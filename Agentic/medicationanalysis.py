"""
MedScript — Medication Agentic Workflow
========================================
v4.1.1  |  9-Agent Specialist Entity Assessment Pipe + Dictation-Only Medication Gate
         |  PATCH: hardened dictation-only gate (code-level filter, not prompt-trust)

ARCHITECTURE:
  ┌─────────────────────────────────────────────────────────────────────┐
  │  Phase 0A: EntityTypedGraphFetcher                                  │
  │    → 9 typed Cypher queries in parallel                             │
  │    → fallback to generic query if all return empty                  │
  │                                                                     │
  │  Phase 0B: 9 Specialist Entity Agents (ALL in parallel)             │
  │    ┌──────────────────────────────────────────────────────────┐     │
  │    │  DiagnosisAgent        — every dx is abnormal, classify  │     │
  │    │  LabAbnormalityAgent   — reference range + flag analysis │     │
  │    │  VitalSignAgent        — clinical threshold assessment   │     │
  │    │  MedicationAgent       — drug class severity triage      │     │
  │    │  FindingAgent          — structural/pathological changes │     │
  │    │  ProcedureAgent        — pathological indication check   │     │
  │    │  MeasurementAgent      — tumour size, BMI, organ size    │     │
  │    │  AnatomyAgent          — structural involvement check    │     │
  │    │  SymptomAgent          — all symptoms are significant    │     │
  │    └──────────────────────────────────────────────────────────┘     │
  │    Each agent: annotates _llm_is_abnormal + _llm_abnormal_reason    │
  │    Each agent: runs internal batching (BATCH_SIZE=40)               │
  │    Each agent: neo4j_flag_fallback on LLM failure                   │
  │                                                                     │
  │  Phase 0C: GraphPreprocessor                                        │
  │    → 9 section markdown builders + timeline + entity index          │
  │    → confirmed_diagnoses list + abnormal_signals list               │
  │    → NOTE: this is PATIENT HISTORY data only. Neo4j / graph docs    │
  │      can legitimately be null/empty — that is NOT an error state.  │
  │                                                                     │
  │  A1  MedicationExtractorAgent   — DICTATION-ONLY GATE                │
  │    → Extracts medications ONLY from prescription_text (the doctor's │
  │      dictation). Graph data is NEVER read here, ever.               │
  │    → After the LLM call, a CODE-LEVEL filter strips any blank /     │
  │      placeholder rows the LLM might echo from the JSON schema       │
  │      template (this is the actual bug this patch fixes — see       │
  │      _clean_extracted_prescriptions() below).                      │
  │    → route_after_extraction() inspects the CLEANED result:          │
  │        • 0 real medications in dictation → skip straight to an     │
  │          EMPTY finalizer. A2 / A3 / A4 do NOT run. No safety        │
  │          alerts, no "everything is safe" filler is generated.       │
  │        • ≥1 real medication in dictation  → continue full pipeline  │
  │                                                                     │
  │  A2 + A3  [parallel, only if A1 found medications]                  │
  │    A2  PatientContextAgent        — graph/history safety context    │
  │    A3  DrugDatabaseAgent          — pharmacology resolution         │
  │                                                                     │
  │  A4  SafetyAnalysisAgent          — drug-drug / drug-disease        │
  │      (compares DICTATED medications against graph/history context) │
  │                                                                     │
  │  A5  PrescriptionFinalizerAgent   — enriched structured output      │
  └─────────────────────────────────────────────────────────────────────┘

WORKFLOW GRAPH (v4.1):
  phase_0a → phase_0b_9agents → phase_0c → a1_extract
      ├─[dictation has meds]──→ parallel_a2_a3 → a4_safety → a5_finalizer → END
      └─[dictation has NO meds]─────────────────→ a5_empty_finalizer      → END

DESIGN PRINCIPLES:
  • Medications extracted ONLY from doctor prescription/dictation text — never from graph.
  • Graph/history data (Phase 0A–0C) is used ONLY as PATIENT HISTORY CONTEXT to
    cross-check dictated medications for safety — it is never itself treated as
    a source of medications, and it is allowed to be null/empty.
  • No REAL medication in dictation → no medication in output → NO safety analysis is
    run at all (A2, A3, A4 are skipped entirely, not just "run empty").
  • A code-level filter (not just a prompt instruction) removes blank/placeholder
    prescription rows before the gate decision is made, so a weak/fast LLM echoing
    the JSON template can never falsely open the safety-analysis branch.
  • Every entity type has its own dedicated LLM agent with specialist clinical rules.
  • Zero hallucination: missing values → defined fallbacks, never invented data.
  • Phase 0A/0C identical to PDGI v4.0; Phase 0B expanded to 9 specialist agents.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any, Dict, List, Optional, TypedDict

from fastapi import APIRouter, HTTPException
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorClient
from neo4j import AsyncGraphDatabase
from pydantic import BaseModel

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_groq import ChatGroq
from langgraph.graph import END, StateGraph


# ============================================================
# ENVIRONMENT
# ============================================================

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
NEO4J_URI    = os.getenv("NEO4J_URI",      "bolt://neo4j:7687")
NEO4J_USER   = os.getenv("NEO4J_USER",     "neo4j")
NEO4J_PASS   = os.getenv("NEO4J_PASSWORD", "password")
MONGO_URI    = os.getenv("MONGO_URI")
MONGO_DB     = "doctorassistai"

mongo_client = AsyncIOMotorClient(MONGO_URI)
mongo_db     = mongo_client[MONGO_DB]
med_store    = mongo_db["medication_summaries"]

neo4j_driver = AsyncGraphDatabase.driver(
    NEO4J_URI,
    auth=(NEO4J_USER, NEO4J_PASS),
    max_connection_lifetime=3600,
    max_connection_pool_size=50,
)

# High-quality LLM — safety, education, patient context, drug DB
llm_synthesis = ChatGroq(
    model="llama-3.3-70b-versatile",
    temperature=0.0,
    max_tokens=5000,
    groq_api_key=GROQ_API_KEY,
)

# Fast LLM — all 9 Phase 0B specialist agents + medication extraction
llm_fast = ChatGroq(
    model="llama-3.1-8b-instant",
    temperature=0.0,
    max_tokens=4000,
    groq_api_key=GROQ_API_KEY,
)

router = APIRouter(prefix="", tags=["Medication Agentic Workflow"])


# ============================================================
# REQUEST MODEL
# ============================================================

class MedicationRequest(BaseModel):
    patient_id:            str
    doctor_id:             str
    prescription_text:     str
    include_intermediates: bool = False


# ============================================================
# DATA STRUCTURES
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
# WORKFLOW STATE
# ============================================================

class MedState(TypedDict):
    patient_id:        str
    doctor_id:         str
    prescription_text: str

    dob:               Optional[str]
    sex:               Optional[str]
    demographics_extra: Dict

    typed_data:      Dict[str, List[Dict]]
    graph_documents: List[Dict]

    # Phase 0B agent results (keyed by entity type)
    entity_agent_results: Dict[str, Dict]   # entity_type → agent summary

    compressed_context: Optional[CompressedContext]

    # A1–A5 outputs
    extracted_medications: Optional[Dict]
    patient_context:       Optional[Dict]
    drug_database:         Optional[Dict]
    safety_analysis:       Optional[Dict]
    final_prescription:    Optional[Dict]

    errors:        List[str]
    agent_timings: Dict[str, float]


# ============================================================
# UTILITIES
# ============================================================

def parse_llm_json(text: str) -> Dict:
    if not text:
        return {}
    text = text.strip()
    text = re.sub(r"```json\s*", "", text)
    text = re.sub(r"```\s*",     "", text)
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        text = match.group(0)
    try:
        return json.loads(text)
    except Exception:
        return {"raw_output": text}


def _compute_age(dob: Optional[str]) -> Optional[float]:
    if not dob or not dob.strip():
        return None
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y", "%d-%b-%Y"):
        try:
            birth = datetime.strptime(dob.strip(), fmt)
            return round((datetime.now() - birth).days / 365.25, 1)
        except ValueError:
            continue
    return None


def _neo4j_flag_fallback(row: Dict) -> tuple[bool, Optional[str]]:
    """Universal Neo4j flag fallback — used by all entity agents on LLM failure."""
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


def _row_to_assessment_item(row: Dict, index: int) -> Dict:
    """Serialise a graph row into an LLM-friendly assessment item."""
    return {
        "index":               index,
        "name":                row.get("name", "unknown"),
        "value":               row.get("value"),
        "unit":                row.get("unit"),
        "reference_range":     row.get("reference_range"),
        "evidence":            (row.get("evidence") or "")[:300],
        "status":              row.get("status"),
        "severity":            row.get("severity"),
        "grade":               row.get("grade"),
        "stage":               row.get("stage"),
        "histology":           row.get("histology"),
        "laterality":          row.get("laterality"),
        "drug_class":          row.get("drug_class"),
        "frequency":           row.get("frequency"),
        "specimen_type":       row.get("specimen_type"),
        "neo4j_is_abnormal":   row.get("is_abnormal"),
        "neo4j_abnormal_flag": row.get("abnormal_flag"),
        "document":            row.get("document", "unknown"),
        "date":                row.get("raw_date") or row.get("date"),
    }


class BaseAgent:
    def __init__(self, llm):
        self.llm = llm

    async def _invoke(self, system: str, user: str) -> Dict:
        response = await self.llm.ainvoke(
            [SystemMessage(content=system), HumanMessage(content=user)]
        )
        return parse_llm_json(response.content)

    def _elapsed(self, start: float) -> float:
        return round((datetime.now().timestamp() - start) * 1000, 1)

    def _get_ctx(self, state: MedState) -> CompressedContext:
        return state.get("compressed_context") or CompressedContext(
            confirmed_diagnoses=[], abnormal_signals=[],
            md_diagnoses="", md_labs="", md_vitals="", md_medications="",
            md_findings="", md_procedures="", md_measurements="",
            md_anatomy="", md_symptoms="", md_timeline="",
            entity_index={},
            total_documents=0, total_entities=0, abnormal_entity_count=0,
            date_range={}, token_estimate=0,
        )

    def _build_clinical_context(
        self,
        ctx: CompressedContext,
        sections: Optional[List[str]] = None,
    ) -> str:
        section_map = {
            "diagnoses":    ctx["md_diagnoses"],
            "labs":         ctx["md_labs"],
            "vitals":       ctx["md_vitals"],
            "medications":  ctx["md_medications"],
            "findings":     ctx["md_findings"],
            "procedures":   ctx["md_procedures"],
            "measurements": ctx["md_measurements"],
            "anatomy":      ctx["md_anatomy"],
            "symptoms":     ctx["md_symptoms"],
            "timeline":     ctx["md_timeline"],
        }
        if sections is None:
            sections = list(section_map.keys())
        parts = [
            f"**PATIENT CLINICAL DATA** "
            f"(docs: {ctx['total_documents']} | entities: {ctx['total_entities']} | "
            f"abnormal: {ctx['abnormal_entity_count']} | "
            f"date range: {ctx['date_range'].get('earliest','?')} → "
            f"{ctx['date_range'].get('latest','?')})**\n"
        ]
        for key in sections:
            if key in section_map and section_map[key]:
                parts.append(section_map[key])
        return "\n\n".join(parts)


# ============================================================
# DEMOGRAPHICS
# ============================================================

async def fetch_patient_demographics(patient_id: str) -> Dict:
    try:
        patient = await mongo_db["patient_users"].find_one(
            {"sys_user_id": patient_id},
            {"_id": 0, "date_of_birth": 1, "gender": 1,
             "weight_kg": 1, "height_cm": 1, "allergies": 1},
        )
        if not patient:
            return {}
        return {
            "dob":       patient.get("date_of_birth"),
            "sex":       patient.get("gender"),
            "weight_kg": patient.get("weight_kg"),
            "height_cm": patient.get("height_cm"),
            "allergies": patient.get("allergies", []),
        }
    except Exception:
        logger.exception(f"Demographics fetch failed: {patient_id}")
        return {}


# ============================================================
# PHASE 0A: ENTITY-TYPED GRAPH FETCHER
# 9 typed Cypher queries in parallel + generic fallback.
# ============================================================

class EntityTypedGraphFetcher:
    """
    Runs 9 typed Cypher queries in parallel.
    Falls back to a single generic query if all typed queries return empty.
    """

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
                 n.test_name, n.vital_type, n.value)      AS name,
        coalesce(n.value, n.result)                        AS value,
        coalesce(n.unit, n.units)                          AS unit,
        coalesce(e.document_date, n.date)                  AS raw_date,
        coalesce(e.document_name, 'unknown')               AS document,
        e.evidence_text                                    AS evidence,
        n.reference_range                                  AS reference_range,
        n.is_abnormal                                      AS is_abnormal,
        n.abnormal_flag                                    AS abnormal_flag,
        n.severity                                         AS severity,
        n.status                                           AS status,
        n.grade                                            AS grade,
        n.stage                                            AS stage
    ORDER BY raw_date ASC
    """

    def _build_typed_query(self, rel_types: List[str], node_label: str) -> str:
        rel_pattern = "|".join(rel_types)
        return f"""
        MATCH (p:Patient {{patient_id: $patient_id}})-[r:{rel_pattern}]->(n:{node_label})
        OPTIONAL MATCH (n)-[:SUPPORTED_BY_EVIDENCE]->(e:Evidence)
        RETURN
            type(r)                                             AS relation,
            '{node_label}'                                      AS entity_type,
            coalesce(n.name, n.details, n.description,
                     n.drug_name, n.test_name, n.vital_type,
                     n.value, n.finding_text, toString(id(n))) AS name,
            coalesce(n.value, n.result, n.amount, n.dose)      AS value,
            coalesce(n.unit, n.units)                          AS unit,
            coalesce(e.document_date, n.date)                  AS raw_date,
            coalesce(e.document_name, n.source_document,
                     'unknown')                                AS document,
            e.evidence_text                                    AS evidence,
            n.reference_range                                  AS reference_range,
            n.is_abnormal                                      AS is_abnormal,
            n.abnormal_flag                                    AS abnormal_flag,
            n.severity                                         AS severity,
            n.status                                           AS status,
            n.laterality                                       AS laterality,
            n.histology                                        AS histology,
            n.grade                                            AS grade,
            n.stage                                            AS stage,
            n.drug_class                                       AS drug_class,
            n.frequency                                        AS frequency,
            n.specimen_type                                    AS specimen_type
        ORDER BY raw_date ASC
        """

    async def _run_typed_query(
        self, session, patient_id, rel_types, node_label, display_name
    ) -> Dict:
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
                    self._run_typed_query(
                        session, patient_id, rel_types, node_label, display_name
                    )
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
                logger.warning("All typed queries empty — running fallback")
                typed_data = await self._run_fallback(patient_id)

            logger.info(
                f"EntityTypedGraphFetcher: patient={patient_id} | "
                + " | ".join(f"{k}={len(v)}" for k, v in typed_data.items())
            )
            return typed_data
        except Exception as e:
            logger.error(f"EntityTypedGraphFetcher failed: {e}")
            raise

    async def _run_fallback(self, patient_id: str) -> Dict[str, List[Dict]]:
        async with neo4j_driver.session() as session:
            result  = await session.run(self._FALLBACK_QUERY, patient_id=patient_id)
            grouped = {d: [] for _, _, d in self.ENTITY_TYPE_SPECS}
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


