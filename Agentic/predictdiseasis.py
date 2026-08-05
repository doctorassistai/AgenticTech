"""
PDGI — Predictive Disease Graph Intelligence
=============================================
v4.0.0  |  Streamlined Patient-Education Pipeline

WHAT'S NEW IN v4.0:
  ┌─────────────────────────────────────────────────────────────────────┐
  │  REMOVED agents not required by the patient-education report spec: │
  │    ✗  B0  GraphAnchorAgent                                         │
  │    ✗  B1  TrajectoryAgent                                          │
  │    ✗  B2  OrganBurdenAgent  (kept for B14 input — simplified)      │
  │    ✗  B3  ComorbidityWebAgent                                      │
  │    ✗  B4  RiskModifierAgent                                        │
  │    ✗  B5  CardiometabolicRiskAgent                                 │
  │    ✗  B6  OncologicRiskAgent                                       │
  │    ✗  B7  RenalHepaticRiskAgent                                    │
  │    ✗  B8  MultiSpecialtyRiskAgent                                  │
  │    ✗  B9  RiskSynthesisAgent                                       │
  │    ✗  B11 PredictionAuditAgent                                     │
  │                                                                     │
  │  KEPT agents (required by PDF spec + explicit user request):       │
  │    ✓  Phase 0A  EntityTypedGraphFetcher                            │
  │    ✓  Phase 0B  LLMAbnormalityAssessor                             │
  │    ✓  Phase 0C  GraphPreprocessor                                  │
  │    ✓  B_QRISK3  QRISK3Agent (explicit keep)                        │
  │    ✓  B10       PredictiveNarrativeAgent  → Section 02             │
  │    ✓  B12       PatientUnderstandingAgent → Section 01 + 03        │
  │    ✓  B_CONSULT ConsultantMapAgent        → Section 04             │
  │    ✓  B13       DietaryGuidanceAgent      → Section 05             │
  │    ✓  B14       OrganEffectAnalysisAgent  (explicit keep)          │
  │                                                                     │
  │  NEW PIPELINE (v4.0):                                               │
  │    Phase 0A → 0B → 0C                                              │
  │    → B_QRISK3 (standalone, uses demographics + compressed ctx)     │
  │    → B10  (Section 02: What to Watch For)                          │
  │    → B12_CONSULT sequential (Section 01+03 → Section 04)           │
  │    → B13 + B14 parallel (Section 05 + Organ Analysis)              │
  │                                                                     │
  │  All prompts rewritten to use compressed_context directly          │
  │  (no upstream B0–B9 JSON dependencies).                            │
  └─────────────────────────────────────────────────────────────────────┘

Architecture v4.0:
  Phase 0A: EntityTypedGraphFetcher  — 9 typed Cypher queries in parallel
  Phase 0B: LLMAbnormalityAssessor   — LLM annotates each entity type (9 calls parallel)
  Phase 0C: GraphPreprocessor        — abnormal markdown compression
  Parallel  → B_QRISK3 (QRISK3 CVD risk score)
  Narrative → B10  (Section 02 — What to Watch For)
  Patient   → B12  (Section 01 + 03) → B_CONSULT (Section 04)  [sequential]
  Extended  → B13 + B14 [parallel]
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, TypedDict

from fastapi import FastAPI, HTTPException, APIRouter
from loguru import logger
from neo4j import AsyncGraphDatabase
from pydantic import BaseModel

from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import StateGraph, END

from motor.motor_asyncio import AsyncIOMotorClient


# ============================================================
# ENVIRONMENT CONFIGURATION
# ============================================================

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
NEO4J_URI    = os.getenv("NEO4J_URI",      "bolt://neo4j:7687")
NEO4J_USER   = os.getenv("NEO4J_USER",     "neo4j")
NEO4J_PASS   = os.getenv("NEO4J_PASSWORD", "password")
MONGO_URI    = os.getenv("MONGO_URI")
MONGO_DB     = "doctorassistai"

mongo_client     = AsyncIOMotorClient(MONGO_URI)
mongo_db         = mongo_client[MONGO_DB]
prediction_store = mongo_db["predictive_summaries"]

neo4j_driver = AsyncGraphDatabase.driver(
    NEO4J_URI,
    auth=(NEO4J_USER, NEO4J_PASS),
    max_connection_lifetime=3600,
    max_connection_pool_size=50,
)

# Synthesis-quality LLM for patient-facing sections
llm_synthesis = ChatGroq(
    model="llama-3.3-70b-versatile",
    temperature=0.1,
    max_tokens=5000,
    groq_api_key=GROQ_API_KEY,
)

# Fast LLM for abnormality assessment
llm_abnormality = ChatGroq(
    model="llama-3.1-8b-instant",
    temperature=0.0,
    max_tokens=4000,
    groq_api_key=GROQ_API_KEY,
)

router = APIRouter(prefix="", tags=["Predictive Disease Intelligence"])


# ============================================================
# REQUEST / RESPONSE MODELS
# ============================================================

class PredictiveRequest(BaseModel):
    patient_id:            str
    doctor_id:             str
    include_intermediates: bool = False
    primary_specialty:     Optional[str] = None


# ============================================================
# COMPRESSED CONTEXT DATA STRUCTURES
# ============================================================

class EntityRecord(TypedDict):
    entity_id:       str
    entity_type:     str
    name:            str
    value:           Optional[str]
    unit:            Optional[str]
    date:            Optional[str]
    document:        str
    evidence:        Optional[str]
    is_abnormal:     bool
    abnormal_reason: Optional[str]


class CompressedContext(TypedDict):
    confirmed_diagnoses:  List[Dict]
    abnormal_signals:     List[Dict]

    md_diagnoses:     str
    md_labs:          str
    md_vitals:        str
    md_medications:   str
    md_findings:      str
    md_procedures:    str
    md_measurements:  str
    md_anatomy:       str
    md_symptoms:      str
    md_timeline:      str

    entity_index:     Dict[str, EntityRecord]

    total_documents:       int
    total_entities:        int
    abnormal_entity_count: int
    date_range:            Dict[str, str]
    token_estimate:        int


# ============================================================
# PREDICTIVE STATE  (v4.0: only keys required by kept agents)
# ============================================================

class PredictiveState(TypedDict):
    patient_id:        str
    doctor_id:         str
    primary_specialty: Optional[str]
    graph_documents:   List[Dict]
    dob:               Optional[str]
    sex:               Optional[str]

    compressed_context: Optional[CompressedContext]

    qrisk3_assessment:    Optional[Dict]   # B_QRISK3
    predictive_report:    Optional[Dict]   # B10 — Section 02
    patient_understanding: Optional[Dict]  # B12 — Section 01 + 03
    consultant_map:        Optional[Dict]  # B_CONSULT — Section 04
    dietary_guidance:      Optional[Dict]  # B13 — Section 05
    organ_effect_analysis: Optional[Dict]  # B14 — Organ analysis

    errors:        List[str]
    agent_timings: Dict[str, float]


# ============================================================
# PHASE 0A: ENTITY-TYPED GRAPH FETCHER  (unchanged)
# ============================================================

class EntityTypedGraphFetcher:
    ENTITY_TYPE_SPECS = [
        (["HAS_DIAGNOSIS", "DIAGNOSED_WITH", "CONFIRMED_DIAGNOSIS"],   "Diagnosis",   "diagnoses"),
        (["HAS_LAB_RESULT", "HAS_LAB", "LAB_RESULT"],                  "LabResult",   "lab_results"),
        (["HAS_VITAL_SIGN", "HAS_VITAL", "VITAL_SIGN"],                "VitalSign",   "vital_signs"),
        (["HAS_MEDICATION", "PRESCRIBED", "TAKING", "ON_MEDICATION"],  "Medication",  "medications"),
        (["HAS_FINDING", "FINDING", "SHOWS_FINDING"],                  "Finding",     "findings"),
        (["HAS_PROCEDURE", "PROCEDURE", "UNDERWENT"],                  "Procedure",   "procedures"),
        (["HAS_MEASUREMENT", "MEASUREMENT"],                           "Measurement", "measurements"),
        (["HAS_ANATOMY", "INVOLVES", "ANATOMY"],                       "Anatomy",     "anatomy"),
        (["HAS_SYMPTOM", "SYMPTOM", "PRESENTS_WITH"],                  "Symptom",     "symptoms"),
    ]

    _FALLBACK_QUERY = """
    MATCH (p:Patient {patient_id: $patient_id})-[r]->(n)
    OPTIONAL MATCH (n)-[:SUPPORTED_BY_EVIDENCE]->(e:Evidence)
    RETURN
        type(r) AS relation,
        CASE
            WHEN n:Diagnosis    THEN 'Diagnosis'
            WHEN n:LabResult    THEN 'LabResult'
            WHEN n:VitalSign    THEN 'VitalSign'
            WHEN n:Medication   THEN 'Medication'
            WHEN n:Finding      THEN 'Finding'
            WHEN n:Procedure    THEN 'Procedure'
            WHEN n:Measurement  THEN 'Measurement'
            WHEN n:Anatomy      THEN 'Anatomy'
            WHEN n:Symptom      THEN 'Symptom'
            ELSE head(labels(n))
        END AS entity_type,
        coalesce(n.name, n.details, n.description, n.drug_name,
                 n.test_name, n.vital_type, n.value) AS name,
        coalesce(n.value, n.result)  AS value,
        coalesce(n.unit, n.units)    AS unit,
        coalesce(e.document_date, n.date) AS raw_date,
        coalesce(e.document_name, 'unknown') AS document,
        e.evidence_text AS evidence,
        n.reference_range AS reference_range,
        n.is_abnormal AS is_abnormal,
        n.abnormal_flag AS abnormal_flag,
        n.severity AS severity,
        n.status AS status,
        n.grade AS grade,
        n.stage AS stage
    ORDER BY raw_date ASC
    """

    def _build_typed_query(self, rel_types: List[str], node_label: str) -> str:
        rel_pattern = "|".join(rel_types)
        return f"""
        MATCH (p:Patient {{patient_id: $patient_id}})-[r:{rel_pattern}]->(n:{node_label})
        OPTIONAL MATCH (n)-[:SUPPORTED_BY_EVIDENCE]->(e:Evidence)
        RETURN
            type(r) AS relation,
            '{node_label}' AS entity_type,

            coalesce(
                n.name,
                n.details,
                n.description,
                n.drug_name,
                n.test_name,
                n.vital_type,
                n.value,
                n.finding_text,
                toString(id(n))
            ) AS name,

            coalesce(n.value, n.result, n.amount, n.dose) AS value,
            coalesce(n.unit, n.units) AS unit,

            coalesce(e.document_date, n.date) AS raw_date,

            coalesce(
                e.document_name,
                n.source_document,
                'unknown'
            ) AS document,

            e.evidence_text AS evidence,

            n.reference_range AS reference_range,
            n.is_abnormal AS is_abnormal,
            n.abnormal_flag AS abnormal_flag,
            n.severity AS severity,
            n.status AS status,
            n.laterality AS laterality,
            n.histology AS histology,
            n.grade AS grade,
            n.stage AS stage,
            n.drug_class AS drug_class,
            n.frequency AS frequency,
            n.specimen_type AS specimen_type,

            properties(n) AS entity,
            CASE
                WHEN e IS NULL THEN {{}}
                ELSE properties(e)
            END AS evidence_node

        ORDER BY raw_date ASC
        """

    async def _run_typed_query(self, session, patient_id, rel_types, node_label, display_name):
        query  = self._build_typed_query(rel_types, node_label)
        result = await session.run(query, patient_id=patient_id)
        rows: List[Dict] = []
        async for record in result:
            rows.append(dict(record))
        return {display_name: rows}

    async def fetch_all(self, patient_id: str) -> Dict[str, List[Dict]]:
        try:
            async with neo4j_driver.session() as session:
                tasks = [
                    self._run_typed_query(session, patient_id, rel_types, node_label, display_name)
                    for rel_types, node_label, display_name in self.ENTITY_TYPE_SPECS
                ]
                results = await asyncio.gather(*tasks, return_exceptions=True)

            typed_data: Dict[str, List[Dict]] = {}
            for i, result in enumerate(results):
                _, _, display_name = self.ENTITY_TYPE_SPECS[i]
                if isinstance(result, Exception):
                    logger.warning(f"Typed query '{display_name}' failed: {result}")
                    typed_data[display_name] = []
                else:
                    typed_data[display_name] = result.get(display_name, [])

            total = sum(len(v) for v in typed_data.values())
            if total == 0:
                logger.warning("All typed queries returned empty — running fallback query")
                typed_data = await self._run_fallback(patient_id)

            logger.info(f"EntityTypedGraphFetcher: patient={patient_id} | "
                        + " | ".join(f"{k}={len(v)}" for k, v in typed_data.items()))
            return typed_data
        except Exception as e:
            logger.error(f"EntityTypedGraphFetcher failed: {e}")
            raise

    async def _run_fallback(self, patient_id: str) -> Dict[str, List[Dict]]:
        async with neo4j_driver.session() as session:
            result = await session.run(self._FALLBACK_QUERY, patient_id=patient_id)
            grouped: Dict[str, List[Dict]] = {d: [] for _, _, d in self.ENTITY_TYPE_SPECS}
            type_to_key = {
                "Diagnosis": "diagnoses", "LabResult": "lab_results",
                "VitalSign": "vital_signs", "Medication": "medications",
                "Finding": "findings", "Procedure": "procedures",
                "Measurement": "measurements", "Anatomy": "anatomy",
                "Symptom": "symptoms",
            }
            async for record in result:
                row = dict(record)
                key = type_to_key.get(row.get("entity_type", ""), "findings")
                grouped[key].append(row)
            return grouped


# ============================================================
# PHASE 0B: LLM ABNORMALITY ASSESSOR  (unchanged)
# ============================================================

_ENTITY_TYPE_CLINICAL_CONTEXT: Dict[str, str] = {
    "diagnoses": (
        "These are documented DIAGNOSES. Every diagnosis is clinically significant "
        "by definition. Mark ALL as abnormal=true. The abnormal_reason should "
        "briefly state what disease/condition it represents."
    ),
    "lab_results": (
        "These are laboratory test results. Mark a result as abnormal if: "
        "(1) the value is outside the stated reference range, "
        "(2) Neo4j already flagged it (is_abnormal=true or abnormal_flag present), "
        "(3) the name or evidence contains clinical flags such as elevated, raised, "
        "high, low, decreased, positive, reactive, detected, critical, panic value, "
        "outside range, or similar. "
        "Mark as normal only if the value is explicitly within reference range "
        "and there are no flags."
    ),
    "vital_signs": (
        "These are vital sign measurements. Mark abnormal if: "
        "(1) blood pressure >= 140/90 mmHg or <= 90/60 mmHg, "
        "(2) heart rate > 100 or < 60 bpm, "
        "(3) SpO2 < 95%, "
        "(4) temperature > 37.5 C or < 36 C, "
        "(5) respiratory rate > 20 or < 12, "
        "(6) the record itself says abnormal/high/low. "
        "Mark as normal if the value is in the standard range for an adult."
    ),
    "medications": (
        "These are medication records. Medications are not inherently abnormal, "
        "but mark abnormal=true if the medication strongly implies an active disease "
        "or serious condition (e.g. chemotherapy agents, anticoagulants, insulin, "
        "immunosuppressants, antipsychotics, anti-epileptics, dialysis-related drugs). "
        "Mark abnormal=false for routine/OTC medications (vitamins, antacids, etc.)."
    ),
    "findings": (
        "These are clinical or imaging findings. Mark abnormal if the finding "
        "describes any structural, morphological, or pathological change: "
        "masses, nodules, calculi, thickening, lesions, effusions, stenosis, "
        "steatosis, fibrosis, infiltration, malignancy, dysplasia, necrosis, "
        "inflammation, oedema, atrophy, hypertrophy, or any deviation from "
        "expected normal anatomy/appearance. "
        "Mark as normal only if the finding explicitly states: normal, unremarkable, "
        "no abnormality detected, within normal limits, clear, intact."
    ),
    "procedures": (
        "These are procedures. Procedures themselves are not abnormal, but mark "
        "abnormal=true if the procedure name or evidence implies a pathological "
        "indication (e.g. biopsy with malignant result, TURBT, oncologic resection, "
        "dialysis, organ transplant). Mark abnormal=false for routine screening "
        "or preventive procedures."
    ),
    "measurements": (
        "These are body measurements. Mark abnormal if: "
        "(1) a tumour/mass size is recorded, "
        "(2) BMI > 30 or < 18.5, "
        "(3) organ size is outside normal range, "
        "(4) the measurement is described as abnormal or enlarged."
    ),
    "anatomy": (
        "These are anatomical entities. Mark abnormal if the anatomy entity "
        "describes a structural abnormality, absence of an expected structure, "
        "or involvement of anatomy in a pathological process."
    ),
    "symptoms": (
        "These are patient-reported or clinician-documented symptoms. "
        "ALL symptoms are clinically significant by definition. Mark ALL as abnormal=true."
    ),
}


class LLMAbnormalityAssessor:
    BATCH_SIZE = 40

    def __init__(self, llm_client):
        self._llm = llm_client

    @staticmethod
    def _neo4j_flag_fallback(row: Dict) -> tuple[bool, Optional[str]]:
        if row.get("is_abnormal") is True:
            return True, "neo4j_flag:is_abnormal"
        flag = row.get("abnormal_flag")
        if flag and str(flag).lower() not in ("false", "0", "no", "normal", "none"):
            return True, f"neo4j_flag:abnormal_flag={flag}"
        if row.get("grade"):
            return True, f"neo4j_flag:grade={row['grade']}"
        if row.get("stage"):
            return True, f"neo4j_flag:stage={row['stage']}"
        sev = str(row.get("severity") or "").lower()
        if sev and sev not in ("none", "normal", "mild", ""):
            return True, f"neo4j_flag:severity={sev}"
        return False, None

    @staticmethod
    def _row_to_description(row: Dict, index: int) -> Dict:
        return {
            "index":           index,
            "name":            row.get("name", "unknown"),
            "value":           row.get("value"),
            "unit":            row.get("unit"),
            "reference_range": row.get("reference_range"),
            "evidence":        (row.get("evidence") or "")[:300],
            "status":          row.get("status"),
            "severity":        row.get("severity"),
            "grade":           row.get("grade"),
            "stage":           row.get("stage"),
            "neo4j_is_abnormal": row.get("is_abnormal"),
            "neo4j_abnormal_flag": row.get("abnormal_flag"),
            "document":        row.get("document", "unknown"),
            "date":            row.get("raw_date") or row.get("date"),
        }

    async def _assess_batch(self, entity_type, batch, start_index):
        clinical_ctx = _ENTITY_TYPE_CLINICAL_CONTEXT.get(entity_type, "")
        descriptions = [self._row_to_description(row, start_index + i) for i, row in enumerate(batch)]

        system = (
            "You are a clinical data analyst performing abnormality assessment "
            "on medical entity records extracted from patient documents. "
            "Return ONLY a JSON object — no markdown, no explanation. "
            "Do not include ```json fences."
        )
        prompt = f"""
