from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict
import time
import random
import re
from groq import Groq
from routes.agents.base import run_pass1
from services.groq_rate_limiter import reserve_tokens, estimate_tokens
logger = logging.getLogger(__name__)

import os
_groq = Groq(api_key=os.getenv("GROQ_API_KEY"))

_MODEL = "openai/gpt-oss-120b"
_MAX_TOKENS = 4000
_TEXT_LIMIT = 85_000


# ═══════════════════════════════════════════════════════════════════════════
# LOW-LEVEL CALLS
# ═══════════════════════════════════════════════════════════════════════════
def _call_groq_sync(system_prompt: str, user_prompt: str) -> Dict[str, Any]:
    base_delay = 5.0
    attempt = 0

    while True:
        attempt += 1
        reserve_tokens(estimate_tokens(system_prompt, user_prompt, _MAX_TOKENS))
        try:
            completion = _groq.chat.completions.create(
                model=_MODEL,
                temperature=0.0,
                max_tokens=_MAX_TOKENS,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user",   "content": user_prompt},
                ],
            )
            raw = completion.choices[0].message.content
            return json.loads(raw)

        except Exception as exc:
            err_str = str(exc)

            if "rate_limit_exceeded" in err_str or "429" in err_str:
                wait = min(base_delay * (2 ** min(attempt, 6)) + random.uniform(0, 2), 60)
                match = re.search(r'try again in ([\d.]+)s', err_str)
                if match:
                    wait = float(match.group(1)) + 1.0
                logger.warning(
                    "Rate limit hit (attempt %d), waiting %.1fs... (will keep retrying, never giving up)",
                    attempt, wait
                )
                time.sleep(wait)
                continue

            # NEW: salvage json_validate_failed instead of dropping everything
            body = getattr(exc, "body", None)
            failed_gen = None
            if isinstance(body, dict):
                failed_gen = (body.get("error") or {}).get("failed_generation")
            if failed_gen:
                try:
                    salvaged = json.loads(failed_gen)
                    logger.warning("Salvaged failed_generation JSON after validate error")
                    return _coerce_flat_scalars(salvaged)
                except Exception:
                    logger.error("Could not parse failed_generation as JSON")

            logger.error("Groq call failed (non-rate-limit): %s", exc)
            return {}

def _call_groq_sync_with_tokens(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int
) -> Dict[str, Any]:
    """Same as _call_groq_sync but with configurable token limit."""
    try:
        completion = _groq.chat.completions.create(
            model=_MODEL,
            temperature=0.0,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_prompt},
            ],
        )
        raw = completion.choices[0].message.content
        return json.loads(raw)
    except Exception as exc:
        logger.error("Groq call (custom tokens) failed: %s", exc)
        return {}
def _coerce_flat_scalars(d: Dict[str, Any]) -> Dict[str, Any]:
    """Flatten any stray list/dict values Groq emitted into plain strings,
    except chiefComplaints which the schema intentionally wants as a list."""
    out = {}
    for k, v in d.items():
        if k == "additionalMedicalDetails.chiefComplaints":
            out[k] = v  # leave as-is, handled downstream
            continue
        if isinstance(v, list):
            out[k] = "; ".join(str(x) for x in v if x not in (None, ""))
        elif isinstance(v, dict):
            out[k] = ", ".join(f"{kk}: {vv}" for kk, vv in v.items() if vv not in (None, ""))
        else:
            out[k] = v
    return out

async def _call_groq(system_prompt: str, user_prompt: str) -> Dict[str, Any]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None, _call_groq_sync, system_prompt, user_prompt
    )


# ═══════════════════════════════════════════════════════════════════════════
# SHARED RULES
# ═══════════════════════════════════════════════════════════════════════════

_SHARED_RULES = """
GLOBAL RULES (apply to every field):
1. Return ONLY valid JSON — no markdown fences, no prose outside JSON.
2. Use null for any field you cannot find. Never invent values.
3. Dates → ISO YYYY-MM-DD.  Mobile numbers → 10 digits, strip +91 prefix.
4. Amounts / numbers → plain numeric value, no currency symbols.
5. If a policy period like "05-11-2025 - 22-05-2026" appears, split it:
   first date → policyDetails.startDate, second → policyDetails.endDate.
6. Map semantically equivalent labels even when wording differs
   (e.g. "net amount" = finalBillAmount, "preauth number" = insurerRef).
"""

