"""
unified_report_agent.py
─────────────────────────────────────────────────────────────────────────────
Three-call pipeline for investigation report generation:

  Call A  → Hospital base findings  (Section 1 skeleton)
  A-trigs → Per-trigger hospital assessments (appended to Section 1)
  Call B  → Member/insured base findings (Section 2 skeleton)
  B-trigs → Per-trigger member assessments (appended to Section 2)
  Call C  → Reconciled conclusion (Section 3) + final verdict

Text splitting between hospital and member content is prompt-directed,
not regex-based, because the content is interleaved in raw_llama_markdown.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

from routes.agents.base import call_groq_sync, SHARED_RULES, _make_serializable, detect_case_type
from routes.agents.preprocessor import (
    compute_auto_discrepancies,
    format_bill_block,
    format_complaints_list,
    format_register_summary,
    format_vitals,
    reconcile_conclusion,
    parse_reviewer_annotations,
    preprocess,
)

logger = logging.getLogger(__name__)

def _format_annotations_for_llm(annotations: List[Dict[str, str]]) -> str:
    """
    Render reviewer annotations as explicit, must-address instructions for
    the generation prompts (Call A/B trigger prompts + Call C reconcile).
    Returns "" if there are none.
    """
    if not annotations:
        return ""
    lines = [
        "REVIEWER ANNOTATIONS — a human reviewer has flagged the following points.",
        "You MUST reason about each one explicitly using the document evidence",
        "available to you. Do not just restate the note — analyse whether the",
        "record supports, contradicts, or is silent on it, and say so.",
        "",
    ]
    for i, ann in enumerate(annotations, 1):
        lines.append(f"[{i}] ({ann.get('label', 'NOTE')})")
        lines.append(f"    Flagged text: \"{ann.get('highlighted_text', '')}\"")
        lines.append(f"    Reviewer note: {ann.get('note', '')}")
        lines.append("")
    return "\n".join(lines)
def _drug_rule_for_case(pass1_result: Dict[str, Any]) -> str:
    """
    Ported from claim_genuinity.py — case-type-aware drug whitelist to
    prevent the model importing plausible-sounding but undocumented drugs.
    """
    case_type = detect_case_type(pass1_result)
    if case_type == "SURGICAL":
        return (
            "SURGICAL CASE — FORBIDDEN drugs (never include unless explicitly "
            "in THIS document's medicine chart): Doxycycline, Noradrenaline/Norad, "
            "T.Dolo, T.Udiliv, T.Hepamerz, Neb Duolin/Budecort, Inj MEROPENEM. "
            "Only include drugs explicitly listed in THIS document's medicine chart. "
            "Use abbreviated names exactly as they appear in the chart "
            "(e.g. 'Inj Mero' not 'Meropenem'). "
            "Include anaesthesia drugs from the anaesthesia record if present."
        )
    elif case_type == "MEDICAL":
        return (
            "MEDICAL CASE: Include EVERY drug by name from this document's "
            "medicine/progress chart. Do not skip any drug. Do not abbreviate. "
            "FORBIDDEN (include ONLY if explicitly in THIS document's chart): "
            "spinal anaesthesia agents, OT pre-op drugs, surgical prep drugs. "
            "Hydrocortisone/Hydrocort IS a valid medical drug — include it if present."
        )
    else:
        return (
            "Only include drugs explicitly listed in this document's medicine chart. "
            "Do not import drugs from memory or from similar past cases."
        )

# ─────────────────────────────────────────────────────────────────────────────
# Member-visit document detection
# ─────────────────────────────────────────────────────────────────────────────
# NOTE: this list must only contain generic, case-agnostic markers of an
# actual member/insured-side document. It must NEVER contain a specific
# claimant's name or a one-off phrase from a single past case — that causes
# unrelated documents to be misclassified as "member visit present", which in
# turn makes Call B fabricate a plausible-sounding member visit section for
# cases where no member visit was ever conducted.
_MEMBER_DOC_KEYWORDS = [
    "Insured Verification Form",
    "Patient Feedback Form",
    "Self-Declaration",
    "FO Name",
    "insured's residence",
    "member visit",
    "insured questionnaire",
]

_STRONG_MEMBER_MARKERS = ["Insured Verification Form", "Patient Feedback Form"]

def has_member_documents(full_text: str) -> bool:
    if not full_text:
        return False
    lower = full_text.lower()
    if any(m.lower() in lower for m in _STRONG_MEMBER_MARKERS):
        return True
    hits = sum(1 for kw in _MEMBER_DOC_KEYWORDS if kw.lower() in lower)
    return hits >= 2

def extract_member_text(full_text: str) -> str:
    """
    Extract only pages that contain member/insured‑side content.
    Keeps a page if it contains at least one of the keywords below.
    """
    # Split by page markers (common in these PDFs)
    pages = re.split(r'(<!-- PAGE_START: \d+ -->)', full_text, flags=re.IGNORECASE)
    kept_pages = []
    for i in range(1, len(pages), 2):
        marker = pages[i]
        content = pages[i+1] if i+1 < len(pages) else ""
        page_block = marker + content
        if any(kw.lower() in page_block.lower() for kw in _MEMBER_DOC_KEYWORDS):
            kept_pages.append(page_block)
    if kept_pages:
        return "\n".join(kept_pages)
    # No page markers matched a member keyword. Do NOT fall back to grabbing
    # an arbitrary slice of the (hospital-only) document — that slice gets
    # fed straight into the member-base prompt and produces a fabricated
    # member visit section. Callers should check has_member_documents(...)
    # before relying on this text at all.
    return ""
# ─────────────────────────────────────────────────────────────────────────────
# Trigger label map
# ─────────────────────────────────────────────────────────────────────────────
TRIGGER_LABELS: Dict[str, str] = {
    "claim_genuinity_authenticity":             "Claim Genuinity & Authenticity",
    "accident_incident_verification":           "Accident / Incident Verification",
    "ped_non_disclosure":                       "PED / Non-Disclosure",
    "medical_records_treatment_verification":   "Medical Records & Treatment Verification",
    "hospital_criteria_watchlist":              "Hospital Criteria / Watchlist",
    "legal_regulatory_death_verification":      "Death Verification",
    "intoxication_addiction":                   "Intoxication / Addiction",
    "financial_claim_pattern_risk":             "Financial & Claim Pattern Risk",
    "policy_coverage_verification":             "Policy & Coverage Verification",
    "field_vicinity_investigation":             "Field / Vicinity Investigation",
    "employee_corporate_group_policy_verification": "Employee / Corporate Policy",
    "hospital_cash_benefit_abuse":              "Hospital Cash / Benefit Abuse",
    "suspicious_claim_pattern_repeat_fraud":    "Suspicious Claim Pattern",
    "final_universal_red_flags_matrix":         "Universal Red Flags Matrix",
    "rta":                                      "Road Traffic Accident",
    "death_claim":                              "Death Claim",
    "critical_illness":                         "Critical Illness",
}

# ─────────────────────────────────────────────────────────────────────────────
# Shared base system prompt
# ─────────────────────────────────────────────────────────────────────────────
_BASE_SYSTEM = SHARED_RULES + """
You are a senior insurance field investigation officer writing a formal
Indian health/life insurance investigation report.
Return ONLY valid JSON — no markdown fences, no prose outside JSON.
Use null for missing fields. Never invent facts.
Every factual sentence must be traceable to the source document.
NEVER write "stable" for vitals — always use exact documented values.
NEVER invent symptoms, drugs, dates, amounts, or clinical details.
"""
_CITATION_RULE = """
CITATION RULE:
The source document text you are given contains markers like:
  <!-- PDF_START: filename.pdf -->
  <!-- PAGE_START: N -->
Whenever you state a fact drawn from that source text, add a citation
immediately after the sentence — or after the LAST sentence of a group of
consecutive sentences that all came from the same document and page —
in exactly this format:
  (Source: filename.pdf, Page N)