ENTITY TYPE: {entity_type.upper()}

CLINICAL CONTEXT FOR ABNORMALITY ASSESSMENT:
{clinical_ctx}

ENTITIES TO ASSESS ({len(descriptions)} items):
{json.dumps(descriptions, indent=2)}

Return ONLY this exact JSON structure:
{{
  "assessments": [
    {{
      "index": <integer matching the index field>,
      "is_abnormal": <true or false>,
      "reason": "<brief clinical reason, or null if normal>"
    }}
  ]
}}
"""
        try:
            response = await self._llm.ainvoke([SystemMessage(content=system), HumanMessage(content=prompt)])
            raw = response.content.strip()
            raw = re.sub(r"```json", "", raw)
            raw = re.sub(r"```", "", raw)
            match = re.search(r"\{.*\}", raw, re.DOTALL)
            if not match:
                raise ValueError("No JSON object found")
            parsed = json.loads(match.group(0))
            results: Dict[int, tuple[bool, Optional[str]]] = {}
            for item in parsed.get("assessments", []):
                idx = item.get("index")
                is_abn = bool(item.get("is_abnormal", False))
                reason = item.get("reason") or None
                if idx is not None:
                    results[idx] = (is_abn, reason)
            return results
        except Exception as e:
            logger.warning(f"LLMAbnormalityAssessor batch failed for '{entity_type}' (start={start_index}): {e}")
            return {start_index + i: self._neo4j_flag_fallback(row) for i, row in enumerate(batch)}

    async def assess_entity_type(self, entity_type: str, rows: List[Dict]) -> None:
        if not rows:
            return
        if entity_type in ("diagnoses", "symptoms"):
            for row in rows:
                row["_llm_is_abnormal"] = True
                row["_llm_abnormal_reason"] = (
                    "diagnoses are clinically significant by definition"
                    if entity_type == "diagnoses"
                    else "symptoms represent deviations from normal health"
                )
            return

        all_results: Dict[int, tuple[bool, Optional[str]]] = {}
        tasks = []
        for batch_start in range(0, len(rows), self.BATCH_SIZE):
            batch = rows[batch_start: batch_start + self.BATCH_SIZE]
            tasks.append(self._assess_batch(entity_type, batch, batch_start))

        batch_results = await asyncio.gather(*tasks, return_exceptions=True)
        for i, result in enumerate(batch_results):
            if isinstance(result, Exception):
                batch_start = i * self.BATCH_SIZE
                batch = rows[batch_start: batch_start + self.BATCH_SIZE]
                for j, row in enumerate(batch):
                    is_abn, reason = self._neo4j_flag_fallback(row)
                    all_results[batch_start + j] = (is_abn, reason)
            else:
                all_results.update(result)

        for idx, row in enumerate(rows):
            is_abn, reason = all_results.get(idx, self._neo4j_flag_fallback(row))
            row["_llm_is_abnormal"] = is_abn
            row["_llm_abnormal_reason"] = reason

        abnormal_count = sum(1 for r in rows if r.get("_llm_is_abnormal"))
        logger.info(f"LLMAbnormalityAssessor: '{entity_type}' — {len(rows)} entities | {abnormal_count} abnormal")

    async def assess_all(self, typed_data: Dict[str, List[Dict]]) -> None:
        tasks = [self.assess_entity_type(etype, rows) for etype, rows in typed_data.items()]
        await asyncio.gather(*tasks)
        logger.info("LLMAbnormalityAssessor: all entity types assessed")


# ============================================================
# PHASE 0C: GRAPH PREPROCESSOR  (unchanged)
# ============================================================

class GraphPreprocessor:
    @staticmethod
    def _is_abnormal(row: Dict) -> bool:
        llm_flag = row.get("_llm_is_abnormal")
        if llm_flag is not None:
            return bool(llm_flag)
        if row.get("is_abnormal") is True:
            return True
        flag = row.get("abnormal_flag")
        if flag and str(flag).lower() not in ("false", "0", "no", "normal", "none"):
            return True
        if row.get("grade"):
            return True
        if row.get("stage"):
            return True
        sev = str(row.get("severity") or "").lower()
        if sev and sev not in ("none", "normal", "mild", ""):
            return True
        return False

    @staticmethod
    def _abnormal_reason(row: Dict) -> Optional[str]:
        return row.get("_llm_abnormal_reason")

    @staticmethod
    def _fmt_date(raw: Optional[str]) -> str:
        if not raw or raw in ("None", "null", "none"):
            return "date unknown"
        return str(raw).strip()

    def _fmt_row(self, row: Dict, include_evidence: bool = True) -> str:
        name  = row.get("name", "unknown")
        value = row.get("value")
        unit  = row.get("unit")
        date  = self._fmt_date(row.get("raw_date") or row.get("date"))
        doc   = row.get("document", "?")
        evid  = row.get("evidence", "") or ""

        parts = [f"**{name}**"]
        if value:
            parts.append(f"= {value}")
        if unit:
            parts.append(unit)
        parts.append(f"| {date}")
        parts.append(f"| doc: `{doc}`")

        extra = []
        if row.get("grade"):
            extra.append(f"grade={row['grade']}")
        if row.get("stage"):
            extra.append(f"stage={row['stage']}")
        if row.get("severity"):
            extra.append(f"severity={row['severity']}")
        if row.get("histology"):
            extra.append(f"histology: {row['histology']}")
        if row.get("laterality"):
            extra.append(f"laterality: {row['laterality']}")
        if row.get("reference_range"):
            extra.append(f"ref: {row['reference_range']}")
        reason = self._abnormal_reason(row)
        if reason:
            extra.append(f"⚠ {reason}")
        if extra:
            parts.append(f"| {'; '.join(extra)}")

        line = "- " + " ".join(parts)
        if include_evidence and evid and len(evid) < 300:
            line += f"\n  > *{evid.strip()}*"
        return line

    def build_md_diagnoses(self, rows):
        if not rows:
            return "## DIAGNOSES\n_No confirmed diagnoses documented in graph._\n"
        lines = ["## CONFIRMED DIAGNOSES\n"]
        lines.append(f"_Total: {len(rows)} confirmed diagnosis entity/entities_\n")
        for row in rows:
            lines.append(self._fmt_row(row, include_evidence=True))
        return "\n".join(lines) + "\n"

    def build_md_labs(self, rows):
        if not rows:
            return "## LAB RESULTS\n_No lab results documented._\n"
        abnormal = [r for r in rows if self._is_abnormal(r)]
        normal   = [r for r in rows if not self._is_abnormal(r)]
        lines = ["## LAB RESULTS\n"]
        lines.append(f"_Total: {len(rows)} results | Abnormal/flagged: {len(abnormal)} | Normal: {len(normal)}_\n")
        if abnormal:
            lines.append("### ⚠ Abnormal / Flagged Results")
            for row in abnormal:
                lines.append(self._fmt_row(row, include_evidence=True))
        if normal:
            lines.append("\n### Normal Results (compressed)")
            by_doc: Dict[str, List[str]] = {}
            for row in normal:
                doc = row.get("document", "unknown")
                by_doc.setdefault(doc, []).append(f"{row.get('name', '?')}={row.get('value', 'N/A')}")
            for doc, names in by_doc.items():
                lines.append(f"- `{doc}`: {', '.join(names[:10])}" + (f" (+{len(names)-10} more)" if len(names) > 10 else ""))
        return "\n".join(lines) + "\n"

    def build_md_vitals(self, rows):
        if not rows:
            return "## VITAL SIGNS\n_No vital signs documented._\n"
        abnormal = [r for r in rows if self._is_abnormal(r)]
        normal   = [r for r in rows if not self._is_abnormal(r)]
        lines = ["## VITAL SIGNS\n"]
        lines.append(f"_Total: {len(rows)} | Abnormal: {len(abnormal)} | Normal: {len(normal)}_\n")
        if abnormal:
            lines.append("### ⚠ Out-of-Range / Abnormal Vitals")
            for row in abnormal:
                lines.append(self._fmt_row(row, include_evidence=False))
        if normal:
            lines.append("\n### Normal Vitals (latest per type)")
            seen: set = set()
            for row in reversed(normal):
                vtype = row.get("name", "?")
                if vtype not in seen:
                    lines.append(self._fmt_row(row, include_evidence=False))
                    seen.add(vtype)
        return "\n".join(lines) + "\n"

    def build_md_medications(self, rows):
        if not rows:
            return "## MEDICATIONS\n_No medications documented._\n"
        abnormal = [r for r in rows if self._is_abnormal(r)]
        normal   = [r for r in rows if not self._is_abnormal(r)]
        lines = ["## MEDICATIONS\n", f"_Total: {len(rows)} medication entries_\n"]
        if abnormal:
            lines.append("### ⚠ Clinically Significant Medications")
            for row in abnormal:
                name = row.get("name", "unknown")
                date = self._fmt_date(row.get("raw_date") or row.get("date"))
                doc  = row.get("document", "?")
                freq = row.get("frequency", "")
                cls  = row.get("drug_class", "")
                reason = self._abnormal_reason(row) or ""
                parts = [f"**{name}**", f"| {date}", f"| doc: `{doc}`"]
                if freq:   parts.append(f"| freq: {freq}")
                if cls:    parts.append(f"| class: {cls}")
                if reason: parts.append(f"| ⚠ {reason}")
                lines.append("- " + " ".join(parts))
        if normal:
            lines.append("\n### Routine Medications")
            for row in normal:
                name = row.get("name", "unknown")
                date = self._fmt_date(row.get("raw_date") or row.get("date"))
                doc  = row.get("document", "?")
                freq = row.get("frequency", "")
                cls  = row.get("drug_class", "")
                parts = [f"**{name}**", f"| {date}", f"| doc: `{doc}`"]
                if freq: parts.append(f"| freq: {freq}")
                if cls:  parts.append(f"| class: {cls}")
                lines.append("- " + " ".join(parts))
        return "\n".join(lines) + "\n"

    def build_md_findings(self, rows):
        if not rows:
            return "## FINDINGS\n_No findings documented._\n"
        abnormal = [r for r in rows if self._is_abnormal(r)]
        normal   = [r for r in rows if not self._is_abnormal(r)]
        lines = ["## CLINICAL FINDINGS\n"]
        lines.append(f"_Total: {len(rows)} | Abnormal: {len(abnormal)} | Unremarkable: {len(normal)}_\n")
        if abnormal:
            lines.append("### ⚠ Significant Findings")
            for row in abnormal:
                lines.append(self._fmt_row(row, include_evidence=True))
        if normal:
            lines.append("\n### Unremarkable Findings (compressed)")
            names = [r.get("name", "?") for r in normal]
            lines.append("- " + ", ".join(names[:15]) + (f" (+{len(names)-15} more)" if len(names) > 15 else ""))
        return "\n".join(lines) + "\n"

    def build_md_procedures(self, rows):
        if not rows:
            return "## PROCEDURES\n_No procedures documented._\n"
        abnormal = [r for r in rows if self._is_abnormal(r)]
        normal   = [r for r in rows if not self._is_abnormal(r)]
        lines = ["## PROCEDURES\n", f"_Total: {len(rows)} procedures_\n"]
        if abnormal:
            lines.append("### ⚠ Procedures with Pathological Indication")
            for row in abnormal:
                name = row.get("name", "unknown")
                date = self._fmt_date(row.get("raw_date") or row.get("date"))
                doc  = row.get("document", "?")
                spec = row.get("specimen_type", "")
                reason = self._abnormal_reason(row) or ""
                evidence = row.get("evidence", "")
                parts = [f"**{name}**", f"| {date}", f"| doc: `{doc}`"]
                if spec:   parts.append(f"| specimen: {spec}")
                if reason: parts.append(f"| ⚠ {reason}")
                lines.append("- " + " ".join(parts))
                if evidence and len(evidence) < 200:
                    lines.append(f"  > *{evidence.strip()}*")
        if normal:
            lines.append("\n### Routine Procedures")
            for row in normal:
                name = row.get("name", "unknown")
                date = self._fmt_date(row.get("raw_date") or row.get("date"))
                doc  = row.get("document", "?")
                evidence = row.get("evidence", "")
                lines.append(f"- **{name}** | {date} | doc: `{doc}`")
                if evidence and len(evidence) < 200:
                    lines.append(f"  > *{evidence.strip()}*")
        return "\n".join(lines) + "\n"

    def build_md_measurements(self, rows):
        if not rows:
            return "## MEASUREMENTS\n_No measurements documented._\n"
        lines = ["## MEASUREMENTS\n"]
        for row in rows:
            lines.append(self._fmt_row(row, include_evidence=True))
        return "\n".join(lines) + "\n"

    def build_md_anatomy(self, rows):
        if not rows:
            return "## ANATOMY\n_No anatomy entities documented._\n"
        abnormal = [r for r in rows if self._is_abnormal(r)]
        normal   = [r for r in rows if not self._is_abnormal(r)]
        lines = ["## ANATOMY\n"]
        if abnormal:
            lines.append("### ⚠ Pathologically Involved Anatomy")
            for row in abnormal:
                lines.append(self._fmt_row(row, include_evidence=False))
        if normal:
            lines.append("\n### Anatomical References")
            for row in normal:
                name = row.get("name", "unknown")
                date = self._fmt_date(row.get("raw_date") or row.get("date"))
                doc  = row.get("document", "?")
                lat  = row.get("laterality", "")
                parts = [f"**{name}**", f"| {date}", f"| doc: `{doc}`"]
                if lat: parts.append(f"| {lat}")
                lines.append("- " + " ".join(parts))
        return "\n".join(lines) + "\n"

    def build_md_symptoms(self, rows):
        if not rows:
            return "## SYMPTOMS\n_No symptoms documented._\n"
        lines = ["## SYMPTOMS / PRESENTATIONS\n"]
        for row in rows:
            lines.append(self._fmt_row(row, include_evidence=True))
        return "\n".join(lines) + "\n"

    def build_md_timeline(self, typed_data):
        events: List[Dict] = []
        for entity_type, rows in typed_data.items():
            for row in rows:
                raw_date = row.get("raw_date") or row.get("date")
                if raw_date and raw_date not in ("None", "null", "none"):
                    events.append({
                        "date": str(raw_date).strip(), "doc": row.get("document", "unknown"),
                        "type": entity_type, "name": row.get("name", "?"),
                        "is_abnormal": self._is_abnormal(row),
                        "reason": self._abnormal_reason(row),
                    })
        if not events:
            return "## CLINICAL TIMELINE\n_No dated events._\n"
        events.sort(key=lambda x: x["date"])
        by_doc: Dict[str, Dict] = {}
        for ev in events:
            key = ev["date"] + "|" + ev["doc"]
            if key not in by_doc:
                by_doc[key] = {"date": ev["date"], "doc": ev["doc"], "events": []}
            flag = "⚠ " if ev["is_abnormal"] else ""
            entry = f"{flag}[{ev['type']}] {ev['name']}"
            if ev["is_abnormal"] and ev["reason"]:
                entry += f" — {ev['reason']}"
            by_doc[key]["events"].append(entry)
        lines = ["## CLINICAL TIMELINE\n"]
        for entry in sorted(by_doc.values(), key=lambda x: x["date"]):
            lines.append(f"### {entry['date']}  |  `{entry['doc']}`")
            for ev_str in entry["events"]:
                lines.append(f"- {ev_str}")
            lines.append("")
        return "\n".join(lines)

    def build_entity_index(self, typed_data):
        prefix_map = {
            "diagnoses": "DX", "lab_results": "LB", "vital_signs": "VT",
            "medications": "MX", "findings": "FN", "procedures": "PR",
            "measurements": "MS", "anatomy": "AN", "symptoms": "SX",
        }
        index: Dict[str, EntityRecord] = {}
        for type_key, rows in typed_data.items():
            prefix = prefix_map.get(type_key, "XX")
            for i, row in enumerate(rows, 1):
                entity_id = f"{prefix}-{i:03d}"
                index[entity_id] = EntityRecord(
                    entity_id=entity_id, entity_type=type_key,
                    name=str(row.get("name", "unknown")),
                    value=str(row.get("value", "")) if row.get("value") else None,
                    unit=str(row.get("unit", "")) if row.get("unit") else None,
                    date=self._fmt_date(row.get("raw_date") or row.get("date")),
                    document=str(row.get("document", "unknown")),
                    evidence=str(row.get("evidence", "")) if row.get("evidence") else None,
                    is_abnormal=self._is_abnormal(row),
                    abnormal_reason=(self._abnormal_reason(row) or ("neo4j_flag" if row.get("is_abnormal") else None)),
                )
        return index

    def extract_confirmed_diagnoses(self, rows):
        return [{
            "name":               row.get("name", "unknown"),
            "entity_type":        "Diagnosis",
            "confirmation_status": "CONFIRMED — Documented Diagnosis",
            "date":               self._fmt_date(row.get("raw_date") or row.get("date")),
            "document":           row.get("document", "unknown"),
            "evidence_text":      row.get("evidence", ""),
            "grade":              row.get("grade"),
            "stage":              row.get("stage"),
            "histology":          row.get("histology"),
            "abnormal_reason":    self._abnormal_reason(row),
        } for row in rows]

    def extract_abnormal_signals(self, typed_data):
        signals = []
        for entity_type, rows in typed_data.items():
            for row in rows:
                if self._is_abnormal(row):
                    signals.append({
                        "entity_type": entity_type, "name": row.get("name", "?"),
                        "value": row.get("value"),
                        "date": self._fmt_date(row.get("raw_date") or row.get("date")),
                        "document": row.get("document", "?"),
                        "evidence": row.get("evidence", ""),
                        "severity": row.get("severity", "abnormal"),
                        "abnormal_reason": self._abnormal_reason(row),
                    })
        return signals

    @staticmethod
    def _estimate_tokens(text: str) -> int:
        return len(text) // 4

    def compress(self, typed_data, graph_docs):
        md_diagnoses    = self.build_md_diagnoses(   typed_data.get("diagnoses",    []))
        md_labs         = self.build_md_labs(         typed_data.get("lab_results",  []))
        md_vitals       = self.build_md_vitals(       typed_data.get("vital_signs",  []))
        md_medications  = self.build_md_medications(  typed_data.get("medications",  []))
        md_findings     = self.build_md_findings(     typed_data.get("findings",     []))
        md_procedures   = self.build_md_procedures(   typed_data.get("procedures",   []))
        md_measurements = self.build_md_measurements( typed_data.get("measurements", []))
        md_anatomy      = self.build_md_anatomy(      typed_data.get("anatomy",      []))
        md_symptoms     = self.build_md_symptoms(     typed_data.get("symptoms",     []))
        md_timeline     = self.build_md_timeline(typed_data)

        entity_index        = self.build_entity_index(typed_data)
        confirmed_diagnoses = self.extract_confirmed_diagnoses(typed_data.get("diagnoses", []))
        abnormal_signals    = self.extract_abnormal_signals(typed_data)

        total_entities = sum(len(v) for v in typed_data.values())
        abnormal_count = len(abnormal_signals)

        dates = [d.get("document_date", "") for d in graph_docs
                 if d.get("document_date") and d["document_date"] not in ("None", "null")]
        dates_sorted = sorted(d for d in dates if d)
        date_range = {
            "earliest": dates_sorted[0]  if dates_sorted else "unknown",
            "latest":   dates_sorted[-1] if dates_sorted else "unknown",
        }

        all_md = (md_diagnoses + md_labs + md_vitals + md_medications + md_findings +
                  md_procedures + md_measurements + md_anatomy + md_symptoms + md_timeline)
        token_est = self._estimate_tokens(all_md)

        logger.info(f"GraphPreprocessor: {total_entities} entities → {abnormal_count} abnormal signals | ~{token_est} tokens")

        return CompressedContext(
            confirmed_diagnoses=confirmed_diagnoses, abnormal_signals=abnormal_signals,
            md_diagnoses=md_diagnoses, md_labs=md_labs, md_vitals=md_vitals,
            md_medications=md_medications, md_findings=md_findings, md_procedures=md_procedures,
            md_measurements=md_measurements, md_anatomy=md_anatomy, md_symptoms=md_symptoms,
            md_timeline=md_timeline, entity_index=entity_index,
            total_documents=len(graph_docs), total_entities=total_entities,
            abnormal_entity_count=abnormal_count, date_range=date_range, token_estimate=token_est,
        )


# ============================================================
# NEO4J LEGACY FETCH & DEMOGRAPHICS
# ============================================================

async def fetch_patient_graph_documents(patient_id: str) -> List[Dict]:
    cypher = """
    MATCH (p:Patient {patient_id: $patient_id})-[r]->(n)
    OPTIONAL MATCH (n)-[:SUPPORTED_BY_EVIDENCE]->(e:Evidence)
    WITH r, n, e,
        coalesce(e.document_date, n.date, null) AS raw_date,
        coalesce(e.document_name, "unknown") AS document
    RETURN document, raw_date AS document_date,
        collect({
            relation: type(r),
            entity_type: CASE
                WHEN n:Diagnosis    THEN "Diagnosis"
                WHEN n:LabResult    THEN "Lab Result"
                WHEN n:VitalSign    THEN "Vital Sign"
                WHEN n:Finding      THEN "Finding"
                WHEN n:Medication   THEN "Medication"
                WHEN n:Measurement  THEN "Measurement"
                WHEN n:Procedure    THEN "Procedure"
                WHEN n:Anatomy      THEN "Anatomy"
                WHEN n:Symptom      THEN "Symptom"
                ELSE head(labels(n))
            END,
            name: coalesce(n.name, n.details, n.description,
                           n.drug_name, n.test_name, n.vital_type, n.value),
            date: raw_date,
            evidence: e.evidence_text
        }) AS entities
    ORDER BY document_date ASC
    """
    try:
        async with neo4j_driver.session() as session:
            result = await session.run(cypher, patient_id=patient_id)
            docs: List[Dict] = []
            async for record in result:
                docs.append({
                    "document":      record["document"],
                    "document_date": str(record["document_date"]),
                    "entities":      record["entities"],
                })
            return docs
    except Exception as e:
        logger.error(f"Legacy Neo4j fetch failed: {e}")
        raise


async def fetch_patient_demographics(patient_id: str) -> Dict:
    try:
        patient = await mongo_db["patient_users"].find_one(
            {"sys_user_id": patient_id},
            {"_id": 0, "date_of_birth": 1, "gender": 1}
        )
        if not patient:
            return {"dob": None, "sex": None}
        return {"dob": patient.get("date_of_birth"), "sex": patient.get("gender")}
    except Exception:
        logger.exception(f"Demographics fetch failed for {patient_id}")
        return {"dob": None, "sex": None}


# ============================================================
# UTILITIES
# ============================================================

def parse_llm_json(text: str) -> Dict:
    if not text:
        return {}
    text = text.strip()
    text = re.sub(r"```json", "", text)
    text = re.sub(r"```", "", text)
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        text = match.group(0)
    try:
        return json.loads(text)
    except Exception:
        return {"raw_output": text}


def _compute_age_from_dob(dob: Optional[str]) -> Optional[float]:
    if not dob or not dob.strip():
        return None
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y", "%d-%b-%Y", "%Y/%m/%d"):
        try:
            birth = datetime.strptime(dob.strip(), fmt)
            return round((datetime.now() - birth).days / 365.25, 1)
        except ValueError:
            continue
    return None


class BaseAgent:
    def __init__(self, llm):
        self.llm = llm

    async def _invoke(self, system: str, user: str) -> Dict:
        response = await self.llm.ainvoke([SystemMessage(content=system), HumanMessage(content=user)])
        return parse_llm_json(response.content)

    def _elapsed(self, start: float) -> float:
        return round((datetime.now().timestamp() - start) * 1000, 1)

    def _get_ctx(self, state: PredictiveState) -> CompressedContext:
        return state.get("compressed_context") or CompressedContext(
            confirmed_diagnoses=[], abnormal_signals=[],
            md_diagnoses="", md_labs="", md_vitals="", md_medications="",
            md_findings="", md_procedures="", md_measurements="",
            md_anatomy="", md_symptoms="", md_timeline="",
            entity_index={}, total_documents=0, total_entities=0,
            abnormal_entity_count=0, date_range={}, token_estimate=0,
        )

    def _build_clinical_context(self, ctx: CompressedContext, sections: Optional[List[str]] = None) -> str:
        section_map = {
            "diagnoses": ctx["md_diagnoses"], "labs": ctx["md_labs"], "vitals": ctx["md_vitals"],
            "medications": ctx["md_medications"], "findings": ctx["md_findings"],
            "procedures": ctx["md_procedures"], "measurements": ctx["md_measurements"],
            "anatomy": ctx["md_anatomy"], "symptoms": ctx["md_symptoms"], "timeline": ctx["md_timeline"],
        }
        if sections is None:
            sections = list(section_map.keys())
        parts = [
            f"**PATIENT CLINICAL DATA** "
            f"(docs: {ctx['total_documents']} | entities: {ctx['total_entities']} | "
            f"abnormal: {ctx['abnormal_entity_count']} | "
            f"date range: {ctx['date_range'].get('earliest','?')} → {ctx['date_range'].get('latest','?')})**\n"
        ]
        for key in sections:
            if key in section_map and section_map[key]:
                parts.append(section_map[key])
        return "\n\n".join(parts)


# ============================================================
# QRISK3 IMPLEMENTATION  (unchanged)
# ============================================================

QRISK3_W_BINARY: Dict[str, float] = {
    "atrial_fibrillation": 1.5923, "atypical_antipsychotic": 0.2566,
    "corticosteroid_use": 0.5887, "migraine": 0.2289,
    "rheumatoid_arthritis": 0.2804, "ckd_stage3_plus": 0.5765,
    "severe_mental_illness": 0.2562, "sle": 0.7579,
    "treated_hypertension": 0.6218, "type1_diabetes": 1.7078,
    "type2_diabetes": 1.0645, "family_history_cvd": 0.4522,
    "erectile_dysfunction": 0.0,
}
QRISK3_W_SMOKING:   Dict[str, float] = {"ex": 0.1341, "light": 0.5426, "moderate": 0.6924, "heavy": 0.8659}
QRISK3_W_ETHNICITY: Dict[int, float] = {2: 0.2804, 3: 0.1302, 4: -0.1749, 5: 0.0, 6: -0.3580, 7: -0.4021, 8: -0.1699, 9: -0.1655}
QRISK3_W_CONTINUOUS: Dict[str, float] = {"cholesterol_hdl_ratio": 0.1681, "sbp_mean": 0.0128, "sbp_variability": 0.0106, "townsend_score": 0.0939}
QRISK3_W_AGE_COEFF = 0.0775; QRISK3_W_BMI_COEFF = 0.0854; QRISK3_W_BASELINE_SURVIVAL = 0.9809; QRISK3_W_MEAN_LP = -0.3789
QRISK3_W_DEFAULTS  = {"age": 52.0, "bmi": 26.0, "sbp_mean": 123.0, "sbp_variability": 0.0, "cholesterol_hdl_ratio": 3.5, "townsend_score": 0.0}

QRISK3_M_BINARY: Dict[str, float] = {
    "atrial_fibrillation": 0.8836, "atypical_antipsychotic": 0.1422,
    "corticosteroid_use": 0.3543, "migraine": 0.0,
    "rheumatoid_arthritis": 0.2576, "ckd_stage3_plus": 0.5765,
    "severe_mental_illness": 0.1652, "sle": 0.0,
    "treated_hypertension": 0.5481, "type1_diabetes": 1.0434,
    "type2_diabetes": 0.7600, "family_history_cvd": 0.5441,
    "erectile_dysfunction": 0.2231,
}
QRISK3_M_SMOKING:    Dict[str, float] = {"ex": 0.1519, "light": 0.5956, "moderate": 0.6618, "heavy": 0.8429}
QRISK3_M_ETHNICITY:  Dict[int, float] = {2: 0.3012, 3: 0.1681, 4: 0.0, 5: -0.1751, 6: -0.3580, 7: -0.4021, 8: -0.1699, 9: -0.1655}
QRISK3_M_CONTINUOUS: Dict[str, float] = {"cholesterol_hdl_ratio": 0.1530, "sbp_mean": 0.0168, "sbp_variability": 0.0094, "townsend_score": 0.0671}
QRISK3_M_AGE_COEFF = 0.0713; QRISK3_M_BMI_COEFF = 0.0682; QRISK3_M_BASELINE_SURVIVAL = 0.9561; QRISK3_M_MEAN_LP = 0.0943
QRISK3_M_DEFAULTS  = {"age": 52.0, "bmi": 26.0, "sbp_mean": 130.0, "sbp_variability": 0.0, "cholesterol_hdl_ratio": 4.0, "townsend_score": 0.0}

ETHNICITY_CODE_MAP: Dict[str, int] = {
    "white": 1, "not recorded": 1, "unknown": 1, "indian": 2, "south asian": 2,
    "pakistani": 3, "bangladeshi": 4, "other asian": 5, "black caribbean": 6,
    "black african": 7, "chinese": 8, "other": 9,
}


def _qrisk3_category(pct: float) -> str:
    if pct < 10: return "LOW (<10%)"
    elif pct < 20: return "MODERATE (10-20%)"
    else: return "HIGH (>20%)"


def compute_qrisk3_score(extracted: Dict, sex: str, age: Optional[float]) -> Dict:
    sex_norm = (sex or "").lower().strip()
    is_female = sex_norm in ("female", "f", "woman", "women")
    is_male   = sex_norm in ("male",   "m", "man",   "men")

    if not is_female and not is_male:
        return {"score_percent": None, "risk_category": "UNAVAILABLE", "error": "Sex not documented.",
                "variables_used": [], "missing_variables": ["sex"], "assumed_defaults": [], "confidence": "Insufficient data"}

    if is_female:
        binary_c, smoking_c, ethnic_c, cont_c = QRISK3_W_BINARY, QRISK3_W_SMOKING, QRISK3_W_ETHNICITY, QRISK3_W_CONTINUOUS
        age_coeff, bmi_coeff, s0, mean_lp, defaults = QRISK3_W_AGE_COEFF, QRISK3_W_BMI_COEFF, QRISK3_W_BASELINE_SURVIVAL, QRISK3_W_MEAN_LP, QRISK3_W_DEFAULTS
    else:
        binary_c, smoking_c, ethnic_c, cont_c = QRISK3_M_BINARY, QRISK3_M_SMOKING, QRISK3_M_ETHNICITY, QRISK3_M_CONTINUOUS
        age_coeff, bmi_coeff, s0, mean_lp, defaults = QRISK3_M_AGE_COEFF, QRISK3_M_BMI_COEFF, QRISK3_M_BASELINE_SURVIVAL, QRISK3_M_MEAN_LP, QRISK3_M_DEFAULTS

    lp = 0.0; used_vars: List[str] = []; missing_vars: List[str] = []; assumed: List[str] = []

    if age and 25 <= age <= 84:
        lp += age_coeff * (age - 52.0); used_vars.append(f"age={age:.1f}y")
    elif age:
        return {"score_percent": None, "risk_category": "UNAVAILABLE",
                "error": f"Age {age} outside QRISK3 range (25-84).",
                "variables_used": [], "missing_variables": ["age_in_range"], "assumed_defaults": [], "confidence": "Insufficient data"}
    else:
        return {"score_percent": None, "risk_category": "UNAVAILABLE", "error": "Age not available.",
                "variables_used": [], "missing_variables": ["age"], "assumed_defaults": [], "confidence": "Insufficient data"}

    for var, coeff, centre in [
        ("bmi", bmi_coeff, 26.0),
        ("sbp_mean", cont_c["sbp_mean"], defaults["sbp_mean"]),
        ("cholesterol_hdl_ratio", cont_c["cholesterol_hdl_ratio"], defaults["cholesterol_hdl_ratio"]),
        ("townsend_score", cont_c.get("townsend_score", 0), 0.0),
    ]:
        raw = extracted.get(var)
        if raw is not None:
            try:
                val = float(raw); lp += coeff * (val - centre); used_vars.append(f"{var}={val}")
            except (ValueError, TypeError):
                missing_vars.append(f"{var} unparseable"); assumed.append(f"{var}={defaults.get(var, 0)} (median)")
        else:
            missing_vars.append(f"{var} not in graph"); assumed.append(f"{var}={defaults.get(var, 0)} (median)")

    sbpv_raw = extracted.get("sbp_variability")
    if sbpv_raw is not None:
        try: lp += cont_c["sbp_variability"] * float(sbpv_raw)
        except (ValueError, TypeError): pass

    for var_key, coeff_val in binary_c.items():
        if coeff_val == 0.0: continue
        val = extracted.get(var_key, 0)
        try: flag = int(bool(val))
        except (TypeError, ValueError): flag = 0
        if flag: lp += coeff_val; used_vars.append(f"{var_key}=YES")

    smoking = (extracted.get("smoking_category") or "").lower().strip()
    if smoking in smoking_c: lp += smoking_c[smoking]; used_vars.append(f"smoking={smoking}")
    else: used_vars.append("smoking=never/not documented")

    eth_raw  = (extracted.get("ethnicity") or "").lower().strip()
    eth_code = ETHNICITY_CODE_MAP.get(eth_raw, 1)
    if eth_code != 1 and eth_code in ethnic_c: lp += ethnic_c[eth_code]; used_vars.append(f"ethnicity={eth_raw}")
    else: used_vars.append("ethnicity=white/not recorded (code 1)")

    try:
        risk_fraction = 1.0 - math.pow(s0, math.exp(lp - mean_lp))
        risk_percent  = round(risk_fraction * 100, 1)
    except (OverflowError, ValueError):
        return {"score_percent": None, "risk_category": "COMPUTATION_ERROR", "error": "Overflow.",
                "variables_used": used_vars, "missing_variables": missing_vars, "assumed_defaults": assumed, "confidence": "Insufficient data"}

    key_present = sum([
        1 if extracted.get("bmi") else 0,
        1 if extracted.get("sbp_mean") else 0,
        1 if extracted.get("cholesterol_hdl_ratio") else 0,
        1 if extracted.get("smoking_category") else 0,
        1 if extracted.get("ethnicity") else 0,
    ])
    confidence = ("Moderate" if key_present >= 4 else "Low-Moderate" if key_present >= 2 else "Low — most key variables absent; score is indicative only")

    return {
        "score_percent": risk_percent, "risk_category": _qrisk3_category(risk_percent),
        "linear_predictor": round(lp, 4), "sex_used": "female" if is_female else "male",
        "age_used": age, "baseline_survival_used": s0, "confidence": confidence,
        "key_variables_present": key_present, "key_variables_total": 5,
        "variables_used": used_vars, "missing_variables": missing_vars, "assumed_defaults": assumed,
        "interpretation": f"Approximately {risk_percent}% estimated probability of a heart attack or stroke in the next 10 years based on available graph variables.",
        "caveats": ["Age/BMI polynomials linearised in this implementation.", "Missing variables replaced with population medians.", "Clinical decisions require validated algorithm at qrisk.org."],
        "reference": "Hippisley-Cox J, Coupland C, Brindle P. BMJ 2017;357:j2099",
    }


# ============================================================
# B_QRISK3 · QRISK3 AGENT
# Extracts variables from compressed context, computes QRISK3 score.
# ============================================================

class QRISK3Agent(BaseAgent):
    agent_id = "B_QRISK3"

    async def run(self, state: PredictiveState) -> PredictiveState:
        logger.info(f"{self.agent_id} · QRISK3Agent — START")
        t0 = datetime.now().timestamp()
        patient_dob  = state.get("dob",  "Not documented")
        patient_sex  = state.get("sex",  "Not documented")
        age = _compute_age_from_dob(patient_dob)
        ctx = self._get_ctx(state)
        clinical_ctx = self._build_clinical_context(ctx, sections=["vitals", "labs", "medications", "measurements", "diagnoses"])

        system = (
            "You are a clinical data extractor specialised in QRISK3 cardiovascular risk calculator inputs. "
            "Extract ONLY what is explicitly present in the clinical data. "
            "Do NOT impute or infer missing values. Return valid JSON only."
        )
        prompt = f"""