def _build_pre_extracted_facts(
    pass1_result: Dict[str, Any],
) -> str:
    """
    Shared structured facts block injected into every agent.
    Keeps all agents aligned to same extracted truth.
    """
    return (
        "PRE-EXTRACTED_FACTS (SOURCE OF TRUTH):\n"
        + json.dumps(pass1_result, indent=2)
        + "\n\n"
        "RULES:\n"
        "- Use PRE-EXTRACTED_FACTS first.\n"
        "- Use DOCUMENT TEXT only to support/verify.\n"
        "- If conflict exists, PRE-EXTRACTED_FACTS wins.\n"
        "- Never contradict pre-extracted facts.\n"
        "- Never invent missing values.\n"
    )
# ═══════════════════════════════════════════════════════════════════════════
# AGENT A1 — Policy & Claim Identity
# ═══════════════════════════════════════════════════════════════════════════

_A1_SYSTEM = _SHARED_RULES + """
You are an insurance policy and claim identity extraction specialist.
Focus ONLY on the fields listed in the schema below.
"""

_A1_SCHEMA = """
Return a JSON object with ONLY these keys (null if not found):
{
  "insurer": null,
  "policyNumber": null,
  "policyType": null,
  "insurerRef": null,
  "insurerContact": null,
  "insurerContactInfo": null,
  "policyDetails.startDate": null,
  "policyDetails.endDate": null,
  "policyDetails.inceptionDate": null,
  "policyDetails.coverageType": null,
  "policyDetails.preExistingDisease": null,
  "policyDetails.roomRentLimit": null,
  "claimMode": null,
  "claimSubtype": null,
  "claimedAmount": null,
  "sumInsured": null,
  "dateOfIncident": null,
  "dateOfIntimation": null,
  "cashlessDetails.tpaName": null,
  "cashlessDetails.admissionType": null,
  "cashlessDetails.estimatedCost": null
}

SEMANTIC MAPPINGS FOR THIS AGENT:

- insurerRef:
  PRIMARY — first numeric/alphanumeric token in the email Subject line.
  Pattern: "Subject: <NUMBER> <INSURER> REIMBURSEMENT"
  → insurerRef = that leading number.
  ALSO maps to: claim number | authorization number | preauth number | A.R. No.

- policyNumber:
    Priority 1: Look in the "Insured Verification Form" section for "Policy Number:".
    Priority 2: Look in the email subject or body for "# ..." pattern.
    Do NOT use the claim number (e.g., "OC-26-1002-6056-24") as policy number.
    Return exactly as found, preserving spaces.

-claimMode:
  PRIORITY 1: Field officer form checkbox "Cashless availed: YES/NO"
  If YES → "cashless". If NO → "reimbursement".

  PRIORITY 2: Subject line keyword — "REIMBURSEMENT" → "reimbursement",
  "CASHLESS" → "cashless"

  PRIORITY 3: Claim form "Mode of claim" or "Type of claim" field.

  If all null → return null. Never guess.

- insurerContact: human contact person name only (never company/TPA names)

- cashlessDetails.tpaName: TPA company name only

- policyDetails.coverageType: "accident" only if RTA/trauma explicitly mentioned.
  For health/surgical → "health" or null.

- claimSubtype: "surgical" if surgery or operative procedure mentioned

- policyDetails.startDate: first date in the policy period range, e.g., "01 Jul 2025"
  from "(01 Jul 2025 - 30 Jun 2026)". This is the policy effective date.
- policyDetails.inceptionDate: earliest date the beneficiary was covered,
  often from "Beneficiary covered from DD MMM YYYY" in the email.
  Example: "28 Jul 2025". Do not confuse with startDate.
- policyDetails.endDate: second date in the policy period range.

"""

async def agent_a1_policy(
    text: str,
    pass1_result: Dict[str, Any],
) -> Dict[str, Any]:
    facts = _build_pre_extracted_facts(pass1_result)

    user = f"""
{_A1_SCHEMA}

{facts}

DOCUMENT TEXT:
{text[:_TEXT_LIMIT]}
"""

    result = await _call_groq(_A1_SYSTEM, user)

    logger.info(
        "A1 Policy agent: %d fields found",
        sum(1 for v in result.values() if v is not None),
    )

    return result


