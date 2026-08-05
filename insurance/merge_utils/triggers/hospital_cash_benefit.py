"""Trigger 12: Hospital Cash / Benefit Abuse"""
from __future__ import annotations
import re
import json
import logging
import asyncio
from typing import Any, Dict
from routes.agents.preprocessor import reconcile_conclusion, extract_discrepancies_from_raw
from routes.agents.base import (
    call_groq_sync,
    SHARED_RULES,
    _make_serializable,
)

logger = logging.getLogger(__name__)

_SYSTEM = SHARED_RULES + """

⚠ CRITICAL – DISCREPANCY BLOCK RULE ⚠
You MUST reproduce the `DISCREPANCIES` block EXACTLY as it appears in the `<<<DISC_START>>>` section.
Do NOT summarise, rephrase, reorder, or truncate.
Do NOT convert it into a numbered list unless the original is already a numbered list.
If the original block contains line breaks, page references (-14/52-), and specific phrasing, keep them unchanged.
If you cannot copy it exactly, copy it as-is and do not attempt to rewrite.

You are a senior insurance investigator specializing in hospital cash benefit abuse detection,
length-of-stay inflation auditing, and artificial admission identification, with 20+ years
of experience in Indian health insurance claim audits.
Write like a formal benefit abuse investigation report. Use language like:
"Our investigator reviewed the IP register and nursing notes for the claimed period",
"Vitals chart dates were found blank across all pages — continuous single-stretch entries noted",
"Bill analysis reveals ICU charges billed for all 5 days despite no ICU register entries",
"The length of stay claimed does not correspond with the clinical severity documented."
STRICT RULES:
- You MUST reproduce the EXACT discrepancies_verbatim block in Section 2.
- You MUST NOT invent any symptom, date, number, medicine, or timeline.
- If the document contains any of these words:
  suspected, conceal, hide, not provided, not maintained, blank,
  single stretch
  → verdict MUST be SUSPECTED.
- The final verdict line must exactly match the manual closing phrase
  if final_verdict_verbatim exists.
  Otherwise use verdict_override from preprocessed data.
- Never reinterpret chief complaints. Use only the pre-extracted complaint list.
RULE — GUARDIAN/SPOUSE:
If the document contains "W/O", "S/O", "D/O", "Spouse:", "Father:", or "Mother:",
you MUST include the relation in Section 1 as "(Guardian/Spouse: [name])" or "(Husband: [name])".
If the relation is explicitly "w/o", write "wife of [name]".
RULE — BILL LINE ITEMS:
If the number of line items in the pre‑extracted list is > 0,
you MUST list each one in the "Bill breakdown:" sentence.
Never write "etc." or "…".
"""

