"""
Claim Adjudication Agent — Multi-Trigger Engine
Single common run() function. Trigger passed as argument.
Supports all 14 triggers defined in the audit framework.
"""
from __future__ import annotations

import json
import logging
import asyncio
import re
from typing import Any, Dict, List

from routes.agents.base import (
    call_groq_sync,
    SHARED_RULES,
    detect_case_type,
    _make_serializable,
)

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────
# TRIGGER REGISTRY
# Maps trigger string → human label used in report header
# ─────────────────────────────────────────────────────────────
TRIGGER_LABELS: Dict[str, str] = {
    "claim_genuinity_authenticity":  "CLAIM GENUINITY & AUTHENTICITY",
    "ped_non_disclosure":            "PED / NON-DISCLOSURE",
    "accident_incident_verification":"ACCIDENT / INCIDENT VERIFICATION",
    "intoxication_addiction":        "INTOXICATION / ADDICTION",
    "medical_records_treatment":     "MEDICAL RECORDS & TREATMENT VERIFICATION",
    "financial_claim_pattern_risk":  "FINANCIAL & CLAIM PATTERN RISK",
    "policy_coverage_verification":  "POLICY & COVERAGE VERIFICATION",
    "field_vicinity_investigation":  "FIELD / VICINITY INVESTIGATION",
    "legal_regulatory_death":        "LEGAL / REGULATORY / DEATH VERIFICATION",
    "hospital_criteria_watchlist":   "HOSPITAL CRITERIA / WATCHLIST HOSPITAL",
    "employee_corporate_group":      "EMPLOYEE / CORPORATE / GROUP POLICY VERIFICATION",
    "hospital_cash_benefit_abuse":   "HOSPITAL CASH / BENEFIT ABUSE",
    "suspicious_claim_pattern":      "SUSPICIOUS CLAIM PATTERN / REPEAT FRAUD INDICATORS",
    "final_red_flags_matrix":        "FINAL UNIVERSAL RED FLAGS MATRIX",
}

# ─────────────────────────────────────────────────────────────
# SHARED SYSTEM PROMPT BASE
# ─────────────────────────────────────────────────────────────
_BASE_SYSTEM = SHARED_RULES + """
You are a senior insurance fraud investigation analyst with 20+ years of experience
in Indian health insurance claim audits. You write detailed, precise investigative
conclusions in the style of a certified field investigation report.
Your output must read like a professional human investigator wrote it —
factual, structured, evidence-driven, never vague.

ABSOLUTE RULES (apply to ALL triggers):
- NEVER invent any symptom, date, number, medicine, timeline, or fact.
- ALL facts must come ONLY from FORENSIC AUDIT FACTS and FULL DOCUMENT TEXT.
- Use ONLY the pre-extracted complaints_list for chief complaints. Never infer.
- Reproduce discrepancies_verbatim EXACTLY if non-null. Do not paraphrase.
- If FULL DOCUMENT TEXT contains: suspected, conceal, hide, not provided,
  not maintained, blank, single stretch → verdict MUST be SUSPECTED.
- Final verdict must match final_verdict_verbatim exactly if it exists.
- Every sentence introduces a new fact. No restating. No filler.

DISCREPANCY CLASSIFICATION TAGS (use exactly these):
  [MISSING]           — document, record, or register entirely absent
  [INCOMPLETE]        — present but partially filled
  [CONTRADICTORY]     — conflicts with another record
  [SUSPICIOUS]        — raises fraud concern
  [BILLING MISMATCH]  — billed item not supported by clinical record
  [TIMELINE MISMATCH] — dates or sequence inconsistent
  [SINGLE STRETCH]    — entries written in one sitting without date breaks
"""


