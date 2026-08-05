"""
Trigger: Accident / Incident Verification
"""
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

You are a senior insurance investigator specializing in accident and injury claims.
Write a structured accident verification report in formal investigator style,
in the style of a certified field investigation report.
Use language like "Our investigator visited the hospital", "ICP was verified and copy collected",
"The following registers were verified". Write as a physical field investigation report.
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
  then the final verdict MUST be SUSPECTED.
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

The conclusion must be a multi-section accident investigation report.
Use \\n\\n between sections. Third person, past tense, formal tone.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Use ONLY facts from FORENSIC AUDIT FACTS and FULL DOCUMENT TEXT. Never invent.
- Include exact vitals verbatim. Never write "stable".
- Include ALL drugs administered by name.
- MLC/FIR numbers must appear if present.
- Bill amount must be gross amount from document, not post-discount.
- State what was physically verified: ICP, IP register, OT register, lab register,
  registration certificate, tariff, pharmacy register — using BINDING INSTRUCTION 5 flags only.
- Write like a field investigator — "Our investigator visited...", "ICP was collected..."
- Include ALL chief complaints verbatim — do not summarize or drop any.
- Include OPD history before admission if present.
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

SECTION 1 — ACCIDENT PART FINDINGS
One dense paragraph covering:
- Investigating agency and mode ("Our investigator visited the hospital and verified the ICP")
- Patient: name, age, gender
- Hospital: name, address, bed strength, reg number, validity, reg cert page ref
- Admission: date, time, IP/UHID, admitting doctor, qualification, reg number
- Accident: date, time, exact location (accident_place)
- Accident narration verbatim (accident_narration)
- Vehicle involved, helmet/seatbelt status
- Person who brought patient to hospital (brought_by)
- First aid hospital and first aid details
- Chief complaints verbatim (ALL of them, from the pre-extracted complaint list only)
- Past history (exact phrase)
- Vitals on admission (ALL markers exact — BP, PR, SPO2, Temp, RR, GRBS)
- Provisional diagnosis
- Investigations done
- Final diagnosis (all lines verbatim)
- All treatments administered (every drug)
- MLC number, FIR number, police station
- Whether police was informed
- Witness name and statement
- Discharge date, time, vitals at discharge
- Bill: gross, discount, received, room tariff, all line items, payment mode, page ref
- Registers verified (per flags above): IP, OT, lab, reg cert, tariff, in-house lab, pharmacy
- Treating doctor (standalone)
- Data collected from: name, designation, phone
- Field officer name and opinion

SECTION 2 — DISCREPANCIES
Header: "DISCREPANCIES"
If discrepancies_verbatim is non-null:
  → "Kindly note —" followed by ENTIRE verbatim block exactly as written.
Append auto-detected flags not already in verbatim.
If none at all: "No major discrepancies noted."

SECTION 3 — ACCIDENT VERIFICATION FINDINGS
Verify and state clearly for each:
□ Was the accident date and time consistent across ICP, MLC, and admission records?
□ Was MLC registered in this hospital?
□ Was FIR filed? If yes — FIR number and police station.
□ Was helmet/seatbelt worn? (for vehicle accidents)
□ Who brought the patient and from where?
□ Was first aid given elsewhere before admission?
□ Are witness details available and consistent?
□ Is the injury pattern consistent with alleged accident mechanism?
□ Was alcohol/intoxication suspected or tested?
□ Is the accident narration consistent across all documents?

Classify each:
  [INCONSISTENT] — conflicting accounts
  [MISSING] — record absent
  [SUSPICIOUS] — only with specific named evidence
  [VERIFIED] — confirmed consistent

SECTION 4 — MLC / LEGAL STATUS
- MLC registered: YES/NO and number
- FIR filed: YES/NO and number
- Police station name
- Whether MLC copy collected
- If RTA — driving licence / RC book status
- Any medico-legal remarks in records

SECTION 5 — AUDIT EVALUATION
A. Accident Genuinity: Is the alleged mechanism consistent with injuries?
B. Documentation: MLC, FIR, witness records completeness.
C. Billing: ICU/surgery charges vs clinical severity.
D. Suspicion Assessment: Specific concerns only. End with ONE of:
   "Accident appears genuine and well-documented."
   "Accident narration requires further field verification."
   "Accident claim has significant inconsistencies warranting investigation."

SECTION 6 — CONCLUSION
Summary → Verification outcome → Field officer opinion (only if name and opinion non-null) →
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
□ MLC number, FIR number, police station included if non-null

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

9. ACCIDENT / LEGAL CONSTANTS:
   Accident date/time:  {pass1_result.get('accident_date') or 'Not documented'} / {pass1_result.get('accident_time') or 'Not documented'}
   Accident place:      {pass1_result.get('accident_place') or 'Not documented'}
   Accident narration:  {pass1_result.get('accident_narration') or 'Not documented'}
   Brought by:           {pass1_result.get('brought_by') or 'Not documented'}
   MLC number:           {pass1_result.get('mlc_number') or 'Not documented'}
   MLC registered:       {pass1_result.get('mlc_registered') or 'Not documented'}
   FIR number:            {pass1_result.get('fir_number') or 'Not documented'}
   Police station:        {pass1_result.get('police_station') or 'Not documented'}
   Witness name:          {pass1_result.get('witness_name') or 'Not documented'}
   Witness statement:     {pass1_result.get('witness_statement') or 'Not documented'}
   Helmet/seatbelt:       {pass1_result.get('helmet_seatbelt_status') or 'Not documented'}

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
                "Reconstructed accident_incident conclusion from %d sections",
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
                "As per the verification, the accident claim is found to be Genuine.",
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
    logger.info("accident_incident conclusion: %d chars", len(conclusion))
    return conclusion