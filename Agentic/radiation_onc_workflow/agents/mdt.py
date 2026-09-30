"""
agents/mdt.py — Module 11: Multidisciplinary Decision Support.

Keeps the radiation, systemic-therapy and surgical timelines coordinated and surfaces
the case context a tumor board needs. Everything is derived from what the record states:
treatment intent, the systemic regimen (from the chemotherapy record when linked, else the
RT record's recorded systemic-therapy note), prior treatments, and histology/grade/stage/
adverse features from the pathology report when documented. Molecular-marker results
(IHC/mutation), an open-trial registry, and a formal guideline knowledge base are NOT present
in the linked databases, so those rows are honestly labelled "Not available". Nothing clinical
is invented; sequencing/safety references are published-standard statements disclosed in each
row's reference column.

Sources:
  * `chemotherapy_records` → the authoritative systemic-therapy record via
    resolve_chemotherapy() (latest-cycle regimen/intent, cycle progress, drug allergies,
    aggregated toxicities, organ-function flags, tumor-board question) — drives Chemoradiation
    Coordination, Concurrent Systemic Therapy Safety and Tumor Board Decision Assistant when a
    record is linked; `ebrt.procedure` is the fallback.
  * `onco_pathology` → the surgical-pathology report via resolve_pathology() (histology,
    grade, AJCC stage, resection margins, node counts, LVI/PNI) — authoritative for
    Pathology Correlation, with `discharge.primary` as the fallback.
  * `rt-record-details` → `ebrt.procedure` (systemicTherapy, combinationSpecify, technique —
    fallback systemic source), `ebrt.followUp` (postCompletionPlan — MDT review
    documentation); `discharge.primary` (Histopathology, 'TNM Staging', Intent — fallback
    histology snapshot).
  * `radiotherapy_records` → `data.intent` (treatmentIntent, treatmentSetting),
    `data.patient` (previousTreatments[]: treatmentType/date/outcome), `data.summary`
    (treatmentOutcome).

Frozen row mapping for Module 11 (standard renderer):
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

from ..data_sources import coalesce_history, resolve_chemotherapy, resolve_pathology
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
        return ""
    try:
        y, m, d = text.split("T")[0].split("-")
        return f"{int(d):02d} {_MONTHS[int(m) - 1]} {y}"
    except (ValueError, IndexError):
        return text.split("T")[0]


def _clean(value: Any) -> str:
    """Trimmed string; empty for None/blank/'none'/'null'/'nil' so callers test truthiness."""
    text = str(value).strip() if value is not None else ""
    return "" if text.lower() in ("", "none", "null", "nil", "na", "n/a") else text


def _priors(prev: List[Dict[str, Any]], *terms: str) -> List[Dict[str, Any]]:
    """Prior treatments whose treatmentType contains any of the given substrings."""
    out = []
    for p in prev:
        tt = _clean(p.get("treatmentType")).lower()
        if tt and any(t in tt for t in terms):
            out.append(p)
    return out


def _prior_txt(priors: List[Dict[str, Any]]) -> str:
    """'Chemotherapy (30 Jul 2026)' from the newest matching prior treatment."""
    if not priors:
        return ""
    p = priors[-1]
    label = _clean(p.get("treatmentType")) or "prior treatment"
    when = _short_date(p.get("date"))
    return label + (f" ({when})" if when else "")


def _cycle_progress(chemo: Dict[str, Any]) -> str:
    """'cycle 2 of 3, 1 completed' from the chemotherapy record's progress counters."""
    cur = chemo.get("current_cycle")
    planned = chemo.get("planned_cycles")
    done = chemo.get("completed_cycles")
    bits: List[str] = []
    if cur and planned:
        bits.append(f"cycle {cur} of {planned}")
    elif cur:
        bits.append(f"cycle {cur}")
    elif planned:
        bits.append(f"{planned} cycles planned")
    if done:
        bits.append(f"{done} completed")
    if chemo.get("treatment_completed"):
        bits.append("treatment completed")
    return ", ".join(bits)