# ─────────────────────────────────────────────────────────────
# TRIGGER-SPECIFIC SYSTEM PROMPT EXTENSIONS
# ─────────────────────────────────────────────────────────────
_TRIGGER_SYSTEM_EXTENSIONS: Dict[str, str] = {

    "claim_genuinity_authenticity": """
Write like a physical field investigation report:
"Our investigator visited the hospital, verified the ICP and collected the copy of the same."
"IP register was verified and copy collected."
"The following discrepancies were noted in the ICP."
Focus: Was the hospitalization, treatment, diagnosis, billing, and claim genuine?
Check: admission proof, IP register, nursing notes, vitals progression, ICU/OT support,
pharmacy vs chart, register cross-verification, chronology, discharge summary authenticity.
""",

    "ped_non_disclosure": """
Focus: Did the disease exist before Policy Inception Date (PID)?
Was chronic illness, surgery, or long-term treatment hidden at proposal stage?
Check: policy inception date vs first symptom/treatment date, old prescriptions,
long-term medications, prior hospitalization, proposal form vs ICP history,
family history, known-case-of keywords in records.
Verdict labels: "PED confirmed — claim not admissible under policy terms."
OR "No evidence of PED/Non-Disclosure found in available documents."
""",

    "accident_incident_verification": """
Focus: Did the accident/incident actually happen as claimed?
Check: MLC registration, FIR, injury pattern vs narration, ER casualty entry,
timeline from incident to hospital, vehicle/RTA details, witness statements,
police records, imaging vs claimed trauma, spot plausibility.
Verdict labels: "Incident genuinity doubtful — strong discrepancy indicators."
OR "Incident verified and consistent with medical evidence."
""",

    "intoxication_addiction": """
Focus: Was alcohol, drugs, or toxic substances involved in the hospitalization?
Check: toxicology reports, blood alcohol level, urine drug screen, ER notes for
intoxication signs, accident-intoxication link, chronic addiction history,
policy exclusion applicability, hidden substance abuse history.
Verdict labels: "Intoxication confirmed — policy exclusion may apply."
OR "No evidence of intoxication or substance abuse found."
""",

    "medical_records_treatment": """
Focus: Was the diagnosis medically supported? Was treatment genuine and appropriate?
Check: symptoms vs diagnosis vs investigations vs treatment, vitals progression,
ICU/ventilator necessity, OT/procedure necessity, pharmacy vs medication chart,
lab correlation with diagnosis, discharge summary consistency, chronology.
Verdict labels: "Medical records and treatment found inconsistent — claim suspect."
OR "Medical records and treatment verified as consistent and appropriate."
""",

    "financial_claim_pattern_risk": """
Focus: Is the billing inflated, duplicated, or disproportionate?
Check: bill amount vs diagnosis severity, item-by-item verification vs tariff,
duplicate charges, room rent vs actual stay, ICU/OT overbilling, pharmacy inflation,
repeat claim patterns, same hospital fraud history, duplicate identity/contact linkage.
Verdict labels: "Financial irregularities detected — claim amount disputed."
OR "Billing found consistent with treatment and hospital tariff."
""",

    "policy_coverage_verification": """
Focus: Is this claim actually covered under the policy?
Check: policy active on admission date, member eligibility, waiting period,
PED exclusions, treatment coverage, day-care eligibility, hospital cash limits,
duplicate benefit claims, corporate/group eligibility, portability continuity.
Verdict labels: "Claim falls outside policy coverage — not admissible."
OR "Claim verified as within policy coverage and member eligibility."
""",

    "field_vicinity_investigation": """
Focus: Does physical/local verification support the claim?
Check: claimant residence verification, neighborhood inquiry, employer/workplace
verification, hospital physical existence and capability, accident spot plausibility,
death/event local confirmation, third-party cross-verification, organized fraud signs.
Verdict labels: "Field verification reveals significant discrepancies — claim suspect."
OR "Field verification confirms claim consistent with local evidence."
""",

    "legal_regulatory_death": """
Focus: Are legal records, death records, and medico-legal evidence consistent?
Check: death certificate vs hospital records, MLC registration, FIR details,
postmortem vs cause of death, toxicology in death cases, legal claimant validity,
RTA legal trail, MACT records, police final report, inquest/panchnama.
Verdict labels: "Legal/death verification reveals inconsistencies — claim suspect."
OR "Legal and death records verified and consistent with claim."
""",

    "hospital_criteria_watchlist": """
Focus: Is the hospital genuine, operational, and capable of billed services?
Check: hospital registration and license, ICU/OT physical capability, bed capacity
vs claimed admissions, doctor/staff authenticity, lab capability, watchlist status,
ghost admission indicators, repeated suspicious billing pattern from same hospital.
Verdict labels: "Hospital criteria deficiencies found — claim suspect."
OR "Hospital verified as genuine and capable of billed services."
""",

    "employee_corporate_group": """
Focus: Was the employee/member genuinely eligible under the group/corporate policy?
Check: active employment on admission date, group enrollment validity, dependent
eligibility and declaration, salary/payroll verification, HR confirmation, fake
employee/SME indicators, resigned-before-claim scenario, corporate benefit misuse.
Verdict labels: "Employee/member eligibility not established — claim not admissible."
OR "Employee eligibility and corporate policy coverage verified."
""",

    "hospital_cash_benefit_abuse": """
Focus: Was the hospital cash/daily benefit legitimately triggered?
Check: minimum stay requirement vs actual stay, ICU benefit vs ICU necessity,
non-medical admission indicators, duplicate benefit claims across policies,
artificial LOS extension, repeated short admission pattern, benefit-driven admission.
Verdict labels: "Hospital cash benefit misuse detected — claim suspect."
OR "Hospital cash benefit eligibility verified as legitimate."
""",

    "suspicious_claim_pattern": """
Focus: Are there repeat fraud indicators across claimant, hospital, or billing?
Check: repeated similar claims, same diagnosis repetition, same hospital fraud trail,
duplicate identity/contact/bank usage, reused documents or templates, same ICU duration
pattern, same billing structure, organized fraud cluster indicators.
Verdict labels: "Suspicious repeat pattern detected — organized fraud likely."
OR "No suspicious repeat pattern or fraud indicators identified."
""",

    "final_red_flags_matrix": """
Focus: Cross-trigger universal fraud detection — final audit summary.
Evaluate ALL of: identity flags, admission flags, chronology flags, medical necessity,
diagnosis support, ICU/OT flags, pharmacy/billing flags, register flags, policy flags,
PED/ND flags, accident flags, intoxication flags, hospital flags, corporate flags,
field flags, legal/death flags, repeat pattern flags.
Assign final suspicion level: LOW / MEDIUM / HIGH.
Conclude with: LIKELY GENUINE or LIKELY DOUBTFUL / FRAUD with reasoning.
""",
}