# ═══════════════════════════════════════════════════════════════════════════
# AGENT A2 — Claimant & Hospital
# ═══════════════════════════════════════════════════════════════════════════

_A2_SYSTEM = _SHARED_RULES + """
You are an insurance claimant and hospital details extraction specialist.
Focus ONLY on the fields listed in the schema below.
"""

_A2_SCHEMA = """
Return a JSON object with ONLY these keys (null if not found):
{
  "claimantName": null,
  "claimantMobile": null,
  "claimantAge": null,
  "relationship": null,
  "idProofType": null,
  "idProofNumber": null,
  "claimantAddress": null,
  "city": null,
  "district": null,
  "pinCode": null,
  "hospitalDetails.name": null,
  "hospitalDetails.address": null,
  "hospitalDetails.type": null,
  "hospitalDetails.doctorName": null,
  "hospitalDetails.admissionDate": null,
  "hospitalDetails.dischargeDate": null,
  "hospitalDetails.city": null,
  "hospitalDetails.department": null,
  "hospitalDetails.hospitalContactNumber": null,
  "hospitalDetails.hospitalEmail": null,
  "reimbursementDetails.accountName": null,
  "reimbursementDetails.bankDetails": null,
  "reimbursementDetails.ifsc": null
}

SEMANTIC MAPPINGS FOR THIS AGENT:
- claimantAge: extract from "30 Y", "30/F", "Age 30", "30 years"
- claimantMobile:
  Look for "Mobile:" in the IPD bill header (e.g., "Mobile: 9346630077") or
  "Mobile No:" in hospital letterhead. Extract exactly 10 digits after stripping
  spaces, dashes, and +91 prefix. If not found, return null.
  NEVER invent a mobile number. Do not use any other number from the document.
- hospitalDetails.hospitalContactNumber: phone near hospital name/address only
- hospitalDetails.hospitalEmail: email near hospital name/address
- idProofNumber: Aadhaar 12-digit, strip spaces. "9813 1170 0414" → "981311700414"
- idProofType: "Aadhaar Card" if QR + Government of India header + 12-digit number
- claimantName: on Aadhaar, name in CAPS below photo
- claimantAge: from "Year of Birth: YYYY" calculate from current year
"""

async def agent_a2_claimant_hospital(
    text: str,
    pass1_result: Dict[str, Any],
) -> Dict[str, Any]:
    facts = _build_pre_extracted_facts(pass1_result)

    user = f"""
{_A2_SCHEMA}

{facts}

DOCUMENT TEXT:
{text[:_TEXT_LIMIT]}
"""

    result = await _call_groq(_A2_SYSTEM, user)

    logger.info(
        "A2 Claimant/Hospital agent: %d fields found",
        sum(1 for v in result.values() if v is not None),
    )

    return result


# ═══════════════════════════════════════════════════════════════════════════
# AGENT A3 — Medical & Clinical
# ═══════════════════════════════════════════════════════════════════════════

_A3_SYSTEM = _SHARED_RULES + """
You are a senior medical records extraction specialist for an Indian insurance
investigation company. You excel at reading clinical shorthand, OBG abbreviations,
handwritten-style notes, and operative/discharge summaries.
Focus ONLY on the medical and clinical fields listed in the schema below.
"""

