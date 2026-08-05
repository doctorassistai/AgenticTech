"""
CCGI Progress Tracking Agent — v1.2
=================================================

Changelog v1.2:
  • Added RadiologyDoctorViewAgent  — enriched radiology narrative for doctors
  • Added VitalsDoctorViewAgent     — enriched vitals narrative for doctors
  • Added LabDoctorViewAgent        — enriched lab narrative for doctors
  • All three doctor-view agents run in parallel after the three extractor passes
  • /clinical-progress response now includes doctor_view block with all three outputs
  • New /clinical-progress/doctor-view endpoint accepts pre-computed trend arr

All dependencies are defined directly in this file.
No external sibling-module imports required.

Architecture:
  ProgressTrackingAgent (A_PROG)
    ├── _extract_labs()            → structured lab timeline with trends
    ├── _extract_radiology()       → lesion measurements + progression
    └── _extract_vitals()          → vitals timeline + stability
    [all three run in parallel — Pass 1]

  Doctor View Agents (Pass 2 — parallel, fed by Pass 1 outputs):
    ├── RadiologyDoctorViewAgent   → imaging progression narrative + MDT summary
    ├── VitalsDoctorViewAgent      → physiological status narrative + fitness assessment
    └── LabDoctorViewAgent         → lab trend narrative + clinical interpretation

Integration options
-------------------
  Option A  — Insert before A9 in the main pipeline:
    workflow.add_edge("A4", "A_PROG")
    workflow.add_edge("A_PROG", "A5_A8_PARALLEL")

  Option B  — Run standalone via /clinical-progress endpoint
    (does NOT require the full 13-agent pipeline)

  Option C  — Doctor view only (pre-computed trends as input):
    POST /clinical-progress/doctor-view
    {
      "patient_id":       "PAT-...",
      "doctor_id":        "DOC-...",
      "specialty":        "Oncology",
      "lab_trends":       [...],
      "radiology_trends": [...],
      "vitals_trends":    [...]
    }
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
from neo4j import AsyncGraphDatabase
from pydantic import BaseModel

from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage


# ============================================================
# ENVIRONMENT CONFIGURATION
# ============================================================

GROQ_API_KEY  = os.getenv("GROQ_API_KEY")
NEO4J_URI = os.getenv("NEO4J_URI")
NEO4J_USER = os.getenv("NEO4J_USER")
NEO4J_PASS = os.getenv("NEO4J_PASSWORD")
MONGO_URI     = os.getenv("MONGO_URI")
MONGO_DB_NAME = "doctorassistai"

neo4j_driver = AsyncGraphDatabase.driver(
    NEO4J_URI,
    auth=(NEO4J_USER, NEO4J_PASS),
    max_connection_lifetime=3600,
    max_connection_pool_size=50,
)

mongo_client = AsyncIOMotorClient(MONGO_URI)
mongo_db     = mongo_client[MONGO_DB_NAME]

# Primary reasoning LLM (fast)
llm = ChatGroq(
    model="llama-3.1-8b-instant",
    temperature=0.2,
    max_tokens=5000,
    groq_api_key=GROQ_API_KEY,
)

# Higher-quality LLM for synthesis layers
llm_synthesis = ChatGroq(
    model="llama-3.3-70b-versatile",
    temperature=0.1,
    max_tokens=5000,
    groq_api_key=GROQ_API_KEY,
)


# ============================================================
# SHARED PYDANTIC REQUEST MODEL
# ============================================================

class ClinicalRequest(BaseModel):
    patient_id:            str
    doctor_id:             str
    consultation_text:     str
    specialty:             str
    include_intermediates: bool = False


# ============================================================
# CLINICAL STATE (TypedDict — shared with main pipeline)
# ============================================================

class ClinicalState(TypedDict):
    patient_id:            str
    doctor_id:             str
    consultation_text:     str
    specialty:             str
    graph_documents:       List[Dict]
    disease_context:       Optional[Dict]
    anchor_schema:         Optional[Dict]
    oncology_anchor:       Optional[Dict]
    structured_graph:      Optional[str]
    timeline:              Optional[str]
    organ_analysis:        Optional[str]
    disease_causation:     Optional[str]
    evidence_quality:      Optional[str]
    signal_importance:     Optional[str]
    treatment_context:     Optional[str]
    missing_information:   Optional[str]
    clinical_insights:     Optional[str]
    clinical_summary:      Optional[str]
    summary_paragraph_1:   Optional[str]
    summary_paragraph_2:   Optional[str]
    reasoning_score:       Optional[str]
    learned_patterns:      Optional[str]
    diagnostic_confidence: Optional[Dict]
    dob:                   Optional[str]
    sex:                   Optional[str]
    # Progress tracking output (written by A_PROG)
    progress_tracking:     Optional[Dict]
    errors:                List[str]
    agent_timings:         Dict[str, float]


# ============================================================
# JSON PARSER UTILITY
# ============================================================

def parse_llm_json(text: str) -> Dict:
    """Strip markdown fences and extract the first JSON object from LLM output."""
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


# ============================================================
# BASE AGENT
# ============================================================

class BaseAgent:
    def __init__(self, llm_instance):
        self.llm = llm_instance

    async def _invoke(self, system: str, user: str) -> Dict:
        response = await self.llm.ainvoke([
            SystemMessage(content=system),
            HumanMessage(content=user),
        ])
        return parse_llm_json(response.content)

    def _elapsed(self, start: float) -> float:
        return round((datetime.now().timestamp() - start) * 1000, 1)


# ============================================================
# NEO4J GRAPH FETCH
# ============================================================

async def fetch_patient_graph_documents(patient_id: str) -> List[Dict]:
    """
    Fetch all clinical graph documents for a patient from Neo4j,
    ordered chronologically by document date.
    """
    cypher = """
    MATCH (p:Patient {patient_id: $patient_id})-[r]->(n)
    OPTIONAL MATCH (n)-[:SUPPORTED_BY_EVIDENCE]->(e:Evidence)

    WITH r, n, e,
        CASE
            WHEN e IS NULL OR e.document_date IS NULL OR e.document_date = "null"
            THEN NULL
            ELSE toString(e.document_date)
        END AS raw_date,
        coalesce(e.document_name, "unknown") AS document

    WITH r, n, e, document, raw_date,
        CASE
            WHEN raw_date IS NULL THEN NULL
            WHEN raw_date =~ '\\d{4}-\\d{2}-\\d{2}'
            THEN date(raw_date)
            WHEN raw_date =~ '\\d{2}-\\d{2}-\\d{4}'
            THEN date({
                year:  toInteger(split(raw_date,'-')[2]),
                month: toInteger(split(raw_date,'-')[1]),
                day:   toInteger(split(raw_date,'-')[0])
            })
            WHEN raw_date =~ '\\d{2}-[A-Za-z]{3}-\\d{4}'
            THEN date({
                year:  toInteger(split(raw_date,'-')[2]),
                month: CASE split(raw_date,'-')[1]
                    WHEN 'Jan' THEN 1 WHEN 'Feb' THEN 2 WHEN 'Mar' THEN 3
                    WHEN 'Apr' THEN 4 WHEN 'May' THEN 5 WHEN 'Jun' THEN 6
                    WHEN 'Jul' THEN 7 WHEN 'Aug' THEN 8 WHEN 'Sep' THEN 9
                    WHEN 'Oct' THEN 10 WHEN 'Nov' THEN 11 WHEN 'Dec' THEN 12
                    ELSE NULL END,
                day: toInteger(split(raw_date,'-')[0])
            })
            ELSE NULL
        END AS document_date

    WITH document, document_date,
        collect({
            relation: type(r),
            entity_type: CASE
                WHEN n:Treatment    THEN "Treatment"
                WHEN n:Procedure    THEN "Procedure"
                WHEN n:Diagnosis    THEN "Diagnosis"
                WHEN n:Medication   THEN "Medication"
                WHEN n:LabResult    THEN "Lab Result"
                WHEN n:VitalSign    THEN "Vital Sign"
                WHEN n:Finding      THEN "Finding"
                WHEN n:Anatomy      THEN "Anatomy"
                WHEN n:Measurement  THEN "Measurement"
                ELSE head(labels(n))
            END,
            name: coalesce(
                n.name, n.details, n.description,
                n.drug_name, n.test_name, n.vital_type, n.value
            ),
            date:     raw_date,
            evidence: e.evidence_text
        }) AS entities

    RETURN document, document_date, entities
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
            logger.info(f"Graph fetch: {len(docs)} documents for patient {patient_id}")
            return docs
    except Exception as e:
        logger.error(f"Neo4j fetch failed for patient {patient_id}: {e}")
        raise


# ============================================================
# DEMO DATA LOADER
# ============================================================

