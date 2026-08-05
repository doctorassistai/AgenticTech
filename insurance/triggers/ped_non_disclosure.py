"""
Trigger: PED / Non-Disclosure
Fallback single-trigger path — called via TRIGGER_REGISTRY only.
In the unified pipeline, PED assessment is handled by
_HOSPITAL_TRIGGER_INSTRUCTIONS["ped_non_disclosure"] and
_MEMBER_TRIGGER_INSTRUCTIONS["ped_non_disclosure"] in unified_report_agent.py.
"""
from __future__ import annotations
import json
import logging
import asyncio
from typing import Any, Dict
from routes.agents.base import call_groq_sync, SHARED_RULES, _make_serializable

logger = logging.getLogger(__name__)

_SYSTEM = SHARED_RULES + """
CRITICAL OUTPUT FORMAT:
You MUST return a JSON object with ONLY one key: "conclusion".
The value of "conclusion" must be a single string containing the entire multi‑section report.
Example: {"conclusion": "SECTION 1 — CLINICAL FINDINGS\\n...\\n\\nSECTION 2 — PED ANALYSIS\\n..."}

Do NOT return separate keys like section_1, section_2, etc.
Do NOT return markdown code blocks.
You are a senior insurance investigator specializing in Pre-Existing Disease (PED)
detection and non-disclosure audits for Indian health insurance claims.
Write like a physical field investigation report. Use language like:
"Our investigator visited the hospital", "ICP was verified", "The following registers were collected".
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

CRITICAL – ASTHMA DETECTION:
If the raw document contains "Asthma - 2 yrs", "PAST H/o Asthma", or similar,
you MUST include it in the PED analysis as a pre‑existing condition.

CRITICAL – RAW TEXT SCAN REQUIRED:
Even if the extracted fields below are empty, you MUST scan the FULL DOCUMENT TEXT
for any mention of chronic or pre‑existing conditions.

If you find ANY of these patterns anywhere in the document, you MUST report them in Section 2:
  - "K/c/o" (known case of)
  - "DM since", "HTN since", "Asthma since", "Hypothyroidism since"
  - "on medication for X years/months"
  - "newly diagnosed" (if contradicted by later records)
  - "old CVA", "old stroke", "chronic kidney disease", "CAD", "COPD"
  - "Type 2 diabetes", "T2DM", "hypertension"

CRITICAL ANTI-HALLUCINATION RULES:
- NEVER mention AVR (Audio Visual Recording) data, telecall transcripts,
  or member verbal statements unless they are explicitly present in FULL DOCUMENT TEXT.
- NEVER mention pre-admission OPD papers, consultation slips, or prescriptions
  from OTHER hospitals unless their content appears in FULL DOCUMENT TEXT.
- The raw document text contains ONLY hospital indoor case papers and the
  field officer form. It does NOT contain:
    * Member/insured interviews or denials
    * Telephone call recordings or summaries
    * OPD papers from external clinics (unless explicitly reproduced in the text)
    * Investigator commentary not in the field officer form
- If ped_mentioned_in_records contains contradictory entries
  (e.g. "K/c/o T2DM on medication" AND "Newly detected T2DM"),
  report this contradiction EXACTLY as found. Do NOT infer intent
  (hiding, concealment, deliberate suppression) from records alone.
- The phrase "patient is trying to hide" or "patient concealed"
  MUST NOT appear unless the field_officer_hospital_opinion or
  discrepancies_verbatim explicitly uses those words.
- Asthma history MUST NOT be mentioned unless it appears in FULL DOCUMENT TEXT.

Do NOT rely on extracted ped_mentioned_in_records alone. Always verify against raw text.

RULE — GUARDIAN/SPOUSE:
If the document contains "W/O", "S/O", "D/O", "Spouse:", "Father:", or "Mother:",
you MUST include the relation in Section 1 as "(Guardian/Spouse: [name])" or "(Husband: [name])".
If the relation is explicitly "w/o", write "wife of [name]".

RULE — PRE‑ADMISSION OPD VISITS:
Any mention of "OPD basis on [date]" or "first consultation on [date]" that occurs
BEFORE the admission date MUST be treated as a pre‑admission OPD visit.
Report it even if it is not in a structured table.
"""

