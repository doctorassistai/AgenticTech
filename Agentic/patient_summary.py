from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional, Dict, Any, List, TypedDict, AsyncIterator
from datetime import datetime, timedelta
import sys
import json
import re
import asyncio

# Motor and MongoDB
from motor.motor_asyncio import AsyncIOMotorClient

# LangChain and LangGraph
from langgraph.graph import StateGraph, END
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage

# Logging
from loguru import logger

# Environment
import os
from dotenv import load_dotenv

# Neo4j
from neo4j.time import DateTime as Neo4jDateTime
from neo4j.time import Date as Neo4jDate
from neo4j.time import Duration as Neo4jDuration

# Local imports
from Agentic.Rag.graph_rag_system import graph_rag_system

# =====================================================================
# UTILITY FUNCTIONS
# =====================================================================

def safe_json(data):
    """Safely JSON-serialize objects (handles datetime, ObjectId, etc.)"""
    return json.dumps(data, indent=2, default=str)

def serialize_documents(docs):
    """Convert LangChain Documents to JSON-safe dicts"""
    if not docs:
        return []
    return [
        {
            "content": doc.page_content,
            "metadata": doc.metadata
        }
        for doc in docs
        if hasattr(doc, "page_content")
    ]

def sanitize_for_response(obj):
    """Sanitize Neo4j types for JSON response"""
    if isinstance(obj, (Neo4jDateTime, Neo4jDate)):
        return obj.isoformat()
    if isinstance(obj, Neo4jDuration):
        return str(obj)
    if isinstance(obj, dict):
        return {k: sanitize_for_response(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_for_response(v) for v in obj]
    return obj

# =====================================================================
# ROUTER SETUP
# =====================================================================

router = APIRouter(tags=["Agentic"])

# =====================================================================
# DATABASE CONFIGURATION
# =====================================================================

STORAGE_BASE_URL = os.getenv("STORAGE_BASE_URL")
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

client = AsyncIOMotorClient(MONGO_URI)
db = client[MONGO_DB]

# Collections
document_categories_collection = db["document_categories"]
procedure_notes_collection = db["procedure_notes"]
conversation_user_collection = db["conversation_user"]
dictation_collection = db["dictation"]
documentation_treatment_plan_collection = db["documentation-treatment-plan"]
documentation_investigation_notes_collection = db["documentation-investigation-notes"]
documentation_medication_analysis_collection = db["documentation-medication-analysis"]
patient_vitals_collection = db["patient_vitals"]
summary_collection = db["patient_summary"]
dictation_collection = db["dictation"]
processing_tracker = db["processing_tracker"]
# Laboratory collections


# User collections
doctor_user_collection = db["doctor_users"]
patient_user_collection = db["patient_users"]

# EventDB and other collections


# =====================================================================
# LLM CONFIGURATION
# =====================================================================

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

if not GROQ_API_KEY:
    raise RuntimeError("GROQ_API_KEY is not set")

llm = ChatGroq(
    model="llama-3.1-8b-instant",
    groq_api_key=GROQ_API_KEY,
    temperature=0.2,
    max_tokens=4000
)
from neo4j import AsyncGraphDatabase

neo4j_uri = os.getenv("NEO4J_URI", "bolt://neo4j:7687")
neo4j_user = os.getenv("NEO4J_USER", "neo4j")
neo4j_password = os.getenv("NEO4J_PASSWORD", "password")



neo4j_driver = AsyncGraphDatabase.driver(
    neo4j_uri,
    auth=(neo4j_user, neo4j_password)
)
# =====================================================================
# PYDANTIC MODELS
# =====================================================================

class ClinicalReasoningRequest(BaseModel):
    patient_id: str
    doctor_id: str
    consultation_text: str

class EnhancedClinicalReasoningResponse(BaseModel):
    status: str
    patient_medical_history: Optional[Dict[str, Any]] = None
    current_medical_condition: Optional[Dict[str, Any]] = None
    disease_causation: Optional[Dict[str, Any]] = None
    staging: Optional[Dict[str, Any]] = None
    prognosis: Optional[Dict[str, Any]] = None
    risk_stratification: Optional[Dict[str, Any]] = None
    treatment_validation: Optional[Dict[str, Any]] = None
    contraindications: Optional[Dict[str, Any]] = None
    final_recommendation: Optional[Dict[str, Any]] = None
    enriched_context: Optional[Dict[str, Any]] = None
    rag_insights: Optional[Dict[str, Any]] = None
    advanced_treatment_intelligence: Optional[Dict[str, Any]] = None
    differential_diagnosis: Optional[Dict[str, Any]] = None
    medication_reconciliation: Optional[Dict[str, Any]] = None
    guideline_compliance: Optional[Dict[str, Any]] = None
    clinical_deterioration_warning: Optional[Dict[str, Any]] = None
    diagnostic_test_appropriateness: Optional[Dict[str, Any]] = None
    comorbidity_interaction: Optional[Dict[str, Any]] = None
    discharge_readiness: Optional[Dict[str, Any]] = None
    longitudinal_story: Optional[Dict[str, Any]] = None
    patient_summary: Optional[Dict[str, Any]] = None
    confidence_scores: Dict[str, float]
    warnings: list
    requires_review: bool
    timestamp: str
    error: Optional[str] = None

# =====================================================================
# STATE DEFINITION
# =====================================================================

class ClinicalReasoningState(TypedDict):
    """Enhanced state with RAG context and medical history agents"""
    # Input
    patient_id: str
    doctor_id: str
    consultation_text: str
    medical_context: Dict[str, Any]
    clinical_context: Dict[str, Any]
    longitudinal_context: Dict[str, Any]
    
    # NEW: Medical History Agents
    patient_medical_history: Optional[Dict[str, Any]]
    current_medical_condition: Optional[Dict[str, Any]]
    medical_history_processing_complete: bool
    current_condition_processing_complete: bool
    
    # RAG Context
    rag_context: Optional[Dict[str, Any]]
    relevant_documents: Optional[List[Any]]
    graph_relationships: Optional[Dict[str, Any]]
    temporal_trends: Optional[Dict[str, Any]]
    advanced_treatment_intelligence: Optional[Dict[str, Any]]
    
    # Processing
    disease_causation: Optional[Dict[str, Any]]
    staging_analysis: Optional[Dict[str, Any]]
    prognosis_factors: Optional[Dict[str, Any]]
    risk_stratification: Optional[Dict[str, Any]]
    treatment_validation: Optional[Dict[str, Any]]
    contraindication_check: Optional[Dict[str, Any]]
    outcome_prediction: Optional[Dict[str, Any]]
    
    # Output
    final_recommendation: Optional[Dict[str, Any]]
    confidence_scores: Dict[str, float]
    warnings: List[str]
    requires_review: bool
    error: Optional[str]

    # Additional agents
    differential_diagnosis: Optional[Dict[str, Any]]
    medication_reconciliation: Optional[Dict[str, Any]]
    guideline_compliance: Optional[Dict[str, Any]]
    clinical_deterioration_warning: Optional[Dict[str, Any]]
    diagnostic_test_appropriateness: Optional[Dict[str, Any]]
    comorbidity_interaction: Optional[Dict[str, Any]]
    discharge_readiness: Optional[Dict[str, Any]]
    patient_summary: Optional[Dict[str, Any]]
    longitudinal_story: Optional[Dict[str, Any]]

# =====================================================================
# BATCH RECORD FETCHER UTILITY
# =====================================================================


def repair_json(content: str):

    # remove markdown
    content = re.sub(r"```json|```", "", content).strip()

    # extract json block
    match = re.search(r"\{.*\}", content, re.DOTALL)
    if match:
        content = match.group(0)

    # remove trailing commas
    content = re.sub(r",\s*([\]}])", r"\1", content)

    # fix missing commas between objects
    content = re.sub(r'"\s*\n\s*"', '",\n"', content)

    return content


def merge_dict_lists(old, new):
    for key, value in new.items():
        if isinstance(value, list):
            old.setdefault(key, [])
            old[key].extend(value)
        else:
            old[key] = value
    return old
def convert_graph_records(records):

    formatted = []

    for r in records:

        formatted.append({
            "_id": r.get("document", "graph_record"),
            "collection_name": r.get("type", "graph_entity"),
            "report_date": r.get("date"),
            "content": r.get("name"),
            "evidence": r.get("evidence"),
            "document": r.get("document"),
            "type": r.get("type")
        })

    return formatted
######Thomas####
async def fetch_patient_graph_documents(patient_id: str):

    query = """
    MATCH (p:Patient {patient_id:$patient_id})-[r]->(n)
  
    OPTIONAL MATCH (n)-[:SUPPORTED_BY_EVIDENCE]->(e:Evidence)

    WITH 
        e.document_name AS document,
        toString(e.document_date) AS document_date,
        collect({
            relation: type(r),
            entity_type: labels(n)[0],
            name: coalesce(
                n.name,
                n.description,
                n.drug_name,
                n.test_name,
                n.vital_type,
                n.value
            ),
            date: toString(e.document_date),
            evidence: e.evidence_text
        }) AS entities

    WITH collect({
        document: document,
        document_date: document_date,
        entities: entities
    }) AS documents

    RETURN documents
    """

    async with neo4j_driver.session() as session:

        result = await session.run(query, patient_id=patient_id)

        record = await result.single()

        if not record:
            return []

        return record["documents"]

async def fetch_patient_graph_data(patient_id: str):

    query = """
    MATCH (p:Patient {patient_id:$patient_id})

    OPTIONAL MATCH (p)-[:HAS_DIAGNOSIS]->(d:Diagnosis)-[:SUPPORTED_BY_EVIDENCE]->(ed:Evidence)
    OPTIONAL MATCH (p)-[:HAS_SYMPTOM]->(s:Symptom)-[:SUPPORTED_BY_EVIDENCE]->(es:Evidence)
    OPTIONAL MATCH (p)-[:TAKES_MEDICATION]->(m:Medication)-[:SUPPORTED_BY_EVIDENCE]->(em:Evidence)
    OPTIONAL MATCH (p)-[:HAS_LAB_RESULT]->(l:LabResult)-[:SUPPORTED_BY_EVIDENCE]->(el:Evidence)
    OPTIONAL MATCH (p)-[:HAS_VITAL_SIGN]->(v:VitalSign)-[:SUPPORTED_BY_EVIDENCE]->(ev:Evidence)

    OPTIONAL MATCH (p)-[:HAS_FINDING]->(f:Finding)-[:SUPPORTED_BY_EVIDENCE]->(ef:Evidence)
    OPTIONAL MATCH (p)-[:HAS_ANATOMY]->(a:Anatomy)-[:SUPPORTED_BY_EVIDENCE]->(ea:Evidence)
    OPTIONAL MATCH (p)-[:HAS_PROCEDURE]->(pr:Procedure)-[:SUPPORTED_BY_EVIDENCE]->(ep:Evidence)
    OPTIONAL MATCH (p)-[:HAS_MEASUREMENT]->(me:Measurement)-[:SUPPORTED_BY_EVIDENCE]->(eme:Evidence)

    RETURN
    collect(DISTINCT {
        type: "Diagnosis",
        name: d.name,
        date: d.diagnosis_date,
        evidence: ed.evidence_text,
        document: ed.document_name
    }) +

    collect(DISTINCT {
        type: "Symptom",
        name: s.name,
        date: s.onset_date,
        evidence: es.evidence_text,
        document: es.document_name
    }) +

    collect(DISTINCT {
        type: "Medication",
        name: m.drug_name,
        date: m.start_date,
        evidence: em.evidence_text,
        document: em.document_name
    }) +

    collect(DISTINCT {
        type: "LabResult",
        name: l.test_name,
        date: l.test_date,
        evidence: el.evidence_text,
        document: el.document_name
    }) +

    collect(DISTINCT {
        type: "VitalSign",
        name: v.vital_type,
        date: v.measurement_date,
        evidence: ev.evidence_text,
        document: ev.document_name
    }) +

    collect(DISTINCT {
        type: "Finding",
        name: f.description,
        date: f.observed_on,
        evidence: ef.evidence_text,
        document: ef.document_name
    }) +

    collect(DISTINCT {
        type: "Anatomy",
        name: a.name,
        date: a.observed_on,
        evidence: ea.evidence_text,
        document: ea.document_name
    }) +

    collect(DISTINCT {
        type: "Procedure",
        name: pr.name,
        date: pr.recommended_on,
        evidence: ep.evidence_text,
        document: ep.document_name
    }) +

    collect(DISTINCT {
        type: "Measurement",
        name: me.value,
        date: me.recorded_on,
        evidence: eme.evidence_text,
        document: eme.document_name
    }) AS patient_report
    """

    async with neo4j_driver.session() as session:

        result = await session.run(query, patient_id=patient_id)

        record = await result.single()

        return record["patient_report"] if record else []



async def fetch_records_in_batches(
    patient_id: str,
    collections: List,
    cutoff_date: datetime,
    comparison: str,
    batch_size: int = 50
) -> AsyncIterator[List[Dict[str, Any]]]:

    """
    Fetch records from multiple collections in batches.

    Rules:
    - patient_vitals → use sys_user_id = patient_id
    - other collections → use patient_id = patient_id
    """

    logger.info(f"Fetching records for patient_id={patient_id}")

    for collection in collections:

        try:

            logger.info(f"📂 Processing collection: {collection.name}")

            # ======================================================
            # VITALS COLLECTION
            # ======================================================
            if collection.name == "patient_vitals":

                query = {"sys_user_id": patient_id}

                count = await collection.count_documents(query)

                logger.info(f"🩺 Vitals documents found: {count}")

                if count == 0:
                    logger.warning(f"No vitals records for patient {patient_id}")
                    continue

                cursor = collection.find(query)

                batch = []

                async for doc in cursor:

                    logger.info(f"Vitals doc found | _id={doc['_id']}")

                    # -----------------------------
                    # Nested vitals structure
                    # -----------------------------
                    if "vitals" in doc and isinstance(doc["vitals"], dict):

                        for timestamp, vitals_data in doc["vitals"].items():

                            try:
                                timestamp_clean = timestamp.replace("_", ".").replace("Z", "")
                                record_date = datetime.fromisoformat(timestamp_clean)

                            except Exception:
                                logger.warning(f"Timestamp parse failed: {timestamp}")
                                record_date = doc.get("updated_at")

                            if record_date:

                                if comparison == ">" and record_date >= cutoff_date:
                                    continue

                                if comparison == "<=" and record_date < cutoff_date:
                                    continue

                            record = {
                                "_id": str(doc["_id"]),
                                "collection_name": "patient_vitals",
                                "report_date": record_date,
                                **vitals_data
                            }

                            batch.append(record)

                            if len(batch) >= batch_size:
                                logger.info(f"Yielding vitals batch size={len(batch)}")
                                yield batch
                                batch = []

                    # -----------------------------
                    # Flat schema fallback
                    # -----------------------------
                    else:

                        record_date = (
                            doc.get("created_at")
                            or doc.get("updated_at")
                            or datetime.utcnow()
                        )

                        if record_date:

                            if comparison == ">" and record_date >= cutoff_date:
                                continue

                            if comparison == "<=" and record_date < cutoff_date:
                                continue

                        record = {
                            "_id": str(doc["_id"]),
                            "collection_name": "patient_vitals",
                            "report_date": record_date
                        }

                        for key, value in doc.items():

                            if key in [
                                "_id",
                                "sys_user_id",
                                "created_at",
                                "updated_at"
                            ]:
                                continue

                            record[key] = value

                        batch.append(record)

                        if len(batch) >= batch_size:
                            logger.info(f"Yielding vitals batch size={len(batch)}")
                            yield batch
                            batch = []

                if batch:
                    logger.info(f"Yielding final vitals batch size={len(batch)}")
                    yield batch

                continue

            # ======================================================
            # OTHER COLLECTIONS
            # ======================================================

            if comparison == ">":
                date_filter = {"$lt": cutoff_date}
            else:
                date_filter = {"$gte": cutoff_date}

            query = {
                "patient_id": patient_id,
                "$or": [
                    {"created_at": date_filter},
                    {"report_date": date_filter},
                    {"updated_at": date_filter}
                ]
            }

            count = await collection.count_documents(query)

            logger.info(
                f"{collection.name} records found for patient {patient_id}: {count}"
            )

            if count == 0:
                logger.warning(f"No records in {collection.name}")
                continue

            cursor = (
                collection.find(query)
                .sort("created_at", -1)
                .limit(batch_size)
            )

            batch = []

            async for doc in cursor:

                doc["_id"] = str(doc["_id"])
                doc["collection_name"] = collection.name

                batch.append(doc)

                if len(batch) >= batch_size:

                    logger.info(
                        f"Yielding batch | collection={collection.name} size={len(batch)}"
                    )

                    yield batch
                    batch = []

            if batch:
                logger.info(
                    f"Yielding final batch | collection={collection.name} size={len(batch)}"
                )
                yield batch

        except Exception as e:

            logger.error(
                f"Batch fetch error | collection={collection.name} | error={e}"
            )
# =====================================================================
# NEW AGENT 1: PATIENT MEDICAL HISTORY AGENT (>1 YEAR)
# =====================================================================

class PatientMedicalHistoryAgent:
    """
    Processes medical records older than 1 year.
    Iterates through batches to build comprehensive history abstract.
    """
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
        self.batch_size = 50
    
    async def analyze(self, state: ClinicalReasoningState) -> ClinicalReasoningState:
        """Process historical records in batches"""
        
        logger.info("📚 Patient Medical History Agent: Starting analysis")
        
        patient_id = state["patient_id"]
        cutoff_date = datetime.utcnow() - timedelta(days=365)  # 1 year ago
        
        # Initialize running abstract
        running_abstract = {
            "major_diagnoses": [],
            "past_surgeries": [],
            "past_procedures": [],
            "treatment_history": [],
            "lab_trends": [],
            "imaging_findings": [],
            "vitals_history": [],
            "resolved_conditions": [],
            "medical_events_timeline": [],
            "correlations": []
        }
        
        # Collections to process (only historical data)
        collections = [
        
            procedure_notes_collection,
            documentation_treatment_plan_collection,
            documentation_investigation_notes_collection,
            conversation_user_collection,
            patient_vitals_collection,
            document_categories_collection,
            dictation_collection
        ]
        
        batch_count = 0
        
        try:
            # Process records in batches
            documents = await fetch_patient_graph_documents(patient_id)

            for doc in documents:

                document_name = doc["document"]
                batch = doc["entities"]

                logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
                logger.info(f"📄 Processing document: {document_name}")
                logger.info(f"📊 Entities count: {len(batch)}")

                try:

                    running_abstract = await self._process_batch(batch, running_abstract)

                    logger.info("✅ Document processed successfully")

                except Exception as e:

                    logger.error(f"❌ Document processing failed: {e}")
            
            # Generate final structured summary
            final_summary = await self._generate_final_summary(running_abstract)
            
            state["patient_medical_history"] = final_summary
            state["medical_history_processing_complete"] = True
            
            logger.info(f"✅ Medical History Agent: Processed {batch_count} batches")
        
        except Exception as e:
            logger.error(f"❌ Medical History Agent failed: {e}")
            state["patient_medical_history"] = {
                "summary_text": "Medical history processing incomplete",
                "error": str(e)
            }
            state["medical_history_processing_complete"] = False
        
        return state
    
    async def _process_batch(
        self,
        batch: List[Dict[str, Any]],
        running_abstract: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Process one batch and update running abstract"""
        
        # Format batch for LLM
        batch_summary = self._format_batch_for_llm(batch)
        logger.info(f"medical_batch:{batch_summary}")
        
        prompt = f"""
You are a STRICT clinical information extraction system reviewing historical medical records older than 1 year.

Your job is to extract ONLY factual information explicitly written in the records.

You MUST NOT infer diagnoses or use outside medical knowledge.

--------------------------------------------------
SOURCE DATA
--------------------------------------------------

CURRENT ABSTRACT:
{json.dumps(running_abstract, indent=2, default=str)}

NEW RECORDS:
{batch_summary}

--------------------------------------------------
DIAGNOSIS EXTRACTION RULE
--------------------------------------------------

Extract ONLY disease names.

Do NOT include staging, grade, TNM, severity, or classification in the diagnosis text.

Example:

Record:
"Invasive carcinoma of no special type, Grade 2"

Correct extraction:

diagnosis: "Invasive carcinoma of no special type"

--------------------------------------------------
TIMELINE EXTRACTION RULE
--------------------------------------------------

Create timeline events when a record contains BOTH:

• a clinical event
• a date

Examples of events:

• diagnosis
• biopsy
• imaging study
• surgery
• procedure
• treatment start

Example:

Record:
[2025-12-08] Procedure: Trucut biopsy

Output:

{{
 "date": "2025-12-08",
 "event": "Trucut biopsy performed"
}}

--------------------------------------------------
EVIDENCE RULE
--------------------------------------------------

Every extracted item MUST include evidence text copied exactly from the records.

If evidence cannot be found DO NOT include the item.

--------------------------------------------------
STRICT SAFETY RULES
--------------------------------------------------

• Use ONLY the provided records
• NEVER infer diseases
• NEVER generate medications not written
• NEVER generate lab values not written
• NEVER guess missing information

If information is missing return [].

--------------------------------------------------
OUTPUT FORMAT
--------------------------------------------------

Return ONLY valid JSON:

{{
 "major_diagnoses":[{{"diagnosis":"string","evidence":"string"}}],

 "past_surgeries":[
  {{"procedure":"string","date":"string","evidence":"string"}}
 ],

 "past_procedures":[
  {{"procedure":"string","date":"string","evidence":"string"}}
 ],

 "treatment_history":[
  {{"treatment":"string","evidence":"string"}}
 ],

 "lab_trends":[
  {{"trend":"string","evidence":"string"}}
 ],

 "imaging_findings":[
  {{"finding":"string","evidence":"string"}}
 ],

 "vitals_history":[
  {{"vital":"string","value":"string","date":"string","evidence":"string"}}
 ],

 "resolved_conditions":[
  {{"condition":"string","evidence":"string"}}
 ],

 "medical_events_timeline":[
  {{"date":"string","event":"string","evidence":"string"}}
 ],

 "correlations":[]
}}

Return ONLY JSON.
"""
        
        try:
            response = await self.llm.ainvoke([
                SystemMessage(content="You are a physician extracting and correlating medical history. Return only valid JSON."),
                HumanMessage(content=prompt)
            ])
            
            content = repair_json(response.content)

            # remove markdown
            content = re.sub(r"```json|```", "", content).strip()

            # extract json block
            json_match = re.search(r"\{.*\}", content, re.DOTALL)

            if json_match:
                content = json_match.group(0)

            # remove trailing commas
            content = re.sub(r",\s*([\]}])", r"\1", content)

            try:
                updated_abstract = json.loads(content)
            except json.JSONDecodeError as e:
                logger.error(f"JSON parse failed: {e}")
                return running_abstract

            running_abstract = merge_dict_lists(running_abstract, updated_abstract)

            return running_abstract

        except Exception as e:
            logger.error(f"Batch processing failed: {e}")
            return running_abstract
    
    
    
    def _format_batch_for_llm(self, batch):

        formatted = []

        for entity in batch:

            entity_type = entity.get("entity_type") or entity.get("type")
            name = entity.get("name")
            evidence = entity.get("evidence")
            date = entity.get("date")

            formatted.append(
                f"[{date}] {entity_type}: {name} | Evidence: {evidence}"
            )

        return "\n".join(formatted)
    
    
    
    def _extract_report_findings(self, record: Dict[str, Any]) -> str:

        if "processed_data" in record and record["processed_data"]:
            structured = record["processed_data"][0].get("structured_data", {})
            return json.dumps(structured, default=str)

        return "No key findings"
    
    
    def _extract_vital_signs(self, record: Dict[str, Any]) -> str:
        """Extract all vitals dynamically"""

        ignore = {
            "_id",
            "collection_name",
            "report_date",
            "created_at",
            "updated_at"
        }

        vitals = []

        for key, value in record.items():

            if key in ignore:
                continue

            if value is None:
                continue

            vitals.append(f"{key}: {value}")

        return ", ".join(vitals) if vitals else "No vitals"
    def _extract_lab_values(self, record: Dict[str, Any]) -> str:
        """Extract key lab values"""
        values = []
        if "test_results" in record:
            for test in record["test_results"][:5]:  # Limit to 5
                name = test.get("test_name", "")
                value = test.get("value", "")
                unit = test.get("unit", "")
                values.append(f"{name}: {value} {unit}")
        return ", ".join(values) if values else "No values"
    
    def _extract_imaging_findings(self, record: Dict[str, Any]) -> str:
        """Extract imaging summary"""
        impression = record.get("impression", "")
        findings = record.get("findings", "")
        return impression or findings[:200] or "No findings"
    
    def _extract_treatment_info(self, record: Dict[str, Any]) -> str:
        """Extract treatment summary"""
        if "medications" in record:
            meds = [m.get("name", "") for m in record["medications"][:3]]
            return f"Medications: {', '.join(meds)}"
        return str(record.get("content", ""))[:200]
    
    async def _generate_final_summary(
        self,
        running_abstract: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Generate final human-readable summary from abstract"""
        
        prompt = f"""
You are a clinical summarization system generating the patient's historical medical history (>1 year).

Use ONLY the provided structured data.

Do NOT add medical information not present in the input.

--------------------------------------------------
INPUT DATA
--------------------------------------------------

{json.dumps(running_abstract, indent=2, default=str)}

--------------------------------------------------
TASK
--------------------------------------------------

Generate a structured summary describing the patient's past medical history.

Include:

• major diagnoses
• surgical history
• procedures
• treatment history
• imaging findings
• vitals history
• correlations
• timeline of events

--------------------------------------------------
TIMELINE RULE
--------------------------------------------------

Timeline events must be chronological.

Example:

{{
 "date": "2025-12-08",
 "event": "Trucut biopsy performed"
}}

--------------------------------------------------
OUTPUT FORMAT
--------------------------------------------------

Return JSON:

{{
 "summary_text":"brief clinical overview",

 "major_diagnoses":[],

 "past_surgeries":[],

 "significant_procedures":[],

 "treatment_progressions":[],

 "lab_trajectory":[],

 "imaging_summary":[],

 "vitals_history":[],

 "resolved_issues":[],

 "key_correlations":[],

 "timeline_highlights":[
  {{"date":"string","event":"string"}}
 ],

 "character_count":0,

 "medical_complexity_score":"low | moderate | high"
}}

Return ONLY JSON.
"""
        
        try:
            response = await self.llm.ainvoke([
                SystemMessage(content="Generate final medical history summary. Return only valid JSON."),
                HumanMessage(content=prompt)
            ])
            
            content = repair_json(response.content)
            if "```json" in content:
                content = content.split("```json", 1)[1].split("```", 1)[0]
            
            summary = json.loads(content)
            summary["character_count"] = len(json.dumps(summary))
            
            return summary
            
        except Exception as e:
            logger.error(f"Final summary generation failed: {e}")
            return {
                "summary_text": "Medical history processing incomplete",
                "error": str(e),
                "raw_abstract": running_abstract
            }

# =====================================================================
# NEW AGENT 2: CURRENT MEDICAL CONDITION AGENT (≤1 YEAR)
# =====================================================================

class CurrentMedicalConditionAgent:
    """
    Processes medical records from the last 1 year.
    Iterates through batches to build current condition abstract.
    """
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
        self.batch_size = 50
    
    async def analyze(self, state: ClinicalReasoningState) -> ClinicalReasoningState:
        """Process recent records in batches"""
        
        logger.info("🩺 Current Medical Condition Agent: Starting analysis")
        
        patient_id = state["patient_id"]
        cutoff_date = datetime.utcnow() - timedelta(days=365)
        
        # Initialize running abstract
        running_abstract = {
            "active_diagnoses": [],
            "stage_information": [],
            "ongoing_treatments": [],
            "current_medications": [],
            "recent_lab_findings": [],
            "recent_imaging": [],
            "recent_procedures": [],
            "recent_vitals": [],
            "active_symptoms": [],
            "complications": [],
            "clinical_trajectory": "unknown"
        }
        
        # Collections to process (recent data only)
        collections = [
          
            procedure_notes_collection,
            documentation_treatment_plan_collection,
            documentation_medication_analysis_collection,
            conversation_user_collection,
            patient_vitals_collection,
            document_categories_collection,
            dictation_collection
        ]
        
        batch_count = 0
        
        try:
            # Process records in batches
            documents = await fetch_patient_graph_documents(patient_id)

            for doc in documents:

                document_name = doc["document"]
                batch = doc["entities"]

                logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
                logger.info(f"📄 Processing document: {document_name}")
                logger.info(f"📊 Entities count: {len(batch)}")

                try:

                    running_abstract = await self._process_batch(batch, running_abstract)

                    logger.info("✅ Document processed successfully")

                except Exception as e:

                    logger.error(f"❌ Document processing failed: {e}")
            
            # Generate final structured summary
            final_summary = await self._generate_final_summary(running_abstract)
            
            state["current_medical_condition"] = final_summary
            state["current_condition_processing_complete"] = True
            
            logger.info(f"✅ Current Condition Agent: Processed {batch_count} batches")
        
        except Exception as e:
            logger.error(f"❌ Current Condition Agent failed: {e}")
            state["current_medical_condition"] = {
                "summary_text": "Current condition processing incomplete",
                "error": str(e)
            }
            state["current_condition_processing_complete"] = False
        
        return state
    
    async def _process_batch(
        self,
        batch: List[Dict[str, Any]],
        running_abstract: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Process one batch and update running abstract"""
        
        batch_summary = self._format_batch_for_llm(batch)
        
        prompt = f"""
You are a STRICT clinical information extraction system.

Your task is NOT to diagnose, infer, or interpret medical data.

Your task is ONLY to extract clinical information that is explicitly written
in the provided medical records.

--------------------------------------------------
SOURCE RECORDS (LAST 1 YEAR)
--------------------------------------------------

CURRENT ABSTRACT (previously extracted data):
{json.dumps(running_abstract, indent=2, default=str)}

NEW BATCH OF RECORDS:
{batch_summary}

--------------------------------------------------
TASK
--------------------------------------------------

Update the patient's CURRENT medical condition using ONLY information
explicitly written in the records.

Extract the following categories if present:

1. Active diagnoses
2. Ongoing treatments
3. Current medications
4. Laboratory findings
5. Vital signs
6. Imaging findings
7. Procedures
8. Symptoms
9. Complications
10. Disease staging information

--------------------------------------------------
CRITICAL EXTRACTION RULES
--------------------------------------------------

You MUST follow these rules strictly:

1. Extract ONLY what is explicitly written.
2. NEVER infer or interpret clinical meaning.
3. NEVER convert vital signs into symptoms.
4. NEVER convert imaging findings into diagnoses.
5. NEVER invent medications, labs, or treatments.
6. NEVER guess staging or disease severity.

If information is missing → return empty lists [].

--------------------------------------------------
DIAGNOSIS EXTRACTION RULE
--------------------------------------------------

Only extract diagnoses when the record explicitly states a disease.

Valid examples:

• "Invasive carcinoma"
• "Ductal carcinoma in situ"
• "Breast cancer"
• "Hypertension"

DO NOT classify imaging findings as diagnoses.

Examples of text that MUST NOT be diagnoses:

• BIRADS findings
• lesions
• nodules
• masses
• imaging impressions

These belong under imaging findings.

--------------------------------------------------
VITAL SIGN RULE
--------------------------------------------------

Vital sign values must NOT be converted into clinical symptoms.

Example:

Record:
temperature: 103

Correct extraction:
temperature: 103

Incorrect extraction:
fever

Symptoms must only be extracted if explicitly written.

--------------------------------------------------
IMAGING EXTRACTION RULE
--------------------------------------------------

If multiple sentences describe the same imaging study,
combine them into ONE imaging finding.

Example:

Report contains:
- lesion description
- lymph node description
- impression

Correct extraction:

ONE imaging entry summarizing the study.

--------------------------------------------------
STAGING EXTRACTION RULE
--------------------------------------------------

Extract staging information ONLY when it is explicitly written
in the records.

Valid staging evidence includes:

• Stage I / II / III / IV
• TNM classification written in the report
• Histologic grade
• Tumor grade

IMPORTANT RULES:

• DO NOT derive TNM stage from tumor size.
• DO NOT predict Stage I/II/III/IV.
• DO NOT infer lymph node staging.
• DO NOT estimate metastasis status.

Only extract staging if the report explicitly states it.

Examples:

Record:
Histologic grade: Grade 2

Output:

"stage_information": {{
  "disease": "",
  "stage": "",
  "tnm_stage": "",
  "grade": "Grade 2",
  "evidence": "Histologic grade: Grade 2"
}}

Record:
Stage II Breast Cancer

Output:

"stage_information": {{
  "disease": "Breast cancer",
  "stage": "Stage II",
  "tnm_stage": "",
  "grade": "",
  "evidence": "Stage II Breast Cancer"
}}

If staging is not present return:

"stage_information": {{}}

--------------------------------------------------
EVIDENCE REQUIREMENT
--------------------------------------------------

Every extracted item MUST include the exact evidence text copied
from the records.

If evidence text cannot be found, DO NOT include the item.

Example:

{{
  "recent_vitals": [
    {{
      "vital": "temperature",
      "value": "103",
      "date": "2026-03-08",
      "evidence": "temperature: 103"
    }}
  ]
}}

--------------------------------------------------
OUTPUT FORMAT
--------------------------------------------------

Return ONLY valid JSON in this structure:

{{
  "active_diagnoses": [
    {{
      "diagnosis": "string",
      "evidence": "exact text from records"
    }}
  ],

  "ongoing_treatments": [
    {{
      "treatment": "string",
      "evidence": "exact text"
    }}
  ],

  "current_medications": [
    {{
      "drug": "string",
      "dose": "string",
      "indication": "string",
      "evidence": "exact text"
    }}
  ],

  "recent_lab_findings": [
    {{
      "test": "string",
      "value": "string",
      "date": "string",
      "evidence": "exact text"
    }}
  ],

  "recent_vitals": [
    {{
      "vital": "blood_pressure | heart_rate | respiratory_rate | temperature | oxygen_saturation",
      "value": "string",
      "date": "string",
      "evidence": "exact text"
    }}
  ],

  "recent_imaging": [
    {{
      "modality": "string",
      "date": "string",
      "key_finding": "string",
      "evidence": "exact text"
    }}
  ],

  "recent_procedures": [
    {{
      "procedure": "string",
      "date": "string",
      "evidence": "exact text"
    }}
  ],

  "active_symptoms": [
    {{
      "symptom": "string",
      "evidence": "exact text"
    }}
  ],

  "complications": [
    {{
      "complication": "string",
      "evidence": "exact text"
    }}
  ],

  "clinical_trajectory": "improving | stable | declining | fluctuating | unknown",

  "stage_information": {{
      "disease": "string",
      "stage": "string",
      "tnm_stage": "string",
      "grade": "string",
      "evidence": "exact text"
  }}
}}

--------------------------------------------------
FINAL RULE
--------------------------------------------------

If a value does NOT appear explicitly in the records,
it MUST NOT appear in the output.

Return ONLY valid JSON.
"""
        
        try:
            response = await self.llm.ainvoke([
                SystemMessage(content="You are a physician assessing current medical condition. Return only valid JSON."),
                HumanMessage(content=prompt)
            ])

            content = repair_json(response.content)

            # remove markdown
            content = re.sub(r"```json|```", "", content).strip()

            # extract JSON
            json_match = re.search(r"\{.*\}", content, re.DOTALL)
            if json_match:
                content = json_match.group(0)

            # FIX: remove trailing commas
            content = re.sub(r",\s*([\]}])", r"\1", content)

            try:
                updated_abstract = json.loads(content)
            except json.JSONDecodeError as e:
                logger.error(f"JSON parse failed: {e}")
                return running_abstract

            running_abstract = merge_dict_lists(running_abstract, updated_abstract)

            return running_abstract

        except Exception as e:
            logger.error(f"Batch processing failed: {e}")
            return running_abstract
    
    def _format_batch_for_llm(self, batch):

        formatted = []

        for entity in batch:

            entity_type = entity.get("entity_type")
            name = entity.get("name")
            evidence = entity.get("evidence")
            date = entity.get("date")

            formatted.append(
                f"[{date}] {entity_type}: {name} | Evidence: {evidence}"
            )

        return "\n".join(formatted)
    
    
    
    
    def _extract_report_findings(self, record: Dict[str, Any]) -> str:

        if "processed_data" in record and record["processed_data"]:
            structured = record["processed_data"][0].get("structured_data", {})
            return json.dumps(structured, default=str)

        return "No key findings"
    
    def _extract_lab_values(self, record: Dict[str, Any]) -> str:
        """Extract key lab values"""
        values = []
        if "test_results" in record:
            for test in record["test_results"][:5]:
                name = test.get("test_name", "")
                value = test.get("value", "")
                unit = test.get("unit", "")
                flag = test.get("flag", "")
                values.append(f"{name}: {value} {unit} {flag}".strip())
        return ", ".join(values) if values else "No values"
    
    def _extract_imaging_findings(self, record: Dict[str, Any]) -> str:
        """Extract imaging summary"""
        return record.get("impression", "")[:200] or record.get("findings", "")[:200]
    
    def _extract_medication_info(self, record: Dict[str, Any]) -> str:
        """Extract current medications"""
        if "medications" in record:
            meds = [f"{m.get('name')} {m.get('dose', '')}" for m in record["medications"][:5]]
            return ", ".join(meds)
        return ""
    
    def _extract_vital_signs(self, record: Dict[str, Any]) -> str:
        """Extract all vitals dynamically from record"""

        ignore_keys = {"_id", "collection_name", "report_date", "created_at", "updated_at"}

        vitals = []

        for key, value in record.items():

            if key in ignore_keys:
                continue

            if value is None:
                continue

            vitals.append(f"{key}: {value}")

        return ", ".join(vitals) if vitals else "No vitals"
    
    async def _generate_final_summary(
        self,
        running_abstract: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Generate final human-readable summary"""
        
        prompt = f"""
You are a clinical summarization system generating the patient's CURRENT medical condition.

Use ONLY the structured data provided.

--------------------------------------------------
INPUT DATA
--------------------------------------------------

{json.dumps(running_abstract, indent=2, default=str)}

--------------------------------------------------
TASK
--------------------------------------------------

Generate a concise summary of the patient's current clinical condition.

Include:

• active diagnoses
• medications
• abnormal labs
• abnormal vitals
• imaging findings
• procedures
• symptoms
• complications
• clinical trajectory
• disease staging (if present)

--------------------------------------------------
STAGING RULE
--------------------------------------------------

If staging exists preserve it exactly.

Examples:

Stage II breast cancer  
TNM: T2N1M0  
Grade 2  

Do NOT create staging if absent.

--------------------------------------------------
OUTPUT FORMAT
--------------------------------------------------

Return JSON:

{{
 "summary_text":"2–3 sentence clinical summary",

 "active_diagnoses":[],

 "current_medications":[],

 "recent_lab_findings":[],

 "recent_vitals":[],

 "recent_imaging":[],

 "recent_procedures":[],

 "active_symptoms":[],

 "active_issues":[],

 "clinical_trajectory":"improving | stable | declining | fluctuating | unknown",

 "trajectory_rationale":"",

 "monitoring_needs":[],

 "pending_actions":[],

 "stage_information":{{}},

 "character_count":0,

 "urgency_level":"routine | urgent | emergent"
}}

Return ONLY JSON.
"""
        
        try:
            response = await self.llm.ainvoke([
                SystemMessage(content="Generate current condition summary. Return only valid JSON."),
                HumanMessage(content=prompt)
            ])
            
            content = repair_json(response.content)
            if "```json" in content:
                content = content.split("```json", 1)[1].split("```", 1)[0]
            
            summary = json.loads(content)
            summary["character_count"] = len(json.dumps(summary))
            
            return summary
            
        except Exception as e:
            logger.error(f"Final summary generation failed: {e}")
            return {
                "summary_text": "Current condition processing incomplete",
                "error": str(e),
                "raw_abstract": running_abstract
            }

# =====================================================================
# CONTEXT FETCHING FUNCTIONS (UPDATED)
# =====================================================================

async def fetch_medical_context(patient_id: str, doctor_id: str) -> Dict[str, Any]:
    """
    Fetch complete medical context from all sources
    """
    logger.info(f"📚 Fetching Medical Context: Patient={patient_id}")

    try:
        medical_context = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "timestamp": datetime.utcnow().isoformat(),
            "demographics": {},
            "speciality": [],
            "conversation": [],
            "procedure_notes": [],
            "treatment_documents": [],
            "investigation_documents": [],
            "medication_analysis": [],
            "document_categories": [],
            "disease_identity": {},
            "disease_trajectory": {},
            "treatment_memory": {},
            "functional_status": {},
            "risk_topology": {},
            "prognosis": {},
            "hypothesis_layer": {},
            "next_visit_brief": {},
            "symptom_trajectory": {},
            "lab_trend_analysis": {},
            "biomarker_trend": {},
            "imaging_progression": {},
            "case_boundaries": {},
            "comorbidity_interaction": {},
            "patient_summary": {},
        }

        demographics = await fetch_patient_demographics(patient_id, patient_user_collection)
        
        medical_context["procedure_notes"] = await fetch_collection_data(
            patient_id, procedure_notes_collection
        )
        medical_context["conversation"] = await fetch_collection_data(
            patient_id, conversation_user_collection
        )
        medical_context["dictations"] = await fetch_collection_data(
            patient_id, dictation_collection
        )
        medical_context["treatment_documents"] = await fetch_collection_data(
            patient_id, documentation_treatment_plan_collection
        )
        medical_context["investigation_documents"] = await fetch_collection_data(
            patient_id, documentation_investigation_notes_collection
        )
        medical_context["medication_analysis"] = await fetch_collection_data(
            patient_id, documentation_medication_analysis_collection
        )
        medical_context["document_categories"] = await fetch_collection_data(
            patient_id, document_categories_collection
        )
        medical_context["vital_signs"] = await fetch_collection_data(
            patient_id, patient_vitals_collection
        )
        medical_context["demographics"] = demographics
        medical_context["speciality"] = await fetch_doctor_speciality(
            doctor_id, doctor_user_collection
        )

        logger.info(f"✅ Medical Context Fetched")
        return medical_context

    except Exception as e:
        logger.error(f"❌ Failed to fetch medical context: {str(e)}")
        return {}

async def fetch_collection_data(
    patient_id: str,
    collection,
    limit: int = 100
) -> List[Dict[str, Any]]:
    """Generic fetch function for any patient-based collection"""
    try:
        cursor = collection.find(
            {"patient_id": patient_id}
        ).sort("created_at", -1).limit(limit)

        results = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            results.append(doc)

        return results

    except Exception as e:
        logger.error(f"❌ Failed fetching data | collection={collection.name} | error={str(e)}")
        return []

async def fetch_doctor_speciality(doctor_id: str, collection) -> list:
    """Fetch doctor's speciality using doctor sys_user_id"""
    try:
        doc = await collection.find_one(
            {"sys_user_id": doctor_id},
            {"_id": 0, "specialization": 1}
        )

        if not doc:
            logger.warning(f"⚠️ No speciality found | doctor_id={doctor_id}")
            return []

        speciality = doc.get("specialization")

        if isinstance(speciality, list):
            return speciality

        return [speciality] if speciality else []

    except Exception as e:
        logger.error(f"❌ Failed fetching doctor speciality: {str(e)}")
        return []

async def fetch_patient_demographics(patient_id: str, collection) -> Dict[str, Any]:
    """Fetch patient age and sex from demographics collection"""
    try:
        doc = await collection.find_one(
            {"sys_user_id": patient_id},
            {"_id": 0, "date_of_birth": 1, "gender": 1}
        )

        if not doc:
            logger.warning(f"⚠️ No demographics found | patient_id={patient_id}")
            return {}

        date_of_birth = doc.get("date_of_birth")
        gender = doc.get("gender")
        age = None

        if date_of_birth:
            try:
                if isinstance(date_of_birth, str):
                    dob = datetime.strptime(date_of_birth, "%Y-%m-%d").date()
                else:
                    dob = date_of_birth

                today = datetime.utcnow().date()
                age = today.year - dob.year - (
                    (today.month, today.day) < (dob.month, dob.day)
                )

            except Exception:
                logger.warning(f"⚠️ Invalid DOB format | patient_id={patient_id}")

        return {"age": age, "sex": gender}

    except Exception as e:
        logger.error(f"❌ Failed fetching demographics: {str(e)}")
        return {}


# =====================================================================
# RAG RETRIEVAL AGENT
# =====================================================================

async def retrieve_rag_context(state: ClinicalReasoningState) -> ClinicalReasoningState:
    """Retrieve relevant context using Graph-RAG system before reasoning"""
    logger.info("🔍 RAG Retrieval Agent: Starting context retrieval")
    
    try:
        patient_id = state["patient_id"]
        consultation_text = state["consultation_text"]
        
        medical = state.get("medical_context", {})
        
        
        
        rag_results=None
        
        
        
        vector_results = None
        if not vector_results:
            logger.warning("⚠️ RAG retrieval returned no documents")
        
        serialized_docs = serialize_documents(vector_results)
        
        state["rag_context"] = {
            "vector_results": serialized_docs,
            
        }
        state["relevant_documents"] = serialized_docs
       
        logger.info(f"✅ RAG Retrieval Complete: {len(serialized_docs)} documents retrieved")
        
    except Exception as e:
        logger.error(f"❌ RAG Retrieval failed: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        state["error"] = f"RAG retrieval error: {str(e)}"
        state["rag_context"] = {"error": str(e), "vector_results": []}
        state["relevant_documents"] = []
    
    return state

# =====================================================================
# Other AGENTS (Minimal implementations for completeness)
# =====================================================================


# =====================================================================
# WORKFLOW CREATION WITH NEW AGENTS
# =====================================================================

def create_enhanced_clinical_reasoning_workflow(llm: ChatGroq) -> StateGraph:
    """
    Create enhanced LangGraph workflow with medical history agents
    """
    
    # Initialize ALL agents
    rag_retrieval_agent = retrieve_rag_context
    
    # NEW AGENTS
    medical_history_agent = PatientMedicalHistoryAgent(llm)
    current_condition_agent = CurrentMedicalConditionAgent(llm)
    
    # Existing agents
    
    # Create workflow
    workflow = StateGraph(ClinicalReasoningState)
    
    # ── ADD ALL NODES ──────────────────────────────────────────────
    workflow.add_node("rag_retrieval", rag_retrieval_agent)
    
    # NEW HISTORY NODES - Execute early to provide context
    workflow.add_node("medical_history_agent", medical_history_agent.analyze)
    workflow.add_node("current_condition_agent", current_condition_agent.analyze)
    
   
    # ── SET ENTRY POINT ──────────────────────────────────────────────
    workflow.set_entry_point("rag_retrieval")
    
    # ── ADD ALL EDGES (MODIFIED FLOW) ────────────────────────────────
    # NEW: Process medical history agents early
    workflow.add_edge("rag_retrieval", "medical_history_agent")
    workflow.add_edge("medical_history_agent", "current_condition_agent")
    workflow.add_edge("current_condition_agent", END)

    # Continue with existing flow
    
    return workflow.compile()

# =====================================================================
# MAIN EXECUTION FUNCTION
# =====================================================================

async def run_enhanced_clinical_reasoning(
    patient_id: str,
    doctor_id: str,
    consultation_text: str,
    medical_context: Dict[str, Any],
   
) -> Dict[str, Any]:
    """
    Execute complete clinical reasoning workflow with NEW history agents
    """
    logger.info("🚀 Starting Enhanced Clinical Reasoning Workflow with History Agents")
    
    # Create workflow
    workflow = create_enhanced_clinical_reasoning_workflow(llm)
    
    # Initialize state
    initial_state: ClinicalReasoningState = {
        "patient_id": patient_id,
        "doctor_id": doctor_id,
        "consultation_text": consultation_text,
        "medical_context": medical_context,
        
        
        # NEW FIELDS
        "patient_medical_history": None,
        "current_medical_condition": None,
        "medical_history_processing_complete": False,
        "current_condition_processing_complete": False,
        
        # Existing fields
        "rag_context": None,
        "relevant_documents": None,
        "graph_relationships": None,
        "temporal_trends": None,
        "longitudinal_story": None,
        "confidence_scores": {},
        "warnings": [],
        "requires_review": False,
        "advanced_treatment_intelligence": None,
        "error": None
    }
    
    try:
        # Run workflow
        final_state = await workflow.ainvoke(initial_state)
        
        logger.info("✅ Enhanced Clinical Reasoning Workflow Complete")
        
        response_payload = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,

            "patient_medical_history": final_state.get("patient_medical_history"),
            "current_medical_condition": final_state.get("current_medical_condition"),

            "confidence_scores": final_state.get("confidence_scores", {}),
            "warnings": final_state.get("warnings", []),
            "requires_review": final_state.get("requires_review", False),

            "created_at": datetime.utcnow()
        }

        # Save to MongoDB
        try:
            insert_result = await summary_collection.insert_one(response_payload)
            logger.info(f"✅ Patient summary saved | id={insert_result.inserted_id}")
            await processing_tracker.update_one(
                {
                    "patient_id": patient_id,
                    "doctor_id": doctor_id
                },
                {
                    "$set": {
                        "status": "completed",
                        "summary_id": str(insert_result.inserted_id),
                        "completed_at": datetime.utcnow()
                    }
                }
            )
        except Exception as db_error:
            logger.error(f"❌ Failed saving patient summary: {db_error}")

        # Response format for API
        response_payload["status"] = "success"
        response_payload["timestamp"] = datetime.utcnow().isoformat()
        
        return sanitize_for_response(response_payload)
        
    except Exception as e:
        logger.error(f"❌ Enhanced Clinical Reasoning Workflow failed: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return {
            "status": "error",
            "error": str(e),
            "confidence_scores": {},
            "warnings": ["Clinical reasoning workflow failed"],
            "requires_review": True,
            "timestamp": datetime.utcnow().isoformat()
        }
    finally:
        await graph_rag_system.close()

# =====================================================================
# API ENDPOINTS
# =====================================================================



@router.post("/patient-summary-agent", response_model=EnhancedClinicalReasoningResponse)
async def execute_enhanced_clinical_reasoning(request: ClinicalReasoningRequest):
    """
    Execute comprehensive multi-agent clinical reasoning workflow with NEW history agents
    """
    try:
        logger.info(f"🚀 Enhanced Clinical Reasoning Request: Patient={request.patient_id}, Doctor={request.doctor_id}")
        
        # Fetch contexts from database
        medical_context = await fetch_medical_context(request.patient_id, request.doctor_id)
       
        
        # Execute enhanced reasoning workflow with NEW history agents
        result = await run_enhanced_clinical_reasoning(
            patient_id=request.patient_id,
            doctor_id=request.doctor_id,
            consultation_text=request.consultation_text,
            medical_context=medical_context,
           
        )
        
        logger.info(f"✅ Enhanced Clinical Reasoning Complete: Status={result['status']}")
        
        return EnhancedClinicalReasoningResponse(**result)
        
    except Exception as e:
        logger.error(f"❌ Enhanced Clinical Reasoning Failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


