"""
followup_consultation_agent.py
===============================
Follow-Up Consultation Prep Agent for DoctorAssist — v1.0.0

Purpose
-------
Given (a) the patient's full longitudinal history (Neo4j graph, exactly like the
tumor-board pipeline) and (b) the NEW inputs the doctor provides for the upcoming
visit — current medications, investigations, the active treatment plan, and the
clinical note from the LAST consultation — this pipeline produces a structured,
specialty-aware "consultation prep pack": what to check, what to ask the patient,
what to examine, what red flags to screen for, and a decisive written brief the
doctor can read in 30 seconds before walking into the room.

The pipeline is DYNAMIC: a dedicated agent (Agent 2) looks at the requesting
specialty + the patient's actual condition/treatment and writes a bespoke set of
"directives" that steer every downstream agent's prompt. A medical-oncology
patient on cycle 4 FOLFOX gets neuropathy/myelosuppression-flavoured questions;
a cardiology patient on new beta-blockade gets orthostatic/HF-flavoured questions;
the same skeleton produces a different, relevant pack every time — this is what
"dynamic prompting" means in this file, as opposed to one static checklist.

Agentic Pipeline
----------------
  0. PatientGraphRetrievalAgent        — Pulls the full Neo4j entity graph for the
                                          patient (same "A to Z" timeline approach
                                          as the tumor board pipeline) so nothing
                                          in the patient's history is invisible to
                                          the extraction step.

  1. FollowUpContextExtractorAgent     — Reads patient_summary + graph timeline +
                                          the NEW payload (medications,
                                          investigations, treatment_plan,
                                          latest_clinical_note) and produces a
                                          structured FollowUpClinicalContext.

  2. SpecialtyDynamicPromptAgent       — THE dynamic-prompting agent. Looks at
                                          requesting_specialty + diagnosis +
                                          treatment_plan + known toxicities and
                                          writes a SpecialtyFocusPlan PLUS a raw
                                          "directive_block" of prompt text that is
                                          injected verbatim into every downstream
                                          agent's prompt. This is what makes the
                                          same pipeline behave differently for an
                                          oncologist vs a cardiologist vs an
                                          endocrinologist without hand-written
                                          per-specialty branches.

  3. TreatmentResponseAssessmentAgent  — Assesses whether the patient appears to
                                          be responding/stable/deteriorating using
                                          the investigations trend + interval
                                          history + treatment plan, steered by the
                                          specialty directives.

  4. RedFlagScreeningAgent             — Internal safety pass. Screens interval
                                          history, toxicities, cardiac findings and
                                          the response assessment for anything that
                                          should escalate urgency BEFORE the visit
                                          even happens (e.g. "call the patient
                                          today", not "ask at next visit").

  5. FollowUpQuestionAndChecklistAgent — Generates the actual consultation tools:
                                          categorised patient questions, physical
                                          exam items, vitals, investigations to
                                          review/order, and medication-adherence
                                          checks — all steered by the specialty
                                          directives and any red flags raised.

  6. ConsultationBriefAssembler        — Writes the final decisive, plain-prose
                                          consultation brief and assembles the
                                          FollowUpConsultationPlan Pydantic report.

Author: AI Architect
Version: 1.0.0
"""

import json
import traceback
from typing import Dict, Any, List, Optional, TypedDict
from datetime import datetime
from enum import Enum

from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from motor.motor_asyncio import AsyncIOMotorClient

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
    tags=["followup_consultation"],
    responses={404: {"description": "Not found"}},
)

# =====================================================================
# DB SETUP — MongoDB
# =====================================================================

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB  = "doctorassistai"

mongodb_client = AsyncIOMotorClient(MONGO_URI)
database       = mongodb_client[MONGO_DB]

summary_collection      = database["patient_summary"]
patient_user_collection = database["patient_users"]
doctor_user_collection  = database["doctor_users"]
followup_plan_collection = database["followup_consultation_plans"]

# =====================================================================
# DB SETUP — Neo4j (patient history only, same contract as tumor board)
# =====================================================================

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
NEO4J_URI    = os.getenv("NEO4J_URI", "bolt://neo4j:7687")
NEO4J_USER   = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASS   = os.getenv("NEO4J_PASSWORD", "password")

try:
    neo4j_driver = AsyncGraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASS))
    logger.info(f"🔗 [FollowUp] Neo4j driver initialised | uri={NEO4J_URI} | user={NEO4J_USER}")
except Exception as _neo4j_init_err:
    neo4j_driver = None
    logger.error(f"❌ [FollowUp] Neo4j driver initialisation failed: {_neo4j_init_err}")


async def close_neo4j_driver() -> None:
    if neo4j_driver is not None:
        await neo4j_driver.close()
        logger.info("🔌 [FollowUp] Neo4j driver closed")


# =====================================================================
# ENUMS
# =====================================================================

class ConsultationUrgency(str, Enum):
    ROUTINE  = "routine"    # proceed at the scheduled visit as planned
    PRIORITY = "priority"   # bring the visit forward / add extra workup first
    URGENT   = "urgent"     # contact patient / escalate before the scheduled visit


class TreatmentResponseStatus(str, Enum):
    RESPONDING     = "responding"
    STABLE         = "stable"
    MIXED          = "mixed"
    CONCERNING     = "concerning"
    INSUFFICIENT   = "insufficient_data"


# =====================================================================
# PYDANTIC SCHEMAS
# =====================================================================

class FollowUpClinicalContext(BaseModel):
    primary_diagnosis:         str = ""
    disease_status:            str = ""   # e.g. "on cycle 4 FOLFOX", "post-op surveillance"
    key_biomarkers:            Dict[str, Any] = Field(default_factory=dict)
    active_medications:        List[str] = Field(default_factory=list)
    recent_investigations:     List[str] = Field(default_factory=list)
    reported_vitals:           List[str] = Field(default_factory=list)
    treatment_plan_summary:    str = ""
    interval_history:          List[str] = Field(default_factory=list)  # events/symptoms since last visit
    comorbidities:             List[str] = Field(default_factory=list)
    cardiac_findings:          List[str] = Field(default_factory=list)
    known_toxicities:          List[str] = Field(default_factory=list)
    performance_status:        str = ""
    clinical_summary_text:     str = ""