# ─────────────────────────────────────────────────────────────
# TRIGGER-SPECIFIC REPORT SCHEMAS
# ─────────────────────────────────────────────────────────────
_TRIGGER_SCHEMAS: Dict[str, str] = {

    "claim_genuinity_authenticity": """
REPORT STRUCTURE:

SECTION 1 — HOSPITAL PART FINDINGS
One dense paragraph, no sub-headers. Cover in order:
① Opening line (physical visit or document review).
② Patient name, age, gender, IP number, hospital name, admission date/time.
③ Chief complaints verbatim — ALL of them from complaints_list.
④ OPD history before admission if present (exact wording).
⑤ Past history verbatim.
⑥ Vitals on admission — ALL markers exact, never "stable".
⑦ Provisional diagnosis verbatim.
⑧ Investigations ordered verbatim.
⑨ Final diagnosis — ALL lines verbatim.
⑩ For SURGICAL: procedure, anaesthesia, surgery date, operation record status, post-op period.
⑪ All medications from medicine chart by name.
⑫ Discharge date and time.
⑬ Vitals at discharge exact.
⑭ Discharge medications by name.
⑮ Bill: gross, discount, net, room tariff, all line items, payment mode.
⑯ Registers: IP/OT/lab/pharmacy status as prose sentences.
⑰ Treating doctor standalone sentence.
⑱ Data collected from (name, designation, phone).
⑲ Field officer name.

SECTION 2 — DISCREPANCIES
Reproduce discrepancies_verbatim EXACTLY if non-null ("Kindly note —" prefix).
Then append auto-detected flags not already present.
If none: "No major discrepancies noted."

SECTION 3 — AUDIT EVALUATION
A. Clinical Genuinity
B. Documentation Quality
C. Billing Completeness
D. Fraud Suspicion Assessment — end with ONE verdict phrase.

SECTION 4 — CONCLUSION
If genuine: condensed summary + register verification + field officer opinion verbatim +
"RECOMMENDATION\\nAs per the verification, admission is verified and claim found to be Genuine."
If suspected: "Hence based on the above discrepancies, the claim seems to be suspected."
Use final_verdict_verbatim if non-null.
""",

    "ped_non_disclosure": """
REPORT STRUCTURE:

SECTION 1 — CLINICAL & POLICY FACTS
Policy inception date, admission date, time gap. Current diagnosis. Past history verbatim.
Long-term medications found (if any). Pre-admission OPD/prescriptions (if any).
Prior hospitalization history (if any). Proposal form PED declaration.

SECTION 2 — PED LINKAGE ANALYSIS
Does current diagnosis link to a pre-existing condition?
Is there medical continuity before PID?
Chronic disease keywords found in records (Known case of / K/C/O / On treatment since).
Old lab/imaging showing disease before PID (if any).
Prior surgery/procedure history (if any).

SECTION 3 — NON-DISCLOSURE CHECK
Was chronic illness hidden at proposal? Was surgery history hidden?
Was long-term medication hidden? Proposal form vs ICP history mismatch.
Addiction/lifestyle suppression (smoking, alcohol, drug history).

SECTION 4 — AUDIT EVALUATION
A. Clinical linkage strength
B. Documentation evidence of pre-existing condition
C. Non-disclosure assessment
D. PED Verdict — ONE verdict phrase.

SECTION 5 — CONCLUSION
PED confirmed or not confirmed with reasoning.
Use final_verdict_verbatim if non-null.
""",

    "accident_incident_verification": """
REPORT STRUCTURE:

SECTION 1 — INCIDENT FACTS
Claimed incident date, time, place, narration. Type of incident (RTA/fall/assault/burn/etc).
MLC registered (yes/no). FIR details if present. Brought by whom. First aid hospital if any.
Vehicle details if RTA. Helmet/seatbelt mention. Admission date/time vs incident date/time.

SECTION 2 — MEDICAL EVIDENCE vs NARRATION
ER/casualty entry verified. Injury pattern vs claimed mechanism.
Imaging findings vs trauma narration. ICU/OT necessity vs injury severity.
Timeline: incident → ER → diagnosis → treatment → ICU/OT → discharge.
Any timeline mismatch noted.

SECTION 3 — LEGAL & THIRD-PARTY VERIFICATION
FIR details vs hospital records. MLC number and registration status.
Police station, PC number, informant name (if documented). Witness details if any.
Postmortem/forensic report if death case. RTA legal trail.

SECTION 4 — DISCREPANCIES
Reproduce discrepancies_verbatim EXACTLY if non-null.
Append auto-detected flags.

SECTION 5 — AUDIT EVALUATION
A. Incident genuinity
B. Medical evidence consistency
C. Legal trail adequacy
D. Verdict — ONE verdict phrase.

SECTION 6 — CONCLUSION
Use final_verdict_verbatim if non-null.
""",

    "intoxication_addiction": """
REPORT STRUCTURE:

SECTION 1 — CLINICAL PRESENTATION
Admission circumstances. Chief complaints. ER notes for intoxication signs.
Altered consciousness, slurred speech, vomiting, seizures — if documented.
Vitals on admission exact.

SECTION 2 — TOXICOLOGY & SUBSTANCE EVIDENCE
Blood alcohol level (if done). Urine drug screen result. Toxicology report findings.
Gastric lavage findings if present. Chemical/poison analysis if applicable.
Substance mentioned in ER/casualty notes, nursing notes, or doctor orders.

SECTION 3 — ADDICTION / CHRONIC USE HISTORY
Alcohol dependence history. Smoking/tobacco history. Drug abuse history.
Rehab/psychiatric history. Chronic liver disease linkage. Withdrawal admission history.
Hidden addiction history — proposal vs ICP.

SECTION 4 — EVENT LINKAGE
Was intoxication directly linked to the hospitalization event?
Accident + intoxication correlation. Self-harm + substance link.
Policy exclusion applicability.

SECTION 5 — DISCREPANCIES
Reproduce discrepancies_verbatim EXACTLY if non-null.
Append auto-detected flags.

SECTION 6 — CONCLUSION
Use final_verdict_verbatim if non-null.
""",

    "medical_records_treatment": """
REPORT STRUCTURE:

SECTION 1 — CLINICAL SUMMARY
Patient, diagnosis, admission/discharge dates, treating doctor, hospital.
Chief complaints, vitals, provisional and final diagnosis verbatim.
All medications from medicine chart. Investigations ordered and results if available.

SECTION 2 — DIAGNOSIS SUPPORT VERIFICATION
Does diagnosis have lab/imaging evidence? CBC/CRP/cultures for infection.
Troponin/ECG for cardiac. CT/MRI for neuro/trauma. Platelet trend for dengue.
Creatinine for renal. Are investigation results available or blank?

SECTION 3 — TREATMENT APPROPRIATENESS
Correct specialty consulted? Correct drugs used? ICU medically justified?
Ventilator justified? OT/procedure justified? Duration of stay justified?
Treatment escalation supported by vitals progression?

SECTION 4 — DOCUMENTATION QUALITY
Nursing notes completeness. Vitals chart dates present. Medication chart filled.
Investigation result chart status. Progress notes adequacy. Discharge summary consistency.

SECTION 5 — DISCREPANCIES
Reproduce discrepancies_verbatim EXACTLY if non-null.
Append auto-detected flags.

SECTION 6 — AUDIT EVALUATION
A. Clinical genuinity
B. Treatment appropriateness
C. Documentation adequacy
D. Verdict — ONE verdict phrase.

SECTION 7 — CONCLUSION
Use final_verdict_verbatim if non-null.
""",

    "financial_claim_pattern_risk": """
REPORT STRUCTURE:

SECTION 1 — CLAIM FINANCIAL SUMMARY
Gross bill, discount, net amount, payment mode. Room tariff and type.
All bill line items with amounts. LOS (admission to discharge days).
Claimed amount vs bill amount.

SECTION 2 — BILL REASONABILITY CHECK
Is amount proportionate to diagnosis and severity?
Simple vs complex case billing comparison.
High-cost items: ICU, ventilator, implants, biologics, rare injectables.

SECTION 3 — INFLATION & DUPLICATE CHECK
Medication chart vs pharmacy bill vs pharmacy register (if collected).
Duplicate medicines or lab tests. Over-tariff room category.
Unsupported ICU/OT charges. Package split billing. Extra doctor visits.

SECTION 4 — LOS & ROOM RENT VERIFICATION
Billed days vs admission-discharge date calculation.
ICU overlap with ward charges. Room category match.
Artificial stay extension indicators.

SECTION 5 — PATTERN RISK
Prior claim history if available. Repeat hospital suspicious pattern.
Duplicate identity/contact/bank linkage. Corporate misuse indicators.

SECTION 6 — DISCREPANCIES
Reproduce discrepancies_verbatim EXACTLY if non-null.
Append auto-detected flags.

SECTION 7 — AUDIT EVALUATION
A. Bill reasonability
B. Inflation/duplication assessment
C. Pattern risk level
D. Verdict — ONE verdict phrase.

SECTION 8 — CONCLUSION
Use final_verdict_verbatim if non-null.
""",

    "policy_coverage_verification": """
REPORT STRUCTURE:

SECTION 1 — POLICY & MEMBER FACTS
Policy number, type, start/end date, inception date, status on admission date.
Member name, relationship, age. Corporate/group policy details if applicable.
Sum insured, room rent limit, coverage type.

SECTION 2 — ELIGIBILITY VERIFICATION
Policy active on admission date? Member listed in policy?
Dependent relationship verified? Corporate employment active?
Identity match (name, DOB, ID proof)?

SECTION 3 — COVERAGE & WAITING PERIOD CHECK
Is treatment/diagnosis covered? Waiting period active for this condition?
PED exclusion applicable? Specific disease waiting period?
Day-care eligibility if short stay? Hospital cash clause applicability?

SECTION 4 — EXCLUSION CHECK
Intoxication exclusion? Self-harm exclusion? Cosmetic treatment?
Infertility/experimental? Non-medical consumables? Congenital?
Is claim structured to avoid exclusion wording?

SECTION 5 — DUPLICATE / BENEFIT ABUSE CHECK
Same hospitalization under multiple policies? Corporate + retail overlap?
Duplicate hospital cash claim? Portability continuity valid?

SECTION 6 — DISCREPANCIES
Reproduce discrepancies_verbatim EXACTLY if non-null.
Append auto-detected flags.

SECTION 7 — CONCLUSION
Use final_verdict_verbatim if non-null.
""",

    "field_vicinity_investigation": """
REPORT STRUCTURE:

SECTION 1 — FIELD VERIFICATION SUMMARY
Physical visit conducted (yes/no). Date of field visit if documented.
Hospital physical existence confirmed. Hospital capability verified.
Claimant residence verified. Employer/workplace verified.

SECTION 2 — RESIDENCE & NEIGHBORHOOD CHECK
Address verified. Neighbor/local inquiry findings.
Claimant known at residence? Duration of stay at address?
Any staged or temporary address indicators?

SECTION 3 — HOSPITAL PHYSICAL VERIFICATION
Hospital exists and operational. ICU physically present?
OT physically present? Lab in-house or outsourced?
Staff (doctors, nurses) present and verifiable?
Bed capacity consistent with claim? Lab photographs collected?

SECTION 4 — WORKPLACE / EMPLOYER VERIFICATION
Employer exists? Employee known to HR/supervisor?
Attendance records confirm presence on incident date?
Workplace injury registers checked?

SECTION 5 — ACCIDENT SPOT / INCIDENT LOCATION
Spot physically consistent with narration?
Local awareness of incident?
CCTV possibility? Witness statements?

SECTION 6 — DISCREPANCIES
Reproduce discrepancies_verbatim EXACTLY if non-null.
Append auto-detected flags.

SECTION 7 — CONCLUSION
Field officer opinion verbatim if present.
Use final_verdict_verbatim if non-null.
""",

    "legal_regulatory_death": """
REPORT STRUCTURE:

SECTION 1 — DEATH / LEGAL EVENT FACTS
Date, time, place of death. Cause of death as documented.
Hospital death summary vs death certificate consistency.
Death register entry. Cremation/burial proof if available.

SECTION 2 — MLC & POLICE VERIFICATION
MLC number and registration status. Police station and FIR details.
Inquest/panchnama details. Police final report if available.
Timeline: event → MLC → police intimation → hospital.

SECTION 3 — POSTMORTEM & FORENSIC VERIFICATION
PM report findings vs clinical cause of death.
Injury pattern in PM vs claimed event. Toxicology in PM.
Time since death vs hospital records. Forensic opinion.

SECTION 4 — LEGAL CLAIMANT VERIFICATION
Who is claiming? Legal heir / nominee / spouse / parent?
Relationship proof verified. Policy nominee match.
Court/legal dependency documents if applicable.

SECTION 5 — DISCREPANCIES
Reproduce discrepancies_verbatim EXACTLY if non-null.
Append auto-detected flags.

SECTION 6 — AUDIT EVALUATION
A. Death genuinity
B. Legal trail adequacy
C. Claimant validity
D. Verdict — ONE verdict phrase.

SECTION 7 — CONCLUSION
Use final_verdict_verbatim if non-null.
""",

    "hospital_criteria_watchlist": """
REPORT STRUCTURE:

SECTION 1 — HOSPITAL PROFILE
Hospital name, address, registration number, license validity.
Issuing authority, NABH status. Bed capacity. Specialties registered.
Treating doctor name, qualification, registration number.

SECTION 2 — FACILITY CAPABILITY VERIFICATION
ICU available and operational? Beds, monitors, ventilators?
OT available? OT register present? Anesthesia support?
In-house lab? Lab registration? Outsourced lab details?
Radiology/imaging capability?

SECTION 3 — BILLED SERVICES vs FACILITY CAPABILITY
ICU billed — ICU physically exists? Ventilator billed — ventilator present?
Surgery billed — OT capable of that procedure?
Dialysis billed — dialysis unit present?
High-end services vs actual capability of facility.

SECTION 4 — GHOST ADMISSION & REGISTER CHECK
IP register verified and patient entry found?
ICU register entry present for billed ICU days?
OT register entry for billed procedures?
Lab register cross-verified with billed investigations?
Pharmacy register cross-verified with medicine bill?

SECTION 5 — WATCHLIST & PATTERN CHECK
Hospital on watchlist? Previous suspicious claims from same hospital?
Same diagnosis pattern? Same ICU abuse? Same billing structure?
Repeated inflated claims from this hospital?

SECTION 6 — DISCREPANCIES
Reproduce discrepancies_verbatim EXACTLY if non-null.
Append auto-detected flags.

SECTION 7 — CONCLUSION
Use final_verdict_verbatim if non-null.
""",

    "employee_corporate_group": """
REPORT STRUCTURE:

SECTION 1 — EMPLOYMENT & POLICY FACTS
Employer name, employee ID, designation. Group policy number.
Policy coverage period. Member category. Sum insured. Dependent declaration.

SECTION 2 — EMPLOYMENT GENUINITY CHECK
Employee record verified with HR? Payroll/salary slip verified?
Joining date and exit date (if any). Active on admission date?
Attendance records checked? Supervisor confirmation?

SECTION 3 — DEPENDENT ELIGIBILITY
Spouse/child/parent declared in policy? Relationship proof verified?
DOB and identity match? Enrollment date vs claim date?
Any undeclared dependent usage?

SECTION 4 — GROUP POLICY ELIGIBILITY
Waiting period waiver applicable? PED waiver applicable?
Correct member category? Sum insured applicable?
SME/company genuinely operational?

SECTION 5 — MISUSE INDICATORS
Resigned before claim? Fake employment trail?
Fake dependent? Same hospitalization under multiple members?
Corporate + retail duplicate benefit?

SECTION 6 — DISCREPANCIES
Reproduce discrepancies_verbatim EXACTLY if non-null.
Append auto-detected flags.

SECTION 7 — CONCLUSION
Use final_verdict_verbatim if non-null.
""",

    "hospital_cash_benefit_abuse": """
REPORT STRUCTURE:

SECTION 1 — BENEFIT CLAUSE FACTS
Policy hospital cash clause: daily amount, ICU multiplier, max days.
Minimum stay requirement. Admission date/time and discharge date/time.
Actual LOS calculated. ICU days claimed.

SECTION 2 — ADMISSION GENUINITY FOR BENEFIT
Was admission medically required? Any treatment activity documented?
Non-medical admission indicators? Minimal treatment with prolonged stay?
Stable patient retained only for benefit eligibility?

SECTION 3 — ICU BENEFIT VERIFICATION
ICU transfer note present? ICU register entry verified?
ICU monitoring chart present? Clinical deterioration justifying ICU?
ICU billed only to trigger higher daily benefit?

SECTION 4 — LOS & DUPLICATE CHECK
Billed days vs actual calculated days. Artificial overnight stay?
Same hospitalization under multiple policies for cash benefit?
Prior repeated short admissions for benefit?

SECTION 5 — DISCREPANCIES
Reproduce discrepancies_verbatim EXACTLY if non-null.
Append auto-detected flags.

SECTION 6 — CONCLUSION
Use final_verdict_verbatim if non-null.
""",

    "suspicious_claim_pattern": """
REPORT STRUCTURE:

SECTION 1 — CURRENT CLAIM PROFILE
Claimant, hospital, diagnosis, bill amount, admission/discharge dates.
Claim type and trigger summary.

SECTION 2 — REPEAT CLAIM HISTORY
Prior claims by same claimant. Same diagnosis repeated?
Same hospital repeatedly? Similar LOS and billing pattern?
Frequency of admissions in policy period?

SECTION 3 — IDENTITY & CONTACT LINKAGE
Mobile number used in multiple claims? Address shared across claims?
Bank account linked to multiple claims? Employee ID or dependent ID reused?
Aadhaar/govt ID used across different members?

SECTION 4 — DOCUMENT REUSE INDICATORS
Same discharge wording across claims? Same doctor notes template?
Reused lab reports? Same handwriting pattern? Same bill structure?
Identical treatment chart entries?

SECTION 5 — HOSPITAL FRAUD PATTERN
Hospital shows same ICU abuse pattern? Same inflated billing structure?
Same diagnosis cluster from same hospital? Watchlist linkage?

SECTION 6 — DISCREPANCIES
Reproduce discrepancies_verbatim EXACTLY if non-null.
Append auto-detected flags.

SECTION 7 — CONCLUSION
Use final_verdict_verbatim if non-null.
""",

    "final_red_flags_matrix": """
REPORT STRUCTURE:

SECTION 1 — CASE SUMMARY
Patient, hospital, diagnosis, bill amount, triggers active, policy details.

SECTION 2 — RED FLAGS EVALUATION
Evaluate each category. List only those with findings.
Mark: ✓ CLEAR / ⚠ FLAG / ✗ CRITICAL

Categories:
- Identity & Member Eligibility
- Admission & Hospitalization
- Date / Chronology
- Medical Necessity
- Diagnosis Support
- ICU / OT / Procedure
- Pharmacy & Billing
- Registers
- Policy & Coverage
- PED / Non-Disclosure
- Accident / Incident
- Intoxication
- Hospital Criteria
- Corporate / Employee
- Field / Vicinity
- Legal / Death
- Repeat Pattern

SECTION 3 — SUSPICION SCORING
LOW RISK: minor gaps only
MEDIUM RISK: multiple inconsistencies, no critical fraud proof
HIGH RISK: proven fake records / major fraud indicators

SECTION 4 — FINAL DETERMINATION
LIKELY GENUINE — with conditions if any.
OR
LIKELY DOUBTFUL / FRAUD — list top 3-5 reasons.

SECTION 5 — RECOMMENDATION
Specific action: Pay / Query / Repudiate / Investigate further / Field re-verification.
Use final_verdict_verbatim if non-null.
""",
}