PATIENT DEMOGRAPHICS: DOB={patient_dob} | Sex={patient_sex} | Computed Age={age if age else "Not computable"}

COMPRESSED CLINICAL DATA:
{clinical_ctx}

Extract all QRISK3 input variables that are explicitly present in the data above.
Return null for any variable not present.

Return ONLY valid JSON:
{{
  "extracted_variables": {{
    "age": null,
    "sex": null,
    "ethnicity": null,
    "townsend_score": null,
    "bmi": null,
    "weight_kg": null,
    "height_cm": null,
    "sbp_mean": null,
    "sbp_variability": null,
    "sbp_readings": [],
    "total_cholesterol": null,
    "hdl_cholesterol": null,
    "cholesterol_hdl_ratio": null,
    "smoking_category": null,
    "atrial_fibrillation": 0,
    "atypical_antipsychotic": 0,
    "corticosteroid_use": 0,
    "migraine": 0,
    "rheumatoid_arthritis": 0,
    "ckd_stage3_plus": 0,
    "severe_mental_illness": 0,
    "sle": 0,
    "treated_hypertension": 0,
    "type1_diabetes": 0,
    "type2_diabetes": 0,
    "family_history_cvd": 0,
    "erectile_dysfunction": 0
  }},
  "variables_present_in_graph": [],
  "variables_absent_from_graph": [],
  "data_completeness_note": "Brief note on data quality for QRISK3 calculation"
}}
"""
        llm_result = await self._invoke(system, prompt)
        extracted = llm_result.get("extracted_variables", {})
        if not isinstance(extracted, dict):
            extracted = {}

        if not extracted.get("age") and age is not None:
            extracted["age"] = age
        if not extracted.get("sex"):
            extracted["sex"] = patient_sex

        sex_for_calc = extracted.get("sex") or patient_sex or ""
        age_for_calc = extracted.get("age") or age
        qrisk3_calc = compute_qrisk3_score(extracted, sex_for_calc, age_for_calc)

        state["qrisk3_assessment"] = {
            "agent": self.agent_id,
            "reference": "Hippisley-Cox J, Coupland C, Brindle P. BMJ 2017;357:j2099",
            "algorithm": "QRISK3 — Simplified approximation (linearised age/BMI polynomials)",
            **{k: qrisk3_calc.get(k) for k in [
                "score_percent", "risk_category", "interpretation", "sex_used",
                "age_used", "confidence", "key_variables_present", "key_variables_total",
                "variables_used", "missing_variables", "assumed_defaults", "caveats", "error", "linear_predictor"
            ]},
            "extracted_variables": extracted,
            "variables_present_in_graph":  llm_result.get("variables_present_in_graph", []),
            "variables_absent_from_graph": llm_result.get("variables_absent_from_graph", []),
            "data_completeness_note":      llm_result.get("data_completeness_note", ""),
        }
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · QRISK3Agent — DONE ({state['agent_timings'][self.agent_id]}ms) | score={qrisk3_calc.get('score_percent')}%")
        return state


# ============================================================
# B10 · PREDICTIVE NARRATIVE AGENT
# Produces Section 02: "What to Watch For — Risks & Predictions"
# Works directly from compressed_context — no upstream B0-B9 deps.
# ============================================================

class PredictiveNarrativeAgent(BaseAgent):
    agent_id = "B10"

    async def run(self, state: PredictiveState) -> PredictiveState:
        logger.info(f"{self.agent_id} · PredictiveNarrativeAgent — START")
        t0 = datetime.now().timestamp()

        patient_dob  = state.get("dob",  "Not documented")
        patient_sex  = state.get("sex",  "Not documented")
        primary_spec = state.get("primary_specialty") or "Not specified"
        ctx          = self._get_ctx(state)
        qrisk3       = state.get("qrisk3_assessment") or {}

        clinical_ctx = self._build_clinical_context(ctx)
        dx_json      = json.dumps(ctx["confirmed_diagnoses"], indent=2, default=str)
        abnormal_json = json.dumps(ctx["abnormal_signals"][:60], indent=2, default=str)

        system = (
            "You are a senior physician writing Section 02 of a patient-education health report. "
            "Your audience is a non-medical adult — write in warm, plain English with short sentences. "
            "Every risk or warning sign MUST be traceable to a documented entity in the clinical data. "
            "Do NOT invent risks or make up conditions not present in the data. "
            "Do NOT recommend treatments, medications, or procedures. "
            "Confirmed diagnoses always appear first. Return valid JSON only."
        )

        prompt = f"""