_A3_SCHEMA = """
Return a JSON object with ONLY these keys (null if not found):
{
  "criticalDetails.diagnosis": null,
  "additionalMedicalDetails.diagnosisSummary": null,
  "additionalMedicalDetails.chiefComplaints": null,
  "additionalMedicalDetails.pastHistory": null,
  "additionalMedicalDetails.generalExamination": null,
  "additionalMedicalDetails.localExamination": null,
  "additionalMedicalDetails.vitals": null,
  "additionalMedicalDetails.investigatorHospitalOpinion": null,
  "additionalMedicalDetails.investigatorMemberOpinion": null,
  "additionalMedicalDetails.firstConsultationDate": null,
  "medicalStaff.pathologistName": null,
  "medicalStaff.pathologistDesignation": null,
  "medicalStaff.pathologistRegNo": null,
  "medicalStaff.radiologistName": null,
  "medicalStaff.radiologistDesignation": null,
  "medicalStaff.radiologistRegNo": null
}

SEMANTIC MAPPINGS FOR THIS AGENT:

criticalDetails.diagnosis → final diagnosis | clinical impression | medical condition
additionalMedicalDetails.chiefComplaints → c/o | presenting complaints | fever | pain
additionalMedicalDetails.chiefComplaints:
  MUST be a JSON array of strings, even if only one complaint.
  Example: ["Fever (High grade)", "SOB since 1 day"].
  Do NOT return a single comma‑separated string like "Fever, SOB, weakness".

additionalMedicalDetails.pastHistory:
  Extract verbatim from the field labelled "Past History" in the initial assessment
  or nursing notes. If it says "No significant past history", return that exact phrase.
  If the field is empty, return null. Do not infer from other sections.
additionalMedicalDetails.generalExamination → systemic examination | P/A findings
additionalMedicalDetails.localExamination → wound findings | sutures | tenderness
additionalMedicalDetails.vitals:
  BP | pulse | PR | RR | SpO2 | Saturation | temperature | Temp | T |
  FHS | GRBS | RBS | blood sugar | glucose | Hb | Haemoglobin |
  urine output — ALL markers present.

  MUST be returned as a single plain string, never a JSON object or array.
  Combine all values into one comma-separated string, e.g.:
  "HR 69, PR/RR 118/87, RBS 113, Blood Urea 24.8, Sr. Creatinine 1.1"

  Format: include every value found.
  Never summarise as "stable" or "within normal limits". 
medicalStaff.radiologistName → doctor signing scan/ultrasound report

IMPORTANT: Infer from shorthand clinical notes, OBG abbreviations, progress records.
"""

async def agent_a3_medical(
    text: str,
    pass1_result: Dict[str, Any],
) -> Dict[str, Any]:
    facts = _build_pre_extracted_facts(pass1_result)

    user = f"""
{_A3_SCHEMA}

{facts}

DOCUMENT TEXT:
{text[:_TEXT_LIMIT]}
"""

    result = await _call_groq(_A3_SYSTEM, user)

    logger.info(
        "A3 Medical agent: %d fields found",
        sum(1 for v in result.values() if v is not None),
    )

    return result


# ═══════════════════════════════════════════════════════════════════════════
# AGENT A4 — Billing, Accident & Death
# ═══════════════════════════════════════════════════════════════════════════

_A4_SYSTEM = _SHARED_RULES + """
You are an insurance billing, accident, and death claim extraction specialist.
Focus ONLY on the billing, accident, and death-related fields below.

INSTRUCTION – BILL TABLE EXTRACTION:
The bill is split into multiple subtables. You MUST extract rows from ALL subtables.
Example: The "Doctor Fees" subtable has rows: Opinion Consultation charges (Dr. Shantha Kumar) - 1740, etc.
Do not stop after "Registration".

"""

_A4_SCHEMA = """
Return a JSON object with ONLY these keys (null if not found):
{
  "billingDetails.finalBillAmount": null,
  "billingDetails.discountAmount": null,
  "billingDetails.roomType": null,
  "billingDetails.tariffType": null,
  "accidentDetails.dateTime": null,
  "accidentDetails.place": null,
  "accidentDetails.firNumber": null,
  "accidentDetails.mlcNumber": null,
  "deathDetails.date": null,
  "deathDetails.time": null,
  "deathDetails.reason": null,
  "deathDetails.beneficiaryName": null,
  "accidentDetails.firstAidDetails": null,
  "accidentDetails.firstAidHospital": null
}

SEMANTIC MAPPINGS FOR THIS AGENT:

billingDetails.finalBillAmount:
  Extract from the IPD Bill table that matches the current patient's name and IP number.
  Use the "Grand Amount" or "Final Amount" row.
  Do NOT use the "Final Bill amount paid at the hospital" from the Insured Verification Form.

billingDetails.roomType:
Priority 1:
Look in the Field Officer form section:
"Room Type (Stay of Patient)"

```
Extract ONLY the checked/selected room type.

Valid normalized outputs:
  - "AC Room"
  - "Non-AC Room"
  - "Ward"
  - "Suite"
  - "Private Room"

If multiple boxes exist:
  - choose the one marked with:
    [x], ✓, ✔, checked checkbox, or filled circle

Ignore unselected options.
```

Priority 2:
If no checkbox selection is found,
infer from the correct patient's IPD bill room/bed charge line items.

```
Examples:
  - "Semi Private" → "Ward"
  - "Twin Sharing" → "Ward"
  - "General Ward" → "Ward"
  - "Private Room" → "Private Room"
  - "Deluxe AC Room" → "AC Room"
  - "Suite Room" → "Suite"
```

Important:
Use only the bill belonging to the correct patient matching:
- patient name
- IP number / UHID / admission number

Return null ONLY if:
- the field officer form is absent or has no selected checkbox
AND
- the bill contains no identifiable room type clue.

accidentDetails.mlcNumber → MLC No | police intimation number | A.R. No.
accidentDetails.firNumber → FIR No | PC NO
accidentDetails.firstAidDetails → condition on arrival + vitals + immediate treatment
accidentDetails.firstAidHospital → hospital name from accident report header

billingDetails.discountAmount:
  Look for "Discount:" in the bill summary footer of the correct patient's bill.
  Extract the numeric value. If not found, return 0.

IMPORTANT: Return amounts as plain numbers only.
"""

