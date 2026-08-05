"""Trigger 9: Legal / Regulatory / Death Verification"""
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

You are a senior insurance investigator specializing in death claim verification,
medico-legal case auditing, and forensic legal trail analysis, with 20+ years of
experience in Indian health/life insurance claim audits.
Write like a formal legal investigation report. Use language like:
"Our investigator verified the MLC copy at the police station",
"Death certificate was cross-checked against the hospital death summary",
"Postmortem report was collected and findings are as follows.",
"FIR was verified at the stated police station and copy collected."
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
Multi-section legal and death verification investigation report. Third person, past tense.
Use \\n\\n between sections.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Use ONLY facts from FORENSIC AUDIT FACTS and FULL DOCUMENT TEXT. Never invent.
- Include exact vitals verbatim. Never write "stable".
- State ALL legal documents verified with their collection status, per BINDING INSTRUCTION
  register flags only — never assume.
- State cause of death verbatim from each source — never paraphrase.
- ALL chief complaints verbatim — never summarize or drop any (use the pre-extracted list only).
- Date, time, and place of death must be stated exactly as found in each record.
- Beneficiary name, relationship, and ID proof status must appear.
- MLC number, FIR number, police station, postmortem status must appear if present.
- Legal claimant verification status must appear in Section 3.
- Toxicology / forensic findings must appear verbatim if present.
- You MUST reproduce discrepancies_verbatim EXACTLY in Section 2. Do not paraphrase or reorder.

RULE — REGISTERS — WRITE ONLY WHAT IS CONFIRMED:
  If flag = YES → state "verified and attached"
  If flag = NO  → state "[MISSING] — not collected"
  If flag = null → omit entirely
  NEVER write a blanket register statement unless ALL relevant flags are YES.

RULE — TREATING DOCTOR — STANDALONE LINE:
After registers, always state treating doctor as a standalone sentence:
"Treating Doctor — Dr. [name] ([qualification], Reg No. [reg_number])."

SECTION 1 — CLINICAL AND LEGAL FACTS
One dense paragraph covering:
- Patient: name, age, gender, address
- Hospital: name, full address, registration number, bed strength
- Admission: date, time, IP number, treating doctor, qualification
- ALL chief complaints verbatim (pre-extracted list only)
- Past history (exact phrase from records)
- Vitals on admission (ALL markers — BP, PR, SPO2, Temp, RR, GRBS)
- Provisional and final diagnosis (all lines verbatim)
- Clinical course: all treatments administered (every drug by name)
- Death: date, time, place, cause as stated in hospital records
- Cause of death verbatim from: (a) discharge/death summary, (b) death certificate,
  (c) postmortem report — each stated separately
- Postmortem: conducted YES/NO, report collected YES/NO, findings verbatim
- FIR: number, police station, date filed, narration verbatim
- MLC: number, ER note, police intimation date/time
- Beneficiary: name, relationship to deceased, ID proof type, phone
- Accident narration verbatim (if applicable)
- Witness name and statement (if applicable)
- Alcohol/toxicology findings verbatim (if applicable)
- Burial/cremation certificate status
- Registers (per flags below), treating doctor (standalone)

SECTION 2 — DISCREPANCIES
Header: "DISCREPANCIES"
If discrepancies_verbatim is non-null:
  → "Kindly note —" followed by ENTIRE verbatim block exactly as written.
Append auto-detected flags not already in verbatim.
If none at all: "No major discrepancies noted."

SECTION 3 — DEATH VERIFICATION FINDINGS
Verify and state clearly for each:
□ Date, time, place of death — consistent across hospital records, death certificate, police records?
□ Cause of death — does it match across discharge summary, death certificate, and postmortem?
□ Was death certificate issued? By which authority?
□ Was postmortem conducted? Report collected and findings consistent with claimed cause?
□ Was MLC registered? Is MLC number traceable?
□ Was FIR filed where legally required (accidental/assault/suspicious death)?
□ Does FIR narration match patient/hospital version?
□ Was police final report / closure report collected?
□ Was panchnama / inquest conducted?
□ Was toxicology / forensic report obtained for poisoning/overdose/alcohol deaths?
□ Is cause of death consistent with clinical treatment record?
□ Was burial / cremation certificate collected?
□ Was death registered in local death register?
□ Was death intimated to insurance company within policy timelines?
□ For RTA: RC, DL, vehicle details, MACT records verified?
□ For suicide/self-harm: Is there suicidal history, psychiatric history?

Classify each:
  [VERIFIED] — confirmed and cross-checked
  [MISSING] — document or record absent
  [INCONSISTENT] — finding conflicts across sources
  [SUSPICIOUS] — raises fraud concern

