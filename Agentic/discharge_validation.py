"""
CCGI Discharge Summary Validation Pipeline — Evidence-Based Multi-Agent System
===============================================================================
v4.1.0  (patched)

MASTER RULE: THIS IS AN AUDIT SYSTEM, NOT A DIAGNOSTIC SYSTEM.
Every finding must be backed by explicit evidence from day_wise_timeline.
Nothing is invented, inferred, assumed, or predicted.

PATCH NOTES (v4.1.0):
  • VA1A — added SKIP-IF-SELF-RESULTED rule: an investigation name that already
           has its result/finding/diagnosis reported in the SAME document is
           NOT extracted as an "order" (fixes false positives like CT Urogram,
           PET-CT, TURBT, Histopathology being flagged pending when the result
           is in the very same report).
  • VA1B — added SAME-DOCUMENT MATCH RULE + SEMANTIC/PROCEDURE-EQUIVALENCE RULE
           (e.g., "Suggested cystoscopy" is fulfilled by a later TURBT;
           "HPE correlation" is fulfilled by the Histopathology/Biopsy Report).
           VA1B must now reason about clinical equivalence, not just literal
           string matching, before marking anything pending.
  • VA9  — added MANDATORY CODING RULE: every diagnosis VA4 confirmed as
           supported_by_timeline=true MUST receive an ICD-10 code attempt.
           Silent omission is forbidden — if a code cannot be confidently
           assigned, VA9 must emit a cdi_query explaining the gap instead of
           dropping the diagnosis from suggested_icd10_codes.

INPUT  : mongo_db["discharge_summaries"] → day_wise_timeline (JSON)
OUTPUT :
  • mongo_db["discharge_validations"]
  • Structured validation report (machine-readable JSON for frontend)

═══════════════════════════════════════════════════════════════
AGENTS (v4.1.0)
═══════════════════════════════════════════════════════════════

INVESTIGATION (DUAL-AGENT VERIFICATION):
  VA1A · InvestigationOrderExtractorAgent  — reads every order/recommendation in timeline,
                                             extracts what was ordered (labs, histo, imaging,
                                             cultures, biopsies, special tests like P67, HbA1c…)
                                             EXCLUDING anything already self-resulted in the
                                             same document.
  VA1B · InvestigationResultVerifierAgent  — cross-checks VA1A's order list against the FULL
                                             timeline (same-document + semantic/procedure
                                             equivalence matching) to confirm which orders have
                                             results, which are pending, and audits abnormal
                                             values. This dual pass eliminates false "pending"
                                             flags and catches orders hidden in doctor notes
                                             (e.g., "send P67", "HPE of specimen").

CLINICAL AUDIT AGENTS:
  VA2  · MedicationReconciliationAgent     — evidence-based medication audit (enhanced: BPMH gap)
  VA3  · ProcedureSurgeryAgent             — evidence-based procedure audit
  VA4  · ClinicalConsistencyAgent          — discharge summary accuracy audit
  VA5  · DischargeReadinessAgent           — evidence-based stability + social domain
  VA6  · FollowUpAgent                     — evidence-based follow-up audit

NEW AGENTS (v4.0.0 — previously missing):
  VA8  · SafetyAllergyAgent                — P3 safety flags: allergy, drug toxicity,
                                             inappropriate IV lines / catheters, HAC detection
  VA9  · CodingBillingAgent                — P6 ICD-10 code suggestion (MANDATORY per confirmed
                                             diagnosis), DRG band, CC/MCC, HAC exclusion,
                                             CDI query list
  VA10 · InsuranceDocumentAgent            — P7 pre-auth summary, LoS justification,
                                             medical necessity, claims package elements
  VA11 · PostDischargeMonitoringAgent      — P9 Day-2/7/30 question sets, high-risk flags,
                                             escalation triggers, readmission risk indicators

FINAL:
  VA7  · FinalAuditAgent                   — aggregation + frontend-ready report

═══════════════════════════════════════════════════════════════
CONCURRENCY:
  VA1A → VA1B (sequential — B depends on A's order list)
  VA1B + VA2 + VA3 → parallel  (VA1A+1B run as a sub-pipeline, result merges before VA2/3)
  VA1A+VA1B, VA2, VA3, VA8 → all four run in parallel first wave
  VA4 → VA5 → VA6 → VA9 → VA10 → VA11 → VA7 → sequential second wave

═══════════════════════════════════════════════════════════════
FRONTEND JSON FIELDS (per agent):
  VA1A: ordered_investigations (all extracted orders with source + date)
  VA1B: resulted_investigations, pending_investigations, abnormal_values_documented,
        investigation_trends, findings_comparison, active_concerns_evidence_based,
        verification_summary, issues
  VA2:  documented_medications, medications_stopped, dose_changes,
        high_risk_medications_documented, iv_to_oral_switch, prn_medications,
        medication_trends, bpmh_gap_noted, issues
  VA3:  procedures_classified, surgical_documentation_audit, specimens_tracking,
        complications_documented, disease_timeline, imaging_results_summary, issues
  VA4:  diagnoses_accuracy, factual_errors, documented_events_missing_from_summary,
        nursing_observations_captured, active_concerns_evidence_based,
        findings_comparison, positive_findings, issues
  VA5:  vital_signs_documented_near_discharge, lab_values_documented_near_discharge,
        symptom_control_evidence, devices_documented, mobility_status_documented,
        social_environment_domain, deterioration_events_documented,
        discharge_appropriateness, clinical_stability_score, issues
  VA6:  documented_followup_plans, pending_investigations_requiring_review,
        guideline_required_followup_for_confirmed_diagnoses,
        patient_education_documented, red_flag_symptoms_documented,
        missing_critical_followup, issues
  VA7:  categorised_issues, issue_counts, active_critical_concerns_summary,
        disease_timeline_narrative, findings_comparison_table,
        discharge_readiness_verdict, priority_action_list, scores,
        approved_for_clinical_use, audit_conclusion
  VA8:  allergy_flags, drug_toxicity_flags, inappropriate_device_flags,
        hospital_acquired_conditions, issues
  VA9:  suggested_icd10_codes, suggested_procedure_codes, drg_band,
        cc_mcc_captured, hac_exclusion_review, cdi_queries, issues
  VA10: preauth_summary, los_justification, medical_necessity_letter,
        discharge_summary_payer_format, claims_package_elements, issues
  VA11: day2_questions, day7_questions, day30_questions,
        high_risk_flags, escalation_triggers, readmission_risk_indicators, issues
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, TypedDict

from fastapi import APIRouter, HTTPException
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel

from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import StateGraph, END


# ═══════════════════════════════════════════════════════════════
# ENVIRONMENT
# ═══════════════════════════════════════════════════════════════

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
MONGO_URI    = os.getenv("MONGO_URI")
MONGO_DB     = os.getenv("MONGO_DB", "doctorassistai")

mongo_client = AsyncIOMotorClient(MONGO_URI)
mongo_db     = mongo_client[MONGO_DB]

llm_heavy = ChatGroq(
    model        = "llama-3.3-70b-versatile",
    temperature  = 0.0,
    max_tokens   = 8000,
    groq_api_key = GROQ_API_KEY,
)

llm_light = ChatGroq(
    model        = "llama-3.1-8b-instant",
    temperature  = 0.0,
    max_tokens   = 6500,
    groq_api_key = GROQ_API_KEY,
)

router = APIRouter(prefix="", tags=["Discharge Validation v4"])


# ═══════════════════════════════════════════════════════════════
# REQUEST / RESPONSE MODELS
# ═══════════════════════════════════════════════════════════════

class ValidationRequest(BaseModel):
    patient_id: str
    doctor_id:  str
    specialty:  str


# ═══════════════════════════════════════════════════════════════
# PIPELINE STATE
# ═══════════════════════════════════════════════════════════════

class ValidationState(TypedDict):
    patient_id:  str
    doctor_id:   str
    specialty:   str

    # Loaded from MongoDB
    day_wise_timeline:  List[Dict]
    discharge_summary:  str
    admission_reason:   Optional[str]
    admission_date:     Optional[str]
    patient_name:       Optional[str]
    patient_dob:        Optional[str]
    patient_sex:        Optional[str]

    # Agent outputs
    investigation_order_report:   Optional[Dict]   # VA1A
    investigation_result_report:  Optional[Dict]   # VA1B
    medication_report:            Optional[Dict]   # VA2
    procedure_report:             Optional[Dict]   # VA3
    consistency_report:           Optional[Dict]   # VA4
    readiness_report:             Optional[Dict]   # VA5
    followup_report:              Optional[Dict]   # VA6
    final_audit:                  Optional[Dict]   # VA7
    safety_allergy_report:        Optional[Dict]   # VA8
    coding_billing_report:        Optional[Dict]   # VA9
    insurance_document_report:    Optional[Dict]   # VA10
    post_discharge_report:        Optional[Dict]   # VA11

    errors:        List[str]
    agent_timings: Dict[str, float]


# ═══════════════════════════════════════════════════════════════
# MASTER PROMPT BLOCK — injected into every agent
# ═══════════════════════════════════════════════════════════════

MASTER_AUDIT_RULES = """
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MASTER AUDIT RULES — APPLY WITHOUT EXCEPTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

THIS IS AN AUDIT SYSTEM — NOT A DIAGNOSTIC SYSTEM.
You MUST NOT invent, infer, assume, predict, or create any clinical finding
that is not explicitly present in the provided day_wise_timeline data.

RULE 1 — NO INVENTED FINDINGS
If evidence does not exist in the source data:
  • Do NOT create a diagnosis
  • Do NOT create a complication
  • Do NOT create a symptom
  • Do NOT create a laboratory abnormality
  • Do NOT create a patient safety concern
  Instead output: "status": "not_documented" or "status": "unknown"

RULE 2 — NO ASSUMED CLINICAL STATES
NEVER generate statements such as:
  ✗ Unresolved anaemia           ✗ Untreated hypotension
  ✗ Pending critical labs        ✗ Clinical deterioration
  ✗ Sepsis risk                  ✗ Respiratory failure
  ✗ Bleeding                     ✗ Infection
UNLESS explicit evidence with source document and date supports it.
If evidence is absent: { "issue":"Cannot determine", "reason":"No evidence found in source documents" }

RULE 3 — EVERY FINDING NEEDS EVIDENCE
Required schema for every finding:
  { "finding":"...", "evidence":"exact text from source", "source_document":"filename", "date":"YYYY-MM-DD or unknown" }
If evidence field is empty → DO NOT output the finding.

RULE 4 — ISSUE SCHEMA (mandatory fields)
Every issue MUST contain:
  {
    "severity":         "Critical|Major|Moderate|Minor",
    "category":         "...",
    "description":      "...",
    "evidence":         "exact text from source document",
    "source_document":  "filename",
    "date":             "YYYY-MM-DD or unknown",
    "confidence_score": 0.0,
    "recommendation":   "..."
  }

RULE 5 — CONFIDENCE SCORES
  1.0  = explicit, unambiguous evidence in one document
  0.75 = supported by multiple documents
  0.5  = partial evidence (some fields present, some missing)
  0.25 = weak or indirect evidence
  0.0  = no evidence
DO NOT output any finding with confidence_score below 0.75.

RULE 6 — STATUS VALUES (use only these)
  "resolved"            — documented with management recorded
  "partially_addressed" — documented but management incomplete
  "unresolved"          — documented problem with NO management recorded
  "not_documented"      — information was expected but absent
  "unknown"             — cannot determine from available records
  Never invent other status values.

RULE 7 — LABEL DEFINITIONS
  NOT_DOCUMENTED: Information was expected for this type of case but is absent from records.
  UNKNOWN:        Cannot determine — records do not contain enough information.
  UNRESOLVED:     A problem was documented but no management action was recorded.

ALLOWED OUTPUT WORDS:
  ✓ Missing  ✓ Not documented  ✓ Unknown  ✓ Cannot determine  ✓ Requires review

FORBIDDEN CLINICAL WORDS without explicit evidence:
  ✗ Anaemia  ✗ Hypotension  ✗ Sepsis  ✗ Deterioration  ✗ Bleeding
  ✗ Infection  ✗ Respiratory failure  ✗ Clinical instability

IMAGING IS NOT SURGERY:
  PET CT, CT Scan, MRI, X-Ray, Ultrasound, Mammogram, Echo, ECG are NOT surgical procedures.
  Do NOT request anaesthesia notes, surgical safety checklists, or operative notes for these.
  Apply surgical documentation checks ONLY to: biopsies, operations, invasive procedures.

DISCHARGE READINESS:
  Never say "Premature discharge" unless at least TWO independent evidence sources confirm it
  (e.g., documented vital sign instability AND documented unresolved critical lab value).
  If fewer than two sources: { "discharge_appropriateness": "Cannot determine" }

FOLLOW-UP:
  Only recommend follow-up if (a) explicitly documented in records, OR
  (b) it is a standard clinical guideline requirement for a CONFIRMED diagnosis.
  Never recommend follow-up based on assumptions.

FINAL AUDIT:
  Only aggregate validated findings. Remove duplicates. Do not amplify assumptions.
  If evidence is absent → do not escalate severity.

PENDING INVESTIGATIONS:
  A test is "pending" ONLY when:
    (a) it appears in a "recommendations", "treatments", or "plan" field (i.e. it was ordered),
    AND
    (b) no result for that test exists anywhere in the full timeline — including:
        - results reported in the SAME document as the order itself, and
        - results that semantically/clinically fulfil the order via a different
          but equivalent procedure or report (e.g. a performed TURBT fulfils a
          prior "suggested cystoscopy"; a Histopathology/Biopsy Report fulfils
          an "HPE correlation" recommendation).
  If a result or clinically-equivalent fulfilment exists anywhere in the timeline → it is NOT pending.
  If only mentioned in findings/diagnoses with no order evidence → not_documented.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""


# ═══════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════

def _elapsed(start: float) -> float:
    return round((datetime.now().timestamp() - start) * 1000, 1)


def parse_llm_json(text: str) -> Any:
    if not text:
        return {}
    text = text.strip()
    text = re.sub(r"```json\s*", "", text)
    text = re.sub(r"```\s*", "", text)
    match = re.search(r"(\{.*\}|\[.*\])", text, re.DOTALL)
    if match:
        text = match.group(0)
    try:
        return json.loads(text)
    except Exception:
        return {"raw_output": text}


def _serialize_timeline(timeline: List[Dict]) -> str:
    return json.dumps(timeline, indent=2, default=str)



def _ensure_dict(value: Any, default: Optional[Dict] = None) -> Dict:
    """Normalize LLM output: unwrap single-element list to dict."""
    if default is None:
        default = {}
    if isinstance(value, list):
        return value[0] if value else default
    if isinstance(value, dict):
        return value
    return default

class BaseAgent:
    def __init__(self, llm_instance):
        self.llm = llm_instance

    async def _invoke(self, system: str, user: str) -> Any:
        response = await self.llm.ainvoke([
            SystemMessage(content=system),
            HumanMessage(content=user),
        ])
        return parse_llm_json(response.content)

    def _elapsed(self, start: float) -> float:
        return _elapsed(start)


# ═══════════════════════════════════════════════════════════════
# DATA LOADER
# ═══════════════════════════════════════════════════════════════

async def load_discharge_record(patient_id: str, doctor_id: str) -> Dict:
    record = await mongo_db["discharge_summaries"].find_one(
        {"patient_id": patient_id, "doctor_id": doctor_id},
        sort=[("generated_at", -1)],
    )
    logger.info(f"discharge_summary_timeline:{record}")
    if not record:
        raise HTTPException(
            status_code=404,
            detail=f"No discharge summary found for patient {patient_id} / doctor {doctor_id}",
        )
    return record