async def agent_a4_billing_accident(
    text: str,
    pass1_result: Dict[str, Any],
) -> Dict[str, Any]:
    facts = _build_pre_extracted_facts(pass1_result)

    user = f"""
{_A4_SCHEMA}

{facts}

DOCUMENT TEXT:
{text[:_TEXT_LIMIT]}
"""

    result = await _call_groq(_A4_SYSTEM, user)

    logger.info(
        "A4 Billing/Accident agent: %d fields found",
        sum(1 for v in result.values() if v is not None),
    )

    return result


# ═══════════════════════════════════════════════════════════════════════════
# AGENT A5 — Risk, Investigation & Description
# ═══════════════════════════════════════════════════════════════════════════

_A5_SYSTEM = _SHARED_RULES + """
You are an insurance fraud risk and investigation details extraction specialist.
Focus ONLY on risk scores, triggers, investigation metadata, and description.
"""

_A5_SCHEMA = """
Return a JSON object with ONLY these keys (null if not found):
{
  "description": null,
  "riskDetails.riskScore": null,
  "riskDetails.riskLevel": null,
  "riskDetails.triggers": null,
  "riskDetails.investigationInstruction": null,
  "investigationDetails.investigatorName": null,
  "investigationDetails.investigatorDesignation": null,
  "investigationDetails.dataCollectedFrom": null
}

SEMANTIC MAPPINGS FOR THIS AGENT:

description → 4-6 sentence clinical-investigative narrative covering:
  patient name/age/gender, incident nature/date/place, hospital arrival,
  admission vitals, key treatment, police/MLC status, any fraud flags.
  Third person, past tense, factual.

riskDetails.triggers → fraud triggers | risk triggers | suspicious indicators from email.
  MUST be returned as a single plain string, never a JSON array or object.
  If multiple triggers are found, combine them into one string separated by
  "; ", e.g. "PED suspected; duration mismatch". Do NOT return a list.riskDetails.investigationInstruction → "please investigate" | insurer remarks
riskDetails.riskScore → numeric only if explicitly stated
riskDetails.riskLevel → infer: "High" if fraud/suspected language, "Medium" if verify language
investigationDetails.dataCollectedFrom → name + designation of person data collected from
"""

async def agent_a5_risk_investigation(
    text: str,
    pass1_result: Dict[str, Any],
) -> Dict[str, Any]:
    facts = _build_pre_extracted_facts(pass1_result)

    user = f"""
{_A5_SCHEMA}

{facts}

DOCUMENT TEXT:
{text[:_TEXT_LIMIT]}
"""

    result = await _call_groq(_A5_SYSTEM, user)

    logger.info(
        "A5 Risk/Investigation agent: %d fields found",
        sum(1 for v in result.values() if v is not None),
    )

    return result


# Agent A6 (Investigation Checklist) was removed entirely — every one of
# its checklist.* fields was unused (no "checklist" object exists on the
# case form), so calling it was a wasted LLM round-trip on every document.


_A7_SYSTEM = _SHARED_RULES + """
You are an insurance investigation instruction analyst.
You read insurer/TPA email instructions and extract:
1. A brief summary of what the investigator is asked to do
2. Which investigation triggers apply based on the email content
"""

