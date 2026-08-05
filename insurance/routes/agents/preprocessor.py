from __future__ import annotations
import re
from typing import Any, Dict, List, Optional
import json as _json

# ----------------------------------------------------------------------
# Keyword lists and helper functions
# ----------------------------------------------------------------------

SUSPECT_KEYWORDS = [
    "suspect",
    "suspected",
    "concealed",
    "ped",
    "pre-existing",
    "chronic",
    "discrepancies",
    "not provided",
    "not maintained",
    "single stretch",
    "blank chart",
    "tdc not",
    "hiding",
    "blank",
    "not properly",
    "found no relief",
    "one sitting",
    "no date",
    "date column blank",
]

def parse_conclusion_struct(raw: str) -> Optional[Dict[str, Any]]:
    """
    Try to parse structured JSON from LLM output.
    Returns None if the output is prose (old format) or malformed.
    """
    cleaned = re.sub(r"```(?:json)?|```", "", raw).strip()
    try:
        data = _json.loads(cleaned)
    except (_json.JSONDecodeError, TypeError):
        return None

    required = {"verdict", "section1", "recommendation"}
    if not required.issubset(data.keys()):
        return None

    # Normalise verdict — accept any phrasing the LLM uses
    v = str(data.get("verdict", "")).upper()
    data["verdict"] = "SUSPECTED" if "SUSPECT" in v else "GENUINE"

    # Ensure discrepancies is always a list
    disc = data.get("discrepancies")
    if disc is None:
        data["discrepancies"] = []
    elif isinstance(disc, str):
        data["discrepancies"] = [disc] if disc.strip() else []

    return data
_CONCLUSION_TEMPLATE = (
    "SECTION 1 — HOSPITAL VISIT FINDINGS\n"
    "{section1}\n\n"
    "SECTION 2 — MEMBER / INSURED VISIT FINDINGS\n"
    "{section2}\n\n"
    "SECTION 3 — CONCLUSION\n"
    "{section3_body}\n\n"          # ← preserve full section3 from LLM
    "RECOMMENDATION\n"
    "{recommendation}"             # ← only this line is Python-controlled
)

def render_conclusion(struct, pass1, verdict_override):
    final_verdict = verdict_override or struct["verdict"]
    
    disc_items = struct.get("discrepancies") or []
    disc_verbatim = (pass1.get("discrepancies_verbatim") or "").strip()
    
    if disc_items:
        disc_block = "Kindly note —\n" + "\n".join(disc_items)
    elif disc_verbatim:                                      # ← remove the `and final_verdict == "SUSPECTED"` condition
        disc_block = "Kindly note —\n" + disc_verbatim
    elif final_verdict == "SUSPECTED":                       # ← NEW: SUSPECTED but no disc text
        disc_block = "Kindly note — Discrepancies were noted during investigation. Refer to findings above."
    else:
        disc_block = "No major discrepancies were noted."   # ← only reached when GENUINE
    
    # Recommendation — Python controlled, never from LLM
    if final_verdict == "SUSPECTED":
        rec = "Hence based on the above discrepancies, the claim seems to be SUSPECTED."
    else:
        rec = "Hence based on the above findings, the claim is found to be GENUINE and recommended for settlement."
    
    # Section 3 body — strip LLM verdict line
    section3_raw = struct.get("section3") or struct.get("recommendation") or ""
    section3_body = re.sub(
        r"(?i)hence based on.*?(suspected|genuine|settlement)\.?\s*$",
        "",
        section3_raw,
        flags=re.DOTALL,
    ).strip()
    
    # NEW: also strip "No major discrepancies were noted" from section3_body
    # if verdict is SUSPECTED — the LLM writes this in the wrong section
    if final_verdict == "SUSPECTED":
        section3_body = re.sub(
            r"(?i)no major discrepancies were noted\.?\s*",
            "",
            section3_body,
        ).strip()
    
    return _CONCLUSION_TEMPLATE.format(
        section1=struct.get("section1", "").strip(),
        section2=(struct.get("section2") or "Member / insured visit was not conducted as part of this investigation.").strip(),
        section3_body=disc_block + ("\n\n" + section3_body if section3_body else ""),
        recommendation=rec,
    )