PATIENT: DOB={patient_dob} | Sex={patient_sex} | Primary Specialty={primary_spec}

CONFIRMED DIAGNOSES (from graph):
{dx_json}

ABNORMAL SIGNALS (from graph, top 60):
{abnormal_json}

FULL COMPRESSED CLINICAL DATA:
{clinical_ctx}

QRISK3 SCORE (pre-computed):
{json.dumps(qrisk3, indent=2, default=str)}

══════════════════════════════════════════════════════════
TASK — SECTION 02: WHAT TO WATCH FOR — RISKS & PREDICTIONS
Style: MedConsolidate patient-education PDF
Tone: warm, plain English, no jargon, short sentences
══════════════════════════════════════════════════════════

SEVERITY BADGE VALUES (pick exactly one per risk):
  "CONFIRMED"      — already diagnosed, documented in records
  "HIGH RISK"      — strong evidence from documented signals points toward this
  "MODERATE"       — meaningful risk worth watching, based on documented data
  "WATCH CLOSELY"  — early signal present in records, needs monitoring

Return ONLY valid JSON:
{{
  "section_02_what_to_watch_for": {{
    "section_intro": "One warm sentence explaining what this section covers.",

    "short_term_risks": {{
      "label": "Short-Term Risks (Next 3–6 Months)",
      "items": [
        {{
          "risk_name": "Plain English name (e.g. 'Blood sugar spikes')",
          "severity_badge": "CONFIRMED|HIGH RISK|MODERATE|WATCH CLOSELY",
          "plain_description": "One or two sentences describing what this risk means for the patient. No jargon.",
          "trigger_scenario": "What makes this risk worse (e.g. 'Skipping meals or eating high-carb foods').",
          "what_patient_feels": "What the patient might feel if this happens (symptoms in plain English).",
          "source_entity": "Name of the graph entity this risk is based on",
          "source_document": "Document this came from",
          "specialty_domain": "e.g. Endocrinology"
        }}
      ]
    }},

    "long_term_risks": {{
      "label": "Long-Term Risks (1–5 Years)",
      "items": [
        {{
          "risk_name": "Plain English name (e.g. 'Kidney decline')",
          "severity_badge": "CONFIRMED|HIGH RISK|MODERATE|WATCH CLOSELY",
          "plain_description": "Two to three sentences explaining the long-term consequence in plain language. Be specific about which organ or body system.",
          "why_this_patient": "Why this specific patient is at risk, based only on documented conditions.",
          "preventability_note": "One sentence on whether this is preventable or manageable (e.g. 'Preventable with annual eye checks').",
          "source_entity": "Name of the graph entity this risk is based on",
          "source_document": "Document this came from",
          "specialty_domain": "e.g. Nephrology"
        }}
      ]
    }},

    "early_warning_signs": {{
      "label": "Early Warning Signs — Seek Help Immediately If You Notice",
      "intro": "These symptoms mean something may be going wrong. Do not wait — contact your doctor or go to A&E.",
      "groups": [
        {{
          "group_name": "e.g. Heart / Stroke Warnings",
          "related_condition": "Condition this group relates to",
          "signs": [
            "Plain English description of a warning sign (e.g. 'Chest pain or tightness')"
          ]
        }}
      ]
    }},

    "qrisk3_plain": {{
      "score_percent": {qrisk3.get("score_percent")},
      "plain_statement": "e.g. Based on what we know about you, your estimated 10-year risk of a heart attack or stroke is approximately X%.",
      "risk_category_plain": "e.g. This is in the LOW / MODERATE / HIGH range.",
      "what_this_means": "One plain-English sentence about what this number means for this patient.",
      "caveat": "This is an estimate based on available records. A full assessment requires a face-to-face consultation."
    }},

    "section_02_summary": "Two sentences summarising the most important risks for this patient.",
    "total_short_term_risks": 0,
    "total_long_term_risks": 0,
    "highest_priority_risk": "Plain name of the single most important risk for this patient.",
    "disclaimer": "These predictions are based on your documented medical records. They are not a clinical diagnosis or prognosis. Always consult your doctor before making any decisions about your health."
  }},

  "confirmed_diagnoses_list": [
    {{
      "condition": "Exact name from records",
      "confirmation_status": "CONFIRMED — Documented Diagnosis",
      "specialty_domain": "...",
      "first_documented": "...",
      "source_document": "...",
      "evidence_text": "...",
      "grade": null,
      "stage": null
    }}
  ],

  "abnormal_signals_summary": [
    {{
      "signal_name": "...",
      "entity_type": "...",
      "value": "...",
      "date": "...",
      "document": "...",
      "clinical_significance": "High|Moderate|Low"
    }}
  ],

  "executive_summary": "3–5 sentence summary of the patient's most important health concerns and risks. All condition names from graph only. No treatment language.",
  "disclaimer": "IMPORTANT: This analysis is generated solely from documented medical records. It identifies risk signals and potential trajectories — it does not constitute a clinical diagnosis, prognosis, or treatment recommendation. All findings require specialist clinical review."
}}
"""
        state["predictive_report"] = await self._invoke(system, prompt)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · PredictiveNarrativeAgent — DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# B12 · PATIENT UNDERSTANDING AGENT
# Produces Section 01 (Your Current Health) + Section 03 (Monitoring Checklist)
# Works directly from compressed_context.
# ============================================================

class PatientUnderstandingAgent(BaseAgent):
    agent_id = "B12"

    async def run(self, state: PredictiveState) -> PredictiveState:
        logger.info(f"{self.agent_id} · PatientUnderstandingAgent — START")
        t0 = datetime.now().timestamp()

        patient_dob  = state.get("dob",  "Not documented")
        patient_sex  = state.get("sex",  "Not documented")
        primary_spec = state.get("primary_specialty") or "Not specified"
        ctx          = self._get_ctx(state)
        qrisk3       = state.get("qrisk3_assessment") or {}

        dx_json = json.dumps(ctx["confirmed_diagnoses"], indent=2, default=str)

        system = (
            "You are a specialist in patient health communication writing a patient-education report. "
            "Write Section 01 (Your Current Health) and Section 03 (Your Monitoring Checklist). "
            "Tone: warm, plain English — as if explaining to a non-medical adult. Zero jargon. "
            "Every condition, medication, and lab value MUST come from the documented clinical data. "
            "Do NOT invent or assume information not present in the data. "
            "Do NOT recommend treatments. Return valid JSON only."
        )

        prompt = f"""