Group consecutive sentences from the same document/page under ONE citation.
Do not cite every sentence individually if they share the same source.
If a single sentence combines facts from two different documents or pages,
cite both, comma-separated, inside one parenthetical:
  (Source: filename.pdf, Page N; other_file.pdf, Page M)
Do NOT cite headers, instructions, or your own reasoning/interim
assessments — only cite statements of fact drawn from the source document
text.
"""

def _scope_discipline_block(current_trigger: str, all_triggers: List[str]) -> str:
    """
    Tells a per-trigger prompt to stay inside its own topic and not restate
    facts that belong to a different trigger selected for this same report.
    Without this, a fact like "history of alcohol intake" gets repeated
    under Claim Genuinity, PED, AND Intoxication/Addiction instead of
    staying confined to the Intoxication/Addiction paragraph.
    """
    others = [TRIGGER_LABELS.get(t, t) for t in all_triggers if t != current_trigger]
    if not others:
        return ""
    others_str = ", ".join(others)
    return f"""
SCOPE DISCIPLINE:
This report also contains SEPARATE dedicated paragraphs for these other
triggers: {others_str}.
Do NOT restate or re-analyse facts that belong to one of those triggers'
own subject matter (for example, if "Intoxication / Addiction" is one of
the other triggers listed above, do not discuss alcohol/intoxication
findings here — that belongs in its own paragraph). Only mention such a
fact here in passing, in a single clause, if it is directly necessary to
support THIS trigger's own conclusion — do not give it its own sentence
or repeat the same analysis found in the other trigger's paragraph.
"""

# ─────────────────────────────────────────────────────────────────────────────
# Trigger-specific hospital-side assessment instructions
# ─────────────────────────────────────────────────────────────────────────────
# Every block below returns "finding" (a 3-6 sentence paragraph) via the
# calling prompt. The bullet lists inside each instruction are lifted from
# the equivalent standalone trigger file's SECTION 3/4/5 verification
# checklist so this per-trigger call asks the same depth of question the
# single-trigger pipeline would — just scoped to hospital-side evidence
# only, and phrased as "assess and answer", not "reproduce a checklist".
_HOSPITAL_TRIGGER_INSTRUCTIONS: Dict[str, str] = {
    "claim_genuinity_authenticity": """
Assess from the hospital records only:
- Is the hospitalisation clinically justified by the documented vitals, diagnosis, and treatment?
- Are the ICP, discharge summary, registers, and billing internally consistent?
- Are there any chart anomalies (blank dates, single-stretch entries, missing IP numbers)?
- Does the bill breakdown match the clinical record (no billed items lacking clinical support)?
Return a single factual paragraph. Reference facts already stated in the hospital base findings
using phrases like "as noted above" — do not repeat them.
""",
    "ped_non_disclosure": """
Assess from the hospital ICP and discharge summary only:
- Does the past history section document any chronic or pre-existing condition?
- Does the final/provisional diagnosis or medication chart suggest a long-standing disease
  (e.g. K/c/o DM, HTN since X years, HbA1c >6.5%, steroids/OHA/antihypertensives on chart)?
- Is the current diagnosis plausibly caused or complicated by any identified PED?
- State whether the hospital record confirms, contradicts, or is silent on PED.

INTRA-RECORD CONTRADICTION CHECK:
Scan for the same condition described with contradictory descriptors, e.g.:
  - "newly detected T2DM" alongside "K/c/o T2DM on medication"
  - "DM since 2 months" alongside "newly diagnosed DM"
  - "HTN newly detected" alongside "HTN on treatment"
If found, tag it [CONTRADICTORY] in the discrepancies array and describe both
conflicting entries in the finding. Do NOT infer concealment or intent from
a records-only contradiction — report it as a factual inconsistency only.

EVIDENCE SOURCE DISCIPLINE:
Any statement describing patient behavior (denial, hiding, concealment) MUST
be traceable to an explicit quote in field_officer_hospital_opinion or
discrepancies_verbatim. Do NOT write "patient concealed" or "patient tried to
hide" unless those words (or a clear equivalent) appear verbatim in one of
those two sources.

Return a single factual paragraph. Do not speculate beyond what the documents show.
""",
    "accident_incident_verification": """
Assess from the hospital MLC register, casualty notes, and treating doctor certificate:
- Was the MLC registered at the treating hospital? (MLC = Medico-Legal Case at hospital.
  This is DIFFERENT from FIR at police station — state each separately.)
- Was the FIR registered at a police station? State FIR number and station if present.
- What does the treating doctor's certificate state as the nature of injuries?
- Is the injury pattern documented in the ICP consistent with the reported mechanism?
- Was alcohol smell noted in the casualty admission notes?
- Was helmet/seatbelt status documented? Who is recorded as having brought the patient in?
- Is the accident date/time in the ICP consistent with the admission date/time?
Return a single factual paragraph. MLC and FIR must appear as separate sentences.
""",
    "intoxication_addiction": """
Assess from the hospital admission records only:
- Was alcohol smell or intoxication noted in the casualty/admission notes?
- Was a blood alcohol test ordered? What was the result?
- Does the medication chart show any addiction-related medications (e.g. thiamine,
  naltrexone, disulfiram)?
- Does any clinical note mention chronic alcohol use or liver disease?
This is the ONLY paragraph where alcohol/intoxication/addiction findings should
be analysed in depth — gather all such facts here.
Return a single factual paragraph.
""",
    "legal_regulatory_death_verification": """
Assess from the hospital death records:
- What is the documented cause of death in the death certificate / discharge summary?
- Was a post-mortem conducted? What were the findings?
- Is the death certificate available and consistent with the treating doctor's notes?
- Were any forensic / MLC procedures followed at the hospital?
- State date, time, and place of death exactly as recorded, and whether these are
  consistent across the discharge summary, death certificate, and postmortem report.
Return a single factual paragraph.
""",
    "hospital_criteria_watchlist": """
Assess from hospital registration, infrastructure evidence, and the field officer
hospital-visit form:
- Is the hospital registration certificate valid, current, and issued by the stated authority?
- Does the hospital meet the minimum bed-strength required for the services billed
  (compare registration-certificate bed count against the field-officer-verified count)?
- Is the hospital empanelled with the insurer/TPA, and is it on any watchlist?
- Is the treating doctor registered, with qualification matching the specialty of treatment?
- Is an in-house lab present, registered, and located in the hospital's vicinity?
- For ICU/OT billed cases: is there documentary evidence (ICU register, OT register,
  anaesthesia record) that these facilities were physically used for this patient?
- Are IP, OT, lab, pharmacy, and tariff registers each individually confirmed
  (per the register flags), never as a blanket statement?
Return a single factual paragraph referencing specific document evidence.
""",
    "financial_claim_pattern_risk": """
Assess from the hospital bill and clinical record:
- Is the billed amount proportional to the documented length of stay, procedures, and diagnosis?
- Are there any line items billed without clinical support (e.g. ICU charges with no ICU register,
  pharmacy charges with no matching entry in the medication chart)?
- Is the room tariff per day consistent with the room type occupied and the total bill?
- Is the bill breakup detailed (>10 line items) or aggregated/vague?
- Is the claimed/billed amount a suspiciously round number, or does it exactly match the sum insured?
- Was there a discount, and if so does its size or timing suggest it was offered to reduce scrutiny?
Return a single factual paragraph.
""",
    "medical_records_treatment_verification": """
Assess from the ICP, progress notes, vitals chart, nurses notes, and medication chart:
- Are all investigations ordered documented with results, or is the investigation
  result chart blank?
- Is the treatment (drugs, fluids, procedures) appropriate and proportionate for the diagnosis?
- Are the nurses notes and vitals chart dated across the full admission period, or do they
  appear written in a single undated stretch?
- Does the medication chart carry an IP number, date, and time for each entry?
- For surgical cases: is the operation record attached, and is the post-operative
  period documented as uneventful or otherwise?
- Do the discharge summary's clinical narrative and the daily progress notes agree with
  each other, or is there a timeline mismatch (e.g. treatment or lab work dated before
  admission, or after discharge/death)?
