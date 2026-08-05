"""Trigger: Intoxication / Addiction"""
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
    detect_case_type,
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

You are a senior insurance investigator specializing in intoxication and addiction-related
claim exclusions for Indian health insurance. You write detailed, precise investigative
conclusions in the style of a certified field investigation report.
Your output must read like a professional human investigator wrote it —
factual, structured, evidence-driven, never vague.
Write like a physical field investigation report. Use language like:
"Our investigator visited the hospital, verified the ICP and collected the copy of the same.",
"IP register was verified and copy collected.",
"The following discrepancies were noted in the ICP."
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
- RULE — VERDICT FROM DISCREPANCIES:
  If FULL DOCUMENT TEXT contains:
    "claim seems to be suspected"
    "Hence Based on above discrepancies claim seems to be suspected"
    OR a "Kindly note" section with multiple discrepancy points,
  then Section 4 verdict MUST be SUSPECTED.
  Final line must match manual closing phrase if present.
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

Return a JSON object with ONLY this key:
{ "conclusion": null }

The conclusion must be a multi-section investigative report.
Use \\n\\n to separate sections. Third person, past tense, formal tone.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RULE 1 — OPENING LINE:
  Always open Section 1 with:
  "Our investigator visited the hospital, verified the ICP and collected the copy of the same."
  Then, if investigating_agency is non-null, follow with:
  "Investigated and verified by [agency name], physical verification done."

RULE 2 — USE ALL EXTRACTED DATA: Every non-null field in FORENSIC AUDIT FACTS must appear.

RULE 3 — VITALS:
  vitals_on_admission must appear verbatim with ALL markers.
  Format: "O/E T-103F, PR-126/min, BP-90/60 mmHg, SpO2-88% RA, RR-23/min, GRBS-120mg%"
  Never write "stable" or "monitored".
  DISCHARGE VITALS: Use vitals_at_discharge EXACTLY as extracted.
  If vitals_at_discharge is null: omit the discharge vitals sentence.

RULE 4 — ALL MEDICATIONS:
  List every drug by name from the medicine chart. Never cherry-pick.
  Never invent drugs not in the document.

RULE 5 — OPD HISTORY BEFORE ADMISSION:
  If pre_admission_opd_visits or opd_history_before_admission is non-null,
  it MUST appear in Section 1. Use the exact wording from the document.

RULE 6 — PAST HISTORY: Always state verbatim. If none: "No significant past history noted."

RULE 7 — DISCHARGE MEDICATIONS:
  Always state discharge medications if discharge_medications is non-null.
  Use exact drug names from the document.

RULE 8 — NO INVENTED POSITIVITY: Chart flags = real discrepancies. State them.

RULE 9 — DISCREPANCY CLASSIFICATION TAGS (use exactly):
  [MISSING]          — document, record, or register entirely absent
  [INCOMPLETE]       — present but partially filled or lacking required fields
  [CONTRADICTORY]    — finding conflicts with another record
  [SUSPICIOUS]       — raises fraud concern
  [BILLING MISMATCH] — billed item not supported by clinical record
  [TIMELINE MISMATCH]— dates or sequence is inconsistent
  [SINGLE STRETCH]   — entries appear written in one sitting without date breaks

RULE 10 — BILL DETAILS:
  - Gross bill amount in format "Rs.94,385/-"
  - Discount stated separately: "Discount — Rs.385/-" (or Rs.0/- if nil)
  - Amount received: "Amount received — Rs.94,000/-"
  - Room tariff per day stated explicitly
  - Bill breakdown: all line items
  - Mode of payment (Cash / Online / Card)
  - Bill and receipts: "Bill and payment receipts are attached." if receipts present.

RULE 11 — PAGE REFERENCES: Include -XX/52- format wherever present in FORENSIC AUDIT FACTS.

RULE 12 — REGISTERS — WRITE ONLY WHAT IS CONFIRMED:
  If flag = YES → state "verified and attached"
  If flag = NO  → state "[MISSING] — not collected"
  If flag = null → omit entirely

