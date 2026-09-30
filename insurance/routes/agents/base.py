from __future__ import annotations

import asyncio
import json
from datetime import datetime, date
import logging
from typing import Any, Dict, List, Optional

from routes.agents.chunking import (
    split_text_by_pdf,
    render_page_batch,
    batch_file_pages,
)
import re
from groq import Groq
import os
import time
import random


def _make_serializable(obj):
    if isinstance(obj, dict):
        return {k: _make_serializable(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_make_serializable(i) for i in obj]
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    return obj


logger = logging.getLogger(__name__)

_groq = Groq(api_key=os.getenv("GROQ_API_KEY"))
_MODEL = "openai/gpt-oss-120b"
_TEXT_LIMIT = 85_000

# ── Shared rules injected into every agent prompt ────────────────────────────

SHARED_RULES = """
GLOBAL RULES:
1. Return ONLY valid JSON — no markdown fences, no prose outside JSON.
2. Use null for any field you cannot find. Never invent values.
3. Dates → ISO YYYY-MM-DD. Mobile → 10 digits, strip +91.
4. Amounts → plain numeric value, no currency symbols.
5. This pipeline processes claims from MULTIPLE insurers and MULTIPLE
   investigation-report templates. Never assume a fixed report structure,
   a fixed closing sentence, or a fixed section heading wording. Identify
   sections and boundaries by their MEANING (e.g. "this is the discrepancy
   note", "this is the report's own concluding verdict line"), not by
   matching one exact phrase.
"""

# ── Low-level Groq callers ────────────────────────────────────────────────────
def call_groq_sync(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = 4000,
) -> Dict[str, Any]:
    max_retries = 5
    base_delay = 5.0
    current_max_tokens = max_tokens
    truncation_retried = False

    for attempt in range(max_retries):
        try:
            completion = _groq.chat.completions.create(
                model=_MODEL,
                temperature=0.0,
                max_tokens=current_max_tokens,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user",   "content": user_prompt},
                ],
            )
            return json.loads(completion.choices[0].message.content)

        except Exception as exc:
            err_str = str(exc)

            if "rate_limit_exceeded" in err_str or "429" in err_str:
                wait = base_delay * (2 ** attempt) + random.uniform(0, 2)
                match = re.search(r'try again in ([\d.]+)s', err_str)
                if match:
                    wait = float(match.group(1)) + 1.0
                logger.warning(
                    "Rate limit hit (attempt %d/%d), waiting %.1fs...",
                    attempt + 1, max_retries, wait
                )
                time.sleep(wait)
                continue

            if isinstance(exc, json.JSONDecodeError) and attempt < 1:
                logger.warning("Groq JSON parse failed (attempt %d) — retrying once: %s", attempt + 1, exc)
                continue

            if "max completion tokens" in err_str.lower() and not truncation_retried:
                truncation_retried = True
                current_max_tokens = min(int(current_max_tokens * 1.6) + 500, 8192)
                logger.warning(
                    "Groq response was truncated before valid JSON (attempt %d) "
                    "— retrying once with max_tokens=%d instead of %d",
                    attempt + 1, current_max_tokens, max_tokens,
                )
                continue

            logger.error("Groq call failed: %s", exc)
            raise RuntimeError(f"Groq call failed: {exc}") from exc

    raise RuntimeError(f"Groq call failed after {max_retries} retries (rate limit)")

async def call_groq(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = 4000,
) -> Dict[str, Any]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None, call_groq_sync, system_prompt, user_prompt, max_tokens
    )


# ── Regional language detection and translation ───────────────────────────────
# NOTE: this is generic Unicode-block script detection covering all major
# Indian scripts, not tied to any insurer/report template — kept as-is.

_INDIAN_SCRIPT_RANGES = [
    (0x0900, 0x097F, "Devanagari"),   # Hindi, Marathi, Sanskrit
    (0x0980, 0x09FF, "Bengali"),
    (0x0A00, 0x0A7F, "Gurmukhi"),     # Punjabi
    (0x0A80, 0x0AFF, "Gujarati"),
    (0x0B00, 0x0B7F, "Odia"),
    (0x0B80, 0x0BFF, "Tamil"),
    (0x0C00, 0x0C7F, "Telugu"),
    (0x0C80, 0x0CFF, "Kannada"),
    (0x0D00, 0x0D7F, "Malayalam"),
    (0x0600, 0x06FF, "Arabic/Urdu"),
]


def _detect_script(text: str) -> str | None:
    """
    Return the dominant Indian script name if more than 15% of
    non-whitespace characters in `text` belong to a regional script.
    Returns None if the text is predominantly Latin/ASCII.
    """
    script_counts: dict[str, int] = {}
    for ch in text:
        cp = ord(ch)
        for start, end, name in _INDIAN_SCRIPT_RANGES:
            if start <= cp <= end:
                script_counts[name] = script_counts.get(name, 0) + 1
                break

    if not script_counts:
        return None

    total_chars = len([c for c in text if not c.isspace()])
    dominant = max(script_counts, key=script_counts.__getitem__)
    if total_chars > 0 and script_counts[dominant] / total_chars > 0.15:
        return dominant
    return None


def _split_into_segments(text: str) -> list[dict]:
    """
    Split text into contiguous Latin vs regional-script segments line by line.
    Each item: {"text": str, "is_regional": bool, "script": str | None}
    """
    segments = []
    current_lines: list[str] = []
    current_is_regional = False

    for line in text.split("\n"):
        script = _detect_script(line)
        line_is_regional = script is not None

        if line_is_regional != current_is_regional and current_lines:
            segments.append({
                "text": "\n".join(current_lines),
                "is_regional": current_is_regional,
                "script": _detect_script("\n".join(current_lines)),
            })
            current_lines = []

        current_is_regional = line_is_regional
        current_lines.append(line)

    if current_lines:
        segments.append({
            "text": "\n".join(current_lines),
            "is_regional": current_is_regional,
            "script": _detect_script("\n".join(current_lines)),
        })

    return segments