_A7_SCHEMA = """
Return a JSON object with ONLY these keys (null if not found):
{
  "emailInstructions": null,
  "suggestedTriggers": null
}

RULES:

emailInstructions:
  Summarize the email instructions in 2-4 sentences.
  Include: what the insurer suspects, what must be verified, any specific 
  documents to collect, and any special notes.
  Example: "Insurer suspects PED non-disclosure for migraine. Investigator 
  must rule out pre-existing condition and collect first consultation papers, 
  TDC, lab reports, and ICP. Hospital-only visit required."

suggestedTriggers:
  Return a JSON ARRAY of trigger values from the list below that match the 
  email content. Match based on keywords/intent, not exact words.
  Return [] if no triggers match. Never return null for this field.

  Available trigger values (use EXACTLY these strings):
  - "claim_genuinity_authenticity"     → "genuine", "genuinity", "authenticity", "TAG Genuine", "verify claim"
  - "ped_non_disclosure"               → "PED", "pre-existing", "non-disclosure", "chronicity", "duration of ailment", "history"
  - "accident_incident_verification"   → "accident", "RTA", "incident verification", "spot visit"
  - "intoxication_addiction"           → "alcohol", "intoxication", "substance", "addiction"
  - "medical_records_treatment_verification" → "ICP", "treatment records", "hospital records", "case sheet", "TDC", "first consultation"
  - "financial_claim_pattern_risk"     → "bill verification", "pharmacy verification", "lab bills", "inflated", "discount"
  - "policy_coverage_verification"     → "coverage", "policy", "floater", "beneficiary"
  - "field_vicinity_investigation"     → "field visit", "geo-tag", "vicinity", "hospital visit", "visit hospital"
  - "legal_regulatory_death_verification" → "death", "postmortem", "FIR", "police", "legal"
  - "hospital_criteria_watchlist"      → "watchlist hospital", "hospital registration", "hospital tariff", "AVR"
  - "employee_corporate_group_policy_verification" → "corporate", "group policy", "employee"
  - "hospital_cash_benefit_abuse"      → "hospital cash", "benefit abuse", "cash claim"
  - "suspicious_claim_pattern_repeat_fraud" → "fraud", "suspected", "rework", "wrong information", "presumed"
  - "final_universal_red_flags_matrix" → "red flag", "forensic", "master trigger", "in-depth investigation", "detail investigation"
"""

async def agent_a7_email_instructions(
    text: str,
    pass1_result: dict,
) -> dict:
    facts = _build_pre_extracted_facts(pass1_result)
    user = f"""
{_A7_SCHEMA}

{facts}

DOCUMENT TEXT:
{text[:_TEXT_LIMIT]}
"""
    result = await _call_groq(_A7_SYSTEM, user)
    logger.info(
        "A7 Email Instructions agent: %d fields found",
        sum(1 for v in result.values() if v is not None),
    )
    return result

# ═══════════════════════════════════════════════════════════════════════════
# MERGE LOGIC
# ═══════════════════════════════════════════════════════════════════════════