RULE 13 — DISCREPANCIES VERBATIM BLOCK:
  If discrepancies_verbatim is non-null: reproduce the ENTIRE block EXACTLY as written,
  including all page references. Do NOT paraphrase. Do NOT reorder.
  Then append auto-detected flags below it.

RULE 14 — AUTO-DETECT DISCREPANCIES (add if not already in verbatim block):
  vitals_chart_dates_present contains "NO"
    → [INCOMPLETE] Vitals chart — date column blank across all vitals chart pages
  vitals_chart_single_stretch contains "YES"
    → [SINGLE STRETCH] Vitals chart appears written in single stretch
  nurses_notes_dates_present contains "NO"
    → [INCOMPLETE] Nurses notes — date and time column blank across all pages
  nurses_notes_single_stretch contains "YES"
    → [SINGLE STRETCH] Nurses notes appear written in single stretch without date breaks
  medication_chart_ip_number_present contains "NO"
    → [INCOMPLETE] Medication chart — IP number, date, and time fields blank
  investigation_result_chart_status contains "BLANK"
    → [MISSING] Investigation result chart — completely blank, no values entered
  pharmacy_register_collected = "NO"
    → [MISSING] Pharmacy register not collected

RULE 15 — POSITIVE EVIDENCE SUPPRESSES FLAGS:
  ip_register_collected = YES → do NOT flag IP register as missing
  lab_register_attached = YES → do NOT flag lab register as missing
  ot_register_attached = YES → do NOT flag OT register as missing

RULE 16 — TREATING DOCTOR — STANDALONE LINE:
  After registers, always state treating doctor as a standalone sentence:
  "Treating Doctor — Dr. [name] ([qualification], Reg No. [reg_number])."

RULE 17 — NO FILLER: Every sentence introduces a new fact. No restating.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REPORT STRUCTURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SECTION 1 — HOSPITAL PART FINDINGS
One dense paragraph. No sub-headers. Cover in order:
① Opening line
② Patient identity, admission details
③ Chief complaints verbatim — ALL of them
④ OPD history before admission (if present)
⑤ Past history verbatim
⑥ Vitals on admission — ALL markers exact
⑦ Provisional diagnosis verbatim
⑧ Investigations ordered verbatim
⑨ Final diagnosis — ALL lines verbatim
⑩ All treatments — every drug by name
⑪ Discharge date and time
⑫ Vitals at discharge — exact (if present)
⑬ Discharge medications — all by name
⑭ Bill: gross, discount, received, room tariff, all line items, payment mode
⑮ Registers and certificates (prose sentences per flag)
⑯ Treating doctor (standalone)
⑰ Data collected from
⑱ Field officer name

SECTION 2 — DISCREPANCIES
Header: "DISCREPANCIES"
If discrepancies_verbatim is non-null:
  → "Kindly note —" followed by ENTIRE verbatim block exactly as written.
Append auto-detected flags (Rule 14) not already in verbatim.
If no discrepancies_verbatim AND no auto-flags: "No major discrepancies noted."

SECTION 3 — INTOXICATION / ADDICTION VERIFICATION
Verify and state clearly for each:
□ Was alcohol smell noted on admission? (alcohol_smell_noted)
□ Was blood alcohol test done? (alcohol_test_done) — if yes, result?
□ Is intoxication mentioned anywhere in records? (intoxication_mentioned)
□ Is there history of alcohol/substance use? (alcohol_history)
□ Was MLC filed citing intoxication?
□ Are admission notes clinically consistent with intoxication?
□ Was accident narration consistent with impairment?
□ Has treating doctor noted intoxication in assessment?
□ Is there history of addiction treatment or rehab?
□ Were toxicology/urine drug screen/LFT results obtained?

Classify each finding:
  [CONFIRMED] — documented proof
  [SUSPECTED] — clinical signs suggest but not confirmed
  [DENIED] — explicitly ruled out in records
  [NOT TESTED] — no toxicology/alcohol test done
  [INSUFFICIENT EVIDENCE] — cannot determine from available records