def load_demo_graph_documents() -> List[Dict]:
    return [
        {
            "document": "demo-document-001.pdf",
            "document_date": "2025-10-01",
            "entities": [
                {
                    "relation": "HAS_SYMPTOM",
                    "entity_type": "Symptom",
                    "name": "Hematuria",
                    "date": "2025-10-01",
                    "evidence": "Clinical details: Hematuria.",
                },
                {
                    "relation": "HAS_FINDING",
                    "entity_type": "Finding",
                    "name": "Mild diffuse urinary bladder wall thickening",
                    "date": "2025-10-01",
                    "evidence": "Mild diffuse urinary bladder wall thickening with peri-vesical fat stranding.",
                },
            ],
        },
        {
            "document": "demo-document-002.pdf",
            "document_date": "2026-01-06",
            "entities": [
                {
                    "relation": "HAS_PROCEDURE",
                    "entity_type": "Procedure",
                    "name": "Histopathological examination (TURBT specimen)",
                    "date": "2026-01-06",
                    "evidence": "Bulk of resection, Deep resection, Random biopsy specimens analyzed.",
                },
                {
                    "relation": "HAS_DIAGNOSIS",
                    "entity_type": "Diagnosis",
                    "name": "Transitional cell carcinoma grade 3 infiltrating muscle bundles",
                    "date": "2026-01-06",
                    "evidence": "Transitional cell carcinoma grade 3 infiltrating muscle bundles.",
                },
            ],
        },
    ]


# ============================================================
# PYDANTIC MODELS — progress endpoint
# ============================================================

class ProgressRequest(BaseModel):
    patient_id:              str
    doctor_id:               str
    specialty:               str = "General Medicine"
    include_raw_extractions: bool = False


class TrendPoint(BaseModel):
    date:            Optional[str]
    value:           Optional[str]
    unit:            Optional[str]
    source_document: Optional[str]
    notes:           Optional[str] = None


class TrendSeries(BaseModel):
    parameter:        str
    category:         str            # "lab" | "radiology" | "vitals"
    subcategory:      Optional[str]
    data_points:      List[TrendPoint]
    direction:        str
    direction_symbol: str
    clinical_flag:    str
    flag_rationale:   str
    first_value:      Optional[str]
    latest_value:     Optional[str]
    change_summary:   str


# ── Doctor-view Pydantic output models ──────────────────────────────────────

class RadiologyDoctorView(BaseModel):
    """Structured radiology narrative for doctor consumption."""
    specialty:                   str
    generated_at:                str
    lesion_interpretations:      List[Dict]
    overall_response_assessment: str   # CR|PR|SD|PD|NE|INSUFFICIENT_DATA
    recist_summary:              str
    structural_findings_summary: str
    mdt_radiology_paragraph:     str
    urgent_radiology_actions:    List[Dict]   # [{action, rationale, timeframe}]
    next_imaging_recommendation: Dict         # {modality, suggested_timeframe, clinical_question}
    interpretation_confidence:   str          # High|Moderate|Low
    confidence_rationale:        str


class VitalsDoctorView(BaseModel):
    """Structured vitals / physiological narrative for doctor consumption."""
    specialty:                     str
    generated_at:                  str
    parameter_interpretations:     List[Dict]
    cardiac_fitness_summary:       Dict
    functional_reserve_assessment: str    # GOOD|MODERATE|POOR|NOT_ASSESSABLE
    functional_reserve_rationale:  str
    treatment_tolerance:           Dict
    deteriorating_parameters:      List[Dict]
    mdt_vitals_paragraph:          str
    monitoring_recommendations:    List[Dict]
    interpretation_confidence:     str
    confidence_rationale:          str


class LabDoctorView(BaseModel):
    """Structured lab narrative for doctor consumption."""
    specialty:                    str
    generated_at:                 str
    parameter_interpretations:    List[Dict]
    organ_system_lab_summaries:   List[Dict]
    critical_lab_values:          List[Dict]
    tumour_marker_assessment:     Optional[Dict]
    improving_parameters:         List[str]
    worsening_parameters:         List[str]
    stable_parameters:            List[str]
    missing_labs_clinical_impact: List[Dict]
    mdt_lab_paragraph:            str
    overall_lab_status:           str   # STABLE|CONCERN|CRITICAL|MIXED|INSUFFICIENT_DATA
    interpretation_confidence:    str
    confidence_rationale:         str


class DoctorViewRequest(BaseModel):
    """
    Request model for the standalone /clinical-progress/doctor-view endpoint.
    Accepts pre-computed trend arrays — does NOT require re-running extractors.
    """
    patient_id:       str
    doctor_id:        str
    specialty:        str = "General Medicine"
    lab_trends:       List[Dict]
    radiology_trends: List[Dict]
    vitals_trends:    List[Dict]


class DoctorViewOutput(BaseModel):
    patient_id:         str
    doctor_id:          str
    specialty:          str
    generated_at:       str
    processing_time_ms: int
    radiology:          Optional[RadiologyDoctorView]
    vitals:             Optional[VitalsDoctorView]
    labs:               Optional[LabDoctorView]


class ProgressOutput(BaseModel):
    patient_id:         str
    doctor_id:          str
    generated_at:       str
    documents_analyzed: int
    processing_time_ms: int

    # CEO / summary view
    overall_status:   str
    headline_summary: str
    critical_flags:   List[str]

    # Doctor view — raw trend series
    radiology_trends: List[TrendSeries]
    lab_trends:       List[TrendSeries]
    vitals_trends:    List[TrendSeries]

    # CEO convenience tables
    ceo_radiology_table: List[Dict]
    ceo_lab_table:       List[Dict]
    ceo_vitals_table:    List[Dict]

    # Doctor-view enriched outputs (Pass 2)
    doctor_view: Optional[DoctorViewOutput] = None

    # Raw LLM extractions (optional)
    raw_extractions: Optional[Dict] = None


# ============================================================
# PASS 1: EXTRACTOR AGENT
# ============================================================