# ─────────────────────────────────────────────────────────────
# AUTO-DISCREPANCY RULES PER TRIGGER
# Returns list of flag strings based on extracted data
# ─────────────────────────────────────────────────────────────
def _build_auto_discrepancies(
    trigger: str,
    pass1: Dict[str, Any],
    preprocessed: Dict[str, Any],
) -> List[str]:
    flags: List[str] = []

    # ── Shared across most triggers ──────────────────────────
    if str(pass1.get("vitals_chart_dates_present") or "").upper() == "NO":
        flags.append("[INCOMPLETE] Vitals chart — date column blank across all vitals chart pages")

    if str(pass1.get("vitals_chart_single_stretch") or "").upper() == "YES":
        flags.append("[SINGLE STRETCH] Vitals chart appears written in single stretch without date breaks")

    if str(pass1.get("nurses_notes_dates_present") or "").upper() == "NO":
        flags.append("[INCOMPLETE] Nurses notes — date and time column blank across all pages")

    if str(pass1.get("nurses_notes_single_stretch") or "").upper() == "YES":
        flags.append("[SINGLE STRETCH] Nurses notes appear written in single stretch without date breaks")

    if str(pass1.get("medication_chart_ip_number_present") or "").upper() == "NO":
        flags.append("[INCOMPLETE] Medication chart — IP number, date, and time fields blank")

    if str(pass1.get("investigation_result_chart_status") or "").upper() == "BLANK":
        flags.append("[MISSING] Investigation result chart — completely blank, no values entered")

    if str(pass1.get("pharmacy_register_collected") or "").upper() == "NO":
        flags.append("[MISSING] Pharmacy register not collected")

    # ICU billed but no ICU register
    bill_items = pass1.get("bill_breakdown_items") or []
    icu_billed = any(
        "ICU" in str(item.get("item", "")).upper()
        for item in bill_items
    )
    icu_register_ok = str(pass1.get("icu_register_collected") or "").upper() == "YES"
    if icu_billed and not icu_register_ok:
        flags.append("[BILLING MISMATCH] ICU charges billed but ICU register not verified")

    if pass1.get("discrepancies_verbatim") and "TDC" in str(pass1.get("discrepancies_verbatim")):
        flags.append("[MISSING] TDC (Treatment Details Certificate) — clarification not provided")

    # ── Trigger-specific additional flags ───────────────────

    if trigger == "accident_incident_verification":
        if not pass1.get("mlc_number") and str(pass1.get("mlc_registered") or "").upper() != "YES":
            flags.append("[MISSING] MLC not registered despite medico-legal event")
        if not pass1.get("fir_number"):
            flags.append("[MISSING] FIR number not documented")
        if not pass1.get("accident_narration"):
            flags.append("[MISSING] Accident/incident narration not captured")

    if trigger == "intoxication_addiction":
        if not pass1.get("alcohol_test_result") and str(pass1.get("alcohol_test_done") or "").upper() != "YES":
            flags.append("[MISSING] Alcohol/toxicology test not conducted or result not documented")
        if str(pass1.get("alcohol_smell_noted") or "").upper() == "YES" and not pass1.get("alcohol_test_result"):
            flags.append("[SUSPICIOUS] Alcohol smell noted in ER but no blood alcohol test documented")

    if trigger == "legal_regulatory_death":
        if pass1.get("death_date") and not pass1.get("postmortem_done"):
            flags.append("[MISSING] Postmortem not confirmed despite death claim")
        if pass1.get("death_date") and not pass1.get("death_certificate_available"):
            flags.append("[MISSING] Death certificate not confirmed as available")

    if trigger in ("financial_claim_pattern_risk", "hospital_cash_benefit_abuse"):
        if not pass1.get("bill_breakdown_items"):
            flags.append("[INCOMPLETE] No detailed line-item bill breakdown provided")

    if trigger == "ped_non_disclosure":
        if pass1.get("policy_inception_date") and pass1.get("pre_admission_opd_visits"):
            flags.append("[SUSPICIOUS] Pre-admission OPD visits documented — PED timeline requires verification")

    return flags


