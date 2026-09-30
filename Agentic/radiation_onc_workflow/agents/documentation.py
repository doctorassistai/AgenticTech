"""
agents/documentation.py — Module 09: Documentation & Clinical Intelligence.

The highest data-ready agent (see PLAN.md §5/§6), built first to validate the whole
framework. It derives the status/last-generated/completeness of the ten clinical
documents the dashboard tracks — from the EBRT record, the workflow Summary, the AI
Clinical Summary (patient_summary) and the Tumor Board / MDT Plan (tumorBoardPlan) —
and honestly labels "Not available" the documents that have no source in the data.

Frozen row mapping for Module 09 (handled by RadiationOncologyIntelligence.jsx):
    param        → Document
    status/label → Status pill (col 2)
    finding      → Last Generated  (col 3)
    ref          → Completeness    (col 4)
    action       → Indication / Action (col 5)

This agent emits exactly those six keys per row; it adds nothing to the dashboard.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from ..data_sources import coalesce_history
from ..state import Row, STATUS_OK, STATUS_WATCH, STATUS_ALERT, STATUS_NEUTRAL, DASH
from .base import BaseAgent


def _short_date(iso: str) -> str:
    """'2026-07-30T11:15:16' → '30 Jul 2026'. Best-effort, never raises."""
    if not iso:
        return DASH
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    try:
        date_part = iso.replace(" ", "T").split("T")[0]
        y, m, d = date_part.split("-")
        return f"{int(d):02d} {months[int(m) - 1]} {y}"
    except (ValueError, IndexError):
        return iso.replace(" ", "T").split("T")[0] or DASH


def _latest_saved_at(record: Dict[str, Any], stage: str) -> str:
    """Newest savedAt across a stage's history snapshots."""
    history = (record.get("history") or {}).get(stage) or []
    stamps = [s.get("savedAt", "") for s in history if isinstance(s, dict)]
    return max(stamps) if stamps else ""


def _snippet(text: str, limit: int = 120) -> str:
    """Length-capped one-liner: markdown-bold stripped, whitespace collapsed."""
    clean = " ".join(str(text).replace("**", "").split())
    if len(clean) <= limit:
        return clean
    return clean[:limit].rsplit(" ", 1)[0].rstrip() + "…"


def _summary_paragraphs(doc: Dict[str, Any]) -> List[str]:
    """
    Pull the AI Clinical Summary paragraphs out of a patient_summary document.

    Mirrors what the 'AI Clinical Summary' tab renders: `summary.paragraphs[]`, each a
    string or a `{text}` object. A few older docs nest the same list under a top-level
    `patient_summary` key. Empty/blank entries are dropped. Never raises.
    """
    if not isinstance(doc, dict):
        return []
    for container in (doc.get("summary"), doc.get("patient_summary")):
        if not isinstance(container, dict):
            continue
        paras = container.get("paragraphs")
        if not isinstance(paras, list):
            continue
        out: List[str] = []
        for p in paras:
            if isinstance(p, str):
                text = p.strip()
            elif isinstance(p, dict):
                text = str(p.get("text", "")).strip()
            else:
                text = ""
            if text:
                out.append(text)
        if out:
            return out
    return []


def _tumor_board_fields(plan: Dict[str, Any]) -> Dict[str, str]:
    """
    Flatten a tumor-board source into a few human-readable fields.

    Handles both the `tumorBoardPlan` collection doc and the
    `rt-record-details.common.tumorBoard` mirror (which wraps the plan under `planData`
    when loaded from get-tumor-board-plan). Absent/blank fields become "". Never raises.
    """
    if not isinstance(plan, dict):
        return {}
    inner = plan.get("planData") if isinstance(plan.get("planData"), dict) else plan

    def g(*keys: str) -> str:
        for k in keys:
            v = inner.get(k)
            if v not in (None, "", []):
                return str(v).strip()
        return ""

    return {
        "speciality": g("speciality", "specialty"),
        "recommendation": g("doctorRecommendation", "recommendation"),
        "followed": g("tbFollowed"),
        "schedule": g("tbScheduleDate", "scheduleDate", "meetingDate"),
        "question": g("tbQuestion"),
        "status": g("status"),
        "date": g("created_at", "createdAt", "generated_at"),
    }