class ProgressTrackingAgent(BaseAgent):
    """
    Two-pass progress extractor.

    Pass 1 (parallel): LAB + RADIOLOGY + VITALS extraction from raw documents.
    Pass 2 (parallel): RadiologyDoctorView + VitalsDoctorView + LabDoctorView
                       interpretation, fed from Pass 1 trend outputs.
    """

    agent_id = "A_PROG"

    # ── LAB extraction ───────────────────────────────────────────────────────

    async def _extract_labs(self, docs_json: str, specialty: str) -> Dict:
        system = (
            "You are a clinical laboratory data extraction specialist. "
            "Your sole job is to extract ALL documented laboratory values from clinical records, "
            "organised by parameter, with dates. You compute trends precisely. "
            "Always respond with valid JSON only."
        )

        prompt = f"""
You are extracting ALL laboratory data from clinical records for trend analysis.

SPECIALTY CONTEXT: {specialty}

CLINICAL DOCUMENTS:
{docs_json}

══════════════════════════════════════════════════════════
TASK — EXHAUSTIVE LAB DATA EXTRACTION + TREND ANALYSIS
══════════════════════════════════════════════════════════

STEP 1 — IDENTIFY ALL LAB PARAMETERS
  Scan EVERY document for:
  • Blood counts (CBC): Hb, WBC, platelets, neutrophils, etc.
  • Metabolic panels: Na, K, Cl, BUN, Creatinine, eGFR, glucose, HbA1c
  • Liver function: ALT, AST, ALP, GGT, bilirubin (total/direct), albumin
  • Tumour markers: CEA, CA 19-9, CA 125, PSA, AFP, DCP/PIVKA-II, etc.
  • Coagulation: PT, INR, aPTT
  • Thyroid: TSH, fT3, fT4
  • Lipids: Total cholesterol, LDL, HDL, triglycerides
  • Cardiac enzymes: Troponin, BNP, CK-MB
  • Urinalysis: protein, glucose, blood, WBC, RBC
  • Microbiology / cultures (if documented)
  • ANY other lab value explicitly mentioned

STEP 2 — FOR EACH PARAMETER
  List ALL documented values in strict chronological order.
  For each value:
    • date, value + unit, reference range, document name, abnormal flag

STEP 3 — TREND ANALYSIS
  For each parameter with ≥2 values: direction, percent_change, clinical_trend_interpretation, urgency.
  For parameters with only 1 value: direction = "single_reading", urgency based on abnormality.

STEP 4 — MISSING CRITICAL LABS
  List lab parameters that SHOULD be present but are NOT documented.

Return ONLY valid JSON:
{{
  "lab_trends": [
    {{
      "parameter": "...",
      "subcategory": "haematology|metabolic|liver|tumour_marker|cardiac|coagulation|thyroid|lipid|urine|other",
      "data_points": [
        {{
          "date": "...",
          "value": "...",
          "unit": "...",
          "reference_range": "...",
          "abnormal_flag": "HIGH|LOW|CRITICAL_HIGH|CRITICAL_LOW|NORMAL|BORDERLINE|NOT_STATED",
          "source_document": "...",
          "notes": "..."
        }}
      ],
      "data_point_count": 1,
      "direction": "increasing|decreasing|stable|fluctuating|single_reading",
      "direction_symbol": "↑|↓|→|~|•",
      "first_value": "...",
      "latest_value": "...",
      "percent_change": null,
      "clinical_flag": "CRITICAL|CONCERN|STABLE|IMPROVING|INSUFFICIENT_DATA",
      "flag_rationale": "...",
      "change_summary": "..."
    }}
  ],
  "missing_critical_labs": [
    {{
      "parameter_name": "...",
      "clinical_need": "...",
      "urgency": "CRITICAL|IMPORTANT|RECOMMENDED"
    }}
  ],
  "lab_summary_sentence": "..."
}}
"""
        return await self._invoke(system, prompt)

    # ── RADIOLOGY extraction ─────────────────────────────────────────────────

    async def _extract_radiology(self, docs_json: str, specialty: str) -> Dict:
        system = (
            "You are a radiological data extraction specialist for oncology and complex medicine. "
            "Your sole job is to extract ALL imaging measurements, lesion sizes, and radiological "
            "findings from clinical records, compute size progression, and flag concerning changes. "
            "Always respond with valid JSON only."
        )

        prompt = f"""
You are extracting ALL radiological data for trend and progression analysis.

SPECIALTY CONTEXT: {specialty}

CLINICAL DOCUMENTS:
{docs_json}

══════════════════════════════════════════════════════════
TASK — EXHAUSTIVE RADIOLOGY DATA EXTRACTION + PROGRESSION
══════════════════════════════════════════════════════════

STEP 1 — IDENTIFY ALL IMAGING STUDIES (modality, date, source, clinical question).

STEP 2 — EXTRACT ALL LESION / TUMOUR MEASUREMENTS
  For each lesion: label, site, dimensions, max dimension, date, modality, source,
  imaging characteristics, clinical interpretation, T/N/M implication.

STEP 3 — LESION PROGRESSION ANALYSIS
  For lesions with ≥2 measurements: size_change_cm, size_change_percent,
  progression_status (PROGRESSING|STABLE|RESPONDING|MIXED|SINGLE_READING).

STEP 4 — STRUCTURAL / NON-MEASUREMENT FINDINGS

STEP 5 — RADIOLOGY SUMMARY (one non-clinical paragraph)

Return ONLY valid JSON:
{{
  "imaging_studies": [
    {{"modality": "...", "date": "...", "source_document": "...", "clinical_question": "..."}}
  ],
  "lesion_trends": [
    {{
      "lesion_id": "...",
      "lesion_label": "...",
      "anatomical_site": "...",
      "clinical_interpretation": "primary_tumor|lymph_node|metastasis|satellite|incidental",
      "tnm_implication": "...",
      "measurements": [
        {{
          "date": "...",
          "dimensions_raw": "...",
          "maximum_dimension_cm": null,
          "modality": "...",
          "source_document": "...",
          "imaging_characteristics": "...",
          "notes": "..."
        }}
      ],
      "measurement_count": 1,
      "direction": "increasing|decreasing|stable|single_reading",
      "direction_symbol": "↑|↓|→|•",
      "first_max_dimension_cm": null,
      "latest_max_dimension_cm": null,
      "size_change_cm": null,
      "size_change_percent": null,
      "progression_status": "PROGRESSING|STABLE|RESPONDING|MIXED|SINGLE_READING",
      "clinical_flag": "CRITICAL|CONCERN|STABLE|IMPROVING|INSUFFICIENT_DATA",
      "flag_rationale": "...",
      "change_summary": "..."
    }}
  ],
  "structural_findings": [
    {{
      "finding": "...",
      "date": "...",
      "source_document": "...",
      "clinical_significance": "...",
      "clinical_flag": "CRITICAL|CONCERN|STABLE|INSUFFICIENT_DATA"
    }}
  ],
  "radiology_summary_sentence": "...",
  "overall_disease_trajectory": "PROGRESSING|STABLE|RESPONDING|MIXED|INSUFFICIENT_DATA"
}}
"""
        return await self._invoke(system, prompt)

    # ── VITALS extraction ────────────────────────────────────────────────────

    async def _extract_vitals(self, docs_json: str, specialty: str) -> Dict:
        system = (
            "You are a clinical vitals and physiological parameter extraction specialist. "
            "Your sole job is to extract ALL documented vital signs, echocardiographic parameters, "
            "functional assessments, and physiological measurements from clinical records, "
            "with trend analysis. Always respond with valid JSON only."
        )

        prompt = f"""
You are extracting ALL vitals and physiological parameter data for trend analysis.

SPECIALTY CONTEXT: {specialty}

CLINICAL DOCUMENTS:
{docs_json}

══════════════════════════════════════════════════════════
TASK — EXHAUSTIVE VITALS + PHYSIOLOGICAL PARAMETER EXTRACTION
══════════════════════════════════════════════════════════

STEP 1 — IDENTIFY ALL VITALS AND PHYSIOLOGICAL PARAMETERS
  Scan EVERY document for: BP, HR, SpO2, temperature, RR, weight, BMI,
  echo parameters (EF, LVIDd, RWMA, diastolic dysfunction),
  pulmonary function, ECOG/Karnofsky, pain scores, and any other physiological measure.

STEP 2 — FOR EACH PARAMETER: date, value, unit, normal range, source, abnormal_flag, clinical_context.

STEP 3 — TREND ANALYSIS: direction, symbol, stability_assessment, clinical_note.
  For cardiac: EF status, RWMA, diastolic dysfunction grade.

STEP 4 — FUNCTIONAL STATUS SUMMARY for treatment planning.

Return ONLY valid JSON:
{{
  "vitals_trends": [
    {{
      "parameter": "...",
      "subcategory": "basic_vitals|cardiac_echo|pulmonary|functional_score|ent|neurological|other",
      "data_points": [
        {{
          "date": "...",
          "value": "...",
          "unit": "...",
          "normal_range": "...",
          "abnormal_flag": "CRITICAL|ABNORMAL|BORDERLINE|NORMAL|NOT_STATED",
          "source_document": "...",
          "clinical_context": "..."
        }}
      ],
      "data_point_count": 1,
      "direction": "increasing|decreasing|stable|fluctuating|single_reading",
      "direction_symbol": "↑|↓|→|~|•",
      "first_value": "...",
      "latest_value": "...",
      "stability_assessment": "STABLE|IMPROVING|DETERIORATING|FLUCTUATING|SINGLE_READING",
      "clinical_flag": "CRITICAL|CONCERN|STABLE|IMPROVING|INSUFFICIENT_DATA",
      "flag_rationale": "...",
      "change_summary": "..."
    }}
  ],
  "cardiac_summary": {{
    "ef_status": "Preserved (≥50%)|Mildly reduced (40-49%)|Reduced (<40%)|Not documented",
    "ef_value": "...",
    "rwma_present": null,
    "rwma_segments": [],
    "diastolic_dysfunction_grade": "...",
    "overall_cardiac_fitness_for_surgery": "GOOD|MODERATE|POOR|NOT_ASSESSABLE",
    "cardiac_notes": "..."
  }},
  "functional_status_summary": {{
    "ecog_or_equivalent": "...",
    "overall_functional_reserve": "GOOD|MODERATE|POOR|NOT_ASSESSABLE",
    "treatment_tolerance_assessment": "...",
    "notes": "..."
  }},
  "vitals_summary_sentence": "..."
}}
"""
        return await self._invoke(system, prompt)

    # ── Main Run ─────────────────────────────────────────────────────────────

    async def run(
        self,
        docs: List[Dict],
        specialty: str,
        patient_id: str,
        doctor_id: str,
    ) -> Dict:
        logger.info(f"{self.agent_id} · ProgressTrackingAgent — START (Pass 1: extractors)")
        t0 = datetime.now().timestamp()

        docs_json = json.dumps(docs, indent=2, default=str)

        # ── PASS 1: run all three extractors concurrently ────────────────────
        logger.info(f"{self.agent_id} · Pass 1 — LAB + RADIOLOGY + VITALS in parallel")
        lab_result, radio_result, vitals_result = await asyncio.gather(
            self._extract_labs(docs_json, specialty),
            self._extract_radiology(docs_json, specialty),
            self._extract_vitals(docs_json, specialty),
            return_exceptions=True,
        )

        # Handle partial failures gracefully
        if isinstance(lab_result, Exception):
            logger.error(f"{self.agent_id} · Lab extraction failed: {lab_result}")
            lab_result = {
                "lab_trends": [],
                "missing_critical_labs": [],
                "lab_summary_sentence": "Lab extraction failed.",
            }
        if isinstance(radio_result, Exception):
            logger.error(f"{self.agent_id} · Radiology extraction failed: {radio_result}")
            radio_result = {
                "lesion_trends": [],
                "structural_findings": [],
                "radiology_summary_sentence": "Radiology extraction failed.",
                "overall_disease_trajectory": "INSUFFICIENT_DATA",
            }
        if isinstance(vitals_result, Exception):
            logger.error(f"{self.agent_id} · Vitals extraction failed: {vitals_result}")
            vitals_result = {
                "vitals_trends": [],
                "cardiac_summary": {},
                "functional_status_summary": {},
                "vitals_summary_sentence": "Vitals extraction failed.",
            }

        elapsed_p1 = round((datetime.now().timestamp() - t0) * 1000)
        logger.info(f"{self.agent_id} · Pass 1 complete ({elapsed_p1}ms)")

        # ── Build TrendSeries objects ────────────────────────────────────────
        radiology_trends = _build_radiology_series(radio_result)
        lab_trends       = _build_lab_series(lab_result)
        vitals_trends    = _build_vitals_series(vitals_result)

        # ── PASS 2: doctor-view agents fed from Pass 1 outputs ───────────────
        logger.info(f"{self.agent_id} · Pass 2 — Doctor-view agents in parallel")
        t2 = datetime.now().timestamp()

        rad_view_result, vitals_view_result, lab_view_result = await asyncio.gather(
            RadiologyDoctorViewAgent(llm_synthesis).run(
                radiology_trends=[s.dict() for s in radiology_trends],
                specialty=specialty,
            ),
            VitalsDoctorViewAgent(llm_synthesis).run(
                vitals_trends=[s.dict() for s in vitals_trends],
                specialty=specialty,
            ),
            LabDoctorViewAgent(llm_synthesis).run(
                lab_trends=[s.dict() for s in lab_trends],
                specialty=specialty,
                missing_critical_labs=lab_result.get("missing_critical_labs", []),
            ),
            return_exceptions=True,
        )

        elapsed_p2 = round((datetime.now().timestamp() - t2) * 1000)
        logger.info(f"{self.agent_id} · Pass 2 complete ({elapsed_p2}ms)")

        if isinstance(rad_view_result, Exception):
            logger.error(f"{self.agent_id} · RadiologyDoctorView failed: {rad_view_result}")
            rad_view_result = {}
        if isinstance(vitals_view_result, Exception):
            logger.error(f"{self.agent_id} · VitalsDoctorView failed: {vitals_view_result}")
            vitals_view_result = {}
        if isinstance(lab_view_result, Exception):
            logger.error(f"{self.agent_id} · LabDoctorView failed: {lab_view_result}")
            lab_view_result = {}

        # ── Determine overall status ─────────────────────────────────────────
        all_flags = (
            [t["clinical_flag"] for t in lab_result.get("lab_trends", [])]
            + [t["clinical_flag"] for t in radio_result.get("lesion_trends", [])]
            + [t["clinical_flag"] for t in vitals_result.get("vitals_trends", [])]
        )
        overall_status      = _compute_overall_status(all_flags, radio_result.get("overall_disease_trajectory", "INSUFFICIENT_DATA"))
        critical_flags      = _collect_critical_flags(lab_result, radio_result, vitals_result)
        ceo_radiology_table = _build_ceo_table_radiology(radio_result)
        ceo_lab_table       = _build_ceo_table_labs(lab_result)
        ceo_vitals_table    = _build_ceo_table_vitals(vitals_result)
        headline            = _build_headline(
            overall_status,
            radio_result.get("radiology_summary_sentence", ""),
            lab_result.get("lab_summary_sentence", ""),
            vitals_result.get("vitals_summary_sentence", ""),
        )

        elapsed_total = round((datetime.now().timestamp() - t0) * 1000)

        doctor_view = _build_doctor_view_output(
            patient_id=patient_id,
            doctor_id=doctor_id,
            specialty=specialty,
            rad_view=rad_view_result,
            vitals_view=vitals_view_result,
            lab_view=lab_view_result,
            processing_time_ms=elapsed_total,
        )

        output = ProgressOutput(
            patient_id=patient_id,
            doctor_id=doctor_id,
            generated_at=datetime.now().isoformat(),
            documents_analyzed=len(docs),
            processing_time_ms=elapsed_total,
            overall_status=overall_status,
            headline_summary=headline,
            critical_flags=critical_flags,
            radiology_trends=radiology_trends,
            lab_trends=lab_trends,
            vitals_trends=vitals_trends,
            ceo_radiology_table=ceo_radiology_table,
            ceo_lab_table=ceo_lab_table,
            ceo_vitals_table=ceo_vitals_table,
            doctor_view=doctor_view,
        )

        raw_extractions = {
            "lab_raw":             lab_result,
            "radiology_raw":       radio_result,
            "vitals_raw":          vitals_result,
            "rad_doctor_view":     rad_view_result,
            "vitals_doctor_view":  vitals_view_result,
            "lab_doctor_view":     lab_view_result,
        }

        logger.info(
            f"{self.agent_id} · ProgressTrackingAgent — DONE ({elapsed_total}ms) | "
            f"Pass1={elapsed_p1}ms Pass2={elapsed_p2}ms | "
            f"Status: {overall_status} | Critical flags: {len(critical_flags)}"
        )

        return {
            "progress_output":  output.dict(),
            "raw_extractions":  raw_extractions,
            "agent_timing_ms":  elapsed_total,
        }

    # ── State-aware run (for integration into ClinicalState pipeline) ────────

    async def run_on_state(self, state: ClinicalState) -> ClinicalState:
        """
        Call this when integrating A_PROG into the main CCGI workflow.
        Reads graph_documents from state, writes progress_tracking to state.
        """
        result = await self.run(
            docs=state["graph_documents"],
            specialty=state.get("specialty", "General Medicine"),
            patient_id=state["patient_id"],
            doctor_id=state["doctor_id"],
        )
        state["progress_tracking"] = result["progress_output"]      # type: ignore[index]
        state["agent_timings"][self.agent_id] = result["agent_timing_ms"]
        return state