class SpecialtyFocusPlan(BaseModel):
    specialty:               str = ""
    primary_focus_domains:   List[str] = Field(default_factory=list)
    monitoring_priorities:   List[str] = Field(default_factory=list)
    rationale:               str = ""


class TreatmentResponseAssessment(BaseModel):
    response_status: TreatmentResponseStatus = TreatmentResponseStatus.INSUFFICIENT
    evidence:        List[str] = Field(default_factory=list)
    concerns:        List[str] = Field(default_factory=list)


class RedFlagScreen(BaseModel):
    red_flags:          List[str] = Field(default_factory=list)
    urgency:            ConsultationUrgency = ConsultationUrgency.ROUTINE
    escalation_action:  str = ""


class SymptomCheckQuestion(BaseModel):
    category:            str  # e.g. "Neuropathy", "Cardiac", "Medication Adherence"
    question:            str
    clinical_rationale:  str


class ConsultationChecklist(BaseModel):
    vitals_to_check:              List[str] = Field(default_factory=list)
    physical_exam_items:          List[str] = Field(default_factory=list)
    investigations_to_review:     List[str] = Field(default_factory=list)
    investigations_to_order:      List[str] = Field(default_factory=list)
    medication_adherence_checks:  List[str] = Field(default_factory=list)


class FollowUpConsultationPlan(BaseModel):
    """Final report returned by the pipeline — this is the doctor-facing artifact."""
    patient_id:            str
    patient_age:           Optional[int] = None
    patient_sex:           Optional[str] = None
    requesting_specialty:  str = "general_practice"

    clinical_context:               Optional[FollowUpClinicalContext]     = None
    specialty_focus:                Optional[SpecialtyFocusPlan]          = None
    treatment_response_assessment:  Optional[TreatmentResponseAssessment] = None
    red_flag_screen:                Optional[RedFlagScreen]               = None
    symptom_check_questions:        List[SymptomCheckQuestion] = Field(default_factory=list)
    checklist:                      Optional[ConsultationChecklist] = None

    consultation_brief: str = ""
    urgency:             ConsultationUrgency = ConsultationUrgency.ROUTINE

    warnings: List[str] = Field(default_factory=list)


# =====================================================================
# INPUT / GRAPH STATE
# =====================================================================

class FollowUpConsultationInput(BaseModel):
    patient_id:            str
    doctor_id:             str
    hospital_id:           Optional[str] = None
    patient_age:           Optional[int] = None
    patient_sex:           Optional[str] = None
    requesting_specialty:  Optional[str] = None

    # ── the "new" inputs for THIS follow-up, supplied in the request payload ──
    # ── All of the following are OPTIONAL. Send whatever you actually have for
    # this visit — the extraction agent works with partial data and the rest of
    # the pipeline degrades gracefully (with a warning) when something is missing.
    current_medications:   List[str] = Field(default_factory=list)
    investigations:        List[str] = Field(default_factory=list)   # e.g. "CBC 12-Jun: WBC 2.1 (low)"
    treatment_plan:        str = ""
    latest_clinical_note:  str = ""
    vitals:                List[str] = Field(default_factory=list)   # e.g. "BP 130/85", "HR 88", "Temp 37.1C", "SpO2 98%", "Weight 72kg"


class FollowUpState(TypedDict):
    fu_input:                 FollowUpConsultationInput
    patient_summary:          Optional[Dict[str, Any]]
    graph_documents:          List[Dict[str, Any]]
    graph_timeline_text:      str
    clinical_context:         Optional[FollowUpClinicalContext]
    specialty_focus:          Optional[SpecialtyFocusPlan]
    dynamic_prompt_directives: str          # raw text injected into downstream prompts
    treatment_response:       Optional[TreatmentResponseAssessment]
    red_flag_screen:          Optional[RedFlagScreen]
    symptom_check_questions:  List[SymptomCheckQuestion]
    checklist:                Optional[ConsultationChecklist]
    consultation_plan:        Optional[FollowUpConsultationPlan]
    warnings:                 List[str]
    error:                    Optional[str]


# =====================================================================
# SHARED HELPERS
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


def _log_raw(label: str, doc: Any, max_chars: int = 600) -> None:
    try:
        raw = json.dumps(doc, indent=2, default=str)
        if len(raw) > max_chars:
            raw = raw[:max_chars] + f"\n  ... [truncated — full length {len(raw)} chars]"
        logger.debug(f"   [RAW — {label}]:\n{raw}")
    except Exception as log_err:
        logger.debug(f"   [RAW — {label}]: could not serialise — {log_err}")


# =====================================================================
# NEO4J — PATIENT GRAPH RETRIEVAL (same contract as tumor_board_agent.py)
# =====================================================================

async def fetch_patient_graph_documents(patient_id: str) -> List[Dict]:
    """Full longitudinal entity graph for the patient, ordered chronologically."""
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
    """Compress the raw graph into a readable chronological timeline, most-recent-kept."""
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
    truncated = full_text[-max_chars:]
    first_newline = truncated.find("\n")
    if first_newline != -1:
        truncated = truncated[first_newline + 1:]
    return f"[... earlier history truncated for length ...]\n{truncated}"


# =====================================================================
# AGENT 0 — PATIENT GRAPH RETRIEVAL
# =====================================================================

class PatientGraphRetrievalAgent:
    async def retrieve_graph(self, state: FollowUpState) -> FollowUpState:
        logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        logger.info("🕸️  [Agent 0 — PatientGraphRetrieval]: Starting")

        patient_id = state["fu_input"].patient_id
        graph_documents: List[Dict[str, Any]] = []
        try:
            graph_documents = await fetch_patient_graph_documents(patient_id)
        except Exception as e:
            logger.error(f"❌ [Agent 0] Unexpected error during graph fetch: {e}\n{traceback.format_exc()}")

        if not graph_documents:
            state["warnings"].append(
                "No patient knowledge-graph history available — plan based on payload + latest summary only"
            )

        timeline_text = _render_graph_timeline(graph_documents)
        state["graph_documents"]     = graph_documents
        state["graph_timeline_text"] = timeline_text

        logger.info(
            f"✅ [Agent 0] Graph retrieval complete | documents={len(graph_documents)} "
            f"| timeline_chars={len(timeline_text)}"
        )
        return state