def _translate_segment_sync(segment_text: str, script_name: str) -> str:
    """
    Translate one regional-script segment to English via Groq.
    Returns the original text unchanged if translation fails.
    """
    system = (
        "You are a precise medical document translator. "
        f"The input is in {script_name} script (Indian regional language). "
        "Translate it to clear English. "
        "Rules: "
        "1. Translate ALL text — do not skip any sentence. "
        "2. Preserve medical terms, drug names, dates, and numbers exactly. "
        "3. Preserve document structure and line breaks. "
        "4. Do NOT add commentary or explanations. "
        "5. Return ONLY the translated text, nothing else."
    )
    user = (
        f"Translate the following {script_name} text to English:\n\n{segment_text}"
    )

    for attempt in range(3):
        try:
            completion = _groq.chat.completions.create(
                model=_MODEL,
                temperature=0.0,
                max_tokens=min(len(segment_text) * 3, 4000),
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user",   "content": user},
                ],
            )
            translated = completion.choices[0].message.content.strip()
            return translated if translated else segment_text

        except Exception as exc:
            err_str = str(exc)
            if "rate_limit_exceeded" in err_str or "429" in err_str:
                wait = 3.0 * (2 ** attempt)
                match = re.search(r"try again in ([\d.]+)s", err_str)
                if match:
                    wait = float(match.group(1)) + 1.0
                logger.warning(
                    "Translation rate limit (attempt %d/3), waiting %.1fs",
                    attempt + 1,
                    wait,
                )
                time.sleep(wait)
                continue
            logger.error("Translation segment error: %s", exc)
            return segment_text  # fallback — keep original

    return segment_text


def translate_regional_text(raw_text: str) -> str:
    """
    Detect regional-language segments in raw_text, translate them to English,
    and return the full document with regional parts replaced in-place.

    - English/Latin segments are untouched.
    - Only non-Latin script segments are sent to Groq.
    - If no regional script is detected, returns raw_text unchanged (zero cost).
    """
    segments = _split_into_segments(raw_text)
    regional = [s for s in segments if s["is_regional"]]

    if not regional:
        return raw_text  # nothing to translate

    detected = list({s["script"] for s in regional if s["script"]})
    logger.info(
        "Regional scripts detected: %s — translating %d segment(s)",
        detected,
        len(regional),
    )

    result_parts = []
    for seg in segments:
        if not seg["is_regional"]:
            result_parts.append(seg["text"])
        else:
            script = seg["script"] or "Indian regional language"
            translated = _translate_segment_sync(seg["text"], script)
            result_parts.append(translated)  # replace in-place, no markers

    return "\n".join(result_parts)


# ── Pass 1 — shared forensic extractor used by all triggers ──────────────────
# This is the ONLY place claim facts are extracted. Everything downstream
# (preprocessing, hospital/member base findings, trigger assessments,
# reconciliation) must read from the JSON this produces, or from `raw_text`
# directly for its own boundary-aware slicing — never from a second,
# independently-sourced field.

_PASS1_SYSTEM = SHARED_RULES + """
IMPORTANT – YOU ARE A FORENSIC EXTRACTOR, NOT A SUMMARISER.
- Output JSON only.
- Never omit fields. If a field is not found, use null.
- For arrays (chief_complaints, pre_admission_opd_visits, hba1c_values, contradictions_found),
  include EVERY occurrence. Do not merge or truncate.
- For strings (discrepancies_verbatim, patient_stated_bill_amount), copy verbatim.
- If you are unsure whether something is a pre‑admission OPD visit, include it.
  The downstream process can filter, but you must not miss it.
- This document may come from ANY insurer or investigator template. Identify
  fields by their meaning and context, never by matching one fixed phrase or
  heading wording — headings, sign-offs, and closing sentences vary by insurer.

CRITICAL – ASTHMA DETECTION:
If the raw document contains "Asthma - 2 yrs", "PAST H/o Asthma", or similar,
you MUST include it in Section 2 as a pre‑existing condition.

"""

PASS1_SCHEMA = """
{
  "investigating_agency": null,
  "admission_date": null,
  "admission_time": null,
  "discharge_date": null,
  "discharge_time": null,
  "ip_number": null,
  "uhid_number": null,
  "patient_name": null,
  "patient_age_gender": null,
  "guardian_name": null,
  "chief_complaints": null,
  "past_history": null,
  "provisional_diagnosis": null,
  "final_diagnosis": null,
  "case_type": null,
  "vitals_on_admission": null,
  "vitals_at_discharge": null,
  "rr_on_admission": null,
  "o2_support_on_admission": null,
  "vasopressor_used": null,
  "investigations_done": null,
  "all_treatments": null,
  "discharge_medications": null,
  "bill_amount": null,
  "gross_bill_amount": null,
  "discount_amount": null,
  "net_amount_received": null,
  "payment_mode": null,
  "bill_breakdown_items": null,
  "physical_visit_confirmed": null,
  "surgeon_name": null,
  "anaesthetist_name": null,
  "surgery_date_time": null,
  "hospital_reg_valid_till": null,
  "hospital_reg_issuing_authority": null,
  "bill_number": null,
  "bill_breakdown": null,
  "icu_charges": null,
  "room_charges": null,
  "room_tariff_per_day": null,
  "medicine_charges": null,
  "lab_charges": null,
  "mode_of_payment": null,
  "pharmacy_register_collected": null,
  "hospital_name": null,
  "hospital_address": null,
  "hospital_registration_number": null,
  "hospital_registration_validity": null,
  "hospital_bed_strength": null,
  "hospital_nabh": null,
  "reg_certificate_page_reference": null,
  "bill_page_reference": null,
  "treating_doctor": null,
  "doctor_qualification": null,
  "doctor_reg_number": null,
  "pathologist_name": null,
  "pathologist_designation": null,
  "inhouse_lab": null,
  "lab_register_collected": null,
  "icu_register_collected": null,
  "data_collected_from_name": null,
  "data_collected_from_designation": null,
  "data_collected_from_phone": null,
  "field_officer_name": null,
  "field_officer_hospital_opinion": null,
  "field_officer_member_opinion": null,
  "room_type": null,
  "cashless_availed": null,
  "mlc_registered": null,
  "mlc_collected": null,
  "ip_register_collected": null,
  "ip_register_attached": null,
  "ot_register_attached": null,
  "lab_register_attached": null,
  "reg_certificate_attached": null,
  "tariff_attached": null,
  "inhouse_lab_present": null,
  "lab_photos_attached": null,
  "first_registration_date": null,
  "discrepancies_verbatim": null,
  "page_references_found": null,
  "vitals_chart_dates_present": null,
  "vitals_chart_single_stretch": null,
  "nurses_notes_dates_present": null,
  "nurses_notes_single_stretch": null,
  "medication_chart_ip_number_present": null,
  "medication_chart_time_date_present": null,
  "investigation_result_chart_status": null,
  "final_verdict_verbatim": null,
  "opd_history_before_admission": null,
  "operation_record_attached": null,
  "postoperative_period": null,
  "investigating_agency_type": null,
  "verification_mode": null,
  "anaesthesia_type": null,
  "policy_inception_date": null,
  "policy_start_date": null,
  "policy_end_date": null,
  "ped_declared_at_proposal": null,
  "ped_mentioned_in_records": null,
  "pre_admission_opd_visits": null,
  "pre_admission_prescriptions": null,
  "accident_date_time": null,
  "accident_place": null,
  "accident_narration": null,
  "mlc_number": null,
  "fir_number": null,
  "police_station": null,
  "witness_name": null,
  "witness_statement": null,
  "brought_by": null,
  "first_aid_hospital": null,
  "first_aid_details": null,
  "helmet_worn": null,
  "seatbelt_worn": null,
  "vehicle_type": null,
  "alcohol_smell_noted": null,
  "alcohol_test_done": null,
  "alcohol_test_result": null,
  "intoxication_mentioned": null,
  "death_date": null,
  "death_time": null,
  "death_place": null,
  "cause_of_death": null,
  "postmortem_done": null,
  "postmortem_report": null,
  "death_certificate_available": null,
  "beneficiary_name": null,
  "beneficiary_relationship": null,
  "suicidal_history": null,
  "psychiatric_history": null,
  "alcohol_history": null,
  "claimed_amount": null,
  "sum_insured": null,
  "previous_claims": null,
  "claim_frequency": null,
  "short_duration_policy": null,
  "policy_type": null,
  "employer_name": null,
  "employee_id": null,
  "employment_verification_done": null,
  "hospital_watchlist_status": null,
  "hospital_empanelment_status": null,
  "hospital_registration_valid": null,
  "lab_vicinity_to_hospital": null,
  "investigation_vicinity_check": null,
  "hba1c_values": null,
  "patient_stated_bill_amount": null,
  "contradictions_found": null,
  "ped_contradiction_detected": null
}
"""