# ═══════════════════════════════════════════════════════════════
# VA1A · INVESTIGATION ORDER EXTRACTOR AGENT  (PATCHED v4.1.0)
# ═══════════════════════════════════════════════════════════════
#
# PURPOSE:
#   Scan every field of the day_wise_timeline for investigation ORDERS.
#   Orders can be buried anywhere:
#     • "recommendations": ["send CBC", "HPE of specimen", "check P67"]
#     • "treatments":      ["send for culture & sensitivity"]
#     • findings text:     "doctor ordered HbA1c"
#     • procedure notes:   "specimen sent for histopathology"
#   This agent makes a COMPLETE, deduplicated order manifest before VA1B
#   attempts result-matching.
#
#   PATCH v4.1.0: Added SKIP-IF-SELF-RESULTED rule. Many real-world clinical
#   documents (e.g. a CT report) list the investigation name as a header/tag
#   ("Investigations: CT Urogram, PET-CT") while reporting the actual result
#   in the SAME document's findings/diagnoses fields. Previously VA1A treated
#   the header tag as a standalone "order" even though the result was right
#   there — causing VA1B to falsely mark it pending. Now VA1A checks the
#   document's own findings/diagnoses/treatments before extracting an order.
#
# FRONTEND DISPLAY FIELDS:
#   ordered_investigations → Full order list table with source + date + order_type
# ═══════════════════════════════════════════════════════════════

class InvestigationOrderExtractorAgent(BaseAgent):
    agent_id = "VA1A"

    async def run(self, state: ValidationState) -> ValidationState:
        logger.info(f"{self.agent_id} · InvestigationOrderExtractor — START")
        t0 = datetime.now().timestamp()

        timeline  = state["day_wise_timeline"]
        specialty = state["specialty"]
        raw_timeline_json = _serialize_timeline(timeline)

        system = f"""You are a senior {specialty} clinical auditor performing a FIRST-PASS INVESTIGATION ORDER EXTRACTION.
{MASTER_AUDIT_RULES}

YOUR SOLE TASK IN THIS PASS:
Extract EVERY investigation that was ORDERED anywhere in the timeline AND still has no
result reported in that same document.

Look in ALL of these fields across every document in every day block:
  • "recommendations" array
  • "treatments" array
  • "findings" array (e.g., "specimen sent for HPE")
  • "procedures" array (e.g., "biopsy — specimen sent for histopathology")
  • Free text inside any field mentioning: "send for", "order", "check", "HPE of", "culture of",
    "histopathology of", "cytology of", "biopsy report awaited", "P67", "HbA1c",
    "repeat CBC", "repeat culture", "tumour markers", "bone marrow", "flow cytometry", etc.

IMPORTANT — order_type classification:
  "lab"             → blood tests (CBC, CMP, LFT, RFT, coagulation, HbA1c, tumour markers, etc.)
  "histopathology"  → HPE, biopsy reports, histopathology, surgical specimen reports, cytology
  "microbiology"    → culture & sensitivity, blood culture, urine C&S, wound swab
  "imaging"         → X-ray, CT, MRI, USG, PET, Echo, ECG, Doppler
  "special_test"    → any named special panel (P67, flow cytometry, bone marrow biopsy, etc.)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL — SKIP-IF-SELF-RESULTED RULE (read before extracting):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Before adding any investigation to ordered_investigations, check the SAME document
block it appears in (its "investigations", "findings", "diagnoses", "abnormalities"
and "treatments" fields).

  • If that SAME document already reports a finding, diagnosis, or descriptive result
    for that investigation (e.g. a CT report whose "investigations" field lists
    "CT Urogram, PET-CT" AND whose "findings"/"diagnoses" fields describe the bladder
    mass, lymph nodes, hepatomegaly, etc. found BY that CT/PET-CT) — this investigation
    is ALREADY RESULTED in this same document. Do NOT extract it as an order.
  • Likewise, if a "Cystoscopy / TURBT Report" lists "TURBT" under investigations AND
    that same document's findings/diagnoses describe what was found during the TURBT —
    do NOT extract "TURBT" as a pending order; it is self-resulted.
  • Likewise, if a "Histopathology / Biopsy Report" lists "Histopathology" or "HPE"
    under investigations AND the same document's findings/diagnoses describe the
    histopathology result — do NOT extract it as a pending order.
  • Only extract an investigation as an ORDER when the order text (e.g. a
    recommendation, plan, or "send for X" instruction) appears WITHOUT a
    corresponding result in that same document — i.e. it is a genuine forward-looking
    instruction for something to happen LATER (in a future document/day), such as
    "PET CT to be arranged", "send P67", "repeat CBC tomorrow".
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Do NOT confirm whether a result exists in OTHER (later) documents — that exhaustive
cross-document check is VA1B's job. Your job is only to (a) extract genuine forward
orders, and (b) immediately exclude self-resulted items per the rule above.

Return ONLY valid JSON."""

        prompt = f"""
SPECIALTY        : {specialty}
ADMISSION REASON : {state.get('admission_reason', 'Not documented')}
PATIENT          : {state.get('patient_name', 'Unknown')}

═══════════════════════════════════════════════════════════
FULL DAY_WISE_TIMELINE (TIMELINE DATA — SOURCE OF TRUTH):
═══════════════════════════════════════════════════════════
{raw_timeline_json}
═══════════════════════════════════════════════════════════

EXTRACTION TASK:

Read the ENTIRE timeline carefully. Search EVERY field in EVERY document block.
Extract every investigation ORDER that is a genuine forward-looking instruction with
NO result yet in that same document — including:
  • Standard lab orders (CBC, LFT, RFT, electrolytes, HbA1c, lipids, coagulation…)
  • Histopathology / biopsy orders (HPE of TURBT specimen, HPE of lymph node, etc.)
    — UNLESS the same document already reports the histopathology findings
  • Imaging orders (CT chest, MRI spine, Echo, X-ray…) — UNLESS the same document
    already reports the imaging findings
  • Microbiology orders (urine C&S, blood culture, wound swab…)
  • Special / named tests (P67, flow cytometry, bone marrow trephine, etc.)
  • Any instruction containing "send for", "order", "check", "repeat", "await result",
    "to be arranged"

Schema for ordered_investigations:
[
  {{
    "test_name":       "exact name as written in source",
    "order_type":      "lab|histopathology|microbiology|imaging|special_test",
    "ordered_in_field":"recommendations|treatments|findings|procedures|other",
    "ordered_date":    "YYYY-MM-DD or unknown",
    "source_document": "exact filename from timeline",
    "order_text":      "exact verbatim text that contains this order",
    "self_resulted_in_same_document": false,
    "confidence_score": 1.0
  }}
]

Rules:
- If the same test is ordered on two different dates, list each separately.
- If the same test is mentioned in two different documents on the same date, list once (keep highest-confidence source).
- Do NOT include tests that already have a result, finding, or diagnosis recorded in the
  SAME document (per the SKIP-IF-SELF-RESULTED rule above) — these are RESULTS, not orders.
- Do NOT include tests that only appear in results/investigations fields with a result value — those are RESULTS, not orders.
- Only include if confidence_score ≥ 0.75.

Return ONLY this valid JSON structure (no other text):
{{
  "ordered_investigations": [...]
}}
"""
        result = await self._invoke(system, prompt)
        state["investigation_order_report"]   = result
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · InvestigationOrderExtractor — DONE ({state['agent_timings'][self.agent_id]}ms) | Orders found: {len(result.get('ordered_investigations', []))}")
        return state


# ═══════════════════════════════════════════════════════════════
# VA1B · INVESTIGATION RESULT VERIFIER AGENT  (PATCHED v4.1.0)
# ═══════════════════════════════════════════════════════════════
#
# PURPOSE:
#   Takes VA1A's order manifest and cross-checks EVERY order against the
#   FULL timeline to find results.  This is critical because:
#     • Histopathology results may be in a separate document block (days later)
#     • A doctor may order "P67 test" on day 1 and the result arrives on day 5
#     • Without this cross-check, ordered-but-later-resulted tests appear "pending"
#   VA1B then produces the classic investigation audit sections (resulted, pending,
#   abnormal, trends, comparison, concerns) with high accuracy.
#
#   PATCH v4.1.0: Added two rules VA1B must apply BEFORE declaring anything
#   "genuinely pending":
#     1. SAME-DOCUMENT MATCH RULE — if the order's source_document itself
#        contains the result (header/tag + findings/diagnoses in the same doc),
#        it is resulted, not pending.
#     2. SEMANTIC / PROCEDURE-EQUIVALENCE RULE — clinical recommendations are
#        often fulfilled by a DIFFERENT but clinically equivalent procedure or
#        report later in the timeline. E.g.:
#          - "Suggested cystoscopy" is fulfilled by a later TURBT (TURBT is a
#            cystoscopic procedure with resection).
#          - "HPE correlation" (a recommendation to correlate histopathology)
#            is fulfilled by the appearance of a Histopathology/Biopsy Report
#            with findings, regardless of exact wording.
#          - A "biopsy sample dispatched to [lab]" is fulfilled by the
#            histopathology report that later reports on that same specimen.
#     VA1B must reason about clinical equivalence, not just literal string
#     matching, before marking anything pending.
#
# FRONTEND DISPLAY FIELDS:
#   resulted_investigations, pending_investigations, abnormal_values_documented,
#   investigation_trends, findings_comparison, active_concerns_evidence_based,
#   verification_summary, issues
# ═══════════════════════════════════════════════════════════════

class InvestigationResultVerifierAgent(BaseAgent):
    agent_id = "VA1B"

    async def run(self, state: ValidationState) -> ValidationState:
        logger.info(f"{self.agent_id} · InvestigationResultVerifier — START")
        t0 = datetime.now().timestamp()

        timeline     = state["day_wise_timeline"]
        specialty    = state["specialty"]
        order_report = state.get("investigation_order_report") or {}
        orders       = order_report.get("ordered_investigations", [])

        raw_timeline_json = _serialize_timeline(timeline)
        orders_json       = json.dumps(orders, indent=2, default=str)

        system = f"""You are a senior {specialty} clinical auditor performing a SECOND-PASS INVESTIGATION RESULT VERIFICATION.
{MASTER_AUDIT_RULES}

YOUR TASK:
You are given:
  1. A list of ORDERED investigations extracted by VA1A (the order manifest) using the
     full timeline DATA (not raw/unstructured text — this is the structured day-wise
     clinical timeline that is the single source of truth for this patient).
  2. The complete day_wise_timeline JSON (the source of truth) to cross-check against.

For EVERY order in the manifest, search the ENTIRE timeline DATA for a matching result
BEFORE concluding anything is pending. Apply BOTH of these rules, in order:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE A — SAME-DOCUMENT MATCH RULE (check first):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
If the order's source_document is the SAME document that contains the answer —
i.e. that document's own "findings", "diagnoses", or "abnormalities" fields describe
the outcome of that investigation — it is immediately RESULTED, not pending.
Many real clinical documents list the investigation name as a header/tag
(e.g. "Investigations: CT Urogram, PET-CT") while the actual result is reported in
prose elsewhere in the SAME document (findings/diagnoses). Treat this as a match.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE B — SEMANTIC / PROCEDURE-EQUIVALENCE RULE (check second):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A recommendation or plan item is often fulfilled later by a DIFFERENT but clinically
equivalent procedure, report, or action — not necessarily the exact same test name.
Examples you MUST apply this reasoning to:
  • "Suggested cystoscopy" / "Cystoscopy" → FULFILLED by a later TURBT (Trans-Urethral
    Resection of Bladder Tumour is performed via cystoscope and includes/exceeds a
    diagnostic cystoscopy).
  • "HPE correlation" (a recommendation to correlate histopathology with imaging) →
    FULFILLED by the appearance of any Histopathology / Biopsy Report with findings,
    anywhere later in the timeline, regardless of exact wording match.
  • "Biopsy sample dispatched to [lab name]" / "specimen sent for histopathology" →
    FULFILLED by a later Histopathology/Biopsy Report that reports on that same
    specimen (matched by approximate date proximity and specimen description, not
    exact string match).
  • "TURBT" listed as an investigation tag on the SAME day the TURBT procedure was
    performed and reported (with findings/diagnoses) → FULFILLED in that same document
    (also covered by Rule A).
  • "PET-CT", "CT Urogram" listed as investigation tags on a CT/PET report whose own
    findings describe what those scans showed → FULFILLED in that same document
    (also covered by Rule A).
Use clinical judgement: if a later document or procedure clearly and substantively
answers the clinical question the order was trying to answer, treat it as RESULTED,
even if the test name differs.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ONLY AFTER RULE A and RULE B both fail to find a match anywhere in the full timeline
DATA should an order be marked GENUINELY PENDING. A genuinely pending example: a
recommendation like "PET CT and oncology OPD appointment to be arranged" made on the
LAST documented day, with no subsequent document anywhere in the timeline showing
that scan was performed or its result — this is correctly pending because it is a
forward plan for something that has not yet happened in the available records.

MATCHING EXAMPLES:
  Order: "HPE of TURBT specimen" → Result match: document_label "Histopathology / Biopsy Report"
         with findings about the specimen (Rule A or B)
  Order: "Repeat CBC"            → Result match: investigations array with Hb, WBC, Platelets values
  Order: "P67"                   → Result match: if any document contains "P67" with a value
  Order: "Urine C&S"             → Result match: investigations array "Urine culture: no growth"
  Order: "Suggested cystoscopy"  → Result match: a later TURBT procedure report (Rule B)
  Order: "HPE correlation"       → Result match: any later Histopathology/Biopsy Report (Rule B)

If NO match found anywhere in the full timeline DATA after applying Rule A and Rule B
→ the test is GENUINELY PENDING.

Return ONLY valid JSON."""

        prompt = f"""
SPECIALTY        : {specialty}
ADMISSION REASON : {state.get('admission_reason', 'Not documented')}
PATIENT          : {state.get('patient_name', 'Unknown')}

═══════════════════════════════════════════════════════════
VA1A ORDER MANIFEST (what was ordered — verify each one against the TIMELINE DATA below,
NOT against any external or raw unstructured text):
═══════════════════════════════════════════════════════════
{orders_json}
═══════════════════════════════════════════════════════════

FULL DAY_WISE_TIMELINE (STRUCTURED TIMELINE DATA — search this for results,
applying RULE A same-document match and RULE B semantic/procedure-equivalence match
before declaring anything pending):
═══════════════════════════════════════════════════════════
{raw_timeline_json}
═══════════════════════════════════════════════════════════

VERIFICATION TASK:

For EACH order in the VA1A manifest above, search the ENTIRE timeline DATA for a result,
applying RULE A then RULE B as described in the system instructions.
Then produce the following sections:

SECTION 1: resulted_investigations
All investigations (from VA1A orders AND any additional non-ordered results found in timeline)
that have an explicit result, finding, or clinically-equivalent fulfilment documented.
Schema: [
  {{
    "test":             "...",
    "order_type":       "lab|histopathology|microbiology|imaging|special_test",
    "result":           "...",
    "unit":             "...",
    "date":             "YYYY-MM-DD or unknown",
    "source_document":  "filename",
    "status":           "normal|abnormal|critical",
    "was_ordered":      true|false,
    "order_date":       "YYYY-MM-DD or unknown or not_applicable",
    "matched_via":      "same_document|later_document_same_test|semantic_equivalence",
    "confidence_score": 1.0
  }}
]

SECTION 2: pending_investigations
Orders from VA1A manifest where NO result was found ANYWHERE in the full timeline DATA
after applying BOTH Rule A (same-document) and Rule B (semantic/procedure-equivalence).
Re-verify each before marking pending — check document labels, findings, diagnoses, and
all investigations arrays, and consider clinically-equivalent fulfilment, not just exact
name matches.
Schema: [
  {{
    "test":            "...",
    "order_type":      "lab|histopathology|microbiology|imaging|special_test",
    "ordered_date":    "YYYY-MM-DD or unknown",
    "source_document": "filename where order appears",
    "reason_pending":  "No result or clinically-equivalent fulfilment found anywhere in timeline data after exhaustive search (Rule A and Rule B both checked)",
    "confidence_score": 0.75,
    "status":          "not_documented"
  }}
]
If no genuinely pending tests: []

SECTION 3: abnormal_values_documented
Only values explicitly flagged as abnormal or critical in the source documents.
Schema: [
  {{
    "test":                    "...",
    "value":                   "...",
    "unit":                    "...",
    "reference_range":         "...",
    "flag":                    "abnormal|critical",
    "management_documented":   true|false,
    "management_evidence":     "exact text or not_documented",
    "source_document":         "...",
    "date":                    "YYYY-MM-DD or unknown",
    "confidence_score":        1.0
  }}
]

SECTION 4: investigation_trends
Serial tests with 2 or more data points across different dates.
Schema: [
  {{
    "test":          "...",
    "data_points":   [ {{"date":"...","value":"...","unit":"...","source":"filename"}} ],
    "direction":     "increasing|decreasing|stable|single_value",
    "clinical_note": "..."
  }}
]
Only include if 2+ data points exist for the same test.

SECTION 5: findings_comparison
Key parameters with values at two different time points.
Schema: [
  {{
    "parameter":        "...",
    "earliest_value":   "...",
    "earliest_date":    "...",
    "latest_value":     "...",
    "latest_date":      "...",
    "change":           "increasing|decreasing|stable|single_reading",
    "source_documents": ["filename1","filename2"]
  }}
]

SECTION 6: active_concerns_evidence_based
Items where an abnormal value IS documented AND no management is recorded.
Both conditions must be explicitly evidenced.
Schema: [
  {{
    "concern":         "...",
    "evidence":        "exact text from source document",
    "source_document": "...",
    "date":            "YYYY-MM-DD or unknown",
    "confidence_score": 0.75
  }}
]
confidence_score must be ≥ 0.75 or omit.

SECTION 7: verification_summary
High-level summary of the dual-agent verification.
Schema:
{{
  "total_orders_extracted_by_VA1A":   0,
  "orders_with_results_found":        0,
  "orders_resolved_via_same_document":0,
  "orders_resolved_via_semantic_equivalence": 0,
  "orders_genuinely_pending":         0,
  "additional_results_not_ordered":   0,
  "histopathology_orders_verified":   0,
  "special_test_orders_verified":     0,
  "verification_note":                "..."
}}

SECTION 8: issues
Only confidence_score ≥ 0.75.
Schema: [
  {{
    "severity":         "Critical|Major|Moderate|Minor",
    "category":         "Investigation Verification",
    "description":      "...",
    "evidence":         "exact text from source",
    "source_document":  "...",
    "date":             "YYYY-MM-DD or unknown",
    "confidence_score": 0.0,
    "recommendation":   "..."
  }}
]

Return ONLY this valid JSON structure (no other text):
{{
  "resulted_investigations":        [...],
  "pending_investigations":         [...],
  "abnormal_values_documented":     [...],
  "investigation_trends":           [...],
  "findings_comparison":            [...],
  "active_concerns_evidence_based": [...],
  "verification_summary":           {{}},
  "issues":                         [...]
}}
"""
        result = await self._invoke(system, prompt)
        state["investigation_result_report"]  = result
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        summary = result.get("verification_summary", {})
        logger.info(
            f"{self.agent_id} · InvestigationResultVerifier — DONE ({state['agent_timings'][self.agent_id]}ms) | "
            f"Resulted: {summary.get('orders_with_results_found','?')} | "
            f"Pending: {summary.get('orders_genuinely_pending','?')}"
        )
        return state


