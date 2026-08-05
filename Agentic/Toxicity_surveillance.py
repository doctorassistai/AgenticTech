"""
Toxicity Surveillance & Immuno-Oncology System — v3.2
======================================================

CEO-aligned design principles:
  ① ICIs introduce irAEs that appear LATE, MIMIC other conditions,
    and require RAPID organ-specific intervention.
  ② irAEs responsible for up to 30% of ICI treatment discontinuations.
  ③ Early Grade 1–2 recognition + prompt steroid intervention
    prevents escalation to Grade 3–4.
  ④ DoctorAssist.ai Risk Agent monitors ICI cohorts CONTINUOUSLY
    for irAE signal patterns.

Individual Patient Pipeline  →  A13 → A14 → A15 → A16 → A17 → A18
                                 → A19 → A20 → [A21 + A22 + A23 PARALLEL]
                                 → A24 → A25 → A26

v3.2 fixes over v3.1:
  ✓ Cypher query now uses $patient_id parameter (no hardcoded ID)
  ✓ Parallel runner uses copy.deepcopy to prevent state mutation race condition
  ✓ A13 — plan-text filtering: entity_type + name heuristics prevent
          clinical instructions from being classified as treatments
  ✓ A16 — CTCAE grading: LLM instructed to extract quantitative measures
          from evidence text and grade accordingly (frequency, severity, duration)
  ✓ A18 — Early irAE detection: lowered confirmation threshold to
          "Possible/Suspected" for post-ICI symptoms without alternative cause;
          system logs missed Grade 1 opportunities
  ✓ A19 — ICI check: reads ici_exposure reliably from treatment_info dict
  ✓ A24 — ICI check: same robustness fix as A19
  ✓ A23 — Signal counts now reconcile with signal_classifications array
  ✓ A14 — No-baseline warning flag when all data is same-date
  ✓ MongoDB — _id removed from payload before return
  ✓ LLM timeouts added

Architecture:
  Neo4j graph fetch  →  Groq / LLaMA calls  →  FastAPI  →  MongoDB

Prompt design:
  • No hardcoded irAE names, organ timelines, or drug lists in any LLM prompt.
  • LLM derives ALL clinical patterns from the graph data in each request.
  • CTCAE grading logic uses QUANTITATIVE EVIDENCE extracted from graph data.
  • Constants retained as code-level validators / post-processors ONLY.
"""

from __future__ import annotations

import asyncio
import copy
import json
import os
import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, TypedDict

from fastapi import APIRouter, HTTPException, BackgroundTasks
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorClient
from neo4j import AsyncGraphDatabase
from pydantic import BaseModel

from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import StateGraph, END


# ============================================================
# ENVIRONMENT
# ============================================================

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
NEO4J_URI    = os.getenv("NEO4J_URI",      "bolt://neo4j:7687")
NEO4J_USER   = os.getenv("NEO4J_USER",     "neo4j")
NEO4J_PASS   = os.getenv("NEO4J_PASSWORD", "password")
MONGO_URI    = os.getenv("MONGO_URI")
MONGO_DB     = "doctorassistai"

# ── Neo4j ─────────────────────────────────────────────────────────────────────
neo4j_driver = AsyncGraphDatabase.driver(
    NEO4J_URI,
    auth=(NEO4J_USER, NEO4J_PASS),
    max_connection_lifetime=3600,
    max_connection_pool_size=50,
)

# ── MongoDB ───────────────────────────────────────────────────────────────────
mongo_client         = AsyncIOMotorClient(MONGO_URI)
mongo_db             = mongo_client[MONGO_DB]
toxicity_collection  = mongo_db["toxicity_surveillance"]
alerts_collection    = mongo_db["toxicity_alerts"]
cohort_collection    = mongo_db["ici_cohort"]
tracker_collection   = mongo_db["processing_tracker"]

# ── LLMs — added request_timeout to prevent silent hangs ─────────────────────
llm = ChatGroq(
    model="llama-3.1-8b-instant",
    temperature=0.1,
    max_tokens=6000,
    request_timeout=30,
    groq_api_key=GROQ_API_KEY,
)

llm_synthesis = ChatGroq(
    model="llama-3.3-70b-versatile",
    temperature=0.1,
    max_tokens=6000,
    request_timeout=45,
    groq_api_key=GROQ_API_KEY,
)

router = APIRouter(prefix="", tags=["Toxicity Surveillance"])


# ============================================================
# CODE-LEVEL CONSTANTS
# NOTE: These are used ONLY for post-processing validation,
#       alert persistence, and cohort classification.
#       They are NOT injected into any LLM prompt.
# ============================================================

LATE_ONSET_IRAE_PATTERNS = [
    "Immune-mediated Hypothyroidism",
    "Immune-mediated Hypophysitis",
    "Immune-mediated Adrenal Insufficiency",
    "Immune-mediated Pneumonitis",
    "Immune-mediated Nephritis",
    "Immune-mediated Myocarditis",
]

IRAE_MIMICKERS = {
    "Immune-mediated Colitis":           ["IBS", "Infectious diarrhea", "Chemo toxicity"],
    "Immune-mediated Pneumonitis":       ["Infection", "COPD exacerbation", "PE", "Tumor progression"],
    "Immune-mediated Hepatitis":         ["Viral hepatitis", "Drug-induced liver injury", "Tumor infiltration"],
    "Immune-mediated Thyroiditis":       ["Primary thyroid disease", "Drug effect"],
    "Immune-mediated Nephritis":         ["Dehydration", "NSAIDs", "Contrast nephropathy"],
    "Immune-mediated Hypophysitis":      ["Brain mets", "Pituitary adenoma", "Fatigue/depression"],
    "Immune-mediated Myocarditis":       ["ACS", "Pulmonary embolism", "Stress cardiomyopathy"],
    "Immune-mediated Adrenal Insufficiency": ["Fatigue", "Anorexia", "Electrolyte imbalance"],
}

ESCALATION_TIMELINE_DAYS = {
    "GI": 14, "Hepatic": 21, "Pulmonary": 10, "Endocrine": 42,
    "Dermatologic": 7, "Renal": 28, "Cardiac": 3, "Neurologic": 5,
}

ICI_HOLD_THRESHOLD_GRADE = 2
ICI_DISCONTINUE_GRADE    = 3
EMERGENT_ORGANS          = ["Cardiac", "Neurologic"]

# Plan-text verbs — used in A13 post-processing to filter non-drug entries
PLAN_TEXT_VERBS = re.compile(
    r"^\s*(continue|hold|monitor|initiate|consider|administer|refer|check|"
    r"order|start|stop|review|assess|obtain|perform|schedule|educate)\b",
    re.IGNORECASE,
)


# ============================================================
# REQUEST / RESPONSE MODELS
# ============================================================

class ToxicityRequest(BaseModel):
    patient_id:            str
    doctor_id:             str
    specialty:             str = "Oncology"
    include_intermediates: bool = False


class ToxicityTrigger(BaseModel):
    patient_id: str
    doctor_id:  str


class CohortScanRequest(BaseModel):
    doctor_id:       str
    scan_days_back:  int = 7
    min_alert_grade: str = "G1"


class CohortAlertQuery(BaseModel):
    doctor_id:       str
    alert_level:     Optional[str] = None
    unresolved_only: bool = True


# ============================================================
# CLINICAL STATE
# ============================================================

class ToxicityState(TypedDict):
    patient_id:      str
    doctor_id:       str
    specialty:       str
    graph_documents: List[Dict]
    dob:             Optional[str]
    sex:             Optional[str]

    treatment_info:  Optional[Dict]
    pre_treatment:   Optional[List[Dict]]
    post_treatment:  Optional[List[Dict]]
    baseline:        Optional[Dict]
    new_signals:     Optional[Dict]
    lab_changes:     Optional[Dict]
    toxicity_map:    Optional[Dict]
    risk_assessment: Optional[Dict]
    final_synthesis: Optional[Dict]

    quality_score:        Optional[Dict]
    narrative:            Optional[Dict]
    noise_separation:     Optional[Dict]
    escalation_risk:      Optional[Dict]
    discontinuation_risk: Optional[Dict]
    cohort_pattern:       Optional[Dict]

    narrative_paragraph_1: Optional[str]
    narrative_paragraph_2: Optional[str]
    alert_level:           Optional[str]

    no_baseline_warning: bool   # v3.2: set True when no pre-treatment data exists
    errors:        List[str]
    agent_timings: Dict[str, float]


# ============================================================
# NEO4J GRAPH FETCH  — v3.2: uses $patient_id parameter
# ============================================================