Return a single factual paragraph, using the exact chart-quality flag values
(vitals_chart_dates_present, nurses_notes_dates_present,
medication_chart_ip_number_present, investigation_result_chart_status) where relevant.
""",
    "policy_coverage_verification": """
Assess from the hospital and claim-administration side of the record only:
- Was the admission date within the policy period (policy_start_date to policy_end_date)?
- Is this claim within any applicable waiting period (PED, named-disease, or initial
  waiting period), based on policy_inception_date vs the diagnosis/treatment dates?
- Was the treating hospital cashless/network, or reimbursement — and is the claim mode
  in the hospital records consistent with cashless_availed?
- Was pre-authorisation obtained for a cashless claim, if applicable?
- Is the room rent actually billed within any room-rent limit implied by the policy
  documents present in the record?
Return a single factual paragraph. State clearly which of these could NOT be verified
from hospital-side documents alone (coverage terms usually require the policy schedule).
""",
    "field_vicinity_investigation": """
Assess from the field officer's hospital-visit form and geotag/photo evidence only:
- Is the hospital physically located at the stated address and confirmed operational
  by the field officer?
- Does the field-verified bed strength match the registration certificate?
- Was a geotag photo of the hospital premises collected?
- Is the in-house lab (if any) genuinely in the vicinity of the hospital, with photos collected?
- Were the IP, OT, and lab registers physically verified on-site, and is that reflected
  in the register flags (never assume — state only what the flags confirm)?
- Is the hospital's ICU/OT physically present and functional per the field officer's account?
Return a single factual paragraph, citing the field officer's name and hospital opinion
where present.
""",
    "employee_corporate_group_policy_verification": """
Assess from the hospital-side and policy-administration documents only (employer/HR
confirmation itself is usually member-side, so focus here on what the hospital and
claim paperwork show):
- What employer name, employee ID, and policy/member category appear in the hospital
  admission or billing paperwork?
- Does the claimant's relationship to the employee (self / spouse / child / parent) as
  recorded on the admission form match what is claimed?
- Is there any hospital-side evidence of dependent enrolment (e.g. ID proof collected
  at admission, insurance card details)?
- Is the treating hospital empanelled for this specific corporate/group policy, and is
  cashless availed consistent with that empanelment?
Return a single factual paragraph. Explicitly state where employment/eligibility
verification is NOT determinable from hospital records alone and must rely on the
member/HR side.
""",
    "hospital_cash_benefit_abuse": """
Assess from the hospital admission/discharge timeline, vitals chart, nurses notes,
medication chart, and bill only:
- Calculate the exact length of stay from admission date/time to discharge date/time.
- Is the length of stay medically justified by the diagnosis and documented severity
  (vitals, investigations), or does it look inflated relative to clinical need?
- Are nursing notes and the vitals chart dated for every day of the claimed stay, or
  do they show blank dates / a single continuous undated stretch (state the exact
  vitals_chart_dates_present / nurses_notes_dates_present / single-stretch flag values)?
- If ICU is billed: do ICU register entries, monitoring sheets, and ICU nursing notes
  exist for the claimed ICU days, and does the documented clinical condition support
  ICU-level care?
- Is there any indicator of an artificially prolonged or 23-hour-threshold admission
  designed to trigger a hospital-cash or ICU-cash benefit rather than genuine need?
Return a single factual paragraph.
""",
    "suspicious_claim_pattern_repeat_fraud": """
Assess from the hospital records:
- Is there any documentation of previous admissions at the same hospital, for the same
  or a similar diagnosis, that is visible from this record alone?
- Does the clinical picture (short LOS, rapid recovery, minimal interventions relative
  to the diagnosis) raise concerns about a pattern of short admissions timed to a
  minimum-stay benefit threshold?
- Are there any chart anomalies (single-stretch entries, blank dates, physiologically
  implausible vitals) suggesting the record was fabricated or reused as a template?
- Does the billing structure (room tariff, drug list, lab list) resemble a standard,
  repeatable template rather than a case-specific record?
Return a single factual paragraph.
""",
    "final_universal_red_flags_matrix": """
Provide a rapid hospital-side-only red-flag scan across these dimensions, one clause
each, using CLEAR / FLAG / RED FLAG for each dimension (do not use headers or bullets —
weave it into flowing prose):
- Hospital credentials (registration validity, empanelment, watchlist status)
- Admission and hospitalisation genuineness (IP register, nursing notes, vitals chart
  continuity)
- Clinical consistency (diagnosis vs complaints, vitals, investigations, treatment)
- Documentation integrity (dated charts, no single-stretch entries, discharge summary
  consistent with progress notes)
- Billing (bill vs clinical support, ICU/OT charges vs register entries)
- Chronology (lab/treatment/OT dates fall within the admission period; nothing dated
  after discharge or death)
Only flag an item RED FLAG if there is a specific, citable document fact supporting it —
do not speculate. This paragraph feeds a later master synthesis; keep it dense and
factual, 5-8 sentences.
""",
}

# Default for triggers not explicitly listed above
_DEFAULT_HOSPITAL_TRIGGER = """
Assess from the hospital records only what is relevant to this trigger.
Return a single factual paragraph. Do not repeat the hospital base findings.
"""

# ─────────────────────────────────────────────────────────────────────────────
# Trigger-specific member/insured-side assessment instructions
# ─────────────────────────────────────────────────────────────────────────────
_MEMBER_TRIGGER_INSTRUCTIONS: Dict[str, str] = {
    "claim_genuinity_authenticity": """
Assess from the insured verification form and member visit findings only:
- Does the member's account of the illness/admission match the hospital record?
- Did the member correctly identify the treating doctor, hospital name, and dates?
- Did the member state a bill amount? Does it match the hospital bill?
- Did the field officer find any inconsistency in the member's narration?
Return a single factual paragraph referencing specific member-visit evidence.
""",
    "ped_non_disclosure": """
Assess from the insured questionnaire, member interview, and field officer member visit:
- Did the member disclose any pre-existing condition (DM, HTN, asthma, etc.)?
- Did the member deny any pre-existing condition?
- Did the member mention any prior hospitalisations, OPD visits, or ongoing medications?
- Did the field officer note any home medications or prescription slips at the member's residence?

PRE-ADMISSION OPD VISIT SCOPING:
Only treat a visit as "pre-admission" if its date is BEFORE the admission
date. Do NOT count inpatient consultation notes dated during the hospital
stay as pre-admission OPD visits.

- Cross-reference: if the hospital record shows PED indicators and the member denied it,
  flag this as [UNDISCLOSED PED SUSPECTED] — the reconciliation call will decide the verdict.

EVIDENCE SOURCE DISCIPLINE:
Any statement describing the member's behavior (denial, hiding, concealment)
MUST be traceable to an explicit quote in field_officer_member_opinion,
discrepancies_verbatim, or the insured questionnaire itself. Do NOT write
"member concealed" or "member tried to hide" unless equivalent wording
appears verbatim in one of those sources.

Return a single factual paragraph.
""",
    "accident_incident_verification": """
Assess from the insured questionnaire, member interview, and accident narration:
- What accident narration did the member give during the member visit?
- Is this consistent with the hospital MLC/casualty notes?
- Was helmet / seatbelt worn — what did the member state vs what was documented?
- Who brought the patient to hospital according to the member?
- Did the field officer note any inconsistency between the member's narration and physical evidence?
Return a single factual paragraph. Explicitly flag any inconsistencies.
""",
    "intoxication_addiction": """
Assess from the member visit and insured questionnaire:
- Did the member admit to consuming alcohol before the incident?
- Did family members mention alcohol use?
- Are there any home medications suggesting chronic alcohol use?
- Did the field officer observe any relevant evidence at the member's residence?
This is the ONLY paragraph where alcohol/intoxication/addiction findings should
be analysed in depth — gather all such facts here.
Return a single factual paragraph.
""",
    "legal_regulatory_death_verification": """
