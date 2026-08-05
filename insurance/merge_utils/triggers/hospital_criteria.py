"""Trigger 10: Hospital Criteria / Watchlist Hospital / Unverified Hospital"""
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

You are a senior insurance investigator specializing in hospital credential verification,
infrastructure auditing, watchlist screening, and ghost admission detection, with
20+ years of experience in Indian health insurance claim audits.
Write like a formal hospital inspection and field investigation report. Use language like:
"Our investigator physically visited the hospital premises",
"Registration certificate was verified and copy collected",
"ICU register was verified — no entries found corresponding to the claim period",
"The treating doctor's registration was cross-checked with the state medical council."
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
Multi-section hospital criteria and watchlist investigation report. Third person, past tense.
Use \\n\\n between sections.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Use ONLY facts from FORENSIC AUDIT FACTS and FULL DOCUMENT TEXT. Never invent.
- Include registration number, validity, issuing authority verbatim.
- State bed strength from registration certificate AND field officer form separately.
- ALL billed services must be cross-referenced against verified infrastructure.
- Watchlist status must be stated explicitly — confirmed, absent, or unverifiable.
- NABH/NABL status must be stated if present in records.
- Treating doctor's name, qualification, registration number must appear.
- Vitals on admission must appear verbatim. Never write "stable".
- ALL chief complaints verbatim — use ONLY the pre-extracted complaint list.
- All registers verified must be listed per BINDING INSTRUCTION flags only — never assume.
- Field officer name, hospital opinion, and geotag status must appear if non-null.
- Lab vicinity and in-house lab status must appear in Section 3.
- You MUST reproduce discrepancies_verbatim EXACTLY in Section 2. Do not paraphrase or reorder.

RULE — REGISTERS — WRITE ONLY WHAT IS CONFIRMED:
  If flag = YES → state "verified and attached"
  If flag = NO  → state "[MISSING] — not collected"
  If flag = null → omit entirely
  NEVER write a blanket register statement unless ALL relevant flags are YES.

RULE — TREATING DOCTOR — STANDALONE LINE:
After registers, always state treating doctor as a standalone sentence:
"Treating Doctor — Dr. [name] ([qualification], Reg No. [reg_number])."

SECTION 1 — HOSPITAL AND CLINICAL FACTS
One dense paragraph covering:
- Hospital: name, full address, registration number, registration validity, issuing authority,
  bed strength (from reg cert), bed strength (from field officer form), NABH status
- Registration certificate page reference
- Treating doctor: name, qualification, registration number (standalone sentence)
- Patient: name, age, gender, address, IP number, UHID
- Admission: date, time; Discharge: date, time
- ALL chief complaints verbatim (pre-extracted list only)
- Vitals on admission (ALL markers — never "stable")
- Provisional and final diagnosis (all lines verbatim)
- All treatments administered (every drug by name)
- Bill: gross, discount, room tariff per day, full bill breakdown line by line
- Registers verified (per flags below): IP register, OT register, lab register,
  pharmacy register, tariff chart, registration certificate
- Field officer name
- Field officer hospital opinion (verbatim)
- Geotag photo collected: YES/NO
- In-house lab present: YES/NO
- Lab vicinity to hospital: state finding
- Lab photos collected: YES/NO
- Data collected from: name, designation, phone
- Hospital watchlist status (verbatim from records)
- Hospital empanelment status

SECTION 2 — DISCREPANCIES
Header: "DISCREPANCIES"
If discrepancies_verbatim is non-null:
  → "Kindly note —" followed by ENTIRE verbatim block exactly as written.
Append auto-detected flags not already in verbatim.
If none at all: "No major discrepancies noted."