PATIENT: DOB={patient_dob} | Sex={patient_sex} | Specialty={primary_spec}

CONFIRMED DIAGNOSES:
{dx_json}

COMPRESSED MEDICATIONS:
{ctx['md_medications']}

COMPRESSED LAB RESULTS:
{ctx['md_labs']}

COMPRESSED VITAL SIGNS:
{ctx['md_vitals']}

COMPRESSED FINDINGS:
{ctx['md_findings']}

COMPRESSED SYMPTOMS:
{ctx['md_symptoms']}

COMPRESSED PROCEDURES:
{ctx['md_procedures']}

QRISK3 SCORE:
{json.dumps(qrisk3, indent=2, default=str)}

══════════════════════════════════════════════════════════
TASK — SECTION 01: YOUR CURRENT HEALTH (plain language)
        AND
        SECTION 03: YOUR MONITORING CHECKLIST
Style: MedConsolidate patient-education PDF
══════════════════════════════════════════════════════════

SEVERITY BADGE VALUES for Section 01 conditions:
  "CRITICAL"      — immediately life-threatening or actively serious
  "SERIOUS"       — significant condition requiring specialist management
  "MODERATE"      — manageable condition needing consistent attention
  "MILD"          — early-stage or low-severity condition
  "WATCH CLOSELY" — not yet a diagnosis but needs monitoring (subclinical signal)

Return ONLY valid JSON:
{{
  "section_01_your_current_health": {{
    "section_intro": "One warm welcoming sentence explaining this section.",

    "condition_cards": [
      {{
        "condition_plain_name": "Plain English name (e.g. 'High Blood Pressure')",
        "condition_medical_name": "Medical name (e.g. 'Hypertension')",
        "severity_badge": "CRITICAL|SERIOUS|MODERATE|MILD|WATCH CLOSELY",
        "what_it_is": "One to two sentences: what is this condition, in simple words.",
        "what_it_means_for_life": "One to two sentences: how does this affect daily life? Fatigue, diet, activity limits?",
        "current_status": "One sentence: is it actively treated or being monitored?",
        "key_number": "The most relevant lab/vital value for this condition. null if not available.",
        "key_number_context": "One sentence on what this number means (e.g. 'Safe target is below 7%'). null if key_number is null.",
        "confirmed_in_document": "Document name",
        "confirmed_on_date": "Date",
        "evidence_plain": "Plain English summary of the evidence (e.g. 'Your biopsy confirmed this condition')",
        "specialty_domain": "e.g. Urology"
      }}
    ],

    "allergies_and_history": {{
      "known_allergies": [],
      "past_surgeries": [],
      "past_hospitalisations": [],
      "summary_paragraph": "One paragraph summarising allergies, surgeries and hospitalisations in plain English. Say 'None documented in available records' if empty."
    }},

    "medications_plain": [
      {{
        "medicine_name": "Drug name",
        "dose_and_frequency": "e.g. 500mg, twice daily — or 'Dose not documented' if absent",
        "what_it_does_simply": "One plain sentence on what this medicine does",
        "confirmed_in_document": "Document name",
        "confirmed_on_date": "Date"
      }}
    ],

    "key_lab_values": [
      {{
        "test_name_plain": "Plain name (e.g. 'Average Blood Sugar')",
        "test_name_medical": "Medical name (e.g. 'HbA1c')",
        "your_result": "The documented value",
        "target_or_normal": "What normal/target looks like — null if not determinable",
        "what_it_means_plain": "One plain sentence on what the result means",
        "date": "Test date",
        "source_document": "Document name"
      }}
    ],

    "overall_health_summary": "Two to three supportive, honest sentences giving an overall picture of this patient's health.",
    "total_active_conditions": 0,
    "total_medications": 0,
    "generated_from_documents": []
  }},

  "section_03_monitoring_checklist": {{
    "section_intro": "One sentence explaining why monitoring matters for this patient specifically.",

    "home_monitoring": [
      {{
        "what_to_check": "Plain name (e.g. 'Blood Pressure')",
        "how_often": "e.g. Twice daily (morning and evening)",
        "target_or_goal": "e.g. Below 130/80 mmHg — null if not determinable",
        "how_to_do_it": "One simple sentence on how to perform this check.",
        "why_important": "One sentence on why this check matters for this patient's conditions.",
        "related_condition": "Condition name",
        "alert_level": "When to contact doctor — e.g. 'If above 180/120 mmHg, seek help immediately'"
      }}
    ],

    "clinical_tests": [
      {{
        "test_name": "e.g. HbA1c (Average Blood Sugar)",
        "how_often": "e.g. Every 3 months",
        "purpose_plain": "e.g. Track 3-month blood sugar control",
        "why_this_patient": "Why this specific test matters for this patient's conditions.",
        "related_condition": "Condition name",
        "urgency": "Routine|Important|Critical"
      }}
    ],

    "checklist_summary": "One sentence summarising the overall monitoring plan.",
    "total_home_checks": 0,
    "total_clinical_tests": 0
  }},

  "patient_summary_headline": "One sentence: the most important health message for this patient, in warm plain English.",
  "total_findings_explained": 0,
  "generated_from_documents": [],
  "section_disclaimer": "This report has been automatically generated from your medical records to help you understand your health. It is not a medical diagnosis, prognosis, or recommendation for any treatment. Please discuss all findings with your doctor."
}}
"""
        state["patient_understanding"] = await self._invoke(system, prompt)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · PatientUnderstandingAgent — DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# B_CONSULT · CONSULTANT MAP AGENT
# Produces Section 04: "Who You Should Consult"
# Works from compressed_context + patient_understanding output.
# ============================================================

class ConsultantMapAgent(BaseAgent):
    agent_id = "B_CONSULT"

    async def run(self, state: PredictiveState) -> PredictiveState:
        logger.info(f"{self.agent_id} · ConsultantMapAgent — START")
        t0 = datetime.now().timestamp()

        patient_dob  = state.get("dob",  "Not documented")
        patient_sex  = state.get("sex",  "Not documented")
        primary_spec = state.get("primary_specialty") or "Not specified"
        ctx          = self._get_ctx(state)
        report       = state.get("predictive_report") or {}
        understanding = state.get("patient_understanding") or {}

        dx_json = json.dumps(ctx["confirmed_diagnoses"], indent=2, default=str)
        abnormal_json = json.dumps(ctx["abnormal_signals"][:40], indent=2, default=str)

        # Pull condition cards from Section 01 if available
        condition_cards = understanding.get("section_01_your_current_health", {}).get("condition_cards", [])
        section_02 = report.get("section_02_what_to_watch_for", {})

        system = (
            "You are a specialist in patient care coordination and multidisciplinary referral planning. "
            "Generate Section 04 of a patient-education health report: 'Who You Should Consult'. "
            "Write in warm, plain English. Every referral must be justified by a documented condition or signal. "
            "Do NOT recommend unnecessary specialists. Do NOT include treatment language. Return valid JSON only."
        )

        prompt = f"""