# ============================================================
# PASS 2: DOCTOR-VIEW AGENTS
# ============================================================

class RadiologyDoctorViewAgent(BaseAgent):
    """
    Enriched radiology narrative for doctor consumption.

    INPUT:  radiology_trends  — List[TrendSeries.dict()]
    OUTPUT: RadiologyDoctorView-compatible dict

    Produces:
      • Per-lesion RECIST interpretation
      • Overall response assessment (CR/PR/SD/PD/NE)
      • Structural findings narrative
      • Urgent radiology actions with timeframes
      • MDT-ready paragraph
      • Next imaging recommendation
    """

    agent_id = "A_RAD_DOC"

    async def run(
        self,
        radiology_trends: List[Dict],
        specialty: str,
    ) -> Dict:
        logger.info(f"{self.agent_id} · RadiologyDoctorViewAgent — START")
        t0 = datetime.now().timestamp()

        trends_json = json.dumps(radiology_trends, indent=2, default=str)

        system = (
            f"You are a senior radiologist and {specialty} specialist writing a "
            "structured radiology interpretation report for a treating clinician. "
            "Your output is consumed by a doctor, NOT a patient or lay audience. "
            "Use precise clinical and radiological terminology. "
            "Always respond with valid JSON only."
        )

        prompt = f"""
You are performing an enriched clinical interpretation of pre-computed radiology trend data
for a {specialty} specialist.

SPECIALTY CONTEXT: {specialty}

PRE-COMPUTED RADIOLOGY TRENDS (from extraction pass):
{trends_json}

══════════════════════════════════════════════════════════
TASK — RADIOLOGY DOCTOR VIEW: ENRICHED CLINICAL INTERPRETATION
══════════════════════════════════════════════════════════

SECTION 1 — LESION-BY-LESION INTERPRETATION
  For EACH lesion in the trend data:
  a. Size trajectory (e.g. "3.2 cm → 4.1 cm over 3 months")
  b. RECIST 1.1 response category if ≥2 measurements:
       CR (complete response), PR (partial ≥30% decrease),
       SD (stable disease), PD (progressive ≥20% increase), NE (not evaluable)
  c. Clinical significance: what does this size change mean for this patient?
  d. Differential: progression vs treatment response vs post-inflammatory change.
     Rate: "Likely progression|Likely response|Indeterminate"
  e. Recommended follow-up imaging

SECTION 2 — OVERALL RECIST RESPONSE ASSESSMENT
  Based on ALL lesions combined:
  • Target lesion sum of diameters (if calculable)
  • Best response to date, current response category
  • New lesions identified? (new lesions = PD regardless of target response)
  • Overall response: "CR|PR|SD|PD|NE|INSUFFICIENT_DATA"
  • Plain-language RECIST summary (2 sentences)

SECTION 3 — STRUCTURAL FINDINGS NARRATIVE
  Interpret ALL structural/non-measurement findings and their staging/management implications.

SECTION 4 — URGENT RADIOLOGY ACTIONS
  For each urgent finding: action, clinical rationale, timeframe.
  Timeframes: "IMMEDIATE (24h)|URGENT (48-72h)|SHORT-TERM (1-2wk)|ROUTINE (next review)"

SECTION 5 — MDT RADIOLOGY PARAGRAPH
  A single self-contained paragraph (5-8 sentences) for tumour board presentation.
  Third person: "Imaging review demonstrates..."
  Include: modalities reviewed, lesion trajectory, response assessment, structural
  findings, and recommended next imaging.

SECTION 6 — NEXT IMAGING RECOMMENDATION
  Specific modality (e.g., "FDG-PET CT" not just "PET"), timeframe, clinical question.

Return ONLY valid JSON:
{{
  "lesion_interpretations": [
    {{
      "lesion_label": "...",
      "anatomical_site": "...",
      "clinical_interpretation_type": "primary_tumor|lymph_node|metastasis|satellite|structural|incidental",
      "size_trajectory": "...",
      "recist_category": "CR|PR|SD|PD|NE|NOT_APPLICABLE",
      "size_change_summary": "...",
      "clinical_significance": "...",
      "differential_assessment": "Likely progression|Likely response|Indeterminate|Not applicable",
      "differential_rationale": "...",
      "recommended_follow_up": "..."
    }}
  ],
  "overall_response_assessment": "CR|PR|SD|PD|NE|INSUFFICIENT_DATA",
  "target_lesion_sum_baseline_cm": null,
  "target_lesion_sum_current_cm": null,
  "new_lesions_identified": false,
  "recist_summary": "...",
  "structural_findings_summary": "...",
  "urgent_radiology_actions": [
    {{
      "action": "...",
      "rationale": "...",
      "timeframe": "IMMEDIATE (24h)|URGENT (48-72h)|SHORT-TERM (1-2wk)|ROUTINE (next review)"
    }}
  ],
  "mdt_radiology_paragraph": "...",
  "next_imaging_recommendation": {{
    "modality": "...",
    "suggested_timeframe": "...",
    "clinical_question": "...",
    "contrast_required": null,
    "special_protocol": "..."
  }},
  "interpretation_confidence": "High|Moderate|Low",
  "confidence_rationale": "..."
}}
"""
        result = await self._invoke(system, prompt)
        result["specialty"]    = specialty
        result["generated_at"] = datetime.now().isoformat()
        logger.info(
            f"{self.agent_id} · RadiologyDoctorViewAgent — DONE "
            f"({self._elapsed(t0)}ms) | Response: {result.get('overall_response_assessment', 'N/A')}"
        )
        return result


