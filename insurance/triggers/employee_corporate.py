"""Trigger 11: Employee / Corporate / Group Policy Verification"""
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

You are a senior insurance investigator specializing in corporate and group policy claim
verification, employment authenticity auditing, and dependent eligibility checks, with
20+ years of experience in Indian health insurance claim audits.
Write like a formal corporate investigation report. Use language like:
"Our investigator visited the employer's registered office and verified employment records",
"HR confirmation was obtained from the stated employer",
"Employee ID was cross-checked against payroll records",
"Dependent enrollment was verified against the corporate group policy member list."
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
"""

_SCHEMA = '''
⚠ ISOLATION RULE: All facts must come ONLY from FORENSIC AUDIT FACTS and FULL DOCUMENT TEXT.
Do NOT import drug names, amounts, or clinical details from memory or prior context.

Return JSON: { "conclusion": null }
Multi-section corporate and group policy investigation report. Third person, past tense.
Use \\n\\n between sections.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Use ONLY facts from FORENSIC AUDIT FACTS and FULL DOCUMENT TEXT. Never invent.
- Employer name, employee ID, policy type must appear in Section 1.
- Employment verification status must be explicitly stated — confirmed, denied, or unverifiable.
- Dependent name, relationship, and enrollment status must appear for dependent claims.
- All identity documents submitted must be listed with match/mismatch status.
- Policy type (corporate/SME/group) and member category must appear.
- Any prior claims under the same policy must be noted if present in records.
- If employment_verification_done is non-null, it must appear verbatim.
- Vitals (if patient was hospitalized) must appear verbatim. Never write "stable".
- ALL chief complaints verbatim — use ONLY the pre-extracted complaint list.
- You MUST reproduce discrepancies_verbatim EXACTLY in Section 2. Do not paraphrase or reorder.

RULE — REGISTERS — WRITE ONLY WHAT IS CONFIRMED:
  If flag = YES → state "verified and attached"
  If flag = NO  → state "[MISSING] — not collected"
  If flag = null → omit entirely
  NEVER write a blanket register statement unless ALL relevant flags are YES.

RULE — TREATING DOCTOR — STANDALONE LINE:
After registers, always state treating doctor as a standalone sentence:
"Treating Doctor — Dr. [name] ([qualification], Reg No. [reg_number])."

SECTION 1 — EMPLOYMENT, POLICY, AND CLINICAL FACTS
One dense paragraph covering:
- Employer: name, address, industry, type (corporate / SME / group)
- Employee: name, employee ID, department, designation, joining date
- Policy: type, policy number, group / corporate / SME, member category,
  sum insured, policy period start and end
- Claimant: name, age, gender, relationship to employee (self / spouse / child / parent)
- Dependent declaration: enrolled YES/NO, enrollment date, family declaration record
- Identity documents: Aadhaar / ID proof submitted — name, DOB, match status
- Marriage certificate (for spouse): collected / not collected
- Birth certificate (for child): collected / not collected
- Patient: IP number, admission date, discharge date
- Chief complaints verbatim (ALL of them, from the pre-extracted complaint list only)
- Past history verbatim
- Vitals on admission (ALL markers — never "stable")
- Diagnosis verbatim (provisional and final, all lines)
- Treating hospital: name, address, registration status
- Bill amount (gross), claimed amount
- Registers verified (per flags below)
- Treating doctor (standalone)
- Employment verification: done YES/NO, verified by whom, outcome verbatim
- Prior claims under same policy: state if present

SECTION 2 — DISCREPANCIES
Header: "DISCREPANCIES"
If discrepancies_verbatim is non-null:
  → "Kindly note —" followed by ENTIRE verbatim block exactly as written.
Append auto-detected flags not already in verbatim.
If none at all: "No major discrepancies noted."

SECTION 3 — EMPLOYMENT VERIFICATION FINDINGS
Verify and state clearly for each:
□ Was employment genuinely confirmed by the employer / HR?
□ Was the employee active on the date of admission?
□ Was the employee's joining date before the policy inception date?
□ Was there any resignation, termination, or suspension before the claim?
□ Is the employee ID valid and traceable in company records?
□ Does the employee's department, designation, and salary tier match enrollment records?
□ Was payroll active during the admission period?
□ Was any PF / ESI trail available to corroborate employment?
□ Was the company office physically verified — is it genuine and operational?
□ Were any co-workers or supervisors interviewed?

Classify each:
  [VERIFIED] — confirmed by employer / HR / documentary evidence
  [DENIED] — employer denies employment or eligibility
  [INACTIVE] — employment confirmed but not active at claim time
  [NOT VERIFIED] — verification not attempted or employer unresponsive
  [SUSPICIOUS] — raises fraud concern

SECTION 4 — MEMBER ELIGIBILITY AND DEPENDENT VERIFICATION
For each claimant, verify:

A. Self (Employee):
   - Is employee in the active member list on the admission date?
   - Is the sum insured level and member category correct?

B. Dependent (Spouse / Child / Parent):
   - Is dependent named in the corporate enrollment / group policy member list?
   - Is the relationship proved by a valid document?
   - Does the dependent's name and DOB match the document submitted?
   - Was the dependent enrolled before the admission date?
   - Is there any mismatch in name, age, or relationship?

C. Policy Continuity:
   - Was policy in force on the admission date?
   - Was there any break in group coverage?
   - Was there a corporate-to-retail portability claim? If so, is continuity valid?
   - Are any waiting period or PED waiver conditions applicable?

D. Duplicate / Misuse Check:
   - Is the same hospitalization being claimed under multiple policies?
   - Is there evidence of cashless misuse or duplicate reimbursement?
   - Were any multiple short admissions filed under the same group policy in the same year?

SECTION 5 — COMPANY GENUINITY CHECK (FOR SME / SMALL GROUP POLICIES)
If policy is SME or small group:
□ Is the company registered and operational?
□ Does the company have the claimed number of employees?
□ Were employees genuinely working and not artificially enrolled?
□ Is there evidence of artificial bulk enrollment shortly before claim?
□ Was the company office physically verified?

Classify: [GENUINE] [DOUBTFUL] [FAKE] [NOT VERIFIED]

SECTION 6 — AUDIT EVALUATION
A. Employment Genuinity:
   Was the claimant genuinely employed and active at the time of admission?
B. Member Eligibility:
   Was the claimant correctly enrolled and eligible under the group policy terms?
C. Documentation Integrity:
   Are identity, relationship, and enrollment documents consistent and verifiable?
D. Fraud Risk Assessment:
   State specific concerns only. Conclude with ONE of:
   "Employment and eligibility verification confirms a genuine corporate claim — no fraud indicators."
   "Employment or eligibility gaps identified — further HR confirmation and document verification recommended."
   "Employment and eligibility verification reveals serious inconsistencies — organized group policy fraud cannot be ruled out."

SECTION 7 — CONCLUSION
Summary → Employment verification outcome → Member eligibility outcome →
Policy validity outcome → Recommendation → Final verdict line.
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
□ employer_name, employee_id appear in Section 1 if non-null
□ employment_verification_done appears verbatim in Section 1 and Section 3
□ policy_type, policy_start_date, policy_end_date appear in Section 1 if non-null
□ All {len(preprocessed['complaints_list'])} chief complaints written verbatim
□ Vitals string appears exactly — no "stable"
□ Diagnosis (final_diagnosis, provisional_diagnosis) reproduced verbatim, all lines
□ Discrepancy verbatim block reproduced ENTIRELY if discrepancies_verbatim is non-null
□ Auto-discrepancies appended if not already present
□ Register prose matches flags exactly
□ Final verdict = {preprocessed['verdict_override']}
□ If final_verdict_verbatim exists, final line must match it exactly
□ Treating doctor standalone sentence appears after register summary
□ All identity documents — type, name match, DOB match — appear in Section 4B
□ cashless_availed appears in Section 4D if non-null
□ previous_claims and claim_frequency appear in Section 4D if non-null
□ short_duration_policy appears in Section 4C if non-null
□ hospital_empanelment_status appears in Section 1 if non-null

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

4. REGISTER STATUS:
   IP register:   {preprocessed['register_flags']['ip']}
   OT register:   {preprocessed['register_flags']['ot']}
   Lab register:  {preprocessed['register_flags']['lab']}
   Pharmacy:      {preprocessed['register_flags']['pharmacy']}
   Reg cert:      {preprocessed['register_flags']['reg_cert']}
   Tariff:        {pass1_result.get('tariff_attached') or 'null'}

5. VITALS — use this exact string (never write "stable"):
   {preprocessed['vitals_formatted'] or pass1_result.get('vitals_on_admission') or 'Not documented'}

6. VERDICT ENFORCEMENT:
   If FULL DOCUMENT TEXT contains "claim seems to be suspected" or a Kindly note
   section with multiple discrepancy points → verdict MUST be SUSPECTED.

7. EMPLOYMENT / CORPORATE CONSTANTS:
   Employer name:              {pass1_result.get('employer_name') or 'Not documented'}
   Employee ID:                {pass1_result.get('employee_id') or 'Not documented'}
   Department / designation:   {pass1_result.get('department') or 'Not documented'} / {pass1_result.get('designation') or 'Not documented'}
   Joining date:                {pass1_result.get('joining_date') or 'Not documented'}
   Policy type:                 {pass1_result.get('policy_type') or 'Not documented'}
   Policy number:                {pass1_result.get('policy_number') or 'Not documented'}
   Policy period:                {pass1_result.get('policy_start_date') or 'Not documented'} to {pass1_result.get('policy_end_date') or 'Not documented'}
   Member category:              {pass1_result.get('member_category') or 'Not documented'}
   Sum insured:                  {pass1_result.get('sum_insured') or 'Not documented'}
   Claimant relationship:        {pass1_result.get('relationship_to_employee') or 'Not documented'}
   Dependent enrolled:           {pass1_result.get('dependent_enrolled') or 'Not documented'}
   Dependent enrollment date:    {pass1_result.get('dependent_enrollment_date') or 'Not documented'}
   Employment verification done: {pass1_result.get('employment_verification_done') or 'Not documented'}
   Hospital empanelment status:  {pass1_result.get('hospital_empanelment_status') or 'Not documented'}
   Cashless availed:             {pass1_result.get('cashless_availed') or 'Not documented'}
   Previous claims:              {pass1_result.get('previous_claims') or 'Not documented'}
   Claim frequency:               {pass1_result.get('claim_frequency') or 'Not documented'}
   Short duration policy:         {pass1_result.get('short_duration_policy') or 'Not documented'}

8. FINAL DIAGNOSIS LOCK — reproduce EXACTLY, all lines:
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
                "Reconstructed corporate_group conclusion from %d sections",
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
                "As per the verification, the corporate/group policy claim is found to be Genuine.",
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
    logger.info("corporate_group conclusion: %d chars", len(conclusion))
    return conclusion