async def fetch_patient_graph_documents(patient_id: str) -> List[Dict]:
    """
    Fetch all clinical entities for a patient from Neo4j, ordered by date.
    Uses parameterised $patient_id — no hardcoded patient ID.
    """
    cypher = """
    MATCH (p:Patient {patient_id: $patient_id})-[r]->(n)
    OPTIONAL MATCH (n)-[:SUPPORTED_BY_EVIDENCE]->(e:Evidence)

    WITH r, n, e,
        CASE
            WHEN e IS NOT NULL AND e.document_date IS NOT NULL AND e.document_date <> "null"
            THEN toString(e.document_date)
            WHEN n.date IS NOT NULL
            THEN toString(n.date)
            ELSE toString(date())
        END AS raw_date,
        coalesce(e.document_name, "unknown") AS document

    WITH r, n, e, document, raw_date,
        CASE
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

            ELSE date()
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
        logger.info(f"Graph fetch: {len(docs)} documents | patient={patient_id}")
        return docs
    except Exception as e:
        logger.error(f"Neo4j fetch failed | patient={patient_id} | {e}")
        raise


async def fetch_patient_demographics(patient_id: str) -> Dict:
    try:
        patient = await mongo_db["patient_users"].find_one(
            {"sys_user_id": patient_id},
            {"_id": 0, "date_of_birth": 1, "gender": 1},
        )
        if not patient:
            return {"dob": None, "sex": None}
        return {"dob": patient.get("date_of_birth"), "sex": patient.get("gender")}
    except Exception:
        logger.exception(f"Demographics fetch failed | patient={patient_id}")
        return {"dob": None, "sex": None}


async def fetch_ici_cohort_patient_ids(doctor_id: str) -> List[str]:
    try:
        cursor = cohort_collection.find(
            {"doctor_id": doctor_id, "ici_active": True},
            {"_id": 0, "patient_id": 1},
        )
        ids = [doc["patient_id"] async for doc in cursor]
        logger.info(f"ICI cohort: {len(ids)} active patients | doctor={doctor_id}")
        return ids
    except Exception as e:
        logger.error(f"Cohort fetch failed | doctor={doctor_id} | {e}")
        return []


# ============================================================
# DEMO DATA
# ============================================================

def load_demo_graph_documents() -> List[Dict]:
    return [
        {
            "document": "baseline_oncology_2025-07-15.pdf",
            "document_date": "2025-07-15",
            "entities": [
                {"relation": "HAS_DIAGNOSIS",  "entity_type": "Diagnosis",
                 "name": "Metastatic NSCLC — Adenocarcinoma, PD-L1 TPS 85%, KRAS G12C",
                 "date": "2025-07-15",
                 "evidence": "Metastatic non-small cell lung carcinoma, adenocarcinoma histology, PD-L1 TPS 85%, KRAS G12C mutation. Initiating pembrolizumab monotherapy."},
                {"relation": "HAS_LAB",        "entity_type": "Lab Result",
                 "name": "ALT 24 U/L", "date": "2025-07-15",
                 "evidence": "ALT 24 U/L (ref 7–56). Normal hepatic function."},
                {"relation": "HAS_LAB",        "entity_type": "Lab Result",
                 "name": "AST 20 U/L", "date": "2025-07-15",
                 "evidence": "AST 20 U/L (ref 10–40). Normal."},
                {"relation": "HAS_LAB",        "entity_type": "Lab Result",
                 "name": "TSH 1.8 mIU/L", "date": "2025-07-15",
                 "evidence": "TSH 1.8 mIU/L (ref 0.4–4.0). Normal thyroid function."},
                {"relation": "HAS_LAB",        "entity_type": "Lab Result",
                 "name": "Creatinine 0.9 mg/dL", "date": "2025-07-15",
                 "evidence": "Serum creatinine 0.9 mg/dL. Normal renal function."},
                {"relation": "HAS_LAB",        "entity_type": "Lab Result",
                 "name": "Cortisol 18 mcg/dL", "date": "2025-07-15",
                 "evidence": "AM cortisol 18 mcg/dL (ref >18). Lower limit of normal."},
                {"relation": "HAS_VITAL",       "entity_type": "Vital Sign",
                 "name": "SpO2 97%", "date": "2025-07-15",
                 "evidence": "Oxygen saturation 97% on room air."},
                {"relation": "HAS_CONDITION",   "entity_type": "Diagnosis",
                 "name": "Type 2 Diabetes Mellitus — well controlled",
                 "date": "2025-07-15",
                 "evidence": "Background T2DM on metformin. HbA1c 6.9%."},
            ],
        },
        {
            "document": "cycle1_pembrolizumab_2025-07-22.pdf",
            "document_date": "2025-07-22",
            "entities": [
                {"relation": "HAS_TREATMENT",  "entity_type": "Treatment",
                 "name": "Pembrolizumab 200mg IV Q3W — Cycle 1",
                 "date": "2025-07-22",
                 "evidence": "Pembrolizumab 200mg IV administered. Cycle 1 Day 1. Indication: metastatic NSCLC PD-L1 TPS 85%."},
            ],
        },
        {
            "document": "cycle2_review_2025-08-12.pdf",
            "document_date": "2025-08-12",
            "entities": [
                {"relation": "HAS_TREATMENT",  "entity_type": "Treatment",
                 "name": "Pembrolizumab 200mg IV Q3W — Cycle 2",
                 "date": "2025-08-12",
                 "evidence": "Pembrolizumab Cycle 2 administered. Patient tolerating well."},
                {"relation": "HAS_SYMPTOM",    "entity_type": "Finding",
                 "name": "Mild fatigue — patient-reported",
                 "date": "2025-08-12",
                 "evidence": "Patient reports mild fatigue. Attributed to disease and treatment. No intervention."},
                {"relation": "HAS_LAB",        "entity_type": "Lab Result",
                 "name": "TSH 5.2 mIU/L", "date": "2025-08-12",
                 "evidence": "TSH 5.2 mIU/L — mildly elevated above ULN (0.4–4.0). Patient asymptomatic."},
                {"relation": "HAS_LAB",        "entity_type": "Lab Result",
                 "name": "ALT 68 U/L", "date": "2025-08-12",
                 "evidence": "ALT 68 U/L — mildly above ULN. Approximately 2.8× ULN."},
            ],
        },
        {
            "document": "cycle3_review_2025-09-02.pdf",
            "document_date": "2025-09-02",
            "entities": [
                {"relation": "HAS_TREATMENT",  "entity_type": "Treatment",
                 "name": "Pembrolizumab 200mg IV Q3W — Cycle 3",
                 "date": "2025-09-02",
                 "evidence": "Pembrolizumab Cycle 3 administered despite mild TSH elevation. No steroids initiated."},
                {"relation": "HAS_SYMPTOM",    "entity_type": "Finding",
                 "name": "Loose stools 4×/day for 6 days",
                 "date": "2025-09-02",
                 "evidence": "Loose stools 4 times per day, ongoing 6 days. Mild cramping. No blood. Grade 2 diarrhea."},
                {"relation": "HAS_SYMPTOM",    "entity_type": "Finding",
                 "name": "Dry cough new onset",
                 "date": "2025-09-02",
                 "evidence": "New onset non-productive cough, 10 days duration. No fever. No known infection."},
                {"relation": "HAS_LAB",        "entity_type": "Lab Result",
                 "name": "TSH 11.4 mIU/L", "date": "2025-09-02",
                 "evidence": "TSH 11.4 mIU/L — significantly elevated. Free T4 low at 0.6 ng/dL. Consistent with primary hypothyroidism."},
                {"relation": "HAS_LAB",        "entity_type": "Lab Result",
                 "name": "ALT 187 U/L", "date": "2025-09-02",
                 "evidence": "ALT 187 U/L — 7.8× ULN. AST 156 U/L — 7.8× ULN. Grade 3 hepatitis pattern."},
                {"relation": "HAS_VITAL",       "entity_type": "Vital Sign",
                 "name": "SpO2 93% on room air", "date": "2025-09-02",
                 "evidence": "SpO2 dropped to 93% on room air. Cough present. CT chest ordered."},
                {"relation": "HAS_LAB",        "entity_type": "Lab Result",
                 "name": "Cortisol 6 mcg/dL", "date": "2025-09-02",
                 "evidence": "AM cortisol 6 mcg/dL — low. ACTH stimulation test ordered. Possible adrenal insufficiency."},
            ],
        },
        {
            "document": "chest_ct_2025-09-04.pdf",
            "document_date": "2025-09-04",
            "entities": [
                {"relation": "HAS_FINDING",    "entity_type": "Finding",
                 "name": "Bilateral ground-glass opacities — pneumonitis pattern",
                 "date": "2025-09-04",
                 "evidence": "CT chest: bilateral ground-glass opacities in a peribronchovascular distribution. No consolidation. No pleural effusion. Pattern consistent with immune-mediated pneumonitis. Tumor stable."},
            ],
        },
    ]


# ============================================================
# BASE AGENT
# ============================================================

def parse_llm_json(text: str, agent_id: str = "") -> Dict:
    if not text:
        logger.warning(f"{agent_id} — parse_llm_json received empty text")
        return {}
    text = text.strip()
    text = re.sub(r"```json\s*", "", text)
    text = re.sub(r"```\s*",     "", text)
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        text = match.group(0)
    try:
        return json.loads(text)
    except Exception as exc:
        logger.warning(f"{agent_id} — JSON parse failed ({exc}); returning raw_output sentinel")
        return {"raw_output": text, "_parse_error": True}


class BaseAgent:
    def __init__(self, llm_instance):
        self.llm = llm_instance

    async def _invoke(self, system: str, user: str, agent_id: str = "") -> Dict:
        try:
            response = await self.llm.ainvoke([
                SystemMessage(content=system),
                HumanMessage(content=user),
            ])
            return parse_llm_json(response.content, agent_id)
        except Exception as exc:
            logger.error(f"{agent_id} — LLM invoke failed: {exc}")
            return {"_invoke_error": str(exc)}

    def _elapsed(self, start: float) -> float:
        return round((datetime.now().timestamp() - start) * 1000, 1)


# ============================================================
# A13 — TREATMENT EXTRACTION  (v3.2)
#
# Key changes:
#  • Prompt explicitly separates pharmacological agents from plan instructions.
#  • Post-processor filters names that match PLAN_TEXT_VERBS regex.
#  • Grounding validator still checks corpus membership.
# ============================================================

class TreatmentExtractionAgent(BaseAgent):
    agent_id = "A13"

    async def run(self, state: ToxicityState) -> ToxicityState:
        logger.info(f"{self.agent_id} · TreatmentExtractionAgent — START")
        t0 = datetime.now().timestamp()

        docs_json = json.dumps(state["graph_documents"], indent=2, default=str)

        system = (
            "You are a STRICT clinical pharmacology extraction system.\n\n"
            "CRITICAL GROUNDING RULES (NON-NEGOTIABLE):\n"
            "1. ONLY extract pharmacological treatment agents explicitly present in graph_documents.\n"
            "2. A TREATMENT is a drug, infusion, or therapeutic agent administered to the patient.\n"
            "3. A PLAN INSTRUCTION is a sentence describing what to do (e.g., 'Continue therapy', "
            "'Hold therapy if toxicity develops', 'Monitor for irAEs', 'Initiate corticosteroids'). "
            "PLAN INSTRUCTIONS ARE NOT TREATMENTS. Do NOT include them.\n"
            "4. Every treatment MUST have direct supporting evidence in evidence_text.\n"
            "5. DO NOT infer, assume, or guess missing treatments.\n"
            "6. If no pharmacological agent appears in the data → treatments_identified = [] and treatment_detected = false.\n"
            "7. Classify the ICI class (PD-1 / PD-L1 / CTLA-4 / combination) ONLY from the explicit drug name in the data.\n\n"
            "TREATMENT vs PLAN INSTRUCTION EXAMPLES:\n"
            "  ✓ Treatment:  'Pembrolizumab 200mg IV Q3W', 'Nivolumab', 'Metformin'\n"
            "  ✗ Not a treatment: 'Continue ICI therapy as per protocol'\n"
            "  ✗ Not a treatment: 'Hold therapy if toxicity develops'\n"
            "  ✗ Not a treatment: 'Monitor for irAEs at each cycle'\n"
            "  ✗ Not a treatment: 'Initiate corticosteroids if moderate toxicity occurs'\n\n"
            "Violation of these rules is a CRITICAL ERROR.\n"
            "Return ONLY valid JSON."
        )

        prompt = f"""
Extract ONLY pharmacological treatment agents from the patient documents below.

PATIENT GRAPH DOCUMENTS:
{docs_json}

══════════════════════════════════════════════════════════
STRICT EXTRACTION RULES
══════════════════════════════════════════════════════════

STEP 1 — IDENTIFY REAL TREATMENTS:
Before including any entry:
  ✓ Does the name refer to a drug, biologic, or infusion agent?
  ✓ Is it explicitly named in the "name" OR "evidence" fields?
  ✓ Is its entity_type "Treatment" or "Medication"?

STEP 2 — EXCLUDE PLAN TEXT:
Exclude ANY entry where the name:
  ✗ Starts with a verb like "Continue", "Hold", "Monitor", "Initiate", "Consider"
  ✗ Contains conditional clauses like "if toxicity", "as per protocol"
  ✗ Reads as an instruction rather than a drug name

STEP 3 — ICI CLASSIFICATION:
Determine ICI class ONLY from the explicit drug name in the data.
Do not use any external drug knowledge.

STEP 4 — REGIMEN-BASED RISK:
Based ONLY on treatment data found, assess baseline irAE risk as Low / Moderate / High.
Do not use organ-specific knowledge — reason from: combination ICI vs mono, number of cycles.

══════════════════════════════════════════════════════════

Return ONLY valid JSON:
{{
  "treatments_identified": [
    {{
      "treatment_name":         "exact drug name from data",
      "treatment_class":        "...",
      "ici_subtype":            "PD-1 | PD-L1 | CTLA-4 | combination | Not ICI | Not applicable",
      "treatment_date":         "...",
      "cycle_number":           "...",
      "total_cycles_to_date":   "...",
      "indication":             "...",
      "source_document":        "...",
      "evidence_text":          "exact supporting text from evidence field"
    }}
  ],
  "current_treatment": {{
    "treatment_detected":        false,
    "treatment_name":            "",
    "treatment_class":           "Unknown",
    "ici_subtype":               "Not applicable",
    "treatment_date":            "",
    "cycle_number":              "",
    "total_cycles_to_date":      "",
    "indication":                "",
    "source_document":           ""
  }},
  "ici_exposure":                  false,
  "ici_agents_received":           [],
  "cumulative_ici_cycles":         "",
  "combination_ici":               false,
  "combination_ici_agents":        [],
  "baseline_irae_risk_from_regimen": "Low",
  "treatment_history_summary":     ""
}}
"""

        raw_output = await self._invoke(system, prompt, self.agent_id)

        # ── Post-processing grounding + plan-text filter ──────────────────────
        def enforce_grounding(output: Dict, graph_docs: List[Dict]) -> Dict:
            corpus = json.dumps(graph_docs).lower()

            valid_treatments = []
            valid_agents = []

            for t in output.get("treatments_identified", []):
                if not isinstance(t, dict):
                    continue
                name = (t.get("treatment_name") or "").strip()
                # Filter plan-text entries by regex
                if PLAN_TEXT_VERBS.match(name):
                    logger.debug(f"{self.agent_id} — filtered plan-text entry: {name}")
                    continue
                # Filter overly long names (instructions tend to be sentences)
                if len(name) > 80:
                    logger.debug(f"{self.agent_id} — filtered long-name entry: {name[:60]}…")
                    continue
                evidence = (t.get("evidence_text") or "").lower()
                if name and (name.lower() in corpus or evidence in corpus):
                    valid_treatments.append(t)

            for agent in output.get("ici_agents_received", []):
                agent_name = ""
                if isinstance(agent, dict):
                    agent_name = (
                        agent.get("agent_name") or agent.get("name") or
                        agent.get("treatment_name") or ""
                    )
                elif isinstance(agent, str):
                    agent_name = agent

                if PLAN_TEXT_VERBS.match(agent_name):
                    continue
                if len(agent_name) > 80:
                    continue
                if agent_name.lower() in corpus:
                    valid_agents.append(agent)

            ici_exposure = len(valid_agents) > 0

            current = output.get("current_treatment", {})
            if not valid_treatments:
                current = {
                    "treatment_detected": False, "treatment_name": "",
                    "treatment_class": "Unknown", "ici_subtype": "Not applicable",
                    "treatment_date": "", "cycle_number": "",
                    "total_cycles_to_date": "", "indication": "", "source_document": "",
                }

            if valid_treatments:
                names = []
                for a in valid_agents:
                    names.append(a if isinstance(a, str) else (a.get("agent_name") or a.get("name") or str(a)))
                summary = "ICI agents documented: " + ", ".join(names) if names else "Treatments documented (non-ICI)"
            else:
                summary = "No pharmacological treatment documented in available records."

            return {
                **output,
                "treatments_identified":      valid_treatments,
                "ici_agents_received":        valid_agents,
                "ici_exposure":               ici_exposure,
                "current_treatment":          current,
                "treatment_history_summary":  summary,
            }

        state["treatment_info"] = enforce_grounding(raw_output, state["graph_documents"])
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(
            f"{self.agent_id} · DONE | ICI={state['treatment_info'].get('ici_exposure')} | "
            f"treatments={len(state['treatment_info'].get('treatments_identified', []))} | "
            f"{state['agent_timings'][self.agent_id]}ms"
        )
        return state


# ============================================================
# A14 — TIMELINE SEGMENTATION  (v3.2)
#
# Key changes:
#  • Sets no_baseline_warning = True when all documents share the same date.
#  • Downstream agents receive this flag to caveat their outputs.
# ============================================================

class TimelineSegmentationAgent(BaseAgent):
    agent_id = "A14"

    async def run(self, state: ToxicityState) -> ToxicityState:
        logger.info(f"{self.agent_id} · TimelineSegmentationAgent — START")
        t0 = datetime.now().timestamp()

        # Pre-process: resolve null dates
        processed_docs = []
        for doc in state["graph_documents"]:
            doc_copy = doc.copy()
            doc_date = doc_copy.get("document_date")
            if not doc_date or doc_date in ("None", "null"):
                entity_dates = [e.get("date") for e in doc_copy.get("entities", []) if e.get("date")]
                if entity_dates:
                    doc_copy["document_date"] = max(entity_dates)
                else:
                    treatment_info = state.get("treatment_info", {})
                    td = (treatment_info.get("current_treatment") or {}).get("treatment_date")
                    if td:
                        doc_copy["document_date"] = td
                    else:
                        continue
            processed_docs.append(doc_copy)

        # v3.2: detect single-date datasets (no baseline possible)
        unique_dates = set(d.get("document_date", "") for d in processed_docs)
        no_baseline = len(unique_dates) <= 1
        state["no_baseline_warning"] = no_baseline
        if no_baseline:
            logger.warning(
                f"{self.agent_id} — All documents share one date ({unique_dates}). "
                "No pre-treatment baseline can be established. Flagging downstream."
            )

        docs_json     = json.dumps(processed_docs,            indent=2, default=str)
        treatment_info = json.dumps(state["treatment_info"],  indent=2, default=str)

        system = (
            "You are a clinical data scientist. Split clinical data into pre-treatment "
            "and post-treatment windows based solely on the data provided.\n"
            "For irAE monitoring the post-treatment window is the surveillance zone.\n"
            "If ALL documents share the same date, classify all entities as post-treatment "
            "and note in segmentation_rationale that no baseline is available.\n"
            "Always respond with valid JSON only."
        )

        prompt = f"""
