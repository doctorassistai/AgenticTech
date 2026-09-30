"""
header.py — Dashboard header summariser (patient strip + KPI cards).

The 12 module tables are populated by their agents; the two strips at the top of
RadiationOncologyIntelligence.jsx (the patient-identity strip and the 6 KPI cards) are a
roll-up SUMMARY. This module derives their VALUES from the same two read-only records,
matched to the frozen labels. It adds/removes no card or field — values only, with an
honest "Not available" whenever a value cannot be sourced. Nothing clinical is invented.

Returned shape (consumed by the JSX header overlay, matched by frozen label):
    {
      "patientStrip": { "<label>": {"v": str, "sub": str}, ... },
      "kpis":         { "<label>": {"num": str, "status": str, "text": str}, ... },
      "generatedAt":  ISO-8601 UTC string,
    }
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from .data_sources import (
    RTDataSource,
    coalesce_history,
    get_data_source,
    resolve_delivery,
    resolve_prescription,
)
from .state import STATUS_OK, STATUS_WATCH, STATUS_ALERT, STATUS_NEUTRAL

NA = "Not available"
_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


# ── helpers ──────────────────────────────────────────────────────────────────
def _clean(value: Any) -> str:
    """Trimmed string; empty for None/blank/'none'/'null'/'nil'/'na'."""
    text = str(value).strip() if value is not None else ""
    return "" if text.lower() in ("", "none", "null", "nil", "na", "n/a") else text


def _num(value: Any) -> Optional[float]:
    try:
        return float(str(value).strip())
    except (ValueError, TypeError):
        return None


def _fmt(value: Optional[float]) -> str:
    if value is None:
        return "—"
    return f"{value:.0f}" if abs(value - round(value)) < 0.05 else f"{value:.1f}"


def _grade_num(value: Any) -> Optional[int]:
    m = re.search(r"[0-5]", str(value or ""))
    return int(m.group()) if m else None


def _short_date(iso: Any) -> str:
    text = _clean(iso)
    if not text:
        return ""
    try:
        y, m, d = text.split("T")[0].split("-")
        return f"{int(d):02d} {_MONTHS[int(m) - 1]} {y}"
    except (ValueError, IndexError):
        return text.split("T")[0]


def _cap(text: str) -> str:
    return text[:1].upper() + text[1:] if text else text


def _short_diagnosis(value: Any) -> str:
    """Condense a free-text / LLM diagnosis narrative to a single short headline.

    The "Medical History → Diagnosis" field is often a multi-sentence summary
    (primary diagnosis, then active problems / staging / markers). The header cell
    wants just the primary-diagnosis line, so: strip markdown emphasis, drop any
    leading "Diagnosis:" label, keep the first sentence, and — only if that is still
    long — keep its first clause (e.g. "**Locally advanced breast cancer, right
    breast, invasive ductal carcinoma, …**" → "Locally advanced breast cancer").
    Nothing is invented; we only trim what the record already says.
    """
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if not text:
        return ""
    text = text.replace("*", "").replace("`", "")
    text = re.sub(r"^\s*(primary\s+)?diagnos[ei]s\s*[:\-–]\s*", "", text, flags=re.I)
    sentence = re.split(r"[.;\n]", text, maxsplit=1)[0].strip()
    if len(sentence) <= 40:
        return sentence
    return re.split(r",", sentence, maxsplit=1)[0].strip()


def _parse_date(value: Any) -> Optional[date]:
    text = _clean(value)
    if not text:
        return None
    try:
        return date.fromisoformat(text.split("T")[0])
    except ValueError:
        return None


def _weekdays_between(a: date, b: date) -> int:
    """Mon-Fri days strictly between two dates (the treatment days a gap skipped)."""
    n, cur = 0, a + timedelta(days=1)
    while cur < b:
        if cur.weekday() < 5:
            n += 1
        cur += timedelta(days=1)
    return n


def _mod_status(modules_map: Dict[str, Any], mid: str) -> str:
    """The authoritative roll-up status of one module envelope (drives the KPI dot)."""
    env = (modules_map or {}).get(mid) or {}
    data = env.get("data") or {}
    st = _clean(data.get("status"))
    return st if st in (STATUS_OK, STATUS_WATCH, STATUS_ALERT, STATUS_NEUTRAL) else STATUS_NEUTRAL


def _kpi(num: str, status: str, *, ok: str, watch: str, alert: str) -> Dict[str, str]:
    """One KPI card: derived headline number + module-authoritative status + short caption."""
    if not num or num == "—":
        return {"num": "—", "status": STATUS_NEUTRAL, "text": NA}
    text = {STATUS_OK: ok, STATUS_WATCH: watch, STATUS_ALERT: alert}.get(status, "Recorded")
    return {"num": num, "status": status, "text": text}


def _dose_plan(ebrt: Dict[str, Any]) -> tuple:
    """(totalDose cGy, totalFractions) resolved across procedure / ebrt / first sim set."""
    procedure = ebrt.get("procedure") or {}
    sims = ebrt.get("simulationSets") or []
    sim = sims[0] if isinstance(sims, list) and sims else {}

    def pick(key: str) -> Optional[float]:
        for src in (procedure, ebrt, sim):
            if isinstance(src, dict):
                v = _num(src.get(key))
                if v is not None:
                    return v
        return None

    return pick("totalDose"), pick("totalFractions")


async def build_header(
    patient_id: Optional[str],
    modules_map: Optional[Dict[str, Any]] = None,
    data_source: Optional[RTDataSource] = None,
) -> Dict[str, Any]:
    """
    Derive the header strip + KPI values from the two read-only records. KPI *status*
    comes from the already-computed module roll-ups (single source of truth); KPI
    *numbers* and every strip value are sourced from the records. Never invents data.
    """
    ds = data_source or get_data_source()
    ebrt_raw = await ds.get_ebrt_record(patient_id)
    wf_raw = await ds.get_workflow_record(patient_id)
    data = wf_raw.get("data") or {}

    ebrt = coalesce_history(ebrt_raw, "ebrt")
    brachy = coalesce_history(ebrt_raw, "brachy")
    common = coalesce_history(ebrt_raw, "common")
    discharge = coalesce_history(ebrt_raw, "discharge")
    intent = coalesce_history(data, "intent")
    patient = coalesce_history(data, "patient")
    summary = coalesce_history(data, "summary")
    qa = coalesce_history(data, "qa")
    sessions_stage = coalesce_history(data, "sessions")
    treatment = coalesce_history(data, "treatment")

    # Which course was delivered — EBRT or brachytherapy — with its keys normalised so
    # dose / fraction / gap values below source from the right side of data.sessions.
    deliv = resolve_delivery(sessions_stage, treatment)

    procedure = ebrt.get("procedure") or {}
    primary = discharge.get("primary") or {}
    follow_up = ebrt.get("followUp") or {}
    sessions = [s for s in (sessions_stage.get("treatmentSessions") or []) if isinstance(s, dict)]
    adverse = [a for a in (ebrt.get("adverseEvents") or []) if isinstance(a, dict)]

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    # ── patient strip ────────────────────────────────────────────────────────
    pid = (_clean(patient.get("patientId")) or _clean(wf_raw.get("patientId"))
           or _clean(ebrt_raw.get("patientId")) or _clean(patient_id))
    pname = _clean(patient.get("patientName")) or _clean(patient.get("firstName"))

    # Diagnosis: the "Medical History → Diagnosis" free-text field (patient.diagnosis).
    # Falls back to histology/target-site only when that field is not recorded. The field
    # is a free-text/LLM summary, so internal whitespace is collapsed for the one-line cell.
    dx_text = _short_diagnosis(patient.get("diagnosis"))
    histo = _clean(primary.get("Histopathology"))
    laterality = _clean(primary.get("Laterality"))
    targets = [t for t in (intent.get("targetVolumes") or []) if isinstance(t, dict)]
    site = _clean(targets[0].get("volumeName")) if targets else ""
    if dx_text:
        diagnosis = dx_text
        diag_sub = ""
    else:
        diagnosis = histo or site
        if diagnosis and laterality:
            diagnosis = f"{diagnosis} ({laterality})"
        diag_sub = site if (histo and site and site.lower() not in histo.lower()) else ""

    intent_val = _clean(intent.get("treatmentIntent")) or _clean(primary.get("Intent"))

    # Course dose/fractions: the prescription is resolved by the shared helper — the
    # workflow "Treatment Plan" tab (data.treatment, Gy) first, then the legacy EBRT sim
    # set (cGy → Gy). `_dose_plan` back-fills a totalDose recorded at procedure/ebrt level
    # (outside a sim set); brachytherapy, which has no EBRT plan, falls back to the
    # delivered brachy dose/sessions (already Gy).
    presc = resolve_prescription(treatment, ebrt, brachy, common.get("treatment"))
    dose_gy = presc["total_gy"]
    total_fx = _num(presc["n_fx"])
    if dose_gy is None or total_fx is None:
        total_dose_cgy, plan_fx = _dose_plan(ebrt)
        if dose_gy is None and total_dose_cgy is not None:
            dose_gy = total_dose_cgy / 100.0
        if total_fx is None and plan_fx is not None:
            total_fx = plan_fx
    if dose_gy is None:
        dose_gy = _num(deliv.get("totalDoseDeliveredGy"))
    if total_fx is None:
        total_fx = _num(deliv.get("totalSessionsDelivered"))
    if dose_gy is not None and total_fx:
        course = f"{_fmt(dose_gy)} Gy / {int(total_fx)} fx"
    elif dose_gy is not None:
        course = f"{_fmt(dose_gy)} Gy"
    elif total_fx:
        course = f"{int(total_fx)} fx"
    else:
        course = ""
    delivered_gy = _num(summary.get("totalDoseDeliveredGy"))
    if delivered_gy is None:
        delivered_gy = _num(deliv.get("totalDoseDeliveredGy"))
    # Show the delivered sub-line only when it adds something beyond the course value.
    course_sub = (f"{_fmt(delivered_gy)} Gy delivered"
                  if delivered_gy is not None
                  and (dose_gy is None or abs(delivered_gy - dose_gy) >= 0.05)
                  else "")

    systemic = _clean(procedure.get("systemicTherapy"))
    combo = _clean(procedure.get("combinationSpecify"))
    concurrent = "concurrent" in (combo + " " + systemic).lower()
    if systemic:
        concurrent_val = f"{systemic} (concurrent)" if concurrent else f"{systemic} (sequential)"
    else:
        concurrent_val = "None"

    strip = {
        "Patient ID": {"v": pid or NA, "sub": pname},
        "Diagnosis": {"v": diagnosis or NA, "sub": diag_sub},
        "Intent": {"v": _cap(intent_val) or NA, "sub": ""},
        "Course": {"v": course or NA, "sub": course_sub},
        "Concurrent Systemic": {"v": concurrent_val, "sub": ""},
        "Report Generated": {"v": now, "sub": ""},
    }

    # ── KPI cards (num from records, status from the module roll-up) ──────────
    # Plan / Delivery (m5): delivered vs planned fractions.
    delivered_fx = _num(summary.get("fractionsCompleted"))
    if delivered_fx is None:
        delivered_fx = _num(deliv.get("totalSessionsDelivered"))
    if delivered_fx is None and sessions:
        delivered_fx = float(len(sessions))
    if delivered_fx is not None and total_fx:
        plan_num = f"{int(delivered_fx)} / {int(total_fx)} fx"
    elif delivered_fx is not None:
        plan_num = f"{int(delivered_fx)} fx"
    else:
        plan_num = "—"

    # Cumulative Dose Ledger (m3): delivered dose, else planned.
    if delivered_gy is not None:
        dose_num = f"{_fmt(delivered_gy)} Gy"
    elif dose_gy is not None:
        dose_num = f"{_fmt(dose_gy)} Gy"
    else:
        dose_num = "—"

    # Active Toxicity (m7): worst recorded grade across summary + adverse events.
    grades: List[int] = []
    reported = 0
    for t in (summary.get("toxicities") or []):
        if isinstance(t, dict) and _clean(t.get("toxicity")):
            reported += 1
            g = _grade_num(t.get("grade"))
            if g is not None:
                grades.append(g)
    for a in adverse:
        if _clean(a.get("event")):
            reported += 1
            g = _grade_num(a.get("grade"))
            if g is not None:
                grades.append(g)
    if grades:
        tox_num = f"G{max(grades)}"
    elif reported:
        tox_num = "Reported"
    else:
        tox_num = "None"

    # Treatment Gap (m6): largest weekday gap between consecutive fractions (EBRT), or —
    # for brachytherapy, which has no per-fraction calendar — the longest recorded
    # interruption span.
    sess_dates = sorted({d for d in (_parse_date(s.get("date")) for s in sessions) if d})
    if len(sess_dates) >= 2:
        max_gap = max(_weekdays_between(a, b) for a, b in zip(sess_dates, sess_dates[1:]))
        gap_num = f"{max_gap} d"
    elif deliv.get("interruptions"):
        spans = []
        for it in deliv["interruptions"]:
            a, b = _parse_date(it.get("startDate")), _parse_date(it.get("endDate"))
            if a and b and b >= a:
                spans.append(_weekdays_between(a - timedelta(days=1), b + timedelta(days=1)))
        gap_num = f"{max(spans)} d" if spans else "—"
    else:
        gap_num = "—"

    # Plan QA (m4): gamma pass rate.
    gamma = _num(qa.get("gammaPassRate"))
    qa_num = f"{_fmt(gamma)}%" if gamma is not None else "—"

    # Next Response Assessment (m8): scheduled follow-up date.
    next_fu = _short_date(follow_up.get("date")) or _short_date(follow_up.get("nextVisit"))
    resp_num = next_fu or "—"

    kpis = {
        "Plan / Delivery": _kpi(
            plan_num, _mod_status(modules_map, "m5"),
            ok="On schedule", watch="Monitor delivery", alert="Delivery deviation"),
        "Cumulative Dose Ledger": _kpi(
            dose_num, _mod_status(modules_map, "m3"),
            ok="Within limits", watch="Approaching limit", alert="Constraint exceeded"),
        "Active Toxicity": _kpi(
            tox_num, _mod_status(modules_map, "m7"),
            ok="No active toxicity", watch="Monitor toxicity", alert="Manage toxicity"),
        "Treatment Gap": _kpi(
            gap_num, _mod_status(modules_map, "m6"),
            ok="No significant gap", watch="Gap — compensate", alert="Prolonged gap"),
        "Plan QA": _kpi(
            qa_num, _mod_status(modules_map, "m4"),
            ok="QA passed", watch="QA review", alert="QA failed"),
        "Next Response Assessment": _kpi(
            resp_num, _mod_status(modules_map, "m8"),
            ok="Scheduled", watch="Due for review", alert="Overdue"),
    }

    return {"patientStrip": strip, "kpis": kpis, "generatedAt": now}

