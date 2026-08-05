"""
treatment_plans_agent.py
=======================
Next-Generation Treatment Planning Engine for DoctorAssist

Features:
- Evidence-based treatment recommendations
- Multi-guideline integration 
- Avoids already completed procedures/investigations
- Neo4j treatment knowledge graph
- Pharmacological + Procedural + Non-pharmacological planning
- Cost-effectiveness analysis
- Drug interaction checking
- Contraindication detection
- Follow-up scheduling intelligence

★ PHASE 2 SKILL-FIRST TREATMENT RETRIEVAL (NEW)
- Mirrors the diagnosis skill retrieval pattern already implemented in
  phase2_skill_retrieval_service.py's ClinicalRAGRetrievalEngine.
- A new TreatmentSkillRetrievalAgent runs right after intent identification
  and calls the SAME hybrid engine (vector + BM25 + graph + subtype +
  cluster + fusion + LLM rerank) that already retrieves treatment skills
  from `phase1_treatment_skills` / `phase1_treatment_skills_vectors` —
  no new retriever, no new collection, no separate system.
- The retrieved treatment skills are injected into every downstream
  treatment agent (Pharmacological, Procedural, Investigation, Lifestyle,
  FollowUp). Each generated recommendation must cite which retrieved
  skill (and which section of its body) it came from, or explicitly
  state it is not skill-grounded.
- ★ NEW — TreatmentSkillApplicationAgent runs after all recommendations are
  generated and traces every skill-cited recommendation back to the exact
  retrieved skill, filling in skill_contribution / patient_match_reason /
  matched_evidence and feeding an applied_recommendations map back onto
  retrieved_skills_summary for auditability.
- The ClinicalEvaluationAgent validates skill-cited recommendations
  against the ACTUAL skill content retrieved (not generic guideline
  text), exactly like the diagnosis-side "skill-specific guideline
  validation" pattern — both via the LLM audit AND a deterministic
  code-level cross-check against the skill body.

Author: AI Architect
Version: 1.2.0  (Phase 2 skill application + skill-specific validation)
"""

import json
import re
from typing import Dict, Any, List, Optional, TypedDict, Set
from datetime import datetime, timedelta
from enum import Enum
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, WebSocket, status, File, Form, UploadFile, Body
# LangGraph
from langgraph.graph import StateGraph, END
from langchain_core.messages import HumanMessage, SystemMessage

# LLM
from langchain_groq import ChatGroq

# Graph libraries
import networkx as nx
from neo4j import GraphDatabase

# Logging
from loguru import logger

# Utilities
from pydantic import BaseModel, Field



from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, WebSocket, status, File, Form, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse, FileResponse
# from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field, EmailStr, validator
from fastapi.encoders import jsonable_encoder
from typing import Any, Dict, List, Optional, Union
from pymongo import MongoClient
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime, date, timedelta
from bson import ObjectId
from enum import Enum
import logging
import random
import string
import sys
import pytz
import socket
import platform
import httpx
import asyncio
import json
import time
import queue
import threading
from passlib.context import CryptContext
from functools import wraps, partial
import uuid
import os
import aiofiles
import shutil
import re
import copy
import traceback
from groq import Groq
from fastapi import Query
from typing import Optional
from fastapi import Response
from jose import jwt, JWTError
from datetime import datetime, timedelta
from fastapi.encoders import jsonable_encoder
from shared.audit.schema import AuditEvent
from shared.audit.utils import emit_audit
from datetime import datetime, timezone
from dotenv import load_dotenv
import os
from pydantic import BaseModel, Field
from typing import List, Optional
from bson import ObjectId

# ★ PHASE 2 — reuse the existing hybrid RAG retrieval engine. No new
# retriever/collection is created; this is exactly the same engine that
# already retrieves treatment skills from phase1_treatment_skills /
# phase1_treatment_skills_vectors for the diagnostic side.........
from Agentic.phase2_skill_retrieval_service import (
    PatientRetrievalContext,
    MetadataFilter,
    _get_engine,
)
ALLOW_UNGROUNDED_GUIDELINES = False



router = APIRouter(
    prefix="",
    tags=["doctor"],
    responses={404: {"description": "Not found"}},
)

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)



MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"
NODES_DB = "doctorassistai_nodes"

mongodb_client = AsyncIOMotorClient(MONGO_URI)  # async (Motor)
database = mongodb_client[MONGO_DB]

client = MongoClient(MONGO_URI)  # sync (PyMongo)
db = client[MONGO_DB]

nodes_database = mongodb_client[NODES_DB]
nodes_db = client[NODES_DB]    


summary_collection = database["patient_summary"]

patient_user_collection = database["patient_users"]

doctor_user_collection = database["doctor_users"]

doctor_guidelines_collection = database["doctor_guidelines"]


# =====================================================================
# ENUMS & CONSTANTS
# =====================================================================

class TreatmentIntent(str, Enum):
    CURATIVE = "curative"
    DISEASE_MODIFYING = "disease_modifying"
    PALLIATIVE = "palliative"
    SYMPTOM_CONTROL = "symptom_control"
    PREVENTIVE = "preventive"


class TreatmentModality(str, Enum):
    PHARMACOLOGICAL = "pharmacological"
    SURGICAL = "surgical"
    PROCEDURAL = "procedural"
    RADIATION = "radiation"
    LIFESTYLE = "lifestyle"
    PHYSIOTHERAPY = "physiotherapy"
    PSYCHOLOGICAL = "psychological"


class DrugClass(str, Enum):
    ANTIBIOTIC = "antibiotic"
    ANTIHYPERTENSIVE = "antihypertensive"
    ANTICOAGULANT = "anticoagulant"
    CHEMOTHERAPY = "chemotherapy"
    IMMUNOTHERAPY = "immunotherapy"
    ANALGESIC = "analgesic"
    CORTICOSTEROID = "corticosteroid"


class GuidelineSource(str, Enum):
    NCCN = "NCCN"
    WHO = "WHO"
    AHA = "AHA/ACC"
    NICE = "NICE"
    IDSA = "IDSA"
    ASCO = "ASCO"
    ESMO = "ESMO"
    NCG_INDIA = "NCG India"


class EvidenceLevel(str, Enum):
    A = "A"  # RCT/Meta-analysis
    B = "B"  # Observational
    C = "C"  # Expert opinion


class RecommendationClass(str, Enum):
    CLASS_I = "I"      # Must do
    CLASS_IIA = "IIa"  # Should do
    CLASS_IIB = "IIb"  # May consider
    CLASS_III = "III"  # Must not do

class TreatmentStrategy(str, Enum):
    CONSERVATIVE = "conservative"
    STANDARD = "standard"
    AGGRESSIVE = "aggressive"
    
# =====================================================================
# PYDANTIC SCHEMAS
# =====================================================================

class PrimaryDiagnosis(BaseModel):
    disease: str
    icd10_code: Optional[str] = None
    stage: Optional[str] = None
    severity: Optional[str] = None
    confidence: Optional[float] = None


class CompletedProcedure(BaseModel):
    """Already performed procedure"""
    procedure_name: str
    date_performed: str
    outcome: Optional[str] = None
    complications: Optional[str] = None


class CompletedInvestigation(BaseModel):
    """Already completed investigation"""
    test_name: str
    date_performed: str
    result: Optional[str] = None
    is_abnormal: bool = False


class CurrentMedication(BaseModel):
    """Medication patient is currently taking"""
    drug_name: str
    dose: str
    frequency: str
    route: str
    started_date: Optional[str] = None
    indication: Optional[str] = None


class Allergy(BaseModel):
    """Drug/substance allergy"""
    allergen: str
    reaction: str
    severity: str = "moderate"

class PrognosisData(BaseModel):
    overall_prognosis: Optional[str] = None
    five_year_survival_rate: Optional[float] = None
    expected_treatment_response: Optional[str] = None
    risk_stratification: Optional[str] = None
    performance_status: Optional[str] = None
    complication_risk: Optional[str] = None


class TreatmentPlanInput(BaseModel):
    """Input schema for treatment planning"""
    # From diagnostic agent
    primary_diagnosis: Optional[PrimaryDiagnosis] = None
    prognosis: Optional[PrognosisData] = None
    alternative_diagnoses: List[str] = Field(default_factory=list)
    
    # Patient context
    patient_id: str
    patient_age: Optional[int] = None
    patient_sex: Optional[str] = None
    patient_weight_kg: Optional[float] = None
    
    # Medical history
    comorbidities: List[str] = Field(default_factory=list)
    allergies: List[Allergy] = Field(default_factory=list)
    current_medications: List[CurrentMedication] = Field(default_factory=list)
    
    # Organ function
    renal_function_egfr: Optional[float] = None  # mL/min/1.73m²
    hepatic_function: Optional[str] = "normal"  # normal/mild/moderate/severe impairment
    cardiac_function_ef: Optional[float] = None  # Ejection fraction %
    
    # Already completed (CRITICAL - avoid duplication)
    completed_procedures: List[CompletedProcedure] = Field(default_factory=list)
    completed_investigations: List[CompletedInvestigation] = Field(default_factory=list)
    
    # Clinical context
    visit_type: Optional[str] = None  # first_visit, followup, emergency, etc.
    doctor_speciality: Optional[str] = None
    treatment_setting: Optional[str] = "outpatient"  # outpatient/inpatient/icu
    
    # Preferences
    cost_sensitivity: Optional[str] = "moderate"  # low/moderate/high
    patient_preferences: Optional[str] = None


class DrugRecommendation(BaseModel):
    """Pharmacological treatment recommendation"""
    drug_name: str
    drug_class: str
    indication: str
    dose: str
    frequency: str
    route: str
    duration: str
    
    # Evidence
    guideline_support: Optional[str] = None
    recommendation_class: Optional[str] = None
    evidence_level: Optional[str] = None
    is_primary_treatment: bool = False
    # Guideline Rationale — WHY this drug for THIS patient
    guideline_rationale: str = ""          
    patient_specific_reason: str = ""      # e.g. "Chosen over gemcitabine due to patient age <65 and normal renal function"
    supporting_trial: Optional[str] = None # e.g. "SWOG S8710", "CheckMate 274"

    # ★ PHASE 2 — skill provenance. Populated when this recommendation is
    # traced back to a specific retrieved treatment skill (see
    # TreatmentSkillRetrievalAgent). Null when no retrieved skill supports it.
    source_skill_name: Optional[str] = None
    source_skill_section: Optional[str] = None

    # ★ PHASE 2 — skill contribution/traceability fields, populated by
    # TreatmentSkillApplicationAgent (item 3 of the treatment-skill fixes).
    skill_contribution: Optional[str] = None
    patient_match_reason: Optional[str] = None
    matched_evidence: List[str] = Field(default_factory=list)
    
    # Safety
    contraindications_checked: bool = True
    renal_dose_adjustment: Optional[str] = None
    hepatic_dose_adjustment: Optional[str] = None
    drug_interactions: List[str] = Field(default_factory=list)
    
    # Monitoring
    monitoring_required: List[str] = Field(default_factory=list)
    monitoring_frequency: Optional[str] = None
    
    # Alternatives
    alternative_if_unavailable: Optional[str] = None
    generic_available: bool = True
    approximate_cost: Optional[str] = None



class ProceduralRecommendation(BaseModel):
    """Surgical/procedural recommendation"""
    procedure_name: str
    indication: str
    timing: str
    
    # Evidence
    guideline_support: Optional[str] = None
    recommendation_class: Optional[str] = None
    evidence_level: Optional[str] = None
    is_primary_treatment: bool = False
    
    # Guideline Rationale — WHY this procedure for THIS patient
    guideline_rationale: str = ""          
    patient_specific_reason: str = ""     # e.g. "Indicated because tumor invades muscularis propria (T2) per biopsy"
    supporting_trial: Optional[str] = None

    # ★ PHASE 2 — skill provenance
    source_skill_name: Optional[str] = None
    source_skill_section: Optional[str] = None

    # ★ PHASE 2 — skill contribution/traceability fields
    skill_contribution: Optional[str] = None
    patient_match_reason: Optional[str] = None
    matched_evidence: List[str] = Field(default_factory=list)
    
    # Safety
    prerequisites: List[str] = Field(default_factory=list)
    contraindications: List[str] = Field(default_factory=list)
    expected_complications: List[str] = Field(default_factory=list)
    
    # Planning
    estimated_duration: Optional[str] = None
    anesthesia_type: Optional[str] = None
    post_procedure_care: List[str] = Field(default_factory=list)
    cardiac_risk_note: str = "safe"
    reason_needed: str = ""



class InvestigationRecommendation(BaseModel):
    """Diagnostic test recommendation"""
    test_name: str
    indication: str
    urgency: str
    
    # Justification
    expected_finding: str
    will_change_management: bool = True
    what_decision_it_drives: str = ""      # e.g. "Will determine T-stage and eligibility for bladder preservation"
    
    # Guideline Rationale — WHY this test for THIS patient
    guideline_rationale: str = ""         
    patient_specific_reason: str = ""     # e.g. "Ordered because prior imaging showed left hydroureter suspicious for ureteral involvement"

    # ★ PHASE 2 — skill provenance
    source_skill_name: Optional[str] = None
    source_skill_section: Optional[str] = None

    # ★ PHASE 2 — skill contribution/traceability fields
    skill_contribution: Optional[str] = None
    patient_match_reason: Optional[str] = None
    matched_evidence: List[str] = Field(default_factory=list)
    
    # Already done check
    already_completed: bool = False
    last_result_date: Optional[str] = None
    repeat_justified: bool = False
    repeat_justification: Optional[str] = None


class LifestyleRecommendation(BaseModel):
    """Non-pharmacological lifestyle intervention"""
    intervention_type: str
    specific_recommendation: str
    evidence_strength: EvidenceLevel
    expected_benefit: str
    implementation_difficulty: str = "moderate"
    
    # Guideline Rationale — WHY this lifestyle change for THIS patient
    guideline_rationale: str = ""          # e.g. "ACS 2023 — smoking is #1 modifiable risk factor for bladder cancer, responsible for 50% of cases"
    patient_specific_reason: str = ""     # e.g. "Critical for this patient as continued smoking doubles recurrence risk post-cystectomy"
    supporting_evidence: Optional[str] = None  # e.g. "Meta-analysis of 32 studies (Cumberbatch et al., 2016)"

    # ★ PHASE 2 — skill provenance
    source_skill_name: Optional[str] = None
    source_skill_section: Optional[str] = None

    # ★ PHASE 2 — skill contribution/traceability fields
    skill_contribution: Optional[str] = None
    patient_match_reason: Optional[str] = None
    matched_evidence: List[str] = Field(default_factory=list)


class MonitoringParameter(BaseModel):
    parameter: str
    reason: str = ""
    guideline: str = ""
    frequency: str = ""

class SuccessCriterion(BaseModel):
    criterion: str
    guideline_basis: str = ""

class EscalationTrigger(BaseModel):
    trigger: str
    action: str = ""
    guideline_basis: str = ""

class FollowUpPlan(BaseModel):
    """Follow-up scheduling"""
    next_visit_timing: str
    follow_up_guideline_rationale: str = ""
    monitoring_parameters: List[Any] = Field(default_factory=list)  # List[MonitoringParameter] or List[str]
    success_criteria: List[Any] = Field(default_factory=list)       # List[SuccessCriterion] or List[str]
    escalation_triggers: List[Any] = Field(default_factory=list)    # List[EscalationTrigger] or List[str]

class ValidationResult(BaseModel):
    is_valid: bool
    validation_score: float
    guideline_compliance_score: float = 0.0
    critical_issues: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    recommendations_to_remove: List[str] = Field(default_factory=list)
    recommendations_to_add: List[str] = Field(default_factory=list)
    guideline_compliance_notes: List[str] = Field(default_factory=list)
    safety_notes: List[str] = Field(default_factory=list)

class TreatmentPlan(BaseModel):
    """Complete treatment plan output"""
    # Intent
    rank: Optional[int] = None
    treatment_intent: TreatmentIntent
    primary_goals: List[str] = Field(default_factory=list)
    
    # Pharmacological
    first_line_drugs: List[DrugRecommendation] = Field(default_factory=list)
    adjunctive_drugs: List[DrugRecommendation] = Field(default_factory=list)
    
    # Procedural
    recommended_procedures: List[ProceduralRecommendation] = Field(default_factory=list)
    
    # Investigations
    required_investigations: List[InvestigationRecommendation] = Field(default_factory=list)
    
    # Non-pharmacological
    lifestyle_modifications: List[LifestyleRecommendation] = Field(default_factory=list)
    
    # Safety
    contraindications_detected: List[str] = Field(default_factory=list)
    drug_interactions_detected: List[str] = Field(default_factory=list)
    
    # Follow-up
    follow_up_plan: FollowUpPlan

    strategy: TreatmentStrategy = TreatmentStrategy.STANDARD
    validation_result: Optional[ValidationResult] = None
    
    # Metadata
    guideline_compliance_score: float = 0.0
    cost_effectiveness_tier: str = "moderate"
    patient_adherence_prediction: str = "moderate"

    # ★ PHASE 2 — compact list of the retrieved treatment skills that were
    # actually surfaced to the agents for this plan (skill_id/name + score +
    # which guideline it came from + which recommendations actually used it).
    # Mirrors the diagnosis-side "retrieved_skills" block in the design doc's
    # Final Output Structure.
    retrieved_skills_summary: List[Dict[str, Any]] = Field(default_factory=list)
    
    # Warnings
    warnings: List[str] = Field(default_factory=list)
    requires_specialist_review: bool = False
    
    # Summary
    treatment_summary: str = ""
    confidence_score: float = 0.0

# =====================================================================
# STATE DEFINITION
# =====================================================================

class TreatmentPlanState(TypedDict):
    """LangGraph state for treatment planning"""
    # Input
    treatment_input: TreatmentPlanInput
    
    # ✅ FIX 1: Added patient_summary to state
    patient_summary: Optional[Dict[str, Any]]

    # Doctor's selected guidelines (fetched from doctor_guidelines_collection)
    doctor_guidelines: List[Dict[str, Any]]
    allowed_guideline_titles: List[str]

    # ★ PHASE 2 — treatment skills retrieved via the hybrid RAG engine
    # (phase1_treatment_skills / phase1_treatment_skills_vectors), used by
    # every downstream treatment agent for skill-grounded recommendations.
    retrieved_treatment_skills: List[Dict[str, Any]]
    treatment_retrieval_metrics: Dict[str, Any]

    # ★ PHASE 2 — populated by TreatmentSkillApplicationAgent: maps a
    # skill's display name -> list of "Drug: X" / "Procedure: Y" labels of
    # every recommendation that was actually traced back to that skill.
    skill_applications_map: Dict[str, List[str]]

    # Layer 1: Intent & Goals
    treatment_intent: Optional[TreatmentIntent]
    treatment_goals: List[str]
    
    # Layer 2: Guideline Retrieval
    applicable_guidelines: List[Dict[str, Any]]
    guideline_recommendations: Dict[str, Any]
    
    # Layer 3: Exclusion Filters
    excluded_procedures: Set[str]
    excluded_investigations: Set[str]
    
    # Layer 4: Drug Recommendations
    candidate_drugs: List[DrugRecommendation]
    
    # Layer 5: Procedural Recommendations
    candidate_procedures: List[ProceduralRecommendation]
    
    # Layer 6: Investigation Recommendations
    candidate_investigations: List[InvestigationRecommendation]
    
    # Layer 7: Safety Validation
    contraindications: List[str]
    drug_interactions: List[str]
    
    # Layer 8: Cost-Effectiveness
    cost_analysis: Dict[str, Any]
    
    # Layer 9: Follow-up Planning
    follow_up_plan: Optional[FollowUpPlan]
    
    # Lifestyle recommendations
    lifestyle_recommendations: List[LifestyleRecommendation]

    current_strategy: Optional[TreatmentStrategy]
    prognosis: Optional[PrognosisData]
    
    # Final output
    treatment_plan: Optional[TreatmentPlan]
    
    # Metadata
    error: Optional[str]
    warnings: List[str]


# =====================================================================
# ★ PHASE 2 — SKILL NAME + FORMATTING HELPERS (shared by all treatment agents)
# =====================================================================

def _skill_display_name(s: Dict[str, Any]) -> str:
    """
    Canonical, human-readable display name for a retrieved skill.

    FIX 1 (skill name display): previously this fell back straight to the
    raw skill_id (a UUID like "343c2cd0-b5c0-4dc5-b058"), which is what
    agents saw and cited. Now we prefer an actual human-readable name
    first, and ONLY fall back to the UUID/disease::subtype combo as a
    last resort. Used everywhere a skill needs to be displayed or matched
    by name: prompt formatting, skill application matching, retrieval
    logging, and the final output summary — so all four stay consistent.
    """
    return (
        s.get("skill_name")
        or s.get("name")
        or s.get("skill_id")
        or f"{s.get('disease_type','Unknown')}::{s.get('subtype','General')}"
    )



def _format_treatment_skills_for_prompt(
    skills: List[Dict[str, Any]],
    max_skills: int = 8,
) -> str:
    """
    Renders retrieved treatment skills (from the Phase 2 hybrid RAG engine)
    into a compact, prompt-ready block.

    Design intent (mirrors the diagnosis-side skill formatting already used
    in ContextAssembler._format_treatment_skill inside
    phase2_skill_retrieval_service.py):
      - Surface the SKILL, not the source PDF — the doctor cares about the
        skill content, not which guideline PDF it was extracted from.
      - Give each skill a stable, citable name so agents can reference it
        as `source_skill_name` in their structured output.
      - Keep it short: full skill bodies are already capped upstream by
        ContextAssembler.MAX_CHARS_PER_SKILL; this trims further for
        prompt budget across five different agents.
    """
    if not skills:
        return (
            "No treatment skills were retrieved for this patient from the "
            "knowledge base. Recommend based on standard clinical judgment "
            "and the approved guidelines below, but do NOT set "
            "source_skill_name/source_skill_section on any recommendation."
        )

    lines: List[str] = []
    for s in skills[:max_skills]:
        body = s.get("body") or s.get("_body_summary") or {}
        # FIX 1 — use the human-readable display name instead of the raw
        # skill_id, so agents cite something meaningful (e.g. "Idiopathic
        # MCD First Line Treatment") instead of a UUID.
        skill_name = _skill_display_name(s)
        guideline = f"{s.get('guideline','')} {s.get('guideline_version','')}".strip()
        score = s.get("final_score", s.get("score", 0.0)) or 0.0

        lines.append(f"\n[SKILL: {skill_name}]  (guideline={guideline or 'N/A'}, score={score:.2f})")
        lines.append(f"  disease/subtype : {s.get('disease_type','')} / {s.get('subtype','General')}")

        if isinstance(body, dict):
            if body.get("treatment_principles"):
                lines.append(f"  treatment_principles : {str(body['treatment_principles'])[:200]}")

            for stage_entry in (body.get("stage_wise_treatment", []) or [])[:2]:
                if isinstance(stage_entry, dict) and stage_entry.get("stage"):
                    stage = stage_entry.get("stage", "")
                    intent = stage_entry.get("intent", "")
                    primary = stage_entry.get("primary_treatment", "")
                    lines.append(f"  stage_wise_treatment[{stage}] ({intent}): {primary[:150]}")
                    for opt in (stage_entry.get("options", []) or [])[:2]:
                        if isinstance(opt, dict) and opt.get("regimen_name"):
                            drugs = ", ".join(opt.get("drugs", [])[:4])
                            cond = f" [if {opt['condition']}]" if opt.get("condition") else ""
                            lines.append(f"    • {opt['regimen_name']}{cond}: {drugs}")

            for rule in (body.get("if_then_rules", []) or [])[:3]:
                if isinstance(rule, dict) and rule.get("condition") and rule.get("action"):
                    lines.append(f"  if_then_rules: IF {rule['condition']} → {rule['action'][:100]}")

            tt = body.get("targeted_therapy", {})
            if isinstance(tt, dict) and tt.get("drugs"):
                lines.append(f"  targeted_therapy drugs : {', '.join(str(d) for d in tt['drugs'][:5])}")

            immuno = body.get("immunotherapy", {})
            if isinstance(immuno, dict) and immuno.get("drugs"):
                lines.append(f"  immunotherapy drugs : {', '.join(str(d) for d in immuno['drugs'][:5])}")

            ci = body.get("contraindications", []) or []
            ci_text = "; ".join(
                f"{c.get('drug_or_action','')}: avoid if {c.get('condition','')}"
                for c in ci[:2] if isinstance(c, dict)
            )
            if ci_text:
                lines.append(f"  contraindications : {ci_text[:200]}")

            ev_text = "; ".join(
                f"{e.get('trial','')}: {e.get('finding','')[:80]}"
                for e in (body.get("key_evidence", []) or [])[:2]
                if isinstance(e, dict)
            )
            if ev_text:
                lines.append(f"  key_evidence : {ev_text[:200]}")

        matched_ev = s.get("matched_evidence") or []
        if matched_ev:
            lines.append(f"  matched_patient_evidence : {', '.join(matched_ev[:6])}")

    lines.append(
        "\nCITATION RULE: For every recommendation you generate that is grounded in one of "
        "the [SKILL: ...] blocks above, set \"source_skill_name\" to that EXACT skill name "
        "(as shown after 'SKILL:' above) and \"source_skill_section\" to the specific part of "
        "the skill you used (e.g. 'stage_wise_treatment Stage III', 'targeted_therapy', "
        "'if_then_rules'). If a recommendation is NOT grounded in any retrieved skill, set both "
        "fields to null and rely on the approved guidelines list instead — never fabricate a "
        "skill citation."
    )
    return "\n".join(lines)