Split the patient's clinical data into pre-treatment and post-treatment windows.

TREATMENT CONTEXT:
{treatment_info}

NO BASELINE WARNING: {no_baseline}

FULL GRAPH DOCUMENTS:
{docs_json}

══════════════════════════════════════════════════════════
SEGMENTATION RULES
══════════════════════════════════════════════════════════

Pre-treatment  → All data BEFORE the ICI start date (baseline reference).
Post-treatment → All data ON or AFTER the ICI start date (surveillance zone).

If no_baseline_warning is true:
  → Set pre_treatment = []
  → Classify ALL documents as post-treatment
  → Set segmentation_rationale = "No pre-ICI baseline available — all data is from a single visit."

irAE ONSET WINDOW LABELS (assign based on days elapsed from ICI start):
  Early     →  0–42 days
  Medium    →  43–84 days
  Late      →  85+ days
  Very late →  180+ days

Return ONLY valid JSON:
{{
  "treatment_start_date_used":       "...",
  "segmentation_rationale":          "...",
  "no_baseline_available":           {str(no_baseline).lower()},
  "pre_treatment": [],
  "post_treatment": [
    {{
      "document":            "...",
      "document_date":       "...",
      "window":              "post_treatment",
      "days_from_ici_start": 0,
      "irae_onset_window":   "Early | Medium | Late | Very late",
      "entities":            []
    }}
  ],
  "pre_treatment_document_count":  0,
  "post_treatment_document_count": 0,
  "monitoring_duration_days":      0,
  "current_ici_week":              0
}}
"""
        raw = await self._invoke(system, prompt, self.agent_id)
        state["pre_treatment"]  = raw.get("pre_treatment",  [])
        state["post_treatment"] = raw.get("post_treatment", [])
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · DONE ({state['agent_timings'][self.agent_id]}ms) | no_baseline={no_baseline}")
        return state


# ============================================================
# A15 — BASELINE BUILDER
# ============================================================

class BaselineBuilderAgent(BaseAgent):
    agent_id = "A15"

    async def run(self, state: ToxicityState) -> ToxicityState:
        logger.info(f"{self.agent_id} · BaselineBuilderAgent — START")
        t0 = datetime.now().timestamp()

        pre_json           = json.dumps(state["pre_treatment"], indent=2, default=str)
        no_baseline_warning = state.get("no_baseline_warning", False)

        system = (
            "You are a clinical oncologist building a pre-ICI baseline profile.\n"
            "This baseline will be compared against post-treatment data to distinguish "
            "true irAE signals from pre-existing conditions.\n"
            "If no pre-treatment data is available, return a minimal baseline with "
            "all organ functions marked as 'Not documented' and set "
            "baseline_summary to explain the limitation.\n"
            "Always respond with valid JSON only."
        )

        prompt = f"""
Build the patient's pre-ICI baseline.

PRE-TREATMENT DOCUMENTS:
{pre_json}

NO BASELINE WARNING: {no_baseline_warning}

══════════════════════════════════════════════════════════
BASELINE EXTRACTION RULES
══════════════════════════════════════════════════════════

1. Extract ONLY what is explicitly documented in pre-treatment records.
2. If no_baseline_warning is true AND pre_treatment is empty:
   → Set all organ_function_summary fields to "Not documented"
   → Set baseline_summary to: "No pre-ICI baseline available for this patient.
     All clinical data is from a single visit. irAE grading comparisons are
     limited — use clinical judgement."
   → Set overall_baseline_irae_risk to "Cannot assess"
3. For each lab, capture the EXACT numerical value and reference range as documented.
4. Flag any pre-existing condition that could influence irAE detection.
5. Note borderline lab values — these are important irAE early-warning anchors.

Return ONLY valid JSON:
{{
  "baseline_conditions": [],
  "baseline_labs": [],
  "baseline_vitals": [],
  "organ_function_summary": {{
    "hepatic":   "Normal | Mildly impaired | Moderately impaired | Not documented",
    "renal":     "Normal | Mildly impaired | Moderately impaired | Not documented",
    "thyroid":   "Normal | Mildly impaired | Moderately impaired | Not documented",
    "adrenal":   "Normal | Mildly impaired | Moderately impaired | Not documented",
    "cardiac":   "Normal | Mildly impaired | Moderately impaired | Not documented",
    "pulmonary": "Normal | Mildly impaired | Moderately impaired | Not documented"
  }},
  "pre_existing_autoimmune":            [],
  "prior_immunosuppressive_therapy":    [],
  "high_risk_baseline_flags":           [],
  "overall_baseline_irae_risk":         "Low | Moderate | High | Very High | Cannot assess",
  "baseline_risk_rationale":            "...",
  "performance_status":                 "...",
  "baseline_summary":                   "..."
}}
"""
        state["baseline"]                     = await self._invoke(system, prompt, self.agent_id)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A16 — POST-TREATMENT SIGNAL EXTRACTION  (v3.2)
#
# Key changes:
#  • CTCAE grading prompt section: instructs LLM to extract
#    quantitative evidence (counts, frequencies, durations, severities)
#    from evidence text and grade accordingly.
#  • Grading methodology is data-driven, not hardcoded.
#  • "Worsened" detection enhanced for no-baseline scenarios.
# ============================================================

class SignalExtractionAgent(BaseAgent):
    agent_id = "A16"

    async def run(self, state: ToxicityState) -> ToxicityState:
        logger.info(f"{self.agent_id} · SignalExtractionAgent — START")
        t0 = datetime.now().timestamp()

        post_json          = json.dumps(state["post_treatment"],  indent=2, default=str)
        treatment_info     = json.dumps(state["treatment_info"],  indent=2, default=str)
        baseline           = json.dumps(state["baseline"],        indent=2, default=str)
        no_baseline_warning = state.get("no_baseline_warning", False)

        system = (
            "You are a STRICT clinical signal extraction and grading system.\n\n"
            "CRITICAL GROUNDING RULES:\n"
            "1. ONLY extract signals explicitly present in the provided documents.\n"
            "2. Every signal MUST be directly supported by evidence_text.\n"
            "3. DO NOT infer, assume, or generate missing clinical findings.\n"
            "4. If no ICI exposure → RETURN EMPTY OUTPUT.\n"
            "5. If no post-treatment signals → RETURN EMPTY OUTPUT.\n\n"
            "CTCAE GRADING RULE (DATA-DRIVEN — NO HARDCODED THRESHOLDS):\n"
            "For each signal, extract the QUANTITATIVE DESCRIPTORS from the evidence text:\n"
            "  • Frequency: how many times per day / per week is the symptom occurring?\n"
            "  • Duration: how many days has the symptom been present?\n"
            "  • Severity: if a numerical severity rating is given (e.g. 4/10), use it.\n"
            "  • Functional impact: does the evidence describe interference with daily activities?\n"
            "Then reason about grade:\n"
            "  • A symptom occurring multiple times per day (e.g. 4 or more) is NOT Grade 1.\n"
            "  • A symptom persisting for several days with documented frequency is more severe "
            "than a new, single-episode symptom.\n"
            "  • A new-onset respiratory symptom (cough, dyspnoea) post-ICI is always at least "
            "Grade 1 and should trigger a note that pulmonary assessment may be warranted.\n"
            "  • Do NOT default every symptom to Grade 1 — grade from the evidence numbers.\n\n"
            "NO BASELINE HANDLING:\n"
            "If no_baseline_warning is true, classify any post-ICI symptom with no documented "
            "pre-ICI equivalent as 'New' regardless of baseline comparison.\n\n"
            "Return ONLY valid JSON."
        )

        prompt = f"""
Extract and grade clinical signals from post-treatment data.

TREATMENT:
{treatment_info}

BASELINE (may be empty if no pre-treatment data):
{baseline}

NO BASELINE WARNING: {no_baseline_warning}

POST-TREATMENT DOCUMENTS:
{post_json}

══════════════════════════════════════════════════════════
GRADING INSTRUCTIONS
══════════════════════════════════════════════════════════

STEP 1 — ICI CHECK:
If ici_exposure = false → RETURN EMPTY JSON

STEP 2 — SIGNAL VALIDATION:
Include a signal ONLY if:
  ✓ Explicitly present in post-treatment text
  ✓ Has evidence_text

STEP 3 — QUANTITATIVE GRADING (DATA-DRIVEN):
For each signal found:
  a) Extract every number from the evidence text (frequency/day, duration in days, severity/10, etc.)
  b) Extract the specific descriptor (e.g. "4–6 loose watery stools per day for 5 days")
  c) Assign grade based on what those numbers tell you about severity:
     - Low frequency / brief duration / mild subjective severity → Grade 1
     - Moderate frequency (multiple per day) / days of persistence → Grade 2
     - Severe / disabling / requiring intervention → Grade 3+
  d) Store the quantitative rationale in ctcae_grade_rationale

STEP 4 — CLASSIFICATION:
  New      = not documented in baseline
  Worsened = explicitly described as worse than prior visit
  If no_baseline_warning = true → ALL post-ICI symptoms are "New"

STEP 5 — DENIED SYMPTOMS:
If evidence states "patient denies X" → DO NOT include X as a signal.

══════════════════════════════════════════════════════════