_SCHEMA = '''
⚠ ISOLATION RULE: All facts must come ONLY from FORENSIC AUDIT FACTS and FULL DOCUMENT TEXT.
Do NOT import drug names, amounts, or clinical details from memory or prior context.

Return JSON: { "conclusion": null }
Multi-section hospital cash and benefit abuse investigation report. Third person, past tense.
Use \\n\\n between sections.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Use ONLY facts from FORENSIC AUDIT FACTS and FULL DOCUMENT TEXT. Never invent.
- Admission date/time and discharge date/time must appear verbatim with exact LOS calculation.
- ALL vitals verbatim — never write "stable" or summarize.
- State vitals chart date status, nurses notes date status, medication chart status explicitly.
- ICU charges: cross-check against ICU register entries, ICU nursing notes, and monitoring sheets.
- Bill breakdown must appear line by line, including room type, per-day rate, ICU charges.
- Previous claim history and claim frequency must appear if non-null.
- Policy benefit wording (hospital cash clause, ICU cash clause) must be referenced if found.
- Multiple policy / duplicate benefit check must appear in Section 3D.
- Diagnosis must be assessed for LOS appropriateness in Section 3A.
- ALL chief complaints verbatim — use ONLY the pre-extracted complaint list.
- Registers stated per BINDING INSTRUCTION flags only — never assume.
- You MUST reproduce discrepancies_verbatim EXACTLY in Section 2. Do not paraphrase or reorder.

RULE — REGISTERS — WRITE ONLY WHAT IS CONFIRMED:
  If flag = YES → state "verified and attached"
  If flag = NO  → state "[MISSING] — not collected"
  If flag = null → omit entirely
  NEVER write a blanket register statement unless ALL relevant flags are YES.

RULE — TREATING DOCTOR — STANDALONE LINE:
After registers, always state treating doctor as a standalone sentence:
"Treating Doctor — Dr. [name] ([qualification], Reg No. [reg_number])."

SECTION 1 — HOSPITALIZATION AND BENEFIT FACTS
One dense paragraph covering:
- Patient: name, age, gender, address
- Hospital: name, full address, registration number, bed strength, empanelment status
- Admission: date, time, IP number; Discharge: date, time
- Length of stay: exact calculation (days) — stated and actual
- Room type and tariff per day
- ALL chief complaints verbatim (pre-extracted list only)
- Past history (exact phrase)
- Vitals on admission (ALL markers — BP, PR, SPO2, Temp, RR, GRBS verbatim)
- Vitals at discharge (verbatim)
- Provisional and final diagnosis (all lines verbatim)
- All treatments administered (every drug by name)
- Bill: gross, discount, bill breakdown line by line:
  room charges, ICU charges, medicine charges, lab charges, other charges
- Mode of payment
- Hospital cash benefit: rate per day, total days claimed, total benefit amount (from policy if available)
- ICU cash benefit: rate, total ICU days claimed (if applicable)
- Vitals chart dates: present / blank / single stretch (state verbatim from extraction)
- Nurses notes dates: present / blank / single stretch (state verbatim)
- Medication chart IP number and date/time: present / blank (state verbatim)
- Registers (per flags below): IP register, OT register, lab register, pharmacy register
- ICU register entries for claim period: present / absent / blank
- Treating doctor (standalone)
- Previous claims: state count, diagnosis, hospital, period if available
- Claim frequency: state if available

SECTION 2 — DISCREPANCIES
Header: "DISCREPANCIES"
If discrepancies_verbatim is non-null:
  → "Kindly note —" followed by ENTIRE verbatim block exactly as written.
Append auto-detected flags not already in verbatim.
If none at all: "No major discrepancies noted."

SECTION 3 — ADMISSION AND LOS VERIFICATION
Verify and state clearly for each:
□ Is the patient's admission recorded in the IP register?
□ Does the IP register entry match the claimed admission and discharge dates?
□ Was the bed actually allotted — is bed number recorded?
□ Is there a genuine nursing admission note at the stated admission time?
□ Are daily nursing notes present and dated for each day of the claimed stay?
□ Are vitals charts dated and do they cover the entire claimed admission period?
□ Is the medication chart filled with IP number, dates, and drug administration times?
□ Does the pharmacy dispensing record align with the inpatient stay dates?
□ Does the lab investigation record align with the claimed admission period?
□ Was the admission medically necessary given the documented clinical condition?
□ Is the length of stay appropriate for the diagnosis and severity documented?
□ Is there evidence of premature discharge or artificial prolongation of stay?
□ Does the discharge summary narrative match the clinical records?

Classify each:
  [VERIFIED] — confirmed by register / clinical record
  [INFLATED] — stay or charges exceed what clinical record supports
  [FABRICATED] — record appears manufactured or dates are blank/implausible
  [SUSPICIOUS] — raises benefit abuse concern
  [NOT VERIFIED] — record absent or not checked

SECTION 4 — BENEFIT CALCULATION AND ABUSE AUDIT

A. Length of Stay vs Clinical Severity:
   State diagnosis, documented severity (vitals, investigations), and typical expected LOS.
   State claimed LOS. State whether LOS is appropriate, borderline, or inflated.

B. Hospital Cash Calculation Audit:
   - Policy minimum admission requirement: state if known
   - Exact admission time to exact discharge time: does it meet the minimum?
   - Daily benefit rate × verified days = benefit payable
   - Days claimed vs days verifiable from clinical records
   - Any 23-hour admissions or artificial overnight stays to trigger eligibility?

C. ICU Benefit Audit (if ICU charged):
   - ICU days billed: state count
   - ICU register entries for the claimed days: present / absent / partial
   - ICU monitoring sheets for the claimed days: present / absent
   - ICU nursing notes: present / absent
   - Patient's documented clinical condition: was ICU-level care genuinely required?
   - ICU benefit calculation: rate × days claimed vs days verifiable

D. Multiple Policy / Duplicate Benefit Check:
   - Is same hospitalization claimed under more than one policy?
   - Is corporate + retail policy overlap present?
   - Is there any duplicate reimbursement or dual cashless claim?
   - Previous similar hospital cash claims in the same policy year: state count and pattern

E. Repeat Admission Pattern Check:
   - State previous claims: frequency, diagnosis, hospital, duration
   - Is there a pattern of repeated short admissions targeting the minimum stay threshold?
   - Is there same-hospital, same-diagnosis repetition?

SECTION 5 — DOCUMENT INTEGRITY CROSS-CHECK
Cross-reference the following and state finding for each:
- Vitals chart: dates filled across all pages? Single continuous stretch without date breaks?
- Nurses notes: dated per shift? Or undated single stretch?
- Medication chart: IP number, date, time filled? Or blank?
- Investigation result chart: result values entered or completely blank?
- Discharge summary clinical narrative: consistent with daily progress notes?
- Bill dates vs clinical record dates: aligned or mismatched?
- Admission form date vs IP register entry date: consistent?

SECTION 6 — AUDIT EVALUATION
A. Admission Genuinity:
   Was the patient genuinely admitted as an inpatient for the claimed period,
   with operational evidence (nursing notes, vitals, pharmacy, lab) throughout?
B. Stay Duration:
   Is the claimed length of stay medically justified and operationally corroborated?
C. Benefit Calculation:
   Is the hospital cash / ICU cash benefit calculated on genuine, verifiable days?
D. Abuse Risk Assessment:
   State specific concerns only. Conclude with ONE of:
   "Admission and stay duration are well-supported — hospital cash benefit appears legitimately claimed."
   "Documentation gaps raise concerns about stay duration — benefit entitlement requires clarification."
   "Evidence strongly suggests artificial admission or inflated LOS for benefit purposes — abuse cannot be ruled out."

SECTION 7 — CONCLUSION
Summary → Admission verification outcome → LOS verification outcome →
ICU / benefit calculation outcome → Multiple policy / repeat pattern outcome →
Recommendation → Final verdict line.
Always end with either final_verdict_verbatim (if non-null) or the appropriate verdict phrase
from verdict_override.
'''