# ─────────────────────────────────────────────────────────────
# BILL BLOCK FORMATTER
# ─────────────────────────────────────────────────────────────
def _format_bill_block(pass1: Dict[str, Any]) -> str:
    gross    = pass1.get("gross_bill_amount") or pass1.get("bill_amount") or "Not documented"
    discount = pass1.get("discount_amount") or "Rs.0/-"
    net      = pass1.get("net_amount_received") or gross
    mode     = pass1.get("payment_mode") or pass1.get("mode_of_payment") or "Not documented"
    tariff   = pass1.get("room_tariff_per_day") or "Not documented"
    room     = pass1.get("room_type") or ""
    items    = pass1.get("bill_breakdown_items") or []

    lines = [
        f"Gross bill amount: {gross}",
        f"Discount: {discount}",
        f"Amount received: {net}",
        f"Room tariff: {tariff} per day ({room})" if room else f"Room tariff: {tariff} per day",
        f"Mode of payment: {mode}",
    ]

    if items:
        lines.append("Bill breakdown:")
        for item in items:
            lines.append(f"  - {item.get('item','?')}: {item.get('amount','?')}")

    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────
# REGISTER FLAGS
# ─────────────────────────────────────────────────────────────
def _build_register_flags(pass1: Dict[str, Any]) -> Dict[str, str]:
    def yn(key: str) -> str:
        v = pass1.get(key)
        if v is None:
            return "null"
        return str(v).upper()

    return {
        "ip":       yn("ip_register_collected"),
        "ot":       yn("ot_register_attached"),
        "lab":      yn("lab_register_attached") or yn("lab_register_collected"),
        "pharmacy": yn("pharmacy_register_collected"),
        "reg_cert": "YES" if pass1.get("reg_certificate_attached") or pass1.get("hospital_registration_valid") == "YES" else "null",
    }