# ═══════════════════════════════════════════════════════════════
# VA2 · MEDICATION RECONCILIATION AGENT  (enhanced — BPMH gap)
# ═══════════════════════════════════════════════════════════════

class MedicationReconciliationAgent(BaseAgent):
    agent_id = "VA2"

    async def run(self, state: ValidationState) -> ValidationState:
        logger.info(f"{self.agent_id} · MedicationReconciliation — START")
        t0 = datetime.now().timestamp()

        timeline          = state["day_wise_timeline"]
        specialty         = state["specialty"]
        raw_timeline_json = _serialize_timeline(timeline)

        system = f"""You are a senior {specialty} clinical pharmacist and medication safety auditor.
{MASTER_AUDIT_RULES}

You are auditing medications ONLY from the provided day_wise_timeline JSON.
The timeline is the ONLY source of truth.
Do NOT invent medication names, doses, or safety concerns not present in the source data.
Return ONLY valid JSON."""

        prompt = f"""
SPECIALTY        : {specialty}
ADMISSION REASON : {state.get('admission_reason', 'Not documented')}
PATIENT          : {state.get('patient_name', 'Unknown')}

═══════════════════════════════════════════════════════════
FULL DAY_WISE_TIMELINE (RAW JSON — SOURCE OF TRUTH):
═══════════════════════════════════════════════════════════
{raw_timeline_json}
═══════════════════════════════════════════════════════════

AUDIT TASK — Evidence-Based Medication Reconciliation:

SECTION 1: documented_medications
Schema: [
  {{
    "drug":              "...",
    "dose":              "...",
    "route":             "...",
    "frequency":         "...",
    "first_seen_date":   "YYYY-MM-DD or unknown",
    "last_seen_date":    "YYYY-MM-DD or unknown",
    "source_documents":  ["filename1","filename2"],
    "confidence_score":  1.0
  }}
]

SECTION 2: medications_stopped
Medications seen on one date but absent on subsequent dates with no documented reason.
Schema: [
  {{
    "drug":                     "...",
    "last_documented_date":     "YYYY-MM-DD or unknown",
    "source_document":          "...",
    "reason_for_stopping":      "not_documented|documented",
    "confidence_score":         0.0
  }}
]
If no evidence: []

SECTION 3: dose_changes
Only if TWO different doses for the same drug are explicitly documented on different dates.
Schema: [
  {{
    "drug":               "...",
    "change_from":        "...",
    "change_to":          "...",
    "date_of_change":     "YYYY-MM-DD or unknown",
    "reason_documented":  true|false,
    "source_documents":   ["..."],
    "confidence_score":   0.0
  }}
]
If none: []

SECTION 4: high_risk_medications_documented
Only for drugs actually found in timeline that belong to:
anticoagulants, insulin, opioids, nephrotoxics, narrow-therapeutic-index agents.
Schema: [
  {{
    "drug":                          "...",
    "risk_class":                    "...",
    "monitoring_documented":         true|false,
    "monitoring_evidence":           "exact text or not_documented",
    "discharge_instruction_present": true|false,
    "source_document":               "...",
    "confidence_score":              1.0
  }}
]
If none: []

SECTION 5: iv_to_oral_switch
Only if both IV and oral forms of the same drug are documented on different dates.
Schema: [
  {{
    "drug":             "...",
    "iv_date":          "YYYY-MM-DD or unknown",
    "oral_date":        "YYYY-MM-DD or unknown",
    "converted":        true,
    "source_documents": ["..."],
    "confidence_score": 0.0
  }}
]
If none: []

SECTION 6: prn_medications
SOS/PRN medications found in the timeline.
Schema: [
  {{
    "drug":                   "...",
    "indication_documented":  true|false,
    "indication":             "exact text or not_documented",
    "max_dose_documented":    true|false,
    "source_document":        "...",
    "confidence_score":       1.0
  }}
]
If none: []

SECTION 7: medication_trends
Day-by-day medication changes in plain language with source filenames cited.
Schema: [
  {{"summary":"Day [date]: [Drug] [dose] [route] [frequency] started/stopped/changed [source: filename]."}}
]

SECTION 8: bpmh_gap_noted
Note whether pre-admission medication history (BPMH) is documented in the timeline.
If BPMH is absent this is a reconciliation gap — patient's chronic home medications unknown.
Schema:
{{
  "bpmh_documented":    true|false,
  "bpmh_source":        "filename or not_documented",
  "chronic_medications_identifiable": true|false,
  "gap_note":           "..."
}}

SECTION 9: issues
Only confidence_score ≥ 0.75.
Schema: [
  {{
    "severity":         "Critical|Major|Moderate|Minor",
    "category":         "Medication Reconciliation",
    "description":      "...",
    "evidence":         "exact text from source",
    "source_document":  "...",
    "date":             "YYYY-MM-DD or unknown",
    "confidence_score": 0.0,
    "recommendation":   "..."
  }}
]

Return ONLY this valid JSON (no other text):
{{
  "documented_medications":           [...],
  "medications_stopped":              [...],
  "dose_changes":                     [...],
  "high_risk_medications_documented": [...],
  "iv_to_oral_switch":                [...],
  "prn_medications":                  [...],
  "medication_trends":                [...],
  "bpmh_gap_noted":                   {{}},
  "issues":                           [...]
}}
"""
        result = await self._invoke(system, prompt)
        state["medication_report"]            = result
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · MedicationReconciliation — DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ═══════════════════════════════════════════════════════════════
# VA3 · PROCEDURE / SURGERY AGENT  (unchanged from v3)
# ═══════════════════════════════════════════════════════════════

class ProcedureSurgeryAgent(BaseAgent):
    agent_id = "VA3"

    async def run(self, state: ValidationState) -> ValidationState:
        logger.info(f"{self.agent_id} · ProcedureSurgery — START")
        t0 = datetime.now().timestamp()

        timeline          = state["day_wise_timeline"]
        specialty         = state["specialty"]
        raw_timeline_json = _serialize_timeline(timeline)

        system = f"""You are a senior {specialty} surgical clinical auditor.
{MASTER_AUDIT_RULES}

CRITICAL RULE FOR THIS AGENT:
Imaging studies (PET CT, CT Scan, MRI, X-Ray, Ultrasound, Mammogram, Echo, ECG, Doppler)
are NOT surgical procedures. Do NOT request anaesthesia notes, surgical checklists,
or operative notes for imaging. Only apply surgical documentation checks to:
biopsies, operations (TURBT, laparoscopy, etc.), and invasive procedures.

Return ONLY valid JSON."""

        prompt = f"""
SPECIALTY        : {specialty}
ADMISSION REASON : {state.get('admission_reason', 'Not documented')}
PATIENT          : {state.get('patient_name', 'Unknown')}

═══════════════════════════════════════════════════════════
FULL DAY_WISE_TIMELINE (RAW JSON — SOURCE OF TRUTH):
═══════════════════════════════════════════════════════════
{raw_timeline_json}
═══════════════════════════════════════════════════════════

AUDIT TASK — Evidence-Based Procedure/Surgery Audit:

Classify every procedure:
  "surgical_invasive"  — operations, biopsies, invasive interventions
  "imaging_diagnostic" — CT, MRI, X-Ray, USG, Echo, ECG, PET — NO surgical checks
  "bedside_procedure"  — catheter, IV line, wound care, transfusion

SECTION 1: procedures_classified
Schema: [
  {{
    "name":             "...",
    "classification":   "surgical_invasive|imaging_diagnostic|bedside_procedure",
    "date":             "YYYY-MM-DD or unknown",
    "source_document":  "...",
    "confidence_score": 1.0
  }}
]

SECTION 2: surgical_documentation_audit  (surgical_invasive ONLY)
Schema: [
  {{
    "procedure":                      "...",
    "date":                           "YYYY-MM-DD or unknown",
    "pre_op_assessment_documented":   true|false,
    "pre_op_evidence":                "exact text or not_documented",
    "operative_note_documented":      true|false,
    "operative_evidence":             "exact text or not_documented",
    "post_op_monitoring_documented":  true|false,
    "post_op_evidence":               "exact text or not_documented",
    "source_documents":               ["..."],
    "confidence_score":               0.0
  }}
]
If no surgical procedures: []

SECTION 3: specimens_tracking
Schema: [
  {{
    "specimen_type":                "...",
    "sent_from_procedure":          "...",
    "histopath_result_documented":  true|false,
    "result":                       "exact text or not_documented",
    "source_document":              "...",
    "date":                         "YYYY-MM-DD or unknown",
    "confidence_score":             0.0
  }}
]
If no specimen: []

SECTION 4: complications_documented
ONLY explicitly written complications.
Schema: [
  {{
    "complication":          "...",
    "evidence":              "exact text from source",
    "management_documented": true|false,
    "management_evidence":   "exact text or not_documented",
    "source_document":       "...",
    "date":                  "YYYY-MM-DD or unknown",
    "confidence_score":      0.0
  }}
]
If none: []

SECTION 5: disease_timeline
Chronological documented events.
Schema: [
  {{
    "date":            "YYYY-MM-DD or unknown",
    "event":           "...",
    "source_document": "...",
    "significance":    "..."
  }}
]

SECTION 6: imaging_results_summary
Schema: [
  {{
    "study":           "...",
    "key_finding":     "...",
    "date":            "YYYY-MM-DD or unknown",
    "source_document": "..."
  }}
]

SECTION 7: issues  (surgical_invasive only, confidence ≥ 0.75)
Schema: [
  {{
    "severity":         "Critical|Major|Moderate|Minor",
    "category":         "Procedure/Surgery",
    "description":      "...",
    "evidence":         "exact text",
    "source_document":  "...",
    "date":             "YYYY-MM-DD or unknown",
    "confidence_score": 0.0,
    "recommendation":   "..."
  }}
]

Return ONLY this valid JSON:
{{
  "procedures_classified":        [...],
  "surgical_documentation_audit": [...],
  "specimens_tracking":           [...],
  "complications_documented":     [...],
  "disease_timeline":             [...],
  "imaging_results_summary":      [...],
  "issues":                       [...]
}}
"""
        result = await self._invoke(system, prompt)
        state["procedure_report"]             = result
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · ProcedureSurgery — DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ═══════════════════════════════════════════════════════════════
# VA4 · CLINICAL CONSISTENCY AGENT  (unchanged from v3)
# ═══════════════════════════════════════════════════════════════