Assess from the member/beneficiary visit:
- Did the beneficiary provide the death certificate and post-mortem report?
- Is the beneficiary's account of circumstances consistent with hospital records?
- Were any supporting documents (burial certificate, police report) collected from the member?
- State the beneficiary's name, relationship to the deceased, and whether ID proof
  submitted matches the policy nominee (if this data is present in the member forms).
Return a single factual paragraph.
""",
    "financial_claim_pattern_risk": """
Assess from the insured verification form:
- What bill amount did the member state they paid?
- Does this match the hospital bill? If not, quantify the difference.
- Did the member mention any cash payment made outside the official bill?
- Did the field officer note any financial irregularities?
Return a single factual paragraph.
""",
    "medical_records_treatment_verification": """
Assess from the insured verification form and member interview only:
- Does the member's own account of symptoms, duration, and treatment received line up
  with what is documented in the hospital's chief complaints and diagnosis?
- Did the member mention any treatment, test, or medication that does NOT appear in
  the hospital record (or vice versa — a hospital-documented treatment the member
  seems unaware of)?
Return a single factual paragraph. If the member forms contain no clinical detail at
all, state that plainly rather than inferring anything.
""",
    "hospital_criteria_watchlist": """
Assess from the member/insured visit only what is relevant:
- Did the member's account of the hospital (name, location, how they chose it) match
  the hospital identified in the claim documents?
- Did the field officer's member-visit notes mention anything about the hospital's
  reputation, size, or facilities that is relevant to genuineness?
This is normally thin from the member side — if the member forms contain no hospital-
credential-relevant content, state that plainly in a single sentence rather than
speculating. Do not repeat hospital-side infrastructure findings here.
""",
    "policy_coverage_verification": """
Assess from the insured verification form and member interview only:
- Does the member correctly state their policy number, policy type, and relationship
  to the primary insured (self / spouse / child / parent / employee)?
- Did the member mention the claim mode (cashless vs reimbursement) and does it match
  what cashless_availed shows?
- Did the member mention a TPA name, pre-authorisation, or intimation to the insurer,
  and is the timing consistent with policy requirements?
- Is there any indication from the member interview of a recently purchased or
  short-duration policy relative to the claim date?
Return a single factual paragraph. State plainly if the member forms contain no
policy-detail content.
""",
    "field_vicinity_investigation": """
Assess from the field officer's residence-visit / vicinity-verification notes only:
- Was the claimant's residential address physically verified by field visit?
- Are neighbours or local contacts aware of the claimant and the hospitalisation/event?
- Was the claimant traceable and cooperative during the field visit?
- Did local inquiry produce any statement that contradicts the claimant's own account?
- For accident claims: was the incident locally known and independently confirmable?
Return a single factual paragraph, citing the field officer's name and any residence-
verification outcome recorded.
""",
    "employee_corporate_group_policy_verification": """
Assess from the member/insured-side documents and any employer/HR confirmation
recorded during the member visit:
- Did the member state their employer name, employee ID, department, and designation,
  and do these match the claim paperwork?
- Is there any explicit HR/employer confirmation of active employment recorded
  (employment_verification_done) — what was the outcome, verbatim?
- For a dependent claim: is the dependent's enrolment in the group policy declared,
  and is the relationship supported by a document (marriage/birth certificate) that the
  member produced?
- Did the field officer note anything suggesting the employment or enrolment might not
  be genuine (e.g. very recent joining date shortly before the claim)?
Return a single factual paragraph. State plainly if this data is not present in the
member-side documents.
""",
    "hospital_cash_benefit_abuse": """
Assess from the member/insured visit only what is relevant:
- Did the member's own account of the length of stay and reason for admission match
  what the hospital records show?
- Did the field officer note anything about the claimant's condition during or after
  the admission that seems inconsistent with the severity implied by the benefit claimed?
This is normally thin from the member side — if the member forms contain nothing
relevant to length-of-stay or benefit calculation, state that plainly rather than
speculating. Do not repeat the hospital-side LOS/ICU analysis here.
""",
    "suspicious_claim_pattern_repeat_fraud": """
Assess from the insured verification form and any identifiers recorded during the
member visit:
- What mobile number, address, bank account, Aadhaar/ID, and emergency contact did the
  member provide — do any of these look reused, generic, or inconsistent with other
  details in this same claim file?
- Did the member disclose any prior claims, other policies, or other hospitalisations
  not already captured in the hospital-side previous-claims data?
- Did the field officer note anything behavioral (claimant story changed, over-coached
  responses, delayed document production, uncooperativeness)? Only report this if it
  is explicitly recorded in field_officer_member_opinion — do not infer it.
Return a single factual paragraph. Note explicitly that behavioral indicators alone
are never sufficient on their own to establish fraud.
""",
    "final_universal_red_flags_matrix": """
Provide a rapid member-side-only red-flag scan across these dimensions, one clause
each, using CLEAR / FLAG / RED FLAG for each dimension (weave it into flowing prose,
no headers or bullets):
- Identity consistency (name/DOB/gender match across member forms and policy)
- Member account vs hospital record consistency (illness narration, bill amount, dates)
- Shared-identifier risk (mobile/address/bank/ID reused or inconsistent)
- Behavioral indicators explicitly recorded by the field officer (only if present)
Only flag an item RED FLAG if there is a specific, citable document fact supporting it.
If no member/insured documents contain relevant content for a dimension, mark it
CLEAR by default rather than RED FLAG — absence of member-side data is not itself
a red flag. Keep this dense and factual, 4-6 sentences.
""",
}

_DEFAULT_MEMBER_TRIGGER = """
Assess from the member/insured visit findings only what is relevant to this trigger.
Return a single factual paragraph. Do not repeat the member base findings.
"""

# Used verbatim as the per-trigger member "finding" when no member/insured
# document exists at all, so Call C sees an explicit statement instead of
# an empty/missing key.
_NO_MEMBER_VISIT_TRIGGER_FINDING = (
    "Member / insured visit was not conducted as part of this investigation, "
    "so no member-side findings are available for this trigger."
)


# ─────────────────────────────────────────────────────────────────────────────
# Helper: sync Groq wrapper
# ─────────────────────────────────────────────────────────────────────────────
def _groq(system: str, user: str, max_tokens: int = 4000) -> Dict[str, Any]:
    return call_groq_sync(system, user, max_tokens)


async def _agroq(system: str, user: str, max_tokens: int = 4000) -> Dict[str, Any]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _groq, system, user, max_tokens)


# ─────────────────────────────────────────────────────────────────────────────
# CALL A — Hospital base findings
# ─────────────────────────────────────────────────────────────────────────────
_HOSPITAL_BASE_SYSTEM = _BASE_SYSTEM + _CITATION_RULE + """
FOCUS: You are writing SECTION 1 — HOSPITAL PART FINDINGS.
Extract information ONLY from hospital-side content in the document:
  ICP (Indoor Case Papers), discharge summary, treating doctor certificate,
  operation theatre records, anaesthesia records, medication/vitals/nurses charts,
  hospital registration certificate, IP/OT/lab registers, in-patient bill.
IGNORE: Insured verification forms, member interview content, AVR forms,
  welfare/income certificates, any document obtained from the insured's residence.
"""

def _hospital_base_user(
    pass1: Dict[str, Any],
    preprocessed: Dict[str, Any],
    text: str,
) -> str:
    drug_rule = _drug_rule_for_case(pass1)
    return f"""
Return a JSON object with exactly these keys:
  "section1_prose": string  — full hospital findings paragraph (min 400 words)
  "discrepancies":  array   — list of specific discrepancy strings found in hospital records
                              (empty array [] if none)

WRITING RULES FOR section1_prose:
① Open with: "Our investigator visited the hospital, verified the ICP and collected the copy of the same."
   If physical_visit_confirmed is NO or null: "Documents were reviewed and ICP copy was collected."