SECTION 3 — HOSPITAL CRITERIA VERIFICATION
Verify and state clearly for each:
□ Is the hospital physically located at the stated address and operational?
□ Is the hospital registered with the state health/clinical establishment authority?
□ Is the registration number valid and within the stated validity period?
□ Does the hospital have the minimum bed strength required for the claim type?
□ Is the hospital empanelled with the insurer / TPA?
□ Is the hospital on any watchlist or linked to prior fraud alerts?
□ Is the treating doctor registered with the state medical council?
□ Does the treating doctor's specialty match the treatment provided?
□ Is an in-house lab present and registered?
□ Is lab located in the vicinity of the hospital?
□ Is the OT physically present and functional for surgical claims?
□ Were ICU facilities verified — beds, monitors, ventilators, ICU register?
□ Is the pharmacy register maintained and collection confirmed?
□ Are the IP, OT, and lab registers properly maintained with entries?
□ Was a tariff chart verified and is billing consistent with tariff?
□ Was a geotag / photo of hospital premises collected?
□ Are all billed services (ICU, surgery, diagnostics) supported by
  verified infrastructure?

Classify each:
  [VERIFIED] — physically or documentarily confirmed
  [MISSING] — record, register, or facility absent
  [BELOW CRITERIA] — present but insufficient for billed services
  [SUSPICIOUS] — raises fraud concern
  [NOT VERIFIED] — not checked or not traceable

SECTION 4 — INFRASTRUCTURE AND BILLING CAPABILITY ASSESSMENT
For each billed category, state whether the hospital infrastructure supports it:

A. General Ward / Room Charges:
   Bed count verified, room tariff consistent with billing: YES / NO / PARTIAL

B. ICU Charges (if billed):
   ICU beds present, ICU register entries found, monitoring equipment present,
   ICU nursing staff present, critical care doctor notes present: YES / NO / ABSENT

C. OT / Surgical Charges (if billed):
   OT room physically present, OT register entries found, anesthesia support present,
   surgical specialist on roster: YES / NO / ABSENT

D. Lab / Diagnostic Charges:
   In-house lab present, lab register verified, outsourced lab proof available,
   test results correlated with clinical records: YES / NO / PARTIAL

E. Pharmacy Charges:
   Pharmacy register collected, drugs billed match drugs in treatment record,
   pharmacy in vicinity: YES / NO / MISMATCH

F. Doctor / Specialist Charges:
   Consultant notes present in case sheet, specialty match verified: YES / NO

SECTION 5 — GHOST ADMISSION AND PATIENT TRAIL CHECK
Cross-reference the following to assess whether patient was genuinely admitted:
- IP register entry: present / absent / inconsistent
- Bed allotment record: present / absent
- Daily nursing notes: present / absent / appear fabricated
- Vitals chart: dates filled / blank / single stretch
- Medication chart: IP number present / blank; dates filled / blank
- Pharmacy dispensing records correlated: YES / NO
- Lab investigation results correlated: YES / NO / BLANK
- Discharge summary clinical narrative vs treatment records: CONSISTENT / INCONSISTENT

SECTION 6 — AUDIT EVALUATION
A. Hospital Legitimacy:
   Is the hospital genuinely registered, physically operational, and appropriately
   staffed and equipped for the services billed?
B. Documentation Integrity:
   Are all mandatory registers, certificates, and records properly maintained
   and consistent with the claim?
C. Billing vs Infrastructure:
   Are the billed services realistically deliverable at this hospital given its
   verified infrastructure and capability?
D. Fraud Risk Assessment:
   State specific concerns only. Conclude with ONE of:
   "Hospital criteria verification confirms a genuine, capable facility — claim appears credible."
   "Hospital criteria verification reveals infrastructure gaps — further inquiry recommended."
   "Hospital criteria verification raises serious doubts about hospital capability and admission genuinity — organized fraud cannot be ruled out."

SECTION 7 — CONCLUSION
Summary → Infrastructure verification outcome → Register and documentation outcome →
Watchlist / empanelment status → Recommendation → Final verdict line.
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
□ hospital_registration_number, hospital_registration_validity, hospital_bed_strength
  appear verbatim in Section 1
