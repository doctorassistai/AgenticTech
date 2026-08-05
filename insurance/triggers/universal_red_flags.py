"""Trigger 14: Final Universal Red Flags Matrix – Master Cross-Trigger Fraud Detection"""
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

You are a master insurance fraud investigator conducting a comprehensive cross-trigger
red flags audit across all risk dimensions of a claim.
Write like a senior investigation closure report and master fraud assessment sheet.
Use language like:
"A comprehensive review of all available documents and field findings reveals the following
red flags across the stated dimensions",
"The following items are classified as CRITICAL and require immediate repudiation review",
"Based on the universal red flags matrix, the overall claim risk is assessed as follows."
This is the final consolidated opinion — it must be thorough, precise, and actionable.
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

RULE 1 — USE ALL EXTRACTED DATA: Every non-null field in FORENSIC AUDIT FACTS must appear.

RULE 2 — VITALS:
  vitals_on_admission must appear verbatim with ALL markers. Never write "stable".
  DISCHARGE VITALS: Use vitals_at_discharge EXACTLY as extracted.

RULE 3 — ALL MEDICATIONS:
  List every drug by name from the medicine chart. Never cherry-pick or invent.

RULE 4 — MATRIX COMPLETENESS:
  Every red flag dimension in Section 3 must be assessed — mark CLEAR, FLAG, or RED FLAG.
  RED FLAG items must carry a one-line factual reason citing the specific document fact.

RULE 5 — RISK COUNTS:
  Section 4 risk counts must be actual numbers. Never leave blanks.

RULE 6 — DISCREPANCIES VERBATIM BLOCK:
  If discrepancies_verbatim is non-null: reproduce the ENTIRE block EXACTLY as written
  in Section 2. Then append auto-detected flags below it.

RULE 7 — AUTO-DETECT DISCREPANCIES (add if not already in verbatim block):
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

RULE 8 — FINAL VERDICT PHRASE:
  The closing verdict line must use exactly one of the four fixed phrases:
  GENUINE / PARTIALLY SUPPORTED / SUSPECTED / REPUDIATION RECOMMENDED.

RULE 9 — NO FILLER: Every sentence introduces a new fact. No restating.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REPORT STRUCTURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SECTION 1 — MASTER CASE SUMMARY
One dense paragraph covering ALL key facts:
- Patient: name, age, gender, address
- Policy: type, number, inception date, sum insured, member category, policy age at claim
- Hospital: name, address, registration number, validity, bed strength,
  empanelment status, watchlist status
- Admission: date, time; Discharge: date, time; IP number; Length of stay
- ALL chief complaints verbatim
- Provisional and final diagnosis (all lines verbatim)
- Vitals on admission verbatim (ALL markers — never write "stable")
- All treatments administered (every drug by name)
- Bill amount gross, discount, breakdown summary, mode of payment, claimed amount
- Previous claims: count, frequency, pattern
- Field officer name; hospital opinion verbatim; member opinion verbatim
- Geotag collected: YES/NO; Lab vicinity verified: YES/NO

SECTION 2 — DISCREPANCIES
Header: "DISCREPANCIES"
If discrepancies_verbatim is non-null:
  → "Kindly note —" followed by ENTIRE verbatim block exactly as written.
Append auto-detected flags (Rule 7) not already in verbatim.
If no discrepancies_verbatim AND no auto-flags: "No major discrepancies noted."

SECTION 3 — UNIVERSAL RED FLAGS MATRIX
For every item below, mark:
  ✓ CLEAR       — verified, no concern
  ⚠ FLAG        — partial concern, clarification needed
  ✗ RED FLAG    — confirmed concern, state factual reason in one line

─── A. IDENTITY AND ELIGIBILITY ───────────────────────────────────────────
  □ Patient name matches policy / ID proof
  □ Date of birth consistent across all documents
  □ Gender consistent across records
  □ Claimant is eligible member under the policy
  □ Dependent relationship proved by valid document
  □ Employee ID / corporate eligibility verified (if applicable)
  □ No duplicate identity linkage across claim files
  □ Nominee / legal heir correctly identified (death claims)

─── B. HOSPITAL CREDENTIALS ────────────────────────────────────────────────
  □ Hospital registered with state authority; registration valid
  □ Bed strength meets minimum criteria for claim type
  □ Hospital empanelled with insurer / TPA
  □ Hospital not on fraud watchlist
  □ Treating doctor registered; specialty matches treatment
  □ In-house lab present and registered
  □ ICU physically verified and functional (if ICU billed)
  □ OT physically verified and functional (if OT billed)
  □ Pharmacy register collected and maintained

─── C. ADMISSION AND HOSPITALIZATION ───────────────────────────────────────
  □ Admission recorded in IP register with correct dates
  □ Bed allotment documented
  □ Nursing admission note present at stated admission time
  □ Admission medically justified given documented severity
  □ MLC registered where legally required
  □ FIR filed where required
  □ Geotag / hospital photo collected
  □ Claimant residence verified by field visit

