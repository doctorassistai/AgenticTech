"""
diagnostic_agent.py  — v2.S
============================
Next-Generation Hybrid Diagnostic Reasoning System for DoctorAssist

What changed in v2.0
---------------------
1. NEW  HypothesisToDiagnosisReasoningAgent (A0-style specialist thought process)
        • Builds a formal differential ladder from hypothesis → confirmed / refuted
        • Documents the evidence chain a specialist would follow
        • Produces a "diagnostic confidence map" and a treatment-readiness gate

2. NEW  GuidelinePathwayMappingAgent
        • Maps suspected condition → applicable guideline pathways
        • For each guideline criterion: marks CONFIRMED / PENDING / MISSING / NOT APPLICABLE
        • Surfaces overlapping criteria across multiple guidelines
        • Outputs a per-guideline evidence gap list

3. REWORKED  DiagnosticStressTester / InvestigationGapAnalyzer
        • Investigations now come back as one of:
            DONE_CONFIRMED  – test was performed, result available, supports hypothesis
            DONE_REFUTES    – test was performed, result available, contradicts hypothesis
            DONE_INCONCLUSIVE – test was performed, result present but not diagnostic
            NOT_DONE        – test not yet performed
        • Each DONE* entry carries: date, result_summary, interpretation
        • "Missing" section is now strictly: tests required to (a) confirm diagnosis
          OR (b) verify treatment eligibility — not a generic workup list

4. REWORKED  GuidelineValidationAgent
        • Now calls GuidelinePathwayMappingAgent internally
        • Returns structured pathway_mapping alongside the previous guideline list

Architecture (LangGraph):
  clinical_language
  → build_evidence_graph
  → generate_differentials
  → knowledge_graph
  → probabilistic_scoring
  → disease_characterization
  → severity_scoring
  → hypothesis_to_diagnosis_reasoning   ← NEW
  → guideline_validation                ← REWORKED (calls pathway mapper)
  → stress_testing                      ← REWORKED
  → investigation_gap                   ← REWORKED
  → conflict_detection
  → longitudinal_analysis
  → red_flag_detection
  → doctor_hypothesis
  → report_generation
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
    WebSocket, status, File, Form, UploadFile, Query, Response
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

try:
    from shared.audit.schema import AuditEvent
    from shared.audit.utils import emit_audit
except ImportError:
    pass  # allow running standalone

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
doctor_guidelines_collection = db["doctor_guidelines"]
doctor_user_collection       = db["doctor_users"]
summary_collection           = database["patient_summary"]
# Add these collection references after your existing DB connections
diagnosis_data_collection = database["diagnosis_data"]
documentation_treatment_plan_collection = database["documentation-treatment-plan"]

patient_appointments_collection = db["patient_appointments"]
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
    """
    Fine-grained status for each recommended investigation.

    DONE_CONFIRMED   – performed, result supports primary hypothesis
    DONE_REFUTES     – performed, result contradicts hypothesis
    DONE_INCONCLUSIVE – performed, present but non-diagnostic
    NOT_DONE         – not yet performed
    """
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


# ── Investigation with status + result ────────────────────────────────────────

class InvestigationItem(BaseModel):
    """
    A single recommended investigation with its current evidence status.

    Fields
    ------
    test                 : name of the test / procedure
    status               : one of InvestigationStatus enum values
    date_performed       : ISO date string if done
    result_summary       : brief result text if done
    interpretation       : clinical interpretation of result
    supports_hypothesis  : does this result support the primary hypothesis?
    required_for         : "diagnosis_confirmation" | "treatment_eligibility" | "both" | "monitoring"
    urgency              : "immediate" | "before_treatment" | "planned" | "optional"
    """
    test:                str
    status:              str                = InvestigationStatus.NOT_DONE
    date_performed:      Optional[str]      = None
    result_summary:      Optional[str]      = None
    interpretation:      Optional[str]      = None
    supports_hypothesis: Optional[bool]     = None
    required_for:        str                = "diagnosis_confirmation"
    urgency:             str                = "before_treatment"


# ── Guideline pathway ─────────────────────────────────────────────────────────

class GuidelineCriterion(BaseModel):
    """One criterion within a guideline pathway."""
    criterion_name:   str
    criterion_detail: str
    status:           str             = "PENDING"  # CONFIRMED | PENDING | MISSING | NOT_APPLICABLE
    evidence_from:    Optional[str]   = None       # source doc / test that confirms it
    evidence_text:    Optional[str]   = None       # exact result / value from record
    missing_action:   Optional[str]   = None       # what to order if PENDING/MISSING
    decision_impact:  Optional[str]   = None       # what treatment decision this criterion gates


class EvidenceAvailableItem(BaseModel):
    """Section 1 — a confirmed parameter mapped to its guideline relevance."""
    parameter:              str   # e.g., "Tumor histology — IDC Grade 2"
    value:                  str   # actual value / result
    source:                 str   # document / test name
    date:                   Optional[str] = None
    guideline_relevance:    str   # why this matters per guideline
    hypothesis_link:        str   # which step of the specialist reasoning this satisfies
    decision_enabled:       str   # what treatment/staging decision this unlocks


class MissingPendingItem(BaseModel):
    """Section 2 — a missing or pending guideline-required investigation."""
    investigation:          str
    guideline_requirement:  str   # which guideline mandates this
    status:                 str   = "MISSING"  # MISSING | PENDING
    importance_for_treatment: str # why it matters for the treatment plan
    hypothesis_step_blocked:  str # which step of the specialist reasoning is blocked
    ordering_priority:        int = 1   # 1 = highest
    recommended_action:       str = ""


class ClinicalInterpretationBlock(BaseModel):
    """Section 3 — synthesis of what is ready, what is limited, what to do next."""
    sufficient_for_treatment_initiation: bool   = False
    treatment_ready_for:    List[str]    = Field(default_factory=list)  # e.g., ["Surgery", "Hormone therapy"]
    limited_by_missing:     List[str]    = Field(default_factory=list)  # decisions blocked
    hypothesis_gate_status: str          = "not_ready"  # mirrors HypothesisReasoningOutput.diagnosis_gate
    hypothesis_gate_narrative: str       = ""           # specialist's summary at this gate
    priority_next_steps:    List[str]    = Field(default_factory=list)  # ordered action list


class GuidelineAlignmentSummary(BaseModel):
    """Section 4 — overall workup completion and readiness assessment."""
    workup_completion_percent:  int    = 0
    confirmed_criteria:         int    = 0
    pending_criteria:           int    = 0
    missing_criteria:           int    = 0
    total_criteria:             int    = 0
    ready_for_surgery:          str    = "No"      # Yes | Conditional | No
    ready_for_systemic_therapy: str    = "No"
    ready_for_mdt_discussion:   str    = "No"
    readiness_rationale:        str    = ""
    cross_guideline_consensus:  str    = ""   # where multiple guidelines agree
    cross_guideline_conflicts:  str    = ""   # where guidelines differ


class GuidelinePathway(BaseModel):
    """
    Full 4-section structured guideline analysis for one guideline,
    driven by the specialist's hypothesis reasoning.

    Section 1  — Evidence Available (confirmed parameters + guideline relevance)
    Section 2  — Missing / Pending (what is needed and why)
    Section 3  — Clinical Interpretation (synthesis, gate status, next steps)
    Section 4  — Guideline Alignment Summary (completion %, readiness gates)
    """
    guideline_name:    str
    guideline_source:  str
    applicable_for:    str
    pathway_stage:     Optional[str]                  = None
    overall_alignment: str                            = "partial"

    # Section 1
    evidence_available:       List[EvidenceAvailableItem]   = Field(default_factory=list)

    # Section 2
    missing_pending:          List[MissingPendingItem]       = Field(default_factory=list)

    # Section 3
    clinical_interpretation:  Optional[ClinicalInterpretationBlock] = None

    # Section 4
    alignment_summary:        Optional[GuidelineAlignmentSummary]   = None

    # Cross-guideline metadata
    cross_guideline_overlaps: List[str]                      = Field(default_factory=list)

    # Legacy flat counts (kept for backward compat)
    confirmed_count:  int = 0
    pending_count:    int = 0
    missing_count:    int = 0


# ── Hypothesis reasoning ──────────────────────────────────────────────────────

class HypothesisStep(BaseModel):
    """One step on the specialist's hypothesis-to-diagnosis ladder."""
    step_number:       int
    step_label:        str   # e.g., "Initial suspicion", "First-line workup", "Confirmatory test"
    reasoning:         str
    evidence_available: List[str]  = Field(default_factory=list)
    evidence_missing:  List[str]   = Field(default_factory=list)
    outcome:           str         = "pending"  # confirmed | refuted | pending | partially_supported
    next_required:     Optional[str] = None


