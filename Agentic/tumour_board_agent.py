"""
tumor_board_agent.py
====================
Tumor Board Recommendation Engine for DoctorAssist — v4.4.0

Agentic Pipeline (each agent receives and enriches the accumulated context):
  0. PatientGraphRetrievalAgent     — NEW in v4.4. Pulls the full longitudinal
                                      patient graph from Neo4j (every document,
                                      every entity ever extracted for this
                                      patient — labs, imaging, meds, procedures,
                                      vitals, findings — "A to Z") and turns it
                                      into a compact timeline text block that
                                      is handed to Agent 1. This does NOT change
                                      ClinicalContext's shape — it just gives the
                                      LLM strictly more raw material to extract from.

  1. PatientContextExtractorAgent   — Reads raw patient summary + graph timeline,
                                      extracts structured clinical picture,
                                      produces ClinicalContext + clinical_summary_text
                                      for downstream agents.

  2. TBGuidelineRetrievalAgent      — Receives ClinicalContext, fetches doctor-approved
                                      guidelines from MongoDB only, filters to approved
                                      sources, produces GuidelineContext enriched
                                      with patient relevance. (MongoDB-only, unchanged.)

  3. DoctorOpinionAgent             — Receives ClinicalContext + GuidelineContext +
                                      all prior MDT opinions + own previous recommendation.
                                      Produces narrative specialty opinion + confidence_breakdown.

  4. CrossSpecialtyReviewAgent      — NEW in v4.4. Internal-only agent (does not appear
                                      in the final report schema). Simulates a panel of
                                      oncology subspecialties — medical oncology, surgical
                                      oncology, radiation oncology, pathology, palliative
                                      care — independently stress-testing the doctor's
                                      draft opinion against the FULL clinical + graph
                                      picture. Surfaces anything the single specialty
                                      missed, and produces a cross_specialty_alignment
                                      score that is BLENDED into the existing
                                      confidence_breakdown.consensus_alignment field
                                      (no schema change). Also folds any genuinely new
                                      concerns into doctor_opinion.concerns_raised and can
                                      flip requires_urgent_mdt if something serious surfaces.
                                      This is what kills the "uncertain / hedgy" output —
                                      by the time MDTSynthesis and the final write-up run,
                                      the opinion has already survived a multi-specialty
                                      sanity check.

  5. MDTSynthesisAgent              — Receives all specialty opinions + doctor opinion draft
                                      (now cross-checked), produces consensus narrative.

  6. TBValidationAgent              — Audits for safety/biomarker/guideline issues.

  7. TBReportAssembler              — Combines all agent outputs into final TumorBoardReport.
                                      SAME SCHEMA AS BEFORE — no new fields exposed.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Changes in v4.4 over v4.3:
  NEO4J RE-INTRODUCED (read-only, additive):
  • New async Neo4j driver (NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD env vars).
  • fetch_patient_graph_documents() restored — pulls the patient's full
    entity graph (Treatment / Procedure / Diagnosis / Medication / LabResult /
    VitalSign / Finding / Anatomy / Measurement nodes) ordered by document date.
  • This is purely an ADDITIONAL input to Agent 1 (context extraction). It does
    NOT replace MongoDB doctor_guidelines as the source of guidelines (that
    stays MongoDB-only per v4.3 — Neo4j is never used for guideline lookup,
    only for patient history).
  • Graph fetch failures are non-fatal — pipeline proceeds with MongoDB-only
    data and a warning, exactly like before Neo4j was added.

  CROSS-SPECIALTY REVIEW (new agent, no schema change):
  • Added CrossSpecialtyReviewAgent between DoctorOpinionAgent and
    MDTSynthesisAgent.
  • Purely internal — TumorBoardReport Pydantic model is UNCHANGED. The
    agent's output is merged into existing doctor_opinion fields
    (confidence_breakdown.consensus_alignment, concerns_raised,
    requires_urgent_mdt) so nothing downstream (API consumers, UI) needs
    to change to benefit from it.
  • This directly targets "hedgy / uncertain" final recommendations: the
    final write-up prompt now explicitly instructs the LLM to commit to a
    decisive plan once cross-specialty review has run, only hedging on
    items that are genuinely still missing data.

Author: AI Architect
Version: 4.4.0
"""

import json
import re
import traceback
from typing import Dict, Any, List, Optional, TypedDict, Set
from datetime import datetime
from enum import Enum

from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import MongoClient
from bson import ObjectId

from langgraph.graph import StateGraph, END
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_groq import ChatGroq
from loguru import logger

from neo4j import AsyncGraphDatabase

import os
from dotenv import load_dotenv

load_dotenv()

router = APIRouter(
    prefix="",
    tags=["tumor_board"],
    responses={404: {"description": "Not found"}},
)

# =====================================================================
# DB SETUP — MongoDB (unchanged)
# =====================================================================

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB  = "doctorassistai"

mongodb_client = AsyncIOMotorClient(MONGO_URI)
database       = mongodb_client[MONGO_DB]

client = MongoClient(MONGO_URI)
db     = client[MONGO_DB]

summary_collection           = database["patient_summary"]
patient_user_collection      = database["patient_users"]
doctor_user_collection       = database["doctor_users"]
doctor_guidelines_collection = database["doctor_guidelines"]
tumor_board_collection       = database["tumor_board_cases"]


# =====================================================================
# DB SETUP — Neo4j (restored in v4.4, patient-history only)
# =====================================================================

GROQ_API_KEY  = os.getenv("GROQ_API_KEY")
NEO4J_URI     = os.getenv("NEO4J_URI", "bolt://neo4j:7687")
NEO4J_USER    = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASS    = os.getenv("NEO4J_PASSWORD", "password")

try:
    neo4j_driver = AsyncGraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASS))
    logger.info(f"🔗 Neo4j driver initialised | uri={NEO4J_URI} | user={NEO4J_USER}")
except Exception as _neo4j_init_err:
    neo4j_driver = None
    logger.error(f"❌ Neo4j driver initialisation failed: {_neo4j_init_err}")


async def close_neo4j_driver() -> None:
    """Call from FastAPI shutdown event if/when one is wired up."""
    if neo4j_driver is not None:
        await neo4j_driver.close()
        logger.info("🔌 Neo4j driver closed")


# =====================================================================
# ENUMS
# =====================================================================

class MDTConsensus(str, Enum):
    UNANIMOUS  = "unanimous"
    MAJORITY   = "majority"
    SPLIT      = "split"
    DISSENTING = "dissenting"


# =====================================================================
# SPECIALTY SCOPE GUIDANCE  (NEW)
#
# Keeps every specialist's narrative — and the final sign-off — strictly
# within that specialist's own clinical lane, aligned with the NCG-KCDO
# NER Multi-Disciplinary Tumour Board Module's department comment list
# (Radiation Oncology / Surgical Oncology / Medical Oncology / Radiology /
# Pathology), plus Palliative Care which the CrossSpecialtyReviewAgent
# panel already models. This is prompt-only guidance — it does not touch
# any Pydantic schema or the JSON output shape.
# =====================================================================

SPECIALTY_SCOPE_GUIDANCE: Dict[str, str] = {
    "surgical_oncology": (
        "Speak strictly as the operating surgeon. Your opinion must LEAD with the "
        "concrete operative plan for THIS patient, derived from the actual clinical "
        "context provided (not a generic template): resectability and operability "
        "given the inferred stage and imaging; the specific operative approach (open "
        "vs. laparoscopic vs. robotic), extent of resection and lymphadenectomy "
        "required; whether neoadjuvant therapy is needed to downstage before surgery "
        "can be offered; peri-operative risk given comorbidities, cardiac findings and "
        "performance status; and expected post-operative recovery or functional "
        "impact. Do NOT specify chemotherapy regimens, drug names/doses, or "
        "radiotherapy dose/fractionation — if systemic or radiation therapy is "
        "needed, name it only as a referral action for that specialty to define. "
        "Generic prerequisite workup (fitness clearance, further staging, organ "
        "function tests) must appear only as secondary supporting actions AFTER the "
        "operative plan, never as a substitute for stating the plan itself."
    ),
    "medical_oncology": (
        "Speak strictly as the treating medical oncologist. Your opinion must LEAD "
        "with the concrete systemic therapy plan for THIS patient, derived from the "
        "actual clinical context provided (not a generic template): the specific "
        "systemic therapy strategy (chemotherapy / targeted therapy / immunotherapy) "
        "supported by the biomarker profile; sequencing (neoadjuvant, adjuvant, or "
        "palliative-intent) relative to any surgery or radiation; dose/regimen "
        "considerations given comorbidities, organ function and performance status; "
        "anticipated toxicities and monitoring plan; and symptom control and pain "
        "management for the patient during systemic treatment. Do NOT specify the "
        "surgical approach or radiotherapy dose/fields — name those only as referral "
        "actions for the relevant specialty. Generic prerequisite workup (biomarker "
        "completion, organ function tests, cardiac clearance) must appear only as "
        "secondary supporting actions AFTER the systemic therapy plan, never as a "
        "substitute for stating the plan itself."
    ),
    "radiation_oncology": (
        "Speak strictly as the treating radiation oncologist. Your opinion must LEAD "
        "with the concrete radiotherapy plan for THIS patient, derived from the "
        "actual clinical context provided (not a generic template): whether "
        "radiotherapy is indicated and in what intent (curative, adjuvant, "
        "neoadjuvant, or palliative); modality (EBRT/IMRT/VMAT/SBRT/brachytherapy); "
        "target volume and organs at risk implied by the primary site, imaging and "
        "inferred stage; an approximate dose/fractionation range appropriate to that "
        "intent and site; sequencing with surgery or systemic therapy; and expected "
        "acute/late toxicity relevant to this patient's comorbidities and organs at "
        "risk. Do NOT specify chemotherapy regimens or the surgical operative plan — "
        "name those only as referral actions for the relevant specialty. Generic "
        "prerequisite workup (performance-status assessment, cardiac clearance, "
        "biomarker completion) must appear only as secondary supporting actions "
        "AFTER the radiotherapy plan, never as a substitute for stating the plan "
        "itself — a radiation oncology opinion that only lists prerequisite workup "
        "and never names a modality/intent/target is incomplete."
    ),
    "radiology": (
        "Speak strictly as the reporting radiologist. Your opinion must LEAD with "
        "the concrete staging/interpretation conclusion for THIS patient, derived "
        "from the actual imaging findings provided (not a generic template): the "
        "adequacy and interpretation of current imaging for staging; any additional "
        "imaging or image-guided procedure (e.g. biopsy) needed to resolve staging "
        "or characterize a finding; and specific concerns about lesion measurement, "
        "nodal or metastatic status that affect the treatment decision. Do NOT "
        "recommend a treatment modality — restrict comments to diagnostic/staging "
        "accuracy and imaging next steps."
    ),
    "pathology": (
        "Speak strictly as the reporting pathologist. Your opinion must LEAD with "
        "the concrete diagnostic/biomarker conclusion for THIS patient, derived from "
        "the actual pathology data provided (not a generic template): confirmation "
        "and completeness of histological diagnosis, grade, and margins where "
        "applicable; adequacy of biomarker/IHC/molecular testing performed and any "
        "additional tissue-based testing required before a systemic therapy decision "
        "can be finalized; and any discordance between pathology and the "
        "clinical/imaging picture. Do NOT recommend a treatment modality — restrict "
        "comments to diagnostic and biomarker completeness."
    ),
    "palliative_care": (
        "Speak strictly as the palliative care specialist. Your opinion must LEAD "
        "with the concrete symptom-control/goals-of-care plan for THIS patient, "
        "derived from the actual clinical context provided (not a generic template): "
        "symptom burden and control (pain, nausea, dyspnoea, etc.) relevant to the "
        "clinical picture; goals-of-care alignment given stage and performance "
        "status; psychosocial and caregiver support needs; and how palliative input "
        "should run in parallel with (not instead of) disease-directed treatment "
        "unless the picture indicates a shift to comfort-focused care. Do NOT "
        "specify curative treatment regimens, doses, or operative plans."
    ),
    "general_oncology": (
        "Speak as a general oncology reviewer coordinating the case. Summarize the "
        "overall disease-directed strategy and flag which specific specialties "
        "(surgical/medical/radiation oncology, radiology, pathology, palliative "
        "care) need to weigh in before a definitive plan can be finalized."
    ),
}