─── D. CLINICAL CONSISTENCY ────────────────────────────────────────────────
  □ Diagnosis consistent with presenting complaints and history
  □ Treatment administered is appropriate for the diagnosis
  □ Vitals on admission consistent with stated severity
  □ Lab investigation results support the diagnosis
  □ Imaging / radiology present where clinically expected
  □ ICU admission clinically justified by deterioration notes
  □ Surgical indication documented (if OT billed)
  □ Discharge condition consistent with treatment outcome

─── E. DOCUMENTATION INTEGRITY ─────────────────────────────────────────────
  □ Nursing notes present and dated for all admission days
  □ Vitals chart dated — not single-stretch undated entries
  □ Medication chart has IP number, dates, drug administration times filled
  □ Investigation result chart has values entered (not blank)
  □ Discharge summary narrative consistent with daily progress notes
  □ No discrepancies noted across documents (discrepancies_verbatim)
  □ Signatures consistent across case sheet
  □ No evidence of template reuse or copy-paste across records

─── F. BILLING AND PHARMACY ────────────────────────────────────────────────
  □ Bill amount consistent with room tariff × LOS
  □ ICU charges supported by ICU register entries
  □ OT charges supported by OT register and anesthesia notes
  □ Pharmacy charges correlated with medication chart and treatment records
  □ Lab charges correlated with investigation result chart
  □ No duplicate drug or procedure charges
  □ Room category billed matches actual room type
  □ Discount stated separately from gross bill amount

─── G. POLICY AND COVERAGE ─────────────────────────────────────────────────
  □ Policy active on date of admission
  □ Waiting period, if applicable, has been served
  □ Pre-existing disease — declared at proposal (PED check)
  □ No PED concealment evidence in medical records
  □ Applicable exclusions reviewed and addressed
  □ No concurrent policy misuse or duplicate benefit claimed
  □ Policy age reasonable relative to claim (not short-duration abuse)

─── H. CHRONOLOGY AND DATE LOGIC ───────────────────────────────────────────
  □ Lab dates fall within admission period
  □ Treatment dates align with diagnosis date
  □ OT / ICU dates fall within admission period
  □ Pharmacy dispensing dates within admission period
  □ Death / discharge date consistent across all documents
  □ No reports generated after death or after discharge

─── I. ACCIDENT, INTOXICATION, AND LEGAL (IF APPLICABLE) ──────────────────
  □ Accident narration consistent across hospital, FIR, and patient statement
  □ MLC / FIR timing consistent with claimed accident time
  □ Postmortem findings consistent with claimed cause of death (death claims)
  □ Toxicology obtained where poisoning, overdose, or intoxication suspected
  □ Alcohol / intoxication history not suppressed to avoid exclusion
  □ Legal claimant (death claims) — valid heir, correct relationship, ID verified

─── J. REPEAT FRAUD AND PATTERN ────────────────────────────────────────────
  □ No unusual repeat claim frequency on this policy
  □ Same hospital not linked to prior suspicious claims on this member
  □ Same diagnosis not repeated across multiple short admissions
  □ No shared mobile / address / bank linkage with other suspect claims
  □ No document template reuse across prior claim files
  □ Policy age and claim timing not consistent with pre-planned fraud
  □ Hospital not linked to organized fraud cluster

SECTION 4 — RED FLAG SUMMARY
List every ⚠ FLAG and ✗ RED FLAG item from Section 3.
For each, state:
- Dimension (e.g., F. Billing / C. Admission)
- Item description
- Factual basis (one line, citing the specific document fact)
- Classification: [CRITICAL] [HIGH] [MEDIUM] [LOW]

SECTION 5 — OVERALL RISK SCORING
State exact counts:
  CRITICAL red flags: __
  HIGH risk flags:    __
  MEDIUM flags:       __
  LOW flags:          __
  CLEAR items:        __

Overall risk level (select one):
  CRITICAL — immediate repudiation review, refer to fraud registry
  HIGH     — claim should not be settled without further field investigation
  MEDIUM   — settlement may proceed after specified clarifications
  LOW      — claim appears genuine, minor gaps are administrative

SECTION 6 — MASTER CONCLUSION AND FINAL VERDICT
One consolidated paragraph covering all dimensions.
Field officer name and hospital opinion verbatim (if non-null).
Field officer member opinion verbatim (if non-null).
Net recommendation: settle / further inquiry / repudiation review.