② Patient: "[Name], a [age]-year-old [gender] (Guardian: [name if present]),
   admitted on [date] at [time] (IP No. [ip], UHID: [uhid])."
   Then: "Cashless availed — [YES/NO]." if known.
   Then: "MLC registered and collected." if mlc_registered = YES.
③ Chief complaints — ALL of them verbatim, never drop any:
   {json.dumps(preprocessed['complaints_list'], indent=2)}
④ OPD history before admission (exact wording if present).
⑤ Past history verbatim. If none: "No significant past history noted."
⑥ Vitals on admission (NEVER write "stable"):
   "{preprocessed['vitals_formatted'] or pass1.get('vitals_on_admission') or 'Not documented'}"
⑦ Provisional diagnosis verbatim.
⑧ Investigations ordered verbatim.
⑨ Final diagnosis — ALL lines verbatim:
   {json.dumps(pass1.get('final_diagnosis'), indent=2)}
⑩ For surgical cases: "Patient underwent [procedure] under [anaesthesia] on [date].
   Operation record is attached. Post-operative period was noted as uneventful."
⑪ ALL inpatient treatments by name:
   {json.dumps(pass1.get('all_treatments', []), indent=2)}
   DRUG SAFETY RULE: {drug_rule}
⑫ Discharge: "Patient was discharged on [date] at [time]."
⑬ Vitals at discharge (exact, NEVER mix with admission vitals):
   "{pass1.get('vitals_at_discharge') or 'Not documented'}"
⑭ Discharge medications (use exact drug names from the document, same DRUG
   SAFETY RULE applies — never invent or import from memory):
   {json.dumps(pass1.get('discharge_medications', []), indent=2)}
⑮ Bill — use EXACTLY these figures, in EXACTLY this format (do not paraphrase
   or reformat the numbers):
   "Gross bill amount — Rs.<value>/-"
   "Discount — Rs.<value>/-" (state Rs.0/- if nil, never omit this line)
   "Amount received — Rs.<value>/-"
   "Room tariff — Rs.<value>/- per day (<room_type>)" (omit room_type in
   parentheses if not documented)
   "Mode of payment — <mode>"
   Use these exact source values:
{preprocessed['bill_block']}
   Bill breakdown — list ALL line items (bed charges, professional charges,
   nursing, pharmacy, surgeon charges, OT charges, anaesthesia charges, lab,
   registration, others). If there are more than ~8 items, use a bullet list
   instead of a single run-on sentence. NEVER write "etc." or "…" to
   truncate the list — include every item or explicitly state
   "no detailed line-item breakup was provided."
   Bill line items:
   {json.dumps(pass1.get('bill_breakdown_items', []), indent=2)}
   If a bill/payment receipt is documented as attached, state:
   "Bill and payment receipts are attached."
   Include page references in -XX/52- format wherever present in the
   forensic audit facts.
⑯ Registers and certificates — follow this exactly, per register:
   IF flag = "YES"  → state "[register name] verified and attached."
   IF flag = "NO"   → state "[MISSING] [register name] — not collected."
   IF flag = null   → OMIT that register entirely from the prose. Do NOT
                       write "not documented" or "unknown" for it, and do
                       NOT count it toward any missing-registers list.
   NEVER write a blanket statement like "IP register, OT register, and lab
   register are verified and attached" unless ALL relevant flags are
   individually "YES" — always state each register in its own sentence or
   clause so partial verification is visible.

   IP register:  {preprocessed['register_flags']['ip']}
   OT register:  {preprocessed['register_flags']['ot']}
   Lab register: {preprocessed['register_flags']['lab']}
   Pharmacy:     {preprocessed['register_flags']['pharmacy']}
   Reg cert:     {preprocessed['register_flags']['reg_cert']}
   Tariff:       {pass1.get('tariff_attached') or 'null'}

⑰ Treating doctor: "Treating Doctor — Dr. [name] ([qual], Reg No. [num])."
⑱ Pathologist (if present): "Pathologist — [name] ([designation])."
⑲ Data collected from: "Data collected from [name], [designation], Ph: [phone]."
⑳ Field officer: "Field Officer: [name]."

PATIENT/ADMIN CONSTANTS:
  Physical visit:  {pass1.get('physical_visit_confirmed') or 'null'}
  Admission time:  {pass1.get('admission_time') or 'Not documented'}
  IP / UHID:       {pass1.get('ip_number') or pass1.get('uhid_number') or 'Not documented'}
  Guardian:        {pass1.get('guardian_name') or 'Not documented'}
  MLC registered:  {pass1.get('mlc_registered') or 'Not documented'}
  Cashless:        {pass1.get('cashless_availed') or 'Not documented'}
  Employer:        {pass1.get('employer_name') or 'Not documented'}
  Pathologist:     {pass1.get('pathologist_name') or 'Not documented'}, {pass1.get('pathologist_designation') or ''}
  Reg valid till:  {pass1.get('hospital_reg_valid_till') or 'Not documented'}
  Reg authority:   {pass1.get('hospital_reg_issuing_authority') or 'Not documented'}
  Treating doctor: {pass1.get('treating_doctor') or 'Not documented'}
  Doctor qual:     {pass1.get('doctor_qualification') or 'Not documented'}
  Doctor reg:      {pass1.get('doctor_reg_number') or 'Not documented'}
  Data from name:  {pass1.get('data_collected_from_name') or 'Not documented'}
  Data from desig: {pass1.get('data_collected_from_designation') or 'Not documented'}
  Data from phone: {pass1.get('data_collected_from_phone') or 'Not documented'}
  Field officer:   {pass1.get('field_officer_name') or 'Not documented'}

FORENSIC AUDIT FACTS:
{json.dumps(pass1, indent=2)}

FULL DOCUMENT TEXT (focus on hospital-side content only):
{text[:120000]}
"""


# ─────────────────────────────────────────────────────────────────────────────
# CALL A-trigger — Per-trigger hospital assessment
# ─────────────────────────────────────────────────────────────────────────────
def _hospital_trigger_user(
    trigger: str,
    pass1: Dict[str, Any],
    text: str,
    hospital_base_prose: str,
    annotations_block: str = "",
    preprocessed: Optional[Dict[str, Any]] = None,
    all_triggers: Optional[List[str]] = None,
) -> str:
    label = TRIGGER_LABELS.get(trigger, trigger)
    instruction = _HOSPITAL_TRIGGER_INSTRUCTIONS.get(trigger, _DEFAULT_HOSPITAL_TRIGGER)
    scope_block = _scope_discipline_block(trigger, all_triggers or [])

    # ── PED pre-check injection ────────────────────────────────────────
    ped_precheck_note = ""
    if trigger == "ped_non_disclosure" and preprocessed is not None:
        if preprocessed.get("ped_contradiction_detected"):
            ped_precheck_note = (
                "\nPYTHON PRE-CHECK RESULT: An intra-record contradiction was "
                "already detected — ped_mentioned_in_records contains both a "
                "'newly diagnosed'-type entry and a chronic marker (K/c/o / "
                "on medication / since X months/years) for what appears to be "
                "the same condition. You MUST report this as [CONTRADICTORY] "
                "in your finding.\n"
            )
        else:
            ped_precheck_note = (
                "\nPYTHON PRE-CHECK RESULT: No intra-record contradiction was "
                "detected by the automated pre-check. Do not claim one exists "
                "unless you find independent evidence in the document text.\n"
            )

    return f"""
TRIGGER: {label}

Return a JSON object with exactly these keys:
  "finding":       string — one paragraph (3-6 sentences) of trigger-specific findings
                            from the HOSPITAL RECORDS ONLY.
  "discrepancies": array  — list of specific discrepancy strings found relevant to
                            this trigger in hospital records. Empty array [] if none.
                            Use tags: [MISSING] [INCOMPLETE] [CONTRADICTORY] [SUSPICIOUS]
                            [BILLING MISMATCH] [TIMELINE MISMATCH] [SINGLE STRETCH]

TRIGGER ASSESSMENT INSTRUCTION:
{instruction}
{ped_precheck_note}
{scope_block}
CITATION REMINDER: cite (Source: filename.pdf, Page N) after each group of
consecutive sentences drawn from the same document/page, as instructed in
the system prompt.