async def run(
    text: str,
    pass1_result: Dict[str, Any],
    extracted_flat: Dict[str, Any],
    preprocessed: Dict[str, Any] = None,
) -> str:
    if preprocessed is None:
        from routes.agents.preprocessor import preprocess
        preprocessed = preprocess(pass1_result, extracted_flat)

    non_null = {k: v for k, v in extracted_flat.items() if v is not None}
    non_null = _make_serializable(non_null)
    pass1_result = _make_serializable(pass1_result)

    disc_block = (
        preprocessed.get("_effective_disc_block")
        or pass1_result.get("discrepancies_verbatim")
        or extract_discrepancies_from_raw(text)
        or ""
    )

    if not pass1_result.get("discrepancies_verbatim") and disc_block:
        logger.info("Recovered discrepancy block from raw markdown fallback")
        pass1_result["discrepancies_verbatim"] = disc_block

    auto_flags = preprocessed.get("auto_discrepancies") or []
    is_genuine = preprocessed.get("_is_genuine", False)

    if auto_flags and (not disc_block or disc_block == "None"):
        if not is_genuine:
            auto_text = "\n".join(auto_flags)
            disc_block = (
                (disc_block + "\n" + auto_text) if disc_block
                else "Kindly note —\n" + auto_text
            )
            if not pass1_result.get("discrepancies_verbatim"):
                pass1_result["discrepancies_verbatim"] = disc_block
        else:
            disc_block = ""

    if not disc_block:
        disc_block = "None"

    user = f"""
{_SCHEMA}

MANDATORY CHECKLIST — verify each before writing the first word:
□ Admission date/time and discharge date/time appear verbatim. Calculate exact LOS.
□ All {len(preprocessed['complaints_list'])} chief complaints written verbatim
□ Vitals string appears exactly — no "stable" (admission AND discharge)
□ vitals_chart_dates_present appears in Sections 1 and 5 verbatim
□ nurses_notes_dates_present appears in Sections 1 and 5 verbatim
□ medication_chart_ip_number_present and medication_chart_time_date_present appear
  in Sections 1 and 5 verbatim
□ investigation_result_chart_status appears in Section 5 verbatim
□ Bill breakdown appears line by line in Section 1 (room, ICU, medicine, lab)
□ icu_charges appears in Section 1 and Section 4C if non-null
□ previous_claims and claim_frequency appear in Section 4E if non-null
□ Register prose matches flags exactly in Section 3
□ cashless_availed appears in Section 4D if non-null
□ room_type, room_charges, room_tariff_per_day appear in Section 1
□ Discrepancy verbatim block reproduced ENTIRELY if discrepancies_verbatim is non-null
□ Auto-discrepancies appended if not already present
□ Final verdict = {preprocessed['verdict_override']}
□ If final_verdict_verbatim exists, final line must match it exactly
□ Final diagnosis reproduced VERBATIM including ALL lines

BINDING INSTRUCTIONS — NON-NEGOTIABLE:

1. VERDICT LOCK:
If FULL DOCUMENT TEXT contains:
suspected, conceal, hide, not provided, not maintained, blank, single stretch
→ VERDICT = SUSPECTED
Else: VERDICT = {preprocessed['verdict_override']}

2. CHIEF COMPLAINTS — use ONLY this exact list:
{json.dumps(preprocessed['complaints_list'], indent=2)}

3. AUTO-DETECTED DISCREPANCIES — append to Section 2 if not already in verbatim:
{chr(10).join(preprocessed['auto_discrepancies']) or "   (none)"}

4. BILL FIGURES — use exactly these:
{preprocessed['bill_block']}

5. REGISTER STATUS:
   IP register:   {preprocessed['register_flags']['ip']}
   OT register:   {preprocessed['register_flags']['ot']}
   Lab register:  {preprocessed['register_flags']['lab']}
   Pharmacy:      {preprocessed['register_flags']['pharmacy']}
   Reg cert:      {preprocessed['register_flags']['reg_cert']}
   Tariff:        {pass1_result.get('tariff_attached') or 'null'}

6. VITALS — use this exact string (never write "stable"):
   Admission: {preprocessed['vitals_formatted'] or pass1_result.get('vitals_on_admission') or 'Not documented'}
   Discharge — COPY EXACTLY (do not mix with admission vitals):
   {pass1_result.get('vitals_at_discharge') or 'Not documented'}

7. VERDICT ENFORCEMENT:
   If FULL DOCUMENT TEXT contains "claim seems to be suspected" or a Kindly note
   section with multiple discrepancy points → verdict MUST be SUSPECTED.

8. HOSPITAL CASH / BENEFIT ABUSE CONSTANTS:
   Admission date/time:        {pass1_result.get('admission_date') or 'Not documented'} / {pass1_result.get('admission_time') or 'Not documented'}
   Discharge date/time:         {pass1_result.get('discharge_date') or 'Not documented'} / {pass1_result.get('discharge_time') or 'Not documented'}
   Room type:                    {pass1_result.get('room_type') or 'Not documented'}
   Room tariff per day:           {pass1_result.get('room_tariff_per_day') or 'Not documented'}
   ICU charges:                    {pass1_result.get('icu_charges') or 'Not documented'}
   ICU register entries (period):  {pass1_result.get('icu_register_entries') or 'Not documented'}
   Cashless availed:                {pass1_result.get('cashless_availed') or 'Not documented'}
   Previous claims:                  {pass1_result.get('previous_claims') or 'Not documented'}
   Claim frequency:                   {pass1_result.get('claim_frequency') or 'Not documented'}
   Vitals chart dates present:         {pass1_result.get('vitals_chart_dates_present') or 'Not documented'}
   Vitals chart single stretch:         {pass1_result.get('vitals_chart_single_stretch') or 'Not documented'}
   Nurses notes dates present:           {pass1_result.get('nurses_notes_dates_present') or 'Not documented'}
   Nurses notes single stretch:           {pass1_result.get('nurses_notes_single_stretch') or 'Not documented'}
   Medication chart IP number present:     {pass1_result.get('medication_chart_ip_number_present') or 'Not documented'}
   Medication chart time/date present:      {pass1_result.get('medication_chart_time_date_present') or 'Not documented'}
   Investigation result chart status:        {pass1_result.get('investigation_result_chart_status') or 'Not documented'}
   IP register collected/attached:            {pass1_result.get('ip_register_collected') or 'Not documented'} / {pass1_result.get('ip_register_attached') or 'Not documented'}

9. FINAL DIAGNOSIS LOCK — reproduce EXACTLY, all lines:
   {json.dumps(pass1_result.get('final_diagnosis'), indent=2)}

DISCREPANCIES (copy verbatim exactly; do not paraphrase):
<<<DISC_START>>>
{disc_block}
<<<DISC_END>>>

BILL LINE ITEMS:
{json.dumps(pass1_result.get('bill_breakdown_items', []), indent=2)}

ALL TREATMENTS:
{json.dumps(pass1_result.get('all_treatments', []), indent=2)}

FINAL VERDICT RULE:
If pass1_result["final_verdict_verbatim"] is non-null, use it EXACTLY as the closing line.
Else use: {preprocessed['verdict_override']}

FORENSIC AUDIT FACTS:
{json.dumps(pass1_result, indent=2)}

A1-A6 CONTEXT:
{json.dumps(non_null, indent=2)[:2000]}

FULL DOCUMENT TEXT:
{text[:50000]}
"""

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        call_groq_sync,
        _SYSTEM,
        user,
        7000,
    )

    conclusion = result.get("conclusion") or ""

    # Fallback: reconstruct from section keys if model split into sections
    if not conclusion and isinstance(result, dict):
        section_keys = sorted(k for k in result if k.startswith("section_"))
        if section_keys:
            conclusion = "\n\n".join(result[k] for k in section_keys)
            logger.info(
                "Reconstructed hospital_cash conclusion from %d sections",
                len(section_keys),
            )
        elif result:
            conclusion = json.dumps(result, indent=2)
            logger.warning("No 'conclusion' key; using raw JSON as fallback")

    # Chief complaints enforcement
    expected_complaints = preprocessed.get("complaints_list", [])
    if expected_complaints and conclusion:
        missing = [
            c for c in expected_complaints
            if c.lower()[:12] not in conclusion.lower()
        ]
        if len(missing) > len(expected_complaints) * 0.5:
            lines = conclusion.split("\n")
            for i, line in enumerate(lines):
                if re.search(r"As per the ICP.*?\d+-year-old", line, re.IGNORECASE):
                    complaint_line = (
                        f"Chief complaints — {', '.join(expected_complaints)}."
                    )
                    lines.insert(i + 1, complaint_line)
                    conclusion = "\n".join(lines)
                    logger.info("Inserted missing chief complaints")
                    break

    # Genuine override: if preprocessor says genuine but LLM wrote suspected
    if preprocessed.get("_is_genuine") and conclusion:
        lower = conclusion.lower()
        if "claim seems to be suspected" in lower or "not recommended for settlement" in lower:
            conclusion = re.sub(
                r"(?i)(hence based on the above discrepancies.*?suspected\.?|"
                r"not recommended for settlement\.?)",
                "As per the verification, the hospital cash benefit claim is found to be Genuine.",
                conclusion,
                count=1,
            )
            logger.info("Post-processed: forced GENUINE verdict override")

    # Deterministic discrepancy block injection
    from routes.agents.base import extract_discrepancies_deterministic
    raw_disc = extract_discrepancies_deterministic(text)
    if raw_disc and len(raw_disc) > 50:
        pattern = r"(SECTION 2 — DISCREPANCIES\s*\n)(.*?)(\n\nSECTION 3|\n\n\*\*SECTION 3|\Z)"
        replacement = r"\1" + raw_disc + r"\3"
        conclusion = re.sub(
            pattern, replacement, conclusion,
            flags=re.DOTALL | re.IGNORECASE,
        )

    conclusion = reconcile_conclusion(conclusion, pass1_result)
    logger.info("hospital_cash conclusion: %d chars", len(conclusion))
    return conclusion