# =====================================================================
# AGENT 1 — FOLLOW-UP CONTEXT EXTRACTOR
# =====================================================================

class FollowUpContextExtractorAgent:
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def extract(self, state: FollowUpState) -> FollowUpState:
        logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        logger.info("🔍 [Agent 1 — FollowUpContextExtractor]: Starting")

        fu_input             = state["fu_input"]
        patient_summary      = state.get("patient_summary") or {}
        graph_timeline_text  = state.get("graph_timeline_text") or ""

        clinical_summary_raw = ""
        if patient_summary:
            cs = patient_summary.get("clinical_summary", {})
            clinical_summary_raw = cs.get("raw_output", "") if isinstance(cs, dict) else (cs if isinstance(cs, str) else "")

        payload_block = {
            "current_medications":  fu_input.current_medications or "Not provided",
            "investigations":       fu_input.investigations or "Not provided",
            "treatment_plan":       fu_input.treatment_plan or "Not provided",
            "latest_clinical_note": fu_input.latest_clinical_note or "Not provided",
            "vitals":               fu_input.vitals or "Not provided",
        }

        agentic_context = {
            "historical_clinical_summary":    clinical_summary_raw,
            "neo4j_patient_graph_timeline":   graph_timeline_text or "No graph history available",
            "THIS_CONSULTATION_NEW_INPUTS":   payload_block,
        }
        context_json = json.dumps(agentic_context, indent=2, default=str)
        logger.info(f"   [Agent 1] context_json length sent to LLM: {len(context_json)} chars")

        prompt = f"""You are a senior clinician preparing the structured clinical picture ahead of a
patient's FOLLOW-UP consultation.

FULL PATIENT RECORD:
{context_json}

Patient Age: {fu_input.patient_age or 'Unknown'}
Patient Sex: {fu_input.patient_sex or 'Unknown'}
Requesting Specialty: {fu_input.requesting_specialty or 'General Practice'}

IMPORTANT:
- "neo4j_patient_graph_timeline" is the full longitudinal record (every document, lab,
  imaging study, medication, procedure, finding ever captured). Treat it as authoritative
  for anything not repeated in the historical summary.
- "THIS_CONSULTATION_NEW_INPUTS" is what the doctor is bringing to THIS visit — the
  current medication list, investigations ordered/reviewed since last time, the
  active treatment plan, the latest recorded vitals, and the free-text clinical
  note from the LAST consultation. This is your most important and most recent
  signal — weight it heavily, especially for interval_history (what has happened /
  changed since the last visit).
- ANY of these new inputs may be marked "Not provided" — this is expected and NOT
  an error. Fall back to the historical summary and graph timeline for that field,
  and do not fabricate a value just because the payload didn't supply one.

EXTRACTION RULES:
1. primary_diagnosis — full diagnosis (site/histology/subtype or equivalent for non-oncology).
2. disease_status — one line on where the patient currently is in their care pathway
   (e.g. "Cycle 4 of 6, FOLFOX, day 15", "6-month post-op surveillance", "Newly started
   on antihypertensive therapy").
3. key_biomarkers — any labs/markers relevant to monitoring THIS condition, pulled from
   both sources. Use "unknown" only if genuinely not documented anywhere.
4. active_medications — reconcile the payload's current_medications with anything in the
   graph/summary; flag any discrepancy inside interval_history rather than silently dropping it.
5. recent_investigations — investigations from the payload AND the graph timeline, most
   recent first, including the result/value where available.
6. reported_vitals — the vitals payload if provided (e.g. "BP 130/85", "HR 88", "SpO2 98%"),
   reconciled against any vitals found in the graph timeline. Empty list if none available
   anywhere — never invent numbers.
7. treatment_plan_summary — 1-2 sentence plain summary of the active treatment_plan text,
   or "Not documented" if not provided anywhere.
8. interval_history — concrete events/symptoms/changes since the last consultation, drawn
   primarily from latest_clinical_note but cross-checked against the graph timeline for
   anything the note omitted (e.g. an ED visit, a new lab drawn independently). If no
   clinical note or graph history is available, return an empty list rather than guessing.
9. comorbidities — non-primary-condition diagnoses.
10. cardiac_findings — any cardiac workup/findings from either source.
11. known_toxicities — documented side effects/adverse reactions to current or recent
    treatment (from clinical note or graph Finding/LabResult nodes).
12. performance_status — ECOG/Karnofsky/functional status if documented anywhere, else
    "Not assessed".
13. clinical_summary_text — 3-4 sentence narrative: who the patient is, where they are in
    their care pathway, what's changed since last visit, and anything urgent-sounding. No name.

Return ONLY this JSON — no preamble, no markdown fences:
{{
  "primary_diagnosis": "...",
  "disease_status": "...",
  "key_biomarkers": {{ "<marker>": "<result or unknown>" }},
  "active_medications": ["..."],
  "reported_vitals": ["..."],
  "recent_investigations": ["... — result/date"],
  "treatment_plan_summary": "...",
  "interval_history": ["Concrete event/symptom since last visit"],
  "comorbidities": ["..."],
  "cardiac_findings": ["..."],
  "known_toxicities": ["..."],
  "performance_status": "...",
  "clinical_summary_text": "..."
}}"""

        try:
            response = self.llm.invoke([
                SystemMessage(content="Extract structured follow-up clinical context. Return only JSON."),
                HumanMessage(content=prompt),
            ])
            result = _parse_json(response.content)

            ctx = FollowUpClinicalContext(
                primary_diagnosis      = result.get("primary_diagnosis", "Pending review"),
                disease_status         = result.get("disease_status", ""),
                key_biomarkers         = result.get("key_biomarkers", {}),
                active_medications     = result.get("active_medications", fu_input.current_medications),
                recent_investigations  = result.get("recent_investigations", fu_input.investigations),
                reported_vitals        = result.get("reported_vitals", fu_input.vitals),
                treatment_plan_summary = result.get("treatment_plan_summary", (fu_input.treatment_plan or "Not documented")[:280]),
                interval_history       = result.get("interval_history", []),
                comorbidities          = result.get("comorbidities", []),
                cardiac_findings       = result.get("cardiac_findings", []),
                known_toxicities       = result.get("known_toxicities", []),
                performance_status     = result.get("performance_status", "Not assessed"),
                clinical_summary_text  = result.get("clinical_summary_text", ""),
            )
            state["clinical_context"] = ctx

            logger.info(f"✅ [Agent 1] Diagnosis        : {ctx.primary_diagnosis}")
            logger.info(f"   [Agent 1] Disease status   : {ctx.disease_status}")
            logger.info(f"   [Agent 1] Interval history : {ctx.interval_history}")
            logger.info(f"   [Agent 1] Known toxicities : {ctx.known_toxicities}")
            logger.info(f"   [Agent 1] Cardiac findings : {ctx.cardiac_findings}")

        except Exception as e:
            logger.error(f"❌ [Agent 1] Context extraction failed: {e}\n{traceback.format_exc()}")
            state["clinical_context"] = FollowUpClinicalContext(
                clinical_summary_text="Context extraction failed — manual review required.",
                active_medications=fu_input.current_medications,
                recent_investigations=fu_input.investigations,
                reported_vitals=fu_input.vitals,
                treatment_plan_summary=(fu_input.treatment_plan or "Not documented")[:280],
            )
            state["warnings"].append("Follow-up context extraction incomplete — review manually")

        return state