def _get_specialty_guidance(specialty: str) -> str:
    """
    Returns scope-of-practice guidance text for a given specialty string.
    Does substring/fuzzy matching since `specialty` may arrive in varied
    forms (e.g. "Surgical Oncology", "surgical_onc", "Surgery").
    Falls back to the general_oncology guidance if nothing matches.
    """
    key = (specialty or "").strip().lower().replace(" ", "_").replace("-", "_")

    if key in SPECIALTY_SCOPE_GUIDANCE:
        return SPECIALTY_SCOPE_GUIDANCE[key]

    alias_map = {
        "surgical_oncology":  ["surg", "surgery", "surgical"],
        "medical_oncology":   ["medical_onc", "med_onc", "medonc", "chemo", "systemic"],
        "radiation_oncology": ["radiation", "rt_onc", "radonc", "radiotherapy"],
        "radiology":          ["radiolog", "imaging"],
        "pathology":          ["patholog", "histopath"],
        "palliative_care":    ["palliative", "supportive_care", "hospice"],
    }
    for canonical, aliases in alias_map.items():
        if any(a in key for a in aliases):
            return SPECIALTY_SCOPE_GUIDANCE[canonical]

    return SPECIALTY_SCOPE_GUIDANCE["general_oncology"]


# =====================================================================
# PYDANTIC SCHEMAS  (UNCHANGED — same shape as v4.3, do not modify
# without checking every downstream consumer of TumorBoardReport)
# =====================================================================

class PriorDoctorOpinion(BaseModel):
    """One doctor's existing tumor board entry — fetched from DB."""
    doctor_id:             str
    specialty:             str
    doctor_recommendation: str
    created_at:            Optional[str] = None
    is_current_doctor:     bool = False


class ClinicalContext(BaseModel):
    primary_diagnosis:  str = ""
    cancer_stage:       str = ""
    inferred_stage:     str = ""
    key_biomarkers:     Dict[str, Any] = Field(default_factory=dict)
    critical_findings:  List[str] = Field(default_factory=list)
    comorbidities:      List[str] = Field(default_factory=list)
    cardiac_findings:   List[str] = Field(default_factory=list)
    urgent_concerns:    List[str] = Field(default_factory=list)
    pathology_summary:  List[str] = Field(default_factory=list)
    prior_treatments:   List[str] = Field(default_factory=list)
    current_medications: List[str] = Field(default_factory=list)
    metastatic_sites:   List[str] = Field(default_factory=list)
    imaging_summary:    List[str] = Field(default_factory=list)
    performance_status: str = ""
    clinical_summary_text: str = ""


class GuidelineContext(BaseModel):
    applicable_guideline_titles: List[str] = Field(default_factory=list)
    key_recommendations:         List[str] = Field(default_factory=list)
    contraindicated_options:     List[str] = Field(default_factory=list)
    missing_workup:              List[str] = Field(default_factory=list)
    guideline_summary_text:      str       = ""


class ConfidenceBreakdown(BaseModel):
    guideline_alignment:  float = 0.0
    consensus_alignment:  float = 0.0
    data_completeness:    float = 0.0
    revision_consistency: float = 0.0
    reasoning:            Dict[str, str] = Field(default_factory=dict)


class DoctorOpinionDraft(BaseModel):
    specialty:         str = ""
    clinical_position: str       = ""
    key_actions:       List[str] = Field(default_factory=list)
    concerns_raised:   List[str] = Field(default_factory=list)
    confidence_breakdown: ConfidenceBreakdown = Field(
        default_factory=ConfidenceBreakdown
    )
    requires_urgent_mdt:          bool = False
    requires_genetic_counseling:  bool = False
    requires_palliative_referral: bool = False
    optimal_recommendation:       str  = ""  # legacy fallback field, kept for safety


class MDTConsensusReport(BaseModel):
    consensus_status:       MDTConsensus = MDTConsensus.MAJORITY
    agreed_actions:         List[str]    = Field(default_factory=list)
    points_of_disagreement: List[str]    = Field(default_factory=list)
    unresolved_questions:   List[str]    = Field(default_factory=list)
    chairperson_summary:    str          = ""


class ValidationReport(BaseModel):
    is_safe:         bool  = True
    safety_score:    float = 0.75
    guideline_score: float = 0.75
    flags:           List[str] = Field(default_factory=list)
    missing_workup_additions: List[str] = Field(default_factory=list)
    auditor_note:             str       = ""


class TumorBoardReport(BaseModel):
    """UNCHANGED SCHEMA — identical field set to v4.3."""
    patient_id:           str
    patient_age:          Optional[int] = None
    patient_sex:          Optional[str] = None
    requesting_specialty: str

    clinical_context: Optional[ClinicalContext] = None
    doctor_opinion: Optional[DoctorOpinionDraft] = None
    mdt_consensus: Optional[MDTConsensusReport] = None
    validation: Optional[ValidationReport] = None

    final_recommendation: str   = ""
    confidence_score:     float = 0.0
    confidence_breakdown: Optional[ConfidenceBreakdown] = None

    requires_urgent_mdt:          bool = False
    requires_genetic_counseling:  bool = False
    requires_palliative_referral: bool = False

    warnings: List[str] = Field(default_factory=list)


# =====================================================================
# INPUT / GRAPH STATE
# =====================================================================

class TumorBoardInput(BaseModel):
    patient_id:                   str
    doctor_id:                    str
    hospital_id:                  Optional[str] = None
    patient_age:                  Optional[int] = None
    patient_sex:                  Optional[str] = None
    requesting_specialty:         Optional[str] = None
    doctor_sys_id:                Optional[str] = None
    prior_doctor_opinions:        List[PriorDoctorOpinion] = Field(default_factory=list)
    current_doctor_prior_opinion: Optional[PriorDoctorOpinion] = None


class TumorBoardState(TypedDict):
    tb_input:           TumorBoardInput
    patient_summary:    Optional[Dict[str, Any]]
    # NEW in v4.4 — raw Neo4j graph documents + a pre-rendered text timeline.
    # Internal only — never serialised into TumorBoardReport.
    graph_documents:    List[Dict[str, Any]]
    graph_timeline_text: str
    clinical_context:   Optional[ClinicalContext]
    guideline_context:  Optional[GuidelineContext]
    doctor_opinion:     Optional[DoctorOpinionDraft]
    # NEW in v4.4 — internal cross-specialty panel notes (not exposed in report)
    cross_specialty_notes: Optional[Dict[str, Any]]
    mdt_consensus:      Optional[MDTConsensusReport]
    validation_report:  Optional[ValidationReport]
    tumor_board_report: Optional[TumorBoardReport]
    doctor_guidelines:  List[Dict[str, Any]]
    warnings:           List[str]
    error:              Optional[str]


# =====================================================================
# SHARED JSON PARSER
# =====================================================================

def _parse_json(content: str) -> dict:
    try:
        content = content.strip()
        if "```json" in content:
            content = content.split("```json", 1)[1].split("```", 1)[0]
        elif "```" in content:
            content = content.split("```", 1)[1].split("```", 1)[0]
        s, e = content.find("{"), content.rfind("}")
        if s != -1 and e != -1:
            return json.loads(content[s: e + 1])
        return {}
    except Exception:
        return {}


def _log_raw_document(label: str, doc: Any, max_chars: int = 800) -> None:
    """Pretty-print a raw DB document or list excerpt for debugging."""
    try:
        raw = json.dumps(doc, indent=2, default=str)
        if len(raw) > max_chars:
            raw = raw[:max_chars] + f"\n  ... [truncated — full length {len(raw)} chars]"
        logger.debug(f"   [RAW DB — {label}]:\n{raw}")
    except Exception as log_err:
        logger.debug(f"   [RAW DB — {label}]: could not serialise — {log_err}")


# =====================================================================
# NEO4J — PATIENT GRAPH RETRIEVAL  (restored from pre-v4.3, patient
# history only — NEVER used for guideline lookup)
# =====================================================================

async def fetch_patient_graph_documents(patient_id: str) -> List[Dict]:
    """
    Pulls the FULL longitudinal entity graph for a patient: every
    Treatment / Procedure / Diagnosis / Medication / LabResult /
    VitalSign / Finding / Anatomy / Measurement node ever linked to
    this patient, grouped by source document and ordered chronologically.

    This is the "A to Z" patient history feed for Agent 1.
    """
    if neo4j_driver is None:
        logger.warning("   [Neo4j] driver not initialised — skipping graph fetch")
        return []

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
                WHEN n:Treatment THEN "Treatment"
                WHEN n:Procedure THEN "Procedure"
                WHEN n:Diagnosis THEN "Diagnosis"
                WHEN n:Medication THEN "Medication"
                WHEN n:LabResult THEN "Lab Result"
                WHEN n:VitalSign THEN "Vital Sign"
                WHEN n:Finding THEN "Finding"
                WHEN n:Anatomy THEN "Anatomy"
                WHEN n:Measurement THEN "Measurement"
                ELSE head(labels(n))
            END,
            name: coalesce(
                n.name, n.details, n.description, n.drug_name,
                n.test_name, n.vital_type, n.value
            ),
            date: raw_date,
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
            logger.info(f"   [Neo4j] graph fetch | patient={patient_id} | documents={len(docs)}")
            return docs
    except Exception as e:
        logger.error(f"   [Neo4j] graph fetch FAILED for patient {patient_id}: {e}")
        return []


def _render_graph_timeline(graph_documents: List[Dict], max_chars: int = 6000) -> str:
    """
    Compresses the raw Neo4j document/entity graph into a readable
    chronological timeline string suitable for an LLM prompt, e.g.:

      [2023-04-11] Endoscopy Report
        - Finding: 4cm distal esophageal mass
        - Procedure: Upper GI endoscopy with biopsy
      [2023-04-19] Pathology Report
        - Diagnosis: Adenocarcinoma, moderately differentiated
        - Lab Result: HER2 IHC 2+ (equivocal)
      ...

    Truncated to max_chars to keep prompts bounded; truncation keeps the
    MOST RECENT entries (most clinically relevant for current decision-making)
    rather than the oldest.
    """
    if not graph_documents:
        return ""

    lines: List[str] = []
    for doc in graph_documents:
        date_str = doc.get("document_date") or "undated"
        doc_name = doc.get("document") or "unknown document"
        lines.append(f"[{date_str}] {doc_name}")
        for ent in (doc.get("entities") or []):
            etype = ent.get("entity_type", "Entity")
            name  = ent.get("name", "")
            if not name:
                continue
            evidence = ent.get("evidence")
            suffix = f" (evidence: {evidence})" if evidence else ""
            lines.append(f"    - {etype}: {name}{suffix}")

    full_text = "\n".join(lines)
    if len(full_text) <= max_chars:
        return full_text

    # Keep the tail (most recent) — chronological order means recent = end.
    truncated = full_text[-max_chars:]
    first_newline = truncated.find("\n")
    if first_newline != -1:
        truncated = truncated[first_newline + 1:]
    return f"[... earlier history truncated for length ...]\n{truncated}"


# =====================================================================
# AGENT 0 — PATIENT GRAPH RETRIEVAL  (NEW in v4.4)
# =====================================================================

class PatientGraphRetrievalAgent:
    """
    Pulls the patient's full Neo4j entity graph and renders it into a
    timeline text block. This block is purely additive context handed to
    Agent 1 (PatientContextExtractorAgent) — it never touches the output
    schema and failures here are non-fatal (pipeline proceeds MongoDB-only).
    """

    async def retrieve_graph(self, state: TumorBoardState) -> TumorBoardState:
        logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        logger.info("🕸️  [Agent 0 — PatientGraphRetrieval]: Starting")

        patient_id = state["tb_input"].patient_id

        graph_documents: List[Dict[str, Any]] = []
        try:
            graph_documents = await fetch_patient_graph_documents(patient_id)
        except Exception as e:
            logger.error(f"❌ [Agent 0] Unexpected error during graph fetch: {e}\n{traceback.format_exc()}")

        if graph_documents:
            for idx, doc in enumerate(graph_documents[:5]):
                _log_raw_document(f"graph_documents[{idx}]", doc, max_chars=500)
            if len(graph_documents) > 5:
                logger.info(f"   [Agent 0] ... plus {len(graph_documents) - 5} more graph documents")
        else:
            logger.warning(
                f"   [Agent 0] No graph documents found for patient_id='{patient_id}' "
                f"— proceeding without longitudinal graph context"
            )
            state["warnings"].append(
                "No patient knowledge-graph history available — recommendation based on MongoDB summary only"
            )

        timeline_text = _render_graph_timeline(graph_documents)

        state["graph_documents"]     = graph_documents
        state["graph_timeline_text"] = timeline_text

        logger.info(
            f"✅ [Agent 0] Graph retrieval complete "
            f"| documents={len(graph_documents)} "
            f"| timeline_chars={len(timeline_text)}"
        )

        return state