{annotations_block}
If any reviewer annotation above relates to this trigger and to hospital-side
records, address it directly in "finding" with your own reasoning — state what
the hospital record actually shows in relation to the flagged point.

HOSPITAL BASE FINDINGS (already written — do NOT repeat these facts):
{hospital_base_prose[:3000]}

FORENSIC AUDIT FACTS:
{json.dumps(pass1, indent=2)[:4000]}

FULL DOCUMENT TEXT (hospital-side content only):
{text[:40000]}
"""

# ─────────────────────────────────────────────────────────────────────────────
# CALL B — Member/insured base findings
# ─────────────────────────────────────────────────────────────────────────────
_MEMBER_BASE_SYSTEM = _BASE_SYSTEM + _CITATION_RULE + """
You are writing SECTION 2 — MEMBER / INSURED VISIT FINDINGS.

The primary sources for this section are the "Insured Verification Form" and the "Patient Feedback Form".
These forms are the official record of the member/insured visit. They contain structured data such as:
- Patient & proposer details, age, relation
- Symptoms, duration, first consultation
- Past medical history (DM, HTN, etc.)
- Regular medications, lifestyle habits (smoking, alcohol)
- Bill amount stated by the insured
- Field officer’s remarks and observations

RULES:
- This function is ONLY ever called when a real Insured Verification Form /
  Patient Feedback Form / other member-side document has already been
  confirmed present in the source text — you do not need to guess whether
  a visit happened.
- Write a detailed, factual paragraph (min 300 words) synthesising ALL the data from these forms.
- If a field is missing, write "Not mentioned" or "Not documented."
- If, after reviewing the provided text, it does not actually contain an Insured
  Verification Form or Patient Feedback Form (only incidental phrases matched),
  set "section2_prose" to exactly:
  "Member / insured visit was not conducted as part of this investigation, so no
  member-side findings are available." and return an empty discrepancies array."""

def _member_base_user(
    pass1: Dict[str, Any],
    extracted_flat: Dict[str, Any],
    text: str,
) -> str:
    # Combine member-related fields from both sources
    combined = {**extracted_flat, **pass1}
    explicit_fields = {
        "patient_name": combined.get("patient_name") or combined.get("name_of_patient"),
        "patient_age": combined.get("patient_age"),
        "relation_with_patient": combined.get("relation_with_patient"),
        "symptoms_complaints": combined.get("symptoms_complaints"),
        "past_medical_history": combined.get("past_medical_history") or combined.get("medical_history"),
        "regular_medications": combined.get("regular_medications"),
        "lifestyle_habits": combined.get("lifestyle_habits"),
        "stated_bill_amount": combined.get("patient_stated_bill_amount"),
        "field_officer_member_opinion": combined.get("field_officer_member_opinion"),
        "insured_address": combined.get("insured_address") or combined.get("patient_address"),
        "field_officer_name": combined.get("field_officer_name"),
    }

    return f"""
Return a JSON object with exactly these keys:
  "section2_prose": string (minimum 300 words) — the full member visit findings paragraph.
  "discrepancies":  array — list of discrepancies found in member-side content.

IMPORTANT: The document CONTAINS the Insured Verification Form and Patient Feedback Form.
The following data has ALREADY been extracted from these forms. 
You MUST compose Section 2 using this data. Do NOT say the visit was not conducted.

EXTRACTED FORM DATA:
{json.dumps(explicit_fields, indent=2)}

WRITING INSTRUCTIONS FOR SECTION 2:
① Open with: "Our investigator conducted a member/insured visit and collected the Insured Verification Form."
   If the field officer name is present, include it: "The visit was conducted by [FO Name]."
② State the patient's name, age, and relationship with the proposer/guardian.
③ Describe the insured's account of the illness/symptoms exactly as stated in the form.
④ Detail the past medical history, regular medications, and lifestyle habits disclosed (or denied).
⑤ Mention the bill amount the insured stated they paid.
⑥ Include the field officer's observations and opinions.
⑦ List any supporting documents collected (Aadhaar, prescriptions, etc.).
⑧ Note any inconsistencies (e.g., stated bill vs hospital bill, history denied but hospital record suggests PED).

FULL MEMBER DOCUMENT TEXT (for additional context):
{text[:80000]}
"""


# ─────────────────────────────────────────────────────────────────────────────
# CALL B-trigger — Per-trigger member assessment
# ─────────────────────────────────────────────────────────────────────────────
def _member_trigger_user(
    trigger: str,
    pass1: Dict[str, Any],
    text: str,
    member_base_prose: str,
    annotations_block: str = "",
    preprocessed: Optional[Dict[str, Any]] = None,
    all_triggers: Optional[List[str]] = None,
) -> str:
    label = TRIGGER_LABELS.get(trigger, trigger)
    instruction = _MEMBER_TRIGGER_INSTRUCTIONS.get(trigger, _DEFAULT_MEMBER_TRIGGER)
    scope_block = _scope_discipline_block(trigger, all_triggers or [])

    if trigger == "ped_non_disclosure":
        instruction += """
   IMPORTANT: The Insured Verification Form contains a "Past medical history" table. 
   Check if the insured marked YES/NO for conditions like Diabetes, Hypertension, etc. 
   Also check the "Self-Declaration" for any mention of pre-existing illness. 
   If the table has NO in all rows but the hospital ICP lists chronic conditions, 
   flag it as [UNDISCLOSED PED SUSPECTED].
   """
    elif trigger == "claim_genuinity_authenticity":
        instruction += """
   IMPORTANT: The Insured Verification Form has fields: Symptoms, Duration, First consultation, 
   and the insured's bill amount. Cross‑check these with the hospital records. 
   Look for the "Field officer member opinion" section for any red flags.
   """

    # ── PED pre-check injection ────────────────────────────────────────
    ped_precheck_note = ""
    if trigger == "ped_non_disclosure" and preprocessed is not None:
        if preprocessed.get("ped_contradiction_detected"):
            ped_precheck_note = (
                "\nPYTHON PRE-CHECK RESULT: An intra-record contradiction was "
                "already detected in the hospital-side records — treat any "
                "member-side denial of the same condition as a fact to report, "
                "not as evidence of intent. Do NOT use words like 'hiding' or "
                "'concealed' unless the field officer opinion or "
                "discrepancies_verbatim explicitly uses them.\n"
            )
        else:
            ped_precheck_note = (
                "\nPYTHON PRE-CHECK RESULT: No intra-record contradiction was "
                "detected by the automated pre-check.\n"
            )

    return f"""
TRIGGER: {label}

Return a JSON object with exactly these keys:
  "finding":       string — one paragraph (3-6 sentences) of trigger-specific findings
                            from the MEMBER / INSURED VISIT CONTENT ONLY.
  "discrepancies": array  — specific discrepancy strings relevant to this trigger

TRIGGER ASSESSMENT INSTRUCTION:
{instruction}
{ped_precheck_note}
{scope_block}
CITATION REMINDER: cite (Source: filename.pdf, Page N) after each group of
consecutive sentences drawn from the same document/page, as instructed in
the system prompt.

{annotations_block}
If any reviewer annotation above relates to this trigger and to member-side
records, address it directly in "finding" with your own reasoning — state what
the member visit / insured form actually shows in relation to the flagged point.

MEMBER BASE FINDINGS (already written — do NOT repeat these facts):
{member_base_prose[:3000]}

EXTRACTED FORM DATA:
{json.dumps(pass1, indent=2)[:3000]}

MEMBER DOCUMENT TEXT (filtered member forms only):
{text[:40000]}
"""
# ─────────────────────────────────────────────────────────────────────────────
# CALL C — Reconciled conclusion
# ─────────────────────────────────────────────────────────────────────────────
_RECONCILE_SYSTEM = _BASE_SYSTEM + """
You are writing SECTION 3 — CONCLUSION for a formal insurance investigation report.
You receive the complete Section 1 (hospital findings) and Section 2 (member findings)
already written, plus per-trigger assessments from both sides.
Your job is ONLY to write Section 3 — do not re-state facts already in Sections 1 or 2.

CITATION RULE FOR SECTION 3 (different from Sections 1 & 2):
Do NOT use "(Source: filename.pdf, Page N)" citations here — Section 1 and
Section 2 already carry those. When you reference a fact that was
established earlier, cite the SECTION instead, e.g.:
  "as noted in Section 1" or "as noted in Section 2"
placed inline in the sentence, not as a trailing parenthetical tag.
"""