Close with verbatim final verdict line from document if final_verdict_verbatim is non-null.
Then close with EXACTLY ONE of:
"Hence, based on the universal red flags matrix, the claim is assessed as: GENUINE."
"Hence, based on the universal red flags matrix, the claim is assessed as: PARTIALLY SUPPORTED."
"Hence, based on the universal red flags matrix, the claim is assessed as: SUSPECTED."
"Hence, based on the universal red flags matrix, the claim is assessed as: REPUDIATION RECOMMENDED."
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
            "Do not skip any drug. Do not abbreviate."
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
□ All {len(preprocessed['complaints_list'])} chief complaints written verbatim in Section 1
□ Vitals string appears exactly — no "stable"
□ Bill block appears with all three amounts
□ Discrepancy verbatim block reproduced ENTIRELY if discrepancies_verbatim is non-null
□ Auto-discrepancies appended if not already present
□ Section 6 verdict = {preprocessed['verdict_override']}
□ If final_verdict_verbatim exists, final line must match it exactly
□ Final diagnosis reproduced VERBATIM including ALL lines
□ ALL Section 3 matrix items assessed — every single checkbox
□ ✓ CLEAR / ⚠ FLAG / ✗ RED FLAG appears for each item; RED FLAG items state factual basis
□ Section 3E uses vitals_chart_dates_present, nurses_notes_dates_present,
  medication_chart_ip_number_present, investigation_result_chart_status exactly
□ hospital_watchlist_status and hospital_empanelment_status inform Section 3B
□ previous_claims, claim_frequency, short_duration_policy inform Section 3G and 3J
□ ped_declared_at_proposal, ped_mentioned_in_records inform Section 3G
□ field_officer_name, field_officer_hospital_opinion, field_officer_member_opinion
  appear in Section 6 if non-null
□ Section 5 risk counts are actual numbers — never leave blanks
□ Closing verdict line uses exactly one of the four fixed phrases

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

6. VITALS — use this exact string (never write "stable"):
   {preprocessed['vitals_formatted'] or pass1_result.get('vitals_on_admission') or 'Not documented'}

7. PHYSICAL VISIT — {pass1_result.get('physical_visit_confirmed') or 'null'}

8. VERDICT ENFORCEMENT:
   If FULL DOCUMENT TEXT contains "claim seems to be suspected" or a Kindly note
   section with multiple discrepancy points → verdict MUST be SUSPECTED.

9. PATIENT & MASTER AUDIT CONSTANTS:
   IP / UHID number:          {pass1_result.get('ip_number') or pass1_result.get('uhid_number') or 'Not documented'}
   Guardian name:             {pass1_result.get('guardian_name') or 'Not documented'}
   Policy inception date:     {pass1_result.get('policy_inception_date') or 'Not documented'}
   Policy start date:         {pass1_result.get('policy_start_date') or 'Not documented'}
   Policy end date:           {pass1_result.get('policy_end_date') or 'Not documented'}
   Sum insured:               {pass1_result.get('sum_insured') or 'Not documented'}
   Claimed amount:            {pass1_result.get('claimed_amount') or 'Not documented'}
   Short duration policy:     {pass1_result.get('short_duration_policy') or 'Not documented'}
   Previous claims:           {pass1_result.get('previous_claims') or 'Not documented'}
   Claim frequency:           {pass1_result.get('claim_frequency') or 'Not documented'}
   Hospital watchlist status: {pass1_result.get('hospital_watchlist_status') or 'Not documented'}
   Hospital empanelment:      {pass1_result.get('hospital_empanelment_status') or 'Not documented'}
   PED declared at proposal:  {pass1_result.get('ped_declared_at_proposal') or 'Not documented'}
   PED mentioned in records:  {json.dumps(pass1_result.get('ped_mentioned_in_records') or [])}
   MLC registered:            {pass1_result.get('mlc_registered') or 'Not documented'}
   MLC number:                {pass1_result.get('mlc_number') or 'Not documented'}
   FIR number:                {pass1_result.get('fir_number') or 'Not documented'}
   Alcohol smell noted:       {pass1_result.get('alcohol_smell_noted') or 'Not documented'}
   Intoxication mentioned:    {pass1_result.get('intoxication_mentioned') or 'Not documented'}
   Lab vicinity check:        {pass1_result.get('lab_vicinity_to_hospital') or 'Not documented'}
   Employer:                  {pass1_result.get('employer_name') or 'Not documented'}

   Chart quality — use in Section 3E:
   vitals_chart_dates_present:         {pass1_result.get('vitals_chart_dates_present') or 'Not documented'}
   vitals_chart_single_stretch:        {pass1_result.get('vitals_chart_single_stretch') or 'Not documented'}
   nurses_notes_dates_present:         {pass1_result.get('nurses_notes_dates_present') or 'Not documented'}
   nurses_notes_single_stretch:        {pass1_result.get('nurses_notes_single_stretch') or 'Not documented'}
   medication_chart_ip_number_present: {pass1_result.get('medication_chart_ip_number_present') or 'Not documented'}
   investigation_result_chart_status:  {pass1_result.get('investigation_result_chart_status') or 'Not documented'}

   Discharge vitals — COPY EXACTLY:
   {pass1_result.get('vitals_at_discharge') or 'Not documented'}

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
                "Reconstructed universal_red_flags conclusion from %d sections",
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
    logger.info("universal_red_flags conclusion: %d chars", len(conclusion))
    return conclusion