def build_contradictions(pass1: Dict[str, Any], raw_markdown: str) -> List[str]:
    contradictions = []

    # 1. Diabetes duration conflict
    dm_durations = []
    for line in raw_markdown.split("\n"):
        low = line.lower()
        if "dm since" in low or "diabetes since" in low or "newly diagnosed" in low:
            dm_durations.append(line.strip())
    if len(dm_durations) >= 2:
        contradictions.append(
            "Diabetes duration: multiple conflicting statements - "
            + "; ".join(dm_durations[:3])
        )

    # 2. Diagnosis inconsistency
    provisional = pass1.get("provisional_diagnosis") or ""
    if isinstance(provisional, list):
        provisional = " ".join(str(x) for x in provisional if x is not None)

    final_dx = pass1.get("final_diagnosis")
    if isinstance(final_dx, list):
        final_dx = " ".join(str(x) for x in final_dx if x is not None)
    final_dx = final_dx or ""
    if provisional and final_dx:
        prov_words = set(provisional.lower().split())
        final_words = set(final_dx.lower().split())
        common = prov_words.intersection(final_words)
        if len(common) < 2 and len(prov_words) > 3 and len(final_words) > 3:
            contradictions.append(
                f"Diagnosis inconsistency: provisional '{provisional}' "
                f"vs final '{final_dx}'"
            )

    # 3. Bill mismatch
    patient_bill = str(pass1.get("patient_stated_bill_amount") or "")
    hospital_bill = str(
        pass1.get("bill_amount") or pass1.get("gross_bill_amount") or ""
    )
    if patient_bill and hospital_bill:
        p_num = re.sub(r"[^0-9]", "", patient_bill)
        h_num = re.sub(r"[^0-9]", "", hospital_bill)
        if p_num and h_num and p_num != h_num:
            contradictions.append(
                f"Bill amount mismatch: patient stated {patient_bill} "
                f"vs hospital bill {hospital_bill}"
            )

    all_diagnoses = []
    # Collect provisional, final, and any Δ lines from raw markdown
    diag_matches = re.findall(r"[Δ∆]\s*:\s*(.+?)(?:\n|$)", raw_markdown, re.IGNORECASE)
    if isinstance(pass1.get("provisional_diagnosis"), str):
        all_diagnoses.append(pass1["provisional_diagnosis"])
    if isinstance(pass1.get("final_diagnosis"), str):
        all_diagnoses.append(pass1["final_diagnosis"])
    all_diagnoses.extend(diag_matches)

    # Check for conflicting terms (generic – you can expand this list)
    conflict_pairs = [("cellulitis", "osteoarthritis"), ("diabetic foot", "OA knee")]
    for diag1, diag2 in conflict_pairs:
        if any(diag1.lower() in d.lower() for d in all_diagnoses) and any(diag2.lower() in d.lower() for d in all_diagnoses):
            contradictions.append(f"Diagnosis inconsistency: '{diag1}' vs '{diag2}' found across records")

    return contradictions


def _has_ped_contradiction(pass1: Dict[str, Any]) -> bool:
    records = pass1.get("ped_mentioned_in_records") or []
    if not records:
        return False
    if isinstance(records, str):
        records = [records]
    combined = " ".join(str(r).lower() for r in records)
    newly = "newly" in combined or "newly diagnosed" in combined
    chronic = any(
        kw in combined
        for kw in [
            "k/c/o",
            "known case",
            "on medication",
            "since",
            "on treatment",
            "on oha",
            "dm since",
            "htn since",
        ]
    )
    return newly and chronic