def _reconcile_user(
    triggers: List[str],
    section1: str,
    section2: str,
    hospital_trigger_findings: Dict[str, Dict],
    member_trigger_findings: Dict[str, Dict],
    all_discrepancies: List[str],
    pass1: Dict[str, Any],
    preprocessed: Dict[str, Any],
    disc_block: str,
    annotations_block: str = "",
) -> str:
    trigger_summaries = []
    for t in triggers:
        label = TRIGGER_LABELS.get(t, t)
        h = hospital_trigger_findings.get(t, {})
        m = member_trigger_findings.get(t, {})
        trigger_summaries.append(
            f"TRIGGER: {label}\n"
            f"  Hospital side: {h.get('finding', 'No findings')}\n"
            f"  Member side:   {m.get('finding', 'No findings')}"
        )

    return f"""
Return a JSON object with exactly these keys:
  "section3_prose": string — the full Section 3 conclusion text
  "verdict":        string — exactly "GENUINE" or "SUSPECTED"

SECTION 3 STRUCTURE:

A. DISCREPANCIES
   Write out this exact text as your DISCREPANCIES content — do not add any
   marker, tag, or wrapper text of your own around it, and do not paraphrase
   or reformat it in any way:
   {disc_block}
   If the text above is literally "None", write instead: "No major discrepancies were noted."
   Then append these auto-detected flags if not already present:
   {chr(10).join(all_discrepancies) or "   (none)"}

B. TRIGGER ASSESSMENT
   For each trigger below, write ONE natural prose paragraph (4-6 sentences) that:
   - Synthesises the hospital-side and member-side findings
   - Explicitly calls out any CONTRADICTION between the two sides
     (e.g. "The hospital ICP records DM since 5 years, however the member denied
      any pre-existing condition during the insured visit — this constitutes an
      undisclosed pre-existing condition.")
   - References facts with "as noted in Section 1" / "as noted in Section 2" —
     do NOT use "(Source: filename.pdf, Page N)" citations in this section.
   - Ends with a one-sentence interim assessment for this trigger
   - Stays within its OWN trigger's subject matter — if a fact belongs to a
     different trigger in this same list (e.g. alcohol/intoxication belongs to
     "Intoxication / Addiction"), do not re-analyse it here; a brief factual
     mention in passing is fine, but the full analysis belongs only in that
     trigger's own paragraph.

   TRIGGER FINDINGS TO SYNTHESISE:
   {chr(10).join(trigger_summaries)}

{annotations_block}
C. REVIEWER ANNOTATIONS — MANDATORY
   If any reviewer annotations are listed above, add a short dedicated subsection
   after the trigger assessments, titled "REVIEWER POINTS ADDRESSED". For each
   annotation, write 1-3 sentences that:
   - State what the annotation flagged
   - Reason about it against the hospital/member findings and forensic audit facts
     already available to you (do not invent new facts)
   - State explicitly whether the record supports, contradicts, or is silent on it
   Do NOT just repeat the reviewer's note verbatim — show your own analysis.
   If there are no reviewer annotations, omit this subsection entirely.

D. FINAL VERDICT (one sentence)
   Use this EXACTLY if provided (non-null):
   final_verdict_verbatim = {pass1.get('final_verdict_verbatim') or 'null'}

   If null, use one of:
   GENUINE:   "Hence based on the above findings, the claim is found to be Genuine and recommended for settlement."
   SUSPECTED: "Hence based on the above discrepancies, the claim seems to be Suspected."

VERDICT DECISION RULES (in priority order):
1. If the DISCREPANCY BLOCK or raw document contains "suspected" → SUSPECTED
2. If hospital and member sides CONTRADICT each other on a material fact
   (PED disclosure, accident narration, bill amount) → SUSPECTED
3. If verdict_override below is SUSPECTED → SUSPECTED
4. Otherwise → GENUINE

verdict_override from preprocessor: {preprocessed['verdict_override']}

SECTION 1 ALREADY WRITTEN (reference only, do not repeat):
{section1[:4000]}

SECTION 2 ALREADY WRITTEN (reference only, do not repeat):
{section2[:2000]}

FORENSIC AUDIT FACTS:
{json.dumps(pass1, indent=2)[:3000]}
"""