class ClinicalConsistencyAgent(BaseAgent):
    agent_id = "VA4"

    async def run(self, state: ValidationState) -> ValidationState:
        logger.info(f"{self.agent_id} · ClinicalConsistency — START")
        t0 = datetime.now().timestamp()

        timeline          = state["day_wise_timeline"]
        discharge_summary = state.get("discharge_summary", "")
        specialty         = state["specialty"]
        raw_timeline_json = _serialize_timeline(timeline)

        system = f"""You are a senior {specialty} clinical quality auditor reviewing discharge summary accuracy.
{MASTER_AUDIT_RULES}

Compare the discharge_summary text against the day_wise_timeline JSON.
The timeline is the ONLY source of truth.
Return ONLY valid JSON."""

        prompt = f"""
SPECIALTY        : {specialty}
ADMISSION REASON : {state.get('admission_reason', 'Not documented')}
PATIENT          : {state.get('patient_name', 'Unknown')}

DISCHARGE SUMMARY TEXT (the document being audited):
═══════════════════════════════════════════════════════════
{discharge_summary[:4000]}{'...[truncated]' if len(discharge_summary) > 4000 else ''}
═══════════════════════════════════════════════════════════

FULL DAY_WISE_TIMELINE (RAW JSON — SOURCE OF TRUTH):
═══════════════════════════════════════════════════════════
{raw_timeline_json}
═══════════════════════════════════════════════════════════

AUDIT TASK — Evidence-Based Clinical Consistency Check:

SECTION 1: diagnoses_accuracy
Schema: [
  {{
    "diagnosis":             "...",
    "in_discharge_summary":  true,
    "supported_by_timeline": true|false,
    "timeline_evidence":     "exact text or not_documented",
    "source_document":       "...",
    "date":                  "YYYY-MM-DD or unknown",
    "confidence_score":      0.0
  }}
]
Omit confidence < 0.75.

SECTION 2: factual_errors
Only if discharge summary CONTRADICTS explicit timeline data.
Schema: [
  {{
    "field":                    "...",
    "discharge_summary_states": "...",
    "timeline_shows":           "...",
    "source_document":          "...",
    "date":                     "YYYY-MM-DD or unknown",
    "confidence_score":         0.0
  }}
]
If none: []

SECTION 3: documented_events_missing_from_summary
Events explicitly in timeline but absent from discharge summary.
Schema: [
  {{
    "event":              "...",
    "timeline_evidence":  "exact text",
    "source_document":    "...",
    "date":               "YYYY-MM-DD or unknown",
    "significance":       "...",
    "confidence_score":   0.0
  }}
]
Omit confidence < 0.75.

SECTION 4: nursing_observations_captured
Critical nursing entries (hypotension, desaturation, oliguria, fever, pallor).
Schema: [
  {{
    "observation":          "...",
    "timeline_evidence":    "exact text",
    "source_document":      "...",
    "date":                 "YYYY-MM-DD or unknown",
    "in_discharge_summary": true|false,
    "confidence_score":     1.0
  }}
]

SECTION 5: active_concerns_evidence_based
Clinical issues in timeline with NO management or resolution recorded.
Schema: [
  {{
    "concern":            "...",
    "evidence":           "exact text",
    "source_document":    "...",
    "date":               "YYYY-MM-DD or unknown",
    "management_status":  "unresolved|not_documented",
    "confidence_score":   0.0
  }}
]
Omit confidence < 0.75.

SECTION 6: findings_comparison
Key parameters at two different time points.
Schema: [
  {{
    "parameter":                 "...",
    "on_admission":              "...",
    "admission_source":          "...",
    "at_discharge_or_later":     "...",
    "discharge_source":          "...",
    "change":                    "increasing|decreasing|stable|single_reading_only",
    "consistent_in_summary":     true|false
  }}
]

SECTION 7: positive_findings
Things documented correctly and completely.
Schema: ["...", "..."]

SECTION 8: issues  (confidence ≥ 0.75)
Schema: [
  {{
    "severity":         "Critical|Major|Moderate|Minor",
    "category":         "Clinical Consistency",
    "description":      "...",
    "evidence":         "exact text",
    "source_document":  "...",
    "date":             "YYYY-MM-DD or unknown",
    "confidence_score": 0.0,
    "recommendation":   "..."
  }}
]

Return ONLY this valid JSON:
{{
  "diagnoses_accuracy":                     [...],
  "factual_errors":                         [...],
  "documented_events_missing_from_summary": [...],
  "nursing_observations_captured":          [...],
  "active_concerns_evidence_based":         [...],
  "findings_comparison":                    [...],
  "positive_findings":                      [...],
  "issues":                                 [...]
}}
"""
        result = await self._invoke(system, prompt)
        state["consistency_report"]           = result
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · ClinicalConsistency — DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ═══════════════════════════════════════════════════════════════
# VA5 · DISCHARGE READINESS AGENT  (enhanced — social domain)
# ═══════════════════════════════════════════════════════════════

class DischargeReadinessAgent(BaseAgent):
    agent_id = "VA5"

    async def run(self, state: ValidationState) -> ValidationState:
        logger.info(f"{self.agent_id} · DischargeReadiness — START")
        t0 = datetime.now().timestamp()

        timeline          = state["day_wise_timeline"]
        specialty         = state["specialty"]
        raw_timeline_json = _serialize_timeline(timeline)

        clinical_blocks = [b for b in timeline if b.get("type") == "clinical_day"]
        last_two_dates  = [b.get("date", "unknown") for b in clinical_blocks[-2:]]

        system = f"""You are a senior {specialty} clinician auditing discharge readiness.
{MASTER_AUDIT_RULES}

DISCHARGE READINESS SPECIFIC RULES:
Never declare "Premature discharge" unless BOTH are explicitly evidenced:
  1. Documented vital sign instability (with exact values from source)
  2. Documented unresolved critical laboratory value (with exact values from source)
If fewer than two independent evidence sources: {{ "verdict": "Cannot determine" }}

SOCIAL DOMAIN RULE:
Social environment assessment (home safety, family/carer support, equipment) should be
documented. If not found in the timeline, report as not_documented — do NOT assume.

Return ONLY valid JSON."""

        prompt = f"""
SPECIALTY        : {specialty}
ADMISSION REASON : {state.get('admission_reason', 'Not documented')}
PATIENT          : {state.get('patient_name', 'Unknown')}
ADMISSION DATE   : {state.get('admission_date', 'Unknown')}
LAST 2 CLINICAL DAY DATES: {last_two_dates}

═══════════════════════════════════════════════════════════
FULL DAY_WISE_TIMELINE (RAW JSON — SOURCE OF TRUTH):
═══════════════════════════════════════════════════════════
{raw_timeline_json}
═══════════════════════════════════════════════════════════

AUDIT TASK — Evidence-Based Discharge Readiness Assessment:

SECTION 1: vital_signs_documented_near_discharge
Schema: [
  {{
    "parameter":           "...",
    "value":               "...",
    "unit":                "...",
    "date":                "YYYY-MM-DD or unknown",
    "source_document":     "...",
    "within_normal_range": true|false,
    "reference":           "..."
  }}
]
If none: []

SECTION 2: lab_values_documented_near_discharge
Schema: [
  {{
    "test":            "...",
    "value":           "...",
    "unit":            "...",
    "reference_range": "...",
    "status":          "normal|abnormal|critical|not_documented",
    "date":            "YYYY-MM-DD or unknown",
    "source_document": "..."
  }}
]
If none: []

SECTION 3: symptom_control_evidence
Schema: [
  {{
    "symptom":         "...",
    "evidence":        "exact text or not_documented",
    "controlled":      true|false,
    "source_document": "...",
    "date":            "YYYY-MM-DD or unknown"
  }}
]

SECTION 4: devices_documented
Schema: [
  {{
    "device":          "...",
    "status":          "removed|in_situ|not_documented",
    "evidence":        "exact text or not_documented",
    "date":            "YYYY-MM-DD or unknown",
    "source_document": "..."
  }}
]

SECTION 5: mobility_status_documented
Schema:
{{
  "documented":      true|false,
  "status":          "...",
  "evidence":        "exact text or not_documented",
  "source_document": "..."
}}

SECTION 6: social_environment_domain   ← NEW (P5 gap from v3)
Check if any of the following are documented in the timeline:
  home environment assessment, family/carer support, transport plan,
  walking aid / equipment arranged, social worker review, community nursing.
Schema:
{{
  "home_environment_assessed":      true|false,
  "home_environment_evidence":      "exact text or not_documented",
  "family_carer_support_confirmed": true|false,
  "family_carer_evidence":          "exact text or not_documented",
  "equipment_arranged":             true|false,
  "equipment_evidence":             "exact text or not_documented",
  "social_worker_involved":         true|false,
  "social_worker_evidence":         "exact text or not_documented",
  "community_nursing_arranged":     true|false,
  "community_nursing_evidence":     "exact text or not_documented",
  "social_domain_score":            "GREEN|AMBER|RED|not_documented",
  "social_domain_note":             "..."
}}

SECTION 7: deterioration_events_documented
ONLY explicitly described as deterioration or instability.
Schema: [
  {{
    "event":                 "...",
    "evidence":              "exact text",
    "date":                  "YYYY-MM-DD or unknown",
    "source_document":       "...",
    "management_documented": true|false,
    "management_evidence":   "exact text or not_documented"
  }}
]
If none: []

SECTION 8: discharge_appropriateness
Requires ≥ 2 independent evidence sources to call "Premature".
Schema:
{{
  "verdict":               "Appropriate|Premature|Cannot determine",
  "rationale":             "...",
  "evidence_sources_used": ["source1","source2"],
  "evidence_count":        0
}}

SECTION 9: clinical_stability_score
Score 0–10 based ONLY on documented evidence. Do not deduct for missing documentation.
Schema:
{{
  "score": 0,
  "basis": "..."
}}

SECTION 10: issues  (confidence ≥ 0.75)
Schema: [
  {{
    "severity":         "Critical|Major|Moderate|Minor",
    "category":         "Discharge Readiness",
    "description":      "...",
    "evidence":         "exact text",
    "source_document":  "...",
    "date":             "YYYY-MM-DD or unknown",
    "confidence_score": 0.0,
    "recommendation":   "..."
  }}
]

Return ONLY this valid JSON:
{{
  "vital_signs_documented_near_discharge":  [...],
  "lab_values_documented_near_discharge":   [...],
  "symptom_control_evidence":               [...],
  "devices_documented":                     [...],
  "mobility_status_documented":             {{}},
  "social_environment_domain":              {{}},
  "deterioration_events_documented":        [...],
  "discharge_appropriateness":              {{}},
  "clinical_stability_score":               {{}},
  "issues":                                 [...]
}}
"""
        result = await self._invoke(system, prompt)
        state["readiness_report"]             = result
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · DischargeReadiness — DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ═══════════════════════════════════════════════════════════════
# VA6 · FOLLOW-UP AGENT  (unchanged from v3)
# ═══════════════════════════════════════════════════════════════

class FollowUpAgent(BaseAgent):
    agent_id = "VA6"

    async def run(self, state: ValidationState) -> ValidationState:
        logger.info(f"{self.agent_id} · FollowUp — START")
        t0 = datetime.now().timestamp()

        timeline          = state["day_wise_timeline"]
        specialty         = state["specialty"]
        raw_timeline_json = _serialize_timeline(timeline)

        system = f"""You are a senior {specialty} clinician auditing discharge follow-up documentation.
{MASTER_AUDIT_RULES}

FOLLOW-UP SPECIFIC RULES:
Only recommend follow-up if:
  (a) Explicitly documented in the timeline, OR
  (b) Standard published clinical guideline requirement for a CONFIRMED diagnosis.
Never recommend follow-up based on assumed diagnoses.

PENDING INVESTIGATIONS: A test is pending ONLY when ordered AND result (including any
same-document result or clinically-equivalent fulfilment via a different procedure or
report) is absent throughout the full timeline DATA. Apply the same same-document and
semantic-equivalence reasoning VA1B uses (e.g. a TURBT fulfils a "suggested cystoscopy";
a histopathology report fulfils "HPE correlation") before listing anything here.
Return ONLY valid JSON."""

        prompt = f"""
SPECIALTY        : {specialty}
ADMISSION REASON : {state.get('admission_reason', 'Not documented')}
PATIENT          : {state.get('patient_name', 'Unknown')}

═══════════════════════════════════════════════════════════
FULL DAY_WISE_TIMELINE (RAW JSON — SOURCE OF TRUTH):
═══════════════════════════════════════════════════════════
{raw_timeline_json}
═══════════════════════════════════════════════════════════

AUDIT TASK — Evidence-Based Follow-Up Audit:

SECTION 1: documented_followup_plans
Schema: [
  {{
    "specialty_or_service": "...",
    "timeframe":            "...",
    "purpose":              "...",
    "evidence":             "exact text",
    "source_document":      "...",
    "date":                 "YYYY-MM-DD or unknown",
    "confidence_score":     1.0
  }}
]

SECTION 2: pending_investigations_requiring_review
Tests ordered in timeline with NO result and NO clinically-equivalent fulfilment anywhere.
Cross-check entire timeline DATA using same-document and semantic-equivalence reasoning.
Schema: [
  {{
    "test":             "...",
    "ordered_date":     "YYYY-MM-DD or unknown",
    "ordered_in":       "source filename",
    "status":           "not_documented",
    "action_required":  "...",
    "confidence_score": 0.0
  }}
]
If none: []

SECTION 3: guideline_required_followup_for_confirmed_diagnoses
Only for diagnoses EXPLICITLY documented.
Schema: [
  {{
    "diagnosis":              "...",
    "diagnosis_source":       "filename",
    "required_followup":      "...",
    "guideline":              "name of guideline",
    "documented_in_timeline": true|false,
    "confidence_score":       0.0
  }}
]
Omit confidence < 0.75.

SECTION 4: patient_education_documented
Schema:
{{
  "documented":      true|false,
  "topics_covered":  ["..."],
  "evidence":        "exact text or not_documented",
  "source_document": "..."
}}

SECTION 5: red_flag_symptoms_documented
Schema:
{{
  "documented":       true|false,
  "symptoms_listed":  ["..."],
  "evidence":         "exact text or not_documented",
  "source_document":  "..."
}}

SECTION 6: missing_critical_followup
Only if guideline-required AND confirmed diagnosis AND absent from timeline.
Schema: [
  {{
    "followup":         "...",
    "reason_required":  "...",
    "basis":            "guideline_for_confirmed_diagnosis",
    "diagnosis":        "...",
    "confidence_score": 0.0
  }}
]
Omit confidence < 0.75.

SECTION 7: issues  (confidence ≥ 0.75)
Schema: [
  {{
    "severity":         "Critical|Major|Moderate|Minor",
    "category":         "Follow-Up Planning",
    "description":      "...",
    "evidence":         "exact text",
    "source_document":  "...",
    "date":             "YYYY-MM-DD or unknown",
    "confidence_score": 0.0,
    "recommendation":   "..."
  }}
]

Return ONLY this valid JSON:
{{
  "documented_followup_plans":                          [...],
  "pending_investigations_requiring_review":             [...],
  "guideline_required_followup_for_confirmed_diagnoses": [...],
  "patient_education_documented":                       {{}},
  "red_flag_symptoms_documented":                       {{}},
  "missing_critical_followup":                          [...],
  "issues":                                             [...]
}}
"""
        result = await self._invoke(system, prompt)
        state["followup_report"]              = result
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · FollowUp — DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ═══════════════════════════════════════════════════════════════
# VA8 · SAFETY & ALLERGY AGENT  (NEW — P3 gap)
# ═══════════════════════════════════════════════════════════════