_PASS1_RULES = """


SOURCE PRIORITY FOR CRITICAL FIELDS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PRIORITY HIERARCHY (highest → lowest):
  1. Hospital Discharge Summary / ICP (indoor case papers)
  2. Field Officer Hospital Visit Form
  3. Insured Questionnaire / Member Visit documents
  4. Aadhaar / ID proof (ONLY for identity fields: name, DOB, address)

chief_complaints:
  MUST come from DISCHARGE SUMMARY "CHIEF COMPLAINT" section
  or DOCTOR'S INITIAL ASSESSMENT "Complaints on admission with duration".
  NEVER from the insured questionnaire answers — the insured's own
  description is layman wording and must not replace medical record wording.

investigations_done:
  MUST come from hospital lab reports, doctor's orders in the ICP,
  or the discharge summary investigations section.
  NEVER from insured questionnaire (the insured lists only what they
  remember, not the complete investigation panel ordered by the doctor).

past_history:
  MUST come from DISCHARGE SUMMARY "PAST MEDICAL/SURGICAL HISTORY"
  or DOCTOR'S INITIAL ASSESSMENT "Past medical / surgical history".
  The insured questionnaire past history MAY be used ONLY if no hospital
  record source exists. Never merge both sources into one field.

guardian_name:
  PRIMARY SOURCE: Hospital ICP "Guardian" / "Attender" / "Next of kin" field,
  or the witness signature section of any questionnaire form.

  AADHAAR ADDRESS RULE:
  "S/O [name]" in an Aadhaar address means the PATIENT is the son of [name].
  "D/O [name]" means the PATIENT is the daughter of [name].
  These indicate the patient's parentage — NOT the patient's guardian.
  NEVER use the name following S/O or D/O as the guardian.

  "W/O [name]" means the patient is the wife of [name] → spouse is guardian.
  Witness signatures on questionnaire forms (signed by a family member)
  indicate the attending guardian — use that name and relation.

case_type:
  Classify the claim as one of "SURGICAL", "MEDICAL", or "MIXED" based on
  what the diagnosis and documented treatment actually show:
    - "SURGICAL" if the primary treatment for this admission was an
      operative/procedural intervention (an operation record, anaesthesia
      record, or OT register entry exists for this admission).
    - "MEDICAL" if the admission was managed purely through drugs,
      fluids, and monitoring, with no operative procedure performed.
    - "MIXED" if both a significant operative procedure and substantial
      independent medical management are documented for the same admission.
  Base this on what THIS document actually shows, not on the name of the
  diagnosis alone — the same diagnosis can be managed surgically or
  medically depending on the case.

EXTRACTION RULES:

admission_date/time: Priority: 1) Field Officer form  2) IPD Bill  3) Discharge Summary
discharge_date/time: Same priority order
ip_number/uhid_number: "I.P.No.", "UHIDNumber", "MR No", "Registered No"
cashless_availed:
  Look in the field officer form for "Cashless availed:".
  If "YES [x]" or checkmark → "YES".
  If "NO [x]" → "NO".
  Default to null if not found.

vitals_on_admission:
  CRITICAL CONTEXT-LOCK RULE:
  If this is a TRAUMA / RTA case (document contains "RTA", "road traffic accident",
  "two-wheeler", "alleged history of RTA"), the admission vitals MUST come from
  the trauma patient's case sheet only. Typical RTA admission vitals include
  BP around 120-130/70-90, normal PR, normal SpO2.
  NEVER extract shock vitals (BP 90/60, SpO2 88%) for a patient who presented
  alert with GCS E4V5M6 and power 5/5. If you see such vitals in the document
  they belong to a DIFFERENT patient's record bundled in the same document.
  Cross-check: vitals must be consistent with the clinical picture
  (a patient with GCS 15 and power 5/5 cannot have BP 90/60 and SpO2 88%).

  PRIORITY ORDER (most reliable → use the highest available):
    1) Section "CONDITION AT THE TIME OF ADMISSION (Complaint with duration
       Physical examination & Vital Data)" in the Discharge Summary.
       Look for lines starting with "BP:-", "Spo2:-", "Temp:-" etc.
    2) Section titled "INITIAL ASSESSMENT" → subsection "10. PHYSICAL EXAMINATION"
       → items 13 (Temperature), 14 (Pulse Rate), 15 (Respiration Rate), 16 (BP), 17 (SpO2).
       CRITICAL: Use the numeric values from the numbered list — do NOT use the
       PROGRESS RECORD / DOCTOR'S ORDERS table even if it appears earlier in the document.
       The progress record may repeat the same vitals but is the SECONDARY source.
    3) Section "PROGRESS RECORD / DOCTOR'S ORDERS" — use ONLY if sources 1 and 2 are absent.
    4) Nursing initial assessment.

  CRITICAL — PR (Pulse Rate) SOURCE:
    The INITIAL ASSESSMENT section lists PR under item 14 "Pulse Rate: 126/min".
    The DISCHARGE SUMMARY may list a different PR (e.g. 86/min) for discharge condition.
    NEVER use the discharge PR as the admission PR.
    If the document shows "PR-86/min" only in a discharge section, it is NOT the admission PR.

  Extract ALL markers present: BP, PR (also called Pulse), SpO2 (also Saturation/Sats),
  Temp (also Temperature, T), RR (also Respiratory Rate), GRBS (also RBS, Blood Sugar,
  Glucose), FHS (for obstetric cases).
  Format exactly: "T-103F, PR-126/min, BP-90/60 mmHg, SpO2-88% RA, RR-23/min, GRBS-120mg%"
  FORBIDDEN: Never return "stable", "normal", "within normal limits", or any summary.
  If a value is not present, omit that marker. Never write "not recorded".
  NEVER include fake complaints or symptoms in this field – this field is for vitals only.

investigations_done:
  Extract ALL investigations mentioned in "INVESTIGATIONS" sections, "INVESTIGATIONS ORDERED", or lab result tables.
  Include CBC, CRP, RFT, LFT, ECG, Chest X‑ray, MRI, ANA, Anti‑CCP, RA factor, Uric acid, Urine analysis, etc.
  Return as JSON array of strings.

vitals_at_discharge:
  PRIORITY ORDER:
    1) Section "CONDITION AT THE TIME OF DISCHARGE (with vital Date)" in the
       case sheet — look for lines like "BP - 110/70 mmHg", "SPO2 - 95% RA",
       "PR - 90/min".
    2) Section "PATIENTS CONDITION AT DISCHARGE" in the discharge summary —
       look for lines like "BP-110/90 mmhg", "PR-86/mm", "RR-19/mm",
       "SPO2-98% RA", "TEMP-AFORIBALE".
    3) Any paragraph containing the phrase "condition at discharge" or
       "discharged in stable condition" followed by vital values.

  CRITICAL — use the HIGHEST-PRIORITY source found. Do NOT mix values from
  different sources. The two discharge summary blocks (case sheet vs printed
  discharge summary) may differ — use the printed discharge summary
  ("PATIENTS CONDITION AT DISCHARGE") as it is the final authoritative record.

  Format: "BP-110/90 mmHg, PR-86/min, RR-19/min, SpO2-98% RA, Temp-Afebrile"
  If a marker is absent, omit it. Return null only if no discharge vitals exist.

  NOTE: "AFORIBALE" / "AFEBRILE" = no fever — transcribe verbatim as "Afebrile".
past_history:
  Extract verbatim from sections labelled:
    "PAST H/o", "Past History", "History of Past Illness", "PAST H/O"
  Capture lines with pattern: "<condition> - <duration>", e.g. "Asthma - 2 yrs"
  Also capture "K/c/o", "DM since", "HTN since", etc.
  Return as a single string with all conditions separated by semicolons.

chief_complaints:
  Extract as a JSON ARRAY, one string per complaint. NEVER MERGE.

  CRITICAL CONTEXT-LOCK RULE:
  Before extracting chief complaints, identify the CASE TYPE from the document:
  - If the document contains "RTA", "road traffic accident", "two-wheeler",
    "alleged history of RTA" → this is a TRAUMA / ACCIDENT case.
    Chief complaints MUST be trauma-related: e.g. "alleged history of RTA",
    "LOC", "head injury", "ENT bleed". NEVER output fever/SOB/myalgia for
    a trauma case unless explicitly documented as a separate co-morbidity
    admission complaint.
  - If the document contains "fever", "SOB", "dyspnoea", "breathlessness"
    as the PRIMARY complaints with no RTA context → this is a MEDICAL FEVER case.
    Chief complaints MUST be fever/SOB/myalgia type. NEVER output RTA complaints.

  If multiple patient records are present in the same document bundle, extract
  ONLY the complaints for the patient whose name matches the claimant name at
  the top of the case sheet being read. Do NOT mix complaints across patients.

  PRIORITY ORDER (most reliable first):
    1. Section titled "COMPLAINTS AND DURATION" – extract every bullet point as a separate complaint.
    2. Section titled "Chief Complaints" or "Presenting Complaints" from the CORRECT patient's case sheet.
    3. Nursing notes "C/O" section for the same patient.
    4. Initial assessment paragraph for the same patient.

  CRITICAL RULES:
    - Never output fever/SOB/myalgia for an RTA/trauma admission.
    - Never output RTA/accident complaints for a medical fever admission.
    - Count the items. If the source has 5 items, the array must have 5 items.
    - Do NOT invent complaints not present in the document.

  Example — RTA case:
    ["Alleged history of RTA, 2 wheeler vs 4 wheeler", "LOC 2 minutes", "No ENT bleed"]

  Example — Medical fever case:
    ["Fever (High grade)", "SOB since 1 day", "C/O generalized myalgia & weakness"]

  Example of WRONG extraction (prohibited — mixing case types):
    ["Fever (High grade)", "SOB since 1 day"] for an RTA case
    ["Alleged history of RTA"] for a fever/medical admission

o2_support_on_admission:
  Extract the oxygen support status and flow rate if available.

  Look for patterns like:
    - "SpO2 88% on room air" → "RA" or "Room air"
    - "SpO2 96% at 4 litres of O2" → "4L O2"
    - "O2 support: 2L/min" → "2L/min"
    - "on oxygen" → "Oxygen"

  Return the FULL string as documented.
  Example: "RA, also 96% at 4 litres O2" or simply "4 litres O2"

  Do NOT return only "RA" if additional support is documented.
  If only room air is mentioned, return "RA".
  If no oxygen support mentioned, return null.
vasopressor_used:
  Extract the name of any vasopressor/inotrope used.

  Look for:
    - "NORAD", "Noradrenaline", "Norepinephrine"
    - "Dopamine", "Dobutamine", "Vasopressin", "Adrenaline", "Epinephrine"
    - In the progress record or doctor's orders: e.g., "Inj NORAD @ 5ml/hr"

  Return the exact name as found in the document.
  Example: "NORAD" or "Noradrenaline"

  If multiple are used, return comma-separated list.
  Return null if none found.
provisional_diagnosis: From "PROVISIONAL DIAGNOSIS" field — EXACTLY as written.
final_diagnosis: From Discharge Summary "DIAGNOSIS" — ALL lines verbatim.

all_treatments:
  Extract EVERY drug from PROGRESS RECORD / DOCTOR'S ORDERS and MEDICINE CHART tables.
  Include all IV drugs (e.g., Inj Meropenem, Inj Doxy, Inj NORAD), IV fluids (NS, RL, DNS), and oral medications.

discharge_medications:
  Extract ONLY from the "DISCHARGE TREATMENT ADVISED" or "DISCHARGE SUMMARY — MEDICATION" section.
  These are oral/outpatient drugs given at discharge.
  Do NOT include IV infusion drugs from the inpatient progress notes.
  Example correct: ["T. cefixime 200mg", "T. emoprazole 40mg", "T. VIT-C", "SYP. DUCOSET 10ml"]
  Example wrong: ["INJ MEROPENEM", "INJ NORAD", "IV FLUIDS"]
final_diagnosis:
  Extract ALL lines from the DIAGNOSIS block in the discharge summary.
  Never compress multiple diagnosis lines to a single line. Return as array if multiple lines.
bill_amount:
  EXCLUDE the value from "Final Bill amount paid at the hospital" (that is patient_stated_bill_amount).
  Use ONLY the "Total Bill Amount" or "Grand Amount" from the IPD Bill table.
  If multiple bills exist, use the one whose patient name matches the claimant.
  Format: "Rs.78,219/-"

gross_bill_amount:
  Same as bill_amount.

net_amount_received:
  Use "Net Amount" or "Amount Received" from the IPD Bill table.
  Do NOT use patient‑stated amount.

discount_amount:
  Look for any of these patterns ANYWHERE in the bill section or payment summary:
    - "Discount : Rs. 35"
    - "Discount: 4485.00"
    - "Discount Amount : 35"
    - "Concession : 35"
    - "Waiver : 35"
    - A row in the bill table where item contains "discount" (case‑insensitive).
  If found, extract the numeric value and return as "Rs.<value>/-".
  If not found, return "Rs.0/-".

payment_mode: "Cash", "Online", "Card", "Cheque", "NEFT" — from bill payment row.
bill_breakdown_items:
Extract EVERY bill row from the complete IPD bill document.

The bill may appear either:

1. As a single flat table
2. As multiple subtables under sections like "Service Charges"

Handle BOTH formats.

────────────────────────
FLAT TABLE EXTRACTION
────────────────────────
If the bill is a normal table:

* Extract EVERY row exactly as written.
* Include rows even if amount is Rs.0/-.
* Preserve item name and amount exactly.
* Combine rows across all pages.
* Do NOT skip headers, charges, discounts, or totals.

Return format:
[
{"item": "Registration", "amount": "Rs.500/-"},
{"item": "Consultation", "amount": "Rs.0/-"}
]

Count validation:

* The output row count MUST match the document row count.

────────────────────────
SERVICE CHARGES / SUBTABLE EXTRACTION
────────────────────────
If the document contains grouped subtables under sections like:
- Doctor Fees
- Hospital
- Ward Charges
- Clinical Chemistry
- Haematology
- Immunology
- MRI
- Microbiology
- POCT
- Serology
- Xray
- Pharmacy

Then:

* Extract EVERY row from EVERY subtable.
* Include zero-value rows.
* Include subtotal rows.

For subtotal rows:

* Prefix the section name.

Example:
{"item": "Sub Total - Doctor Fees", "amount": "8790.00"}

Preserve:

* Original item names
* Original amounts
* Original spelling

Merge all extracted rows into ONE final JSON array.

Do NOT deduplicate.
Do NOT summarize.
Do NOT omit repeated items.

Multi-page handling:

* Continue extraction across all pages until the bill ends.


physical_visit_confirmed:
  Return "YES" if ANY of the following is true:
    1. Document contains a section titled "Mandatory Details to be filled by Field Officer (Hospital Visit)"
    2. Document contains phrase "Our investigator visited the hospital"
    3. Document contains phrase "Hospital Visited" or "Visited on"
    4. Field "FO Name" has a non‑empty value
    5. Document contains a geotagged photo or "Hospital Pic [x]"
    6. Document contains a signature with "FO" or "Field Officer"
  Return "NO" only if the document explicitly states no physical visit was done.
  Default to "YES" if any field officer data (name, opinion, signature) exists.

surgeon_name: Doctor who performed the operation. From OT notes or discharge summary.
anaesthetist_name: Doctor who gave anaesthesia. From anaesthesia record.
surgery_date_time: Date and time of surgery from OT register or operative notes.
hospital_reg_valid_till: Validity date on registration certificate.
hospital_reg_issuing_authority: >
  Issuing body on certificate
  (e.g. "Govt of Tamil Nadu").
bill_breakdown: ALL line items with quantities and amounts.
room_tariff_per_day: From ROOM CHARGES unit price column.

hospital_bed_strength: From registration certificate AND field officer form.
reg_certificate_page_reference: Page ref format: "-49/52-"
bill_page_reference: Page ref format: "-48/52-"

pharmacy_register_collected: From field officer form. Return "YES" or "NO".
ip_register_attached: From field officer form "IP Register Collected". "YES" or "NO".
ot_register_attached: From field officer form OT register section. "YES" or "NO" or null.
lab_register_attached: From field officer form item 14. "YES" or "NO".
reg_certificate_attached: From field officer form item 5. "Yes - valid till [date]" or null.
tariff_attached: From field officer form item 15. "Yes" or "No".
icu_register_collected: Was the ICU register verified/collected for this admission, if ICU was billed? "YES" or "NO" or null if ICU was never billed/relevant.
inhouse_lab_present: From field officer form item 12. "YES" or "NO".
lab_photos_attached: From field officer form item 13. "YES" or "NO".

field_officer_hospital_opinion: From "Investigator opinion (Hospital Visit)" — exact text.
field_officer_member_opinion: From "Investigator opinion (Member Visit)" — exact text or null.
field_officer_name: From "FO Name" field.
data_collected_from_name/designation/phone: From field officer form item 19.

vitals_chart_dates_present:
  Check ALL VITALS CHART tables. Is Date column filled?
  If ALL blank: "NO - Date column blank across all vitals chart pages"
  If present: "YES"

vitals_chart_single_stretch:
  Are readings continuous without clear date breaks?
  "YES - appears single stretch" or "NO"

nurses_notes_dates_present:
  Check ALL nurses notes Date & Time column.
  If ALL blank: "NO - Date and Time column blank in all nurses notes"
  If present: "YES"

nurses_notes_single_stretch:
  Multiple shift cycles but no dates?
  "YES - appears single stretch" or "NO"

medication_chart_ip_number_present:
  Is IP number field filled in MEDICATION CHART?
  "NO - IP number and Date/Time blank" or "PARTIAL" or "YES"

investigation_result_chart_status:
  Are result values entered in INVESTIGATION RESULT CHART?
  "BLANK - completely empty" or "PARTIAL" or "COMPLETE"

discrepancies_verbatim:
  DO NOT summarise.
  DO NOT truncate.
  DO NOT rephrase.
  This document may use ANY insurer's wording for this section — do not
  look for one fixed heading or one fixed closing sentence. Instead:
    1. Find the paragraph(s) where the investigator/report itself raises
       discrepancies, red flags, or concerns about the claim (this is
       typically introduced by a phrase like "Kindly note", "DISCREPANCIES",
       "Points to note", "Observations", or similar — but the exact wording
       varies by insurer, so identify it by its MEANING, not by string match).
    2. Copy that block VERBATIM, character-for-character, including line
       breaks, spacing, and page references (e.g. -14/52-).
    3. Stop at the natural end of that block — either the report's own
       concluding/verdict sentence for this note (whatever its exact
       wording is), or the start of a clearly different section, whichever
       comes first.
  If the block is longer than 2000 characters, still return it fully.
  If no such discrepancy/observations block exists in this document, return null.

page_references_found: List ALL X/52 patterns as array.
final_verdict_verbatim: Exact closing verdict line from investigation report or null.

policy_inception_date: Earliest policy start / "beneficiary covered from" date.
ped_declared_at_proposal: Was PED declared in proposal form? "YES"/"NO"/null.
ped_mentioned_in_records:
  Extract ANY pre-existing / chronic condition mentioned in records.
  Include:
    - duration-based history:
      "DM since 2 months", "HTN since 5 years", "Asthma since 2 years", "Asthma since childhood"
    - chronic disease markers:
      "K/c/o T2DM on medication", "Known diabetic", "Known hypertensive"
    - other chronic findings:
      "Asymptomatic cholelithiasis", "cholelithiasis", "Gallstones", "CKD", "COPD", "Old CVA"
  Also capture any line containing "since" followed by a duration (years/months) and a disease name, e.g. "Asthma - 2 yrs".
  Preserve wording verbatim.
  Return as JSON array of strings.
  Example: ["DM since 2 months", "K/c/o T2DM on medication", "Asthma since 2 years", "Asymptomatic cholelithiasis"]

ped_contradiction_detected:
  true if ped_mentioned_in_records contains, for what is recognisably the
  SAME condition, both a "newly diagnosed"-type statement AND a chronic
  marker (e.g. "K/c/o", "known case of", "on medication", "on OHA", "since
  <duration>", "on treatment") — i.e. the record contradicts itself about
  whether this was pre-existing. false if no such internal contradiction
  exists. Base this on what the records actually say for THIS claim, not
  on a fixed keyword list — the exact phrasing varies by hospital/insurer.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FEW‑SHOT EXAMPLES FOR CRITICAL FIELDS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EXAMPLE 1 – pre_admission_opd_visits:

Raw document snippet:
    ---
    Dr. KALAIARASAN SENGUTTUVAN, M.S.
    Consultant General & Laparoscopic Surgeon
    Date : 8/1/26
    Δ : Diabetic Neuropathy
    T2DM on OHA
    ---
Correct JSON output:
[
  {
    "date": "2026-01-08",
    "doctor": "Dr. KALAIARASAN SENGUTTUVAN",
    "diagnosis": "Diabetic Neuropathy",
    "hospital": null,
    "raw_text": "Dr. KALAIARASAN SENGUTTUVAN, M.S. ... Date : 8/1/26 Δ : Diabetic Neuropathy"
  }
]

Another raw snippet:
    ---
    ARK MULTI SPECIALITY HOSPITAL
    OP CASE SHEET
    Visit Time : 10/01/26 12:45 PM
    Consultant Doctor: SHIMNA KUNHIRAMAN MD.,DM(NEPHRO)
    c/o B/L side pain - 20 days, pedal edema - 10 days
    Newly diagnosed diabetes Dec 2025
    ---
Output:
[
  {
    "date": "2026-01-10",
    "doctor": "SHIMNA KUNHIRAMAN",
    "diagnosis": "Newly diagnosed diabetes",
    "hospital": "ARK MULTI SPECIALITY HOSPITAL",
    "raw_text": "ARK MULTI SPECIALITY HOSPITAL ... Visit Time : 10/01/26 ..."
  }
]

NOTE: Convert all dates to ISO format YYYY-MM-DD. Assume 2‑digit years are in 2000s (e.g., 26 → 2026).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EXAMPLE 2 – hba1c_values:

Raw: "HbA1c 10.5% (page 13/46)" and later "HbA1c 13 on 17/12/25"
Output: ["10.5% (page 13/46)", "13% (17/12/25)"]

If only value without page reference: "HbA1c: 8.2%" → ["8.2%"]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EXAMPLE 3 – contradictions_found:

Raw: ... "K/c/o T2DM on medication" (page 10) and later "Newly detected Type II DM" (page 30) ...
Output: ["Diabetes: 'K/c/o T2DM on medication' contradicts 'Newly detected Type II DM'"]

If multiple contradictions:
[
  "Diabetes: 'DM since 2 months' conflicts with 'newly diagnosed DM'",
  "Diagnosis: 'Left foot cellulitis' vs 'Left knee osteoarthritis'"
]

Identify contradictions by comparing what the SAME document set says about
the SAME fact at different points — do not rely on a fixed pair-list of
diagnosis names. Any two statements about the same condition/fact that
cannot both be true are a contradiction, regardless of which specific
diagnoses are involved.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EXAMPLE 4 – patient_stated_bill_amount:

Raw: "Final Bill amount paid at the hospital: 85,653"
Output: "Rs.85,653/-"

Alternative phrasing: "final bill amount 85653" → "Rs.85,653/-"
This field may be labelled differently across insurer templates
("Bill amount confirmed by insured", "Amount paid by patient", etc.) —
identify it by meaning (the bill amount the INSURED states they paid, as
opposed to the hospital's own billed figure), not by one fixed label.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

guardian_name / spouse_relation:
  For adults: extract the person's name from patterns like:
    "W/O <name>", "S/O <name>", "D/O <name>", "Spouse: <name>", "Father: <name>", "Mother: <name>"
  Return as a string like "Shankar Bhosale (husband)" or "Shankar Bhosale (father)".
  For minors: also accept "Father/Mother name" as guardian.
  If the document has both "Guardian name" and a spouse relation, prefer the explicit guardian.
  If none found, return null.

pre_admission_opd_visits:
  Extract ALL visits that happened BEFORE admission_date.
  Look for:
    - Prescription slips that have a date line and a doctor's name/signature.
    - OP case sheets with "Visit Time" or "Date".
    - Consultation notes from external clinics.
  For each, create an object:
    {
      date: "YYYY-MM-DD" (convert from d/m/yy),
      doctor: "doctor name if present",
      diagnosis: "any diagnosis mentioned (Δ / Diagnosis)",
      hospital: "clinic/hospital name if present",
      raw_text: "first 200 chars of the document"
    }
  Include ALL such visits, even if some fields are null.
  If multiple prescriptions on the same date, create separate entries.

pre_admission_prescriptions: Any prescriptions before admission.

accident_date_time: Date and time of accident.
accident_place: Location of accident.
accident_narration: Verbatim accident description.
mlc_number: MLC/police intimation number.
fir_number: FIR number.
police_station: Police station name.
witness_name/statement: Witness details.
brought_by: Who brought patient to hospital.
helmet_worn: "YES"/"NO"/"NA" for two-wheeler cases.
seatbelt_worn: "YES"/"NO"/"NA" for four-wheeler cases.
vehicle_type: Vehicle involved.
alcohol_smell_noted: Was alcohol smell noted in admission records? "YES"/"NO"/null.
alcohol_test_done: Was blood alcohol test done? "YES"/"NO"/null.
alcohol_test_result: Result of alcohol test.
intoxication_mentioned: Any mention of intoxication in records? "YES"/"NO"/null.
hba1c_values:
  Look for patterns: "HbA1c", "HbA₁c", "glycated haemoglobin", "HBA1C".
  Capture the numeric value AND the date if present (e.g., "10.5% (page 13/46)", "13 on 17/12/25").
  Return as JSON array of strings. Example: ["10.5% (page 13/46)", "13% (17/12/25)"]

patient_stated_bill_amount:
  Extract the bill amount the INSURED states they personally paid, wherever
  this claim's own documents record it (label wording varies by insurer —
  see EXAMPLE 4 above). Return as string with currency, e.g., "Rs.85,653/-".

contradictions_found:
  In addition to direct textual contradictions, examine hba1c_values and
  policy_inception_date together. If HbA1c > 9% and policy inception was
  less than 6 months before admission, add contradiction:
  "High HbA1c ({value}) within months of policy start – suggests pre-existing diabetes not disclosed."

death_date/time/place/cause: Death details.
postmortem_done: "YES"/"NO"/"PENDING".
suicidal_history/psychiatric_history/alcohol_history: From death checklist.

claimed_amount: From claim form or bill.
sum_insured: From policy details.
previous_claims: Any mention of prior claims.
claim_frequency: Pattern of claims if mentioned.
short_duration_policy: Was policy less than 1 year old at claim? "YES"/"NO"/null.

employer_name: From employee/corporate policy details.
employee_id: Employee ID number.
employment_verification_done: Was employment verified? "YES"/"NO"/null.

hospital_watchlist_status: Any mention of hospital being on watchlist.
hospital_empanelment_status: Network/non-network/empanelled status.
lab_vicinity_to_hospital: Lab distance/vicinity check result.
"""