# =====================================================================
# AGENT 1 — PATIENT CONTEXT EXTRACTOR  (now also reads graph_timeline_text)
# =====================================================================

class PatientContextExtractorAgent:
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def extract(self, state: TumorBoardState) -> TumorBoardState:
        logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        logger.info("🔍 [Agent 1 — PatientContextExtractor]: Starting")

        patient_summary = state.get("patient_summary") or {}
        graph_timeline_text = state.get("graph_timeline_text") or ""

        logger.info(
            f"   [Agent 1] patient_summary top-level keys: "
            f"{list(patient_summary.keys())}"
        )
        if patient_summary:
            _log_raw_document("patient_summary (full)", patient_summary, max_chars=10000)

        for section in ("clinical_summary", "timeline", "treatment_context"):
            section_data = patient_summary.get(section) if patient_summary else None
            if section_data:
                logger.info(f"   [Agent 1] ── section '{section}' present")
                _log_raw_document(f"patient_summary.{section}", section_data, max_chars=600)
            else:
                logger.info(f"   [Agent 1] ── section '{section}' MISSING or empty")

        logger.info(
            f"   [Agent 1] Neo4j graph timeline present: "
            f"{'yes (' + str(len(graph_timeline_text)) + ' chars)' if graph_timeline_text else 'NO'}"
        )

        clinical_summary_raw = ""
        if patient_summary:
            cs = patient_summary.get("clinical_summary", {})
            if isinstance(cs, dict):
                clinical_summary_raw = cs.get("raw_output", "")
            elif isinstance(cs, str):
                clinical_summary_raw = cs

        logger.info(
            f"   [Agent 1] clinical_summary_raw extracted "
            f"| length={len(clinical_summary_raw)} chars"
        )
        if not clinical_summary_raw and not graph_timeline_text:
            logger.warning(
                "   [Agent 1] Both clinical_summary_raw AND graph_timeline_text are EMPTY "
                "— LLM will have no clinical text to work from"
            )

        timeline_data  = patient_summary.get("timeline", {})         if patient_summary else {}
        treatment_data = patient_summary.get("treatment_context", {}) if patient_summary else {}

        agentic_context = {
            "clinical_summary": clinical_summary_raw,
            "neo4j_patient_graph_timeline": graph_timeline_text or "No graph history available",
            "timeline": {
                "timeline":            timeline_data.get("timeline", []),
                "diagnostic_delays":   timeline_data.get("diagnostic_delays", []),
                "progression_markers": timeline_data.get("progression_markers", []),
                "disease_velocity":    timeline_data.get("disease_velocity", ""),
                "velocity_rationale":  timeline_data.get("velocity_rationale", ""),
                "causal_narrative":    timeline_data.get("causal_narrative", ""),
            },
            "treatment_timeline": treatment_data.get("treatment_timeline", {}),
        }
        context_json = json.dumps(agentic_context, indent=2, default=str)

        logger.info(
            f"   [Agent 1] context_json being sent to LLM "
            f"| total length={len(context_json)} chars"
        )

        tb_input = state["tb_input"]

        prompt = f"""You are a senior oncologist preparing a structured clinical dossier for a multidisciplinary tumor board meeting.

PATIENT RECORD (all available sections, including full longitudinal graph history):
{context_json}

Patient Age: {tb_input.patient_age or 'Unknown'}
Patient Sex: {tb_input.patient_sex or 'Unknown'}
Requesting Specialty: {tb_input.requesting_specialty or 'Oncology'}

IMPORTANT: "neo4j_patient_graph_timeline" above is the patient's FULL longitudinal
record — every document, lab, imaging study, medication, procedure, and finding ever
captured for this patient, in chronological order. Treat it as the most complete and
authoritative source of patient history. Cross-reference it against clinical_summary;
if the graph timeline contains data not mentioned in clinical_summary (e.g. an older
biomarker result, an earlier line of treatment, a comorbidity), you MUST still extract
it — do not silently drop data found only in the graph timeline.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXTRACTION RULES — READ CAREFULLY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. PRIMARY DIAGNOSIS
   Extract the full diagnosis including: primary site, histology type, subtype/grade.
   Works for ALL cancer types — solid tumors, haematological, sarcoma, CNS, etc.

2. CANCER STAGE
   Use the formally documented stage if present (AJCC/TNM/Ann Arbor/FIGO etc.).
   If not formally staged, write "Not formally staged".

3. INFERRED STAGE
   ALWAYS populate this. Derive the best clinical stage estimate from ALL available
   imaging (CT, PET-CT, MRI, endoscopy), pathology, and lab data — including data
   found only in the graph timeline.
   Format: "cTxNxMx — [basis]" e.g. "cT3N0M0 — PET-CT no distant metastasis, EUS pending"
   For haematological cancers use appropriate system (ISS, Ann Arbor + Deauville etc.)
   If truly no imaging available write: "Cannot infer — no imaging available"

4. KEY BIOMARKERS
   Extract ALL biomarkers documented for this cancer type, from BOTH clinical_summary
   and the graph timeline lab results. Do NOT limit to a fixed panel.
   Use "unknown" only if the test was not performed or result not documented anywhere.
   Use "not applicable" if the marker is not part of standard workup for this cancer type.

5. CARDIAC FINDINGS
   Extract ALL cardiac findings from ECHO, stress test, cardiology notes, ECG —
   check both clinical_summary and graph timeline Vital Sign / Finding entries.
   If no cardiac workup documented write: []

6. IMAGING SUMMARY
   ALWAYS populate from ALL imaging reports across both sources.
   Include: primary lesion details, lymph node status, metastatic sites, incidental findings.

7. COMORBIDITIES
   Include ALL documented medical conditions outside the primary cancer.
   Do NOT put cardiac findings here — those go in cardiac_findings.

8. CRITICAL FINDINGS
   Clinically significant findings that directly impact treatment decisions.

9. URGENT CONCERNS
   Flag anything requiring immediate action before treatment can proceed.

10. PRIOR TREATMENTS
    ALL previous treatments for this cancer, from both sources — surgery, chemo,
    radiation, immunotherapy, targeted therapy, transplant. Critical — prevents
    re-recommendation of failed treatments.

11. PERFORMANCE STATUS
    Document ECOG (0-4) or Karnofsky (0-100) if recorded anywhere.
    If not documented write: "Not assessed — required before treatment planning"

12. CLINICAL SUMMARY TEXT
    3-4 sentence narrative covering demographics, diagnosis/grade, disease extent,
    comorbidities/cardiac status, and prior treatment context. No patient name.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return ONLY this JSON — no preamble, no markdown fences:
{{
  "primary_diagnosis": "Full diagnosis: site + histology + grade/subtype",
  "cancer_stage": "Formally documented stage or 'Not formally staged'",
  "inferred_stage": "cTxNxMx — basis of inference",
  "key_biomarkers": {{ "<marker_name>": "<result or unknown or not applicable>" }},
  "critical_findings": ["Finding 1 — specific, with measurements where available"],
  "comorbidities": ["Non-cardiac comorbidity 1"],
  "cardiac_findings": ["ECHO finding 1", "EF: 62%, Grade 1 Diastolic Dysfunction"],
  "urgent_concerns": ["Urgent concern 1 — what is missing and why it matters"],
  "pathology_summary": ["Key pathology result 1"],
  "prior_treatments": ["Treatment 1 — date if available"],
  "current_medications": ["Medication 1 — dose if available"],
  "metastatic_sites": ["Site 1 — confirmed or suspected"],
  "imaging_summary": ["CT/PET/MRI finding 1", "Lymph node status", "Distant metastasis status"],
  "performance_status": "ECOG x or 'Not assessed — required before treatment planning'",
  "clinical_summary_text": "3-4 sentence board-ready narrative. No patient name."
}}"""
        try:
            response = self.llm.invoke([
                SystemMessage(content="Extract structured clinical data for tumor board. Return only JSON."),
                HumanMessage(content=prompt),
            ])
            result = _parse_json(response.content)

            clinical_context = ClinicalContext(
                primary_diagnosis     = result.get("primary_diagnosis", "Pending workup"),
                cancer_stage          = result.get("cancer_stage", "Not formally staged"),
                inferred_stage        = result.get("inferred_stage", "Cannot infer — no imaging available"),
                key_biomarkers        = result.get("key_biomarkers", {}),
                critical_findings     = result.get("critical_findings", []),
                comorbidities         = result.get("comorbidities", []),
                cardiac_findings      = result.get("cardiac_findings", []),
                urgent_concerns       = result.get("urgent_concerns", []),
                pathology_summary     = result.get("pathology_summary", []),
                prior_treatments      = result.get("prior_treatments", []),
                current_medications   = result.get("current_medications", []),
                metastatic_sites      = result.get("metastatic_sites", []),
                imaging_summary       = result.get("imaging_summary", []),
                performance_status    = result.get("performance_status", "Not assessed — required before treatment planning"),
                clinical_summary_text = result.get("clinical_summary_text", ""),
            )

            state["clinical_context"] = clinical_context

            if clinical_context.urgent_concerns:
                state["warnings"].extend([
                    f"URGENT: {u}" for u in clinical_context.urgent_concerns
                ])

            known_bm   = {k: v for k, v in clinical_context.key_biomarkers.items()
                          if v and v not in ("unknown", None, "")}
            missing_bm = [k for k, v in clinical_context.key_biomarkers.items()
                          if not v or v in ("unknown", None, "")]

            logger.info(f"✅ [Agent 1] Diagnosis          : {clinical_context.primary_diagnosis}")
            logger.info(f"   [Agent 1] Formal stage        : {clinical_context.cancer_stage}")
            logger.info(f"   [Agent 1] Inferred stage      : {clinical_context.inferred_stage}")
            logger.info(f"   [Agent 1] Biomarkers known    : {known_bm}")
            logger.info(f"   [Agent 1] Biomarkers missing  : {missing_bm}")
            logger.info(f"   [Agent 1] Comorbidities       : {clinical_context.comorbidities}")
            logger.info(f"   [Agent 1] Cardiac findings    : {clinical_context.cardiac_findings}")
            logger.info(f"   [Agent 1] Urgent concerns     : {clinical_context.urgent_concerns}")
            logger.info(f"   [Agent 1] Critical findings   : {clinical_context.critical_findings}")
            logger.info(f"   [Agent 1] Imaging summary     : {clinical_context.imaging_summary}")
            logger.info(f"   [Agent 1] Prior treatments    : {clinical_context.prior_treatments}")
            logger.info(f"   [Agent 1] Performance status  : {clinical_context.performance_status}")
            logger.info(f"   [Agent 1] Metastatic sites    : {clinical_context.metastatic_sites}")
            logger.info(
                f"   [Agent 1] Summary text        : "
                f"{clinical_context.clinical_summary_text[:200]}..."
            )

        except Exception as e:
            logger.error(f"❌ [Agent 1] Context extraction failed: {e}\n{traceback.format_exc()}")
            state["clinical_context"] = ClinicalContext(
                clinical_summary_text="Clinical context extraction failed — manual review required."
            )
            state["warnings"].append("Patient context extraction incomplete — review manually")

        return state


# =====================================================================
# AGENT 2 — GUIDELINE RETRIEVAL  (MongoDB-only — unchanged from v4.3)
# =====================================================================