class SafetyAllergyAgent(BaseAgent):
    agent_id = "VA8"

    async def run(self, state: ValidationState) -> ValidationState:
        logger.info(f"{self.agent_id} · SafetyAllergy — START")
        t0 = datetime.now().timestamp()

        timeline          = state["day_wise_timeline"]
        specialty         = state["specialty"]
        raw_timeline_json = _serialize_timeline(timeline)

        system = f"""You are a senior {specialty} patient safety and clinical pharmacology auditor.
{MASTER_AUDIT_RULES}

YOUR TASK: Detect patient safety concerns related to:
  1. Allergic events (drug/food allergy signs in clinical notes or nursing notes)
  2. Drug toxicity (lab or clinical markers suggesting supra-therapeutic drug levels)
  3. Inappropriate devices (IV lines or catheters present beyond documented guideline threshold)
  4. Hospital-acquired conditions (HAI, pressure ulcers, falls, DVT, delirium, hospital-acquired pneumonia)

CRITICAL: Only flag what is EXPLICITLY documented in the timeline.
Do NOT invent safety concerns. Do NOT infer toxicity from a single mildly elevated value.
Return ONLY valid JSON."""

        prompt = f"""
SPECIALTY        : {specialty}
ADMISSION REASON : {state.get('admission_reason', 'Not documented')}
PATIENT          : {state.get('patient_name', 'Unknown')}

═══════════════════════════════════════════════════════════
FULL DAY_WISE_TIMELINE (RAW JSON — SOURCE OF TRUTH):
═══════════════════════════════════════════════════════════
{raw_timeline_json}
═══════════════════════════════════════════════════════════

SAFETY AUDIT TASK:

SECTION 1: allergy_flags
Any allergy event, drug reaction, or allergy documentation found in the timeline.
Also flag if allergy field is blank or "NKDA not verified".
Schema: [
  {{
    "type":                    "documented_allergy|suspected_reaction|allergy_field_blank",
    "drug_or_substance":       "...",
    "reaction_documented":     "exact text or not_documented",
    "allergy_documented_in_record": true|false,
    "source_document":         "...",
    "date":                    "YYYY-MM-DD or unknown",
    "confidence_score":        0.0,
    "action_required":         "..."
  }}
]
If no allergy concerns found: []

SECTION 2: drug_toxicity_flags
Lab or clinical markers in the timeline that could indicate supra-therapeutic drug levels.
Only flag if BOTH: (a) a high-risk drug is documented AND (b) an abnormal lab/clinical sign
consistent with toxicity is documented in the same or subsequent document.
Schema: [
  {{
    "drug":                    "...",
    "toxicity_indicator":      "...",
    "lab_or_clinical_evidence":"exact text from source",
    "source_document":         "...",
    "date":                    "YYYY-MM-DD or unknown",
    "confidence_score":        0.0,
    "recommendation":          "..."
  }}
]
If no evidence: []

SECTION 3: inappropriate_device_flags
IV lines or urinary catheters documented as present beyond standard care duration
or without documented clinical review.
Schema: [
  {{
    "device":                  "...",
    "insertion_date":          "YYYY-MM-DD or unknown",
    "last_review_documented":  true|false,
    "review_evidence":         "exact text or not_documented",
    "days_in_situ":            "calculated or unknown",
    "guideline_threshold":     "...",
    "flag":                    "review_required|within_guideline|not_documented",
    "source_document":         "...",
    "confidence_score":        0.0
  }}
]
If no device concerns: []

SECTION 4: hospital_acquired_conditions
HAI, pressure ulcers, falls, DVT, delirium, HAP — ONLY if explicitly documented.
Schema: [
  {{
    "condition":               "HAI|pressure_ulcer|fall|DVT|delirium|HAP|other",
    "evidence":                "exact text from source",
    "date_first_documented":   "YYYY-MM-DD or unknown",
    "source_document":         "...",
    "management_documented":   true|false,
    "management_evidence":     "exact text or not_documented",
    "confidence_score":        0.0
  }}
]
If none documented: []

SECTION 5: issues  (confidence ≥ 0.75)
Schema: [
  {{
    "severity":         "Critical|Major|Moderate|Minor",
    "category":         "Patient Safety",
    "description":      "...",
    "evidence":         "exact text",
    "source_document":  "...",
    "date":             "YYYY-MM-DD or unknown",
    "confidence_score": 0.0,
    "recommendation":   "..."
  }}
]

Return ONLY this valid JSON:
{{
  "allergy_flags":                [...],
  "drug_toxicity_flags":          [...],
  "inappropriate_device_flags":   [...],
  "hospital_acquired_conditions": [...],
  "issues":                       [...]
}}
"""
        result = await self._invoke(system, prompt)
        state["safety_allergy_report"]        = result
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · SafetyAllergy — DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ═══════════════════════════════════════════════════════════════
# VA9 · CODING & BILLING AGENT  (PATCHED v4.1.0 — MANDATORY CODING)
# ═══════════════════════════════════════════════════════════════
#
# PATCH v4.1.0: Previously VA9 could silently return an empty
# suggested_icd10_codes list even when VA4 had confirmed diagnoses with
# supported_by_timeline=true. This patch adds a MANDATORY CODING RULE:
# every confirmed diagnosis MUST receive a code attempt. If a precise code
# truly cannot be assigned, VA9 must explain why via a cdi_query instead of
# dropping the diagnosis silently. "No code" / empty-handed returns for
# diagnoses that exist are no longer permitted.
#
# FRONTEND DISPLAY FIELDS:
#   suggested_icd10_codes, suggested_procedure_codes, drg_band,
#   cc_mcc_captured, hac_exclusion_review, cdi_queries, issues
# ═══════════════════════════════════════════════════════════════

class CodingBillingAgent(BaseAgent):
    agent_id = "VA9"

    async def run(self, state: ValidationState) -> ValidationState:
        logger.info(f"{self.agent_id} · CodingBilling — START")
        t0 = datetime.now().timestamp()

        timeline          = state["day_wise_timeline"]
        discharge_summary = state.get("discharge_summary", "")
        specialty         = state["specialty"]
        raw_timeline_json = _serialize_timeline(timeline)

        proc_report  = state.get("procedure_report") or {}
        cons_report  = state.get("consistency_report") or {}

        confirmed_diagnoses = [
            d for d in cons_report.get("diagnoses_accuracy", [])
            if d.get("supported_by_timeline") is True
        ]
        confirmed_procedures = [
            p for p in proc_report.get("procedures_classified", [])
            if p.get("classification") == "surgical_invasive"
        ]

        system = f"""You are a senior clinical coder and CDI (Clinical Documentation Improvement) specialist
for {specialty} cases.
{MASTER_AUDIT_RULES}

YOUR TASK: Suggest ICD-10 codes and procedure codes based ONLY on documented diagnoses and procedures
in the day_wise_timeline. Do NOT code diagnoses that are not explicitly documented.

ICD-10 CODING RULES:
- Principal diagnosis: the condition chiefly responsible for admission (after investigation)
- Secondary diagnoses: co-morbidities that affected care during this admission
- Hospital-acquired conditions must NOT be the principal diagnosis
- Only code diagnoses that are CONFIRMED in documentation — not "rule out" or "query" diagnoses

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MANDATORY CODING RULE (do not skip this):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are given a list of CONFIRMED diagnoses (already validated by VA4 as
supported_by_timeline=true) and a list of CONFIRMED surgical/invasive procedures
(already validated by VA3). EVERY single one of these MUST appear in your output —
either:
  (a) with a real ICD-10 code in suggested_icd10_codes (or a real procedure code in
      suggested_procedure_codes for procedures), using your best clinical coding
      knowledge to assign the most specific code the documentation supports, OR
  (b) if — and only if — you genuinely cannot determine a specific enough code from
      the documentation (e.g. laterality, stage, or subtype is not specified), you
      MUST still emit an entry in suggested_icd10_codes using the best available
      (even if less specific/category-level) code, AND additionally raise a
      cdi_query explaining exactly what additional detail is needed to make the
      code more specific.
You must NEVER simply omit a confirmed diagnosis or confirmed procedure from the
coding output with no code and no cdi_query. An empty suggested_icd10_codes list is
only acceptable if the confirmed diagnoses list given to you is itself empty.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return ONLY valid JSON."""

        prompt = f"""
SPECIALTY        : {specialty}
ADMISSION REASON : {state.get('admission_reason', 'Not documented')}
PATIENT          : {state.get('patient_name', 'Unknown')}
ADMISSION DATE   : {state.get('admission_date', 'Unknown')}

DISCHARGE SUMMARY (for coding context):
═══════════════════════════════════════════════════════════
{discharge_summary[:3000]}{'...[truncated]' if len(discharge_summary) > 3000 else ''}
═══════════════════════════════════════════════════════════

FULL DAY_WISE_TIMELINE (RAW JSON — SOURCE OF TRUTH):
═══════════════════════════════════════════════════════════
{raw_timeline_json}
═══════════════════════════════════════════════════════════

CONFIRMED DIAGNOSES (from VA4 — supported_by_timeline=true — EVERY ONE OF THESE
MUST be coded or accompanied by a cdi_query; do not drop any of them silently):
{json.dumps(confirmed_diagnoses, indent=2, default=str)}

CONFIRMED SURGICAL/INVASIVE PROCEDURES (from VA3 — EVERY ONE OF THESE MUST receive
a procedure code attempt or a cdi_query):
{json.dumps(confirmed_procedures, indent=2, default=str)}

ALL CLASSIFIED PROCEDURES (for reference — includes imaging/bedside, no codes needed
for non-surgical items):
{json.dumps(proc_report.get('procedures_classified', []), indent=2, default=str)}

ALL DIAGNOSES ACCURACY (for reference, includes any not yet confirmed):
{json.dumps(cons_report.get('diagnoses_accuracy', []), indent=2, default=str)}

CODING TASK:

SECTION 1: suggested_icd10_codes
MANDATORY — must contain one entry for EVERY diagnosis listed in
"CONFIRMED DIAGNOSES" above (per the MANDATORY CODING RULE). Use your best clinical
coding knowledge to assign the most accurate and specific ICD-10 code the
documentation supports.
Schema: [
  {{
    "code":              "ICD-10 code e.g. C67.9",
    "description":       "ICD-10 description",
    "diagnosis":         "as documented in timeline",
    "code_type":         "principal|secondary|hospital_acquired",
    "poi_indicator":     "yes|no|unknown",
    "evidence":          "exact text from timeline",
    "source_document":   "...",
    "code_specificity":  "specific|category_level_pending_cdi",
    "confidence_score":  0.0
  }}
]

SECTION 2: suggested_procedure_codes
MANDATORY — must contain one entry for EVERY procedure listed in
"CONFIRMED SURGICAL/INVASIVE PROCEDURES" above.
Schema: [
  {{
    "code":             "ICD-10-PCS or CPT code",
    "description":      "procedure description",
    "procedure":        "as documented",
    "date":             "YYYY-MM-DD or unknown",
    "source_document":  "...",
    "confidence_score": 0.0
  }}
]

SECTION 3: drg_band
Based on principal diagnosis and procedures above.
Schema:
{{
  "estimated_drg":          "DRG code or description if determinable",
  "drg_note":               "brief rationale",
  "expected_los_band":      "e.g. 2-5 days",
  "confidence_score":       0.0
}}

SECTION 4: cc_mcc_captured
Complications (CC) and Major Complications (MCC) that affect DRG weight.
Only include if explicitly documented in timeline.
Schema: [
  {{
    "condition":        "...",
    "cc_or_mcc":        "CC|MCC",
    "icd10_code":       "...",
    "evidence":         "exact text",
    "source_document":  "...",
    "confidence_score": 0.0
  }}
]
If none: []

SECTION 5: hac_exclusion_review
Hospital-Acquired Conditions that could affect quality metrics.
Schema: [
  {{
    "condition":          "...",
    "poi_indicator":      "yes|no|unknown",
    "poi_evidence":       "exact text or not_documented",
    "hac_flag":           true|false,
    "source_document":    "...",
    "confidence_score":   0.0
  }}
]
If none: []

SECTION 6: cdi_queries
MANDATORY companion to Section 1/2 — raise a query for ANY confirmed diagnosis or
procedure where you assigned only a category-level (non-specific) code instead of a
fully specific one, explaining exactly what additional documentation detail
(laterality, stage, grade, specific organism, etc.) is needed.
Schema: [
  {{
    "query_type":       "...",
    "question":         "exact CDI query to physician",
    "reason":           "...",
    "related_diagnosis_or_procedure": "...",
    "impact":           "DRG weight / code specificity / POA indicator",
    "confidence_score": 0.0
  }}
]
If every confirmed diagnosis/procedure already has a fully specific code: []

SECTION 7: issues  (confidence ≥ 0.75)
Schema: [
  {{
    "severity":         "Critical|Major|Moderate|Minor",
    "category":         "Coding & Billing",
    "description":      "...",
    "evidence":         "exact text",
    "source_document":  "...",
    "date":             "YYYY-MM-DD or unknown",
    "confidence_score": 0.0,
    "recommendation":   "..."
  }}
]

Return ONLY this valid JSON:
{{
  "suggested_icd10_codes":    [...],
  "suggested_procedure_codes":[...],
  "drg_band":                 {{}},
  "cc_mcc_captured":          [...],
  "hac_exclusion_review":     [...],
  "cdi_queries":              [...],
  "issues":                   [...]
}}
"""
        result = await self._invoke(system, prompt)

        # ── Safety net: enforce MANDATORY CODING RULE in code, not just prompt ──
        # If the LLM still dropped a confirmed diagnosis with no code and no cdi_query,
        # surface that as a critical pipeline issue so it is visible to the frontend
        # instead of silently disappearing.
        try:
            coded_diagnoses = {
                (c.get("diagnosis") or "").strip().lower()
                for c in result.get("suggested_icd10_codes", [])
                if isinstance(c, dict)
            }
            queried_diagnoses = {
                (q.get("related_diagnosis_or_procedure") or "").strip().lower()
                for q in result.get("cdi_queries", [])
                if isinstance(q, dict)
            }
            uncovered = []
            for d in confirmed_diagnoses:
                name = (d.get("diagnosis") or "").strip().lower()
                if name and name not in coded_diagnoses and name not in queried_diagnoses:
                    uncovered.append(d.get("diagnosis"))
            if uncovered:
                result.setdefault("issues", []).append({
                    "severity": "Major",
                    "category": "Coding & Billing",
                    "description": (
                        "Confirmed diagnosis/diagnoses missing an ICD-10 code suggestion "
                        "or CDI query: " + ", ".join(uncovered)
                    ),
                    "evidence": "Cross-check against VA4 confirmed diagnoses list",
                    "source_document": "VA9 internal consistency check",
                    "date": "unknown",
                    "confidence_score": 0.9,
                    "recommendation": "Re-run coding pass to assign a code or raise a CDI query for the uncovered diagnosis.",
                })
                logger.warning(f"{self.agent_id} · Uncovered confirmed diagnoses (no code/no CDI query): {uncovered}")
        except Exception as e:
            logger.error(f"{self.agent_id} · mandatory coding safety-net check failed: {e}")

        logger.info(f"billcodings:{result}")
        state["coding_billing_report"]        = result
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · CodingBilling — DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ═══════════════════════════════════════════════════════════════
# VA10 · INSURANCE DOCUMENT AGENT  (NEW — P7 gap)
# ═══════════════════════════════════════════════════════════════

class InsuranceDocumentAgent(BaseAgent):
    agent_id = "VA10"

    async def run(self, state: ValidationState) -> ValidationState:
        logger.info(f"{self.agent_id} · InsuranceDocument — START")
        t0 = datetime.now().timestamp()

        timeline          = state["day_wise_timeline"]
        discharge_summary = state.get("discharge_summary", "")
        specialty         = state["specialty"]
        raw_timeline_json = _serialize_timeline(timeline)

        coding_report    = state.get("coding_billing_report") or {}
        readiness_report = state.get("readiness_report") or {}
        followup_report  = state.get("followup_report") or {}

        # Defensive normalization — llm_light sometimes returns dict-schema fields as lists
        coding_report = {
            **coding_report,
            "drg_band":              _ensure_dict(coding_report.get("drg_band")),
            "preauth_summary":       _ensure_dict(coding_report.get("preauth_summary")),
        }
        readiness_report = {
            **readiness_report,
            "discharge_appropriateness": _ensure_dict(readiness_report.get("discharge_appropriateness")),
        }

        system = f"""You are a senior {specialty} insurance coordinator and medical necessity documentation specialist.
{MASTER_AUDIT_RULES}

YOUR TASK: Generate structured payer documentation content based ONLY on documented evidence
in the day_wise_timeline. All claims must be supported by explicit source evidence.
Do NOT fabricate clinical details. If evidence is absent, note "not_documented".
Return ONLY valid JSON."""

        prompt = f"""
SPECIALTY        : {specialty}
ADMISSION REASON : {state.get('admission_reason', 'Not documented')}
PATIENT NAME     : {state.get('patient_name', 'Unknown')}
DOB              : {state.get('patient_dob', 'Unknown')}
SEX              : {state.get('patient_sex', 'Unknown')}
ADMISSION DATE   : {state.get('admission_date', 'Unknown')}

DISCHARGE SUMMARY:
═══════════════════════════════════════════════════════════
{discharge_summary[:2000]}{'...[truncated]' if len(discharge_summary) > 2000 else ''}
═══════════════════════════════════════════════════════════

FULL DAY_WISE_TIMELINE (RAW JSON):
═══════════════════════════════════════════════════════════
{raw_timeline_json}
═══════════════════════════════════════════════════════════

ICD-10 CODES (from VA9):
{json.dumps(coding_report.get('suggested_icd10_codes', []), indent=2, default=str)}

DRG BAND (from VA9):
{json.dumps(coding_report.get('drg_band') or {}, indent=2, default=str)}

DISCHARGE READINESS VERDICT (from VA5):
{json.dumps(readiness_report.get('discharge_appropriateness') or  {}, indent=2, default=str)}

FOLLOW-UP PLANS (from VA6):
{json.dumps(followup_report.get('documented_followup_plans', []), indent=2, default=str)}

INSURANCE DOCUMENT TASK:

SECTION 1: preauth_summary
Clinical justification for the admission and principal procedure.
Schema:
{{
  "admission_justification":  "evidence-based paragraph using documented findings",
  "principal_procedure":      "...",
  "clinical_urgency":         "elective|urgent|emergency|not_documented",
  "supporting_evidence":      ["exact text from timeline", "..."],
  "confidence_score":         0.0
}}

SECTION 2: los_justification
Day-by-day clinical rationale for length of stay.
Schema: [
  {{
    "day":             "YYYY-MM-DD or Day N",
    "rationale":       "clinical reason patient required inpatient care this day",
    "evidence":        "exact text from timeline",
    "source_document": "..."
  }}
]

SECTION 3: medical_necessity_letter
Structured elements for a medical necessity letter.
Schema:
{{
  "patient_summary":          "...",
  "diagnosis":                "...",
  "treatment_provided":       "...",
  "clinical_necessity":       "evidence-based paragraph",
  "outcome":                  "...",
  "physician_statement_note": "Requires physician signature before submission"
}}

SECTION 4: discharge_summary_payer_format
Structured payer-formatted summary elements.
Schema:
{{
  "reason_for_admission":  "...",
  "final_diagnoses":       ["..."],
  "procedures_performed":  ["..."],
  "clinical_course":       "...",
  "discharge_condition":   "...",
  "discharge_medications": ["..."],
  "followup_plan":         "...",
  "pending_results":       ["..."]
}}

SECTION 5: claims_package_elements
Checklist of components needed for the claims package.
Schema:
{{
  "patient_demographics_available":    true|false,
  "icd10_codes_available":             true|false,
  "procedure_codes_available":         true|false,
  "discharge_summary_available":       true|false,
  "operative_notes_available":         true|false,
  "lab_reports_available":             true|false,
  "imaging_reports_available":         true|false,
  "missing_elements":                  ["list any items marked false above"],
  "claims_readiness":                  "ready|incomplete|not_assessed"
}}

SECTION 6: issues  (confidence ≥ 0.75)
Schema: [
  {{
    "severity":         "Critical|Major|Moderate|Minor",
    "category":         "Insurance Documentation",
    "description":      "...",
    "evidence":         "exact text",
    "source_document":  "...",
    "date":             "YYYY-MM-DD or unknown",
    "confidence_score": 0.0,
    "recommendation":   "..."
  }}
]

Return ONLY this valid JSON:
{{
  "preauth_summary":               {{}},
  "los_justification":             [...],
  "medical_necessity_letter":      {{}},
  "discharge_summary_payer_format":{{}},
  "claims_package_elements":       {{}},
  "issues":                        [...]
}}
"""
        result = await self._invoke(system, prompt)
        state["insurance_document_report"]    = result
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · InsuranceDocument — DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ═══════════════════════════════════════════════════════════════
# VA11 · POST-DISCHARGE MONITORING AGENT  (NEW — P9 gap)
# ═══════════════════════════════════════════════════════════════

