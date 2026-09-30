from __future__ import annotations
import logging
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ----------------------------------------------------------------------
# This module does two kinds of work, and only two:
#
# 1. FORMATTING — turning already-extracted Pass 1 fields into the
#    display strings/dicts the report-generation prompts need
#    (format_vitals, format_bill_block, format_register_summary,
#    format_complaints_list). These never guess at document content —
#    they only normalise what Pass 1 already extracted from
#    raw_llama_markdown.
#
# 2. STRUCTURAL DISCREPANCY FLAGS — compute_auto_discrepancies derives
#    administrative/completeness flags (blank charts, missing registers,
#    thin bill breakup) purely from Pass 1's own structured fields.
#
# VERDICT DECISION IS NOT COMPUTED HERE. It used to be (via a
# compute_verdict_override function with its own keyword lists and
# raw-text scans), duplicating a second, separately-tuned verdict engine
# in unified_report_agent.py. That was consolidated into ONE engine —
# unified_report_agent.compute_rule_verdict — which is now the only place
# that decides SUSPECTED vs GENUINE. This module only supplies it with
# structural signals (via compute_auto_discrepancies) and formatted text;
# it has no opinion on the verdict itself.
# ----------------------------------------------------------------------

MIN_BILL_LINE_ITEMS = 10  # below this, bill breakup is "incomplete"
_SINGLE_STRETCH_TAG = "[SINGLE STRETCH]"


def compute_auto_discrepancies(pass1: Dict[str, Any]) -> List[str]:
    """
    Structural/administrative flags derived from Pass 1's own
    chart-quality and billing fields. No raw-text parsing except the
    SpO2 sanity check below, which is a physiological impossibility
    check (SpO2 cannot exceed 100%) rather than a document-format
    heuristic — the same class of deterministic sanity check as
    unified_report_agent.py's death-outcome check.
    """
    flags: List[str] = []
    disc_text = (pass1.get("discrepancies_verbatim") or "").lower()

    def _already(kw: str) -> bool:
        return kw.lower() in disc_text

    vcd = str(pass1.get("vitals_chart_dates_present") or "")
    if vcd.upper().startswith("NO") and not _already("vitals chart"):
        flags.append("[INCOMPLETE] Vitals chart — date column blank across all vitals chart pages")

    vcs = str(pass1.get("vitals_chart_single_stretch") or "")
    if vcs.upper().startswith("YES") and not _already("single stretch"):
        flags.append(f"{_SINGLE_STRETCH_TAG} Vitals chart appears written in one sitting without date breaks")

    nnd = str(pass1.get("nurses_notes_dates_present") or "")
    if nnd.upper().startswith("NO") and not _already("nurses notes"):
        flags.append("[INCOMPLETE] Nurses notes — date and time column blank across all pages")

    nns = str(pass1.get("nurses_notes_single_stretch") or "")
    if nns.upper().startswith("YES") and not _already("nurses notes single"):
        flags.append(f"{_SINGLE_STRETCH_TAG} Nurses notes appear written in single stretch without date breaks")

    mic = str(pass1.get("medication_chart_ip_number_present") or "")
    if mic.upper().startswith("NO") and not _already("medication chart"):
        flags.append("[INCOMPLETE] Medication chart — IP number, date and time fields blank")

    irc = str(pass1.get("investigation_result_chart_status") or "")
    if irc.upper().startswith("BLANK") and not _already("investigation result"):
        flags.append("[MISSING] Investigation result chart — completely blank, no values entered")

    pharm = str(pass1.get("pharmacy_register_collected") or "")
    if pharm.upper() == "NO" and not _already("pharmacy register"):
        flags.append("[MISSING] Pharmacy register not collected")

    bill_items = pass1.get("bill_breakdown_items") or []
    icu_billed = any(
        "ICU" in str(item.get("item", "")).upper() if isinstance(item, dict) else "ICU" in str(item).upper()
        for item in bill_items
    )
    icu_register_ok = str(pass1.get("icu_register_collected") or "").upper() == "YES"
    if icu_billed and not icu_register_ok and not _already("icu"):
        flags.append("[BILLING MISMATCH] ICU charges billed but ICU register not verified")

    if len(bill_items) < MIN_BILL_LINE_ITEMS and not _already("breakup"):
        flags.append("[INCOMPLETE] No detailed line-item bill provided – only aggregated charges shown")

    # SpO2 > 100% — physiologically impossible regardless of template.
    # This is the one place this module still touches free text, because
    # it's checking a physical constraint, not a document format — and it
    # only scans the vitals fields Pass 1 already extracted, not the raw
    # document.
    raw_vitals = " ".join(str(pass1.get(k) or "") for k in ("vitals_on_admission", "vitals_at_discharge"))
    for val in re.findall(r"spo2\s*[-:=]?\s*(\d{2,3})\s*%?", raw_vitals, re.IGNORECASE):
        try:
            spo2 = int(val)
        except ValueError:
            continue
        if spo2 > 100 and not _already("spo2"):
            flags.append(f"[PHYSIOLOGICAL ANOMALY] SpO2 value {spo2}% is impossible (>100%)")
            break

    return flags


def format_vitals(pass1: Dict[str, Any]) -> Optional[str]:
    raw = (pass1.get("vitals_on_admission") or "").strip()
    if not raw or raw.lower() in ("stable", "normal", "within normal limits"):
        return None
    o2 = (pass1.get("o2_support_on_admission") or "").strip()
    if o2 and o2.upper() != "RA" and o2.lower() not in raw.lower():
        raw = f"{raw}; O2 support — {o2}"
    return raw