def _is_genuine_case(pass1: Dict[str, Any], auto_flags: List[str]) -> bool:
    """
    Return True when the only issues are minor administrative gaps
    (pharmacy register missing, single-stretch with dates present)
    and there are no clinical, billing, or chart-completeness red flags.
    """
    # Any manual discrepancy text → never genuinely clean
    disc = (pass1.get("discrepancies_verbatim") or "").strip()
    if disc and len(disc) > 20:
        return False

    # Any contradictions → not genuine
    if pass1.get("contradictions_found"):
        return False

    # Hard chart failures → not genuine
    vcd = str(pass1.get("vitals_chart_dates_present") or "").upper()
    nnd = str(pass1.get("nurses_notes_dates_present") or "").upper()
    irc = str(pass1.get("investigation_result_chart_status") or "").upper()
    mic = str(pass1.get("medication_chart_ip_number_present") or "").upper()

    if vcd.startswith("NO"):
        return False
    if nnd.startswith("NO"):
        return False
    if irc.startswith("BLANK"):
        return False
    if mic.startswith("NO"):
        return False

    # Filter flags: only administrative gaps remain → still genuine
    ADMIN_ONLY = {"[MISSING] Pharmacy register not collected"}
    SINGLE_STRETCH_WITH_DATES = "[SINGLE STRETCH]"

    critical = []
    for flag in auto_flags:
        if flag in ADMIN_ONLY:
            continue
        # Single-stretch is non-critical when dates ARE present
        if SINGLE_STRETCH_WITH_DATES in flag:
            if not vcd.startswith("NO") and not nnd.startswith("NO"):
                continue  # dates exist → not critical
        critical.append(flag)

    return len(critical) == 0


def compute_verdict_override(
    pass1: Dict[str, Any], raw_markdown: str = ""
) -> str:
    disc = (pass1.get("discrepancies_verbatim") or "").strip()
    disc_lower = disc.lower()
    raw_lower = (raw_markdown or "").lower()

    # contradictions_found
    contradictions = pass1.get("contradictions_found") or []
    if contradictions and len(contradictions) > 0:
        return "SUSPECTED"

    patient_bill = str(pass1.get("patient_stated_bill_amount") or "")
    hospital_bill = str(
        pass1.get("bill_amount") or pass1.get("gross_bill_amount") or ""
    )
    if patient_bill and hospital_bill:
        p_num = re.sub(r"[^0-9]", "", patient_bill)
        h_num = re.sub(r"[^0-9]", "", hospital_bill)
        if p_num and h_num:
            p_val = int(p_num)
            h_val = int(h_num)
            if h_val > 0 and abs(p_val - h_val) / h_val > 0.05:
                return "SUSPECTED"

    # high HbA1c + short policy tenure
    hba1c_vals = pass1.get("hba1c_values") or []
    policy_inception = pass1.get("policy_inception_date") or ""
    admission_date = pass1.get("admission_date") or ""
    if hba1c_vals and policy_inception and admission_date:
        high_hba1c = False
        for val_str in hba1c_vals:
            num_match = re.search(r"(\d+(?:\.\d+)?)", val_str)
            if num_match and float(num_match.group(1)) > 9.0:
                high_hba1c = True
                break
        if high_hba1c:
            from datetime import datetime

            try:
                inc = datetime.strptime(policy_inception, "%Y-%m-%d")
                adm = datetime.strptime(admission_date, "%Y-%m-%d")
                months = (adm.year - inc.year) * 12 + (adm.month - inc.month)
                if months < 6:
                    return "SUSPECTED"
            except Exception:
                pass

    # explicit suspect verdict in raw text
    if re.search(
        r"(claim seems to be|found to be|verdict.*?|recommend.*?)\s*suspected",
        raw_lower,
    ):
        return "SUSPECTED"

    # manual discrepancy block present
    # manual discrepancy block present
    # Name mismatch alone is not sufficient to mark as SUSPECTED
    if disc and len(disc) > 20:
        disc_stripped = re.sub(
            r"\[NAME MISMATCH\][^\n]*\n?", "", disc
        ).strip()
        disc_stripped = re.sub(
            r"\[BILLING MISMATCH\][^\n]*\n?", "", disc_stripped  
        ).strip()
        if disc_stripped and len(disc_stripped) > 20:
            return "SUSPECTED"
    if any(k in disc_lower for k in SUSPECT_KEYWORDS):
        return "SUSPECTED"

    raw_suspect_phrases = [
        "kindly note",
        "discrepancies",
        "not properly maintained",
        "blank chart",
        "single stretched",
        "no date mentioned",
        "not provided",
        "tdc not",
        "claim seems to be suspected",
    ]
    for phrase in raw_suspect_phrases:
        if phrase in raw_lower:
            if phrase in ("kindly note", "discrepancies"):
                # Only SUSPECTED if there's real content beyond name/billing flags
                disc_content = re.sub(r"\[NAME MISMATCH\][^\n]*", "", disc).strip()
                disc_content = re.sub(r"\[BILLING MISMATCH\][^\n]*", "", disc_content).strip()
                if disc_content and len(disc_content) > 20:
                    return "SUSPECTED"
                continue   # ← name mismatch only → skip
            if "suspected" in raw_lower:
                return "SUSPECTED"

    # structural chart anomalies (hard failures only)
    vcd = str(pass1.get("vitals_chart_dates_present") or "").upper()
    nnd = str(pass1.get("nurses_notes_dates_present") or "").upper()
    irc = str(pass1.get("investigation_result_chart_status") or "").upper()
    mic = str(pass1.get("medication_chart_ip_number_present") or "").upper()

    if vcd.startswith("NO"):
        return "SUSPECTED"
    if nnd.startswith("NO"):
        return "SUSPECTED"
    if irc.startswith("BLANK"):
        return "SUSPECTED"
    if mic.startswith("NO"):
        return "SUSPECTED"

    # auto-discrepancy flags — only truly critical ones trigger SUSPECTED
    auto_flags = compute_auto_discrepancies(pass1, raw_markdown)

    ADMIN_ONLY = {"[MISSING] Pharmacy register not collected"}
    SINGLE_STRETCH_WITH_DATES = "[SINGLE STRETCH]"

    critical_flags = []
    for flag in auto_flags:
        # Pharmacy-only missing → not critical
        if flag in ADMIN_ONLY:
            continue
        # Single-stretch is only critical when dates are also missing
        if SINGLE_STRETCH_WITH_DATES in flag:
            if not vcd.startswith("NO") and not nnd.startswith("NO"):
                continue  # dates present → non-critical
        critical_flags.append(flag)

    if critical_flags:
        return "SUSPECTED"

    return "GENUINE"