# =====================================================================
# AGENT 2 — SPECIALTY DYNAMIC PROMPT AGENT  (the "dynamic prompting" agent)
# =====================================================================

class SpecialtyDynamicPromptAgent:
    """
    Looks at requesting_specialty + the extracted clinical context and produces:
      (a) a structured SpecialtyFocusPlan (exposed in the final report)
      (b) a raw `directive_block` string of prompt text that gets injected verbatim
          into Agents 3, 4 and 5's prompts below.

    This is the mechanism that makes the SAME graph produce oncology-flavoured,
    cardiology-flavoured, or endocrinology-flavoured output without hand-written
    per-specialty branches anywhere else in the code.
    """

    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def build_directives(self, state: FollowUpState) -> FollowUpState:
        logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        logger.info("🧭 [Agent 2 — SpecialtyDynamicPrompt]: Starting")

        fu_input  = state["fu_input"]
        ctx       = state.get("clinical_context") or FollowUpClinicalContext()
        specialty = fu_input.requesting_specialty or "general_practice"

        prompt = f"""You are designing a bespoke follow-up-visit strategy for a
{specialty.replace('_', ' ').title()} specialist seeing this specific patient.

PATIENT PICTURE:
Diagnosis        : {ctx.primary_diagnosis}
Disease status   : {ctx.disease_status}
Treatment plan   : {ctx.treatment_plan_summary}
Active meds      : {', '.join(ctx.active_medications) or 'None documented'}
Known toxicities : {', '.join(ctx.known_toxicities) or 'None documented'}
Comorbidities    : {', '.join(ctx.comorbidities) or 'None documented'}
Cardiac findings : {', '.join(ctx.cardiac_findings) or 'None documented'}
Interval history : {', '.join(ctx.interval_history) or 'None reported'}

YOUR TASK:
Decide what THIS specialty, for THIS exact patient and treatment, must prioritise
at this follow-up. Do not give a generic checklist for the diagnosis in the
abstract — tailor it to the specific drugs/treatment/status above (e.g. a platinum
agent implies ototoxicity/nephrotoxicity/neuropathy screening; an ACE inhibitor
implies renal function and potassium; anticoagulation implies bleeding/INR checks).

Produce:
- primary_focus_domains: 3-6 short domain labels (e.g. "Peripheral neuropathy",
  "Myelosuppression", "Cardiotoxicity", "Medication adherence").
- monitoring_priorities: 3-6 concrete, specific things to monitor tied to the actual
  drugs/treatment/status above (not generic "monitor for side effects").
- rationale: 1-2 sentences on WHY these are the priorities for this patient right now.
- directive_block: a short paragraph of direct instructions (imperative voice) that
  will be injected into other AI agents' prompts to steer their output toward this
  patient's actual situation. Be concrete and specific to the drugs/treatment/status
  above — this is the most important field.

Return ONLY this JSON:
{{
  "primary_focus_domains": ["..."],
  "monitoring_priorities": ["..."],
  "rationale": "...",
  "directive_block": "..."
}}"""

        directive_block = (
            f"Prioritise the standard monitoring appropriate for {ctx.primary_diagnosis or 'this condition'} "
            f"under {specialty.replace('_', ' ')} care."
        )
        try:
            response = self.llm.invoke([
                SystemMessage(content="Design a bespoke, drug/status-specific follow-up strategy. Return only JSON."),
                HumanMessage(content=prompt),
            ])
            result = _parse_json(response.content)

            focus_plan = SpecialtyFocusPlan(
                specialty              = specialty,
                primary_focus_domains  = result.get("primary_focus_domains", []),
                monitoring_priorities  = result.get("monitoring_priorities", []),
                rationale              = result.get("rationale", ""),
            )
            directive_block = result.get("directive_block", directive_block)

            state["specialty_focus"] = focus_plan
            state["dynamic_prompt_directives"] = directive_block

            logger.info(f"✅ [Agent 2] Focus domains   : {focus_plan.primary_focus_domains}")
            logger.info(f"   [Agent 2] Monitoring      : {focus_plan.monitoring_priorities}")
            logger.info(f"   [Agent 2] Directive block : {directive_block[:200]}...")

        except Exception as e:
            logger.error(f"❌ [Agent 2] Dynamic prompt build failed: {e}\n{traceback.format_exc()}")
            state["specialty_focus"] = SpecialtyFocusPlan(specialty=specialty)
            state["dynamic_prompt_directives"] = directive_block
            state["warnings"].append("Specialty-specific strategy could not be generated — using generic focus")

        return state