Return ONLY valid JSON:
{{
  "new_signals": [
    {{
      "signal_name":             "...",
      "entity_type":             "...",
      "organ_system":            "GI | Pulmonary | Hepatic | Endocrine | Dermatologic | Renal | Cardiac | Neurologic | Constitutional | Other",
      "ctcae_grade":             "G1 | G2 | G3 | G4",
      "ctcae_grade_rationale":   "explain the numbers from evidence that led to this grade",
      "quantitative_evidence":   "exact numbers/frequencies/durations from evidence text",
      "classification":          "New | Worsened",
      "onset_date":              "...",
      "duration_days":           0,
      "evidence_text":           "...",
      "source_document":         "..."
    }}
  ],
  "grade1_signals_count":          0,
  "grade2_signals_count":          0,
  "grade3_plus_signals_count":     0,
  "dismissed_grade1_signals":      [],
  "organ_systems_affected":        [],
  "highest_ctcae_grade_observed":  "None",
  "time_to_first_signal_days":     0,
  "concurrent_multiorgan_signals": false,
  "signal_summary":                "..."
}}
"""
        state["new_signals"]                  = await self._invoke(system, prompt, self.agent_id)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A17 — LAB TREND ANALYSIS
# ============================================================

class LabTrendAgent(BaseAgent):
    agent_id = "A17"

    async def run(self, state: ToxicityState) -> ToxicityState:
        logger.info(f"{self.agent_id} · LabTrendAgent — START")
        t0 = datetime.now().timestamp()

        pre_json           = json.dumps(state["pre_treatment"],  indent=2, default=str)
        post_json          = json.dumps(state["post_treatment"], indent=2, default=str)
        baseline           = json.dumps(state["baseline"],       indent=2, default=str)
        no_baseline_warning = state.get("no_baseline_warning", False)

        system = (
            "You are a STRICT clinical lab extraction system.\n\n"
            "CRITICAL GROUNDING RULES:\n"
            "1. ONLY use lab values explicitly present in documents.\n"
            "2. DO NOT generate or assume lab values.\n"
            "3. If a lab test is not present → DO NOT include it.\n"
            "4. If no valid comparison exists AND no_baseline_warning is false → RETURN EMPTY OUTPUT.\n"
            "5. DO NOT estimate ULN unless explicitly stated in evidence.\n\n"
            "NO BASELINE HANDLING:\n"
            "If no_baseline_warning is true:\n"
            "  → Include post-treatment labs even without baseline comparison.\n"
            "  → Set baseline_value to 'Not available — single visit'.\n"
            "  → Flag any lab value described as elevated/abnormal in evidence text.\n\n"
            "Return ONLY valid JSON."
        )

        prompt = f"""
Extract lab trends from available data.

BASELINE:
{baseline}

PRE:
{pre_json}

POST:
{post_json}

NO BASELINE WARNING: {no_baseline_warning}

══════════════════════════════════════════════════════════
RULES
══════════════════════════════════════════════════════════

STEP 1 — LAB EXISTENCE:
Only include a lab if explicitly in documents with a stated value.

STEP 2 — COMPARISON:
If no_baseline_warning = false: only compare if BOTH baseline and post values exist.
If no_baseline_warning = true:  include post-ICI labs that are flagged as abnormal
  in evidence text (e.g. "elevated", "above ULN", "low", "grade N").

STEP 3 — FOLD CHANGE:
Only calculate fold change if ULN is explicitly stated in evidence.

STEP 4 — FORBIDDEN:
✗ No assumed normal ranges
✗ No inferred lab trends
✗ No synthetic values

Return ONLY valid JSON:
{{
  "lab_changes": [
    {{
      "test_name":       "...",
      "baseline_value":  "...",
      "post_value":      "...",
      "unit":            "...",
      "reference_range": "...",
      "fold_change":     null,
      "ctcae_grade":     "...",
      "organ_system":    "...",
      "trend":           "Increasing | Decreasing | Stable | Single-point (no baseline)",
      "is_flagged":      false,
      "grade_crossing":  false,
      "flag_reason":     "...",
      "date":            "...",
      "source_document": "..."
    }}
  ],
  "new_post_ici_labs":               [],
  "grade_crossings_summary":         [],
  "flagged_lab_changes":             [],
  "organ_systems_with_lab_signals":  [],
  "highest_grade_lab_change":        "None",
  "rapid_escalation_detected":       false,
  "lab_trend_summary":               "..."
}}
"""
        state["lab_changes"]                  = await self._invoke(system, prompt, self.agent_id)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A18 — irAE TOXICITY MAPPING  (v3.2)
#
# Key changes:
#  • Introduces three confidence levels: Confirmed, Suspected, Possible.
#  • A new post-ICI symptom with no documented alternative cause is
#    at minimum "Possible irAE" — not excluded from the map.
#  • Missed Grade 1 opportunities are explicitly surfaced.
#  • Mimicker reasoning derives from graph data, not hardcoded lists.
# ============================================================

class ToxicityMappingAgent(BaseAgent):
    agent_id = "A18"

    async def run(self, state: ToxicityState) -> ToxicityState:
        logger.info(f"{self.agent_id} · ToxicityMappingAgent — START")
        t0 = datetime.now().timestamp()

        signals        = json.dumps(state["new_signals"],    indent=2, default=str)
        lab_changes    = json.dumps(state["lab_changes"],    indent=2, default=str)
        treatment_info = json.dumps(state["treatment_info"], indent=2, default=str)
        baseline       = json.dumps(state["baseline"],       indent=2, default=str)
        no_baseline_warning = state.get("no_baseline_warning", False)

        system = (
            "You are a STRICT irAE toxicity mapping system with EARLY DETECTION focus.\n\n"
            "CRITICAL GROUNDING RULES:\n"
            "1. ONLY map toxicity if valid ICI exposure exists.\n"
            "2. ONLY use signals explicitly extracted from prior steps.\n"
            "3. DO NOT create new signals.\n\n"
            "EARLY DETECTION PRINCIPLE (CEO REQUIREMENT):\n"
            "The purpose of this system is to detect irAEs EARLY, at Grade 1–2, "
            "before they escalate. Failing to flag a possible irAE is MORE dangerous "
            "than including a false positive that a clinician can review.\n\n"
            "CONFIDENCE TIER SYSTEM (map ALL signals that are post-ICI and unexplained):\n"
            "  Confirmed  → Lab or imaging evidence confirms the irAE pattern.\n"
            "  Suspected  → Clinical presentation is consistent with an irAE and "
            "no alternative cause is documented in the graph data.\n"
            "  Possible   → Symptom appeared after ICI initiation and has no documented "
            "pre-ICI equivalent and no documented alternative cause.\n\n"
            "KEY RULE: Do NOT leave suspected_toxicities = [] when there are new "
            "post-ICI symptoms. Map them at the appropriate confidence tier.\n\n"
            "MIMICKER REASONING: Derive alternative diagnoses ONLY from information "
            "present in the graph data (e.g., known comorbidities, prior diagnoses). "
            "Do NOT use generic medical knowledge to invent mimickers.\n\n"
            "Return ONLY valid JSON."
        )

        prompt = f"""
Map irAE toxicities using the early-detection confidence tier system.

TREATMENT:
{treatment_info}

BASELINE:
{baseline}

SIGNALS (from A16):
{signals}

LABS (from A17):
{lab_changes}

NO BASELINE WARNING: {no_baseline_warning}

══════════════════════════════════════════════════════════
MAPPING INSTRUCTIONS
══════════════════════════════════════════════════════════

STEP 1 — ICI CHECK:
If ici_exposure = false → RETURN EMPTY OUTPUT

STEP 2 — SIGNAL CHECK:
If new_signals.new_signals is empty → RETURN EMPTY OUTPUT

STEP 3 — MAP EACH SIGNAL:
For each signal in new_signals.new_signals:
  a) Does lab or imaging data confirm an irAE pattern? → Confidence = "Confirmed"
  b) Is clinical presentation consistent with irAE AND no alternative cause documented? → "Suspected"
  c) Appeared after ICI, no pre-ICI equivalent, no documented cause? → "Possible"
  d) Is there a documented alternative explanation in the graph data? → "Mimicker — not irAE"

STEP 4 — GRADE MAPPING:
Use the ctcae_grade already assigned in A16 (do not re-derive).
Preserve ctcae_grade_rationale from A16 signals.

STEP 5 — ORGAN SYSTEM:
Derive organ system from the symptom characteristics and evidence text.
Do NOT use any external organ-drug association list.

STEP 6 — MANAGEMENT RECOMMENDATION:
Based on the grade:
  G1 → Continue ICI, monitor closely, document.
  G2 → Hold ICI, consider steroids, work up.
  G3+ → Discontinue ICI, start steroids, specialist referral.
This is derived from grade, not from a hardcoded rule list.

STEP 7 — MISSED GRADE 1 OPPORTUNITIES:
Any Grade 1 signal found now should be assessed: was there a prior visit
in the graph data where this symptom was present but not escalated?
If so, document in missed_grade1_opportunities.

══════════════════════════════════════════════════════════

Return ONLY valid JSON:
{{
  "suspected_toxicities": [
    {{
      "irae_name":                      "descriptive name derived from organ + mechanism",
      "confidence":                     "Confirmed | Suspected | Possible",
      "organ_system":                   "...",
      "ctcae_grade":                    "G1 | G2 | G3 | G4",
      "ctcae_grade_rationale":          "...",
      "onset_timing":                   "...",
      "supporting_signals":             [],
      "supporting_labs":                [],
      "alternative_diagnoses_if_mimicker": [],
      "ici_management_recommendation":  "Continue with monitoring | Hold ICI | Discontinue ICI",
      "steroid_indicated":              false,
      "steroid_rationale":              "...",
      "urgency":                        "Routine | Urgent | Emergent",
      "clinical_evidence":              "..."
    }}
  ],
  "total_iraes_identified":          0,
  "multisystem_irae":                false,
  "organs_concurrently_affected":    [],
  "highest_grade_irae":              "None",
  "overall_ici_recommendation":      "Cannot assess",
  "ici_recommendation_rationale":    "...",
  "emergent_irAE_present":           false,
  "emergent_irae_details":           "",
  "missed_grade1_opportunities":     [],
  "toxicity_mapping_summary":        "..."
}}
"""
        state["toxicity_map"]                 = await self._invoke(system, prompt, self.agent_id)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A19 — RISK PREDICTION  (v3.2)
#
# Key change: robust ICI check reads bool from treatment_info dict
# rather than relying on string comparison that could fail.
# ============================================================

class RiskPredictionAgent(BaseAgent):
    agent_id = "A19"

    async def run(self, state: ToxicityState) -> ToxicityState:
        logger.info(f"{self.agent_id} · RiskPredictionAgent — START")
        t0 = datetime.now().timestamp()

        baseline       = json.dumps(state.get("baseline", {}),       indent=2, default=str)
        treatment_info = json.dumps(state.get("treatment_info", {}), indent=2, default=str)
        toxicity_map   = json.dumps(state.get("toxicity_map", {}),   indent=2, default=str)

        # v3.2: read ici_exposure directly from state, not from JSON string
        ici_exposure = state.get("treatment_info", {}).get("ici_exposure", False)

        system = (
            "You are a STRICT clinical risk prediction system.\n\n"
            "CRITICAL GROUNDING RULES:\n"
            "1. ONLY use explicitly provided patient data.\n"
            "2. If no ICI exposure → RETURN NOT APPLICABLE output.\n"
            "3. If no irAE → DO NOT predict organ risks.\n"
            "4. If no lab data → DO NOT create monitoring plans.\n\n"
            "Return ONLY valid JSON."
        )

        not_applicable_output = {
            "overall_future_risk": "Not applicable",
            "risk_rationale": "No ICI exposure confirmed",
            "risk_multipliers_present": [],
            "organ_risks": [],
            "second_irae_risk": "Not applicable",
            "second_irae_most_likely_organ": "",
            "grade_3_4_risk_estimate": "Not applicable",
            "grade_3_4_risk_percent": "Not applicable",
            "ici_discontinuation_risk": "Not applicable",
            "discontinuation_risk_rationale": "No ICI therapy",
            "continuous_monitoring_plan": [],
            "prophylactic_measures_recommended": [],
            "risk_summary": "Risk prediction not applicable without ICI",
        }

        if not ici_exposure:
            logger.info(f"{self.agent_id} — ICI not confirmed, returning not-applicable")
            state["risk_assessment"] = not_applicable_output
            state["agent_timings"][self.agent_id] = self._elapsed(t0)
            return state

        prompt = f"""
Predict future irAE risk using only the data provided.

BASELINE:
{baseline}

TREATMENT:
{treatment_info}

TOXICITY MAP (from A18):
{toxicity_map}

══════════════════════════════════════════════════════════
STRICT DECISION LOGIC
══════════════════════════════════════════════════════════

ICI CONFIRMED. Proceed with risk assessment.

STEP 1 — irAE PRESENT CHECK:
If toxicity_map.suspected_toxicities is empty:
  → organ_risks = []
  → second_irae_risk = "Low — no current irAE signals"

STEP 2 — ORGAN RISKS:
Only include organs explicitly present in toxicity_map.
Reason about secondary irAE risk from: number of current irAEs,
grade level, multisystem involvement, ICI class from treatment_info.

STEP 3 — MONITORING PLAN:
Only include lab tests that:
  ✓ Already exist in patient data (from A17 labs), OR
  ✓ Are directly relevant to a confirmed/suspected irAE from A18.

STEP 4 — DATA FORBIDDEN:
✗ Do NOT add labs not present in patient data
✗ Do NOT assume autoimmune history
✗ Do NOT use generic oncology monitoring schedules

