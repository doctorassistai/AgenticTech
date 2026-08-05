"""
diagnostics_agent.py  — v3.1  (MERGED with diagnostic_skill_agent.py + SKILL OUTPUT QUALITY UPGRADE)
=======================================================================
Skill-first Diagnostic Reasoning System for DoctorAssist.

WORKFLOW (unchanged from v3.0)
--------------
  skill_retrieval                       ← entry point. Searches the
                                           doctor's skill library (Chroma +
                                           Mongo) using the RAW patient
                                           context/dictation — no diagnosis
                                           needed. Populates
                                           state["retrieved_skills"].
  → clinical_language                   (now sees retrieved skills)
  → build_evidence_graph
  → generate_differentials              (now sees retrieved skills)
  → knowledge_graph
  → probabilistic_scoring
  → disease_characterization
  → severity_scoring
  → hypothesis_to_diagnosis_reasoning   (now sees retrieved skills)
  → followup_reasoning
  → guideline_validation                Uses state["retrieved_skills"] directly
                                           as the guideline source.
  → skill_application                   Produces a matched/missing
                                           analysis per top skill, and a
                                           full skill_usage_log showing
                                           exactly which skill contributed
                                           what content to which agent.
  → stress_testing
  → investigation_gap
  → conflict_detection
  → longitudinal_analysis
  → red_flag_detection
  → doctor_hypothesis
  → report_generation                   (now includes applied_skills,
                                           retrieved_skills, skill_usage_log,
                                           skill_application_summary)

WHAT'S NEW IN v3.1 — SKILL OUTPUT QUALITY UPGRADE
--------------------------------------------------
Previously, skill usage was tracked only as opaque skill_id lists plus a
truncated free-text blob ("content_used"). Doctors reading the final report
could see THAT a skill was used, but not WHAT specifically it contributed,
WHICH patient evidence matched WHICH skill criterion, or HOW MUCH it moved
diagnostic confidence.

This version turns every skill touchpoint into a clinician-grade, explainable
artifact:

  1. `_log_skill_usage()` now records skill_names, a one-line clinical
     `reason_used` narrative, and a quantified/qualified `impact`, not just
     ids and a text blob.
  2. Every agent that consumes retrieved_skills (ClinicalLanguageAgent,
     DifferentialDiagnosisGenerator, HypothesisToDiagnosisReasoningAgent,
     GuidelineValidationAgent) now asks the LLM for structured
     `skill_contributions` — {skill_id, skill_name, contribution} — instead
     of a bare list of ids, so we always know WHY a skill mattered to that
     specific reasoning step.
  3. `SkillApplicationAgent` now produces, per skill: sections_applied,
     matched criterion↔patient-evidence PAIRS (not just parallel lists),
     a one-sentence clinical `contribution`, and a qualitative `impact`
     level (High/Medium/Low) derived from its quantitative
     diagnostic_confidence_contribution.
  4. A new `state["skill_application_summary"]` — a "Skill Impact Report" —
     distills all of the above into the doctor-facing shape: skill_name,
     impact, contribution, evidence_matched, evidence_missing,
     diagnostic_weight.
  5. `DiagnosisCandidate.supported_by_skills` — the primary (and any)
     diagnosis now directly carries which skills backed it, with a
     confidence_boost and a one-line contribution, so the final report can
     show "supported_by_skills" directly under the diagnosis instead of
     making the doctor cross-reference a separate skills list.

All existing fields, endpoints, DB writes, and workflow edges are preserved
exactly as they were — this is purely additive/quality work on the
skill-explainability surface.
"""

from __future__ import annotations

import json
import re
import os
import traceback
import copy
import asyncio
import time
import uuid
import aiofiles
import shutil
import queue
import threading
import random
import string
import sys
import pytz
import socket
import platform
import httpx

from typing import Dict, Any, List, Optional, TypedDict, Union
from datetime import datetime, date, timedelta, timezone
from enum import Enum

from loguru import logger
from bson import ObjectId
import logging

from langgraph.graph import StateGraph, END
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_groq import ChatGroq

import networkx as nx
from neo4j import GraphDatabase
from rapidfuzz import fuzz

from fastapi import (
    APIRouter, Depends, FastAPI, HTTPException, Request,
    WebSocket, status, File, Form, UploadFile, Query, Response, Body
)
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse, FileResponse
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field, validator
from pymongo import MongoClient
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from functools import wraps, partial
from jose import jwt, JWTError
from dotenv import load_dotenv

from groq import Groq

# ── Merged in from diagnostic_skill_agent.py ────────────────────────────────
import chromadb

try:
    from shared.audit.schema import AuditEvent
    from shared.audit.utils import emit_audit
except ImportError:
    pass  # allow running standalone

# ── Phase 1 embedding pathway (used only by the merged-in skill indexing
#    utilities below — kept for the standalone /reindex backfill endpoint) ──
from Agentic.phase1_knowledge_pipeline import (
    _embed_text,
    EMBEDDING_MODEL,
    MONGO_URI as PHASE1_MONGO_URI,
    MONGO_DB as PHASE1_MONGO_DB,
    CHROMA_PERSIST_PATH,
)

# ── Phase 2 hybrid retrieval engine — this is the actual retrieval path ─────
from Agentic.phase2_skill_retrieval_service import (
    ClinicalRAGRetrievalEngine,
    build_retrieval_context_from_patient_summary,   # ← replaces build_retrieval_context_from_diagnostic_input
    FINAL_TOP_K,
    _get_engine,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="",
    tags=["doctor"],
    responses={404: {"description": "Not fd"}},
)

# ──────────────────────────────────────────────────────────────────────────────
# ENV / DB
# ──────────────────────────────────────────────────────────────────────────────

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB  = "doctorassistai"
NODES_DB  = "doctorassistai_nodes"

mongodb_client = AsyncIOMotorClient(MONGO_URI)
database       = mongodb_client[MONGO_DB]

client    = MongoClient(MONGO_URI)
db        = client[MONGO_DB]
nodes_db  = client[NODES_DB]

patient_user_collection     = db["patient_users"]
doctor_user_collection       = db["doctor_users"]
summary_collection           = database["patient_summary"]
diagnosis_data_collection = database["diagnosis_data"]
documentation_treatment_plan_collection = database["documentation-treatment-plan"]
retrieved_skills_collection   = database["retrieved_skills"]
diagnostic_reports_collection = database["diagnostic_reports"]
patient_appointments_collection = db["patient_appointments"]

# ── Merged in — skill config from diagnostic_skill_agent.py ────────────────
SKILL_COLLECTION_NAME = "clinical_skills"   # standalone backfill/browse collection

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
_groq_client_module = Groq(api_key=GROQ_API_KEY)
SKILL_APPLICATION_MODEL = "llama-3.3-70b-versatile"

# Minimum final_score a retrieved skill needs before we bother running the
# per-skill matched/missing application analysis on it.
SKILL_RELEVANCE_MIN_SCORE = 0.15
TOP_N_APPLY = 3

# Thresholds used to translate a quantitative diagnostic_confidence_contribution
# (0.0-1.0) into a doctor-facing qualitative impact label.
SKILL_IMPACT_HIGH_THRESHOLD   = 0.6
SKILL_IMPACT_MEDIUM_THRESHOLD = 0.3

# ──────────────────────────────────────────────────────────────────────────────
# ENUMS & CONSTANTS
# ──────────────────────────────────────────────────────────────────────────────

class VisitType(str, Enum):
    FIRST_VISIT      = "first_visit"
    FOLLOWUP_VISIT   = "followup_visit"
    POST_PROCEDURE   = "post_procedure"
    PERIODIC_REVIEW  = "periodic_review"
    EMERGENCY_VISIT  = "emergency_visit"


class GuidelineSource(str, Enum):
    NCCN      = "NCCN"
    WHO       = "WHO"
    AHA       = "AHA/ACC"
    NICE      = "NICE"
    IDSA      = "IDSA"
    ASCO      = "ASCO"
    ESMO      = "ESMO"
    NCG_INDIA = "NCG India"


class SeverityLevel(str, Enum):
    MILD     = "mild"
    MODERATE = "moderate"
    SEVERE   = "severe"
    CRITICAL = "critical"


class EvidenceRelationship(str, Enum):
    SUPPORTS    = "supports"
    CONTRADICTS = "contradicts"
    SUGGESTS    = "suggests"
    REQUIRES    = "requires"
    CAUSED_BY   = "caused_by"
    IMPROVED_BY = "improved_by"


class NodeType(str, Enum):
    SYMPTOM            = "symptom"
    LAB_RESULT         = "lab_result"
    IMAGING_FINDING    = "imaging_finding"
    RISK_FACTOR        = "risk_factor"
    PROCEDURE          = "procedure"
    MEDICATION         = "medication"
    DISEASE_HYPOTHESIS = "disease_hypothesis"


class InvestigationStatus(str, Enum):
    DONE_CONFIRMED    = "done_confirmed"
    DONE_REFUTES      = "done_refutes"
    DONE_INCONCLUSIVE = "done_inconclusive"
    NOT_DONE          = "not_done"


# ──────────────────────────────────────────────────────────────────────────────
# PYDANTIC SCHEMAS
# ──────────────────────────────────────────────────────────────────────────────

class DiagnosticInput(BaseModel):
    patient_context_summary:   str
    age:                       int
    gender:                    str
    medical_history_summary:   str
    procedure_summary:         Optional[str]       = None
    latest_lab_summary:        Optional[str]       = None
    latest_imaging_summary:    Optional[str]       = None
    doctor_note_or_dictation:  str
    visit_type:                VisitType
    doctor_speciality:         str
    doctor_hypothesis_optional: Optional[str]      = None
    last_medications:          Optional[List[str]] = None
    recent_procedures:         Optional[List[str]] = None
    patient_id:                str
    doctor_id:                 str


class ClinicalLanguageOutput(BaseModel):
    symptoms:               List[str]  = Field(default_factory=list)
    clinical_findings: List[Union[str, Dict[str, Any]]]
    doctor_hypothesis:      Optional[str] = None
    alternative_hypothesis: List[str]  = Field(default_factory=list)
    ruleout_conditions:     List[str]  = Field(default_factory=list)
    pending_tests:          List[str]  = Field(default_factory=list)


class EvidenceNode(BaseModel):
    node_id:       str
    node_type:     NodeType
    value:         str
    weight:        float         = 1.0
    temporal_info: Optional[str] = None


class EvidenceEdge(BaseModel):
    source:       str
    target:       str
    relationship: EvidenceRelationship
    strength:     float = 0.5


class InvestigationItem(BaseModel):
    test:                str
    status:              str                = InvestigationStatus.NOT_DONE
    date_performed:      Optional[str]      = None
    result_summary:      Optional[str]      = None
    interpretation:      Optional[str]      = None
    supports_hypothesis: Optional[bool]     = None
    required_for:        str                = "diagnosis_confirmation"
    urgency:             str                = "before_treatment"


class GuidelineCriterion(BaseModel):
    criterion_name:   str
    criterion_detail: str
    status:           str             = "PENDING"
    evidence_from:    Optional[str]   = None
    evidence_text:    Optional[str]   = None
    missing_action:   Optional[str]   = None
    decision_impact:  Optional[str]   = None


class EvidenceAvailableItem(BaseModel):
    parameter:              str
    value:                  str
    source:                 str
    date:                   Optional[str] = None
    guideline_relevance:    str
    hypothesis_link:        str
    decision_enabled:       str


class MissingPendingItem(BaseModel):
    investigation:          str
    guideline_requirement:  str
    status:                 str   = "MISSING"
    importance_for_treatment: str
    hypothesis_step_blocked:  str
    ordering_priority:        int = 1
    recommended_action:       str = ""


class ClinicalInterpretationBlock(BaseModel):
    sufficient_for_treatment_initiation: bool   = False
    treatment_ready_for:    List[str]    = Field(default_factory=list)
    limited_by_missing:     List[str]    = Field(default_factory=list)
    hypothesis_gate_status: str          = "not_ready"
    hypothesis_gate_narrative: str       = ""
    priority_next_steps:    List[str]    = Field(default_factory=list)


class GuidelineAlignmentSummary(BaseModel):
    workup_completion_percent:  int    = 0
    confirmed_criteria:         int    = 0
    pending_criteria:           int    = 0
    missing_criteria:           int    = 0
    total_criteria:             int    = 0
    ready_for_surgery:          str    = "No"
    ready_for_systemic_therapy: str    = "No"
    ready_for_mdt_discussion:   str    = "No"
    readiness_rationale:        str    = ""
    cross_guideline_consensus:  str    = ""
    cross_guideline_conflicts:  str    = ""


class GuidelinePathway(BaseModel):
    guideline_name:    str
    guideline_source:  str
    applicable_for:    str
    pathway_stage:     Optional[str]                  = None
    overall_alignment: str                            = "partial"
    evidence_available:       List[EvidenceAvailableItem]   = Field(default_factory=list)
    missing_pending:          List[MissingPendingItem]       = Field(default_factory=list)
    clinical_interpretation:  Optional[ClinicalInterpretationBlock] = None
    alignment_summary:        Optional[GuidelineAlignmentSummary]   = None
    cross_guideline_overlaps: List[str]                      = Field(default_factory=list)
    confirmed_count:  int = 0
    pending_count:    int = 0
    missing_count:    int = 0


class HypothesisStep(BaseModel):
    step_number:       int
    step_label:        str
    reasoning:         str
    evidence_available: List[str]  = Field(default_factory=list)
    evidence_missing:  List[str]   = Field(default_factory=list)
    outcome:           str         = "pending"
    next_required:     Optional[str] = None


class HypothesisReasoningOutput(BaseModel):
    primary_hypothesis:        str
    confidence_at_entry:       float  = 0.0
    confidence_current:        float  = 0.0
    confidence_for_treatment:  float  = 0.0
    steps:                     List[HypothesisStep] = Field(default_factory=list)
    diagnosis_gate:            str    = "not_ready"
    gate_blockers:             List[str] = Field(default_factory=list)
    gate_conditions:           List[str] = Field(default_factory=list)
    confirmatory_tests_pending: List[str] = Field(default_factory=list)
    ruling_out:                List[str] = Field(default_factory=list)
    specialist_summary:        str   = ""


class DiagnosisCandidate(BaseModel):
    disease:             str
    probability:         float
    disease_type:        Optional[str]  = None
    stage:               Optional[str]  = None
    tumor_size:          Optional[str]  = None
    supporting_evidence: List[str]      = Field(default_factory=list)
    conflicting_evidence: List[str]     = Field(default_factory=list)
    required_tests:      List[str]      = Field(default_factory=list)
    missing_evidence:    List[str]      = Field(default_factory=list)
    severity:            Optional[SeverityLevel] = None
    guideline_sources:   List[Dict[str, Any]]    = Field(default_factory=list)
    guideline_pathways:  List[GuidelinePathway]  = Field(default_factory=list)
    # ── NEW — skill-first explainability ────────────────────────────────────
    # Which retrieved/applied skills directly backed this diagnosis, with a
    # one-line clinical contribution and the confidence they added. Populated
    # by SkillApplicationAgent so the report can show "why" right next to
    # the diagnosis instead of forcing a cross-reference into a separate list.
    supported_by_skills: List[Dict[str, Any]]    = Field(default_factory=list)


class DiagnosticReport(BaseModel):
    primary_hypothesis:      DiagnosisCandidate
    alternative_diagnoses:   List[DiagnosisCandidate]     = Field(default_factory=list)
    evidence_graph_summary:  Dict[str, Any]
    investigations:          List[InvestigationItem]      = Field(default_factory=list)
    missing_investigations:  List[str]                    = Field(default_factory=list)
    expected_findings:       Dict[str, str]               = Field(default_factory=dict)
    red_flag_alerts:         List[str]                    = Field(default_factory=list)
    diagnostic_explanation:  str
    confidence_score:        float
    hypothesis_reasoning:    Optional[HypothesisReasoningOutput] = None
    longitudinal_risk_predictions: Optional[Dict[str, Any]]     = None
    followup_analysis:       Optional[Dict[str, Any]]     = None
    # ── skill-first fields ──────────────────────────────────────────────────
    retrieved_skills:        List[Dict[str, Any]]          = Field(default_factory=list)
    applied_skills:          List[Dict[str, Any]]          = Field(default_factory=list)
    skill_usage_log:         List[Dict[str, Any]]          = Field(default_factory=list)
    # ── NEW — the doctor-facing "Skill Impact Report" ───────────────────────
    skill_application_summary: List[Dict[str, Any]]        = Field(default_factory=list)


class PatientSummaryUpsertRequest(BaseModel):
    patient_id:          str
    doctor_id:           str
    generated_at:        Optional[str]              = None
    documents_analyzed:  Optional[int]               = None
    processing_time_ms:  Optional[float]             = None
    summary:             Dict[str, Any]
    timeline:            Optional[Dict[str, Any]]    = None
    organ_analysis:      Optional[Dict[str, Any]]    = None
    agent_timings:       Optional[Dict[str, Any]]    = None
    errors:              Optional[List[Any]]         = Field(default_factory=list)
    clinical_summary:    Optional[Dict[str, Any]]    = None
# ──────────────────────────────────────────────────────────────────────────────
# LANGGRAPH STATE
# ──────────────────────────────────────────────────────────────────────────────

class DiagnosticState(TypedDict):
    diagnostic_input:          DiagnosticInput
    retrieved_skills:          List[Dict]           # from SkillRetrievalAgent
    skill_usage_log:           List[Dict]           # {agent, skill_ids, skill_names, content_used, reason_used, impact}
    applied_skills:            List[Dict]           # from SkillApplicationAgent
    skill_application_summary: List[Dict]           # NEW — doctor-facing "Skill Impact Report"
    structured_clinical_data:  Optional[ClinicalLanguageOutput]
    evidence_graph:            Optional[nx.DiGraph]
    evidence_nodes:            List[EvidenceNode]
    evidence_edges:            List[EvidenceEdge]
    candidate_diseases:        List[str]
    scored_diagnoses:          List[DiagnosisCandidate]
    evidence_conflicts:        List[str]
    investigations:            List[InvestigationItem]
    missing_investigations:    List[str]
    hypothesis_reasoning:      Optional[HypothesisReasoningOutput]
    longitudinal_progression:  Optional[Dict[str, Any]]
    red_flags:                 List[str]
    diagnostic_report:         Optional[DiagnosticReport]
    error:                     Optional[str]
    warnings:                  List[str]
    followup_analysis: Optional[Dict[str, Any]]