class TBGuidelineRetrievalAgent:
    async def retrieve(self, state: TumorBoardState) -> TumorBoardState:
        logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        logger.info("📚 [Agent 2 — GuidelineRetrieval]: Starting (MongoDB-only)")

        tb_input         = state["tb_input"]
        clinical_context = state.get("clinical_context") or ClinicalContext()

        doctor_lookup_id       = tb_input.doctor_sys_id or tb_input.doctor_id
        doctor_guidelines_list: List[Dict[str, Any]] = []

        try:
            logger.info(
                f"   [Agent 2] DB query | collection=doctor_guidelines "
                f"| filter={{doctor_id: '{doctor_lookup_id}'}}"
            )
            doctor_guideline_doc = await doctor_guidelines_collection.find_one(
                {"doctor_id": doctor_lookup_id}
            )

            if doctor_guideline_doc:
                logger.info(
                    f"   [Agent 2] DB result | doctor_guidelines doc found "
                    f"| _id={doctor_guideline_doc.get('_id')}"
                )
                _log_raw_document("doctor_guidelines (full doc)", doctor_guideline_doc, max_chars=2000)
                doctor_guidelines_list = doctor_guideline_doc.get("guidelines", [])
                logger.info(f"   [Agent 2] guidelines array length: {len(doctor_guidelines_list)}")
                for idx, g in enumerate(doctor_guidelines_list):
                    logger.info(
                        f"   [Agent 2]   guideline[{idx}] | id={g.get('id', 'N/A')} "
                        f"| title={g.get('title', 'N/A')} "
                        f"| treatments_count={len(g.get('treatments', []))}"
                    )
            else:
                logger.warning(
                    f"   [Agent 2] DB result | NO doctor_guidelines record for doctor_id='{doctor_lookup_id}'"
                )
        except Exception as e:
            logger.error(f"❌ [Agent 2] Failed to fetch doctor_guidelines: {e}")

        state["doctor_guidelines"] = doctor_guidelines_list

        approved_list = [
            f"{g.get('title', 'Untitled')} — {g.get('explanation', '')}".strip(" —")
            for g in doctor_guidelines_list
            if g.get("title")
        ]

        key_recs: List[str] = []
        for g in doctor_guidelines_list:
            for t in g.get("treatments", []):
                name      = t.get("name", "")
                modality  = t.get("modality", "")
                rec_class = t.get("rec_class", "N/A")
                evidence  = t.get("evidence", "N/A")
                if name:
                    key_recs.append(f"{name} ({modality}, Class {rec_class}, Level {evidence})")

        contraindicated: List[str] = []
        bm = clinical_context.key_biomarkers
        if bm.get("EGFR") in ("wild-type",):
            contraindicated.append("EGFR-targeted therapy (EGFR wild-type)")

        missing_workup: List[str] = []
        unknown_markers = [
            k for k, v in bm.items()
            if str(v).lower() in ("unknown", "none", "", "not done", "pending")
        ]
        if unknown_markers:
            missing_workup.append(f"Complete biomarker panel — missing: {', '.join(unknown_markers)}")
        if not clinical_context.pathology_summary:
            missing_workup.append("Histopathology confirmation required")

        diagnosis_lower = clinical_context.primary_diagnosis.lower()
        inferred_lower  = clinical_context.inferred_stage.lower()

        if any(x in diagnosis_lower for x in ("esophag", "gastric", "stomach", "rectal", "colon")):
            if "eus" not in inferred_lower and "endoscopic ultrasound" not in inferred_lower:
                missing_workup.append("Endoscopic ultrasound (EUS) — required for T and N staging before treatment")

        if any(x in diagnosis_lower for x in ("lymphoma", "myeloma", "leukaemia", "leukemia")):
            missing_workup.append("Bone marrow biopsy — required for haematological staging")

        if "breast" in diagnosis_lower:
            if not any("mri" in str(s).lower() for s in clinical_context.imaging_summary):
                missing_workup.append("Breast MRI — recommended for local staging")

        if clinical_context.performance_status in ("", "Not assessed — required before treatment planning", None):
            missing_workup.append("ECOG performance status assessment — required before systemic therapy")

        if not clinical_context.cardiac_findings and any(
            x in diagnosis_lower for x in (
                "esophag", "lung", "gastric", "breast", "colon", "rectal",
                "bladder", "ovarian", "cervical", "sarcoma"
            )
        ):
            missing_workup.append("Cardiac evaluation (ECHO) — required before chemotherapy/surgery planning")

        summary_text = (
            f"For this patient with {clinical_context.primary_diagnosis} "
            f"({clinical_context.cancer_stage}), approved applicable guidelines are: "
            f"{'; '.join(approved_list[:3]) if approved_list else 'standard institutional guidelines'}. "
            f"Key evidence-based options include: "
            f"{'; '.join(key_recs[:4]) if key_recs else 'to be determined based on biomarker completion'}. "
            f"{'Contraindicated: ' + '; '.join(contraindicated) + '. ' if contraindicated else ''}"
            f"{'Missing workup before proceeding: ' + '; '.join(missing_workup) + '.' if missing_workup else ''}"
        )

        state["guideline_context"] = GuidelineContext(
            applicable_guideline_titles = approved_list,
            key_recommendations         = key_recs,
            contraindicated_options     = contraindicated,
            missing_workup              = missing_workup,
            guideline_summary_text      = summary_text,
        )

        logger.info(
            f"✅ [Agent 2] Guideline context built "
            f"| approved_guidelines={len(approved_list)} "
            f"| recommendations={len(key_recs)} "
            f"| contraindications={len(contraindicated)} "
            f"| missing_workup={len(missing_workup)}"
        )

        return state


# =====================================================================
# AGENT 3 — DOCTOR OPINION AGENT  (unchanged logic, same schema output)
# =====================================================================

class DoctorOpinionAgent:
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def generate_opinion(self, state: TumorBoardState) -> TumorBoardState:
        logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        logger.info("🏥 [Agent 3 — DoctorOpinionAgent]: Starting")

        tb_input          = state["tb_input"]
        clinical_context  = state.get("clinical_context") or ClinicalContext()
        guideline_context = state.get("guideline_context") or GuidelineContext()

        specialty = tb_input.requesting_specialty or "general_oncology"
        age       = tb_input.patient_age
        sex       = tb_input.patient_sex
        specialty_scope_guidance = _get_specialty_guidance(specialty)

        own_prior = tb_input.current_doctor_prior_opinion
        if own_prior:
            own_prior_block = (
                f"  ═══════════════════════════════════════════\n"
                f"  YOUR PREVIOUS OPINION (submitted {own_prior.created_at or 'N/A'})\n"
                f"  {own_prior.doctor_recommendation}\n"
                f"  ═══════════════════════════════════════════\n"
                f"  State explicitly whether you are confirming, revising, or updating it — and why.\n"
            )
        else:
            own_prior_block = "  No previous opinion from you on record for this patient."

        other_opinions_block = ""
        for op in tb_input.prior_doctor_opinions:
            other_opinions_block += (
                f"\n  ─────────────────────────────────────\n"
                f"  {op.specialty.upper()} (submitted {op.created_at or 'N/A'}):\n"
                f"  {op.doctor_recommendation}\n"
            )
        if not other_opinions_block:
            other_opinions_block = "  No other specialty opinions on record yet."

        approved_block = (
            "\n".join(
                f"  [{g.get('id', 'N/A')}] {g.get('title')} — {g.get('explanation', '')}"
                for g in state.get("doctor_guidelines", [])
            )
            or "  No specific guidelines configured — use evidence-based clinical judgment"
        )

        known_bm = {k: v for k, v in clinical_context.key_biomarkers.items()
                    if v and v not in ("unknown", None, "")}
        total_bm = len(clinical_context.key_biomarkers) or 1
        bm_completeness = round(len(known_bm) / total_bm, 2)
        has_pathology = 1.0 if clinical_context.pathology_summary else 0.0
        has_imaging   = 1.0 if clinical_context.imaging_summary   else 0.0
        has_staging   = 0.0 if clinical_context.cancer_stage in ("Not staged", "") else 1.0
        data_completeness = round((bm_completeness + has_pathology + has_imaging + has_staging) / 4, 3)

        n_other_opinions = len(tb_input.prior_doctor_opinions)

        prompt = f"""You are a {specialty.replace('_', ' ').title()} specialist submitting your opinion to a Multidisciplinary Tumor Board (MDT).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR SPECIALTY'S SCOPE OF INPUT (STAY WITHIN THIS LANE):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{specialty_scope_guidance}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CLINICAL CONTEXT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{clinical_context.clinical_summary_text}

Age: {age or 'Unknown'} | Sex: {sex or 'Unknown'}
Formal Stage    : {clinical_context.cancer_stage}
Inferred Stage  : {clinical_context.inferred_stage}
Comorbidities   : {', '.join(clinical_context.comorbidities) or 'None documented'}
Cardiac findings: {', '.join(clinical_context.cardiac_findings) or 'None documented'}
Current medications: {', '.join(clinical_context.current_medications) or 'None documented'}
Performance status : {clinical_context.performance_status or 'Not assessed'}

Imaging summary:
{chr(10).join(f'  • {i}' for i in clinical_context.imaging_summary) or '  None documented'}

Known biomarkers:
{chr(10).join(f'  {k}: {v}' for k, v in known_bm.items()) or '  Biomarker panel incomplete'}

Prior treatments (MUST NOT be re-recommended):
{chr(10).join(f'  • {t}' for t in clinical_context.prior_treatments) or '  None documented'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GUIDELINE CONTEXT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{guideline_context.guideline_summary_text}

Approved guidelines:
{approved_block}

Contraindicated options:
{chr(10).join(f'  ✗ {c}' for c in guideline_context.contraindicated_options) or '  None identified'}

Missing workup (MUST be actioned before systemic therapy):
{chr(10).join(f'  ? {m}' for m in guideline_context.missing_workup) or '  None identified'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR PREVIOUS OPINION:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{own_prior_block}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OTHER MDT OPINIONS ALREADY SUBMITTED ({n_other_opinions} specialist(s)):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{other_opinions_block}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR TASKS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TASK A — Write your MDT opinion as a {specialty.replace('_', ' ').title()} specialist.
          Your clinical_position must LEAD with your concrete specialty-specific
          procedural/treatment plan for THIS patient (see scope above), grounded in
          the actual inferred stage, imaging, biomarkers and other clinical data
          given — do not lead with generic prerequisite workup instead of stating
          your plan. Do NOT repeat concerns already raised by other specialties
          unless you disagree.

TASK B — Score four confidence dimensions (each 0.0–1.0):
  • guideline_alignment   : do your actions match the approved guidelines?
  • consensus_alignment   : how much do the other MDT opinions agree with yours?
    (1.0 = all agree, 0.5 = mixed, 0.0 = all disagree; 0.8 if no other opinions yet)
  • data_completeness     : how complete is the clinical/biomarker/staging data?
    ({data_completeness:.2f} pre-computed — adjust ±0.05 based on narrative gaps)
  • revision_consistency  : is your current position consistent with your prior opinion?
    (1.0 = confirming unchanged, 0.7 = minor update, 0.4 = significant revision,
     0.9 if no prior opinion on record)

RULES:
- NEVER include the patient name.
- Stay strictly within YOUR SPECIALTY'S SCOPE OF INPUT defined above. Every
  key_action and the clinical_position must reflect what a {specialty.replace('_', ' ').title()}
  specialist actually does — not decisions that belong to another specialty. If
  another specialty's intervention is needed, name it only as a referral/next
  step (e.g. "Refer to Medical Oncology for systemic therapy planning"), never
  prescribe that specialty's specifics yourself (no drug names/doses/regimens if
  you are not Medical Oncology, no operative approach if you are not Surgical
  Oncology, no RT dose/fractionation if you are not Radiation Oncology).
- Do NOT recommend anything in the contraindicated list.
- Do NOT re-recommend any prior treatment.
- key_actions[0] (and ideally [1]) must state YOUR concrete specialty-specific
  procedural plan (e.g. for Radiation Oncology: modality + intent + target/field;
  for Medical Oncology: systemic regimen strategy + sequencing; for Surgical
  Oncology: operative approach + extent of resection) — not a generic workup
  item. If missing workup is listed, include completing it as a LATER key_action
  (a prerequisite before execution), not as key_actions[0], UNLESS the missing
  data makes it clinically unsafe to state any plan at all — in that rare case,
  say so explicitly and explain what specific plan you would commit to once that
  one piece of data returns.
- If cardiac_findings are present, address their impact on your specialty's treatment plan.
- key_actions must be specific and actionable — no vague statements.

Return ONLY this JSON — no preamble, no markdown fences:
{{
  "specialty": "{specialty}",
  "clinical_position": "2-3 sentence narrative grounded in staging, imaging and comorbidities",
  "key_actions": ["Action 1 — specific and actionable with clinical rationale", "Action 2", "Action 3"],
  "concerns_raised": ["Specific concern from your specialty perspective"],
  "confidence_breakdown": {{
    "guideline_alignment": <0.0–1.0>,
    "consensus_alignment": <0.0–1.0>,
    "data_completeness": <0.0–1.0>,
    "revision_consistency": <0.0–1.0>,
    "reasoning": {{
      "guideline_alignment": "one-sentence explanation",
      "consensus_alignment": "one-sentence explanation",
      "data_completeness": "one-sentence explanation",
      "revision_consistency": "one-sentence explanation"
    }}
  }},
  "requires_urgent_mdt": true|false,
  "requires_genetic_counseling": true|false,
  "requires_palliative_referral": true|false
}}

Return ONLY JSON."""

        try:
            response = self.llm.invoke([
                SystemMessage(content="You are an MDT specialist writing your tumor board opinion. Return only JSON."),
                HumanMessage(content=prompt),
            ])
            result = _parse_json(response.content)

            raw_cb = result.get("confidence_breakdown", {})
            cb = ConfidenceBreakdown(
                guideline_alignment  = max(0.0, min(1.0, float(raw_cb.get("guideline_alignment", 0.7)))),
                consensus_alignment  = max(0.0, min(1.0, float(raw_cb.get("consensus_alignment", 0.8)))),
                data_completeness    = max(0.0, min(1.0, float(raw_cb.get("data_completeness", data_completeness)))),
                revision_consistency = max(0.0, min(1.0, float(raw_cb.get("revision_consistency", 0.9)))),
                reasoning            = raw_cb.get("reasoning", {}),
            )

            state["doctor_opinion"] = DoctorOpinionDraft(
                specialty         = result.get("specialty", specialty),
                clinical_position = result.get("clinical_position", ""),
                key_actions       = result.get("key_actions", []),
                concerns_raised   = result.get("concerns_raised", []),
                confidence_breakdown          = cb,
                requires_urgent_mdt           = result.get("requires_urgent_mdt", False),
                requires_genetic_counseling   = result.get("requires_genetic_counseling", False),
                requires_palliative_referral  = result.get("requires_palliative_referral", False),
            )

            op = state["doctor_opinion"]
            logger.info(f"✅ [Agent 3] Opinion generated | specialty={op.specialty}")
            logger.info(f"   [Agent 3] Key actions ({len(op.key_actions)}): {op.key_actions}")
            logger.info(
                f"   [Agent 3] Confidence breakdown  : "
                f"guideline={cb.guideline_alignment:.2f} | consensus={cb.consensus_alignment:.2f} | "
                f"completeness={cb.data_completeness:.2f} | revision={cb.revision_consistency:.2f}"
            )

        except Exception as e:
            logger.error(f"❌ [Agent 3] Opinion generation failed: {e}\n{traceback.format_exc()}")
            state["doctor_opinion"] = DoctorOpinionDraft(
                specialty              = specialty,
                clinical_position      = "Opinion generation failed — manual review required.",
                optimal_recommendation = "Could not generate recommendation — manual review required.",
            )
            state["warnings"].append("Doctor opinion generation incomplete — review manually")

        return state