# ─────────────────────────────────────────────────────────────────────────────
# Orchestrator
# ─────────────────────────────────────────────────────────────────────────────
async def generate_unified_conclusion(
    triggers: List[str],
    text: str,
    pass1_result: Dict[str, Any],
    extracted_flat: Dict[str, Any],
    preprocessed: Dict[str, Any],
    additional_context: str = "",
) -> str:
    """
    Three-call pipeline: A (hospital base + per-trigger) → B (member base +
    per-trigger) → C (reconciled conclusion). A and B run concurrently.
    Returns the combined three-section conclusion string.
    """
    pass1_result = _make_serializable(pass1_result)
    annotations = parse_reviewer_annotations(additional_context)
    annotations_block = _format_annotations_for_llm(annotations)

    # ── Discrepancy block ────────────────────────────────────────────────
    disc_block = (
        preprocessed.get("_effective_disc_block")
        or pass1_result.get("discrepancies_verbatim")
        or ""
    )
    auto_flags = preprocessed.get("auto_discrepancies") or []
    if auto_flags and not disc_block:
        disc_block = "Kindly note —\n" + "\n".join(auto_flags)
    elif auto_flags and disc_block:
        existing_lower = disc_block.lower()
        new_flags = [f for f in auto_flags if f.lower()[:30] not in existing_lower]
        if new_flags:
            disc_block = disc_block + "\n" + "\n".join(new_flags)
    if not disc_block:
        disc_block = "None"

    # ── All discrepancies for reconcile call ─────────────────────────────
    all_disc_list: List[str] = []
    if disc_block != "None":
        all_disc_list.append(disc_block)

    # ── Determine whether a real member/insured document exists at all ───
    # This gate is what prevents Call B from fabricating a member-visit
    # section when no such visit was ever conducted. Only if this is True
    # do we filter the text and run the member-side LLM calls.
    member_present = has_member_documents(text)
    member_text = extract_member_text(text) if member_present else ""

    # ── CONCURRENT: Call A (hospital base) + Call B (member base, if any) ─
    hospital_base_task = _agroq(
        _HOSPITAL_BASE_SYSTEM,
        _hospital_base_user(pass1_result, preprocessed, text),
        max_tokens=5000,
    )

    hospital_base_prose = ""
    hospital_base_disc: List[str] = []
    member_base_prose = ""
    member_base_disc: List[str] = []

    if member_present:
        member_base_task = _agroq(
            _MEMBER_BASE_SYSTEM,
            _member_base_user(pass1_result, extracted_flat, member_text),
            max_tokens=4000,
        )
        hospital_base_raw, member_base_raw = await asyncio.gather(
            hospital_base_task, member_base_task, return_exceptions=True
        )

        if isinstance(hospital_base_raw, dict):
            hospital_base_prose = hospital_base_raw.get("section1_prose") or ""
            hospital_base_disc = hospital_base_raw.get("discrepancies") or []

        if isinstance(member_base_raw, dict):
            member_base_prose = member_base_raw.get("section2_prose") or ""
            member_base_disc = member_base_raw.get("discrepancies") or []
        else:
            # Retry once with a simpler, more directive prompt — only makes
            # sense to retry when we already know member documents exist.
            logger.warning("Member base call failed – retrying with fallback prompt")
            fallback_user = f"""
The document contains Insured Verification Forms and Patient Feedback Forms. 
These forms are the primary record of the member visit. 
Extract ALL details from them: insured's name, age, claim number, symptoms, 
medical history disclosed, bill amount stated, field officer remarks, 
and any inconsistencies.
Return JSON with "section2_prose" (at least 400 words) and "discrepancies".

Document text:
{member_text[:80000]}
"""
            retry_raw = await _agroq(
                _MEMBER_BASE_SYSTEM,
                fallback_user,
                max_tokens=4000,
            )
            if isinstance(retry_raw, dict):
                member_base_prose = retry_raw.get("section2_prose") or ""
                member_base_disc = retry_raw.get("discrepancies") or []
    else:
        # No member/insured document detected at all — skip the LLM call
        # entirely rather than risk fabrication.
        logger.info("No member/insured documents detected — skipping Call B")
        hospital_base_raw = await hospital_base_task
        if isinstance(hospital_base_raw, dict):
            hospital_base_prose = hospital_base_raw.get("section1_prose") or ""
            hospital_base_disc = hospital_base_raw.get("discrepancies") or []

    if not hospital_base_prose:
        logger.warning("Hospital base call returned empty — using fallback")
        hospital_base_prose = "[Hospital findings could not be generated. Please retry.]"

    if not member_base_prose:
        member_base_prose = "Member / insured visit was not conducted as part of this investigation."

    all_disc_list.extend(hospital_base_disc)
    all_disc_list.extend(member_base_disc)

    # ── CONCURRENT: Per-trigger hospital + member calls ───────────────────
    hospital_trigger_tasks = {
        t: _agroq(
            _HOSPITAL_BASE_SYSTEM,
            _hospital_trigger_user(
                t, pass1_result, text, hospital_base_prose, annotations_block,
                preprocessed=preprocessed, all_triggers=triggers,
            ),
            max_tokens=1500,
        )
        for t in triggers
    }

    all_trigger_keys = list(hospital_trigger_tasks.keys())
    hospital_results = await asyncio.gather(
        *[hospital_trigger_tasks[t] for t in all_trigger_keys],
        return_exceptions=True,
    )

    hospital_trigger_findings: Dict[str, Dict] = {}
    member_trigger_findings: Dict[str, Dict] = {}

    if member_present:
        member_trigger_tasks = {
            t: _agroq(
                _MEMBER_BASE_SYSTEM,
                _member_trigger_user(
                    t, pass1_result, member_text, member_base_prose, annotations_block,
                    preprocessed=preprocessed, all_triggers=triggers,
                ),
                max_tokens=1500,
            )
            for t in triggers
        }
        member_results = await asyncio.gather(
            *[member_trigger_tasks[t] for t in all_trigger_keys],
            return_exceptions=True,
        )
        for t, h_raw, m_raw in zip(all_trigger_keys, hospital_results, member_results):
            h = h_raw if isinstance(h_raw, dict) else {}
            m = m_raw if isinstance(m_raw, dict) else {}
            hospital_trigger_findings[t] = h
            member_trigger_findings[t] = m
            all_disc_list.extend(h.get("discrepancies") or [])
            all_disc_list.extend(m.get("discrepancies") or [])
    else:
        # No member documents — don't call the member-trigger LLM at all,
        # just record an explicit "not conducted" finding per trigger so
        # Call C sees a clear statement instead of an empty key.
        for t, h_raw in zip(all_trigger_keys, hospital_results):
            h = h_raw if isinstance(h_raw, dict) else {}
            hospital_trigger_findings[t] = h
            member_trigger_findings[t] = {"finding": _NO_MEMBER_VISIT_TRIGGER_FINDING, "discrepancies": []}
            all_disc_list.extend(h.get("discrepancies") or [])

    # Deduplicate discrepancies
    seen = set()
    unique_discs: List[str] = []
    for d in all_disc_list:
        key = d.strip().lower()[:60]
        if key not in seen:
            seen.add(key)
            unique_discs.append(d)

    # ── Append trigger findings into section prose ────────────────────────
    if hospital_trigger_findings:
        section1_parts = [hospital_base_prose]
        for t in triggers:
            label = TRIGGER_LABELS.get(t, t)
            finding = hospital_trigger_findings.get(t, {}).get("finding", "")
            if finding:
                section1_parts.append(
                    f"\n{label} — Hospital Assessment\n{finding}"
                )
        section1_full = "\n".join(section1_parts)
    else:
        section1_full = hospital_base_prose

    if member_present and member_trigger_findings:
        section2_parts = [member_base_prose]
        for t in triggers:
            label = TRIGGER_LABELS.get(t, t)
            finding = member_trigger_findings.get(t, {}).get("finding", "")
            if finding:
                section2_parts.append(
                    f"\n{label} — Member Assessment\n{finding}"
                )
        section2_full = "\n".join(section2_parts)
    else:
        section2_full = member_base_prose

    # ── Call C — Reconciled conclusion ───────────────────────────────────
    reconcile_raw = await _agroq(
        _RECONCILE_SYSTEM,
        _reconcile_user(
            triggers,
            section1_full,
            section2_full,
            hospital_trigger_findings,
            member_trigger_findings,
            unique_discs,
            pass1_result,
            preprocessed,
            disc_block,
            annotations_block,

        ),
        max_tokens=4000,
    )

    section3_prose = ""
    llm_verdict = preprocessed["verdict_override"]
    if isinstance(reconcile_raw, dict):
        section3_prose = reconcile_raw.get("section3_prose") or ""
        llm_verdict_raw = (reconcile_raw.get("verdict") or "").upper()
        if llm_verdict_raw in ("GENUINE", "SUSPECTED"):
            # If preprocessor says SUSPECTED, never let LLM override to GENUINE
            if preprocessed["verdict_override"] == "SUSPECTED":
                llm_verdict = "SUSPECTED"
            else:
                llm_verdict = llm_verdict_raw

    if not section3_prose:
        logger.warning("Reconcile call returned empty section3 — building fallback")
        disc_text = disc_block if disc_block != "None" else "No major discrepancies were noted."
        section3_prose = (
            f"DISCREPANCIES\n{disc_text}\n\n"
            f"Based on the hospital and member visit findings documented above, "
            f"the claim has been assessed across the selected triggers. "
        )
        if llm_verdict == "SUSPECTED":
            section3_prose += "Hence based on the above discrepancies, the claim seems to be Suspected."
        else:
            section3_prose += "Hence based on the above findings, the claim is found to be Genuine and recommended for settlement."

    # ── Assemble final conclusion ─────────────────────────────────────────
    conclusion = (
        "SECTION 1 — HOSPITAL PART FINDINGS\n\n"
        f"{section1_full}\n\n\n"
        "SECTION 2 — MEMBER / INSURED VISIT FINDINGS\n\n"
        f"{section2_full}\n\n\n"
        "SECTION 3 — CONCLUSION\n\n"
        f"{section3_prose}"
    )

    # ── Verdict safeguard ─────────────────────────────────────────────────
    raw_lower = text.lower()
    conclusion_lower = conclusion.lower()
    if preprocessed["verdict_override"] == "SUSPECTED" or re.search(
        r"(claim seems to be|found to be)[^\n]*suspected", raw_lower
    ):
        if "genuine" in conclusion_lower and "suspected" not in conclusion_lower:
            logger.warning("Forcing SUSPECTED verdict for case")
            conclusion = re.sub(
                r"(?i)(found to be Genuine.*?settlement\.?|"
                r"claim is found to be Genuine[^.]*\.)",
                "claim seems to be Suspected.",
                conclusion,
                count=1,
            )

    conclusion = reconcile_conclusion(conclusion, pass1_result, annotations)

    logger.info(
        "generate_unified_conclusion | triggers=%s | calls=%d | chars=%d | member_present=%s",
        triggers,
        2 + len(triggers) * 2 + 1,
        len(conclusion),
        member_present,
    )
    return conclusion