async def fetch_graph_documents(patient_id: str) -> List[Dict]:
    cypher = """
    MATCH (p:Patient {patient_id: $patient_id})-[r]->(n)
    OPTIONAL MATCH (n)-[:SUPPORTED_BY_EVIDENCE]->(e:Evidence)
    WITH coalesce(e.document_date, n.date, null) AS raw_date,
         coalesce(e.document_name, 'unknown')    AS document
    RETURN DISTINCT document, raw_date AS document_date
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
                })
            return docs
    except Exception as e:
        logger.warning(f"Graph documents fetch failed (non-critical): {e}")
        return []


# ============================================================
# PHASE 0B: 9 SPECIALIST ENTITY AGENTS
# Each agent is responsible for exactly one entity type.
# All 9 run in parallel after Phase 0A completes.
# ============================================================

class BaseEntityAgent(ABC):
    """
    Abstract base for all 9 specialist entity agents.

    Each subclass defines:
      - entity_type_key : str   — key in typed_data dict
      - agent_id        : str   — logging name
      - SYSTEM_PROMPT   : str   — specialist clinical system prompt
      - CLINICAL_RULES  : str   — entity-specific abnormality rules
      - auto_abnormal   : bool  — if True, skip LLM and flag all as abnormal

    The base class handles:
      - batching (BATCH_SIZE = 40)
      - LLM invocation with structured JSON output
      - neo4j_flag_fallback on any LLM failure
      - annotation of rows with _llm_is_abnormal + _llm_abnormal_reason
      - agent summary (total, abnormal, normal, example_abnormals)
    """

    BATCH_SIZE   = 40
    entity_type_key: str  = ""
    agent_id:         str  = ""
    SYSTEM_PROMPT:    str  = ""
    CLINICAL_RULES:   str  = ""
    auto_abnormal:    bool = False

    def __init__(self, llm):
        self._llm = llm

    async def _assess_batch(
        self, batch: List[Dict], start_index: int
    ) -> Dict[int, tuple[bool, Optional[str]]]:
        items = [
            _row_to_assessment_item(row, start_index + i)
            for i, row in enumerate(batch)
        ]
        prompt = f"""
ENTITY TYPE: {self.entity_type_key.upper().replace("_", " ")}

CLINICAL ABNORMALITY RULES:
{self.CLINICAL_RULES}

ENTITIES TO ASSESS ({len(items)} items):
{json.dumps(items, indent=2)}

Return ONLY this exact JSON — no markdown, no explanation:
{{
  "assessments": [
    {{
      "index":       <integer matching index field>,
      "is_abnormal": <true or false>,
      "reason":      "<brief clinical reason — null if normal>"
    }}
  ]
}}
"""
        try:
            response = await self._llm.ainvoke(
                [SystemMessage(content=self.SYSTEM_PROMPT),
                 HumanMessage(content=prompt)]
            )
            raw = response.content.strip()
            raw = re.sub(r"```json", "", raw)
            raw = re.sub(r"```",     "", raw)
            match = re.search(r"\{.*\}", raw, re.DOTALL)
            if not match:
                raise ValueError("No JSON found in response")
            parsed  = json.loads(match.group(0))
            results: Dict[int, tuple[bool, Optional[str]]] = {}
            for item in parsed.get("assessments", []):
                idx    = item.get("index")
                is_abn = bool(item.get("is_abnormal", False))
                reason = item.get("reason") or None
                if idx is not None:
                    results[idx] = (is_abn, reason)
            return results
        except Exception as e:
            logger.warning(
                f"{self.agent_id} batch failed (start={start_index}): {e} "
                "— falling back to neo4j flags"
            )
            return {
                start_index + i: _neo4j_flag_fallback(row)
                for i, row in enumerate(batch)
            }

    async def run(self, rows: List[Dict]) -> Dict:
        """
        Annotate all rows. Returns agent summary dict.
        """
        t0 = datetime.now().timestamp()
        logger.info(f"{self.agent_id} — START | rows={len(rows)}")

        if not rows:
            logger.info(f"{self.agent_id} — SKIP (no rows)")
            return {
                "agent_id":       self.agent_id,
                "entity_type":    self.entity_type_key,
                "total":          0,
                "abnormal":       0,
                "normal":         0,
                "elapsed_ms":     0.0,
                "example_abnormals": [],
            }

        # Auto-abnormal types (diagnoses, symptoms) — no LLM call needed
        if self.auto_abnormal:
            for row in rows:
                row["_llm_is_abnormal"]     = True
                row["_llm_abnormal_reason"] = self._auto_reason()
            abnormal_count = len(rows)
        else:
            all_results: Dict[int, tuple[bool, Optional[str]]] = {}
            batch_tasks = []
            for batch_start in range(0, len(rows), self.BATCH_SIZE):
                batch = rows[batch_start: batch_start + self.BATCH_SIZE]
                batch_tasks.append(self._assess_batch(batch, batch_start))

            batch_results = await asyncio.gather(*batch_tasks, return_exceptions=True)
            for i, result in enumerate(batch_results):
                if isinstance(result, Exception):
                    batch_start = i * self.BATCH_SIZE
                    batch = rows[batch_start: batch_start + self.BATCH_SIZE]
                    for j, row in enumerate(batch):
                        is_abn, reason = _neo4j_flag_fallback(row)
                        all_results[batch_start + j] = (is_abn, reason)
                else:
                    all_results.update(result)

            for idx, row in enumerate(rows):
                is_abn, reason = all_results.get(idx, _neo4j_flag_fallback(row))
                row["_llm_is_abnormal"]     = is_abn
                row["_llm_abnormal_reason"] = reason

            abnormal_count = sum(1 for r in rows if r.get("_llm_is_abnormal"))

        elapsed = round((datetime.now().timestamp() - t0) * 1000, 1)
        example_abnormals = [
            {
                "name":   r.get("name", "?"),
                "value":  r.get("value"),
                "reason": r.get("_llm_abnormal_reason"),
            }
            for r in rows if r.get("_llm_is_abnormal")
        ][:5]

        logger.info(
            f"{self.agent_id} — DONE ({elapsed}ms) | "
            f"total={len(rows)} | abnormal={abnormal_count} | normal={len(rows)-abnormal_count}"
        )
        return {
            "agent_id":           self.agent_id,
            "entity_type":        self.entity_type_key,
            "total":              len(rows),
            "abnormal":           abnormal_count,
            "normal":             len(rows) - abnormal_count,
            "elapsed_ms":         elapsed,
            "example_abnormals":  example_abnormals,
        }

    def _auto_reason(self) -> str:
        return (
            "diagnosis is clinically significant by definition"
            if self.entity_type_key == "diagnoses"
            else "symptom represents a deviation from normal health"
        )


# ──────────────────────────────────────────────
# 1. DiagnosisAgent
# ──────────────────────────────────────────────
class DiagnosisAgent(BaseEntityAgent):
    entity_type_key = "diagnoses"
    agent_id        = "Phase0B_DiagnosisAgent"
    auto_abnormal   = True   # All diagnoses are clinically significant — no LLM needed
    SYSTEM_PROMPT   = ""
    CLINICAL_RULES  = ""


# ──────────────────────────────────────────────
# 2. LabAbnormalityAgent
# ──────────────────────────────────────────────
class LabAbnormalityAgent(BaseEntityAgent):
    entity_type_key = "lab_results"
    agent_id        = "Phase0B_LabAbnormalityAgent"
    auto_abnormal   = False

    SYSTEM_PROMPT = (
        "You are a clinical laboratory scientist performing abnormality assessment "
        "on lab results extracted from patient medical records. "
        "Apply evidence-based reference range analysis. "
        "Return ONLY a JSON object — no markdown, no explanation."
    )

    CLINICAL_RULES = """
Mark a lab result as ABNORMAL (is_abnormal=true) if ANY of the following apply:
  1. VALUE OUTSIDE REFERENCE RANGE: the numeric value falls outside the stated
     reference_range (e.g. value=9.2%, ref=4.0-6.5% → abnormal).
  2. NEO4J ALREADY FLAGGED IT: is_abnormal=true OR abnormal_flag is set to
     HIGH/LOW/CRITICAL/ELEVATED/POSITIVE/REACTIVE/DETECTED.
  3. CLINICAL LANGUAGE IN EVIDENCE: the evidence or name contains words such as:
     elevated, raised, high, low, decreased, increased, reduced, critical,
     panic value, positive, reactive, detected, outside range, above normal,
     below normal, flagged, marked, abnormal.
  4. CRITICAL VALUES (always abnormal regardless of reference range):
     - HbA1c > 9.0% (poor glycaemic control)
     - eGFR < 60 mL/min (CKD stage 3+)
     - Creatinine > 1.3 mg/dL (women) or > 1.5 mg/dL (men)
     - Haemoglobin < 11 g/dL
     - Sodium < 135 or > 145 mmol/L
     - Potassium < 3.5 or > 5.5 mmol/L
     - INR > 3.0
     - Troponin any detectable level
     - PSA > 4.0 ng/mL
     - Total cholesterol > 200 mg/dL
     - LDL > 130 mg/dL
     - TSH outside 0.4–4.0 mIU/L
     - Platelet < 100,000 or > 450,000 /μL
     - WBC > 11,000 or < 4,000 /μL
  5. TUMOUR MARKERS: any detectable level of CA-125, CEA, AFP, PSA, CA 19-9,
     Beta-HCG (non-pregnancy), NSE is considered clinically significant.

Mark as NORMAL only if:
  - Value is explicitly within reference range AND
  - No clinical flags in the record AND
  - Not a critical value by the criteria above.

The reason field must state the specific abnormality (e.g. "HbA1c 9.2% above target 7%",
"eGFR 55 — CKD stage 3a", "Creatinine 1.4 mg/dL above upper limit 1.2").
"""


# ──────────────────────────────────────────────
# 3. VitalSignAgent
# ──────────────────────────────────────────────
class VitalSignAgent(BaseEntityAgent):
    entity_type_key = "vital_signs"
    agent_id        = "Phase0B_VitalSignAgent"
    auto_abnormal   = False

    SYSTEM_PROMPT = (
        "You are a clinical nurse assessor evaluating vital sign measurements "
        "against established clinical threshold criteria. "
        "Apply NICE / AHA standard thresholds for adults. "
        "Return ONLY a JSON object — no markdown, no explanation."
    )

    CLINICAL_RULES = """
Mark a vital sign as ABNORMAL (is_abnormal=true) if it meets ANY threshold below:

BLOOD PRESSURE:
  - Hypertensive: systolic ≥ 140 mmHg OR diastolic ≥ 90 mmHg
  - Hypertensive crisis: systolic ≥ 180 OR diastolic ≥ 120 (mark with "CRISIS" in reason)
  - Hypotensive: systolic < 90 OR diastolic < 60
  - If value is written as "148/92" — parse as systolic=148, diastolic=92 → ABNORMAL

HEART RATE:
  - Tachycardia: > 100 bpm
  - Bradycardia: < 60 bpm (unless athlete context stated)

OXYGEN SATURATION (SpO2):
  - Abnormal: < 95%
  - Critical: < 90%

TEMPERATURE:
  - Fever: > 37.5°C (99.5°F)
  - Hypothermia: < 36.0°C (96.8°F)

RESPIRATORY RATE:
  - Tachypnoea: > 20 breaths/min
  - Bradypnoea: < 12 breaths/min

BLOOD GLUCOSE (if recorded as vital):
  - Hyperglycaemia: > 11.1 mmol/L or > 200 mg/dL
  - Hypoglycaemia: < 3.9 mmol/L or < 70 mg/dL

WEIGHT / BMI (if recorded as vital):
  - Obese: BMI > 30
  - Underweight: BMI < 18.5
  - Overweight: BMI 25–29.9 (mark as WATCH — mild concern)

Mark as NORMAL if the value clearly falls within the adult normal ranges above.
The reason must quote the measured value and the threshold exceeded
(e.g. "BP 148/92 mmHg — Stage 1 hypertension (threshold ≥140/90)").
"""


# ──────────────────────────────────────────────
# 4. MedicationAgent
# ──────────────────────────────────────────────
class MedicationAgent(BaseEntityAgent):
    entity_type_key = "medications"
    agent_id        = "Phase0B_MedicationAgent"
    auto_abnormal   = False

    SYSTEM_PROMPT = (
        "You are a clinical pharmacist assessing medication records from patient charts. "
        "Your task is to flag medications that indicate serious or complex disease states "
        "or carry significant clinical implications. "
        "Return ONLY a JSON object — no markdown, no explanation."
    )

    CLINICAL_RULES = """