PATIENT: DOB={patient_dob} | Sex={patient_sex} | Primary Specialty={primary_spec}

CONFIRMED DIAGNOSES:
{dx_json}

ABNORMAL SIGNALS (top 40):
{abnormal_json}

COMPRESSED MEDICATIONS:
{ctx['md_medications']}

CONDITION CARDS (from Section 01):
{json.dumps(condition_cards, indent=2, default=str)}

SHORT & LONG-TERM RISKS (from Section 02):
{json.dumps(section_02, indent=2, default=str)}

══════════════════════════════════════════════════════════
TASK — SECTION 04: WHO YOU SHOULD CONSULT
Style: MedConsolidate patient-education PDF
Specialist table with urgency, plain-English reasons
══════════════════════════════════════════════════════════

Rules:
- Only recommend specialists that are clearly justified by documented conditions or abnormal signals.
- Always include General Physician (ONGOING) as care coordinator.
- Use plain English for "why_needed" and "what_to_expect".
- No treatment language.

URGENCY VALUES (use exactly one):
  "HIGH"       — see within 4–8 weeks
  "MEDIUM"     — schedule within 3 months
  "ANNUAL"     — once a year
  "6 MONTHS"   — every 6 months
  "ONGOING"    — continuous relationship
  "AS NEEDED"  — for specific symptoms only

Return ONLY valid JSON:
{{
  "section_04_who_to_consult": {{
    "section_intro": "One plain sentence explaining why this patient needs a team of specialists.",

    "specialist_referrals": [
      {{
        "specialist_type": "e.g. Endocrinologist",
        "why_needed": "Plain English: what this specialist does and why THIS patient needs them, based on their documented conditions.",
        "urgency": "HIGH|MEDIUM|ANNUAL|6 MONTHS|ONGOING|AS NEEDED",
        "urgency_plain": "e.g. 'You should see them within the next 4–6 weeks'",
        "related_conditions": ["List of documented conditions this specialist addresses"],
        "what_to_expect": "One sentence: what will happen at this appointment.",
        "source_entity": "The graph entity that triggers this referral",
        "source_document": "Document this came from",
        "specialty_domain": "Medical specialty name"
      }}
    ],

    "pharmacy_review": {{
      "needed": false,
      "reason": "Plain reason — e.g. Patient is on X medications, a pharmacist review checks for interactions.",
      "number_of_medications": 0,
      "polypharmacy_flag": false,
      "polypharmacy_note": null
    }},

    "care_coordination_note": "One sentence about the GP/family doctor as the central coordinator of all specialist inputs.",

    "section_04_summary": "Two sentences summarising the consultation priorities for this patient.",
    "total_specialists_recommended": 0,
    "high_urgency_count": 0,
    "medium_urgency_count": 0
  }}
}}
"""
        state["consultant_map"] = await self._invoke(system, prompt)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · ConsultantMapAgent — DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# B12 → B_CONSULT SEQUENTIAL RUNNER
# ============================================================

async def run_b12_then_consult(state: PredictiveState) -> PredictiveState:
    logger.info("Patient layer (B12 → B_CONSULT) — START")
    t0 = datetime.now().timestamp()

    # B12 first — its condition_cards feed B_CONSULT
    try:
        result_b12 = await PatientUnderstandingAgent(llm_synthesis).run(dict(state))
        state["agent_timings"].update(result_b12.get("agent_timings", {}))
        state["patient_understanding"] = result_b12.get("patient_understanding")
    except Exception as e:
        logger.error(f"B12 failed: {e}")
        state["errors"].append(f"B12: {str(e)}")

    # B_CONSULT uses patient_understanding from above
    state_for_consult = dict(state)
    try:
        result_consult = await ConsultantMapAgent(llm_synthesis).run(state_for_consult)
        state["agent_timings"].update(result_consult.get("agent_timings", {}))
        state["consultant_map"] = result_consult.get("consultant_map")
    except Exception as e:
        logger.error(f"B_CONSULT failed: {e}")
        state["errors"].append(f"B_CONSULT: {str(e)}")
        state["consultant_map"] = {"error": str(e)}

    elapsed = round((datetime.now().timestamp() - t0) * 1000, 1)
    logger.info(f"Patient layer (B12 → B_CONSULT) — DONE ({elapsed}ms)")
    return state


# ============================================================
# B13 · DIETARY GUIDANCE AGENT
# Produces Section 05: "Diet, Habits & Lifestyle Changes"
# Works directly from compressed_context.
# ============================================================

class DietaryGuidanceAgent(BaseAgent):
    agent_id = "B13"

    async def run(self, state: PredictiveState) -> PredictiveState:
        logger.info(f"{self.agent_id} · DietaryGuidanceAgent — START")
        t0 = datetime.now().timestamp()

        patient_dob  = state.get("dob",  "Not documented")
        patient_sex  = state.get("sex",  "Not documented")
        primary_spec = state.get("primary_specialty") or "Not specified"
        ctx          = self._get_ctx(state)

        dx_json = json.dumps(ctx["confirmed_diagnoses"], indent=2, default=str)
        abnormal_json = json.dumps(ctx["abnormal_signals"][:30], indent=2, default=str)

        system = (
            "You are a clinical nutritionist writing Section 05 of a patient-education health report: "
            "'Diet, Habits & Lifestyle Changes'. "
            "Tone: warm, practical plain English — like advice from a trusted nutritionist. "
            "Every recommendation MUST relate to a documented condition or abnormal signal. "
            "Be condition-specific, not generic. "
            "Do NOT recommend medications or procedures. "
            "Always end with the disclaimer about consulting a doctor or dietitian. "
            "Return valid JSON only."
        )

        prompt = f"""
PATIENT: DOB={patient_dob} | Sex={patient_sex} | Specialty={primary_spec}

CONFIRMED DIAGNOSES:
{dx_json}

ABNORMAL SIGNALS (top 30):
{abnormal_json}

COMPRESSED MEDICATIONS (check for dietary interactions):
{ctx['md_medications']}

COMPRESSED LABS (for dietary targets):
{ctx['md_labs']}

COMPRESSED FINDINGS (for organ-specific dietary cautions):
{ctx['md_findings']}

══════════════════════════════════════════════════════════
TASK — SECTION 05: DIET, HABITS & LIFESTYLE CHANGES
Style: MedConsolidate patient-education PDF
EAT MORE / REDUCE column style
══════════════════════════════════════════════════════════

Generate practical, condition-specific lifestyle guidance.
Every item must connect to a documented condition or abnormal signal.

Return ONLY valid JSON:
{{
  "section_05_lifestyle": {{
    "section_intro": "One warm sentence introducing this section.",

    "no_conditions_documented": false,
    "conditions_assessed_count": 0,

    "what_to_eat": {{
      "intro": "One sentence on why diet matters specifically for this patient.",

      "eat_more": [
        {{
          "food_item": "e.g. Brown rice, oats, whole wheat",
          "plain_why": "e.g. Slow to digest, keeps blood sugar stable",
          "related_conditions": ["e.g. Type 2 Diabetes"],
          "priority": "Essential|Recommended|Helpful"
        }}
      ],

      "reduce_or_avoid": [
        {{
          "food_item": "e.g. White rice in large portions, white flour, biscuits",
          "plain_why": "e.g. Digests quickly and causes blood sugar spikes",
          "related_conditions": ["e.g. Type 2 Diabetes"],
          "avoid_level": "Avoid completely|Reduce significantly|Limit intake"
        }}
      ],

      "dietary_conflicts": [
        {{
          "conflict_description": "e.g. High potassium foods are good for blood pressure but restricted in kidney disease",
          "resolution": "Plain guidance on how to navigate this conflict",
          "conditions_involved": ["e.g. Hypertension", "CKD"]
        }}
      ]
    }},

    "physical_activity": {{
      "intro": "One sentence on why physical activity matters for this patient.",

      "activity_plan": [
        {{
          "step": 1,
          "activity": "e.g. Start with 30 minutes of brisk walking daily",
          "frequency": "e.g. Daily",
          "plain_benefit": "e.g. This alone significantly lowers blood sugar and blood pressure",
          "related_conditions": ["..."],
          "caution": "e.g. Get specialist clearance before starting if you have a heart condition. null if no caution needed."
        }}
      ],

      "activities_to_avoid": [
        {{
          "activity": "e.g. Heavy weightlifting without clearance",
          "reason_plain": "Plain reason related to this patient's conditions",
          "related_condition": "Condition name"
        }}
      ]
    }},

    "habits": {{
      "build_these": [
        {{
          "habit": "e.g. Sleep 7–8 hours nightly",
          "plain_why": "e.g. Poor sleep raises blood sugar by 15–20% and increases blood pressure",
          "related_conditions": ["..."],
          "how_to_start": "One practical tip on how to build this habit."
        }}
      ],

      "stop_these": [
        {{
          "habit": "e.g. Smoking",
          "plain_why": "e.g. Every cigarette raises blood pressure for 30+ minutes and damages the kidneys",
          "related_conditions": ["..."],
          "urgency": "Stop immediately|Reduce and plan to stop|Be mindful of"
        }}
      ]
    }},

    "organ_specific_notes": [
      {{
        "organ": "e.g. Kidneys",
        "dietary_note_plain": "One plain sentence on organ-specific dietary consideration",
        "related_condition": "Condition name"
      }}
    ],

    "motivational_note": "Two to three warm, encouraging sentences. Acknowledge that managing multiple conditions is hard. Emphasise that small consistent changes make a real difference.",

    "disclaimer": "The dietary and lifestyle information in this report is based on your documented medical conditions and is for guidance only. Discuss any major dietary changes with your doctor or a registered dietitian before making them.",
    "section_05_summary": "One sentence summarising the single most important lifestyle change for this patient."
  }}
}}
"""
        result = await self._invoke(system, prompt)

        if isinstance(result, dict) and "raw_output" in result:
            raw = result["raw_output"]
            try:
                result = json.loads(raw)
            except Exception:
                result = {
                    "section_05_lifestyle": {
                        "no_conditions_documented": True,
                        "conditions_assessed_count": 0,
                        "what_to_eat": {"eat_more": [], "reduce_or_avoid": [], "dietary_conflicts": []},
                        "physical_activity": {"activity_plan": [], "activities_to_avoid": []},
                        "habits": {"build_these": [], "stop_these": []},
                        "organ_specific_notes": [],
                        "motivational_note": "Lifestyle guidance could not be generated. Please speak to your care team.",
                        "disclaimer": "Please consult your doctor or a registered dietitian.",
                        "section_05_summary": "Unable to generate guidance.",
                    }
                }

        state["dietary_guidance"] = result
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · DietaryGuidanceAgent — DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# B14 · ORGAN EFFECT ANALYSIS AGENT
# Produces organ health registry, effect chains, and patient overview.
# Works directly from compressed_context.
# ============================================================

class OrganEffectAnalysisAgent(BaseAgent):
    agent_id = "B14"

    BURDEN_INFERENCE: Dict[str, str] = {
        "liver":        ["fatty", "hepatic", "steatosis", "cirrhosis", "hepatitis"],
        "kidney":       ["renal", "calculi", "kidney", "nephro", "ckd", "creatinine", "egfr"],
        "bladder":      ["bladder", "urothelial", "transitional", "urine", "urinary"],
        "heart":        ["cardiac", "heart", "coronary", "myocardial", "atrial", "ventricular"],
        "prostate":     ["prostate", "psa"],
        "lung":         ["pulmonary", "lung", "respiratory", "pleural"],
        "pancreas":     ["pancreatic", "diabetes", "insulin", "glucose", "hba1c"],
        "thyroid":      ["thyroid", "tsh", "t3", "t4", "hypothyroid", "hyperthyroid"],
        "bone":         ["bone", "osteo", "fracture", "spine", "vertebral"],
        "blood":        ["anaemia", "hemoglobin", "haemoglobin", "wbc", "platelet", "haematological"],
    }

    def _infer_organ_signals(self, ctx: CompressedContext) -> List[Dict]:
        """
        Infer which organs have abnormal signals from compressed markdown context.
        Returns a list of {organ, entity_name, entity_type, evidence, document, date} dicts.
        """
        all_text = (
            ctx["md_diagnoses"] + ctx["md_findings"] + ctx["md_labs"] +
            ctx["md_vitals"] + ctx["md_symptoms"] + ctx["md_measurements"] +
            ctx["md_procedures"] + ctx["md_anatomy"]
        ).lower()

        organ_hits: Dict[str, List[str]] = {}
        for organ, keywords in self.BURDEN_INFERENCE.items():
            hits = [kw for kw in keywords if kw in all_text]
            if hits:
                organ_hits[organ] = hits

        organ_signals = []
        for signal in ctx["abnormal_signals"]:
            sig_name = (signal.get("name") or "").lower()
            sig_evid = (signal.get("evidence") or "").lower()
            combined = sig_name + " " + sig_evid
            for organ, keywords in self.BURDEN_INFERENCE.items():
                if any(kw in combined for kw in keywords):
                    organ_signals.append({
                        "organ": organ,
                        "entity_name": signal.get("name", "?"),
                        "entity_type": signal.get("entity_type", "?"),
                        "evidence": signal.get("evidence", ""),
                        "document": signal.get("document", "?"),
                        "date": signal.get("date", "?"),
                        "abnormal_reason": signal.get("abnormal_reason", ""),
                    })

        return organ_signals

    async def run(self, state: PredictiveState) -> PredictiveState:
        logger.info(f"{self.agent_id} · OrganEffectAnalysisAgent — START")
        t0 = datetime.now().timestamp()

        patient_dob  = state.get("dob",  "Not documented")
        patient_sex  = state.get("sex",  "Not documented")
        primary_spec = state.get("primary_specialty") or "Not specified"
        ctx          = self._get_ctx(state)

        organ_signals = self._infer_organ_signals(ctx)
        dx_json       = json.dumps(ctx["confirmed_diagnoses"], indent=2, default=str)
        abnormal_json = json.dumps(ctx["abnormal_signals"][:50], indent=2, default=str)

        system = (
            "You are a multi-organ pathophysiology specialist. "
            "Identify organ-level health status, inter-organ effect chains, and a patient-friendly "
            "organ health overview directly from the provided clinical data. "
            "Use ONLY data explicitly present in the clinical records. "
            "No treatment recommendations. Plain language in patient-facing sections. "
            "Return valid JSON only."
        )

        prompt = f"""