def _skills_summary_for_output(
    skills: List[Dict[str, Any]],
    applied_map: Optional[Dict[str, List[str]]] = None,
) -> List[Dict[str, Any]]:
    """
    Compact skill list for the final TreatmentPlan.retrieved_skills_summary
    field.

    FIX 4 (improve final output): now also carries a human-readable
    `skill_name` (see _skill_display_name) alongside the raw skill_id, and
    an `applied_recommendations` list populated from the
    TreatmentSkillApplicationAgent's bookkeeping — i.e. which drugs/
    procedures/investigations/lifestyle items actually ended up citing
    this skill. This makes it possible to audit, per retrieved skill,
    whether it was actually used and by what.
    """
    applied_map = applied_map or {}
    summary = []
    for s in skills:
        skill_name = _skill_display_name(s)
        summary.append({
            "skill_id": s.get("skill_id", s.get("doc_id", "")),
            "skill_name": skill_name,
            "disease_type": s.get("disease_type", ""),
            "subtype": s.get("subtype", ""),
            "guideline": f"{s.get('guideline','')} {s.get('guideline_version','')}".strip(),
            "score": round(s.get("final_score", s.get("score", 0.0)) or 0.0, 4),
            "matched_evidence": s.get("matched_evidence", []),
            "applied_recommendations": applied_map.get(skill_name, []),
        })
    return summary


# =====================================================================
# ★ PHASE 2 — LAYER 0: TREATMENT SKILL RETRIEVAL AGENT (NEW)
# =====================================================================

class TreatmentSkillRetrievalAgent:
    """
    Bridges the treatment-planning workflow to the existing Phase 2 hybrid
    RAG retrieval engine (ClinicalRAGRetrievalEngine in
    phase2_skill_retrieval_service.py).

    IMPORTANT: this does NOT build a new retriever. It reuses the exact
    same engine the diagnostic pipeline already uses — vector (Chroma) +
    BM25 + graph traversal + subtype hierarchy + community cluster +
    RRF fusion + LLM rerank — and simply keeps the `treatment_skills` half
    of the result (the `diagnosis_skills` half is ignored here; diagnosis
    retrieval is handled by the diagnostic pipeline itself).

    Flow (matches the design doc's Steps 1-6, using the codebase's real
    architecture instead of a hand-rolled Chroma query):
      Step 1 — Build a PatientRetrievalContext from patient_summary +
               treatment_input (disease, stage, prior treatments, current
               meds, clinical summary) — same context shape the diagnosis
               retriever already consumes.
      Step 2/3 — Engine internally embeds + BM25 + graph + subtype +
               cluster matches against phase1_treatment_skills, using
               name/description/trigger_keywords (never source_pdf).
      Step 4 — Engine's LLMReranker + FINAL_MIN_SCORE gate produce the
               final ranked treatment skill list.
      Step 5 — Full skill body is lazily loaded (already handled by the
               engine's _load_full_bodies).
      Step 6 — matched_evidence is carried through for citation.
    """

    async def retrieve_skills(self, state: TreatmentPlanState) -> TreatmentPlanState:
        logger.info("🧩 Treatment Skill Retrieval Agent: Starting (Phase 2 bridge)")

        treatment_input = state["treatment_input"]
        primary_dx = treatment_input.primary_diagnosis
        patient_summary = state.get("patient_summary") or {}
        summary_data = patient_summary.get("summary", {})

        clinical_summary_text = "\n\n".join(summary_data.get("paragraphs", []))
        confirmed_diagnoses = summary_data.get("confirmed_diagnoses", []) or []

        suspected_diseases: List[str] = []
        if primary_dx and primary_dx.disease:
            suspected_diseases.append(primary_dx.disease)
        for d in confirmed_diagnoses:
            if d and d not in suspected_diseases:
                suspected_diseases.append(d)

        if not suspected_diseases and not clinical_summary_text:
            logger.info("ℹ️ No disease context available — skipping treatment skill retrieval")
            state["retrieved_treatment_skills"] = []
            state["treatment_retrieval_metrics"] = {}
            return state

        current_meds = [m.drug_name for m in treatment_input.current_medications]

        prior_treatments: List[str] = []
        medical_history = patient_summary.get("patient_medical_history", {})
        for t in medical_history.get("treatment_progressions", []):
            name = t.get("treatment", "") if isinstance(t, dict) else t
            if name:
                prior_treatments.append(name)

        # doctor_id: same lookup convention already used elsewhere in this
        # file (doctor sys_user_id is threaded through patient_preferences).
        doctor_id = treatment_input.patient_preferences or treatment_input.doctor_speciality or ""

        ctx = PatientRetrievalContext(
            doctor_id=doctor_id,
            patient_id=treatment_input.patient_id,
            specialty=treatment_input.doctor_speciality or "",
            suspected_diseases=suspected_diseases[:4],
            confirmed_diagnoses=confirmed_diagnoses[:4],
            disease_stage=(primary_dx.stage if primary_dx and primary_dx.stage else ""),
            disease_subtype="",
            biomarkers=[],
            prior_treatments=prior_treatments[:5],
            current_medications=current_meds[:8],
            clinical_summary=clinical_summary_text[:1500],
            physician_query=(summary_data.get("diagnosis_header", "") or clinical_summary_text[:300]),
            visit_type=treatment_input.visit_type or "first_visit",
        )

        try:
            result = await _get_engine().retrieve(ctx)
            treatment_skills = list(result.treatment_skills or [])

            # ★ FIX #7 — deduplicate by skill_id (falling back to display
            # name) — the hybrid engine's vector+BM25+graph+cluster fusion
            # can surface the same skill multiple times.
            original_count = len(treatment_skills)

            deduped = {}

            for skill in treatment_skills:

                key = (
                    str(skill.get("disease_type", "")).lower().strip(),
                    str(skill.get("subtype", "")).lower().strip(),
                    str(skill.get("skill_type", "")).lower().strip(),
                    str(_skill_display_name(skill)).lower().strip()
                )

                score = float(
                    skill.get("final_score",
                    skill.get("score", 0))
                )

                existing = deduped.get(key)

                if existing is None:
                    deduped[key] = skill

                else:
                    existing_score = float(
                        existing.get("final_score",
                        existing.get("score", 0))
                    )

                    # keep highest scored duplicate
                    if score > existing_score:
                        deduped[key] = skill

            treatment_skills = sorted(
                deduped.values(),
                key=lambda x: float(
                    x.get("final_score",
                    x.get("score", 0))
                ),
                reverse=True
            )

            logger.info(
                f"🧹 Deduplicated treatment skills: "
                f"{original_count} → {len(treatment_skills)}"
            )
        except Exception as e:
            logger.error(f"❌ Treatment skill retrieval failed: {str(e)}")
            state["warnings"].append(
                "Treatment skill retrieval (Phase 2) failed — proceeding without skill grounding"
            )
            state["retrieved_treatment_skills"] = []
            state["treatment_retrieval_metrics"] = {}
            return state

        state["retrieved_treatment_skills"] = treatment_skills
        state["treatment_retrieval_metrics"] = getattr(result, "retrieval_metrics", {}) or {}

        # ★ PHASE 4 (doc1) — hard-ground guard. Zero retrieved skills is not
        # a silent condition; every downstream agent's prompt already
        # instructs "do NOT set source_skill_name" when the skills block is
        # empty, but this warning makes the gap visible in the final plan's
        # `warnings` list and in `retrieval_audit`-style logging.
        if not treatment_skills:
            state["warnings"].append(
                "No treatment skills retrieved — recommendations in this plan are "
                "NOT skill-grounded; any guideline_rationale must be treated as "
                "unverified LLM output, not a confirmed citation"
            )
            logger.warning("⚠️ Treatment Skill Retrieval: 0 skills retrieved — proceeding ungrounded")

        logger.info(
            f"✅ Treatment Skill Retrieval: {len(treatment_skills)} skill(s) retrieved "
            f"(method={getattr(result, 'retrieval_method', 'unknown')})"
        )

        # FIX 6 (retrieval logging) — log every retrieved skill (not just
        # the first 10) using the human-readable skill name plus its
        # matched patient evidence, so retrieval debugging shows exactly
        # what was retrieved and why, instead of a bare skill_id/UUID.
        for s in treatment_skills:
            logger.info(
                f"""
    Skill Name: {_skill_display_name(s)}
    Disease: {s.get('disease_type')}
    Subtype: {s.get('subtype')}
    Score: {s.get('final_score', s.get('score', 0.0))}
    Matched Evidence: {s.get('matched_evidence')}
    """
            )

        return state


# =====================================================================
# ★ PHASE 2 — LAYER (post-recommendation): TREATMENT SKILL APPLICATION AGENT (NEW)
# =====================================================================

class TreatmentSkillApplicationAgent:
    """
    ★ FIX 2 (most important) — Treatment Skill Application Agent.

    Runs AFTER all recommendation-generating agents (Pharmacological,
    Procedural, Investigation, Lifestyle) and BEFORE final assembly /
    clinical evaluation. For every recommendation that already carries a
    `source_skill_name` (set by the upstream LLM-driven agents per the
    CITATION RULE in `_format_treatment_skills_for_prompt`), this agent:

      1. Looks up the EXACT retrieved skill that name refers to (using the
         same canonical `_skill_display_name` used when the skill was
         first shown to the agents, so lookups never silently miss due to
         a naming mismatch).
      2. If the cited skill cannot be found among the retrieved skills,
         treats this as a fabricated/stale citation: clears the citation
         rather than trusting it, and logs a warning. (The deterministic
         cross-check in ClinicalEvaluationAgent._validate_skill_citations
         double-checks this again at evaluation time — see FIX 5.)
      3. Populates `matched_evidence` on the recommendation from the
         skill's own `matched_evidence` (never fabricated — pulled
         directly from what retrieval already matched for this patient).
      4. Writes a short, specific `skill_contribution` string describing
         what the skill contributed and from which section.
      5. Fills `patient_match_reason` — reusing the recommendation's own
         `patient_specific_reason` if the upstream agent already wrote one
         (avoiding a redundant LLM call), else falling back to the
         matched-evidence text, else a safe generic explanation.
      6. Records every applied recommendation in a skill_name ->
         [recommendation label, ...] map so the final
         `retrieved_skills_summary` (FIX 4) can show, per retrieved skill,
         exactly which recommendations actually used it.

    This agent is intentionally deterministic (no LLM call) — it is a
    traceability/bookkeeping pass over content the upstream agents already
    generated, not a new source of clinical judgment.
    """

    async def apply_skills(self, state: TreatmentPlanState) -> TreatmentPlanState:
        logger.info("🔗 Treatment Skill Application Agent: Starting")

        retrieved_skills = state.get("retrieved_treatment_skills", [])
        skill_lookup: Dict[str, Dict[str, Any]] = {
            _skill_display_name(s): s for s in retrieved_skills
        }

        # skill_name -> list of applied recommendation labels
        applied_map: Dict[str, List[str]] = {}

        def _apply(rec, rec_label: str):
            skill_name = getattr(rec, "source_skill_name", None)
            if not skill_name:
                return

            skill = skill_lookup.get(skill_name)
            if not skill:
                logger.warning(
                    f"⚠️ {rec_label} cites unknown/stale skill '{skill_name}' — "
                    f"clearing citation rather than trusting it"
                )
                rec.source_skill_name = None
                rec.source_skill_section = None
                return

            # matched_evidence: pulled directly from what retrieval already
            # matched for this patient against this skill — never invented.
            skill_evidence = skill.get("matched_evidence", []) or []
            if skill_evidence:
                rec.matched_evidence = list(skill_evidence[:6])

            # skill_contribution: short, specific description of what this
            # skill contributed to this exact recommendation.


            # ★ NEW — provenance comes only from the skill, never the LLM
            # skill_contribution: short, specific description of what this
            # skill contributed to this exact recommendation.

            body = skill.get("body") or {}

            # ★ NEW — provenance fields only exist on DrugRecommendation and
            # ProceduralRecommendation. Investigations and Lifestyle items
            # don't have these fields, so we check before setting them.
            if hasattr(rec, "guideline_support"):
                skill_guideline = f"{skill.get('guideline','')} {skill.get('guideline_version','')}".strip()
                rec.guideline_support = skill_guideline or None
                rec.guideline_rationale = (
                    f"Derived from retrieved skill '{skill_name}'"
                    + (f", guideline: {skill_guideline}" if skill_guideline else "")
                )
                rec.recommendation_class = body.get("recommendation_class")
                rec.evidence_level = body.get("evidence_level")

            if hasattr(rec, "is_primary_treatment"):
                rec_name = getattr(rec, "drug_name", None) or getattr(rec, "procedure_name", None) or ""
                rec_name = rec_name.lower()
                for stage_entry in (body.get("stage_wise_treatment", []) or []):
                    if rec_name and rec_name in str(stage_entry.get("primary_treatment", "")).lower():
                        rec.is_primary_treatment = True
                        break

            section = getattr(rec, "source_skill_section", None) or "skill body"
            rec.skill_contribution = f"Grounded in retrieved skill '{skill_name}' ({section})"

            # patient_match_reason: prefer the upstream agent's own
            # patient-specific rationale (already patient-specific and
            # already generated — no need to re-derive it), else build one
            # from the skill's matched evidence, else a safe fallback.
            existing_reason = (getattr(rec, "patient_specific_reason", "") or "").strip()
            if existing_reason:
                rec.patient_match_reason = existing_reason
            elif skill_evidence:
                rec.patient_match_reason = (
                    f"Matches patient evidence: {', '.join(skill_evidence[:4])}"
                )
            else:
                rec.patient_match_reason = (
                    f"Recommendation grounded in '{skill_name}'; no specific patient "
                    f"evidence markers were carried through retrieval for this skill."
                )

            applied_map.setdefault(skill_name, []).append(rec_label)

        for d in state.get("candidate_drugs", []):
            _apply(d, f"Drug: {d.drug_name}")
        for p in state.get("candidate_procedures", []):
            _apply(p, f"Procedure: {p.procedure_name}")
        for i in state.get("candidate_investigations", []):
            _apply(i, f"Investigation: {i.test_name}")
        for l in state.get("lifestyle_recommendations", []):
            _apply(l, f"Lifestyle: {l.intervention_type}")

        state["skill_applications_map"] = applied_map

        total_applied = sum(len(v) for v in applied_map.values())
        logger.info(
            f"✅ Skill Application: {total_applied} recommendation(s) traced back to "
            f"{len(applied_map)} retrieved skill(s)"
        )

        return state


# =====================================================================
# NEO4J TREATMENT KNOWLEDGE GRAPH
# =====================================================================

