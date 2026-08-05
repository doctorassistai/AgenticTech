"""Trigger 13: Suspicious Claim Pattern / Repeat Fraud Indicators"""
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

You are a senior insurance fraud analyst specializing in repeat fraud pattern detection,
organized fraud cluster identification, and cross-claim behavioral analysis.
Write like a formal fraud pattern investigation report. Use language like:
"A review of prior claim history reveals the following pattern",
"The current claim shares structural similarities with previously filed claims",
"Cross-referencing mobile number, hospital, and diagnosis reveals the following linkage",
"Document comparison across claim files indicates possible template reuse."
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
  then Section 9 verdict MUST be SUSPECTED.
  Final line must match manual closing phrase if present.
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
  If vitals_at_discharge is null: omit the discharge vitals sentence.

RULE 3 — ALL MEDICATIONS:
  List every drug by name from the medicine chart. Never cherry-pick or invent.

RULE 4 — PRIOR CLAIMS — MANDATORY:
  ALL prior claims must be listed individually — never summarize as "multiple claims".
  For each: claim number/date, hospital, diagnosis, length of stay, bill amount, benefit type.

RULE 5 — DISCREPANCY CLASSIFICATION TAGS (use exactly):
  [MISSING]          — document, record, or register entirely absent
  [INCOMPLETE]       — present but partially filled or lacking required fields
  [CONTRADICTORY]    — finding conflicts with another record
  [SUSPICIOUS]       — raises fraud concern
  [BILLING MISMATCH] — billed item not supported by clinical record
  [TIMELINE MISMATCH]— dates or sequence is inconsistent
  [SINGLE STRETCH]   — entries appear written in one sitting without date breaks

RULE 6 — DISCREPANCIES VERBATIM BLOCK:
  If discrepancies_verbatim is non-null: reproduce the ENTIRE block EXACTLY as written.
  Then append auto-detected flags below it.

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

RULE 8 — NO FILLER: Every sentence introduces a new fact. No restating.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REPORT STRUCTURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SECTION 1 — CURRENT CLAIM AND CLAIMANT PROFILE
One dense paragraph covering:
- Claimant: name, age, gender, address, mobile number, Aadhaar / ID
- Policy: type, number, inception date, sum insured, member category
- Policy age at claim date: calculate and state
- Hospital: name, full address, registration number, empanelment status, watchlist status
- Treating doctor: name, qualification, registration number
- Admission: date, time; Discharge: date, time; IP number
- ALL chief complaints verbatim
- Provisional and final diagnosis (all lines verbatim)
- Vitals on admission verbatim (ALL markers — never write "stable")
- All treatments administered (every drug by name)
- Bill amount (gross), discount, breakdown summary, mode of payment
- Claimed amount and sum insured
- Previous claims: count, dates, hospitals, diagnoses, amounts — each individually
- Claim frequency: state as count per policy year or per period
- Field officer name, hospital opinion (verbatim), member opinion (verbatim)
- Hospital watchlist status verbatim; hospital empanelment status

SECTION 2 — DISCREPANCIES
Header: "DISCREPANCIES"
If discrepancies_verbatim is non-null:
  → "Kindly note —" followed by ENTIRE verbatim block exactly as written.
Append auto-detected flags (Rule 7) not already in verbatim.
If no discrepancies_verbatim AND no auto-flags: "No major discrepancies noted."

SECTION 3 — REPEAT CLAIM HISTORY ANALYSIS
For each prior claim, state individually:
- Claim number / date; Hospital name; Diagnosis; Length of stay; Bill amount;
  Type of benefit triggered (ICU, hospital cash, surgical package, etc.)

Then analyse across all claims:
□ Is this the first claim or a repeat claim?
□ What is the claim frequency — is it unusually high?
□ Is the same hospital used repeatedly?
□ Is the same diagnosis or diagnostic category repeated?
□ Is the same type of benefit repeatedly triggered?
□ Is there a pattern of short-stay admissions clustering around minimum benefit thresholds?
□ Is the policy unusually new relative to the claim date?
□ Are there multiple concurrent policies covering the same member?
□ Is the same doctor involved across multiple claims?
□ Is the same billing structure repeated?

Classify each finding:
  [FIRST CLAIM] — no prior history
  [REPEAT PATTERN] — same element appears in 2+ claims
  [HIGH FREQUENCY] — claim rate exceeds medically expected norms
  [FRAUD INDICATOR] — pattern strongly suggests organised manipulation