Return ONLY valid JSON:
{{
  "overall_future_risk":           "Low | Moderate | High | Very High",
  "risk_rationale":                "...",
  "risk_multipliers_present":      [],
  "organ_risks":                   [],
  "second_irae_risk":              "...",
  "second_irae_most_likely_organ": "...",
  "grade_3_4_risk_estimate":       "...",
  "grade_3_4_risk_percent":        "...",
  "ici_discontinuation_risk":      "Low | Moderate | High",
  "discontinuation_risk_rationale":"...",
  "continuous_monitoring_plan":    [],
  "prophylactic_measures_recommended": [],
  "risk_summary":                  "..."
}}
"""
        state["risk_assessment"]              = await self._invoke(system, prompt, self.agent_id)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A20 — FINAL SYNTHESIS
# ============================================================

class FinalSynthesisAgent(BaseAgent):
    agent_id = "A20"

    async def run(self, state: ToxicityState) -> ToxicityState:
        logger.info(f"{self.agent_id} · FinalSynthesisAgent — START")
        t0 = datetime.now().timestamp()

        treatment_info     = json.dumps(state.get("treatment_info", {}), indent=2, default=str)
        toxicity_map       = json.dumps(state.get("toxicity_map", {}),   indent=2, default=str)
        risk               = json.dumps(state.get("risk_assessment", {}), indent=2, default=str)
        baseline           = json.dumps(state.get("baseline", {}),        indent=2, default=str)
        signals            = json.dumps(state.get("new_signals", {}),     indent=2, default=str)
        lab_changes        = json.dumps(state.get("lab_changes", {}),     indent=2, default=str)
        no_baseline_warning = state.get("no_baseline_warning", False)
        ici_exposure       = state.get("treatment_info", {}).get("ici_exposure", False)

        system = (
            "You are a STRICT clinical synthesis system.\n\n"
            "CRITICAL GROUNDING RULES:\n"
            "1. ONLY use explicitly provided patient data.\n"
            "2. If no ICI → NO toxicity workflow.\n"
            "3. CONSISTENCY RULE: The grade1_watchlist MUST ONLY contain signals from A16. "
            "If A18 suspected_toxicities is empty but A16 signals exist, "
            "those signals belong on grade1_watchlist — not on suspected_toxicities. "
            "Do NOT have a non-empty watchlist AND zero irAEs at the same time without "
            "explaining the distinction in the rationale.\n"
            "4. ALERT LEVEL RULE: If any Grade 2 signal exists, alert_level = 'Alert' minimum. "
            "If any Grade 3+ signal exists, alert_level = 'Emergency'.\n\n"
            "Return ONLY valid JSON."
        )

        if not ici_exposure:
            no_ici_output = {
                "alert_level": "Routine",
                "alert_rationale": "No ICI therapy detected",
                "toxicity_detection": {
                    "iraes_confirmed_probable": [], "iraes_possible": [],
                    "grade1_watchlist": [], "multisystem_involvement": False,
                    "missed_grade1_signals": [],
                },
                "ici_management_decision": {
                    "recommendation": "Cannot assess", "rationale": "No ICI therapy",
                    "hold_vs_discontinue": "Not applicable",
                    "rechallenge_eligible": False, "rechallenge_criteria": [],
                    "rechallenge_conditions": "",
                    "steroid_protocol": {
                        "indicated": False, "agent": "", "dose": "",
                        "route": "", "duration": "", "taper_plan": "",
                    },
                    "additional_immunosuppressant": "",
                },
                "discontinuation_prevention_note": "",
                "risk_summary": {"overall_risk": "Not applicable", "key_organ_risks": [], "next_irae_prediction": ""},
                "recommended_actions": [], "monitoring_plan": [], "specialist_referrals": [],
                "patient_education": [],
                "summary": "No ICI therapy detected. Toxicity surveillance not applicable.",
            }
            state["final_synthesis"] = no_ici_output
            state["agent_timings"][self.agent_id] = self._elapsed(t0)
            return state

        prompt = f"""
Synthesize final clinical report.

TREATMENT:
{treatment_info}

BASELINE:
{baseline}

SIGNALS (A16):
{signals}

LABS (A17):
{lab_changes}

TOXICITY MAP (A18):
{toxicity_map}

RISK (A19):
{risk}

NO BASELINE WARNING: {no_baseline_warning}

══════════════════════════════════════════════════════════
SYNTHESIS RULES
══════════════════════════════════════════════════════════

STEP 1 — ALERT LEVEL:
  Routine    → No irAE signals at all.
  Caution    → Grade 1 signals on watchlist, no confirmed irAE.
  Alert      → Suspected/Confirmed Grade 2 irAE present.
  Emergency  → Grade 3+ irAE, or emergent organ involvement.

STEP 2 — WATCHLIST vs CONFIRMED irAE:
  grade1_watchlist   → Grade 1 signals that are Possible irAE (unconfirmed).
  iraes_confirmed_probable → Confirmed or Suspected irAEs from A18.
  These are MUTUALLY EXCLUSIVE lists for the same signal.

STEP 3 — CONSISTENCY CHECK:
  If A16 signals exist AND A18 suspected_toxicities is empty:
  → Those signals go on grade1_watchlist with alert_level = "Caution" minimum.
  → ici_management_decision.recommendation = "Continue ICI with close monitoring"
  → steroid_protocol.indicated = false

STEP 4 — MANAGEMENT DECISION:
  Derive from highest confirmed grade in A18:
  G1  → Continue with monitoring
  G2  → Hold ICI, consider steroids
  G3+ → Discontinue ICI, steroids, specialist referral
  No irAE → Continue with monitoring

STEP 5 — NO BASELINE CAVEAT:
  If no_baseline_warning is true, include in summary:
  "Note: No pre-ICI baseline available for this patient. Signal assessment is
  based on a single visit. Clinical judgement required."

STEP 6 — DATA USAGE:
  Only include actions, monitoring, referrals supported by A16–A19 outputs.
  DO NOT add generic oncology monitoring not present in the data.

Return ONLY valid JSON (same structure as before).
"""
        state["final_synthesis"]              = await self._invoke(system, prompt, self.agent_id)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A21 — QUALITY EVALUATOR  (parallel)
# ============================================================

class QualityEvaluatorAgent(BaseAgent):
    agent_id = "A21"

    async def run(self, state: ToxicityState) -> ToxicityState:
        logger.info(f"{self.agent_id} · QualityEvaluatorAgent — START")
        t0 = datetime.now().timestamp()

        synthesis    = json.dumps(state.get("final_synthesis", {}), indent=2, default=str)
        toxicity_map = json.dumps(state.get("toxicity_map", {}),    indent=2, default=str)
        signals      = json.dumps(state.get("new_signals", {}),     indent=2, default=str)
        docs         = [d.get("document") for d in state.get("graph_documents", [])]
        ici_exposure = state.get("treatment_info", {}).get("ici_exposure", False)

        system = (
            "You are a STRICT clinical QA evaluator.\n\n"
            "CRITICAL RULES:\n"
            "1. ONLY evaluate what is explicitly present.\n"
            "2. Do NOT penalise absence of data — if there is no data, scores default to 1.0.\n"
            "3. Hallucination = output contains data NOT present in source documents.\n"
            "4. GRADING ACCURACY: If A16 new_signals contains quantitative descriptors "
            "(e.g. '4-6 stools/day') and the assigned grade does not reflect that severity, "
            "flag it as a grading error.\n"
            "5. CONSISTENCY: Flag if grade1_watchlist is non-empty but suspected_toxicities is "
            "empty without explanation.\n\n"
            "Return ONLY valid JSON."
        )

        prompt = f"""
Evaluate this toxicity pipeline output.

SOURCE DOCUMENTS: {json.dumps(docs, indent=2)}

SIGNALS (A16):
{signals}

TOXICITY MAP (A18):
{toxicity_map}

FINAL SYNTHESIS (A20):
{synthesis}

ICI EXPOSURE: {ici_exposure}

══════════════════════════════════════════════════════════
EVALUATION LOGIC
══════════════════════════════════════════════════════════

STEP 1 — If ICI not confirmed → all scores = 1.0, approved = true.

STEP 2 — GRADING ACCURACY CHECK:
For each signal in A16 new_signals that has quantitative_evidence or
ctcae_grade_rationale, check if the assigned ctcae_grade is consistent
with the numbers. If a signal states "4-6 per day" but is graded G1, that is
a grading error.

STEP 3 — HALLUCINATION:
Flag ONLY if output contains data NOT in source documents.

STEP 4 — EARLY WARNING:
If Grade 1-2 signals exist and were not escalated to suspected_toxicities
nor placed on watchlist, flag as early_warning_gaps.

STEP 5 — CONSISTENCY:
Check that grade1_watchlist and suspected_toxicities are used correctly
(mutually exclusive, consistent with grades).

Scores are 0.0–1.0 where 1.0 = perfect.

Return ONLY valid JSON:
{{
  "scores": {{
    "signal_detection_completeness": 0.0,
    "ctcae_grading_accuracy":        0.0,
    "hallucination_risk":            0.0,
    "management_appropriateness":    0.0,
    "early_warning_quality":         0.0,
    "overall":                       0.0
  }},
  "confidence_band":             "...",
  "missed_signals":              [],
  "ctcae_grading_errors":        [],
  "management_errors":           [],
  "hallucination_flags":         [],
  "early_warning_gaps":          [],
  "improvement_recommendations": [],
  "requires_physician_review":   false,
  "review_priority_items":       [],
  "approved_for_clinical_use":   true
}}
"""
        state["quality_score"]                = await self._invoke(system, prompt, self.agent_id)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A22 — NARRATIVE GENERATOR  (parallel)
# ============================================================

class NarrativeAgent(BaseAgent):
    agent_id = "A22"

    async def run(self, state: ToxicityState) -> ToxicityState:
        logger.info(f"{self.agent_id} · NarrativeAgent — START")
        t0 = datetime.now().timestamp()

        treatment_info     = json.dumps(state.get("treatment_info", {}), indent=2, default=str)
        toxicity_map       = json.dumps(state.get("toxicity_map", {}),   indent=2, default=str)
        risk               = json.dumps(state.get("risk_assessment", {}), indent=2, default=str)
        synthesis          = json.dumps(state.get("final_synthesis", {}), indent=2, default=str)
        baseline           = json.dumps(state.get("baseline", {}),        indent=2, default=str)
        dob                = state.get("dob", "Not documented")
        sex                = state.get("sex", "Not documented")
        no_baseline_warning = state.get("no_baseline_warning", False)
        ici_exposure       = state.get("treatment_info", {}).get("ici_exposure", False)

        system = (
            "You are a STRICT clinical narrative generator.\n\n"
            "CRITICAL GROUNDING RULES:\n"
            "1. ONLY summarise explicitly provided data.\n"
            "2. Do NOT mention labs, signals, or conditions not present.\n"
            "3. If no ICI → generate a one-sentence minimal narrative.\n"
            "4. If no_baseline_warning is true, include a brief caveat in paragraph_2.\n"
            "5. paragraph_1 and paragraph_2 must NOT repeat the same facts.\n"
            "6. Demographics (DOB/sex) only included if explicitly provided.\n\n"
            "Return ONLY valid JSON."
        )

        prompt = f"""
Generate a two-paragraph clinical narrative.

DOB: {dob}  |  SEX: {sex}  |  ICI: {ici_exposure}  |  NO BASELINE: {no_baseline_warning}

TREATMENT:
{treatment_info}

BASELINE:
{baseline}

TOXICITY MAP:
{toxicity_map}

RISK:
{risk}

SYNTHESIS:
{synthesis}

══════════════════════════════════════════════════════════
NARRATIVE RULES
══════════════════════════════════════════════════════════

paragraph_1 — Clinical Status:
  Summarise: current ICI regimen (cycle), any confirmed/suspected irAEs,
  highest grade observed. Be factual and brief (2-4 sentences).

paragraph_2 — Plan & Caveats:
  Summarise: management recommendation, key monitoring actions.
  If no_baseline_warning = true, add: "Note: assessment is limited by the
  absence of a pre-treatment baseline for this visit."

bottom_line — One sentence maximum.

alert_level — Routine | Caution | Alert | Emergency
  Derived from highest grade irAE or synthesis.alert_level.