async def _run_pass1_single(text: str) -> Dict[str, Any]:
    # ── FIX: truncate before sending to Groq ───────────────────────────────
    # Every other extractor in this codebase truncates document text before
    # building the prompt. Combined with the very large _PASS1_RULES block,
    # large documents can push the total prompt size past the model's
    # context window. Truncating here brings this call in line with the
    # rest of the pipeline; oversized files are handled by page-batching
    # in _run_pass1_batched instead of silent truncation loss.
    truncated_text = text[:_TEXT_LIMIT]
    user = f"""
Extract the following from the document text below.
Return ONLY valid JSON. Use null if not found. Never invent.
CRITICAL:
- Extract full discrepancy blocks; never truncate multi-line sections.
- Identify the discrepancy/observations block by MEANING, not by matching
  one fixed heading or one fixed closing sentence — insurer templates vary.
- Capture OPD history before admission as structured visit objects.
- Detect PED/chronic illness even when expressed indirectly
  (e.g. "K/c/o T2DM on medication", "DM since 2 months").

{PASS1_SCHEMA}

{_PASS1_RULES}

DOCUMENT TEXT:
 {truncated_text}
"""
    return await call_groq(_PASS1_SYSTEM, user, max_tokens=8000)


def detect_case_type(pass1: Dict[str, Any]) -> str:
    """
    Reads the case_type field the LLM already classified in Pass 1
    (see the `case_type` rule in _PASS1_RULES) instead of re-deriving it
    from a hardcoded diagnosis keyword list. Kept as a thin function so
    downstream callers (unified_report_agent.py) don't need to change
    their import.
    """
    case_type = str(pass1.get("case_type") or "").strip().upper()
    if case_type in ("SURGICAL", "MEDICAL", "MIXED"):
        return case_type
    return "MIXED"