def _merge_flat_results(*dicts: Dict[str, Any]) -> Dict[str, Any]:
    # Index of A3 (Medical) and A7 (Email) within the tuple passed to
    # _merge_flat_results. This MUST match the order of the asyncio.gather
    # call in run_multiagent_extraction below:
    #   0: A1-Policy, 1: A2-Claimant, 2: A3-Medical,
    #   3: A4-Billing, 4: A5-Risk, 5: A7-Email
    # (A6-Checklist was removed, which is why A7 is now index 5, not 6.)
    A3_INDEX = 2
    A7_INDEX = 5

    A3_KEYS = {
        "criticalDetails.diagnosis",
        "additionalMedicalDetails.diagnosisSummary",
        "additionalMedicalDetails.chiefComplaints",
        "additionalMedicalDetails.pastHistory",
        "additionalMedicalDetails.generalExamination",
        "additionalMedicalDetails.localExamination",
        "additionalMedicalDetails.vitals",
        "additionalMedicalDetails.investigatorHospitalOpinion",
        "additionalMedicalDetails.investigatorMemberOpinion",
        "additionalMedicalDetails.firstConsultationDate",
        "medicalStaff.pathologistName", "medicalStaff.pathologistDesignation",
        "medicalStaff.pathologistRegNo", "medicalStaff.radiologistName",
        "medicalStaff.radiologistDesignation", "medicalStaff.radiologistRegNo",
    }
    A7_KEYS = {"emailInstructions", "suggestedTriggers"}

    merged: Dict[str, Any] = {}
    for idx, d in enumerate(dicts):
        is_a3 = (idx == A3_INDEX)
        is_a7 = (idx == A7_INDEX)
        for key, value in d.items():
            if value is None:
                continue

            if is_a7 and key in A7_KEYS:
                merged[key] = value  # A7 always wins for its own keys
                continue

            if key in merged and merged[key] is not None:
                if is_a3 and key in A3_KEYS:
                    merged[key] = value
            else:
                merged[key] = value

    # After merging: normalize chiefComplaints into a list if it came back as a string
    if "additionalMedicalDetails.chiefComplaints" in merged:
        cc = merged["additionalMedicalDetails.chiefComplaints"]
        if isinstance(cc, str) and "," in cc:
            merged["additionalMedicalDetails.chiefComplaints"] = [c.strip() for c in cc.split(",")]

    # Defensive: riskDetails.triggers must reach the router as a plain string.
    # The A5 prompt now instructs Groq to always return a string, but this
    # normalizes any list it still emits (e.g. from a salvaged/malformed
    # response) so a downstream .strip() call never sees a list.
    if "riskDetails.triggers" in merged:
        trig = merged["riskDetails.triggers"]
        if isinstance(trig, list):
            merged["riskDetails.triggers"] = "; ".join(
                str(t).strip() for t in trig if t not in (None, "")
            )

    return merged


async def _empty_a7() -> Dict[str, Any]:
    # No email/trigger text was supplied for this document — never let A7
    # read the raw document text and mistake clinical/report language for
    # investigation instructions.
    return {"emailInstructions": None, "suggestedTriggers": []}


# ═══════════════════════════════════════════════════════════════════════════
# FORM FIELD ALLOW-LIST
# ═══════════════════════════════════════════════════════════════════════════
# Every key here matches an actual field on BLANK_FORM in NewCase.jsx.
# Agents historically over-extract (riskDetails.*, checklist.*,
# emailInstructions, obstetricDetails.*, criticalDetails.procedure/implants/
# surgeryDate, clinicalSummary, claimantEmail, several billingDetails/
# accidentDetails sub-fields) — none of those exist on the form, but were
# still being persisted to insurance_claims_new. This allow-list is the
# single choke point that strips them before persistence, for every caller.
FORM_ALLOWED_FIELDS = {
    # A1 — Policy & Claim Identity
    "insurer", "policyNumber", "policyType", "insurerRef",
    "insurerContact", "insurerContactInfo",
    "policyDetails.startDate", "policyDetails.endDate", "policyDetails.inceptionDate",
    "policyDetails.coverageType", "policyDetails.preExistingDisease", "policyDetails.roomRentLimit",
    "claimMode", "claimSubtype", "claimedAmount", "sumInsured",
    "dateOfIncident", "dateOfIntimation",
    "cashlessDetails.tpaName", "cashlessDetails.admissionType", "cashlessDetails.estimatedCost",

    # A2 — Claimant & Hospital
    "claimantName", "claimantMobile", "claimantAge", "relationship",
    "idProofType", "idProofNumber", "claimantAddress", "city", "district", "pinCode",
    "hospitalDetails.name", "hospitalDetails.address", "hospitalDetails.type",
    "hospitalDetails.doctorName", "hospitalDetails.admissionDate", "hospitalDetails.dischargeDate",
    "hospitalDetails.city", "hospitalDetails.department",
    "hospitalDetails.hospitalContactNumber", "hospitalDetails.hospitalEmail",
    "reimbursementDetails.accountName", "reimbursementDetails.bankDetails", "reimbursementDetails.ifsc",

    # A3 — Medical & Clinical
    "criticalDetails.diagnosis",
    "additionalMedicalDetails.diagnosisSummary", "additionalMedicalDetails.chiefComplaints",
    "additionalMedicalDetails.pastHistory", "additionalMedicalDetails.generalExamination",
    "additionalMedicalDetails.localExamination", "additionalMedicalDetails.vitals",
    "additionalMedicalDetails.investigatorHospitalOpinion",
    "additionalMedicalDetails.investigatorMemberOpinion",
    "additionalMedicalDetails.firstConsultationDate",
    "medicalStaff.pathologistName", "medicalStaff.pathologistDesignation", "medicalStaff.pathologistRegNo",
    "medicalStaff.radiologistName", "medicalStaff.radiologistDesignation", "medicalStaff.radiologistRegNo",

    # A4 — Billing, Accident & Death
    "billingDetails.finalBillAmount", "billingDetails.discountAmount",
    "billingDetails.roomType", "billingDetails.tariffType",
    "accidentDetails.dateTime", "accidentDetails.place",
    "accidentDetails.firNumber", "accidentDetails.mlcNumber",
    "accidentDetails.firstAidDetails", "accidentDetails.firstAidHospital",
    "deathDetails.date", "deathDetails.time", "deathDetails.reason", "deathDetails.beneficiaryName",

    # A5 — Risk, Investigation & Description
    # (riskDetails.* dropped — no such object on the form)
    "description",
    "investigationDetails.investigatorName", "investigationDetails.investigatorDesignation",
    "investigationDetails.dataCollectedFrom",

    # A6 — Investigation Checklist: nothing kept, no "checklist" object on the form.
}