class DocumentationAgent(BaseAgent):
    moduleId = "m9"
    slug = "documentation"
    num = "09 / 12"
    title = "Documentation & Clinical Intelligence"

    async def gather_context(self, patient_id: Optional[str]) -> Dict[str, Any]:
        ebrt_record = await self.ds.get_ebrt_record(patient_id)
        workflow_record = await self.ds.get_workflow_record(patient_id)
        data = workflow_record.get("data") or {}  # workflow stages live under data.<stage>
        patient_summary = await self.ds.get_patient_summary(patient_id)
        tumor_board = await self.ds.get_tumor_board_plan(patient_id)
        return {
            "record": ebrt_record,
            "ebrt": coalesce_history(ebrt_record, "ebrt"),
            "discharge": coalesce_history(ebrt_record, "discharge"),
            "common": coalesce_history(ebrt_record, "common"),
            "summary": coalesce_history(data, "summary"),
            "patientSummary": patient_summary,
            "tumorBoard": tumor_board,
            "ebrtSavedAt": _latest_saved_at(ebrt_record, "ebrt"),
            "dischargeSavedAt": _latest_saved_at(ebrt_record, "discharge"),
            "summarySavedAt": _latest_saved_at(data, "summary"),
        }

    def build_rows(self, ctx: Dict[str, Any]) -> List[Row]:
        record = ctx["record"]
        ebrt = ctx.get("ebrt") or {}
        discharge = ctx.get("discharge") or {}
        common = ctx.get("common") or {}
        summary = ctx.get("summary") or {}
        patient_summary = ctx.get("patientSummary") or {}
        tumor_board = ctx.get("tumorBoard") or {}
        ebrt_date = _short_date(ctx.get("ebrtSavedAt", ""))
        disc_date = _short_date(ctx.get("dischargeSavedAt", ""))
        sum_date = _short_date(ctx.get("summarySavedAt", ""))

        sim_sets = ebrt.get("simulationSets") or []
        procedure = ebrt.get("procedure") or {}
        approvals = ebrt.get("approvals") or {}
        completion = ebrt.get("completion") or {}
        adverse = ebrt.get("adverseEvents") or []
        follow_up = ebrt.get("followUp") or {}
        rt_completed = str(record.get("status", "")).lower() == "completed"

        rows: List[Row] = []

        # 1. Consultation Summary — the AI "Clinical Summary" (patient_summary collection).
        paragraphs = _summary_paragraphs(patient_summary)
        if paragraphs:
            n = len(paragraphs)
            gen_date = _short_date(str(patient_summary.get("generated_at", "")))
            rows.append(Row(
                param="Consultation Summary",
                status=STATUS_OK, statusLabel="Final",
                finding=gen_date,
                ref="Complete",
                action=(f"AI Clinical Summary on record "
                        f"({n} paragraph{'s' if n != 1 else ''}): {_snippet(paragraphs[0])}"),
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Consultation Summary",
                ref="Requires consultation record",
                action="Populates from the AI Clinical Summary when it is generated.",
                source="gap",
            ))

        # 2. Simulation Summary — derived from ebrt.simulationSets.
        if sim_sets:
            sim = sim_sets[0]
            immob = sim.get("immobilisation") or "immobilisation recorded"
            rows.append(Row(
                param="Simulation Summary",
                status=STATUS_OK, statusLabel="Final",
                finding=ebrt_date,
                ref="Complete",
                action=f"CT sim on record ({immob}). No action.",
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Simulation Summary", ref="Requires simulation set",
                action="Populates from ebrt.simulationSets.", source="gap"))

        # 3. Treatment Plan Summary — procedure + approvals sign-off.
        if procedure:
            signed = [
                approvals.get("roSigned"),
                approvals.get("mpSigned"),
                approvals.get("rttSigned"),
            ]
            all_signed = all(bool(x) for x in signed)
            technique = procedure.get("technique") or "technique recorded"
            rows.append(Row(
                param="Treatment Plan Summary",
                status=STATUS_OK if all_signed else STATUS_WATCH,
                statusLabel="Final" if all_signed else "Draft",
                finding=ebrt_date,
                ref="Complete" if all_signed else "Awaiting sign-off",
                action=(f"{technique} plan; RO/MP/RTT signed. No action."
                        if all_signed
                        else f"{technique} plan; complete approvals to finalize."),
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Treatment Plan Summary", ref="Requires procedure record",
                action="Populates from ebrt.procedure.", source="gap"))

        # 4. Weekly Review Summary — no on-treatment review source available.
        rows.append(Row.not_available(
            "Weekly Review Summary",
            ref="Requires on-treatment reviews",
            action="Populates when weekly on-treatment visits are recorded.",
            source="gap",
        ))

        # 5. Completion Summary — status=completed + discharge narrative.
        has_completion_text = bool((discharge or {}).get("summaryParagraph"))
        if rt_completed and (has_completion_text or completion):
            rows.append(Row(
                param="Completion Summary",
                status=STATUS_OK, statusLabel="Final",
                finding=disc_date if has_completion_text else ebrt_date,
                ref="Complete",
                action=(f"Treatment {completion.get('rtCompletion', 'completed')}; "
                        f"response {completion.get('clinResponse', 'recorded')} "
                        f"({completion.get('responseCriteria', 'n/a')})."),
                source="db",
            ))
        elif completion:
            rows.append(Row(
                param="Completion Summary",
                status=STATUS_NEUTRAL, statusLabel="Not yet generated",
                finding=DASH, ref="Pending treatment completion",
                action="Auto-generates when status becomes completed.",
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Completion Summary", ref="Requires completion record",
                action="Populates at end of treatment.", source="gap"))

        # 6. Toxicity Summary — workflow Summary toxicities + EBRT adverseEvents + discharge text.
        wf_tox = [t for t in (summary.get("toxicities") or []) if isinstance(t, dict)]
        tox_text = bool((discharge or {}).get("toxicitySummaryParagraph"))
        tox_count = len(wf_tox) + len(adverse)
        if wf_tox or adverse or tox_text:
            grades = ([_grade_num(t.get("grade")) for t in wf_tox]
                      + [_grade_num(a.get("grade")) for a in adverse])
            worst_grade = max(grades) if grades else 0
            if worst_grade >= 3:
                tox_status = STATUS_ALERT
            elif worst_grade >= 2:
                tox_status = STATUS_WATCH
            else:
                tox_status = STATUS_OK
            # Name the worst-grade event for the action line (Summary first, then EBRT).
            worst_name = ""
            for t in wf_tox:
                if _grade_num(t.get("grade")) == worst_grade:
                    worst_name = str(t.get("toxicity", "")).strip()
                    break
            if not worst_name:
                for a in adverse:
                    if _grade_num(a.get("grade")) == worst_grade:
                        worst_name = str(a.get("event", "")).strip()
                        break
            if tox_count:
                detail = (f"{tox_count} toxicit{'ies' if tox_count != 1 else 'y'} recorded"
                          + (f"; worst Grade {worst_grade}" if worst_grade else "")
                          + (f" ({worst_name})" if worst_name else "") + ".")
            else:
                detail = "Toxicity narrative on record."
            # Prefer the source's own timestamp for "Last Generated".
            candidates = ([sum_date] if wf_tox else []) + ([ebrt_date] if adverse else []) \
                + ([disc_date] if tox_text else [])
            finding_date = next((d for d in candidates if d and d != DASH), DASH)
            rows.append(Row(
                param="Toxicity Summary",
                status=tox_status, statusLabel="Final",
                finding=finding_date,
                ref="Complete",
                action=detail,
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Toxicity Summary", ref="Requires toxicity record",
                action="Populates from the workflow Summary toxicities or ebrt.adverseEvents.",
                source="gap"))

        # 7. Follow-up Summary — ebrt.followUp plan.
        if follow_up and (follow_up.get("date") or follow_up.get("postCompletionPlan")):
            rows.append(Row(
                param="Follow-up Summary",
                status=STATUS_OK, statusLabel="Final",
                finding=_short_date(follow_up.get("date", "")) or ebrt_date,
                ref="Complete",
                action=(f"Next: {_short_date(follow_up.get('date',''))}"
                        f"{', imaging ' + follow_up.get('imagingAdvised') if follow_up.get('imagingAdvised') else ''}."),
                source="db",
            ))
        else:
            rows.append(Row(
                param="Follow-up Summary",
                status=STATUS_NEUTRAL, statusLabel="Not yet generated",
                finding=DASH, ref="Pending first follow-up",
                action="Generates after first follow-up visit.",
                source="db",
            ))

        # 8. Tumor Board Summary — tumorBoardPlan collection, then common.tumorBoard mirror.
        tb = _tumor_board_fields(tumor_board)
        if not any(tb.values()):
            tb = _tumor_board_fields(common.get("tumorBoard") or {})
        if any(tb.values()):
            pending = tb.get("status", "").lower() == "pending"
            bits: List[str] = []
            if tb.get("speciality"):
                bits.append(tb["speciality"])
            if tb.get("recommendation"):
                bits.append(f"recommendation: {_snippet(tb['recommendation'], 80)}")
            elif tb.get("question"):
                bits.append(f"question: {_snippet(tb['question'], 80)}")
            if tb.get("schedule"):
                bits.append(f"scheduled {_short_date(tb['schedule'])}")
            detail = "MDT plan on record" + (f" — {'; '.join(bits)}" if bits else "") + "."
            rows.append(Row(
                param="Tumor Board Summary",
                status=STATUS_WATCH if pending else STATUS_OK,
                statusLabel="Pending" if pending else "Final",
                finding=_short_date(tb.get("date", "")),
                ref="Awaiting review" if pending else "Complete",
                action=detail,
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Tumor Board Summary",
                ref="Requires MDT record",
                action="Populates from the Tumor Board / MDT Plan when recorded.",
                source="gap",
            ))

        # 9. Guideline Evidence Viewer — needs a guideline KB link.
        rows.append(Row.not_available(
            "Guideline Evidence Viewer",
            ref="Requires guideline KB link",
            action="Enables when the guideline knowledge base is linked.",
            source="request",
        ))

        # 10. Explainable AI Recommendation Log — this agent's own provenance.
        derived = sum(1 for r in rows if r.statusLabel != "Not available")
        rows.append(Row(
            param="Explainable AI Recommendation Log",
            status=STATUS_OK, statusLabel="Active",
            finding="Live",
            ref="Traceable",
            action=f"{derived + 1} of 10 rows derived from source records; "
                   "each finding is traceable to a field.",
            source="derived",
        ))

        return rows

    def build_prompt(self, ctx: Dict[str, Any], rows: List[Row]) -> Optional[str]:
        """
        Optional: ask the LLM to synthesize document narrative BODIES (prose only),
        stored under meta.narrative. Row status/completeness above are already final
        and do not depend on this. Skips cleanly when GROQ_API_KEY is unset.
        """
        discharge = ctx.get("discharge") or {}
        ebrt = ctx.get("ebrt") or {}
        payload = {
            "simulation": (ebrt.get("simulationSets") or [{}])[0],
            "procedure": ebrt.get("procedure"),
            "completion": ebrt.get("completion"),
            "adverseEvents": ebrt.get("adverseEvents"),
            "followUp": ebrt.get("followUp"),
            "dischargeSummary": discharge.get("summaryParagraph"),
        }
        return (
            "You are a radiation oncology documentation assistant. Using ONLY the "
            "JSON below, write concise clinical summary bodies. Do not invent data; "
            "if a field is missing use an empty string. Return a JSON object with "
            'keys "simulation", "treatmentPlan", "completion", "toxicity", '
            '"followUp", each a 1-2 sentence string.\n\n'
            f"DATA:\n{json.dumps(payload, default=str)}"
        )


def _grade_num(grade: str) -> int:
    """'Grade 2' → 2; unknown → 0."""
    for token in str(grade).replace("Grade", "").split():
        if token.isdigit():
            return int(token)
    return 0