Mark a medication as ABNORMAL / CLINICALLY SIGNIFICANT (is_abnormal=true) if it belongs
to any of the following HIGH-SIGNIFICANCE categories:

  ONCOLOGY:
    - Chemotherapy agents (cyclophosphamide, cisplatin, carboplatin, paclitaxel,
      docetaxel, gemcitabine, doxorubicin, vincristine, methotrexate, capecitabine,
      imatinib, erlotinib, bevacizumab, rituximab, trastuzumab)
    - Hormonal cancer therapy (tamoxifen, letrozole, anastrozole, bicalutamide,
      enzalutamide, leuprolide)
    - Reason: "Oncology agent — active or recent cancer treatment"

  IMMUNOSUPPRESSION:
    - Cyclosporine, tacrolimus, mycophenolate, azathioprine, sirolimus
    - Biologics: infliximab, adalimumab, etanercept, ustekinumab, secukinumab
    - High-dose corticosteroids (prednisolone >10mg/day, dexamethasone)
    - Reason: "Immunosuppressant — significant immune compromise risk"

  ANTICOAGULATION:
    - Warfarin, heparin, enoxaparin, rivaroxaban, apixaban, dabigatran, edoxaban
    - Reason: "Anticoagulant — bleeding risk, requires monitoring"

  DIABETES (INSULIN / GLP-1):
    - Any insulin formulation (glargine, detemir, aspart, lispro, regular)
    - GLP-1 agonists: semaglutide, liraglutide, dulaglutide, exenatide
    - SGLT-2: empagliflozin, dapagliflozin, canagliflozin (flag if >1 antidiabetic)
    - Reason: "Insulin/GLP-1 — insulin-dependent or complex diabetes"

  CARDIAC HIGH-RISK:
    - Digoxin, amiodarone, flecainide, sotalol
    - Nitrates: isosorbide dinitrate, isosorbide mononitrate, GTN
    - Reason: "Cardiac antiarrhythmic or nitrate — high clinical significance"

  RENAL / DIALYSIS:
    - Erythropoietin, darbepoetin, sevelamer, cinacalcet, lanthanum carbonate
    - Reason: "Renal replacement therapy drug — severe CKD/ESRD"

  PSYCHIATRIC HIGH-RISK:
    - Lithium, clozapine, olanzapine, risperidone, quetiapine, haloperidol
    - Reason: "High-risk antipsychotic — requires monitoring"

  ANTI-EPILEPTIC:
    - Phenytoin, valproate, carbamazepine, levetiracetam, lamotrigine, topiramate
    - Reason: "Anti-epileptic — epilepsy/neurological condition"

Mark as NOT SIGNIFICANT (is_abnormal=false) for:
  - Vitamins, minerals, supplements (vitamin D, B12, iron, calcium, zinc, omega-3)
  - OTC antacids (omeprazole, pantoprazole at standard doses, ranitidine)
  - Antihistamines (cetirizine, loratadine, fexofenadine)
  - Simple analgesics (paracetamol, ibuprofen unless chronic high-dose)
  - Routine statins, ACE inhibitors, ARBs, calcium channel blockers (unless concerning combo)
  - Standard metformin monotherapy

The reason must name the drug class and the implication
(e.g. "Warfarin — anticoagulant, bleeding risk, INR monitoring required").
"""


# ──────────────────────────────────────────────
# 5. FindingAgent
# ──────────────────────────────────────────────
class FindingAgent(BaseEntityAgent):
    entity_type_key = "findings"
    agent_id        = "Phase0B_FindingAgent"
    auto_abnormal   = False

    SYSTEM_PROMPT = (
        "You are a consultant radiologist and pathologist reviewing clinical and "
        "imaging findings from patient medical records. "
        "Assess whether each finding represents a significant pathological or "
        "structural abnormality. "
        "Return ONLY a JSON object — no markdown, no explanation."
    )

    CLINICAL_RULES = """
Mark a finding as ABNORMAL (is_abnormal=true) if it describes ANY of the following:

  STRUCTURAL / MORPHOLOGICAL CHANGES:
    - Masses, tumours, nodules, polyps, cysts, lesions
    - Thickening (bladder wall, bowel wall, endometrial)
    - Calculi (stones in kidney, bile duct, bladder, salivary gland)
    - Effusions (pleural, pericardial, ascites, joint)
    - Stenosis, narrowing, obstruction (vascular, biliary, ureteric, bowel)
    - Dilatation or distension (hydronephrosis, biliary dilatation, bowel loops)
    - Atrophy or hypertrophy of organs

  PATHOLOGICAL / TISSUE CHANGES:
    - Steatosis, fatty changes (liver, pancreas)
    - Fibrosis, cirrhosis, sclerosis, calcification
    - Infiltration, consolidation (lung), ground-glass opacity
    - Necrosis, infarction
    - Inflammation, oedema, congestion
    - Dysplasia, carcinoma-in-situ, malignancy, metastasis
    - Von Brunn's nests, atypia, nuclear changes
    - Haemorrhage, haematoma

  ONCOLOGICAL FINDINGS:
    - Any biopsy or histopathology result showing carcinoma, sarcoma, lymphoma,
      or malignant cells — always ABNORMAL regardless of other fields
    - Grade or stage present → always ABNORMAL

  VASCULAR / CARDIAC FINDINGS:
    - Atherosclerosis, plaques, intimal thickening
    - Cardiomegaly, left ventricular hypertrophy, wall motion abnormality
    - Reduced ejection fraction

Mark as NORMAL / UNREMARKABLE only if the finding text EXPLICITLY states:
  "normal", "unremarkable", "no abnormality detected", "within normal limits",
  "clear", "intact", "no significant finding", "NAD".
  If there is any ambiguity, mark as ABNORMAL.

The reason must describe the specific pathological change found
(e.g. "Grade I-II hepatic steatosis — fatty liver disease",
"Bladder wall thickening — structural abnormality",
"TCC Grade 3 — malignant histopathology").
"""


# ──────────────────────────────────────────────
# 6. ProcedureAgent
# ──────────────────────────────────────────────
class ProcedureAgent(BaseEntityAgent):
    entity_type_key = "procedures"
    agent_id        = "Phase0B_ProcedureAgent"
    auto_abnormal   = False

    SYSTEM_PROMPT = (
        "You are a clinical surgeon and proceduralist reviewing procedure records "
        "from patient medical records. "
        "Assess whether each procedure implies a significant pathological indication "
        "or serious clinical condition. "
        "Return ONLY a JSON object — no markdown, no explanation."
    )

    CLINICAL_RULES = """
Mark a procedure as CLINICALLY SIGNIFICANT (is_abnormal=true) if it implies ANY of:

  ONCOLOGICAL PROCEDURES:
    - Biopsy (any site) — especially if evidence mentions malignant, carcinoma, tumour
    - TURBT (transurethral resection of bladder tumour)
    - Oncologic resection (colectomy, gastrectomy, prostatectomy, nephrectomy,
      mastectomy, cystectomy, hepatectomy)
    - Bone marrow biopsy / aspiration
    - Lymph node dissection
    - Reason: "Oncologic procedure — implies active or suspected malignancy"

  RENAL REPLACEMENT THERAPY:
    - Haemodialysis, peritoneal dialysis, CRRT
    - AV fistula creation
    - Reason: "Dialysis/renal replacement — end-stage renal disease"

  ORGAN TRANSPLANTATION:
    - Kidney, liver, heart, lung, pancreas transplant
    - Reason: "Organ transplant — immunosuppression required"

  HIGH-ACUITY CARDIAC PROCEDURES:
    - Coronary angiography / PCI / CABG
    - Pacemaker / ICD implantation
    - Cardioversion / ablation
    - Reason: "Cardiac intervention — significant coronary or arrhythmia disease"

  MAJOR SURGERY WITH PATHOLOGICAL INDICATION:
    - Any surgery where evidence mentions: cancer, malignancy, tumour, carcinoma,
      metastasis, infarction, necrosis, haemorrhage requiring surgery
    - Reason: "Major surgery with pathological indication"

  INVASIVE DIAGNOSTIC PROCEDURES:
    - ERCP, colonoscopy with polypectomy, upper GI endoscopy with biopsy
    - Lumbar puncture with abnormal findings
    - Paracentesis / thoracocentesis (implies effusion)
    - Reason: "Invasive diagnostic — implies significant pathology"

Mark as ROUTINE / NOT SIGNIFICANT (is_abnormal=false) for:
  - Routine screening colonoscopy (no biopsy / no polyp)
  - Standard blood draws, IV cannulation
  - Routine imaging (chest X-ray, ultrasound) — unless evidence mentions pathology
  - Routine vaccinations, dressings, suture removal
  - Physiotherapy, occupational therapy

The reason must name the procedure and the pathological implication
(e.g. "TURBT — transurethral resection for bladder tumour, implies active urothelial malignancy").
"""


# ──────────────────────────────────────────────
# 7. MeasurementAgent
# ──────────────────────────────────────────────
class MeasurementAgent(BaseEntityAgent):
    entity_type_key = "measurements"
    agent_id        = "Phase0B_MeasurementAgent"
    auto_abnormal   = False

    SYSTEM_PROMPT = (
        "You are a clinical measurement analyst reviewing body measurements and "
        "dimensional data from patient medical records. "
        "Apply evidence-based thresholds to classify measurements. "
        "Return ONLY a JSON object — no markdown, no explanation."
    )

    CLINICAL_RULES = """
Mark a measurement as ABNORMAL (is_abnormal=true) if ANY apply:

  TUMOUR / LESION SIZES (always abnormal — implies active pathology):
    - Any tumour, mass, lesion, or nodule measurement (e.g. "6x3.8x1.5 cm mass")
    - Any specimen size from biopsy or resection
    - Reason: "Tumour/mass measurement — confirms active pathology"

  BODY MASS INDEX (BMI):
    - Obese: BMI > 30 kg/m² (reason: "Obesity — BMI {value}")
    - Underweight: BMI < 18.5 kg/m² (reason: "Underweight — BMI {value}")
    - Overweight: BMI 25–30 kg/m² (reason: "Overweight — BMI {value}, mild concern")

  ORGAN SIZES (abnormal if outside stated normal):
    - Liver span > 15 cm
    - Spleen length > 12 cm (splenomegaly)
    - Kidney length > 12 cm or < 9 cm
    - Thyroid lobe > 2 cm anterior-posterior
    - Prostate volume > 30 mL
    - Uterus length > 9 cm (non-pregnant)
    - Reason: "Organ size abnormal — {organ} {value} {unit}, normal range stated"

  TUMOUR MARKERS / DIMENSIONAL STAGING:
    - Any measurement associated with staging terminology (T1, T2, T3, T4, N1, M1)
    - Reason: "Staging measurement — implies active malignancy"

  WAIST CIRCUMFERENCE:
    - Men: > 102 cm
    - Women: > 88 cm
    - Reason: "Central obesity — increased metabolic risk"

Mark as NORMAL if:
  - Measurement is stated as within normal limits
  - Organ size within standard reference range
  - BMI 18.5–24.9

The reason must state the measurement value, unit, and the threshold exceeded.
"""


# ──────────────────────────────────────────────
# 8. AnatomyAgent
# ──────────────────────────────────────────────
class AnatomyAgent(BaseEntityAgent):
    entity_type_key = "anatomy"
    agent_id        = "Phase0B_AnatomyAgent"
    auto_abnormal   = False

    SYSTEM_PROMPT = (
        "You are a clinical anatomist reviewing anatomical entity records from "
        "patient medical records. "
        "Assess whether each anatomical entity is associated with a pathological "
        "process, structural abnormality, or pathological involvement. "
        "Return ONLY a JSON object — no markdown, no explanation."
    )

    CLINICAL_RULES = """
Mark an anatomical entity as ABNORMAL / PATHOLOGICALLY INVOLVED (is_abnormal=true) if:

  DIRECT PATHOLOGICAL INVOLVEMENT:
    - The anatomy entity is explicitly described as diseased, affected, invaded,
      infiltrated, inflamed, atrophied, hypertrophied, or otherwise abnormal
    - Evidence contains: carcinoma, tumour, lesion, stenosis, thickening, fibrosis,
      calcification, necrosis, infarction, rupture, perforation, obstruction
    - The entity is named as the primary site of a documented diagnosis
      (e.g. "Urinary Bladder" when TCC of bladder is diagnosed)
    - Reason: "Anatomy involved in pathological process — {specific finding}"

  SURGICAL / PROCEDURAL INVOLVEMENT:
    - Anatomy entity is the site of a therapeutic or diagnostic procedure
      that implies pathology (resection, biopsy, ablation)
    - Reason: "Anatomy site of pathological procedure"

  LATERALITY SIGNIFICANCE:
    - If laterality (right/left/bilateral) is stated, the anatomy entity is likely
      clinically relevant — mark as abnormal if any associated pathology is documented
    - Reason: "Laterally specified anatomy with documented pathology"

  ABSENT / RESECTED ANATOMY:
    - Absence of an expected anatomical structure (post-surgical, congenital absence)
    - Reason: "Structure absent or previously resected — significant clinical history"

Mark as NORMAL if:
  - The anatomy entity is mentioned purely as a reference location with no
    pathological qualifier
  - Evidence clearly states the structure is normal, unremarkable, or intact
  - No diagnosis, finding, or procedure is linked to this anatomy