□ hospital_watchlist_status and hospital_empanelment_status appear in Section 1
□ treating_doctor, doctor_qualification, doctor_reg_number appear as standalone sentence
□ All {len(preprocessed['complaints_list'])} chief complaints written verbatim
□ Vitals string appears exactly — no "stable"
□ Discrepancy verbatim block reproduced ENTIRELY if discrepancies_verbatim is non-null
□ Auto-discrepancies appended if not already present
□ Register prose matches flags exactly — never a blanket statement unless ALL are YES
□ Final verdict = {preprocessed['verdict_override']}
□ If final_verdict_verbatim exists, final line must match it exactly
□ Final diagnosis reproduced VERBATIM including ALL lines
□ inhouse_lab_present, lab_vicinity_to_hospital, lab_photos_attached appear in Sections 1 and 3
□ field_officer_name, field_officer_hospital_opinion appear in Section 1 if non-null
□ All billed charges cross-checked against infrastructure in Section 4
□ vitals_chart_dates_present, nurses_notes_dates_present, medication_chart_ip_number_present
  appear in Section 5
□ investigation_vicinity_check appears in Section 3 if non-null

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
   {preprocessed['vitals_formatted'] or pass1_result.get('vitals_on_admission') or 'Not documented'}

7. VERDICT ENFORCEMENT:
   If FULL DOCUMENT TEXT contains "claim seems to be suspected" or a Kindly note
   section with multiple discrepancy points → verdict MUST be SUSPECTED.

8. HOSPITAL CRITERIA / WATCHLIST CONSTANTS:
   Hospital registration number:     {pass1_result.get('hospital_registration_number') or 'Not documented'}
   Hospital registration validity:   {pass1_result.get('hospital_registration_validity') or pass1_result.get('hospital_reg_valid_till') or 'Not documented'}
   Reg issuing authority:             {pass1_result.get('hospital_reg_issuing_authority') or 'Not documented'}
   Bed strength (reg cert):           {pass1_result.get('hospital_bed_strength_reg_cert') or pass1_result.get('hospital_bed_strength') or 'Not documented'}
   Bed strength (field officer form): {pass1_result.get('hospital_bed_strength_field_officer') or 'Not documented'}
   NABH status:                       {pass1_result.get('hospital_nabh') or 'Not documented'}
   Hospital watchlist status:          {pass1_result.get('hospital_watchlist_status') or 'Not documented'}
   Hospital empanelment status:        {pass1_result.get('hospital_empanelment_status') or 'Not documented'}
   In-house lab present:                {pass1_result.get('inhouse_lab_present') or 'Not documented'}
   Lab vicinity to hospital:            {pass1_result.get('lab_vicinity_to_hospital') or 'Not documented'}
   Lab photos attached:                 {pass1_result.get('lab_photos_attached') or 'Not documented'}
   Geotag photo collected:              {pass1_result.get('geotag_photo_collected') or 'Not documented'}
   Investigation vicinity check:         {pass1_result.get('investigation_vicinity_check') or 'Not documented'}
   Field officer name:                   {pass1_result.get('field_officer_name') or 'Not documented'}
   Field officer hospital opinion:       {pass1_result.get('field_officer_hospital_opinion') or 'Not documented'}
   Vitals chart dates present:           {pass1_result.get('vitals_chart_dates_present') or 'Not documented'}
   Nurses notes dates present:           {pass1_result.get('nurses_notes_dates_present') or 'Not documented'}
   Medication chart IP number present:   {pass1_result.get('medication_chart_ip_number_present') or 'Not documented'}

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
                "Reconstructed hospital_criteria conclusion from %d sections",
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
                "As per the verification, hospital criteria findings confirm the claim is found to be Genuine.",
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
    logger.info("hospital_criteria conclusion: %d chars", len(conclusion))
    return conclusion