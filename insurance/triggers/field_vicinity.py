"""Trigger: Field / Vicinity Investigation"""
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

You are an insurance field investigator specializing in vicinity and neighborhood verification,
with 20+ years of experience in Indian health insurance claim audits.
Write like a physical field investigation report. Use language like:
"Our investigator visited the hospital", "ICP was verified and copy collected",
"Field visit was conducted at the claimant's residence",
"The following registers were verified and attached."
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
Multi-section field investigation report. Third person, past tense.
Use \\n\\n between sections.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Use ONLY facts from FORENSIC AUDIT FACTS and FULL DOCUMENT TEXT. Never invent.
- Include exact vitals verbatim. Never write "stable".
- Include ALL drugs administered by name.
- Bill amount = gross from document. State discount separately.
- ALL chief complaints verbatim — use ONLY the pre-extracted complaint list.
- State what was physically verified per BINDING INSTRUCTION register flags only — never assume.
- OPD history before admission must appear if present.
- Field officer name, data collected from, geotag status must appear.
- You MUST reproduce discrepancies_verbatim EXACTLY in Section 2. Do not paraphrase or reorder.

RULE — REGISTERS — WRITE ONLY WHAT IS CONFIRMED:
  If flag = YES → state "verified and attached"
  If flag = NO  → state "[MISSING] — not collected"
  If flag = null → omit entirely
  NEVER write a blanket "IP register, OT register, and lab register are
  verified and attached" unless ALL three flags are YES.

RULE — TREATING DOCTOR — STANDALONE LINE:
After registers, always state treating doctor as a standalone sentence:
"Treating Doctor — Dr. [name] ([qualification], Reg No. [reg_number])."

SECTION 1 — CLINICAL AND FIELD FACTS
One dense paragraph covering:
- "Our investigator visited [hospital name] on [date] and verified the ICP and collected copy of the same."
- Patient: name, age, gender, address
- Hospital: name, full address, bed strength, reg number, validity, reg cert page ref
- Admission: date, time, IP number, treating doctor, qualification, reg number
- ALL chief complaints verbatim (pre-extracted list only)
- OPD history before admission (if any)
- Past history (exact phrase)
- Vitals on admission (ALL markers — BP, PR, SPO2, Temp, RR, GRBS)
- Provisional and final diagnosis (all lines verbatim)
- All treatments (every drug by name)
- Discharge date, time, vitals at discharge
- Discharge medications
- Bill: gross, discount, room tariff, breakdown (all line items), mode of payment
- Registers verified (per flags below): IP, OT, lab, reg cert, tariff, pharmacy
- Treating doctor (standalone)
- Data collected from: name, designation, phone
- Field officer name (field_officer_name)
- Field officer hospital opinion (field_officer_hospital_opinion)
- Field officer member opinion (field_officer_member_opinion)
- Geotag photo collected: YES/NO
- Lab vicinity verified: YES/NO
- Lab photos collected: YES/NO

SECTION 2 — DISCREPANCIES
Header: "DISCREPANCIES"
If discrepancies_verbatim is non-null:
  → "Kindly note —" followed by ENTIRE verbatim block exactly as written.
Append auto-detected flags not already in verbatim.
If none at all: "No major discrepancies noted."

SECTION 3 — VICINITY INVESTIGATION FINDINGS
Verify and state clearly for each:
□ Is the hospital physically located at the stated address?
□ Was the hospital operational at the time of admission?
□ Does the hospital have the stated bed capacity?
□ Is the hospital registration valid and displayed?
□ Is the lab located in the vicinity of the hospital?
□ Was the lab register physically verified and collected?
□ Were pharmacy records verified — is pharmacy in vicinity?
□ Was geotag hospital photo collected?
□ Was the claimant's residence verified by field visit?
□ Were neighbor/local inquiries conducted — outcome?
□ Was the accident/incident spot verified (if applicable)?
□ Is the hospital's ICU/OT physically present and functional?
□ Is the hospital's bed strength consistent with what is registered?