def format_bill_block(pass1: Dict[str, Any]) -> str:
    gross = pass1.get("gross_bill_amount") or pass1.get("bill_amount") or "Not available"
    discount = pass1.get("discount_amount") or "Rs.0/-"
    received = pass1.get("net_amount_received") or gross
    tariff = pass1.get("room_tariff_per_day") or "Not documented"
    room = pass1.get("room_type") or ""
    mode = pass1.get("mode_of_payment") or pass1.get("payment_mode") or "Not documented"
    tariff_str = f"{tariff} per day ({room})" if room else f"{tariff} per day"
    return (
        f"Gross bill: {gross}\n"
        f"Discount: {discount}\n"
        f"Amount received: {received}\n"
        f"Room tariff: {tariff_str}\n"
        f"Payment mode: {mode}"
    )


def format_register_summary(pass1: Dict[str, Any]) -> Dict[str, Any]:
    def _flag(key: str) -> Optional[str]:
        raw = pass1.get(key)
        if isinstance(raw, bool):
            return "YES" if raw else "NO"
        v = (str(raw) if raw is not None else "").upper().strip()
        if v in ("YES", "Y", "TRUE", "1"):
            return "YES"
        if v in ("NO", "N", "FALSE", "0"):
            return "NO"
        if v == "NA":
            return "NA"
        return None

    return {
        "ip": _flag("ip_register_collected") or _flag("ip_register_attached"),
        "ot": _flag("ot_register_attached"),
        "lab": _flag("lab_register_attached") or _flag("lab_register_collected"),
        "pharmacy": _flag("pharmacy_register_collected"),
        "icu": _flag("icu_register_collected"),
        "reg_cert": pass1.get("reg_certificate_attached"),
        "tariff": _flag("tariff_attached"),
    }


def format_complaints_list(pass1: Dict[str, Any]) -> List[str]:
    raw = pass1.get("chief_complaints") or ""
    if isinstance(raw, list):
        return [c.strip() for c in raw if c.strip()]
    items = re.split(r"[,;•\n]+", raw)
    return [i.strip() for i in items if i.strip()]


def parse_reviewer_annotations(additional_context: str) -> List[Dict[str, str]]:
    """
    Parses the REVIEWER ANNOTATIONS block produced by formatAnnotationsForPrompt()
    on the frontend back into a list of {label, highlighted_text, note}.
    This is our own app's fixed internal format (not document content), so
    matching it exactly by regex is correct here, not a template heuristic.
    """
    if not additional_context or "REVIEWER ANNOTATIONS" not in additional_context:
        return []

    items = []
    pattern = re.compile(
        r"\[\d+\]\s*([A-Z ]+)\s*\n\s*Highlighted text:\s*\"(.*?)\"\s*\n\s*Reviewer note:\s*(.*?)(?:\n\n|\Z)",
        re.DOTALL,
    )
    for m in pattern.finditer(additional_context):
        items.append({
            "label": m.group(1).strip(),
            "highlighted_text": m.group(2).strip(),
            "note": m.group(3).strip(),
        })
    return items


def find_missing_annotations(conclusion: str, annotations: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """
    An annotation counts as 'addressed' if either its highlighted text
    or its note appears in the conclusion.
    """
    conclusion_lower = " ".join(conclusion.lower().split())
    missing = []
    for ann in annotations:
        note_norm = " ".join(ann["note"].lower().split())
        text_norm = " ".join(ann["highlighted_text"].lower().split())
        note_hit = note_norm[:40] in conclusion_lower if note_norm else False
        text_hit = text_norm[:40] in conclusion_lower if text_norm else False
        if not note_hit and not text_hit:
            missing.append(ann)
    return missing


def preprocess(pass1: Dict[str, Any]) -> Dict[str, Any]:
    """
    Deterministic post-processing of Pass 1's output. Takes ONLY pass1
    (Pass 1's structured JSON extraction) — no raw_markdown/extracted_flat
    parameter, since nothing here re-parses document text independently
    of what Pass 1 already extracted. Returns formatting helpers and
    structural flags for the report-generation prompts; does NOT decide
    a verdict (see unified_report_agent.compute_rule_verdict for that).
    """
    return {
        "auto_discrepancies": compute_auto_discrepancies(pass1),
        "vitals_formatted": format_vitals(pass1),
        "bill_block": format_bill_block(pass1),
        "register_flags": format_register_summary(pass1),
        "complaints_list": format_complaints_list(pass1),
        "ped_contradiction_detected": bool(pass1.get("ped_contradiction_detected")),
        "has_ped_in_raw": bool(pass1.get("ped_mentioned_in_records")),
    }


def reconcile_conclusion(
    conclusion: str,
    pass1: Dict[str, Any],
    annotations: Optional[List[Dict[str, str]]] = None,
) -> str:
    """
    Append any critical facts that are missing from the conclusion.
    Only appends — never removes or restructures. Reads exclusively from
    pass1 (Pass 1's structured extraction), never from raw document text.
    """
    missing = []

    bill = str(pass1.get("gross_bill_amount") or pass1.get("bill_amount") or "")
    if bill and bill not in conclusion:
        missing.append(f"Final bill amount: {bill}")

    guardian = str(pass1.get("guardian_name") or "")
    if guardian and guardian.split("(")[0].strip().lower() not in conclusion.lower():
        missing.append(f"Guardian / attendant: {guardian}")

    ip = str(pass1.get("ip_number") or "")
    if ip and ip not in conclusion:
        missing.append(f"IP No.: {ip}")

    if annotations:
        missing_anns = find_missing_annotations(conclusion, annotations)
        for ann in missing_anns:
            missing.append(
                f"Reviewer flagged [{ann['label']}] on \"{ann['highlighted_text']}\": {ann['note']}"
            )

    if missing:
        conclusion += (
            "\n\n[Reconciled — facts present in records but missing from report above]\n"
            + "\n".join(f"• {m}" for m in missing)
        )

    return conclusion