The reason must specify what pathological process involves this anatomy.
"""


# ──────────────────────────────────────────────
# 9. SymptomAgent
# ──────────────────────────────────────────────
class SymptomAgent(BaseEntityAgent):
    entity_type_key = "symptoms"
    agent_id        = "Phase0B_SymptomAgent"
    auto_abnormal   = True   # All symptoms are clinically significant — no LLM needed
    SYSTEM_PROMPT   = ""
    CLINICAL_RULES  = ""


# ============================================================
# PHASE 0B ORCHESTRATOR
# Instantiates all 9 agents and runs them in parallel.
# ============================================================

# Registry: entity_type_key → agent class
ENTITY_AGENT_REGISTRY: Dict[str, type] = {
    "diagnoses":    DiagnosisAgent,
    "lab_results":  LabAbnormalityAgent,
    "vital_signs":  VitalSignAgent,
    "medications":  MedicationAgent,
    "findings":     FindingAgent,
    "procedures":   ProcedureAgent,
    "measurements": MeasurementAgent,
    "anatomy":      AnatomyAgent,
    "symptoms":     SymptomAgent,
}


async def run_9_entity_agents(
    typed_data: Dict[str, List[Dict]],
    llm,
) -> Dict[str, Dict]:
    """
    Instantiate all 9 specialist entity agents and run them in parallel.
    Returns a dict of entity_type_key → agent summary.
    Any entity types present in typed_data but not in the registry
    get a simple neo4j_flag_fallback pass.
    """
    logger.info("Phase 0B — 9 specialist entity agents starting in parallel")
    t0 = datetime.now().timestamp()

    agent_tasks: List[tuple[str, Any]] = []
    for entity_key, rows in typed_data.items():
        agent_class = ENTITY_AGENT_REGISTRY.get(entity_key)
        if agent_class:
            agent = agent_class(llm)
            agent_tasks.append((entity_key, agent.run(rows)))
        else:
            # Unknown entity type — apply fallback tagging inline
            logger.warning(
                f"Phase 0B: no specialist agent for '{entity_key}' — "
                "applying neo4j_flag_fallback"
            )
            for row in rows:
                is_abn, reason = _neo4j_flag_fallback(row)
                row["_llm_is_abnormal"]     = is_abn
                row["_llm_abnormal_reason"] = reason

    if not agent_tasks:
        return {}

    keys, coroutines = zip(*agent_tasks)
    results = await asyncio.gather(*coroutines, return_exceptions=True)

    summaries: Dict[str, Dict] = {}
    for key, result in zip(keys, results):
        if isinstance(result, Exception):
            logger.error(f"Phase 0B agent '{key}' failed: {result}")
            # Fall back to neo4j flags for this entity type
            for row in typed_data.get(key, []):
                is_abn, reason = _neo4j_flag_fallback(row)
                row["_llm_is_abnormal"]     = is_abn
                row["_llm_abnormal_reason"] = reason
            summaries[key] = {
                "agent_id":    ENTITY_AGENT_REGISTRY[key].agent_id
                               if key in ENTITY_AGENT_REGISTRY else key,
                "entity_type": key,
                "error":       str(result),
                "fallback":    "neo4j_flag applied",
            }
        else:
            summaries[key] = result

    elapsed = round((datetime.now().timestamp() - t0) * 1000, 1)
    total_abnormal = sum(
        len([r for r in rows if r.get("_llm_is_abnormal")])
        for rows in typed_data.values()
    )
    logger.info(
        f"Phase 0B — ALL 9 agents DONE ({elapsed}ms) | "
        f"total_abnormal_across_all_types={total_abnormal}"
    )
    return summaries


# ============================================================
# PHASE 0C: GRAPH PREPROCESSOR
# Full section builders for all 9 types + timeline + entity index.
# NOTE: everything in this phase is PATIENT HISTORY (graph) data.
# typed_data / graph_documents are allowed to be empty/null — that is a
# normal, expected state (e.g. a brand new patient with no prior records)
# and must never cause the pipeline to error or to fabricate data.
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
        if row.get("grade") or row.get("stage"):
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
        if value: parts.append(f"= {value}")
        if unit:  parts.append(unit)
        parts.append(f"| {date}")
        parts.append(f"| doc: `{doc}`")

        extra = []
        if row.get("grade"):        extra.append(f"grade={row['grade']}")
        if row.get("stage"):        extra.append(f"stage={row['stage']}")
        if row.get("severity"):     extra.append(f"severity={row['severity']}")
        if row.get("histology"):    extra.append(f"histology: {row['histology']}")
        if row.get("laterality"):   extra.append(f"laterality: {row['laterality']}")
        if row.get("reference_range"): extra.append(f"ref: {row['reference_range']}")
        reason = self._abnormal_reason(row)
        if reason: extra.append(f"⚠ {reason}")
        if extra:  parts.append(f"| {'; '.join(extra)}")

        line = "- " + " ".join(parts)
        if include_evidence and evid and len(evid) < 300:
            line += f"\n  > *{evid.strip()}*"
        return line

    def build_md_diagnoses(self, rows: List[Dict]) -> str:
        if not rows:
            return "## DIAGNOSES\n_No confirmed diagnoses documented._\n"
        lines = ["## CONFIRMED DIAGNOSES\n",
                 f"_Total: {len(rows)} confirmed diagnosis entity/entities_\n"]
        for row in rows:
            lines.append(self._fmt_row(row, include_evidence=True))
        return "\n".join(lines) + "\n"

    def build_md_labs(self, rows: List[Dict]) -> str:
        if not rows:
            return "## LAB RESULTS\n_No lab results documented._\n"
        abnormal = [r for r in rows if self._is_abnormal(r)]
        normal   = [r for r in rows if not self._is_abnormal(r)]
        lines = ["## LAB RESULTS\n",
                 f"_Total: {len(rows)} | Abnormal: {len(abnormal)} | Normal: {len(normal)}_\n"]
        if abnormal:
            lines.append("### ⚠ Abnormal / Flagged Results")
            for row in abnormal:
                lines.append(self._fmt_row(row, include_evidence=True))
        if normal:
            lines.append("\n### Normal Results (compressed)")
            by_doc: Dict[str, List[str]] = {}
            for row in normal:
                doc = row.get("document", "unknown")
                by_doc.setdefault(doc, []).append(
                    f"{row.get('name','?')}={row.get('value','N/A')}"
                )
            for doc, names in by_doc.items():
                lines.append(
                    f"- `{doc}`: {', '.join(names[:10])}"
                    + (f" (+{len(names)-10} more)" if len(names) > 10 else "")
                )
        return "\n".join(lines) + "\n"

    def build_md_vitals(self, rows: List[Dict]) -> str:
        if not rows:
            return "## VITAL SIGNS\n_No vital signs documented._\n"
        abnormal = [r for r in rows if self._is_abnormal(r)]
        normal   = [r for r in rows if not self._is_abnormal(r)]
        lines = ["## VITAL SIGNS\n",
                 f"_Total: {len(rows)} | Abnormal: {len(abnormal)} | Normal: {len(normal)}_\n"]
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

    def build_md_medications(self, rows: List[Dict]) -> str:
        if not rows:
            return "## MEDICATIONS\n_No medications documented._\n"
        abnormal = [r for r in rows if self._is_abnormal(r)]
        normal   = [r for r in rows if not self._is_abnormal(r)]
        lines = ["## MEDICATIONS\n", f"_Total: {len(rows)} medication entries_\n"]
        if abnormal:
            lines.append("### ⚠ Clinically Significant Medications")
            for row in abnormal:
                name   = row.get("name", "unknown")
                date   = self._fmt_date(row.get("raw_date") or row.get("date"))
                doc    = row.get("document", "?")
                freq   = row.get("frequency", "")
                cls    = row.get("drug_class", "")
                reason = self._abnormal_reason(row) or ""
                parts  = [f"**{name}**", f"| {date}", f"| doc: `{doc}`"]
                if freq:   parts.append(f"| freq: {freq}")
                if cls:    parts.append(f"| class: {cls}")
                if reason: parts.append(f"| ⚠ {reason}")
                lines.append("- " + " ".join(parts))
        if normal:
            lines.append("\n### Routine Medications")
            for row in normal:
                name  = row.get("name", "unknown")
                date  = self._fmt_date(row.get("raw_date") or row.get("date"))
                doc   = row.get("document", "?")
                freq  = row.get("frequency", "")
                cls   = row.get("drug_class", "")
                parts = [f"**{name}**", f"| {date}", f"| doc: `{doc}`"]
                if freq: parts.append(f"| freq: {freq}")
                if cls:  parts.append(f"| class: {cls}")
                lines.append("- " + " ".join(parts))
        return "\n".join(lines) + "\n"

    def build_md_findings(self, rows: List[Dict]) -> str:
        if not rows:
            return "## FINDINGS\n_No findings documented._\n"
        abnormal = [r for r in rows if self._is_abnormal(r)]
        normal   = [r for r in rows if not self._is_abnormal(r)]
        lines = ["## CLINICAL FINDINGS\n",
                 f"_Total: {len(rows)} | Abnormal: {len(abnormal)} | Unremarkable: {len(normal)}_\n"]
        if abnormal:
            lines.append("### ⚠ Significant Findings")
            for row in abnormal:
                lines.append(self._fmt_row(row, include_evidence=True))
        if normal:
            lines.append("\n### Unremarkable Findings (compressed)")
            names = [r.get("name", "?") for r in normal]
            lines.append(
                "- " + ", ".join(names[:15])
                + (f" (+{len(names)-15} more)" if len(names) > 15 else "")
            )
        return "\n".join(lines) + "\n"

    def build_md_procedures(self, rows: List[Dict]) -> str:
        if not rows:
            return "## PROCEDURES\n_No procedures documented._\n"
        abnormal = [r for r in rows if self._is_abnormal(r)]
        normal   = [r for r in rows if not self._is_abnormal(r)]
        lines = ["## PROCEDURES\n", f"_Total: {len(rows)} procedures_\n"]
        if abnormal:
            lines.append("### ⚠ Procedures with Pathological Indication")
            for row in abnormal:
                name   = row.get("name", "unknown")
                date   = self._fmt_date(row.get("raw_date") or row.get("date"))
                doc    = row.get("document", "?")
                spec   = row.get("specimen_type", "")
                reason = self._abnormal_reason(row) or ""
                evid   = row.get("evidence", "")
                parts  = [f"**{name}**", f"| {date}", f"| doc: `{doc}`"]
                if spec:   parts.append(f"| specimen: {spec}")
                if reason: parts.append(f"| ⚠ {reason}")
                lines.append("- " + " ".join(parts))
                if evid and len(evid) < 200:
                    lines.append(f"  > *{evid.strip()}*")
        if normal:
            lines.append("\n### Routine Procedures")
            for row in normal:
                name = row.get("name", "unknown")
                date = self._fmt_date(row.get("raw_date") or row.get("date"))
                doc  = row.get("document", "?")
                evid = row.get("evidence", "")
                lines.append(f"- **{name}** | {date} | doc: `{doc}`")
                if evid and len(evid) < 200:
                    lines.append(f"  > *{evid.strip()}*")
        return "\n".join(lines) + "\n"

    def build_md_measurements(self, rows: List[Dict]) -> str:
        if not rows:
            return "## MEASUREMENTS\n_No measurements documented._\n"
        lines = ["## MEASUREMENTS\n"]
        for row in rows:
            lines.append(self._fmt_row(row, include_evidence=True))
        return "\n".join(lines) + "\n"

    def build_md_anatomy(self, rows: List[Dict]) -> str:
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
                name  = row.get("name", "unknown")
                date  = self._fmt_date(row.get("raw_date") or row.get("date"))
                doc   = row.get("document", "?")
                lat   = row.get("laterality", "")
                parts = [f"**{name}**", f"| {date}", f"| doc: `{doc}`"]
                if lat: parts.append(f"| {lat}")
                lines.append("- " + " ".join(parts))
        return "\n".join(lines) + "\n"

    def build_md_symptoms(self, rows: List[Dict]) -> str:
        if not rows:
            return "## SYMPTOMS\n_No symptoms documented._\n"
        lines = ["## SYMPTOMS / PRESENTATIONS\n"]
        for row in rows:
            lines.append(self._fmt_row(row, include_evidence=True))
        return "\n".join(lines) + "\n"

    def build_md_timeline(self, typed_data: Dict[str, List[Dict]]) -> str:
        events: List[Dict] = []
        for entity_type, rows in typed_data.items():
            for row in rows:
                raw_date = row.get("raw_date") or row.get("date")
                if raw_date and raw_date not in ("None", "null", "none"):
                    events.append({
                        "date":        str(raw_date).strip(),
                        "doc":         row.get("document", "unknown"),
                        "type":        entity_type,
                        "name":        row.get("name", "?"),
                        "is_abnormal": self._is_abnormal(row),
                        "reason":      self._abnormal_reason(row),
                    })
        if not events:
            return "## CLINICAL TIMELINE\n_No dated events._\n"
        events.sort(key=lambda x: x["date"])
        by_doc: Dict[str, Dict] = {}
        for ev in events:
            key = ev["date"] + "|" + ev["doc"]
            if key not in by_doc:
                by_doc[key] = {"date": ev["date"], "doc": ev["doc"], "events": []}
            flag  = "⚠ " if ev["is_abnormal"] else ""
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

    def build_entity_index(self, typed_data: Dict[str, List[Dict]]) -> Dict[str, EntityRecord]:
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
                    abnormal_reason=(
                        self._abnormal_reason(row)
                        or ("neo4j_flag" if row.get("is_abnormal") else None)
                    ),
                )
        return index

    def extract_confirmed_diagnoses(self, rows: List[Dict]) -> List[Dict]:
        return [
            {
                "name":                row.get("name", "unknown"),
                "entity_type":         "Diagnosis",
                "confirmation_status": "CONFIRMED — Documented Diagnosis",
                "date":                self._fmt_date(row.get("raw_date") or row.get("date")),
                "document":            row.get("document", "unknown"),
                "evidence_text":       row.get("evidence", ""),
                "grade":               row.get("grade"),
                "stage":               row.get("stage"),
                "histology":           row.get("histology"),
                "abnormal_reason":     self._abnormal_reason(row),
            }
            for row in rows
        ]

    def extract_abnormal_signals(self, typed_data: Dict[str, List[Dict]]) -> List[Dict]:
        signals = []
        for entity_type, rows in typed_data.items():
            for row in rows:
                if self._is_abnormal(row):
                    signals.append({
                        "entity_type":     entity_type,
                        "name":            row.get("name", "?"),
                        "value":           row.get("value"),
                        "date":            self._fmt_date(row.get("raw_date") or row.get("date")),
                        "document":        row.get("document", "?"),
                        "evidence":        row.get("evidence", ""),
                        "severity":        row.get("severity", "abnormal"),
                        "abnormal_reason": self._abnormal_reason(row),
                    })
        return signals

    def compress(
        self, typed_data: Dict[str, List[Dict]], graph_docs: List[Dict]
    ) -> CompressedContext:
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

        dates = [
            d.get("document_date", "")
            for d in graph_docs
            if d.get("document_date") and d["document_date"] not in ("None", "null")
        ]
        dates_sorted = sorted(d for d in dates if d)
        date_range = {
            "earliest": dates_sorted[0]  if dates_sorted else "unknown",
            "latest":   dates_sorted[-1] if dates_sorted else "unknown",
        }

        all_md = (
            md_diagnoses + md_labs + md_vitals + md_medications + md_findings +
            md_procedures + md_measurements + md_anatomy + md_symptoms + md_timeline
        )
        token_est = len(all_md) // 4

        logger.info(
            f"GraphPreprocessor: {total_entities} entities → "
            f"{len(abnormal_signals)} abnormal | ~{token_est} tokens"
        )

        return CompressedContext(
            confirmed_diagnoses=confirmed_diagnoses,
            abnormal_signals=abnormal_signals,
            md_diagnoses=md_diagnoses, md_labs=md_labs, md_vitals=md_vitals,
            md_medications=md_medications, md_findings=md_findings,
            md_procedures=md_procedures, md_measurements=md_measurements,
            md_anatomy=md_anatomy, md_symptoms=md_symptoms, md_timeline=md_timeline,
            entity_index=entity_index,
            total_documents=len(graph_docs),
            total_entities=total_entities,
            abnormal_entity_count=len(abnormal_signals),
            date_range=date_range,
            token_estimate=token_est,
        )


# ============================================================
# DEMO DATA
# ============================================================

def load_demo_typed_data() -> Dict[str, List[Dict]]:
    return {
        "diagnoses": [
            {
                "name": "Type 2 Diabetes Mellitus", "value": None, "unit": None,
                "raw_date": "2025-06-01", "document": "outpatient_summary.pdf",
                "evidence": "Patient confirmed with Type 2 Diabetes Mellitus.",
                "is_abnormal": True,
            },
            {
                "name": "Essential Hypertension", "value": None, "unit": None,
                "raw_date": "2025-06-01", "document": "outpatient_summary.pdf",
                "evidence": "BP consistently elevated. Diagnosed with essential hypertension.",
                "is_abnormal": True,
            },
        ],
        "lab_results": [
            {
                "name": "HbA1c", "value": "9.2", "unit": "%",
                "raw_date": "2025-11-15", "document": "lab_report_nov.pdf",
                "evidence": "HbA1c 9.2% — above target of 7%.",
                "reference_range": "4.0–6.5%", "is_abnormal": True, "abnormal_flag": "HIGH",
            },
            {
                "name": "eGFR", "value": "55", "unit": "mL/min/1.73m²",
                "raw_date": "2025-11-15", "document": "lab_report_nov.pdf",
                "evidence": "eGFR mildly reduced at 55 mL/min/1.73m².",
                "reference_range": ">60", "is_abnormal": True, "abnormal_flag": "LOW",
            },
            {
                "name": "Serum Creatinine", "value": "1.4", "unit": "mg/dL",
                "raw_date": "2025-11-15", "document": "lab_report_nov.pdf",
                "reference_range": "0.7–1.2 mg/dL", "is_abnormal": True,
            },
            {
                "name": "Total Cholesterol", "value": "210", "unit": "mg/dL",
                "raw_date": "2025-11-15", "document": "lab_report_nov.pdf",
                "reference_range": "<200 mg/dL", "is_abnormal": True,
            },
        ],
        "vital_signs": [
            {
                "name": "Blood Pressure", "value": "148/92", "unit": "mmHg",
                "raw_date": "2025-12-01", "document": "clinic_visit.pdf",
                "is_abnormal": True,
            },
            {
                "name": "Heart Rate", "value": "78", "unit": "bpm",
                "raw_date": "2025-12-01", "document": "clinic_visit.pdf",
                "is_abnormal": False,
            },
        ],
        "medications": [
            {
                "name": "Metformin 500mg", "raw_date": "2025-06-01",
                "document": "outpatient_summary.pdf",
                "drug_class": "Biguanide", "frequency": "Twice daily",
            },
            {
                "name": "Insulin Glargine 10 units", "raw_date": "2025-11-15",
                "document": "clinic_visit.pdf",
                "drug_class": "Basal insulin", "frequency": "Once daily at bedtime",
            },
        ],
        "findings": [
            {
                "name": "Grade I-II fatty changes in liver", "value": None, "unit": None,
                "raw_date": "2025-10-01", "document": "abdomen_usg.pdf",
                "evidence": "Grade I-II fatty changes in liver.", "is_abnormal": True,
            },
            {
                "name": "Bilateral small renal calculi", "value": None, "unit": None,
                "raw_date": "2025-10-01", "document": "abdomen_usg.pdf",
                "evidence": "Bilateral small renal calculi.", "is_abnormal": True,
            },
        ],
        "procedures": [
            {
                "name": "Sonography abdomen and pelvis", "raw_date": "2025-10-01",
                "document": "abdomen_usg.pdf",
                "evidence": "Ultrasound of abdomen and pelvis performed.",
            },
        ],
        "measurements": [
            {
                "name": "BMI", "value": "31.2", "unit": "kg/m²",
                "raw_date": "2025-12-01", "document": "clinic_visit.pdf",
                "is_abnormal": True,
            },
        ],
        "anatomy": [],
        "symptoms": [
            {
                "name": "Polyuria", "raw_date": "2025-11-01",
                "document": "outpatient_summary.pdf",
                "evidence": "Patient reports frequent urination.",
            },
            {
                "name": "Nocturia", "raw_date": "2025-11-01",
                "document": "outpatient_summary.pdf",
                "evidence": "Patient wakes 2–3 times nightly to urinate.",
            },
        ],
    }


def load_demo_graph_documents() -> List[Dict]:
    return [
        {"document": "outpatient_summary.pdf", "document_date": "2025-06-01"},
        {"document": "abdomen_usg.pdf",         "document_date": "2025-10-01"},
        {"document": "lab_report_nov.pdf",       "document_date": "2025-11-15"},
        {"document": "clinic_visit.pdf",         "document_date": "2025-12-01"},
    ]


# ============================================================
# A1 — MEDICATION EXTRACTOR AGENT  (DICTATION-ONLY — GATES THE REST OF THE PIPELINE)
# ============================================================

def _is_blank(v: Any) -> bool:
    """True if a value is empty/None/whitespace-only."""
    if v is None:
        return True
    if isinstance(v, str):
        return v.strip() == ""
    if isinstance(v, (list, dict)):
        return len(v) == 0
    return False


def _has_real_medication(rx: Dict) -> bool:
    """
    Decide whether an extracted prescription row is an ACTUAL medication or a
    blank/placeholder row (e.g. the LLM echoing the empty-string JSON schema
    template instead of returning an empty prescriptions array).

    A row counts as real only if at least one of the name-bearing fields
    actually contains a drug name.
    """
    name_fields = (
        rx.get("medication"),
        rx.get("generic_name"),
        rx.get("brand_name"),
        rx.get("raw_extracted_text"),
    )
    return any(not _is_blank(f) for f in name_fields)


def _clean_extracted_prescriptions(extraction_result: Dict) -> Dict:
    """
    CODE-LEVEL SAFETY NET for the dictation-only gate.

    The LLM is instructed to return an empty `prescriptions` array when no
    medication is dictated, but a fast/weak model can still echo the JSON
    schema's example object (all empty strings) as if it were a real
    extracted row. If that ever slips through, route_after_extraction()
    would incorrectly treat the dictation as containing a medication and
    open the A2/A3/A4 (patient-context / drug-database / safety-analysis)
    branch — which would then pull in graph/history data inappropriately.

    This function strips any such blank/placeholder rows BEFORE the gate
    decision is made, so the gate can never misfire due to a prompt-template
    echo, regardless of what the LLM actually returned.
    """
    raw_prescriptions = extraction_result.get("prescriptions", []) or []
    if not isinstance(raw_prescriptions, list):
        raw_prescriptions = []

    cleaned = [rx for rx in raw_prescriptions if isinstance(rx, dict) and _has_real_medication(rx)]
    dropped = len(raw_prescriptions) - len(cleaned)

    if dropped > 0:
        logger.warning(
            f"A1 · _clean_extracted_prescriptions — dropped {dropped} blank/placeholder "
            f"prescription row(s) that the LLM returned despite no real medication in the dictation"
        )

    extraction_result["prescriptions"]                = cleaned
    extraction_result["total_medications_extracted"]   = len(cleaned)
    extraction_result["medications_found"]             = len(cleaned) > 0
    return extraction_result


class MedicationExtractorAgent(BaseAgent):
    """
    Reads ONLY `prescription_text` (the doctor's dictation).

    Graph/history data (typed_data, compressed_context) is NEVER passed into
    this agent and NEVER used as a medication source — even when the graph
    contains a rich medication history and typed_data['medications'] is
    populated, those rows are patient HISTORY, not what was just dictated,
    and must not leak into the extracted list.

    Graph data being null/empty for a patient (e.g. no Neo4j records yet)
    is a normal state and has no bearing on this agent at all.

    After the LLM call, the raw result is passed through
    _clean_extracted_prescriptions() so that any blank/placeholder rows
    (schema-template echoes) can never be mistaken for a real medication by
    the downstream router.
    """

    agent_id = "A1"

    async def run(self, state: MedState) -> Dict:
        logger.info(f"{self.agent_id} · MedicationExtractorAgent — START")
        t0 = datetime.now().timestamp()

        system = (
            "You are a STRICT clinical medication extraction engine. "
            "Extract medications ONLY from the PRESCRIPTION TEXT provided. "
            "Do NOT use any other source. Do NOT hallucinate or infer medications not stated. "
            "CRITICAL RULE: if the prescription text does not explicitly name any medication, "
            "you MUST return \"prescriptions\": [] — a literal empty array. "
            "Never return a placeholder or template row with empty string fields just to "
            "satisfy the JSON shape; an empty array is the ONLY correct output when no "
            "medication is stated. "
            "Return ONLY valid JSON. No markdown, no prose."
        )

        prompt = f"""
PRESCRIPTION TEXT (ONLY source for extraction):
\"\"\"
{state["prescription_text"].strip()}
\"\"\"

══════════════════════════════════════════════════════════
FORMAT DETECTION:

FORMAT A — Natural clinical speech ("start X", "initiate Y", "prescribe Z")
FORMAT B — Treatment Protocol (contains "TREATMENT PROTOCOL", "- Dose:", "- Frequency:")
  → Valid medication line: starts with "•" naming a drug/supplement
  → SKIP: lifestyle bullets, diagnostics, investigations

ACTIVE VERBS (extract): start / begin / prescribe / initiate / order / give /
  administer / continue / take / increase to / decrease to / add / commence

EXCLUSION VERBS (skip): stop / discontinue / hold / previously on / was on /
  completed / avoided / withhold

NEVER classify as medication: radiation / surgery / O2 therapy / physiotherapy /
  dialysis / imaging / BP monitoring / lifestyle advice (diet, exercise, walking) /
  follow-up plans / lab/investigation orders (lipid profile, KFT, etc.)

REQUIRED per medication:
  generic_name → derive from drug name
  brand_name   → most recognised brand
  route        → infer only if unambiguous; else ""
  dosage_form  → infer from route/context

All other string fields → "" if not stated. Arrays → [] if not stated.

══════════════════════════════════════════════════════════
IF NO MEDICATION IS EXPLICITLY STATED IN THE TEXT ABOVE:
  → "medications_found" = false
  → "total_medications_extracted" = 0
  → "prescriptions" = []   (a literal empty JSON array — NOT an array containing
     one object with empty string fields; do not copy the example schema object
     below verbatim, it is a shape example only, not a default output)
══════════════════════════════════════════════════════════

Return ONLY this JSON:
{{
  "medications_found": true,
  "prescription_format": "FORMAT_A or FORMAT_B",
  "total_medications_extracted": 0,
  "prescriptions": [
    {{
      "medication":               "",
      "generic_name":             "",
      "brand_name":               "",
      "category":                 "",
      "strength":                 "",
      "dosage_form":              "",
      "route":                    "",
      "frequency":                "",
      "duration":                 "",
      "follow_up":                "",
      "standard_frequency_options": [],
      "standard_duration_options":  [],
      "special_instructions":     "",
      "dosage_instructions":      "",
      "quantity":                 "",
      "refills":                  "",
      "raw_extracted_text":       ""
    }}
  ],
  "skipped_items":    [],
  "extraction_notes": ""
}}
"""
        result = await self._invoke(system, prompt)

        # CODE-LEVEL gate hardening — strip any blank/placeholder rows the
        # LLM might have echoed from the schema, regardless of the prompt.
        result = _clean_extracted_prescriptions(result)

        elapsed = self._elapsed(t0)
        logger.info(
            f"{self.agent_id} · DONE ({elapsed}ms) | "
            f"found={result.get('total_medications_extracted', 0)}"
        )
        return {"extracted_medications": result, "timing": elapsed}


# ============================================================
# A2 — PATIENT CONTEXT AGENT
# (Only ever invoked when A1 found ≥1 medication in the dictation.)
# ============================================================

class PatientContextAgent(BaseAgent):
    agent_id = "A2"

    async def run(self, state: MedState) -> Dict:
        logger.info(f"{self.agent_id} · PatientContextAgent — START")
        t0       = datetime.now().timestamp()
        ctx      = self._get_ctx(state)
        dob      = state.get("dob",  "Not documented")
        sex      = state.get("sex",  "Not documented")
        age      = _compute_age(dob)
        demo_ext = state.get("demographics_extra", {})

        clinical_ctx = self._build_clinical_context(
            ctx, sections=["diagnoses", "labs", "vitals", "medications", "findings", "symptoms"]
        )

        system = (
            "You are a clinical pharmacist extracting patient context for medication safety review. "
            "Use ONLY the provided clinical data. Do NOT invent values. "
            "Mark anything not present as 'Not documented'. Return ONLY valid JSON."
        )

        prompt = f"""
PATIENT DEMOGRAPHICS:
  DOB: {dob} | Age: {age if age else "Not computable"} | Sex: {sex}
  Weight: {demo_ext.get("weight_kg") or "Not documented"} kg
  Height: {demo_ext.get("height_cm") or "Not documented"} cm
  Known Allergies: {json.dumps(demo_ext.get("allergies", []))}

COMPRESSED CLINICAL DATA:
{clinical_ctx}

Return ONLY valid JSON:
{{
  "patient_summary": {{"age": null, "sex": "", "weight_kg": null, "height_cm": null, "bmi": null}},

  "active_conditions": [
    {{"condition": "", "severity": "", "relevance_to_medications": ""}}
  ],

  "organ_function": {{
    "renal":   {{"status": "Normal|Impaired|Unknown", "egfr_value": null, "creatinine_value": null, "notes": ""}},
    "hepatic": {{"status": "Normal|Impaired|Unknown", "alt_value": null, "ast_value": null, "notes": ""}},
    "cardiac": {{"status": "Normal|Concern|Unknown", "notes": ""}}
  }},

  "documented_allergies": [],

  "current_medications_from_graph": [
    {{"name": "", "class": "", "frequency": "", "document": ""}}
  ],

  "key_lab_values_for_safety": [
    {{"test": "", "value": "", "unit": "", "date": "", "flag": "normal|abnormal|critical"}}
  ],

  "safety_flags": [
    {{"flag_type": "renal_impairment|hepatic_impairment|age_risk|allergy|cardiac|polypharmacy|other",
      "detail": "", "severity": "low|moderate|high|critical", "source": ""}}
  ],

  "context_quality": {{
    "has_renal_data": false, "has_hepatic_data": false, "has_cardiac_data": false,
    "has_allergy_data": false, "has_weight": false, "completeness_note": ""
  }}
}}
"""
        result  = await self._invoke(system, prompt)
        elapsed = self._elapsed(t0)
        logger.info(f"{self.agent_id} · DONE ({elapsed}ms)")
        return {"patient_context": result, "timing": elapsed}


# ============================================================
# A3 — DRUG DATABASE AGENT
# (Only ever invoked when A1 found ≥1 medication in the dictation.)
# ============================================================

class DrugDatabaseAgent(BaseAgent):
    agent_id = "A3"

    async def run(self, state: MedState) -> Dict:
        logger.info(f"{self.agent_id} · DrugDatabaseAgent — START")
        t0            = datetime.now().timestamp()
        extracted     = state.get("extracted_medications") or {}
        prescriptions = extracted.get("prescriptions", [])

        if not prescriptions:
            return {"drug_database": {"resolved_drugs": [], "total": 0}, "timing": 0.0}

        drug_list = [
            {"idx": i, "name": p.get("medication",""), "generic": p.get("generic_name",""),
             "category": p.get("category",""), "strength": p.get("strength","")}
            for i, p in enumerate(prescriptions)
        ]

        system = (
            "You are a clinical pharmacology database. "
            "Resolve drug names, classifications, standard doses, and key interactions. "
            "This is NOT patient data — only drug information. Return ONLY valid JSON."
        )

        prompt = f"""
DRUGS TO RESOLVE ({len(drug_list)} items):
{json.dumps(drug_list, indent=2)}

Return ONLY valid JSON:
{{
  "resolved_drugs": [
    {{
      "idx": 0,
      "confirmed_generic_name":     "",
      "confirmed_brand_name":       "",
      "drug_class":                 "",
      "pharmacological_action":     "One sentence on mechanism",
      "standard_adult_dose":        "",
      "standard_frequency_options": [],
      "standard_duration_options":  [],
      "common_dosage_forms":        [],
      "common_routes":              [],
      "key_contraindications":      [],
      "major_drug_classes_to_avoid": [],
      "requires_renal_adjustment":   false,
      "requires_hepatic_adjustment": false,
      "requires_age_adjustment":     false,
      "narrow_therapeutic_index":    false,
      "food_interactions":           [],
      "monitoring_parameters":       [],
      "patient_counselling_points":  []
    }}
  ],
  "total": 0
}}
"""
        result  = await self._invoke(system, prompt)
        elapsed = self._elapsed(t0)
        logger.info(f"{self.agent_id} · DONE ({elapsed}ms) | resolved={result.get('total',0)}")
        return {"drug_database": result, "timing": elapsed}


# ============================================================
# A4 — SAFETY ANALYSIS AGENT
# (Only ever invoked when A1 found ≥1 medication in the dictation. Compares
#  the DICTATED medications against the patient's graph/history context.)
# ============================================================

class SafetyAnalysisAgent(BaseAgent):
    agent_id = "A4"

    async def run(self, state: MedState) -> Dict:
        logger.info(f"{self.agent_id} · SafetyAnalysisAgent — START")
        t0            = datetime.now().timestamp()
        extracted     = state.get("extracted_medications") or {}
        pt_ctx        = state.get("patient_context")       or {}
        drug_db       = state.get("drug_database")         or {}
        prescriptions = extracted.get("prescriptions", [])

        if not prescriptions:
            return {
                "safety_analysis": {
                    "safety_alerts": [],
                    "safe_rx": {
                        "principles": (
                            "Standard safe prescribing principles apply: verify indication, "
                            "confirm allergy status, adjust for renal/hepatic function, "
                            "monitor for adverse effects, and counsel the patient."
                        ),
                        "dose_personalization": {
                            "renal_adjustment":   "No medications to adjust.",
                            "hepatic_adjustment": "No medications to adjust.",
                            "weight_adjustment":  "No medications to adjust.",
                            "references": [],
                        },
                        "antibiotics_analysis": "none",
                        "issues_found": [],
                    },
                    "evidence_at_bedside":  {"summary": "No medications extracted.", "guidelines": [], "key_studies": []},
                    "overall_analysis":     "No medications found. No safety analysis performed.",
                    "interaction_matrix":   [],
                    "high_priority_alerts": 0,
                },
                "timing": 0.0,
            }

        system = (
            "You are a senior clinical pharmacist performing medication safety review. "
            "Generate evidence-based safety alerts using ONLY the patient data and prescriptions provided. "
            "Do NOT invent conditions, labs, or interactions not documented. "
            "Return ONLY valid JSON."
        )

        prompt = f"""
PRESCRIBED MEDICATIONS:
{json.dumps(prescriptions, indent=2)}

PATIENT CONTEXT (from clinical graph):
{json.dumps(pt_ctx, indent=2)}

DRUG DATABASE RESOLUTIONS:
{json.dumps(drug_db.get("resolved_drugs", []), indent=2)}

══════════════════════════════════════════════════════════
MANDATORY ALERTS (severity "moderate" minimum) if:
  • eGFR < 60 or renal impairment documented AND renally-cleared drug prescribed
  • ALT/AST > 2×ULN or liver disease AND hepatically-metabolised drug prescribed
  • Age ≥ 65 AND high-risk drug for elderly (NSAIDs, sedatives, anticoagulants)
  • Heart failure/arrhythmia AND potentially contraindicated drug
  • Two drugs from same class (duplicate therapy)
  • Drug matches documented allergy
  • HbA1c > 9% AND dose escalation of glucose-lowering drug

Alert severity: "safe" | "moderate" | "danger"
══════════════════════════════════════════════════════════

Return ONLY valid JSON:
{{
  "safety_alerts": [
    {{"medication": "", "severity": "safe|moderate|danger",
      "alert_type": "drug_drug|drug_disease|dose_adjustment|allergy|duplicate|renal|hepatic|age|other",
      "alert": "", "reason": "", "recommendation": "", "data_source": "", "references": []}}
  ],
  "interaction_matrix": [
    {{"drug_a": "", "drug_b": "", "interaction_type": "pharmacokinetic|pharmacodynamic|none",
      "severity": "none|mild|moderate|severe", "effect": "", "clinical_action": ""}}
  ],
  "safe_rx": {{
    "principles": "Standard safe prescribing principles apply: verify indication, confirm allergy status, adjust for renal/hepatic function, monitor for adverse effects, and counsel the patient.",
    "dose_personalization": {{"renal_adjustment": "", "hepatic_adjustment": "", "weight_adjustment": "", "references": []}},
    "antibiotics_analysis": "none|appropriate|inappropriate|stewardship_concern",
    "issues_found": []
  }},
  "evidence_at_bedside": {{
    "summary": "",
    "guidelines": [{{"medication": "", "guideline": "", "source": "", "year": ""}}],
    "key_studies": []
  }},
  "overall_analysis":     "",
  "high_priority_alerts": 0,
  "moderate_alerts":      0,
  "safe_medications":     0,
  "data_limitations":     ""
}}
"""
        result  = await self._invoke(system, prompt)
        elapsed = self._elapsed(t0)
        logger.info(
            f"{self.agent_id} · DONE ({elapsed}ms) | "
            f"high_alerts={result.get('high_priority_alerts',0)}"
        )
        return {"safety_analysis": result, "timing": elapsed}


# ============================================================
# A5 — PRESCRIPTION FINALIZER AGENT
# ============================================================

class PrescriptionFinalizerAgent(BaseAgent):
    agent_id = "A5"

    def _enrich(self, rx: Dict, resolved: Optional[Dict], alerts: List[Dict]) -> Dict:
        enriched = dict(rx)
        if resolved:
            if not enriched.get("generic_name"):
                enriched["generic_name"] = resolved.get("confirmed_generic_name", "")
            if not enriched.get("brand_name"):
                enriched["brand_name"] = resolved.get("confirmed_brand_name", "")
            if not enriched.get("category"):
                enriched["category"] = resolved.get("drug_class", "")
            if not enriched.get("dosage_form") and resolved.get("common_dosage_forms"):
                enriched["dosage_form"] = resolved["common_dosage_forms"][0]
            if not enriched.get("route") and resolved.get("common_routes"):
                enriched["route"] = resolved["common_routes"][0]
            if not enriched.get("standard_frequency_options"):
                enriched["standard_frequency_options"] = resolved.get("standard_frequency_options", [])
            if not enriched.get("standard_duration_options"):
                enriched["standard_duration_options"] = resolved.get("standard_duration_options", [])

        med_name = (enriched.get("medication") or "").lower()
        enriched["safety_alerts"] = [
            a for a in alerts
            if med_name and med_name in (a.get("medication") or "").lower()
        ]
        enriched["has_safety_alert"]   = bool(enriched["safety_alerts"])
        enriched["max_alert_severity"] = (
            max(
                (a.get("severity","safe") for a in enriched["safety_alerts"]),
                key=lambda s: {"safe": 0, "moderate": 1, "danger": 2}.get(s, 0),
                default="safe",
            )
            if enriched["safety_alerts"] else "safe"
        )
        for field in ("special_instructions","dosage_instructions","quantity","refills","follow_up"):
            enriched.setdefault(field, "")
        return enriched

    async def run(self, state: MedState) -> Dict:
        logger.info(f"{self.agent_id} · PrescriptionFinalizerAgent — START")
        t0            = datetime.now().timestamp()
        extracted     = state.get("extracted_medications") or {}
        drug_db       = state.get("drug_database")         or {}
        safety        = state.get("safety_analysis")       or {}
        prescriptions = extracted.get("prescriptions", [])
        resolved_map  = {r.get("idx"): r for r in drug_db.get("resolved_drugs",[]) if "idx" in r}
        alerts        = safety.get("safety_alerts", [])

        enriched = [
            self._enrich(rx, resolved_map.get(i), alerts)
            for i, rx in enumerate(prescriptions)
        ]

        safe_rx = safety.get("safe_rx", {})
        if not safe_rx.get("principles"):
            safe_rx["principles"] = (
                "Standard safe prescribing principles apply: verify indication, "
                "confirm allergy status, adjust for renal/hepatic function, "
                "monitor for adverse effects, and counsel the patient."
            )
        dose_p = safe_rx.get("dose_personalization", {})
        for field in ("renal_adjustment","hepatic_adjustment","weight_adjustment"):
            if not dose_p.get(field):
                dose_p[field] = "Insufficient clinical data available."
        safe_rx["dose_personalization"] = dose_p

        evidence = safety.get("evidence_at_bedside", {})
        if not evidence.get("summary"):
            evidence["summary"] = "No specific guideline references identified."

        result = {
            "prescriptions":        enriched,
            "total_medications":    len(enriched),
            "medications_found":    len(enriched) > 0,
            "safety_alerts":        alerts,
            "interaction_matrix":   safety.get("interaction_matrix", []),
            "high_priority_alerts": safety.get("high_priority_alerts", 0),
            "safe_rx":              safe_rx,
            "evidence_at_bedside":  evidence,
            "overall_analysis":     safety.get("overall_analysis") or (
                "Clinical data processed. No additional systemic concerns."
            ),
            "data_limitations":     safety.get("data_limitations", ""),
            "prescription_format":  extracted.get("prescription_format", ""),
            "extraction_notes":     extracted.get("extraction_notes", ""),
        }

        elapsed = self._elapsed(t0)
        logger.info(f"{self.agent_id} · DONE ({elapsed}ms) | final_rx={len(enriched)}")
        return {"final_prescription": result, "timing": elapsed}


# ============================================================
# WORKFLOW NODES
# ============================================================

async def phase_0a_node(state: MedState) -> MedState:
    """
    Phase 0A: EntityTypedGraphFetcher
    9 typed Cypher queries in parallel + demographics + graph_documents.
    Falls back to demo data if Neo4j is unavailable.
    An empty/null result here (new patient, no prior graph records) is a
    normal state, not an error — downstream phases handle it gracefully.
    """
    logger.info("Phase 0A — EntityTypedGraphFetcher + demographics + graph docs — START")
    t0      = datetime.now().timestamp()
    fetcher = EntityTypedGraphFetcher()
    fetch_error: Optional[str] = None

    try:
        typed_data, demographics, graph_docs = await asyncio.gather(
            fetcher.fetch_all(state["patient_id"]),
            fetch_patient_demographics(state["patient_id"]),
            fetch_graph_documents(state["patient_id"]),
        )
    except Exception as e:
        logger.warning(f"Phase 0A Neo4j unavailable ({e}) — loading demo data")
        typed_data   = load_demo_typed_data()
        graph_docs   = load_demo_graph_documents()
        demographics = {}
        fetch_error  = str(e)

    if isinstance(demographics, Exception):
        demographics = {}
    if isinstance(graph_docs, Exception):
        graph_docs = []

    state["typed_data"]         = typed_data or {}
    state["graph_documents"]    = graph_docs or []
    state["dob"]                = demographics.get("dob")
    state["sex"]                = demographics.get("sex")
    state["demographics_extra"] = demographics
    if fetch_error:
        state["errors"].append(f"Phase0A: {fetch_error}")

    elapsed = round((datetime.now().timestamp() - t0) * 1000, 1)
    state["agent_timings"]["Phase0A"] = elapsed
    logger.info(
        f"Phase 0A — DONE ({elapsed}ms) | "
        f"entities={sum(len(v) for v in state['typed_data'].items() if isinstance(v, list))}"
    )
    return state


async def phase_0b_node(state: MedState) -> MedState:
    """
    Phase 0B: 9 Specialist Entity Agents — ALL run in parallel.
    Each agent has its own clinical system prompt and abnormality rules.
    Results are stored in state['entity_agent_results'] for the response.
    Rows in typed_data are annotated with _llm_is_abnormal + _llm_abnormal_reason.
    """
    logger.info("Phase 0B — 9 specialist entity agents — START")
    t0 = datetime.now().timestamp()

    try:
        summaries = await run_9_entity_agents(state["typed_data"], llm_fast)
        state["entity_agent_results"] = summaries
    except Exception as e:
        logger.error(f"Phase 0B orchestrator failed: {e}")
        state["errors"].append(f"Phase0B: {str(e)}")
        state["entity_agent_results"] = {}
        # Apply fallback to all rows
        for rows in state["typed_data"].values():
            for row in rows:
                if "_llm_is_abnormal" not in row:
                    is_abn, reason = _neo4j_flag_fallback(row)
                    row["_llm_is_abnormal"]     = is_abn
                    row["_llm_abnormal_reason"] = reason

    elapsed = round((datetime.now().timestamp() - t0) * 1000, 1)
    state["agent_timings"]["Phase0B"] = elapsed
    logger.info(f"Phase 0B — DONE ({elapsed}ms)")
    return state


async def phase_0c_node(state: MedState) -> MedState:
    """
    Phase 0C: GraphPreprocessor
    Builds 9 section markdown + timeline + entity index → CompressedContext.
    Handles typed_data / graph_documents being empty gracefully (new patient).
    """
    logger.info("Phase 0C — GraphPreprocessor — START")
    t0 = datetime.now().timestamp()

    try:
        preprocessor = GraphPreprocessor()
        state["compressed_context"] = preprocessor.compress(
            state["typed_data"], state["graph_documents"]
        )
    except Exception as e:
        logger.error(f"Phase 0C GraphPreprocessor failed: {e}")
        state["errors"].append(f"Phase0C: {str(e)}")
        state["compressed_context"] = None

    elapsed = round((datetime.now().timestamp() - t0) * 1000, 1)
    state["agent_timings"]["Phase0C"] = elapsed
    ctx = state.get("compressed_context")
    logger.info(
        f"Phase 0C — DONE ({elapsed}ms) | "
        f"token_est={ctx.get('token_estimate', 0) if ctx else 0}"
    )
    return state


async def a1_extract_node(state: MedState) -> MedState:
    """
    A1 — MedicationExtractorAgent, run ALONE (not in a parallel group).

    This is deliberately isolated from A2/A3 so that `route_after_extraction`
    can gate the rest of the pipeline on its result: if the DICTATION
    (prescription_text) contains no medications, nothing downstream should
    run — not patient-context lookup, not drug-database resolution, and
    definitely not a safety analysis that could imply "everything is safe"
    for medications that were never actually prescribed in this dictation.

    A1's run() already applies _clean_extracted_prescriptions() internally,
    so `extracted_medications["prescriptions"]` stored here is guaranteed to
    contain only rows with a real medication name — never blank/placeholder
    rows echoed from the JSON schema.
    """
    logger.info("A1 — MedicationExtractorAgent (gating node) — START")
    t0 = datetime.now().timestamp()

    try:
        result = await MedicationExtractorAgent(llm_fast).run(dict(state))
        state["agent_timings"]["A1"]           = result.get("timing", 0.0)
        state["extracted_medications"]         = result.get("extracted_medications", {})
    except Exception as e:
        logger.error(f"A1 failed: {e}")
        state["errors"].append(f"A1: {str(e)}")
        state["extracted_medications"] = {}

    elapsed = round((datetime.now().timestamp() - t0) * 1000, 1)
    logger.info(f"A1 — DONE ({elapsed}ms)")
    return state


def route_after_extraction(state: MedState) -> str:
    """
    Gate: only proceed to patient-context / drug-database / safety-analysis
    if the DICTATION (prescription_text) itself contained at least one REAL
    medication.

    Graph/history data (typed_data, compressed_context, graph_documents) is
    PATIENT HISTORY used only to cross-check dictated medications for safety.
    It is never itself a medication source, and it is normal/expected for it
    to be null or empty (e.g. a brand-new patient) — that alone must never
    trigger a safety analysis or generate alerts.

    Defense in depth: even though A1 already cleans out blank/placeholder
    rows via _clean_extracted_prescriptions(), this router re-validates with
    _has_real_medication() before deciding the route, so a false "has
    medications" branch can never be triggered by a stray empty-string row.
    """
    extracted     = state.get("extracted_medications") or {}
    prescriptions = [
        rx for rx in extracted.get("prescriptions", [])
        if isinstance(rx, dict) and _has_real_medication(rx)
    ]
    if prescriptions:
        logger.info(
            f"Router: {len(prescriptions)} real medication(s) found in dictation "
            "— continuing to patient-context / drug-database / safety-analysis"
        )
        return "has_medications"
    logger.info(
        "Router: NO real medications found in the dictation — skipping A2/A3/A4 "
        "entirely and short-circuiting to an empty result"
    )
    return "no_medications"


async def parallel_a2_a3_node(state: MedState) -> MedState:
    """
    A2 (patient/history context) + A3 (drug database resolution), in parallel.
    Only ever reached when A1 found ≥1 real medication in the dictation.
    """
    logger.info("Parallel group (A2 + A3) — START")
    t0 = datetime.now().timestamp()

    results = await asyncio.gather(
        PatientContextAgent(llm_synthesis).run(dict(state)),
        DrugDatabaseAgent(llm_synthesis).run(dict(state)),
        return_exceptions=True,
    )

    for i, (name, key) in enumerate(
        [("A2", "patient_context"), ("A3", "drug_database")]
    ):
        result = results[i]
        if isinstance(result, Exception):
            logger.error(f"{name} failed: {result}")
            state["errors"].append(f"{name}: {str(result)}")
            state[key] = {}
        else:
            state["agent_timings"][name] = result.get("timing", 0.0)
            state[key] = result.get(key, {})

    elapsed = round((datetime.now().timestamp() - t0) * 1000, 1)
    logger.info(f"Parallel group (A2+A3) — DONE ({elapsed}ms)")
    return state


async def a4_safety_node(state: MedState) -> MedState:
    """Only ever reached when A1 found ≥1 real medication in the dictation."""
    try:
        result = await SafetyAnalysisAgent(llm_synthesis).run(dict(state))
        state["agent_timings"]["A4"] = result.get("timing", 0.0)
        state["safety_analysis"]     = result.get("safety_analysis", {})
    except Exception as e:
        logger.error(f"A4 failed: {e}")
        state["errors"].append(f"A4: {str(e)}")
        state["safety_analysis"] = {}
    return state


async def a5_finalizer_node(state: MedState) -> MedState:
    """A5 — PrescriptionFinalizerAgent. Only reached on the has-medications branch."""
    logger.info("A5 — PrescriptionFinalizerAgent — START")
    t0 = datetime.now().timestamp()

    try:
        result = await PrescriptionFinalizerAgent(llm_synthesis).run(dict(state))
        state["agent_timings"]["A5"] = result.get("timing", 0.0)
        state["final_prescription"]  = result.get("final_prescription", {})
    except Exception as e:
        logger.error(f"A5 failed: {e}")
        state["errors"].append(f"A5: {str(e)}")
        state["final_prescription"] = {}

    elapsed = round((datetime.now().timestamp() - t0) * 1000, 1)
    logger.info(f"A5 — DONE ({elapsed}ms)")
    return state


async def a5_empty_finalizer_node(state: MedState) -> MedState:
    """
    Short-circuit finalizer used ONLY when the dictation (prescription_text)
    contains NO real medications.

    In this branch:
      - A2 (patient context), A3 (drug database), and A4 (safety analysis)
        never ran — there is nothing to check safety for.
      - Graph/patient-history data is NEVER substituted in as "medications";
        it stays context-only and is simply irrelevant here.
      - The response explicitly communicates that no medications were
        dictated, instead of implying a "safe" or "no issues" analysis was
        performed on anything.
    """
    logger.info("A5 (empty) — no medications in dictation — building empty result")
    t0 = datetime.now().timestamp()

    extracted = state.get("extracted_medications") or {}
    result = {
        "prescriptions":        [],
        "total_medications":    0,
        "medications_found":    False,
        "safety_alerts":        [],
        "interaction_matrix":   [],
        "high_priority_alerts": 0,
        "safe_rx": {
            "principles": (
                "No medications were found in the doctor's dictation/prescription text. "
                "No medication safety analysis was performed."
            ),
            "dose_personalization": {
                "renal_adjustment":   "Not applicable — no medications dictated.",
                "hepatic_adjustment": "Not applicable — no medications dictated.",
                "weight_adjustment":  "Not applicable — no medications dictated.",
                "references": [],
            },
            "antibiotics_analysis": "none",
            "issues_found": [],
        },
        "evidence_at_bedside": {
            "summary": "No medications dictated — no evidence lookup performed.",
            "guidelines": [],
            "key_studies": [],
        },
        "overall_analysis": (
            "The dictated prescription text did not contain any medications. "
            "Patient history / graph data is used only to cross-check dictated "
            "medications and is never itself treated as a medication source, "
            "so no safety analysis was run for this request."
        ),
        "data_limitations": "",
        "prescription_format": extracted.get("prescription_format", ""),
        "extraction_notes":    extracted.get("extraction_notes", ""),
    }

    state["patient_context"]    = state.get("patient_context")    or {}
    state["drug_database"]      = state.get("drug_database")      or {}
    state["safety_analysis"]    = state.get("safety_analysis")    or {}
    state["final_prescription"] = result

    elapsed = round((datetime.now().timestamp() - t0) * 1000, 1)
    state["agent_timings"]["A5"] = elapsed
    logger.info(f"A5 (empty) — DONE ({elapsed}ms)")
    return state


# ============================================================
# WORKFLOW GRAPH  (v4.1.1)
# Phase0A → Phase0B → Phase0C → a1_extract
#     ├─[dictation has real meds]──→ parallel_a2_a3 → a4_safety → a5_finalizer → END
#     └─[dictation has NO meds]────────────────────────────────→ a5_empty_finalizer → END
# ============================================================

def create_medication_workflow() -> Any:
    workflow = StateGraph(MedState)

    workflow.add_node("phase_0a",           phase_0a_node)
    workflow.add_node("phase_0b",           phase_0b_node)
    workflow.add_node("phase_0c",           phase_0c_node)
    workflow.add_node("a1_extract",         a1_extract_node)
    workflow.add_node("parallel_a2_a3",     parallel_a2_a3_node)
    workflow.add_node("a4_safety",          a4_safety_node)
    workflow.add_node("a5_finalizer",       a5_finalizer_node)
    workflow.add_node("a5_empty_finalizer", a5_empty_finalizer_node)

    workflow.set_entry_point("phase_0a")
    workflow.add_edge("phase_0a", "phase_0b")
    workflow.add_edge("phase_0b", "phase_0c")
    workflow.add_edge("phase_0c", "a1_extract")

    # Gate: only continue to context/drug-db/safety-analysis if the dictation
    # itself contained at least one REAL medication (see _has_real_medication).
    workflow.add_conditional_edges(
        "a1_extract",
        route_after_extraction,
        {
            "has_medications": "parallel_a2_a3",
            "no_medications":  "a5_empty_finalizer",
        },
    )

    workflow.add_edge("parallel_a2_a3",     "a4_safety")
    workflow.add_edge("a4_safety",          "a5_finalizer")
    workflow.add_edge("a5_finalizer",       END)
    workflow.add_edge("a5_empty_finalizer", END)

    return workflow.compile()


medication_workflow = create_medication_workflow()


# ============================================================
# DEMO PRESCRIPTIONS
# ============================================================

DEMO_PRESCRIPTION_FORMAT_A = """
Start Metformin 500mg twice daily with meals for type 2 diabetes.
Prescribe Amlodipine 5mg once daily for blood pressure.
Add Atorvastatin 20mg once at night for cholesterol.
Give Pantoprazole 40mg once daily before breakfast.
"""

DEMO_PRESCRIPTION_FORMAT_B = """
TREATMENT PROTOCOL — Hypertension & Metabolic Syndrome

PRIMARY GOALS:
- Achieve BP < 130/80 mmHg
- Optimise lipid profile

• Amlodipine
  - Dose: 5mg
  - Frequency: Once daily (morning)
  - Indication: Hypertension

• Atorvastatin
  - Dose: 20mg
  - Frequency: Once at night
  - Indication: Dyslipidaemia

LIFESTYLE MODIFICATIONS:
- Maintain a low-sodium diet
- Schedule 30 minutes of walking daily

INVESTIGATIONS:
- Lipid Profile at 3 months
- KFT at 6 months
"""

# A dictation with NO medications at all — used to sanity-check the gate.
# Only lifestyle advice / follow-up plan, nothing prescribed. The patient's
# graph history (Phase 0A/0B/0C) may still contain past medications like
# Metformin/Insulin — that must NOT leak into this result or trigger any
# safety alert.
DEMO_PRESCRIPTION_NO_MEDS = """
Discussed lifestyle modification including low-sodium diet and daily walking.
Advised to monitor blood pressure at home twice weekly.
Follow up in clinic in 4 weeks with repeat lipid profile and KFT.
No new medications started today.
"""


# ============================================================
# API ENDPOINTS
# ============================================================

@router.post("/medication-agent")
async def run_medication_agent(request: MedicationRequest):
    """
    MedScript v4.1.1 — 9-Agent Specialist Entity Assessment Pipeline +
    Dictation-Only Medication Gate (hardened).

    Phase 0A: EntityTypedGraphFetcher  — 9 typed Cypher queries in parallel
    Phase 0B: 9 Specialist Entity Agents (ALL in parallel):
              DiagnosisAgent | LabAbnormalityAgent | VitalSignAgent | MedicationAgent
              FindingAgent   | ProcedureAgent     | MeasurementAgent | AnatomyAgent | SymptomAgent
    Phase 0C: GraphPreprocessor        — 9-section markdown + timeline + entity index
    A1:       MedicationExtractorAgent — DICTATION ONLY. Gates the rest of the pipeline:
                if the dictation has no REAL medications, A2/A3/A4 are skipped entirely.
                A code-level filter (_clean_extracted_prescriptions /
                _has_real_medication) prevents a blank/placeholder LLM row from
                ever falsely opening the safety-analysis branch.
    A2+A3:    Parallel — patient/history context / drug DB (only if A1 found real meds)
    A4:       Safety analysis, dictated meds vs. graph/history (only if A1 found real meds)
    A5:       Finalised prescription output (real, or an explicit empty result)
    """
    start_ms = datetime.now().timestamp() * 1000
    logger.info(
        f"MedScript v4.1.1 | patient={request.patient_id} | "
        f"doctor={request.doctor_id} | len={len(request.prescription_text)}"
    )

    if not request.prescription_text.strip():
        raise HTTPException(
            status_code=400,
            detail="prescription_text is required and cannot be empty.",
        )

    initial_state = MedState(
        patient_id=request.patient_id,
        doctor_id=request.doctor_id,
        prescription_text=request.prescription_text,
        dob=None, sex=None, demographics_extra={},
        typed_data={}, graph_documents=[],
        entity_agent_results={},
        compressed_context=None,
        extracted_medications=None, patient_context=None,
        drug_database=None, safety_analysis=None,
        final_prescription=None,
        errors=[], agent_timings={},
    )

    try:
        result  = await medication_workflow.ainvoke(initial_state)
        elapsed = round(datetime.now().timestamp() * 1000 - start_ms)

        final      = result.get("final_prescription")    or {}
        pt_ctx     = result.get("patient_context")       or {}
        ctx        = result.get("compressed_context")    or {}
        typed_data = result.get("typed_data", {})

        # Persist
        try:
            await med_store.insert_one({
                "patient_id":           request.patient_id,
                "doctor_id":            request.doctor_id,
                "generated_at":         datetime.utcnow(),
                "processing_time_ms":   elapsed,
                "total_medications":    final.get("total_medications", 0),
                "high_priority_alerts": final.get("high_priority_alerts", 0),
                "version":              "4.1.1",
                "prescriptions":        final.get("prescriptions",  []),
                "safety_alerts":        final.get("safety_alerts",  []),
            })
        except Exception as e:
            logger.error(f"MongoDB save failed: {e}")

        # Entity type stats from Phase 0B agents
        entity_agent_stats = result.get("entity_agent_results", {})
        entity_type_stats  = {
            etype: {
                "total":       len(rows),
                "abnormal":    sum(1 for r in rows if r.get("_llm_is_abnormal")),
                "normal":      sum(1 for r in rows if not r.get("_llm_is_abnormal")),
                "assessed_by": "specialist_agent",
                "agent_id":    entity_agent_stats.get(etype, {}).get("agent_id", "unknown"),
            }
            for etype, rows in typed_data.items()
        }

        response: Dict[str, Any] = {
            "patient_id":         request.patient_id,
            "doctor_id":          request.doctor_id,
            "generated_at":       datetime.now().isoformat(),
            "processing_time_ms": elapsed,
            "version":            "4.1.1",
            "agent_timings":      result.get("agent_timings", {}),
            "errors":             result.get("errors", []),

            # ── Primary output ────────────────────────────────────
            "prescriptions":       final.get("prescriptions",       []),
            "total_medications":   final.get("total_medications",   0),
            "medications_found":   final.get("medications_found",   False),
            "prescription_format": final.get("prescription_format", ""),
            "extraction_notes":    final.get("extraction_notes",    ""),

            # ── Safety ────────────────────────────────────────────
            "safety": {
                "alerts":               final.get("safety_alerts",        []),
                "interaction_matrix":   final.get("interaction_matrix",   []),
                "high_priority_alerts": final.get("high_priority_alerts", 0),
                "safe_rx":              final.get("safe_rx",              {}),
                "evidence_at_bedside":  final.get("evidence_at_bedside",  {}),
                "overall_analysis":     final.get("overall_analysis",     ""),
                "data_limitations":     final.get("data_limitations",     ""),
            },

            # ── Patient context summary ───────────────────────────
            "patient_context_summary": {
                "active_conditions":         pt_ctx.get("active_conditions",         []),
                "organ_function":            pt_ctx.get("organ_function",            {}),
                "documented_allergies":      pt_ctx.get("documented_allergies",      []),
                "safety_flags":              pt_ctx.get("safety_flags",              []),
                "key_lab_values_for_safety": pt_ctx.get("key_lab_values_for_safety", []),
                "context_quality":           pt_ctx.get("context_quality",           {}),
            },

            # ── Phase 0B agent summaries ──────────────────────────
            "entity_agent_summaries": entity_agent_stats,

            # ── Graph stats ───────────────────────────────────────
            "graph_stats": {
                "total_entities":            ctx.get("total_entities",        0),
                "abnormal_entities":         ctx.get("abnormal_entity_count", 0),
                "total_documents":           ctx.get("total_documents",       0),
                "confirmed_diagnoses_count": len(ctx.get("confirmed_diagnoses", [])),
                "token_estimate":            ctx.get("token_estimate",        0),
                "date_range":                ctx.get("date_range",            {}),
                "entity_type_stats":         entity_type_stats,
            },
        }

        if request.include_intermediates:
            response["intermediate"] = {
                "extracted_medications_raw": result.get("extracted_medications"),
                "patient_context_raw":       result.get("patient_context"),
                "drug_database_raw":         result.get("drug_database"),
                "safety_analysis_raw":       result.get("safety_analysis"),
                "entity_agent_results":      entity_agent_stats,
                "llm_abnormality_annotations": {
                    etype: [
                        {
                            "name":        r.get("name","?"),
                            "is_abnormal": r.get("_llm_is_abnormal"),
                            "reason":      r.get("_llm_abnormal_reason"),
                            "agent":       entity_agent_stats.get(etype,{}).get("agent_id","?"),
                        }
                        for r in rows
                    ]
                    for etype, rows in typed_data.items()
                },
                "compressed_md_diagnoses":   ctx.get("md_diagnoses",   ""),
                "compressed_md_labs":        ctx.get("md_labs",         ""),
                "compressed_md_vitals":      ctx.get("md_vitals",       ""),
                "compressed_md_medications": ctx.get("md_medications",  ""),
                "compressed_md_findings":    ctx.get("md_findings",     ""),
                "compressed_md_timeline":    ctx.get("md_timeline",     ""),
                "entity_index_size":         len(ctx.get("entity_index", {})),
            }

        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(
            f"MedScript v4.1.1 pipeline failed | patient={request.patient_id} | {e}"
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/medication-agent/demo")
async def run_medication_demo():
    return await run_medication_agent(MedicationRequest(
        patient_id="PAT-235aeb6f-3c57-48b4-8140-f545c7c52417",
        doctor_id="DOC-dcf818e8-a3e0-427a-b935-98b6f602699c",
        prescription_text=DEMO_PRESCRIPTION_FORMAT_A,
        include_intermediates=True,
    ))


@router.get("/medication-agent/demo-protocol")
async def run_medication_demo_protocol():
    return await run_medication_agent(MedicationRequest(
        patient_id="PAT-235aeb6f-3c57-48b4-8140-f545c7c52417",
        doctor_id="DOC-dcf818e8-a3e0-427a-b935-98b6f602699c",
        prescription_text=DEMO_PRESCRIPTION_FORMAT_B,
        include_intermediates=True,
    ))


@router.get("/medication-agent/demo-no-meds")
async def run_medication_demo_no_meds():
    """Sanity-check endpoint: dictation with zero medications → gate should
    short-circuit, A2/A3/A4 should not run, and total_medications should be 0
    with medications_found=false, regardless of what the graph/history holds
    (the demo patient's graph history includes Metformin + Insulin Glargine —
    those must NOT appear in the response and must NOT trigger any alert)."""
    return await run_medication_agent(MedicationRequest(
        patient_id="PAT-235aeb6f-3c57-48b4-8140-f545c7c52417",
        doctor_id="DOC-dcf818e8-a3e0-427a-b935-98b6f602699c",
        prescription_text=DEMO_PRESCRIPTION_NO_MEDS,
        include_intermediates=True,
    ))


@router.get("/medication-agent/health")
async def medication_agent_health():
    return {
        "status":      "ok",
        "version":     "4.1.1",
        "system_name": "MedScript — Medication Agentic Workflow",
        "pipeline": [
            "Phase 0A — EntityTypedGraphFetcher    [9 typed Cypher queries in parallel + fallback]",
            "Phase 0B — 9 Specialist Entity Agents [ALL in parallel, fast LLM]:",
            "           DiagnosisAgent             [auto-abnormal, no LLM]",
            "           LabAbnormalityAgent         [reference range + critical value rules]",
            "           VitalSignAgent              [NICE/AHA threshold assessment]",
            "           MedicationAgent             [drug class significance triage]",
            "           FindingAgent                [structural/pathological/oncological]",
            "           ProcedureAgent              [pathological indication check]",
            "           MeasurementAgent            [tumour size, BMI, organ size]",
            "           AnatomyAgent                [pathological involvement check]",
            "           SymptomAgent                [auto-abnormal, no LLM]",
            "Phase 0C — GraphPreprocessor           [9-section markdown + timeline + entity index]",
            "A1 [fast] — MedicationExtractorAgent   [DICTATION ONLY; gates rest of pipeline; "
            "code-level blank/placeholder filter]",
            "ROUTER    — route_after_extraction     [no REAL meds in dictation → skip straight to A5-empty]",
            "A2        — PatientContextAgent        [graph/history → safety context; skipped if no meds]",
            "A3        — DrugDatabaseAgent          [pharmacology resolution; skipped if no meds]",
            "A4        — SafetyAnalysisAgent        [dictated meds vs graph/history; skipped if no meds]",
            "A5        — PrescriptionFinalizerAgent [enriched output, or explicit empty result]",
        ],
        "parallel_groups": {
            "phase_0b": [
                "DiagnosisAgent", "LabAbnormalityAgent", "VitalSignAgent",
                "MedicationAgent", "FindingAgent", "ProcedureAgent",
                "MeasurementAgent", "AnatomyAgent", "SymptomAgent",
            ],
            "group_1": ["A2", "A3"],
        },
        "sequential":    ["Phase0A", "Phase0B", "Phase0C", "A1", "route_after_extraction",
                          "group_1 (if meds)", "A4 (if meds)", "A5"],
        "auto_abnormal": ["DiagnosisAgent (all diagnoses)", "SymptomAgent (all symptoms)"],
        "llm_assessed":  ["LabAbnormalityAgent", "VitalSignAgent", "MedicationAgent",
                          "FindingAgent", "ProcedureAgent", "MeasurementAgent", "AnatomyAgent"],
        "design_principles": [
            "Each entity type has its own dedicated specialist agent with tailored clinical rules",
            "All 9 Phase 0B agents run in parallel for maximum throughput",
            "Diagnoses and symptoms auto-flagged without LLM call (always clinically significant)",
            "Each agent has specialised SYSTEM_PROMPT and CLINICAL_RULES",
            "Medications extracted ONLY from prescription_text (the dictation) — never from graph",
            "Graph/history data is used ONLY as context to cross-check dictated medications — "
            "it is never treated as a medication source, and it may legitimately be null/empty",
            "If the dictation has zero REAL medications, A2/A3/A4 do not run at all — no safety "
            "analysis, no 'everything is safe' filler is produced",
            "A code-level filter (_clean_extracted_prescriptions / _has_real_medication) strips "
            "blank/placeholder LLM rows so a schema-template echo can never falsely open the "
            "safety-analysis branch — this is enforced in Python, not just in the prompt",
            "Zero hallucination — no medications invented if not in the dictation",
            "neo4j_flag_fallback applied per-batch if any Phase 0B LLM call fails",
        ],
        "entity_agent_registry": list(ENTITY_AGENT_REGISTRY.keys()),
    }


# ============================================================
# ENTRYPOINT
# ============================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "medication_agent_v4:app",
        host="0.0.0.0",
        port=8002,
        reload=False,
        log_level="info",
    )