def compute_auto_discrepancies(
    pass1: Dict[str, Any], raw_markdown: str = ""
) -> List[str]:
    flags = []
    disc_text = (pass1.get("discrepancies_verbatim") or "").lower()

    def _already(kw: str) -> bool:
        return kw.lower() in disc_text

    vcd = str(pass1.get("vitals_chart_dates_present") or "")
    if vcd.upper().startswith("NO") and not _already("vitals chart"):
        flags.append(
            "[INCOMPLETE] Vitals chart — date column blank across all vitals chart pages"
        )

    vcs = str(pass1.get("vitals_chart_single_stretch") or "")
    if vcs.upper().startswith("YES") and not _already("single stretch"):
        flags.append(
            "[SINGLE STRETCH] Vitals chart appears written in one sitting "
            "without date breaks"
        )

    nnd = str(pass1.get("nurses_notes_dates_present") or "")
    if nnd.upper().startswith("NO") and not _already("nurses notes"):
        flags.append(
            "[INCOMPLETE] Nurses notes — date and time column blank across all pages"
        )

    nns = str(pass1.get("nurses_notes_single_stretch") or "")
    if nns.upper().startswith("YES") and not _already("nurses notes single"):
        flags.append(
            "[SINGLE STRETCH] Nurses notes appear written in single stretch "
            "without date breaks"
        )

    mic = str(pass1.get("medication_chart_ip_number_present") or "")
    if mic.upper().startswith("NO") and not _already("medication chart"):
        flags.append(
            "[INCOMPLETE] Medication chart — IP number, date and time fields blank"
        )

    irc = str(pass1.get("investigation_result_chart_status") or "")
    if irc.upper().startswith("BLANK") and not _already("investigation result"):
        flags.append(
            "[MISSING] Investigation result chart — completely blank, no values entered"
        )

    pharm = str(pass1.get("pharmacy_register_collected") or "")
    if pharm.upper() == "NO" and not _already("pharmacy register"):
        flags.append("[MISSING] Pharmacy register not collected")

    # ICU billing mismatch
    bill_items = pass1.get("bill_breakdown_items") or []
    icu_billed = any(
        "ICU" in str(item.get("item", "")).upper()
        if isinstance(item, dict) else "ICU" in str(item).upper()
        for item in bill_items
    )
    icu_register_ok = (
        str(pass1.get("icu_register_collected") or "").upper() == "YES"
    )
    if icu_billed and not icu_register_ok and not _already("icu"):
        flags.append(
            "[BILLING MISMATCH] ICU charges billed but ICU register not verified"
        )

    # TDC missing (search raw text)
    raw_lower = (raw_markdown or "").lower()
    if "tdc" in raw_lower and not _already("tdc"):
        flags.append(
            "[MISSING] TDC (Treatment Details Certificate) — "
            "clarification not provided"
        )

    # No detailed breakup bill (less than 10 line items)
    if len(bill_items) < 10 and not _already("breakup"):
        flags.append(
            "[INCOMPLETE] No detailed line-item bill provided – "
            "only aggregated charges shown"
        )

    # SpO2 > 100%
    spo2_matches = re.findall(
        r"spo2\s*[-:=]?\s*(\d{2,3})\s*%?", raw_lower
    )
    for val in spo2_matches:
        try:
            spo2 = int(val)
            if spo2 > 100 and not _already("spo2"):
                flags.append(
                    f"[PHYSIOLOGICAL ANOMALY] SpO2 value {spo2}% is impossible (>100%)"
                )
                break
        except ValueError:
            pass

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
    gross = (
        pass1.get("gross_bill_amount")
        or pass1.get("bill_amount")
        or "Not available"
    )
    discount = pass1.get("discount_amount") or "Rs.0/-"
    received = pass1.get("net_amount_received") or gross
    tariff = pass1.get("room_tariff_per_day") or "Not documented"
    room = pass1.get("room_type") or ""
    mode = (
        pass1.get("mode_of_payment")
        or pass1.get("payment_mode")
        or "Not documented"
    )
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
        "icu": None,
        "reg_cert": pass1.get("reg_certificate_attached"),
        "tariff": _flag("tariff_attached"),
    }