class MDTAgent(BaseAgent):
    moduleId = "m11"
    slug = "mdt"
    num = "11 / 12"
    title = "Multidisciplinary Decision Support"

    async def gather_context(self, patient_id: Optional[str]) -> Dict[str, Any]:
        details_record = await self.ds.get_ebrt_record(patient_id)
        workflow_record = await self.ds.get_workflow_record(patient_id)
        data = workflow_record.get("data") or {}
        return {
            "ebrt": coalesce_history(details_record, "ebrt"),
            "discharge": coalesce_history(details_record, "discharge"),
            "intent": coalesce_history(data, "intent"),
            "patient": coalesce_history(data, "patient"),
            "summary": coalesce_history(data, "summary"),
            "pathology": resolve_pathology(await self.ds.get_pathology_record(patient_id)),
            "chemo": resolve_chemotherapy(await self.ds.get_chemotherapy_record(patient_id)),
        }

    def build_rows(self, ctx: Dict[str, Any]) -> List[Row]:
        ebrt = ctx.get("ebrt") or {}
        discharge = ctx.get("discharge") or {}
        intent = ctx.get("intent") or {}
        patient = ctx.get("patient") or {}
        chemo = ctx.get("chemo") or {}

        procedure = ebrt.get("procedure") or {}
        follow_up = ebrt.get("followUp") or {}
        primary = discharge.get("primary") or {}
        prev = [p for p in (patient.get("previousTreatments") or []) if isinstance(p, dict)]

        intent_val = _clean(intent.get("treatmentIntent")) or _clean(primary.get("Intent"))
        il = intent_val.lower()
        systemic = _clean(procedure.get("systemicTherapy"))
        combo = _clean(procedure.get("combinationSpecify"))
        technique = _clean(procedure.get("technique"))
        concurrent = "concurrent" in (combo + " " + systemic).lower()
        prior_surgery = _priors(prev, "surg")
        prior_chemo = _priors(prev, "chemo", "systemic")
        prior_rt = _priors(prev, "radiat", "radiotherap", "brachy", "ebrt")

        # The chemotherapy_records document is the authoritative systemic-therapy source when
        # present (regimen, cycle progress, allergy/toxicity/organ safety, tumor board). The RT
        # record's single ebrt.procedure.systemicTherapy note is the fallback for older courses.
        chemo_active = bool(chemo.get("has_data"))
        chemo_label = chemo.get("regimen_label")
        chemo_intent = chemo.get("intent")

        # Pathology-first sourcing: the onco_pathology report supersedes the discharge
        # histology snapshot for histology/stage, and carries grade / margins / nodes /
        # LVI-PNI that the discharge summary does not. Falls back to discharge when no
        # report is linked, so nothing regresses for records without a pathology document.
        path = ctx.get("pathology") or {}
        if path.get("has_data"):
            histo = path.get("histology") or _clean(primary.get("Histopathology"))
            stage_txt = path.get("stage_display") or _clean(primary.get("TNM Staging"))
        else:
            histo = _clean(primary.get("Histopathology"))
            stage_txt = _clean(primary.get("TNM Staging"))
        adverse_path: List[str] = []
        if path.get("margin_involved"):
            adverse_path.append("positive margins")
        if path.get("nodes_involved"):
            adverse_path.append("nodal involvement")
        adverse_path.extend(path.get("risk_features") or [])

        rows: List[Row] = []

        # 1. Surgery-RT Sequencing — RT position relative to surgery, from intent + priors.
        setting = _clean(intent.get("treatmentSetting"))
        if prior_surgery:
            rows.append(Row(
                param="Surgery-RT Sequencing",
                status=STATUS_OK, statusLabel="Post-operative",
                finding=f"RT follows prior surgery ({_prior_txt(prior_surgery)})",
                ref="Adjuvant RT typically within ~6 weeks of surgery",
                action="Post-operative sequencing on record; confirm the surgery-to-RT interval "
                       "meets the adjuvant window.",
                source="db",
            ))
        elif "neoadj" in il:
            rows.append(Row(
                param="Surgery-RT Sequencing",
                status=STATUS_WATCH, statusLabel="Neoadjuvant",
                finding="Neoadjuvant intent — RT precedes planned surgery",
                ref="Neoadjuvant RT precedes surgery per protocol",
                action="Coordinate the RT-to-surgery interval with the surgical team.",
                source="db",
            ))
        elif "adjuv" in il or "adjuv" in setting.lower():
            rows.append(Row(
                param="Surgery-RT Sequencing",
                status=STATUS_WATCH, statusLabel="Adjuvant — verify",
                finding="Adjuvant intent but no prior surgery on record",
                ref="Adjuvant RT follows definitive surgery",
                action="Confirm the surgical procedure and date for adjuvant sequencing.",
                source="derived",
            ))
        elif intent_val:
            rows.append(Row(
                param="Surgery-RT Sequencing",
                status=STATUS_OK, statusLabel="RT primary modality",
                finding=f"{intent_val} RT; no surgical resection in the pathway",
                ref="Sequencing defined by the multimodality plan",
                action="RT as the primary modality; no surgery-RT sequencing required for this intent.",
                source="derived",
            ))
        else:
            rows.append(Row.not_available(
                "Surgery-RT Sequencing", ref="Sequencing defined by the multimodality plan",
                action="Populates from treatment intent + prior surgical treatments."))

        # 2. Chemoradiation Coordination — systemic therapy scheduled with RT. The
        #    chemotherapy record (regimen + cycle progress) is authoritative; ebrt.procedure
        #    is the fallback for records without a linked chemo document.
        if chemo_active and (chemo_label or chemo_intent):
            progress = _cycle_progress(chemo)
            label = chemo_label or "Systemic therapy"
            detail_bits = [b for b in (chemo_intent and f"{chemo_intent} intent", progress) if b]
            finding = label + (f" — {', '.join(detail_bits)}" if detail_bits else "")
            if chemo.get("concurrent_rt"):
                rows.append(Row(
                    param="Chemoradiation Coordination",
                    status=STATUS_OK, statusLabel="Concurrent chemo-RT",
                    finding=finding,
                    ref="Concurrent chemo-RT schedule coordinated per protocol",
                    action=f"{label} runs concurrently with RT; align cycle timing with the "
                           "fraction calendar.",
                    source="db",
                ))
            else:
                rows.append(Row(
                    param="Chemoradiation Coordination",
                    status=STATUS_WATCH, statusLabel="Active systemic Rx",
                    finding=finding,
                    ref="Chemo-RT schedule coordinated per protocol",
                    action=("Active systemic therapy on the chemotherapy record"
                            + (f" ({progress})" if progress else "")
                            + " — coordinate RT fraction timing with the chemo cycle calendar."),
                    source="db",
                ))
        elif systemic:
            seq = "concurrent" if concurrent else "sequential"
            rows.append(Row(
                param="Chemoradiation Coordination",
                status=STATUS_OK, statusLabel="Coordinated",
                finding=systemic + (f" — {combo}" if combo else ""),
                ref="Chemo-RT schedule coordinated per protocol",
                action=f"{systemic} coordinated with RT ({seq}); align cycle timing with fractions.",
                source="db",
            ))
        else:
            rows.append(Row(
                param="Chemoradiation Coordination",
                status=STATUS_NEUTRAL, statusLabel="RT alone",
                finding="No systemic therapy recorded with this RT course",
                ref="Chemo-RT schedule coordinated where indicated",
                action="RT delivered without systemic therapy; no chemoradiation coordination required.",
                source="db",
            ))

        # 3. Concurrent Systemic Therapy Safety — added acute-toxicity monitoring. When a
        #    chemotherapy record is linked, its allergy / toxicity / organ-function profile
        #    drives the safety verdict; ebrt.procedure concurrency is the fallback.
        if chemo_active:
            safety_bits: List[str] = []
            wa = chemo.get("worst_allergy") or {}
            if wa.get("drug"):
                sev = wa.get("severity")
                atype = wa.get("type")
                safety_bits.append((f"{sev} " if sev else "") + f"allergy to {wa['drug']}"
                                   + (f" ({atype})" if atype else ""))
            if chemo.get("organ_flags"):
                safety_bits.append("organ function: " + ", ".join(chemo["organ_flags"]))
            if chemo.get("worst_tox_name"):
                safety_bits.append(
                    f"Grade {chemo['worst_tox_grade']} {chemo['worst_tox_name'].lower()}")
            label = chemo_label or "systemic therapy"
            finding = ("On " + label
                       + (f"; {'; '.join(safety_bits)}" if safety_bits
                          else "; no adverse safety flags recorded"))
            high_risk = bool(chemo.get("severe_allergy")) or (chemo.get("worst_tox_grade") or 0) >= 3
            conc = " concurrent with RT" if chemo.get("concurrent_rt") else ""
            if high_risk:
                rows.append(Row(
                    param="Concurrent Systemic Therapy Safety",
                    status=STATUS_ALERT, statusLabel="High-risk profile",
                    finding=finding,
                    ref="Severe drug allergy / Grade ≥3 toxicity — verify safe co-administration with RT",
                    action=(f"Systemic therapy{conc} with a high-risk safety profile "
                            f"({'; '.join(safety_bits)}) — confirm mitigations before/around RT "
                            "and maintain enhanced toxicity monitoring."),
                    source="db",
                ))
            else:
                rows.append(Row(
                    param="Concurrent Systemic Therapy Safety",
                    status=STATUS_WATCH, statusLabel="Enhanced monitoring",
                    finding=finding,
                    ref="Active systemic therapy — monitor additive toxicity (CBC, mucosa, organ function)",
                    action=("Systemic therapy in progress"
                            + (conc or " (concurrency with RT not confirmed on the chemo record)")
                            + "; maintain enhanced toxicity monitoring."),
                    source="db",
                ))
        elif systemic and concurrent:
            rows.append(Row(
                param="Concurrent Systemic Therapy Safety",
                status=STATUS_WATCH, statusLabel="Enhanced monitoring",
                finding=f"Concurrent {systemic.lower()} with RT" + (f" ({combo})" if combo else ""),
                ref="Concurrent chemo-RT raises mucosal/haematologic toxicity — monitor CBC & mucosa",
                action="Concurrent systemic therapy — maintain enhanced toxicity monitoring "
                       "(blood counts, mucositis, hydration).",
                source="db",
            ))
        elif systemic:
            rows.append(Row(
                param="Concurrent Systemic Therapy Safety",
                status=STATUS_OK, statusLabel="Sequential",
                finding=f"{systemic} recorded as sequential (not concurrent) with RT",
                ref="Sequential systemic therapy — lower additive acute toxicity",
                action="Systemic therapy is sequential; standard toxicity monitoring applies.",
                source="db",
            ))
        else:
            rows.append(Row(
                param="Concurrent Systemic Therapy Safety",
                status=STATUS_NEUTRAL, statusLabel="Not applicable",
                finding="No concurrent systemic therapy with this RT course",
                ref="Concurrent-therapy safety assessed where systemic therapy is given",
                action="No concurrent systemic therapy recorded; concurrent-safety review not required.",
                source="derived",
            ))

        # 4. Pathology Correlation — histology / grade / stage / adverse features for the
        #    RT indication, from the onco_pathology report (discharge snapshot as fallback).
        acc = path.get("accession_id")
        if path.get("has_data"):
            bits = []
            if histo:
                bits.append(f"histology {histo}")
            if path.get("grade"):
                bits.append(f"grade {path['grade']}")
            if stage_txt:
                bits.append(f"stage {stage_txt}")
            if path.get("nodes_summary"):
                bits.append(path["nodes_summary"])
            if path.get("margin_involved") and path.get("margin_summary"):
                bits.append(f"margins: {path['margin_summary']}")
            if path.get("risk_features"):
                bits.append("; ".join(path["risk_features"]))
            rows.append(Row(
                param="Pathology Correlation",
                status=STATUS_WATCH if adverse_path else STATUS_OK,
                statusLabel="Adverse features" if adverse_path else "On record",
                finding=("; ".join(bits) if bits
                         else path.get("final_diagnosis") or "Pathology on record"),
                ref="Histology & stage correlated with the RT indication",
                action=(f"Adverse pathology ({', '.join(adverse_path)}) — ensure the RT "
                        "dose/volume and any boost address these"
                        + (f" [{acc}]." if acc else ".")
                        if adverse_path else
                        "Pathology/stage documented"
                        + (f" [{acc}]" if acc else "")
                        + "; confirm the RT dose/volume matches the histology."),
                source="db",
            ))
        elif histo or stage_txt:
            bits = []
            if histo:
                bits.append(f"histology {histo}")
            if stage_txt:
                bits.append(f"stage {stage_txt}")
            rows.append(Row(
                param="Pathology Correlation",
                status=STATUS_OK, statusLabel="On record",
                finding="; ".join(bits),
                ref="Histology & stage correlated with the RT indication",
                action="Pathology/stage documented; confirm the RT dose/volume matches the histology.",
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Pathology Correlation",
                ref="Histology & stage correlated with the RT indication",
                action="Populates from the onco_pathology report or discharge histology/stage."))

        # 5. Molecular Marker Correlation — needs molecular/receptor/mutation results.
        rows.append(Row.not_available(
            "Molecular Marker Correlation",
            ref="Actionable markers (IHC/mutation) correlated with strategy",
            action="Populates when molecular/receptor/mutation results are linked; not stored "
                   "in the workflow record.",
            source="gap",
        ))

        # 6. Tumor Board Decision Assistant — MDT documentation + compiled case context.
        #    The chemotherapy record carries an explicit tumor-board question / follow-through
        #    flag; prefer it, then fall back to the RT care-plan mention and compiled context.
        plan = _clean(follow_up.get("postCompletionPlan"))
        mdt_mentioned = bool(plan and any(
            t in plan.lower() for t in
            ("multidisciplin", "tumor board", "tumour board", "mdt", "board review")))
        case_bits = [b for b in (
            intent_val and f"{intent_val} intent",
            technique and technique,
            systemic and f"+ {systemic.lower()}",
        ) if b]
        tb_followed = (chemo.get("tb_followed") or "").lower()
        tb_ref = (chemo.get("tb_reference") or "").lower()
        tb_question = chemo.get("tb_question")
        tb_schedule = chemo.get("tb_schedule")
        chemo_tb = chemo_active and bool(tb_question or tb_followed or tb_schedule or tb_ref)
        if chemo_tb:
            q_snip = tb_question or ""
            if len(q_snip) > 140:
                q_snip = q_snip[:137].rstrip() + "…"
            find_bits = [b for b in (
                q_snip and f"MDT question: {q_snip}",
                tb_schedule and f"board {_short_date(tb_schedule)}",
            ) if b]
            finding = ("; ".join(find_bits)
                       or "Tumor-board context recorded on the chemotherapy record")
            if tb_followed == "yes" or tb_ref == "yes":
                rows.append(Row(
                    param="Tumor Board Decision Assistant",
                    status=STATUS_OK, statusLabel="MDT documented",
                    finding=finding,
                    ref="Case reviewed at a multidisciplinary tumor board",
                    action="Tumor-board recommendation on record; ensure the RT plan reflects "
                           "the board decision.",
                    source="db",
                ))
            elif tb_followed == "no":
                reason = _clean(chemo.get("tb_not_followed_reason"))
                rows.append(Row(
                    param="Tumor Board Decision Assistant",
                    status=STATUS_WATCH, statusLabel="Board not followed",
                    finding=finding + (f"; recorded reason: {reason}" if reason else ""),
                    ref="Case reviewed at a multidisciplinary tumor board",
                    action="Management diverges from / lacks the tumor-board recommendation — "
                           "confirm the rationale is documented and revisit at MDT.",
                    source="db",
                ))
            else:
                rows.append(Row(
                    param="Tumor Board Decision Assistant",
                    status=STATUS_WATCH,
                    statusLabel="MDT scheduled" if tb_schedule else "Board input pending",
                    finding=finding,
                    ref="Case reviewed at a multidisciplinary tumor board",
                    action="Tumor-board review recorded on the chemotherapy record; confirm the "
                           "outcome is captured before finalising the RT plan.",
                    source="db",
                ))
        elif mdt_mentioned:
            rows.append(Row(
                param="Tumor Board Decision Assistant",
                status=STATUS_OK, statusLabel="MDT documented",
                finding=("Multidisciplinary review documented in the care plan"
                         + (f"; case: {', '.join(case_bits)}" if case_bits else "")),
                ref="Case reviewed at a multidisciplinary tumor board",
                action="MDT review on record; ensure board recommendations are reflected in the plan.",
                source="db",
            ))
        elif case_bits:
            rows.append(Row(
                param="Tumor Board Decision Assistant",
                status=STATUS_NEUTRAL, statusLabel="Case prepared",
                finding="Case summary: " + ", ".join(case_bits),
                ref="Case reviewed at a multidisciplinary tumor board",
                action="Case elements compiled for the board; document the MDT review outcome.",
                source="derived",
            ))
        else:
            rows.append(Row.not_available(
                "Tumor Board Decision Assistant",
                ref="Case reviewed at a multidisciplinary tumor board",
                action="Populates from the recorded case context + MDT documentation."))

        # 7. Re-treatment Eligibility — prior RT triggers a cumulative-dose review.
        if prior_rt:
            rows.append(Row(
                param="Re-treatment Eligibility",
                status=STATUS_WATCH, statusLabel="Prior RT — review",
                finding=f"Prior radiotherapy on record ({_prior_txt(prior_rt)})",
                ref="Cumulative-dose & OAR-tolerance review before re-irradiation",
                action="Prior RT — review cumulative OAR dose and interval before re-treatment "
                       "(see the Dose module).",
                source="db",
            ))
        else:
            rows.append(Row(
                param="Re-treatment Eligibility",
                status=STATUS_OK, statusLabel="First course",
                finding="No prior radiotherapy on record",
                ref="Cumulative-dose review applies to re-irradiation",
                action="First RT course; no re-irradiation cumulative-dose constraint applies.",
                source="derived",
            ))

        # 8. Clinical Trial Matching — needs an open-trial registry with eligibility criteria.
        rows.append(Row.not_available(
            "Clinical Trial Matching",
            ref="Eligible open trials matched to the case",
            action="Populates when an open-trial registry with eligibility criteria is linked.",
            source="gap",
        ))

        # 9. Guideline Compliance Dashboard — needs a guideline knowledge base.
        documented = [n for n, v in (
            ("intent", intent_val), ("technique", technique),
            ("systemic therapy", systemic), ("stage", stage_txt),
        ) if v]
        rows.append(Row.not_available(
            "Guideline Compliance Dashboard",
            ref="Plan checked against NCCN/ESTRO-type guideline criteria",
            action=("Populates when a guideline knowledge base is linked"
                    + (f" (documented: {', '.join(documented)})." if documented else ".")),
            source="gap",
        ))

        # 10. Personalized Strategy Recommendation — factual roll-up of the documented strategy.
        strat = []
        if intent_val:
            strat.append(f"{intent_val} RT")
        if technique:
            strat.append(technique)
        if systemic:
            strat.append(("concurrent " if concurrent else "") + systemic.lower())
        elif chemo_active and chemo_label:
            strat.append(("concurrent " if chemo.get("concurrent_rt") else "") + chemo_label.lower()
                         + (f" ({chemo_intent})" if chemo_intent else ""))
        if prior_surgery:
            strat.append("post prior surgery")
        if prior_chemo and not systemic and not chemo_active:
            strat.append("prior " + (_clean(prior_chemo[-1].get("treatmentType")).lower()
                                     or "chemotherapy"))
        if adverse_path:
            strat.append("adverse pathology: " + ", ".join(adverse_path))
        if strat:
            rows.append(Row(
                param="Personalized Strategy Recommendation",
                status=STATUS_OK, statusLabel="Documented",
                finding="Documented strategy: " + ", ".join(strat),
                ref="Coordinated multimodality strategy for the patient",
                action="Recorded multimodality strategy summarised; an AI strategy recommender "
                       "activates when a decision model / knowledge base is linked.",
                source="derived",
            ))
        else:
            rows.append(Row.not_available(
                "Personalized Strategy Recommendation",
                ref="Coordinated multimodality strategy for the patient",
                action="Populates from treatment intent + the recorded modality mix.",
                source="gap"))

        return rows

    def build_prompt(self, ctx: Dict[str, Any], rows: List[Row]) -> Optional[str]:
        """
        Optional 1-2 sentence multidisciplinary-coordination narrative (prose only), stored
        under meta.narrative. Row statuses above are already final and independent of this.
        Skips cleanly when GROQ_API_KEY is unset.
        """
        ebrt = ctx.get("ebrt") or {}
        intent = ctx.get("intent") or {}
        patient = ctx.get("patient") or {}
        chemo = ctx.get("chemo") or {}
        procedure = ebrt.get("procedure") or {}
        payload = {
            "treatmentIntent": intent.get("treatmentIntent"),
            "treatmentSetting": intent.get("treatmentSetting"),
            "systemicTherapy": procedure.get("systemicTherapy"),
            "combinationSpecify": procedure.get("combinationSpecify"),
            "technique": procedure.get("technique"),
            "chemotherapy": ({
                "regimen": chemo.get("regimen_label"),
                "intent": chemo.get("intent"),
                "cycleProgress": _cycle_progress(chemo),
                "concurrentWithRT": chemo.get("concurrent_rt"),
                "tumorBoardQuestion": chemo.get("tb_question"),
            } if chemo.get("has_data") else None),
            "previousTreatments": [
                {"type": p.get("treatmentType"), "date": p.get("date")}
                for p in (patient.get("previousTreatments") or []) if isinstance(p, dict)
            ],
        }
        return (
            "You are a radiation oncology multidisciplinary-coordination assistant. Using ONLY "
            "the JSON below, write a concise 1-2 sentence summary of how the RT, systemic and "
            "surgical timelines are coordinated. Do not invent data or make treatment "
            "recommendations; if a field is missing, omit it. Return a JSON object with a single "
            'key "mdt" whose value is the sentence.\n\n'
            f"DATA:\n{json.dumps(payload, default=str)}"
        )