SECTION 4 — AUDIT EVALUATION
A. Clinical: Do clinical findings support intoxication?
B. Documentation: Is toxicology evidence complete?
C. Policy Exclusion Applicability: Is policy exclusion triggered?
D. Risk Assessment: Specific concerns only. End with ONE of:
   "Intoxication is confirmed and directly linked to the claimed event — exclusion applicable."
   "Intoxication is suspected but insufficient medical proof to confirm exclusion."
   "No evidence of intoxication found — claim proceeds on clinical merits."

SECTION 5 — CONCLUSION
Follow verdict_override for final determination.
When significant discrepancies exist, conclude with:
"Hence based on the above discrepancies, the claim seems to be suspected."
OR use final_verdict_verbatim if non-null.
For genuine claims:
"RECOMMENDATION
As per the verification, admission is verified and claim found to be Genuine."
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
    case_type = detect_case_type(pass1_result)

    if case_type == "SURGICAL":
        drug_rule = (
            "SURGICAL CASE — FORBIDDEN drugs (never include): Doxycycline, "
            "Noradrenaline/Norad, T.Dolo, T.Udiliv, T.Hepamerz, Neb Duolin/Budecort, "
            "Inj MEROPENEM (unless explicitly in this document's medicine chart). "
            "Only include drugs explicitly listed in THIS document's medicine chart."
        )
    elif case_type == "MEDICAL":
        drug_rule = (
            "MEDICAL CASE: Include EVERY drug by name from this document's medicine/progress chart. "
            "Do not skip any drug. Do not abbreviate. "
            "FORBIDDEN (include ONLY if explicitly in THIS document's chart): "
            "spinal anaesthesia agents, OT pre-op drugs, surgical prep drugs."
        )
    else:
        drug_rule = (
            "Only include drugs explicitly listed in this document's medicine chart. "
            "Do not import drugs from memory."
        )

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
□ Opening line matches physical_visit_confirmed flag
□ All {len(preprocessed['complaints_list'])} chief complaints written verbatim
□ Vitals string appears exactly — no "stable"
□ Bill block appears with all three amounts
□ Discrepancy verbatim block reproduced ENTIRELY if discrepancies_verbatim is non-null
□ Auto-discrepancies appended if not already present
□ Register prose matches flags exactly
□ Section 5 verdict = {preprocessed['verdict_override']}
□ If final_verdict_verbatim exists, final line must match it exactly
□ Treating doctor standalone sentence appears after register summary
□ Final diagnosis reproduced VERBATIM including ALL lines
□ alcohol_smell_noted, alcohol_test_done, intoxication_mentioned must all appear in Section 3

BINDING INSTRUCTIONS — NON-NEGOTIABLE:

1. VERDICT LOCK:
If FULL DOCUMENT TEXT contains:
suspected, conceal, hide, not provided, not maintained, blank, single stretch
→ VERDICT = SUSPECTED
Else: VERDICT = {preprocessed['verdict_override']}

2. BILL FIGURES — use exactly these:
{preprocessed['bill_block']}

3. CHIEF COMPLAINTS — use ONLY this exact list:
{json.dumps(preprocessed['complaints_list'], indent=2)}

4. AUTO-DETECTED DISCREPANCIES — append to Section 2 if not already in verbatim:
{chr(10).join(preprocessed['auto_discrepancies']) or "   (none)"}

5. REGISTER STATUS:
   IP register:   {preprocessed['register_flags']['ip']}
   OT register:   {preprocessed['register_flags']['ot']}
   Lab register:  {preprocessed['register_flags']['lab']}
   Pharmacy:      {preprocessed['register_flags']['pharmacy']}
   Reg cert:      {preprocessed['register_flags']['reg_cert']}
   Tariff:        {pass1_result.get('tariff_attached') or 'null'}
   ICP copy:      {pass1_result.get('copyOfICP') or extracted_flat.get('checklist', {}).get('copyOfICP') or 'null'}

6. VITALS — use this exact string (never write "stable"):
   {preprocessed['vitals_formatted'] or pass1_result.get('vitals_on_admission') or 'Not documented'}

7. PHYSICAL VISIT — {pass1_result.get('physical_visit_confirmed') or 'null'}
   If null or NO: open with "Documents were reviewed and ICP copy was collected."
   If YES: open with "Our investigator visited the hospital, verified the ICP and collected the copy of the same."