class PostDischargeMonitoringAgent(BaseAgent):
    agent_id = "VA11"

    async def run(self, state: ValidationState) -> ValidationState:
        logger.info(f"{self.agent_id} · PostDischargeMonitoring — START")
        t0 = datetime.now().timestamp()

        specialty         = state["specialty"]
        admission_reason  = state.get("admission_reason", "Not documented")

        proc_report      = state.get("procedure_report") or {}
        med_report       = state.get("medication_report") or {}
        readiness_report = state.get("readiness_report") or {}
        followup_report  = state.get("followup_report") or {}
        cons_report      = state.get("consistency_report") or {}
        safety_report    = state.get("safety_allergy_report") or {}

        # Defensive normalization
        readiness_report = {
            **readiness_report,
            "clinical_stability_score": _ensure_dict(readiness_report.get("clinical_stability_score")),
        }

        diagnoses        = [d.get("diagnosis","") for d in cons_report.get("diagnoses_accuracy", []) if d.get("supported_by_timeline")]
        procedures       = [p.get("name","") for p in proc_report.get("procedures_classified", [])]
        high_risk_meds   = [m.get("drug","") for m in med_report.get("high_risk_medications_documented", [])]
        pending_results  = [p.get("test","") for p in followup_report.get("pending_investigations_requiring_review", [])]
        hac_conditions   = [h.get("condition","") for h in safety_report.get("hospital_acquired_conditions", [])]
        readiness_score  = readiness_report.get("clinical_stability_score", {}).get("score", "unknown")
        followup_plans   = [f.get("specialty_or_service","") for f in followup_report.get("documented_followup_plans", [])]

        system = f"""You are a senior {specialty} post-discharge care coordinator designing an
evidence-based post-discharge monitoring protocol.
{MASTER_AUDIT_RULES}

YOUR TASK: Generate personalised post-discharge monitoring question sets and risk flags
based ONLY on the patient's confirmed diagnoses, procedures, medications, and pending results
from this admission. Do NOT add generic questions unrelated to this patient's documented conditions.

Day-2  call: early complications, medication access, wound/procedure site concerns
Day-7  call: recovery progress, first follow-up attended, symptom trajectory
Day-30 survey: full recovery, readmission elsewhere, functional status, satisfaction

Return ONLY valid JSON."""

        prompt = f"""
SPECIALTY        : {specialty}
ADMISSION REASON : {admission_reason}
PATIENT          : {state.get('patient_name', 'Unknown')}

CONFIRMED DIAGNOSES FROM THIS ADMISSION: {json.dumps(diagnoses)}
PROCEDURES PERFORMED: {json.dumps(procedures)}
HIGH-RISK MEDICATIONS AT DISCHARGE: {json.dumps(high_risk_meds)}
PENDING RESULTS AT DISCHARGE: {json.dumps(pending_results)}
HOSPITAL-ACQUIRED CONDITIONS: {json.dumps(hac_conditions)}
CLINICAL STABILITY SCORE: {readiness_score}/10
FOLLOW-UP APPOINTMENTS PLANNED: {json.dumps(followup_plans)}

POST-DISCHARGE MONITORING TASK:

SECTION 1: day2_questions
Personalised Day-2 follow-up call questions based on THIS patient's diagnoses and procedures.
Schema: [
  {{
    "question":          "plain language question for patient",
    "rationale":         "why this question is relevant to this patient",
    "escalation_if":     "what answer would trigger escalation",
    "escalation_action": "nurse callback within 2h|clinician alert|advise ED visit"
  }}
]
Minimum 5 questions. Maximum 10.

SECTION 2: day7_questions
Day-7 follow-up questions.
Schema: [
  {{
    "question":          "...",
    "rationale":         "...",
    "escalation_if":     "...",
    "escalation_action": "..."
  }}
]
Minimum 5 questions. Maximum 10.

SECTION 3: day30_questions
Day-30 survey questions.
Schema: [
  {{
    "question":          "...",
    "rationale":         "...",
    "escalation_if":     "...",
    "escalation_action": "..."
  }}
]
Minimum 5 questions. Maximum 10.

SECTION 4: high_risk_flags
Conditions from this patient's record that place them at elevated readmission risk.
Schema: [
  {{
    "risk_factor":    "...",
    "basis":          "diagnosis|procedure|medication|pending_result|hac",
    "risk_level":     "High|Medium|Low",
    "monitoring_note":"..."
  }}
]

SECTION 5: escalation_triggers
Specific symptoms or responses that should trigger immediate clinical escalation.
These MUST be personalised to the diagnoses and procedures documented for this patient.
Schema: [
  {{
    "trigger":           "...",
    "related_to":        "diagnosis or procedure name",
    "action":            "Immediate ED|Clinician call within 2h|GP same day",
    "communication_channel":"AI call|SMS|app alert"
  }}
]

SECTION 6: readmission_risk_indicators
Evidence-based indicators of readmission risk from this patient's record.
Schema:
{{
  "overall_risk_level":          "High|Medium|Low",
  "risk_score_basis":            "...",
  "primary_risk_factors":        ["..."],
  "protective_factors":          ["..."],
  "recommended_monitoring_level":"intensive|standard|basic"
}}

SECTION 7: issues
Any gaps in the discharge plan that increase post-discharge risk.
Schema: [
  {{
    "severity":         "Critical|Major|Moderate|Minor",
    "category":         "Post-Discharge Monitoring",
    "description":      "...",
    "evidence":         "based on documented clinical findings",
    "source_document":  "...",
    "date":             "YYYY-MM-DD or unknown",
    "confidence_score": 0.0,
    "recommendation":   "..."
  }}
]

Return ONLY this valid JSON:
{{
  "day2_questions":              [...],
  "day7_questions":              [...],
  "day30_questions":             [...],
  "high_risk_flags":             [...],
  "escalation_triggers":         [...],
  "readmission_risk_indicators": {{}},
  "issues":                      [...]
}}
"""
        result = await self._invoke(system, prompt)
        state["post_discharge_report"]        = result
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · PostDischargeMonitoring — DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ═══════════════════════════════════════════════════════════════
# VA7 · FINAL AUDIT AGENT  (updated — aggregates all 11 agents)
# ═══════════════════════════════════════════════════════════════

class FinalAuditAgent(BaseAgent):
    agent_id = "VA7"

    async def run(self, state: ValidationState) -> ValidationState:
        logger.info(f"{self.agent_id} · FinalAudit — START")
        t0 = datetime.now().timestamp()

        specialty = state["specialty"]

        def _get_issues(report: Optional[Dict]) -> List[Dict]:
            if not report or not isinstance(report, dict):
                return []
            return [
                i for i in report.get("issues", [])
                if isinstance(i, dict) and float(i.get("confidence_score", 0)) >= 0.75
            ]

        inv_result_report = state.get("investigation_result_report") or {}
        med_report        = state.get("medication_report")           or {}
        proc_report       = state.get("procedure_report")            or {}
        cons_report       = state.get("consistency_report")          or {}
        ready_report      = state.get("readiness_report")            or {}
        fu_report         = state.get("followup_report")             or {}
        safety_report     = state.get("safety_allergy_report")       or {}
        coding_report     = state.get("coding_billing_report")       or {}
        insurance_report  = state.get("insurance_document_report")   or {}
        pd_report         = state.get("post_discharge_report")       or {}

        # Defensive normalization for all dict-schema fields from light model agents
        coding_report = {
            **coding_report,
            "drg_band": _ensure_dict(coding_report.get("drg_band")),
        }
        ready_report = {
            **ready_report,
            "discharge_appropriateness": _ensure_dict(ready_report.get("discharge_appropriateness")),
            "clinical_stability_score":  _ensure_dict(ready_report.get("clinical_stability_score")),
        }

        all_issues = (
            _get_issues(inv_result_report)
            + _get_issues(med_report)
            + _get_issues(proc_report)
            + _get_issues(cons_report)
            + _get_issues(ready_report)
            + _get_issues(fu_report)
            + _get_issues(safety_report)
            + _get_issues(coding_report)
            + _get_issues(insurance_report)
            + _get_issues(pd_report)
        )

        disease_timeline  = proc_report.get("disease_timeline", [])
        readiness_verdict = ready_report.get("discharge_appropriateness", {})
        stab_score        = ready_report.get("clinical_stability_score", {})
        active_concerns   = (
            inv_result_report.get("active_concerns_evidence_based", [])
            + cons_report.get("active_concerns_evidence_based", [])
        )
        findings_comp = (
            inv_result_report.get("findings_comparison", [])
            + cons_report.get("findings_comparison", [])
        )

        # P8 quality gate checks
        quality_gate = {
            "missing_primary_diagnosis":    len(cons_report.get("diagnoses_accuracy", [])) == 0,
            "missing_followup_instructions": not fu_report.get("documented_followup_plans"),
            "pending_results_not_acknowledged": len(fu_report.get("pending_investigations_requiring_review", [])) > 0,
            "red_flag_symptoms_missing":    not fu_report.get("red_flag_symptoms_documented", {}).get("documented", False),
            "patient_education_incomplete": not fu_report.get("patient_education_documented", {}).get("documented", False),
            "allergy_concern_present":      len(safety_report.get("allergy_flags", [])) > 0,
            "readiness_score_below_70":     (stab_score.get("score", 10) or 10) < 7,
        }
        quality_gate_blocks = [k for k, v in quality_gate.items() if v]

        system = f"""You are the senior {specialty} clinical audit lead aggregating all agent findings.
{MASTER_AUDIT_RULES}

AGGREGATION RULES:
- Only aggregate issues with confidence_score ≥ 0.75
- Remove duplicate issues (same finding from different agents → keep highest confidence)
- Do NOT amplify severity beyond what evidence supports
- Do NOT escalate findings to Critical without explicit Critical-level evidence
- If evidence for an issue is absent → remove it

P8 QUALITY GATE: The approved_for_clinical_use flag must be false if:
  • Any Critical issue exists with confidence ≥ 0.75, OR
  • Any Major factual error in discharge summary exists, OR
  • Any quality gate hard block is triggered (see quality_gate_blocks below)
Return ONLY valid JSON."""

        prompt = f"""
SPECIALTY       : {specialty}
PATIENT         : {state.get('patient_name','Unknown')}  DOB: {state.get('patient_dob','Unknown')}  Sex: {state.get('patient_sex','Unknown')}
ADMISSION DATE  : {state.get('admission_date','Unknown')}
ADMISSION REASON: {state.get('admission_reason','Not documented')}

ALL VALIDATED ISSUES FROM ALL AGENTS (confidence ≥ 0.75):
{json.dumps(all_issues, indent=2, default=str)}

ACTIVE CONCERNS (evidence-based):
{json.dumps(active_concerns, indent=2, default=str)}

FINDINGS COMPARISON:
{json.dumps(findings_comp, indent=2, default=str)}

DISEASE TIMELINE:
{json.dumps(disease_timeline, indent=2, default=str)}

DISCHARGE READINESS VERDICT:
{json.dumps(readiness_verdict, indent=2, default=str)}

STABILITY SCORE: {json.dumps(stab_score, default=str)}

P8 QUALITY GATE BLOCKS TRIGGERED: {json.dumps(quality_gate_blocks)}
P8 FULL QUALITY GATE STATUS: {json.dumps(quality_gate, indent=2)}

ISSUE COUNT PER AGENT:
- VA1B Investigation Result : {len(_get_issues(inv_result_report))}
- VA2  Medication            : {len(_get_issues(med_report))}
- VA3  Procedure             : {len(_get_issues(proc_report))}
- VA4  Consistency           : {len(_get_issues(cons_report))}
- VA5  Readiness             : {len(_get_issues(ready_report))}
- VA6  Follow-Up             : {len(_get_issues(fu_report))}
- VA8  Safety & Allergy      : {len(_get_issues(safety_report))}
- VA9  Coding & Billing      : {len(_get_issues(coding_report))}
- VA10 Insurance             : {len(_get_issues(insurance_report))}
- VA11 Post-Discharge        : {len(_get_issues(pd_report))}

TASK — Final Audit Report:

SECTION 1: categorised_issues
Deduplicate then categorise all issues. Only confidence ≥ 0.75.
Schema:
{{
  "Critical": [...],
  "Major":    [...],
  "Moderate": [...],
  "Minor":    [...]
}}

SECTION 2: issue_counts
Schema: {{"Critical":0,"Major":0,"Moderate":0,"Minor":0,"Total":0}}

SECTION 3: active_critical_concerns_summary
Only concerns with confidence ≥ 0.75. If none: []
Schema: [
  {{"concern":"...","evidence":"...","source_document":"...","date":"...","confidence_score":0.0}}
]

SECTION 4: disease_timeline_narrative
Chronological clinical story using ONLY documented events. Max 8 items.
Schema: [
  {{"date":"...","event":"...","source_document":"...","significance":"..."}}
]

SECTION 5: findings_comparison_table
Deduplicated from agent outputs.
Schema: [
  {{"parameter":"...","on_admission":"...","at_discharge":"...","trajectory":"increasing|decreasing|stable|single_reading_only|not_documented"}}
]

SECTION 6: discharge_readiness_verdict
Use exactly what VA5 returned. Do not modify.
Schema: {{"verdict":"...","rationale":"...","stability_score":0}}

SECTION 7: priority_action_list
Top 5 actions from evidenced issues. If fewer than 5 exist, output fewer.
Schema: [
  {{"rank":1,"action":"...","urgency":"Immediate|Within 24h|Before discharge","agent":"VA1A-VA11","evidence":"..."}}
]

SECTION 8: scores
Base scores on documented evidence quality.
Schema:
{{
  "investigation_completeness": 0.0,
  "medication_safety":          0.0,
  "procedure_documentation":    0.0,
  "summary_accuracy":           0.0,
  "discharge_readiness":        0.0,
  "followup_adequacy":          0.0,
  "patient_safety":             0.0,
  "coding_completeness":        0.0,
  "insurance_readiness":        0.0,
  "post_discharge_planning":    0.0,
  "overall":                    0.0
}}

SECTION 9: quality_gate_status
P8 quality gate result.
Schema:
{{
  "blocks_triggered":       {json.dumps(quality_gate_blocks)},
  "hard_block_active":      {str(len(quality_gate_blocks) > 0).lower()},
  "discharge_can_proceed":  true|false,
  "gate_notes":             "..."
}}

SECTION 10: approved_for_clinical_use
true  = no Critical issues AND no Major factual errors AND no P8 hard blocks
false = at least one Critical/Major issue OR P8 block triggered
Schema: true|false

SECTION 11: audit_conclusion
2-3 sentences. Factual. Evidence-based. No invented clinical states.
Schema: "..."

Return ONLY this valid JSON:
{{
  "categorised_issues":               {{"Critical":[],"Major":[],"Moderate":[],"Minor":[]}},
  "issue_counts":                     {{"Critical":0,"Major":0,"Moderate":0,"Minor":0,"Total":0}},
  "active_critical_concerns_summary": [...],
  "disease_timeline_narrative":       [...],
  "findings_comparison_table":        [...],
  "discharge_readiness_verdict":      {{}},
  "priority_action_list":             [...],
  "scores":                           {{}},
  "quality_gate_status":              {{}},
  "approved_for_clinical_use":        true,
  "audit_conclusion":                 "..."
}}
"""
        result = await self._invoke(system, prompt)
        state["final_audit"]                  = result
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(
            f"{self.agent_id} · FinalAudit — DONE ({state['agent_timings'][self.agent_id]}ms) | "
            f"Overall: {result.get('scores',{}).get('overall','N/A')} | "
            f"Approved: {result.get('approved_for_clinical_use','?')}"
        )
        return state