# ──────────────────────────────────────────────────────────────────────────────
# NEO4J
# ──────────────────────────────────────────────────────────────────────────────

class Neo4jConnectionManager:
    def __init__(self, uri: str, user: str, password: str):
        self.driver = GraphDatabase.driver(uri, auth=(user, password))
        logger.info(f"✅ Neo4j: {uri}")

    def close(self):
        if self.driver:
            self.driver.close()

    def query_candidate_diseases(
        self,
        symptoms: List[str],
        risk_factors: List[str],
        lab_markers: List[str],
    ) -> List[str]:
        query = """
        MATCH (d:Disease)-[:HAS_SYMPTOM]->(sym:Symptom)
        WHERE ANY(s IN $symptoms WHERE toLower(sym.name) CONTAINS toLower(s))
        RETURN DISTINCT d.name AS disease
        LIMIT 10
        """
        try:
            with self.driver.session() as session:
                result   = session.run(query, symptoms=symptoms, risk_factors=risk_factors, lab_markers=lab_markers)
                diseases = [r["disease"] for r in result]
                return diseases
        except Exception as e:
            logger.error(f"Neo4j query failed: {e}")
            return []

    def get_disease_relationships(self, disease: str) -> Dict[str, List[str]]:
        query = """
        MATCH (d:Disease {name: $disease})
        OPTIONAL MATCH (d)-[:HAS_SYMPTOM]->(s)
        OPTIONAL MATCH (d)-[:HAS_LAB_MARKER]->(l)
        OPTIONAL MATCH (d)-[:HAS_RISK_FACTOR]->(r)
        OPTIONAL MATCH (d)-[:CAUSES]->(c)
        RETURN
            collect(DISTINCT s.name) as symptoms,
            collect(DISTINCT l.name) as lab_markers,
            collect(DISTINCT r.name) as risk_factors,
            collect(DISTINCT c.name) as complications
        """
        try:
            with self.driver.session() as session:
                result = session.run(query, disease=disease)
                record = result.single()
                if record:
                    return {
                        "symptoms":       record["symptoms"] or [],
                        "lab_markers":    record["lab_markers"] or [],
                        "risk_factors":   record["risk_factors"] or [],
                        "complications":  record["complications"] or [],
                    }
                return {}
        except Exception as e:
            logger.error(f"Disease relationship query failed: {e}")
            return {}


# ──────────────────────────────────────────────────────────────────────────────
# UTILITY: JSON PARSER
# ──────────────────────────────────────────────────────────────────────────────

def _parse_json(content: str) -> dict:
    try:
        content = content.strip()
        if "```json" in content:
            content = content.split("```json", 1)[1].split("```", 1)[0]
        elif "```" in content:
            content = content.split("```", 1)[1].split("```", 1)[0]
        start = content.find("{")
        end   = content.rfind("}")
        if start != -1 and end != -1:
            return json.loads(content[start:end + 1])
        return {}
    except Exception as e:
        logger.warning(f"JSON parse failed: {e}")
        return {}


# ──────────────────────────────────────────────────────────────────────────────
# SKILL PROMPT / LOGGING HELPERS  (v3.1 — richer, evidence-mapped)
# ──────────────────────────────────────────────────────────────────────────────

def _format_skills_for_prompt(retrieved_skills: List[Dict], max_skills: int = 6, max_chars_each: int = 500) -> str:
    """Compact, promptable summary of retrieved skills — each tagged with its
    skill_id so agents can cite exactly which skill informed their output."""
    if not retrieved_skills:
        return "No pre-retrieved skills available for this case."
    blocks = []
    for s in retrieved_skills[:max_skills]:
        body = s.get("body", {}) or {}
        bits = []
        if body.get("diagnostic_criteria"):
            bits.append(f"Criteria: {str(body['diagnostic_criteria'])[:180]}")
        if body.get("treatment_principles"):
            bits.append(f"Treatment: {str(body['treatment_principles'])[:180]}")
        if s.get("trigger_keywords"):
            bits.append(f"Keywords: {', '.join(s['trigger_keywords'][:8])}")
        blocks.append(
            f"[skill_id={s.get('skill_id')}] {s.get('name')} "
            f"({s.get('disease_type','')}/{s.get('subtype','General')}) "
            f"— {s.get('guideline','')} {s.get('guideline_version','')} "
            f"(score={s.get('score', 0):.2f})\n  "
            + (" | ".join(bits)[:max_chars_each] if bits else "(no body preview)")
        )
    return "\n\n".join(blocks)


def _impact_level_from_score(score: Optional[float]) -> str:
    """Translate a 0.0-1.0 quantitative skill contribution into a doctor-facing
    qualitative impact label. Used consistently across skill_application_summary
    and supported_by_skills so every part of the report speaks the same
    High/Medium/Low language."""
    try:
        s = float(score)
    except (TypeError, ValueError):
        return "Unknown"
    if s >= SKILL_IMPACT_HIGH_THRESHOLD:
        return "High"
    if s >= SKILL_IMPACT_MEDIUM_THRESHOLD:
        return "Medium"
    if s > 0:
        return "Low"
    return "None"


def _extract_skill_contributions(parsed: dict, key: str = "skill_contributions") -> List[Dict[str, Any]]:
    """Normalizes an LLM-returned skill_contributions list into a consistent
    shape: [{"skill_id":..., "skill_name":..., "contribution":...}].
    Falls back to the older bare-id list ("skill_ids_referenced") for
    resilience if a model ever regresses to the old shape, so nothing breaks
    silently."""
    raw = parsed.pop(key, None)
    contributions: List[Dict[str, Any]] = []

    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict) and (item.get("skill_id") or item.get("contribution")):
                contributions.append({
                    "skill_id":     item.get("skill_id", ""),
                    "skill_name":   item.get("skill_name", ""),
                    "contribution": item.get("contribution", ""),
                })
            elif isinstance(item, str) and item:
                # Old-style bare skill_id string — keep it usable.
                contributions.append({"skill_id": item, "skill_name": "", "contribution": ""})

    # Backward-compat fallback: some prompts/agents may still emit the older
    # "skill_ids_referenced" bare-id field. Merge it in without duplicating.
    legacy_ids = parsed.pop("skill_ids_referenced", None) or []
    known_ids = {c["skill_id"] for c in contributions if c.get("skill_id")}
    for sid in legacy_ids:
        if sid and sid not in known_ids:
            contributions.append({"skill_id": sid, "skill_name": "", "contribution": ""})
            known_ids.add(sid)

    return contributions


def _log_skill_usage(
    state: "DiagnosticState",
    agent_name: str,
    skill_ids_used: List[str],
    content_used: str,
    skill_names: Optional[List[str]] = None,
    reason_used: str = "",
    impact: str = "",
    sections_used: Optional[List[str]] = None,
):
    """Every agent that consumes retrieved_skills calls this so the final
    report can show exactly which skill informed which decision, WHY
    (reason_used — a one-line clinical narrative), and with what effect
    (impact — e.g. a confidence delta or qualitative High/Medium/Low tag).

    This is intentionally still safe to call with just the original 4
    positional args (agent_name, skill_ids_used, content_used) — the new
    fields default to empty so no existing call site breaks."""
    skill_ids_used = [s for s in (skill_ids_used or []) if s]
    if not skill_ids_used and not reason_used:
        return
    state.setdefault("skill_usage_log", []).append({
        "agent":         agent_name,
        "skill_ids":     skill_ids_used,
        "skill_names":   [s for s in (skill_names or []) if s],
        "content_used":  (content_used or "")[:300],
        "reason_used":   (reason_used or "")[:300],
        "impact":        impact or "",
        "sections_used": sections_used or [],
    })

# ──────────────────────────────────────────────────────────────────────────────
# PHASES 1, 2, 4, 5 — GENERIC SKILL ROUTING / SLIMMING / DEDUP / SUMMARY
# Works for ANY skill_type and ANY body schema — nothing disease- or
# field-name-specific is hardcoded. Optional overrides come from an env var,
# never from code.
# ──────────────────────────────────────────────────────────────────────────────

SKILL_FIELD_CONFIG_ENV = "SKILL_AGENT_FIELD_CONFIG_JSON"


def _load_skill_field_config() -> Dict[str, List[str]]:
    """
    Optional admin-supplied JSON mapping: {"<skill_type>": ["field1","field2"]}.
    If unset, every field is kept (just truncated) — so ANY skill schema
    (any specialty, any disease) works without code changes.
    Example env value:
      {"diagnosis": ["diagnostic_criteria","investigations","biomarkers"]}
    """
    raw = os.getenv(SKILL_FIELD_CONFIG_ENV, "")
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception as e:
        logger.warning(f"[SkillFieldConfig] could not parse {SKILL_FIELD_CONFIG_ENV}: {e}")
        return {}


_SKILL_FIELD_CONFIG = _load_skill_field_config()


def route_skills_to_agents(retrieved_skills: List[Dict]) -> Dict[str, List[Dict]]:
    """
    PHASE 1 — Buckets skills by whatever skill_type value is actually present
    on each skill (no fixed category list). Every skill also lands in
    'guideline_skills' (unfiltered) so GuidelineValidationAgent keeps seeing
    everything, exactly as it does today — zero functional loss.

    Returns e.g. {"diagnosis_skills": [...], "treatment_skills": [...],
                   "followup_skills": [...], "guideline_skills": [...]}
    — keys are derived purely from the data, not hardcoded here.
    """
    routed: Dict[str, List[Dict]] = {"guideline_skills": []}
    for skill in retrieved_skills or []:
        skill_type = (skill.get("skill_type") or "unclassified").strip().lower() or "unclassified"
        bucket_key = f"{skill_type}_skills"
        routed.setdefault(bucket_key, []).append(skill)
        # ISSUE 2 FIX — this is the diagnostic workflow; treatment skills
        # belong to the separate treatment-plan workflow and must never leak
        # into diagnosis guideline sourcing / pathway mapping / application.
        if skill_type != "treatment":
            routed["guideline_skills"].append(skill)
    return routed


def _get_bucket_skills(state: "DiagnosticState", bucket_key: str, skill_type_match: str) -> List[Dict]:
    """
    PHASE 1 FIX — Root cause of treatment skills leaking into diagnosis
    reasoning: `state.get("diagnosis_skills", state.get("retrieved_skills", []))`
    silently returns EVERYTHING (including treatment skills) whenever the
    diagnosis_skills bucket happens to be empty/absent. Never fall back to
    the unfiltered pool — derive the bucket directly from retrieved_skills
    filtered by skill_type instead.
    """
    bucket = state.get(bucket_key)
    if bucket:
        return bucket
    return [
        s for s in state.get("retrieved_skills", [])
        if (s.get("skill_type") or "").strip().lower() == skill_type_match
    ]


def _slim_skill_body(body: Dict[str, Any], skill_type: str, max_value_chars: int = 600) -> Dict[str, Any]:
    """
    PHASE 2 — Shrinks a skill body for a given agent bucket.
    - If SKILL_AGENT_FIELD_CONFIG_JSON defines an allow-list for this
      skill_type, only those fields are kept (opt-in, doctor-configurable).
    - Otherwise every field is kept but each value is truncated, so this
      works identically for any skill schema without assuming field names.
    """
    if not isinstance(body, dict):
        return {}

    allowed = _SKILL_FIELD_CONFIG.get(skill_type)
    if allowed:
        return {k: body[k] for k in allowed if k in body}

    slim: Dict[str, Any] = {}
    for k, v in body.items():
        if isinstance(v, (dict, list)):
            slim[k] = json.dumps(v, default=str)[:max_value_chars]
        elif isinstance(v, str):
            slim[k] = v[:max_value_chars]
        else:
            slim[k] = v
    return slim


def filter_skill_for_agent(skill: Dict) -> Dict:
    """
    PHASE 2 — Produces the lean, agent-facing shape of a skill.
    No clinical keywords/field names are hardcoded; slimming behavior is
    entirely driven by _slim_skill_body's generic rule above.
    """
    skill_type = (skill.get("skill_type") or "unclassified").strip().lower() or "unclassified"
    return {
        "skill_id":         skill.get("skill_id"),
        "name":             skill.get("name") or skill.get("title"),
        "skill_name":       skill.get("name") or skill.get("title"),
        "skill_type":       skill.get("skill_type", ""),
        "disease_type":     skill.get("disease_type"),
        "subtype":          skill.get("subtype"),
        "score":            skill.get("score"),
        "guideline":        skill.get("guideline", ""),
        "guideline_version": skill.get("guideline_version", ""),
        "trigger_keywords": skill.get("trigger_keywords", []),
        "body":             _slim_skill_body(skill.get("body", {}) or {}, skill_type),
    }



def deduplicate_skills(skills: List[Dict]) -> List[Dict]:
    """
    Two skills are duplicates if they share
    (skill_type, disease_type, subtype, name) case/whitespace-insensitively;
    the higher-scoring one wins. Fixes "Unicentric Castleman Disease" vs
    "Unicentric Castleman disease" being treated as distinct skills.
    """
    unique: Dict[tuple, Dict] = {}
    for skill in skills or []:
        key = (
            str(skill.get("skill_type", "")).lower().strip(),
            str(skill.get("disease_type", "")).lower().strip(),
            str(skill.get("subtype", "")).lower().strip(),
            str(skill.get("name", "")).lower().strip(),
        )
        existing = unique.get(key)
        if existing is None or (skill.get("score", 0) or 0) > (existing.get("score", 0) or 0):
            unique[key] = skill
    return list(unique.values())


def build_skill_summary(skill: Dict) -> Dict[str, Any]:
    """PHASE 5 — Lightweight, frontend-facing summary of a skill."""
    body = skill.get("body", {}) or {}
    return {
        "skill_id":      skill.get("skill_id"),
        "skill_name":    skill.get("skill_name") or skill.get("name"),
        "disease_type":  skill.get("disease_type"),
        "subtype":       skill.get("subtype"),
        "sections_used": list(body.keys()) if isinstance(body, dict) else [],
    }


def _strip_skill_body_for_response(skill: Dict[str, Any]) -> Dict[str, Any]:
    """
    ISSUE 3 — Removes the (potentially 100-500KB) 'body' field from a skill
    dict for API responses only. Mongo writes (retrieved_skills_collection,
    diagnostic_reports_collection) still use the untouched report.* objects
    with full bodies — this function is only applied at the response_data
    construction point below, nothing upstream is affected.
    """
    if not isinstance(skill, dict):
        return skill
    lean = {k: v for k, v in skill.items() if k != "body"}
    body = skill.get("body")
    if isinstance(body, dict):
        lean["sections_available"] = list(body.keys())
    return lean