PATIENT: DOB={patient_dob} | Sex={patient_sex} | Specialty={primary_spec}

CONFIRMED DIAGNOSES:
{dx_json}

ABNORMAL SIGNALS (top 50):
{abnormal_json}

COMPRESSED DIAGNOSES:
{ctx['md_diagnoses']}

COMPRESSED FINDINGS:
{ctx['md_findings']}

COMPRESSED LABS:
{ctx['md_labs']}

COMPRESSED VITALS:
{ctx['md_vitals']}

COMPRESSED ANATOMY:
{ctx['md_anatomy']}

COMPRESSED MEASUREMENTS:
{ctx['md_measurements']}

INFERRED ORGAN SIGNALS (pre-processed):
{json.dumps(organ_signals, indent=2, default=str)}

══════════════════════════════════════════════════════════
TASK — ORGAN HEALTH ANALYSIS
Produce: organ health registry, effect chains, patient overview
══════════════════════════════════════════════════════════

HEALTH SCORE SCALE (0–100):
  85–100: Healthy — no abnormal signals
  65–84:  Mild concern — early or minor abnormality
  45–64:  Moderate concern — clear abnormality documented
  25–44:  High concern — serious pathology documented
  0–24:   Critical — life-threatening condition documented

BURDEN LEVELS:
  NONE | SUBCLINICAL | MILD | MODERATE | SEVERE | CRITICAL | CONFIRMED_DISEASE

BURDEN TRENDS:
  INCREASING | STABLE | DECREASING | SINGLE_POINT | UNKNOWN