# =====================================================================
# AGENT 4 — CROSS-SPECIALTY REVIEW  (NEW in v4.4)
#
# Purpose: kill "hedgy / uncertain" final recommendations by running an
# internal panel of oncology subspecialties against the SAME full
# clinical + graph picture, and folding the result into EXISTING fields
# only (ConfidenceBreakdown.consensus_alignment, concerns_raised,
# requires_urgent_mdt). No new fields are added to TumorBoardReport.
# =====================================================================

class CrossSpecialtyReviewAgent:
    PANEL_SPECIALTIES = [
        "medical_oncology",
        "surgical_oncology",
        "radiation_oncology",
        "pathology",
        "palliative_care",
    ]

    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def cross_check(self, state: TumorBoardState) -> TumorBoardState:
        logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        logger.info("🧬 [Agent 4 — CrossSpecialtyReview]: Starting")

        clinical_context  = state.get("clinical_context") or ClinicalContext()
        guideline_context = state.get("guideline_context") or GuidelineContext()
        doctor_opinion    = state.get("doctor_opinion") or DoctorOpinionDraft()
        requesting_specialty = doctor_opinion.specialty or "general_oncology"

        panel_to_check = [
            s for s in self.PANEL_SPECIALTIES
            if s != requesting_specialty
        ]

        panel_scope_block = "\n".join(
            f"  • {s.replace('_', ' ').title()}: {_get_specialty_guidance(s)}"
            for s in panel_to_check
        )

        prompt = f"""You are convening an internal multi-specialty sanity-check panel
BEFORE this case goes to the formal MDT. The requesting specialist
({requesting_specialty.replace('_', ' ').title()}) has already drafted an opinion below.
Your job is to independently stress-test it from the perspective of these oncology
subspecialties: {', '.join(s.replace('_', ' ').title() for s in panel_to_check)}.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EACH PANEL SPECIALTY'S SCOPE (evaluate strictly through this lens — a
specialty should only be credited with an objection that falls within its
own scope; do not let one specialty's panel voice wander into another's):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{panel_scope_block}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FULL CLINICAL PICTURE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{clinical_context.clinical_summary_text}
Formal Stage    : {clinical_context.cancer_stage}
Inferred Stage  : {clinical_context.inferred_stage}
Comorbidities   : {', '.join(clinical_context.comorbidities) or 'None documented'}
Cardiac findings: {', '.join(clinical_context.cardiac_findings) or 'None documented'}
Biomarkers      : {', '.join(f'{k}: {v}' for k, v in clinical_context.key_biomarkers.items()) or 'Incomplete'}
Prior treatments: {', '.join(clinical_context.prior_treatments) or 'None'}
Performance status: {clinical_context.performance_status or 'Not assessed'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GUIDELINE CONTEXT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{guideline_context.guideline_summary_text}
Contraindicated: {', '.join(guideline_context.contraindicated_options) or 'None'}
Missing workup : {', '.join(guideline_context.missing_workup) or 'None'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DRAFT OPINION TO STRESS-TEST ({requesting_specialty.replace('_', ' ').title()}):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Position    : {doctor_opinion.clinical_position}
Key actions : {'; '.join(doctor_opinion.key_actions) or 'None'}
Concerns    : {'; '.join(doctor_opinion.concerns_raised) or 'None'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR TASK:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
For EACH panel specialty, decide: does it AGREE with the draft opinion's plan, or does
it raise a genuine, clinically material objection/addition? Do NOT invent objections for
the sake of it — agreement is a valid and expected outcome when the plan is sound.

Then produce:
- cross_specialty_alignment: 0.0–1.0 — how well the draft plan holds up across the panel
  (1.0 = full panel agreement with no material gaps, 0.5 = mixed, 0.0 = panel strongly disagrees)
- new_concerns: ONLY concerns that are clinically material and NOT already listed in
  doctor_opinion.concerns_raised above (avoid duplicates — compare carefully).
- escalation_needed: true only if the panel surfaces something that genuinely requires
  urgent full MDT discussion before any action proceeds (e.g. unaddressed contraindication,
  major safety gap) — NOT simply because data is incomplete.
- panel_summary: 1-2 sentence internal note on whether the panel broadly endorses the plan.

Return ONLY this JSON:
{{
  "cross_specialty_alignment": <0.0-1.0>,
  "new_concerns": ["concern 1"],
  "escalation_needed": true|false,
  "panel_summary": "1-2 sentence note"
}}

Return ONLY JSON."""

        cross_specialty_alignment = 0.8
        new_concerns: List[str] = []
        escalation_needed = False
        panel_summary = ""

        try:
            response = self.llm.invoke([
                SystemMessage(content="You are an internal oncology cross-specialty review panel. Return only JSON."),
                HumanMessage(content=prompt),
            ])
            result = _parse_json(response.content)

            cross_specialty_alignment = max(0.0, min(1.0, float(result.get("cross_specialty_alignment", 0.8))))
            new_concerns = [str(c) for c in (result.get("new_concerns") or []) if c]
            escalation_needed = bool(result.get("escalation_needed", False))
            panel_summary = result.get("panel_summary", "")

            logger.info(
                f"✅ [Agent 4] Panel review complete "
                f"| alignment={cross_specialty_alignment:.2f} "
                f"| new_concerns={len(new_concerns)} "
                f"| escalation_needed={escalation_needed}"
            )
            if panel_summary:
                logger.info(f"   [Agent 4] Panel note: {panel_summary}")

        except Exception as e:
            logger.error(f"❌ [Agent 4] Cross-specialty review failed: {e}\n{traceback.format_exc()}")
            state["warnings"].append("Cross-specialty review could not be completed — proceeding on single-specialty opinion")

        # ── Merge results into EXISTING doctor_opinion fields only ────
        # (no new schema fields are introduced on TumorBoardReport)
        cb = doctor_opinion.confidence_breakdown
        blended_consensus = round((cb.consensus_alignment * 0.6) + (cross_specialty_alignment * 0.4), 3)
        cb.consensus_alignment = max(0.0, min(1.0, blended_consensus))

        existing_concerns_lower = {c.strip().lower() for c in doctor_opinion.concerns_raised}
        for concern in new_concerns:
            if concern.strip().lower() not in existing_concerns_lower:
                doctor_opinion.concerns_raised.append(f"[Cross-specialty panel] {concern}")
                existing_concerns_lower.add(concern.strip().lower())

        if escalation_needed:
            doctor_opinion.requires_urgent_mdt = True

        state["doctor_opinion"] = doctor_opinion
        state["cross_specialty_notes"] = {
            "cross_specialty_alignment": cross_specialty_alignment,
            "panel_summary": panel_summary,
            "escalation_needed": escalation_needed,
            "panel_specialties_checked": panel_to_check,
        }

        logger.info(
            f"   [Agent 4] Blended consensus_alignment now = {cb.consensus_alignment:.3f} "
            f"(prior consensus 60% + panel alignment 40%)"
        )

        return state


# =====================================================================
# AGENT 5 — MDT SYNTHESIS AGENT  (unchanged logic; benefits from the
# now cross-checked doctor_opinion as input)
# =====================================================================

