"""
Precision Oncology Intelligence System (POIS) — v4.1
=====================================================

FIX v4.1:
  1. f-string backslash SyntaxError fixed (Python 3.11 compatible)
     — all json.dumps / str expressions pre-computed before f-strings
  2. Recursion limit resolved:
     — MAX_ORCHESTRATION_CYCLES = 8, HARD_STOP_CYCLE = 10
     — explicit recursion_limit=50 in ainvoke config
     — stall detection (repeated batch → force END)
     — empty next_agents → force pipeline_complete
     — unknown phase_gate → should_continue returns "end"
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

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_groq import ChatGroq
from langgraph.graph import END, StateGraph

# ═══════════════════════════════════════════════════════════════════
# ENVIRONMENT
# ═══════════════════════════════════════════════════════════════════

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
NEO4J_URI    = os.getenv("NEO4J_URI",      "bolt://neo4j:7687")
NEO4J_USER   = os.getenv("NEO4J_USER",     "neo4j")
NEO4J_PASS   = os.getenv("NEO4J_PASSWORD", "password")
MONGO_URI    = os.getenv("MONGO_URI")
MONGO_DB     = "doctorassistai"

neo4j_driver = AsyncGraphDatabase.driver(
    NEO4J_URI,
    auth=(NEO4J_USER, NEO4J_PASS),
    max_connection_lifetime=3600,
    max_connection_pool_size=50,
)
mongo_client = AsyncIOMotorClient(MONGO_URI)
mongo_db     = mongo_client[MONGO_DB]
genomics_col = mongo_db["genomics_pipeline"]

# ── LLM instances ──────────────────────────────────────────────────
llm_fast = ChatGroq(
    model="llama-3.1-8b-instant",
    temperature=0.1,
    max_tokens=7000,
    groq_api_key=GROQ_API_KEY,
)
llm_strong = ChatGroq(
    model="llama-3.1-8b-instant",
    temperature=0.1,
    max_tokens=7000,
    groq_api_key=GROQ_API_KEY,
)

MAX_PARALLEL_AT_ONCE  = 3
_groq_semaphore       = asyncio.Semaphore(MAX_PARALLEL_AT_ONCE)

# Cycle caps — keep well under LangGraph's node-visit counter
# Steps = 1 (phase_detect) + cycles * 2 (orchestrate +xecute)
# With recursion_limit=50: max safe cycles = (50-1)/2 = 24 → we cap at 8
MAX_ORCHESTRATION_CYCLES = 8
HARD_STOP_CYCLE          = 10   # absolute circuit-breaker

STRONG_LLM_AGENTS = {"PHASE", "O1", "O2", "O3", "O4", "O5", "O6", "O7", "D7", "D8"}

router = APIRouter(prefix="/genomics", tags=["Precision Oncology — POIS v4"])


# ═══════════════════════════════════════════════════════════════════
# REQUEST MODEL
# ═══════════════════════════════════════════════════════════════════

class AnalyseRequest(BaseModel):
    patient_id:            str
    doctor_id:             str
    specialty:             str  = "Oncology"
    include_intermediates: bool = False
    phase_hint:            Optional[str] = None   # "pretest" | "full" | None


# ═══════════════════════════════════════════════════════════════════
# PIPELINE STATE
# ═══════════════════════════════════════════════════════════════════

class GenomicsState(TypedDict):
    patient_id:       str
    doctor_id:        str
    session_id:       str
    specialty:        str
    phase:            str

    graph_documents:   List[Dict]
    molecular_results: Optional[Dict]
    phase_detection:   Optional[Dict]

    orchestration_plan:  Optional[Dict]
    completed_agents:    List[str]
    pipeline_complete:   bool
    phase_gate:          str
    orchestration_cycle: int
    last_agent_batch:    List[str]   # stall detection

    agent_outputs:  Dict[str, Any]
    errors:         List[str]
    agent_timings:  Dict[str, float]


# ═══════════════════════════════════════════════════════════════════
# NEO4J FETCH
# ═══════════════════════════════════════════════════════════════════

async def fetch_graph_documents(patient_id: str) -> List[Dict]:
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
            relation:    type(r),
            entity_type: CASE
                WHEN n:Treatment   THEN "Treatment"
                WHEN n:Procedure   THEN "Procedure"
                WHEN n:Diagnosis   THEN "Diagnosis"
                WHEN n:Medication  THEN "Medication"
                WHEN n:LabResult   THEN "Lab Result"
                WHEN n:VitalSign   THEN "Vital Sign"
                WHEN n:Finding     THEN "Finding"
                WHEN n:Anatomy     THEN "Anatomy"
                WHEN n:Measurement THEN "Measurement"
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
            logger.info("Graph fetch: %d docs for %s", len(docs), patient_id)
            return docs
    except Exception as exc:
        logger.error("Neo4j fetch failed: %s", exc)
        raise


# ═══════════════════════════════════════════════════════════════════
# UTILITIES
# ═══════════════════════════════════════════════════════════════════

def parse_json_safe(text: str) -> Dict:
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


async def safe_invoke(llm_instance, messages: list, max_retries: int = 4) -> str:
    delay = 5
    for attempt in range(max_retries):
        async with _groq_semaphore:
            try:
                response = await llm_instance.ainvoke(messages)
                return response.content
            except Exception as exc:
                err_str = str(exc).lower()
                is_rate_limit = (
                    "429" in err_str
                    or "rate limit" in err_str
                    or "too many requests" in err_str
                    or "quota" in err_str
                )
                if is_rate_limit and attempt < max_retries - 1:
                    wait = delay * (2 ** attempt)
                    logger.warning("Rate limit (attempt %d). Waiting %ds...", attempt + 1, wait)
                    await asyncio.sleep(wait)
                else:
                    raise
    raise RuntimeError("Max retries exceeded on Groq API call")


# ═══════════════════════════════════════════════════════════════════
# GPEA PROMPT BUILDER  (Goal → Persona → Evidence → Ac
# NOTE: No backslashes inside f-string expressions — all computed
#       values are assigned to variables BEFORE the f-string.
# ═══════════════════════════════════════════════════════════════════

def gpea_system(goal: str, persona: str, constraints: str) -> str:
    return (
        "GOAL:\n" + goal + "\n\n"
        "PERSONA:\n" + persona + "\n\n"
        "CONSTRAINTS:\n" + constraints + "\n\n"
        "GENERAL RULES:\n"
        "• Reason strictly from provided evidence — never invent or extrapolate.\n"
        "• Every clinical claim must cite its source document.\n"
        "• Mark genuinely absent data as 'Not documented'.\n"
        "• Patient safety is the absolute priority:\n"
        "    - Remove absolute contraindications silently; flag relative ones.\n"
        "    - Germline VUS must NEVER guide therapy decisions.\n"
        "    - BRAF V600E requires combination therapy — monotherapy prohibited.\n"
        "    - Recommend therapy only from AMP/ASCO/CAP Tier I or II variants.\n"
        "• Respond with valid JSON only — no preamble, no markdown fences."
    )


def gpea_user(evidence_block: str, action_block: str) -> str:
    return "EVIDENCE:\n" + evidence_block + "\n\nACTION:\n" + action_block


# ═══════════════════════════════════════════════════════════════════
# BASE AGENT
# ═══════════════════════════════════════════════════════════════════

class BaseAgent:
    agent_id: str = "BASE"

    def __init__(self, llm_instance):
        self.llm = llm_instance

    async def _invoke(self, system_prompt: str, user_prompt: str) -> Dict:
        content = await safe_invoke(
            self.llm,
            [SystemMessage(content=system_prompt), HumanMessage(content=user_prompt)],
        )
        return parse_json_safe(content)

    def _elapsed(self, start: float) -> float:
        return round((datetime.now().timestamp() - start) * 1000, 1)


# ═══════════════════════════════════════════════════════════════════
# PHASE DETECTOR AGENT
# ═══════════════════════════════════════════════════════════════════

class PhaseDetectorAgent(BaseAgent):
    agent_id = "PHASE"

    async def detect(self, graph_docs: List[Dict], phase_hint: Optional[str]) -> Dict:
        t0 = datetime.now().timestamp()

        system = gpea_system(
            goal=(
                "Analyse every patient graph document entity with expert clinical judgment "
                "to determine whether actionable molecular/genomic data is present, "
                "classify all findings, and decide the pipeline phase."
            ),
            persona=(
                "Dual-board certified molecular pathologist and clinical bioinformatician "
                "with 20 years of precision oncology experience. Expert in NGS, IHC panels, "
                "liquid biopsy, germline testing, and multi-omic data."
            ),
            constraints=(
                "• phase_hint overrides only if clinically coherent.\n"
                "• 'pretest' = clinical/demographic data only — no molecular results.\n"
                "• 'full' = actionable molecular/genomic results present.\n"
                "• General labs (CBC, CMP, LFTs) are NOT molecular data.\n"
                "• Companion IHC (HER2, PD-L1, ALK, ROS1, MMR) IS molecular.\n"
                "• H&E morphology alone does NOT qualify as molecular.\n"
                "• NGS, ctDNA, germline, TMB, MSI, HRD ARE molecular.\n"
                "• Be conservative — when uncertain choose 'pretest'.\n"
                "• Respond with valid JSON only."
            ),
        )

        # Pre-compute before f-string (avoid backslash-in-expression error)
        doc_payload = json.dumps(
            [
                {
                    "document":     d.get("document"),
                    "date":         d.get("document_date"),
                    "entity_count": len(d.get("entities", [])),
                    "entities":     d.get("entities", []),
                }
                for d in graph_docs
            ],
            indent=2,
            default=str,
        )

        hint_block = (
            "Caller phase_hint: '" + phase_hint + "' — honour if clinically coherent."
            if phase_hint else
            "No phase_hint provided — decide from clinical evidence."
        )

        evidence = "ALL PATIENT GRAPH DOCUMENTS:\n" + doc_payload + "\n\n" + hint_block

        action = (
            "Classify every entity and determine the pipeline phase.\n\n"
            "Return ONLY valid JSON:\n"
            "{\n"
            '  "phase": "pretest" | "full",\n'
            '  "phase_reasoning": "<2-3 sentences>",\n'
            '  "data_quality_score": <0-100>,\n'
            '  "data_quality_notes": "<brief>",\n'
            '  "entity_classification_summary": {\n'
            '    "demographic": <int>, "diagnosis": <int>, "treatment_history": <int>,\n'
            '    "comorbidity": <int>, "vital_sign": <int>, "routine_lab": <int>,\n'
            '    "somatic_variant": <int>, "cnv_fusion": <int>, "ihc_molecular": <int>,\n'
            '    "tmb_msi_hrd": <int>, "germline_variant": <int>, "liquid_biopsy": <int>,\n'
            '    "expression_profile": <int>, "methylation": <int>, "immune_profile": <int>,\n'
            '    "other_molecular": <int>\n'
            "  },\n"
            '  "has_molecular_data": true | false,\n'
            '  "molecular_data_confidence": "high" | "medium" | "low",\n'
            '  "molecular_inventory": [\n'
            "    {\n"
            '      "entity_name": "...", "category": "...", "gene": "...",\n'
            '      "result_value": "...", "clinical_significance": "...",\n'
            '      "therapy_relevance": "...",\n'
            '      "actionability": "immediate" | "routine" | "surveillance",\n'
            '      "source_document": "...", "evidence_text": "..."\n'
            "    }\n"
            "  ],\n"
            '  "key_actionable_findings": [\n'
            "    {\n"
            '      "finding": "...", "therapy_impact": "...",\n'
            '      "urgency": "immediate" | "routine",\n'
            '      "evidence_tier": "Tier I" | "Tier II" | "Tier III" | "Tier IV" | "unknown"\n'
            "    }\n"
            "  ],\n"
            '  "clinical_gap_analysis": {\n'
            '    "missing_critical_tests": ["..."],\n'
            '    "recommended_next_tests": [\n'
            '      {"test": "...", "rationale": "...", "priority": "urgent" | "recommended" | "optional"}\n'
            "    ],\n"
            '    "data_gaps_affecting_therapy": ["..."]\n'
            "  },\n"
            '  "pretest_clinical_summary": {\n'
            '    "cancer_type": "...", "stage": "...", "histology": "...", "ecog_ps": "...",\n'
            '    "key_comorbidities": ["..."], "prior_therapy_lines": <int>, "last_treatment": "..."\n'
            "  }\n"
            "}"
        )

        result  = await self._invoke(system, gpea_user(evidence, action))
        elapsed = self._elapsed(t0)
        logger.info(
            "PhaseDetector | phase=%s | molecular=%s | confidence=%s | %dms",
            result.get("phase"),
            result.get("has_molecular_data"),
            result.get("molecular_data_confidence"),
            elapsed,
        )
        return result


# ═══════════════════════════════════════════════════════════════════
# CONTEXT TRIMMER
# ═══════════════════════════════════════════════════════════════════

AGENT_INPUT_MAP: Dict[str, List[str]] = {
    "P1": [], "P2": [], "P3": [], "P4": [],
    "T1": ["P1", "P2", "P3"], "T2": ["P1", "P2"], "T3": ["P1", "P2"],
    "T4": ["P1", "P2", "P4"], "T5": ["P1", "P3", "P4"], "T6": ["P1", "P2"],
    "T7": ["P1", "P2", "P3"], "T8": ["P1", "P2"],
    "M1": ["P1", "P2"], "M2": ["P1", "P2"], "M3": ["P1", "P4"],
    "M4": ["P1"], "M5": ["P2"], "M6": ["P1", "P3"],
    "M7": ["P4"], "M8": ["P1"], "M9": ["P1"],
    "D1": ["M1", "M2", "P3", "P4"], "D2": ["M3", "M7", "P4", "P3", "P1"],
    "D3": ["M5", "M6", "P4", "P3", "P1"], "D4": ["P4", "P3", "M1", "P1"],
    "D5": ["M5", "P1", "P3"], "D6": ["M1", "M2", "M3", "P1", "P3", "P4"],
    "D7": ["D1", "D2", "D5", "D6", "P1"], "D8": ["D1", "D2", "D7", "M1", "P1"],
    "D9": ["P3", "M1", "M2", "M3"], "D10": ["M6", "M7", "M4", "M5"],
    "O3": ["D1", "D2", "D3", "D4", "D5", "D7", "D8", "P4", "P1", "P3"],
    "O4": ["D1", "D2", "D7", "P1", "O3"],
    "O1": ["O3", "O4", "D7", "M1", "M2", "M3", "P1", "P2", "P4"],
    "O2": ["D7", "O3", "P1"],
    "O6": ["O1", "O2", "O3", "O4", "P1"],
    "O7": ["O1", "P1", "D7"],
    "O5": ["O1", "O2", "O6", "O7", "O3", "D7", "M9"],
}


def trim_context(agent_id: str, agent_outputs: Dict[str, Any]) -> Dict[str, Any]:
    needed = AGENT_INPUT_MAP.get(agent_id, [])
    return {k: agent_outputs[k] for k in needed if k in agent_outputs}


# ═══════════════════════════════════════════════════════════════════
# AGENT REGISTRY
# ═══════════════════════════════════════════════════════════════════

AGENT_GPEA: Dict[str, Dict[str, str]] = {
    "P1": {
        "name": "Demographics + Stage Parser",
        "goal": "Extract cancer type, AJCC/TNM staging, ECOG performance status, and all comorbidities.",
        "persona": "Senior oncology nurse specialist with 15 years of tumour board documentation experience.",
        "constraints": "ECOG must be numeric. List all comorbidities with ICD codes where documented.",
    },
    "P2": {
        "name": "Histology & Pathology Classifier",
        "goal": "Classify tumour histology using WHO classification, extract IHC markers, summarise HPR.",
        "persona": "Consultant histopathologist with WHO 5th edition tumour classification expertise.",
        "constraints": "Use WHO 5th edition. Report H-scores and percentage positivity for IHC.",
    },
    "P3": {
        "name": "Prior Therapy Analyser",
        "goal": "Construct chronological treatment history: therapy lines, responses, discontinuation reasons.",
        "persona": "Medical oncologist with 20 years of systemic therapy experience.",
        "constraints": "Every line: drugs, dates, best response, reason for stopping. Flag excluded drugs.",
    },
    "P4": {
        "name": "Performance & Fitness Scorer",
        "goal": "Assess patient fitness for targeted agents, immunotherapy, chemotherapy, cellular therapy, SCT.",
        "persona": "Clinical haematologist with HCT-CI scoring and organ-function gating expertise.",
        "constraints": "Apply HCT-CI for SCT. eGFR for renal, Child-Pugh for hepatic gating. Flag LVEF and QTc.",
    },
    "T1": {
        "name": "Genomic Test Recommender",
        "goal": "Recommend DNA sequencing strategy with gene targets, tissue requirements, clinical priority.",
        "persona": "Molecular oncologist and genomics lab director with NGS assay design expertise.",
        "constraints": "Justify every test. Specify FFPE/fresh/liquid. FDA companion diagnostics first.",
    },
    "T2": {
        "name": "Transcriptomic Panel Selector",
        "goal": "Select RNA tests: prognostic signatures, fusion panels, transcriptomic subtyping assays.",
        "persona": "Translational oncologist with Oncotype DX, Prosigna, PAM50, NanoString expertise.",
        "constraints": "Clinically validated tests only. Specify tissue input and turnaround time.",
    },
    "T3": {
        "name": "Proteomic Marker Recommender",
        "goal": "Identify companion diagnostic and ADC-target IHC tests with clones and thresholds.",
        "persona": "Pathologist with IHC companion diagnostic expertise for ADCs and targeted therapies.",
        "constraints": "FDA/EMA-approved assays. Specify clone, platform, threshold. HER2 needs FISH reflex.",
    },
    "T4": {
        "name": "Immune Profiling Selector",
        "goal": "Select PD-L1, TMB, MSI, HLA typing, and TIL assessment tests for ICI eligibility.",
        "persona": "Immuno-oncologist with immune checkpoint biomarker testing expertise.",
        "constraints": "PD-L1 clone and threshold per drug label. TMB >= 10 mut/Mb for pan-tumour approval.",
    },
    "T5": {
        "name": "Single-Cell Test Evaluator",
        "goal": "Evaluate scRNA-seq indication and CAR-T antigen uniformity requirements.",
        "persona": "Translational researcher with single-cell sequencing expertise in clinical oncology.",
        "constraints": "scRNA-seq only when heterogeneity materially affects therapy selection.",
    },
    "T6": {
        "name": "Germline Risk Screener",
        "goal": "Assess germline testing indication per NCCN/ASCO hereditary cancer guidelines.",
        "persona": "Clinical geneticist specialising in BRCA1/2, Lynch syndrome, multi-gene panels.",
        "constraints": "Apply NCCN criteria. Document germline separately from somatic. Flag at-risk family members.",
    },
    "T7": {
        "name": "Liquid Biopsy Recommender",
        "goal": "Design ctDNA/cfDNA/CTC monitoring plan with platform, clinical question, and intervals.",
        "persona": "Liquid biopsy specialist with ctDNA monitoring and MRD detection expertise.",
        "constraints": "Specify utility (baseline/monitoring/MRD/resistance). Not a substitute for tissue biopsy.",
    },
    "T8": {
        "name": "Epigenetic Test Recommender",
        "goal": "Identify MGMT methylation, IDH profiling, EZH2, MLH1, and methylation array needs.",
        "persona": "Neuro-oncologist with Heidelberg methylation classification expertise.",
        "constraints": "MGMT mandatory for glioma/GBM. IDH by IHC then sequencing. cIMPACT-NOW guidelines.",
    },
    "M1": {
        "name": "Somatic Variant Interpreter",
        "goal": "Interpret somatic variants with AMP/ASCO/CAP tiering, OncoKB/CIViC cross-reference.",
        "persona": "Molecular pathologist with 15 years CAP-accredited NGS panel experience.",
        "constraints": "Tier every variant (I-IV). Only Tier I/II guide therapy. Note VAF and coverage depth.",
    },
    "M2": {
        "name": "CNV + Fusion Detector",
        "goal": "Interpret CNVs and gene fusions, classify significance, map to approved therapies.",
        "persona": "Cytogenomicist with FISH, CMA, NGS-based CNV/fusion detection expertise.",
        "constraints": "High-level amplification >= 6 copies. Confirm fusion in-frame and kinase domain retention.",
    },
    "M3": {
        "name": "TMB / MSI / HRD Scorer",
        "goal": "Calculate TMB, MSI, HRD; apply FDA thresholds; determine ICI and PARPi eligibility.",
        "persona": "Biomarker scientist with pan-tumour threshold expertise.",
        "constraints": "TMB >= 10 = pembrolizumab eligible. MSI-H/dMMR = pembrolizumab eligible. HRD >= 42 = PARPi.",
    },
    "M4": {
        "name": "Transcriptomic Signature Interpreter",
        "goal": "Interpret RNA signatures: molecular subtypes, pathway activation, prognostic findings.",
        "persona": "Bioinformatician specialising in transcriptomic analysis and RNA-based signatures.",
        "constraints": "Distinguish prognostic from predictive. Flag low-quality RNA input.",
    },
    "M5": {
        "name": "Proteomic Pathway Mapper",
        "goal": "Confirm ADC target IHC expression and validate ADC eligibility thresholds per drug label.",
        "persona": "Translational oncologist specialising in HER2, TROP2, HER3, FRa, NECTIN4 ADC targets.",
        "constraints": "ADC eligibility requires confirmed IHC per drug-specific threshold. No cross-cancer extrapolation.",
    },
    "M6": {
        "name": "Single-Cell Heterogeneity Analyser",
        "goal": "Characterise clonal architecture, identify subclones, assess CAR-T antigen uniformity.",
        "persona": "Single-cell genomics specialist with clonal dynamics and cellular therapy expertise.",
        "constraints": "Antigen uniformity >= 90% for CAR-T. Flag subclone resistance variants.",
    },
    "M7": {
        "name": "Immune Phenotype Classifier",
        "goal": "Classify tumour immune phenotype (inflamed/excluded/desert) with unified TME classification.",
        "persona": "Tumour immunologist with TME characterisation and ICI biomarker expertise.",
        "constraints": "Apply Teng/Chen classification. Integrate PD-L1, TIL, TMB, MSI. Flag immunosuppressive mechanisms.",
    },
    "M8": {
        "name": "Epigenetic Alteration Interpreter",
        "goal": "Interpret MGMT methylation, IDH1/2, EZH2 mutations, MLH1 silencing, methylation array.",
        "persona": "Neuro-oncologist with Heidelberg classification and epigenetic therapy expertise.",
        "constraints": "MGMT: pyrosequencing preferred. IDH: IHC then sequencing. EZH2 Y646 actionable.",
    },
    "M9": {
        "name": "Germline Pathogenicity Agent",
        "goal": "Classify germline variants with ACMG/AMP criteria; manage VUS carefully.",
        "persona": "Clinical molecular geneticist with ACMG/AMP variant classification expertise.",
        "constraints": "VUS NEVER guides therapy. P/LP variants only. Document ACMG codes. Genetic counselling for P/LP.",
    },
    "D1": {
        "name": "Targeted Therapy Matcher",
        "goal": "Match Tier I/II variants to approved targeted therapies with evidence levels.",
        "persona": "Precision oncology pharmacologist with FDA/EMA targeted agent and basket trial expertise.",
        "constraints": "Tier I/II only. Note resistance mutations. Include ESMO-MCBS. Flag mandatory combinations.",
    },
    "D2": {
        "name": "ICI Eligibility Agent",
        "goal": "Determine eligibility for every approved checkpoint inhibitor based on biomarkers and organ function.",
        "persona": "Immuno-oncologist with ICI trial data and biomarker-driven selection expertise.",
        "constraints": "Drug-specific FDA thresholds. Flag autoimmune contraindications. Document prior irAE.",
    },
    "D3": {
        "name": "CAR-T + TCR Eligibility Agent",
        "goal": "Assess eligibility for approved CAR-T and TCR-T products including antigen requirements.",
        "persona": "Cellular therapy specialist with approved CAR-T product expertise.",
        "constraints": "Antigen uniformity >= 90%. Prior CD19 therapy documented. Flag REMS and centre certification.",
    },
    "D4": {
        "name": "Stem Cell Therapy Agent",
        "goal": "Evaluate auto/allo SCT eligibility, conditioning intensity, donor availability, GvHD risk.",
        "persona": "Bone marrow transplant physician with EBMT/CIBMTR eligibility criteria expertise.",
        "constraints": "HCT-CI for allo-SCT. RIC for HCT-CI >= 3. Document donor availability.",
    },
    "D5": {
        "name": "ADC Matcher",
        "goal": "Match IHC-confirmed ADC targets to approved ADCs with dose, schedule, eligibility.",
        "persona": "Medical oncologist specialising in approved ADCs across tumour types.",
        "constraints": "Requires M5 IHC confirmation. No threshold extrapolation. Flag payload toxicity class.",
    },
    "D6": {
        "name": "Clinical Trial Matcher",
        "goal": "Identify clinical trials matching molecular profile, cancer type, and prior therapy.",
        "persona": "Clinical trial navigator with precision oncology basket and umbrella protocol expertise.",
        "constraints": "Match: tumour type, alteration, lines, ECOG, organ function. Note phase and sponsor.",
    },
    "D7": {
        "name": "Approved Drug Ranker",
        "goal": "Produce ranked therapy list with ESMO-MCBS grades, evidence levels, biomarker confidence.",
        "persona": "Senior precision oncologist and tumour board chair with ESMO-MCBS expertise.",
        "constraints": "Rank: FDA > off-label > investigational, then ESMO-MCBS, then biomarker confidence.",
    },
    "D8": {
        "name": "Combination Regimen Agent",
        "goal": "Design mandatory combination regimens and validate safety of all combinations.",
        "persona": "Clinical pharmacologist with combination regimen and DDI expertise.",
        "constraints": "BRAF V600E: BRAF+MEK always — monotherapy prohibited. Document synergy and toxicity.",
    },
    "D9": {
        "name": "Resistance Mechanism Agent",
        "goal": "Analyse resistance mechanisms, identify failure causes, recommend next-line strategies.",
        "persona": "Translational oncologist specialising in acquired and intrinsic resistance.",
        "constraints": "Distinguish primary from acquired resistance. Map to downstream targets.",
    },
    "D10": {
        "name": "TME Analyser",
        "goal": "Characterise TME and identify therapeutic targets (VEGF, TGF-b, IDO, MDSCs, Tregs, CAFs).",
        "persona": "TME researcher with TME-directed therapy and combinatorial immunotherapy expertise.",
        "constraints": "Integrate M7, M2, M6. Identify dominant immunosuppressive mechanism.",
    },
    "O1": {
        "name": "Personalised Report Generator",
        "goal": "Generate comprehensive oncologist-grade precision oncology report.",
        "persona": "Chief precision oncologist with 25 years writing molecular tumour board reports.",
        "constraints": "Structure: summary -> findings -> therapy (ranked) -> safety -> trials -> monitoring.",
    },
    "O2": {
        "name": "Evidence Grader",
        "goal": "Apply ESMO-MCBS, NCCN, and ASCO Value Framework grades to every recommendation.",
        "persona": "HTA specialist with ESMO-MCBS v1.1 and NCCN evidence category expertise.",
        "constraints": "ESMO-MCBS A/B curative, 4/5 non-curative. NCCN Cat 1 to 2B/3.",
    },
    "O3": {
        "name": "Contraindication Checker [SAFETY GATE]",
        "goal": "REMOVE absolute contraindications and FLAG relative contraindications.",
        "persona": "Clinical pharmacologist and safety officer with oncology drug contraindication expertise.",
        "constraints": "Absolute contraindications MUST be removed. Relative flagged with guidance. Err on caution.",
    },
    "O4": {
        "name": "Drug Interaction Agent [SAFETY GATE]",
        "goal": "Identify CYP3A4, QTc, and immunosuppressant drug-drug interactions.",
        "persona": "Clinical pharmacist with CYP450, QTc, and interaction severity expertise.",
        "constraints": "Flag strong CYP3A4 inhibitors/inducers. Remove contraindicated QTc combos.",
    },
    "O5": {
        "name": "Audit Trail + Guardrail [FINAL GATE]",
        "goal": "Verify recommendation traceability, block orphan recommendations, produce audit trail.",
        "persona": "Clinical governance officer with molecular tumour board documentation expertise.",
        "constraints": "Every recommendation: biomarker link + evidence tier + O3/O4 clearance.",
    },
    "O6": {
        "name": "Oncologist Briefing Composer",
        "goal": "Compose concise MDT tumour board briefing (max 500 words).",
        "persona": "MDT chair who distils molecular data into decision-ready clinical summaries.",
        "constraints": "Max 500 words. Case summary -> key findings -> top 3 therapies -> safety -> actions.",
    },
    "O7": {
        "name": "Patient Summary Composer",
        "goal": "Write 8th-grade plain-language patient summary of findings and treatment options.",
        "persona": "Oncology patient navigator and health literacy specialist.",
        "constraints": "8th-grade reading level. No unexplained acronyms. Max 400 words. Avoid catastrophising.",
    },
}

# Flat registry for orchestrator prompt — no backslash in value
AGENT_REGISTRY = {k: v["name"] + ": " + v["goal"][:120] for k, v in AGENT_GPEA.items()}


# ═══════════════════════════════════════════════════════════════════
# ORCHESTRATOR AGENT
# ═══════════════════════════════════════════════════════════════════

class OrchestratorAgent(BaseAgent):
    agent_id = "ORCHESTRATOR"

    async def plan(self, state: GenomicsState) -> Dict:
        t0        = datetime.now().timestamp()
        completed = state.get("completed_agents", [])
        phase     = state.get("phase", "pretest")
        outputs   = state.get("agent_outputs", {})
        mol       = state.get("molecular_results") or {}
        cycle     = state.get("orchestration_cycle", 0)
        pd_out    = state.get("phase_detection") or {}

        # Pre-compute all values before building strings (no backslash in f-expr)
        output_summary = {
            aid: list(v.keys())[:5] if isinstance(v, dict) else type(v).__name__
            for aid, v in outputs.items()
        }

        all_p = ["P1", "P2", "P3", "P4"]
        all_t = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"]
        all_m = ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9"]
        all_d = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10"]
        all_o = ["O3", "O4", "O1", "O2", "O6", "O7", "O5"]

        eligible  = (all_p + all_t) if phase == "pretest" else (all_p + all_t + all_m + all_d + all_o)
        remaining = [a for a in eligible if a not in completed]

        # Pre-compute JSON strings for evidence block
        completed_json      = json.dumps(completed)
        remaining_json      = json.dumps(remaining)
        output_summary_json = json.dumps(output_summary, indent=2)
        mol_has             = str(mol.get("has_molecular_data", False))
        mol_count           = str(mol.get("entity_count", 0))
        pd_quality          = str(pd_out.get("data_quality_score", ""))
        pd_findings         = str(len(pd_out.get("key_actionable_findings", [])))
        registry_json       = json.dumps(AGENT_REGISTRY, indent=2)
        doc_names           = json.dumps([d.get("document") for d in state["graph_documents"]])
        cycle_str           = str(cycle + 1)
        max_cycle_str       = str(MAX_ORCHESTRATION_CYCLES)
        completed_count_str = str(len(completed))
        remaining_count_str = str(len(remaining))

        # Pretest remaining helpers (no backslash needed)
        pretest_remaining = [a for a in (all_p + all_t) if a not in completed]
        pretest_remaining_json = json.dumps(pretest_remaining)
        remaining_json_full    = json.dumps(remaining)

        if phase == "pretest":
            phase_rules = (
                "PRETEST: Run P agents (P1-P4) first, then T agents (T1-T8).\n"
                "Do NOT schedule M, D, or O agents.\n"
                "Remaining: " + pretest_remaining_json + "\n"
                "Set phase_gate='pretest_pause' when ALL P and T agents are done."
            )
        else:
            phase_rules = (
                "FULL: Run tiers in order P -> T -> M -> D -> O.\n"
                "T needs P1-P4. M needs molecular data. D7 needs D1,D2,D5,D6.\n"
                "D3,D4,D8,D9,D10 need D1,D2. O3+O4 before O1,O2,O6,O7. O5 last.\n"
                "Remaining agents: " + remaining_json_full + "\n"
                "Set phase_gate='done' ONLY after O5 completes.\n"
                "If remaining is empty, set pipeline_complete=true and phase_gate='done'."
            )

        system = gpea_system(
            goal="Orchestrate a precision oncology pipeline — decide which agents to run next.",
            persona="AI orchestration brain of a precision oncology decision support system.",
            constraints=(
                "Never re-run a completed agent.\n"
                "Respect all dependency rules strictly.\n"
                "Batch up to 5 INDEPENDENT agents per cycle.\n"
                "If no agents remain, set pipeline_complete=true.\n"
                "Respond with valid JSON only."
            ),
        )

        evidence = (
            "PHASE: " + phase + "\n"
            "CYCLE: " + cycle_str + " / " + max_cycle_str + "\n"
            "COMPLETED: " + completed_json + "\n"
            "REMAINING: " + remaining_json + "\n"
            "OUTPUT KEYS: " + output_summary_json + "\n"
            "MOLECULAR: has_data=" + mol_has + ", entities=" + mol_count + "\n"
            "PHASE DETECTOR: quality=" + pd_quality + ", findings=" + pd_findings + "\n"
            "DOCUMENTS: " + doc_names + "\n"
            "AGENT REGISTRY:\n" + registry_json
        )

        action = (
            "PHASE RULES:\n" + phase_rules + "\n\n"
            "Select the next agent batch. Per agent provide instructions.\n"
            "IMPORTANT: If remaining agents list is empty, return pipeline_complete=true.\n\n"
            "Return ONLY valid JSON:\n"
            "{\n"
            '  "next_agents": ["AGENT_ID_1", "AGENT_ID_2"],\n'
            '  "execution_mode": "parallel",\n'
            '  "phase_gate": "running | pretest_pause | done",\n'
            '  "pipeline_complete": false,\n'
            '  "orchestration_rationale": "...",\n'
            '  "agent_instructions": {\n'
            '    "AGENT_ID": {\n'
            '      "primary_input_agents": ["P1"],\n'
            '      "clinical_focus": "...",\n'
            '      "key_outputs_needed": ["field1", "field2"],\n'
            '      "special_considerations": ""\n'
            "    }\n"
            "  },\n"
            '  "completed_count": ' + completed_count_str + ',\n'
            '  "remaining_count": ' + remaining_count_str + "\n"
            "}"
        )

        result  = await self._invoke(system, gpea_user(evidence, action))
        elapsed = self._elapsed(t0)

        # Safety: orchestrator returned empty next_agents but remaining agents exist
        next_agents = result.get("next_agents", [])
        if not next_agents and remaining:
            forced = remaining[:3]
            logger.warning("Orchestrator returned empty next_agents; forcing %s", forced)
            result["next_agents"]       = forced
            result["pipeline_complete"] = False
            result["phase_gate"]        = "running"

        # Force complete when nothing left
        if not result.get("next_agents") and not remaining:
            result["pipeline_complete"] = True
            result["phase_gate"]        = "done" if phase == "full" else "pretest_pause"

        logger.info(
            "ORCHESTRATOR cycle %d | phase=%s | next=%s | gate=%s | %dms",
            cycle + 1, phase, result.get("next_agents", []),
            result.get("phase_gate"), elapsed,
        )
        return result


# ═══════════════════════════════════════════════════════════════════
# DYNAMIC AGENT
# ═══════════════════════════════════════════════════════════════════

class DynamicAgent(BaseAgent):
    def __init__(self, agent_id: str, llm_instance):
        super().__init__(llm_instance)
        self.agent_id = agent_id
        self.gpea     = AGENT_GPEA.get(agent_id, {
            "name": agent_id,
            "goal": "Execute " + agent_id + " role in the precision oncology pipeline.",
            "persona": "Precision oncology specialist.",
            "constraints": "Reason from provided data only. Respond with valid JSON.",
        })

    async def run(self, state: GenomicsState, instructions: Dict) -> Dict:
        t0 = datetime.now().timestamp()
        logger.info("%s — START", self.agent_id)

        primary_inputs     = instructions.get("primary_input_agents", [])
        clinical_focus     = instructions.get("clinical_focus", "")
        key_outputs_needed = instructions.get("key_outputs_needed", [])
        special_notes      = instructions.get("special_considerations", "")

        prior_outputs = trim_context(self.agent_id, state["agent_outputs"])
        for aid in primary_inputs:
            if aid in state["agent_outputs"] and aid not in prior_outputs:
                prior_outputs[aid] = state["agent_outputs"][aid]

        mol = state.get("molecular_results") or {}
        pd  = state.get("phase_detection") or {}

        # Pre-compute before building prompt strings
        goal_text = self.gpea["goal"] + ("\nSpecific focus: " + clinical_focus if clinical_focus else "")
        constraints_text = self.gpea["constraints"] + ("\nNOTE: " + special_notes if special_notes else "")

        system = gpea_system(
            goal=goal_text,
            persona=self.gpea["persona"],
            constraints=constraints_text,
        )

        if mol.get("has_molecular_data"):
            mol_block = json.dumps(
                {
                    "confidence": mol.get("molecular_data_confidence", ""),
                    "summary":    mol.get("extraction_summary", ""),
                    "findings":   mol.get("key_actionable_findings", []),
                    "entities":   mol.get("raw_molecular_entities", []),
                },
                indent=2,
                default=str,
            )
        else:
            mol_block = "No molecular/genomic data available."

        # Pre-compute JSON strings
        prior_json   = json.dumps(prior_outputs, indent=2, default=str) if prior_outputs else "None — read graph documents directly."
        summary_json = json.dumps(pd.get("pretest_clinical_summary", {}), indent=2)
        gap_json     = json.dumps(pd.get("clinical_gap_analysis", {}), indent=2)
        docs_json    = json.dumps(state["graph_documents"], indent=2, default=str)
        agent_label  = self.agent_id + " — " + self.gpea["name"]
        phase_val    = state.get("phase", "")
        specialty_val = state.get("specialty", "Oncology")

        evidence = (
            "AGENT: " + agent_label + "\n"
            "PHASE: " + phase_val + " | SPECIALTY: " + specialty_val + "\n\n"
            "PRIOR OUTPUTS (trimmed):\n" + prior_json + "\n\n"
            "MOLECULAR DATA:\n" + mol_block + "\n\n"
            "CLINICAL SUMMARY:\n" + summary_json + "\n\n"
            "GAP ANALYSIS:\n" + gap_json + "\n\n"
            "GRAPH DOCUMENTS:\n" + docs_json
        )

        if key_outputs_needed:
            key_block = "Required output fields:\n" + json.dumps(key_outputs_needed, indent=2)
        else:
            key_block = "Produce all outputs relevant to your specialist role."

        action = (
            key_block + "\n\n"
            "Produce complete specialist output as valid JSON.\n"
            "Cite source document for every clinical claim.\n"
            "Mark absent data as 'Not documented'."
        )

        result  = await self._invoke(system, gpea_user(evidence, action))
        elapsed = self._elapsed(t0)
        logger.info("%s — DONE (%dms)", self.agent_id, elapsed)
        return {"result": result, "elapsed_ms": elapsed}


# ═══════════════════════════════════════════════════════════════════
# EXECUTORS
# ═══════════════════════════════════════════════════════════════════

async def execute_parallel(
    agent_ids: List[str], state: GenomicsState, instructions: Dict
) -> Dict[str, Any]:
    outputs: Dict[str, Any] = {}
    batches = [
        agent_ids[i: i + MAX_PARALLEL_AT_ONCE]
        for i in range(0, len(agent_ids), MAX_PARALLEL_AT_ONCE)
    ]
    for idx, batch in enumerate(batches):
        logger.info("Parallel batch %d/%d: %s", idx + 1, len(batches), batch)
        agents  = [
            DynamicAgent(aid, llm_strong if aid in STRONG_LLM_AGENTS else llm_fast)
            for aid in batch
        ]
        tasks   = [a.run(state, instructions.get(aid, {})) for a, aid in zip(agents, batch)]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for aid, res in zip(batch, results):
            if isinstance(res, Exception):
                logger.error("%s failed: %s", aid, res)
                outputs[aid] = {"error": str(res)}
            else:
                outputs[aid] = res.get("result", {})
        if idx < len(batches) - 1:
            await asyncio.sleep(2)
    return outputs


async def execute_sequential(
    agent_ids: List[str], state: GenomicsState, instructions: Dict
) -> Dict[str, Any]:
    outputs: Dict[str, Any] = {}
    for aid in agent_ids:
        state["agent_outputs"].update(outputs)
        agent = DynamicAgent(aid, llm_strong if aid in STRONG_LLM_AGENTS else llm_fast)
        try:
            res = await agent.run(state, instructions.get(aid, {}))
            outputs[aid] = res.get("result", {})
        except Exception as exc:
            logger.error("%s sequential failed: %s", aid, exc)
            outputs[aid] = {"error": str(exc)}
        await asyncio.sleep(1)
    return outputs


# ═══════════════════════════════════════════════════════════════════
# LANGGRAPH NODES
# ═══════════════════════════════════════════════════════════════════

async def phase_detect_node(state: GenomicsState) -> GenomicsState:
    """Node 1 — LLM-based phase detection, no hardcoded keywords."""
    hint = state.get("phase") if state.get("phase") in ("pretest", "full") else None
    pd_result = await PhaseDetectorAgent(llm_strong).detect(state["graph_documents"], hint)

    state["phase"]           = pd_result.get("phase", "pretest")
    state["phase_detection"] = pd_result

    if pd_result.get("has_molecular_data"):
        state["molecular_results"] = {
            "has_molecular_data":        True,
            "entity_count":              len(pd_result.get("molecular_inventory", [])),
            "molecular_data_confidence": pd_result.get("molecular_data_confidence", "medium"),
            "extraction_summary":        pd_result.get("phase_reasoning", ""),
            "raw_molecular_entities":    pd_result.get("molecular_inventory", []),
            "key_actionable_findings":   pd_result.get("key_actionable_findings", []),
        }
        logger.info(
            "Molecular data loaded | entities=%d | confidence=%s",
            state["molecular_results"]["entity_count"],
            state["molecular_results"]["molecular_data_confidence"],
        )

    logger.info("Phase detection -> %s", state["phase"])
    return state


async def orchestrate_node(state: GenomicsState) -> GenomicsState:
    """Node 2 — Decide next agents. Hard-stops before LLM if limit reached."""
    cycle = state.get("orchestration_cycle", 0)

    if cycle >= HARD_STOP_CYCLE:
        logger.warning("Hard stop at cycle %d — forcing pipeline complete", cycle)
        state["pipeline_complete"] = True
        state["phase_gate"]        = "done"
        state["orchestration_plan"] = {
            "next_agents": [], "phase_gate": "done",
            "pipeline_complete": True, "agent_instructions": {},
        }
        return state

    plan = await OrchestratorAgent(llm_strong).plan(state)

    state["orchestration_plan"]  = plan
    state["pipeline_complete"]   = plan.get("pipeline_complete", False)
    state["orchestration_cycle"] = cycle + 1

    # Normalise gate — only allow known values
    gate = plan.get("phase_gate", "running")
    if gate not in ("running", "pretest_pause", "done"):
        gate = "running"
    state["phase_gate"] = gate

    return state


async def execute_node(state: GenomicsState) -> GenomicsState:
    """Node 3 — Run the agents chosen by orchestrate_node."""
    plan           = state.get("orchestration_plan") or {}
    next_agents    = plan.get("next_agents", [])
    execution_mode = plan.get("execution_mode", "parallel")
    instructions   = plan.get("agent_instructions", {})

    # Empty next_agents → mark done and exit
    if not next_agents:
        logger.warning("execute_node: empty next_agents — forcing pipeline complete")
        state["pipeline_complete"] = True
        state["phase_gate"] = "done" if state.get("phase") == "full" else "pretest_pause"
        return state

    # Stall detection — same batch repeated → exit
    last_batch = state.get("last_agent_batch", [])
    if sorted(next_agents) == sorted(last_batch):
        logger.warning("Stall detected — same batch repeated: %s. Forcing end.", next_agents)
        state["pipeline_complete"] = True
        state["phase_gate"]        = "done"
        return state

    state["last_agent_batch"] = list(next_agents)

    logger.info("execute_node | mode=%s | agents=%s", execution_mode, next_agents)
    t0 = datetime.now().timestamp()

    if execution_mode == "sequential":
        new_outputs = await execute_sequential(next_agents, state, instructions)
    else:
        new_outputs = await execute_parallel(next_agents, state, instructions)

    state["agent_outputs"].update(new_outputs)
    state["completed_agents"].extend(next_agents)

    elapsed = round((datetime.now().timestamp() - t0) * 1000, 1)
    for aid in next_agents:
        state["agent_timings"][aid] = round(elapsed / max(len(next_agents), 1), 1)

    logger.info(
        "execute_node done | %dms | completed=%s",
        elapsed, state["completed_agents"],
    )
    return state


# ═══════════════════════════════════════════════════════════════════
# ROUTING — must return "end" before hitting recursion limit
# ═══════════════════════════════════════════════════════════════════

def should_continue(state: GenomicsState) -> str:
    # Absolute hard stop by cycle count
    if state.get("orchestration_cycle", 0) >= HARD_STOP_CYCLE:
        logger.warning("should_continue: hard stop at cycle %d", state.get("orchestration_cycle"))
        return "end"

    if state.get("pipeline_complete"):
        return "end"

    gate = state.get("phase_gate", "running")

    if gate == "done":
        return "end"

    if gate == "pretest_pause":
        return "pretest_pause"

    if gate == "running":
        return "continue"

    # Unknown gate value — end safely
    logger.warning("should_continue: unknown phase_gate='%s' — ending", gate)
    return "end"


# ═══════════════════════════════════════════════════════════════════
# WORKFLOW
# ═══════════════════════════════════════════════════════════════════

def build_workflow():
    wf = StateGraph(GenomicsState)
    wf.add_node("phase_detect", phase_detect_node)
    wf.add_node("orchestrate",  orchestrate_node)
    wf.add_node("execute",      execute_node)
    wf.set_entry_point("phase_detect")
    wf.add_edge("phase_detect", "orchestrate")
    wf.add_edge("orchestrate",  "execute")
    wf.add_conditional_edges(
        "execute",
        should_continue,
        {"continue": "orchestrate", "pretest_pause": END, "end": END},
    )
    return wf.compile()


genomics_workflow = build_workflow()


# ═══════════════════════════════════════════════════════════════════
# STATE FACTORY
# ═══════════════════════════════════════════════════════════════════

def build_initial_state(
    patient_id: str,
    doctor_id:  str,
    specialty:  str,
    graph_docs: List[Dict],
    phase_hint: Optional[str] = None,
) -> GenomicsState:
    session_id    = "POIS-" + patient_id[:8] + "-" + str(int(datetime.now().timestamp()))
    initial_phase = phase_hint if phase_hint in ("pretest", "full") else "unknown"
    return GenomicsState(
        patient_id=patient_id,
        doctor_id=doctor_id,
        session_id=session_id,
        specialty=specialty,
        phase=initial_phase,
        graph_documents=graph_docs,
        molecular_results=None,
        phase_detection=None,
        orchestration_plan=None,
        completed_agents=[],
        pipeline_complete=False,
        phase_gate="running",
        orchestration_cycle=0,
        last_agent_batch=[],
        agent_outputs={},
        errors=[],
        agent_timings={},
    )


# ═══════════════════════════════════════════════════════════════════
# RESPONSE BUILDER
# ═══════════════════════════════════════════════════════════════════

def build_response(
    request:    AnalyseRequest,
    result:     GenomicsState,
    graph_docs: List[Dict],
    elapsed_ms: int,
) -> Dict:
    ao  = result.get("agent_outputs", {})
    mol = result.get("molecular_results") or {}
    pd  = result.get("phase_detection") or {}

    resp: Dict[str, Any] = {
        "patient_id":           request.patient_id,
        "doctor_id":            request.doctor_id,
        "session_id":           result.get("session_id"),
        "generated_at":         datetime.now().isoformat(),
        "processing_time_ms":   elapsed_ms,
        "phase_detected":       result.get("phase"),
        "documents_analyzed":   len(graph_docs),
        "version":              "POIS-4.1.0-gpea",
        "orchestration_cycles": result.get("orchestration_cycle", 0),
        "agents_completed":     result.get("completed_agents", []),
        "agent_timings":        result.get("agent_timings", {}),
        "errors":               result.get("errors", []),
        "phase_intelligence": {
            "phase":                     pd.get("phase"),
            "phase_reasoning":           pd.get("phase_reasoning"),
            "data_quality_score":        pd.get("data_quality_score"),
            "data_quality_notes":        pd.get("data_quality_notes"),
            "molecular_data_confidence": pd.get("molecular_data_confidence"),
            "entity_classification":     pd.get("entity_classification_summary", {}),
            "clinical_gap_analysis":     pd.get("clinical_gap_analysis", {}),
            "pretest_clinical_summary":  pd.get("pretest_clinical_summary", {}),
        },
        "molecular_extraction": {
            "has_molecular_data":        mol.get("has_molecular_data", False),
            "entity_count":              mol.get("entity_count", 0),
            "molecular_data_confidence": mol.get("molecular_data_confidence", ""),
            "extraction_summary":        mol.get("extraction_summary", ""),
            "key_actionable_findings":   mol.get("key_actionable_findings", []),
        },
        "clinical_context": {
            "demographics_and_stage": ao.get("P1"),
            "histology":              ao.get("P2"),
            "prior_therapy":          ao.get("P3"),
            "fitness":                ao.get("P4"),
        },
    }

    if any(ao.get(k) for k in ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"]):
        resp["recommended_test_menu"] = {
            "genomic_tests":    ao.get("T1"),
            "transcriptomic":   ao.get("T2"),
            "proteomic_ihc":    ao.get("T3"),
            "immune_profiling": ao.get("T4"),
            "single_cell":      ao.get("T5"),
            "germline":         ao.get("T6"),
            "liquid_biopsy":    ao.get("T7"),
            "epigenetic":       ao.get("T8"),
        }

    if any(ao.get(k) for k in ["D7", "O1", "O6"]):
        resp["therapy_report"] = {
            "oncologist_briefing": ao.get("O6"),
            "personalised_report": ao.get("O1"),
            "evidence_grades":     ao.get("O2"),
            "patient_summary":     ao.get("O7"),
            "audit_trail":         ao.get("O5"),
            "safety": {
                "contraindications": ao.get("O3"),
                "drug_interactions": ao.get("O4"),
            },
            "therapy_ranked":      ao.get("D7"),
            "combination_regimen": ao.get("D8"),
            "resistance_analysis": ao.get("D9"),
            "tme_analysis":        ao.get("D10"),
            "cellular_therapy": {
                "cart_tcr":  ao.get("D3"),
                "stem_cell": ao.get("D4"),
            },
            "trial_matches": ao.get("D6"),
        }

    if request.include_intermediates:
        resp["intermediate"] = {
            "all_agent_outputs":      ao,
            "molecular_results_full": mol,
            "phase_detection_full":   pd,
            "orchestration_cycles":   result.get("orchestration_cycle"),
            "orchestration_plan":     result.get("orchestration_plan"),
        }

    return resp


# ═══════════════════════════════════════════════════════════════════
# UNIFIED API ENDPOINT
# ══════════════════════════════════════════════════════════════════

@router.post("/analyse", response_model=None)
async def analyse(request: AnalyseRequest):
    """
    POIS v4.1 — unified precision oncology analysis.
    Phase detected by LLM agent (no hardcoded keywords).
    Recursion fixed: cycle cap=8, hard stop=10, recursion_limit=50.
    """
    start_ms = datetime.now().timestamp() * 1000
    logger.info("POIS v4.1 | patient=%s | hint=%s", request.patient_id, request.phase_hint)

    try:
        try:
            graph_docs = await fetch_graph_documents(request.patient_id)
        except Exception as exc:
            logger.warning("Neo4j unavailable: %s", exc)
            graph_docs = []

        if not graph_docs:
            raise HTTPException(
                status_code=404,
                detail="No clinical data found for patient " + request.patient_id,
            )

        state = build_initial_state(
            patient_id=request.patient_id,
            doctor_id=request.doctor_id,
            specialty=request.specialty,
            graph_docs=graph_docs,
            phase_hint=request.phase_hint,
        )

        # Explicit recursion_limit prevents LangGraph's 25-step default from firing
        result = await genomics_workflow.ainvoke(
            state,
            config={"recursion_limit": 50},
        )

        elapsed_ms    = round(datetime.now().timestamp() * 1000 - start_ms)
        session_id    = result.get("session_id")
        agent_outputs = result.get("agent_outputs", {})
        mol_out       = result.get("molecular_results") or {}
        pd_out        = result.get("phase_detection") or {}

        await genomics_col.replace_one(
            {"session_id": session_id},
            {
                "session_id":        session_id,
                "patient_id":        request.patient_id,
                "doctor_id":         request.doctor_id,
                "phase":             result.get("phase"),
                "agent_outputs":     agent_outputs,
                "graph_documents":   graph_docs,
                "molecular_results": mol_out,
                "phase_detection":   pd_out,
                "completed_agents":  result.get("completed_agents", []),
                "generated_at":      datetime.utcnow(),
            },
            upsert=True,
        )

        return build_response(request, result, graph_docs, elapsed_ms)

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("POIS v4.1 failed | patient=%s", request.patient_id)
        raise HTTPException(status_code=500, detail=str(exc))


# ═══════════════════════════════════════════════════════════════════
# HEALTH
# ═══════════════════════════════════════════════════════════════════

@router.get("/health")
async def health():
    strong_agents_sorted = sorted(STRONG_LLM_AGENTS)
    return {
        "status":  "ok",
        "version": "POIS-4.1.0-gpea",
        "fixes_v4_1": {
            "syntax_error":              "f-string backslash eliminated — all expressions pre-computed as variables",
            "max_orchestration_cycles":  MAX_ORCHESTRATION_CYCLES,
            "hard_stop_cycle":           HARD_STOP_CYCLE,
            "langgraph_recursion_limit": 50,
            "stall_detection":           "Repeated agent batch -> force END",
            "empty_next_agents":         "execute_node sets pipeline_complete=True",
            "unknown_phase_gate":        "should_continue returns end for unknown gate",
        },
        "architecture": {
            "phase_detection":  "PhaseDetectorAgent — LLM reasoning, zero hardcoded keywords",
            "prompt_framework": "GPEA (Goal -> Persona -> Evidence -> Action) on every agent",
            "endpoint":         "POST /genomics/analyse",
            "workflow":         "phase_detect -> orchestrate -> execute -> [loop | end]",
        },
        "llm_routing": {
            "fast_llm":   "llama-3.1-8b-instant for P/T/M/D agents",
            "strong_llm": "llama-3.3-70b-versatile for " + str(strong_agents_sorted),
        },
        "agents_available":  len(AGENT_GPEA) + 2,
        "workflow_compiled": genomics_workflow is not None,
    }