# ═══════════════════════════════════════════════════════════════
# WORKFLOW GRAPH  (v4 — updated pipeline)
# ═══════════════════════════════════════════════════════════════
#
# EXECUTION ORDER:
#   Step 1 (SEQUENTIAL):  VA1A — extract all orders from timeline
#   Step 2 (SEQUENTIAL):  VA1B — verify each order against full timeline
#   Step 3 (PARALLEL):    VA1B result + VA2 + VA3 + VA8 run together
#                         (VA1A/1B already done; VA2, VA3, VA8 are independent)
#   Step 4 (SEQUENTIAL):  VA4 → VA5 → VA6 → VA9 → VA10 → VA11 → VA7
# ═══════════════════════════════════════════════════════════════

async def _run_va1a_then_va1b(state: ValidationState) -> ValidationState:
    """VA1A (order extraction) → VA1B (result verification) — sequential."""
    logger.info("SEQUENTIAL · VA1A → VA1B — START")
    t0 = datetime.now().timestamp()

    va1a = InvestigationOrderExtractorAgent(llm_heavy)
    state = await va1a.run(state)

    va1b = InvestigationResultVerifierAgent(llm_heavy)
    state = await va1b.run(state)

    logger.info(f"SEQUENTIAL · VA1A → VA1B — DONE ({round(_elapsed(t0))}ms)")
    return state


async def _parallel_wave1(state: ValidationState) -> ValidationState:
    """
    Wave 1 parallel: VA1A+VA1B sub-pipeline, VA2, VA3, VA8 — all independent.
    VA1A→VA1B runs as a sequential sub-task within asyncio.gather.
    """
    logger.info("PARALLEL WAVE 1 · VA1A→VA1B + VA2 + VA3 + VA8 — START")
    t0 = datetime.now().timestamp()

    va2 = MedicationReconciliationAgent(llm_heavy)
    va3 = ProcedureSurgeryAgent(llm_heavy)
    va8 = SafetyAllergyAgent(llm_heavy)

    results = await asyncio.gather(
        _run_va1a_then_va1b(dict(state)),   # type: ignore[arg-type]
        va2.run(dict(state)),                # type: ignore[arg-type]
        va3.run(dict(state)),                # type: ignore[arg-type]
        va8.run(dict(state)),                # type: ignore[arg-type]
        return_exceptions=True,
    )

    agent_groups = ["VA1A_VA1B", "VA2", "VA3", "VA8"]
    for group, result in zip(agent_groups, results):
        if isinstance(result, Exception):
            logger.error(f"{group} parallel failed: {result}")
            state["errors"].append(f"{group}: {str(result)}")
        else:
            if group == "VA1A_VA1B":
                state["investigation_order_report"]  = result.get("investigation_order_report")
                state["investigation_result_report"] = result.get("investigation_result_report")
            elif group == "VA2":
                state["medication_report"]           = result.get("medication_report")
            elif group == "VA3":
                state["procedure_report"]            = result.get("procedure_report")
            elif group == "VA8":
                state["safety_allergy_report"]       = result.get("safety_allergy_report")
            state["agent_timings"].update(result.get("agent_timings", {}))

    logger.info(f"PARALLEL WAVE 1 — DONE ({round(_elapsed(t0))}ms)")
    return state


def create_validation_workflow() -> Any:
    workflow = StateGraph(ValidationState)

    # Wave 1: parallel (VA1A→VA1B, VA2, VA3, VA8)
    workflow.add_node("wave1_parallel", _parallel_wave1)

    # Wave 2: sequential chain
    workflow.add_node("VA4",  ClinicalConsistencyAgent(llm_heavy).run)
    workflow.add_node("VA5",  DischargeReadinessAgent(llm_heavy).run)
    workflow.add_node("VA6",  FollowUpAgent(llm_heavy).run)
    workflow.add_node("VA9",  CodingBillingAgent(llm_light).run)
    workflow.add_node("VA10", InsuranceDocumentAgent(llm_light).run)
    workflow.add_node("VA11", PostDischargeMonitoringAgent(llm_light).run)
    workflow.add_node("VA7",  FinalAuditAgent(llm_light).run)

    workflow.set_entry_point("wave1_parallel")
    workflow.add_edge("wave1_parallel", "VA4")
    workflow.add_edge("VA4",  "VA5")
    workflow.add_edge("VA5",  "VA6")
    workflow.add_edge("VA6",  "VA9")
    workflow.add_edge("VA9",  "VA10")
    workflow.add_edge("VA10", "VA11")
    workflow.add_edge("VA11", "VA7")
    workflow.add_edge("VA7",  END)

    return workflow.compile()


validation_workflow = create_validation_workflow()


# ═══════════════════════════════════════════════════════════════
# STATE FACTORY
# ═══════════════════════════════════════════════════════════════

def build_validation_state(request: ValidationRequest, record: Dict) -> ValidationState:
    return ValidationState(
        patient_id    = request.patient_id,
        doctor_id     = request.doctor_id,
        specialty     = request.specialty,

        day_wise_timeline = record.get("day_wise_timeline", []),
        discharge_summary = record.get("discharge_summary", ""),
        admission_reason  = record.get("admission_reason"),
        admission_date    = record.get("admission_date"),
        patient_name      = (record.get("patient") or {}).get("name"),
        patient_dob       = (record.get("patient") or {}).get("dob"),
        patient_sex       = (record.get("patient") or {}).get("sex"),

        investigation_order_report   = None,
        investigation_result_report  = None,
        medication_report            = None,
        procedure_report             = None,
        consistency_report           = None,
        readiness_report             = None,
        followup_report              = None,
        final_audit                  = None,
        safety_allergy_report        = None,
        coding_billing_report        = None,
        insurance_document_report    = None,
        post_discharge_report        = None,

        errors        = [],
        agent_timings = {},
    )


# ═══════════════════════════════════════════════════════════════
# DEMO DATA  (same as v3 — TURBT urology patient)
# ═══════════════════════════════════════════════════════════════

def _demo_record() -> Dict:
    return {
        "patient_id":       "PAT-demo-001",
        "doctor_id":        "DOC-demo-001",
        "specialty":        "Urology",
        "admission_reason": "Haematuria with bladder mass on imaging",
        "admission_date":   "2026-01-06",
        "patient": {"name": "Demo Patient", "dob": "1958-04-12", "sex": "Male"},
        "discharge_summary": (
            "Patient admitted for haematuria. TURBT performed on 06 Jan 2026. "
            "Histopathology revealed Grade 3 transitional cell carcinoma with muscle invasion. "
            "Post-operative course uneventful. Discharged on oral antibiotics. "
            "Follow-up in 2 weeks with urology."
        ),
        "day_wise_timeline": [
            {
                "type": "admission", "date": "2026-01-06",
                "date_label": "Admission", "day_number": 0,
                "story_narrative": "Patient admitted with haematuria and bladder mass on imaging.",
                "documents": [],
            },
            {
                "type": "clinical_day", "date": "2026-01-06",
                "date_label": "Admission Day", "day_number": 1,
                "story_narrative": "TURBT performed. Histopathology specimens sent.",
                "documents": [
                    {
                        "document_label": "Histopathology / Biopsy Report",
                        "filename": "histopath_turbt.pdf",
                        "vitals": [], "medications": [],
                        "investigations": [
                            {
                                "test": "Histopathology — TURBT specimen",
                                "result": "Transitional cell carcinoma grade 3, muscle-invasive. Lamina propria shows multiple Von Brunn's nests. Muscularis propria involved. Lymphovascular invasion not identified.",
                                "unit": "", "reference_range": "", "status": "abnormal"
                            },
                        ],
                        "procedures": [
                            {"name": "TURBT", "detail": "Bulk resection, deep resection, random biopsy. Multiple fragments 6×3.8×1.5 cm received.", "laterality": "", "surgeon": ""},
                        ],
                        "findings": [
                            "TCC grade 3 infiltrating muscle bundles",
                            "Muscularis propria involved",
                            "Von Brunn's nests in lamina propria",
                            "Lymphovascular invasion not identified"
                        ],
                        "diagnoses": ["Transitional cell carcinoma bladder grade 3 with muscularis propria invasion"],
                        "treatments": [],
                        "abnormalities": ["Grade 3 TCC with muscularis propria invasion — high-risk malignancy requiring oncology referral"],
                        "recommendations": [],
                    },
                ],
            },
            {
                "type": "clinical_day", "date": "2026-01-07",
                "date_label": "Day 2 of Admission", "day_number": 2,
                "story_narrative": "Post-op day 1. Hypotension and oliguria noted in nursing notes.",
                "documents": [
                    {
                        "document_label": "Doctor Progress Note",
                        "filename": "doctor_progress_note_07jan.pdf",
                        "vitals": [],
                        "medications": [
                            {"drug": "Ceftriaxone",   "dose": "1g",    "route": "IV",   "frequency": "BD",  "duration": ""},
                            {"drug": "Pantoprazole",  "dose": "40mg",  "route": "oral", "frequency": "OD",  "duration": ""},
                            {"drug": "Tramadol",      "dose": "50mg",  "route": "IV",   "frequency": "SOS", "duration": ""},
                            {"drug": "Metronidazole", "dose": "400mg", "route": "oral", "frequency": "TDS", "duration": ""},
                        ],
                        "investigations": [
                            {"test": "CBC repeat", "result": "pending", "unit": "", "reference_range": "", "status": "pending"},
                        ],
                        "procedures": [],
                        "findings": [
                            "Abdomen soft, non-tender",
                            "Catheter draining clear urine",
                            "Patient comfortable, no active complaints"
                        ],
                        "diagnoses": [
                            "Post-operative day 1 TURBT",
                            "Transitional cell carcinoma bladder grade 3"
                        ],
                        "treatments": ["Continue IV antibiotics", "Monitor urine output hourly"],
                        "abnormalities": [],
                        "recommendations": [
                            "Continue IV antibiotics",
                            "Monitor urine output hourly",
                            "Repeat CBC tomorrow",
                            "Remove catheter on post-op day 3 if urine clear",
                            "Urology follow-up in 2 weeks",
                            "Oncology referral for muscle-invasive TCC",
                        ],
                    },
                    {
                        "document_label": "Nursing Progress Note",
                        "filename": "nursing_note_07jan.pdf",
                        "vitals": [
                            {"parameter": "BP",           "value": "90/60", "unit": "mmHg",  "note": "hypotension documented"},
                            {"parameter": "HR",           "value": "110",   "unit": "bpm",   "note": "tachycardia"},
                            {"parameter": "RR",           "value": "20",    "unit": "/min",  "note": ""},
                            {"parameter": "Temperature",  "value": "37.8",  "unit": "°C",    "note": "low-grade fever"},
                            {"parameter": "SpO2",         "value": "96",    "unit": "%",     "note": "room air"},
                            {"parameter": "Urine output", "value": "25",    "unit": "ml/hr", "note": "below target of 50 ml/hr — oliguria"},
                        ],
                        "medications": [
                            {"drug": "Normal Saline", "dose": "500ml bolus", "route": "IV", "frequency": "stat",     "duration": ""},
                            {"drug": "Normal Saline", "dose": "100ml",       "route": "IV", "frequency": "per hour", "duration": ""},
                        ],
                        "investigations": [],
                        "procedures": [],
                        "findings": [
                            "Patient pale and diaphoretic",
                            "IV site patent, no phlebitis",
                            "IV fluids commenced per doctor orders"
                        ],
                        "diagnoses": [],
                        "treatments": ["Repositioned every 2 hours", "IV NS 100 ml/hr commenced"],
                        "abnormalities": [
                            "BP 90/60 mmHg — hypotension (reference >100/60 mmHg)",
                            "HR 110 bpm — tachycardia",
                            "Urine output 25 ml/hr — oliguria (target 50 ml/hr)",
                            "Temperature 37.8°C — low-grade fever",
                        ],
                        "recommendations": [],
                    },
                    {
                        "document_label": "Medication Administration Record (MAR)",
                        "filename": "medication_chart_07jan.pdf",
                        "vitals": [],
                        "medications": [
                            {"drug": "Ceftriaxone",   "dose": "1g",    "route": "IV",   "frequency": "BD",       "duration": ""},
                            {"drug": "Pantoprazole",  "dose": "40mg",  "route": "oral", "frequency": "OD",       "duration": ""},
                            {"drug": "Tramadol",      "dose": "50mg",  "route": "IV",   "frequency": "SOS",      "duration": ""},
                            {"drug": "Normal Saline", "dose": "100ml", "route": "IV",   "frequency": "per hour", "duration": ""},
                            {"drug": "Metronidazole", "dose": "400mg", "route": "oral", "frequency": "TDS",      "duration": ""},
                        ],
                        "investigations": [], "procedures": [], "findings": [],
                        "diagnoses": [], "treatments": [], "abnormalities": [], "recommendations": [],
                    },
                ],
            },
            {
                "type": "clinical_day", "date": None,
                "date_label": "Date Unknown", "day_number": None,
                "story_narrative": "Undated investigations — Echo and CBC.",
                "documents": [
                    {
                        "document_label": "Echocardiogram Report",
                        "filename": "echo_report.pdf",
                        "vitals": [],
                        "medications": [],
                        "investigations": [
                            {"test": "EF",     "result": "71",  "unit": "%",    "reference_range": "55-75",   "status": "normal"},
                            {"test": "LVIDd",  "result": "4.8", "unit": "cm",   "reference_range": "<5.5",    "status": "normal"},
                            {"test": "RVSP",   "result": "28",  "unit": "mmHg", "reference_range": "<35",     "status": "normal"},
                            {"test": "MV E/A", "result": "0.7", "unit": "",     "reference_range": "0.8-1.5", "status": "abnormal"},
                        ],
                        "procedures": [],
                        "findings": [
                            "Trivial aortic regurgitation",
                            "Normal LV systolic function",
                            "Mild LV diastolic dysfunction grade 1",
                            "No pericardial effusion",
                            "No wall motion abnormality"
                        ],
                        "diagnoses": ["Mild LV diastolic dysfunction grade 1"],
                        "treatments": [],
                        "abnormalities": ["MV E/A ratio 0.7 — below normal range 0.8-1.5, consistent with diastolic dysfunction grade 1"],
                        "recommendations": [],
                    },
                    {
                        "document_label": "CBC / Haematology Report",
                        "filename": "lab_cbc.pdf",
                        "vitals": [],
                        "medications": [],
                        "investigations": [
                            {"test": "Haemoglobin", "result": "7.2",  "unit": "gm%",      "reference_range": "13-17",      "status": "critical"},
                            {"test": "WBC",         "result": "9210", "unit": "cells/cmm", "reference_range": "4000-11000", "status": "normal"},
                            {"test": "Platelets",   "result": "2.46", "unit": "lakhs/cmm", "reference_range": "1.5-4.0",   "status": "normal"},
                            {"test": "PCV",         "result": "21.6", "unit": "%",          "reference_range": "40-52",      "status": "critical"},
                            {"test": "MPV",         "result": "7.8",  "unit": "fl",         "reference_range": "9.4-12.3",  "status": "abnormal"},
                            {"test": "MCH",         "result": "24",   "unit": "pg",         "reference_range": "27-33",      "status": "abnormal"},
                        ],
                        "procedures": [],
                        "findings": [
                            "Microcytic hypochromic picture on blood film",
                            "Neutrophils 72%, Lymphocytes 22%, Monocytes 4%, Eosinophils 2%"
                        ],
                        "diagnoses": ["Haemoglobin 7.2 gm% — critically low (ref 13-17 gm%)"],
                        "treatments": [],
                        "abnormalities": [
                            "Haemoglobin 7.2 gm% — CRITICAL LOW (ref 13-17 gm%)",
                            "PCV 21.6% — CRITICAL LOW (ref 40-52%)",
                            "MPV 7.8 fl — low (ref 9.4-12.3 fl)",
                            "MCH 24 pg — low (ref 27-33 pg)",
                        ],
                        "recommendations": [],
                    },
                    {
                        "document_label": "Physiotherapy Note",
                        "filename": "physio_note.pdf",
                        "vitals": [],
                        "medications": [],
                        "investigations": [],
                        "procedures": [],
                        "findings": ["Post-operative rehabilitation assessment completed"],
                        "diagnoses": [],
                        "treatments": [
                            "Deep breathing exercises taught",
                            "Ankle pumps and calf compression every 2 hours — DVT prophylaxis",
                            "Ambulation with assistance from post-op day 2",
                            "Incentive spirometry commenced",
                        ],
                        "abnormalities": [],
                        "recommendations": ["DVT prophylaxis to continue until fully ambulant"],
                    },
                ],
            },
        ],
    }