class MDTSynthesisAgent:
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def synthesize(self, state: TumorBoardState) -> TumorBoardState:
        logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        logger.info("🔗 [Agent 5 — MDTSynthesisAgent]: Starting")

        tb_input          = state["tb_input"]
        clinical_context  = state.get("clinical_context") or ClinicalContext()
        guideline_context = state.get("guideline_context") or GuidelineContext()
        doctor_opinion    = state.get("doctor_opinion") or DoctorOpinionDraft()
        prior_opinions    = tb_input.prior_doctor_opinions
        own_prior         = tb_input.current_doctor_prior_opinion
        cross_notes       = state.get("cross_specialty_notes") or {}

        if not prior_opinions and not own_prior:
            logger.info(
                "   [Agent 5] No other real MDT opinions present — "
                "using single-specialty + cross-specialty-panel summary"
            )
            panel_note = (
                f" An internal cross-specialty panel review "
                f"({cross_notes.get('panel_summary', 'completed without material objections')}) "
                f"supports this position."
                if cross_notes else ""
            )
            state["mdt_consensus"] = MDTConsensusReport(
                consensus_status    = MDTConsensus.UNANIMOUS,
                agreed_actions      = doctor_opinion.key_actions,
                chairperson_summary = (
                    f"This case was reviewed by "
                    f"{doctor_opinion.specialty.replace('_', ' ').title()}.{panel_note} "
                    f"{doctor_opinion.clinical_position} "
                    f"Formal cross-specialty MDT discussion remains available if further "
                    f"specialist opinions are submitted."
                ),
            )
            return state

        current_opinion_text = (
            f"CURRENT OPINION ({doctor_opinion.specialty.replace('_', ' ').title()}):\n"
            f"  Position    : {doctor_opinion.clinical_position}\n"
            f"  Key Actions : {'; '.join(doctor_opinion.key_actions)}\n"
            f"  Concerns    : {'; '.join(doctor_opinion.concerns_raised) or 'None'}\n"
        )

        all_opinions_text = current_opinion_text
        for op in prior_opinions:
            all_opinions_text += (
                f"\n─────────────────────────────────────\n"
                f"{op.specialty.upper()} (submitted {op.created_at or 'N/A'}):\n"
                f"  {op.doctor_recommendation}\n"
            )

        prompt = f"""You are the MDT chairperson facilitating a multidisciplinary tumor board.

CLINICAL PICTURE:
{clinical_context.clinical_summary_text}
Inferred Stage: {clinical_context.inferred_stage}
Cardiac findings: {', '.join(clinical_context.cardiac_findings) or 'None'}

GUIDELINE CONTEXT:
{guideline_context.guideline_summary_text}

ALL SPECIALTY OPINIONS:
{all_opinions_text}

Write the MDT chairperson synthesis — the official board minute.

STRICT RULES:
- agreed_actions: only actions that are genuinely supported by the available opinions.
  Note which specialty/specialties support each action.
- points_of_disagreement: ONLY populate if two or more specialties hold genuinely
  conflicting positions on the SAME clinical decision. If only one specialty has
  submitted an opinion, set this to an empty list [].
  Do NOT fabricate disagreements or write "X vs. No opposing opinion".
- unresolved_questions: clinical questions that require additional data, discussion,
  or another specialty's input to resolve.
- consensus_status rules:
    "unanimous"  — all opinions align fully
    "majority"   — most align, minor differences
    "split"      — significant split on a key treatment decision
    "dissenting" — one opinion explicitly contradicts the majority
  If only ONE specialty opinion exists → always "unanimous" (pending full MDT).
- chairperson_summary: formal 3-4 sentence MDT minute. State how many specialties
  contributed. Reference inferred stage and key comorbidities. No patient name.

Return ONLY this JSON:
{{
  "consensus_status": "unanimous|majority|split|dissenting",
  "agreed_actions": ["Agreed action — (Specialty 1, Specialty 2)"],
  "points_of_disagreement": [],
  "unresolved_questions": ["Unresolved question — what data would resolve this"],
  "chairperson_summary": "3-4 sentence formal MDT minute (no patient name)"
}}

Return ONLY JSON."""

        try:
            response = self.llm.invoke([
                SystemMessage(content="You are MDT chairperson. Write the board synthesis. Return only JSON."),
                HumanMessage(content=prompt),
            ])
            result = _parse_json(response.content)

            consensus = MDTConsensus.MAJORITY
            try:
                consensus = MDTConsensus(result.get("consensus_status", "majority"))
            except ValueError:
                pass

            state["mdt_consensus"] = MDTConsensusReport(
                consensus_status       = consensus,
                agreed_actions         = result.get("agreed_actions", []),
                points_of_disagreement = result.get("points_of_disagreement", []),
                unresolved_questions   = result.get("unresolved_questions", []),
                chairperson_summary    = result.get("chairperson_summary", ""),
            )
            mc = state["mdt_consensus"]
            logger.info(
                f"✅ [Agent 5] MDT consensus: {consensus.value} "
                f"| agreed_actions={len(mc.agreed_actions)} "
                f"| disagreements={len(mc.points_of_disagreement)} "
                f"| unresolved={len(mc.unresolved_questions)}"
            )

        except Exception as e:
            logger.error(f"❌ [Agent 5] MDT synthesis failed: {e}\n{traceback.format_exc()}")
            state["warnings"].append("MDT synthesis incomplete — manual review required")
            state["mdt_consensus"] = MDTConsensusReport(
                consensus_status    = MDTConsensus.MAJORITY,
                chairperson_summary = "MDT synthesis could not be completed — manual review required.",
            )

        return state


# =====================================================================
# AGENT 6 — VALIDATION AGENT  (unchanged from v4.3)
# =====================================================================

class TBValidationAgent:
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def validate(self, state: TumorBoardState) -> TumorBoardState:
        logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        logger.info("🧠 [Agent 6 — ValidationAgent]: Starting")

        tb_input          = state["tb_input"]
        clinical_context  = state.get("clinical_context") or ClinicalContext()
        guideline_context = state.get("guideline_context") or GuidelineContext()
        doctor_opinion    = state.get("doctor_opinion") or DoctorOpinionDraft()
        mdt_consensus     = state.get("mdt_consensus") or MDTConsensusReport()

        known_bm   = {k: v for k, v in clinical_context.key_biomarkers.items()
                      if v and v not in ("unknown", None)}
        bm_summary = "\n".join(f"  {k}: {v}" for k, v in known_bm.items())

        approved_block = (
            "\n".join(
                f"  [{g.get('id', 'N/A')}] {g.get('title')} — {g.get('explanation', '')}"
                for g in state.get("doctor_guidelines", [])
            )
            or "  No specific guidelines configured"
        )

        agreed_actions_block = (
            chr(10).join(f"  • {a}" for a in mdt_consensus.agreed_actions)
            or "  None"
        )

        prompt = f"""You are a senior oncologist performing a safety and guideline compliance audit
on a multidisciplinary tumor board recommendation.

PATIENT:
Age: {tb_input.patient_age or 'Unknown'} | Sex: {tb_input.patient_sex or 'Unknown'}
Diagnosis: {clinical_context.primary_diagnosis}
Formal Stage: {clinical_context.cancer_stage}
Inferred Stage: {clinical_context.inferred_stage}

BIOMARKER STATUS:
{bm_summary or '  Not available'}

CARDIAC FINDINGS (critical for treatment planning):
{chr(10).join(f'  • {c}' for c in clinical_context.cardiac_findings) or '  None documented'}

PRIOR TREATMENTS (MUST NOT be re-recommended):
{chr(10).join(f'  - {t}' for t in clinical_context.prior_treatments) or '  None'}

CURRENT MEDICATIONS:
{', '.join(clinical_context.current_medications) or 'None'}

CONTRAINDICATED OPTIONS (from biomarker/clinical analysis):
{chr(10).join(f'  ✗ {c}' for c in guideline_context.contraindicated_options) or '  None identified'}

MISSING WORKUP (flagged by guideline retrieval):
{chr(10).join(f'  ? {m}' for m in guideline_context.missing_workup) or '  None identified'}

SPECIALIST OPINION — KEY ACTIONS:
{chr(10).join(f'  • {a}' for a in doctor_opinion.key_actions) or '  None'}

MDT AGREED ACTIONS (DO NOT remove these unless explicitly contraindicated):
{agreed_actions_block}

APPROVED GUIDELINES:
{approved_block}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AUDIT CHECKLIST:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. BIOMARKER MISMATCH    — Biomarker-targeted therapy recommended without confirmed marker?
2. FAILED TREATMENT      — Any treatment in prior_treatments being re-recommended?
3. CONTRAINDICATION      — Any explicitly contraindicated option being recommended?
4. CARDIAC RISK          — Are cardiac findings (if any) adequately addressed in the plan?
5. RENAL/HEPATIC RISK    — Are nephrotoxic/hepatotoxic agents appropriate given organ function?
6. AGE / PERFORMANCE     — Is the treatment intensity appropriate for age and performance status?
7. DRUG INTERACTION      — Dangerous combination with current medications?
8. MISSING WORKUP        — Is critical missing workup flagged BEFORE systemic therapy starts?
9. GUIDELINE COMPLIANCE  — Do the agreed actions align with approved guidelines?

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCORING RULES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Start safety_score and guideline_score both at 0.85.
Each CRITICAL flag : -0.15 (floor 0.40)
Each WARNING flag  : -0.05 (floor 0.40)

IMPORTANT — DO NOT flag or penalise:
- MDT agreed actions that are clinically appropriate even if not in approved guidelines
- Staging workup steps (EUS, bone marrow biopsy etc.) — these are always appropriate
- Nutritional support, palliative options, surgical evaluation — standard of care actions
- Actions that are pending completion of missing workup

missing_workup_additions: ONLY add a step here if it is genuinely absent from ALL
of the above actions AND is required by the approved guidelines.

Return ONLY this JSON:
{{
  "safety_score": <float 0.40–0.90>,
  "guideline_score": <float 0.40–0.90>,
  "is_safe": <true|false>,
  "flags": ["CRITICAL: <specific safety issue>", "WARNING: <specific concern>"],
  "missing_workup_additions": ["<guideline-required step genuinely absent from all actions> — <guideline reference>"],
  "auditor_note": "2-3 sentence audit summary referencing stage, cardiac status, and key safety considerations. No patient name."
}}

Return ONLY JSON."""

        try:
            response = self.llm.invoke([
                SystemMessage(content="Audit tumor board opinion for safety. Return only JSON."),
                HumanMessage(content=prompt),
            ])
            result = _parse_json(response.content)

            safety_score    = max(0.40, min(0.90, float(result.get("safety_score",    0.70))))
            guideline_score = max(0.40, min(0.90, float(result.get("guideline_score", 0.70))))

            state["validation_report"] = ValidationReport(
                is_safe                  = result.get("is_safe", True),
                safety_score             = round(safety_score,    3),
                guideline_score          = round(guideline_score, 3),
                flags                    = [str(f) for f in (result.get("flags") or []) if f],
                missing_workup_additions = [
                    str(a) for a in (result.get("missing_workup_additions") or []) if a
                ],
                auditor_note             = result.get("auditor_note", ""),
            )
            vr = state["validation_report"]
            logger.info(
                f"✅ [Agent 6] Validation complete "
                f"| is_safe={vr.is_safe} "
                f"| safety_score={vr.safety_score:.2f} "
                f"| guideline_score={vr.guideline_score:.2f} "
                f"| flags={len(vr.flags)}"
            )
            for flag in vr.flags:
                if flag.startswith("CRITICAL"):
                    logger.warning(f"   [Agent 6] 🚨 {flag}")
                else:
                    logger.info(f"   [Agent 6] ⚠️  {flag}")

        except Exception as e:
            logger.error(f"❌ [Agent 6] Validation failed: {e}\n{traceback.format_exc()}")
            state["validation_report"] = ValidationReport(
                is_safe      = False,
                safety_score = 0.50,
                flags        = [f"Validation agent failed: {str(e)}"],
                auditor_note = "Validation could not be completed — manual review required.",
            )

        return state


# =====================================================================
# AGENT 7 — REPORT ASSEMBLER  (same output schema as v4.3 — only the
# final_recommendation prompt is updated to demand a decisive, non-hedgy
# write-up now that the opinion has survived cross-specialty review)
# =====================================================================