8. VERDICT ENFORCEMENT:
   If FULL DOCUMENT TEXT contains "claim seems to be suspected" or a Kindly note
   section with multiple discrepancy points → verdict MUST be SUSPECTED.

9. PATIENT & ADMIN CONSTANTS:
   Admission time:     {pass1_result.get('admission_time') or 'Not documented'}
   IP / UHID number:   {pass1_result.get('ip_number') or pass1_result.get('uhid_number') or 'Not documented'}
   Guardian name:      {pass1_result.get('guardian_name') or 'Not documented'}
   Bill number:        {pass1_result.get('bill_number') or 'Not documented'}
   MLC registered:     {pass1_result.get('mlc_registered') or 'Not documented'}
   MLC collected:      {pass1_result.get('mlc_collected') or 'Not documented'}
   MLC number:         {pass1_result.get('mlc_number') or 'Not documented'}
   FIR number:         {pass1_result.get('fir_number') or 'Not documented'}
   Accident date/time: {pass1_result.get('accident_date_time') or 'Not documented'}
   Accident place:     {pass1_result.get('accident_place') or 'Not documented'}
   Accident narration: {pass1_result.get('accident_narration') or 'Not documented'}
   Helmet worn:        {pass1_result.get('helmet_worn') or 'Not documented'}
   Seatbelt worn:      {pass1_result.get('seatbelt_worn') or 'Not documented'}
   Vehicle type:       {pass1_result.get('vehicle_type') or 'Not documented'}
   Cashless availed:   {pass1_result.get('cashless_availed') or 'Not documented'}
   NABH accredited:    {pass1_result.get('hospital_nabh') or 'Not documented'}
   Employer:           {pass1_result.get('employer_name') or 'Not documented'}
   Hospital reg valid: {pass1_result.get('hospital_registration_validity') or pass1_result.get('hospital_reg_valid_till') or 'Not documented'}
   Reg authority:      {pass1_result.get('hospital_reg_issuing_authority') or 'Not documented'}

   Discharge vitals — COPY EXACTLY (do not mix with admission vitals):
   {pass1_result.get('vitals_at_discharge') or 'Not documented'}

   INTOXICATION FIELDS — reproduce all in Section 3:
   alcohol_smell_noted:  {pass1_result.get('alcohol_smell_noted') or 'Not documented'}
   alcohol_test_done:    {pass1_result.get('alcohol_test_done') or 'Not documented'}
   alcohol_test_result:  {pass1_result.get('alcohol_test_result') or 'Not documented'}
   intoxication_mentioned: {pass1_result.get('intoxication_mentioned') or 'Not documented'}
   alcohol_history:      {pass1_result.get('alcohol_history') or 'Not documented'}

10. FINAL DIAGNOSIS LOCK — reproduce EXACTLY, all lines:
    {json.dumps(pass1_result.get('final_diagnosis'), indent=2)}

DISCREPANCIES (copy verbatim exactly; do not paraphrase):
<<<DISC_START>>>
{disc_block}
<<<DISC_END>>>

BILL LINE ITEMS:
{json.dumps(pass1_result.get('bill_breakdown_items', []), indent=2)}

ALL TREATMENTS:
{json.dumps(pass1_result.get('all_treatments', []), indent=2)}

INVESTIGATIONS DONE:
{json.dumps(pass1_result.get('investigations_done', []), indent=2)}

DRUG SAFETY RULE:
{drug_rule}

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
                "Reconstructed intoxication conclusion from %d sections",
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

    # Genuine override
    if preprocessed.get("_is_genuine") and conclusion:
        lower = conclusion.lower()
        if "claim seems to be suspected" in lower or "not recommended for settlement" in lower:
            conclusion = re.sub(
                r"(?i)(hence based on the above discrepancies.*?suspected\.?|"
                r"not recommended for settlement\.?)",
                "As per the verification, admission is verified and claim found to be Genuine.",
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
    logger.info("intoxication_addiction conclusion: %d chars", len(conclusion))
    return conclusion