# ─────────────────────────────────────────────────────────────
# VERDICT OVERRIDE
# ─────────────────────────────────────────────────────────────
def _build_verdict_override(
    trigger: str,
    pass1: Dict[str, Any],
    auto_discrepancies: List[str],
) -> str:
    # Hard override: suspect keywords in verbatim discrepancies
    disc = str(pass1.get("discrepancies_verbatim") or "").lower()
    suspect_keywords = ["suspected", "conceal", "hide", "not provided", "not maintained", "blank", "single stretch"]
    if any(kw in disc for kw in suspect_keywords):
        return "SUSPECTED"

    # Hard override: auto-discrepancies contain critical flags
    critical_flags = ["[MISSING]", "[BILLING MISMATCH]", "[SINGLE STRETCH]", "[SUSPICIOUS]"]
    if any(any(cf in d for cf in critical_flags) for d in auto_discrepancies):
        return "SUSPECTED"

    # Field officer opinion
    opinion = str(pass1.get("field_officer_hospital_opinion") or "").lower()
    if "genuine" in opinion and pass1.get("ip_register_collected", "").upper() == "YES":
        return "GENUINE"

    return "SUSPECTED"


# ─────────────────────────────────────────────────────────────
# VITALS FORMATTER
# ─────────────────────────────────────────────────────────────
def _format_vitals(pass1: Dict[str, Any]) -> str:
    v = pass1.get("vitals_on_admission")
    if v:
        return str(v)
    return "Not documented"