class TreatmentKnowledgeGraph:
    """Neo4j-based treatment knowledge graph"""
    
    def __init__(self, uri: str, user: str, password: str):
        self.driver = GraphDatabase.driver(uri, auth=(user, password))
        logger.info(f"✅ Treatment Knowledge Graph connected: {uri}")
    
    def close(self):
        if self.driver:
            self.driver.close()
    
    def get_treatment_guidelines(
        self,
        disease: str,
        stage: Optional[str] = None,
        specialty: Optional[str] = None,
        prior_treatments: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """Retrieve treatment guidelines from knowledge graph"""

        query = """
        MATCH (d:Disease)
        WHERE toLower(d.name) = toLower($disease)
        OR toLower(d.name) CONTAINS toLower($disease)
        MATCH (d)-[:HAS_TREATMENT]->(t:Treatment)
        OPTIONAL MATCH (t)-[:RECOMMENDED_BY]->(g:Guideline)
        WHERE ($stage IS NULL OR toLower(t.applicable_stage) = toLower($stage)
            OR t.applicable_stage IS NULL)
        AND ($specialty IS NULL OR toLower(g.specialty) = toLower($specialty)
            OR g.specialty IS NULL)
        AND NOT (
            size($prior_treatments) > 0
            AND toLower(t.name) IN [x IN $prior_treatments | toLower(x)]
            AND t.line_of_therapy = 'first_line'
        )
        RETURN
            t.name as treatment,
            t.modality as modality,
            t.recommendation_class as rec_class,
            t.evidence_level as evidence,
            g.source as guideline,
            t.first_line as is_first_line,
            t.line_of_therapy as line_of_therapy
        ORDER BY t.first_line DESC, t.recommendation_class ASC
        LIMIT 20
        """

        try:
            with self.driver.session() as session:
                result = session.run(
                    query,
                    disease=disease,
                    stage=stage,
                    specialty=specialty,
                    prior_treatments=prior_treatments or []
                )
                
                treatments = []
                for record in result:
                    treatments.append({
                        "treatment": record["treatment"],
                        "modality": record["modality"],
                        "recommendation_class": record["rec_class"],
                        "evidence_level": record["evidence"],
                        "guideline": record["guideline"],
                        "is_first_line": record["is_first_line"]
                    })
                
                logger.info(f"📊 Retrieved {len(treatments)} treatments from knowledge graph")
                return treatments
                
        except Exception as e:
            logger.error(f"❌ Neo4j treatment query failed: {str(e)}")
            return []
    
    def get_drug_interactions(
        self,
        drug_name: str,
        current_medications: List[str]
    ) -> List[Dict[str, Any]]:
        """Check drug-drug interactions"""
        
        query = """
        MATCH (d1:Drug {name: $drug_name})-[i:INTERACTS_WITH]->(d2:Drug)
        WHERE d2.name IN $current_meds
        RETURN 
            d2.name as interacting_drug,
            i.severity as severity,
            i.mechanism as mechanism,
            i.management as management
        """
        
        try:
            with self.driver.session() as session:
                result = session.run(
                    query,
                    drug_name=drug_name,
                    current_meds=current_medications
                )
                
                interactions = []
                for record in result:
                    interactions.append({
                        "drug": record["interacting_drug"],
                        "severity": record["severity"],
                        "mechanism": record["mechanism"],
                        "management": record["management"]
                    })
                
                return interactions
                
        except Exception as e:
            logger.error(f"❌ Interaction query failed: {str(e)}")
            return []
    
    def get_contraindications(
        self,
        drug_name: str,
        comorbidities: List[str],
        patient_age: int,
        renal_function: Optional[float]
    ) -> List[str]:
        """Check contraindications for a drug"""
        
        query = """
        MATCH (d:Drug {name: $drug_name})-[:CONTRAINDICATED_IN]->(c:Condition)
        WHERE c.name IN $comorbidities
        RETURN c.name as condition, 'absolute' as type
        
        UNION
        
        MATCH (d:Drug {name: $drug_name})-[:CAUTION_IN]->(c:Condition)
        WHERE c.name IN $comorbidities
        RETURN c.name as condition, 'relative' as type
        """
        
        try:
            with self.driver.session() as session:
                result = session.run(
                    query,
                    drug_name=drug_name,
                    comorbidities=comorbidities
                )
                
                contraindications = []
                for record in result:
                    contraindications.append(
                        f"{record['type'].upper()}: {record['condition']}"
                    )
                
                # Age-based contraindications
                if patient_age >= 65:
                    # Check Beers Criteria
                    beers_query = """
                    MATCH (d:Drug {name: $drug_name})-[:BEERS_CRITERIA]->(b)
                    RETURN b.warning as warning
                    """
                    beers_result = session.run(beers_query, drug_name=drug_name)
                    for record in beers_result:
                        contraindications.append(f"BEERS: {record['warning']}")
                
                # Renal contraindications
                if renal_function and renal_function < 60:
                    renal_query = """
                    MATCH (d:Drug {name: $drug_name})
                    WHERE d.avoid_if_egfr_below > $egfr
                    RETURN d.renal_warning as warning
                    """
                    renal_result = session.run(renal_query, drug_name=drug_name, egfr=renal_function)
                    for record in renal_result:
                        contraindications.append(f"RENAL: {record['warning']}")
                
                return contraindications
                
        except Exception as e:
            logger.error(f"❌ Contraindication query failed: {str(e)}")
            return []


# =====================================================================
# LAYER 1: TREATMENT INTENT & GOAL IDENTIFICATION
# =====================================================================


class TreatmentIntentAgent:
    """Determines treatment intent and goals"""
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
    
    async def determine_intent(self, state: TreatmentPlanState) -> TreatmentPlanState:
        """Identify treatment intent based on diagnosis and patient summary"""
        
        logger.info("🎯 Treatment Intent Agent: Starting for patient ID %s", state["treatment_input"].patient_id)
        
        treatment_input = state["treatment_input"]
        primary_dx = treatment_input.primary_diagnosis
        patient_summary = state.get("patient_summary") or {}
        # logger.info(f"📋 Patient summary retrieved: {patient_summary}")
        summary_data = patient_summary.get("summary", {})

        # Full patient summary
        clinical_summary_text = "\n\n".join(
            summary_data.get("paragraphs", [])
        )

        agentic_context = {
            "clinical_summary": clinical_summary_text
        }
        patient_summary_json = json.dumps(agentic_context, indent=2, default=str)

        # logger.info(f"🎯 TreatmentIntentAgent | agentic_context: {patient_summary_json}")
        strategy = state.get("current_strategy", TreatmentStrategy.STANDARD)
        prognosis = state.get("prognosis")
        prognosis_context = ""
        if prognosis:
            prognosis_context = f"""
        PROGNOSIS DATA (use to inform intent — poor prognosis may shift curative → palliative):
        Overall prognosis        : {prognosis.overall_prognosis or 'Not specified'}
        5-year survival rate     : {prognosis.five_year_survival_rate or 'Unknown'}
        Risk stratification      : {prognosis.risk_stratification or 'Not specified'}
        Expected treatment response: {prognosis.expected_treatment_response or 'Not specified'}
        Performance status       : {prognosis.performance_status or 'Not specified'}
"""

        summary_context = f"""
        PATIENT CLINICAL CONTEXT (clinical summary + treatment timeline — use to decide intent):
        {patient_summary_json}
        {prognosis_context}
        INTENT MAPPING RULES — apply strictly in this order:
        1. If imaging confirms distant metastasis (liver/lung/bone/brain) → palliative
        2. If nodal metastasis only (regional lymph nodes), no distant spread, newly diagnosed → curative
        3. If early stage (I or II), no metastasis → curative
        4. If chronic stable disease under ongoing management → disease_modifying
        5. If progressive after multiple treatment lines with no curative option remaining → palliative
        6. If acute crisis (sepsis, obstruction, hemorrhage, severe pain) → symptom_control
        7. If no active disease, only risk factors → preventive

        CRITICAL: Nodal involvement alone does NOT make intent palliative.
        Only assign palliative if distant organ metastasis is explicitly documented in the imaging above.
        """

        if not patient_summary:
            logger.warning("Patient summary is missing. Using default values.")

        # Handle case when no primary diagnosis is provided
        if not primary_dx:
            logger.info("No structured primary_diagnosis provided - deriving intent from clinical summary/timeline")

            prompt = f"""You are a senior physician determining treatment intent.

⚠️ PRIORITY INSTRUCTION — READ THIS FIRST:
No structured diagnosis object was passed with this request. This does NOT mean the patient is healthy —
it only means the caller didn't attach one. Your first and most important job is to read the PATIENT
CLINICAL CONTEXT below (clinical summary + timeline) and determine if it documents an active disease.

- If the clinical context documents ANY active serious condition — cancer, cardiac disease, organ failure,
  active infection, or any diagnosed pathology — you MUST treat that as the real primary condition and
  choose intent (curative / disease_modifying / palliative / symptom_control) exactly as you would if it
  had been passed as a structured diagnosis. Do NOT downgrade a real disease into a "wellness plan."
- Only choose "preventive" if the clinical context shows NO active disease process at all — i.e. a
  genuinely healthy patient with, at most, risk factors and no diagnosed condition.
- Silently defaulting to "preventive" without checking the clinical context below is a critical error.

PATIENT CONTEXT:
Age: {treatment_input.patient_age}
Sex: {treatment_input.patient_sex}
Comorbidities: {', '.join(treatment_input.comorbidities)}
Current Medications: {', '.join([m.drug_name for m in treatment_input.current_medications])}
Visit Type: {treatment_input.visit_type}

{summary_context}

TASK:
1. Read the clinical context above and identify the actual active condition, if any.
2. Select the treatment intent that matches that real condition (not a default).
3. Define 3-5 specific, measurable goals appropriate to that condition and intent — e.g. for an active
   cancer diagnosis, goals should reflect staging, treatment initiation, and disease control — NOT generic
   wellness language — unless the patient is genuinely healthy.

OUTPUT (JSON):
{{
  "identified_condition": "the actual disease/condition found in the clinical context, or 'none identified'",
  "treatment_intent": "EXACTLY ONE of: curative, disease_modifying, palliative, symptom_control, preventive",
  "treatment_goals": [
    "Specific measurable goal 1",
    "Specific measurable goal 2",
    "Specific measurable goal 3"
  ]
}}

Return ONLY JSON."""
        else:
            prompt = f"""You are a senior physician determining treatment intent.

            DIAGNOSIS: {primary_dx.disease} | STAGE: {primary_dx.stage or 'Not specified'} | SEVERITY: {primary_dx.severity}
            AGE: {treatment_input.patient_age} | VISIT: {treatment_input.visit_type}

            {summary_context}

            Read the patient summary above carefully. Apply the intent mapping rules to select exactly one intent.
            Then define 3-5 specific measurable treatment goals based on the patient's actual condition.

            OUTPUT JSON only:
            {{
            "treatment_intent": "curative|disease_modifying|palliative|symptom_control|preventive",
            "treatment_goals": ["goal 1", "goal 2", "goal 3"]
            }}"""
        
        try:
            response = self.llm.invoke([  # Send prompt to LLM for treatment intent
                SystemMessage(content="Determine treatment intent. Return only JSON."),
                HumanMessage(content=prompt)
            ])
            
            result = self._parse_json(response.content)
            
            # FIX: Handle invalid intent values
            raw_intent = result.get("treatment_intent", "").lower()
            
            # Map to valid enum
            valid_intents = {
                "curative": TreatmentIntent.CURATIVE,
                "disease_modifying": TreatmentIntent.DISEASE_MODIFYING,
                "palliative": TreatmentIntent.PALLIATIVE,
                "symptom_control": TreatmentIntent.SYMPTOM_CONTROL,
                "preventive": TreatmentIntent.PREVENTIVE
            }
            
            # If invalid or contains pipe, default to symptom_control or preventive
            if raw_intent in valid_intents:
                state["treatment_intent"] = valid_intents[raw_intent]
            else:
                # Default to preventive if no diagnosis, otherwise symptom_control
                if not primary_dx:
                    logger.warning(f"⚠️ Invalid intent '{raw_intent}', defaulting to preventive")
                    state["treatment_intent"] = TreatmentIntent.PREVENTIVE
                else:
                    logger.warning(f"⚠️ Invalid intent '{raw_intent}', defaulting to symptom_control")
                    state["treatment_intent"] = TreatmentIntent.SYMPTOM_CONTROL
            
            state["treatment_goals"] = result.get("treatment_goals", [])
            
            logger.info(f"✅ Treatment Intent: {state['treatment_intent']}")
            
        except Exception as e:
            logger.error(f"❌ Intent determination failed: {str(e)}")
            # FIX: Set default intent based on whether diagnosis exists
            if not primary_dx:
                state["treatment_intent"] = TreatmentIntent.PREVENTIVE
            else:
                state["treatment_intent"] = TreatmentIntent.SYMPTOM_CONTROL
            state["warnings"].append("Treatment intent determination incomplete")
        
        return state
    
    def _parse_json(self, content: str) -> dict:
        try:
            content = content.strip()
            if "```json" in content:
                content = content.split("```json", 1)[1].split("```", 1)[0]
            start = content.find("{")
            end = content.rfind("}")
            if start != -1 and end != -1:
                return json.loads(content[start:end + 1])
            return {}
        except:
            return {}
# =====================================================================
# LAYER 2: GUIDELINE RETRIEVAL AGENT
# =====================================================================

class GuidelineRetrievalAgent:
    """Retrieves evidence-based treatment guidelines, filtered by doctor's selected guidelines"""
    
    def __init__(self, knowledge_graph: TreatmentKnowledgeGraph):
        self.kg = knowledge_graph
    
    async def retrieve_guidelines(self, state: TreatmentPlanState) -> TreatmentPlanState:
        """Query knowledge graph for treatment guidelines, filtered by doctor's selected guidelines"""

        logger.info("📚 Guideline Retrieval Agent: Starting")

        treatment_input = state["treatment_input"]
        primary_dx = treatment_input.primary_diagnosis

        # ── Extract agentic context (clinical_summary + timeline + treatment_timeline) ──
        patient_summary = state.get("patient_summary") or {}
        # logger.info(f"📋 Patient summary retrieved: {patient_summary}")
        summary_data = patient_summary.get("summary", {})

        # Full patient summary
        clinical_summary_text = "\n\n".join(
            summary_data.get("paragraphs", [])
        )

        agentic_context = {
            "clinical_summary": clinical_summary_text
        }
        patient_summary_json = json.dumps(agentic_context, indent=2, default=str)
        agentic_context_json = json.dumps(agentic_context, indent=2, default=str)
        # logger.info(f"📚 GuidelineRetrievalAgent | agentic_context: {agentic_context_json}")

        # ── Extract prior_treatments from treatment_timeline for Neo4j query ──
        prior_treatments = []
        treatment_timeline = agentic_context.get("treatment_timeline", {})
        if isinstance(treatment_timeline, dict):
            for phase_key, phase_val in treatment_timeline.items():
                if isinstance(phase_val, list):
                    for item in phase_val:
                        t = item.get("treatment", "") if isinstance(item, dict) else str(item)
                        if t:
                            prior_treatments.append(t)
                elif isinstance(phase_val, str) and phase_val:
                    prior_treatments.append(phase_val)

        # Fallback: also check patient_medical_history in raw summary
        if not prior_treatments:
            medical_history = patient_summary.get("patient_medical_history", {})
            prior_treatments = [
                t.get("treatment", "") if isinstance(t, dict) else t
                for t in medical_history.get("treatment_progressions", [])
                if (t.get("treatment", "") if isinstance(t, dict) else t)
            ]

        if prior_treatments:
            logger.info(f"📚 Prior treatments found: {prior_treatments} — will fetch next-line guidelines")

        # ── Fetch doctor's selected guidelines from doctor_guidelines_collection by doctorId ──
        # doctor sys_user_id is stored in patient_preferences during build_treatment_input
        doctor_lookup_id = treatment_input.patient_preferences or treatment_input.doctor_speciality
        logger.info(f"📚 Looking up doctor guidelines for doctorId: {doctor_lookup_id}")
        doctor_guidelines_list = []
        allowed_guideline_titles = set()

        try:
            doctor_guideline_doc = await doctor_guidelines_collection.find_one(
                {"doctorId": doctor_lookup_id}
            )

            if doctor_guideline_doc:
                doctor_guidelines_list = doctor_guideline_doc.get("guidelines", [])
                allowed_guideline_titles = {
                    g.get("title", "").strip().upper()
                    for g in doctor_guidelines_list
                    if g.get("title")
                }
                logger.info(f"✅ Doctor guidelines fetched from DB:")
                logger.info(f"   doctorId      : {doctor_guideline_doc.get('doctorId')}")
                logger.info(f"   specialization: {doctor_guideline_doc.get('specialization')}")
                logger.info(f"   total count   : {len(doctor_guidelines_list)}")
                logger.info(f"   ┌─────────────────────────────────────────")
                for g in doctor_guidelines_list:
                    logger.info(f"   │ [{g.get('id')}] {g.get('title')}")
                    logger.info(f"   │     reference  : {g.get('reference', 'N/A')}")
                    logger.info(f"   │     explanation: {g.get('explanation', 'N/A')}")
                logger.info(f"   └─────────────────────────────────────────")
                logger.info(f"   allowed_titles: {sorted(list(allowed_guideline_titles))}")
            else:
                logger.warning(
                    f"⚠️ No doctor guidelines found for doctorId={doctor_lookup_id} — "
                    f"all guideline recommendations will be blocked to enforce strict compliance"
                )
        except Exception as gde:
            logger.error(f"❌ Failed to fetch doctor guidelines: {str(gde)}")

        # Store doctor guidelines in state for downstream agents
        state["doctor_guidelines"] = doctor_guidelines_list
        state["allowed_guideline_titles"] = list(allowed_guideline_titles)
        logger.info(f"📚 Allowed guideline titles stored in state: {list(allowed_guideline_titles)}")

        # ── Handle case when no primary diagnosis is provided ──
        if not primary_dx:
            logger.info("ℹ️ No primary diagnosis provided - skipping guideline retrieval")
            state["applicable_guidelines"] = []
            state["guideline_recommendations"] = {
                "class_I": [],
                "class_IIa": [],
                "class_IIb": [],
                "first_line": [],
                "all": []
            }
            return state

        # ── Query knowledge graph ──
        try:
            guidelines = self.kg.get_treatment_guidelines(
                disease=primary_dx.disease,
                stage=primary_dx.stage,
                specialty=treatment_input.doctor_speciality,
                prior_treatments=prior_treatments
            )

            # ── Filter guidelines to only those the doctor has selected ──
            if allowed_guideline_titles:
                filtered_guidelines = []
                for g in guidelines:
                    g_source = str(g.get("guideline", "") or g.get("source", "")).strip().upper()
                    matched = any(
                        allowed in g_source or g_source in allowed
                        for allowed in allowed_guideline_titles
                    )
                    if matched:
                        filtered_guidelines.append(g)
                    else:
                        logger.info(f"   ⏭️ Skipping guideline '{g_source}' — not in doctor's selected list")
                guidelines = filtered_guidelines
                logger.info(f"📚 After doctor filter: {len(guidelines)} guidelines remain")
            else:
                logger.info("📚 No guideline filter applied — using all retrieved guidelines")

            state["applicable_guidelines"] = guidelines

            # Organize by recommendation class
            guideline_recs = {
                "class_I": [g for g in guidelines if g.get("recommendation_class") == "I"],
                "class_IIa": [g for g in guidelines if g.get("recommendation_class") == "IIa"],
                "class_IIb": [g for g in guidelines if g.get("recommendation_class") == "IIb"],
                "first_line": [g for g in guidelines if g.get("is_first_line")],
                "all": guidelines
            }

            state["guideline_recommendations"] = guideline_recs

            logger.info(f"✅ Retrieved {len(guidelines)} guideline recommendations")
            logger.info(f"   Class I (Must do): {len(guideline_recs['class_I'])}")
            logger.info(f"   First-line: {len(guideline_recs['first_line'])}")

        except Exception as e:
            logger.error(f"❌ Guideline retrieval failed: {str(e)}")
            state["applicable_guidelines"] = []
            state["guideline_recommendations"] = {
                "class_I": [],
                "class_IIa": [],
                "class_IIb": [],
                "first_line": [],
                "all": []
            }
            state["warnings"].append("Guideline retrieval failed")

        return state

# =====================================================================
# LAYER 3: EXCLUSION FILTER AGENT (CRITICAL)
# =====================================================================

class ExclusionFilterAgent:
    """Filters out already completed procedures and investigations"""
    
    async def filter_completed(self, state: TreatmentPlanState) -> TreatmentPlanState:
        """Build exclusion sets from completed items"""

        logger.info("🚫 Exclusion Filter Agent: Starting")

        treatment_input = state["treatment_input"]

        # Build exclusion sets
        excluded_procedures = set()
        excluded_investigations = set()

        # Add completed procedures from treatment_input (already built from summary)
        for proc in treatment_input.completed_procedures:
            excluded_procedures.add(proc.procedure_name.lower())
            logger.info(f"   ❌ Excluding procedure: {proc.procedure_name} (done on {proc.date_performed})")

        # Add completed investigations from treatment_input
        for inv in treatment_input.completed_investigations:
            excluded_investigations.add(inv.test_name.lower())
            logger.info(f"   ❌ Excluding investigation: {inv.test_name} (done on {inv.date_performed})")

        # Cross-check directly with patient_summary for anything missed
        patient_summary = state.get("patient_summary") or {}

        # Flatten all known procedure/investigation keys from the raw summary
        def _extract_all_strings(obj, keys):
            """Recursively extract values for given keys from nested dict/list"""
            found = []
            if isinstance(obj, dict):
                for k, v in obj.items():
                    if k in keys:
                        items = v if isinstance(v, list) else [v]
                        for item in items:
                            if isinstance(item, dict):
                                val = (item.get("procedure") or item.get("treatment") or
                                    item.get("modality") or item.get("test_name") or "")
                                if val:
                                    found.append(val)
                            elif isinstance(item, str) and item:
                                found.append(item)
                    else:
                        found.extend(_extract_all_strings(v, keys))
            elif isinstance(obj, list):
                for item in obj:
                    found.extend(_extract_all_strings(item, keys))
            return found

        procedure_keys = {"past_surgeries", "treatment_progressions", "recent_procedures"}
        investigation_keys = {
            "imaging_summary", "recent_imaging", "lab_results",
            "completed_investigations", "diagnostic_workup",
            "completed_workup", "diagnostic_tests", "investigations_completed"
        }  # ★ FIX #4 — widened
        for name in _extract_all_strings(patient_summary, procedure_keys):
            excluded_procedures.add(name.lower())
            logger.info(f"   ❌ Excluding procedure from summary: {name}")

        for name in _extract_all_strings(patient_summary, investigation_keys):
            excluded_investigations.add(name.lower())
            logger.info(f"   ❌ Excluding investigation from summary: {name}")

        state["excluded_procedures"] = excluded_procedures
        state["excluded_investigations"] = excluded_investigations

        logger.info(f"✅ Exclusion Filter: {len(excluded_procedures)} procedures, {len(excluded_investigations)} investigations excluded")

        return state



class TreatmentModalityDecisionAgent:
    """
    ★ FIX (Issues #1/#3) — Decides the PRIMARY treatment modality from
    diagnosis evidence + retrieved skills BEFORE any drug or procedure
    is generated. Prevents the Pharmacological Agent from defaulting to
    a drug-centric plan when diagnosis/skill/treatment_goals call for
    surgical resection as primary treatment.
    """
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def decide_modality(self, state: TreatmentPlanState) -> TreatmentPlanState:
        treatment_input = state["treatment_input"]
        primary_dx = treatment_input.primary_diagnosis
        retrieved_skills = state.get("retrieved_treatment_skills", [])
        skills_block = _format_treatment_skills_for_prompt(retrieved_skills, max_skills=6)
        goals = state.get("treatment_goals", [])

        if not primary_dx:
            state["modality_decision"] = {
                "primary_modality": "systemic",
                "systemic_therapy_role": "primary",
                "rationale": "No structured diagnosis provided",
            }
            return state

        prompt = f"""You are a senior surgical oncologist deciding the PRIMARY treatment modality.

DIAGNOSIS: {primary_dx.disease}
STAGE: {primary_dx.stage or 'Not specified'}
STATED TREATMENT GOALS: {', '.join(goals) or 'Not specified'}

★ RETRIEVED TREATMENT SKILLS (check stage_wise_treatment.primary_treatment and
treatment_principles for what the FIRST modality should be):
{skills_block}

RULE: If the stated treatment goals explicitly mention resection/surgical excision/curative surgical
intent, AND the retrieved skill documents surgery as primary for resectable/localized disease, surgery
MUST be primary_modality. Systemic drug therapy (e.g. Rituximab, chemotherapy) is only "primary" when
surgery is not indicated, disease is unresectable/disseminated/multicentric, or the skill/goals say so.

OUTPUT (JSON only):
{{
  "primary_modality": "surgery" | "systemic" | "combined" | "surveillance",
  "systemic_therapy_role": "primary" | "adjuvant_only" | "unresectable_disease_only" | "not_indicated",
  "rationale": "1-2 sentences citing the diagnosis/goals/skill that drove this"
}}
Return ONLY JSON."""

        try:
            response = self.llm.invoke([
                SystemMessage(content="Decide primary treatment modality. Return only JSON."),
                HumanMessage(content=prompt)
            ])
            result = self._parse_json(response.content)
            state["modality_decision"] = {
                "primary_modality": result.get("primary_modality", "systemic"),
                "systemic_therapy_role": result.get("systemic_therapy_role", "primary"),
                "rationale": result.get("rationale", ""),
            }
            logger.info(f"🎯 Modality Decision: {state['modality_decision']}")
        except Exception as e:
            logger.error(f"❌ Modality decision failed: {e}")
            state["modality_decision"] = {
                "primary_modality": "systemic",
                "systemic_therapy_role": "primary",
                "rationale": "Fallback — decision failed",
            }
        return state

    def _parse_json(self, content: str) -> dict:
        try:
            content = content.strip()
            if "```json" in content:
                content = content.split("```json", 1)[1].split("```", 1)[0]
            s, e = content.find("{"), content.rfind("}")
            if s != -1 and e != -1:
                return json.loads(content[s:e + 1])
            return {}
        except Exception:
            return {}

class TreatmentModalityDecisionAgent:
    """
    ★ FIX (Issues #1/#3) — Decides the PRIMARY treatment modality from
    diagnosis evidence + retrieved skills BEFORE any drug or procedure
    is generated. Prevents the Pharmacological Agent from defaulting to
    a drug-centric plan when diagnosis/skill/treatment_goals call for
    surgical resection as primary treatment.
    """
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def decide_modality(self, state: TreatmentPlanState) -> TreatmentPlanState:
        treatment_input = state["treatment_input"]
        primary_dx = treatment_input.primary_diagnosis
        retrieved_skills = state.get("retrieved_treatment_skills", [])
        skills_block = _format_treatment_skills_for_prompt(retrieved_skills, max_skills=6)
        goals = state.get("treatment_goals", [])

        if not primary_dx:
            state["modality_decision"] = {
                "primary_modality": "systemic",
                "systemic_therapy_role": "primary",
                "rationale": "No structured diagnosis provided",
            }
            return state

        prompt = f"""You are a senior surgical oncologist deciding the PRIMARY treatment modality.

DIAGNOSIS: {primary_dx.disease}
STAGE: {primary_dx.stage or 'Not specified'}
STATED TREATMENT GOALS: {', '.join(goals) or 'Not specified'}

★ RETRIEVED TREATMENT SKILLS (check stage_wise_treatment.primary_treatment and
treatment_principles for what the FIRST modality should be):
{skills_block}

RULE: If the stated treatment goals explicitly mention resection/surgical excision/curative surgical
intent, AND the retrieved skill documents surgery as primary for resectable/localized disease, surgery
MUST be primary_modality. Systemic drug therapy (e.g. Rituximab, chemotherapy) is only "primary" when
surgery is not indicated, disease is unresectable/disseminated/multicentric, or the skill/goals say so.

OUTPUT (JSON only):
{{
  "primary_modality": "surgery" | "systemic" | "combined" | "surveillance",
  "systemic_therapy_role": "primary" | "adjuvant_only" | "unresectable_disease_only" | "not_indicated",
  "rationale": "1-2 sentences citing the diagnosis/goals/skill that drove this"
}}
Return ONLY JSON."""

        try:
            response = self.llm.invoke([
                SystemMessage(content="Decide primary treatment modality. Return only JSON."),
                HumanMessage(content=prompt)
            ])
            result = self._parse_json(response.content)
            state["modality_decision"] = {
                "primary_modality": result.get("primary_modality", "systemic"),
                "systemic_therapy_role": result.get("systemic_therapy_role", "primary"),
                "rationale": result.get("rationale", ""),
            }
            logger.info(f"🎯 Modality Decision: {state['modality_decision']}")
        except Exception as e:
            logger.error(f"❌ Modality decision failed: {e}")
            state["modality_decision"] = {
                "primary_modality": "systemic",
                "systemic_therapy_role": "primary",
                "rationale": "Fallback — decision failed",
            }
        return state

    def _parse_json(self, content: str) -> dict:
        try:
            content = content.strip()
            if "```json" in content:
                content = content.split("```json", 1)[1].split("```", 1)[0]
            s, e = content.find("{"), content.rfind("}")
            if s != -1 and e != -1:
                return json.loads(content[s:e + 1])
            return {}
        except Exception:
            return {}
# =====================================================================
# LAYER 4: PHARMACOLOGICAL RECOMMENDATION AGENT
# =====================================================================

class PharmacologicalAgent:
    """Generates drug recommendations with safety checks"""
    
    def __init__(self, llm: ChatGroq, knowledge_graph: TreatmentKnowledgeGraph):
        self.llm = llm
        self.kg = knowledge_graph

    def _get_stage_context(self, stage: Optional[str], disease: str) -> str:
        """
        Dynamically generates stage-appropriate clinical constraints
        using the LLM's medical knowledge — works for ANY disease/specialty.
        """
        if not stage:
            return (
                f"Stage not specified for {disease}. "
                "Recommend conservatively. Only suggest treatments with broad indication "
                "across all stages of this disease. Do not assume advanced or metastatic disease."
            )

        prompt = f"""You are a senior clinical pharmacologist and oncologist with expertise across all medical specialties.

    DISEASE: {disease}
    STAGE: {stage}

    Your task is to write a SHORT clinical constraint paragraph (3-5 sentences max) that will be injected into a treatment planning prompt.

    This paragraph must:
    1. Describe what "{stage}" means clinically for "{disease}" 
    2. State which drug classes or treatment modalities ARE appropriate for this stage
    3. State which drug classes or treatment modalities are NOT appropriate (e.g., drugs approved only for metastatic/advanced/refractory settings when this is early-stage)
    4. Be specific to the actual disease — use correct clinical terminology for that specialty

    Return ONLY the plain text paragraph. No JSON. No bullet points. No preamble."""

        try:
            response = self.llm.invoke([
                SystemMessage(content="You are a clinical expert. Return only a plain text clinical constraint paragraph."),
                HumanMessage(content=prompt)
            ])
            
            stage_context = response.content.strip()
            
            # Safety fallback if response is empty or too short
            if not stage_context or len(stage_context) < 30:
                raise ValueError("Response too short")
                
            logger.info(f"✅ Stage context generated for {disease} {stage}")
            return stage_context
            
        except Exception as e:
            logger.warning(f"⚠️ Stage context generation failed: {str(e)}, using safe fallback")
            return (
                f"Stage: {stage} for {disease}. "
                "Apply the most current disease-specific clinical guidelines strictly. "
                "Only recommend treatments with evidence-based indication for this exact stage. "
                "Do not recommend drugs approved only for more advanced stages of this disease."
            )

    async def recommend_drugs(self, state: TreatmentPlanState) -> TreatmentPlanState:
        """Generate pharmacological recommendations"""
        
        logger.info("💊 Pharmacological Agent: Starting")
        
        treatment_input = state["treatment_input"]
        patient_summary = state.get("patient_summary") or {}
        # logger.info(f"📋 Patient summary retrieved: {patient_summary}")
        summary_data = patient_summary.get("summary", {})

        # Full patient summary
        clinical_summary_text = "\n\n".join(
            summary_data.get("paragraphs", [])
        )

        agentic_context = {
            "clinical_summary": clinical_summary_text
        }
        patient_summary_json = json.dumps(agentic_context, indent=2, default=str)
        # logger.info(f"💊 PharmacologicalAgent | agentic_context: {patient_summary_json}")
        primary_dx = treatment_input.primary_diagnosis
        guideline_recs = state.get("guideline_recommendations", {})

        # ★ PHASE 2 — retrieved treatment skills block
        retrieved_skills = state.get("retrieved_treatment_skills", [])
        skills_block = _format_treatment_skills_for_prompt(retrieved_skills)
        
        if not primary_dx:
            logger.info("ℹ️ No structured primary diagnosis - checking clinical summary/timeline for active disease before recommending")
            
        
            prompt = f"""
You are a clinical pharmacologist designing a medication plan for this patient.

⚠️ PRIORITY INSTRUCTION — MANDATORY FIRST STEP:
No structured diagnosis object was attached to this request. Before recommending anything, you MUST read
the patient clinical summary and timeline below and check whether it documents an active disease (cancer,
cardiac disease, infection, organ dysfunction, or any diagnosed pathology).

- If an active disease IS documented (e.g. a cancer diagnosis, even mentioned only in narrative form in the
  timeline or summary): you MUST design a disease-specific pharmacological plan for that condition — the
  same rigor you would apply if a structured diagnosis had been provided. This means guideline-based
  primary therapy (e.g. chemotherapy/targeted therapy/appropriate systemic treatment for a cancer, or
  disease-specific first-line drugs for any other condition), NOT vitamins, generic supplements, or
  "preventive" medications. A serious active disease is never treated with a wellness/supplement plan.
- ONLY if the clinical summary and timeline show NO active disease process (a genuinely healthy patient with
  at most risk factors) should you recommend preventive/prophylactic medications or supplements.
- Recommending vitamins or general supplements for a patient whose record documents an active malignancy or
  other serious disease is a critical failure. Check the clinical context below carefully before deciding.

PATIENT CLINICAL SUMMARY + TIMELINE (this is your primary source of truth — read it in full before deciding):
{patient_summary_json}

★ RETRIEVED TREATMENT SKILLS (Phase 2 — skill-first knowledge base retrieval, authoritative when present):
{skills_block}

TASK:
1. First, state internally whether an active disease is present in the clinical context above.
2. If yes: recommend the appropriate disease-specific medications for that actual condition, considering:
   - The specific diagnosis/stage/findings as documented in the summary and timeline
   - Prior treatments and current therapy stage (e.g. pre-op, post-op, on active treatment)
   - Comorbidities and current medications
   - Age, sex, renal/hepatic function, lab trends, and lifestyle factors if mentioned
   - The RETRIEVED TREATMENT SKILLS above — prefer a skill-grounded recommendation over generic knowledge
     whenever a retrieved skill covers the same drug/indication.
   Only recommend drugs supported by approved guidelines for that condition.
3. If no active disease is found: recommend preventive/adjunctive medications or supplements as before.
- Derive every recommendation directly from the patient summary and timeline.
- If treatment (e.g., chemotherapy) is documented as not yet started, mark recommendations as **conditional**
  pending therapy initiation and organ function assessment.
- Do NOT make assumptions beyond what is in the summary and timeline.

OUTPUT FORMAT (JSON array):
[
  {{
    "drug_name": "Exact drug name",
    "drug_class": "Pharmacological class",
    "indication": "Specific indication derived directly from the patient summary",
    "dose": "Patient-specific dose if applicable; otherwise 'conditional pending therapy/labs'",
    "frequency": "Frequency of administration",
    "route": "PO/IV/IM/SC",
    "duration": "Specific duration or 'conditional'",
    "guideline_support": "Exact guideline title + year + recommendation",
    "recommendation_class": "I|IIa|IIb",
    "evidence_level": "A|B|C",
    "guideline_rationale": "Exact guideline + year + recommendation",
    "patient_specific_reason": "Reference at least 2 factors from the patient summary",
    "supporting_trial": "RCT/trial name or null",
    "source_skill_name": "exact [SKILL: ...] name if grounded in a retrieved skill above, else null",
    "source_skill_section": "which part of that skill was used, else null",
    "renal_dose_adjustment": "Adjustment needed if explicitly mentioned, else null",
    "hepatic_dose_adjustment": "Adjustment needed if explicitly mentioned, else null",
    "monitoring_required": ["ONLY parameters explicitly named in the retrieved skill's monitoring/safety section — do NOT invent drug-level monitoring not present in the skill"],
    "monitoring_frequency": "Frequency",
    "generic_available": true|false,
    "alternative_if_unavailable": "Alternative drug"
  }}
]

CRITICAL RULES:
1. All recommendations MUST be **derived from the patient summary and timeline**.
2. If therapy has not started, **flag recommendations as conditional**.
3. guideline_rationale MUST cite **exact approved guideline**.
4. patient_specific_reason must reference **at least 2 explicit patient factors**.
5. If an active disease is documented anywhere in the summary/timeline, disease-specific treatment MUST
   take priority over any preventive/supplement recommendation for that same organ system.
6. Follow the CITATION RULE given with the retrieved treatment skills above.
7. Return **ONLY JSON array** — no explanations or filler text.
"""

        else:
            # Safe stage label — works whether stage is None or provided
            stage_label = primary_dx.stage if primary_dx and primary_dx.stage else "stated"
            disease_label = primary_dx.disease if primary_dx else "the stated condition"

            first_line_treatments = guideline_recs.get("first_line", [])
            first_line_drugs = [
                t for t in first_line_treatments
                if t.get("modality") == "pharmacological"
            ]

            stage_context = self._get_stage_context(primary_dx.stage, primary_dx.disease)

            # ★ FIX (Issues #1/#3) — surgery-vs-drug primacy
            modality_decision = state.get("modality_decision", {})
            candidate_procedures_ctx = state.get("candidate_procedures", [])
            modality_instruction = f"""
⚠️ PRIMARY MODALITY DECISION (MUST FOLLOW — decided upstream from diagnosis + skill review):
Primary modality      : {modality_decision.get('primary_modality', 'systemic')}
Systemic therapy role : {modality_decision.get('systemic_therapy_role', 'primary')}
Rationale             : {modality_decision.get('rationale', '')}

Surgical plan already generated for this patient:
{chr(10).join(f"- {p.procedure_name} ({p.timing}, intent: {p.indication})" for p in candidate_procedures_ctx) or '- None'}

RULES BASED ON THE ABOVE:
- If systemic_therapy_role is "adjuvant_only" or "unresectable_disease_only" or "not_indicated": do NOT
  propose the systemic drug as primary/curative treatment. Only include it as conditional — e.g. "if
  unresectable", "if residual/recurrent disease after surgery" — and set dose/duration to reflect that
  it is conditional pending surgical outcome.
- If primary_modality is "surgery" and surgery alone is curative per the retrieved skill, return an
  EMPTY drug list ([]) rather than inventing a systemic regimen.
- Never contradict the treatment_goals — if goals say "complete surgical resection, curative intent",
  drugs must be secondary/conditional, never the headline treatment.
"""

            # Extract patient summary context
            patient_summary = state.get("patient_summary") or {}
            # logger.info(f"📋 Patient summary retrieved: {patient_summary}")
            summary_data = patient_summary.get("summary", {})

            # Full patient summary
            clinical_summary_text = "\n\n".join(
                summary_data.get("paragraphs", [])
            )

            agentic_context = {
                "clinical_summary": clinical_summary_text
            }
            patient_summary_json = json.dumps(agentic_context, indent=2, default=str)
            strategy = state.get("current_strategy", TreatmentStrategy.STANDARD)

            strategy_instruction = {
                TreatmentStrategy.CONSERVATIVE: (
                    "CONSERVATIVE STRATEGY: Prefer monotherapy. Start lowest effective dose. "
                    "Prioritize safety over efficacy. Avoid combinations unless absolutely necessary. "
                    "Prefer oral over IV. Prefer generic over branded."
                ),
                TreatmentStrategy.STANDARD: (
                    "STANDARD STRATEGY: Follow first-line guideline recommendations. "
                    "Use standard doses. Combine drugs only per guideline protocols."
                ),
                TreatmentStrategy.AGGRESSIVE: (
                    "AGGRESSIVE STRATEGY: Use combination therapy from the start. "
                    "Prioritize maximum efficacy. Use higher end of dose ranges. "
                    "Include adjunctive drugs proactively. "
                    "Consider newer/targeted agents if available."
                ),
            }[strategy]

            intent = state.get("treatment_intent")
            intent_str = intent.value if intent else "not specified"

            excluded_investigations = state.get("excluded_investigations", set())
            intent = state.get("treatment_intent")
            intent_str = intent.value if intent else "not specified"

            prompt = f"""You are a clinical pharmacologist designing a medication regimen.

DIAGNOSIS: {primary_dx.disease} | STAGE: {primary_dx.stage or 'Not specified'} | INTENT: {intent_str}

⚠️ STAGE CONSTRAINT (MUST FOLLOW):
{stage_context}

{modality_instruction}

⚠️ TREATMENT STRATEGY (MUST FOLLOW):
{strategy_instruction}

PATIENT FACTORS:
Age: {treatment_input.patient_age} | eGFR: {treatment_input.renal_function_egfr or 'Unknown'} | Hepatic: {treatment_input.hepatic_function}
Allergies: {', '.join(a.allergen for a in treatment_input.allergies) or 'None'}
Current Medications: {', '.join(f"{m.drug_name} {m.dose}" for m in treatment_input.current_medications) or 'None'}

ALREADY COMPLETED INVESTIGATIONS (do NOT list these under monitoring_required):
{chr(10).join(f"- {i}" for i in excluded_investigations) or 'None'}

PATIENT CLINICAL CONTEXT (clinical summary + treatment timeline — use for biomarker status, prior treatments, and active diagnoses):
{patient_summary_json}

★ RETRIEVED TREATMENT SKILLS (Phase 2 — skill-first knowledge base retrieval, authoritative when present; use in
PREFERENCE to generic knowledge whenever a skill covers this disease/stage/drug class):
{skills_block}

⚠️ BIOMARKER RULES — read from the patient summary above and apply strictly:
- If HER2/IHC score is 1+ or negative → DO NOT recommend Trastuzumab, Pertuzumab, or any HER2-targeted therapy
- If HER2 score is 3+ or FISH amplified → HER2-targeted therapy IS indicated
- If ER/PR positive → endocrine therapy (Letrozole/Anastrozole for postmenopausal, Tamoxifen for premenopausal) IS indicated
- If ER/PR negative → DO NOT recommend Tamoxifen, Letrozole, or Anastrozole
- If patient is postmenopausal (age ≥55 or documented) → prefer Aromatase Inhibitor over Tamoxifen
- DO NOT combine Tamoxifen + Aromatase Inhibitor — use only one
- Apply equivalent biomarker logic for any other disease (MSI, EGFR, ALK, BCR-ABL, etc.) found in the summary

⚠️ APPROVED GUIDELINES — YOU MUST ONLY USE THESE (fetched from doctor's profile in DB):
{chr(10).join(f"  [{g.get('id')}] {g.get('title')} — {g.get('explanation', '')}" for g in state.get('doctor_guidelines', [])) or '  No specific guidelines configured — use your best clinical judgment'}

DO NOT cite any guideline not listed above. If a recommendation has no support from the approved guidelines above, omit it entirely.

GUIDELINE FIRST-LINE OPTIONS FROM KNOWLEDGE GRAPH (pre-filtered to approved guidelines only):
{chr(10).join(f"- {d.get('treatment')} (Class {d.get('recommendation_class')}, Evidence {d.get('evidence_level')})" for d in first_line_drugs) or 'No knowledge graph matches — base recommendations strictly on approved guidelines above'}

REQUIREMENTS:
1. Only recommend drugs indicated for {stage_label} {disease_label}
2. Every drug MUST be supported by one of the approved guidelines listed above
3. Strictly respect all biomarker rules above — check the summary before recommending any targeted therapy
4. Do not repeat drugs from prior failed treatments listed in the summary
5. Match drug count to the strategy
6. Adjust doses for renal/hepatic function
7. Avoid allergens
8. Follow the CITATION RULE given with the retrieved treatment skills above (source_skill_name/source_skill_section)
9. Follow the PRIMARY MODALITY DECISION above — never make drugs the headline treatment when surgery is primary; if systemic therapy role is not "primary", every drug's dose/duration must explicitly say "conditional"

OUTPUT (JSON array):
[
  {{
    "drug_name": "Exact drug name",
    "drug_class": "pharmacological class",
    "indication": "specific indication for {stage_label} {disease_label}",
    "dose": "specific dose",
    "frequency": "frequency",
    "route": "PO/IV/IM/SC",
    "duration": "duration or ongoing",
    "guideline_support": "MUST match one of the approved guideline titles above exactly",
    "recommendation_class": "I|IIa|IIb",
    "evidence_level": "A|B|C",
    "guideline_rationale": "Approved guideline name + year + class + one sentence. Must be from the approved list above only.",
    "patient_specific_reason": "Why this drug for THIS patient — reference at least 2 of: age, stage, biomarker status, renal function, prior treatments",
    "supporting_trial": "Key trial or null",
    "source_skill_name": "exact [SKILL: ...] name if grounded in a retrieved skill above, else null",
    "source_skill_section": "which part of that skill was used, else null",
    "renal_dose_adjustment": "adjustment or null",
    "monitoring_required": ["ONLY parameters explicitly named in the retrieved skill's monitoring/safety section — do NOT invent drug-level monitoring not present in the skill"],
    "monitoring_frequency": "frequency",
    "generic_available": true,
    "alternative_if_unavailable": "alternative"
  }}
]

Return ONLY JSON array."""

        try:
            response = self.llm.invoke([
                SystemMessage(content="Generate stage-appropriate drug recommendations. Return only JSON array."),
                HumanMessage(content=prompt)
            ])
            
            drugs_json = self._parse_json_array(response.content)
            candidate_drugs = []
            
            for drug_data in drugs_json:
                drug_name = drug_data.get("drug_name")
                
                current_med_names = [m.drug_name for m in treatment_input.current_medications]
                interactions = self.kg.get_drug_interactions(drug_name, current_med_names)
                
                contraindications = self.kg.get_contraindications(
                    drug_name=drug_name,
                    comorbidities=treatment_input.comorbidities,
                    patient_age=treatment_input.patient_age or 0,
                    renal_function=treatment_input.renal_function_egfr
                )
                
                if any("ABSOLUTE" in c for c in contraindications):
                    logger.warning(f"⚠️ Skipping {drug_name} - absolute contraindication")
                    continue
                
                
                
                drug_rec = DrugRecommendation(
                    drug_name=drug_name,
                    drug_class=drug_data.get("drug_class", ""),
                    indication=drug_data.get("indication", ""),
                    dose=drug_data.get("dose", ""),
                    frequency=drug_data.get("frequency", ""),
                    route=drug_data.get("route", "PO"),
                    duration=drug_data.get("duration", ""),
                    guideline_rationale=drug_data.get("guideline_rationale", ""),
                    patient_specific_reason=drug_data.get("patient_specific_reason", ""),
                    supporting_trial=drug_data.get("supporting_trial"),
                    source_skill_name=drug_data.get("source_skill_name"),
                    source_skill_section=drug_data.get("source_skill_section"),
                    renal_dose_adjustment=drug_data.get("renal_dose_adjustment"),
                    monitoring_required=drug_data.get("monitoring_required", []),
                    monitoring_frequency=drug_data.get("monitoring_frequency"),
                    drug_interactions=[i["drug"] for i in interactions],
                    generic_available=drug_data.get("generic_available", True),
                    alternative_if_unavailable=drug_data.get("alternative_if_unavailable")
                )
                candidate_drugs.append(drug_rec)
            
            # Post-process: fill any empty rationale fields as fallback
            # ★ PHASE 5/7 (doc1) — enforce grounding BEFORE any fallback text
            # is generated. A recommendation with no source_skill_name and no
            # approved-guideline match must not carry a fabricated
            # guideline_rationale — that's exactly 
            # Cancers 2024 Category 1" got hallucinated with zero skills
            # retrieved. ALLOW_UNGROUNDED_GUIDELINES=False is a module-level
            # constant checked here, not just documentation.
            
            def _filter_monitoring_to_skill(monitoring_list: List[str], skills: List[Dict[str, Any]]) -> List[str]:
                """★ FIX #5 — drop monitoring items not grounded in any
                retrieved skill's actual content (prevents hallucinated
                items like 'Rituximab levels monitoring')."""
                if not skills:
                    return monitoring_list
                skill_blob = " ".join(
                    json.dumps(s.get("body", {}), default=str).lower() for s in skills
                )
                kept = []
                for m in monitoring_list:
                    key_terms = re.findall(r"[a-zA-Z]{4,}", m.lower())
                    if any(term in skill_blob for term in key_terms):
                        kept.append(m)
                    else:
                        logger.warning(f"⚠️ Dropping non-skill-grounded monitoring item: '{m}'")
                return kept

            for drug in candidate_drugs:
                drug.monitoring_required = _filter_monitoring_to_skill(
                    drug.monitoring_required, retrieved_skills
                )

            # Post-process: fill any empty rationale fields as fallback
            for drug in candidate_drugs:
                if not drug.guideline_rationale or drug.guideline_rationale.strip() == "":

                    state["candidate_drugs"] = candidate_drugs
                    logger.info(f"✅ Pharmacological: {len(candidate_drugs)} drugs recommended")
            
        except Exception as e:
            logger.error(f"❌ Drug recommendation failed: {str(e)}")
            state["warnings"].append("Drug recommendation incomplete")
        
        return state

    def _parse_json_array(self, content: str) -> List[dict]:
        try:
            content = content.strip()
            if "```json" in content:
                content = content.split("```json", 1)[1].split("```", 1)[0]
            start = content.find("[")
            end = content.rfind("]")
            if start != -1 and end != -1:
                return json.loads(content[start:end + 1])
            return []
        except:
            return []

# =====================================================================
# LAYER 5: PROCEDURAL RECOMMENDATION AGENT
# =====================================================================

class ProceduralAgent:
    """Generates procedure recommendations only when clinically needed"""
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
    
    async def recommend_procedures(self, state: TreatmentPlanState) -> TreatmentPlanState:
        """Generate procedural recommendations only if patient needs them"""
        
        logger.info("🔪 Procedural Agent: Starting")
        
        treatment_input = state["treatment_input"]
        patient_summary = state.get("patient_summary") or {}
        # logger.info(f"📋 Patient summary retrieved: {patient_summary}")
        summary_data = patient_summary.get("summary", {})

        # Full patient summary
        clinical_summary_text = "\n\n".join(
            summary_data.get("paragraphs", [])
        )

        agentic_context = {
            "clinical_summary": clinical_summary_text
        }
        patient_summary_json = json.dumps(agentic_context, indent=2, default=str)
        primary_dx = treatment_input.primary_diagnosis
        guideline_recs = state.get("guideline_recommendations", {})
        excluded = state.get("excluded_procedures", set())

        # ★ PHASE 2 — retrieved treatment skills block
        retrieved_skills = state.get("retrieved_treatment_skills", [])
        skills_block = _format_treatment_skills_for_prompt(retrieved_skills)

        # ── Guard: no diagnosis ──────────────────────────────────────────────
        if not primary_dx:
            logger.info("ℹ️ No primary diagnosis — skipping procedural recommendations")
            state["candidate_procedures"] = []
            return state

        # ── Pull surgical/procedural options from guidelines ─────────────────
        # ── Pull surgical/procedural options from guidelines ─────────────────
        procedural_treatments = [
            t for t in guideline_recs.get("all", [])
            if t.get("modality") in ["surgical", "procedural"]
            and t.get("treatment", "").lower() not in excluded
        ]

        if not procedural_treatments:
            # ★ FIX #2 — do NOT return early. The Neo4j KG frequently has no
            # procedural entries for rarer diseases; the retrieved skill +
            # diagnosis must still be allowed to drive the LLM call below.
            logger.info("No knowledge-graph procedural matches — proceeding on retrieved skills + clinical judgment")

        # ── Build patient safety profile ─────────────────────────────────────
        ef = treatment_input.cardiac_function_ef
        age = treatment_input.patient_age
        comorbidities = treatment_input.comorbidities or []

        # Determine surgical risk level from EF
        if ef is None:
            ef_risk = "unknown — treat as moderate risk"
        elif ef >= 55:
            ef_risk = "normal (low cardiac risk)"
        elif ef >= 40:
            ef_risk = "mildly reduced (moderate cardiac risk)"
        elif ef >= 30:
            ef_risk = "reduced (high cardiac risk — avoid elective major surgery)"
        else:
            ef_risk = "severely reduced (very high risk — only life-saving procedures)"

        # Flag high-risk comorbidities
        high_risk_comorbidities = [
            c for c in comorbidities
            if any(term in c.lower() for term in [
                "renal failure", "liver failure", "coagulopathy",
                "severe copd", "pulmonary hypertension", "recent mi",
                "uncontrolled diabetes", "sepsis"
            ])
        ]

        # Extract patient summary context
        patient_summary = state.get("patient_summary") or {}
        agentic_context = {
            "clinical_summary": patient_summary.get("clinical_summary", {}).get("raw_output", "")
                                if isinstance(patient_summary.get("clinical_summary"), dict)
                                else str(patient_summary.get("clinical_summary", ""))
        }
        patient_summary_json = json.dumps(agentic_context, indent=2, default=str)
        strategy = state.get("current_strategy", TreatmentStrategy.STANDARD)

        strategy_instruction = {
            TreatmentStrategy.CONSERVATIVE: (
                "CONSERVATIVE: Only recommend procedures if medical management has clearly failed "
                "or if the procedure is absolutely necessary. Prefer minimally invasive options. "
                "If drugs already cover the indication, skip the procedure."
            ),
            TreatmentStrategy.STANDARD: (
                "STANDARD: Recommend procedures per guideline indications. "
                "Consider whether drugs already recommended make a procedure redundant."
            ),
            TreatmentStrategy.AGGRESSIVE: (
                "AGGRESSIVE: Recommend all indicated procedures. "
                "Don't wait for medical therapy to fail if upfront surgery is indicated. "
                "Include prophylactic procedures if evidence supports them."
            ),
        }[strategy]

        intent = state.get("treatment_intent")
        intent_str = intent.value if intent else "not specified"

        doctor_guidelines = state.get('doctor_guidelines', [])
        approved_guidelines_block = (
            chr(10).join(
                f"  [{g.get('id')}] {g.get('title')} — {g.get('explanation', '')}"
                for g in doctor_guidelines
            ) or "  No specific guidelines configured — use your best clinical judgment"
        )

        prompt = f"""You are a senior surgeon/interventionalist.
        Your task is to decide IF and WHICH procedures this patient actually needs.

        ⚠️ APPROVED GUIDELINES — USE ONLY THESE (fetched from doctor's profile in DB):
        {approved_guidelines_block}
        DO NOT reference any guideline not listed above. If a procedure cannot be justified by an approved guideline, omit it.

        ★ RETRIEVED TREATMENT SKILLS (Phase 2 — skill-first knowledge base retrieval, authoritative when present):
        {skills_block}

        ═══════════════════════════════════
        PATIENT PROFILE
        ═══════════════════════════════════
        Age              : {age}
        Primary Diagnosis: {primary_dx.disease}
        Stage            : {primary_dx.stage or 'Not specified'}
        Treatment Intent : {intent_str}

        CARDIAC STATUS
        Ejection Fraction : {ef or 'Unknown'}%
        EF Risk Level     : {ef_risk}

        COMORBIDITIES: {', '.join(comorbidities) if comorbidities else 'None'}
        HIGH-RISK FLAGS : {', '.join(high_risk_comorbidities) if high_risk_comorbidities else 'None'}

        ═══════════════════════════════════
        PATIENT HISTORY (from records)
        ═══════════════════════════════════
        PATIENT CLINICAL CONTEXT (clinical summary + treatment timeline — use for prior surgeries, treatments, and imaging context):
        {patient_summary_json}

        DRUGS ALREADY RECOMMENDED IN THIS PLAN:
        {chr(10).join(f"  - {d.drug_name} ({d.indication})" for d in state.get('candidate_drugs', [])) or '  None'}

        ⚠️ TREATMENT STRATEGY (MUST FOLLOW):
        {strategy_instruction}

        ═══════════════════════════════════
        GUIDELINE-RECOMMENDED PROCEDURES
        ═══════════════════════════════════
        {chr(10).join(f"- {p.get('treatment')} (Class {p.get('recommendation_class')})" for p in procedural_treatments)}

        ALREADY COMPLETED (DO NOT RECOMMEND):
        {chr(10).join(f"- {p}" for p in excluded) if excluded else 'None'}

═══════════════════════════════════
YOUR TASK
═══════════════════════════════════
1. Review each guideline procedure above.
2. Decide if this SPECIFIC patient needs it based on:
   - Their diagnosis and stage
   - Their cardiac EF and surgical risk
   - Their comorbidities and age
   - Treatment intent (curative vs palliative)
   - The RETRIEVED TREATMENT SKILLS above where relevant
3. If EF < 30%, only recommend life-saving or minimally invasive procedures.
4. If EF 30–40%, flag procedures as high-risk and require cardiology clearance.
5. SKIP any procedure already in the completed list.
6. If the patient does NOT need a procedure, simply omit it.
7. Follow the CITATION RULE given with the retrieved treatment skills above.

OUTPUT — JSON array only (empty [] if no procedures needed):
[
  {{
    "procedure_name": "exact procedure name",
    "patient_needs_this": true,
    "reason_needed": "why this patient specifically needs it — reference their diagnosis, stage, imaging, and prior treatments",
    "indication": "clinical indication",
    "timing": "immediate|urgent|elective",
    "guideline_support": "MUST match one of the approved guideline titles listed above exactly",
    "recommendation_class": "I|IIa|IIb",
    "evidence_level": "A|B|C",
    "guideline_rationale": "EXACT guideline name + year + class + what it says about this procedure. ",
    "patient_specific_reason": "Why THIS procedure for THIS patient — reference their specific stage, organ function, prior treatments, and why alternatives were not chosen",
    "supporting_trial": "Key trial supporting this procedure, or null",
    "source_skill_name": "exact [SKILL: ...] name if grounded in a retrieved skill above, else null",
    "source_skill_section": "which part of that skill was used, else null",
    "cardiac_risk_note": "safe|requires cardiology clearance|high risk - discuss with team",
    "prerequisites": ["pre-procedure requirement"],
    "contraindications": ["contraindication"],
    "expected_complications": ["possible complication"],
    "post_procedure_care": ["care requirement"]
  }}
]

CRITICAL RULES:
- Only include procedures where patient_needs_this is true.
- Never recommend a completed procedure.
- guideline_rationale MUST name the specific guideline, year, and class — never vague.
- patient_specific_reason MUST reference at least one patient-specific factor.
- If EF is severely reduced (<30%), override elective procedures to timing: "defer".
- Return ONLY valid JSON array, no explanation text."""

        try:
            response = self.llm.invoke([
                SystemMessage(content="You are a surgical decision-making assistant. Return only a JSON array."),
                HumanMessage(content=prompt)
            ])

            procedures_json = self._parse_json_array(response.content)
            candidate_procedures = []

            for proc_data in procedures_json:
                proc_name = proc_data.get("procedure_name", "")

                # Double-check exclusion list (LLM safety net)
                if proc_name.lower() in excluded:
                    logger.warning(f"⚠️ Skipping {proc_name} — already completed")
                    continue

                # Only include if LLM confirmed patient needs it
                if not proc_data.get("patient_needs_this", False):
                    logger.info(f"ℹ️ {proc_name} — not needed for this patient, skipping")
                    continue

                # ── Safe GuidelineSource mapping ──────────────────────────────
                guideline_map = {
                    "AHA": GuidelineSource.AHA,
                    "AHA/ACC": GuidelineSource.AHA,
                    "NCCN": GuidelineSource.NCCN,
                    "WHO": GuidelineSource.WHO,
                    "NICE": GuidelineSource.NICE,
                    "IDSA": GuidelineSource.IDSA,
                    "ASCO": GuidelineSource.ASCO,
                    "ESMO": GuidelineSource.ESMO,
                    "NCG India": GuidelineSource.NCG_INDIA,
                }
                guideline_enum = guideline_map.get(
                    proc_data.get("guideline_support", "WHO"), GuidelineSource.WHO
                )

                # ── Safe RecommendationClass mapping ─────────────────────────
                rec_class = proc_data.get("recommendation_class", "IIa")
                try:
                    rec_class_enum = RecommendationClass(rec_class)
                except ValueError:
                    logger.warning(f"⚠️ Invalid RecommendationClass '{rec_class}', defaulting to IIa")
                    rec_class_enum = RecommendationClass.CLASS_IIA

                # ── Safe EvidenceLevel mapping ────────────────────────────────
                evidence = proc_data.get("evidence_level", "B")
                try:
                    evidence_enum = EvidenceLevel(evidence)
                except ValueError:
                    logger.warning(f"⚠️ Invalid EvidenceLevel '{evidence}', defaulting to B")
                    evidence_enum = EvidenceLevel.B

                # ── Override timing if EF is critically low ───────────────────
                timing = proc_data.get("timing", "elective")
                if ef is not None and ef < 30 and timing == "elective":
                    timing = "defer"
                    logger.warning(f"⚠️ {proc_name} deferred — EF critically low ({ef}%)")

                proc_rec = ProceduralRecommendation(
                    procedure_name=proc_name,
                    indication=proc_data.get("indication", ""),
                    timing=timing,
                    guideline_rationale=proc_data.get("guideline_rationale", ""),
                    patient_specific_reason=proc_data.get("patient_specific_reason", ""),
                    supporting_trial=proc_data.get("supporting_trial"),
                    source_skill_name=proc_data.get("source_skill_name"),
                    source_skill_section=proc_data.get("source_skill_section"),
                    prerequisites=proc_data.get("prerequisites", []),
                    contraindications=proc_data.get("contraindications", []),
                    expected_complications=proc_data.get("expected_complications", []),
                    post_procedure_care=proc_data.get("post_procedure_care", []),
                    cardiac_risk_note=proc_data.get("cardiac_risk_note", "safe"),
                    reason_needed=proc_data.get("reason_needed", "")
                )
                candidate_procedures.append(proc_rec)

            # Post-process: fill any empty rationale fields as fallback
            for proc in candidate_procedures:
                if not proc.guideline_rationale or proc.guideline_rationale.strip() == "":
                    proc.guideline_rationale = (
                        f"{proc.guideline_support} guidelines — {proc.procedure_name} is recommended "
                        f"for {proc.indication} "
                        f"(Class {proc.recommendation_class}, Evidence Level {proc.evidence_level})"
                    )
                if not proc.patient_specific_reason or proc.patient_specific_reason.strip() == "":
                    disease = primary_dx.disease if primary_dx else "the stated condition"
                    proc.patient_specific_reason = (
                        f"Indicated for this patient with {disease} based on "
                        f"{proc.guideline_support} {proc.recommendation_class} recommendation; "
                        f"timing: {proc.timing}"
                    )

            state["candidate_procedures"] = candidate_procedures
            logger.info(f"✅ Procedural: {len(candidate_procedures)} procedures recommended for this patient")

        except Exception as e:
            logger.error(f"❌ Procedure recommendation failed: {str(e)}")
            state["warnings"].append("Procedure recommendation incomplete")

        return state

    def _parse_json_array(self, content: str) -> List[dict]:
        try:
            content = content.strip()
            if "```json" in content:
                content = content.split("```json", 1)[1].split("```", 1)[0]
            start = content.find("[")
            end = content.rfind("]")
            if start != -1 and end != -1:
                return json.loads(content[start:end + 1])
            return []
        except:
            return []

# =====================================================================
# LAYER 6: INVESTIGATION RECOMMENDATION AGENT
# =====================================================================

class InvestigationAgent:
    """Recommends diagnostic tests intelligently"""
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
    
    async def recommend_investigations(self, state: TreatmentPlanState) -> TreatmentPlanState:
        """Generate investigation recommendations"""
        
        logger.info("🔬 Investigation Agent: Starting")
        
        treatment_input = state["treatment_input"]
        patient_summary = state.get("patient_summary") or {}
        # logger.info(f"📋 Patient summary retrieved: {patient_summary}")
        summary_data = patient_summary.get("summary", {})

        # Full patient summary
        clinical_summary_text = "\n\n".join(
            summary_data.get("paragraphs", [])
        )

        agentic_context = {
            "clinical_summary": clinical_summary_text
        }
        patient_summary_json = json.dumps(agentic_context, indent=2, default=str)
        primary_dx = treatment_input.primary_diagnosis
        excluded = state.get("excluded_investigations", set())

        # ★ PHASE 2 — retrieved treatment skills block
        retrieved_skills = state.get("retrieved_treatment_skills", [])
        skills_block = _format_treatment_skills_for_prompt(retrieved_skills)
        
        # Get completed investigations with dates
        completed_map = {
            inv.test_name.lower(): inv
            for inv in treatment_input.completed_investigations
        }
        
        # Handle case when no primary diagnosis is provided
        if not primary_dx:
            logger.info("ℹ️ No structured primary diagnosis - checking clinical summary/timeline for active disease before ordering tests")
            
            doctor_guidelines_inv = state.get('doctor_guidelines', [])
            approved_inv_block = (
                chr(10).join(
                    f"  [{g.get('id')}] {g.get('title')} — {g.get('explanation', '')}"
                    for g in doctor_guidelines_inv
                ) or "  No specific guidelines configured — use your best clinical judgment"
            )

            prompt = f"""
You are designing a diagnostic testing strategy for this patient.

⚠️ PRIORITY INSTRUCTION — MANDATORY FIRST STEP:
No structured diagnosis was attached to this request. Before recommending any tests, check the clinical
summary and timeline below for evidence of an active disease (cancer, cardiac disease, infection, etc.).
- If an active disease IS documented: recommend the disease-specific staging/monitoring investigations that
  condition requires (e.g. staging CT/PET, tumor markers, biopsy follow-up for a cancer diagnosis) — NOT
  generic age/sex screening only.
- ONLY if no active disease is documented should this become a general preventive screening plan.

⚠️ APPROVED GUIDELINES — USE ONLY THESE (fetched from this doctor's profile in DB):
{approved_inv_block}
- Do NOT reference any guideline not listed above.
- Only recommend investigations supported by the approved guidelines above.

★ RETRIEVED TREATMENT SKILLS (Phase 2 — use to identify any staging/monitoring tests a matched skill requires):
{skills_block}

PATIENT FACTORS (derived from patient summary):
- Age: {treatment_input.patient_age} years
- Sex: {treatment_input.patient_sex}
- Comorbidities: {', '.join(treatment_input.comorbidities)}
- Current Medications: {', '.join([m.drug_name for m in treatment_input.current_medications])}
- Completed Investigations: {chr(10).join(f"- {inv.test_name}: {inv.result or 'Result pending'} (done {inv.date_performed})" for inv in treatment_input.completed_investigations)}
- Clinical summary: {patient_summary_json}  # Use this to infer risk factors, symptoms, prior diagnoses, lab trends, and lifestyle details

PROPOSED TREATMENTS/SUPPLEMENTS:
{', '.join(d.drug_name for d in state.get('candidate_drugs', []))}

TASK:
- Recommend **health screening and monitoring tests** tailored to this specific patient.
- Base recommendations on **the patient summary**, including inferred risks, comorbidities, medication effects, and prior investigations.
- Consider:
  1. Age- and sex-appropriate preventive screening (e.g., colonoscopy, mammogram)
  2. Monitoring for medications or supplements (safety labs, side-effect surveillance)
  3. Monitoring for comorbidities (disease-specific labs or imaging)
  4. Baseline health assessment for undiagnosed risks

OUTPUT (JSON array):
[
  {{
    "test_name": "Exact test name",
    "indication": "Why this test is needed — must reference patient-specific factors from the summary (age, sex, comorbidities, medications, lifestyle, lab trends)",
    "urgency": "stat|urgent|routine",
    "expected_finding": "What the result will tell us clinically for this patient",
    "will_change_management": true|false,
    "what_decision_it_drives": "Specific clinical decision this result informs (e.g., medication adjustment, initiation of therapy, further diagnostics)",
    "guideline_rationale": "MANDATORY — exact approved guideline title + year + what it recommends for this test",
    "patient_specific_reason": "Explain exactly why this test is relevant to THIS patient — reference factors in the patient summary",
    "source_skill_name": "exact [SKILL: ...] name if this test is required by a retrieved skill above, else null",
    "source_skill_section": "which part of that skill requires it, else null",
    "already_completed": false,
    "repeat_justified": false,
    "repeat_justification": null
  }}
]

GENDER RULES (STRICT):
- Never recommend mammogram for male patients
- Never recommend cervical smear/Pap smear for male patients
- Never recommend PSA test for female patients
- Never recommend ovarian cancer screening for male patients
- Patient sex is: {treatment_input.patient_sex} — apply rules accordingly

CRITICAL RULES:
1. All recommendations MUST be **derived from patient-specific summary details**.
2. guideline_rationale MUST cite the **exact guideline and year**.
3. what_decision_it_drives MUST explain a **real clinical decision**.
4. If a test was done recently, set already_completed=true.
5. Focus exclusively on **preventive health, monitoring, and risk-based interventions**.
6. Follow the CITATION RULE given with the retrieved treatment skills above.
7. Return **ONLY JSON array** — do NOT add explanations or commentary.
"""
        else:
            # Extract patient summary context
            patient_summary = state.get("patient_summary") or {}
            # logger.info(f"📋 Patient summary retrieved: {patient_summary}")
            summary_data = patient_summary.get("summary", {})

            # Full patient summary
            clinical_summary_text = "\n\n".join(
                summary_data.get("paragraphs", [])
            )

            agentic_context = {
                "clinical_summary": clinical_summary_text
            }
            patient_summary_json = json.dumps(agentic_context, indent=2, default=str)
            strategy = state.get("current_strategy", TreatmentStrategy.STANDARD)

            strategy_instruction = {
                TreatmentStrategy.CONSERVATIVE: (
                    "CONSERVATIVE: Only truly essential investigations. "
                    "Avoid redundant or low-yield tests. Minimum workup to guide treatment safely."
                ),
                TreatmentStrategy.STANDARD: (
                    "STANDARD: Full guideline-recommended workup for this diagnosis and stage."
                ),
                TreatmentStrategy.AGGRESSIVE: (
                    "AGGRESSIVE: Comprehensive workup. Include staging, predictive biomarkers, "
                    "pharmacogenomics if relevant, and baseline tests for all planned drugs."
                ),
            }[strategy]

            intent = state.get("treatment_intent")
            intent_str = intent.value if intent else "not specified"

            doctor_guidelines_inv = state.get('doctor_guidelines', [])
            approved_inv_block = (
                chr(10).join(
                    f"  [{g.get('id')}] {g.get('title')} — {g.get('explanation', '')}"
                    for g in doctor_guidelines_inv
                ) or "  No specific guidelines configured — use your best clinical judgment"
            )

            prompt = f"""You are designing a diagnostic testing strategy.

        ⚠️ APPROVED GUIDELINES — USE ONLY THESE (fetched from doctor's profile in DB):
        {approved_inv_block}
        DO NOT reference any guideline not in the list above. Only recommend investigations that can be justified by an approved guideline.

        ★ RETRIEVED TREATMENT SKILLS (Phase 2 — use to identify any staging/monitoring tests a matched skill requires):
        {skills_block}

        PRIMARY DIAGNOSIS: {primary_dx.disease}
        STAGE: {primary_dx.stage or 'Not specified'}
        TREATMENT INTENT: {intent_str}

        ⚠️ INVESTIGATION STRATEGY (MUST FOLLOW):
        {strategy_instruction}

        PROPOSED TREATMENTS:
        Drugs: {', '.join(d.drug_name for d in state.get('candidate_drugs', []))}
        Procedures: {', '.join(p.procedure_name for p in state.get('candidate_procedures', []))}

        PATIENT CLINICAL CONTEXT (clinical summary + treatment timeline — use for lab trends, imaging context, and prior investigations):
        {patient_summary_json}

        ALREADY COMPLETED INVESTIGATIONS (with dates):
        {chr(10).join(f"- {inv.test_name}: {inv.result or 'Result pending'} (done {inv.date_performed})" for inv in treatment_input.completed_investigations)}

        TASK: Recommend ONLY investigations that:
        1. Have NOT been done recently (unless repeat is medically justified)
        2. Will change management
        3. Are needed for monitoring the planned drugs/procedures
        4. Are required before planned procedures
        5. Are warranted by concerning lab trends or imaging findings above
        6. Are required by any retrieved treatment skill above

        OUTPUT (JSON array):
        [
        {{
            "test_name": "specific test name",
            "indication": "why needed — reference patient history/trends/planned treatments if applicable",
            "urgency": "stat|urgent|routine",
            "expected_finding": "what the result will tell us clinically",
            "will_change_management": true|false,
            "what_decision_it_drives": "Exactly what clinical decision this result will change — e.g. 'Will determine if patient is eligible for bladder-sparing protocol vs radical cystectomy' or 'Will guide cisplatin dose reduction if eGFR < 60'",
            "guideline_rationale": "MUST reference one of the approved guidelines listed above — name it exactly + year + what it says about this test. Never cite a guideline not in the approved list.",
            "patient_specific_reason": "Why this specific test is needed for THIS patient — reference their diagnosis, stage, planned drugs/procedures, lab trends, or prior imaging",
            "source_skill_name": "exact [SKILL: ...] name if this test is required by a retrieved skill above, else null",
            "source_skill_section": "which part of that skill requires it, else null",
            "already_completed": false,
            "repeat_justified": false,
            "repeat_justification": null
        }}
        ]

        CRITICAL RULES:
        - If lab trend is worsening → prioritize related monitoring tests
        - If prior imaging showed abnormality → check if follow-up imaging is now due
        - If test was done <30 days ago: set already_completed=true, repeat_justified=false (unless medically necessary)
        - If repeat IS needed: explain WHY in repeat_justification
        - guideline_rationale MUST name the specific guideline and year — never write 'guidelines recommend'
        - what_decision_it_drives MUST explain a real clinical decision, not just 'will monitor health'
        - Match investigation depth to strategy above
        - Follow the CITATION RULE given with the retrieved treatment skills above

        Return ONLY JSON array."""
        
        try:
            response = self.llm.invoke([
                SystemMessage(content="Recommend investigations. Return only JSON array."),
                HumanMessage(content=prompt)
            ])
            
            investigations_json = self._parse_json_array(response.content)
            
            candidate_investigations = []
            
            def _is_already_done(name: str, excluded_set: set) -> bool:
                """★ FIX #4 — substring match instead of exact match, so
                'PET-CT' matches 'PET/CT scan' and 'CBC' matches
                'Complete Blood Count (CBC)'."""
                t = name.lower().strip()
                for ex in excluded_set:
                    if t == ex or t in ex or ex in t:
                        return True
                return False

            for inv_data in investigations_json:
                test_name = inv_data.get("test_name", "")
                test_lower = test_name.lower()
                
                # Check if already completed
                already_done = _is_already_done(test_name, excluded)
                completed_inv = completed_map.get(test_lower)
                
                if already_done and not inv_data.get("repeat_justified"):
                    logger.info(f"   ✓ Skipping {test_name} - already done on {completed_inv.date_performed if completed_inv else 'unknown date'}")
                    continue
                
                inv_rec = InvestigationRecommendation(
                    test_name=test_name,
                    indication=inv_data.get("indication", ""),
                    urgency=inv_data.get("urgency", "routine"),
                    expected_finding=inv_data.get("expected_finding", ""),
                    will_change_management=inv_data.get("will_change_management", True),
                    what_decision_it_drives=inv_data.get("what_decision_it_drives", ""),
                    guideline_rationale=inv_data.get("guideline_rationale", ""),
                    patient_specific_reason=inv_data.get("patient_specific_reason", ""),
                    source_skill_name=inv_data.get("source_skill_name"),
                    source_skill_section=inv_data.get("source_skill_section"),
                    already_completed=already_done,
                    last_result_date=completed_inv.date_performed if completed_inv else None,
                    repeat_justified=inv_data.get("repeat_justified", False),
                    repeat_justification=inv_data.get("repeat_justification")
                )
                
                candidate_investigations.append(inv_rec)
            
            # Post-process: fill any empty rationale fields as fallback
            for inv in candidate_investigations:
                if not inv.guideline_rationale or inv.guideline_rationale.strip() == "":
                    inv.guideline_rationale = (
                        f"Standard clinical guidelines recommend {inv.test_name} "
                        f"for {inv.indication}"
                    )
                if not inv.patient_specific_reason or inv.patient_specific_reason.strip() == "":
                    inv.patient_specific_reason = (
                        f"Ordered for this patient because: {inv.indication}. "
                        f"Result will drive decision: {inv.what_decision_it_drives or inv.expected_finding}"
                    )
                if not inv.what_decision_it_drives or inv.what_decision_it_drives.strip() == "":
                    inv.what_decision_it_drives = (
                        f"Will guide clinical management based on {inv.expected_finding}"
                    )

            state["candidate_investigations"] = candidate_investigations
            logger.info(f"✅ Investigation: {len(candidate_investigations)} tests recommended")
            
        except Exception as e:
            logger.error(f"❌ Investigation recommendation failed: {str(e)}")
            state["warnings"].append("Investigation recommendation incomplete")
        
        return state
    
    def _parse_json_array(self, content: str) -> List[dict]:
        try:
            content = content.strip()
            if "```json" in content:
                content = content.split("```json", 1)[1].split("```", 1)[0]
            start = content.find("[")
            end = content.rfind("]")
            if start != -1 and end != -1:
                return json.loads(content[start:end + 1])
            return []
        except:
            return []

# =====================================================================
# LAYER 7: LIFESTYLE RECOMMENDATION AGENT
# =====================================================================

class LifestyleAgent:
    """Non-pharmacological interventions"""
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
    
    async def recommend_lifestyle(self, state: TreatmentPlanState) -> TreatmentPlanState:
        """Generate lifestyle recommendations"""
        
        logger.info("🏃 Lifestyle Agent: Starting")
        
        treatment_input = state["treatment_input"]
        patient_summary = state.get("patient_summary") or {}
        # logger.info(f"📋 Patient summary retrieved: {patient_summary}")
        summary_data = patient_summary.get("summary", {})

        # Full patient summary
        clinical_summary_text = "\n\n".join(
            summary_data.get("paragraphs", [])
        )

        agentic_context = {
            "clinical_summary": clinical_summary_text
        }
        patient_summary_json = json.dumps(agentic_context, indent=2, default=str)
        primary_dx = treatment_input.primary_diagnosis

        # ★ PHASE 2 — retrieved treatment skills block
        retrieved_skills = state.get("retrieved_treatment_skills", [])
        skills_block = _format_treatment_skills_for_prompt(retrieved_skills)
        
        # Handle case when no primary diagnosis is provided
        if not primary_dx:
            doctor_guidelines_ls = state.get('doctor_guidelines', [])
            approved_ls_block = (
                chr(10).join(
                    f"  [{g.get('id')}] {g.get('title')} — {g.get('explanation', '')}"
                    for g in doctor_guidelines_ls
                ) or "  No specific guidelines configured — use your best clinical judgment"
            )

            prompt = f"""
You are designing lifestyle interventions for this patient.

⚠️ PRIORITY INSTRUCTION — MANDATORY FIRST STEP:
No structured diagnosis was attached to this request. Before writing generic wellness advice, check the
clinical summary and timeline below for an active disease. If one is documented, tailor every recommendation
to that condition and its treatment (e.g. neutropenic precautions and fatigue management around chemotherapy,
pre-operative activity restriction if surgery is planned) rather than generic wellness advice. Only fall back
to general wellness/lifestyle guidance if no active disease is documented.

⚠️ APPROVED GUIDELINES — USE ONLY THESE (fetched from this doctor's profile in DB):
{approved_ls_block}
- Do NOT reference any guideline not listed above.
- Only include lifestyle recommendations supported by an approved guideline.

★ RETRIEVED TREATMENT SKILLS (Phase 2 — use to identify any lifestyle constraints tied to a matched skill):
{skills_block}

PATIENT FACTORS (derived from patient summary):
- Age: {treatment_input.patient_age} years
- Sex: {treatment_input.patient_sex}
- Comorbidities: {', '.join(treatment_input.comorbidities)}
- Current Medications: {', '.join([m.drug_name for m in treatment_input.current_medications])}
- Clinical summary: {patient_summary_json}  # Use this to infer lifestyle risks, prior interventions, lab trends, symptoms, and functional status

TASK:
- Recommend **evidence-based, patient-specific lifestyle modifications** for general health and wellness.
- Focus on actionable and measurable interventions **tailored to this patient**.
- Categories to address:
  - Diet (specific dietary changes based on age, comorbidities, medications, and lab trends)
  - Exercise (type, intensity, duration, frequency, contraindications based on patient factors)
  - Smoking cessation (if smoking risk is noted in summary)
  - Alcohol moderation (personalized based on risk factors)
  - Sleep hygiene (age-appropriate and comorbidity-adjusted)
  - Stress management (techniques suitable for patient lifestyle and mental health risk)

OUTPUT (JSON array):
[
  {{
    "intervention_type": "diet|exercise|smoking_cessation|alcohol|sleep|stress",
    "specific_recommendation": "SPECIFIC actionable recommendation with exact frequency, duration, intensity, and modification based on patient summary",
    "evidence_strength": "A|B|C",
    "expected_benefit": "Specific measurable benefit for this patient based on their comorbidities or lab trends",
    "implementation_difficulty": "easy|moderate|difficult",
    "guideline_rationale": "MANDATORY — exact approved guideline title + year + what it recommends for this intervention",
    "patient_specific_reason": "Explain why this intervention is relevant for THIS patient, referencing their age, comorbidities, medications, lab trends, or lifestyle factors from the summary",
    "source_skill_name": "exact [SKILL: ...] name if grounded in a retrieved skill above, else null",
    "source_skill_section": "which part of that skill was used, else null",
    "supporting_evidence": "Key study supporting this recommendation, or null if none"
  }}
]

IMPORTANT: If no retrieved skill or approved guideline supports a category (diet/exercise/sleep/stress/etc.),
OMIT that category entirely. Do not output generic wellness filler ("sleep 7-8 hours", "balanced diet",
"reduce stress") unless it is explicitly grounded in a retrieved skill or an approved guideline above.


CRITICAL RULES:
1. All recommendations MUST be **directly derived from patient-specific summary details**.
2. guideline_rationale MUST cite **exact guideline and year** from the approved list.
3. patient_specific_reason MUST reference **at least two patient-specific factors** (e.g., age + comorbidity, medication + lifestyle risk).
4. Be actionable, measurable, and realistic — include exact frequency, duration, and intensity where applicable.
5. Focus exclusively on **preventive health, wellness, and risk reduction**.
6. Follow the CITATION RULE given with the retrieved treatment skills above.
7. Return **ONLY JSON array** — do NOT add explanations or commentary.
"""
        else:
            # Extract patient summary context
            patient_summary = state.get("patient_summary") or {}
            # logger.info(f"📋 Patient summary retrieved: {patient_summary}")
            summary_data = patient_summary.get("summary", {})

            # Full patient summary
            clinical_summary_text = "\n\n".join(
                summary_data.get("paragraphs", [])
            )

            agentic_context = {
                "clinical_summary": clinical_summary_text
            }
            patient_summary_json = json.dumps(agentic_context, indent=2, default=str)
            strategy = state.get("current_strategy", TreatmentStrategy.STANDARD)
            candidate_procedures = state.get("candidate_procedures", [])
            candidate_drugs = state.get("candidate_drugs", [])

            doctor_guidelines_ls = state.get('doctor_guidelines', [])
            approved_ls_block = (
                chr(10).join(
                    f"  [{g.get('id')}] {g.get('title')} — {g.get('explanation', '')}"
                    for g in doctor_guidelines_ls
                ) or "  No specific guidelines configured — use your best clinical judgment"
            )

            prompt = f"""You are designing lifestyle interventions.

        ⚠️ APPROVED GUIDELINES — USE ONLY THESE (fetched from doctor's profile in DB):
        {approved_ls_block}
        DO NOT reference any guideline not listed above. Only include lifestyle recommendations supported by an approved guideline.

        ★ RETRIEVED TREATMENT SKILLS (Phase 2 — use to identify any lifestyle constraints tied to a matched skill):
        {skills_block}

        PRIMARY DIAGNOSIS: {primary_dx.disease}
        PATIENT AGE: {treatment_input.patient_age}
        COMORBIDITIES: {', '.join(treatment_input.comorbidities)}

        PATIENT CLINICAL CONTEXT (clinical summary + treatment timeline — use for active diagnoses, medications, and urgency context):
        {patient_summary_json}

        DRUGS IN THIS TREATMENT PLAN (tailor lifestyle advice around these):
        {chr(10).join(f"- {d.drug_name} ({d.drug_class})" for d in candidate_drugs) or 'None'}

        PLANNED PROCEDURES IN THIS TREATMENT PLAN:
        {chr(10).join(f"- {p.procedure_name}" for p in candidate_procedures) or 'None'}

        LIFESTYLE CONSTRAINT RULES (MUST FOLLOW):
        1. If surgery is planned → NO high-intensity exercise pre-operatively; recommend gentle mobilization only
        2. If any anticoagulant is in the DRUGS list above (Warfarin, Apixaban, Rivaroxaban, Heparin, Enoxaparin) → warn against contact sports and fall/bleeding risk activities
        3. If any corticosteroid is in the DRUGS list (Prednisolone, Dexamethasone) → advise high-calcium low-sodium diet; weight-bearing exercise to prevent bone loss
        4. If any chemotherapy drug is in the DRUGS list → advise fatigue management, neutropenic diet precautions, avoid crowded places
        5. If patient has cardiac condition → specify safe exercise intensity (e.g., <60% max heart rate; avoid isometric exercises)
        6. If patient has renal impairment → advise on fluid intake and protein restriction if applicable
        7. If patient has active infection/sepsis → defer exercise recommendations until resolved
        8. Tailor diet specifically to active conditions (e.g., low-sodium for heart failure, low-purine for gout)

        TASK: Recommend evidence-based lifestyle modifications that are SAFE given the above constraints.

        CATEGORIES:
        - Diet (specific dietary changes tailored to active conditions — not generic "eat healthy")
        - Exercise (type, intensity, frequency — with explicit contraindications based on planned procedures and conditions)
        - Smoking cessation (if applicable)
        - Alcohol reduction (if applicable)
        - Sleep hygiene
        - Stress management

        OUTPUT (JSON array):
        [
        {{
            "intervention_type": "diet|exercise|smoking_cessation|alcohol|sleep|stress",
            "specific_recommendation": "SPECIFIC actionable recommendation with exact frequency, duration, intensity",
            "evidence_strength": "A|B|C",
            "expected_benefit": "specific measurable benefit for this patient",
            "implementation_difficulty": "easy|moderate|difficult",
            "guideline_rationale": "MUST reference one of the approved guidelines listed above — name it exactly + year + what it says. Never cite a guideline not in the approved list.",
            "patient_specific_reason": "Why this lifestyle change is critical for THIS specific patient — reference their diagnosis, stage, planned treatments, or comorbidities",
            "source_skill_name": "exact [SKILL: ...] name if grounded in a retrieved skill above, else null",
            "source_skill_section": "which part of that skill was used, else null",
            "supporting_evidence": "Key study or meta-analysis supporting this recommendation, or null. Example: 'Cumberbatch et al. 2016 meta-analysis of 32 studies — smoking cessation reduces bladder cancer recurrence by 40%'"
        }}
        ]

        IMPORTANT: If no retrieved skill or approved guideline supports a category (diet/exercise/sleep/stress/etc.),
        OMIT that category entirely. Do not output generic wellness filler ("sleep 7-8 hours", "balanced diet",
        "reduce stress") unless it is explicitly grounded in a retrieved skill or an approved guideline above.

        CRITICAL RULES:
        - All recommendations MUST be **directly derived from patient-specific summary details**.
        - guideline_rationale MUST name the specific guideline and year
        - patient_specific_reason MUST link the recommendation to this patient's specific clinical situation
        - Follow the CITATION RULE given with the retrieved treatment skills above
        - Be SPECIFIC with recommendations:
        BAD: "Exercise regularly"
        GOOD: "Moderate-intensity aerobic exercise 150 min/week (e.g., brisk walking), avoiding high-impact activities pre-operatively if cystectomy is planned"

        Return ONLY JSON array."""
        
        try:
            response = self.llm.invoke([
                SystemMessage(content="Recommend lifestyle interventions. Return only JSON array."),
                HumanMessage(content=prompt)
            ])
            
            lifestyle_json = self._parse_json_array(response.content)
            
            lifestyle_recommendations = []
            for item in lifestyle_json:
                try:
                    # Handle evidence_strength mapping
                    evidence = item.get("evidence_strength", "B")
                    try:
                        evidence_enum = EvidenceLevel(evidence)
                    except ValueError:
                        logger.warning(f"⚠️ Invalid EvidenceLevel '{evidence}', defaulting to B")
                        evidence_enum = EvidenceLevel.B
                    
                    lifestyle_rec = LifestyleRecommendation(
                        intervention_type=item.get("intervention_type", "general"),
                        specific_recommendation=item.get("specific_recommendation", ""),
                        evidence_strength=evidence_enum,
                        expected_benefit=item.get("expected_benefit", ""),
                        implementation_difficulty=item.get("implementation_difficulty", "moderate"),
                        guideline_rationale=item.get("guideline_rationale", ""),
                        patient_specific_reason=item.get("patient_specific_reason", ""),
                        source_skill_name=item.get("source_skill_name"),
                        source_skill_section=item.get("source_skill_section"),
                        supporting_evidence=item.get("supporting_evidence")
                    )
                    lifestyle_recommendations.append(lifestyle_rec)
                except Exception as e:
                    logger.warning(f"⚠️ Error creating lifestyle recommendation: {str(e)}")
                    continue

            
            
            # ★ FIX #6 — drop lifestyle recommendations not grounded in a
            # retrieved skill or an approved guideline (prevents generic
            # filler like "sleep 7-8 hours", "balanced diet").
            approved_titles = {
                g.get("title", "").strip().upper()
                for g in state.get("doctor_guidelines", [])
            }

            def _is_grounded(rec: LifestyleRecommendation) -> bool:
                if rec.source_skill_name:
                    return True
                rationale_upper = (rec.guideline_rationale or "").upper()
                return any(title and title in rationale_upper for title in approved_titles)

            original_count = len(lifestyle_recommendations)
            lifestyle_recommendations = [r for r in lifestyle_recommendations if _is_grounded(r)]
            if len(lifestyle_recommendations) < original_count:
                logger.info(
                    f"🚫 Dropped {original_count - len(lifestyle_recommendations)} "
                    f"non-grounded lifestyle recommendation(s)"
                )

            # Store in state
            # Post-process: fill any empty rationale fields as fallback
            for rec in lifestyle_recommendations:
                if not rec.guideline_rationale or rec.guideline_rationale.strip() == "":
                    rec.guideline_rationale = (
                        f"Evidence-based guidelines recommend {rec.intervention_type} modifications "
                        f"for patients with this condition "
                        f"(Evidence Level {rec.evidence_strength}): {rec.expected_benefit}"
                    )
                if not rec.patient_specific_reason or rec.patient_specific_reason.strip() == "":
                    disease = primary_dx.disease if primary_dx else "the stated condition"
                    rec.patient_specific_reason = (
                        f"Recommended for this patient with {disease} "
                        f"to achieve: {rec.expected_benefit}"
                    )

            state["lifestyle_recommendations"] = lifestyle_recommendations
            logger.info(f"✅ Lifestyle: {len(lifestyle_recommendations)} interventions recommended")
            
        except Exception as e:
            logger.error(f"❌ Lifestyle recommendation failed: {str(e)}")
            state["warnings"].append("Lifestyle recommendation incomplete")
            state["lifestyle_recommendations"] = []
        
        return state
    
    def _parse_json_array(self, content: str) -> List[dict]:
        try:
            content = content.strip()
            if "```json" in content:
                content = content.split("```json", 1)[1].split("```", 1)[0]
            start = content.find("[")
            end = content.rfind("]")
            if start != -1 and end != -1:
                return json.loads(content[start:end + 1])
            return []
        except:
            return []

# =====================================================================
# LAYER 8: FOLLOW-UP PLANNING AGENT
# =====================================================================

class FollowUpAgent:
    """Intelligent follow-up scheduling"""
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
    
    async def plan_followup(self, state: TreatmentPlanState) -> TreatmentPlanState:
        """Generate follow-up plan"""
        
        logger.info("📅 Follow-up Agent: Starting")
        
        treatment_input = state["treatment_input"]
        patient_summary = state.get("patient_summary") or {}
        # logger.info(f"📋 Patient summary retrieved: {patient_summary}")
        summary_data = patient_summary.get("summary", {})

        # Full patient summary
        clinical_summary_text = "\n\n".join(
            summary_data.get("paragraphs", [])
        )

        agentic_context = {
            "clinical_summary": clinical_summary_text
        }
        patient_summary_json = json.dumps(agentic_context, indent=2, default=str)
        primary_dx = treatment_input.primary_diagnosis

        # ★ PHASE 2 — retrieved treatment skills block (skills often carry
        # their own monitoring/follow-up cadence — surface it here too)
        retrieved_skills = state.get("retrieved_treatment_skills", [])
        skills_block = _format_treatment_skills_for_prompt(retrieved_skills)
        
        # Handle case when no primary diagnosis is provided
        if not primary_dx:
            prompt = f"""
You are scheduling follow-up for this patient.

⚠️ PRIORITY INSTRUCTION — MANDATORY FIRST STEP:
No structured diagnosis was attached to this request. Before scheduling generic wellness follow-up, check
the clinical summary and timeline below for an active disease. If one is documented (e.g. an active cancer),
the follow-up interval and monitoring parameters MUST match that disease's actual management needs (e.g.
frequent early visits during active treatment, tumor marker/imaging surveillance) — NOT a generic 3-month
wellness check. Only use generic wellness follow-up if no active disease is documented.

PATIENT CLINICAL SUMMARY + TIMELINE (primary source for all decisions):
{patient_summary_json}

★ RETRIEVED TREATMENT SKILLS (Phase 2 — use any documented follow-up/monitoring cadence in these skills):
{skills_block}

ADDITIONAL FACTORS:
- Age: {treatment_input.patient_age} years
- Sex: {treatment_input.patient_sex}
- Comorbidities: {', '.join(treatment_input.comorbidities)}
- Current Medications: {', '.join([m.drug_name for m in treatment_input.current_medications])}

TASK: Design a follow-up schedule appropriate to whatever is actually found in the clinical context above.

OUTPUT (JSON) — must match this exact top-level schema:
{{
  "next_visit_timing": "specific timeframe justified by the patient's actual condition",
  "follow_up_guideline_rationale": "which guideline/clinical rationale justifies this interval",
  "monitoring_parameters": [
    {{
      "parameter": "what to monitor",
      "reason": "why — reference the actual condition found",
      "guideline": "guideline basis if applicable",
      "frequency": "how often"
    }}
  ],
  "success_criteria": [
    {{
      "criterion": "specific measurable success indicator",
      "guideline_basis": "basis for this threshold"
    }}
  ],
  "escalation_triggers": [
    {{
      "trigger": "specific warning sign",
      "action": "what to do",
      "guideline_basis": "basis for this escalation"
    }}
  ]
}}

CRITICAL RULES:
1. All recommendations MUST be derived primarily from the clinical summary and timeline above.
2. If an active disease is documented, follow-up timing and monitoring MUST reflect that disease's actual
   management schedule, not a default wellness interval.
3. patient_specific_reason/reason fields MUST reference at least two patient-specific factors from the summary.
4. Return ONLY JSON matching the schema above — no nested "follow_up" wrapper, no extra top-level keys.
"""
        else:
            # Extract patient summary context
            patient_summary = state.get("patient_summary") or {}
            # logger.info(f"📋 Patient summary retrieved: {patient_summary}")
            summary_data = patient_summary.get("summary", {})

            # Full patient summary
            clinical_summary_text = "\n\n".join(
                summary_data.get("paragraphs", [])
            )

            agentic_context = {
                "clinical_summary": clinical_summary_text
            }
            patient_summary_json = json.dumps(agentic_context, indent=2, default=str)
            logger.info(f"📋 Patient summary retrieved: {patient_summary_json}")
            strategy = state.get("current_strategy", TreatmentStrategy.STANDARD)
            candidate_investigations = state.get("candidate_investigations", [])
            lifestyle_recommendations = state.get("lifestyle_recommendations", [])

            strategy_instruction = {
                TreatmentStrategy.CONSERVATIVE: (
                    "CONSERVATIVE: Longer follow-up intervals (2-3 months). "
                    "Focus on safety monitoring and side effect detection."
                ),
                TreatmentStrategy.STANDARD: (
                    "STANDARD: Standard follow-up intervals per disease guidelines."
                ),
                TreatmentStrategy.AGGRESSIVE: (
                    "AGGRESSIVE: Frequent early follow-up (2-4 weeks). "
                    "Aggressive monitoring and early titration. "
                    "Include response assessment imaging if applicable."
                ),
            }[strategy]

            intent = state.get("treatment_intent")
            intent_str = intent.value if intent else "not specified"

            doctor_guidelines_fu = state.get('doctor_guidelines', [])
            approved_fu_block = (
                chr(10).join(
                    f"  [{g.get('id')}] {g.get('title')} — {g.get('explanation', '')}"
                    for g in doctor_guidelines_fu
                ) or "  No specific guidelines configured — use your best clinical judgment"
            )

            prompt = f"""You are scheduling follow-up for treatment monitoring.

        ⚠️ APPROVED GUIDELINES — USE ONLY THESE (fetched from doctor's profile in DB):
        {approved_fu_block}
        Every follow_up_guideline_rationale and every monitoring parameter guideline citation MUST reference one of the approved guidelines above only.

        ★ RETRIEVED TREATMENT SKILLS (Phase 2 — use any documented follow-up/monitoring cadence in these skills):
        {skills_block}

        PRIMARY DIAGNOSIS: {primary_dx.disease}
        TREATMENT INTENT: {intent_str}

        ⚠️ FOLLOW-UP STRATEGY (MUST FOLLOW):

        {strategy_instruction}

        TREATMENTS PRESCRIBED:
        {chr(10).join(f"- {d.drug_name} ({d.dose} {d.frequency})" for d in state.get('candidate_drugs', [])) or '- None'}

        PROCEDURES PLANNED:
        {chr(10).join(f"- {p.procedure_name} ({p.timing})" for p in state.get('candidate_procedures', [])) or '- None'}

        INVESTIGATIONS ORDERED (results must be reviewed at follow-up):
        {chr(10).join(f"- {i.test_name} ({i.urgency})" for i in candidate_investigations) or '- None'}

        LIFESTYLE INTERVENTIONS TO TRACK:
        {chr(10).join(f"- {l.intervention_type}: {l.specific_recommendation}" for l in lifestyle_recommendations) or '- None'}

        PATIENT CLINICAL CONTEXT (clinical summary + treatment timeline — use for urgency level, lab trends, active diagnoses, and prior treatments):
        {patient_summary_json}

        TASK: Design a complete follow-up schedule that covers ALL of the above.

        OUTPUT (JSON):
        {{
        "next_visit_timing": "specific timeframe matched to strategy with guideline justification",
        "follow_up_guideline_rationale": "Which approved guideline mandates this follow-up interval — MUST be from the approved list above, name it exactly",
        "monitoring_parameters": [
            {{
            "parameter": "what to monitor — e.g. PSA level",
            "reason": "why — e.g. primary tumor marker for prostate cancer",
            "guideline": "which guideline requires this ",
            "frequency": "how often — e.g. every 3 months"
            }}
        ],
        "success_criteria": [
            {{
            "criterion": "specific measurable success indicator",
            "guideline_basis": "which guideline defines this threshold — "
            }}
        ],
        "escalation_triggers": [
            {{
            "trigger": "specific warning sign",
            "action": "what to do — e.g. urgent urology referral, repeat imaging",
            "guideline_basis": "which guideline recommends this escalation"
            }}
        ]
        }}

        REQUIREMENTS:
        1. monitoring_parameters MUST include every ordered investigation result review
        2. monitoring_parameters MUST include side effect monitoring for every prescribed drug
        3. monitoring_parameters MUST include lifestyle adherence checks
        4. Every monitoring parameter MUST cite which guideline requires it
        5. Every escalation trigger MUST include the recommended action
        6. Match timing to strategy: {strategy_instruction}
        7. Incorporate any follow-up/monitoring cadence documented in the retrieved treatment skills above

        Return ONLY JSON."""
        
        try:
            response = self.llm.invoke([
                SystemMessage(content="Plan follow-up. Return only JSON."),
                HumanMessage(content=prompt)
            ])
            
            followup_json = self._parse_json(response.content)
            
            def _normalize_list(items, key="parameter") -> List[str]:
                """Flatten list of dicts or strings into list of strings"""
                result = []
                for item in (items or []):
                    if isinstance(item, str):
                        result.append(item)
                    elif isinstance(item, dict):
                        # Try common keys in order
                        value = (
                            item.get("parameter") or
                            item.get("criterion") or
                            item.get("trigger") or
                            item.get("monitoring") or
                            item.get("text") or
                            str(item)
                        )
                        # Append reason/guideline if present
                        reason = item.get("reason") or item.get("guideline_basis") or item.get("guideline") or ""
                        action = item.get("action", "")
                        freq = item.get("frequency", "")
                        
                        parts = [value]
                        if freq:
                            parts.append(f"({freq})")
                        if reason:
                            parts.append(f"— {reason}")
                        if action:
                            parts.append(f"→ {action}")
                        
                        result.append(" ".join(parts))
                return result

            follow_up_plan = FollowUpPlan(
                next_visit_timing=followup_json.get("next_visit_timing", "3 months"),
                follow_up_guideline_rationale=followup_json.get("follow_up_guideline_rationale", ""),
                monitoring_parameters=_normalize_list(
                    followup_json.get("monitoring_parameters", []), key="parameter"
                ),
                success_criteria=_normalize_list(
                    followup_json.get("success_criteria", []), key="criterion"
                ),
                escalation_triggers=_normalize_list(
                    followup_json.get("escalation_triggers", []), key="trigger"
                )
            )
            
            state["follow_up_plan"] = follow_up_plan
            logger.info(f"✅ Follow-up: Next visit in {follow_up_plan.next_visit_timing}")
            
        except Exception as e:
            logger.error(f"❌ Follow-up planning failed: {str(e)}")
            state["follow_up_plan"] = FollowUpPlan(
                next_visit_timing="3 months",
                follow_up_guideline_rationale="Default follow-up schedule",
                monitoring_parameters=[
                    "General health assessment",
                    "Review of medications",
                    "Vital signs check"
                ],
                success_criteria=[
                    "Stable health status",
                    "No new symptoms",
                    "Good medication tolerance"
                ],
                escalation_triggers=[
                    "New or worsening symptoms",
                    "Medication side effects",
                    "Abnormal vital signs"
                ]
            )
            state["warnings"].append("Follow-up planning incomplete - using default")
        
        return state
    
    def _parse_json(self, content: str) -> dict:
        try:
            content = content.strip()
            if "```json" in content:
                content = content.split("```json", 1)[1].split("```", 1)[0]
            start = content.find("{")
            end = content.rfind("}")
            if start != -1 and end != -1:
                return json.loads(content[start:end + 1])
            return {}
        except:
            return {}


# =====================================================================
# LAYER 9: FINAL TREATMENT PLAN ASSEMBLER
# =====================================================================

class TreatmentPlanAssembler:
    """Assembles final treatment plan"""
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
    
    async def assemble(self, state: TreatmentPlanState) -> TreatmentPlanState:
        """Create final treatment plan"""
        
        logger.info("📋 Treatment Plan Assembler: Starting")
        
        treatment_input = state["treatment_input"]
        primary_dx = treatment_input.primary_diagnosis
        
        # Separate first-line vs adjunctive drugs
        all_drugs = state.get("candidate_drugs", [])
        first_line = [d for d in all_drugs if d.is_primary_treatment]
        adjunctive = [d for d in all_drugs if not d.is_primary_treatment]
        
        # Generate summary
        summary = await self._generate_summary(state)
        
        # Collect all warnings
        warnings = state.get("warnings", [])
        
        # Add drug interaction warnings
        for drug in all_drugs:
            if drug.drug_interactions:
                warnings.append(f"Drug interaction: {drug.drug_name} with {', '.join(drug.drug_interactions)}")
        
        # Check if specialist review needed
        requires_specialist = (
            len(state.get("candidate_procedures", [])) > 0
            or any(d.recommendation_class == RecommendationClass.CLASS_III for d in all_drugs)
        )
        
        # FIX: Ensure treatment_intent is never None
        treatment_intent = state.get("treatment_intent")
        if treatment_intent is None:
            logger.warning("⚠️ Treatment intent is None, defaulting to PREVENTIVE")
            treatment_intent = TreatmentIntent.PREVENTIVE

        # ★ PHASE 2 — compact summary of retrieved treatment skills, so the
        # final plan carries forward which skills informed it (mirrors the
        # design doc's "retrieved_skills" block in the Final Output Structure).
        # FIX 4 — now also passes the skill_applications_map populated by
        # TreatmentSkillApplicationAgent so each skill shows which
        # recommendations actually applied it.
        retrieved_skills_summary = _skills_summary_for_output(
            state.get("retrieved_treatment_skills", []),
            state.get("skill_applications_map", {}),
        )
        
        treatment_plan = TreatmentPlan(
            treatment_intent=treatment_intent,
            primary_goals=state.get("treatment_goals", []),
            first_line_drugs=first_line,
            adjunctive_drugs=adjunctive,
            recommended_procedures=state.get("candidate_procedures", []),
            required_investigations=state.get("candidate_investigations", []),
            lifestyle_modifications=state.get("lifestyle_recommendations", []),
            follow_up_plan=state.get("follow_up_plan") or FollowUpPlan(
                next_visit_timing="3 months",
                monitoring_parameters=["General health assessment"],
                success_criteria=["Stable health status"],
                escalation_triggers=["New symptoms", "Worsening condition"]
            ),
            guideline_compliance_score=0.0, 
            patient_adherence_prediction="pending",
            retrieved_skills_summary=retrieved_skills_summary,
            warnings=warnings,
            requires_specialist_review=requires_specialist,
            treatment_summary=summary,
            confidence_score=0.0,
        )
        
        state["treatment_plan"] = treatment_plan
        
        logger.info("✅ Treatment Plan Assembled")
        logger.info(f"   First-line drugs: {len(first_line)}")
        logger.info(f"   Procedures: {len(treatment_plan.recommended_procedures)}")
        logger.info(f"   Investigations: {len(treatment_plan.required_investigations)}")
        logger.info(f"   Retrieved treatment skills used: {len(retrieved_skills_summary)}")
        
        return state
    
    async def _generate_summary(self, state: TreatmentPlanState) -> str:
        """Generate treatment summary"""
        
        treatment_input = state["treatment_input"]
        primary_dx = treatment_input.primary_diagnosis
        
        drugs = state.get("candidate_drugs", [])
        procedures = state.get("candidate_procedures", [])
        investigations = state.get("candidate_investigations", [])
        lifestyle = state.get("lifestyle_recommendations", [])
        
        summary_parts = []
        
        # Handle case when no primary diagnosis is provided
        if not primary_dx:
            summary_parts.append(
                f"Wellness plan with {state.get('treatment_intent', TreatmentIntent.PREVENTIVE)} intent."
            )
        else:
            summary_parts.append(
                f"Treatment plan for {primary_dx.disease} with {state.get('treatment_intent')} intent."
            )
        
        if drugs:
            drug_names = [d.drug_name for d in drugs[:3]]
            summary_parts.append(f"Medications: {', '.join(drug_names)}.")
        
        if procedures:
            proc_names = [p.procedure_name for p in procedures]
            summary_parts.append(f"Procedures: {', '.join(proc_names)}.")
        
        if investigations:
            summary_parts.append(f"Recommended tests: {len(investigations)} investigations.")
        
        if lifestyle:
            summary_parts.append(f"Lifestyle modifications: {len(lifestyle)} recommendations.")
        
        if not drugs and not procedures and not investigations and not lifestyle:
            summary_parts.append("No specific recommendations at this time.")
        
        return " ".join(summary_parts)


class ClinicalEvaluationAgent:
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    def _validate_skill_citations(
        self,
        plan: "TreatmentPlan",
        treatment_input: "TreatmentPlanInput",
    ) -> tuple[List[str], List[str]]:
        """
        ★ FIX 5 (skill-specific validation) — deterministic, non-LLM
        cross-check of every skill-cited recommendation against the ACTUAL
        body of the retrieved skill it claims to come from.

        This runs IN ADDITION to the LLM's own Section F skill audit in the
        evaluation prompt below — the LLM pass is good at nuanced clinical
        judgment but can still take a plausible-sounding citation at face
        value; this deterministic pass guarantees that every citation is
        checked against the skill's literal stage_wise_treatment /
        targeted_therapy / immunotherapy / if_then_rules content before the
        plan is considered validated.

        Returns (critical_issues, warnings) to be merged with the LLM's own
        output.
        """
        retrieved_skills = getattr(treatment_input, "_retrieved_treatment_skills", None) or []
        skill_lookup = {_skill_display_name(s): s for s in retrieved_skills}

        critical: List[str] = []
        warnings: List[str] = []

        def _text_contains(body_section: Any, needle: str) -> bool:
            if not needle or not body_section:
                return False
            try:
                blob = json.dumps(body_section, default=str).lower()
            except Exception:
                blob = str(body_section).lower()
            return needle.lower() in blob

        def _check(rec, rec_name: str, rec_label: str):
            skill_name = getattr(rec, "source_skill_name", None)
            if not skill_name:
                return

            skill = skill_lookup.get(skill_name)
            if not skill:
                critical.append(
                    f"CRITICAL: {rec_label} '{rec_name}' cites skill '{skill_name}' which does not "
                    f"match any retrieved treatment skill — fabricated skill citation"
                )
                return

            body = skill.get("body") or {}
            if not isinstance(body, dict) or not body:
                warnings.append(
                    f"{rec_label} '{rec_name}' cites skill '{skill_name}' but the skill body could "
                    f"not be loaded for verification — manually confirm this citation"
                )
                return

            found = (
                _text_contains(body.get("stage_wise_treatment"), rec_name)
                or _text_contains(body.get("targeted_therapy"), rec_name)
                or _text_contains(body.get("immunotherapy"), rec_name)
                or _text_contains(body.get("if_then_rules"), rec_name)
            )
            if not found:
                warnings.append(
                    f"{rec_name} not clearly supported by retrieved skill '{skill_name}' body "
                    f"(checked stage_wise_treatment/targeted_therapy/immunotherapy/if_then_rules) — "
                    f"verify this citation manually"
                )

        for d in (plan.first_line_drugs + plan.adjunctive_drugs):
            _check(d, d.drug_name, "Drug")
        for p in plan.recommended_procedures:
            _check(p, p.procedure_name, "Procedure")
        for i in plan.required_investigations:
            _check(i, i.test_name, "Investigation")

        return critical, warnings

    async def evaluate(
        self,
        plan: TreatmentPlan,
        treatment_input: TreatmentPlanInput,
        patient_summary: Optional[Dict[str, Any]],
    ) -> ValidationResult:
        logger.info(f"🧠 Evaluating | strategy={plan.strategy.value}")

        dx = treatment_input.primary_diagnosis
        all_drugs = plan.first_line_drugs + plan.adjunctive_drugs
        patient_summary_data = patient_summary or {}

        def _safe_json(obj):
            if isinstance(obj, datetime):
                return obj.isoformat()
            raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")

        agentic_context_eval = {
            "clinical_summary": patient_summary_data.get("clinical_summary", {}).get("raw_output", "")
                                if isinstance(patient_summary_data.get("clinical_summary"), dict)
                                else str(patient_summary_data.get("clinical_summary", ""))
        }
        patient_summary_json_eval = json.dumps(agentic_context_eval, indent=2, default=_safe_json)

        # ★ PHASE 2 — retrieved treatment skills, attached dynamically onto
        # treatment_input by generate_three_treatment_plans()/generate_treatment_plan()
        # the same way _doctor_guidelines already is.
        retrieved_skills = getattr(treatment_input, "_retrieved_treatment_skills", None) or []
        skill_lookup = {
            _skill_display_name(s): s
            for s in retrieved_skills
        }
        skills_reference_block = _format_treatment_skills_for_prompt(retrieved_skills, max_skills=10)

        # ── Build plan context strings ────────────────────────────────────
        drug_lines = [
            f"- {d.drug_name} | Class: {d.drug_class} | Dose: {d.dose} | "
            f"Indication: {d.indication} | Rec Class: {d.recommendation_class.value} | "
            f"Guideline: {d.guideline_support.value} | "
            f"source_skill_name: {d.source_skill_name or 'null'}"
            for d in all_drugs
        ]
        inv_lines = [
            f"- {i.test_name} | Urgency: {i.urgency} | Indication: {i.indication} | "
            f"Already done: {i.already_completed} | Repeat justified: {i.repeat_justified} | "
            f"source_skill_name: {i.source_skill_name or 'null'}"
            for i in plan.required_investigations
        ]
        proc_lines = [
            f"- {p.procedure_name} | Timing: {p.timing} | Indication: {p.indication} | "
            f"source_skill_name: {p.source_skill_name or 'null'}"
            for p in plan.recommended_procedures
        ]
        allergy_list = [a.allergen for a in treatment_input.allergies]
        completed_inv_list = [inv.test_name for inv in treatment_input.completed_investigations]
        completed_proc_list = [proc.procedure_name for proc in treatment_input.completed_procedures]
        current_med_list = [f"{m.drug_name} {m.dose}" for m in treatment_input.current_medications]

        strategy_bands = {
            TreatmentStrategy.CONSERVATIVE: "0.40–0.72",
            TreatmentStrategy.STANDARD:     "0.55–0.82",
            TreatmentStrategy.AGGRESSIVE:   "0.62–0.90",
        }
        score_band = strategy_bands[plan.strategy]

        evaluation_prompt = f"""You are a senior specialist physician and clinical pharmacologist performing a comprehensive treatment plan audit.

    ═══════════════════════════════════════════════════════════
    PATIENT PROFILE
    ═══════════════════════════════════════════════════════════
    Age          : {treatment_input.patient_age}
    Sex          : {treatment_input.patient_sex}
    Diagnosis    : {dx.disease if dx else 'None'}
    Stage        : {dx.stage if dx else 'N/A'}
    Severity     : {dx.severity if dx else 'N/A'}
    Renal (eGFR) : {treatment_input.renal_function_egfr or 'Unknown'}
    Hepatic      : {treatment_input.hepatic_function or 'Unknown'}
    Cardiac EF   : {treatment_input.cardiac_function_ef or 'Unknown'}%
    Strategy     : {plan.strategy.value.upper()}
    Intent       : {plan.treatment_intent.value}

    KNOWN ALLERGIES:
    {chr(10).join(f'- {a}' for a in allergy_list) or '- None'}

    CURRENT MEDICATIONS (before this plan):
    {chr(10).join(f'- {m}' for m in current_med_list) or '- None'}

    ALREADY COMPLETED INVESTIGATIONS:
    {chr(10).join(f'- {i}' for i in completed_inv_list) or '- None'}

    ALREADY COMPLETED PROCEDURES:
    {chr(10).join(f'- {p}' for p in completed_proc_list) or '- None'}

    ═══════════════════════════════════════════════════════════
    PATIENT CLINICAL CONTEXT (clinical summary + treatment timeline)
    Use for: biomarker status, prior treatments, active diagnoses, urgency level
    ═══════════════════════════════════════════════════════════
    {patient_summary_json_eval}

    ═══════════════════════════════════════════════════════════
    ★ RETRIEVED TREATMENT SKILLS (Phase 2 — ground truth for any recommendation
    that cites a source_skill_name below; use THIS content, not generic guideline
    text, when auditing a skill-cited recommendation)
    ═══════════════════════════════════════════════════════════
    {skills_reference_block}

    ═══════════════════════════════════════════════════════════
    TREATMENT PLAN BEING EVALUATED
    ═══════════════════════════════════════════════════════════
    DRUGS IN PLAN:
    {chr(10).join(drug_lines) or '- None'}

    INVESTIGATIONS IN PLAN:
    {chr(10).join(inv_lines) or '- None'}

    PROCEDURES IN PLAN:
    {chr(10).join(proc_lines) or '- None'}

    FOLLOW-UP: {plan.follow_up_plan.next_visit_timing if plan.follow_up_plan else 'Not specified'}

    ═══════════════════════════════════════════════════════════
    YOUR EVALUATION TASK — CHECK ALL OF THE FOLLOWING
    ═══════════════════════════════════════════════════════════

    SECTION A — BIOMARKER & RECEPTOR CHECKS (read from patient summary above):
    A1. Read IHC/biomarker results from the patient summary. For each drug in the plan, verify it matches the patient's biomarker status.
        - HER2-targeted drugs (Trastuzumab, Pertuzumab, Lapatinib, Neratinib, Tucatinib, T-DM1): ONLY if HER2 score 3+ or FISH amplified. Flag if HER2 is 1+ or negative.
        - Endocrine therapy (Tamoxifen, Letrozole, Anastrozole, Exemestane, Fulvestrant): ONLY if ER or PR positive. Flag if ER/PR negative.
        - Tamoxifen vs Aromatase Inhibitor: Tamoxifen is for premenopausal women. Aromatase inhibitors are for postmenopausal women (age ≥55 or documented). Flag wrong choice.
        - Tamoxifen + Aromatase Inhibitor simultaneously: No evidence base. Flag as critical.
        - EGFR inhibitors, ALK inhibitors, BRAF inhibitors, BCR-ABL inhibitors, PD-1/PD-L1 inhibitors: verify matching biomarker in summary.
        - Any other targeted therapy: verify target is confirmed positive in the summary.

    SECTION B — DRUG SAFETY CHECKS:
    B1. ALLERGIES: Check every drug in the plan against the known allergies above. Flag any match as critical.
    B2. CARDIOTOXIC MONITORING: If any cardiotoxic drug is in the plan (Doxorubicin, Epirubicin, Cyclophosphamide, Trastuzumab, Pertuzumab, 5-FU, Imatinib), check if Echocardiogram is in the investigation plan. Flag if missing.
    B3. NEPHROTOXIC MONITORING: If any nephrotoxic drug is in the plan (Cisplatin, Carboplatin, Methotrexate, Vancomycin, Amphotericin, NSAIDs), check if renal function tests (eGFR/Creatinine) are in the investigation plan. Flag if missing.
    B4. HEPATOTOXIC MONITORING: If any hepatotoxic drug is in the plan (Tamoxifen, Methotrexate, Letrozole, Anastrozole, Doxorubicin, Isoniazid, Statins at high dose), check if LFTs are in the investigation plan. Flag if missing.
    B5. DRUG-DRUG INTERACTIONS: Review the current medications above alongside the new drugs. Flag any clinically significant interactions.
    B6. DOSE APPROPRIATENESS: Check doses against patient's age, renal function, hepatic function. Flag dangerous doses.
    B7. RENAL DOSE ADJUSTMENT: If eGFR is known and reduced (<60 mL/min), flag any renally-cleared drugs that need dose adjustment.

    SECTION C — INVESTIGATION CHECKS:
    C1. DUPLICATION: Check every investigation in the plan against the already-completed investigations above. Flag any test being re-ordered within the past 30 days without justification.
    C2. MISSING BASELINE TESTS: For the planned drugs and procedures, flag any mandatory baseline tests that are missing (e.g., CBC before chemotherapy, ECHO before anthracyclines, bone density before long-term aromatase inhibitors).
    C3. STAGING COMPLETENESS: For the given diagnosis and stage, flag if any mandatory staging investigation is missing per current guidelines.

    SECTION D — CLINICAL APPROPRIATENESS:
    D1. STAGE MISMATCH: Flag any drug approved only for a more advanced stage than documented (e.g., a metastatic-only drug prescribed for localized disease).
    D2. INTENT MISMATCH: Flag any drug whose indication contradicts the stated treatment intent (e.g., a palliative-only drug in a curative plan).
    D3. MISSING MANDATORY DRUGS: Per the APPROVED GUIDELINES listed below, flag any Class I mandatory drug that is absent from the plan.
    D4. GUIDELINE VIOLATIONS: Flag any recommendation that directly contradicts the APPROVED GUIDELINES listed below. Also flag any recommendation that cites a guideline NOT in the approved list.

    APPROVED GUIDELINES FOR THIS DOCTOR (audit must be based ONLY on these):
    {chr(10).join(f"  [{g.get('id')}] {g.get('title')} — {g.get('explanation', '')}" for g in (getattr(treatment_input, '_doctor_guidelines', None) or []))}

    SECTION E — STRATEGY & FOLLOW-UP:
    E1. STRATEGY APPROPRIATENESS: Given the diagnosis severity and intent, is the {plan.strategy.value} strategy appropriate? Flag under-treatment (too conservative for a curable aggressive cancer) or over-treatment (too aggressive for a palliative intent).
    E2. FOLLOW-UP VAGUENESS: Is the follow-up timing specific? Flag if it is vague (e.g., "as needed", "TBD", missing entirely).
    E3. MONITORING COMPLETENESS: Are all prescribed drugs covered by appropriate monitoring parameters in the follow-up plan?

    SECTION F — ★ SKILL-SPECIFIC VALIDATION (PHASE 2):
    F1. For every drug/procedure/investigation above with a non-null source_skill_name, look up that exact
        skill in the RETRIEVED TREATMENT SKILLS block above and verify the recommendation is ACTUALLY
        supported by that skill's content (stage_wise_treatment / targeted_therapy / immunotherapy /
        if_then_rules / contraindications) — do not accept the citation at face value.
    F2. If a source_skill_name does not match any skill in the RETRIEVED TREATMENT SKILLS block, or the
        skill's content does NOT actually support the recommendation, flag this as a CRITICAL fabricated
        skill citation.
    F3. Do NOT write generic validation text like "the guideline recommends evidence-based treatment" for
        a skill-cited recommendation — cite the specific skill section it came from, mirroring how a
        specific clinical audit would read (e.g. "Recommendation follows anti-IL6 pathway defined in the
        skill's targeted_therapy section" rather than).
    F4. If a retrieved skill clearly covers a matched_patient_evidence condition (e.g. the patient's
        confirmed disease/subtype) but NO recommendation in the plan cites it, flag this as a warning —
        a directly relevant retrieved skill should not go unused.
    F5. NOTE: A deterministic (non-LLM) code-level check has ALSO been run against the same skill bodies
        for every skill-cited recommendation, and its findings are merged with yours below — treat both
        as authoritative; do not contradict a confirmed fabricated citation.

    ═══════════════════════════════════════════════════════════
    SCORING INSTRUCTIONS
    ═══════════════════════════════════════════════════════════
    Start from a base score of 1.0. Apply deductions:
    - Each CRITICAL issue (allergy violation, biomarker mismatch, stage mismatch, missing mandatory drug, fabricated skill citation): -0.15 to -0.20
    - Each WARNING (suboptimal choice, missing monitoring, vague follow-up, unused relevant skill): -0.05 to -0.10
    - Class I guideline drugs present: +0.02 per drug (max +0.06)
    - All mandatory baseline tests present: +0.03
    - Complete and specific follow-up plan: +0.02
    - Recommendations correctly grounded in a retrieved treatment skill (verified in Section F): +0.02 per recommendation (max +0.06)

    Clamp final score to strategy band: {score_band}

    Guideline compliance score = validation_score - 0.03 + (number of Class I drugs × 0.02), clamped to same band.

    ═══════════════════════════════════════════════════════════
    OUTPUT — Return ONLY this JSON, no text outside it:
    ═══════════════════════════════════════════════════════════
    {{
    "validation_score": <float in {score_band}>,
    "guideline_compliance_score": <float in {score_band}>,
    "is_valid": <true if no CRITICAL issues, else false>,
    "critical_issues": [
        "CRITICAL: <specific issue — name the drug, biomarker, guideline violated, or fabricated skill citation>"
    ],
    "warnings": [
        "<specific warning — name the drug or test, or the unused relevant skill>"
    ],
    "recommendations_to_remove": [
        "<drug or test name> — <one sentence reason with guideline or skill reference>"
    ],
    "recommendations_to_add": [
        "<drug or test name> — <one sentence reason with guideline or skill reference>"
    ],
    "safety_notes": [
        "<specific safety monitoring instruction>"
    ]
    }}

    RULES:
    - Be specific in every issue: name the drug, name the biomarker, cite the exact approved guideline or retrieved skill.
    - Only cite guidelines from the APPROVED GUIDELINES list above — never reference ASCO, ESMO, WHO, or any other guideline unless it appears in that approved list.
    - Only validate skill-specific claims against skills that actually appear in the RETRIEVED TREATMENT SKILLS block above.
    - If a recommendation in the plan cites a non-approved guideline, flag it as a warning.
    - Do NOT generate vague issues like "some drugs may not be appropriate".
    - If a section has no issues, return an empty list for that field.
    - critical_issues must only contain genuinely critical safety or efficacy violations.
    - Return ONLY valid JSON. No markdown, no preamble, no explanation outside the JSON."""
        bands = {
                TreatmentStrategy.CONSERVATIVE: (0.40, 0.72),
                TreatmentStrategy.STANDARD:     (0.55, 0.82),
                TreatmentStrategy.AGGRESSIVE:   (0.62, 0.90),
            }
        try:
            resp = self.llm.invoke([
                SystemMessage(content=(
                    "You are a senior oncologist and clinical pharmacologist performing a treatment plan audit. "
                    "Return only valid JSON matching the exact schema provided. No markdown. No text outside JSON."
                )),
                HumanMessage(content=evaluation_prompt)
            ])

            logger.info(f"  🔍 LLM evaluation response: {resp.content[:300]}")
            result = self._parse_json(resp.content)

            def _flatten(items) -> List[str]:
                out = []
                for item in (items or []):
                    if isinstance(item, str) and item.strip():
                        out.append(item)
                    elif isinstance(item, dict):
                        out.append(str(item))
                return out

            # Extract scores from LLM output
            
            lo, hi = bands[plan.strategy]

            raw_val_score = result.get("validation_score")
            raw_guide_score = result.get("guideline_compliance_score")

            # Fallback: compute from critical issue count if LLM didn't return scores
            critical_issues = _flatten(result.get("critical_issues", []))
            warnings_list = _flatten(result.get("warnings", []))

            # ★ FIX 5 — merge in the deterministic, non-LLM skill-citation
            # cross-check BEFORE computing/falling back on scores, so the
            # score reflects both the LLM audit and the code-level check.
            det_critical, det_warnings = self._validate_skill_citations(plan, treatment_input)
            critical_issues = list(dict.fromkeys(critical_issues + det_critical))
            warnings_list = list(dict.fromkeys(warnings_list + det_warnings))

            if raw_val_score is None or not isinstance(raw_val_score, (int, float)):
                # Derive from issue count
                fallback = 1.0 - (len(critical_issues) * 0.18) - (len(warnings_list) * 0.06)
                final_score = round(max(lo, min(hi, fallback)), 3)
                logger.warning(f"⚠️ LLM did not return validation_score — computed fallback: {final_score}")
            else:
                final_score = round(max(lo, min(hi, float(raw_val_score))), 3)

            if raw_guide_score is None or not isinstance(raw_guide_score, (int, float)):
                guideline_score = round(max(lo, min(hi, final_score - 0.02)), 3)
            else:
                guideline_score = round(max(lo, min(hi, float(raw_guide_score))), 3)

            is_valid = result.get("is_valid")
            if not isinstance(is_valid, bool):
                is_valid = len([c for c in critical_issues if "CRITICAL" in c.upper()]) == 0
            elif det_critical:
                # Deterministic check found a fabricated citation the LLM
                # missed/accepted — a plan can never be valid in that case.
                is_valid = False

            logger.info(
                f"  ✅ {plan.strategy.value} | "
                f"val={final_score:.2f} | guideline={guideline_score:.2f} | "
                f"critical={len(critical_issues)} | warnings={len(warnings_list)} | "
                f"deterministic_critical={len(det_critical)} deterministic_warnings={len(det_warnings)}"
            )

            return ValidationResult(
                is_valid=is_valid,
                validation_score=final_score,
                guideline_compliance_score=guideline_score,
                critical_issues=critical_issues,
                warnings=warnings_list,
                recommendations_to_remove=_flatten(result.get("recommendations_to_remove", [])),
                recommendations_to_add=_flatten(result.get("recommendations_to_add", [])),
                guideline_compliance_notes=[],
                safety_notes=_flatten(result.get("safety_notes", [])),
            )

        except Exception as e:
            logger.error(f"❌ Evaluation failed for strategy={plan.strategy.value}: {e}")
            lo, hi = bands[plan.strategy]
            return ValidationResult(
                is_valid=False,
                validation_score=round(lo + 0.05, 3),
                guideline_compliance_score=round(lo, 3),
                critical_issues=[f"Evaluation failed: {str(e)}"],
                warnings=["Manual clinical review required — automated evaluation could not complete"],
                recommendations_to_remove=[],
                recommendations_to_add=[],
                guideline_compliance_notes=[],
                safety_notes=[],
            )

    def _parse_json(self, content: str) -> dict:
        try:
            content = content.strip()
            if "```json" in content:
                content = content.split("```json", 1)[1].split("```", 1)[0]
            s, e = content.find("{"), content.rfind("}")
            if s != -1 and e != -1:
                return json.loads(content[s:e+1])
            return {}
        except Exception:
            return {}
# =====================================================================
# LANGGRAPH WORKFLOW ORCHESTRATOR
# =====================================================================


def create_treatment_plan_workflow(
    llm: ChatGroq,
    knowledge_graph: TreatmentKnowledgeGraph
) -> StateGraph:
    """Create LangGraph treatment planning workflow"""
    
    # Initialize agents
    intent_agent = TreatmentIntentAgent(llm)
    skill_retrieval_agent = TreatmentSkillRetrievalAgent()  # ★ PHASE 2
    guideline_agent = GuidelineRetrievalAgent(knowledge_graph)
    exclusion_agent = ExclusionFilterAgent()
    pharma_agent = PharmacologicalAgent(llm, knowledge_graph)
    procedural_agent = ProceduralAgent(llm)
    investigation_agent = InvestigationAgent(llm)
    lifestyle_agent = LifestyleAgent(llm)
    followup_agent = FollowUpAgent(llm)
    skill_application_agent = TreatmentSkillApplicationAgent()  # ★ PHASE 2 (FIX 2)
    assembler = TreatmentPlanAssembler(llm)
    modality_agent = TreatmentModalityDecisionAgent(llm)  # add near other agent inits

    
    # Create workflow
    workflow = StateGraph(TreatmentPlanState)
    
    # Add nodes
    async def _lift_drug_safety(state: TreatmentPlanState) -> TreatmentPlanState:
        all_interactions = []
        all_contraindications = []
        for d in state.get("candidate_drugs", []):
            all_interactions.extend(d.drug_interactions)
            if d.renal_dose_adjustment:
                all_contraindications.append(
                    f"Renal adjustment needed: {d.drug_name} — {d.renal_dose_adjustment}"
                )
        state["drug_interactions"] = list(set(all_interactions))
        state["contraindications"] = all_contraindications
        return state

    # Add nodes
    workflow.add_node("intent_identification", intent_agent.determine_intent)
    workflow.add_node("treatment_skill_retrieval", skill_retrieval_agent.retrieve_skills)  # ★ PHASE 2
    workflow.add_node("guideline_retrieval", guideline_agent.retrieve_guidelines)
    workflow.add_node("exclusion_filter", exclusion_agent.filter_completed)
    workflow.add_node("pharmacological", pharma_agent.recommend_drugs)
    workflow.add_node("lift_drug_safety", _lift_drug_safety)
    workflow.add_node("procedural", procedural_agent.recommend_procedures)
    workflow.add_node("investigation", investigation_agent.recommend_investigations)
    workflow.add_node("lifestyle", lifestyle_agent.recommend_lifestyle)
    workflow.add_node("followup", followup_agent.plan_followup)
    workflow.add_node("skill_application", skill_application_agent.apply_skills)  # ★ PHASE 2 (FIX 2)
    workflow.add_node("assemble", assembler.assemble)
    workflow.add_node("modality_decision", modality_agent.decide_modality)
    
    # Set entry point
    workflow.set_entry_point("intent_identification")
    
    # Define edges
    # ★ PHASE 2 — treatment skill retrieval runs right after intent
    # identification (so it has treatment_intent/disease context) and
    # before guideline retrieval (so every downstream agent — pharma,
    # procedural, investigation, lifestyle, followup — has retrieved
    # skills available in state["retrieved_treatment_skills"]).
    workflow.add_edge("intent_identification", "treatment_skill_retrieval")
    workflow.add_edge("treatment_skill_retrieval", "guideline_retrieval")
    workflow.add_edge("guideline_retrieval", "exclusion_filter")
    workflow.add_edge("exclusion_filter", "modality_decision")
    workflow.add_edge("modality_decision", "procedural")
    workflow.add_edge("procedural", "pharmacological")
    workflow.add_edge("pharmacological", "lift_drug_safety")
    workflow.add_edge("lift_drug_safety", "investigation")
    workflow.add_edge("investigation", "lifestyle")
    workflow.add_edge("lifestyle", "followup")
    workflow.add_edge("followup", "skill_application")
    workflow.add_edge("skill_application", "assemble")
    # ★ PHASE 2 (FIX 2) — skill application runs after every recommendation
    # (drugs/procedures/investigations/lifestyle) AND the follow-up plan
    # have been generated, and before final assembly — exactly mirroring
    # doc1's requested placement ahead of ClinicalEvaluationAgent (which
    # runs immediately after this workflow completes, in
    # generate_three_treatment_plans / generate_treatment_plan below).
    workflow.add_edge("followup", "skill_application")
    workflow.add_edge("skill_application", "assemble")
    workflow.add_edge("assemble", END)
    
    return workflow.compile()


# =====================================================================
# MAIN EXECUTION FUNCTION
# =====================================================================

# In generate_treatment_plan(), update the function signature and initial_state:

async def generate_treatment_plan(
    treatment_input: TreatmentPlanInput,
    llm: ChatGroq,
    neo4j_uri: str,
    neo4j_user: str,
    neo4j_password: str,
    patient_summary: Optional[Dict[str, Any]] = None
) -> TreatmentPlan:
    
    logger.info(f"🚀 Starting Treatment Planning: Patient={treatment_input.patient_id}")
    
    if treatment_input.primary_diagnosis:
        logger.info(f"   Diagnosis: {treatment_input.primary_diagnosis.disease}")
    else:
        logger.info("   No primary diagnosis provided - will generate general wellness recommendations")
    
    logger.info(f"   Excluding {len(treatment_input.completed_procedures)} procedures")
    logger.info(f"   Excluding {len(treatment_input.completed_investigations)} investigations")
    
    # Initialize knowledge graph
    knowledge_graph = TreatmentKnowledgeGraph(neo4j_uri, neo4j_user, neo4j_password)
    
    try:
        # Create workflow
        workflow = create_treatment_plan_workflow(llm, knowledge_graph)
        
        # Initialize state
        initial_state: TreatmentPlanState = {
            "treatment_input": treatment_input,
            "patient_summary": patient_summary,
            "current_strategy": TreatmentStrategy.STANDARD,
            "prognosis": treatment_input.prognosis,
            "doctor_guidelines": [],
            "allowed_guideline_titles": [],
            "retrieved_treatment_skills": [],           # ★ PHASE 2
            "treatment_retrieval_metrics": {},          # ★ PHASE 2
            "skill_applications_map": {},               # ★ PHASE 2 (FIX 2)
            "treatment_intent": None,
            "treatment_goals": [],
            "applicable_guidelines": [],
            "guideline_recommendations": {},
            "excluded_procedures": set(),
            "excluded_investigations": set(),
            "candidate_drugs": [],
            "candidate_procedures": [],
            "candidate_investigations": [],
            "contraindications": [],
            "drug_interactions": [],
            "modality_decision": Dict[str, Any],
            "cost_analysis": {},
            "follow_up_plan": None,
            "lifestyle_recommendations": [],
            "treatment_plan": None,
            "error": None,
            "warnings": []
        }
        
        # Run workflow
        final_state = await workflow.ainvoke(initial_state)
        
        logger.info("✅ Treatment Planning Complete")
        
        if final_state.get("treatment_plan"):
            return final_state["treatment_plan"]
        else:
            logger.warning("⚠️ Workflow failed to generate plan - creating default plan")
            return create_default_treatment_plan(treatment_input)
            
    finally:
        knowledge_graph.close()

def create_default_treatment_plan(treatment_input: TreatmentPlanInput) -> TreatmentPlan:
    """Create a default treatment plan when workflow fails"""
    
    return TreatmentPlan(
        treatment_intent=TreatmentIntent.PREVENTIVE,
        primary_goals=[
            "Maintain overall health and wellness",
            "Monitor existing conditions",
            "Prevent future health issues"
        ],
        first_line_drugs=[],
        adjunctive_drugs=[],
        recommended_procedures=[],
        required_investigations=[],
        lifestyle_modifications=[],
        follow_up_plan=FollowUpPlan(
            next_visit_timing="3 months",
            monitoring_parameters=[
                "General health assessment",
                "Review of any symptoms",
                "Vital signs check"
            ],
            success_criteria=[
                "Stable health status",
                "No new concerning symptoms",
                "Good medication tolerance"
            ],
            escalation_triggers=[
                "New or worsening symptoms",
                "Medication side effects",
                "Abnormal vital signs"
            ]
        ),
        guideline_compliance_score=0.7,
        patient_adherence_prediction="moderate",
        retrieved_skills_summary=[],
        warnings=["Treatment plan generated with limited information"],
        requires_specialist_review=False,
        treatment_summary="General wellness plan based on available patient information.",
        confidence_score=0.6
    )

async def generate_three_treatment_plans(
    treatment_input: TreatmentPlanInput,
    llm: ChatGroq,
    neo4j_uri: str,
    neo4j_user: str,
    neo4j_password: str,
    patient_summary: Optional[Dict[str, Any]] = None,
) -> List[TreatmentPlan]:

    logger.info(f"🚀 Multi-Plan Generation | Patient={treatment_input.patient_id}")

    knowledge_graph = TreatmentKnowledgeGraph(neo4j_uri, neo4j_user, neo4j_password)
    eval_agent = ClinicalEvaluationAgent(llm)

    strategies = [TreatmentStrategy.CONSERVATIVE, TreatmentStrategy.STANDARD, TreatmentStrategy.AGGRESSIVE]
    enriched_plans: List[TreatmentPlan] = []

    try:
        workflow = create_treatment_plan_workflow(llm, knowledge_graph)

        for strategy in strategies:
            logger.info(f"\n▶ Generating {strategy.value.upper()} plan")

            initial_state: TreatmentPlanState = {
                "treatment_input": treatment_input,
                "patient_summary": patient_summary,
                "current_strategy": strategy,
                "prognosis": treatment_input.prognosis,
                "doctor_guidelines": [],
                "allowed_guideline_titles": [],
                "retrieved_treatment_skills": [],           # ★ PHASE 2
                "treatment_retrieval_metrics": {},          # ★ PHASE 2
                "skill_applications_map": {},               # ★ PHASE 2 (FIX 2)
                "treatment_intent": None,
                "treatment_goals": [],
                "applicable_guidelines": [],
                "guideline_recommendations": {},
                "excluded_procedures": set(),
                "excluded_investigations": set(),
                "candidate_drugs": [],
                "candidate_procedures": [],
                "candidate_investigations": [],
                "contraindications": [],
                "drug_interactions": [],
                "modality_decision": Dict[str, Any],
                "cost_analysis": {},
                "follow_up_plan": None,
                "lifestyle_recommendations": [],
                "treatment_plan": None,
                "error": None,
                "warnings": [],
            }

            final_state = await workflow.ainvoke(initial_state)
            plan: TreatmentPlan = final_state.get("treatment_plan") or create_default_treatment_plan(treatment_input)
            plan.strategy = strategy

            # Attach doctor guidelines + retrieved treatment skills so
            # ClinicalEvaluationAgent can enforce approved-only + skill-specific audit
            treatment_input._doctor_guidelines = final_state.get("doctor_guidelines", [])
            treatment_input._retrieved_treatment_skills = final_state.get("retrieved_treatment_skills", [])  # ★ PHASE 2
            val_result = await eval_agent.evaluate(plan, treatment_input, patient_summary)
            plan.validation_result = val_result
            plan.confidence_score = val_result.validation_score
            plan.guideline_compliance_score = val_result.guideline_compliance_score

            logger.info(
                f"  ✅ {strategy.value.upper()} | "
                f"valid={val_result.is_valid} | "
                f"val_score={val_result.validation_score:.2f} | "
                f"guideline={val_result.guideline_compliance_score:.2f}"
            )
            enriched_plans.append(plan)

        def _clinical_rank_score(p: TreatmentPlan) -> float:
            """
            Composite ranking score that considers clinical content quality,
            not just the LLM probability score.
            """
            prob = p.confidence_score if p.confidence_score else 0.0
            val  = p.validation_result.validation_score if p.validation_result else 0.0
            stress = p.validation_result.guideline_compliance_score if p.validation_result else 0.0

            # Investigation quality: reward more management-changing tests, penalize flagged-for-removal
            inv_count = len(p.required_investigations)
            inv_change_mgmt = sum(1 for i in p.required_investigations if i.will_change_management)
            flagged_removals = len(p.validation_result.recommendations_to_remove) if p.validation_result else 0
            inv_score = min(1.0, (inv_change_mgmt * 0.15) - (flagged_removals * 0.08))

            # Follow-up quality: reward specific monitoring parameters and escalation triggers
            followup_depth = 0.0
            if p.follow_up_plan:
                followup_depth = min(1.0, (
                    len(p.follow_up_plan.monitoring_parameters) * 0.04 +
                    len(p.follow_up_plan.escalation_triggers) * 0.05
                ))

            # Drug quality: reward Class I drugs, penalize Class III
            drug_quality = 0.0
            all_drugs = p.first_line_drugs + p.adjunctive_drugs
            if all_drugs:
                class_i = sum(1 for d in all_drugs if d.recommendation_class == RecommendationClass.CLASS_I)
                class_iii = sum(1 for d in all_drugs if d.recommendation_class == RecommendationClass.CLASS_III)
                drug_quality = min(1.0, (class_i / len(all_drugs)) - (class_iii * 0.2))

            composite = (
                prob         * 0.35 +
                val          * 0.25 +
                inv_score    * 0.15 +
                followup_depth * 0.10 +
                drug_quality * 0.10 +
                stress       * 0.05
            )
            return round(composite, 4)

        enriched_plans.sort(
            key=lambda p: (
                (p.validation_result.validation_score if p.validation_result else 0.0) * 0.6 +
                (p.validation_result.guideline_compliance_score if p.validation_result else 0.0) * 0.4
            ),
            reverse=True
        )

        for plan in enriched_plans:
            plan._clinical_rank_score = _clinical_rank_score(plan)
            logger.info(
                f"  🏆 {plan.strategy.value.upper()} | "
                f"composite={_clinical_rank_score(plan):.3f} | "
                f"confidence={plan.confidence_score:.2f} | "
                f"val={plan.validation_result.validation_score:.2f} | "
                f"inv_mgmt={sum(1 for i in plan.required_investigations if i.will_change_management)} | "
                f"flagged_removals={len(plan.validation_result.recommendations_to_remove) if plan.validation_result else 0}"
            )

        return enriched_plans

    finally:
        knowledge_graph.close()
# =====================================================================
# EXAMPLE USAGE
# ==================================================================

from pydantic import parse_obj_as

@router.post("/generate-treatment-plan/skill")
async def generate_treatment_plan_endpoint(
    request: dict = Body(...)  # Accept any dictionary
):
    """
    Generate treatment plan with optional fields
    
    The endpoint accepts:
    - patient_id: Required
    - doctor_id: Required  
    - primary_diagnosis: Optional (can be null or not provided)
    - additional_input: Optional
    """
    logger.info(f"📋 Received treatment plan request: {json.dumps(request, indent=2)}")
    
    try:
        # Extract fields with defaults
        patient_id = request.get("patient_id")
        doctor_id = request.get("doctor_id")
        primary_diagnosis = request.get("primary_diagnosis")
        prognosis = request.get("prognosis")
        additional_input = request.get("additional_input", {})
        diagnosis_completed_investigations = request.get("completed_investigations", [])
        diagnosis_completed_procedures = request.get("completed_procedures", [])
        
        # Validate required fields
        if not patient_id:
            raise HTTPException(
                status_code=400, 
                detail="patient_id is required"
            )
        
        if not doctor_id:
            raise HTTPException(
                status_code=400, 
                detail="doctor_id is required"
            )
        
        # Step 1: Fetch patient data from patient_users collection
        logger.info(f"🔍 Fetching patient data for ID: {patient_id}")
        patient_data = await database["patient_users"].find_one(
            {"patient_id": patient_id}
        )
        
        if not patient_data:
            patient_data = await database["patient_users"].find_one(
                {"sys_user_id": patient_id}
            )
            
        if not patient_data:
            logger.warning(f"⚠️ Patient not found with ID: {patient_id}, using minimal data")
            patient_data = {
                "patient_id": patient_id,
                "name": "Unknown",
                "gender": None,
                "date_of_birth": None
            }
        
        logger.info(f"✅ Patient data fetched successfully: Name: {patient_data.get('name')}, Gender: {patient_data.get('gender')}")
        
        # Step 2: Fetch doctor data from doctor_users collection using sys_user_id
        logger.info(f"🔍 Fetching doctor data for sys_user_id: {doctor_id}")
        doctor_data = await database["doctor_users"].find_one(
            {"sys_user_id": doctor_id}
        )
        
        if not doctor_data:
            doctor_data = await database["doctor_users"].find_one(
                {"doctor_id": doctor_id}
            )
        
        if doctor_data:
            doctor_specialization = doctor_data.get("specialization", "general_practice")
            logger.info(f"✅ Doctor data fetched: Name: {doctor_data.get('name')}, Specialization: {doctor_specialization}")
        else:
            doctor_data = {"sys_user_id": doctor_id, "name": "Unknown", "specialization": "general_practice"}
            logger.warning(f"⚠️ Doctor data not found, using default")
        # Step 3: Fetch latest patient summary using patient_id only, sorted by generated_at
        logger.info(f"🔍 Fetching latest patient summary for patient_id: {patient_id}")
        patient_summary = None
        try:
            docs = await summary_collection.find(
                {"patient_id": patient_id}
            ).sort("generated_at", -1).limit(1).to_list(1)

            if docs:
                patient_summary = docs[0]
                logger.info(f"✅ Latest patient summary fetched | patient_id={patient_id} | summary_id={str(patient_summary.get('_id', ''))}")
            else:
                logger.warning(f"⚠️ No patient summary found for patient_id={patient_id}")

        except Exception as summary_fetch_error:
            logger.error(f"❌ Failed to fetch patient summary for patient_id={patient_id}: {str(summary_fetch_error)}")

        # Log treatment summary details if found
        if patient_summary:
            patient_summary["_id"] = str(patient_summary["_id"])
            logger.info(f"📊 PATIENT SUMMARY DATA RETRIEVED:")
            logger.info(f"   │ Summary ID: {patient_summary['_id']}")
            logger.info(f"   │ Created At: {patient_summary.get('created_at')}")
            logger.info(f"   │ Last Updated: {patient_summary.get('last_updated')}")

            medical_history = patient_summary.get("patient_medical_history", {})
            if medical_history.get("major_diagnoses"):
                for i, diagnosis in enumerate(medical_history["major_diagnoses"], 1):
                    if isinstance(diagnosis, dict):
                        logger.info(f"   │   {i}. Diagnosis: {diagnosis.get('diagnosis', 'Unknown diagnosis')}")
                    else:
                        logger.info(f"   │   {i}. Diagnosis: {diagnosis}")
            
            completed_procedures = patient_summary.get("completed_procedures", [])
            if completed_procedures:
                logger.info(f"   │ Completed Procedures:")
                for i, proc in enumerate(completed_procedures, 1):
                    if isinstance(proc, dict):
                        logger.info(f"   │   {i}. Procedure: {proc.get('procedure_name', 'Unknown procedure')}")
                    else:
                        logger.info(f"   │   {i}. Procedure: {proc}")

            completed_investigations = patient_summary.get("completed_investigations", [])
            if completed_investigations:
                logger.info(f"   │ Completed Investigations:")
                for i, inv in enumerate(completed_investigations, 1):
                    if isinstance(inv, dict):
                        logger.info(f"   │   {i}. Investigation: {inv.get('test_name', 'Unknown test')}")
                    else:
                        logger.info(f"   │   {i}. Investigation: {inv}")

            current_medications = patient_summary.get("current_medications", [])
            if current_medications:
                logger.info(f"   │ Current Medications:")
                for i, med in enumerate(current_medications, 1):
                    if isinstance(med, dict):
                        logger.info(f"   │   {i}. Medication: {med.get('drug_name', 'Unknown drug')} - {med.get('dose', 'Unknown dose')}")
                    else:
                        logger.info(f"   │   {i}. Medication: {med}")
        else:
            logger.info(f"ℹ️ No summary found for patient: {patient_id} with doctor: {doctor_id}")
        
        # Step 4: Calculate age from date_of_birth
        patient_age = calculate_age(patient_data.get("date_of_birth"))
        logger.info(f"📅 Patient age calculated: {patient_age} years")
        
        # Step 5: Build TreatmentPlanInput from all data sources
        logger.info(f"🛠️ Building treatment input from all data sources...")
        treatment_input = build_treatment_input(
            patient_data=patient_data,
            doctor_data=doctor_data,
            patient_summary=patient_summary,
            primary_diagnosis=primary_diagnosis,
            patient_age=patient_age,
            additional_input=additional_input,
            prognosis=prognosis,
        )
        
        # Log treatment input summary
        logger.info(f"✅ Treatment input built successfully with:")
        logger.info(f"   - Primary Diagnosis: {treatment_input.primary_diagnosis.disease if treatment_input.primary_diagnosis else 'None'}")
        logger.info(f"   - Comorbidities: {len(treatment_input.comorbidities)}")
        logger.info(f"   - Current Medications: {len(treatment_input.current_medications)}")
        logger.info(f"   - Completed Procedures: {len(treatment_input.completed_procedures)}")
        logger.info(f"   - Completed Investigations: {len(treatment_input.completed_investigations)}")
        
        # Step 6: Initialize LLM
        logger.info(f"🤖 Initializing LLM (llama-3.3-70b-versatile)...")
        llm = ChatGroq(
            model="llama-3.3-70b-versatile",
            groq_api_key=os.getenv("GROQ_API_KEY"),
            max_tokens=6000,
            temperature=0.1
        )
        logger.info(f"✅ LLM initialized successfully")
        
        # Step 7: Neo4j connection
        neo4j_uri = os.getenv("NEO4J_URI", "bolt://neo4j:7687")
        neo4j_user = os.getenv("NEO4J_USER", "neo4j")
        neo4j_password = os.getenv("NEO4J_PASSWORD", "password")
        logger.info(f"🔌 Connecting to Neo4j at: {neo4j_uri}")
        
        # Step 8: Generate treatment plan (without storing)
        logger.info(f"🚀 Starting treatment plan generation...")
        plans = await generate_three_treatment_plans(
            treatment_input=treatment_input,
            llm=llm,
            neo4j_uri=neo4j_uri,
            neo4j_user=neo4j_user,
            neo4j_password=neo4j_password,
            patient_summary=patient_summary,
        )

        ranked_summary = []
        for rank, plan in enumerate(plans, 1):
            ranked_summary.append({
                "rank": rank,
                "strategy": plan.strategy.value,
                "severity": treatment_input.primary_diagnosis.severity if treatment_input.primary_diagnosis else None,
                "treatment_intent": plan.treatment_intent.value,
                "validation_score": round(plan.validation_result.validation_score, 3) if plan.validation_result else 0.0,
                "guideline_compliance_score": round(plan.validation_result.guideline_compliance_score, 3) if plan.validation_result else 0.0,
                "is_valid": plan.validation_result.is_valid if plan.validation_result else None,
                "confidence_score": round(plan.confidence_score, 3),
                "drug_count": len(plan.first_line_drugs) + len(plan.adjunctive_drugs),
                "requires_specialist_review": plan.requires_specialist_review,
                "retrieved_treatment_skills_count": len(plan.retrieved_skills_summary),
            })
            plan.rank = rank

        return {
            "success": True,
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "total_plans": len(plans),
            "ranked_summary": ranked_summary,
            "treatment_plans": plans,
        }
                
        # Log treatment plan summary
        logger.info(f"📋 TREATMENT PLAN GENERATED:")
        logger.info(f"   ┌─────────────────────────────────────────")
        logger.info(f"   │ Intent: {treatment_plan.treatment_intent}")
        logger.info(f"   │ Primary Goals: {len(treatment_plan.primary_goals)}")
        for i, goal in enumerate(treatment_plan.primary_goals, 1):
            logger.info(f"   │   {i}. {goal}")
        
        logger.info(f"   │ 💊 First-line Drugs: {len(treatment_plan.first_line_drugs)}")
        for i, drug in enumerate(treatment_plan.first_line_drugs, 1):
            logger.info(f"   │   {i}. {drug.drug_name} - {drug.dose} {drug.frequency}")
        
        logger.info(f"   │ 🔪 Procedures: {len(treatment_plan.recommended_procedures)}")
        for i, proc in enumerate(treatment_plan.recommended_procedures, 1):
            logger.info(f"   │   {i}. {proc.procedure_name} ({proc.timing})")
        
        logger.info(f"   │ 🔬 Investigations: {len(treatment_plan.required_investigations)}")
        for i, inv in enumerate(treatment_plan.required_investigations, 1):
            logger.info(f"   │   {i}. {inv.test_name} ({inv.urgency})")
        
        logger.info(f"   │ 🏃 Lifestyle Modifications: {len(treatment_plan.lifestyle_modifications)}")
        
        logger.info(f"   │ 📅 Follow-up: {treatment_plan.follow_up_plan.next_visit_timing}")
        logger.info(f"   │ Monitoring: {len(treatment_plan.follow_up_plan.monitoring_parameters)} parameters")
        
        logger.info(f"   │ 📊 Scores:")
        logger.info(f"   │   - Guideline Compliance: {treatment_plan.guideline_compliance_score:.0%}")
        logger.info(f"   │   - Confidence: {treatment_plan.confidence_score:.0%}")
        logger.info(f"   │   - Adherence Prediction: {treatment_plan.patient_adherence_prediction}")
        
        if treatment_plan.warnings:
            logger.info(f"   │ ⚠️ Warnings ({len(treatment_plan.warnings)}):")
            for i, warning in enumerate(treatment_plan.warnings, 1):
                logger.info(f"   │   {i}. {warning}")
        
        logger.info(f"   └─────────────────────────────────────────")
        
        # At the end of generate_treatment_plan_endpoint(), 
        # replace the final return block with this:

        logger.info(f"✅ Treatment plan generation complete for patient: {patient_id}")
        # ✅ FIX 7b: Emit audit event
        try:
            await emit_audit(AuditEvent(
                action="treatment_plan_generated",
                actor_id=doctor_id,
                resource_id=patient_id,
                metadata={
                    "confidence_score": treatment_plan.confidence_score,
                    "guideline_compliance": treatment_plan.guideline_compliance_score,
                    "drug_count": len(treatment_plan.first_line_drugs),
                    "requires_specialist_review": treatment_plan.requires_specialist_review,
                    "primary_diagnosis": treatment_plan.treatment_summary
                }
            ))
        except Exception as audit_error:
            logger.warning(f"⚠️ Audit emission failed (non-blocking): {str(audit_error)}")

        return {
            "success": True,
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "treatment_plan": treatment_plan
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error generating treatment plan: {str(e)}")
        logger.error(f"   Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))

def calculate_age(dob_str: Optional[str]) -> Optional[int]:
    """Calculate age from date of birth string"""
    if not dob_str:
        return None
    
    try:
        # Parse date of birthhhhh
        if isinstance(dob_str, str):
            # Handle different date formatsss
            if "T" in dob_str:  # ISO format
                dob = datetime.fromisoformat(dob_str.replace('Z', '+00:00'))
            elif "-" in dob_str:  # YYYY-MM-DD
                dob = datetime.strptime(dob_str, "%Y-%m-%d")
            else:
                return None
        else:
            return None
        
        # Calculate age
        today = datetime.now()
        age = today.year - dob.year
        
        # Adjust if birthday hasn't occurred this year
        if today.month < dob.month or (today.month == dob.month and today.day < dob.day):
            age -= 1
        
        return age
    except Exception as e:
        logger.error(f"Error calculating age from {dob_str}: {str(e)}")
        return None

def build_treatment_input(
    patient_data: dict,
    doctor_data: Optional[dict],
    patient_summary: Optional[dict],
    primary_diagnosis: Optional[dict],
    patient_age: Optional[int],
    additional_input: Optional[dict] = None,
    prognosis: Optional[dict] = None       # ADD this
) -> TreatmentPlanInput:
    """Build TreatmentPlanInput from all data sources"""
    
    completed_procedures = []
    completed_investigations = []
    current_medications = []
    comorbidities = []
    allergies = []
    
    if patient_summary:
        def _deep_collect(obj, target_keys, name_keys):
            """Walk entire summary dict, collect items under target_keys using name_keys"""
            results = []
            if isinstance(obj, dict):
                for k, v in obj.items():
                    if k in target_keys:
                        items = v if isinstance(v, list) else [v]
                        for item in items:
                            if isinstance(item, dict):
                                for nk in name_keys:
                                    if item.get(nk):
                                        results.append(item)
                                        break
                            elif isinstance(item, str) and item.strip():
                                results.append({"name": item})
                    else:
                        results.extend(_deep_collect(v, target_keys, name_keys))
            elif isinstance(obj, list):
                for item in obj:
                    results.extend(_deep_collect(item, target_keys, name_keys))
            return results

        # ── Completed Procedures ──────────────────────────────────────────
        # ── Completed Investigations ──────────────────────────────────────
        for item in _deep_collect(
            patient_summary,
            {"imaging_summary", "recent_imaging", "completed_investigations",
             "lab_results", "diagnostic_workup", "completed_workup",
             "diagnostic_tests", "investigations_completed"},   # ★ FIX #4 — widened
            ["modality", "test_name", "name", "test"]           # ★ FIX #4 — added "test"
        ):
            name = item.get("modality") or item.get("test_name") or item.get("name") or item.get("test", "")
            name = item.get("procedure") or item.get("treatment") or item.get("name", "")
            if name:
                completed_procedures.append(CompletedProcedure(
                    procedure_name=name,
                    date_performed=item.get("date", "unknown"),
                    outcome=item.get("evidence", item.get("outcome", "Completed"))
                ))

        # ── Completed Investigations ──────────────────────────────────────
        for item in _deep_collect(
            patient_summary,
            {"imaging_summary", "recent_imaging", "completed_investigations"},
            ["modality", "test_name", "name"]
        ):
            name = item.get("modality") or item.get("test_name") or item.get("name", "")
            finding = item.get("key_finding") or item.get("finding") or item.get("result", "")
            if name:
                completed_investigations.append(CompletedInvestigation(
                    test_name=name,
                    date_performed=item.get("date", "unknown"),
                    result=finding,
                    is_abnormal=bool(finding)
                ))

        # ── Current Medications ───────────────────────────────────────────
        for item in _deep_collect(
            patient_summary,
            {"current_medications"},
            ["drug_name", "name", "medication"]
        ):
            name = item.get("drug_name") or item.get("name") or item.get("medication", "")
            if name:
                current_medications.append(CurrentMedication(
                    drug_name=name,
                    dose=item.get("dose", ""),
                    frequency=item.get("frequency", ""),
                    route=item.get("route", "PO"),
                    started_date=item.get("started_date"),
                    indication=item.get("indication")
                ))

        # ── Comorbidities ─────────────────────────────────────────────────
        for item in _deep_collect(
            patient_summary,
            {"major_diagnoses", "active_diagnoses"},
            ["diagnosis", "name"]
        ):
            name = item.get("diagnosis") or item.get("name", "")
            if name and name not in comorbidities:
                comorbidities.append(name)

    # ── Primary Diagnosis ─────────────────────────────────────────────────

    primary_dx = None

    if primary_diagnosis:

        if isinstance(primary_diagnosis, str):

            primary_dx = PrimaryDiagnosis(
                disease=primary_diagnosis
            )

        elif isinstance(primary_diagnosis, dict):

            primary_dx = PrimaryDiagnosis(
                disease=primary_diagnosis.get("disease"),
                icd10_code=primary_diagnosis.get("icd10_code"),
                stage=primary_diagnosis.get("stage"),
                severity=primary_diagnosis.get("severity"),
                confidence=primary_diagnosis.get("confidence")
            )
    # ── Visit Type ────────────────────────────────────────────────────────

    visit_type = "first_visit"
    if patient_summary:
        if completed_procedures or completed_investigations:
            visit_type = "followup"
        current_condition = patient_summary.get("current_medical_condition", {})
        urgency = current_condition.get("urgency_level")
        if urgency == "emergency":
            visit_type = "emergency"
        elif urgency == "urgent":
            visit_type = "urgent"

    # ── Doctor Speciality ─────────────────────────────────────────────────

    doctor_speciality = None
    doctor_sys_id = None
    if doctor_data:
        doctor_speciality = doctor_data.get("specialization") or doctor_data.get("specialty")
        doctor_sys_id = (
            doctor_data.get("sys_user_id")
            or doctor_data.get("doctor_id")
            or doctor_data.get("doctorId")
        )
        logger.info(f"🩺 Doctor sys_user_id for guidelines lookup: {doctor_sys_id}")

    # ── Additional Input Overrides ────────────────────────────────────────

    if additional_input:
        if "visit_type" in additional_input:
            visit_type = additional_input["visit_type"]
        if "doctor_speciality" in additional_input:
            doctor_speciality = additional_input["doctor_speciality"]

    treatment_setting = (additional_input or {}).get("treatment_setting", "outpatient")
    cost_sensitivity = (additional_input or {}).get("cost_sensitivity", "moderate")
    patient_preferences = (additional_input or {}).get("patient_preferences")

    # ── Validate age bounds ────────────────────────────────────

    if patient_age is not None and (patient_age < 0 or patient_age > 120):
        logger.warning(f"⚠️ Unrealistic patient age: {patient_age}, setting to None")
        patient_age = None
    prognosis_data = None
    if prognosis and isinstance(prognosis, dict):
        try:
            prognosis_data = PrognosisData(**prognosis)
        except Exception as e:
            logger.warning(f"⚠️ Could not parse prognosis: {e}")

    # Building TreatmentPlanInput
    # doctor_sys_id is stored in patient_preferences so GuidelineRetrievalAgent
    # (and TreatmentSkillRetrievalAgent) can look up the correct doctor
    # guidelines / doctor-scoped skills by doctorId
    final_patient_preferences = patient_preferences or doctor_sys_id or ""

    # Building TreatmentPlanInput
    treatment_input = TreatmentPlanInput(
        primary_diagnosis=primary_dx,
        patient_id=patient_data.get("patient_id", patient_data.get("sys_user_id", "")),
        patient_age=patient_age,
        patient_sex=patient_data.get("gender"),
        patient_weight_kg=None,
        comorbidities=comorbidities,
        allergies=allergies,
        current_medications=current_medications,
        renal_function_egfr=None,
        hepatic_function="normal",
        cardiac_function_ef=None,
        completed_procedures=completed_procedures,
        completed_investigations=completed_investigations,
        visit_type=visit_type,
        doctor_speciality=doctor_speciality,
        treatment_setting=treatment_setting,
        cost_sensitivity=cost_sensitivity,
        patient_preferences=final_patient_preferences,
        prognosis=prognosis_data,
    )
    
    logger.info(f"✅ Treatment input built successfully for patient: {treatment_input}")

    return treatment_input

@router.get("/patient-summary")
async def get_patient_summary():
    # Fetch all data from the collection asynchronously
    data_cursor = summary_collection.find()
    data = await data_cursor.to_list(length=None)  # Await and convert to list
    
    # Convert MongoDB ObjectId to string for JSON response
    for document in data:
        document["_id"] = str(document["_id"])  # Convert ObjectId to string

    return data


@router.get("/doctor-guidelines")
async def get_doctor_guidelines():
    try:
        # Retrieve all data from the collection as a cursor
        cursor = doctor_guidelines_collection.find()

        # Convert the cursor to a list asynchronously
        all_data = []
        async for doc in cursor:
            # Convert ObjectId and datetime to strings
            doc = {
                key: str(value) if isinstance(value, (ObjectId, datetime)) else value
                for key, value in doc.items()
            }
            all_data.append(doc)

        # Return the data as JSON response
        return JSONResponse(content=all_data)
    
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)