# ─────────────────────────────────────────────────────────────────────────────

class VitalsDoctorViewAgent(BaseAgent):
    """
    Enriched vitals / physiological narrative for doctor consumption.

    INPUT:  vitals_trends — List[TrendSeries.dict()]
    OUTPUT: VitalsDoctorView-compatible dict

    Produces:
      • Per-parameter clinical interpretation with treatment relevance
      • Cardiac fitness summary (EF, RWMA, diastolic)
      • Functional reserve assessment
      • Treatment tolerance (surgery / chemo / RT)
      • Deteriorating parameter alerts
      • MDT-ready paragraph
      • Monitoring recommendations
    """

    agent_id = "A_VIT_DOC"

    async def run(
        self,
        vitals_trends: List[Dict],
        specialty: str,
    ) -> Dict:
        logger.info(f"{self.agent_id} · VitalsDoctorViewAgent — START")
        t0 = datetime.now().timestamp()

        trends_json = json.dumps(vitals_trends, indent=2, default=str)

        system = (
            f"You are a senior clinician and {specialty} specialist writing a "
            "structured physiological assessment for a treating clinician. "
            "Your output is consumed by a doctor making treatment decisions. "
            "Use precise clinical terminology. Always respond with valid JSON only."
        )

        prompt = f"""
You are performing an enriched clinical interpretation of pre-computed vitals trend data
for a {specialty} specialist.

SPECIALTY CONTEXT: {specialty}

PRE-COMPUTED VITALS TRENDS (from extraction pass):
{trends_json}

══════════════════════════════════════════════════════════
TASK — VITALS DOCTOR VIEW: ENRICHED CLINICAL INTERPRETATION
══════════════════════════════════════════════════════════

SECTION 1 — PER-PARAMETER CLINICAL INTERPRETATION
  For EACH parameter:
  a. Clinical meaning of the current value
  b. Trend interpretation: what does the direction of change mean clinically?
  c. Treatment relevance: does this constrain any treatment option?
     If yes: name the specific treatment and constraint (e.g., "Low EF <40%
     increases perioperative cardiac risk — anaesthetic review required")
  d. Monitoring priority: "URGENT|ROUTINE|WATCHFUL"

SECTION 2 — CARDIAC FITNESS SUMMARY
  Based on ALL cardiac-related parameters (EF, RWMA, diastolic, BP, HR):
  a. Overall cardiac fitness for planned treatment
  b. EF status with clinical interpretation
  c. RWMA interpretation: segments, ischaemic territory if applicable
  d. Diastolic dysfunction grade and HFpEF vs HFrEF implication
  e. Overall fitness rating: "GOOD|MODERATE|POOR|NOT_ASSESSABLE"
  f. If POOR: required optimisation before treatment

SECTION 3 — FUNCTIONAL RESERVE ASSESSMENT
  Based on ECOG / Karnofsky / NYHA / functional scores:
  a. Current functional reserve: "GOOD|MODERATE|POOR|NOT_ASSESSABLE"
  b. Rationale and impact on treatment intensity planning
  c. Dose-modification implications

SECTION 4 — TREATMENT TOLERANCE ASSESSMENT
  For each treatment modality (surgery, chemotherapy, radiotherapy):
  • Tolerance level, specific notes, organ-level concerns

SECTION 5 — DETERIORATING PARAMETERS (ALERTS)
  For ANY parameter with a deteriorating trend:
  a. Parameter + trend, clinical concern, recommended action, urgency

SECTION 6 — MDT VITALS PARAGRAPH
  A single self-contained paragraph (4-6 sentences) for MDT meeting.
  Include: key vitals, cardiac fitness, functional status, treatment tolerance.

SECTION 7 — MONITORING RECOMMENDATIONS
  Per-parameter: frequency, threshold for escalation, escalation action.

Return ONLY valid JSON:
{{
  "parameter_interpretations": [
    {{
      "parameter": "...",
      "subcategory": "...",
      "current_value": "...",
      "clinical_meaning": "...",
      "trend_interpretation": "...",
      "treatment_relevance": "...",
      "specific_treatment_constrained": "...",
      "monitoring_priority": "URGENT|ROUTINE|WATCHFUL"
    }}
  ],
  "cardiac_fitness_summary": {{
    "overall_fitness": "GOOD|MODERATE|POOR|NOT_ASSESSABLE",
    "ef_comment": "...",
    "rwma_comment": "...",
    "diastolic_comment": "...",
    "bp_hr_comment": "...",
    "optimisation_required": "...",
    "cardiac_notes": "..."
  }},
  "functional_reserve_assessment": "GOOD|MODERATE|POOR|NOT_ASSESSABLE",
  "functional_reserve_rationale": "...",
  "treatment_tolerance": {{
    "surgery_tolerance":      "GOOD|MODERATE|POOR|NOT_ASSESSABLE",
    "surgery_notes":          "...",
    "chemo_tolerance":        "GOOD|MODERATE|POOR|NOT_ASSESSABLE",
    "chemo_notes":            "...",
    "radiotherapy_tolerance": "GOOD|MODERATE|POOR|NOT_ASSESSABLE",
    "radiotherapy_notes":     "..."
  }},
  "deteriorating_parameters": [
    {{
      "parameter": "...",
      "trend": "...",
      "clinical_concern": "...",
      "recommended_action": "...",
      "urgency": "IMMEDIATE|URGENT|SHORT-TERM|ROUTINE"
    }}
  ],
  "mdt_vitals_paragraph": "...",
  "monitoring_recommendations": [
    {{
      "parameter": "...",
      "frequency": "...",
      "threshold_for_escalation": "...",
      "escalation_action": "..."
    }}
  ],
  "interpretation_confidence": "High|Moderate|Low",
  "confidence_rationale": "..."
}}
"""
        result = await self._invoke(system, prompt)
        result["specialty"]    = specialty
        result["generated_at"] = datetime.now().isoformat()
        logger.info(
            f"{self.agent_id} · VitalsDoctorViewAgent — DONE "
            f"({self._elapsed(t0)}ms) | Reserve: {result.get('functional_reserve_assessment', 'N/A')}"
        )
        return result


# ─────────────────────────────────────────────────────────────────────────────