# ═══════════════════════════════════════════════════════════════
# API ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@router.post("/discharge-validation", response_model=None)
async def validate_discharge_summary(request: ValidationRequest):
    """
    Evidence-Based Discharge Validation Pipeline v4.1.0

    11 agents covering all 9 processes from Discharge Co-Pilot workflow spec.

    NEW/PATCHED in v4.1.0:
      • VA1A — SKIP-IF-SELF-RESULTED rule: investigations already resulted in the
               same document are excluded from the order manifest.
      • VA1B — SAME-DOCUMENT MATCH RULE + SEMANTIC/PROCEDURE-EQUIVALENCE RULE:
               stops false "pending" flags for investigations whose result is in
               the same document, or fulfilled by a clinically equivalent later
               procedure/report (e.g. TURBT fulfils "suggested cystoscopy").
      • VA9  — MANDATORY CODING RULE + code-level safety-net check: every
               confirmed diagnosis must get an ICD-10 code or an explicit CDI
               query; silent omission is now flagged as a Major issue if the
               LLM still drops one.
      • VA8          — Safety & Allergy agent (P3 gap: allergy, drug toxicity, HAC, devices)
      • VA10         — Insurance Document agent (P7 gap: pre-auth, LoS, medical necessity)
      • VA11         — Post-Discharge Monitoring agent (P9 gap: Day-2/7/30, risk flags)
      • VA2 enhanced — BPMH gap detection added
      • VA5 enhanced — Social environment domain added
      • VA7 enhanced — P8 quality gate hard block logic integrated

    RESPONSE STRUCTURE:
      approved_for_clinical_use       → boolean banner
      audit_conclusion                → paragraph
      issue_counts                    → {Critical, Major, Moderate, Minor, Total}
      scores                          → per-domain floats (0.0-1.0)
      quality_gate_status             → P8 gate: blocks triggered, hard_block_active
      priority_action_list            → ranked actions with urgency
      discharge_readiness_verdict     → verdict card
      categorised_issues              → {Critical, Major, Moderate, Minor}
      active_critical_concerns        → critical concern banners
      disease_timeline_narrative      → chronological event feed
      findings_comparison_table       → parameter table
      agent_reports                   → per-agent detail (VA1A, VA1B, VA2–VA11)
    """
    start_ms = datetime.now().timestamp() * 1000
    logger.info(
        f"Discharge Validation v4 | patient={request.patient_id} | "
        f"doctor={request.doctor_id} | specialty={request.specialty}"
    )

    try:
        try:
            record = await load_discharge_record(request.patient_id, request.doctor_id)
        except HTTPException:
            logger.warning("No MongoDB record found — using demo data")
            record = _demo_record()

        if not record.get("day_wise_timeline"):
            raise HTTPException(
                status_code=422,
                detail="day_wise_timeline is empty in the discharge summary record.",
            )

        initial_state = build_validation_state(request, record)
        result        = await validation_workflow.ainvoke(initial_state)

        elapsed = round(datetime.now().timestamp() * 1000 - start_ms)
        audit   = result.get("final_audit") or {}

        # Merge VA1A + VA1B into combined investigation report for frontend
        inv_order_report  = result.get("investigation_order_report")  or {}
        inv_result_report = result.get("investigation_result_report") or {}
        combined_investigation_report = {
            "dual_agent_verification": True,
            "VA1A_ordered_investigations":  inv_order_report.get("ordered_investigations", []),
            "VA1B_resulted_investigations": inv_result_report.get("resulted_investigations", []),
            "VA1B_pending_investigations":  inv_result_report.get("pending_investigations", []),
            "VA1B_abnormal_values":         inv_result_report.get("abnormal_values_documented", []),
            "VA1B_investigation_trends":    inv_result_report.get("investigation_trends", []),
            "VA1B_findings_comparison":     inv_result_report.get("findings_comparison", []),
            "VA1B_active_concerns":         inv_result_report.get("active_concerns_evidence_based", []),
            "verification_summary":         inv_result_report.get("verification_summary", {}),
            "issues":                       inv_result_report.get("issues", []),
        }

        response = {
            # ── Meta ──────────────────────────────────────────
            "patient_id":         request.patient_id,
            "doctor_id":          request.doctor_id,
            "specialty":          request.specialty,
            "validated_at":       datetime.now().isoformat(),
            "processing_time_ms": elapsed,
            "version":            "4.1.0",

            "patient": {
                "name": result.get("patient_name"),
                "dob":  result.get("patient_dob"),
                "sex":  result.get("patient_sex"),
            },
            "admission_reason": result.get("admission_reason"),
            "admission_date":   result.get("admission_date"),

            # ── VA7: Dashboard summary ─────────────────────────
            "approved_for_clinical_use":   audit.get("approved_for_clinical_use", False),
            "audit_conclusion":            audit.get("audit_conclusion", ""),
            "issue_counts":                audit.get("issue_counts", {}),
            "scores":                      audit.get("scores", {}),
            "quality_gate_status":         audit.get("quality_gate_status", {}),

            # ── VA7: Issues panel ──────────────────────────────
            "categorised_issues":          audit.get("categorised_issues", {
                "Critical": [], "Major": [], "Moderate": [], "Minor": []
            }),
            "active_critical_concerns":    audit.get("active_critical_concerns_summary", []),

            # ── VA7: Clinical narrative ────────────────────────
            "disease_timeline_narrative":  audit.get("disease_timeline_narrative", []),
            "findings_comparison_table":   audit.get("findings_comparison_table", []),
            "discharge_readiness_verdict": audit.get("discharge_readiness_verdict", {}),
            "priority_action_list":        audit.get("priority_action_list", []),

            # ── Agent detail tabs ──────────────────────────────
            "agent_reports": {
                # VA1A + VA1B combined
                "VA1_investigation":        combined_investigation_report,

                # Clinical audit agents
                "VA2_medication":           result.get("medication_report"),
                "VA3_procedure":            result.get("procedure_report"),
                "VA4_consistency":          result.get("consistency_report"),
                "VA5_readiness":            result.get("readiness_report"),
                "VA6_followup":             result.get("followup_report"),

                # New agents v4.0.0+
                "VA8_safety_allergy":       result.get("safety_allergy_report"),
                "VA9_coding_billing":       result.get("coding_billing_report"),
                "VA10_insurance_documents": result.get("insurance_document_report"),
                "VA11_post_discharge":      result.get("post_discharge_report"),
            },

            # ── Diagnostics ────────────────────────────────────
            "agent_timings": result.get("agent_timings", {}),
            "errors":        result.get("errors", []),
        }

        # ── Persist to MongoDB ─────────────────────────────────
        try:
            await mongo_db["discharge_validations"].insert_one({
                **response,
                "saved_at": datetime.utcnow(),
            })
        except Exception as e:
            logger.error(f"MongoDB save failed: {e}")

        logger.info(
            f"Discharge Validation v4 complete | patient={request.patient_id} | "
            f"{elapsed}ms | overall={audit.get('scores',{}).get('overall','N/A')} | "
            f"approved={audit.get('approved_for_clinical_use','?')}"
        )
        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(
            f"Discharge Validation v4 pipeline failed | patient={request.patient_id} | {e}"
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/discharge-validation/demo")
async def run_validation_demo():
    """Run full validation pipeline with demo TURBT urology patient."""
    return await validate_discharge_summary(
        ValidationRequest(
            patient_id = "PAT-demo-001",
            doctor_id  = "DOC-demo-001",
            specialty  = "Urology",
        )
    )


@router.get("/discharge-validation/health")
async def validation_health():
    return {
        "status":  "ok",
        "version": "4.1.0",
        "master_rule": "AUDIT SYSTEM — no findings invented. All output requires explicit evidence.",
        "agents":  11,

        "pipeline": {
            "wave1_parallel": [
                "VA1A — InvestigationOrderExtractorAgent  (scans ALL timeline fields for orders, "
                "excludes self-resulted-in-same-document items)",
                "  ↓ sequential within sub-pipeline",
                "VA1B — InvestigationResultVerifierAgent  (cross-checks VA1A orders vs full timeline "
                "using same-document + semantic/procedure-equivalence matching)",
                "VA2  — MedicationReconciliationAgent     (parallel with VA1A→VA1B)",
                "VA3  — ProcedureSurgeryAgent             (parallel with VA1A→VA1B)",
                "VA8  — SafetyAllergyAgent                (parallel — NEW P3)",
            ],
            "wave2_sequential": [
                "VA4  — ClinicalConsistencyAgent",
                "VA5  — DischargeReadinessAgent     (+ social domain — P5 enhanced)",
                "VA6  — FollowUpAgent",
                "VA9  — CodingBillingAgent          (NEW P6, MANDATORY CODING RULE patched)",
                "VA10 — InsuranceDocumentAgent      (NEW P7)",
                "VA11 — PostDischargeMonitoringAgent(NEW P9)",
                "VA7  — FinalAuditAgent             (+ P8 quality gate hard blocks)",
            ],
        },

        "v4_1_0_patch_notes": {
            "VA1A_skip_if_self_resulted": "Investigations whose result/finding/diagnosis is reported "
                "in the SAME document as the order tag (e.g. a CT report listing 'CT Urogram, PET-CT' "
                "as investigations while its own findings describe what they showed) are no longer "
                "extracted as pending orders.",
            "VA1B_same_document_and_semantic_rules": "VA1B now applies (a) a same-document match rule "
                "and (b) a semantic/procedure-equivalence rule (e.g. a later TURBT fulfils a 'suggested "
                "cystoscopy'; a Histopathology/Biopsy Report fulfils an 'HPE correlation' recommendation) "
                "before declaring anything genuinely pending.",
            "VA9_mandatory_coding_rule": "Every diagnosis confirmed by VA4 (supported_by_timeline=true) "
                "must now receive either a real ICD-10 code or an explicit CDI query explaining why a "
                "more specific code cannot be assigned. A code-level safety-net check also flags any "
                "diagnosis the LLM still silently drops as a Major issue.",
        },

        "new_in_v4": {
            "dual_investigation_agents": {
                "VA1A": "Extracts forward-looking investigation orders from every timeline field "
                        "including recommendations, treatments, findings, procedure notes — excluding "
                        "anything already self-resulted in the same document.",
                "VA1B": "Cross-checks every VA1A order against the FULL timeline using same-document "
                        "and semantic/procedure-equivalence matching. Prevents false 'pending' flags "
                        "for histopathology, imaging, and procedures that are clinically fulfilled by "
                        "a different but equivalent action elsewhere in the record.",
            },
            "VA8_safety_allergy": "P3 gap: allergy events, drug toxicity markers, inappropriate "
                                  "device duration, hospital-acquired conditions (HAC).",
            "VA9_coding_billing": "P6 gap: MANDATORY ICD-10 code suggestions for every confirmed "
                                  "diagnosis, procedure codes, DRG band, CC/MCC capture, HAC exclusion, "
                                  "CDI physician queries for any non-specific code.",
            "VA10_insurance":     "P7 gap: pre-auth summary, LoS justification, medical necessity "
                                  "letter, payer-format discharge summary, claims package checklist.",
            "VA11_post_discharge":"P9 gap: personalised Day-2/7/30 question sets, escalation "
                                  "triggers, high-risk flags, readmission risk indicators.",
            "VA2_enhanced":       "BPMH gap detection — flags when pre-admission medication "
                                  "history is absent from the timeline.",
            "VA5_enhanced":       "Social environment domain — home assessment, carer support, "
                                  "equipment, social worker, community nursing.",
            "VA7_quality_gate":   "P8 hard block logic: approved_for_clinical_use = false if "
                                  "any Critical/Major issue OR quality gate block triggered "
                                  "(missing diagnosis, missing follow-up, allergy conflict, etc.).",
        },

        "confidence_threshold": "0.75 — findings below this are suppressed",
        "pending_investigation_rule": (
            "VA1A extracts forward-looking orders from every timeline field, excluding anything "
            "already self-resulted in the same document. "
            "VA1B cross-checks EVERY order against the full timeline DATA — applying a same-document "
            "match rule and a semantic/procedure-equivalence rule (e.g. TURBT fulfils 'suggested "
            "cystoscopy'; a histopathology report fulfils 'HPE correlation') — before marking pending. "
            "A test is pending ONLY if VA1A found a genuine forward order AND VA1B found no matching "
            "or clinically-equivalent result anywhere in the timeline data."
        ),
        "icd10_coding_rule": (
            "VA9 must assign an ICD-10 code attempt to every diagnosis VA4 confirmed as "
            "supported_by_timeline=true. If a fully specific code cannot be determined from the "
            "documentation, VA9 still assigns the best available code AND raises a cdi_query "
            "explaining what detail is missing — it must never silently return no code for a "
            "confirmed diagnosis."
        ),
    }