# =====================================================================
# AGENT 3 — TREATMENT RESPONSE ASSESSMENT
# =====================================================================

class TreatmentResponseAssessmentAgent:
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def assess(self, state: FollowUpState) -> FollowUpState:
        logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        logger.info("📈 [Agent 3 — TreatmentResponseAssessment]: Starting")

        ctx        = state.get("clinical_context") or FollowUpClinicalContext()
        directives = state.get("dynamic_prompt_directives") or ""

        prompt = f"""You are assessing treatment response ahead of a follow-up visit.

SPECIALTY DIRECTIVES FOR THIS PATIENT:
{directives}

CLINICAL PICTURE:
Diagnosis            : {ctx.primary_diagnosis}
Disease status       : {ctx.disease_status}
Treatment plan       : {ctx.treatment_plan_summary}
Recent investigations: {chr(10).join(f'  • {i}' for i in ctx.recent_investigations) or '  None documented'}
Reported vitals      : {', '.join(ctx.reported_vitals) or 'None documented'}
Interval history     : {chr(10).join(f'  • {h}' for h in ctx.interval_history) or '  None reported'}
Known toxicities     : {', '.join(ctx.known_toxicities) or 'None documented'}

Assess whether the available evidence suggests the patient is responding, stable,
mixed, or concerning — or whether there simply isn't enough data yet to say.
Be evidence-driven: cite the specific investigation/history item behind each
conclusion, don't assert response status without a concrete basis.

Return ONLY this JSON:
{{
  "response_status": "responding|stable|mixed|concerning|insufficient_data",
  "evidence": ["Specific data point supporting this status"],
  "concerns": ["Specific concern, if any — else empty list"]
}}"""

        try:
            response = self.llm.invoke([
                SystemMessage(content="Assess treatment response from evidence. Return only JSON."),
                HumanMessage(content=prompt),
            ])
            result = _parse_json(response.content)

            try:
                status = TreatmentResponseStatus(result.get("response_status", "insufficient_data"))
            except ValueError:
                status = TreatmentResponseStatus.INSUFFICIENT

            assessment = TreatmentResponseAssessment(
                response_status = status,
                evidence         = result.get("evidence", []),
                concerns         = result.get("concerns", []),
            )
            state["treatment_response"] = assessment
            logger.info(f"✅ [Agent 3] Response status: {status.value} | concerns={assessment.concerns}")

        except Exception as e:
            logger.error(f"❌ [Agent 3] Response assessment failed: {e}\n{traceback.format_exc()}")
            state["treatment_response"] = TreatmentResponseAssessment()
            state["warnings"].append("Treatment response assessment incomplete — review manually")

        return state


# =====================================================================
# AGENT 4 — RED FLAG SCREENING  (internal safety pass)
# =====================================================================

class RedFlagScreeningAgent:
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def screen(self, state: FollowUpState) -> FollowUpState:
        logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        logger.info("🚨 [Agent 4 — RedFlagScreening]: Starting")

        ctx        = state.get("clinical_context") or FollowUpClinicalContext()
        response   = state.get("treatment_response") or TreatmentResponseAssessment()
        directives = state.get("dynamic_prompt_directives") or ""

        prompt = f"""You are screening for anything that should change the URGENCY of this
follow-up BEFORE it happens — i.e. something that means the patient should be
contacted or seen sooner than the scheduled visit, not just discussed at it.

SPECIALTY DIRECTIVES FOR THIS PATIENT:
{directives}

CLINICAL PICTURE:
Diagnosis          : {ctx.primary_diagnosis}
Interval history   : {chr(10).join(f'  • {h}' for h in ctx.interval_history) or '  None reported'}
Known toxicities   : {', '.join(ctx.known_toxicities) or 'None documented'}
Cardiac findings   : {', '.join(ctx.cardiac_findings) or 'None documented'}
Treatment response : {response.response_status.value} — concerns: {', '.join(response.concerns) or 'None'}

RULES:
- Only flag things that are genuinely time-sensitive (e.g. signs of neutropenic
  sepsis, unexplained chest pain, severe uncontrolled symptoms, a critical lab
  value implied by the history). Do NOT flag routine, expected, or already-managed
  findings — over-flagging is as harmful as under-flagging.
- urgency = "urgent" only if the patient may need contact/assessment before the
  scheduled visit. "priority" if the visit itself should be brought forward or
  extended but there's no same-day risk. "routine" otherwise.
- escalation_action: if urgency is not "routine", state the SPECIFIC action
  (e.g. "Call patient today to assess for febrile neutropenia given fever + cycle 4
  chemo timing"). Empty string if routine.

Return ONLY this JSON:
{{
  "red_flags": ["Specific red flag, if any"],
  "urgency": "routine|priority|urgent",
  "escalation_action": "..."
}}"""

        try:
            response_msg = self.llm.invoke([
                SystemMessage(content="Screen for time-sensitive red flags only. Return only JSON."),
                HumanMessage(content=prompt),
            ])
            result = _parse_json(response_msg.content)

            try:
                urgency = ConsultationUrgency(result.get("urgency", "routine"))
            except ValueError:
                urgency = ConsultationUrgency.ROUTINE

            screen = RedFlagScreen(
                red_flags         = result.get("red_flags", []),
                urgency           = urgency,
                escalation_action = result.get("escalation_action", ""),
            )
            state["red_flag_screen"] = screen

            if urgency != ConsultationUrgency.ROUTINE:
                state["warnings"].append(f"[{urgency.value.upper()}] {screen.escalation_action}")

            logger.info(f"✅ [Agent 4] Urgency={urgency.value} | red_flags={screen.red_flags}")

        except Exception as e:
            logger.error(f"❌ [Agent 4] Red flag screening failed: {e}\n{traceback.format_exc()}")
            state["red_flag_screen"] = RedFlagScreen()
            state["warnings"].append("Red flag screening could not be completed — review manually")

        return state