Classify each:
  [VERIFIED] — physically confirmed
  [NOT VERIFIED] — not checked or not traceable
  [INCONSISTENT] — field finding differs from claim
  [MISSING] — record or location absent

SECTION 4 — CLAIMANT AND RESIDENCE VERIFICATION
- Was claimant's address verified by field visit?
- Are neighbors/local contacts aware of the hospitalization?
- Was employment/occupation verified (if relevant)?
- Was accident/death locally known and confirmable?
- Any contradictory statements from local inquiry?
- Was claimant traceable and cooperative?

SECTION 5 — AUDIT EVALUATION
A. Hospital Existence: Is the hospital physically genuine and functional?
B. Lab/Pharmacy Vicinity: Are supporting services genuinely located nearby?
C. Claimant Verification: Is the claimant's address and story locally verifiable?
D. Risk Assessment: Specific concerns only. End with ONE of:
   "Field verification confirms hospital and claimant details — claim appears genuine."
   "Field verification reveals inconsistencies — further inquiry recommended."
   "Field verification raises serious doubts — organized fraud cannot be ruled out."

SECTION 6 — CONCLUSION
Summary → Field verification outcome → Field officer opinion (only if name and opinion non-null) →
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
□ Opening line matches physical_visit_confirmed flag
□ All {len(preprocessed['complaints_list'])} chief complaints written verbatim
□ Vitals string appears exactly — no "stable"
□ Bill block appears with all three amounts
□ Discrepancy verbatim block reproduced ENTIRELY if discrepancies_verbatim is non-null
□ Auto-discrepancies appended if not already present
□ Register prose matches flags exactly
□ Final verdict = {preprocessed['verdict_override']}
□ If final_verdict_verbatim exists, final line must match it exactly
□ Treating doctor standalone sentence appears after register summary
□ Final diagnosis reproduced VERBATIM including ALL lines
□ field_officer_name, field_officer_hospital_opinion, field_officer_member_opinion
  appear in Section 1 if non-null
□ lab_vicinity_to_hospital, lab_photos_attached, inhouse_lab_present appear in Section 3
□ investigation_vicinity_check appears in Section 3 if non-null
□ hospital_bed_strength and hospital_registration_number appear in Section 1

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

9. FIELD / VICINITY CONSTANTS:
   Field officer name:               {pass1_result.get('field_officer_name') or 'Not documented'}
   Field officer hospital opinion:   {pass1_result.get('field_officer_hospital_opinion') or 'Not documented'}
   Field officer member opinion:     {pass1_result.get('field_officer_member_opinion') or 'Not documented'}
   Geotag photo collected:           {pass1_result.get('geotag_photo_collected') or 'Not documented'}
   Lab vicinity to hospital:         {pass1_result.get('lab_vicinity_to_hospital') or 'Not documented'}
   Lab photos attached:              {pass1_result.get('lab_photos_attached') or 'Not documented'}
   In-house lab present:             {pass1_result.get('inhouse_lab_present') or 'Not documented'}
   Investigation vicinity check:     {pass1_result.get('investigation_vicinity_check') or 'Not documented'}
   Hospital bed strength:            {pass1_result.get('hospital_bed_strength') or 'Not documented'}
   Hospital registration number:     {pass1_result.get('hospital_registration_number') or 'Not documented'}
   Data collected from:              {pass1_result.get('data_collected_from_name') or 'Not documented'}, {pass1_result.get('data_collected_from_designation') or ''}, Ph: {pass1_result.get('data_collected_from_phone') or 'Not documented'}

   Discharge vitals — COPY EXACTLY (do not mix with admission vitals):
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
                "Reconstructed field_vicinity conclusion from %d sections",
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
                "As per the verification, field/vicinity findings confirm the claim is found to be Genuine.",
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
    logger.info("field_vicinity conclusion: %d chars", len(conclusion))
    return conclusion