class TBReportAssembler:
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    CONFIDENCE_WEIGHTS = {
        "guideline_alignment":  0.35,
        "consensus_alignment":  0.30,
        "data_completeness":    0.20,
        "revision_consistency": 0.15,
    }

    async def assemble(self, state: TumorBoardState) -> TumorBoardState:
        llm = self.llm
        logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        logger.info("📋 [Agent 7 — ReportAssembler]: Starting")

        tb_input         = state["tb_input"]
        clinical_context = state.get("clinical_context") or ClinicalContext()
        doctor_opinion   = state.get("doctor_opinion") or DoctorOpinionDraft()
        mdt_consensus    = state.get("mdt_consensus") or MDTConsensusReport()
        validation       = state.get("validation_report") or ValidationReport()
        cross_notes      = state.get("cross_specialty_notes") or {}
        specialty_scope_guidance = _get_specialty_guidance(doctor_opinion.specialty)

        cb = doctor_opinion.confidence_breakdown
        raw_confidence = (
            cb.guideline_alignment    * self.CONFIDENCE_WEIGHTS["guideline_alignment"]
            + cb.consensus_alignment  * self.CONFIDENCE_WEIGHTS["consensus_alignment"]
            + cb.data_completeness    * self.CONFIDENCE_WEIGHTS["data_completeness"]
            + cb.revision_consistency * self.CONFIDENCE_WEIGHTS["revision_consistency"]
        )

        safety_modifier    = 0.5 + (validation.safety_score    * 0.5)
        guideline_modifier = 0.5 + (validation.guideline_score * 0.5)
        combined_modifier  = min(safety_modifier, guideline_modifier)
        final_confidence   = round(min(raw_confidence * combined_modifier, 1.0), 3)

        logger.info(
            f"   [Agent 7] Confidence computation:\n"
            f"             guideline_alignment   = {cb.guideline_alignment:.2f} × {self.CONFIDENCE_WEIGHTS['guideline_alignment']}\n"
            f"             consensus_alignment   = {cb.consensus_alignment:.2f} × {self.CONFIDENCE_WEIGHTS['consensus_alignment']} "
            f"(blended w/ cross-specialty panel)\n"
            f"             data_completeness     = {cb.data_completeness:.2f} × {self.CONFIDENCE_WEIGHTS['data_completeness']}\n"
            f"             revision_consistency  = {cb.revision_consistency:.2f} × {self.CONFIDENCE_WEIGHTS['revision_consistency']}\n"
            f"             raw_confidence        = {raw_confidence:.3f}\n"
            f"             safety_modifier       = {safety_modifier:.3f}\n"
            f"             guideline_modifier    = {guideline_modifier:.3f}\n"
            f"             final_confidence_score= {final_confidence:.3f}"
        )

        requires_urgent     = doctor_opinion.requires_urgent_mdt
        requires_genetics   = doctor_opinion.requires_genetic_counseling
        requires_palliative = doctor_opinion.requires_palliative_referral

        limiting_factors = []
        if cb.data_completeness < 0.5:
            limiting_factors.append(f"incomplete clinical data (completeness {cb.data_completeness:.0%})")
        if cb.guideline_alignment < 0.6:
            limiting_factors.append(f"partial guideline alignment ({cb.guideline_alignment:.0%})")
        if cb.consensus_alignment < 0.6:
            limiting_factors.append(f"limited specialist/panel consensus ({cb.consensus_alignment:.0%})")
        if validation.safety_score < 0.7:
            limiting_factors.append(f"safety concerns (score {validation.safety_score:.0%})")
        limiting_text = (
            f"Confidence is limited by: {', '.join(limiting_factors)}."
            if limiting_factors else
            "Cross-specialty review and audit found no major confidence-limiting factors — the plan is well-supported."
        )

        missing_additions_block = (
            chr(10).join(f"  + {a}" for a in validation.missing_workup_additions)
            if validation.missing_workup_additions else "  None"
        )

        panel_alignment_line = (
            f"Internal cross-specialty panel alignment: {cross_notes.get('cross_specialty_alignment', 0.0):.0%} "
            f"— {cross_notes.get('panel_summary', 'no material objections raised')}"
            if cross_notes else "Cross-specialty panel review not available for this run."
        )

        final_rec_prompt = f"""You are a {doctor_opinion.specialty.replace('_', ' ').title()} specialist signing off the final tumor board recommendation for this case.

You must synthesise ALL of the following into one authoritative clinical recommendation:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR SPECIALTY'S SCOPE (the final recommendation must stay in this lane):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{specialty_scope_guidance}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PATIENT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{tb_input.patient_age or 'Unknown'}-year-old {tb_input.patient_sex or 'unknown'}
Diagnosis      : {clinical_context.primary_diagnosis}
Formal stage   : {clinical_context.cancer_stage}
Inferred stage : {clinical_context.inferred_stage}
Performance    : {clinical_context.performance_status or 'Not assessed'}
Comorbidities  : {', '.join(clinical_context.comorbidities) or 'None'}
Cardiac        : {', '.join(clinical_context.cardiac_findings) or 'None'}
Imaging        : {'; '.join(clinical_context.imaging_summary) or 'None documented'}
Prior treatments: {', '.join(clinical_context.prior_treatments) or 'None'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR SPECIALIST POSITION (already cross-checked against medical oncology, surgical
oncology, radiation oncology, pathology, and palliative care perspectives):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{doctor_opinion.clinical_position}

Key actions you recommended:
{chr(10).join(f'  • {a}' for a in doctor_opinion.key_actions) or '  None'}

Concerns (including any raised by the cross-specialty panel):
{chr(10).join(f'  • {c}' for c in doctor_opinion.concerns_raised) or '  None'}

{panel_alignment_line}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MDT CONSENSUS ({mdt_consensus.consensus_status.value}):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{chr(10).join(f'  ✓ {a}' for a in mdt_consensus.agreed_actions) or '  None'}

Unresolved questions:
{chr(10).join(f'  ? {q}' for q in mdt_consensus.unresolved_questions) or '  None'}

MDT Chairperson summary:
{mdt_consensus.chairperson_summary}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SAFETY & GUIDELINE AUDIT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Safety score   : {validation.safety_score:.0%}
Guideline score: {validation.guideline_score:.0%}
Is safe        : {validation.is_safe}
Audit flags    : {'; '.join(validation.flags) or 'None'}
Auditor note   : {validation.auditor_note}
Missing workup additions from audit:
{missing_additions_block}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONFIDENCE: {final_confidence:.0%}
{limiting_text}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RULES FOR YOUR FINAL RECOMMENDATION:
- Write as the {doctor_opinion.specialty.replace('_', ' ').title()} specialist signing off.
- Every sentence must be something a {doctor_opinion.specialty.replace('_', ' ').title()}
  specialist would actually say and do, per YOUR SPECIALTY'S SCOPE defined above.
  Do NOT write as if you are personally deciding another specialty's treatment
  specifics — e.g. a surgeon should not dictate chemotherapy drug/dose or RT
  fractionation, a medical oncologist should not dictate the operative approach,
  a radiation oncologist should not dictate the systemic regimen. Where another
  specialty's input or action is needed, name it explicitly as a referral/next
  step for that specialty, not as your own clinical decision.
- Open with YOUR concrete specialty-specific procedural plan for this patient
  (e.g. Radiation Oncology: modality, intent, target/field, approximate
  dose/fractionation range; Medical Oncology: systemic strategy and sequencing;
  Surgical Oncology: operative approach and extent of resection) grounded in
  the actual clinical data above. Only AFTER stating that plan should you name
  prerequisite workup, consults, or optimization steps that must happen before
  it is executed. Do not let the recommendation become a list of prerequisite
  workup with no procedural plan ever named.
- This plan has ALREADY been stress-tested by a cross-specialty panel and audited for
  safety — write with the appropriate clinical confidence. Be DECISIVE about what to do.
  Only hedge on the SPECIFIC items that are genuinely still missing data (e.g. a pending
  biomarker or staging study) — do not generically hedge the whole recommendation.
- Avoid vague qualifiers like "may consider", "could potentially", "it might be reasonable
  to" for actions that the panel and audit have already endorsed. State the plan plainly:
  "Proceed with X", "Initiate Y", "Refer to Z".
- Synthesise ALL the above — your opinion + cross-specialty panel + MDT consensus + audit findings.
- Explicitly address cardiac findings and their impact on treatment if present.
- If missing workup additions were flagged by the auditor, include them as concrete next steps.
- If confidence < 70%, name the SPECIFIC limiting factor(s) rather than a generic disclaimer.
- If unresolved questions exist, name exactly what needs to happen to resolve them.
- Do NOT include the patient name — use "the patient" or demographics.
- Do NOT use bullet points or headers — flowing clinical prose only.
- 4-6 sentences. Be specific, actionable, and clinically precise.
- Return plain text only."""
        try:
            rec_response = llm.invoke([
                SystemMessage(content="Write a final, decisive tumor board recommendation as a specialist. Plain text only."),
                HumanMessage(content=final_rec_prompt),
            ])
            final_recommendation = rec_response.content.strip()
            logger.info(
                f"   [Agent 7] final_recommendation generated "
                f"({len(final_recommendation)} chars): "
                f"{final_recommendation[:150]}..."
            )
        except Exception as e:
            logger.error(f"❌ [Agent 7] final_recommendation generation failed: {e}")
            final_recommendation = doctor_opinion.optimal_recommendation or ""

        report_cb = ConfidenceBreakdown(
            guideline_alignment  = cb.guideline_alignment,
            consensus_alignment  = cb.consensus_alignment,
            data_completeness    = cb.data_completeness,
            revision_consistency = cb.revision_consistency,
        )

        def _strip_empty(ctx: ClinicalContext) -> ClinicalContext:
            return ClinicalContext(
                primary_diagnosis     = ctx.primary_diagnosis,
                cancer_stage          = ctx.cancer_stage,
                inferred_stage        = ctx.inferred_stage        or "",
                key_biomarkers        = ctx.key_biomarkers,
                critical_findings     = ctx.critical_findings     or [],
                comorbidities         = ctx.comorbidities         or [],
                cardiac_findings      = ctx.cardiac_findings      or [],
                urgent_concerns       = ctx.urgent_concerns       or [],
                pathology_summary     = ctx.pathology_summary     or [],
                clinical_summary_text = ctx.clinical_summary_text,
                prior_treatments      = ctx.prior_treatments      or [],
                current_medications   = ctx.current_medications   or [],
                metastatic_sites      = ctx.metastatic_sites      or [],
                imaging_summary       = ctx.imaging_summary       or [],
                performance_status    = ctx.performance_status    or "",
            )

        state["tumor_board_report"] = TumorBoardReport(
            patient_id            = tb_input.patient_id,
            patient_age           = tb_input.patient_age,
            patient_sex           = tb_input.patient_sex,
            requesting_specialty  = tb_input.requesting_specialty or "general_oncology",
            clinical_context      = _strip_empty(clinical_context),
            doctor_opinion        = doctor_opinion,
            mdt_consensus         = mdt_consensus,
            validation            = validation,
            final_recommendation  = final_recommendation,
            confidence_score      = final_confidence,
            confidence_breakdown  = report_cb,
            requires_urgent_mdt          = requires_urgent,
            requires_genetic_counseling  = requires_genetics,
            requires_palliative_referral = requires_palliative,
            warnings              = state.get("warnings", []),
        )

        logger.info(
            f"✅ [Agent 7] Report assembled "
            f"| confidence={final_confidence:.3f} "
            f"| urgent={requires_urgent} "
            f"| genetics={requires_genetics} "
            f"| palliative={requires_palliative}"
        )
        return state


# =====================================================================
# LANGGRAPH WORKFLOW  (graph fetch + cross-specialty review inserted)
# =====================================================================

def create_tumor_board_workflow(llm: ChatGroq) -> StateGraph:
    graph_agent       = PatientGraphRetrievalAgent()
    context_agent     = PatientContextExtractorAgent(llm)
    guideline_agent   = TBGuidelineRetrievalAgent()
    opinion_agent     = DoctorOpinionAgent(llm)
    cross_check_agent = CrossSpecialtyReviewAgent(llm)
    synthesis_agent   = MDTSynthesisAgent(llm)
    validation_agent  = TBValidationAgent(llm)
    assembler         = TBReportAssembler(llm)

    workflow = StateGraph(TumorBoardState)

    workflow.add_node("fetch_patient_graph",   graph_agent.retrieve_graph)
    workflow.add_node("extract_context",       context_agent.extract)
    workflow.add_node("retrieve_guidelines",   guideline_agent.retrieve)
    workflow.add_node("generate_opinion",      opinion_agent.generate_opinion)
    workflow.add_node("cross_specialty_check", cross_check_agent.cross_check)
    workflow.add_node("run_mdt_synthesis",     synthesis_agent.synthesize)
    workflow.add_node("validate",              validation_agent.validate)
    workflow.add_node("assemble",              assembler.assemble)

    workflow.set_entry_point("fetch_patient_graph")

    workflow.add_edge("fetch_patient_graph",   "extract_context")
    workflow.add_edge("extract_context",       "retrieve_guidelines")
    workflow.add_edge("retrieve_guidelines",   "generate_opinion")
    workflow.add_edge("generate_opinion",      "cross_specialty_check")
    workflow.add_edge("cross_specialty_check", "run_mdt_synthesis")
    workflow.add_edge("run_mdt_synthesis",     "validate")
    workflow.add_edge("validate",              "assemble")
    workflow.add_edge("assemble",              END)

    return workflow.compile()


# =====================================================================
# MAIN GENERATION FUNCTION
# =====================================================================