# =====================================================================
# AGENT 5 — FOLLOW-UP QUESTION AND CHECKLIST AGENT
# =====================================================================

class FollowUpQuestionAndChecklistAgent:
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def generate(self, state: FollowUpState) -> FollowUpState:
        logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        logger.info("📝 [Agent 5 — FollowUpQuestionAndChecklist]: Starting")

        ctx        = state.get("clinical_context") or FollowUpClinicalContext()
        focus      = state.get("specialty_focus") or SpecialtyFocusPlan()
        red_flags  = state.get("red_flag_screen") or RedFlagScreen()
        directives = state.get("dynamic_prompt_directives") or ""

        prompt = f"""You are preparing the concrete tools a clinician will use DURING a
follow-up consultation: the questions to ask the patient, and the checklist to
work through.

SPECIALTY DIRECTIVES FOR THIS PATIENT:
{directives}

FOCUS DOMAINS FOR THIS VISIT: {', '.join(focus.primary_focus_domains) or 'General review'}
MONITORING PRIORITIES: {', '.join(focus.monitoring_priorities) or 'None specified'}
RED FLAGS ALREADY IDENTIFIED: {', '.join(red_flags.red_flags) or 'None'}

CLINICAL PICTURE:
Diagnosis         : {ctx.primary_diagnosis}
Treatment plan     : {ctx.treatment_plan_summary}
Active medications : {', '.join(ctx.active_medications) or 'None documented'}
Known toxicities   : {', '.join(ctx.known_toxicities) or 'None documented'}
Comorbidities      : {', '.join(ctx.comorbidities) or 'None documented'}
Vitals already on file for this visit: {', '.join(ctx.reported_vitals) or 'None provided yet'}

YOUR TASK:
1. symptom_check_questions — 6-10 SPECIFIC questions to ask the patient, each tagged
   with a category (tie categories to the focus domains above where possible: e.g.
   "Neuropathy", "Cardiac", "Medication Adherence", "Functional Status", "Mental Health")
   and a one-line clinical_rationale for why it matters for THIS patient. Ask about
   symptoms in patient-friendly language, not jargon (the question is FOR the patient).
2. checklist.vitals_to_check — specific vitals relevant to the treatment/condition. If
   vitals are already provided above, list only the ones still worth re-checking or
   trending (don't just repeat what's already on file); if none are on file, list the
   full set that should be taken at this visit.
3. checklist.physical_exam_items — specific exam manoeuvres/areas relevant to the
   toxicity/condition profile above (not a generic head-to-toe exam).
4. checklist.investigations_to_review — investigations already available that must be
   looked at during this visit.
5. checklist.investigations_to_order — NEW investigations that should be ordered at or
   before this visit given the treatment/status (only if genuinely indicated).
6. checklist.medication_adherence_checks — specific adherence/safety checks for the
   active medications (e.g. interactions, correct dosing given renal function, missed
   doses given side-effect profile).

RULES:
- Never invent a medication, investigation, or condition not implied by the context above.
- Do not repeat the same content across questions and checklist items — they serve
  different purposes (asking the patient vs. what the clinician does).

Return ONLY this JSON:
{{
  "symptom_check_questions": [
    {{"category": "...", "question": "...", "clinical_rationale": "..."}}
  ],
  "checklist": {{
    "vitals_to_check": ["..."],
    "physical_exam_items": ["..."],
    "investigations_to_review": ["..."],
    "investigations_to_order": ["..."],
    "medication_adherence_checks": ["..."]
  }}
}}"""

        try:
            response = self.llm.invoke([
                SystemMessage(content="Generate specific, non-generic follow-up questions and checklist. Return only JSON."),
                HumanMessage(content=prompt),
            ])
            result = _parse_json(response.content)

            questions = [
                SymptomCheckQuestion(
                    category            = q.get("category", "General"),
                    question            = q.get("question", ""),
                    clinical_rationale  = q.get("clinical_rationale", ""),
                )
                for q in (result.get("symptom_check_questions") or [])
                if q.get("question")
            ]

            checklist_raw = result.get("checklist", {})
            checklist = ConsultationChecklist(
                vitals_to_check              = checklist_raw.get("vitals_to_check", []),
                physical_exam_items          = checklist_raw.get("physical_exam_items", []),
                investigations_to_review     = checklist_raw.get("investigations_to_review", []),
                investigations_to_order      = checklist_raw.get("investigations_to_order", []),
                medication_adherence_checks  = checklist_raw.get("medication_adherence_checks", []),
            )

            state["symptom_check_questions"] = questions
            state["checklist"] = checklist

            logger.info(f"✅ [Agent 5] Questions generated: {len(questions)}")
            logger.info(f"   [Agent 5] Investigations to order: {checklist.investigations_to_order}")

        except Exception as e:
            logger.error(f"❌ [Agent 5] Question/checklist generation failed: {e}\n{traceback.format_exc()}")
            state["symptom_check_questions"] = []
            state["checklist"] = ConsultationChecklist()
            state["warnings"].append("Question/checklist generation incomplete — review manually")

        return state


# =====================================================================
# AGENT 6 — CONSULTATION BRIEF ASSEMBLER
# =====================================================================