SECTION 4 — SHARED IDENTIFIER AND LINKAGE ANALYSIS
Check and state finding for each:
□ Mobile number; Address; Bank account; Aadhaar / ID; Employee ID;
  Emergency contact; Email address; Dependent identity; Hospital + claimant combination;
  Corporate / SME linkage

State for each: [UNIQUE] [SHARED — detail] [UNVERIFIABLE]

SECTION 5 — DOCUMENT AUTHENTICITY AND TEMPLATE FRAUD CHECK
□ Discharge summary wording; Doctor's notes; Lab reports; Signatures;
  Bill structure; Vitals recordings; Nurses notes; Medication chart

Classify each:
  [AUTHENTIC] [TEMPLATE SUSPECTED] [FABRICATED] [UNVERIFIABLE]

SECTION 6 — BILLING PATTERN REPETITION ANALYSIS
Cross-reference current bill against prior claims:
□ Room category and tariff; ICU days; Drug list; Lab test list;
  OT / surgical package; Total bill amount; Discount structure

For any matched pattern state: same amount / similar amount / exact match / different

SECTION 7 — HOSPITAL AND FRAUD CLUSTER ANALYSIS
□ Hospital linked to prior fraud alerts or watchlist?
□ Same hospital across multiple claimants with same investigator?
□ Treating doctor linked to suspicious claims from other patients?
□ Billing structure suggests standard fraud template?
□ Field-verified facts about hospital inconsistent with claim?

SECTION 8 — BEHAVIORAL FRAUD INDICATORS
Note only if documented in field officer reports or investigation notes:
□ Claimant story changed; Records produced only after delay; Claimant uncooperative;
  Over-coached responses; Contradictions between claimant statement and local inquiry

State: [NOTED — source] or [NOT DOCUMENTED]
Note: Behavioral indicators alone are never sufficient to establish fraud.

SECTION 9 — CONCLUSION
Follow verdict_override for final determination.
Summary → Prior claim pattern outcome → Shared identifier outcome →
Document authenticity outcome → Hospital / cluster outcome → Recommendation.
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
□ Section 9 verdict = {preprocessed['verdict_override']}
□ If final_verdict_verbatim exists, final line must match it exactly
□ Final diagnosis reproduced VERBATIM including ALL lines
□ previous_claims and claim_frequency appear in Section 1 and Section 3 verbatim
□ Each prior claim listed individually — not summarized
□ hospital_watchlist_status and hospital_empanelment_status appear in Section 1
□ field_officer_name, field_officer_hospital_opinion, field_officer_member_opinion
  appear in Section 1 if non-null
□ vitals_chart_dates_present, nurses_notes_dates_present, medication_chart_ip_number_present
  appear in Section 5

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

9. PATIENT & FRAUD CONSTANTS:
   IP / UHID number:          {pass1_result.get('ip_number') or pass1_result.get('uhid_number') or 'Not documented'}
   Policy inception date:     {pass1_result.get('policy_inception_date') or 'Not documented'}
   Policy start date:         {pass1_result.get('policy_start_date') or 'Not documented'}
   Policy end date:           {pass1_result.get('policy_end_date') or 'Not documented'}
   Sum insured:               {pass1_result.get('sum_insured') or 'Not documented'}
   Claimed amount:            {pass1_result.get('claimed_amount') or 'Not documented'}
   Previous claims:           {pass1_result.get('previous_claims') or 'Not documented'}
   Claim frequency:           {pass1_result.get('claim_frequency') or 'Not documented'}
   Short duration policy:     {pass1_result.get('short_duration_policy') or 'Not documented'}
   Hospital watchlist status: {pass1_result.get('hospital_watchlist_status') or 'Not documented'}
   Hospital empanelment:      {pass1_result.get('hospital_empanelment_status') or 'Not documented'}
   Employer:                  {pass1_result.get('employer_name') or 'Not documented'}
   Employee ID:               {pass1_result.get('employee_id') or 'Not documented'}

   Chart quality — use in Section 5:
   vitals_chart_dates_present:         {pass1_result.get('vitals_chart_dates_present') or 'Not documented'}
   nurses_notes_dates_present:         {pass1_result.get('nurses_notes_dates_present') or 'Not documented'}
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
                "Reconstructed repeat_fraud_pattern conclusion from %d sections",
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
    logger.info("repeat_fraud_pattern conclusion: %d chars", len(conclusion))
    return conclusion