async def generate_tumor_board_report(
    tb_input:        TumorBoardInput,
    llm:             ChatGroq,
    patient_summary: Optional[Dict[str, Any]] = None,
) -> TumorBoardReport:

    logger.info(
        f"🚀 Tumor Board Generation | Patient={tb_input.patient_id} "
        f"| Doctor={tb_input.doctor_id}"
    )

    try:
        workflow = create_tumor_board_workflow(llm)

        initial_state: TumorBoardState = {
            "tb_input":             tb_input,
            "patient_summary":      patient_summary,
            "graph_documents":      [],
            "graph_timeline_text":  "",
            "clinical_context":     None,
            "guideline_context":    None,
            "doctor_opinion":       None,
            "cross_specialty_notes": None,
            "mdt_consensus":        None,
            "validation_report":    None,
            "tumor_board_report":   None,
            "doctor_guidelines":    [],
            "warnings":             [],
            "error":                None,
        }

        final_state = await workflow.ainvoke(initial_state)
        report      = final_state.get("tumor_board_report")
        if report:
            return report

        return TumorBoardReport(
            patient_id            = tb_input.patient_id,
            requesting_specialty  = tb_input.requesting_specialty or "general_oncology",
            final_recommendation  = "Tumor board report could not be generated — manual review required.",
            warnings              = ["Workflow failed to produce a report"],
        )

    except Exception as e:
        logger.error(f"❌ generate_tumor_board_report error: {e}\n{traceback.format_exc()}")
        raise


# =====================================================================
# HELPER — Age calculation
# =====================================================================

def calculate_age(dob_str: Optional[str]) -> Optional[int]:
    if not dob_str:
        return None
    try:
        if "T" in str(dob_str):
            dob = datetime.fromisoformat(str(dob_str).replace("Z", "+00:00"))
        elif "-" in str(dob_str):
            dob = datetime.strptime(str(dob_str), "%Y-%m-%d")
        else:
            return None
        today = datetime.now()
        age   = today.year - dob.year
        if today.month < dob.month or (
            today.month == dob.month and today.day < dob.day
        ):
            age -= 1
        return age
    except Exception as e:
        logger.error(f"Age calc error: {e}")
        return None


# =====================================================================
# GET ENDPOINT — Latest doctor recommendations  (unchanged)
# =====================================================================

@router.get("/latest_doctor_recommendations/{hospital_id}/{patient_id}")
async def get_latest_doctor_recommendations(hospital_id: str, patient_id: str):
    logger.info(
        f"📋 [GET] latest_doctor_recommendations "
        f"| collection=tumor_board_cases "
        f"| filter={{patient_id='{patient_id}', hospital_id='{hospital_id}'}}"
    )

    pipeline = [
        {"$match": {"patient_id": patient_id, "hospital_id": hospital_id}},
        {"$sort": {"created_at": -1}},
        {
            "$group": {
                "_id":                   "$doctor_id",
                "latest_recommendation": {"$first": "$$ROOT"},
            }
        },
        {
            "$project": {
                "_id":                   0,
                "doctor_id":             "$latest_recommendation.doctor_id",
                "patient_id":            "$latest_recommendation.patient_id",
                "hospital_id":           "$latest_recommendation.hospital_id",
                "speciality":            "$latest_recommendation.speciality",
                "doctor_recommendation": "$latest_recommendation.doctor_recommendation",
                "created_at":            "$latest_recommendation.created_at",
            }
        },
    ]

    result = await tumor_board_collection.aggregate(pipeline).to_list(length=None)

    logger.info(f"   [DB] tumor_board_cases aggregation result | unique doctors={len(result)}")

    if not result:
        raise HTTPException(
            status_code=404,
            detail="No recommendations found for this patient in this hospital",
        )

    for doc in result:
        doc["created_at"] = (
            doc["created_at"].isoformat()
            if isinstance(doc["created_at"], datetime)
            else doc["created_at"]
        )

    return JSONResponse(content={"data": result})


# =====================================================================
# FASTAPI ENDPOINT — Generate Tumor Board Recommendation
# =====================================================================

@router.post("/generate-tumor-board-recommendation")
async def generate_tumor_board_endpoint(
    request: dict = Body(...)
):
    """
    Generate a structured tumor board opinion.

    Request body:
      { "patient_id": "<required>", "doctor_id": "<required>", "hospital_id": "<optional>" }

    Agentic Pipeline v4.4:
      0. fetch_patient_graph  → Neo4j longitudinal history (NEW)
      1. extract_context      → ClinicalContext
      2. retrieve_guidelines  → GuidelineContext (MongoDB-only)
      3. generate_opinion     → DoctorOpinionDraft
      4. cross_specialty_check → internal panel review (NEW, no schema change)
      5. run_mdt_synthesis    → MDTConsensusReport
      6. validate             → ValidationReport
      7. assemble             → TumorBoardReport (schema unchanged)
    """
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    logger.info(f"📋 [POST] generate-tumor-board-recommendation")
    logger.info(f"   raw request: {json.dumps(request, indent=2)}")

    try:
        patient_id  = request.get("patient_id")
        doctor_id   = request.get("doctor_id")
        hospital_id = request.get("hospital_id")

        if not patient_id:
            raise HTTPException(status_code=400, detail="patient_id is required")
        if not doctor_id:
            raise HTTPException(status_code=400, detail="doctor_id is required")

        # ── STEP 1: Fetch patient data ────────────────────────────────
        logger.info(f"   [DB] collection=patient_users | filter={{patient_id: '{patient_id}'}}")
        patient_data = await patient_user_collection.find_one({"patient_id": patient_id})
        if not patient_data:
            patient_data = await patient_user_collection.find_one({"sys_user_id": patient_id})

        if not patient_data:
            logger.warning(
                f"   [DB] patient_users | NOT FOUND for id='{patient_id}' — proceeding with empty record"
            )
            patient_data = {"patient_id": patient_id}
        else:
            logger.info(
                f"   [DB] patient_users FOUND | _id={patient_data.get('_id')} "
                f"| dob={patient_data.get('date_of_birth')} | gender={patient_data.get('gender')}"
            )

        patient_age = calculate_age(patient_data.get("date_of_birth"))
        patient_sex = patient_data.get("gender")

        # ── STEP 2: Fetch doctor data ─────────────────────────────────
        logger.info(f"   [DB] collection=doctor_users | filter={{sys_user_id: '{doctor_id}'}}")
        doctor_data = await doctor_user_collection.find_one({"sys_user_id": doctor_id})
        if not doctor_data:
            doctor_data = await doctor_user_collection.find_one({"doctor_id": doctor_id})

        doctor_specialization = None
        doctor_sys_id         = doctor_id

        if doctor_data:
            doctor_specialization = (
                doctor_data.get("specialization") or doctor_data.get("specialty")
            )
            doctor_sys_id = (
                doctor_data.get("sys_user_id")
                or doctor_data.get("doctor_id")
                or doctor_id
            )
            logger.info(
                f"   [DB] doctor_users FOUND | specialty={doctor_specialization} | sys_user_id={doctor_sys_id}"
            )
        else:
            logger.warning(f"   [DB] doctor_users NOT FOUND for doctor_id='{doctor_id}'")

        # ── STEP 3: Fetch latest patient summary ──────────────────────
        patient_summary = None
        try:
            logger.info(
                f"   [DB] collection=patient_summary | filter={{patient_id: '{patient_id}'}} "
                f"| sort={{generated_at: -1}} | limit=1"
            )
            docs = (
                await summary_collection
                .find({"patient_id": patient_id})
                .sort("generated_at", -1)
                .limit(1)
                .to_list(1)
            )
            if docs:
                patient_summary        = docs[0]
                patient_summary["_id"] = str(patient_summary["_id"])
                logger.info(
                    f"   [DB] patient_summary FOUND | _id={patient_summary['_id']} "
                    f"| generated_at={patient_summary.get('generated_at')}"
                )
            else:
                logger.warning(f"   [DB] patient_summary NOT FOUND for patient_id='{patient_id}'")
        except Exception as e:
            logger.error(f"   [DB] patient_summary fetch error: {e}")

        # ── STEP 4: Fetch tumor_board_cases via aggregation ───────────
        prior_doctor_opinions:        List[PriorDoctorOpinion] = []
        current_doctor_prior_opinion: Optional[PriorDoctorOpinion] = None

        match_stage: Dict[str, Any] = {"patient_id": patient_id}
        if hospital_id:
            match_stage["hospital_id"] = hospital_id

        try:
            aggregation_pipeline = [
                {"$match": match_stage},
                {"$sort": {"created_at": -1}},
                {
                    "$group": {
                        "_id":                   "$doctor_id",
                        "latest_recommendation": {"$first": "$$ROOT"},
                    }
                },
                {
                    "$project": {
                        "_id":                   0,
                        "doctor_id":             "$latest_recommendation.doctor_id",
                        "patient_id":            "$latest_recommendation.patient_id",
                        "hospital_id":           "$latest_recommendation.hospital_id",
                        "speciality":            "$latest_recommendation.speciality",
                        "doctor_recommendation": "$latest_recommendation.doctor_recommendation",
                        "created_at":            "$latest_recommendation.created_at",
                    }
                },
            ]

            logger.info(
                f"   [DB] collection=tumor_board_cases | match_filter={json.dumps(match_stage, default=str)}"
            )

            tb_docs = await tumor_board_collection.aggregate(aggregation_pipeline).to_list(length=None)

            logger.info(f"   [DB] tumor_board_cases aggregation result | unique doctor records={len(tb_docs)}")

            for doc in tb_docs:
                raw_created_at = doc.get("created_at", "")
                created_at_str = (
                    raw_created_at.isoformat()
                    if isinstance(raw_created_at, datetime)
                    else str(raw_created_at)
                )
                doc_doctor_id = str(doc.get("doctor_id", ""))

                try:
                    opinion = PriorDoctorOpinion(
                        doctor_id             = doc_doctor_id,
                        specialty             = doc.get("speciality", "unknown"),
                        doctor_recommendation = doc.get("doctor_recommendation", ""),
                        created_at            = created_at_str,
                        is_current_doctor     = (doc_doctor_id == doctor_id),
                    )
                    if doc_doctor_id == doctor_id:
                        current_doctor_prior_opinion = opinion
                    else:
                        prior_doctor_opinions.append(opinion)
                except Exception as parse_err:
                    logger.warning(f"   [DB] Could not parse tumor_board_cases doc: {parse_err}")

            logger.info(
                f"   [DB] MDT opinions parsed: other_doctors={len(prior_doctor_opinions)} "
                f"| current_doctor_prior={'yes' if current_doctor_prior_opinion else 'none'}"
            )

        except Exception as tb_err:
            logger.error(f"   [DB] tumor_board_cases aggregation FAILED: {tb_err}")

        # ── STEP 5: Build TumorBoardInput ─────────────────────────────
        tb_input = TumorBoardInput(
            patient_id                   = patient_id,
            doctor_id                    = doctor_id,
            hospital_id                  = hospital_id,
            patient_age                  = patient_age,
            patient_sex                  = patient_sex,
            requesting_specialty         = doctor_specialization,
            doctor_sys_id                = doctor_sys_id,
            prior_doctor_opinions        = prior_doctor_opinions,
            current_doctor_prior_opinion = current_doctor_prior_opinion,
        )

        logger.info(
            f"   [INPUT] TumorBoardInput assembled | patient_age={patient_age} "
            f"| patient_sex={patient_sex} | specialty={doctor_specialization} "
            f"| other_opinions={len(prior_doctor_opinions)}"
        )

        # ── STEP 6: Run agentic pipeline ──────────────────────────────
        llm = ChatGroq(
            model        = "llama-3.3-70b-versatile",
            groq_api_key = GROQ_API_KEY,
            temperature  = 0.1,
        )

        report = await generate_tumor_board_report(
            tb_input        = tb_input,
            llm             = llm,
            patient_summary = patient_summary,
        )

        logger.info(
            f"✅ Tumor board complete | patient={patient_id} "
            f"| confidence={report.confidence_score:.3f} "
            f"| is_safe={report.validation.is_safe if report.validation else 'N/A'}"
        )
        logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

        return {
            "success":              True,
            "patient_id":           patient_id,
            "doctor_id":            doctor_id,
            "hospital_id":          hospital_id,
            "requesting_specialty": tb_input.requesting_specialty,
            "tumor_board_report":   report,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Tumor board generation error: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))