_SCHEMA = '''
Return a JSON object with ONLY this key:
{ "conclusion": null }

Multi-section PED investigation report. Third person, past tense.

CRITICAL RULES:
- Use ONLY facts from FORENSIC AUDIT FACTS and FULL DOCUMENT TEXT. Never invent.
- Include exact vitals verbatim. Never write "stable".
- Include ALL drugs by name.
- Bill amount = gross from document. State discount separately.
- ALL chief complaints verbatim — never summarize or drop any.
- OPD history before admission must appear if present.
- State what was physically verified: ICP, IP register, OT register, lab register,
  registration certificate, tariff, pharmacy register.
- You MUST reproduce discrepancies_verbatim EXACTLY in Section 2.
- Never summarize or rewrite it.
- You MUST NOT invent symptoms, PED history, dates, drugs, or numbers.
- If FULL DOCUMENT TEXT contains:
  suspected, conceal, hide, not provided,
  not maintained, blank, single stretch
  → verdict MUST be SUSPECTED.
- Final verdict line priority:
    1) final_verdict_verbatim
    2) otherwise preprocessed verdict_override
- Chief complaints must come ONLY from preprocessed complaints_list.

SECTION 1 — CLINICAL FINDINGS
One dense paragraph covering:
- "Our investigator visited [hospital name] and verified the ICP and collected copy of the same."
- Patient: name, age, gender
- Hospital: name, address, bed strength, reg number, validity
- Admission date, time, IP number, treating doctor, qualification, reg number
- ALL chief complaints verbatim
- OPD history before admission (if any) — exact wording
- Past history (exact phrase)
- Vitals on admission (ALL markers — BP, PR, SPO2, Temp, RR, GRBS)
- Provisional and final diagnosis (all lines verbatim)
- All treatments (every drug by name)
- Discharge date, time, vitals at discharge
- Discharge medications
- Bill amount (gross), discount, room tariff, breakdown, mode of payment
- Registers verified: IP, OT, lab, reg cert, tariff, pharmacy
- Data collected from: name, designation, phone
- Field officer name and opinion

SECTION 2 — PED ANALYSIS
Verify and state for each:

□ PED declared at proposal? → MUST explicitly state YES / NO / UNKNOWN
  (from ped_declared_at_proposal only)

□ PED mentioned in records?
  Use ped_mentioned_in_records exactly.
  Include ALL conditions + durations.

□ Policy inception date — use policy_inception_date exactly.

□ Pre-admission OPD visits — use pre_admission_opd_visits exactly.
  List each visit separately with: date, hospital, complaint.
  Only visits that occurred BEFORE the admission date count.
  Do NOT include inpatient consultation notes dated during the hospital stay.

□ PATIENT STATEMENT VS MEDICAL RECORD CHECK
  Explicitly compare patient denial/history with medical records.
  Also check whether MEDICAL RECORDS contradict EACH OTHER (intra-record contradiction).

  INTRA-RECORD CONTRADICTION RULE:
  If ped_mentioned_in_records contains contradictory descriptors for the same condition:
    - "newly detected T2DM" + "K/c/o T2DM on medication"
    - "DM since 2 months" + "newly diagnosed DM"
    - "HTN newly detected" + "HTN on treatment"
  → Mark as [CONTRADICTORY] in output.
  → Do NOT infer concealment from record contradictions alone.

  Output format:
    [CONTRADICTORY] Records contain conflicting PED history for [condition]:
    [entry A] conflicts with [entry B].

  ONLY if BOTH are absent — no patient-vs-record contradiction AND no intra-record
  contradiction — explicitly state:
  "No contradiction found between patient statement and medical records."

□ Was the policy less than 2 years old at claim? (short_duration_policy)
□ Were pre-admission prescriptions found? (pre_admission_prescriptions)
□ Does the diagnosis suggest a chronic or long-standing condition?
□ Is there treatment history for this condition before policy inception?
□ Was the treating doctor asked about pre-existing history?

Classify each finding:
  [DECLARED]              — PED was disclosed in proposal
  [UNDISCLOSED]           — PED present in records but not declared
  [CHRONIC INDICATOR]     — condition duration suggests pre-existing
  [WITHIN WAITING PERIOD] — claim within PED waiting period
  [INSUFFICIENT EVIDENCE] — cannot determine from available records

□ EVIDENCE SOURCE DISCIPLINE:
  Every statement about patient behavior (denial, hiding, concealment)
  MUST cite its source from FULL DOCUMENT TEXT.
  ALLOWED: field_officer_hospital_opinion, field_officer_member_opinion,
           discrepancies_verbatim, direct quotes from progress notes.
  NOT ALLOWED: AVR content, telephone interviews, OPD papers not in document.

SECTION 3 — POLICY TIMELINE ANALYSIS
- Policy inception date vs date of first treatment for this condition
- Any "known case of X for Y years" language in records
- OPD visits before policy or within first year
- Whether condition was newly diagnosed or long-standing
- Beneficiary covered from date if different from policy start

SECTION 4 — AUDIT EVALUATION
A. Clinical: Is the current diagnosis consistent with a new or pre-existing condition?
B. Documentation: Are prescription/OPD records available to establish PED timeline?
C. Non-Disclosure Assessment: Was material fact concealed at proposal stage?
D. PED Verdict — use EXACTLY ONE of these three phrases:
   "PED appears to have been deliberately concealed — claim warrants repudiation review."
   → ONLY when field_officer_opinion or discrepancies_verbatim explicitly states concealment.

   "PED likely pre-existing but insufficient records to confirm non-disclosure."
   → When records contradict each other but no explicit concealment statement exists.

   "No evidence of undisclosed PED found in available documents."
   → When no PED contradiction exists in available records.

SECTION 5 — CONCLUSION
Summary → PED determination → Field officer opinion (if available) →
Recommendation →

FINAL LINE MUST END WITH EXACTLY ONE OF:
"PED appears to have been deliberately concealed — claim warrants repudiation review."
"PED likely pre-existing but insufficient records to confirm non-disclosure."
"No evidence of undisclosed PED found in available documents."

Do not invent alternate PED verdict wording.
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

    ped_contradiction = preprocessed.get("ped_contradiction_detected", False)
    contradiction_note = (
        "INTRA-RECORD CONTRADICTION DETECTED IN PYTHON PRE-CHECK — "
        "ped_mentioned_in_records contains both 'newly diagnosed' AND chronic markers "
        "(K/c/o / on medication / since X months). "
        "You MUST report this as [CONTRADICTORY] in Section 2 and verdict MUST be SUSPECTED."
        if ped_contradiction
        else "No intra-record contradiction detected by pre-check."
    )

    non_null = {k: v for k, v in extracted_flat.items() if v is not None}
    non_null = _make_serializable(non_null)
    pass1_result = _make_serializable(pass1_result)

    disc_block = pass1_result.get("discrepancies_verbatim") or ""
    auto_flags = preprocessed.get("auto_discrepancies") or []
    if auto_flags:
        auto_text = "\n".join(auto_flags)
        disc_block = (disc_block + "\n" + auto_text) if disc_block else "Kindly note —\n" + auto_text
        if not pass1_result.get("discrepancies_verbatim"):
            pass1_result["discrepancies_verbatim"] = disc_block
    if not disc_block:
        disc_block = "None"

    user = f"""
{_SCHEMA}

MANDATORY PRE-WRITE CHECKS:
1. Physical visit confirmed = {pass1_result.get('physical_visit_confirmed') or 'null'}
   If YES: open with "Our investigator visited the hospital, verified the ICP and collected the copy of the same."
   If NO/null: open with "Documents were reviewed and ICP copy was collected."
2. policy_inception_date must appear — compare against first treatment date.
3. ALL pre-admission OPD visits must be listed with dates (only visits BEFORE admission date).
4. ALL chief complaints verbatim — never summarize.
5. Vitals verbatim — never "stable".
6. Bill = gross amount. State discount separately.
7. All verified registers must appear in Section 1.
8. If FULL DOCUMENT TEXT contains: suspected / conceal / hide / not provided /
   not maintained / blank / single stretch → verdict MUST be SUSPECTED.
9. If final_verdict_verbatim exists, final line must match it exactly.
10. discrepancies_verbatim must be reproduced exactly.

BINDING INSTRUCTIONS:
Verdict:          {preprocessed['verdict_override']}
Bill:
{preprocessed['bill_block']}

Chief complaints — NON-NEGOTIABLE (use ONLY this list, never add or drop):
{json.dumps(preprocessed['complaints_list'], indent=2)}

Auto-discrepancies: {preprocessed['auto_discrepancies']}
Vitals (exact — never write "stable"): {preprocessed['vitals_formatted'] or pass1_result.get('vitals_on_admission')}

PED FACT LOCK — COPY EXACTLY (NO REINTERPRETATION):

PED declared at proposal:
{pass1_result.get('ped_declared_at_proposal') or 'UNKNOWN'}

PED in medical records:
{json.dumps(pass1_result.get('ped_mentioned_in_records'), indent=2)}

Policy inception date:
{pass1_result.get('policy_inception_date') or 'UNKNOWN'}

PRE-ADMISSION OPD VISITS — use ONLY this list (visits before admission date only):
{json.dumps(pass1_result.get('pre_admission_opd_visits') or [], indent=2)}
If this list is empty, state: "No pre-admission OPD visits documented."

PYTHON PRE-CHECK RESULT:
{contradiction_note}

INTRA-RECORD CONTRADICTION CHECK — MANDATORY:
Scan ped_mentioned_in_records for internal conflicts.
PED records found:
{json.dumps(pass1_result.get('ped_mentioned_in_records'), indent=2)}

CONFLICT DETECTION RULES:
If the same condition appears with contradictory descriptors:
  - "Newly detected" / "newly diagnosed" alongside "on medication" for same condition
  - "DM since X months/years" alongside "newly detected DM"
  - "K/c/o [condition]" alongside "newly detected [condition]"
→ Report as [CONTRADICTORY] in Section 2.
→ Do NOT write "No contradiction found" if any of these patterns exist.

PATIENT VS RECORD CONTRADICTION CHECK:
If patient_statement / proposal / declaration denies PED but records show chronic disease,
explicitly state the contradiction. Otherwise explicitly state no contradiction found.

FINAL VERDICT RULE — ABSOLUTE PRIORITY:
If pass1_result["final_verdict_verbatim"] is non-null: use it EXACTLY as the closing line.
Else use: {preprocessed['verdict_override']}

DISCREPANCIES (copy verbatim exactly; do not paraphrase):
<<<DISC_START>>>
{disc_block}
<<<DISC_END>>>

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

    logger.info("PED raw Groq response keys: %s", list(result.keys()) if result else "empty")

    conclusion = result.get("conclusion") or ""

    # Retry with stronger prompt if PED indicators exist but conclusion is empty
    if not conclusion or "No findings for this trigger" in conclusion:
        raw_lower = text.lower()
        ped_indicators = [
            "k/c/o", "known case of", "dm since", "htn since",
            "asthma since", "on medication", "chronic",
            "newly diagnosed", "old cva", "cad", "copd",
            "type 2 diabetes", "t2dm", "hypertension",
        ]
        if any(ind in raw_lower for ind in ped_indicators):
            logger.warning("PED conclusion empty but raw text has indicators — retrying")
            aggressive_user = (
                user
                + "\n\nMANDATORY: You MUST produce a non-empty PED analysis. "
                "At minimum state: 'PED indicators found in raw text but extracted fields were incomplete.'"
            )
            result = await loop.run_in_executor(
                None,
                call_groq_sync,
                _SYSTEM,
                aggressive_user,
                7000,
            )
            conclusion = result.get("conclusion") or ""

    # Fallback: reconstruct from section keys if model split output
    if not conclusion and isinstance(result, dict):
        section_keys = sorted(k for k in result if k.startswith("section_"))
        if section_keys:
            conclusion = "\n\n".join(result[k] for k in section_keys)
            logger.info("Reconstructed PED conclusion from %d sections", len(section_keys))

    if not conclusion:
        logger.warning("PED trigger returned empty conclusion | result=%s", result)

    logger.info("ped_non_disclosure conclusion: %d chars", len(conclusion))
    return conclusion