class ConsultationBriefAssembler:
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def assemble(self, state: FollowUpState) -> FollowUpState:
        logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        logger.info("📋 [Agent 6 — ConsultationBriefAssembler]: Starting")

        fu_input   = state["fu_input"]
        ctx        = state.get("clinical_context") or FollowUpClinicalContext()
        focus      = state.get("specialty_focus") or SpecialtyFocusPlan()
        response   = state.get("treatment_response") or TreatmentResponseAssessment()
        red_flags  = state.get("red_flag_screen") or RedFlagScreen()
        questions  = state.get("symptom_check_questions") or []
        checklist  = state.get("checklist") or ConsultationChecklist()

        prompt = f"""You are the {fu_input.requesting_specialty or 'attending'} physician writing a
2-minute pre-visit brief for yourself ahead of this follow-up consultation.

PATIENT: {fu_input.patient_age or 'Unknown'}-year-old {fu_input.patient_sex or 'unknown'}
Diagnosis        : {ctx.primary_diagnosis}
Disease status   : {ctx.disease_status}
Treatment plan   : {ctx.treatment_plan_summary}
Interval history : {', '.join(ctx.interval_history) or 'None reported'}

Treatment response assessment : {response.response_status.value} — {', '.join(response.evidence) or 'limited evidence'}
Concerns from response review  : {', '.join(response.concerns) or 'None'}

Visit focus domains: {', '.join(focus.primary_focus_domains) or 'General review'}
Rationale          : {focus.rationale}

Red flag screen: urgency={red_flags.urgency.value} | flags={', '.join(red_flags.red_flags) or 'None'}
{('Escalation needed: ' + red_flags.escalation_action) if red_flags.escalation_action else ''}

Top questions to ask ({len(questions)} total, showing categories): {', '.join(sorted(set(q.category for q in questions))) or 'None'}
Key checklist items: vitals={len(checklist.vitals_to_check)}, exam={len(checklist.physical_exam_items)}, investigations to order={len(checklist.investigations_to_order)}

RULES:
- Write 4-6 sentences of flowing clinical prose, no bullet points or headers.
- Be decisive: say what to focus on and why, not "consider checking on..." for
  things the workup above already establishes as necessary.
- If urgency is not routine, open with that and state the specific action needed.
- Reference the treatment response status and the single most important focus domain.
- Do not include the patient's name — use "the patient".
- Return plain text only, no JSON."""

        try:
            resp = self.llm.invoke([
                SystemMessage(content="Write a decisive pre-visit clinical brief. Plain text only."),
                HumanMessage(content=prompt),
            ])
            brief = resp.content.strip()
        except Exception as e:
            logger.error(f"❌ [Agent 6] Brief generation failed: {e}")
            brief = "Pre-visit brief could not be generated — review the structured sections manually."

        state["consultation_plan"] = FollowUpConsultationPlan(
            patient_id            = fu_input.patient_id,
            patient_age           = fu_input.patient_age,
            patient_sex           = fu_input.patient_sex,
            requesting_specialty  = fu_input.requesting_specialty or "general_practice",
            clinical_context               = ctx,
            specialty_focus                = focus,
            treatment_response_assessment  = response,
            red_flag_screen                = red_flags,
            symptom_check_questions        = questions,
            checklist                      = checklist,
            consultation_brief             = brief,
            urgency                        = red_flags.urgency,
            warnings                       = state.get("warnings", []),
        )

        logger.info(f"✅ [Agent 6] Consultation plan assembled | urgency={red_flags.urgency.value}")
        return state


# =====================================================================
# LANGGRAPH WORKFLOW
# =====================================================================

def create_followup_workflow(llm: ChatGroq) -> StateGraph:
    graph_agent      = PatientGraphRetrievalAgent()
    context_agent    = FollowUpContextExtractorAgent(llm)
    dynamic_agent    = SpecialtyDynamicPromptAgent(llm)
    response_agent   = TreatmentResponseAssessmentAgent(llm)
    redflag_agent    = RedFlagScreeningAgent(llm)
    checklist_agent  = FollowUpQuestionAndChecklistAgent(llm)
    assembler        = ConsultationBriefAssembler(llm)

    workflow = StateGraph(FollowUpState)

    workflow.add_node("fetch_patient_graph",      graph_agent.retrieve_graph)
    workflow.add_node("extract_context",          context_agent.extract)
    workflow.add_node("build_dynamic_directives",  dynamic_agent.build_directives)
    workflow.add_node("assess_treatment_response", response_agent.assess)
    workflow.add_node("screen_red_flags",          redflag_agent.screen)
    workflow.add_node("generate_questions",        checklist_agent.generate)
    workflow.add_node("assemble_brief",            assembler.assemble)

    workflow.set_entry_point("fetch_patient_graph")

    workflow.add_edge("fetch_patient_graph",      "extract_context")
    workflow.add_edge("extract_context",          "build_dynamic_directives")
    workflow.add_edge("build_dynamic_directives", "assess_treatment_response")
    workflow.add_edge("assess_treatment_response", "screen_red_flags")
    workflow.add_edge("screen_red_flags",          "generate_questions")
    workflow.add_edge("generate_questions",        "assemble_brief")
    workflow.add_edge("assemble_brief",            END)

    return workflow.compile()


# =====================================================================
# MAIN GENERATION FUNCTION
# =====================================================================

async def generate_followup_consultation_plan(
    fu_input:        FollowUpConsultationInput,
    llm:             ChatGroq,
    patient_summary: Optional[Dict[str, Any]] = None,
) -> FollowUpConsultationPlan:

    logger.info(
        f"🚀 Follow-Up Consultation Generation | Patient={fu_input.patient_id} "
        f"| Doctor={fu_input.doctor_id}"
    )

    try:
        workflow = create_followup_workflow(llm)

        initial_state: FollowUpState = {
            "fu_input":                  fu_input,
            "patient_summary":           patient_summary,
            "graph_documents":           [],
            "graph_timeline_text":       "",
            "clinical_context":          None,
            "specialty_focus":           None,
            "dynamic_prompt_directives": "",
            "treatment_response":        None,
            "red_flag_screen":           None,
            "symptom_check_questions":   [],
            "checklist":                 None,
            "consultation_plan":         None,
            "warnings":                  [],
            "error":                     None,
        }

        final_state = await workflow.ainvoke(initial_state)
        plan = final_state.get("consultation_plan")
        if plan:
            return plan

        return FollowUpConsultationPlan(
            patient_id            = fu_input.patient_id,
            requesting_specialty  = fu_input.requesting_specialty or "general_practice",
            consultation_brief    = "Follow-up plan could not be generated — manual review required.",
            warnings              = ["Workflow failed to produce a plan"],
        )

    except Exception as e:
        logger.error(f"❌ generate_followup_consultation_plan error: {e}\n{traceback.format_exc()}")
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
        age = today.year - dob.year
        if today.month < dob.month or (today.month == dob.month and today.day < dob.day):
            age -= 1
        return age
    except Exception as e:
        logger.error(f"Age calc error: {e}")
        return None