class LabDoctorViewAgent(BaseAgent):
    """
    Enriched lab narrative for doctor consumption.

    INPUT:  lab_trends             — List[TrendSeries.dict()]
            missing_critical_labs  — List[Dict] (from extraction pass)
    OUTPUT: LabDoctorView-compatible dict

    Produces:
      • Per-parameter clinical interpretation with required actions
      • Organ-system lab summaries (renal, hepatic, haematological, etc.)
      • Critical/urgent lab value alerts
      • Tumour marker trajectory assessment
      • Improving / worsening / stable parameter lists
      • Missing labs clinical impact
      • MDT-ready paragraph
      • Overall lab status
    """

    agent_id = "A_LAB_DOC"

    async def run(
        self,
        lab_trends: List[Dict],
        specialty: str,
        missing_critical_labs: Optional[List[Dict]] = None,
    ) -> Dict:
        logger.info(f"{self.agent_id} · LabDoctorViewAgent — START")
        t0 = datetime.now().timestamp()

        trends_json  = json.dumps(lab_trends, indent=2, default=str)
        missing_json = json.dumps(missing_critical_labs or [], indent=2, default=str)

        system = (
            f"You are a senior clinician and {specialty} specialist writing a "
            "structured laboratory interpretation report for a treating clinician. "
            "Your output is consumed by a doctor making treatment and monitoring decisions. "
            "Use precise clinical and laboratory terminology. "
            "Always respond with valid JSON only."
        )

        prompt = f"""
You are performing an enriched clinical interpretation of pre-computed laboratory trend data
for a {specialty} specialist.

SPECIALTY CONTEXT: {specialty}

PRE-COMPUTED LAB TRENDS (from extraction pass):
{trends_json}

MISSING CRITICAL LABS IDENTIFIED BY EXTRACTOR:
{missing_json}

══════════════════════════════════════════════════════════
TASK — LAB DOCTOR VIEW: ENRICHED CLINICAL INTERPRETATION
══════════════════════════════════════════════════════════

SECTION 1 — PER-PARAMETER CLINICAL INTERPRETATION
  For EACH lab parameter:
  a. Clinical meaning of the current value with reference to normal ranges
  b. Trend interpretation: what does the trajectory mean clinically?
     e.g., "Rising AFP (12 → 340 IU/mL) over 2 months suggests HCC progression"
  c. Treatment relevance: does this constrain any treatment?
  d. Required action and timeframe

SECTION 2 — ORGAN-SYSTEM LAB SUMMARIES
  Summarise by system: Haematology, Renal, Hepatic, Coagulation, Metabolic,
  Tumour Markers, Endocrine.
  For each: overall status, key parameters, clinical note, treatment constraint.
  Status: "NORMAL|MILD_ABNORMALITY|SIGNIFICANT_ABNORMALITY|CRITICAL"

SECTION 3 — CRITICAL AND URGENT LAB VALUES
  For CRITICAL_HIGH / CRITICAL_LOW values: parameter, value, danger explanation,
  required action, timeframe: "IMMEDIATE (30 min)|URGENT (2-4h)|SAME DAY|NEXT REVIEW"

SECTION 4 — TUMOUR MARKER ASSESSMENT (if present)
  If tumour markers exist: marker, cancer context, trajectory (response vs progression),
  velocity/doubling time, clinical decision implication.

SECTION 5 — TREND CLASSIFICATION
  Classify each parameter: "improving" (toward normal), "worsening" (away from normal),
  "stable". Provide name + one-line reason.

SECTION 6 — MISSING LABS CLINICAL IMPACT
  For each missing lab: why needed, which treatment decision it blocks, urgency, action.

SECTION 7 — MDT LAB PARAGRAPH
  A single self-contained paragraph (4-6 sentences) for MDT meeting.
  Include: haematological and metabolic status, organ function, tumour markers,
  critical values, treatment-constraining findings.

SECTION 8 — OVERALL LAB STATUS
  "STABLE"           — all values within acceptable ranges
  "CONCERN"          — values outside normal but not immediately dangerous
  "CRITICAL"         — values requiring immediate intervention
  "MIXED"            — some improving, some worsening
  "INSUFFICIENT_DATA" — too few labs to assess

Return ONLY valid JSON:
{{
  "parameter_interpretations": [
    {{
      "parameter": "...",
      "subcategory": "...",
      "current_value": "...",
      "reference_range": "...",
      "abnormal_flag": "...",
      "clinical_meaning": "...",
      "trend_interpretation": "...",
      "treatment_relevance": "...",
      "required_action": "...",
      "action_timeframe": "IMMEDIATE|URGENT|SAME DAY|NEXT REVIEW|NONE"
    }}
  ],
  "organ_system_lab_summaries": [
    {{
      "system": "haematology|renal|hepatic|coagulation|metabolic|tumour_markers|endocrine|other",
      "status": "NORMAL|MILD_ABNORMALITY|SIGNIFICANT_ABNORMALITY|CRITICAL",
      "key_parameters": ["..."],
      "clinical_note": "...",
      "treatment_constraint": "..."
    }}
  ],
  "critical_lab_values": [
    {{
      "parameter": "...",
      "value": "...",
      "threshold": "...",
      "clinical_danger": "...",
      "required_action": "...",
      "timeframe": "IMMEDIATE (30 min)|URGENT (2-4h)|SAME DAY|NEXT REVIEW"
    }}
  ],
  "tumour_marker_assessment": {{
    "present": false,
    "markers": [
      {{
        "marker": "...",
        "cancer_context": "...",
        "trajectory": "...",
        "velocity_comment": "...",
        "clinical_decision_implication": "..."
      }}
    ],
    "overall_tumour_marker_trend": "RESPONDING|STABLE|PROGRESSING|INSUFFICIENT_DATA"
  }},
  "improving_parameters": ["..."],
  "worsening_parameters": ["..."],
  "stable_parameters": ["..."],
  "missing_labs_clinical_impact": [
    {{
      "parameter": "...",
      "why_needed": "...",
      "decision_blocked": "...",
      "urgency": "CRITICAL|IMPORTANT|RECOMMENDED",
      "suggested_action": "..."
    }}
  ],
  "mdt_lab_paragraph": "...",
  "overall_lab_status": "STABLE|CONCERN|CRITICAL|MIXED|INSUFFICIENT_DATA",
  "interpretation_confidence": "High|Moderate|Low",
  "confidence_rationale": "..."
}}
"""
        result = await self._invoke(system, prompt)
        result["specialty"]    = specialty
        result["generated_at"] = datetime.now().isoformat()
        logger.info(
            f"{self.agent_id} · LabDoctorViewAgent — DONE "
            f"({self._elapsed(t0)}ms) | Status: {result.get('overall_lab_status', 'N/A')}"
        )
        return result


# ============================================================
# HELPER: ASSEMBLE DoctorViewOutput
# ============================================================

def _build_doctor_view_output(
    patient_id: str,
    doctor_id: str,
    specialty: str,
    rad_view: Dict,
    vitals_view: Dict,
    lab_view: Dict,
    processing_time_ms: int,
) -> Optional[DoctorViewOutput]:
    """Safely assembles a DoctorViewOutput from raw LLM dicts."""
    if not any([rad_view, vitals_view, lab_view]):
        return None

    now = datetime.now().isoformat()

    def _safe_rad(d: Dict) -> Optional[RadiologyDoctorView]:
        if not d:
            return None
        try:
            return RadiologyDoctorView(
                specialty=d.get("specialty", specialty),
                generated_at=d.get("generated_at", now),
                lesion_interpretations=d.get("lesion_interpretations", []),
                overall_response_assessment=d.get("overall_response_assessment", "INSUFFICIENT_DATA"),
                recist_summary=d.get("recist_summary", ""),
                structural_findings_summary=d.get("structural_findings_summary", ""),
                mdt_radiology_paragraph=d.get("mdt_radiology_paragraph", ""),
                urgent_radiology_actions=d.get("urgent_radiology_actions", []),
                next_imaging_recommendation=d.get("next_imaging_recommendation", {}),
                interpretation_confidence=d.get("interpretation_confidence", "Low"),
                confidence_rationale=d.get("confidence_rationale", ""),
            )
        except Exception as e:
            logger.error(f"RadiologyDoctorView model build failed: {e}")
            return None

    def _safe_vit(d: Dict) -> Optional[VitalsDoctorView]:
        if not d:
            return None
        try:
            return VitalsDoctorView(
                specialty=d.get("specialty", specialty),
                generated_at=d.get("generated_at", now),
                parameter_interpretations=d.get("parameter_interpretations", []),
                cardiac_fitness_summary=d.get("cardiac_fitness_summary", {}),
                functional_reserve_assessment=d.get("functional_reserve_assessment", "NOT_ASSESSABLE"),
                functional_reserve_rationale=d.get("functional_reserve_rationale", ""),
                treatment_tolerance=d.get("treatment_tolerance", {}),
                deteriorating_parameters=d.get("deteriorating_parameters", []),
                mdt_vitals_paragraph=d.get("mdt_vitals_paragraph", ""),
                monitoring_recommendations=d.get("monitoring_recommendations", []),
                interpretation_confidence=d.get("interpretation_confidence", "Low"),
                confidence_rationale=d.get("confidence_rationale", ""),
            )
        except Exception as e:
            logger.error(f"VitalsDoctorView model build failed: {e}")
            return None

    def _safe_lab(d: Dict) -> Optional[LabDoctorView]:
        if not d:
            return None
        try:
            return LabDoctorView(
                specialty=d.get("specialty", specialty),
                generated_at=d.get("generated_at", now),
                parameter_interpretations=d.get("parameter_interpretations", []),
                organ_system_lab_summaries=d.get("organ_system_lab_summaries", []),
                critical_lab_values=d.get("critical_lab_values", []),
                tumour_marker_assessment=d.get("tumour_marker_assessment"),
                improving_parameters=d.get("improving_parameters", []),
                worsening_parameters=d.get("worsening_parameters", []),
                stable_parameters=d.get("stable_parameters", []),
                missing_labs_clinical_impact=d.get("missing_labs_clinical_impact", []),
                mdt_lab_paragraph=d.get("mdt_lab_paragraph", ""),
                overall_lab_status=d.get("overall_lab_status", "INSUFFICIENT_DATA"),
                interpretation_confidence=d.get("interpretation_confidence", "Low"),
                confidence_rationale=d.get("confidence_rationale", ""),
            )
        except Exception as e:
            logger.error(f"LabDoctorView model build failed: {e}")
            return None

    return DoctorViewOutput(
        patient_id=patient_id,
        doctor_id=doctor_id,
        specialty=specialty,
        generated_at=now,
        processing_time_ms=processing_time_ms,
        radiology=_safe_rad(rad_view),
        vitals=_safe_vit(vitals_view),
        labs=_safe_lab(lab_view),
    )