# ─────────────────────────────────────────────────────────────
# DRUG RULE PER CASE TYPE
# ─────────────────────────────────────────────────────────────
def _build_drug_rule(case_type: str) -> str:
    if case_type == "SURGICAL":
        return (
            "SURGICAL CASE — Include ONLY drugs explicitly in THIS document's medicine/anaesthesia chart. "
            "Use abbreviated names as they appear (e.g. 'Inj Mero'). "
            "NEVER include: Doxycycline, Noradrenaline, T.Dolo, T.Udiliv, T.Hepamerz, "
            "Neb Duolin/Budecort unless explicitly in this document."
        )
    elif case_type == "MEDICAL":
        return (
            "MEDICAL CASE — Include ONLY drugs explicitly in THIS document's medicine/progress chart. "
            "List every drug fully — do not abbreviate. "
            "NEVER include surgical prep drugs, spinal anaesthesia agents, or OT pre-op drugs."
        )
    return (
        "Include ONLY drugs explicitly listed in this document's medicine chart. "
        "Do not import drugs from memory or prior context."
    )


# ─────────────────────────────────────────────────────────────
# COMPLAINT POST-PROCESSOR
# Enforces verbatim chief complaints in generated conclusion
# ─────────────────────────────────────────────────────────────
def _enforce_complaints(conclusion: str, complaints: List[str]) -> str:
    if not complaints or not conclusion:
        return conclusion

    markers = [
        r"presented with:",
        r"presented with -",
        r"chief complaints:",
        r"complaints:",
        r"c/o:",
        r"presenting complaints:",
        r"with complaints of",
    ]
    marker_pattern = "|".join(markers)
    pattern = (
        rf"({marker_pattern})\s*(.*?)"
        rf"(?=\n\n|\nSECTION|\n[A-Z][A-Z\s]+:|\n\d+\.|\n\*\*|\.\s+[A-Z]|$)"
    )

    match = re.search(pattern, conclusion, re.IGNORECASE | re.DOTALL)
    complaint_str = ", ".join(complaints) + "."

    if match:
        prefix = match.group(1)
        conclusion = (
            conclusion[:match.start()]
            + f"{prefix} {complaint_str}"
            + conclusion[match.end():]
        )
        logger.info("Enforced verbatim chief complaints via regex replacement")
        return conclusion

    # Fallback: insert after patient introduction line
    lines = conclusion.split("\n")
    for i, line in enumerate(lines):
        if re.search(r"As per the ICP.*?\d+-year-old", line, re.IGNORECASE):
            lines.insert(i + 1, f"presented with: {complaint_str}")
            logger.info("Inserted chief complaints after patient introduction line")
            return "\n".join(lines)

    # Last resort: prepend to Section 1
    conclusion = conclusion.replace(
        "SECTION 1",
        f"SECTION 1\npresented with: {complaint_str}",
        1,
    )
    logger.warning("Appended complaints to Section 1 as last resort")
    return conclusion