def format_complaints_list(pass1: Dict[str, Any]) -> List[str]:
    raw = pass1.get("chief_complaints") or ""
    if isinstance(raw, list):
        return [c.strip() for c in raw if c.strip()]
    items = re.split(r"[,;•\n]+", raw)
    return [i.strip() for i in items if i.strip()]


def has_ped_in_raw_markdown(raw_markdown: str) -> bool:
    if not raw_markdown:
        return False
    raw_lower = raw_markdown.lower()
    ped_indicators = [
        "k/c/o",
        "known case of",
        "dm since",
        "htn since",
        "asthma since",
        "on medication",
        "chronic",
        "newly diagnosed",
        "old cva",
        "cad",
        "copd",
        "type 2 diabetes",
        "t2dm",
        "hypertension",
    ]
    return any(ind in raw_lower for ind in ped_indicators)


def extract_discrepancies_from_raw(raw_markdown: str) -> Optional[str]:
    if not raw_markdown:
        return None

    lines = raw_markdown.split("\n")
    capturing = False
    block = []
    trigger_phrases = ["kindly note", "kindly note-"]
    end_phrase = "hence based on above discrepancies"
    SECTION_HEADERS = re.compile(
        r"^(section\s+\d|conclusion|recommendation|audit evaluation|ped analysis)",
        re.IGNORECASE,
    )

    for line in lines:
        low = line.lower().strip()
        if not capturing and any(phrase in low for phrase in trigger_phrases):
            capturing = True
        if capturing:
            block.append(line)
            if end_phrase in low:
                break
            if SECTION_HEADERS.match(low) and len(block) > 3:
                break

    if not block:
        return None
    result = "\n".join(block).strip()
    return result if len(result) > 20 else None