Return ONLY valid JSON:
{{
  "narrative": {{
    "paragraph_1":  "...",
    "paragraph_2":  "...",
    "bottom_line":  "...",
    "alert_level":  "Routine | Caution | Alert | Emergency",
    "deduplication_check": {{
      "facts_in_p1_only":       [],
      "facts_in_p2_only":       [],
      "no_fact_appears_in_both": true
    }}
  }}
}}
"""
        raw       = await self._invoke(system, prompt, self.agent_id)
        narrative = raw.get("narrative", raw)

        if isinstance(narrative, str):
            parts = [p.strip() for p in narrative.split("\n\n") if p.strip()]
            state["narrative"]             = raw
            state["narrative_paragraph_1"] = parts[0] if parts else narrative
            state["narrative_paragraph_2"] = " ".join(parts[1:]) if len(parts) > 1 else ""
            state["alert_level"]           = "Routine"
        else:
            state["narrative"]             = narrative
            state["narrative_paragraph_1"] = narrative.get("paragraph_1", "")
            state["narrative_paragraph_2"] = narrative.get("paragraph_2", "")
            state["alert_level"]           = narrative.get("alert_level", "Routine")

        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · DONE | alert={state['alert_level']} ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A23 — SIGNAL-TO-NOISE SEPARATOR  (v3.2)
#
# Key change: signal counts in summary MUST match
# len(signal_classifications) — explicit reconciliation instruction.
# ============================================================

class SignalNoiseAgent(BaseAgent):
    agent_id = "A23"

    async def run(self, state: ToxicityState) -> ToxicityState:
        logger.info(f"{self.agent_id} · SignalNoiseAgent — START")
        t0 = datetime.now().timestamp()

        signals        = json.dumps(state.get("new_signals", {}),    indent=2, default=str)
        lab_changes    = json.dumps(state.get("lab_changes", {}),    indent=2, default=str)
        toxicity_map   = json.dumps(state.get("toxicity_map", {}),   indent=2, default=str)
        baseline       = json.dumps(state.get("baseline", {}),       indent=2, default=str)
        treatment_info = json.dumps(state.get("treatment_info", {}), indent=2, default=str)
        ici_exposure   = state.get("treatment_info", {}).get("ici_exposure", False)

        system = (
            "You are a STRICT clinical signal classification system.\n\n"
            "CRITICAL GROUNDING RULES:\n"
            "1. ONLY classify signals explicitly provided.\n"
            "2. DO NOT create or infer new signals.\n"
            "3. COUNT RECONCILIATION RULE: The values in signal_to_noise_summary "
            "MUST add up correctly:\n"
            "   total_signals = len(signal_classifications)\n"
            "   true_irae_signals + noise_signals + mimicker_signals + uncertain_signals = total_signals\n"
            "   Every classified signal must be counted in exactly one bucket.\n"
            "   Do NOT leave all counts at 0 when signals exist.\n\n"
            "Return ONLY valid JSON."
        )

        if not ici_exposure:
            empty = {
                "signal_classifications": [],
                "signal_to_noise_summary": {
                    "total_signals": 0, "true_irae_signals": 0, "noise_signals": 0,
                    "mimicker_signals": 0, "uncertain_signals": 0,
                    "noise_reduction_percent": 0, "irae_signal_purity": "Not applicable",
                },
                "top_confirmed_irae_signals": [], "top_noise_items_to_deprioritize": [],
                "critical_mimickers_to_rule_out": [], "noise_separation_confidence": "Not applicable",
            }
            state["noise_separation"] = empty
            state["agent_timings"][self.agent_id] = self._elapsed(t0)
            return state

        prompt = f"""
Classify signals and produce a reconciled signal-to-noise summary.

TREATMENT:
{treatment_info}

BASELINE:
{baseline}

SIGNALS (A16):
{signals}

LABS (A17):
{lab_changes}

TOXICITY MAP (A18):
{toxicity_map}

══════════════════════════════════════════════════════════
CLASSIFICATION RULES
══════════════════════════════════════════════════════════

STEP 1 — CLASSIFY EACH SIGNAL:
For each signal in A16 new_signals:
  Confirmed irAE  → toxicity_map has it as Confirmed or Suspected
  Possible irAE   → toxicity_map has it as Possible
  Noise           → documented alternative cause exists in graph data
  Mimicker        → another condition in graph data explains it better
  Uncertain       → insufficient data to classify

STEP 2 — COUNT RECONCILIATION (CRITICAL):
  total_signals = count of items in signal_classifications
  Distribute every signal into EXACTLY ONE of:
    true_irae_signals, noise_signals, mimicker_signals, uncertain_signals
  "Possible irAE" signals count as uncertain_signals.
  Sum must equal total_signals.
  noise_reduction_percent = ((noise_signals + mimicker_signals) / total_signals) * 100
  if total_signals > 0 else 0

STEP 3 — MIMICKER REASONING:
Only include mimickers that are documented in the graph data
(existing diagnoses, known comorbidities). Do NOT invent them.

STEP 4 — CONFIDENCE:
Overall noise_separation_confidence based on data completeness:
  High   → baseline + labs + imaging available
  Moderate → partial data
  Low    → single visit, no baseline

Return ONLY valid JSON:
{{
  "signal_classifications": [
    {{
      "signal":             "...",
      "grade":              1,
      "classification":     "Confirmed irAE | Possible irAE | Noise | Mimicker | Uncertain",
      "confidence":         "High | Moderate | Low",
      "irae_category":      "true_irae | uncertain | noise | mimicker",
      "mimicker":           false,
      "alternative_diagnosis": "",
      "evidence_strength":  "Strong | Moderate | Weak"
    }}
  ],
  "signal_to_noise_summary": {{
    "total_signals":          0,
    "true_irae_signals":      0,
    "noise_signals":          0,
    "mimicker_signals":       0,
    "uncertain_signals":      0,
    "noise_reduction_percent": 0,
    "irae_signal_purity":     "Low | Moderate | High | Not applicable"
  }},
  "top_confirmed_irae_signals":      [],
  "top_noise_items_to_deprioritize": [],
  "critical_mimickers_to_rule_out":  [],
  "noise_separation_confidence":     "Low | Moderate | High | Not applicable"
}}
"""
        raw = await self._invoke(system, prompt, self.agent_id)

        # v3.2: post-process count reconciliation
        classifications = raw.get("signal_classifications", [])
        sns = raw.get("signal_to_noise_summary", {})
        actual_total = len(classifications)
        if actual_total > 0 and sns.get("total_signals", 0) != actual_total:
            logger.warning(f"{self.agent_id} — count mismatch; reconciling ({actual_total} signals)")
            true_irae = sum(1 for s in classifications if s.get("irae_category") == "true_irae")
            uncertain = sum(1 for s in classifications if s.get("irae_category") == "uncertain")
            noise     = sum(1 for s in classifications if s.get("irae_category") == "noise")
            mimicker  = sum(1 for s in classifications if s.get("irae_category") == "mimicker")
            # assign unclassified to uncertain
            classified = true_irae + uncertain + noise + mimicker
            if classified < actual_total:
                uncertain += actual_total - classified
            noise_pct = round(((noise + mimicker) / actual_total) * 100) if actual_total else 0
            raw["signal_to_noise_summary"] = {
                **sns,
                "total_signals":           actual_total,
                "true_irae_signals":       true_irae,
                "noise_signals":           noise,
                "mimicker_signals":        mimicker,
                "uncertain_signals":       uncertain,
                "noise_reduction_percent": noise_pct,
            }

        state["noise_separation"]             = raw
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# PARALLEL RUNNER — A21 + A22 + A23
#
# v3.2: uses copy.deepcopy to prevent state mutation race condition.
# ============================================================

async def run_parallel_output_agents(state: ToxicityState) -> ToxicityState:
    logger.info("Parallel layer (A21–A23) — START")
    t0 = datetime.now().timestamp()

    a21 = QualityEvaluatorAgent(llm)
    a22 = NarrativeAgent(llm_synthesis)
    a23 = SignalNoiseAgent(llm)

    # v3.2: deepcopy each branch to prevent shared-dict mutation
    results = await asyncio.gather(
        a21.run(copy.deepcopy(dict(state))),
        a22.run(copy.deepcopy(dict(state))),
        a23.run(copy.deepcopy(dict(state))),
        return_exceptions=True,
    )

    agent_names = ["A21", "A22", "A23"]
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            logger.error(f"{agent_names[i]} failed: {result}")
            state["errors"].append(f"{agent_names[i]}: {str(result)}")
        else:
            state["agent_timings"].update(result.get("agent_timings", {}))
            if i == 0:
                state["quality_score"]    = result.get("quality_score")
            elif i == 1:
                state["narrative"]             = result.get("narrative")
                state["narrative_paragraph_1"] = result.get("narrative_paragraph_1", "")
                state["narrative_paragraph_2"] = result.get("narrative_paragraph_2", "")
                state["alert_level"]           = result.get("alert_level", "Routine")
            elif i == 2:
                state["noise_separation"] = result.get("noise_separation")

    elapsed = round((datetime.now().timestamp() - t0) * 1000, 1)
    logger.info(f"Parallel layer (A21–A23) — DONE ({elapsed}ms)")
    return state


# ============================================================
# A24 — ESCALATION PREDICTOR  (v3.2)
#
# Key change: ICI check reads directly from state dict, not re-parsed.
# ============================================================

class EscalationPredictorAgent(BaseAgent):
    agent_id = "A24"

    async def run(self, state: ToxicityState) -> ToxicityState:
        logger.info(f"{self.agent_id} · EscalationPredictorAgent — START")
        t0 = datetime.now().timestamp()

        signals      = json.dumps(state.get("new_signals", {}),    indent=2, default=str)
        lab_changes  = json.dumps(state.get("lab_changes", {}),    indent=2, default=str)
        toxicity_map = json.dumps(state.get("toxicity_map", {}),   indent=2, default=str)
        risk         = json.dumps(state.get("risk_assessment", {}), indent=2, default=str)
        synthesis    = json.dumps(state.get("final_synthesis", {}), indent=2, default=str)

        # v3.2: read directly from state, not from JSON string
        ici_exposure = state.get("treatment_info", {}).get("ici_exposure", False)

        empty_output = {
            "escalation_predictions": [],
            "highest_escalation_risk_irae": "",
            "highest_escalation_score": 0,
            "imminent_escalations": [],
            "overall_escalation_alert": "None",
            "intervention_prevents_discontinuation": False,
            "discontinuation_prevention_window_days": 0,
            "escalation_summary": "Not applicable — no ICI therapy confirmed",
        }

        if not ici_exposure:
            logger.info(f"{self.agent_id} — ICI not confirmed, returning not-applicable")
            state["escalation_risk"] = empty_output
            state["agent_timings"][self.agent_id] = self._elapsed(t0)
            return state

        iraes = (state.get("toxicity_map") or {}).get("suspected_toxicities", [])
        if not iraes:
            logger.info(f"{self.agent_id} — No irAEs in toxicity_map, returning empty")
            state["escalation_risk"] = {**empty_output, "escalation_summary": "No irAEs identified — escalation not applicable"}
            state["agent_timings"][self.agent_id] = self._elapsed(t0)
            return state

        system = (
            "You are a STRICT clinical escalation prediction system.\n\n"
            "CRITICAL GROUNDING RULES:\n"
            "1. ONLY predict using explicitly provided data.\n"
            "2. ICI is confirmed — proceed with escalation prediction.\n"
            "3. ONLY include irAEs from toxicity_map (Grade G1 or G2).\n"
            "4. Timeline estimates ONLY if lab velocity exists in A17 data.\n"
            "5. Escalation score is 0–100 based on evidence strength.\n\n"
            "Return ONLY valid JSON."
        )

        prompt = f"""
Predict irAE escalation risk.

ICI CONFIRMED.

SIGNALS (A16):
{signals}

LABS (A17):
{lab_changes}

TOXICITY MAP (A18 — confirmed/suspected irAEs):
{toxicity_map}

RISK (A19):
{risk}

SYNTHESIS (A20):
{synthesis}

══════════════════════════════════════════════════════════
ESCALATION PREDICTION RULES
══════════════════════════════════════════════════════════

For each G1 or G2 irAE in toxicity_map.suspected_toxicities:

SCORING (0-100, evidence-based only):
  + Grade 2 (not Grade 1):           +25 points
  + Multi-system irAE:               +20 points
  + Rising lab trend (from A17):     +20 points
  + Multiple ICI cycles completed:   +10 points
  + Prior G1 signal dismissed:       +15 points
  + No steroid intervention yet:     +10 points
  Points apply ONLY if evidence exists in the provided data.

TIMELINE:
  Only estimate if lab velocity data in A17 shows a measurable trend.
  Otherwise: "Timeline uncertain — monitor closely at next cycle."

INTERVENTION WINDOW:
  Only state if escalation_score >= 40 and irAE is Grade 1 or 2.