class HypothesisReasoningOutput(BaseModel):
    """
    Full specialist thought process from initial hypothesis to diagnostic readiness.
    """
    primary_hypothesis:        str
    confidence_at_entry:       float  = 0.0   # before tests
    confidence_current:        float  = 0.0   # after available evidence
    confidence_for_treatment:  float  = 0.0   # confidence target needed to start treatment
    steps:                     List[HypothesisStep] = Field(default_factory=list)
    diagnosis_gate:            str    = "not_ready"  # ready | conditional | not_ready | refuted
    gate_blockers:             List[str] = Field(default_factory=list)   # what is blocking
    gate_conditions:           List[str] = Field(default_factory=list)   # conditions to proceed
    confirmatory_tests_pending: List[str] = Field(default_factory=list)
    ruling_out:                List[str] = Field(default_factory=list)   # diagnoses being actively excluded
    specialist_summary:        str   = ""


# ── Diagnosis candidate ───────────────────────────────────────────────────────

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


# ── Final report ──────────────────────────────────────────────────────────────

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
    followup_analysis:       Optional[Dict[str, Any]]     = None  # ← THIS MUST EXIST


# ──────────────────────────────────────────────────────────────────────────────
# LANGGRAPH STATE
# ──────────────────────────────────────────────────────────────────────────────

class DiagnosticState(TypedDict):
    diagnostic_input:          DiagnosticInput
    structured_clinical_data:  Optional[ClinicalLanguageOutput]
    evidence_graph:            Optional[nx.DiGraph]
    evidence_nodes:            List[EvidenceNode]
    evidence_edges:            List[EvidenceEdge]
    candidate_diseases:        List[str]
    scored_diagnoses:          List[DiagnosisCandidate]
    evidence_conflicts:        List[str]
    investigations:            List[InvestigationItem]       # replaces recommended_investigations
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
# A1  CLINICAL LANGUAGE UNDERSTANDING
# ──────────────────────────────────────────────────────────────────────────────

class ClinicalLanguageAgent:
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def process(self, state: DiagnosticState) -> DiagnosticState:
        logger.info("ClinicalLanguageAgent — START")
        di = state["diagnostic_input"]

        prompt = f"""You are a medical NLP expert extracting structured data from clinical notes.

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
  "pending_tests": ["..."]
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
                        # flatten dict into readable string
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

            state["structured_clinical_data"] = ClinicalLanguageOutput(**result)
            logger.info(f"Symptoms: {result.get('symptoms')}")
            logger.info(f"Hypothesis: {result.get('doctor_hypothesis')}")
        except Exception as e:
            logger.error(f"ClinicalLanguageAgent failed: {e}")
            state["error"] = str(e)
            state["warnings"].append("Clinical language extraction incomplete")
        return state


# ──────────────────────────────────────────────────────────────────────────────
# A2  EVIDENCE GRAPH BUILDER
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
# A3  DIFFERENTIAL GENERATOR
# ──────────────────────────────────────────────────────────────────────────────

class DifferentialDiagnosisGenerator:
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def generate(self, state: DiagnosticState) -> DiagnosticState:
        logger.info("DifferentialDiagnosisGenerator — START")
        di      = state["diagnostic_input"]
        clinical = state.get("structured_clinical_data")

        prompt = f"""
You are an expert physician analyzing a patient case.

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