SECTION 4 — LEGAL CLAIMANT AND DEPENDENCY VERIFICATION
- Beneficiary name and relationship to deceased
- Is beneficiary the policy nominee?
- ID proof submitted and verified: YES / NO / MISMATCH
- Marriage certificate (for spouse claims): collected / not collected
- Birth certificate (for child claims): collected / not collected
- Legal heir certificate: present / absent
- Aadhaar / government ID match: consistent / mismatch
- Is any court order or MACT decree involved?
- Were there competing or disputed claimants?
- Any indication of fake nominee or relationship mismatch?

SECTION 5 — LEGAL TRAIL CONSISTENCY CHECK
Cross-reference the following:
A. Clinical records ↔ Death certificate ↔ Postmortem findings:
   State whether cause of death is consistent or contradictory across all three.
B. Hospital admission records ↔ FIR / MLC narration:
   State whether injury mechanism, date, time, and place are consistent.
C. Patient-stated accident story ↔ Police version ↔ Witness statement:
   State whether accounts are aligned or contradictory.
D. RTA check (if applicable):
   RC / DL / vehicle number / FIR / MACT — verified or absent.
E. Toxicology / forensic findings:
   State verbatim. State whether findings support or contradict claimed cause.

SECTION 6 — AUDIT EVALUATION
A. Death Genuinity:
   Did death genuinely occur as claimed? Is there an independent verifiable death trail
   (hospital → death register → certificate → funeral proof)?
B. Legal Documentation:
   Are mandatory legal documents present for the type of death claimed?
   (Natural: death certificate. Accidental: FIR + MLC + PM. Suicide: PM + psychiatric trail.)
C. Claim Eligibility:
   Is the beneficiary the rightful legal claimant? Is the claimed event covered under policy?
D. Fraud Risk Assessment:
   State specific concerns only. Conclude with ONE of:
   "Legal verification confirms death and documentation — claim appears genuine."
   "Legal verification reveals documentation gaps — further inquiry recommended."
   "Legal verification reveals serious inconsistencies — organized fraud cannot be ruled out."

SECTION 7 — CONCLUSION
Summary → Legal trail outcome → Beneficiary verification outcome →
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
□ All {len(preprocessed['complaints_list'])} chief complaints written verbatim
□ Vitals string appears exactly — no "stable"
□ Discrepancy verbatim block reproduced ENTIRELY if discrepancies_verbatim is non-null
□ Auto-discrepancies appended if not already present
□ Register prose matches flags exactly
□ Final verdict = {preprocessed['verdict_override']}
□ If final_verdict_verbatim exists, final line must match it exactly
□ Treating doctor standalone sentence appears after register summary
□ Final diagnosis reproduced VERBATIM including ALL lines
□ Cause of death stated SEPARATELY from each of: death summary, death certificate, postmortem
□ MLC number, FIR number, police station included if non-null

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

7. DEATH / LEGAL CONSTANTS:
   Death date/time/place:   {pass1_result.get('death_date') or 'Not documented'} / {pass1_result.get('death_time') or 'Not documented'} / {pass1_result.get('death_place') or 'Not documented'}
   Cause of death (death summary): {pass1_result.get('cause_of_death_summary') or 'Not documented'}
   Cause of death (death certificate): {pass1_result.get('cause_of_death_certificate') or 'Not documented'}
   Cause of death (postmortem): {pass1_result.get('cause_of_death_postmortem') or 'Not documented'}
   Postmortem done:          {pass1_result.get('postmortem_done') or 'Not documented'}
   Postmortem findings:      {pass1_result.get('postmortem_findings') or 'Not documented'}
   MLC number:                {pass1_result.get('mlc_number') or 'Not documented'}
   FIR number:                 {pass1_result.get('fir_number') or 'Not documented'}
   Police station:             {pass1_result.get('police_station') or 'Not documented'}
   Beneficiary name:            {pass1_result.get('beneficiary_name') or 'Not documented'}
   Beneficiary relationship:    {pass1_result.get('beneficiary_relationship') or 'Not documented'}
   ID proof status:             {pass1_result.get('id_proof_status') or 'Not documented'}
   Suicidal history:            {pass1_result.get('suicidal_history') or 'Not documented'}
   Psychiatric history:         {pass1_result.get('psychiatric_history') or 'Not documented'}
   Alcohol/toxicology findings: {pass1_result.get('alcohol_history') or pass1_result.get('toxicology_findings') or 'Not documented'}
   Witness name/statement:      {pass1_result.get('witness_name') or 'Not documented'} / {pass1_result.get('witness_statement') or 'Not documented'}
   Accident narration:           {pass1_result.get('accident_narration') or 'Not documented'}

8. FINAL DIAGNOSIS LOCK — reproduce EXACTLY, all lines:
   {json.dumps(pass1_result.get('final_diagnosis'), indent=2)}

DISCREPANCIES (copy verbatim exactly; do not paraphrase):
<<<DISC_START>>>
{disc_block}
<<<DISC_END>>>

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
                "Reconstructed legal_death conclusion from %d sections",
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
                "As per the verification, the death claim is found to be Genuine.",
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
    logger.info("legal_death conclusion: %d chars", len(conclusion))
    return conclusion