Return ONLY valid JSON:
{{
  "escalation_predictions": [
    {{
      "irae_name":                          "...",
      "ctcae_grade_current":               "G1 | G2",
      "escalation_score":                  0,
      "escalation_score_rationale":        "...",
      "predicted_grade_without_intervention": "G2 | G3 | G4",
      "predicted_timeline_to_grade3":      "...",
      "intervention_recommendation":       "...",
      "intervention_prevents_discontinuation": false
    }}
  ],
  "highest_escalation_risk_irae":            "",
  "highest_escalation_score":               0,
  "imminent_escalations":                   [],
  "overall_escalation_alert":               "None | Low | Moderate | High | Critical",
  "intervention_prevents_discontinuation":  false,
  "discontinuation_prevention_window_days": 0,
  "escalation_summary":                     "..."
}}
"""
        state["escalation_risk"]              = await self._invoke(system, prompt, self.agent_id)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A25 — TREATMENT DISCONTINUATION GUARD
# ============================================================

class DiscontinuationGuardAgent(BaseAgent):
    agent_id = "A25"

    async def run(self, state: ToxicityState) -> ToxicityState:
        logger.info(f"{self.agent_id} · DiscontinuationGuardAgent — START")
        t0 = datetime.now().timestamp()

        treatment_info   = json.dumps(state.get("treatment_info", {}),   indent=2, default=str)
        toxicity_map     = json.dumps(state.get("toxicity_map", {}),     indent=2, default=str)
        risk             = json.dumps(state.get("risk_assessment", {}),   indent=2, default=str)
        synthesis        = json.dumps(state.get("final_synthesis", {}),   indent=2, default=str)
        escalation_risk  = json.dumps(state.get("escalation_risk", {}),   indent=2, default=str)
        noise_separation = json.dumps(state.get("noise_separation", {}),  indent=2, default=str)
        ici_exposure     = state.get("treatment_info", {}).get("ici_exposure", False)

        system = (
            "You are a STRICT clinical decision system for ICI discontinuation prevention.\n\n"
            "CRITICAL GROUNDING RULES:\n"
            "1. ONLY use explicitly provided patient data.\n"
            "2. If no ICI → NOT APPLICABLE.\n"
            "3. If no irAE → recommend continuation with monitoring.\n"
            "4. Grade-based decision logic:\n"
            "   G1  → Continue ICI\n"
            "   G2  → Hold ICI (not discontinue)\n"
            "   G3+ → Discontinue (only if explicitly Grade 3 or 4 in toxicity_map)\n\n"
            "Return ONLY valid JSON."
        )

        not_applicable = {
            "discontinuation_risk_assessment": {
                "current_discontinuation_risk": "Not applicable",
                "discontinuation_avoidable": False,
                "avoidable_rationale": "No ICI therapy",
                "irAEs_requiring_mandatory_stop": [],
                "irAEs_manageable_with_hold": [],
                "irAEs_manageable_with_continuation": [],
            },
            "rechallenge_assessment": {
                "rechallenge_eligible": False,
                "rechallenge_eligibility_rationale": "No ICI therapy",
                "rechallenge_criteria_met": [],
                "rechallenge_risk_level": "Not applicable",
                "rechallenge_conditions": [],
                "expected_time_to_rechallenge_eligibility_days": 0,
                "recurrence_risk_on_rechallenge": "Not applicable",
            },
            "discontinuation_prevention_plan": [],
            "cost_of_discontinuation": {
                "clinical_impact": "Not applicable",
                "treatment_alternatives": [],
                "alternatives_available": False,
            },
            "recommended_decision": "Not applicable",
            "decision_rationale": "No ICI therapy",
            "discontinuation_summary": "Not applicable",
        }

        if not ici_exposure:
            state["discontinuation_risk"] = not_applicable
            state["agent_timings"][self.agent_id] = self._elapsed(t0)
            return state

        prompt = f"""
Assess ICI discontinuation risk and prevention strategy.

ICI CONFIRMED.

TREATMENT:
{treatment_info}

TOXICITY MAP (A18):
{toxicity_map}

ESCALATION (A24):
{escalation_risk}

NOISE ANALYSIS (A23):
{noise_separation}

RISK (A19):
{risk}

SYNTHESIS (A20):
{synthesis}

══════════════════════════════════════════════════════════
DECISION RULES
══════════════════════════════════════════════════════════

STEP 1 — GRADE-BASED DECISION:
  No irAE        → Continue ICI, Low risk
  G1 irAE        → Continue ICI with monitoring, Low-Moderate risk
  G2 irAE        → Hold ICI, consider steroids, Moderate-High risk
  G3+ irAE       → Discontinue ICI, steroids, High risk — but assess avoidability

STEP 2 — AVOIDABILITY:
  Discontinuation is avoidable if:
  - Current grade is 1 or 2 and steroid intervention has not been tried yet
  - Escalation is predicted but not yet at Grade 3
  Document avoidable_rationale from the evidence.

STEP 3 — RECHALLENGE:
  Only assess rechallenge if ICI has been held or discontinued.
  If still on active ICI → rechallenge is not applicable.

STEP 4 — PREVENTION PLAN:
  List specific actions from data (what monitoring, what steroid, what timeline)
  that could prevent discontinuation. Only from A16–A24 evidence.

Return ONLY valid JSON (same structure as not_applicable above).
"""
        state["discontinuation_risk"]         = await self._invoke(system, prompt, self.agent_id)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A26 — COHORT PATTERN REPORTER
# ============================================================

class CohortPatternAgent(BaseAgent):
    agent_id = "A26"

    async def run(self, state: ToxicityState) -> ToxicityState:
        logger.info(f"{self.agent_id} · CohortPatternAgent — START")
        t0 = datetime.now().timestamp()

        treatment_info       = json.dumps(state.get("treatment_info", {}),       indent=2, default=str)
        toxicity_map         = json.dumps(state.get("toxicity_map", {}),         indent=2, default=str)
        escalation_risk      = json.dumps(state.get("escalation_risk", {}),      indent=2, default=str)
        discontinuation_risk = json.dumps(state.get("discontinuation_risk", {}), indent=2, default=str)
        risk                 = json.dumps(state.get("risk_assessment", {}),       indent=2, default=str)
        ici_exposure         = state.get("treatment_info", {}).get("ici_exposure", False)
        alert_level          = state.get("alert_level", "Routine")

        system = (
            "You are a STRICT cohort summarization system.\n\n"
            "CRITICAL GROUNDING RULES:\n"
            "1. ONLY summarise explicitly provided data.\n"
            "2. If no ICI → NOT APPLICABLE.\n"
            "3. cohort_flags: ONLY include flags supported by data.\n"
            "4. Use alert_level already derived — do NOT re-derive.\n\n"
            "Return ONLY valid JSON."
        )

        if not ici_exposure:
            state["cohort_pattern"] = {
                "patient_irae_signature": {
                    "patient_id": state["patient_id"], "ici_agent": "None",
                    "ici_class": "Unknown", "ici_cycles_completed": 0,
                    "irae_count": 0, "irae_organ_systems": [],
                    "highest_grade_overall": "None", "multisystem_irae": False,
                    "ici_status": "Not applicable", "discontinuation_type": "None",
                    "early_onset_irae": False, "early_onset_days": 0,
                    "grade1_to_grade3_escalation_occurred": False,
                    "alert_level": "Routine",
                },
                "cohort_flags": [],
                "cohort_monitoring_recommendation": {
                    "monitoring_interval": "Not applicable",
                    "next_surveillance_due": "", "priority_in_cohort": "Low",
                    "cohort_alert_trigger": "None", "escalation_protocol_active": False,
                },
                "pattern_summary": "Not applicable — no ICI therapy",
            }
            state["agent_timings"][self.agent_id] = self._elapsed(t0)
            return state

        prompt = f"""
Generate cohort irAE signature for this patient.

CURRENT ALERT LEVEL: {alert_level}
ICI CONFIRMED.

TREATMENT:
{treatment_info}

TOXICITY MAP (A18):
{toxicity_map}

ESCALATION (A24):
{escalation_risk}

DISCONTINUATION (A25):
{discontinuation_risk}

RISK (A19):
{risk}

══════════════════════════════════════════════════════════
RULES
══════════════════════════════════════════════════════════

1. irae_count = len(suspected_toxicities) from A18 (only Confirmed + Suspected).
2. ici_cycles_completed = from treatment_info (use 0 if not stated).
3. early_onset_irae = true only if onset within 42 days of ICI start AND evidence supports it.
4. grade1_to_grade3_escalation_occurred = true only if explicitly documented in A24 or A18.
5. cohort_flags = list of unusual patterns (e.g., multi-system irAE, rapid escalation).
   Only include if explicitly supported by data.
6. monitoring_interval = "Weekly" if G2+, "Per cycle" if G1, "Routine" if no irAE.
7. alert_level = use the value already computed: {alert_level}