Return JSON only.
{{"differentials": ["disease1","disease2","disease3"]}}"""

        try:
            response = self.llm.invoke([
                SystemMessage(content="Generate clinical differential diagnoses."),
                HumanMessage(content=prompt),
            ])
            parsed  = _parse_json(response.content)
            state["candidate_diseases"] = parsed.get("differentials", [])
            logger.info(f"Differentials: {state['candidate_diseases']}")
        except Exception as e:
            logger.error(f"Differential generation failed: {e}")
            state["candidate_diseases"] = []
        return state


# ──────────────────────────────────────────────────────────────────────────────
# A4  KNOWLEDGE GRAPH
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
# A5  PROBABILISTIC SCORING
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

        for disease in candidates:
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
            # 🔥 ADD THIS BLOCK RIGHT HERE
            followup = state.get("followup_analysis")
            # 🔥 DEBUG PRINT (ADD THIS LINE)
            print("FOLLOWUP:", followup)

            if followup:
                if followup.get("diagnosis_action") == "confirm":
                    probability += 0.15
                elif followup.get("diagnosis_action") == "modify":
                    probability -= 0.1
                elif followup.get("diagnosis_action") == "replace":
                    # 🔥 FIX: Drastically reduce probability for old diagnosis
                    probability -= 0.5  # Reduce by 50%
                    logger.info(f"Replacing diagnosis for {disease}, reducing probability to {probability}")

            missing_ev    = [f"Expected symptom: {s}" for s in expected.get("symptoms", []) if clinical and s not in clinical.symptoms]
            required_tests = expected.get("lab_markers", [])

            scored.append(DiagnosisCandidate(
                disease=disease,
                probability=probability,
                supporting_evidence=supporting,
                conflicting_evidence=conflicting,
                required_tests=required_tests,
                missing_evidence=missing_ev,
            ))

        scored.sort(key=lambda x: x.probability, reverse=True)
        state["scored_diagnoses"] = scored

        # 🔥 FIX: AUTO-INFER PRIMARY DIAGNOSIS IF NULL
        clinical = state.get("structured_clinical_data")

        if clinical:
            dh = clinical.doctor_hypothesis

            invalid_values = [
                None,
                "",
                "null",
                "none",
                "primary suspected diagnosis or null"
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
# A6  DISEASE CHARACTERIZATION
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
# A7  SEVERITY SCORING
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
# A8  HYPOTHESIS → DIAGNOSIS REASONING  (NEW)
# ──────────────────────────────────────────────────────────────────────────────

class HypothesisToDiagnosisReasoningAgent:
    """
    Mimics a specialist's formal thought process from clinical suspicion to
    diagnostic confidence and treatment readiness.

    Produces a step-by-step evidence chain:
      Step 1: Initial suspicion (why this disease fits the presentation)
      Step 2: First-line workup (which tests were ordered and why)
      Step 3: First-line result interpretation (what the results show)
      Step 4: Second-line / confirmatory workup (what is still needed)
      Step 5: Diagnostic gate assessment (ready / conditional / not ready)
      Step 6: Treatment readiness gate (what is confirmed vs pending)

    Each step references actual data from the patient record.
    """

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
  What is the GOLD-STANDARD confirmatory test for {primary.disease}?
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
  "specialist_summary": "3-5 sentence specialist narrative covering: what the presentation suggests, what the evidence confirms so far, what is still needed, and what the current treatment readiness is."
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

            state["hypothesis_reasoning"] = reasoning
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
        # 🔍 DEBUG LOGGING
        logger.info(f"🔍 FollowUpClinicalReasoningAgent - Visit type: {di.visit_type}")
        logger.info(f"🔍 FollowUpClinicalReasoningAgent - Visit type value: {di.visit_type.value}")
        logger.info(f"🔍 FollowUpClinicalReasoningAgent - Is follow-up? {di.visit_type == VisitType.FOLLOWUP_VISIT}")
        # 🚨 Run ONLY for follow-up
        if di.visit_type != VisitType.FOLLOWUP_VISIT:
            return state
        logger.info("✅ FollowUpClinicalReasoningAgent - Processing follow-up visit")

        clinical = state.get("structured_clinical_data")
        reasoning = state.get("hypothesis_reasoning")
        investigations = state.get("investigations", [])
        
        # Get current dictation
        current_dictation = di.doctor_note_or_dictation
        
        # Get previous diagnosis from state if available
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
            
            # 🔥 CRITICAL FIX: If diagnosis_action is "replace", OVERRIDE the scored diagnoses
            if parsed.get("diagnosis_action") == "replace" and parsed.get("new_diagnosis"):
                new_diagnosis_name = parsed.get("new_diagnosis")
                new_confidence = float(parsed.get("confidence", 0.85))
                new_gate = parsed.get("diagnosis_gate", "conditional")
                new_blockers = parsed.get("gate_blockers", [])
                new_summary = parsed.get("specialist_summary", "")
                
                logger.info(f"🔄 REPLACING diagnosis with new condition: {new_diagnosis_name} (confidence: {new_confidence})")
                
                # Extract symptoms from clinical data
                symptoms = clinical.symptoms if clinical else []
                findings = clinical.clinical_findings if clinical else []
                
                # Create supporting evidence list dynamically
                supporting_evidence = []
                for s in symptoms:
                    supporting_evidence.append(f"Symptom: {s}")
                for f in findings[:3]:
                    supporting_evidence.append(f"Finding: {f}")
                
                # Create the new diagnosis candidate with dynamic values
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
                
                # REPLACE the scored diagnoses list with the new diagnosis at the top
                                # REPLACE the scored diagnoses list with the new diagnosis at the top
                scored = state.get("scored_diagnoses", [])
                if scored:
                    # Get the old top diagnosis (the one being replaced)
                    old_top = scored[0] if scored else None
                    
                    # Collect other diagnoses as potential differentials
                    other_diagnoses = []
                    for dx in scored[1:]:  # Skip the first one (being replaced)
                        # Keep other skin cancer related diagnoses
                        if dx.disease.lower() not in [new_diagnosis_name.lower()]:
                            other_diagnoses.append(dx)
                    
                    # Create new list with new diagnosis at top
                    new_scored = [new_diagnosis]
                    
                    # Add other relevant diagnoses as differentials (up to 3)
                    for dx in other_diagnoses[:3]:
                        new_scored.append(dx)
                    
                    # If we don't have enough differentials, add default skin cancer ones
                    if len(new_scored) < 2 and ("skin" in new_diagnosis_name.lower() or "cancer" in new_diagnosis_name.lower() or "carcinoma" in new_diagnosis_name.lower()):
                        # Create default differentials
                        default_dx1 = DiagnosisCandidate(
                            disease="Basal Cell Carcinoma",
                            probability=0.30,
                            disease_type=None,
                            stage=None,
                            tumor_size=None,
                            supporting_evidence=["Sun exposure history", "Similar presentation"],
                            conflicting_evidence=[],
                            required_tests=["Biopsy"],
                            missing_evidence=[],
                            severity=None,
                            guideline_sources=[],
                            guideline_pathways=[]
                        )
                        default_dx2 = DiagnosisCandidate(
                            disease="Melanoma",
                            probability=0.25,
                            disease_type=None,
                            stage=None,
                            tumor_size=None,
                            supporting_evidence=["Pigmented lesion", "Family history"],
                            conflicting_evidence=[],
                            required_tests=["Biopsy"],
                            missing_evidence=[],
                            severity=None,
                            guideline_sources=[],
                            guideline_pathways=[]
                        )
                        default_dx3 = DiagnosisCandidate(
                            disease="Actinic Keratosis",
                            probability=0.20,
                            disease_type=None,
                            stage=None,
                            tumor_size=None,
                            supporting_evidence=["Scaly patches", "Sun damage"],
                            conflicting_evidence=[],
                            required_tests=["Biopsy"],
                            missing_evidence=[],
                            severity=None,
                            guideline_sources=[],
                            guideline_pathways=[]
                        )
                        
                        # Add only if not already in list
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
                
                # Update the hypothesis_reasoning with dynamic values
                hypothesis = state.get("hypothesis_reasoning")
                if hypothesis:
                    hypothesis.primary_hypothesis = new_diagnosis_name
                    hypothesis.confidence_current = new_confidence
                    hypothesis.diagnosis_gate = new_gate
                    hypothesis.gate_blockers = new_blockers
                    hypothesis.specialist_summary = new_summary
                    state["hypothesis_reasoning"] = hypothesis
                
                logger.info(f"✅ Scored diagnoses replaced with new diagnosis: {new_diagnosis_name}")
                logger.info(f"   Gate: {new_gate} | Blockers: {new_blockers}")
                
        except Exception as e:
            logger.error(f"FollowUp agent failed: {e}")
            state["followup_analysis"] = None

        return state
# ──────────────────────────────────────────────────────────────────────────────
# A9  GUIDELINE PATHWAY MAPPING  (v2.1 — 4-section structure + hypothesis wiring)
# ──────────────────────────────────────────────────────────────────────────────

class GuidelinePathwayMappingAgent:
    """
    Produces a structured 4-section guideline analysis for each applicable
    guideline, with the specialist's hypothesis reasoning woven in at every layer.

    Section 1 — Evidence Available
        Parameters already confirmed in the patient record, each mapped to:
        • its guideline relevance
        • which step of the specialist's hypothesis reasoning it satisfies
        • which treatment decision it unlocks

    Section 2 — Missing / Pending as per Guidelines
        Investigations required by the guideline that are absent or pending:
        • why they are needed for treatment planning
        • which hypothesis step they would resolve if obtained
        • ordering priority

    Section 3 — Clinical Interpretation
        Synthesis driven by the hypothesis gate:
        • Is current evidence sufficient to initiate treatment?
        • Which decisions are blocked by missing data?
        • What are the priority next steps (ordered)?

    Section 4 — Guideline Alignment Summary
        • Workup completion %
        • Readiness: Surgery / Systemic therapy / MDT discussion
        • Cross-guideline consensus and conflicts
    """

    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def map_pathways(
        self,
        state: DiagnosticState,
        primary_disease: str,
        guidelines: List[Dict],
    ) -> List[GuidelinePathway]:
        logger.info("GuidelinePathwayMappingAgent (v2.1) — START")

        di         = state["diagnostic_input"]
        clinical   = state.get("structured_clinical_data")
        hypothesis = state.get("hypothesis_reasoning")
        scored     = state.get("scored_diagnoses", [])
        primary    = scored[0] if scored else None

        guidelines_json     = json.dumps(guidelines, indent=2)
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
for EACH applicable guideline.

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
SPECIALIST HYPOTHESIS REASONING (from HypothesisToDiagnosisAgent)
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
APPLICABLE GUIDELINES
═══════════════════════════════════════════════════════════════════
{guidelines_json}

═══════════════════════════════════════════════════════════════════
YOUR TASK — 4-SECTION STRUCTURED ANALYSIS PER GUIDELINE
═══════════════════════════════════════════════════════════════════

For EACH guideline above, produce all four sections below.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 1 — EVIDENCE AVAILABLE (as per guideline)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Identify and list all clinical, pathological, and radiological parameters that are:
  (a) Already established in this patient's record, AND
  (b) Required or recommended by this specific guideline for workup of {primary_disease}

For EACH confirmed parameter provide:
  • parameter:           exact parameter name (e.g., "Tumor histology — IDC Grade 2")
  • value:               actual value / result from the patient record
  • source:              which document / test it came from
  • date:                date of that result
  • guideline_relevance: why this parameter is important per THIS guideline
                         (map it to a specific recommendation in the guideline)
  • hypothesis_link:     which step of the specialist reasoning above this satisfies
                         (use the step_label from the hypothesis steps)
  • decision_enabled:    what specific treatment/staging/management decision
                         is now possible because this parameter is confirmed

INCLUDE parameters such as (if present and confirmed for this disease):
  Histology / pathological grade, tumor size, receptor status (ER/PR/HER2 or PSA/Gleason
  or other disease-specific markers), staging components (T/N/M or equivalent),
  imaging findings relevant to staging, lymph node assessment, performance status,
  organ function relevant to treatment eligibility, prior treatment history.

DO NOT include parameters that are not present in the patient record.
DO NOT fabricate values.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 2 — MISSING / PENDING AS PER GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Identify all investigations, staging components, or biomarkers that:
  (a) Are recommended or required by this guideline for {primary_disease}, AND
  (b) Are NOT available or are incomplete in this patient's record

For EACH missing/pending item provide:
  • investigation:           exact test name
  • guideline_requirement:   cite the specific guideline recommendation this fulfils
  • status:                  MISSING (not ordered) | PENDING (ordered, result awaited)
  • importance_for_treatment: precisely WHY this missing item matters for treatment planning
                              — name the specific treatment decision it would enable
  • hypothesis_step_blocked:  which step of the specialist's reasoning is currently
                              BLOCKED because this test is missing
                              (reference the step_label from the hypothesis steps)
  • ordering_priority:        1 = must have before any treatment decision
                              2 = required before specific treatment
                              3 = recommended, can be deferred briefly
  • recommended_action:       exact next step (e.g., "Order MRI breast with contrast",
                              "Refer for axillary ultrasound + FNAC if suspicious nodes")

Focus on items that are SPECIFICALLY listed as blocked in the specialist's gate_blockers
or confirmatory_tests_pending. These are the highest priority.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 3 — CLINICAL INTERPRETATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Provide a brief synthesis driven by the hypothesis gate status.

  • sufficient_for_treatment_initiation: true | false
    — can treatment begin NOW based on current evidence?

  • treatment_ready_for: list SPECIFIC treatments that CAN proceed now
    (e.g., "Hormone therapy — ER+ confirmed, receptor status complete",
     "Adjuvant chemotherapy — pending Oncotype DX result")

  • limited_by_missing: list SPECIFIC decisions that CANNOT be made yet
    because of missing data (tie each to a specific missing investigation)

  • hypothesis_gate_status: use the SAME value as the hypothesis reasoning gate
    (ready | conditional | not_ready | refuted)
    — this ensures consistency between the hypothesis layer and the guideline layer

  • hypothesis_gate_narrative: 2-3 sentences explaining the gate status
    in the context of THIS guideline's requirements.
    For example: "Per NCCN breast cancer guidelines, the current evidence supports
    a diagnosis of clinical Stage IIA invasive breast cancer. However, axillary nodal
    status cannot be confirmed without sentinel node biopsy, which blocks the final
    surgical planning decision."

  • priority_next_steps: ordered list of the 3-5 most urgent clinical actions
    (each step must be specific and actionable — no vague verbs)
    Priority is determined by:
    (1) items from the specialist's gate_blockers list
    (2) Section 2 items with ordering_priority = 1
    (3) Other Section 2 items with ordering_priority = 2

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 4 — GUIDELINE ALIGNMENT SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  • workup_completion_percent:  % of guideline-recommended workup items that are CONFIRMED
    (confirmed_criteria / total_criteria × 100, rounded to nearest 5%)

  • confirmed_criteria:  count of CONFIRMED parameters (Section 1)
  • pending_criteria:    count of PENDING items (Section 2 with status=PENDING)
  • missing_criteria:    count of MISSING items (Section 2 with status=MISSING)
  • total_criteria:      confirmed + pending + missing

  • ready_for_surgery:           "Yes" | "Conditional on [specific test]" | "No — [reason]"
  • ready_for_systemic_therapy:  "Yes" | "Conditional on [specific test]" | "No — [reason]"
  • ready_for_mdt_discussion:    "Yes" | "Conditional on [specific test]" | "No — [reason]"

  • readiness_rationale:  1-2 sentences explaining the readiness assessment

  • cross_guideline_consensus:   if multiple guidelines are being analyzed, note where they
    AGREE on the required workup or treatment approach

  • cross_guideline_conflicts:   where guidelines DIFFER — note the specific discrepancy
    and which to prioritize for this patient's context

═══════════════════════════════════════════════════════════════════
OUTPUT — Return ONLY valid JSON
═══════════════════════════════════════════════════════════════════

{{
  "pathway_mappings": [
    {{
      "guideline_name":    "...",
      "guideline_source":  "...",
      "applicable_for":    "...",
      "pathway_stage":     "...",
      "overall_alignment": "full | partial | insufficient | not_applicable",

      "evidence_available": [
        {{
          "parameter":           "...",
          "value":               "...",
          "source":              "...",
          "date":                "...",
          "guideline_relevance": "...",
          "hypothesis_link":     "...",
          "decision_enabled":    "..."
        }}
      ],

      "missing_pending": [
        {{
          "investigation":            "...",
          "guideline_requirement":    "...",
          "status":                   "MISSING | PENDING",
          "importance_for_treatment": "...",
          "hypothesis_step_blocked":  "...",
          "ordering_priority":        1,
          "recommended_action":       "..."
        }}
      ],

      "clinical_interpretation": {{
        "sufficient_for_treatment_initiation": false,
        "treatment_ready_for":    ["..."],
        "limited_by_missing":     ["..."],
        "hypothesis_gate_status": "ready | conditional | not_ready | refuted",
        "hypothesis_gate_narrative": "...",
        "priority_next_steps":    ["..."]
      }},

      "alignment_summary": {{
        "workup_completion_percent":  0,
        "confirmed_criteria":         0,
        "pending_criteria":           0,
        "missing_criteria":           0,
        "total_criteria":             0,
        "ready_for_surgery":          "Yes | Conditional on [...] | No — [reason]",
        "ready_for_systemic_therapy": "Yes | Conditional on [...] | No — [reason]",
        "ready_for_mdt_discussion":   "Yes | Conditional on [...] | No — [reason]",
        "readiness_rationale":        "...",
        "cross_guideline_consensus":  "...",
        "cross_guideline_conflicts":  "..."
      }},

      "cross_guideline_overlaps": ["criterion names shared with other guidelines"],
      "confirmed_count": 0,
      "pending_count":   0,
      "missing_count":   0
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

            result: List[GuidelinePathway] = []
            for m in mappings:
                # Parse sub-models safely
                ea = [EvidenceAvailableItem(**x) for x in m.get("evidence_available", [])]
                mp = [MissingPendingItem(**x)    for x in m.get("missing_pending", [])]

                ci_raw = m.get("clinical_interpretation")
                ci     = ClinicalInterpretationBlock(**ci_raw) if ci_raw else None

                as_raw = m.get("alignment_summary")
                als    = GuidelineAlignmentSummary(**as_raw) if as_raw else None

                result.append(GuidelinePathway(
                    guideline_name    = m.get("guideline_name", ""),
                    guideline_source  = m.get("guideline_source", ""),
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

            logger.info(f"Mapped {len(result)} guideline pathways (4-section)")
            return result
        except Exception as e:
            logger.error(f"GuidelinePathwayMappingAgent failed: {e}")
            return []


# ──────────────────────────────────────────────────────────────────────────────
# A10  GUIDELINE VALIDATION  (REWORKED — calls pathway mapper)
# ──────────────────────────────────────────────────────────────────────────────

async def load_doctor_guidelines(doctor_id: str, specialization: str) -> List[Dict]:
    try:
        url = f"https://doctorassist.ai/api/hms/users/data/context/get_DoctorGuidelinesByDoctor/{doctor_id}"
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(url)
        if response.status_code != 200:
            return []
        data = response.json()
        if data.get("status") != "success":
            return []
        all_guidelines = data.get("data", [])
        doc_spec = str(specialization).lower().strip()
        for item in all_guidelines:
            api_spec = str(item.get("specialization", "")).lower().strip()
            if api_spec in doc_spec or doc_spec in api_spec:
                return item.get("guidelines", [])
        return []
    except Exception as e:
        logger.error(f"Guideline API error: {e}")
        return []


class GuidelineValidationAgent:
    def __init__(self, llm: ChatGroq):
        self.llm    = llm
        self.mapper = GuidelinePathwayMappingAgent(llm)

    async def validate(self, state: DiagnosticState) -> DiagnosticState:
        logger.info("GuidelineValidationAgent — START")
        diagnoses = state.get("scored_diagnoses", [])
        di        = state["diagnostic_input"]
        clinical  = state.get("structured_clinical_data")

        doctor_guidelines = await load_doctor_guidelines(di.doctor_id, di.doctor_speciality)
        logger.info(f"Guidelines loaded: {len(doctor_guidelines)}")

        if not doctor_guidelines or not diagnoses:
            return state

        primary        = diagnoses[0]
        guidelines_json = json.dumps(doctor_guidelines, indent=2)

        # ── Standard guideline-to-disease matching ──────────────────────────
        for diagnosis in diagnoses[:4]:
            prompt = f"""