def _merge_pass1(a: Dict[str, Any], b: Dict[str, Any]) -> Dict[str, Any]:
    result = dict(a)
    for k, v in b.items():
        if v is not None and result.get(k) is None:
            result[k] = v
    return result


# Fields where different batches of the SAME document may legitimately
# extract different items (e.g. batch 1 sees page 3's chief complaints,
# batch 2 sees page 40's drug chart) — these get UNIONED across batches
# instead of "first non-null wins".
_LIST_FIELDS_TO_UNION = {
    "chief_complaints", "all_treatments", "discharge_medications",
    "bill_breakdown_items", "hba1c_values", "pre_admission_opd_visits",
    "pre_admission_prescriptions", "contradictions_found",
    "ped_mentioned_in_records", "page_references_found",
}


def _normalize_amount_for_dedup(amount) -> str:
    """Strip currency prefixes, commas, and whitespace so '13,000.00' and
    'Rs.13,000.00' are recognized as the same amount when deduplicating
    bill_breakdown_items across page-batches — see _dedup_key below."""
    s = str(amount or "").strip()
    s = re.sub(r"^rs\.?\s*", "", s, flags=re.IGNORECASE)
    s = s.replace(",", "").rstrip("/-").strip()
    return s


def _dedup_key(item) -> str:
    """Dedup key for a merged list item. For bill_breakdown_items-shaped
    dicts ({"item": name, "amount": value}), normalize both fields so
    formatting differences between extraction batches (e.g. amount with
    vs without an 'Rs.' prefix) don't produce two 'different' entries for
    the same real line item. Falls back to repr() for any other shape."""
    if isinstance(item, dict) and "item" in item and "amount" in item:
        name = re.sub(r"\s+", " ", str(item.get("item") or "").strip().upper())
        amount = _normalize_amount_for_dedup(item.get("amount"))
        return f"{name}|{amount}"
    return repr(item)[:80]