Return ONLY valid JSON:
{{
  "organ_health_registry": [
    {{
      "organ": "e.g. Bladder",
      "health_score": 0,
      "health_label": "Healthy|Mild concern|Moderate concern|High concern|Critical",
      "burden_level": "NONE|SUBCLINICAL|MILD|MODERATE|SEVERE|CRITICAL|CONFIRMED_DISEASE",
      "burden_trend": "INCREASING|STABLE|DECREASING|SINGLE_POINT|UNKNOWN",
      "confirmation_status": "CONFIRMED — Documented Diagnosis|Subclinical signal|Not documented",
      "supporting_graph_entities": [
        {{
          "entity_name": "...",
          "entity_type": "...",
          "value": "...",
          "date": "...",
          "document": "...",
          "evidence_text": "...",
          "entity_contribution": "Why this entity affects this organ's health score"
        }}
      ],
      "organ_health_note": "One sentence on the clinical significance of this organ's status."
    }}
  ],

  "organ_effect_chains": [
    {{
      "source_organ": "e.g. Liver",
      "target_organ": "e.g. Kidney",
      "direction": "->",
      "effect_type": "causal|associated|shared_aetiology|mechanistic",
      "effect_strength": "Strong|Moderate|Weak",
      "effect_description": "Plain English: how does the source organ's condition affect the target organ?",
      "graph_evidence": {{
        "source_entity": "...",
        "target_entity": "...",
        "document": "...",
        "date": "..."
      }},
      "clinical_significance": "High|Moderate|Low"
    }}
  ],

  "organ_relationship_matrix": {{
    "nodes": [
      {{
        "id": "e.g. bladder",
        "label": "Bladder",
        "health_score": 0,
        "health_label": "...",
        "has_confirmed_disease": false
      }}
    ],
    "edges": [
      {{
        "source": "e.g. liver",
        "target": "e.g. kidney",
        "direction": "->",
        "effect_strength": "Strong|Moderate|Weak",
        "effect_type": "...",
        "label": "e.g. Fatty liver raises renal filtration burden"
      }}
    ]
  }},

  "organ_effect_chain_narratives": [
    {{
      "starting_organ": "...",
      "chain_steps": [
        {{
          "step": 1,
          "organ": "...",
          "condition": "...",
          "effect_on_next": "Plain English: what effect does this have on the next organ?",
          "graph_entity": "...",
          "document": "..."
        }}
      ],
      "final_impact": "Plain English: what is the ultimate health consequence of this chain?",
      "chain_severity": "Critical|High|Moderate|Low"
    }}
  ],

  "patient_organ_health_overview": [
    {{
      "organ_plain_name": "e.g. Bladder",
      "organ_medical_name": "e.g. Urinary Bladder",
      "health_status_plain": "e.g. Needs immediate attention",
      "health_score": 0,
      "what_was_found_plain": "Plain English: what was found in the records about this organ.",
      "why_it_matters_plain": "Plain English: why does this finding matter for the patient's health.",
      "source_document_plain": "Document name in plain language",
      "concern_level_plain": "e.g. Serious concern",
      "connected_organs_plain": "e.g. This condition also affects your kidneys"
    }}
  ],

  "overall_organ_health": {{
    "overall_organ_health_score": 0,
    "most_affected_organ": "...",
    "most_affected_score": 0,
    "least_affected_organ": "...",
    "least_affected_score": 0,
    "organ_health_trend": "DETERIORATING|STABLE|IMPROVING|MIXED|INSUFFICIENT_DATA",
    "total_organs_assessed": 0,
    "organs_with_confirmed_disease": 0,
    "organs_with_subclinical_signals": 0,
    "organs_healthy": 0,
    "multi_organ_involvement": false,
    "organ_health_summary": "Two to three plain sentences summarising the overall organ health picture."
  }},

  "organ_analysis_disclaimer": "This organ health analysis is derived from documented findings only. Health scores are approximate indicators and require physician interpretation."
}}
"""
        raw_result = await self._invoke(system, prompt)
        raw_result["inferred_organ_signals"] = organ_signals
        state["organ_effect_analysis"] = raw_result
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · OrganEffectAnalysisAgent — DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# PARALLEL RUNNER — B13 + B14
# ============================================================

async def run_b13_b14_parallel(state: PredictiveState) -> PredictiveState:
    logger.info("Extended patient layer (B13 + B14) — START")
    t0 = datetime.now().timestamp()
    results = await asyncio.gather(
        DietaryGuidanceAgent(llm_synthesis).run(dict(state)),
        OrganEffectAnalysisAgent(llm_synthesis).run(dict(state)),
        return_exceptions=True,
    )
    for i, result in enumerate(results):
        name = "B13" if i == 0 else "B14"
        key  = "dietary_guidance" if i == 0 else "organ_effect_analysis"
        if isinstance(result, Exception):
            logger.error(f"{name} failed: {result}")
            state["errors"].append(f"{name}: {str(result)}")
            state[key] = {"error": str(result)}
        else:
            state["agent_timings"].update(result.get("agent_timings", {}))
            state[key] = result.get(key)
    logger.info(f"Extended patient layer (B13 + B14) — DONE ({round((datetime.now().timestamp()-t0)*1000,1)}ms)")
    return state


# ============================================================
# WORKFLOW GRAPH  (v4.0: streamlined pipeline)
# B_QRISK3 → B10 → B12_CONSULT → B13+B14
# ============================================================

def create_pdgi_workflow() -> Any:
    workflow = StateGraph(PredictiveState)

    workflow.add_node("B_QRISK3",           QRISK3Agent(llm_synthesis).run)
    workflow.add_node("B10",                PredictiveNarrativeAgent(llm_synthesis).run)
    workflow.add_node("B12_CONSULT",        run_b12_then_consult)
    workflow.add_node("B13_B14_PARALLEL",   run_b13_b14_parallel)

    workflow.set_entry_point("B_QRISK3")
    workflow.add_edge("B_QRISK3",          "B10")
    workflow.add_edge("B10",               "B12_CONSULT")
    workflow.add_edge("B12_CONSULT",       "B13_B14_PARALLEL")
    workflow.add_edge("B13_B14_PARALLEL",  END)

    return workflow.compile()


pdgi_workflow = create_pdgi_workflow()


# ============================================================
# INITIAL STATE FACTORY
# ============================================================

def build_predictive_state(request, graph_docs, compressed_context=None, dob=None, sex=None):
    return PredictiveState(
        patient_id=request.patient_id, doctor_id=request.doctor_id,
        primary_specialty=request.primary_specialty,
        graph_documents=graph_docs, compressed_context=compressed_context,
        dob=dob, sex=sex,
        qrisk3_assessment=None,
        predictive_report=None,
        patient_understanding=None,
        consultant_map=None,
        dietary_guidance=None,
        organ_effect_analysis=None,
        errors=[], agent_timings={},
    )


# ============================================================
# DEMO DATA LOADER
# ============================================================

def load_demo_typed_data() -> Dict[str, List[Dict]]:
    return {
        "diagnoses": [{
            "name": "Transitional cell carcinoma grade 3 infiltrating muscle bundles",
            "value": None, "unit": None, "raw_date": "2026-01-06",
            "document": "838ef95e-9be8-42ea-8bcd-d178eb57e3d6.pdf",
            "evidence": "Transitional cell carcinoma grade 3 infiltrating muscle bundles.",
            "grade": "3", "stage": None, "histology": "Transitional cell carcinoma", "is_abnormal": True,
        }],
        "findings": [
            {"name": "Grade I-II fatty changes in liver", "value": None, "unit": None,
             "raw_date": "2025-10-01", "document": "a4ef1484-4b58-415d-a7b2-9653981b8e05.pdf",
             "evidence": "Grade I-II fatty changes in liver.", "is_abnormal": True},
            {"name": "Bilateral small renal calculi", "value": None, "unit": None,
             "raw_date": "2025-10-01", "document": "a4ef1484-4b58-415d-a7b2-9653981b8e05.pdf",
             "evidence": "Bilateral small renal calculi.", "is_abnormal": True},
            {"name": "Mild diffuse urinary bladder wall thickening", "value": None, "unit": None,
             "raw_date": "2025-10-01", "document": "a4ef1484-4b58-415d-a7b2-9653981b8e05.pdf",
             "evidence": "Mild diffuse urinary bladder wall thickening with peri-vesical fat stranding.", "is_abnormal": True},
            {"name": "Von Brunn's nests", "value": None, "unit": None,
             "raw_date": "2026-01-06", "document": "838ef95e-9be8-42ea-8bcd-d178eb57e3d6.pdf",
             "evidence": "Lamina propria shows multiple Von Brunn's nests.", "is_abnormal": True},
        ],
        "procedures": [
            {"name": "Sonography of abdomen and pelvis", "raw_date": "2025-10-01",
             "document": "a4ef1484-4b58-415d-a7b2-9653981b8e05.pdf",
             "evidence": "Sonography of abdomen and pelvis."},
            {"name": "Histopathological examination (TURBT specimen)", "raw_date": "2026-01-06",
             "document": "838ef95e-9be8-42ea-8bcd-d178eb57e3d6.pdf",
             "evidence": "Bulk + Deep resection + Random biopsy specimens analyzed."},
        ],
        "measurements": [{"name": "Bulk specimen size", "value": "6x3.8x1.5", "unit": "cm",
                          "raw_date": "2026-01-06", "document": "838ef95e-9be8-42ea-8bcd-d178eb57e3d6.pdf",
                          "evidence": "Multiple fragments measuring 6x3.8x1.5 cms."}],
        "symptoms": [{"name": "Hematuria", "raw_date": "2025-10-01",
                      "document": "a4ef1484-4b58-415d-a7b2-9653981b8e05.pdf",
                      "evidence": "Clinical details: Hematuria.", "is_abnormal": True}],
        "lab_results": [], "vital_signs": [], "medications": [], "anatomy": [],
    }


def load_demo_graph_documents() -> List[Dict]:
    return [
        {"document": "a4ef1484-4b58-415d-a7b2-9653981b8e05.pdf", "document_date": "2025-10-01",
         "entities": [
             {"relation": "HAS_SYMPTOM", "entity_type": "Symptom", "name": "Hematuria",
              "date": "2025-10-01", "evidence": "Clinical details: Hematuria."},
             {"relation": "HAS_FINDING", "entity_type": "Finding", "name": "Grade I-II fatty changes in liver",
              "date": "2025-10-01", "evidence": "Grade I-II fatty changes in liver."},
             {"relation": "HAS_FINDING", "entity_type": "Finding", "name": "Bilateral small renal calculi",
              "date": "2025-10-01", "evidence": "Bilateral small renal calculi."},
             {"relation": "HAS_FINDING", "entity_type": "Finding", "name": "Mild diffuse urinary bladder wall thickening",
              "date": "2025-10-01", "evidence": "Mild diffuse urinary bladder wall thickening."},
             {"relation": "HAS_PROCEDURE", "entity_type": "Procedure", "name": "Sonography",
              "date": "2025-10-01", "evidence": "Sonography of abdomen and pelvis."},
         ]},
        {"document": "838ef95e-9be8-42ea-8bcd-d178eb57e3d6.pdf", "document_date": "2026-01-06",
         "entities": [
             {"relation": "HAS_PROCEDURE", "entity_type": "Procedure", "name": "Histopathological examination (TURBT)",
              "date": "2026-01-06", "evidence": "Bulk + Deep resection + Random biopsy."},
             {"relation": "HAS_DIAGNOSIS", "entity_type": "Diagnosis", "name": "Transitional cell carcinoma grade 3 infiltrating muscle bundles",
              "date": "2026-01-06", "evidence": "Transitional cell carcinoma grade 3 infiltrating muscle bundles."},
             {"relation": "HAS_FINDING", "entity_type": "Finding", "name": "Von Brunn's nests",
              "date": "2026-01-06", "evidence": "Lamina propria shows multiple Von Brunn's nests."},
             {"relation": "HAS_MEASUREMENT", "entity_type": "Measurement", "name": "6x3.8x1.5 cm (bulk specimen)",
              "date": "2026-01-06", "evidence": "Multiple fragments measuring 6x3.8x1.5 cms."},
         ]},
    ]


# ============================================================
# API ENDPOINTS
# ============================================================

@router.post("/predictive-disease-intelligence")
async def run_predictive_intelligence(request: PredictiveRequest):
    """
    PDGI v4.0 — Streamlined Patient-Education Pipeline.

    Pipeline:
      Phase 0A: EntityTypedGraphFetcher  — 9 typed Cypher queries in parallel
      Phase 0B: LLMAbnormalityAssessor   — LLM annotates each entity type (9 parallel calls)
      Phase 0C: GraphPreprocessor        — abnormal markdown compression
      B_QRISK3: QRISK3 CVD/stroke risk score
      B10:      Section 02 — What to Watch For (risks & predictions)
      B12:      Section 01 — Your Current Health + Section 03 — Monitoring Checklist
      B_CONSULT:Section 04 — Who You Should Consult
      B13+B14:  Section 05 — Diet & Lifestyle (parallel) + Organ Analysis (parallel)

    Removed agents: B0 (GraphAnchor), B1 (Trajectory), B2 (OrganBurden),
                    B3 (ComorbidityWeb), B4 (RiskModifier), B5-B8 (Specialty Risks),
                    B9 (RiskSynthesis), B11 (PredictionAudit)

    Response includes top-level key: patient_education (Sections 01–05)
    """
    start_ms = datetime.now().timestamp() * 1000
    logger.info(f"PDGI v4.0 | patient={request.patient_id} | doctor={request.doctor_id} | specialty={request.primary_specialty or 'None'}")

    assessor      = LLMAbnormalityAssessor(llm_abnormality)
    preprocessor  = GraphPreprocessor()
    typed_fetcher = EntityTypedGraphFetcher()

    try:
        # ── Phase 0A ──────────────────────────────────────────────
        typed_data: Dict[str, List[Dict]] = {}
        graph_docs: List[Dict] = []
        fetch_error = None

        try:
            typed_data, graph_docs = await asyncio.gather(
                typed_fetcher.fetch_all(request.patient_id),
                fetch_patient_graph_documents(request.patient_id),
            )
        except Exception as neo4j_err:
            logger.warning(f"Neo4j unavailable ({neo4j_err}), using demo data")
            typed_data = load_demo_typed_data()
            graph_docs = load_demo_graph_documents()
            fetch_error = str(neo4j_err)

        if not graph_docs and not any(typed_data.values()):
            raise HTTPException(status_code=404, detail=f"No clinical graph data found for patient {request.patient_id}")

        # ── Phase 0B ──────────────────────────────────────────────
        assessment_start = datetime.now().timestamp()
        await assessor.assess_all(typed_data)
        assessment_ms = round((datetime.now().timestamp() - assessment_start) * 1000, 1)

        # ── Phase 0C ──────────────────────────────────────────────
        compressed_context = preprocessor.compress(typed_data, graph_docs)
        logger.info(f"Compression: entities={compressed_context['total_entities']} | abnormal={compressed_context['abnormal_entity_count']} | ~{compressed_context['token_estimate']} tokens")

        demographics = await fetch_patient_demographics(request.patient_id)
        initial_state = build_predictive_state(
            request, graph_docs, compressed_context=compressed_context,
            dob=demographics.get("dob"), sex=demographics.get("sex"),
        )

        result = await pdgi_workflow.ainvoke(initial_state)
        elapsed = round(datetime.now().timestamp() * 1000 - start_ms)

        # ── Persist ───────────────────────────────────────────────
        try:
            await prediction_store.insert_one({
                "patient_id": request.patient_id, "doctor_id": request.doctor_id,
                "generated_at": datetime.utcnow(), "documents_analyzed": len(graph_docs),
                "processing_time_ms": elapsed, "version": "4.0.0",
                **{k: v for k, v in result.items() if k not in ("compressed_context", "graph_documents")},
            })
        except Exception as e:
            logger.error(f"MongoDB save failed: {e}")

        # ── Unpack result keys ────────────────────────────────────
        predictive_report     = result.get("predictive_report",     {})
        qrisk3_assessment     = result.get("qrisk3_assessment",     {})
        patient_understanding = result.get("patient_understanding", {})
        consultant_map        = result.get("consultant_map",        {})
        dietary_guidance      = result.get("dietary_guidance",      {})
        organ_effect_analysis = result.get("organ_effect_analysis", {})

        entity_abnormality_stats = {}
        for etype, rows in typed_data.items():
            total  = len(rows)
            ab_cnt = sum(1 for r in rows if r.get("_llm_is_abnormal", False))
            entity_abnormality_stats[etype] = {
                "total": total, "abnormal": ab_cnt,
                "normal": total - ab_cnt, "assessed_by": "llm"
            }

        # ── Patient Education aggregate (Sections 01–05) ─────────
        patient_education = {
            "version":   "4.0.0",
            "style":     "MedConsolidate patient-education",
            "generated": datetime.now().isoformat(),

            # Section 01 — Your Current Health
            "section_01_your_current_health": patient_understanding.get("section_01_your_current_health", {}),

            # Section 02 — What to Watch For (risks & predictions)
            "section_02_what_to_watch_for": predictive_report.get("section_02_what_to_watch_for", {}),

            # Section 03 — Your Monitoring Checklist
            "section_03_monitoring_checklist": patient_understanding.get("section_03_monitoring_checklist", {}),

            # Section 04 — Who You Should Consult
            "section_04_who_to_consult": consultant_map.get("section_04_who_to_consult", {}),

            # Section 05 — Diet, Habits & Lifestyle
            "section_05_lifestyle": dietary_guidance.get("section_05_lifestyle", {}),

            # Cross-section helpers
            "patient_summary_headline": patient_understanding.get("patient_summary_headline", ""),
            "executive_summary":        predictive_report.get("executive_summary", ""),
            "disclaimer":               patient_understanding.get("section_disclaimer", ""),
        }

        response: Dict[str, Any] = {
            "patient_id":         request.patient_id,
            "doctor_id":          request.doctor_id,
            "generated_at":       datetime.now().isoformat(),
            "documents_analyzed": len(graph_docs),
            "processing_time_ms": elapsed,
            "primary_specialty":  request.primary_specialty or "Not specified",
            "version":            "4.0.0",
            "agent_timings":      result.get("agent_timings", {}),
            "errors":             result.get("errors", []),

            # ── v4.0 PRIMARY OUTPUT ──────────────────────────────
            # patient_education contains all 5 patient-facing sections
            "patient_education": patient_education,

            # ── Confirmed diagnoses (quick access) ───────────────
            "confirmed_diagnoses": predictive_report.get("confirmed_diagnoses_list", []),

            # ── Abnormal signals summary ─────────────────────────
            "abnormal_signals_summary": predictive_report.get("abnormal_signals_summary", []),

            # ── Executive summary ─────────────────────────────────
            "executive_summary": predictive_report.get("executive_summary", ""),
            "disclaimer":        predictive_report.get("disclaimer", ""),

            # ── QRISK3 ────────────────────────────────────────────
            "qrisk3": {
                "score_percent":               qrisk3_assessment.get("score_percent"),
                "risk_category":               qrisk3_assessment.get("risk_category"),
                "interpretation":              qrisk3_assessment.get("interpretation"),
                "confidence":                  qrisk3_assessment.get("confidence"),
                "sex_used":                    qrisk3_assessment.get("sex_used"),
                "age_used":                    qrisk3_assessment.get("age_used"),
                "key_variables_present":       qrisk3_assessment.get("key_variables_present"),
                "key_variables_total":         qrisk3_assessment.get("key_variables_total"),
                "variables_used":              qrisk3_assessment.get("variables_used",         []),
                "missing_variables":           qrisk3_assessment.get("missing_variables",      []),
                "assumed_defaults":            qrisk3_assessment.get("assumed_defaults",       []),
                "variables_present_in_graph":  qrisk3_assessment.get("variables_present_in_graph",  []),
                "variables_absent_from_graph": qrisk3_assessment.get("variables_absent_from_graph", []),
                "data_completeness_note":      qrisk3_assessment.get("data_completeness_note", ""),
                "caveats":                     qrisk3_assessment.get("caveats",                []),
                "error":                       qrisk3_assessment.get("error"),
                "reference":                   "Hippisley-Cox J, Coupland C, Brindle P. BMJ 2017;357:j2099",
                "algorithm_note":              "QRISK3 — Simplified approximation (linearised age/BMI polynomials)",
            },

            # ── Organ effect analysis ────────────────────────────
            "organ_effect_analysis": {
                "organ_health_registry":         organ_effect_analysis.get("organ_health_registry",        []),
                "inferred_organ_signals":        organ_effect_analysis.get("inferred_organ_signals",       []),
                "organ_effect_chains":           organ_effect_analysis.get("organ_effect_chains",          []),
                "organ_relationship_matrix":     organ_effect_analysis.get("organ_relationship_matrix",    {"nodes": [], "edges": []}),
                "organ_effect_chain_narratives": organ_effect_analysis.get("organ_effect_chain_narratives",[]),
                "patient_organ_health_overview": organ_effect_analysis.get("patient_organ_health_overview",[]),
                "overall_organ_health":          organ_effect_analysis.get("overall_organ_health",         {}),
                "organ_analysis_disclaimer":     organ_effect_analysis.get("organ_analysis_disclaimer",    ""),
                "error":                         organ_effect_analysis.get("error"),
            },

            # ── Raw outputs (for debugging) ──────────────────────
            "patient_understanding_raw": patient_understanding,
            "consultant_map_raw":        consultant_map,
            "dietary_guidance_raw":      dietary_guidance,

            # ── Token / data stats ───────────────────────────────
            "token_stats": {
                "total_entities":            compressed_context["total_entities"],
                "abnormal_entities":         compressed_context["abnormal_entity_count"],
                "compressed_token_est":      compressed_context["token_estimate"],
                "date_range":                compressed_context["date_range"],
                "abnormality_assessment_ms": assessment_ms,
                "abnormality_method":        "llm",
                "entity_type_stats":         entity_abnormality_stats,
                "fetch_error":               fetch_error,
            },
        }

        if request.include_intermediates:
            response["intermediate"] = {
                "typed_entity_counts": {k: len(v) for k, v in typed_data.items()},
                "entity_abnormality_stats": entity_abnormality_stats,
                "llm_abnormality_annotations": {
                    etype: [
                        {"name": r.get("name", "?"), "is_abnormal": r.get("_llm_is_abnormal"), "reason": r.get("_llm_abnormal_reason")}
                        for r in rows
                    ]
                    for etype, rows in typed_data.items()
                },
                "qrisk3_assessment":     result.get("qrisk3_assessment"),
                "predictive_report":     result.get("predictive_report"),
                "patient_understanding": result.get("patient_understanding"),
                "consultant_map":        result.get("consultant_map"),
                "dietary_guidance":      result.get("dietary_guidance"),
                "organ_effect_analysis": result.get("organ_effect_analysis"),
                "compressed_md_diagnoses": compressed_context["md_diagnoses"],
                "compressed_md_labs":      compressed_context["md_labs"],
                "compressed_md_findings":  compressed_context["md_findings"],
                "compressed_md_timeline":  compressed_context["md_timeline"],
            }

        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"PDGI v4.0 pipeline failed | patient={request.patient_id} | {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/predictive-disease-intelligence/demo")
async def run_predictive_demo():
    demo_request = PredictiveRequest(
        patient_id="PAT-235aeb6f-3c57-48b4-8140-f545c7c52417",
        doctor_id="DOC-dcf818e8-a3e0-427a-b935-98b6f602699c",
        include_intermediates=True,
        primary_specialty="Urology",
    )
    return await run_predictive_intelligence(demo_request)


@router.get("/predictive-disease-intelligence/health")
async def predictive_health():
    return {
        "status":      "ok",
        "version":     "4.0.0",
        "system_name": "PDGI — Predictive Disease Graph Intelligence",
        "agents":      7,
        "pipeline": [
            "Phase 0A — EntityTypedGraphFetcher    [9 typed Cypher queries in parallel]",
            "Phase 0B — LLMAbnormalityAssessor     [LLM assesses each entity type in parallel]",
            "Phase 0C — GraphPreprocessor          [abnormal markdown compression]",
            "B_QRISK3  — QRISK3 CVD/Stroke Risk",
            "B10       — Predictive Narrative       [Section 02: What to Watch For]",
            "B12       — Patient Understanding      [Section 01: Current Health + Section 03: Monitoring]",
            "B_CONSULT — Consultant Map             [Section 04: Who to Consult]",
            "B13       — Dietary Guidance           [Section 05: Diet & Lifestyle; parallel with B14]",
            "B14       — Organ Effect Analysis      [parallel with B13]",
        ],
        "removed_from_v3_4": [
            "B0  GraphAnchorAgent",
            "B1  TrajectoryAgent",
            "B2  OrganBurdenAgent",
            "B3  ComorbidityWebAgent",
            "B4  RiskModifierAgent",
            "B5  CardiometabolicRiskAgent",
            "B6  OncologicRiskAgent",
            "B7  RenalHepaticRiskAgent",
            "B8  MultiSpecialtyRiskAgent",
            "B9  RiskSynthesisAgent",
            "B11 PredictionAuditAgent",
        ],
        "kept_from_v3_4": [
            "Phase 0A EntityTypedGraphFetcher (unchanged)",
            "Phase 0B LLMAbnormalityAssessor (unchanged)",
            "Phase 0C GraphPreprocessor (unchanged)",
            "B_QRISK3 QRISK3Agent (unchanged, explicit keep)",
            "B10 PredictiveNarrativeAgent (prompt rewritten — no B0-B9 deps)",
            "B12 PatientUnderstandingAgent (prompt rewritten — no B0-B9 deps)",
            "B_CONSULT ConsultantMapAgent (prompt rewritten — no B0-B9 deps)",
            "B13 DietaryGuidanceAgent (prompt rewritten — no B0-B9 deps)",
            "B14 OrganEffectAnalysisAgent (prompt rewritten — no B0-B9 deps, added _infer_organ_signals helper)",
        ],
        "key_changes": {
            "all_kept_agents": "All prompts rewritten to use compressed_context directly. No agent depends on B0–B9 output.",
            "B14_change": "Added _infer_organ_signals() keyword-matching helper to infer organ involvement from compressed markdown without B2 organ burden map.",
            "workflow": "Simplified from 13 nodes to 4 nodes (B_QRISK3 → B10 → B12_CONSULT → B13_B14_PARALLEL)",
            "state": "PredictiveState reduced to only keys needed by kept agents",
            "response": "Backward-compatible patient_education key retained; removed specialty_streams and composite_risk_score (were from removed agents)",
        },
        "patient_education_sections": {
            "section_01_your_current_health":   "From B12 — condition cards, medications, lab values",
            "section_02_what_to_watch_for":     "From B10 — short/long-term risks, early warning signs, QRISK3 plain",
            "section_03_monitoring_checklist":  "From B12 — home monitoring + clinical tests",
            "section_04_who_to_consult":        "From B_CONSULT — specialist table with urgency",
            "section_05_lifestyle":             "From B13 — EAT MORE/REDUCE, activity plan, habits",
        },
    }


# ============================================================
# ENTRYPOINT
# ============================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("pdgi_v4_0:app", host="0.0.0.0", port=8001, reload=False, log_level="info")