You are a senior clinical decision system.

Patient: Age {di.age}, {di.gender}
Symptoms: {clinical.symptoms if clinical else []}
Findings: {clinical.clinical_findings if clinical else []}
Disease: {diagnosis.disease}
Stage: {diagnosis.stage}

AVAILABLE GUIDELINES:
{guidelines_json}

From the guidelines choose those applicable to diagnosing or managing this disease
for THIS patient. For each explain WHY it applies.

Return JSON only:
{{
 "guidelines":[
   {{
     "title":"",
     "reference":"",
     "explanation":"",
     "reason":"why guideline applies to this disease and patient condition"
   }}
 ]
}}"""
            try:
                response = self.llm.invoke([
                    SystemMessage(content="Return clinical guideline matches."),
                    HumanMessage(content=prompt),
                ])
                parsed = _parse_json(response.content)
                diagnosis.guideline_sources = parsed.get("guidelines", [])
            except Exception as e:
                logger.error(e)

        # ── Guideline pathway mapping for primary diagnosis ─────────────────
        if primary.guideline_sources:
            pathways = await self.mapper.map_pathways(
                state=state,
                primary_disease=primary.disease,
                guidelines=primary.guideline_sources,
            )
            primary.guideline_pathways = pathways

        return state


# ──────────────────────────────────────────────────────────────────────────────
# A11  INVESTIGATION STRESS TESTER  (REWORKED)
# ──────────────────────────────────────────────────────────────────────────────

class DiagnosticStressTester:
    """
    Generates the recommended investigation list for the primary diagnosis.

    Each investigation is classified with one of:
        NOT_DONE | DONE_CONFIRMED | DONE_REFUTES | DONE_INCONCLUSIVE

    Each entry includes: date_performed, result_summary, interpretation (if done).
    Each entry also carries: required_for, urgency.
    """

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

Think like a specialist who:
(a) Reviews what investigations are ALREADY documented in the patient record
(b) Identifies which tests CONFIRM the hypothesis with actual results
(c) Identifies which tests are STILL NEEDED

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
  "diagnosis_confirmation"   — needed to confirm the disease itself
  "treatment_eligibility"    — needed to determine if patient can receive standard treatment
  "both"                     — needed for both purposes
  "staging"                  — needed to determine disease extent / severity
  "monitoring"               — baseline for future monitoring

urgency:
  "immediate"        — required before any decision is made
  "before_treatment" — required before starting treatment
  "planned"          — should be done but not blocking
  "optional"         — recommended but not mandatory for this case

IMPORTANT RULES:
- If a test is documented with a result anywhere in the patient record, it is DONE.
- Extract the ACTUAL result text from the patient record for done tests.
- Do NOT mark a test as not_done if there is evidence of it in the record.
- Include a brief interpretation: "supports hypothesis", "refutes hypothesis", etc.

Return ONLY valid JSON:
{{
  "investigations": [
    {{
      "test": "...",
      "status": "done_confirmed | done_refutes | done_inconclusive | not_done",
      "date_performed": "ISO date or null",
      "result_summary": "actual result text if done, else null",
      "interpretation": "clinical interpretation of the result",
      "supports_hypothesis": true,
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
            logger.info(f"Investigations: {len(investigations)} items")
        except Exception as e:
            logger.error(f"DiagnosticStressTester failed: {e}")
            state["investigations"] = []
        return state


# ──────────────────────────────────────────────────────────────────────────────
# A12  INVESTIGATION GAP ANALYZER  (REWORKED)
# ──────────────────────────────────────────────────────────────────────────────

class InvestigationGapAnalyzer:
    """
    Using the specialist's hypothesis reasoning and the investigation list,
    produces the MISSING investigations list — limited to tests that:

    (a) Are required to CONFIRM the diagnosis, OR
    (b) Are required to VERIFY TREATMENT ELIGIBILITY

    Each missing item is linked to the specific decision it unblocks.
    """

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

        # Build a rich missing list via LLM
        gate_blockers = hypothesis.gate_blockers if hypothesis else []
        confirmatory  = hypothesis.confirmatory_tests_pending if hypothesis else []

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
      "test": "...",
      "required_for": "diagnosis_confirmation | treatment_eligibility | staging",
      "decision_unblocked": "e.g., Confirms muscle invasion depth to determine cystectomy candidacy",
      "urgency": "immediate | before_treatment | planned",
      "ordering_priority": 1
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
            state["missing_investigations"] = [
                f"{m['test']} → {m.get('decision_unblocked','')}"
                for m in missing_raw
            ]
            logger.info(f"Missing investigations: {len(missing_raw)}")
        except Exception as e:
            logger.error(f"InvestigationGapAnalyzer failed: {e}")
            # Fallback: use blocking items from checklist
            state["missing_investigations"] = [i.test for i in blocking]
        return state


# ──────────────────────────────────────────────────────────────────────────────
# A13  EVIDENCE CONFLICT DETECTOR
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
# A14  LONGITUDINAL PROGRESSION
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
# A15  RED FLAG DETECTOR
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
# A16  DOCTOR HYPOTHESIS HANDLER
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
# A17  REPORT GENERATOR  (REWORKED)
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
            followup_analysis = state.get("followup_analysis"),
            hypothesis_reasoning   = state.get("hypothesis_reasoning"),
            longitudinal_risk_predictions = state.get("longitudinal_progression"),
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
# LANGGRAPH WORKFLOW
# ──────────────────────────────────────────────────────────────────────────────

def create_diagnostic_workflow(
    llm: ChatGroq,
    neo4j_manager: Neo4jConnectionManager,
) -> StateGraph:
    clinical_language_agent    = ClinicalLanguageAgent(llm)
    evidence_graph_builder     = EvidenceGraphBuilder()
    differential_generator     = DifferentialDiagnosisGenerator(llm)
    knowledge_graph_agent      = KnowledgeGraphAgent(neo4j_manager)
    probabilistic_engine       = ProbabilisticDiagnosisEngine(llm, neo4j_manager)
    characterization_agent     = DiseaseCharacterizationAgent(llm)
    severity_agent             = SeverityScoringAgent(llm)
    hypothesis_reasoning_agent = HypothesisToDiagnosisReasoningAgent(llm)
    guideline_agent            = GuidelineValidationAgent(llm)
    stress_tester              = DiagnosticStressTester(llm)
    investigation_gap          = InvestigationGapAnalyzer(llm)
    conflict_detector          = EvidenceConflictDetector()
    longitudinal_analyzer      = LongitudinalProgressionAnalyzer(llm)
    red_flag_detector          = RedFlagDetector(llm)
    doctor_hypothesis_handler  = DoctorHypothesisHandler(llm)
    report_generator           = DiagnosticReportGenerator(llm)
    followup_agent = FollowUpClinicalReasoningAgent(llm)
    
    workflow = StateGraph(DiagnosticState)
    
    # Add nodes
    workflow.add_node("clinical_language",           clinical_language_agent.process)
    workflow.add_node("build_evidence_graph",        evidence_graph_builder.build)
    workflow.add_node("generate_differentials",      differential_generator.generate)
    workflow.add_node("knowledge_graph",             knowledge_graph_agent.retrieve_candidates)
    workflow.add_node("probabilistic_scoring",       probabilistic_engine.score_diagnoses)
    workflow.add_node("disease_characterization",    characterization_agent.characterize)
    workflow.add_node("severity_scoring",            severity_agent.score)
    workflow.add_node("hypothesis_to_diagnosis_reasoning", hypothesis_reasoning_agent.reason)
    workflow.add_node("followup_reasoning",          followup_agent.analyze)
    workflow.add_node("guideline_validation",        guideline_agent.validate)
    workflow.add_node("stress_testing",              stress_tester.test)
    workflow.add_node("investigation_gap",           investigation_gap.analyze)
    workflow.add_node("conflict_detection",          conflict_detector.detect)
    workflow.add_node("longitudinal_analysis",       longitudinal_analyzer.analyze)
    workflow.add_node("red_flag_detection",          red_flag_detector.detect)
    workflow.add_node("doctor_hypothesis",           doctor_hypothesis_handler.evaluate)
    workflow.add_node("report_generation",           report_generator.generate)
    
    workflow.set_entry_point("clinical_language")
    
    # Add edges - FIXED: use consistent node names
    workflow.add_edge("clinical_language",        "build_evidence_graph")
    workflow.add_edge("build_evidence_graph",     "generate_differentials")
    workflow.add_edge("generate_differentials",   "knowledge_graph")
    workflow.add_edge("knowledge_graph",          "probabilistic_scoring")
    workflow.add_edge("probabilistic_scoring",    "disease_characterization")
    workflow.add_edge("disease_characterization", "severity_scoring")
    workflow.add_edge("severity_scoring",         "hypothesis_to_diagnosis_reasoning")  # ✅ FIXED
    workflow.add_edge("hypothesis_to_diagnosis_reasoning", "followup_reasoning")
    workflow.add_edge("followup_reasoning",       "guideline_validation")
    workflow.add_edge("guideline_validation",     "stress_testing")
    workflow.add_edge("stress_testing",           "investigation_gap")
    workflow.add_edge("investigation_gap",        "conflict_detection")
    workflow.add_edge("conflict_detection",       "longitudinal_analysis")
    workflow.add_edge("longitudinal_analysis",    "red_flag_detection")
    workflow.add_edge("red_flag_detection",       "doctor_hypothesis")
    workflow.add_edge("doctor_hypothesis",        "report_generation")
    workflow.add_edge("report_generation",        END)
    
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
) -> DiagnosticReport:
    logger.info(f"Diagnostic Reasoning: patient={diagnostic_input.patient_id}")
    neo4j_manager = Neo4jConnectionManager(neo4j_uri, neo4j_user, neo4j_password)

    try:
        workflow = create_diagnostic_workflow(llm, neo4j_manager)
        initial_state: DiagnosticState = {
            "diagnostic_input":         diagnostic_input,
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
        }
        final_state = await workflow.ainvoke(initial_state)

        if final_state.get("warnings"):
            logger.warning(f"Warnings: {final_state['warnings']}")
        if final_state.get("error"):
            logger.error(f"Error: {final_state['error']}")

        if final_state.get("diagnostic_report"):
            return final_state["diagnostic_report"]
        raise RuntimeError("Diagnostic workflow failed to generate report")
    finally:
        neo4j_manager.close()


# ──────────────────────────────────────────────────────────────────────────────
# PATIENT CONTEXT BUILDER
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
# API ENDPOINT
# ──────────────────────────────────────────────────────────────────────────────

# class DiagnosticRequest(BaseModel):
#     doctor_note_or_dictation: str


# @router.post("/diagnostic/{patient_id}")
# async def diagnostic_endpoint(
#     patient_id: str,
#     request:    DiagnosticRequest,
#     doctor_id:  str = Query(...),
# ):
#     logger.info(f"Diagnostic request: patient={patient_id} doctor={doctor_id}")
#     try:
#         # ── DOCTOR ────────────────────────────────────────────────────────────
#         doctor = doctor_user_collection.find_one(
#             {"$or": [{"sys_user_id": doctor_id}, {"doctor_id": doctor_id}]},
#             {"_id": 0},
#         )
#         if not doctor:
#             raise HTTPException(status_code=404, detail="Doctor not found")
#         doctor_speciality = doctor.get("specialization")

#         # ── PATIENT ───────────────────────────────────────────────────────────
#         patient = patient_user_collection.find_one(
#             {"$or": [{"patient_id": patient_id}, {"sys_user_id": patient_id}]},
#             {"_id": 0},
#         )
#         if not patient:
#             raise HTTPException(status_code=404, detail="Patient not found")

#         age  = 0
#         dob  = patient.get("date_of_birth")
#         if dob:
#             try:
#                 dob_date = datetime.strptime(dob, "%Y-%m-%d").date()
#                 today    = datetime.utcnow().date()
#                 age      = today.year - dob_date.year - ((today.month, today.day) < (dob_date.month, dob_date.day))
#             except Exception:
#                 pass
#         gender = patient.get("gender") or "unknown"

#         # ── SUMMARY ───────────────────────────────────────────────────────────
#         summary = await summary_collection.find_one(
#             {"patient_id": patient_id},
#             sort=[("_id", -1)],
#         )

#         medical_history_summary = ""
#         imaging_summary         = ""
#         lab_summary             = ""
#         procedure_summary       = ""
#         last_medications: List[str] = []
#         recent_procedures: List[str] = []

#         if summary:
#             if "clinical_summary" in summary:
#                 cs = summary["clinical_summary"]
#                 if "2. DISEASE HISTORY" in cs:
#                     medical_history_summary = cs.split("2. DISEASE HISTORY")[1].split("3.")[0].strip()

#             if "graph_documents" in summary:
#                 img_fnd, lab_fnd, procs = [], [], []
#                 for doc in summary.get("graph_documents", []):
#                     for entity in doc.get("entities", []):
#                         etype = entity.get("entity_type")
#                         name  = entity.get("name")
#                         evid  = entity.get("evidence")
#                         if etype in ["Finding", "ImagingFinding"] and name:
#                             img_fnd.append(f"{name}: {evid}")
#                         elif etype == "LabResult" and name:
#                             lab_fnd.append(f"{name}: {evid}")
#                         elif etype == "Procedure" and name:
#                             procs.append(name)
#                 imaging_summary   = ". ".join(img_fnd[:10])
#                 lab_summary       = ". ".join(lab_fnd[:10])
#                 procedure_summary = ", ".join(procs[:5])
#                 recent_procedures = procs[:5]

#             if "structured_graph" in summary:
#                 sg = summary["structured_graph"]
#                 if "primary_driver" in sg and sg["primary_driver"].get("diagnosis"):
#                     pd = sg["primary_driver"]
#                     imaging_summary += f"\nPrimary Diagnosis: {pd['diagnosis']}"
#                     if pd.get("staging"):
#                         imaging_summary += f" (Stage: {pd['staging']})"

#             if "treatment_timeline" in summary:
#                 tt = summary["treatment_timeline"]
#                 if "data" in tt and "treatment_context" in tt["data"]:
#                     for inv in tt["data"]["treatment_context"].get("past_interventions", []):
#                         if inv.get("intervention_type") == "medication":
#                             med = inv.get("intervention")
#                             if med and med not in last_medications:
#                                 last_medications.append(med)

#         patient_context = build_patient_context(summary)
#         logger.info(f"Context length: {len(patient_context)}")
#         # 🔥 THEN DB CALL
#         appointment_doc = patient_appointments_collection.find_one(
#             {"sys_user_id": patient_id},
#             {"appointments": 1}
#         )

#         visit_type = "first_visit"

#         if appointment_doc and "appointments" in appointment_doc:
#             latest_appt = sorted(
#                 appointment_doc["appointments"],
#                 key=lambda x: x.get("date", ""),
#                 reverse=True
#             )[0]

#             visit_type = latest_appt.get("visit_type", "first_visit")

#         print("VISIT TYPE FROM DB:", visit_type)

#         try:
#             visit_type_enum = VisitType(visit_type.replace(" ", "_"))
#         except:
#             visit_type_enum = VisitType.FIRST_VISIT
#         diagnostic_obj = DiagnosticInput(
#             patient_context_summary  = patient_context,
#             age                      = age,
#             gender                   = gender,
#             medical_history_summary  = medical_history_summary,
#             procedure_summary        = procedure_summary,
#             latest_lab_summary       = lab_summary,
#             latest_imaging_summary   = imaging_summary,
#             doctor_note_or_dictation = request.doctor_note_or_dictation,
#             visit_type=visit_type_enum,
#             doctor_speciality        = doctor_speciality,
#             last_medications         = last_medications,
#             recent_procedures        = recent_procedures,
#             patient_id               = patient_id,
#             doctor_id                = doctor_id,
#         )

#         llm = ChatGroq(
#             model         = "llama-3.1-8b-instant",
#             groq_api_key  = os.getenv("GROQ_API_KEY"),
#             temperature   = 0.2,
#             max_tokens=4000,
            
#         )

#         report = await run_diagnostic_reasoning(
#             diagnostic_input = diagnostic_obj,
#             llm              = llm,
#             neo4j_uri        = "bolt://neo4j:7687",
#             neo4j_user       = "neo4j",
#             neo4j_password   = "password",
#         )

#         primary = report.primary_hypothesis

#         # ── Format investigations ─────────────────────────────────────────────
#         investigations_formatted = []
#         for inv in report.investigations:
#             item = {
#                 "test":                inv.test,
#                 "status":              inv.status,
#                 "required_for":        inv.required_for,
#                 "urgency":             inv.urgency,
#                 "date_performed":      inv.date_performed,
#                 "result_summary":      inv.result_summary,
#                 "interpretation":      inv.interpretation,
#                 "supports_hypothesis": inv.supports_hypothesis,
#             }
#             investigations_formatted.append(item)

#         # ── Format guideline pathways (4-section structure) ──────────────────
#         guideline_pathways_formatted = []
#         for gp in primary.guideline_pathways:

#             # Section 1 — Evidence Available
#             evidence_available_out = [
#                 {
#                     "parameter":           ea.parameter,
#                     "value":               ea.value,
#                     "source":              ea.source,
#                     "date":                ea.date,
#                     "guideline_relevance": ea.guideline_relevance,
#                     "hypothesis_link":     ea.hypothesis_link,
#                     "decision_enabled":    ea.decision_enabled,
#                 }
#                 for ea in gp.evidence_available
#             ]

#             # Section 2 — Missing / Pending
#             missing_pending_out = [
#                 {
#                     "investigation":            mp.investigation,
#                     "guideline_requirement":    mp.guideline_requirement,
#                     "status":                   mp.status,
#                     "importance_for_treatment": mp.importance_for_treatment,
#                     "hypothesis_step_blocked":  mp.hypothesis_step_blocked,
#                     "ordering_priority":        mp.ordering_priority,
#                     "recommended_action":       mp.recommended_action,
#                 }
#                 for mp in gp.missing_pending
#             ]

#             # Section 3 — Clinical Interpretation
#             ci_out = None
#             if gp.clinical_interpretation:
#                 ci = gp.clinical_interpretation
#                 ci_out = {
#                     "sufficient_for_treatment_initiation": ci.sufficient_for_treatment_initiation,
#                     "treatment_ready_for":                 ci.treatment_ready_for,
#                     "limited_by_missing":                  ci.limited_by_missing,
#                     "hypothesis_gate_status":              ci.hypothesis_gate_status,
#                     "hypothesis_gate_narrative":           ci.hypothesis_gate_narrative,
#                     "priority_next_steps":                 ci.priority_next_steps,
#                 }

#             # Section 4 — Alignment Summary
#             als_out = None
#             if gp.alignment_summary:
#                 als = gp.alignment_summary
#                 als_out = {
#                     "workup_completion_percent":  als.workup_completion_percent,
#                     "confirmed_criteria":         als.confirmed_criteria,
#                     "pending_criteria":           als.pending_criteria,
#                     "missing_criteria":           als.missing_criteria,
#                     "total_criteria":             als.total_criteria,
#                     "ready_for_surgery":          als.ready_for_surgery,
#                     "ready_for_systemic_therapy": als.ready_for_systemic_therapy,
#                     "ready_for_mdt_discussion":   als.ready_for_mdt_discussion,
#                     "readiness_rationale":        als.readiness_rationale,
#                     "cross_guideline_consensus":  als.cross_guideline_consensus,
#                     "cross_guideline_conflicts":  als.cross_guideline_conflicts,
#                 }

#             guideline_pathways_formatted.append({
#                 "guideline_name":    gp.guideline_name,
#                 "guideline_source":  gp.guideline_source,
#                 "applicable_for":    gp.applicable_for,
#                 "overall_alignment": gp.overall_alignment,
#                 "pathway_stage":     gp.pathway_stage,

#                 # 4-section structured output
#                 "section_1_evidence_available":      evidence_available_out,
#                 "section_2_missing_pending":         missing_pending_out,
#                 "section_3_clinical_interpretation": ci_out,
#                 "section_4_alignment_summary":       als_out,

#                 # Cross-guideline metadata
#                 "cross_guideline_overlaps": gp.cross_guideline_overlaps,

#                 # Flat counts for quick summary display
#                 "confirmed_count": gp.confirmed_count,
#                 "pending_count":   gp.pending_count,
#                 "missing_count":   gp.missing_count,
#             })

#         # ── Format hypothesis reasoning ───────────────────────────────────────
#         hypothesis_formatted = None
#         if report.hypothesis_reasoning:
#             hr = report.hypothesis_reasoning
#             hypothesis_formatted = {
#                 "primary_hypothesis":        hr.primary_hypothesis,
#                 "confidence_at_entry":       hr.confidence_at_entry,
#                 "confidence_current":        hr.confidence_current,
#                 "confidence_for_treatment":  hr.confidence_for_treatment,
#                 "diagnosis_gate":            hr.diagnosis_gate,
#                 "gate_blockers":             hr.gate_blockers,
#                 "gate_conditions":           hr.gate_conditions,
#                 "confirmatory_tests_pending": hr.confirmatory_tests_pending,
#                 "ruling_out":                hr.ruling_out,
#                 "specialist_summary":        hr.specialist_summary,
#                 "steps": [
#                     {
#                         "step_number":       s.step_number,
#                         "step_label":        s.step_label,
#                         "reasoning":         s.reasoning,
#                         "evidence_available": s.evidence_available,
#                         "evidence_missing":  s.evidence_missing,
#                         "outcome":           s.outcome,
#                         "next_required":     s.next_required,
#                     }
#                     for s in hr.steps
#                 ],
#             }

#         # ── Build differentials ────────────────────────────────────────────────
#         differentials = [
#             {
#                 "disease":      alt.disease,
#                 "type":         alt.disease_type,
#                 "stage":        alt.stage,
#                 "size":         alt.tumor_size,
#                 "probability":  round(alt.probability, 2),
#                 "guidelines":   alt.guideline_sources,
#             }
#             for alt in report.alternative_diagnoses
#         ]

#         return {
#             # ── Primary diagnosis ──────────────────────────────────────────
#             "primary_diagnosis": {
#                 "disease":             primary.disease,
#                 "type":                primary.disease_type,
#                 "stage":               primary.stage,
#                 "size":                primary.tumor_size,
#                 "probability":         round(primary.probability, 2),
#                 "severity":            primary.severity,
#                 "guidelines":          primary.guideline_sources,
#                 "supporting_evidence": primary.supporting_evidence,
#             },

#             # ── Differentials ──────────────────────────────────────────────
#             "differential_diagnoses": differentials,

#             # ── Specialist hypothesis reasoning (NEW) ──────────────────────
#             "hypothesis_reasoning": hypothesis_formatted,

#             # ── Investigation checklist with status + results (REWORKED) ───
#             "investigations": investigations_formatted,

#             # ── Missing investigations: diagnosis + treatment gates (REWORKED)
#             "missing_investigations": report.missing_investigations,

#             # ── Guideline pathway mapping (NEW) ────────────────────────────
#             "guideline_pathways": guideline_pathways_formatted,

#             # ── Flags ──────────────────────────────────────────────────────
#             "red_flag_alerts": report.red_flag_alerts,

#             # ── Explanation ────────────────────────────────────────────────
#             "reason_for_primary_diagnosis": report.diagnostic_explanation,
#         }

#     except HTTPException:
#         raise
#     except Exception as e:
#         logger.error(f"Diagnostic endpoint error: {e}")
#         logger.error(traceback.format_exc())
#         raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")
# Add these imports at the top if not already present


# Helper function to get latest diagnosis
async def get_latest_diagnosis(patient_id: str, doctor_id: str) -> Optional[Dict]:
    """Get the most recent diagnosis for this patient-doctor pair"""
    try:
        docs = await diagnosis_data_collection.find(
            {
                "patient_id": patient_id,
                "doctor_id": doctor_id,
                "type": "diagnosis"
            }
        ).sort("updated_at", -1).to_list(length=1)
        
        if docs:
            return docs[0]
        return None
    except Exception as e:
        logger.error(f"Failed to get latest diagnosis: {e}")
        return None

# Helper function to get latest treatment plan
async def get_latest_treatment_plan(patient_id: str, doctor_id: str) -> Optional[Dict]:
    """Get the most recent treatment plan for this patient-doctor pair"""
    try:
        docs = await documentation_treatment_plan_collection.find(
            {
                "patient_id": patient_id,
                "doctor_id": doctor_id
            }
        ).sort("created_at", -1).to_list(length=1)
        
        if docs:
            return docs[0]
        return None
    except Exception as e:
        logger.error(f"Failed to get latest treatment plan: {e}")
        return None
class DiagnosticRequest(BaseModel):
    doctor_note_or_dictation: str
# Modified diagnostic endpoint
@router.post("/diagnostic/{patient_id}")
async def diagnostic_endpoint(
    patient_id: str,
    request:    DiagnosticRequest,
    doctor_id:  str = Query(...),
):
    logger.info(f"Diagnostic request: patient={patient_id} doctor={doctor_id}")
    logger.info(f"Doctor dictation: {request.doctor_note_or_dictation}")

    try:
        # ── DOCTOR ────────────────────────────────────────────────────────────
        doctor = doctor_user_collection.find_one(
            {"$or": [{"sys_user_id": doctor_id}, {"doctor_id": doctor_id}]},
            {"_id": 0},
        )
        if not doctor:
            raise HTTPException(status_code=404, detail="Doctor not found")
        doctor_speciality = doctor.get("specialization")

        # ── PATIENT ───────────────────────────────────────────────────────────
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

        # ── VISIT TYPE ────────────────────────────────────────────────────────
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

        print("VISIT TYPE FROM DB:", visit_type)

        # 🔥 FIX: Correct mapping for visit type
        visit_type_clean = visit_type.replace(" ", "_").lower()
        print(f"VISIT TYPE CLEAN: {visit_type_clean}")

        if visit_type_clean == "follow_up" or visit_type_clean == "followup" or visit_type_clean == "followup_visit":
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
            print(f"Unknown visit type: {visit_type_clean}, defaulting to FIRST_VISIT")
            visit_type_enum = VisitType.FIRST_VISIT

        print(f"VISIT TYPE ENUM: {visit_type_enum}")
        print(f"VISIT TYPE ENUM VALUE: {visit_type_enum.value}")

        # ── GET PREVIOUS DIAGNOSIS AND TREATMENT PLAN FOR FOLLOW-UP ───────────
        previous_diagnosis = None
        previous_treatment_plan = None
        previous_diagnosis_text = ""
        previous_treatment_text = ""

        if visit_type_enum == VisitType.FOLLOWUP_VISIT:
            previous_diagnosis = await get_latest_diagnosis(patient_id, doctor_id)
            previous_treatment_plan = await get_latest_treatment_plan(patient_id, doctor_id)
            
            if previous_diagnosis:
                previous_diagnosis_text = previous_diagnosis.get("diagnosis", "Unknown")
                logger.info(f"Previous diagnosis found: {previous_diagnosis_text}")
            
            if previous_treatment_plan:
                previous_treatment_text = previous_treatment_plan.get("finaloutput", "")
                if isinstance(previous_treatment_text, dict):
                    previous_treatment_text = json.dumps(previous_treatment_text)
                logger.info(f"Previous treatment plan found (length: {len(previous_treatment_text)})")

        # ── SUMMARY ───────────────────────────────────────────────────────────
        summary = await summary_collection.find_one(
            {"patient_id": patient_id},
            sort=[("_id", -1)],
        )

        # Stop if both patient summary and dictation are missing
        dictation = (request.doctor_note_or_dictation or "").strip()

        if summary is None and not dictation:
            raise HTTPException(
                status_code=400,
                detail="Patient summary and dictation note are both missing."
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

            # -----------------------------
            # Main longitudinal summary
            # -----------------------------
            summary_data = summary.get("summary", {})

            paragraphs = summary_data.get("paragraphs", [])

            patient_context = "\n\n".join(paragraphs)

            medical_history_summary = patient_context

            # -----------------------------
            # Timeline
            # -----------------------------
            timeline = summary.get("timeline", {}).get("timeline", [])

            timeline_lines = []

            for item in timeline:
                date = item.get("date", "")
                narrative = item.get("narrative", "")

                timeline_lines.append(
                    f"{date}: {narrative}"
                )

            timeline_summary = "\n".join(timeline_lines)

            patient_context += f"\n\n===== CLINICAL TIMELINE =====\n{timeline_summary}"
            logger.info(f"THOMAS,THOMAS:{patient_context}")
        
        # ── ENHANCE PATIENT CONTEXT WITH PREVIOUS DIAGNOSIS/TREATMENT ─────────
# ── ENHANCE PATIENT CONTEXT WITH PREVIOUS DIAGNOSIS/TREATMENT ─────────
        # ── ENHANCE PATIENT CONTEXT WITH PREVIOUS DIAGNOSIS/TREATMENT ─────────
        enhanced_context = patient_context

        if visit_type_enum == VisitType.FOLLOWUP_VISIT:
            # 🔥 CRITICAL FIX: Clear instruction to consider NEW cancer
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
{request.doctor_note_or_dictation}

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
            logger.info("Enhanced context with NEW PRIMARY CANCER instruction")

        logger.info(f"Context length: {len(enhanced_context)}")

        # ── CREATE DIAGNOSTIC INPUT ──────────────────────────────────────────
        diagnostic_obj = DiagnosticInput(
            patient_context_summary=enhanced_context,
            age=age,
            gender=gender,
            medical_history_summary=medical_history_summary,
            procedure_summary=procedure_summary,
            latest_lab_summary=lab_summary,
            latest_imaging_summary=imaging_summary,
            doctor_note_or_dictation=request.doctor_note_or_dictation,
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
            max_tokens=4000,
        )

        report = await run_diagnostic_reasoning(
            diagnostic_input=diagnostic_obj,
            llm=llm,
            neo4j_uri=os.getenv("NEO4J_URI"),
            neo4j_user=os.getenv("NEO4J_USER"),
            neo4j_password=os.getenv("NEO4J_PASSWORD"),
        )

        primary = report.primary_hypothesis

        # ── Format investigations ─────────────────────────────────────────────
        investigations_formatted = []
        for inv in report.investigations:
            item = {
                "test": inv.test,
                "status": inv.status,
                "required_for": inv.required_for,
                "urgency": inv.urgency,
                "date_performed": inv.date_performed,
                "result_summary": inv.result_summary,
                "interpretation": inv.interpretation,
                "supports_hypothesis": inv.supports_hypothesis,
            }
            investigations_formatted.append(item)

        # ── Format guideline pathways (4-section structure) ──────────────────
        guideline_pathways_formatted = []
        for gp in primary.guideline_pathways:

            evidence_available_out = [
                {
                    "parameter": ea.parameter,
                    "value": ea.value,
                    "source": ea.source,
                    "date": ea.date,
                    "guideline_relevance": ea.guideline_relevance,
                    "hypothesis_link": ea.hypothesis_link,
                    "decision_enabled": ea.decision_enabled,
                }
                for ea in gp.evidence_available
            ]

            missing_pending_out = [
                {
                    "investigation": mp.investigation,
                    "guideline_requirement": mp.guideline_requirement,
                    "status": mp.status,
                    "importance_for_treatment": mp.importance_for_treatment,
                    "hypothesis_step_blocked": mp.hypothesis_step_blocked,
                    "ordering_priority": mp.ordering_priority,
                    "recommended_action": mp.recommended_action,
                }
                for mp in gp.missing_pending
            ]

            ci_out = None
            if gp.clinical_interpretation:
                ci = gp.clinical_interpretation
                ci_out = {
                    "sufficient_for_treatment_initiation": ci.sufficient_for_treatment_initiation,
                    "treatment_ready_for": ci.treatment_ready_for,
                    "limited_by_missing": ci.limited_by_missing,
                    "hypothesis_gate_status": ci.hypothesis_gate_status,
                    "hypothesis_gate_narrative": ci.hypothesis_gate_narrative,
                    "priority_next_steps": ci.priority_next_steps,
                }

            als_out = None
            if gp.alignment_summary:
                als = gp.alignment_summary
                als_out = {
                    "workup_completion_percent": als.workup_completion_percent,
                    "confirmed_criteria": als.confirmed_criteria,
                    "pending_criteria": als.pending_criteria,
                    "missing_criteria": als.missing_criteria,
                    "total_criteria": als.total_criteria,
                    "ready_for_surgery": als.ready_for_surgery,
                    "ready_for_systemic_therapy": als.ready_for_systemic_therapy,
                    "ready_for_mdt_discussion": als.ready_for_mdt_discussion,
                    "readiness_rationale": als.readiness_rationale,
                    "cross_guideline_consensus": als.cross_guideline_consensus,
                    "cross_guideline_conflicts": als.cross_guideline_conflicts,
                }

            guideline_pathways_formatted.append({
                "guideline_name": gp.guideline_name,
                "guideline_source": gp.guideline_source,
                "applicable_for": gp.applicable_for,
                "overall_alignment": gp.overall_alignment,
                "pathway_stage": gp.pathway_stage,
                "section_1_evidence_available": evidence_available_out,
                "section_2_missing_pending": missing_pending_out,
                "section_3_clinical_interpretation": ci_out,
                "section_4_alignment_summary": als_out,
                "cross_guideline_overlaps": gp.cross_guideline_overlaps,
                "confirmed_count": gp.confirmed_count,
                "pending_count": gp.pending_count,
                "missing_count": gp.missing_count,
            })

        # ── Format hypothesis reasoning ───────────────────────────────────────
        hypothesis_formatted = None
        if report.hypothesis_reasoning:
            hr = report.hypothesis_reasoning
            hypothesis_formatted = {
                "primary_hypothesis": hr.primary_hypothesis,
                "confidence_at_entry": hr.confidence_at_entry,
                "confidence_current": hr.confidence_current,
                "confidence_for_treatment": hr.confidence_for_treatment,
                "diagnosis_gate": hr.diagnosis_gate,
                "gate_blockers": hr.gate_blockers,
                "gate_conditions": hr.gate_conditions,
                "confirmatory_tests_pending": hr.confirmatory_tests_pending,
                "ruling_out": hr.ruling_out,
                "specialist_summary": hr.specialist_summary,
                "steps": [
                    {
                        "step_number": s.step_number,
                        "step_label": s.step_label,
                        "reasoning": s.reasoning,
                        "evidence_available": s.evidence_available,
                        "evidence_missing": s.evidence_missing,
                        "outcome": s.outcome,
                        "next_required": s.next_required,
                    }
                    for s in hr.steps
                ],
            }

        # ── Build differentials ────────────────────────────────────────────────
        differentials = [
            {
                "disease": alt.disease,
                "type": alt.disease_type,
                "stage": alt.stage,
                "size": alt.tumor_size,
                "probability": round(alt.probability, 2),
                "guidelines": alt.guideline_sources,
            }
            for alt in report.alternative_diagnoses
        ]

        # ── Build response with follow-up context ─────────────────────────────
        response_data = {
            "primary_diagnosis": {
                "disease": primary.disease,
                "type": primary.disease_type,
                "stage": primary.stage,
                "size": primary.tumor_size,
                "probability": round(primary.probability, 2),
                "severity": primary.severity,
                "guidelines": primary.guideline_sources,
                "supporting_evidence": primary.supporting_evidence,
            },
            "differential_diagnoses": differentials,
            "hypothesis_reasoning": hypothesis_formatted,
            "investigations": investigations_formatted,
            "missing_investigations": report.missing_investigations,
            "guideline_pathways": guideline_pathways_formatted,
            "red_flag_alerts": report.red_flag_alerts,
            "reason_for_primary_diagnosis": report.diagnostic_explanation,
        }

        # Add follow-up specific fields if this is a follow-up visit
        # Add follow-up specific fields if this is a follow-up visit
        # Add follow-up specific fields if this is a follow-up visit
        if visit_type_enum == VisitType.FOLLOWUP_VISIT:
            # Safely get followup_analysis from report (it might be None or missing)
            followup_analysis = getattr(report, 'followup_analysis', None)
            
            response_data["followup_context"] = {
                "previous_diagnosis": previous_diagnosis_text,
                "previous_treatment_plan": previous_treatment_text[:500] if previous_treatment_text else None,
                "visit_type": "follow_up",
                "relationship_to_prior_diagnosis": followup_analysis.get("diagnosis_action") if followup_analysis else None,
                "status_change": followup_analysis.get("status") if followup_analysis else None,
                "followup_reasoning": followup_analysis.get("reasoning") if followup_analysis else None,
            }

        return response_data

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Diagnostic endpoint error: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")