# =====================================================================
# FASTAPI ENDPOINT — Generate Follow-Up Consultation Plan
# =====================================================================

@router.post("/generate-followup-consultation-plan")
async def generate_followup_consultation_endpoint(request: dict = Body(...)):
    """
    Generate a structured, specialty-aware follow-up consultation prep pack.

    Request body — only patient_id and doctor_id are required, everything else is
    optional and the pipeline degrades gracefully (with a warning) if it's missing:
      {
        "patient_id": "<required>",
        "doctor_id": "<required>",
        "current_medications": ["Metformin 500mg BD", ...],           // optional
        "investigations": ["CBC 12-Jun-2026: WBC 2.1 (low), Hb 10.2"],// optional
        "treatment_plan": "FOLFOX, cycle 4 of 6, day 15 review",      // optional
        "latest_clinical_note": "<free text of the last consultation note>", // optional
        "vitals": ["BP 130/85", "HR 88", "Temp 37.1C", "SpO2 98%"]    // optional
      }

    Agentic Pipeline:
      0. fetch_patient_graph        → Neo4j longitudinal history
      1. extract_context            → FollowUpClinicalContext (history + new payload)
      2. build_dynamic_directives   → specialty- and condition-specific prompt strategy
      3. assess_treatment_response  → responding / stable / concerning / insufficient data
      4. screen_red_flags           → pre-visit urgency screen
      5. generate_questions         → patient questions + clinician checklist
      6. assemble_brief             → final FollowUpConsultationPlan + written brief
    """
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    logger.info("📋 [POST] generate-followup-consultation-plan")
    logger.info(f"   raw request: {json.dumps(request, indent=2, default=str)}")

    try:
        patient_id  = request.get("patient_id")
        doctor_id   = request.get("doctor_id")
        hospital_id = request.get("hospital_id")

        if not patient_id:
            raise HTTPException(status_code=400, detail="patient_id is required")
        if not doctor_id:
            raise HTTPException(status_code=400, detail="doctor_id is required")

        # ── STEP 1: Fetch patient data ────────────────────────────────
        patient_data = await patient_user_collection.find_one({"patient_id": patient_id})
        if not patient_data:
            patient_data = await patient_user_collection.find_one({"sys_user_id": patient_id})
        if not patient_data:
            logger.warning(f"   [DB] patient_users NOT FOUND for id='{patient_id}' — proceeding with empty record")
            patient_data = {"patient_id": patient_id}

        patient_age = calculate_age(patient_data.get("date_of_birth"))
        patient_sex = patient_data.get("gender")

        # ── STEP 2: Fetch doctor data ─────────────────────────────────
        doctor_data = await doctor_user_collection.find_one({"sys_user_id": doctor_id})
        if not doctor_data:
            doctor_data = await doctor_user_collection.find_one({"doctor_id": doctor_id})

        doctor_specialization = None
        if doctor_data:
            doctor_specialization = doctor_data.get("specialization") or doctor_data.get("specialty")
            logger.info(f"   [DB] doctor_users FOUND | specialty={doctor_specialization}")
        else:
            logger.warning(f"   [DB] doctor_users NOT FOUND for doctor_id='{doctor_id}'")

        # ── STEP 3: Fetch latest patient summary ──────────────────────
        patient_summary = None
        try:
            docs = (
                await summary_collection
                .find({"patient_id": patient_id})
                .sort("generated_at", -1)
                .limit(1)
                .to_list(1)
            )
            if docs:
                patient_summary = docs[0]
                patient_summary["_id"] = str(patient_summary["_id"])
            else:
                logger.warning(f"   [DB] patient_summary NOT FOUND for patient_id='{patient_id}'")
        except Exception as e:
            logger.error(f"   [DB] patient_summary fetch error: {e}")

        # ── STEP 4: Build FollowUpConsultationInput from payload ──────
        fu_input = FollowUpConsultationInput(
            patient_id             = patient_id,
            doctor_id              = doctor_id,
            hospital_id            = hospital_id,
            patient_age            = patient_age,
            patient_sex            = patient_sex,
            requesting_specialty   = doctor_specialization,
            current_medications    = request.get("current_medications", []) or [],
            investigations         = request.get("investigations", []) or [],
            treatment_plan         = request.get("treatment_plan", "") or "",
            latest_clinical_note   = request.get("latest_clinical_note", "") or "",
            vitals                 = request.get("vitals", []) or [],
        )

        logger.info(
            f"   [INPUT] FollowUpConsultationInput assembled | specialty={doctor_specialization} "
            f"| meds={len(fu_input.current_medications)} | investigations={len(fu_input.investigations)} "
            f"| vitals={len(fu_input.vitals)} | has_note={bool(fu_input.latest_clinical_note)} "
            f"| has_treatment_plan={bool(fu_input.treatment_plan)}"
        )

        # ── STEP 5: Run agentic pipeline ──────────────────────────────
        llm = ChatGroq(
            model        = "llama-3.3-70b-versatile",
            groq_api_key = GROQ_API_KEY,
            temperature  = 0.1,
        )

        plan = await generate_followup_consultation_plan(
            fu_input        = fu_input,
            llm             = llm,
            patient_summary = patient_summary,
        )

        # ── STEP 6: Persist for the doctor's record (best-effort) ─────
        try:
            await followup_plan_collection.insert_one({
                "patient_id":  patient_id,
                "doctor_id":   doctor_id,
                "hospital_id": hospital_id,
                "generated_at": datetime.utcnow(),
                "plan": plan.model_dump(mode="json"),
            })
        except Exception as persist_err:
            logger.warning(f"   [DB] Could not persist follow-up plan: {persist_err}")

        logger.info(
            f"✅ Follow-up consultation plan complete | patient={patient_id} "
            f"| urgency={plan.urgency.value}"
        )
        logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

        return {
            "success":              True,
            "patient_id":           patient_id,
            "doctor_id":            doctor_id,
            "hospital_id":          hospital_id,
            "requesting_specialty": fu_input.requesting_specialty,
            "followup_consultation_plan": plan,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Follow-up consultation generation error: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))