def _strip_guideline_sources_for_response(guideline_sources: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    ISSUE 1 — guideline_sources carries the full skill 'body' (hundreds of
    fields), needed internally by GuidelinePathwayMappingAgent's prompt.
    That full body must never reach the API response. Produces the lean,
    doctor-facing shape only at the response boundary — the DiagnosisCandidate's
    own guideline_sources is left completely untouched.
    """
    lean = []
    for g in guideline_sources or []:
        body = g.get("body")
        lean.append({
            "skill_id":      g.get("skill_id"),
            "skill_name":    g.get("title", ""),
            "reference":     g.get("reference", ""),
            "disease_type":  g.get("disease_type", ""),
            "subtype":       g.get("subtype", ""),
            "sections_used": list(body.keys()) if isinstance(body, dict) else [],
        })
    return lean

# ──────────────────────────────────────────────────────────────────────────────
# A0  SKILL RETRIEVAL  (entry point, uses raw patient context/dictation)
# ──────────────────────────────────────────────────────────────────────────────

class SkillRetrievalAgent:
    def __init__(self, rag_engine: ClinicalRAGRetrievalEngine):
        self.rag_engine = rag_engine

    async def retrieve(self, state: DiagnosticState) -> DiagnosticState:
        logger.info("SkillRetrievalAgent — START (patient_summary-only)")
        di = state["diagnostic_input"]

        # Retrieval is driven ONLY by patient_summary now — no labs/imaging/
        # dictation/scored_diagnoses text is used to build the query.
        ctx = await build_retrieval_context_from_patient_summary(di.patient_id, di.doctor_id)

        try:
            result = await self.rag_engine.retrieve(ctx, top_k=FINAL_TOP_K)
        except Exception as e:
            logger.error(f"SkillRetrievalAgent failed: {e}")
            state["retrieved_skills"] = []
            state["skill_usage_log"] = []
            return state

        retrieved: List[Dict] = []
        for s in (result.diagnosis_skills + result.treatment_skills):
            retrieved.append({
                "skill_id":          s.get("skill_id") or s.get("doc_id"),
                "name":              s.get("name") or f"{s.get('disease_type')} {s.get('subtype')}",
                "skill_type":        s.get("skill_type", ""),
                "disease_type":      s.get("disease_type", ""),
                "subtype":           s.get("subtype", "General"),
                "score":             s.get("final_score", 0.0),
                "body":              s.get("body", {}),
                "trigger_keywords":  s.get("trigger_keywords", []),
                "guideline":         s.get("guideline", ""),
                "guideline_version": s.get("guideline_version", ""),
                "source_pages":      s.get("source_pages", []),
                "confidence":        s.get("confidence", {}),
            })

        # ── PHASE 4 — dedupe (generic: skill_type/disease_type/subtype) ──
        retrieved = deduplicate_skills(retrieved)

        state["retrieved_skills"] = retrieved
        state["skill_usage_log"]  = []

        # ── PHASE 1 — route into agent-specific buckets (generic, data-driven) ──
        state.update(route_skills_to_agents(retrieved))

        # ── PHASE 1/9 — validation logs ──
        logger.info(f"Retrieved: {len(retrieved)}")
        for bucket_key in list(state.keys()):
            if bucket_key.endswith("_skills") and bucket_key != "retrieved_skills":
                logger.info(f"{bucket_key}: {len(state[bucket_key])}")

        # ── PHASE 2 (MOST IMPORTANT) — slim prompt-facing buckets via
        # filter_skill_for_agent(). guideline_skills is intentionally left
        # UNFILTERED — SkillApplicationAgent and GuidelinePathwayMappingAgent
        # need the full body (up to 3000 chars) for matched-criterion analysis.
        for bucket_key, bucket_skills in list(state.items()):
            if bucket_key.endswith("_skills") and bucket_key not in ("retrieved_skills", "guideline_skills"):
                state[bucket_key] = [filter_skill_for_agent(s) for s in bucket_skills]

        # ── PHASE 5 — lightweight skill summaries, available right after retrieval ──
        state["skill_summaries"] = [build_skill_summary(s) for s in retrieved]

        # Cache immediately so GET /skill-retrieval/{doctor_id}/{patient_id}
        # works even before the rest of the pipeline finishes.

        await retrieved_skills_collection.update_one(
            {"patient_id": di.patient_id, "doctor_id": di.doctor_id},
            {"$set": {
                "skills":           retrieved,
                "retrieval_method": result.retrieval_method,
                "updated_at":       datetime.utcnow(),
            }},
            upsert=True,
        )

        logger.info(f"SkillRetrievalAgent: {len(retrieved)} skills retrieved from patient_summary + cached")
        return state


# ──────────────────────────────────────────────────────────────────────────────
# A1  CLINICAL LANGUAGE UNDERSTANDING  (v3.1 — structured skill_contributions)
# ──────────────────────────────────────────────────────────────────────────────

class ClinicalLanguageAgent:
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def process(self, state: DiagnosticState) -> DiagnosticState:
        logger.info("ClinicalLanguageAgent — START")
        di = state["diagnostic_input"]
        diagnosis_skills = _get_bucket_skills(state, "diagnosis_skills", "diagnosis")
        skills_block = _format_skills_for_prompt(diagnosis_skills)

        prompt = f"""You are a medical NLP expert extracting structured data from clinical notes.

RETRIEVED CLINICAL SKILLS (doctor-approved guideline knowledge — use these to
recognize disease-specific terminology, expected biomarkers, and relevant
findings that might otherwise be missed):
{skills_block}

DOCTOR'S NOTE / DICTATION:
{di.doctor_note_or_dictation}

PATIENT LONGITUDINAL MEDICAL CONTEXT:
{di.patient_context_summary}

CONTEXT: Visit={di.visit_type} | Specialty={di.doctor_speciality}
Medical History: {di.medical_history_summary}
Latest Labs: {di.latest_lab_summary}
Latest Imaging: {di.latest_imaging_summary}

TASK: Extract structured clinical information strictly from the above.
Common shorthand: c/o=complains of, SOB=shortness of breath, R/O=rule out,
HTN=hypertension, DM=diabetes mellitus, H/O=history of.

OUTPUT (JSON only, no markdown):
{{
  "symptoms": ["..."],
  "clinical_findings": ["..."],
  "doctor_hypothesis": null,
  "alternative_hypothesis": ["..."],
  "ruleout_conditions": ["..."],
  "pending_tests": ["..."],
  "skill_contributions": [
    {{
      "skill_id": "skill_id value from the retrieved skills above",
      "skill_name": "name of that skill",
      "contribution": "ONE short sentence: exactly what terminology/finding this skill helped you recognize, e.g. 'Recognized regressed germinal centers and hyalinized vessels as Castleman-specific pathology terms.' Use [] if no skill helped."
    }}
  ]
}}"""

        try:
            response = self.llm.invoke([
                SystemMessage(content="Medical NLP extraction engine. Output only valid JSON."),
                HumanMessage(content=prompt),
            ])
            result = _parse_json(response.content)
            dh = result.get("doctor_hypothesis")

            invalid_values = [
                "primary suspected diagnosis or null",
                "null",
                "none",
                ""
            ]

            if isinstance(dh, str) and dh.lower().strip() in invalid_values:
                result["doctor_hypothesis"] = None
            if result.get("doctor_hypothesis"):
                result["doctor_hypothesis"] = result["doctor_hypothesis"].replace("?", "").strip()

            def normalize_list_of_strings(items):
                normalized = []
                for item in items or []:
                    if isinstance(item, str):
                        normalized.append(item)
                    elif isinstance(item, dict):
                        parts = []
                        for k, v in item.items():
                            if isinstance(v, list):
                                v = ", ".join(map(str, v))
                            parts.append(f"{k}: {v}")
                        normalized.append("; ".join(parts))
                    else:
                        normalized.append(str(item))
                return normalized

            result["clinical_findings"] = normalize_list_of_strings(result.get("clinical_findings"))
            result["symptoms"] = normalize_list_of_strings(result.get("symptoms"))

            skill_contributions = _extract_skill_contributions(result)
            skill_ids_used   = [c["skill_id"] for c in skill_contributions if c.get("skill_id")]
            skill_names_used = [c["skill_name"] for c in skill_contributions if c.get("skill_name")]
            reason_text = "; ".join(c["contribution"] for c in skill_contributions if c.get("contribution"))

            state["structured_clinical_data"] = ClinicalLanguageOutput(**result)
            _log_skill_usage(
                state, "ClinicalLanguageAgent", skill_ids_used,
                content_used=reason_text or "terminology/finding recognition",
                skill_names=skill_names_used,
                reason_used=reason_text,
            )
            logger.info(f"Symptoms: {result.get('symptoms')}")
            logger.info(f"Hypothesis: {result.get('doctor_hypothesis')}")
        except Exception as e:
            logger.error(f"ClinicalLanguageAgent failed: {e}")
            state["error"] = str(e)
            state["warnings"].append("Clinical language extraction incomplete")
        return state


# ──────────────────────────────────────────────────────────────────────────────
# A2  EVIDENCE GRAPH BUILDER  (unchanged)
# ──────────────────────────────────────────────────────────────────────────────

class EvidenceGraphBuilder:
    async def build(self, state: DiagnosticState) -> DiagnosticState:
        logger.info("EvidenceGraphBuilder — START")
        di           = state["diagnostic_input"]
        clinical     = state.get("structured_clinical_data")

        graph  = nx.DiGraph()
        nodes: List[EvidenceNode] = []
        edges: List[EvidenceEdge] = []

        def sanitize(t: str) -> str:
            return re.sub(r"[^a-z0-9_]", "_", t.lower())[:50]

        if clinical:
            for s in clinical.symptoms:
                nid = f"symptom_{sanitize(s)}"
                nodes.append(EvidenceNode(node_id=nid, node_type=NodeType.SYMPTOM, value=s))
                graph.add_node(nid, type="symptom", value=s, weight=1.0)

            for f in clinical.clinical_findings:
                nid = f"finding_{sanitize(f)}"
                nodes.append(EvidenceNode(node_id=nid, node_type=NodeType.IMAGING_FINDING, value=f, weight=1.2))
                graph.add_node(nid, type="finding", value=f, weight=1.2)

            if clinical.doctor_hypothesis:
                hid = f"hypothesis_{sanitize(clinical.doctor_hypothesis)}"
                nodes.append(EvidenceNode(node_id=hid, node_type=NodeType.DISEASE_HYPOTHESIS, value=clinical.doctor_hypothesis, weight=2.0))
                graph.add_node(hid, type="hypothesis", value=clinical.doctor_hypothesis, weight=2.0)
                for s in clinical.symptoms:
                    sid = f"symptom_{sanitize(s)}"
                    edges.append(EvidenceEdge(source=sid, target=hid, relationship=EvidenceRelationship.SUPPORTS, strength=0.7))
                    graph.add_edge(sid, hid, relationship="supports", strength=0.7)

            for alt in clinical.alternative_hypothesis:
                nid = f"hypothesis_{sanitize(alt)}"
                nodes.append(EvidenceNode(node_id=nid, node_type=NodeType.DISEASE_HYPOTHESIS, value=alt, weight=1.0))
                graph.add_node(nid, type="hypothesis", value=alt, weight=1.0)

        if di.latest_lab_summary:
            for pat in [r"(\w+):\s*([\d.]+)", r"(\w+)\s+elevated", r"(\w+)\s+decreased"]:
                for m in re.finditer(pat, di.latest_lab_summary, re.IGNORECASE):
                    lname = m.group(1)
                    nid   = f"lab_{sanitize(lname)}"
                    nodes.append(EvidenceNode(node_id=nid, node_type=NodeType.LAB_RESULT, value=m.group(0), weight=1.5))
                    graph.add_node(nid, type="lab", value=m.group(0), weight=1.5)

        if di.latest_imaging_summary:
            for pat in ["mass","lesion","nodule","calcification","lymph node","effusion","infiltrate","consolidation"]:
                if pat in di.latest_imaging_summary.lower():
                    nid = f"imaging_{sanitize(pat)}"
                    nodes.append(EvidenceNode(node_id=nid, node_type=NodeType.IMAGING_FINDING, value=pat, weight=1.5))
                    graph.add_node(nid, type="imaging", value=pat, weight=1.5)

        state["evidence_graph"] = graph
        state["evidence_nodes"] = nodes
        state["evidence_edges"] = edges
        logger.info(f"Evidence graph: {len(nodes)} nodes, {len(edges)} edges")
        return state


# ──────────────────────────────────────────────────────────────────────────────
# A3  DIFFERENTIAL GENERATOR  (v3.1 — structured skill_contributions)
# ──────────────────────────────────────────────────────────────────────────────

class DifferentialDiagnosisGenerator:
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def generate(self, state: DiagnosticState) -> DiagnosticState:
        logger.info("DifferentialDiagnosisGenerator — START")
        di      = state["diagnostic_input"]
        clinical = state.get("structured_clinical_data")
        diagnosis_skills = _get_bucket_skills(state, "diagnosis_skills", "diagnosis")
        skills_block = _format_skills_for_prompt(diagnosis_skills)

        prompt = f"""
You are an expert physician analyzing a patient case.

RETRIEVED CLINICAL SKILLS (doctor-approved guideline knowledge for this case
— prefer disease names these skills point toward, when supported by the
patient's symptoms/findings):
{skills_block}

Patient: Age {di.age}, {di.gender}
Context: {di.patient_context_summary}
Symptoms: {clinical.symptoms if clinical else []}
History: {di.medical_history_summary}
Labs: {di.latest_lab_summary}
Imaging: {di.latest_imaging_summary}
Doctor note: {di.doctor_note_or_dictation}

Generate the 3 most likely DIFFERENT diseases.
Rules:
- Do NOT repeat the same disease with different wording.
- Only use diseases supported by symptoms or findings.
- If a retrieved skill points toward a specific disease AND it is supported
  by the symptoms/findings above, prefer it.

Return JSON only.
{{
  "differentials": ["disease1","disease2","disease3"],
  "skill_contributions": [
    {{
      "skill_id": "skill_id value from the retrieved skills above",
      "skill_name": "name of that skill",
      "contribution": "ONE short sentence: what this skill made you prefer or rule out, e.g. 'Reduced likelihood of lymphoma because no multicentric disease or B symptoms were identified.' Use [] if no skill influenced the list."
    }}
  ]
}}"""

        try:
            response = self.llm.invoke([
                SystemMessage(content="Generate clinical differential diagnoses."),
                HumanMessage(content=prompt),
            ])
            parsed  = _parse_json(response.content)
            state["candidate_diseases"] = parsed.get("differentials", [])

            skill_contributions = _extract_skill_contributions(parsed)
            skill_ids_used   = [c["skill_id"] for c in skill_contributions if c.get("skill_id")]
            skill_names_used = [c["skill_name"] for c in skill_contributions if c.get("skill_name")]
            reason_text = "; ".join(c["contribution"] for c in skill_contributions if c.get("contribution"))

            _log_skill_usage(
                state, "DifferentialDiagnosisGenerator", skill_ids_used,
                content_used=reason_text or "differential disease selection",
                skill_names=skill_names_used,
                reason_used=reason_text,
            )
            logger.info(f"Differentials: {state['candidate_diseases']}")
        except Exception as e:
            logger.error(f"Differential generation failed: {e}")
            state["candidate_diseases"] = []
        return state


# ──────────────────────────────────────────────────────────────────────────────
# A4  KNOWLEDGE GRAPH  (unchanged)
# ──────────────────────────────────────────────────────────────────────────────

class KnowledgeGraphAgent:
    def __init__(self, neo4j_manager: Neo4jConnectionManager):
        self.neo4j = neo4j_manager

    async def retrieve_candidates(self, state: DiagnosticState) -> DiagnosticState:
        logger.info("KnowledgeGraphAgent — START")
        clinical  = state.get("structured_clinical_data")
        symptoms  = clinical.symptoms if clinical else []
        existing  = state.get("candidate_diseases", [])

        candidates = self.neo4j.query_candidate_diseases(symptoms=symptoms, risk_factors=[], lab_markers=[])

        if len(candidates) < 3 and clinical and clinical.alternative_hypothesis:
            for alt in clinical.alternative_hypothesis:
                if alt not in candidates:
                    candidates.append(alt)
        invalid_values = [
            None,
            "",
            "null",
            "none",
            "primary suspected diagnosis or null"
        ]

        if clinical and clinical.doctor_hypothesis:
            dh = clinical.doctor_hypothesis.lower().strip()
            if dh not in invalid_values:
                if clinical.doctor_hypothesis not in candidates:
                    candidates.insert(0, clinical.doctor_hypothesis)

        for alt in (clinical.alternative_hypothesis if clinical else []):
            if alt not in candidates:
                candidates.append(alt)

        combined                  = list(dict.fromkeys(existing + candidates))
        state["candidate_diseases"] = combined
        logger.info(f"Combined candidates: {combined}")
        return state


# ──────────────────────────────────────────────────────────────────────────────
# A5  PROBABILISTIC SCORING  (unchanged)
# ──────────────────────────────────────────────────────────────────────────────

class ProbabilisticDiagnosisEngine:
    def __init__(self, llm: ChatGroq, neo4j_manager: Neo4jConnectionManager):
        self.llm   = llm
        self.neo4j = neo4j_manager

    async def score_diagnoses(self, state: DiagnosticState) -> DiagnosticState:
        logger.info("ProbabilisticDiagnosisEngine — START")
        candidates = state.get("candidate_diseases", [])
        clinical   = state.get("structured_clinical_data")
        graph      = state.get("evidence_graph")
        di         = state["diagnostic_input"]

        if not candidates:
            state["warnings"].append("No disease candidates to score")
            return state

        scored: List[DiagnosisCandidate] = []

        for idx, disease in enumerate(candidates):
            expected           = self.neo4j.get_disease_relationships(disease)
            supporting, conflicting = [], []

            if not expected.get("symptoms"):
                expected["symptoms"] = clinical.symptoms[:1] if clinical else []

            for symptom in (clinical.symptoms if clinical else []):
                for es in expected.get("symptoms", []):
                    if not es:
                        continue
                    if fuzz.partial_ratio(es.lower(), symptom.lower()) > 75:
                        if disease.lower() not in symptom.lower():
                            supporting.append(f"Symptom: {symptom}")
                        break

            if di.latest_lab_summary:
                lab_text = di.latest_lab_summary.lower()
                for lm in expected.get("lab_markers", []):
                    if lm.lower() in lab_text:
                        supporting.append(f"Lab: {lm}")

            probability = self._calculate_probability(
                disease=disease,
                supporting_evidence=supporting,
                conflicting_evidence=conflicting,
                doctor_hypothesis=clinical.doctor_hypothesis if clinical else None,
                evidence_graph=graph,
            )
            followup = state.get("followup_analysis")

            if followup:
                if followup.get("diagnosis_action") == "confirm":
                    probability += 0.15
                elif followup.get("diagnosis_action") == "modify":
                    probability -= 0.1
                elif followup.get("diagnosis_action") == "replace":
                    probability -= 0.5
                    logger.info(f"Replacing diagnosis for {disease}, reducing probability to {probability}")

            missing_ev    = [f"Expected symptom: {s}" for s in expected.get("symptoms", []) if clinical and s not in clinical.symptoms]
            required_tests = expected.get("lab_markers", [])

            # ISSUE 4 FIX — rank-decay. Sparse symptom-overlap scoring alone
            # tends to give every differential a near-identical score;
            # `candidates`' existing order (doctor hypothesis / LLM's top
            # pick first) should count for something.
            probability = max(0.05, probability * max(0.55, 1 - (0.12 * idx)))

            scored.append(DiagnosisCandidate(
                disease=disease,
                probability=probability,
                supporting_evidence=supporting,
                conflicting_evidence=conflicting,
                required_tests=required_tests,
                missing_evidence=missing_ev,
            ))

        scored.sort(key=lambda x: x.probability, reverse=True)

        # ISSUE 4 FIX — enforce a realistic confidence gap between the
        # primary hypothesis and its differentials.
        for i in range(1, len(scored)):
            max_allowed = scored[i - 1].probability - 0.05
            if scored[i].probability > max_allowed:
                scored[i].probability = max(0.0, max_allowed)

        state["scored_diagnoses"] = scored

        clinical = state.get("structured_clinical_data")

        if clinical:
            dh = clinical.doctor_hypothesis
            invalid_values = [
                None, "", "null", "none", "primary suspected diagnosis or null"
            ]
            if not dh or str(dh).lower().strip() in invalid_values:
                if scored:
                    clinical.doctor_hypothesis = scored[0].disease
                    logger.info(f"🔥 Auto-set primary diagnosis: {scored[0].disease}")

        logger.info(f"Scored: {[(d.disease, d.probability) for d in scored]}")
        return state

    def _calculate_probability(
        self,
        disease: str,
        supporting_evidence: List[str],
        conflicting_evidence: List[str],
        doctor_hypothesis: Optional[str],
        evidence_graph: Optional[nx.DiGraph],
    ) -> float:
        base      = 0.2
        sym_score = len(supporting_evidence) * 0.2
        specificity = 0.1 if "cancer" in disease.lower() else (0.05 if "infection" in disease.lower() else 0)
        conflict  = len(conflicting_evidence) * 0.25
        doc_boost = 0.25 if doctor_hypothesis and disease.lower() == doctor_hypothesis.lower() else 0.0
        graph_boost = 0.0

        if evidence_graph:
            nid = f"hypothesis_{disease.lower().replace(' ','_')[:50]}"
            if nid in evidence_graph:
                try:
                    graph_boost = nx.degree_centrality(evidence_graph).get(nid, 0) * 0.15
                except:
                    pass

        return max(0.0, min(1.0, base + sym_score + doc_boost + graph_boost + specificity - conflict))


# ──────────────────────────────────────────────────────────────────────────────
# A6  DISEASE CHARACTERIZATION  (unchanged)
# ──────────────────────────────────────────────────────────────────────────────

class DiseaseCharacterizationAgent:
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def characterize(self, state: DiagnosticState) -> DiagnosticState:
        logger.info("DiseaseCharacterizationAgent — START")
        diagnoses = state.get("scored_diagnoses", [])
        clinical  = state.get("structured_clinical_data")
        di        = state["diagnostic_input"]

        for diag in diagnoses[:4]:
            prompt = f"""
Disease: {diag.disease}
Patient context: {di.patient_context_summary}
Age: {di.age} | Gender: {di.gender}
Symptoms: {clinical.symptoms if clinical else []}
Findings: {clinical.clinical_findings if clinical else []}
Imaging: {di.latest_imaging_summary}
Labs: {di.latest_lab_summary}

Return JSON only:
{{"type":"disease subtype","stage":"clinical stage","size":"measurement if applicable"}}"""

            try:
                response = self.llm.invoke([
                    SystemMessage(content="Return disease characterization."),
                    HumanMessage(content=prompt),
                ])
                parsed = _parse_json(response.content)
                diag.disease_type = parsed.get("type")
                diag.stage        = parsed.get("stage")
                diag.tumor_size   = parsed.get("size")
            except Exception as e:
                logger.error(e)
        return state


# ──────────────────────────────────────────────────────────────────────────────
# A7  SEVERITY SCORING  (unchanged)
# ──────────────────────────────────────────────────────────────────────────────

class SeverityScoringAgent:
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def score(self, state: DiagnosticState) -> DiagnosticState:
        logger.info("SeverityScoringAgent — START")
        scored = state.get("scored_diagnoses", [])
        if not scored:
            return state

        clinical = state.get("structured_clinical_data") or ClinicalLanguageOutput()
        primary  = scored[0]

        prompt = f"""
Patient symptoms: {clinical.symptoms}
Findings: {clinical.clinical_findings}
Disease: {primary.disease}
Return JSON: {{"severity": "mild | moderate | severe | critical"}}"""

        try:
            response = self.llm.invoke([
                SystemMessage(content="Clinical severity scoring."),
                HumanMessage(content=prompt),
            ])
            parsed        = _parse_json(response.content)
            primary.severity = parsed.get("severity")
        except Exception as e:
            logger.error(e)
        return state


# ──────────────────────────────────────────────────────────────────────────────
# A8  HYPOTHESIS → DIAGNOSIS REASONING  (v3.1 — structured skill_contributions)
# ──────────────────────────────────────────────────────────────────────────────

class HypothesisToDiagnosisReasoningAgent:
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def reason(self, state: DiagnosticState) -> DiagnosticState:
        logger.info("HypothesisToDiagnosisReasoningAgent — START")

        scored   = state.get("scored_diagnoses", [])
        clinical = state.get("structured_clinical_data")
        di       = state["diagnostic_input"]

        if not scored:
            return state

        primary = scored[0]
        diagnosis_skills = _get_bucket_skills(state, "diagnosis_skills", "diagnosis")
        skills_block = _format_skills_for_prompt(diagnosis_skills)

        prompt = f"""
You are a senior {di.doctor_speciality} specialist.

Your task is to formally document your clinical reasoning pathway from initial
hypothesis through to diagnostic confidence and treatment readiness — exactly
as you would present at a multidisciplinary team meeting or a formal case review.

═══════════════════════════════════════════════
PATIENT DATA
═══════════════════════════════════════════════
Age: {di.age} | Gender: {di.gender} | Specialty: {di.doctor_speciality}

FULL PATIENT CONTEXT:
{di.patient_context_summary}
FOLLOW-UP ANALYSIS:
{state.get("followup_analysis")}

RETRIEVED CLINICAL SKILLS (doctor-approved guideline knowledge — use these,
not just general medical knowledge, to judge what confirms/refutes the
hypothesis and what the gold-standard confirmatory test actually is):
{skills_block}

DOCTOR'S DICTATION / NOTE:
{di.doctor_note_or_dictation}

SYMPTOMS (extracted): {clinical.symptoms if clinical else []}
CLINICAL FINDINGS:    {clinical.clinical_findings if clinical else []}
LAB RESULTS:          {di.latest_lab_summary}
IMAGING:              {di.latest_imaging_summary}
MEDICAL HISTORY:      {di.medical_history_summary}
PROCEDURES DONE:      {di.procedure_summary}
MEDICATIONS:          {di.last_medications}

PRIMARY HYPOTHESIS:   {primary.disease}
CURRENT PROBABILITY:  {primary.probability:.2f}
DISEASE TYPE/STAGE:   {primary.disease_type} / {primary.stage}
SUPPORTING EVIDENCE:  {primary.supporting_evidence}
CONFLICTING EVIDENCE: {primary.conflicting_evidence}

DIFFERENTIAL DIAGNOSES (in order):
{[f"{i+1}. {d.disease} (p={d.probability:.2f})" for i, d in enumerate(scored[:5])]}

═══════════════════════════════════════════════
REASONING TASK
═══════════════════════════════════════════════

Think and document like a specialist who is:
(a) Building a clinical case for the primary hypothesis
(b) Systematically ruling out the differentials
(c) Evaluating what is confirmed vs what is still missing

STEP 1 — INITIAL CLINICAL SUSPICION
  Why does this patient's presentation raise suspicion for {primary.disease}?
  Which specific symptoms/findings are the "alarm features" pointing to this diagnosis?
  What is the pre-test probability based on age, gender, history alone?

STEP 2 — FIRST-LINE WORKUP INTERPRETATION
  Which investigations from the patient record directly address this hypothesis?
  For each investigation that IS present: what does the result show?
  For each finding: does it SUPPORT, REFUTE, or give INCONCLUSIVE evidence for the hypothesis?

STEP 3 — RULING OUT DIFFERENTIALS
  For each differential diagnosis in the list above:
  What is the single most important test or finding that would distinguish it from {primary.disease}?
  Is that test done? What does the result show?

STEP 4 — CONFIRMATORY WORKUP GAP
  What is the GOLD-STANDARD confirmatory test for {primary.disease}, per the
  retrieved clinical skills above (if a matching skill exists)?
  Has it been done? If yes, what was the result?
  If no — what is the minimum required to reach diagnostic threshold for treatment?

STEP 5 — DIAGNOSTIC GATE
  Based on ALL available evidence, what is the current diagnostic confidence level?
  Diagnostic gate: "ready" | "conditional" | "not_ready" | "refuted"
  What specific items are blocking a higher confidence level?

STEP 6 — TREATMENT READINESS
  To begin the standard first-line treatment for {primary.disease}:
  Which criteria are CONFIRMED from available data?
  Which criteria are PENDING (test ordered, result awaited)?
  Which criteria are NOT YET ASSESSED (test not yet ordered)?

Return ONLY valid JSON:
{{
  "primary_hypothesis": "{primary.disease}",
  "confidence_at_entry": 0.0,
  "confidence_current": 0.0,
  "confidence_for_treatment": 0.0,
  "steps": [
    {{
      "step_number": 1,
      "step_label": "Initial clinical suspicion",
      "reasoning": "...",
      "evidence_available": ["..."],
      "evidence_missing": ["..."],
      "outcome": "partially_supported | confirmed | refuted | pending",
      "next_required": "..."
    }}
  ],
  "diagnosis_gate": "ready | conditional | not_ready | refuted",
  "gate_blockers": ["..."],
  "gate_conditions": ["..."],
  "confirmatory_tests_pending": ["..."],
  "ruling_out": [
    {{
      "disease": "...",
      "distinguishing_test": "...",
      "test_done": true,
      "result": "...",
      "status": "ruled_out | still_possible | confirmed_alternative"
    }}
  ],
  "specialist_summary": "3-5 sentence specialist narrative covering: what the presentation suggests, what the evidence confirms so far, what is still needed, and what the current treatment readiness is.",
  "skill_contributions": [
    {{
      "skill_id": "skill_id value from the retrieved skills above",
      "skill_name": "name of that skill",
      "contribution": "ONE short sentence stating concretely what this skill contributed to the diagnostic gate decision, e.g. '4 of 5 diagnostic criteria satisfied, supporting confirmation.' Use [] if no skill shaped this reasoning."
    }}
  ]
}}"""

        try:
            response = self.llm.invoke([
                SystemMessage(content=(
                    f"You are a senior {di.doctor_speciality} specialist documenting "
                    "your diagnostic reasoning process. Be rigorous, specific, and evidence-based. "
                    "Output only valid JSON."
                )),
                HumanMessage(content=prompt),
            ])
            parsed = _parse_json(response.content)

            skill_contributions = _extract_skill_contributions(parsed)

            reasoning = HypothesisReasoningOutput(
                primary_hypothesis       = parsed.get("primary_hypothesis", primary.disease),
                confidence_at_entry      = float(parsed.get("confidence_at_entry", 0.2)),
                confidence_current       = float(parsed.get("confidence_current", primary.probability)),
                confidence_for_treatment = float(parsed.get("confidence_for_treatment", 0.8)),
                steps                    = [HypothesisStep(**s) for s in parsed.get("steps", [])],
                diagnosis_gate           = parsed.get("diagnosis_gate", "not_ready"),
                gate_blockers            = parsed.get("gate_blockers", []),
                gate_conditions          = parsed.get("gate_conditions", []),
                confirmatory_tests_pending = parsed.get("confirmatory_tests_pending", []),
                ruling_out               = [r.get("disease","") for r in parsed.get("ruling_out", [])],
                specialist_summary       = parsed.get("specialist_summary", ""),
            )

            # ISSUE 5 FIX — a diagnosis the specialist reasoning has gated as
            # "ready" (confirmatory criteria met) should read as clearly more
            # certain than suspicion alone; "refuted" should pull it down.
            if reasoning.diagnosis_gate == "ready":
                primary.probability = max(primary.probability, 0.8)
            elif reasoning.diagnosis_gate == "refuted":
                primary.probability = min(primary.probability, 0.2)

            state["hypothesis_reasoning"] = reasoning

            skill_ids_used   = [c["skill_id"] for c in skill_contributions if c.get("skill_id")]
            skill_names_used = [c["skill_name"] for c in skill_contributions if c.get("skill_name")]
            reason_text = "; ".join(c["contribution"] for c in skill_contributions if c.get("contribution"))

            _log_skill_usage(
                state, "HypothesisToDiagnosisReasoningAgent", skill_ids_used,
                content_used=reason_text or "diagnostic gate / confirmatory test reasoning",
                skill_names=skill_names_used,
                reason_used=reason_text,
                impact=f"diagnosis_gate={reasoning.diagnosis_gate}",
            )
            logger.info(f"Diagnosis gate: {reasoning.diagnosis_gate}")
            logger.info(f"Gate blockers: {reasoning.gate_blockers}")
        except Exception as e:
            logger.error(f"HypothesisToDiagnosisReasoningAgent failed: {e}")

        return state


class FollowUpClinicalReasoningAgent:
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def analyze(self, state: DiagnosticState) -> DiagnosticState:
        di = state["diagnostic_input"]
        logger.info(f"🔍 FollowUpClinicalReasoningAgent - Visit type: {di.visit_type}")
        if di.visit_type != VisitType.FOLLOWUP_VISIT:
            return state
        logger.info("✅ FollowUpClinicalReasoningAgent - Processing follow-up visit")

        clinical = state.get("structured_clinical_data")
        current_dictation = di.doctor_note_or_dictation

        previous_diagnosis = ""
        scored = state.get("scored_diagnoses", [])
        if scored:
            previous_diagnosis = scored[0].disease

        prompt = f"""
You are a senior {di.doctor_speciality} specialist reviewing a FOLLOW-UP visit.

⚠️ CRITICAL: The patient's CURRENT symptoms may be COMPLETELY DIFFERENT from their previous diagnosis.

═══════════════════════════════════════════════════════════════════
CURRENT DICTATION (THIS IS WHAT THE PATIENT IS PRESENTING WITH NOW):
═══════════════════════════════════════════════════════════════════
{current_dictation}

═══════════════════════════════════════════════════════════════════
PREVIOUS DIAGNOSIS (FROM PRIOR VISIT - FOR REFERENCE ONLY):
═══════════════════════════════════════════════════════════════════
{previous_diagnosis}

═══════════════════════════════════════════════════════════════════
CURRENT SYMPTOMS (extracted from dictation):
═══════════════════════════════════════════════════════════════════
Symptoms: {clinical.symptoms if clinical else []}
Findings: {clinical.clinical_findings if clinical else []}

═══════════════════════════════════════════════════════════════════
YOUR TASK - CRITICAL DECISION:
═══════════════════════════════════════════════════════════════════

1. Compare the CURRENT SYMPTOMS with the PREVIOUS DIAGNOSIS:

   - If the current symptoms are COMPLETELY DIFFERENT and unrelated to the previous diagnosis:
     → This is a NEW PRIMARY CANCER or NEW CONDITION
     → diagnosis_action = "replace"

   - If the current symptoms match or are related to the previous diagnosis:
     → This is a follow-up for the same condition
     → diagnosis_action = "confirm"

2. Based on the CURRENT SYMPTOMS ONLY, determine the appropriate diagnosis.

3. Provide the diagnostic reasoning that explains why this is a new condition.

Return ONLY valid JSON:
{{
  "status": "improving | stable | worsening | new_condition",
  "previous_diagnosis_valid": false,
  "diagnosis_action": "confirm | replace",
  "new_diagnosis": "the actual diagnosis based on current symptoms only",
  "confidence": 0.0-1.0,
  "diagnosis_gate": "ready | conditional | not_ready | refuted",
  "gate_blockers": ["list of what's blocking definitive diagnosis"],
  "specialist_summary": "clinical summary explaining the current presentation and diagnostic status",
  "reasoning": "clear clinical explanation why this is a new condition or follow-up of same"
}}
"""

        try:
            response = self.llm.invoke([
                SystemMessage(content="Follow-up reasoning engine. If symptoms are completely different from previous diagnosis, diagnose NEW condition and set diagnosis_action='replace'."),
                HumanMessage(content=prompt)
            ])

            parsed = _parse_json(response.content)
            logger.info(f"FollowUp agent result: {parsed}")
            state["followup_analysis"] = parsed

            if parsed.get("diagnosis_action") == "replace" and parsed.get("new_diagnosis"):
                new_diagnosis_name = parsed.get("new_diagnosis")
                new_confidence = float(parsed.get("confidence", 0.85))
                new_gate = parsed.get("diagnosis_gate", "conditional")
                new_blockers = parsed.get("gate_blockers", [])
                new_summary = parsed.get("specialist_summary", "")

                logger.info(f"🔄 REPLACING diagnosis with new condition: {new_diagnosis_name} (confidence: {new_confidence})")

                symptoms = clinical.symptoms if clinical else []
                findings = clinical.clinical_findings if clinical else []

                supporting_evidence = []
                for s in symptoms:
                    supporting_evidence.append(f"Symptom: {s}")
                for f in findings[:3]:
                    supporting_evidence.append(f"Finding: {f}")

                new_diagnosis = DiagnosisCandidate(
                    disease=new_diagnosis_name,
                    probability=new_confidence,
                    disease_type=None,
                    stage=None,
                    tumor_size=None,
                    supporting_evidence=supporting_evidence,
                    conflicting_evidence=[],
                    required_tests=[],
                    missing_evidence=[],
                    severity=None,
                    guideline_sources=[],
                    guideline_pathways=[]
                )

                scored = state.get("scored_diagnoses", [])
                if scored:
                    other_diagnoses = []
                    for dx in scored[1:]:
                        if dx.disease.lower() not in [new_diagnosis_name.lower()]:
                            other_diagnoses.append(dx)

                    new_scored = [new_diagnosis]
                    for dx in other_diagnoses[:3]:
                        new_scored.append(dx)

                    if len(new_scored) < 2 and ("skin" in new_diagnosis_name.lower() or "cancer" in new_diagnosis_name.lower() or "carcinoma" in new_diagnosis_name.lower()):
                        default_dx1 = DiagnosisCandidate(
                            disease="Basal Cell Carcinoma", probability=0.30,
                            supporting_evidence=["Sun exposure history", "Similar presentation"],
                            required_tests=["Biopsy"],
                        )
                        default_dx2 = DiagnosisCandidate(
                            disease="Melanoma", probability=0.25,
                            supporting_evidence=["Pigmented lesion", "Family history"],
                            required_tests=["Biopsy"],
                        )
                        default_dx3 = DiagnosisCandidate(
                            disease="Actinic Keratosis", probability=0.20,
                            supporting_evidence=["Scaly patches", "Sun damage"],
                            required_tests=["Biopsy"],
                        )
                        if default_dx1.disease.lower() != new_diagnosis_name.lower():
                            new_scored.append(default_dx1)
                        if default_dx2.disease.lower() != new_diagnosis_name.lower() and len(new_scored) < 4:
                            new_scored.append(default_dx2)
                        if default_dx3.disease.lower() != new_diagnosis_name.lower() and len(new_scored) < 5:
                            new_scored.append(default_dx3)

                    state["scored_diagnoses"] = new_scored
                    logger.info(f"New scored diagnoses count: {len(new_scored)} (including {len(new_scored)-1} differentials)")
                else:
                    state["scored_diagnoses"] = [new_diagnosis]

                hypothesis = state.get("hypothesis_reasoning")
                if hypothesis:
                    hypothesis.primary_hypothesis = new_diagnosis_name
                    hypothesis.confidence_current = new_confidence
                    hypothesis.diagnosis_gate = new_gate
                    hypothesis.gate_blockers = new_blockers
                    hypothesis.specialist_summary = new_summary
                    state["hypothesis_reasoning"] = hypothesis

                logger.info(f"✅ Scored diagnoses replaced with new diagnosis: {new_diagnosis_name}")

        except Exception as e:
            logger.error(f"FollowUp agent failed: {e}")
            state["followup_analysis"] = None

        return state


# ──────────────────────────────────────────────────────────────────────────────
# A9  GUIDELINE PATHWAY MAPPING  (unchanged — still consumes primary.guideline_sources,
#     which now comes from retrieved skills instead of the doctor-guidelines API)
# ──────────────────────────────────────────────────────────────────────────────

class GuidelinePathwayMappingAgent:
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def map_pathways(
        self,
        state: DiagnosticState,
        primary_disease: str,
        guidelines: List[Dict],
    ) -> List[GuidelinePathway]:
        logger.info("GuidelinePathwayMappingAgent — START")

        di         = state["diagnostic_input"]
        clinical   = state.get("structured_clinical_data")
        hypothesis = state.get("hypothesis_reasoning")
        scored     = state.get("scored_diagnoses", [])
        primary    = scored[0] if scored else None

        guidelines_json     = json.dumps(guidelines, indent=2, default=str)
        logger.info(
            f"GUIDELINES RECEIVED = "
            f"{json.dumps(guidelines[:3], indent=2, default=str)}"
        )
        hypothesis_steps_json = json.dumps(
            [
                {
                    "step_number":       s.step_number,
                    "step_label":        s.step_label,
                    "reasoning":         s.reasoning,
                    "evidence_available": s.evidence_available,
                    "evidence_missing":  s.evidence_missing,
                    "outcome":           s.outcome,
                }
                for s in (hypothesis.steps if hypothesis else [])
            ],
            indent=2,
        )

        prompt = f"""
You are a senior {di.doctor_speciality} specialist performing a structured guideline
pathway analysis. You must produce a clinically precise, actionable 4-section report
for EACH applicable guideline/skill below.

The analysis must be hypothesis-driven: every confirmed parameter and every missing
investigation must be explicitly linked to the specialist's diagnostic reasoning steps.

═══════════════════════════════════════════════════════════════════
PATIENT PROFILE
═══════════════════════════════════════════════════════════════════
Age: {di.age}  |  Gender: {di.gender}  |  Specialty: {di.doctor_speciality}
Primary Suspected Diagnosis: {primary_disease}
Disease Type: {primary.disease_type if primary else 'Unknown'}
Stage: {primary.stage if primary else 'Unknown'}
Severity: {primary.severity if primary else 'Unknown'}

SYMPTOMS:    {clinical.symptoms if clinical else []}
FINDINGS:    {clinical.clinical_findings if clinical else []}
LABS:        {di.latest_lab_summary}
IMAGING:     {di.latest_imaging_summary}
PROCEDURES:  {di.procedure_summary}
HISTORY:     {di.medical_history_summary}
MEDICATIONS: {di.last_medications}
FULL CONTEXT:
{di.patient_context_summary}

═══════════════════════════════════════════════════════════════════
SPECIALIST HYPOTHESIS REASONING
═══════════════════════════════════════════════════════════════════
Primary hypothesis:         {hypothesis.primary_hypothesis if hypothesis else primary_disease}
Confidence at entry:        {hypothesis.confidence_at_entry if hypothesis else 0.0}
Confidence current:         {hypothesis.confidence_current if hypothesis else 0.0}
Confidence for treatment:   {hypothesis.confidence_for_treatment if hypothesis else 0.8}
Diagnosis gate:             {hypothesis.diagnosis_gate if hypothesis else 'not_ready'}
Gate blockers:              {hypothesis.gate_blockers if hypothesis else []}
Gate conditions:            {hypothesis.gate_conditions if hypothesis else []}
Confirmatory tests pending: {hypothesis.confirmatory_tests_pending if hypothesis else []}
Ruling out:                 {hypothesis.ruling_out if hypothesis else []}

SPECIALIST SUMMARY:
{hypothesis.specialist_summary if hypothesis else 'Not available'}

HYPOTHESIS STEPS:
{hypothesis_steps_json}

═══════════════════════════════════════════════════════════════════
APPLICABLE SKILLS (retrieved from the doctor's approved skill library —
these replace any locally/manually selected guideline list)
═══════════════════════════════════════════════════════════════════
{guidelines_json}

═══════════════════════════════════════════════════════════════════
YOUR TASK — 4-SECTION STRUCTURED ANALYSIS PER SKILL/GUIDELINE
═══════════════════════════════════════════════════════════════════

IMPORTANT:

guideline_name MUST be copied from the skill name.

DO NOT use:
- PDF filename
- guideline title
- NCCN document name
- source document name

Use the skill name exactly.

For EACH item above, produce all four sections below.

SECTION 1 — EVIDENCE AVAILABLE: parameters already confirmed in this
patient's record that are required/recommended by this skill, each mapped to
its guideline_relevance, which hypothesis step it satisfies, and what
decision it enables.

SECTION 2 — MISSING / PENDING: investigations/staging/biomarkers this skill
requires that are missing or incomplete, each with guideline_requirement,
status, importance_for_treatment, hypothesis_step_blocked, ordering_priority,
recommended_action.

SECTION 3 — CLINICAL INTERPRETATION: sufficient_for_treatment_initiation,
treatment_ready_for, limited_by_missing, hypothesis_gate_status (same value
as the hypothesis reasoning gate), hypothesis_gate_narrative,
priority_next_steps.

SECTION 4 — GUIDELINE ALIGNMENT SUMMARY: workup_completion_percent,
confirmed/pending/missing/total criteria, readiness for surgery / systemic
therapy / MDT discussion, readiness_rationale, cross_guideline_consensus,
cross_guideline_conflicts.

DO NOT include parameters that are not present in the patient record.
DO NOT fabricate values.



═══════════════════════════════════════════════════════════════════
OUTPUT — Return ONLY valid JSON
═══════════════════════════════════════════════════════════════════

{{
  "pathway_mappings": [
    {{
      "guideline_name": "skill name exactly as provided",
      "guideline_source":  "...",
      "applicable_for":    "...",
      "pathway_stage":     "...",
      "overall_alignment": "full | partial | insufficient | not_applicable",
      "evidence_available": [
        {{"parameter":"...", "value":"...", "source":"...", "date":"...",
          "guideline_relevance":"...", "hypothesis_link":"...", "decision_enabled":"..."}}
      ],
      "missing_pending": [
        {{"investigation":"...", "guideline_requirement":"...", "status":"MISSING | PENDING",
          "importance_for_treatment":"...", "hypothesis_step_blocked":"...",
          "ordering_priority":1, "recommended_action":"..."}}
      ],
      "clinical_interpretation": {{
        "sufficient_for_treatment_initiation": false,
        "treatment_ready_for": ["..."],
        "limited_by_missing": ["..."],
        "hypothesis_gate_status": "ready | conditional | not_ready | refuted",
        "hypothesis_gate_narrative": "...",
        "priority_next_steps": ["..."]
      }},
      "alignment_summary": {{
        "workup_completion_percent": 0, "confirmed_criteria": 0, "pending_criteria": 0,
        "missing_criteria": 0, "total_criteria": 0,
        "ready_for_surgery": "Yes | Conditional on [...] | No — [reason]",
        "ready_for_systemic_therapy": "Yes | Conditional on [...] | No — [reason]",
        "ready_for_mdt_discussion": "Yes | Conditional on [...] | No — [reason]",
        "readiness_rationale": "...", "cross_guideline_consensus": "...", "cross_guideline_conflicts": "..."
      }},
      "cross_guideline_overlaps": ["..."],
      "confirmed_count": 0, "pending_count": 0, "missing_count": 0
    }}
  ]
}}"""

        try:
            response = self.llm.invoke([
                SystemMessage(content=(
                    f"You are a senior {di.doctor_speciality} specialist performing a "
                    "structured guideline pathway analysis. Every output must be grounded "
                    "in the actual patient record. Output only valid JSON."
                )),
                HumanMessage(content=prompt),
            ])
            parsed   = _parse_json(response.content)
            mappings = parsed.get("pathway_mappings", [])

            skill_lookup = {}

            for g in guidelines:

                skill_name = (
                    g.get("name")
                    or g.get("skill_name")
                    or ""
                )

                guideline_ref = (
                    g.get("guideline")
                    or g.get("guideline_source")
                    or ""
                )

                if guideline_ref:
                    skill_lookup[guideline_ref] = skill_name

            result: List[GuidelinePathway] = []
            for m in mappings:
                guideline_source = m.get(
                    "guideline_source",
                    ""
                )

                skill_name = skill_lookup.get(
                    guideline_source,
                    m.get("guideline_name", "")
                )
                ea = [EvidenceAvailableItem(**x) for x in m.get("evidence_available", [])]
                mp = [MissingPendingItem(**x)    for x in m.get("missing_pending", [])]

                ci_raw = m.get("clinical_interpretation")
                ci     = ClinicalInterpretationBlock(**ci_raw) if ci_raw else None

                as_raw = m.get("alignment_summary")
                als    = GuidelineAlignmentSummary(**as_raw) if as_raw else None

                result.append(GuidelinePathway(
                    guideline_name = skill_name,
                    guideline_source = guideline_source,
                    applicable_for    = m.get("applicable_for", ""),
                    pathway_stage     = m.get("pathway_stage"),
                    overall_alignment = m.get("overall_alignment", "partial"),
                    evidence_available        = ea,
                    missing_pending           = mp,
                    clinical_interpretation   = ci,
                    alignment_summary         = als,
                    cross_guideline_overlaps  = m.get("cross_guideline_overlaps", []),
                    confirmed_count = m.get("confirmed_count", len(ea)),
                    pending_count   = m.get("pending_count", sum(1 for x in mp if x.status == "PENDING")),
                    missing_count   = m.get("missing_count",  sum(1 for x in mp if x.status == "MISSING")),
                ))

            logger.info(f"Mapped {len(result)} guideline/skill pathways")
            return result
        except Exception as e:
            logger.error(f"GuidelinePathwayMappingAgent failed: {e}")
            return []


# ──────────────────────────────────────────────────────────────────────────────
# A10  GUIDELINE VALIDATION  (v3.1 — logs a clinical contribution narrative,
#      not just skill_ids; still no HTTP call — uses state["retrieved_skills"])
# ──────────────────────────────────────────────────────────────────────────────

class GuidelineValidationAgent:
    def __init__(self, llm: ChatGroq):
        self.llm    = llm
        self.mapper = GuidelinePathwayMappingAgent(llm)

    async def validate(self, state: DiagnosticState) -> DiagnosticState:
        logger.info("GuidelineValidationAgent — START (skill-first, no local guideline input)")
        diagnoses        = state.get("scored_diagnoses", [])
        retrieved_skills = state.get("guideline_skills", state.get("retrieved_skills", []))

        if not retrieved_skills or not diagnoses:
            logger.warning("No retrieved skills or diagnoses — skipping guideline validation")
            return state

        primary = diagnoses[0]

        # Build the guideline-shaped list directly from retrieved skills.
        # This REPLACES the old load_doctor_guidelines() HTTP call entirely —
        # no locally/manually-picked guideline list is used anywhere anymore.
        guidelines_from_skills = [
            {
                "title": s.get("name", ""),
                "reference":   s.get("guideline", ""),
                "explanation": f"Skill: {s.get('name')} ({s.get('disease_type')}/{s.get('subtype')})",
                "reason":      f"Retrieved from patient context/dictation via hybrid RAG (score={s.get('score',0):.2f})",
                "skill_id":    s.get("skill_id"),
                "disease_type": s.get("disease_type", ""),
                "subtype":      s.get("subtype", ""),
                "body":        s.get("body", {}),
            }
            for s in retrieved_skills
        ]

        for diagnosis in diagnoses[:4]:
            matching = [
                g for g in guidelines_from_skills
                if diagnosis.disease.lower() in g["explanation"].lower()
                or diagnosis.disease.lower() in (g.get("disease_type","").lower())
            ] or guidelines_from_skills

            diagnosis.guideline_sources = matching

            matched_names = [g.get("title", "") for g in matching if g.get("title")]
            reason_text = (
                f"Sourced {len(matching)} guideline(s)/skill(s) "
                f"({', '.join(matched_names[:3])}{'…' if len(matched_names) > 3 else ''}) "
                f"as the applicable evidence base for '{diagnosis.disease}'."
            )

            _log_skill_usage(
                state, "GuidelineValidationAgent",
                [g["skill_id"] for g in matching if g.get("skill_id")],
                content_used=reason_text,
                skill_names=matched_names,
                reason_used=reason_text,
                impact=f"guideline_sourcing_for={diagnosis.disease}",
            )

        if primary.guideline_sources:
            pathways = await self.mapper.map_pathways(
                state=state,
                primary_disease=primary.disease,
                guidelines=primary.guideline_sources,
            )
            primary.guideline_pathways = pathways

        return state


# ──────────────────────────────────────────────────────────────────────────────
# A10b  SKILL APPLICATION  (v3.1 — Skill Impact Report: matched criterion↔
#       evidence pairs, sections_applied, contribution narrative, qualitative
#       impact level, and supported_by_skills wired onto the primary diagnosis)
# ──────────────────────────────────────────────────────────────────────────────

_SKILL_APPLICATION_SYSTEM = """
You are a senior clinical specialist applying pre-extracted, guideline-derived
skills to a specific patient. For EACH skill given, produce a detailed,
clinician-readable impact analysis — not just a relevance score.

For EACH skill given, identify:
  1. sections_applied                     — the named sections/parts of the
                                             skill body that were actually
                                             relevant to this patient (e.g.
                                             "Diagnostic Criteria",
                                             "Histopathology Criteria",
                                             "Treatment Principles")
  2. matched                              — a list of PAIRS, each
                                             {"skill_content": "...", "patient_evidence": "..."}:
                                             the exact criterion/finding text
                                             from the skill, paired with the
                                             exact matching evidence found in
                                             THIS patient's data below. Do not
                                             list a skill_content without a
                                             genuine matching patient_evidence.
  3. missing                              — criteria the skill requires that
                                             are NOT yet available for this
                                             patient (plain strings)
  4. investigations_required              — tests needed to close the gap
                                             between "missing" and a complete
                                             workup
  5. evidence_supporting                  — findings from the patient data
                                             that support this skill's overall
                                             relevance to the case
  6. contribution                         — ONE concise, clinician-facing
                                             sentence stating concretely what
                                             this skill contributed, e.g.
                                             "Provided 4 of 5 diagnostic
                                             criteria required to confirm UCD."
  7. diagnostic_confidence_contribution   — 0.0-1.0, how much this skill's
                                             match supports the patient's
                                             suspected diagnosis

Only use what is explicitly present in the patient data given below. Do not
invent findings, sections, or matches that are not present. If a skill
clearly does not apply to this patient, return matched=[], missing=[], say so
plainly in "contribution", and set diagnostic_confidence_contribution=0.0 —
do not force a fit.

Return ONLY valid JSON:
{
  "applied_skills": [
    {
      "skill_id": "",
      "skill_name": "",
      "sections_applied": [],
      "matched": [
        {"skill_content": "", "patient_evidence": ""}
      ],
      "missing": [],
      "investigations_required": [],
      "evidence_supporting": [],
      "contribution": "",
      "diagnostic_confidence_contribution": 0.0
    }
  ]
}
"""


class SkillApplicationAgent:
    """
    Runs one Groq LLM call over the top-N retrieved skills (gated by
    SKILL_RELEVANCE_MIN_SCORE) to produce a matched/missing analysis —
    this is the "specify which skills and which contents got applied" output.

    v3.1: in addition to populating state["applied_skills"], this agent now
    also builds:
      - state["skill_application_summary"]  — a doctor-facing "Skill Impact
        Report": {skill_name, impact, contribution, evidence_matched,
        evidence_missing, diagnostic_weight} per skill.
      - scored_diagnoses[0].supported_by_skills — the skills (with their
        contribution + confidence_boost) that actually backed the primary
        diagnosis, attached directly onto the diagnosis object.
    """

    def __init__(self, groq_client: Groq = _groq_client_module, model: str = SKILL_APPLICATION_MODEL):
        self.groq_client = groq_client
        self.model = model

    async def apply(self, state: DiagnosticState) -> DiagnosticState:
        logger.info("SkillApplicationAgent — START")
        retrieved_skills = state.get("guideline_skills", state.get("retrieved_skills", []))
        di   = state["diagnostic_input"]
        clinical = state.get("structured_clinical_data")
        scored   = state.get("scored_diagnoses", [])

        top_skills = sorted(retrieved_skills, key=lambda s: s.get("score", 0.0), reverse=True)
        top_skills = [s for s in top_skills if s.get("score", 0.0) >= SKILL_RELEVANCE_MIN_SCORE][:TOP_N_APPLY]

        if not top_skills:
            state["applied_skills"] = []
            state["skill_application_summary"] = []
            return state

        patient_summary = (
            f"Age {di.age}, {di.gender}\n"
            f"Primary suspected diagnosis: {scored[0].disease if scored else 'Unknown'}\n"
            f"Doctor note: {di.doctor_note_or_dictation}\n"
            f"Symptoms: {clinical.symptoms if clinical else []}\n"
            f"Findings: {clinical.clinical_findings if clinical else []}\n"
            f"History: {di.medical_history_summary}\n"
            f"Labs: {di.latest_lab_summary}\n"
            f"Imaging: {di.latest_imaging_summary}"
        )

        skill_blocks = []
        for s in top_skills:
            body = s.get("body", {}) or {}
            body_preview = json.dumps(body, default=str)[:3000]
            skill_blocks.append(
                f"=== SKILL: {s.get('name')} (skill_id={s.get('skill_id')}) ===\n{body_preview}"
            )

        user_msg = (
            f"PATIENT DATA:\n{patient_summary}\n\n"
            f"SKILLS TO APPLY:\n\n" + "\n\n".join(skill_blocks)
        )

        applied: list[dict] = []
        try:
            resp = self.groq_client.chat.completions.create(
                model=self.model,
                temperature=0.1,
                max_tokens=10000,
                messages=[
                    {"role": "system", "content": _SKILL_APPLICATION_SYSTEM},
                    {"role": "user",   "content": user_msg},
                ],
                response_format={"type": "json_object"},
            )
            raw    = resp.choices[0].message.content or "{}"
            parsed = json.loads(raw)
            applied = parsed.get("applied_skills", [])
        except Exception as exc:
            logger.warning(f"[SkillApplication] LLM call failed: {exc}")

        score_by_id = {s["skill_id"]: s.get("score") for s in top_skills}
        name_by_id  = {s["skill_id"]: s.get("name") for s in top_skills}

        skill_application_summary: List[Dict[str, Any]] = []
        supported_by_skills: List[Dict[str, Any]] = []

        for a in applied:
            skill_id = a.get("skill_id")
            if not a.get("skill_name"):
                a["skill_name"] = name_by_id.get(skill_id, "")

            a["relevance"] = score_by_id.get(skill_id)

            try:
                confidence_contribution = float(a.get("diagnostic_confidence_contribution", 0.0) or 0.0)
            except (TypeError, ValueError):
                confidence_contribution = 0.0
            confidence_contribution = max(0.0, min(1.0, confidence_contribution))

            impact = _impact_level_from_score(confidence_contribution)
            a["impact"] = impact

            matched_pairs = [m for m in a.get("matched", []) if isinstance(m, dict)]
            evidence_matched = [
                m.get("patient_evidence", "") for m in matched_pairs if m.get("patient_evidence")
            ]
            missing_list = a.get("missing", []) or []
            contribution_text = a.get("contribution", "")

            skill_application_summary.append({
                "skill_id":           skill_id,
                "skill_name":         a.get("skill_name"),
                "impact":             impact,
                "contribution":       contribution_text,
                "sections_applied":   a.get("sections_applied", []),
                "matched":            matched_pairs,
                "evidence_matched":   evidence_matched,
                "evidence_missing":   missing_list,
                "diagnostic_weight":  confidence_contribution,
            })

            if confidence_contribution > 0:
                supported_by_skills.append({
                    "skill_id":         skill_id,
                    "skill_name":       a.get("skill_name"),
                    "contribution":     contribution_text,
                    "confidence_boost": round(confidence_contribution, 2),
                    "impact":           impact,
                })

            _log_skill_usage(
                state, "SkillApplicationAgent",
                [skill_id] if skill_id else [],
                content_used=contribution_text or "matched/missing criteria analysis against patient data",
                skill_names=[a.get("skill_name")] if a.get("skill_name") else [],
                reason_used=contribution_text,
                impact=f"diagnostic_confidence_contribution={confidence_contribution:.2f} ({impact})",
                sections_used=a.get("sections_applied", []),
            )

        state["applied_skills"] = applied
        state["skill_application_summary"] = skill_application_summary

        # Attach the skills that actually backed it directly onto the primary
        # diagnosis so the final report can show "why" right next to the
        # diagnosis, sorted by how much confidence each skill contributed.
        if scored:
            scored[0].supported_by_skills = sorted(
                supported_by_skills, key=lambda x: x.get("confidence_boost", 0.0), reverse=True
            )[:5]

        logger.info(f"SkillApplicationAgent: applied {len(applied)} skills")
        return state


# ──────────────────────────────────────────────────────────────────────────────
# A11  INVESTIGATION STRESS TESTER  (unchanged)
# ──────────────────────────────────────────────────────────────────────────────

class DiagnosticStressTester:
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def test(self, state: DiagnosticState) -> DiagnosticState:
        logger.info("DiagnosticStressTester — START")
        scored   = state.get("scored_diagnoses", [])
        di       = state["diagnostic_input"]
        clinical = state.get("structured_clinical_data")
        hypothesis = state.get("hypothesis_reasoning")

        if not scored:
            return state

        primary          = scored[0]
        reasoning_summary = hypothesis.specialist_summary if hypothesis else ""

        prompt = f"""
You are a senior {di.doctor_speciality} specialist.

Your task is to generate the COMPLETE investigation checklist for confirming
the primary hypothesis AND for verifying treatment eligibility.

═══════════════════════════════════════════════
PRIMARY DIAGNOSIS
═══════════════════════════════════════════════
Disease: {primary.disease}
Type/Stage: {primary.disease_type} / {primary.stage}
Severity: {primary.severity}

═══════════════════════════════════════════════
PATIENT RECORD (search here for done tests + results)
═══════════════════════════════════════════════
FULL CONTEXT:
{di.patient_context_summary}

LABS DOCUMENTED: {di.latest_lab_summary}
IMAGING DOCUMENTED: {di.latest_imaging_summary}
PROCEDURES DOCUMENTED: {di.procedure_summary}
HISTORY: {di.medical_history_summary}
DOCTOR NOTE: {di.doctor_note_or_dictation}

SPECIALIST REASONING:
{reasoning_summary}

═══════════════════════════════════════════════
INVESTIGATION CATEGORIES
═══════════════════════════════════════════════

For each recommended investigation, determine:

status:
  "done_confirmed"    — test is in the patient record AND result supports the diagnosis
  "done_refutes"      — test is in the record AND result contradicts the diagnosis
  "done_inconclusive" — test is in the record but result is not diagnostic
  "not_done"          — test is NOT documented anywhere in the patient record

required_for:
  "diagnosis_confirmation" | "treatment_eligibility" | "both" | "staging" | "monitoring"

urgency:
  "immediate" | "before_treatment" | "planned" | "optional"

IMPORTANT RULES:
- If a test is documented with a result anywhere in the patient record, it is DONE.
- Extract the ACTUAL result text from the patient record for done tests.
- Do NOT mark a test as not_done if there is evidence of it in the record.

Return ONLY valid JSON:
{{
  "investigations": [
    {{
      "test": "...", "status": "done_confirmed | done_refutes | done_inconclusive | not_done",
      "date_performed": "ISO date or null", "result_summary": "actual result text if done, else null",
      "interpretation": "clinical interpretation of the result", "supports_hypothesis": true,
      "required_for": "diagnosis_confirmation | treatment_eligibility | both | staging | monitoring",
      "urgency": "immediate | before_treatment | planned | optional"
    }}
  ]
}}"""

        try:
            response = self.llm.invoke([
                SystemMessage(content=(
                    f"You are a {di.doctor_speciality} specialist generating an investigation "
                    "checklist with evidence status. Output only valid JSON."
                )),
                HumanMessage(content=prompt),
            ])
            parsed = _parse_json(response.content)
            investigations_raw = parsed.get("investigations", [])

            investigations: List[InvestigationItem] = []
            for inv in investigations_raw:
                investigations.append(InvestigationItem(
                    test                = inv.get("test", ""),
                    status              = inv.get("status", InvestigationStatus.NOT_DONE),
                    date_performed      = inv.get("date_performed"),
                    result_summary      = inv.get("result_summary"),
                    interpretation      = inv.get("interpretation"),
                    supports_hypothesis = inv.get("supports_hypothesis"),
                    required_for        = inv.get("required_for", "diagnosis_confirmation"),
                    urgency             = inv.get("urgency", "before_treatment"),
                ))

            state["investigations"] = investigations

            # ISSUE 5 FIX — documented, confirmatory results (biopsy,
            # histopathology, PET, etc.) should visibly move confidence, not
            # leave it flat at the earlier symptom-based estimate.
            confirmed_diagnostic_tests = [
                inv for inv in investigations
                if inv.status == InvestigationStatus.DONE_CONFIRMED
                and inv.required_for in ("diagnosis_confirmation", "both")
                and inv.supports_hypothesis
            ]
            if confirmed_diagnostic_tests:
                boost = min(0.3, 0.12 * len(confirmed_diagnostic_tests))
                primary.probability = max(0.0, min(1.0, primary.probability + boost))
                logger.info(
                    f"Confidence boosted by {boost:.2f} due to "
                    f"{len(confirmed_diagnostic_tests)} confirmed diagnostic test(s); "
                    f"new probability={primary.probability:.2f}"
                )

            logger.info(f"Investigations: {len(investigations)} items")
        except Exception as e:
            logger.error(f"DiagnosticStressTester failed: {e}")
            state["investigations"] = []
        return state


# ──────────────────────────────────────────────────────────────────────────────
# A12  INVESTIGATION GAP ANALYZER  (unchanged)
# ──────────────────────────────────────────────────────────────────────────────

class InvestigationGapAnalyzer:
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def analyze(self, state: DiagnosticState) -> DiagnosticState:
        logger.info("InvestigationGapAnalyzer — START")
        investigations = state.get("investigations", [])
        scored         = state.get("scored_diagnoses", [])
        hypothesis     = state.get("hypothesis_reasoning")
        di             = state["diagnostic_input"]

        if not scored:
            return state

        primary = scored[0]

        not_done = [inv for inv in investigations if inv.status == InvestigationStatus.NOT_DONE]
        blocking = [inv for inv in not_done if inv.required_for in ("diagnosis_confirmation", "treatment_eligibility", "both", "staging") and inv.urgency in ("immediate", "before_treatment")]

        # ISSUE 4 — reconciliation set: any test already documented as done
        # (confirmed/refuted/inconclusive) must never resurface as "missing"
        # later, even if the LLM re-suggests it under different wording.
        done_test_names = {
            inv.test.strip().lower()
            for inv in investigations
            if inv.status in (
                InvestigationStatus.DONE_CONFIRMED,
                InvestigationStatus.DONE_REFUTES,
                InvestigationStatus.DONE_INCONCLUSIVE,
            )
        }

        gate_blockers = hypothesis.gate_blockers if hypothesis else []
        confirmatory  = hypothesis.confirmatory_tests_pending if hypothesis else []

        done_test_names = {
            inv.test.strip().lower()
            for inv in investigations
            if inv.status in (
                InvestigationStatus.DONE_CONFIRMED,
                InvestigationStatus.DONE_REFUTES,
                InvestigationStatus.DONE_INCONCLUSIVE,
            )
        }

        # ISSUE 3 FIX — guideline_pathways[*].missing_pending was built by
        # GuidelinePathwayMappingAgent before investigations were known, from
        # raw patient text alone, so it can contradict what we now know is
        # documented (e.g. "PET-CT" done vs "Imaging for multicentric disease
        # → Missing"). Reconcile using both test name and result/interpretation
        # text so differently-worded-but-equivalent items are caught.
        done_signal_blobs = [
            " ".join(filter(None, [inv.test, inv.result_summary or "", inv.interpretation or ""])).strip().lower()
            for inv in investigations
            if inv.status in (
                InvestigationStatus.DONE_CONFIRMED,
                InvestigationStatus.DONE_REFUTES,
                InvestigationStatus.DONE_INCONCLUSIVE,
            )
        ]

        def _already_satisfied(requirement_text: str) -> bool:
            requirement_text = (requirement_text or "").strip().lower()
            if not requirement_text:
                return False
            for blob in done_signal_blobs:
                if fuzz.partial_ratio(requirement_text, blob) > 85:
                    return True
                if fuzz.token_set_ratio(requirement_text, blob) > 70:
                    return True
            return False

        for pathway in getattr(primary, "guideline_pathways", []) or []:
            still_missing = []
            for item in pathway.missing_pending:
                if _already_satisfied(item.investigation) or _already_satisfied(item.guideline_requirement):
                    logger.info(f"Reconciled guideline missing_pending already satisfied: {item.investigation}")
                    continue
                still_missing.append(item)
            pathway.missing_pending = still_missing
            pathway.missing_count = sum(1 for x in still_missing if x.status == "MISSING")
            pathway.pending_count  = sum(1 for x in still_missing if x.status == "PENDING")

        prompt = f"""
You are a senior {di.doctor_speciality} specialist.

PRIMARY DISEASE: {primary.disease} ({primary.stage})
DIAGNOSIS GATE: {hypothesis.diagnosis_gate if hypothesis else 'unknown'}
GATE BLOCKERS (from reasoning): {gate_blockers}
CONFIRMATORY TESTS PENDING: {confirmatory}

NOT-YET-DONE INVESTIGATIONS (from checklist):
{json.dumps([{"test": i.test, "required_for": i.required_for, "urgency": i.urgency} for i in not_done], indent=2)}

YOUR TASK:
Produce the FINAL list of missing investigations.

RULE 1: Include ONLY tests that will:
  (a) Change the diagnosis (confirm or refute {primary.disease}), OR
  (b) Determine treatment eligibility for first-line treatment of {primary.disease}

RULE 2: Do NOT include tests that:
  - Are for monitoring (those belong in follow-up plan)
  - Are "nice to have" but don't change the immediate decision
  - Are screening tests unrelated to the primary disease

RULE 3: For each missing test, state EXACTLY what decision it unblocks.

Return JSON only:
{{
  "missing_investigations": [
    {{
      "test": "...", "required_for": "diagnosis_confirmation | treatment_eligibility | staging",
      "decision_unblocked": "e.g., Confirms muscle invasion depth to determine cystectomy candidacy",
      "urgency": "immediate | before_treatment | planned", "ordering_priority": 1
    }}
  ]
}}"""

        try:
            response = self.llm.invoke([
                SystemMessage(content="Generate missing investigations list. Output only JSON."),
                HumanMessage(content=prompt),
            ])
            parsed = _parse_json(response.content)
            missing_raw = parsed.get("missing_investigations", [])

            # ISSUE 4 — drop any suggested test that fuzzy-matches something
            # already marked done above, so the report can never say both
            # "PET CT confirms X" and "PET CT still required" at once.
            reconciled = []
            dropped = []
            for m in missing_raw:
                test_name = str(m.get("test", "")).strip().lower()
                if any(fuzz.partial_ratio(test_name, done) > 85 for done in done_test_names):
                    dropped.append(m.get("test", ""))
                    continue
                reconciled.append(m)

            state["missing_investigations"] = [
                f"{m['test']} → {m.get('decision_unblocked','')}"
                for m in reconciled
            ]
            if dropped:
                logger.info(f"Reconciled away already-done tests from missing list: {dropped}")
            logger.info(f"Missing investigations: {len(reconciled)}")
        except Exception as e:
            logger.error(f"InvestigationGapAnalyzer failed: {e}")
            # ISSUE 4 — apply the same reconciliation to the fallback path
            state["missing_investigations"] = [
                i.test for i in blocking
                if not any(fuzz.partial_ratio(i.test.strip().lower(), done) > 85 for done in done_test_names)
            ]
        return state


# ──────────────────────────────────────────────────────────────────────────────
# A13  EVIDENCE CONFLICT DETECTOR  (unchanged)
# ──────────────────────────────────────────────────────────────────────────────

class EvidenceConflictDetector:
    async def detect(self, state: DiagnosticState) -> DiagnosticState:
        logger.info("EvidenceConflictDetector — START")
        conflicts = []
        clinical  = state.get("structured_clinical_data")
        scored    = state.get("scored_diagnoses", [])

        if not scored:
            return state

        top = scored[0]
        if len(top.conflicting_evidence) > len(top.supporting_evidence):
            conflicts.append(
                f"Primary hypothesis '{top.disease}' has more conflicting than supporting evidence"
            )
        if clinical and clinical.doctor_hypothesis:
            matching = [d for d in scored if d.disease.lower() == clinical.doctor_hypothesis.lower()]
            if matching and matching[0].probability < 0.4:
                conflicts.append(
                    f"Doctor hypothesis '{clinical.doctor_hypothesis}' has low probability "
                    f"({matching[0].probability:.2f}) — consider alternatives"
                )

        state["evidence_conflicts"] = conflicts
        return state


# ──────────────────────────────────────────────────────────────────────────────
# A14  LONGITUDINAL PROGRESSION  (unchanged)
# ──────────────────────────────────────────────────────────────────────────────

class LongitudinalProgressionAnalyzer:
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def analyze(self, state: DiagnosticState) -> DiagnosticState:
        logger.info("LongitudinalProgressionAnalyzer — START")
        di = state["diagnostic_input"]
        if di.visit_type not in [VisitType.FOLLOWUP_VISIT, VisitType.POST_PROCEDURE]:
            return state

        prompt = f"""
Visit Type: {di.visit_type}
History: {di.medical_history_summary}
Presentation: {di.doctor_note_or_dictation}
Procedures: {di.recent_procedures}
Medications: {di.last_medications}

OUTPUT JSON:
{{
  "progression_status":"improving|stable|deteriorating",
  "key_changes":["..."],
  "expected_trajectory":"...",
  "concerns":["..."]
}}"""
        try:
            response = self.llm.invoke([
                SystemMessage(content="Analyze disease progression. Return only JSON."),
                HumanMessage(content=prompt),
            ])
            state["longitudinal_progression"] = _parse_json(response.content)
        except Exception as e:
            logger.error(f"Longitudinal analysis failed: {e}")
        return state


# ──────────────────────────────────────────────────────────────────────────────
# A15  RED FLAG DETECTOR  (unchanged)
# ──────────────────────────────────────────────────────────────────────────────

class RedFlagDetector:
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def detect(self, state: DiagnosticState) -> DiagnosticState:
        logger.info("RedFlagDetector — START")
        di      = state["diagnostic_input"]
        clinical = state.get("structured_clinical_data")
        if not clinical:
            return state

        evidence = (
            f"Symptoms: {clinical.symptoms}\n"
            f"Findings: {clinical.clinical_findings}\n"
            f"Doctor note: {di.doctor_note_or_dictation}\n"
            f"Labs: {di.latest_lab_summary}\n"
            f"Imaging: {di.latest_imaging_summary}"
        )

        prompt = f"""
You are a senior clinical safety monitoring system.
Detect any CRITICAL medical red flags from the patient case.
Include: life threatening conditions, malignancy suspicion, organ failure,
internal bleeding, rapidly progressive disease, severe infection, cardiovascular emergencies.

PATIENT DATA:
{evidence}

Return JSON: {{"red_flags": ["description of the clinical risk"]}}
If none: {{"red_flags": []}}"""

        try:
            response = self.llm.invoke([
                SystemMessage(content="Detect dangerous clinical patterns."),
                HumanMessage(content=prompt),
            ])
            parsed      = _parse_json(response.content)
            raw_flags = parsed.get("red_flags", [])

            normalized_flags = []
            for f in raw_flags:
                if isinstance(f, dict):
                    normalized_flags.append(f.get("description", str(f)))
                else:
                    normalized_flags.append(str(f))

            state["red_flags"] = normalized_flags
        except Exception as e:
            logger.error(f"RedFlagDetector failed: {e}")
        return state


# ──────────────────────────────────────────────────────────────────────────────
# A16  DOCTOR HYPOTHESIS HANDLER  (unchanged)
# ──────────────────────────────────────────────────────────────────────────────

class DoctorHypothesisHandler:
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def evaluate(self, state: DiagnosticState) -> DiagnosticState:
        logger.info("DoctorHypothesisHandler — START")
        clinical = state.get("structured_clinical_data")
        scored   = state.get("scored_diagnoses", [])
        if not clinical or not clinical.doctor_hypothesis:
            return state

        doctor_hyp = clinical.doctor_hypothesis
        matching   = [d for d in scored if d.disease.lower() == doctor_hyp.lower()]

        if matching and matching[0].probability < 0.4 and scored:
            alt = scored[0]
            state["warnings"].append(
                f"Doctor suspected {doctor_hyp}. Evidence partially supports this. "
                f"Alternative stronger hypothesis: {alt.disease} (p={alt.probability:.2f})"
            )
        return state


# ──────────────────────────────────────────────────────────────────────────────
# A17  REPORT GENERATOR  (v3.1 — includes skill_application_summary too)
# ──────────────────────────────────────────────────────────────────────────────

class DiagnosticReportGenerator:
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def generate(self, state: DiagnosticState) -> DiagnosticState:
        logger.info("DiagnosticReportGenerator — START")
        scored = state.get("scored_diagnoses", [])
        if not scored:
            state["error"] = "No diagnoses to report"
            return state

        primary      = scored[0]
        alternatives = scored[1:4]
        explanation  = await self._generate_explanation(state, primary)

        graph = state.get("evidence_graph")
        graph_summary = {
            "total_nodes":    graph.number_of_nodes() if graph else 0,
            "total_edges":    graph.number_of_edges() if graph else 0,
            "evidence_density": f"{graph.number_of_edges() / max(graph.number_of_nodes(), 1):.2f}" if graph else "0",
        }

        expected_findings = {}
        for test in primary.required_tests[:5]:
            expected_findings[test] = "Abnormal result expected if diagnosis correct"

        report = DiagnosticReport(
            primary_hypothesis     = primary,
            alternative_diagnoses  = alternatives,
            evidence_graph_summary = graph_summary,
            investigations         = state.get("investigations", []),
            missing_investigations = state.get("missing_investigations", []),
            expected_findings      = expected_findings,
            red_flag_alerts        = state.get("red_flags", []),
            diagnostic_explanation = explanation,
            confidence_score       = primary.probability,
            followup_analysis      = state.get("followup_analysis"),
            hypothesis_reasoning   = state.get("hypothesis_reasoning"),
            longitudinal_risk_predictions = state.get("longitudinal_progression"),
            # ── skill-first fields ──
            retrieved_skills = state.get("retrieved_skills", []),
            applied_skills   = state.get("applied_skills", []),
            skill_usage_log  = state.get("skill_usage_log", []),
            # ── NEW ──
            skill_application_summary = state.get("skill_application_summary", []),
        )

        state["diagnostic_report"] = report
        logger.info(f"Report: {primary.disease} (p={primary.probability:.2f})")
        return state

    async def _generate_explanation(self, state: DiagnosticState, primary: DiagnosisCandidate) -> str:
        di      = state["diagnostic_input"]
        clinical = state.get("structured_clinical_data")

        prompt = f"""
You are a senior clinical decision support system.

Explain WHY this diagnosis is the most likely one.

PATIENT: Age {di.age}, {di.gender} | Specialty: {di.doctor_speciality}
Symptoms: {clinical.symptoms if clinical else []}
Findings: {clinical.clinical_findings if clinical else []}
Doctor note: {di.doctor_note_or_dictation}
History: {di.medical_history_summary}
Labs: {di.latest_lab_summary}
Imaging: {di.latest_imaging_summary}

PRIMARY DIAGNOSIS: {primary.disease}
Supporting evidence: {chr(10).join(f"- {e}" for e in primary.supporting_evidence)}
Probability: {primary.probability:.2f}

Write a 4–6 sentence clinical reasoning explanation referencing:
patient age, sex, symptoms, findings, imaging/labs, and why they match the disease.
Do NOT output JSON. Return explanation text only."""

        try:
            response = self.llm.invoke([
                SystemMessage(content="Generate concise diagnostic reasoning."),
                HumanMessage(content=prompt),
            ])
            return response.content.strip()
        except:
            return f"{primary.disease} is the leading diagnosis based on available evidence."


# ──────────────────────────────────────────────────────────────────────────────
# LANGGRAPH WORKFLOW  (unchanged edges/entry point)
# ──────────────────────────────────────────────────────────────────────────────

def create_diagnostic_workflow(
    llm: ChatGroq,
    neo4j_manager: Neo4jConnectionManager,
    rag_engine: Optional[ClinicalRAGRetrievalEngine] = None,
) -> StateGraph:
    skill_retrieval_agent      = SkillRetrievalAgent(rag_engine or _get_engine())
    clinical_language_agent    = ClinicalLanguageAgent(llm)
    evidence_graph_builder     = EvidenceGraphBuilder()
    differential_generator     = DifferentialDiagnosisGenerator(llm)
    knowledge_graph_agent      = KnowledgeGraphAgent(neo4j_manager)
    probabilistic_engine       = ProbabilisticDiagnosisEngine(llm, neo4j_manager)
    characterization_agent     = DiseaseCharacterizationAgent(llm)
    severity_agent             = SeverityScoringAgent(llm)
    hypothesis_reasoning_agent = HypothesisToDiagnosisReasoningAgent(llm)
    guideline_agent            = GuidelineValidationAgent(llm)
    skill_application_agent    = SkillApplicationAgent()
    stress_tester              = DiagnosticStressTester(llm)
    investigation_gap          = InvestigationGapAnalyzer(llm)
    conflict_detector          = EvidenceConflictDetector()
    longitudinal_analyzer      = LongitudinalProgressionAnalyzer(llm)
    red_flag_detector          = RedFlagDetector(llm)
    doctor_hypothesis_handler  = DoctorHypothesisHandler(llm)
    report_generator           = DiagnosticReportGenerator(llm)
    followup_agent             = FollowUpClinicalReasoningAgent(llm)

    workflow = StateGraph(DiagnosticState)

    workflow.add_node("skill_retrieval",              skill_retrieval_agent.retrieve)
    workflow.add_node("clinical_language",            clinical_language_agent.process)
    workflow.add_node("build_evidence_graph",         evidence_graph_builder.build)
    workflow.add_node("generate_differentials",       differential_generator.generate)
    workflow.add_node("knowledge_graph",              knowledge_graph_agent.retrieve_candidates)
    workflow.add_node("probabilistic_scoring",        probabilistic_engine.score_diagnoses)
    workflow.add_node("disease_characterization",     characterization_agent.characterize)
    workflow.add_node("severity_scoring",             severity_agent.score)
    workflow.add_node("hypothesis_to_diagnosis_reasoning", hypothesis_reasoning_agent.reason)
    workflow.add_node("followup_reasoning",           followup_agent.analyze)
    workflow.add_node("guideline_validation",         guideline_agent.validate)
    workflow.add_node("skill_application",            skill_application_agent.apply)
    workflow.add_node("stress_testing",               stress_tester.test)
    workflow.add_node("investigation_gap",            investigation_gap.analyze)
    workflow.add_node("conflict_detection",           conflict_detector.detect)
    workflow.add_node("longitudinal_analysis",        longitudinal_analyzer.analyze)
    workflow.add_node("red_flag_detection",           red_flag_detector.detect)
    workflow.add_node("doctor_hypothesis",            doctor_hypothesis_handler.evaluate)
    workflow.add_node("report_generation",            report_generator.generate)

    workflow.set_entry_point("skill_retrieval")
    workflow.add_edge("skill_retrieval",              "clinical_language")
    workflow.add_edge("clinical_language",            "build_evidence_graph")
    workflow.add_edge("build_evidence_graph",         "generate_differentials")
    workflow.add_edge("generate_differentials",       "knowledge_graph")
    workflow.add_edge("knowledge_graph",              "probabilistic_scoring")
    workflow.add_edge("probabilistic_scoring",        "disease_characterization")
    workflow.add_edge("disease_characterization",     "severity_scoring")
    workflow.add_edge("severity_scoring",             "hypothesis_to_diagnosis_reasoning")
    workflow.add_edge("hypothesis_to_diagnosis_reasoning", "followup_reasoning")
    workflow.add_edge("followup_reasoning",           "guideline_validation")
    workflow.add_edge("guideline_validation",         "skill_application")
    workflow.add_edge("skill_application",            "stress_testing")
    workflow.add_edge("stress_testing",               "investigation_gap")
    workflow.add_edge("investigation_gap",            "conflict_detection")
    workflow.add_edge("conflict_detection",           "longitudinal_analysis")
    workflow.add_edge("longitudinal_analysis",        "red_flag_detection")
    workflow.add_edge("red_flag_detection",           "doctor_hypothesis")
    workflow.add_edge("doctor_hypothesis",            "report_generation")
    workflow.add_edge("report_generation",            END)

    return workflow.compile()


# ──────────────────────────────────────────────────────────────────────────────
# MAIN EXECUTION
# ──────────────────────────────────────────────────────────────────────────────

async def run_diagnostic_reasoning(
    diagnostic_input: DiagnosticInput,
    llm: ChatGroq,
    neo4j_uri: str,
    neo4j_user: str,
    neo4j_password: str,
):
    logger.info(f"Diagnostic Reasoning: patient={diagnostic_input.patient_id}")
    neo4j_manager = Neo4jConnectionManager(neo4j_uri, neo4j_user, neo4j_password)

    try:
        workflow = create_diagnostic_workflow(llm, neo4j_manager)
        initial_state: DiagnosticState = {
            "diagnostic_input":         diagnostic_input,
            "retrieved_skills":         [],
            "skill_usage_log":          [],
            "applied_skills":           [],
            "skill_application_summary": [],
            "structured_clinical_data": None,
            "evidence_graph":           None,
            "evidence_nodes":           [],
            "evidence_edges":           [],
            "candidate_diseases":       [],
            "scored_diagnoses":         [],
            "evidence_conflicts":       [],
            "investigations":           [],
            "missing_investigations":   [],
            "hypothesis_reasoning":     None,
            "longitudinal_progression": None,
            "red_flags":                [],
            "diagnostic_report":        None,
            "error":                    None,
            "warnings":                 [],
            "followup_analysis":        None,
        }
        final_state = await workflow.ainvoke(initial_state)

        if final_state.get("warnings"):
            logger.warning(f"Warnings: {final_state['warnings']}")
        if final_state.get("error"):
            logger.error(f"Error: {final_state['error']}")

        if final_state.get("diagnostic_report"):
            return final_state["diagnostic_report"], final_state
        raise RuntimeError("Diagnostic workflow failed to generate report")
    finally:
        neo4j_manager.close()


# ──────────────────────────────────────────────────────────────────────────────
# PATIENT CONTEXT BUILDER  (unchanged)
# ──────────────────────────────────────────────────────────────────────────────

def build_patient_context(summary: dict) -> str:
    if not summary:
        return ""
    try:
        sections = []

        clinical_summary = summary.get("clinical_summary")
        if clinical_summary:
            sections.append("CLINICAL SUMMARY:")
            sections.append(json.dumps(clinical_summary, indent=2) if isinstance(clinical_summary, dict) else str(clinical_summary))

        if "treatment_timeline" in summary:
            sections.append("\nTREATMENT TIMELINE:")
            sections.append(json.dumps(summary["treatment_timeline"], indent=2))

        if "structured_graph" in summary:
            sg = summary["structured_graph"]
            sections.append("\nSTRUCTURED DISEASE GRAPH:")
            if "primary_driver" in sg:
                sections.append("\nPRIMARY DIAGNOSIS:")
                sections.append(json.dumps(sg["primary_driver"], indent=2))
            if "hierarchy" in sg:
                sections.append("\nCLINICAL FINDINGS HIERARCHY:")
                for tier, items in sg["hierarchy"].items():
                    sections.append(f"\n{tier}:")
                    for item in items:
                        sections.append(f"- {item.get('finding')} ({item.get('rationale')})")

        if "timeline" in summary:
            tl = summary["timeline"]
            sections.append("\nDISEASE TIMELINE:")
            if "sentinel_event" in tl:
                sections.append(f"Sentinel Event: {tl['sentinel_event']}")
            if "progression_markers" in tl:
                sections.append(f"Progression: {tl['progression_markers']}")

        if "graph_documents" in summary:
            sections.append("\nCLINICAL EVIDENCE:")
            for doc in summary.get("graph_documents", []):
                for entity in doc.get("entities", []):
                    name     = entity.get("name")
                    evidence = entity.get("evidence")
                    if name and evidence:
                        sections.append(f"{name}: {evidence}")

        return "\n".join(sections)
    except Exception as e:
        logger.error(f"build_patient_context error: {e}")
        return str(summary)


# ──────────────────────────────────────────────────────────────────────────────
# MERGED IN — SKILL INDEXING / BACKFILL UTILITIES  (from diagnostic_skill_agent.py)
# These remain standalone: NOT part of the live retrieval path above
# (which reads phase1_diagnosis_skills / phase1_treatment_skills directly via
# Phase 2's engine). Kept for the /diagnostic-skill/reindex/{doctor_id}
# backfill endpoint only.
# ──────────────────────────────────────────────────────────────────────────────

_skill_chroma_client_module     = None
_skill_chroma_collection_module = None


def _get_skill_chroma_collection_module():
    global _skill_chroma_client_module, _skill_chroma_collection_module
    if _skill_chroma_collection_module is None:
        _skill_chroma_client_module = chromadb.PersistentClient(path=CHROMA_PERSIST_PATH)
        _skill_chroma_collection_module = _skill_chroma_client_module.get_or_create_collection(
            SKILL_COLLECTION_NAME
        )
    return _skill_chroma_collection_module


def _skill_embedding_text(skill: dict) -> str:
    name     = skill.get("name", "")
    keywords = " ".join(skill.get("trigger_keywords", [])[:20])
    body_md  = (skill.get("skill_md") or "")[:2000]
    return f"{name}\n{keywords}\n{body_md}".strip()


def index_skill_to_chroma(skill: dict) -> bool:
    collection = _get_skill_chroma_collection_module()
    text   = _skill_embedding_text(skill)
    vector = _embed_text(text)
    if vector is None:
        logger.warning(f"[SkillIndex] embedding failed for skill_id={skill.get('skill_id')}")
        return False

    collection.upsert(
        ids=[skill["skill_id"]],
        documents=[text],
        embeddings=[vector],
        metadatas=[{
            "skill_id":     skill["skill_id"],
            "doctor_id":    skill["doctor_id"],
            "doc_id":       skill.get("doc_id", ""),
            "skill_type":   skill.get("skill_type", ""),
            "subtype":      skill.get("subtype", ""),
            "disease_type": skill.get("disease_type", ""),
            "name":         skill.get("name", ""),
            "status":       skill.get("status", ""),
        }],
    )
    return True


async def index_all_skills_for_doctor(
    doctor_id: str,
    mongo_uri: str = PHASE1_MONGO_URI,
    only_approved: bool = True,
) -> dict:
    client_local = AsyncIOMotorClient(mongo_uri)
    db_local = client_local[PHASE1_MONGO_DB]
    try:
        query: dict = {"doctor_id": doctor_id}
        if only_approved:
            query["status"] = "approved"

        diag_skills  = await db_local["phase1_diagnosis_skills"].find(query).to_list(length=2000)
        treat_skills = await db_local["phase1_treatment_skills"].find(query).to_list(length=2000)
    finally:
        client_local.close()

    all_skills = diag_skills + treat_skills
    count = 0
    for skill in all_skills:
        skill.pop("_id", None)
        if index_skill_to_chroma(skill):
            count += 1

    logger.info(
        f"[SkillIndex] indexed {count}/{len(all_skills)} skills | doctor_id={doctor_id} "
        f"| embedding_model={EMBEDDING_MODEL}"
    )
    return {"indexed": count, "total": len(all_skills)}


# ──────────────────────────────────────────────────────────────────────────────
# DB helpers for follow-up (unchanged)
# ──────────────────────────────────────────────────────────────────────────────

async def get_latest_diagnosis(patient_id: str, doctor_id: str) -> Optional[Dict]:
    try:
        docs = await diagnosis_data_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id, "type": "diagnosis"}
        ).sort("updated_at", -1).to_list(length=1)
        if docs:
            return docs[0]
        return None
    except Exception as e:
        logger.error(f"Failed to get latest diagnosis: {e}")
        return None


async def get_latest_treatment_plan(patient_id: str, doctor_id: str) -> Optional[Dict]:
    try:
        docs = await documentation_treatment_plan_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("created_at", -1).to_list(length=1)
        if docs:
            return docs[0]
        return None
    except Exception as e:
        logger.error(f"Failed to get latest treatment plan: {e}")
        return None


class DiagnosticRequest(BaseModel):
    doctor_note_or_dictation: Optional[str] = None


# ──────────────────────────────────────────────────────────────────────────────
# API ENDPOINT  (v3.1 — response now also includes skill_application_summary
# and each diagnosis's supported_by_skills)
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/diagnostic/skill/{patient_id}")
async def diagnostic_endpoint(
    patient_id: str,
    request:    DiagnosticRequest,
    doctor_id:  str = Query(...),
    # ISSUE 4 FIX — internal/debugging tools can still request the full
    # skill-explainability bundle by passing ?include_debug=true. Doctor UI
    # simply never sends this, so it never sees skill_usage_log /
    # retrieved_skills / applied_skills / *_summary in the response.
    include_debug: bool = Query(default=False, description="Include internal skill debug/audit data in the response (retrieved_skills, applied_skills, skill_usage_log, summaries). Default False for doctor-facing UI."),
):
    logger.info(f"Diagnostic request: patient={patient_id} doctor={doctor_id}")
    logger.info(f"Doctor dictation (raw): {request.doctor_note_or_dictation}")

    try:
        doctor = doctor_user_collection.find_one(
            {"$or": [{"sys_user_id": doctor_id}, {"doctor_id": doctor_id}]},
            {"_id": 0},
        )
        if not doctor:
            raise HTTPException(status_code=404, detail="Doctor not found")
        doctor_speciality = doctor.get("specialization")

        patient = patient_user_collection.find_one(
            {"$or": [{"patient_id": patient_id}, {"sys_user_id": patient_id}]},
            {"_id": 0},
        )
        if not patient:
            raise HTTPException(status_code=404, detail="Patient not found")

        age = 0
        dob = patient.get("date_of_birth")
        if dob:
            try:
                dob_date = datetime.strptime(dob, "%Y-%m-%d").date()
                today = datetime.utcnow().date()
                age = today.year - dob_date.year - ((today.month, today.day) < (dob_date.month, dob_date.day))
            except Exception:
                pass
        gender = patient.get("gender") or "unknown"

        appointment_doc = patient_appointments_collection.find_one(
            {"sys_user_id": patient_id},
            {"appointments": 1}
        )

        visit_type = "first_visit"
        if appointment_doc and "appointments" in appointment_doc:
            latest_appt = sorted(
                appointment_doc["appointments"],
                key=lambda x: x.get("date", ""),
                reverse=True
            )[0]
            visit_type = latest_appt.get("visit_type", "first_visit")

        visit_type_clean = visit_type.replace(" ", "_").lower()

        if visit_type_clean in ("follow_up", "followup", "followup_visit"):
            visit_type_enum = VisitType.FOLLOWUP_VISIT
        elif visit_type_clean == "first_visit":
            visit_type_enum = VisitType.FIRST_VISIT
        elif visit_type_clean == "post_procedure":
            visit_type_enum = VisitType.POST_PROCEDURE
        elif visit_type_clean == "periodic_review":
            visit_type_enum = VisitType.PERIODIC_REVIEW
        elif visit_type_clean == "emergency_visit":
            visit_type_enum = VisitType.EMERGENCY_VISIT
        else:
            visit_type_enum = VisitType.FIRST_VISIT

        previous_diagnosis = None
        previous_treatment_plan = None
        previous_diagnosis_text = ""
        previous_treatment_text = ""

        if visit_type_enum == VisitType.FOLLOWUP_VISIT:
            previous_diagnosis = await get_latest_diagnosis(patient_id, doctor_id)
            previous_treatment_plan = await get_latest_treatment_plan(patient_id, doctor_id)

            if previous_diagnosis:
                previous_diagnosis_text = previous_diagnosis.get("diagnosis", "Unknown")

            if previous_treatment_plan:
                previous_treatment_text = previous_treatment_plan.get("finaloutput", "")
                if isinstance(previous_treatment_text, dict):
                    previous_treatment_text = json.dumps(previous_treatment_text)

        summary = await summary_collection.find_one(
            {"patient_id": patient_id},
            sort=[("_id", -1)],
        )

        medical_history_summary = ""
        imaging_summary = ""
        lab_summary = ""
        procedure_summary = ""
        last_medications = []
        recent_procedures = []

        patient_context = ""
        timeline_summary = ""

        if summary:
            summary_data = summary.get("summary", {})
            paragraphs = summary_data.get("paragraphs", [])
            patient_context = "\n\n".join(paragraphs)
            medical_history_summary = patient_context

            timeline = summary.get("timeline", {}).get("timeline", [])
            timeline_lines = []
            for item in timeline:
                dt = item.get("date", "")
                narrative = item.get("narrative", "")
                timeline_lines.append(f"{dt}: {narrative}")
            timeline_summary = "\n".join(timeline_lines)

            patient_context += f"\n\n===== CLINICAL TIMELINE =====\n{timeline_summary}"

        # ── default dictation from patient_summary when not supplied ──
        # Lets Postman call this endpoint with {} or an empty
        # doctor_note_or_dictation and still get a full run driven purely
        # by patient_summary.
        dictation_text = request.doctor_note_or_dictation
        if not dictation_text:
            diagnosis_header = summary_data.get("diagnosis_header", "") if summary else ""
            dictation_text = diagnosis_header or (patient_context[:1000] if patient_context else "")

        enhanced_context = patient_context

        if visit_type_enum == VisitType.FOLLOWUP_VISIT:
            enhanced_context = f"""
═══════════════════════════════════════════════════════════════════
⚠️ IMPORTANT: THIS IS A FOLLOW-UP VISIT
═══════════════════════════════════════════════════════════════════

PREVIOUS DIAGNOSIS (from prior visit):
{previous_diagnosis_text if previous_diagnosis_text else "None"}

CRITICAL RULE FOR THIS ANALYSIS:
The CURRENT dictation describes the patient's CURRENT symptoms.
If the current symptoms (described below) are COMPLETELY DIFFERENT from the previous diagnosis,
then this is a NEW PRIMARY CANCER and should be diagnosed as such.

DO NOT default to the previous diagnosis unless the current symptoms match it.

═══════════════════════════════════════════════════════════════════
CURRENT PATIENT PRESENTATION (FROM DICTATION):
═══════════════════════════════════════════════════════════════════
{dictation_text}

═══════════════════════════════════════════════════════════════════
HISTORICAL CONTEXT (FOR REFERENCE ONLY - NOT CURRENT DIAGNOSIS):
═══════════════════════════════════════════════════════════════════
{patient_context[:2000] if patient_context else "No historical context"}

PREVIOUS TREATMENT PLAN:
{previous_treatment_text[:500] if previous_treatment_text else "None"}

═══════════════════════════════════════════════════════════════════
INSTRUCTION:
═══════════════════════════════════════════════════════════════════
Based on the CURRENT SYMPTOMS described in the dictation, provide a diagnosis for the CURRENT condition.

The previous diagnosis should ONLY be considered if:
- The current dictation mentions symptoms matching that diagnosis
- The dictation explicitly states it's a follow-up for that condition
"""

        diagnostic_obj = DiagnosticInput(
            patient_context_summary=enhanced_context,
            age=age,
            gender=gender,
            medical_history_summary=medical_history_summary,
            procedure_summary=procedure_summary,
            latest_lab_summary=lab_summary,
            latest_imaging_summary=imaging_summary,
            doctor_note_or_dictation=dictation_text,
            visit_type=visit_type_enum,
            doctor_speciality=doctor_speciality,
            last_medications=last_medications,
            recent_procedures=recent_procedures,
            patient_id=patient_id,
            doctor_id=doctor_id,
        )

        llm = ChatGroq(
            model="llama-3.1-8b-instant",
            groq_api_key=os.getenv("GROQ_API_KEY"),
            temperature=0.2,
            max_tokens=10000,
        )

        report, _final_state = await run_diagnostic_reasoning(
            diagnostic_input=diagnostic_obj,
            llm=llm,
            neo4j_uri=os.getenv("NEO4J_URI"),
            neo4j_user=os.getenv("NEO4J_USER"),
            neo4j_password=os.getenv("NEO4J_PASSWORD"),
        )

        primary = report.primary_hypothesis

        # ─── HELPER FUNCTION: Filter only diagnosis skills ──────────────
        def _filter_diagnosis_skills(guidelines_list):
            """Filter guidelines to only include diagnosis skills."""
            if not guidelines_list:
                return []
            
            filtered = []
            for g in guidelines_list:
                # Check various fields that indicate this is a diagnosis skill
                skill_type = str(g.get("skill_type", "")).lower()
                skill_name = str(g.get("skill_name", g.get("title", ""))).lower()
                body = g.get("body", {})
                sections_used = g.get("sections_used", [])
                
                # Convert sections to list if it's a string
                if isinstance(sections_used, str):
                    sections_used = [sections_used]
                
                # Heuristics to identify diagnosis skills
                is_diagnosis = (
                    skill_type == "diagnosis" or
                    "diagnosis" in skill_name or
                    "diagnostic" in skill_name or
                    any("diagnostic" in str(s).lower() or "diagnosis" in str(s).lower() 
                        for s in sections_used) or
                    body.get("diagnostic_criteria") is not None or
                    body.get("diagnostic_pathway") is not None or
                    "diagnosis" in str(body).lower()
                )
                
                if is_diagnosis:
                    filtered.append(g)
            
            return filtered

        investigations_formatted = []
        for inv in report.investigations:
            investigations_formatted.append({
                "test": inv.test, "status": inv.status, "required_for": inv.required_for,
                "urgency": inv.urgency, "date_performed": inv.date_performed,
                "result_summary": inv.result_summary, "interpretation": inv.interpretation,
                "supports_hypothesis": inv.supports_hypothesis,
            })

        guideline_pathways_formatted = []
        for gp in primary.guideline_pathways:
            evidence_available_out = [
                {"parameter": ea.parameter, "value": ea.value, "source": ea.source, "date": ea.date,
                 "guideline_relevance": ea.guideline_relevance, "hypothesis_link": ea.hypothesis_link,
                 "decision_enabled": ea.decision_enabled}
                for ea in gp.evidence_available
            ]
            missing_pending_out = [
                {"investigation": mp.investigation, "guideline_requirement": mp.guideline_requirement,
                 "status": mp.status, "importance_for_treatment": mp.importance_for_treatment,
                 "hypothesis_step_blocked": mp.hypothesis_step_blocked, "ordering_priority": mp.ordering_priority,
                 "recommended_action": mp.recommended_action}
                for mp in gp.missing_pending
            ]
            ci_out = None
            if gp.clinical_interpretation:
                ci = gp.clinical_interpretation
                ci_out = {
                    "sufficient_for_treatment_initiation": ci.sufficient_for_treatment_initiation,
                    "treatment_ready_for": ci.treatment_ready_for, "limited_by_missing": ci.limited_by_missing,
                    "hypothesis_gate_status": ci.hypothesis_gate_status,
                    "hypothesis_gate_narrative": ci.hypothesis_gate_narrative,
                    "priority_next_steps": ci.priority_next_steps,
                }
            als_out = None
            if gp.alignment_summary:
                als = gp.alignment_summary
                als_out = {
                    "workup_completion_percent": als.workup_completion_percent,
                    "confirmed_criteria": als.confirmed_criteria, "pending_criteria": als.pending_criteria,
                    "missing_criteria": als.missing_criteria, "total_criteria": als.total_criteria,
                    "ready_for_surgery": als.ready_for_surgery,
                    "ready_for_systemic_therapy": als.ready_for_systemic_therapy,
                    "ready_for_mdt_discussion": als.ready_for_mdt_discussion,
                    "readiness_rationale": als.readiness_rationale,
                    "cross_guideline_consensus": als.cross_guideline_consensus,
                    "cross_guideline_conflicts": als.cross_guideline_conflicts,
                }

            guideline_pathways_formatted.append({
                "guideline_name": gp.guideline_name, "guideline_source": gp.guideline_source,
                "applicable_for": gp.applicable_for, "overall_alignment": gp.overall_alignment,
                "pathway_stage": gp.pathway_stage,
                "section_1_evidence_available": evidence_available_out,
                "section_2_missing_pending": missing_pending_out,
                "section_3_clinical_interpretation": ci_out,
                "section_4_alignment_summary": als_out,
                "cross_guideline_overlaps": gp.cross_guideline_overlaps,
                "confirmed_count": gp.confirmed_count, "pending_count": gp.pending_count,
                "missing_count": gp.missing_count,
            })

        hypothesis_formatted = None
        if report.hypothesis_reasoning:
            hr = report.hypothesis_reasoning
            hypothesis_formatted = {
                "primary_hypothesis": hr.primary_hypothesis, "confidence_at_entry": hr.confidence_at_entry,
                "confidence_current": hr.confidence_current, "confidence_for_treatment": hr.confidence_for_treatment,
                "diagnosis_gate": hr.diagnosis_gate, "gate_blockers": hr.gate_blockers,
                "gate_conditions": hr.gate_conditions, "confirmatory_tests_pending": hr.confirmatory_tests_pending,
                "ruling_out": hr.ruling_out, "specialist_summary": hr.specialist_summary,
                "steps": [
                    {"step_number": s.step_number, "step_label": s.step_label, "reasoning": s.reasoning,
                     "evidence_available": s.evidence_available, "evidence_missing": s.evidence_missing,
                     "outcome": s.outcome, "next_required": s.next_required}
                    for s in hr.steps
                ],
            }

        # ─── FILTER: Only diagnosis skills for differentials ─────────────
        differentials = []
        for alt in report.alternative_diagnoses:
            # Filter guidelines for each differential
            filtered_guidelines = _filter_diagnosis_skills(alt.guideline_sources)
            
            differentials.append({
                "disease": alt.disease, 
                "type": alt.disease_type, 
                "stage": alt.stage, 
                "size": alt.tumor_size,
                "probability": round(alt.probability, 2),
                "guidelines": _strip_guideline_sources_for_response(filtered_guidelines),
                "supported_by_skills": alt.supported_by_skills
            })

        # ─── FILTER: Only diagnosis skills for primary diagnosis ─────────
        filtered_primary_guidelines = _filter_diagnosis_skills(primary.guideline_sources)

        # ─── FILTER: Also filter skill_application_summary ──────────────
        filtered_skill_summary = []
        for skill in report.skill_application_summary:
            skill_name = str(skill.get("skill_name", "")).lower()
            if "diagnosis" in skill_name or "diagnostic" in skill_name:
                filtered_skill_summary.append(skill)

        # ISSUE 4 FIX — doctor-facing response. supported_by_skills and
        # skill_application_summary stay IN (they're the clinician-readable
        # "why"); the raw internal skill-tracking artifacts below are moved
        # to debug_bundle instead of living in the primary response.
        response_data = {
            "primary_diagnosis": {
                "disease": primary.disease, 
                "type": primary.disease_type, 
                "stage": primary.stage,
                "size": primary.tumor_size, 
                "probability": round(primary.probability, 2),
                "severity": primary.severity,
                "guidelines": _strip_guideline_sources_for_response(filtered_primary_guidelines),  # ← FILTERED
                "supporting_evidence": primary.supporting_evidence,
                "supported_by_skills": primary.supported_by_skills,
            },
            "differential_diagnoses": differentials,  # ← FILTERED
            "hypothesis_reasoning": hypothesis_formatted,
            "investigations": investigations_formatted,
            "missing_investigations": report.missing_investigations,
            "guideline_pathways": guideline_pathways_formatted,
            "red_flag_alerts": report.red_flag_alerts,
            "reason_for_primary_diagnosis": report.diagnostic_explanation,
            # ── doctor-facing "Skill Impact Report" — also filtered ──────
            "skill_application_summary": filtered_skill_summary,  # ← FILTERED
        }

        # ISSUE 4 FIX — internal skill-tracking / audit artifacts. Always
        # computed (still fully persisted to Mongo below for audit), but
        # only merged into the HTTP response when include_debug=true.
        debug_bundle = {
            "retrieved_skills": [_strip_skill_body_for_response(s) for s in report.retrieved_skills],
            "applied_skills":   [_strip_skill_body_for_response(s) for s in report.applied_skills],
            "skill_usage_log":  report.skill_usage_log,
            "retrieved_skills_summary": [build_skill_summary(s) for s in report.retrieved_skills],
            "applied_skills_summary":   [build_skill_summary(s) for s in report.applied_skills],
        }

        if visit_type_enum == VisitType.FOLLOWUP_VISIT:
            followup_analysis = getattr(report, 'followup_analysis', None)
            response_data["followup_context"] = {
                "previous_diagnosis": previous_diagnosis_text,
                "previous_treatment_plan": previous_treatment_text[:500] if previous_treatment_text else None,
                "visit_type": "follow_up",
                "relationship_to_prior_diagnosis": followup_analysis.get("diagnosis_action") if followup_analysis else None,
                "status_change": followup_analysis.get("status") if followup_analysis else None,
                "followup_reasoning": followup_analysis.get("reasoning") if followup_analysis else None,
            }

        # ISSUE 4 FIX — only attach the debug bundle when explicitly asked.
        # Doctor UI calls omit include_debug and get the clean payload only.
        if include_debug:
            response_data["debug"] = debug_bundle
        
        # ── persist the final report so GET /diagnostic/report/{doctor_id}/{patient_id}
        # has something to return. "report" stays the clean doctor-facing
        # shape; "debug" carries the full skill-tracking bundle for audit /
        # troubleshooting — nothing is discarded, just separated. ──
        await diagnostic_reports_collection.update_one(
            {"patient_id": patient_id, "doctor_id": doctor_id},
            {"$set": {
                "report": response_data,
                "debug": debug_bundle,
                "updated_at": datetime.utcnow(),
            }},
            upsert=True,
        )

        await retrieved_skills_collection.update_one(
            {
                "patient_id": patient_id,
                "doctor_id": doctor_id
            },
            {
                "$set": {
                    "patient_id": patient_id,
                    "doctor_id": doctor_id,
                    "retrieved_skills": report.retrieved_skills,
                    "applied_skills": report.applied_skills,
                    "skill_usage_log": report.skill_usage_log,
                    "skill_application_summary": report.skill_application_summary,
                    "updated_at": datetime.utcnow()
                }
            },
            upsert=True
        )

        return response_data

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Diagnostic endpoint error: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")


@router.get("/skill-retrieval/{doctor_id}/{patient_id}")
async def get_retrieved_skills(doctor_id: str, patient_id: str):
    doc = await retrieved_skills_collection.find_one(
        {"doctor_id": doctor_id, "patient_id": patient_id}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="No retrieved skills found — run POST /diagnostic/{patient_id} first")
    return doc


@router.get("/diagnostic/report/{doctor_id}/{patient_id}")
async def get_diagnostic_report(
    doctor_id: str,
    patient_id: str,
    # ISSUE 4 FIX — same split as the POST endpoint: doctor UI re-fetching a
    # saved report gets the clean shape by default; audit/debug tooling can
    # pass include_debug=true to also get the "debug" bundle back.
    include_debug: bool = Query(default=False, description="Include internal skill debug/audit data (retrieved_skills, applied_skills, skill_usage_log, summaries)."),
):
    doc = await diagnostic_reports_collection.find_one(
        {"doctor_id": doctor_id, "patient_id": patient_id}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="No report found — run POST /diagnostic/{patient_id} first")
    if not include_debug:
        doc.pop("debug", None)
    return doc



@router.post(
    "/patient-summary/save",
    summary="Save/update a patient's clinical summary"
)
async def save_patient_summary(payload: dict = Body(...)):

    # Handle wrapped payloads
    if "data" in payload:
        request = payload["data"]
    else:
        request = payload

    patient_id = request.get("patient_id")
    doctor_id = request.get("doctor_id")

    if not patient_id:
        return {
            "status": "error",
            "message": "patient_id missing"
        }

    if not doctor_id:
        return {
            "status": "error",
            "message": "doctor_id missing"
        }

    doc = {
        "patient_id": patient_id,
        "doctor_id": doctor_id,
        "generated_at": request.get("generated_at")
            or datetime.utcnow().isoformat(),

        "documents_analyzed": request.get("documents_analyzed"),
        "processing_time_ms": request.get("processing_time_ms"),

        "summary": request.get("summary", {}),
        "timeline": request.get("timeline", {}),
        "organ_analysis": request.get("organ_analysis", {}),
        "agent_timings": request.get("agent_timings", {}),
        "errors": request.get("errors", []),
        "clinical_summary": request.get("clinical_summary", {}),

        "updated_at": datetime.utcnow(),
    }

    result = await summary_collection.update_one(
        {
            "patient_id": patient_id,
            "doctor_id": doctor_id
        },
        {
            "$set": doc
        },
        upsert=True,
    )

    saved = await summary_collection.find_one(
        {
            "patient_id": patient_id,
            "doctor_id": doctor_id
        },
        {
            "_id": 0
        }
    )

    return {
        "status": "success",
        "upserted": result.upserted_id is not None,
        "modified": result.modified_count > 0,
        "patient_id": patient_id,
        "doctor_id": doctor_id,
        "data": saved,
    }

@router.get("/patient-summary/{doctor_id}/{patient_id}", summary="View a patient's saved summary")
async def get_patient_summary(doctor_id: str, patient_id: str):
    doc = await summary_collection.find_one(
        {"patient_id": patient_id, "doctor_id": doctor_id},
        {"_id": 0},
        sort=[("_id", -1)],
    )
    if not doc:
        raise HTTPException(status_code=404, detail="No patient_summary found for this doctor/patient")
    return doc

@router.post("/diagnostic-skill/reindex/{doctor_id}")
async def reindex_doctor_skills(doctor_id: str, only_approved: bool = Query(default=True)):
    """
    Backfill / refresh: embeds every existing skill for this doctor into the
    'clinical_skills' Chroma collection. Standalone browse/backfill utility —
    NOT part of the live diagnostic retrieval path (that goes through
    Phase 2's ClinicalRAGRetrievalEngine directly).
    """
    result = await index_all_skills_for_doctor(doctor_id, only_approved=only_approved)
    return {"doctor_id": doctor_id, **result}