# ============================================================
# HELPER: BUILD TrendSeries from raw LLM output
# ============================================================

def _build_radiology_series(raw: Dict) -> List[TrendSeries]:
    series = []
    for lt in raw.get("lesion_trends", []):
        pts = [
            TrendPoint(
                date=m.get("date"),
                value=m.get("dimensions_raw"),
                unit="cm",
                source_document=m.get("source_document"),
                notes=m.get("imaging_characteristics"),
            )
            for m in lt.get("measurements", [])
        ]
        first_dim  = lt.get("first_max_dimension_cm")
        latest_dim = lt.get("latest_max_dimension_cm")
        series.append(TrendSeries(
            parameter=lt.get("lesion_label", lt.get("lesion_id", "Unknown lesion")),
            category="radiology",
            subcategory=lt.get("clinical_interpretation", "unknown"),
            data_points=pts,
            direction=lt.get("direction", "single_reading"),
            direction_symbol=lt.get("direction_symbol", "•"),
            clinical_flag=lt.get("clinical_flag", "INSUFFICIENT_DATA"),
            flag_rationale=lt.get("flag_rationale", ""),
            first_value=f"{first_dim} cm" if first_dim else None,
            latest_value=f"{latest_dim} cm" if latest_dim else None,
            change_summary=lt.get("change_summary", ""),
        ))
    for sf in raw.get("structural_findings", []):
        series.append(TrendSeries(
            parameter=sf.get("finding", "Structural finding")[:80],
            category="radiology",
            subcategory="structural",
            data_points=[TrendPoint(
                date=sf.get("date"),
                value=sf.get("finding"),
                unit=None,
                source_document=sf.get("source_document"),
            )],
            direction="single_reading",
            direction_symbol="•",
            clinical_flag=sf.get("clinical_flag", "INSUFFICIENT_DATA"),
            flag_rationale=sf.get("clinical_significance", ""),
            first_value=None,
            latest_value=sf.get("finding"),
            change_summary="Structural finding — no measurement available",
        ))
    return series


def _build_lab_series(raw: Dict) -> List[TrendSeries]:
    series = []
    for lt in raw.get("lab_trends", []):
        pts = [
            TrendPoint(
                date=dp.get("date"),
                value=dp.get("value"),
                unit=dp.get("unit"),
                source_document=dp.get("source_document"),
                notes=dp.get("abnormal_flag"),
            )
            for dp in lt.get("data_points", [])
        ]
        series.append(TrendSeries(
            parameter=lt.get("parameter", "Unknown"),
            category="lab",
            subcategory=lt.get("subcategory", "other"),
            data_points=pts,
            direction=lt.get("direction", "single_reading"),
            direction_symbol=lt.get("direction_symbol", "•"),
            clinical_flag=lt.get("clinical_flag", "INSUFFICIENT_DATA"),
            flag_rationale=lt.get("flag_rationale", ""),
            first_value=lt.get("first_value"),
            latest_value=lt.get("latest_value"),
            change_summary=lt.get("change_summary", ""),
        ))
    return series


def _build_vitals_series(raw: Dict) -> List[TrendSeries]:
    series = []
    for vt in raw.get("vitals_trends", []):
        pts = [
            TrendPoint(
                date=dp.get("date"),
                value=dp.get("value"),
                unit=dp.get("unit"),
                source_document=dp.get("source_document"),
                notes=dp.get("clinical_context"),
            )
            for dp in vt.get("data_points", [])
        ]
        series.append(TrendSeries(
            parameter=vt.get("parameter", "Unknown"),
            category="vitals",
            subcategory=vt.get("subcategory", "other"),
            data_points=pts,
            direction=vt.get("direction", "single_reading"),
            direction_symbol=vt.get("direction_symbol", "•"),
            clinical_flag=vt.get("clinical_flag", "INSUFFICIENT_DATA"),
            flag_rationale=vt.get("flag_rationale", ""),
            first_value=vt.get("first_value"),
            latest_value=vt.get("latest_value"),
            change_summary=vt.get("change_summary", ""),
        ))
    return series


# ============================================================
# HELPER: OVERALL STATUS
# ============================================================

def _compute_overall_status(all_flags: List[str], disease_trajectory: str) -> str:
    if not all_flags:
        return "Insufficient data"
    critical  = all_flags.count("CRITICAL")
    concern   = all_flags.count("CONCERN")
    improving = all_flags.count("IMPROVING")
    stable    = all_flags.count("STABLE")

    if disease_trajectory == "PROGRESSING" or critical >= 2:
        return "Progressing"
    if disease_trajectory == "RESPONDING" or improving > concern:
        return "Improving"
    if critical == 1 or concern > stable:
        return "Mixed — review required"
    if stable >= 1:
        return "Stable"
    return "Insufficient data"


# ============================================================
# HELPER: CRITICAL FLAGS FOR CEO BADGES
# ============================================================

def _collect_critical_flags(
    lab_result: Dict,
    radio_result: Dict,
    vitals_result: Dict,
) -> List[str]:
    flags = []
    for lt in radio_result.get("lesion_trends", []):
        if lt.get("clinical_flag") == "CRITICAL":
            flags.append(
                f"RADIOLOGY: {lt.get('lesion_label', 'Lesion')} — "
                f"{lt.get('change_summary', lt.get('flag_rationale', ''))}"
            )
    for lt in lab_result.get("lab_trends", []):
        if lt.get("clinical_flag") == "CRITICAL":
            flags.append(
                f"LAB: {lt.get('parameter')} — "
                f"{lt.get('change_summary', lt.get('flag_rationale', ''))}"
            )
    for vt in vitals_result.get("vitals_trends", []):
        if vt.get("clinical_flag") == "CRITICAL":
            flags.append(
                f"VITALS: {vt.get('parameter')} — "
                f"{vt.get('change_summary', vt.get('flag_rationale', ''))}"
            )
    return flags


# ============================================================
# HELPER: CEO SUMMARY TABLES
# ============================================================

def _build_ceo_table_radiology(raw: Dict) -> List[Dict]:
    rows = []
    for lt in raw.get("lesion_trends", []):
        rows.append({
            "parameter": lt.get("lesion_label", lt.get("lesion_id", "Unknown")),
            "site":      lt.get("anatomical_site", ""),
            "first":     f"{lt.get('first_max_dimension_cm')} cm" if lt.get("first_max_dimension_cm") else "—",
            "latest":    f"{lt.get('latest_max_dimension_cm')} cm" if lt.get("latest_max_dimension_cm") else "—",
            "change":    lt.get("change_summary", "—"),
            "trend":     lt.get("direction_symbol", "•"),
            "flag":      lt.get("clinical_flag", "INSUFFICIENT_DATA"),
            "status":    lt.get("progression_status", "—"),
        })
    return rows


def _build_ceo_table_labs(raw: Dict) -> List[Dict]:
    rows = []
    for lt in raw.get("lab_trends", []):
        rows.append({
            "parameter": lt.get("parameter", "Unknown"),
            "category":  lt.get("subcategory", "—"),
            "first":     lt.get("first_value", "—"),
            "latest":    lt.get("latest_value", "—"),
            "change":    lt.get("change_summary", "—"),
            "trend":     lt.get("direction_symbol", "•"),
            "flag":      lt.get("clinical_flag", "INSUFFICIENT_DATA"),
        })
    return rows


def _build_ceo_table_vitals(raw: Dict) -> List[Dict]:
    rows = []
    for vt in raw.get("vitals_trends", []):
        rows.append({
            "parameter": vt.get("parameter", "Unknown"),
            "category":  vt.get("subcategory", "—"),
            "first":     vt.get("first_value", "—"),
            "latest":    vt.get("latest_value", "—"),
            "change":    vt.get("change_summary", "—"),
            "trend":     vt.get("direction_symbol", "•"),
            "flag":      vt.get("clinical_flag", "INSUFFICIENT_DATA"),
        })
    return rows


# ============================================================
# HELPER: PLAIN ENGLISH HEADLINE
# ============================================================

def _build_headline(
    overall_status: str,
    radio_sentence: str,
    lab_sentence: str,
    vitals_sentence: str,
) -> str:
    parts = [
        s for s in [radio_sentence, lab_sentence, vitals_sentence]
        if s and "failed" not in s.lower()
    ]
    combined = " ".join(parts[:2]) if parts else "Progress data has been extracted from available records."
    return f"Overall status: {overall_status}. {combined}"


# ============================================================
# SINGLETON AGENT INSTANCES (shared across endpoints)
# ============================================================