def _merge_pass1_multi(results: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Merge Pass 1 results from multiple page-batches of the same claim.
    Scalar fields: first non-null value found wins (same rule as
    _merge_pass1). List fields in _LIST_FIELDS_TO_UNION: concatenated and
    deduplicated across all batches instead of overwritten.
    discrepancies_verbatim: longest non-empty extraction wins, since a
    later batch may see more of a discrepancy block that spans a page
    boundary the earlier batch cut off mid-way.
    """
    if not results:
        return {}
    merged: Dict[str, Any] = dict(results[0])
    for r in results[1:]:
        for k, v in r.items():
            if k in _LIST_FIELDS_TO_UNION:
                existing = merged.get(k)
                if not isinstance(existing, list):
                    existing = [existing] if existing else []
                incoming = v if isinstance(v, list) else ([v] if v else [])
                seen = {_dedup_key(x) for x in existing}
                for item in incoming:
                    key = _dedup_key(item)
                    if key not in seen:
                        existing.append(item)
                        seen.add(key)
                merged[k] = existing
            elif k == "discrepancies_verbatim":
                if v and (not merged.get(k) or len(str(v)) > len(str(merged.get(k)))):
                    merged[k] = v
            else:
                if v is not None and merged.get(k) is None:
                    merged[k] = v
    return merged


async def _run_pass1_batched(text: str) -> Dict[str, Any]:
    """
    Splits the combined document text by source PDF, and within any file
    bigger than _TEXT_LIMIT, further splits it into page-batches — instead
    of truncating to _TEXT_LIMIT chars and silently losing the rest of the
    file. Every batch runs Pass 1 extraction concurrently, then results
    are merged (see _merge_pass1_multi above).
    """
    files = split_text_by_pdf(text)

    batch_texts: List[str] = []
    for fname, ftext in files.items():
        if len(ftext) <= _TEXT_LIMIT:
            batch_texts.append(ftext)
            continue
        pages = batch_file_pages(ftext, max_chars=_TEXT_LIMIT, overlap_pages=1)
        logger.info(
            "run_pass1: file=%s (%d chars) split into %d batch(es) for "
            "extraction (previously truncated to %d chars and the rest "
            "was silently dropped)", fname, len(ftext), len(pages), _TEXT_LIMIT,
        )
        for batch in pages:
            batch_texts.append(render_page_batch(fname, batch))

    if not batch_texts:
        batch_texts = [text[:_TEXT_LIMIT]]

    results = await asyncio.gather(
        *[_run_pass1_single(bt) for bt in batch_texts],
        return_exceptions=True,
    )

    usable_results = []
    for r in results:
        if isinstance(r, Exception):
            logger.exception("Pass 1 batch call failed: %s", r)
            continue
        if isinstance(r, dict) and r:
            usable_results.append(r)

    if not usable_results:
        return {}

    return _merge_pass1_multi(usable_results)


async def run_pass1(text: str) -> Dict[str, Any]:
    """
    The single entry point for turning raw_llama_markdown into structured
    claim facts. `text` must be raw_llama_markdown and nothing else —
    every field in the returned dict is either extracted by the LLM from
    this text, or read directly from it downstream via chunking.py's
    boundary-aware helpers. No separate deterministic-regex extraction
    pass runs on top of the LLM's output anymore: those regexes assumed a
    single fixed report template (one exact closing sentence, one exact
    field label) and silently produced wrong overrides on any other
    insurer's format. Extraction quality for hba1c/bill/discrepancy
    fields now depends entirely on the Pass 1 prompt rules above — if a
    gap shows up on a real claim, the fix is to sharpen those rules, not
    to bolt another template-specific regex back on.
    """
    # ── Translate any regional-language segments before extraction ────────
    loop = asyncio.get_event_loop()
    text = await loop.run_in_executor(None, translate_regional_text, text)

    # ── LLM extraction — batched per file/page so large files no longer
    #    lose everything past _TEXT_LIMIT chars ─────────────────────────
    merged = await _run_pass1_batched(text)

    return merged, text