def parse_reviewer_annotations(additional_context: str) -> List[Dict[str, str]]:
    """
    Parses the REVIEWER ANNOTATIONS block produced by formatAnnotationsForPrompt()
    on the frontend back into a list of {label, highlighted_text, note}.
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


def find_missing_annotations(
    conclusion: str, annotations: List[Dict[str, str]]
) -> List[Dict[str, str]]:
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


def extract_discharge_vitals_from_raw(raw_markdown: str) -> Optional[str]:
    """
    Extract vitals at discharge from common heading variants.

    Looks for:
      - "CONDITION AT THE TIME OF DISCHARGE"
      - "PATIENTS CONDITION AT DISCHARGE"
      - "vitals at discharge"
      - "condition at discharge"

    Returns a formatted string like
    "BP-110/90 mmHg, PR-86/min, RR-19/min, SpO2-98% RA, Temp-Afebrile"
    or None if not found.
    """
    DISCHARGE_HEADINGS = re.compile(
        r"(condition at the time of discharge|patients?\s+condition at discharge"
        r"|vitals at discharge|condition at discharge)",
        re.IGNORECASE,
    )

    VITAL_PATTERNS = [
        (r"BP\s*[-:]\s*([\d/]+\s*mm\s*[Hh]g)", "BP"),
        (r"PR\s*[-:]\s*([\d/]+\s*/?\s*min)", "PR"),
        (r"RR\s*[-:]\s*([\d/]+\s*/?\s*min)", "RR"),
        (r"SPO2?\s*[-:]\s*(\d+\s*%\s*(?:on\s*)?(?:RA|O2|room\s*air)?)", "SpO2"),
        (r"TEMP\s*[-:]\s*([^\n,]{1,30})", "Temp"),
        (r"PULSE\s*[-:]\s*([\d/]+\s*/?\s*min)", "PR"),
    ]

    lines = raw_markdown.split("\n")
    capture_start = -1

    for i, line in enumerate(lines):
        if DISCHARGE_HEADINGS.search(line):
            capture_start = i
            break

    if capture_start == -1:
        return None

    # Collect up to 15 lines after the heading
    window = "\n".join(lines[capture_start : capture_start + 15])

    found: Dict[str, str] = {}
    for pattern, label in VITAL_PATTERNS:
        m = re.search(pattern, window, re.IGNORECASE)
        if m and label not in found:
            found[label] = m.group(1).strip()

    if not found:
        return None

    # Format into canonical string
    ORDER = ["BP", "PR", "RR", "SpO2", "Temp"]
    parts = []
    for key in ORDER:
        if key in found:
            val = found[key]
            # normalise spacing in BP and PR
            val = re.sub(r"\s+", "", val) if key in ("BP", "PR", "RR") else val
            parts.append(f"{key}-{val}")

    return ", ".join(parts) if parts else None


def detect_chart_quality_from_markdown(raw_markdown: str) -> dict:
    if not raw_markdown:
        return {}

    result = {}
    normalized = re.sub(r"<td>\s*\n\s*", "<td>", raw_markdown)
    normalized = re.sub(r"\s*\n\s*</td>", "</td>", normalized)

    def get_sections(marker_words):
        blocks = []
        lines = raw_markdown.split("\n")
        in_block = False
        block = []
        for line in lines:
            low = line.lower()
            if any(m in low for m in marker_words):
                in_block = True
                block = []
            if in_block:
                block.append(line)
                if len(block) > 200:
                    in_block = False
                    blocks.append("\n".join(block))
                    block = []
        if block:
            blocks.append("\n".join(block))
        return "\n".join(blocks)

    # ── Vitals chart ──────────────────────────────────────────────────────────
    vitals_text = get_sections(["vitals chart"])
    if vitals_text:
        vitals_norm = re.sub(r"<td>\s*\n\s*", "<td>", vitals_text)
        vitals_norm = re.sub(r"\s*\n\s*</td>", "</td>", vitals_norm)
        rows = re.findall(
            r"(<tr>.*?</tr>)", vitals_norm, re.DOTALL | re.IGNORECASE
        )

        date_blank = 0
        date_filled = 0
        distinct_dates = set()
        for row in rows:
            cells = re.findall(r"<td>(.*?)</td>", row, re.DOTALL)
            if len(cells) >= 3:
                first = cells[0].strip()
                if re.search(r"\d{1,2}[/-]\d{1,2}[/-]\d{2,4}", first):
                    date_filled += 1
                    distinct_dates.add(first)
                elif first == "" or first == " ":
                    date_blank += 1
                else:
                    date_filled += 1
                    distinct_dates.add(first)

        total = date_blank + date_filled
        if total > 5:
            if date_blank / total > 0.8 and len(distinct_dates) < 2:
                result["vitals_chart_dates_present"] = (
                    "NO - Date column blank across all vitals chart pages"
                )
                result["vitals_chart_single_stretch"] = "YES - appears single stretch"
            else:
                result["vitals_chart_dates_present"] = "YES"
                result["vitals_chart_single_stretch"] = "NO"

    # ── Nurses notes ─────────────────────────────────────────────────────────
    nurses_text = get_sections(
        ["nurses notes", "nursing assessement", "nurse", "NURSES NOTES"]
    )
    if nurses_text:
        nurses_norm = re.sub(r"<td>\s*\n\s*", "<td>", nurses_text)
        nurses_norm = re.sub(r"\s*\n\s*</td>", "</td>", nurses_norm)
        rows = re.findall(
            r"(<tr>.*?</tr>)", nurses_norm, re.DOTALL | re.IGNORECASE
        )

        date_blank = 0
        date_filled = 0
        distinct_dates = set()
        for row in rows:
            cells = re.findall(r"<td>(.*?)</td>", row, re.DOTALL)
            if cells:
                first = cells[0].strip()
                if re.search(r"\d{1,2}[/-]\d{1,2}[/-]\d{2,4}", first):
                    date_filled += 1
                    distinct_dates.add(first)
                elif (
                    first == ""
                    or first == " "
                    or first.upper() == "EMPTY"
                ):
                    date_blank += 1
                else:
                    date_filled += 1
                    distinct_dates.add(first)

        total = date_blank + date_filled
        if total > 3:
            if date_blank / total > 0.7 and len(distinct_dates) < 2:
                result["nurses_notes_dates_present"] = (
                    "NO - Date and Time column blank in all nurses notes"
                )
                result["nurses_notes_single_stretch"] = (
                    "YES - appears single stretch"
                )
            else:
                result["nurses_notes_dates_present"] = "YES"
                result["nurses_notes_single_stretch"] = "NO"

    # ── Investigation result chart ────────────────────────────────────────────
    inv_text = get_sections(["investigation result chart"])
    if inv_text:
        inv_norm = re.sub(r"<td>\s*\n\s*", "<td>", inv_text)
        inv_norm = re.sub(r"\s*\n\s*</td>", "</td>", inv_norm)
        rows = re.findall(
            r"(<tr>.*?</tr>)", inv_norm, re.DOTALL | re.IGNORECASE
        )
        blank = 0
        filled = 0
        for row in rows:
            cells = re.findall(r"<td>(.*?)</td>", row, re.DOTALL)
            for cell in cells[1:]:
                val = cell.strip()
                if val == "" or val == " ":
                    blank += 1
                else:
                    filled += 1
        total = blank + filled
        if total > 10:
            if filled == 0 or blank / total > 0.95:
                result["investigation_result_chart_status"] = (
                    "BLANK - completely empty"
                )
            elif blank / total > 0.5:
                result["investigation_result_chart_status"] = "PARTIAL"
            else:
                result["investigation_result_chart_status"] = "COMPLETE"

    # ── Medication chart ──────────────────────────────────────────────────────
    med_text = get_sections(["medication chart", "meditation chart"])
    if med_text:
        med_norm = re.sub(r"<td>\s*\n\s*", "<td>", med_text)
        med_norm = re.sub(r"\s*\n\s*</td>", "</td>", med_norm)
        rows = re.findall(
            r"(<tr>.*?</tr>)", med_norm, re.DOTALL | re.IGNORECASE
        )
        blank_first_two = 0
        total_rows = 0
        for row in rows:
            cells = re.findall(r"<td>(.*?)</td>", row, re.DOTALL)
            if len(cells) >= 2:
                total_rows += 1
                if cells[0].strip() == "" and cells[1].strip() == "":
                    blank_first_two += 1
        if total_rows > 3 and blank_first_two / total_rows > 0.7:
            result["medication_chart_ip_number_present"] = (
                "NO - IP number and Date/Time blank"
            )
        elif total_rows > 0:
            result["medication_chart_ip_number_present"] = "YES"

    return result


def preprocess(
    pass1: Dict[str, Any], extracted_flat: Dict[str, Any]
) -> Dict[str, Any]:
    raw_markdown = (
        extracted_flat.get("raw_llama_markdown")
        or extracted_flat.get("raw_markdown")
        or ""
    )

    # ── Fallback discrepancy extraction FIRST ───────────────────────────────
    if not pass1.get("discrepancies_verbatim"):
        fallback = extract_discrepancies_from_raw(raw_markdown)
        if fallback:
            pass1["discrepancies_verbatim"] = fallback

    # ── Override chart quality with deterministic detection ────────────────
    chart_quality = detect_chart_quality_from_markdown(raw_markdown)
    chart_keys = [
        "vitals_chart_dates_present",
        "vitals_chart_single_stretch",
        "nurses_notes_dates_present",
        "nurses_notes_single_stretch",
        "investigation_result_chart_status",
        "medication_chart_ip_number_present",
    ]
    for key in chart_keys:
        if key in chart_quality:
            pass1[key] = chart_quality[key]

    # ── Recover discharge vitals from raw markdown if LLM missed them ─────
    if not pass1.get("vitals_at_discharge") and raw_markdown:
        recovered = extract_discharge_vitals_from_raw(raw_markdown)
        if recovered:
            pass1["vitals_at_discharge"] = recovered

    # ── Build contradictions ────────────────────────────────────────────────
    contradictions = build_contradictions(pass1, raw_markdown)
    if contradictions:
        pass1["contradictions_found"] = contradictions

    # ── Compute auto-flags first so verdict can use them ───────────────────
    auto_flags = compute_auto_discrepancies(
        pass1,
        raw_markdown=raw_markdown
    )

    # ── Compute verdict ─────────────────────────────────────────────────────
    verdict = compute_verdict_override(
        pass1,
        raw_markdown=raw_markdown
    )

    effective_disc_block = (
        pass1.get("discrepancies_verbatim") or ""
    )
    effective_auto_flags = auto_flags

    # ── If verdict is GENUINE, suppress noisy auto-flags ──────────────────
    if verdict == "GENUINE":
        ALLOWED_IN_GENUINE = {
            "[MISSING] Pharmacy register not collected"
        }

        effective_auto_flags = [
            f for f in auto_flags
            if f in ALLOWED_IN_GENUINE
        ]

        if not effective_disc_block:
            effective_disc_block = ""

    return {
        "verdict_override": verdict,
        "ped_contradiction_detected": _has_ped_contradiction(pass1),
        "auto_discrepancies": effective_auto_flags,
        "vitals_formatted": format_vitals(pass1),
        "bill_block": format_bill_block(pass1),
        "register_flags": format_register_summary(pass1),
        "complaints_list": format_complaints_list(pass1),
        "has_ped_in_raw": has_ped_in_raw_markdown(raw_markdown),
        "_effective_disc_block": effective_disc_block,
        "_is_genuine": verdict == "GENUINE",
    }

def reconcile_conclusion(
    conclusion: str,
    pass1: Dict[str, Any],
    annotations: Optional[List[Dict[str, str]]] = None,
) -> str:
    """
    Append any critical facts that are missing from the conclusion.
    Only appends — never removes or restructures.
    """
    missing = []
    
    # Bill amount
    bill = str(pass1.get("gross_bill_amount") or pass1.get("bill_amount") or "")
    if bill and bill not in conclusion:
        missing.append(f"Final bill amount: {bill}")
    
    # Guardian name
    guardian = str(pass1.get("guardian_name") or "")
    if guardian and guardian.split("(")[0].strip().lower() not in conclusion.lower():
        missing.append(f"Guardian / attendant: {guardian}")

    ip = str(pass1.get("ip_number") or "")
    if ip and ip not in conclusion:
        missing.append(f"IP No.: {ip}")

    # ── force in any reviewer annotation the LLM dropped ──────────
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