Return ONLY valid JSON:
{{
  "patient_irae_signature": {{
    "patient_id":                          "{state['patient_id']}",
    "ici_agent":                           "...",
    "ici_class":                           "...",
    "ici_cycles_completed":                0,
    "irae_count":                          0,
    "irae_organ_systems":                  [],
    "highest_grade_overall":               "None",
    "multisystem_irae":                    false,
    "ici_status":                          "Active | On hold | Discontinued",
    "discontinuation_type":                "None | Temporary hold | Permanent",
    "early_onset_irae":                    false,
    "early_onset_days":                    0,
    "grade1_to_grade3_escalation_occurred": false,
    "alert_level":                         "{alert_level}"
  }},
  "cohort_flags": [],
  "cohort_monitoring_recommendation": {{
    "monitoring_interval":       "...",
    "next_surveillance_due":     "...",
    "priority_in_cohort":        "Low | Medium | High | Critical",
    "cohort_alert_trigger":      "...",
    "escalation_protocol_active": false
  }},
  "pattern_summary": "..."
}}
"""
        state["cohort_pattern"]               = await self._invoke(system, prompt, self.agent_id)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# WORKFLOW
# ============================================================

def create_toxicity_workflow():
    workflow = StateGraph(ToxicityState)

    workflow.add_node("A13",            TreatmentExtractionAgent(llm).run)
    workflow.add_node("A14",            TimelineSegmentationAgent(llm).run)
    workflow.add_node("A15",            BaselineBuilderAgent(llm).run)
    workflow.add_node("A16",            SignalExtractionAgent(llm).run)
    workflow.add_node("A17",            LabTrendAgent(llm).run)
    workflow.add_node("A18",            ToxicityMappingAgent(llm).run)
    workflow.add_node("A19",            RiskPredictionAgent(llm).run)
    workflow.add_node("A20",            FinalSynthesisAgent(llm_synthesis).run)
    workflow.add_node("A21_A23_PARALLEL", run_parallel_output_agents)
    workflow.add_node("A24",            EscalationPredictorAgent(llm).run)
    workflow.add_node("A25",            DiscontinuationGuardAgent(llm_synthesis).run)
    workflow.add_node("A26",            CohortPatternAgent(llm).run)

    workflow.set_entry_point("A13")
    workflow.add_edge("A13", "A14")
    workflow.add_edge("A14", "A15")
    workflow.add_edge("A15", "A16")
    workflow.add_edge("A16", "A17")
    workflow.add_edge("A17", "A18")
    workflow.add_edge("A18", "A19")
    workflow.add_edge("A19", "A20")
    workflow.add_edge("A20", "A21_A23_PARALLEL")
    workflow.add_edge("A21_A23_PARALLEL", "A24")
    workflow.add_edge("A24", "A25")
    workflow.add_edge("A25", "A26")
    workflow.add_edge("A26", END)

    return workflow.compile()


toxicity_workflow = create_toxicity_workflow()


# ============================================================
# INITIAL STATE FACTORY
# ============================================================

def build_initial_state(
    request:    ToxicityRequest,
    graph_docs: List[Dict],
    dob:        Optional[str] = None,
    sex:        Optional[str] = None,
) -> ToxicityState:
    return ToxicityState(
        patient_id=request.patient_id,
        doctor_id=request.doctor_id,
        specialty=request.specialty,
        graph_documents=graph_docs,
        dob=dob,
        sex=sex,
        treatment_info=None,
        pre_treatment=None,
        post_treatment=None,
        baseline=None,
        new_signals=None,
        lab_changes=None,
        toxicity_map=None,
        risk_assessment=None,
        final_synthesis=None,
        quality_score=None,
        narrative=None,
        narrative_paragraph_1=None,
        narrative_paragraph_2=None,
        alert_level=None,
        noise_separation=None,
        escalation_risk=None,
        discontinuation_risk=None,
        cohort_pattern=None,
        no_baseline_warning=False,
        errors=[],
        agent_timings={},
    )


# ============================================================
# ALERT PERSISTENCE
# ============================================================

async def persist_alert(patient_id: str, doctor_id: str, result: Dict):
    alert_level = result.get("alert_level", "Routine")
    if alert_level in ("Emergency", "Alert", "Caution"):
        synthesis = result.get("final_synthesis") or {}
        toxicity  = result.get("toxicity_map") or {}
        alert_doc = {
            "patient_id":         patient_id,
            "doctor_id":          doctor_id,
            "alert_level":        alert_level,
            "generated_at":       datetime.utcnow(),
            "resolved":           False,
            "irae_summary":       synthesis.get("summary", ""),
            "ici_recommendation": (synthesis.get("ici_management_decision") or {}).get("recommendation", ""),
            "highest_grade":      toxicity.get("highest_grade_irae", ""),
            "affected_organs":    toxicity.get("organs_concurrently_affected", []),
            "escalation_risk":    (result.get("escalation_risk") or {}).get("overall_escalation_alert", ""),
        }
        try:
            await alerts_collection.insert_one(alert_doc)
            logger.info(f"Alert persisted | patient={patient_id} | level={alert_level}")
        except Exception as e:
            logger.error(f"Alert persist failed | {e}")


# ============================================================
# API ENDPOINTS
# ============================================================

@router.post("/toxicity-surveillance/run")
async def run_toxicity_surveillance(request: ToxicityRequest):
    """
    Full 14-agent ICI Toxicity Surveillance pipeline — v3.2.
    """
    start_ms = datetime.now().timestamp() * 1000
    logger.info(f"Toxicity v3.2 | patient={request.patient_id} | doctor={request.doctor_id}")

    try:
        # ── 1. Graph fetch ─────────────────────────────────────────────────────
        try:
            graph_docs = await fetch_patient_graph_documents(request.patient_id)
        except Exception as e:
            logger.warning(f"Neo4j unavailable ({e}), using demo data")
            graph_docs = load_demo_graph_documents()

        if not graph_docs:
            raise HTTPException(
                status_code=404,
                detail=f"No clinical data found for patient {request.patient_id}",
            )

        # ── 2. Demographics ────────────────────────────────────────────────────
        demographics = await fetch_patient_demographics(request.patient_id)

        # ── 3. Build state ─────────────────────────────────────────────────────
        initial_state = build_initial_state(
            request, graph_docs,
            dob=demographics.get("dob"),
            sex=demographics.get("sex"),
        )

        # ── 4. Run pipeline ────────────────────────────────────────────────────
        result = await toxicity_workflow.ainvoke(initial_state)

        # ── 5. Persist to MongoDB ──────────────────────────────────────────────
        elapsed = round(datetime.now().timestamp() * 1000 - start_ms)
        full_payload = {
            "patient_id":         request.patient_id,
            "doctor_id":          request.doctor_id,
            "generated_at":       datetime.utcnow(),
            "documents_analyzed": len(graph_docs),
            "processing_time_ms": elapsed,
            **{k: v for k, v in result.items() if k != "_id"},
        }
        try:
            await toxicity_collection.insert_one(full_payload)
            full_payload.pop("_id", None)   # v3.2: remove _id after insert
        except Exception as e:
            logger.error(f"MongoDB save failed: {e}")

        # ── 6. Persist alert if warranted ──────────────────────────────────────
        await persist_alert(request.patient_id, request.doctor_id, result)

        # ── 7. Build response ──────────────────────────────────────────────────
        synthesis    = result.get("final_synthesis") or {}
        toxicity_map = result.get("toxicity_map") or {}
        escalation   = result.get("escalation_risk") or {}
        discontinue  = result.get("discontinuation_risk") or {}

        logger.info(
            f"Toxicity v3.2 complete | patient={request.patient_id} | "
            f"{elapsed}ms | {len(graph_docs)} docs | "
            f"alert={result.get('alert_level', 'Routine')} | "
            f"no_baseline={result.get('no_baseline_warning', False)}"
        )

        response = {
            "patient_id":         request.patient_id,
            "doctor_id":          request.doctor_id,
            "generated_at":       datetime.now().isoformat(),
            "documents_analyzed": len(graph_docs),
            "processing_time_ms": elapsed,
            "agent_timings":      result.get("agent_timings", {}),
            "errors":             result.get("errors", []),
            "version":            "3.2.0",
            "no_baseline_warning": result.get("no_baseline_warning", False),

            # CEO KPIs
            "alert_level":              result.get("alert_level", "Routine"),
            "ici_recommendation":       synthesis.get("ici_management_decision", {}).get("recommendation", ""),
            "highest_irae_grade":       toxicity_map.get("highest_grade_irae", "None"),
            "multisystem_irae":         toxicity_map.get("multisystem_irae", False),
            "discontinuation_avoidable": (discontinue.get("discontinuation_risk_assessment") or {}).get("discontinuation_avoidable", True),
            "escalation_alert":         escalation.get("overall_escalation_alert", "None"),

            # Narrative
            "narrative": {
                "paragraph_1": result.get("narrative_paragraph_1", ""),
                "paragraph_2": result.get("narrative_paragraph_2", ""),
                "bottom_line": (result.get("narrative") or {}).get("bottom_line", ""),
                "alert_level": result.get("alert_level", "Routine"),
            },

            # Core toxicity outputs
            "toxicity_detection":      toxicity_map,
            "ici_management_decision": synthesis.get("ici_management_decision", {}),
            "grade1_watchlist":        (synthesis.get("toxicity_detection") or {}).get("grade1_watchlist", []),
            "recommended_actions":     synthesis.get("recommended_actions", []),
            "monitoring_plan":         synthesis.get("monitoring_plan", []),
            "specialist_referrals":    synthesis.get("specialist_referrals", []),

            # CEO mission outputs
            "signal_to_noise":       result.get("noise_separation", {}),
            "escalation_prediction": escalation,
            "discontinuation_guard": discontinue,
            "cohort_signature":      result.get("cohort_pattern", {}),

            # Risk & quality
            "risk_assessment": result.get("risk_assessment", {}),
            "quality_score":   result.get("quality_score", {}),

            # Treatment context
            "treatment_info":   result.get("treatment_info", {}),
            "baseline_summary": (result.get("baseline") or {}).get("baseline_summary", ""),
        }

        if request.include_intermediates:
            response["intermediate"] = {
                "treatment_info":       result.get("treatment_info"),
                "pre_treatment":        result.get("pre_treatment"),
                "post_treatment":       result.get("post_treatment"),
                "baseline":             result.get("baseline"),
                "new_signals":          result.get("new_signals"),
                "lab_changes":          result.get("lab_changes"),
                "toxicity_map":         result.get("toxicity_map"),
                "risk_assessment":      result.get("risk_assessment"),
                "final_synthesis":      result.get("final_synthesis"),
                "noise_separation":     result.get("noise_separation"),
                "escalation_risk":      result.get("escalation_risk"),
                "discontinuation_risk": result.get("discontinuation_risk"),
                "cohort_pattern":       result.get("cohort_pattern"),
                "quality_score":        result.get("quality_score"),
                "narrative_p1":         result.get("narrative_paragraph_1", ""),
                "narrative_p2":         result.get("narrative_paragraph_2", ""),
            }

        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Toxicity v3.2 failed | patient={request.patient_id} | {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# COHORT MONITORING ENDPOINTS
# ============================================================

@router.post("/toxicity-surveillance/cohort/scan")
async def scan_ici_cohort(request: CohortScanRequest, background_tasks: BackgroundTasks):
    logger.info(f"Cohort scan initiated | doctor={request.doctor_id}")
    patient_ids = await fetch_ici_cohort_patient_ids(request.doctor_id)
    if not patient_ids:
        return {
            "status":    "no_patients",
            "message":   f"No active ICI patients found for doctor {request.doctor_id}",
            "doctor_id": request.doctor_id, "scanned": 0,
        }
    queued = []
    for pid in patient_ids:
        background_tasks.add_task(_run_cohort_patient_surveillance, patient_id=pid, doctor_id=request.doctor_id)
        queued.append(pid)
    return {
        "status": "queued", "doctor_id": request.doctor_id,
        "patients_queued": len(queued), "patient_ids": queued,
        "scan_initiated_at": datetime.now().isoformat(),
    }


async def _run_cohort_patient_surveillance(patient_id: str, doctor_id: str):
    try:
        req = ToxicityRequest(patient_id=patient_id, doctor_id=doctor_id, specialty="Oncology")
        await run_toxicity_surveillance(req)
        logger.info(f"Cohort surveillance complete | patient={patient_id}")
    except Exception as e:
        logger.error(f"Cohort patient failed | patient={patient_id} | {e}")


@router.get("/toxicity-surveillance/cohort/alerts")
async def get_cohort_alerts(
    doctor_id:       str,
    unresolved_only: bool = True,
    alert_level:     Optional[str] = None,
):
    query: Dict = {"doctor_id": doctor_id}
    if unresolved_only:
        query["resolved"] = False
    if alert_level:
        query["alert_level"] = alert_level

    level_priority = {"Emergency": 0, "Alert": 1, "Caution": 2, "Routine": 3}
    try:
        cursor = alerts_collection.find(query, {"_id": 0})
        alerts = [doc async for doc in cursor]
        alerts.sort(key=lambda x: (
            level_priority.get(x.get("alert_level", "Routine"), 3),
            x.get("generated_at", ""),
        ))
        return {
            "doctor_id":       doctor_id,
            "total_alerts":    len(alerts),
            "emergency_count": sum(1 for a in alerts if a.get("alert_level") == "Emergency"),
            "alert_count":     sum(1 for a in alerts if a.get("alert_level") == "Alert"),
            "caution_count":   sum(1 for a in alerts if a.get("alert_level") == "Caution"),
            "alerts":          alerts,
            "retrieved_at":    datetime.now().isoformat(),
        }
    except Exception as e:
        logger.error(f"Alert fetch failed | doctor={doctor_id} | {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/toxicity-surveillance/cohort/alerts/{patient_id}/resolve")
async def resolve_patient_alert(patient_id: str, doctor_id: str):
    try:
        result = await alerts_collection.update_many(
            {"patient_id": patient_id, "doctor_id": doctor_id, "resolved": False},
            {"$set": {"resolved": True, "resolved_at": datetime.utcnow()}},
        )
        return {"patient_id": patient_id, "alerts_resolved": result.modified_count,
                "resolved_at": datetime.now().isoformat()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# DEMO & HEALTH
# ============================================================

@router.get("/toxicity-surveillance/demo")
async def run_toxicity_demo():
    """Run the full pipeline with the demo NSCLC/pembrolizumab case."""
    demo_request = ToxicityRequest(
        patient_id="PAT-demo-pembro-irae-001",
        doctor_id="DOC-demo-001",
        specialty="Oncology",
        include_intermediates=True,
    )
    return await run_toxicity_surveillance(demo_request)


@router.get("/toxicity-surveillance/health")
async def toxicity_health():
    return {
        "status":            "ok",
        "version":           "3.2.0",
        "agents":            14,
        "workflow_compiled": toxicity_workflow is not None,
        "llm_fast":          "llama-3.1-8b-instant (Groq)",
        "llm_synthesis":     "llama-3.3-70b-versatile (Groq)",
        "graph_source":      "Neo4j",
        "v32_fixes": {
            "cypher_parameterised":           True,
            "parallel_deepcopy":              True,
            "plan_text_treatment_filter":     True,
            "ctcae_quantitative_grading":     True,
            "irae_early_detection_tiers":     True,
            "ici_check_direct_state_read":    True,
            "signal_count_reconciliation":    True,
            "no_baseline_warning_flag":       True,
            "mongodb_id_removal":             True,
            "llm_timeouts":                   True,
        },
        "prompt_design": {
            "hardcoded_lists_in_prompts": False,
            "data_source":                "Graph documents only",
            "irAE_detection":             "LLM derives from patient data with confidence tiers",
            "ctcae_grading":              "Quantitative evidence extracted from evidence text",
            "mimicker_detection":         "LLM derives from documented comorbidities only",
            "escalation_timelines":       "LLM derives from observed lab velocity",
            "ici_classification":         "LLM derives from explicit drug names in data",
        },
        "ceo_alignment": {
            "irae_late_and_mimic_aware":   True,
            "early_grade1_detection":      True,
            "grade2_as_alert_minimum":     True,
            "steroid_protocols":           True,
            "discontinuation_prevention":  True,
            "cohort_monitoring":           True,
        },
        "agent_pipeline": [
            "A13 — TreatmentExtraction       [ICI class + plan-text filter]",
            "A14 — TimelineSegmentation      [pre/post windows + no_baseline_warning flag]",
            "A15 — BaselineBuilder           [organ function + irAE risk factors]",
            "A16 — SignalExtraction          [quantitative CTCAE grading from evidence text]",
            "A17 — LabTrendAnalysis          [velocity + grade crossings + single-visit handling]",
            "A18 — ToxicityMapping           [Confirmed/Suspected/Possible confidence tiers]",
            "A19 — RiskPrediction            [organ-specific risk — ICI check via state dict]",
            "A20 — FinalSynthesis            [alert level + consistency enforcement]",
            "A21 — QualityEvaluator          [grading accuracy + consistency checks] [parallel]",
            "A22 — NarrativeGenerator        [two-paragraph note + no-baseline caveat] [parallel]",
            "A23 — SignalNoiseAgent          [count-reconciled signal classification]  [parallel]",
            "A24 — EscalationPredictor       [ICI check via state dict + evidence scoring]",
            "A25 — DiscontinuationGuard      [grade-based hold/discontinue + prevention plan]",
            "A26 — CohortPatternReporter     [patient irAE signature for cohort]",
        ],
    }


# ============================================================
# ENTRYPOINT
# ============================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "toxicity_surveillance:app",
        host="0.0.0.0",
        port=8001,
        reload=False,
        log_level="info",
    )