_progress_agent   = ProgressTrackingAgent(llm_synthesis)
_rad_doc_agent    = RadiologyDoctorViewAgent(llm_synthesis)
_vitals_doc_agent = VitalsDoctorViewAgent(llm_synthesis)
_lab_doc_agent    = LabDoctorViewAgent(llm_synthesis)


# ============================================================
# FASTAPI ROUTER
# ============================================================

progress_router = APIRouter(prefix="", tags=["Clinical Progress"])


# ── 1. Full pipeline endpoint: extract + doctor-view ─────────────────────────

@progress_router.post("/clinical-progress", response_model=ProgressOutput)
async def get_clinical_progress(request: ProgressRequest):
    """
    Full progress tracking endpoint — two-pass pipeline.

    Pass 1: Extracts lab, radiology, vitals trends from Neo4j graph documents.
    Pass 2: Runs RadiologyDoctorView + VitalsDoctorView + LabDoctorView in parallel.

    Response includes:
      • CEO view:    overall_status, headline_summary, critical_flags, ceo_*_table
      • Raw trends:  radiology_trends, lab_trends, vitals_trends (TrendSeries arrays)
      • Doctor view: doctor_view.radiology / .vitals / .labs (enriched narratives)
    """
    logger.info(f"Progress request | patient={request.patient_id}")
    start_ms = datetime.now().timestamp() * 1000

    try:
        try:
            docs = await fetch_patient_graph_documents(request.patient_id)
        except Exception as neo4j_err:
            logger.warning(f"Neo4j unavailable ({neo4j_err}), using demo data")
            docs = load_demo_graph_documents()

        if not docs:
            raise HTTPException(
                status_code=404,
                detail=f"No clinical data found for patient {request.patient_id}",
            )

        result = await _progress_agent.run(
            docs=docs,
            specialty=request.specialty,
            patient_id=request.patient_id,
            doctor_id=request.doctor_id,
        )

        elapsed      = round(datetime.now().timestamp() * 1000 - start_ms)
        output: Dict = result["progress_output"]
        output["processing_time_ms"] = elapsed

        if request.include_raw_extractions:
            output["raw_extractions"] = result["raw_extractions"]

        # Persist to MongoDB (non-blocking)
        try:
            await mongo_db["patient_progress"].update_one(
                {"patient_id": request.patient_id, "doctor_id": request.doctor_id},
                {"$set": {**output, "updated_at": datetime.utcnow()}},
                upsert=True,
            )
        except Exception as e:
            logger.error(f"MongoDB progress save failed: {e}")

        logger.info(
            f"Progress complete | patient={request.patient_id} | "
            f"{elapsed}ms | status={output.get('overall_status')}"
        )
        return output

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Progress agent failed | patient={request.patient_id} | {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── 2. Standalone doctor-view endpoint (pre-computed trends as input) ─────────

@progress_router.post("/clinical-progress/doctor-view", response_model=DoctorViewOutput)
async def get_doctor_view(request: DoctorViewRequest):
    """
    Standalone doctor-view endpoint.

    Accepts pre-computed trend arrays and runs the three DoctorView agents
    in parallel WITHOUT re-extracting from raw documents.

    Useful when:
      • Trends were already computed by a prior /clinical-progress call
      • Trends are stored in state["progress_tracking"] from the main pipeline
      • Only a subset of views needs to be refreshed

    Inputs:
      • lab_trends       — TrendSeries-compatible dicts (category: "lab")
      • radiology_trends — TrendSeries-compatible dicts (category: "radiology")
      • vitals_trends    — TrendSeries-compatible dicts (category: "vitals")

    Returns DoctorViewOutput with .radiology, .vitals, .labs.
    """
    logger.info(
        f"Doctor-view request | patient={request.patient_id} | "
        f"lab={len(request.lab_trends)} | rad={len(request.radiology_trends)} | "
        f"vitals={len(request.vitals_trends)}"
    )
    start_ms = datetime.now().timestamp() * 1000

    try:
        rad_view, vitals_view, lab_view = await asyncio.gather(
            _rad_doc_agent.run(
                radiology_trends=request.radiology_trends,
                specialty=request.specialty,
            ),
            _vitals_doc_agent.run(
                vitals_trends=request.vitals_trends,
                specialty=request.specialty,
            ),
            _lab_doc_agent.run(
                lab_trends=request.lab_trends,
                specialty=request.specialty,
            ),
            return_exceptions=True,
        )

        if isinstance(rad_view, Exception):
            logger.error(f"RadiologyDoctorView failed: {rad_view}")
            rad_view = {}
        if isinstance(vitals_view, Exception):
            logger.error(f"VitalsDoctorView failed: {vitals_view}")
            vitals_view = {}
        if isinstance(lab_view, Exception):
            logger.error(f"LabDoctorView failed: {lab_view}")
            lab_view = {}

        elapsed = round(datetime.now().timestamp() * 1000 - start_ms)

        output = _build_doctor_view_output(
            patient_id=request.patient_id,
            doctor_id=request.doctor_id,
            specialty=request.specialty,
            rad_view=rad_view,
            vitals_view=vitals_view,
            lab_view=lab_view,
            processing_time_ms=elapsed,
        )

        if output is None:
            raise HTTPException(
                status_code=422,
                detail="All three doctor-view agents returned empty results.",
            )

        logger.info(f"Doctor-view complete | patient={request.patient_id} | {elapsed}ms")
        return output

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Doctor-view failed | patient={request.patient_id} | {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── 3. Demo endpoints ─────────────────────────────────────────────────────────

@progress_router.get("/clinical-progress/demo")
async def progress_demo():
    """Full pipeline demo — uses built-in sample data, runs both passes."""
    return await get_clinical_progress(ProgressRequest(
        patient_id="PAT-demo-progress",
        doctor_id="DOC-demo",
        specialty="Oncology",
        include_raw_extractions=True,
    ))


@progress_router.get("/clinical-progress/doctor-view/demo")
async def doctor_view_demo():
    """Minimal doctor-view demo — tests three DoctorView agents in isolation."""
    stub_rad = [
        {
            "parameter": "Primary bladder lesion",
            "category": "radiology",
            "subcategory": "primary_tumor",
            "data_points": [
                {"date": "2025-10-01", "value": "3.5 cm", "unit": "cm",
                 "source_document": "demo-USG.pdf", "notes": "Thickened wall"},
            ],
            "direction": "single_reading",
            "direction_symbol": "•",
            "clinical_flag": "CONCERN",
            "flag_rationale": "Single reading, bladder wall thickening",
            "first_value": "3.5 cm",
            "latest_value": "3.5 cm",
            "change_summary": "Single reading — no prior for comparison",
        }
    ]
    stub_lab = [
        {
            "parameter": "Haemoglobin",
            "category": "lab",
            "subcategory": "haematology",
            "data_points": [
                {"date": "2026-01-06", "value": "10.2", "unit": "g/dL",
                 "source_document": "demo-HPR.pdf", "notes": "LOW"},
            ],
            "direction": "single_reading",
            "direction_symbol": "•",
            "clinical_flag": "CONCERN",
            "flag_rationale": "Mild anaemia",
            "first_value": "10.2 g/dL",
            "latest_value": "10.2 g/dL",
            "change_summary": "Single reading — mild anaemia noted",
        }
    ]
    stub_vitals = [
        {
            "parameter": "Ejection Fraction",
            "category": "vitals",
            "subcategory": "cardiac_echo",
            "data_points": [
                {"date": "2026-01-06", "value": "58", "unit": "%",
                 "source_document": "demo-ECHO.pdf", "notes": "Normal"},
            ],
            "direction": "single_reading",
            "direction_symbol": "•",
            "clinical_flag": "STABLE",
            "flag_rationale": "EF preserved",
            "first_value": "58%",
            "latest_value": "58%",
            "change_summary": "Single reading — EF preserved at 58%",
        }
    ]
    return await get_doctor_view(DoctorViewRequest(
        patient_id="PAT-demo-doctor-view",
        doctor_id="DOC-demo",
        specialty="Oncology",
        lab_trends=stub_lab,
        radiology_trends=stub_rad,
        vitals_trends=stub_vitals,
    ))


# ============================================================
# HOW TO INTEGRATE INTO MAIN CCGI APP
# ============================================================
#
# In your FastAPI app entrypoint:
#
#   from ccgi_progress_agent import progress_router
#   app.include_router(progress_router)
#
# Available endpoints:
#   POST /clinical-progress              — full extract + doctor-view (two passes)
#   POST /clinical-progress/doctor-view  — doctor-view only (pre-computed trends in)
#   GET  /clinical-progress/demo         — full pipeline demo
#   GET  /clinical-progress/doctor-view/demo — doctor-view only demo
#
# For pipeline integration (inserts A_PROG before A9):
#
#   from ccgi_progress_agent import ProgressTrackingAgent, llm_synthesis
#   workflow.add_node("A_PROG", ProgressTrackingAgent(llm_synthesis).run_on_state)
#   workflow.add_edge("A4",     "A_PROG")
#   workflow.add_edge("A_PROG", "A5_A8_PARALLEL")
#
# Add "progress_tracking": Optional[Dict] to ClinicalState TypedDict.
# ============================================================