# ─────────────────────────────────────────────────────────────
# MAIN RUN FUNCTION
# ─────────────────────────────────────────────────────────────
async def run(
    text: str,
    trigger: str,
    pass1_result: Dict[str, Any],
    extracted_flat: Dict[str, Any],
    preprocessed: Dict[str, Any] = None,
) -> str:
    """
    Common adjudication entry point.

    Args:
        text:          Full raw document text.
        trigger:       One of the 14 trigger strings (e.g. "claim_genuinity_authenticity").
        pass1_result:  Pre-extracted forensic audit facts dict.
        extracted_flat:Flat key-value extraction dict.
        preprocessed:  Optional pre-built preprocessed dict (built here if None).

    Returns:
        Formatted investigation conclusion string for this trigger.
    """

    # ── Validate trigger ─────────────────────────────────────
    if trigger not in TRIGGER_LABELS:
        raise ValueError(
            f"Unknown trigger: '{trigger}'. "
            f"Valid triggers: {list(TRIGGER_LABELS.keys())}"
        )

    trigger_label = TRIGGER_LABELS[trigger]
    logger.info("Processing trigger: %s", trigger_label)

    # ── Serialise inputs ─────────────────────────────────────
    pass1_result   = _make_serializable(pass1_result)
    extracted_flat = _make_serializable(extracted_flat)
    non_null       = {k: v for k, v in extracted_flat.items() if v is not None}
    case_type      = detect_case_type(pass1_result)

    # ── Build preprocessed if not provided ───────────────────
    if preprocessed is None:
        try:
            from routes.agents.preprocessor import preprocess
            preprocessed = preprocess(pass1_result, extracted_flat)
        except Exception:
            preprocessed = {}

    complaints_list = preprocessed.get("complaints_list") or (
        pass1_result.get("chief_complaints") or []
    )

    # ── Auto-discrepancies ───────────────────────────────────
    auto_discrepancies = _build_auto_discrepancies(trigger, pass1_result, preprocessed)

    # ── Verdict override ─────────────────────────────────────
    verdict_override = _build_verdict_override(trigger, pass1_result, auto_discrepancies)

    # ── Bill block ───────────────────────────────────────────
    bill_block = preprocessed.get("bill_block") or _format_bill_block(pass1_result)

    # ── Register flags ───────────────────────────────────────
    register_flags = preprocessed.get("register_flags") or _build_register_flags(pass1_result)

    # ── Vitals ───────────────────────────────────────────────
    vitals_formatted = preprocessed.get("vitals_formatted") or _format_vitals(pass1_result)

    # ── Drug rule ────────────────────────────────────────────
    drug_rule = _build_drug_rule(case_type)

    # ── Physical visit opening line ──────────────────────────
    physical_visit = str(pass1_result.get("physical_visit_confirmed") or "").upper()
    if physical_visit == "YES":
        opening_line = "Our investigator visited the hospital, verified the ICP and collected the copy of the same."
    else:
        opening_line = "Documents were reviewed and ICP copy was collected."

    # ── System prompt ────────────────────────────────────────
    system_prompt = (
        _BASE_SYSTEM
        + "\n"
        + _TRIGGER_SYSTEM_EXTENSIONS.get(trigger, "")
    )

    # ── Schema for this trigger ──────────────────────────────
    trigger_schema = _TRIGGER_SCHEMAS.get(trigger, "")

    # ── User prompt ──────────────────────────────────────────
    user_prompt = f"""
{trigger_schema}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TRIGGER BEING PROCESSED: {trigger_label}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return a JSON object with ONLY this key:
{{ "conclusion": "<full report text here>" }}

The conclusion must start with this EXACT header:
============================================================
TRIGGER: {trigger_label}
============================================================

MANDATORY CHECKLIST — verify each before writing the first word:
□ Opening line = "{opening_line}"
□ All {len(complaints_list)} chief complaints written verbatim (BINDING INSTRUCTION 3)
□ Vitals string appears exactly — never "stable" (BINDING INSTRUCTION 6)
□ Bill block appears with all amounts (BINDING INSTRUCTION 2)
□ discrepancies_verbatim reproduced ENTIRELY if non-null
□ Auto-discrepancies appended (BINDING INSTRUCTION 4)
□ Register prose matches flags exactly (BINDING INSTRUCTION 5)
□ Verdict = {verdict_override} (BINDING INSTRUCTION 1)
□ final_verdict_verbatim used if non-null
□ Treating doctor standalone sentence present
□ NO invented facts, dates, drugs, or numbers

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BINDING INSTRUCTIONS — NON-NEGOTIABLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. VERDICT LOCK:
   VERDICT = {verdict_override}
   Field officer opinion cannot override this verdict.

2. BILL FIGURES — copy exactly, no paraphrasing:
<<<BILL_START>>>
{bill_block}
<<<BILL_END>>>

3. CHIEF COMPLAINTS — copy verbatim, do NOT infer or reword:
{json.dumps(complaints_list, indent=2)}

4. AUTO-DETECTED DISCREPANCIES — append to discrepancy section if not already in verbatim block:
{chr(10).join(auto_discrepancies) if auto_discrepancies else "   (none)"}

5. REGISTER STATUS (YES = verified/attached | NO = add [MISSING] flag | null = omit):
   IP register:   {register_flags.get("ip", "null")}
   OT register:   {register_flags.get("ot", "null")}
   Lab register:  {register_flags.get("lab", "null")}
   Pharmacy:      {register_flags.get("pharmacy", "null")}
   Reg cert:      {register_flags.get("reg_cert", "null")}

6. VITALS — copy exactly, never write "stable":
   {vitals_formatted}

7. OPENING LINE — start Section 1 with exactly:
   "{opening_line}"

8. DRUG SAFETY RULE:
   {drug_rule}

9. FINAL VERDICT:
   If final_verdict_verbatim is non-null → use it EXACTLY as closing line.
   Else → use verdict: {verdict_override}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORENSIC AUDIT FACTS:
{json.dumps(pass1_result, indent=2)}

SUPPORTING CONTEXT (non-null fields only):
{json.dumps(non_null, indent=2)[:2000]}

FULL DOCUMENT TEXT:
{text[:50000]}
"""

    # ── LLM Call ─────────────────────────────────────────────
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        call_groq_sync,
        system_prompt,
        user_prompt,
        6000,
    )

    # ── Extract conclusion ────────────────────────────────────
    conclusion: str = result.get("conclusion") or ""

    # Fallback: reconstruct from section_ keys if model split output
    if not conclusion and isinstance(result, dict):
        section_keys = sorted(
            k for k in result.keys() if k.startswith("section_")
        )
        if section_keys:
            conclusion = "\n\n".join(result[k] for k in section_keys)
            logger.info(
                "Reconstructed conclusion from %d section keys", len(section_keys)
            )
        elif len(result) > 0:
            conclusion = json.dumps(result, indent=2)
            logger.warning("No 'conclusion' key — using raw JSON as fallback")

    # ── Enforce header ────────────────────────────────────────
    header = (
        f"============================================================\n"
        f"TRIGGER: {trigger_label}\n"
        f"============================================================\n"
    )
    if not conclusion.strip().startswith("==="):
        conclusion = header + "\n" + conclusion

    # ── Enforce verbatim chief complaints ────────────────────
    if complaints_list and trigger in (
        "claim_genuinity_authenticity",
        "medical_records_treatment",
        "accident_incident_verification",
        "intoxication_addiction",
    ):
        conclusion = _enforce_complaints(conclusion, complaints_list)

    logger.info(
        "Trigger '%s' conclusion generated: %d chars",
        trigger,
        len(conclusion),
    )

    return conclusion