# Non-form fields kept anyway because something downstream depends on them.
# suggestedTriggers isn't a form field itself, but drives the trigger
# suggestion UI in CaseDocumentUpload.jsx / FormTabs (which writes the
# user's picks into the real form field claimTriggers).
EXTRA_ALLOWED_NONFORM_FIELDS = {"suggestedTriggers"}


def _filter_to_form_fields(merged: Dict[str, Any]) -> Dict[str, Any]:
    """Drop every extracted key that isn't an actual case-form field (or an
    explicit non-form exception). Runs once, centrally, so every caller of
    run_multiagent_extraction gets pre-filtered output."""
    allowed = FORM_ALLOWED_FIELDS | EXTRA_ALLOWED_NONFORM_FIELDS
    dropped = [k for k in merged if k not in allowed]
    if dropped:
        logger.info(
            "MultiAgent extraction: dropped %d non-form field(s): %s",
            len(dropped), dropped,
        )
    return {k: v for k, v in merged.items() if k in allowed}


# ═══════════════════════════════════════════════════════════════════════════
# PUBLIC ENTRY POINT
# ═══════════════════════════════════════════════════════════════════════════

async def run_multiagent_extraction(
    text: str,
    doc_label: str,
    email_text: str = "",
) -> Dict[str, Any]:
    logger.info(
        "MultiAgent extraction START | %s | text_len=%d",
        doc_label,
        len(text),
    )

    logger.info(
        "Running universal Pass-1 extractor | %s",
        doc_label,
    )

    pass1_raw = await run_pass1(text)

    if isinstance(pass1_raw, tuple):
        pass1_result = pass1_raw[0] or {}
    else:
        pass1_result = pass1_raw or {}

    logger.info(
        "Pass-1 complete | extracted=%d fields",
        sum(
            1
            for v in pass1_result.values()
            if v is not None
        ),
    )

    # Order here MUST match the A3_INDEX / A7_INDEX constants inside
    # _merge_flat_results above.
    results = await asyncio.gather(
        agent_a1_policy(text, pass1_result),
        agent_a2_claimant_hospital(text, pass1_result),
        agent_a3_medical(text, pass1_result),
        agent_a4_billing_accident(text, pass1_result),
        agent_a5_risk_investigation(text, pass1_result),
        agent_a7_email_instructions(email_text, {}) if email_text.strip() else _empty_a7(),

        return_exceptions=True,
    )

    agent_names = ["A1-Policy", "A2-Claimant", "A3-Medical",
                   "A4-Billing", "A5-Risk", "A7-Email"]
    clean_results = []
    for i, res in enumerate(results):
        if isinstance(res, Exception):
            logger.error("Agent %s failed: %s", agent_names[i], res)
            clean_results.append({})
        else:
            clean_results.append(res)

    merged = _merge_flat_results(*clean_results)
    merged = _filter_to_form_fields(merged)

    merged["pre_extracted_facts"] = pass1_result

    total_fields = sum(1 for v in merged.values() if v is not None)
    per_agent = [sum(1 for v in r.values() if v is not None) for r in clean_results]
    logger.info(
        "MultiAgent extraction DONE | %s | total=%d | per-agent=%s",
        doc_label, total_fields,
        dict(zip(agent_names, per_agent)),
    )

    return merged