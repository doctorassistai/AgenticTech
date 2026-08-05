"""
CCGI IP Patient Onboarding Summary — Enhanced Agentic Reasoning System
========================================================================

Architecture:
  Data Fetch Layer       → IPOnboardingDataFetcher
                            • Neo4j graph data (OP + IP docs)
                            • patient_appointments (admission record + chief complaint)
                            • patient_users (demographics)
                            • diagnosis/history API  → latest OP diagnoses
                            • documentation features API → clinical notes, investigation notes,
                              medication analysis, treatment plan, treatment summary (latest per type)

  Agent Pipeline:
    A0  — OP History Anchor         (OP visit chain: complaints → diagnoses → plans → trajectory)
    A1  — OP Treatment Journey      (treatments tried, response, escalation reason classification)
    A2  — OP→IP Transition Reasoner (structured justification for admission, urgency, type)
    A3  — IP Admission Context      (admission logistics, vitals, current documents)
    A4  — IP Clinical Summary       (integrated problem list, working diagnosis, timeline)
    A5  — Clinical Risk Engine      (MEWS/NEWS, comorbidity flags, red flags, risk level)
    A6  — Critical Conditions Agent (critical factors, warning indicators, priority flags)
    A7  — Monitoring Plan Agent     (parameter | frequency | threshold | action)
    A8  — IP Care Plan Agent        (step-by-step sequenced plan)
    A9  — Insurance & Documentation (pre-auth, ICD-10, criteria, gaps)
    A10 — Synthesis Agent           (final structured IP onboarding summary assembly)
    A11 — Quality Agent             (completeness, hallucination check, patient-specificity score)

Output: Fully structured, patient-specific IP Onboarding Summary.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, TypedDict

import httpx
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

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
NEO4J_URI    = os.getenv("NEO4J_URI", "bolt://neo4j:7687")
NEO4J_USER   = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASS   = os.getenv("NEO4J_PASSWORD", "password")
MONGO_URI    = os.getenv("MONGO_URI")
MONGO_DB     = "doctorassistai"

# External API base
EXTERNAL_API_BASE = os.getenv("EXTERNAL_API_BASE", "https://doctorassist.ai/api/hms")

# ── DB Clients ──────────────────────────────────────────────
mongo_client = AsyncIOMotorClient(MONGO_URI)
mongo_db     = mongo_client[MONGO_DB]
# Add this with your other collection definitions
diagnosis_data_collection = mongo_db["diagnosis_data"]
patient_appointments_collection           = mongo_db["patient_appointments"]
patient_users_collection                  = mongo_db["patient_users"]
ip_onboarding_summary_collection          = mongo_db["ip_onboarding_summary"]
patient_vitals_collection = mongo_db["patient_vitals"]
# Documentation sub-collections
documentation_treatment_plan_collection      = mongo_db["documentation-treatment-plan"]
documentation_investigation_notes_collection = mongo_db["documentation-investigation-notes"]
documentation_medication_analysis_collection = mongo_db["documentation-medication-analysis"]
documentation_treatment_summary_collection   = mongo_db["documentation-treatment-summary"]
documentation_clinical_notes_collection      = mongo_db["documentation-clinical-notes"]

neo4j_driver = AsyncGraphDatabase.driver(
    NEO4J_URI,
    auth=(NEO4J_USER, NEO4J_PASS),
    max_connection_lifetime=3600,
    max_connection_pool_size=50,
)

# ── LLMs ────────────────────────────────────────────────────
llm = ChatGroq(
    model="llama-3.1-8b-instant",
    temperature=0.2,
    max_tokens=5000,
    groq_api_key=GROQ_API_KEY,
)

llm_synthesis = ChatGroq(
    model="llama-3.3-70b-versatile",
    temperature=0.1,
    max_tokens=6000,
    groq_api_key=GROQ_API_KEY,
)

router = APIRouter(prefix="", tags=["IP Onboarding Clinical Reasoning"])


# ============================================================
# REQUEST / RESPONSE MODELS
# ============================================================

class IPOnboardingRequest(BaseModel):
    patient_id:            str
    doctor_id:             str
    specialty:             str
    include_intermediates: bool = False


class IPOnboardingResponse(BaseModel):
    patient_id:         str
    doctor_id:          str
    generated_at:       str
    documents_analyzed: int
    processing_time_ms: int
    ip_onboarding_summary: Dict[str, Any]
    score:              Optional[Dict] = None
    intermediate:       Optional[Dict] = None


# ============================================================
# STATE
# ============================================================

class IPOnboardingState(TypedDict):
    # Inputs
    patient_id:    str
    doctor_id:     str
    specialty:     str

    # Raw fetched data
    op_graph_docs:    List[Dict]
    ip_graph_docs:    List[Dict]
    admission_record: Optional[Dict]
    patient_demo:     Optional[Dict]

    # External API data
    op_diagnosis_history: List[Dict]    # from diagnosis/history API (latest first)
    documentation_features: List[Dict]  # from get_documentation_features_by_patient (latest per type)
    patient_vitals: List[Dict]
    # Documentation sub-collections (latest per type)
    latest_clinical_notes:      Optional[Dict]
    latest_investigation_notes: Optional[Dict]
    latest_medication_analysis: Optional[Dict]
    latest_treatment_plan:      Optional[Dict]
    latest_treatment_summary:   Optional[Dict]
    validation_errors: Optional[List[str]]
    # Neo4j ground truth whitelists
    neo4j_diagnoses:   set
    neo4j_medications: set
    neo4j_procedures:  set
    neo4j_findings:    set
    ground_truth:      Dict

    # Agent outputs
    op_history:            Optional[Dict]   # A0
    op_treatment_journey:  Optional[Dict]   # A1
    transition_context:    Optional[Dict]   # A2
    admission_context:     Optional[Dict]   # A3
    clinical_summary:      Optional[Dict]   # A4
    risk_stratification:   Optional[Dict]   # A5
    critical_conditions:   Optional[Dict]   # A6
    monitoring_plan:       Optional[Dict]   # A7
    care_plan:             Optional[Dict]   # A8
    insurance_docs:        Optional[Dict]   # A9
    ip_onboarding_summary: Optional[Dict]   # A10
    quality_score:         Optional[Dict]   # A11

    errors:        List[str]
    agent_timings: Dict[str, float]


# ============================================================
# UTILITIES
# ============================================================
def extract_latest_vitals(vitals_doc):
    if not vitals_doc or "vitals" not in vitals_doc:
        return []

    vitals_map = vitals_doc.get("vitals", {})
    if not vitals_map:
        return []

    # ✅ get latest timestamp
    latest_timestamp = sorted(vitals_map.keys())[-1]
    latest_vitals = vitals_map[latest_timestamp]

    formatted = []

    for key, value in latest_vitals.items():
        if key == "doctor_id":
            continue

        formatted.append({
            "parameter": key,
            "value": value,
            "unit": "",
            "date": latest_timestamp,
            "source": "mongo"
        })

    return formatted
def parse_llm_json(text: str) -> Dict:
    if not text:
        return {}
    
    text = text.strip()
    
    # Remove markdown code blocks
    text = re.sub(r'```json\s*', '', text)
    text = re.sub(r'```\s*', '', text)
    
    # Find JSON object
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if match:
        text = match.group(0)
    
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # If it's already a string that contains JSON, try to parse it
        if text.startswith('"') and text.endswith('"'):
            try:
                inner = json.loads(text)
                return json.loads(inner) if isinstance(inner, str) else inner
            except:
                pass
        return {"raw_output": text}
# ============================
# ✅ NEW: STRUCTURE ENFORCER
# ============================
def enforce_output_structure(state, summary):
    return {
        "previous_op_summary": summary.get("previous_op_summary") 
            or state.get("clinical_summary", {}).get("previous_op_summary"),

        "reason_for_op_to_ip_admission": summary.get("reason_for_op_to_ip_admission") 
            or state.get("transition_context"),

        "treatments_tried_and_response": state.get("op_treatment_journey"),

        "disease_progression_clinical_insights": {
            "progression_trend": state.get("op_history", {}).get("op_clinical_trajectory", {}).get("trend"),
            "key_events": state.get("op_history", {}).get("op_clinical_trajectory", {}).get("key_progression_events"),
            "derived_from": "Neo4j Graph",
        },

        "ip_admission_details": state.get("admission_context"),
        "ip_clinical_summary": state.get("clinical_summary"),
        "risk_stratification": state.get("risk_stratification"),
        "critical_conditions_to_watch": state.get("critical_conditions"),
        "monitoring_plan": state.get("monitoring_plan"),
        "step_by_step_ip_care_plan": state.get("care_plan"),
        "insurance_and_documentation": state.get("insurance_docs")
    }


# ============================
# ✅ NEW: VALIDATION ENGINE
# ============================
def validate_summary(state, summary):
    errors = []

    # Rule 1: OP missing
    if not state.get("op_graph_docs"):
        errors.append("Insufficient OP Clinical Data")

    # Rule 2: Escalation
    escalation = state.get("op_treatment_journey", {}).get("escalation_reason", {})
    if not escalation.get("escalation_derivable"):
        escalation["doctor_input_required"] = True
        escalation["flag"] = "Needs Doctor Input"

    # Rule 3: Risk explainability
    risk = state.get("risk_stratification", {}).get("overall_risk", {})
    if not risk.get("explainability"):
        errors.append("Risk explainability missing")

    return errors


# ============================================================
# LOGGING UTILITIES
# ============================================================
def log_ip_onboarding_input(state: IPOnboardingState):
    """Print IP onboarding input data in a readable format"""
    logger.info("=" * 80)
    logger.info("🏥 IP ONBOARDING INPUT DATA")
    logger.info("=" * 80)
    
    # Patient Info
    logger.info("📋 PATIENT INFORMATION")
    logger.info(f"   Patient ID: {state.get('patient_id')}")
    logger.info(f"   Doctor ID: {state.get('doctor_id')}")
    logger.info(f"   Specialty: {state.get('specialty')}")
    
    # Demographics
    demo = state.get("patient_demo", {})
    if demo:
        logger.info("👤 DEMOGRAPHICS")
        logger.info(f"   {json.dumps(demo, indent=2, default=str)}")
    
    # Admission Record
    admission = state.get("admission_record", {})
    if admission:
        logger.info("🏥 ADMISSION RECORD")
        logger.info(f"   {json.dumps(admission, indent=2, default=str)}")
    
    # Graph Documents - Show actual data
    op_docs = state.get("op_graph_docs", [])
    ip_docs = state.get("ip_graph_docs", [])
    logger.info("📊 GRAPH DOCUMENTS")
    logger.info(f"   OP Documents (before admission): {len(op_docs)} documents")
    if op_docs:
        logger.info(f"   OP Document Data:")
        logger.info(f"   {json.dumps(op_docs, indent=2, default=str)}")
    
    logger.info(f"   IP Documents (from admission): {len(ip_docs)} documents")
    if ip_docs:
        logger.info(f"   IP Document Data:")
        logger.info(f"   {json.dumps(ip_docs, indent=2, default=str)}")
    
    # Diagnosis History - Show actual data
    diag_history = state.get("op_diagnosis_history", [])
    logger.info("🩺 DIAGNOSIS HISTORY")
    logger.info(f"   Total Diagnoses: {len(diag_history)}")
    if diag_history:
        logger.info(f"   Diagnosis Data:")
        logger.info(f"   {json.dumps(diag_history, indent=2, default=str)}")
    
    # Vitals - Show actual data
    vitals = state.get("patient_vitals", [])
    logger.info("💓 VITALS")
    logger.info(f"   Total Vitals: {len(vitals)}")
    if vitals:
        logger.info(f"   Vitals Data:")
        logger.info(f"   {json.dumps(vitals, indent=2, default=str)}")
    
    # Documentation Features - Show actual data
    doc_features = state.get("documentation_features", [])
    logger.info("📝 DOCUMENTATION FEATURES")
    logger.info(f"   Total Features: {len(doc_features)}")
    if doc_features:
        logger.info(f"   Documentation Features Data:")
        logger.info(f"   {json.dumps(doc_features, indent=2, default=str)}")
    
    # Latest Documentation from MongoDB - Show actual data
    logger.info("📚 LATEST DOCUMENTATION (MongoDB)")
    
    latest_clinical = state.get("latest_clinical_notes")
    if latest_clinical:
        logger.info("   Clinical Notes:")
        logger.info(f"   {json.dumps(latest_clinical, indent=2, default=str)}")
    else:
        logger.info("   Clinical Notes: Not available")
    
    latest_investigation = state.get("latest_investigation_notes")
    if latest_investigation:
        logger.info("   Investigation Notes:")
        logger.info(f"   {json.dumps(latest_investigation, indent=2, default=str)}")
    else:
        logger.info("   Investigation Notes: Not available")
    
    latest_medication = state.get("latest_medication_analysis")
    if latest_medication:
        logger.info("   Medication Analysis:")
        logger.info(f"   {json.dumps(latest_medication, indent=2, default=str)}")
    else:
        logger.info("   Medication Analysis: Not available")
    
    latest_treatment_plan = state.get("latest_treatment_plan")
    if latest_treatment_plan:
        logger.info("   Treatment Plan:")
        logger.info(f"   {json.dumps(latest_treatment_plan, indent=2, default=str)}")
    else:
        logger.info("   Treatment Plan: Not available")
    
    latest_treatment_summary = state.get("latest_treatment_summary")
    if latest_treatment_summary:
        logger.info("   Treatment Summary:")
        logger.info(f"   {json.dumps(latest_treatment_summary, indent=2, default=str)}")
    else:
        logger.info("   Treatment Summary: Not available")
    
    # Neo4j Whitelists - Show actual data
    logger.info("🔒 NEO4J GROUND TRUTH WHITELISTS")
    
    neo4j_diagnoses = state.get("neo4j_diagnoses", set())
    logger.info(f"   Valid Diagnoses ({len(neo4j_diagnoses)}):")
    if neo4j_diagnoses:
        logger.info(f"   {json.dumps(list(neo4j_diagnoses), indent=2, default=str)}")
    
    neo4j_medications = state.get("neo4j_medications", set())
    logger.info(f"   Valid Medications ({len(neo4j_medications)}):")
    if neo4j_medications:
        logger.info(f"   {json.dumps(list(neo4j_medications), indent=2, default=str)}")
    
    neo4j_procedures = state.get("neo4j_procedures", set())
    logger.info(f"   Valid Procedures ({len(neo4j_procedures)}):")
    if neo4j_procedures:
        logger.info(f"   {json.dumps(list(neo4j_procedures), indent=2, default=str)}")
    
    neo4j_findings = state.get("neo4j_findings", set())
    logger.info(f"   Valid Findings ({len(neo4j_findings)}):")
    if neo4j_findings:
        logger.info(f"   {json.dumps(list(neo4j_findings), indent=2, default=str)}")
    
    logger.info("=" * 80)
    logger.info("✅ INPUT DATA LOADING COMPLETE")
    logger.info("=" * 80)
class BaseAgent:
    def __init__(self, llm_instance):
        self.llm = llm_instance

    async def _invoke(self, system: str, user: str) -> Dict:
        response = await self.llm.ainvoke([
            SystemMessage(content=system),
            HumanMessage(content=user),
        ])
        
        result = parse_llm_json(response.content)
        
        # If result has raw_output, try to parse it again
        if isinstance(result, dict) and "raw_output" in result:
            raw = result["raw_output"]
            if isinstance(raw, str):
                try:
                    parsed = json.loads(raw)
                    if isinstance(parsed, dict):
                        return parsed
                except:
                    pass
        
        return result

    def _elapsed(self, start: float) -> float:
        return round((datetime.now().timestamp() - start) * 1000, 1)


# ============================================================
# DATA FETCHER
# ============================================================

class IPOnboardingDataFetcher:
    """
    Fetches ALL data required for IP onboarding:
      1. Patient demographics (patient_users)
      2. IP admission record (patient_appointments)
      3. Neo4j OP graph docs (before admission_date)
      4. Neo4j IP graph docs (from admission_date onwards)
      5. OP diagnosis history (external API)
      6. Documentation features (external API or MongoDB collections)
    """

    # ── Demographics ─────────────────────────────────────────
    async def fetch_patient_demographics(self, patient_id: str) -> Dict:
        try:
            for field in ["sys_user_id", "patient_id"]:
                patient = await patient_users_collection.find_one(
                    {field: patient_id},
                    {"_id": 0, "date_of_birth": 1, "gender": 1, "full_name": 1,
                     "name": 1, "phone": 1, "mobile": 1, "blood_group": 1, "allergies": 1}
                )
                if patient:
                    return patient
            return {}
        except Exception as e:
            logger.error(f"Demographics fetch failed: {e}")
            return {}

    # ── IP Admission Record ──────────────────────────────────
    async def fetch_ip_admission_record(self, patient_id: str, doctor_id: str) -> Optional[Dict]:
        try:
            for field in ["sys_user_id", "patient_id"]:
                doc = await patient_appointments_collection.find_one({field: patient_id}, {"_id": 0})
                if doc:
                    break
            if not doc:
                return None

            appointments = doc.get("appointments", [])
            ip_appts = [
                a for a in appointments
                if a.get("visit_type") == "IP"
                and (doctor_id == "ANY" or a.get("doctor_id") == doctor_id)
            ]
            if not ip_appts:
                ip_appts = [a for a in appointments if a.get("visit_type") == "IP"]
            if not ip_appts:
                return None

            ip_appts.sort(key=lambda x: (x.get("date", ""), x.get("created_at", "")), reverse=True)
            best = ip_appts[0]
            best["_patient_doc_id"] = str(doc.get("_id", ""))
            return best
        except Exception as e:
            logger.error(f"IP admission fetch failed: {e}")
            return None
    # ── MongoDB: Diagnosis History from diagnosis_data collection ───────────────
    async def fetch_diagnosis_history_from_mongo(self, patient_id: str, doctor_id: str) -> List[Dict]:
        """Fetch diagnosis history from local diagnosis_data collection"""
        try:
            cursor = diagnosis_data_collection.find(
                {
                    "patient_id": patient_id,
                    "doctor_id": doctor_id,
                    "type": "diagnosis"
                }
            ).sort("updated_at", -1).limit(100)
            
            docs = await cursor.to_list(length=100)
            
            results = []
            for doc in docs:
                results.append({
                    "diagnosis": doc.get("diagnosis", "Nil"),
                    "updated_at": doc.get("updated_at"),
                    "source": "mongo_diagnosis_data"
                })
            
            logger.info(f"Fetched {len(results)} diagnosis records from MongoDB diagnosis_data")
            return results
        except Exception as e:
            logger.error(f"Failed to fetch diagnosis history from MongoDB: {e}")
            return []
    # ── Neo4j Graph Documents ────────────────────────────────
    async def fetch_graph_documents_range(
        self,
        patient_id: str,
        from_date: Optional[str],
        to_date: Optional[str],
        direction: str = "before"
    ) -> List[Dict]:
        where_conditions = []
        if direction == "before" and to_date:
            where_conditions.append(
                "(document_date IS NULL OR document_date < date($cutoff_date))"
            )
            params = {"patient_id": patient_id, "cutoff_date": to_date}
        elif direction == "from" and from_date:
            where_conditions.append(
                "(document_date IS NULL OR document_date >= date($from_date))"
            )
            params = {"patient_id": patient_id, "from_date": from_date}
        else:
            params = {"patient_id": patient_id}

        date_filter = ("WHERE " + " AND ".join(where_conditions)) if where_conditions else ""

        cypher = f"""
        MATCH (p:Patient {{patient_id: $patient_id}})-[r]->(n)
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
                WHEN raw_date =~ '\\\\d{{4}}-\\\\d{{2}}-\\\\d{{2}}'
                THEN date(raw_date)
                WHEN raw_date =~ '\\\\d{{2}}-\\\\d{{2}}-\\\\d{{4}}'
                THEN date({{
                    year:  toInteger(split(raw_date,'-')[2]),
                    month: toInteger(split(raw_date,'-')[1]),
                    day:   toInteger(split(raw_date,'-')[0])
                }})
                WHEN raw_date =~ '\\\\d{{2}}-[A-Za-z]{{3}}-\\\\d{{4}}'
                THEN date({{
                    year:  toInteger(split(raw_date,'-')[2]),
                    month: CASE split(raw_date,'-')[1]
                        WHEN 'Jan' THEN 1 WHEN 'Feb' THEN 2 WHEN 'Mar' THEN 3
                        WHEN 'Apr' THEN 4 WHEN 'May' THEN 5 WHEN 'Jun' THEN 6
                        WHEN 'Jul' THEN 7 WHEN 'Aug' THEN 8 WHEN 'Sep' THEN 9
                        WHEN 'Oct' THEN 10 WHEN 'Nov' THEN 11 WHEN 'Dec' THEN 12
                        ELSE NULL END,
                    day: toInteger(split(raw_date,'-')[0])
                }})
                ELSE NULL
            END AS document_date

        {date_filter}

        WITH document, document_date, raw_date,
            collect({{
                relation: type(r),
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
                    n.name, n.details, n.description, n.drug_name,
                    n.test_name, n.vital_type, n.value
                ),
                date:     raw_date,
                evidence: e.evidence_text
            }}) AS entities

        RETURN document, document_date, entities
        ORDER BY document_date ASC
        """

        try:
            async with neo4j_driver.session() as session:
                result = await session.run(cypher, **params)
                docs: List[Dict] = []
                async for record in result:
                    docs.append({
                        "document":      record["document"],
                        "document_date": str(record["document_date"]),
                        "entities":      record["entities"],
                    })

            cleaned = []
            for doc in docs:
                seen = set()
                clean_entities = []
                for e in doc.get("entities", []):
                    name = str(e.get("name", "")).strip().lower()
                    evidence = str(e.get("evidence", "")).strip().lower()
                    if not name or name == "null":
                        continue
                    if evidence == "null":
                        continue
                    key = (name, e.get("entity_type"))
                    if key in seen:
                        continue
                    seen.add(key)
                    clean_entities.append(e)
                if clean_entities:
                    doc["entities"] = clean_entities
                    cleaned.append(doc)

            logger.info(f"Neo4j [{direction}] — {len(cleaned)} docs for {patient_id}")
            return cleaned
        except Exception as e:
            logger.error(f"Neo4j fetch failed: {e}")
            return []

    # ── External: OP Diagnosis History ──────────────────────
    # ── External: OP Diagnosis History (Enhanced with MongoDB fallback) ─────────
    async def fetch_op_diagnosis_history(self, patient_id: str, doctor_id: str) -> List[Dict]:
        """Fetch OP diagnosis history - tries external API first, then MongoDB"""
        
        # Try external API first
        url = f"{EXTERNAL_API_BASE}/users/data/context/diagnosis/history/{patient_id}/{doctor_id}"
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(url)
                if resp.status_code == 200:
                    data = resp.json()
                    api_data = data.get("data", [])
                    if api_data:
                        # Add source marker
                        for item in api_data:
                            item["source"] = "external_api"
                        logger.info(f"Fetched {len(api_data)} diagnosis records from external API")
                        return api_data
        except Exception as e:
            logger.warning(f"External API for diagnosis history failed: {e}")
        
        # Fallback to MongoDB diagnosis_data collection
        logger.info(f"Falling back to MongoDB diagnosis_data for patient {patient_id}")
        return await self.fetch_diagnosis_history_from_mongo(patient_id, doctor_id)

    # ── External: Documentation Features ────────────────────
    async def fetch_documentation_features(self, patient_id: str) -> List[Dict]:
        url = f"{EXTERNAL_API_BASE}/users/data/context/get_documentation_features_by_patient/{patient_id}"
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(url)
                if resp.status_code == 200:
                    data = resp.json()
                    return data.get("data", [])
        except Exception as e:
            logger.warning(f"Documentation features API failed: {e}")
        return []

    # ── MongoDB: Latest Documentation per type ───────────────
    async def fetch_latest_documentation(self, patient_id: str, doctor_id: str) -> Dict[str, Optional[Dict]]:
        result: Dict[str, Optional[Dict]] = {
            "clinical_notes": None,
            "investigation_notes": None,
            "medication_analysis": None,
            "treatment_plan": None,
            "treatment_summary": None,
        }

        collections_map = {
            "clinical_notes":      documentation_clinical_notes_collection,
            "investigation_notes": documentation_investigation_notes_collection,
            "medication_analysis": documentation_medication_analysis_collection,
            "treatment_plan":      documentation_treatment_plan_collection,
            "treatment_summary":   documentation_treatment_summary_collection,
        }

        query = {"patient_id": patient_id}
        if doctor_id and doctor_id != "ANY":
            query["doctor_id"] = doctor_id

        for key, collection in collections_map.items():
            try:
                doc = await collection.find_one(
                    query,
                    {"_id": 0},
                    sort=[("created_at", -1)]
                )
                result[key] = doc
            except Exception as e:
                logger.warning(f"Documentation fetch [{key}] failed: {e}")

        return result
    async def fetch_patient_vitals(self, patient_id: str) -> Dict:
        try:
            doc = await patient_vitals_collection.find_one(
                {"patient_id": patient_id},
                {"_id": 0}
            )
            return doc or {}
        except Exception as e:
            logger.error(f"Vitals fetch failed: {e}")
            return {}
# ============================================================
# HELPER: Extract latest doc per feature_id from API response
# ============================================================

def extract_latest_by_feature(docs: List[Dict]) -> Dict[str, Dict]:
    """
    From a flat list of documentation feature docs (sorted newest first),
    extract the latest record per feature_id.
    """
    seen: Dict[str, Dict] = {}
    for doc in docs:
        fid = doc.get("feature_id", "unknown")
        if fid not in seen:
            seen[fid] = doc
    return seen


# ============================================================
# HELPER: Build Neo4j Ground Truth Whitelists
# ============================================================
def extract_vitals_from_neo4j(docs: List[Dict]) -> List[Dict]:
    vitals = []

    for doc in docs:
        doc_date = doc.get("document_date")

        for e in doc.get("entities", []):
            if e.get("entity_type") == "Vital Sign":
                vitals.append({
                    "parameter": e.get("name"),
                    "value": e.get("name"),
                    "date": doc_date,
                    "source": "neo4j"
                })

    return vitals


def merge_vitals(mongo_vitals: List[Dict], neo4j_vitals: List[Dict]) -> List[Dict]:
    merged = []

    for v in mongo_vitals:
        merged.append({
            "parameter": v.get("parameter"),
            "value": v.get("value"),
            "unit": v.get("unit"),
            "date": v.get("date"),
            "source": "mongo"
        })

    for v in neo4j_vitals:
        merged.append(v)

    merged.sort(key=lambda x: str(x.get("date")), reverse=True)
    return merged
def build_neo4j_whitelists(op_docs: List[Dict], ip_docs: List[Dict]) -> Dict[str, set]:
    diagnoses = set()
    medications = set()
    procedures = set()
    findings = set()

    for doc in op_docs + ip_docs:
        for e in doc.get("entities", []):
            name = str(e.get("name", "")).strip()
            etype = e.get("entity_type", "")
            if not name or name.lower() in ["null", "none", ""]:
                continue
            if etype == "Diagnosis":
                diagnoses.add(name)
            elif etype == "Medication":
                medications.add(name)
            elif etype == "Procedure":
                procedures.add(name)
            elif etype == "Finding":
                findings.add(name)

    return {
        "diagnoses":   diagnoses,
        "medications": medications,
        "procedures":  procedures,
        "findings":    findings,
    }


# ============================================================
# A0 · OP HISTORY ANCHOR AGENT
# ============================================================

class OPHistoryAnchorAgent(BaseAgent):
    """
    Reads ALL OP (pre-admission) graph documents + diagnosis history API
    + documentation features to produce a comprehensive OP history.
    Groups by visit/document and extracts:
      - Chief complaints per visit
      - Diagnoses (ALL reports → single consolidated diagnosis, not one per report)
      - Doctor plans per visit
      - Investigations done
      - Clinical trajectory
    """

    agent_id = "A0"

    async def run(self, state: IPOnboardingState) -> IPOnboardingState:
        logger.info(f"{self.agent_id} · OPHistoryAnchorAgent — START")
        t0 = datetime.now().timestamp()

        op_docs           = state["op_graph_docs"]
        specialty         = state["specialty"]
        demo              = state.get("patient_demo", {})
        op_diag_history   = state.get("op_diagnosis_history", [])
        doc_features      = state.get("documentation_features", [])
        latest_clin_notes = state.get("latest_clinical_notes")
        latest_inv_notes  = state.get("latest_investigation_notes")
        latest_med_anal   = state.get("latest_medication_analysis")
        latest_tx_plan    = state.get("latest_treatment_plan")
        latest_tx_summary = state.get("latest_treatment_summary")

        neo4j_diag = sorted(state.get("neo4j_diagnoses", set()))
        neo4j_med  = sorted(state.get("neo4j_medications", set()))
        neo4j_proc = sorted(state.get("neo4j_procedures", set()))

        # Latest doc per feature from external API
        feature_map = extract_latest_by_feature(doc_features)

        system = (
            "You are a senior physician extracting a structured, patient-specific OP history "
            "from ALL available sources: graph records, diagnosis API, documentation features, "
            "and clinical notes collections. "
            "You group findings by visit/document but produce ONE unified diagnosis list "
            "from ALL reports combined. Never one diagnosis per report. "
            "CRITICAL RULE: If no data exists for any section, output empty array [] or 'Not documented'. "
            "NEVER invent diagnoses, medications, or procedures not present in the sources above. "
            "Always respond with valid JSON only."
        )

        prompt = f"""
STRICT GROUNDING RULE:
Valid Neo4j diagnoses: {neo4j_diag}
Valid Neo4j medications: {neo4j_med}
Valid Neo4j procedures: {neo4j_proc}
Do NOT invent entities outside these lists.

⚠️ DATA HONESTY RULE:
If a section has NO data from any source, output [] or "Not documented".
NEVER say "fever" if no fever documented.
NEVER say "cough" if no cough documented.

PATIENT DEMOGRAPHICS:
{json.dumps(demo, indent=2, default=str)}

SPECIALTY: {specialty}

═══════════════════════════════════════════════════════════
SOURCE 1 — Neo4j OP Graph Documents (pre-admission, chronological):
{json.dumps(op_docs, indent=2, default=str)}

SOURCE 2 — OP Diagnosis History (from diagnosis API, latest first):
{json.dumps(op_diag_history, indent=2, default=str)}

SOURCE 3 — Latest Clinical Notes:
{json.dumps(latest_clin_notes, indent=2, default=str)}

SOURCE 4 — Latest Investigation Notes:
{json.dumps(latest_inv_notes, indent=2, default=str)}

SOURCE 5 — Latest Medication Analysis:
{json.dumps(latest_med_anal, indent=2, default=str)}

SOURCE 6 — Latest Treatment Plan:
{json.dumps(latest_tx_plan, indent=2, default=str)}

SOURCE 7 — Latest Treatment Summary:
{json.dumps(latest_tx_summary, indent=2, default=str)}

SOURCE 8 — All Documentation Features (keyed by feature_id):
{json.dumps(feature_map, indent=2, default=str)}
═══════════════════════════════════════════════════════════

TASK: Extract complete, structured OP History from ALL sources above.

CRITICAL RULE — DIAGNOSIS:
  Do NOT produce one diagnosis per report.
  Synthesize ALL evidence across all reports into ONE unified diagnosis section.
  The diagnosis section represents what is known from EVERYTHING combined.
  If multiple diagnoses exist, list them all.

SECTION 1 — CHIEF COMPLAINTS (per visit/document)
  For each visit or document source: complaint, date, source.

SECTION 2 — UNIFIED OP DIAGNOSES (from ALL reports combined)
  One list representing all diagnoses established across ALL OP records.
  For each: diagnosis name, date confirmed, confirmation method, source evidence.
  If insufficient data → flag: "Insufficient OP Clinical Data"

SECTION 3 — OP DOCTOR PLANS (per visit)
  All management plans: investigations ordered, medications prescribed,
  referrals, procedures planned.

SECTION 4 — OP INVESTIGATIONS & RESULTS
  All tests, imaging, pathology done in OP period with findings.

SECTION 5 — OP MEDICATIONS
  All medications prescribed: drug, dose, frequency, start date, reason.

SECTION 6 — OP CLINICAL TRAJECTORY
  How was the condition evolving? Worsening/Stable/Improving/Fluctuating with evidence.

SECTION 7 — DATA QUALITY FLAGS
  If any OP data is missing or insufficient → explicitly flag here.

Return ONLY valid JSON:
{{
  "op_summary_available": true,
  "total_op_documents_analyzed": {len(op_docs)},
  "data_quality_flag": "Complete|Insufficient OP Clinical Data|Partial",
  "op_visit_dates": ["..."],
  "chief_complaints": [
    {{
      "complaint": "...",
      "date": "...",
      "source_document": "..."
    }}
  ],
  "unified_diagnoses": [
    {{
      "diagnosis": "...",
      "date_confirmed": "...",
      "confirmation_method": "clinical|imaging|lab|biopsy|histopathology|not documented",
      "source_documents": ["..."],
      "evidence_text": "...",
      "confidence": "High|Moderate|Low"
    }}
  ],
  "op_doctor_plans": [
    {{
      "plan": "...",
      "plan_type": "investigation|medication|referral|procedure|follow_up|other",
      "date": "...",
      "source_document": "..."
    }}
  ],
  "op_investigations": [
    {{
      "test_name": "...",
      "date": "...",
      "result": "...",
      "clinical_significance": "..."
    }}
  ],
  "op_medications": [
    {{
      "drug_name": "...",
      "dose": "...",
      "frequency": "...",
      "start_date": "...",
      "reason": "..."
    }}
  ],
  "op_clinical_trajectory": {{
    "trend": "Worsening|Stable|Improving|Fluctuating|Unknown",
    "narrative": "...",
    "key_progression_events": ["..."]
  }},
  "op_summary_one_line": "..."
}}
"""
        state["op_history"] = await self._invoke(system, prompt)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A1 · OP TREATMENT JOURNEY AGENT
# ============================================================

class OPTreatmentJourneyAgent(BaseAgent):
    """
    Extracts the complete OP treatment journey:
    - Treatments already tried (with response: Improved/No response/Worsened)
    - Failed therapies
    - EXPLICIT escalation reason classification
    Escalation reason categories:
      FAILED_OUTPATIENT_MANAGEMENT | ACUTE_DETERIORATION |
      PROCEDURE_INTERVENTION_NEEDED | MONITORING_REQUIREMENT |
      SURGICAL_PLANNING | DIAGNOSTIC_WORKUP | OTHER
    """

    agent_id = "A1"

    async def run(self, state: IPOnboardingState) -> IPOnboardingState:
        logger.info(f"{self.agent_id} · OPTreatmentJourneyAgent — START")
        t0 = datetime.now().timestamp()

        op_history        = state.get("op_history", {})
        op_docs           = state["op_graph_docs"]
        admission_record  = state.get("admission_record", {})
        latest_tx_plan    = state.get("latest_treatment_plan")
        latest_tx_summary = state.get("latest_treatment_summary")
        latest_med_anal   = state.get("latest_medication_analysis")
        op_diag_history   = state.get("op_diagnosis_history", [])
        specialty         = state["specialty"]
        demo              = state.get("patient_demo", {})

        neo4j_med  = sorted(state.get("neo4j_medications", set()))
        neo4j_proc = sorted(state.get("neo4j_procedures", set()))

        system = (
            "You are a senior clinician reconstructing the complete OP treatment journey "
            "for a patient being admitted as IP. You explicitly classify the escalation reason. "
            "If data is insufficient to determine escalation reason, mark 'Needs Doctor Input'. "
            "Always respond with valid JSON only."
        )

        prompt = f"""
GROUNDING: Valid medications: {neo4j_med} | Valid procedures: {neo4j_proc}

PATIENT DEMOGRAPHICS:
{json.dumps(demo, indent=2, default=str)}

SPECIALTY: {specialty}

OP HISTORY SUMMARY (A0):
{json.dumps(op_history, indent=2, default=str)}

OP GRAPH DOCS (treatment/procedure entities):
{json.dumps(op_docs, indent=2, default=str)}

ADMISSION RECORD (admission reason / chief complaint):
{json.dumps(admission_record, indent=2, default=str)}

LATEST TREATMENT PLAN:
{json.dumps(latest_tx_plan, indent=2, default=str)}

LATEST TREATMENT SUMMARY:
{json.dumps(latest_tx_summary, indent=2, default=str)}

LATEST MEDICATION ANALYSIS:
{json.dumps(latest_med_anal, indent=2, default=str)}

OP DIAGNOSIS HISTORY:
{json.dumps(op_diag_history, indent=2, default=str)}

TASK: Extract the complete OP Treatment Journey and classify escalation reason.

SECTION 1 — TREATMENTS TRIED IN OP
  Every treatment attempted in OP setting.
  For each: treatment name, type (medication/procedure/intervention),
  start date, end date, dose/details, outcome (Improved/No response/Worsened/Unknown).

SECTION 2 — TREATMENT RESPONSE SUMMARY
  Overall treatment response pattern.
  Which treatments helped, which failed.

SECTION 3 — ESCALATION REASON (MANDATORY)
  WHY was this patient escalated from OP to IP?
  Classify as ONE of:
    FAILED_OUTPATIENT_MANAGEMENT — OP treatments not working
    ACUTE_DETERIORATION — sudden worsening requiring urgent IP
    PROCEDURE_INTERVENTION_NEEDED — procedure requiring IP setting
    MONITORING_REQUIREMENT — needs continuous IP monitoring
    SURGICAL_PLANNING — surgical procedure planned
    DIAGNOSTIC_WORKUP — diagnostic workup requiring IP
    OTHER — specify
  
  If derivable from data → provide evidence.
  If NOT derivable → set escalation_derivable: false and flag "Needs Doctor Input".

SECTION 4 — FAILED THERAPIES
  Any treatments that clearly failed or were inadequate.

Return ONLY valid JSON:
{{
  "treatments_tried": [
    {{
      "treatment": "...",
      "type": "Medication|Procedure|Intervention|Chemotherapy|Radiotherapy|Other",
      "details": "...",
      "start_date": "...",
      "end_date": "...",
      "outcome": "Improved|No response|Worsened|Ongoing|Unknown",
      "outcome_evidence": "..."
    }}
  ],
  "treatment_response_summary": {{
    "overall_response": "Good|Partial|Poor|Not assessed",
    "narrative": "...",
    "effective_treatments": ["..."],
    "ineffective_treatments": ["..."]
  }},
  "escalation_reason": {{
    "primary_classification": "FAILED_OUTPATIENT_MANAGEMENT|ACUTE_DETERIORATION|PROCEDURE_INTERVENTION_NEEDED|MONITORING_REQUIREMENT|SURGICAL_PLANNING|DIAGNOSTIC_WORKUP|OTHER",
    "secondary_classifications": ["..."],
    "escalation_derivable": true,
    "doctor_input_required": false,
    "specific_reason": "...",
    "evidence": "...",
    "clinical_narrative": "..."
  }},
  "failed_therapies": [
    {{
      "therapy": "...",
      "reason_for_failure": "...",
      "date": "..."
    }}
  ],
  "treatment_journey_summary": "..."
}}
"""
        state["op_treatment_journey"] = await self._invoke(system, prompt)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A2 · OP → IP TRANSITION REASONER
# ============================================================

class OPToIPTransitionReasonerAgent(BaseAgent):
    """
    Synthesizes a structured, clinically justified OP→IP transition analysis.
    Integrates treatment journey escalation reason with admission record context.
    """

    agent_id = "A2"

    async def run(self, state: IPOnboardingState) -> IPOnboardingState:
        logger.info(f"{self.agent_id} · OPToIPTransitionReasonerAgent — START")
        t0 = datetime.now().timestamp()

        op_history           = state.get("op_history", {})
        op_treatment_journey = state.get("op_treatment_journey", {})
        admission_record     = state.get("admission_record", {})
        specialty            = state["specialty"]
        demo                 = state.get("patient_demo", {})

        system = (
            "You are a senior physician producing a definitive, evidence-based justification "
            "for a patient's OP → IP transition. You integrate clinical trajectory, treatment response, "
            "and admission context. Always respond with valid JSON only."
        )

        prompt = f"""
PATIENT DEMOGRAPHICS:
{json.dumps(demo, indent=2, default=str)}

SPECIALTY: {specialty}

OP HISTORY (A0):
{json.dumps(op_history, indent=2, default=str)}

OP TREATMENT JOURNEY (A1 — includes escalation reason):
{json.dumps(op_treatment_journey, indent=2, default=str)}

IP ADMISSION RECORD:
{json.dumps(admission_record, indent=2, default=str)}

TASK: Produce a structured OP → IP Transition Analysis.

SECTION 1 — PRIMARY REASON FOR ADMISSION
  Specific, evidence-based reason (not generic).
  Reference actual findings, diagnoses, test results.
  Classify: Planned | Unplanned | Diagnostic

SECTION 2 — CLINICAL JUSTIFICATION CRITERIA
  Specific clinical criteria met for inpatient admission:
  (e.g., "requires IV chemotherapy", "needs histopathological staging",
  "failed outpatient cisplatin", "tumor requiring surgical resection", etc.)

SECTION 3 — DIAGNOSIS PROGRESSION
  OP working diagnosis → IP admission diagnosis.
  Has it changed, refined, or confirmed?

SECTION 4 — URGENCY CLASSIFICATION
  Elective | Semi-elective | Urgent | Emergency with rationale.

SECTION 5 — EXPECTED IP CLINICAL COURSE
  Primary procedures/treatments planned, estimated LOS, key milestones, risks.

Return ONLY valid JSON:
{{
  "admission_type_clinical": "Planned|Unplanned|Diagnostic",
  "primary_reason_for_admission": "...",
  "primary_reason_detailed": "...",
  "clinical_justification_criteria": [
    {{
      "criterion": "...",
      "evidence": "...",
      "source": "..."
    }}
  ],
  "op_working_diagnosis": "...",
  "ip_admission_diagnosis": "...",
  "diagnosis_evolution": "Same|Refined|Changed|New|Unknown",
  "diagnosis_evolution_explanation": "...",
  "urgency": "Elective|Semi-elective|Urgent|Emergency",
  "urgency_rationale": "...",
  "expected_ip_course": {{
    "primary_planned_procedures": ["..."],
    "primary_planned_treatments": ["..."],
    "estimated_los_days": "...",
    "key_milestones_before_discharge": ["..."],
    "anticipated_challenges": ["..."]
  }},
  "transition_narrative": "..."
}}
"""
        state["transition_context"] = await self._invoke(system, prompt)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A3 · IP ADMISSION CONTEXT AGENT
# ============================================================

class IPAdmissionContextAgent(BaseAgent):
    """
    Extracts structured IP admission logistics, vitals, current condition,
    and all documents since admission.
    """

    agent_id = "A3"

    async def run(self, state: IPOnboardingState) -> IPOnboardingState:
        logger.info(f"{self.agent_id} · IPAdmissionContextAgent — START")
        t0 = datetime.now().timestamp()

        ip_docs          = state["ip_graph_docs"]
        admission_record = state.get("admission_record", {})
        op_history       = state.get("op_history", {})
        demo             = state.get("patient_demo", {})
        specialty        = state["specialty"]
        latest_inv_notes = state.get("latest_investigation_notes")

        system = (
            "You are a senior clinician extracting structured IP admission details "
            "from graph records and appointment data. Always respond with valid JSON only."
        )

        prompt = f"""
PATIENT DEMOGRAPHICS:
{json.dumps(demo, indent=2, default=str)}

SPECIALTY: {specialty}

IP ADMISSION RECORD (from appointments DB — includes chief_complaint):
{json.dumps(admission_record, indent=2, default=str)}

OP HISTORY (for context):
{json.dumps(op_history, indent=2, default=str)}

IP GRAPH DOCUMENTS (from admission date onwards):
{json.dumps(ip_docs, indent=2, default=str)}
PATIENT VITALS (Merged from Mongo + Neo4j, latest first):
{json.dumps(state.get("patient_vitals", []), indent=2, default=str)}
LATEST INVESTIGATION NOTES:
{json.dumps(latest_inv_notes, indent=2, default=str)}

TASK: Extract structured IP Admission Context.

SECTION 1 — ADMISSION LOGISTICS
  Date, type (Ward/Room/ICU), location, department, admitting doctor,
  chief complaint at admission, patient status.

SECTION 2 — CURRENT CONDITION ON ADMISSION
  General condition, active complaints, active diagnoses, acute findings.

SECTION 3 — CURRENT VITALS (STRICT RULE)

You MUST extract vitals ONLY from PATIENT VITALS input.

Rules:
- Always pick LATEST value per parameter
- Never say "Not documented" if data exists
- Only say "Not available" if truly missing
- Include date and units
- Mark Normal / Abnormal clinically

SECTION 4 — DOCUMENTS & INVESTIGATIONS SINCE ADMISSION
  All documents, labs, imaging, pathology from admission onwards.
  Document name, type, date, key findings, clinical significance.

SECTION 5 — CURRENT MEDICATIONS ON ADMISSION
  Active medications at admission (OP continuations + new IP prescriptions).

Return ONLY valid JSON:
{{
  "admission_logistics": {{
    "admission_date": "...",
    "admission_type": "Ward|Room|ICU|Not documented",
    "location_detail": "...",
    "department": "...",
    "specialty": "...",
    "admitting_doctor_id": "...",
    "chief_complaint_at_admission": "...",
    "patient_status": "Admitted|Pending|Not documented"
  }},
  "current_condition_on_admission": {{
    "general_condition": "Stable|Guarded|Serious|Critical|Not documented",
    "active_complaints": ["..."],
    "active_diagnoses": [
      {{
        "diagnosis": "...",
        "status": "Confirmed|Working|Suspected",
        "date": "..."
      }}
    ],
    "acute_findings": ["..."]
  }},

  "current_documents": [
    {{
      "document_name": "...",
      "document_type": "Lab|Imaging|HPR|Procedure|Consultation|Other",
      "date": "...",
      "key_findings": ["..."],
      "clinical_significance": "..."
    }}
  ],
  "current_medications": [
    {{
      "drug_name": "...",
      "dose": "...",
      "frequency": "...",
      "route": "...",
      "indication": "...",
      "source": "OP_continuation|New_IP_prescription"
    }}
  ]
}}
"""
        state["admission_context"] = await self._invoke(system, prompt)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A4 · IP CLINICAL SUMMARY AGENT
# ============================================================

class IPClinicalSummaryAgent(BaseAgent):
    """
    Full integrated clinical summary: OP + IP data combined.
    Produces problem list, working diagnosis, clinical timeline.
    """

    agent_id = "A4"

    async def run(self, state: IPOnboardingState) -> IPOnboardingState:
        logger.info(f"{self.agent_id} · IPClinicalSummaryAgent — START")
        t0 = datetime.now().timestamp()

        specialty            = state["specialty"]
        demo                 = state.get("patient_demo", {})
        op_history           = state.get("op_history", {})
        op_treatment_journey = state.get("op_treatment_journey", {})
        transition_context   = state.get("transition_context", {})
        admission_context    = state.get("admission_context", {})
        all_ip_docs          = state["ip_graph_docs"]
        latest_clin_notes    = state.get("latest_clinical_notes")
        op_diag_history      = state.get("op_diagnosis_history", [])

        neo4j_diag = sorted(state.get("neo4j_diagnoses", set()))
        neo4j_med  = sorted(state.get("neo4j_medications", set()))

        system = (
            f"You are a senior {specialty} specialist writing a comprehensive IP clinical summary "
            "for the multidisciplinary IP team. Integrate ALL available OP and IP data. "
            "Always respond with valid JSON only."
        )

        prompt = f"""
GROUNDING: Valid diagnoses: {neo4j_diag} | Valid medications: {neo4j_med}

PATIENT DEMOGRAPHICS:
{json.dumps(demo, indent=2, default=str)}

SPECIALTY: {specialty}

OP HISTORY (A0):
{json.dumps(op_history, indent=2, default=str)}

OP TREATMENT JOURNEY (A1):
{json.dumps(op_treatment_journey, indent=2, default=str)}

OP→IP TRANSITION (A2):
{json.dumps(transition_context, indent=2, default=str)}

ADMISSION CONTEXT (A3):
{json.dumps(admission_context, indent=2, default=str)}

LATEST CLINICAL NOTES:
{json.dumps(latest_clin_notes, indent=2, default=str)}

OP DIAGNOSIS HISTORY (API):
{json.dumps(op_diag_history, indent=2, default=str)}

ALL IP GRAPH DOCUMENTS:
{json.dumps(all_ip_docs, indent=2, default=str)}

TASK: Produce a comprehensive integrated IP Clinical Summary.

SECTION 1 — PATIENT OVERVIEW (demographics, blood group, allergies)

SECTION 2 — PREVIOUS OP SUMMARY
  a) Chief Complaints (per visit)
  b) Unified Diagnoses (all reports combined — NOT one per report)
  c) Doctor Plans (per visit)
  d) Clinical Trajectory

SECTION 3 — REASON FOR OP → IP (structured, specific, evidence-based)

SECTION 4 — IP ADMISSION DETAILS (logistics)

SECTION 5 — CURRENT CLINICAL PICTURE
  Primary IP diagnosis, problem list, comorbidities, clinical status, medications

SECTION 6 — CLINICAL TIMELINE (chronological: first OP → current IP)

Return ONLY valid JSON:
{{
  "patient_overview": {{
    "patient_id": "...",
    "name": "...",
    "age": "...",
    "sex": "...",
    "blood_group": "...",
    "allergies": ["..."],
    "phone": "..."
  }},
  "previous_op_summary": {{
    "chief_complaints": [
      {{"complaint": "...", "date": "...", "source_document": "..."}}
    ],
    "unified_diagnoses": [
      {{
        "diagnosis": "...",
        "date_confirmed": "...",
        "confirmation_method": "...",
        "evidence": "..."
      }}
    ],
    "op_doctor_plans": [
      {{"plan": "...", "date": "...", "plan_type": "..."}}
    ],
    "op_clinical_trajectory": "..."
  }},
  "reason_for_op_to_ip_admission": {{
    "primary_reason": "...",
    "clinical_justification": "...",
    "specific_triggers": ["..."],
    "admission_urgency": "Elective|Semi-elective|Urgent|Emergency",
    "admission_type_clinical": "Planned|Unplanned|Diagnostic"
  }},
  "ip_admission_details": {{
    "admission_date": "...",
    "admission_type": "Ward|Room|ICU",
    "location": "...",
    "department": "...",
    "admitting_diagnosis": "...",
    "chief_complaint_at_admission": "..."
  }},
  "current_clinical_picture": {{
    "primary_ip_diagnosis": "...",
    "diagnosis_status": "Confirmed|Working|Suspected",
    "active_problems": ["..."],
    "relevant_comorbidities": [
      {{"condition": "...", "relevance_to_ip_management": "..."}}
    ],
    "clinical_status": "Stable|Guarded|Serious|Critical",
    "current_medications": ["..."]
  }},
  "clinical_timeline": [
    {{
      "date": "...",
      "event": "...",
      "significance": "...",
      "care_setting": "OP|IP"
    }}
  ],
  "ip_clinical_summary_narrative": "..."
}}
"""
        state["clinical_summary"] = await self._invoke(system, prompt)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A5 · CLINICAL RISK STRATIFICATION ENGINE
# ============================================================

class ClinicalRiskStratificationAgent(BaseAgent):
    """
    AUTO-GENERATED clinical risk stratification:
    - MEWS (Modified Early Warning Score)
    - NEWS (National Early Warning Score)
    - Comorbidity risk flags
    - Red flag symptoms
    - Overall risk level with explainability
    """

    agent_id = "A5"

    async def run(self, state: IPOnboardingState) -> IPOnboardingState:
        logger.info(f"{self.agent_id} · ClinicalRiskStratificationAgent — START")
        t0 = datetime.now().timestamp()

        admission_context = state.get("admission_context", {})
        clinical_summary  = state.get("clinical_summary", {})
        op_history        = state.get("op_history", {})
        specialty         = state["specialty"]
        demo              = state.get("patient_demo", {})

        system = (
            "You are a senior intensivist and clinical risk specialist computing an "
            "automated risk stratification for an IP patient. "
            "You compute MEWS, NEWS scores from available vitals, identify high-risk comorbidities, "
            "red flag symptoms, and provide explainability for every flag. "
            "If vitals are missing, use available clinical context to estimate risk band. "
            "Always respond with valid JSON only."
        )

        prompt = f"""
PATIENT DEMOGRAPHICS:
{json.dumps(demo, indent=2, default=str)}

SPECIALTY: {specialty}

ADMISSION CONTEXT (A3 — includes current vitals):
{json.dumps(admission_context, indent=2, default=str)}

CLINICAL SUMMARY (A4 — problem list, comorbidities, diagnoses):
{json.dumps(clinical_summary, indent=2, default=str)}

OP HISTORY (A0 — for comorbidity context):
{json.dumps(op_history, indent=2, default=str)}

TASK: Compute automated clinical risk stratification.

⚠️ MISSING DATA HANDLING:
- If vitals are missing from PATIENT VITALS input:
  * Set total_mews = "Cannot compute - insufficient data"
  * Set total_news = "Cannot compute - insufficient data"  
  * Set risk_band = "Insufficient Data for Assessment"
  * In interpretation state: "Risk assessment limited due to missing vital signs"
- DO NOT assume normal values or invent vitals
- If some vitals present and some missing, compute partial score and note limitations

SECTION 1 — MEWS CALCULATION
  Modified Early Warning Score from available vitals:
  Respiratory Rate, Heart Rate, Systolic BP, Consciousness (AVPU), Temperature.
  Score each 0-3 per parameter, sum for total MEWS.
  If a vital is missing: use "Not available" and explain impact on scoring.
  MEWS interpretation: 0-2 Low, 3-4 Moderate, ≥5 High risk.

SECTION 2 — NEWS CALCULATION
  National Early Warning Score:
  SpO2, Supplemental O2 (Y/N), Temp, Systolic BP, HR, RR, Consciousness.
  Score per parameter, sum for total NEWS.
  NEWS interpretation: 0-4 Low, 5-6 Medium, ≥7 High.

SECTION 3 — HIGH-RISK COMORBIDITIES
  Identify comorbidities that elevate IP risk for this specific patient.
  For each: comorbidity, why it elevates risk, management implication.

SECTION 4 — RED FLAG SYMPTOMS/FINDINGS
  Any red flags currently present or at risk.
  For each: red flag, evidence from records, clinical implication, urgency.

SECTION 5 — OVERALL RISK LEVEL
  High | Moderate | Low with FULL explainability (not generic).
  Which specific clinical factors drove this assessment.

SECTION 6 — PRIORITY FLAGS
  Top 3-5 items the IP team must act on IMMEDIATELY or within first 24 hours.

Return ONLY valid JSON:
{{
  "mews": {{
    "respiratory_rate_score": {{"value": "...", "score": 0, "notes": "..."}},
    "heart_rate_score": {{"value": "...", "score": 0, "notes": "..."}},
    "systolic_bp_score": {{"value": "...", "score": 0, "notes": "..."}},
    "consciousness_score": {{"value": "...", "score": 0, "notes": "..."}},
    "temperature_score": {{"value": "...", "score": 0, "notes": "..."}},
    "total_mews": 0,
    "risk_band": "Low|Moderate|High",
    "interpretation": "...",
    "data_completeness": "Complete|Partial|Insufficient"
  }},
  "news": {{
    "spo2_score": {{"value": "...", "score": 0, "notes": "..."}},
    "supplemental_o2_score": {{"value": "...", "score": 0, "notes": "..."}},
    "temperature_score": {{"value": "...", "score": 0, "notes": "..."}},
    "systolic_bp_score": {{"value": "...", "score": 0, "notes": "..."}},
    "heart_rate_score": {{"value": "...", "score": 0, "notes": "..."}},
    "respiratory_rate_score": {{"value": "...", "score": 0, "notes": "..."}},
    "consciousness_score": {{"value": "...", "score": 0, "notes": "..."}},
    "total_news": 0,
    "risk_band": "Low|Medium|High",
    "interpretation": "...",
    "data_completeness": "Complete|Partial|Insufficient"
  }},
  "high_risk_comorbidities": [
    {{
      "comorbidity": "...",
      "risk_mechanism": "...",
      "management_implication": "...",
      "severity": "High|Moderate|Low"
    }}
  ],
  "red_flags": [
    {{
      "red_flag": "...",
      "present": true,
      "evidence": "...",
      "clinical_implication": "...",
      "urgency": "IMMEDIATE|Within 1h|Within 4h|Monitor"
    }}
  ],
  "overall_risk": {{
    "level": "Low|Moderate|High|Critical",
    "explainability": "...",
    "key_risk_drivers": ["..."],
    "clinical_justification": "..."
  }},
  "priority_flags": [
    {{
      "flag": "...",
      "reason": "...",
      "action": "...",
      "timeframe": "..."
    }}
  ],
  "risk_stratification_summary": "..."
}}
"""
        state["risk_stratification"] = await self._invoke(system, prompt)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A6 · CRITICAL CONDITIONS AGENT
# ============================================================

class CriticalConditionsAgent(BaseAgent):
    """
    Identifies critical clinical conditions + warning indicators
    specific to THIS patient. Not generic.
    """

    agent_id = "A6"

    async def run(self, state: IPOnboardingState) -> IPOnboardingState:
        logger.info(f"{self.agent_id} · CriticalConditionsAgent — START")
        t0 = datetime.now().timestamp()

        clinical_summary     = state.get("clinical_summary", {})
        risk_stratification  = state.get("risk_stratification", {})
        admission_context    = state.get("admission_context", {})
        transition_context   = state.get("transition_context", {})
        op_history           = state.get("op_history", {})
        specialty            = state["specialty"]

        system = (
            "You are an intensivist identifying critical clinical conditions and warning indicators "
            "for THIS specific IP patient. Every flag must be grounded in actual clinical data. "
            "No generic outputs. Always respond with valid JSON only."
        )

        prompt = f"""
SPECIALTY: {specialty}

CLINICAL SUMMARY (A4):
{json.dumps(clinical_summary, indent=2, default=str)}

RISK STRATIFICATION (A5 — MEWS/NEWS/Red flags):
{json.dumps(risk_stratification, indent=2, default=str)}

ADMISSION CONTEXT (A3):
{json.dumps(admission_context, indent=2, default=str)}

TRANSITION CONTEXT (A2):
{json.dumps(transition_context, indent=2, default=str)}

OP HISTORY (A0):
{json.dumps(op_history, indent=2, default=str)}

TASK: Identify all critical conditions and warning indicators for THIS patient.

SECTION 1 — CRITICAL CONDITIONS
  Conditions that could worsen rapidly, require immediate intervention,
  or are life-threatening if missed.
  Priority: IMMEDIATE | HIGH | MODERATE.

SECTION 2 — CRITICAL WARNING INDICATORS
  Specific measurable thresholds — when crossed → escalate immediately.
  Escalation level: Nurse | Senior Resident | Attending | ICU.

SECTION 3 — CONDITIONS TO WATCH
  Conditions that need close monitoring but are not yet critical.

SECTION 4 — IMMEDIATE ACTIONS (next 1-4 hours)

Return ONLY valid JSON:
{{
  "critical_conditions": [
    {{
      "condition": "...",
      "why_critical": "...",
      "supporting_evidence": "...",
      "current_status": "Active|Monitoring|Stabilized",
      "priority": "IMMEDIATE|HIGH|MODERATE",
      "system_involved": "...",
      "time_sensitivity": "Now|1-4h|4-24h|Watchful"
    }}
  ],
  "critical_warning_indicators": [
    {{
      "indicator": "...",
      "warning_threshold": "...",
      "clinical_meaning": "...",
      "immediate_action": "...",
      "time_to_act": "...",
      "escalation_level": "Nurse|Senior Resident|Attending|ICU"
    }}
  ],
  "conditions_to_watch": [
    {{
      "condition": "...",
      "rationale": "...",
      "monitoring_approach": "..."
    }}
  ],
  "immediate_actions_required": [
    {{
      "action": "...",
      "reason": "...",
      "timeframe": "...",
      "responsible": "Doctor|Nurse|Both"
    }}
  ],
  "critical_summary": "..."
}}
"""
        state["critical_conditions"] = await self._invoke(system, prompt)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A7 · MONITORING PLAN AGENT
# ============================================================

class MonitoringPlanAgent(BaseAgent):
    """
    Generates an individualized monitoring plan:
    Parameter | Frequency | Normal Range | Warning Threshold | Action
    """

    agent_id = "A7"

    async def run(self, state: IPOnboardingState) -> IPOnboardingState:
        logger.info(f"{self.agent_id} · MonitoringPlanAgent — START")
        t0 = datetime.now().timestamp()

        clinical_summary    = state.get("clinical_summary", {})
        critical_conditions = state.get("critical_conditions", {})
        risk_stratification = state.get("risk_stratification", {})
        admission_context   = state.get("admission_context", {})
        specialty           = state["specialty"]

        system = (
            "You are a senior clinician defining an individualized monitoring protocol "
            "for THIS IP patient. Tailor every parameter to THIS patient's diagnoses and risks. "
            "No generic monitoring plans. Always respond with valid JSON only."
        )

        prompt = f"""
SPECIALTY: {specialty}

CLINICAL SUMMARY (A4):
{json.dumps(clinical_summary, indent=2, default=str)}

CRITICAL CONDITIONS (A6):
{json.dumps(critical_conditions, indent=2, default=str)}

RISK STRATIFICATION (A5):
{json.dumps(risk_stratification, indent=2, default=str)}

ADMISSION CONTEXT (A3 — current vitals):
{json.dumps(admission_context, indent=2, default=str)}

TASK: Create individualized monitoring plan with structure:
Parameter | Frequency | Normal Range | Warning Threshold | Action

SECTION 1 — VITAL SIGNS MONITORING
SECTION 2 — LABORATORY MONITORING
SECTION 3 — DISEASE-SPECIFIC MONITORING (tied to primary IP diagnosis)
SECTION 4 — MEDICATION MONITORING (for active IP medications)
SECTION 5 — CLINICAL SIGN MONITORING (non-measurable observations)
SECTION 6 — IMAGING / PROCEDURE FOLLOW-UP

Return ONLY valid JSON:
{{
  "monitoring_acuity": "Standard|Enhanced|Intensive|Critical",
  "vital_signs": [
    {{
      "parameter": "...",
      "clinical_justification": "...",
      "frequency": "...",
      "normal_range": "...",
      "warning_threshold": "...",
      "action_on_breach": "...",
      "current_value": "..."
    }}
  ],
  "laboratory_parameters": [
    {{
      "parameter": "...",
      "clinical_justification": "...",
      "frequency": "...",
      "normal_range": "...",
      "target_for_this_patient": "...",
      "warning_threshold": "...",
      "action_on_breach": "..."
    }}
  ],
  "disease_specific_parameters": [
    {{
      "parameter": "...",
      "relevant_to": "...",
      "frequency": "...",
      "normal_range": "...",
      "clinical_significance": "..."
    }}
  ],
  "medication_monitoring": [
    {{
      "medication": "...",
      "parameter_to_monitor": "...",
      "frequency": "...",
      "target_range": "...",
      "toxicity_threshold": "..."
    }}
  ],
  "clinical_sign_monitoring": [
    {{
      "sign": "...",
      "frequency": "...",
      "what_to_look_for": "...",
      "escalation_trigger": "..."
    }}
  ],
  "imaging_procedure_followup": [
    {{
      "investigation": "...",
      "when": "...",
      "purpose": "..."
    }}
  ],
  "monitoring_summary": "..."
}}
"""
        state["monitoring_plan"] = await self._invoke(system, prompt)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A8 · IP CARE PLAN AGENT
# ============================================================

class IPCarePlanAgent(BaseAgent):
    """
    Generates a comprehensive, step-by-step IP care plan
    based on ALL clinical context. No predefined templates.
    """

    agent_id = "A8"

    async def run(self, state: IPOnboardingState) -> IPOnboardingState:
        logger.info(f"{self.agent_id} · IPCarePlanAgent — START")
        t0 = datetime.now().timestamp()

        clinical_summary     = state.get("clinical_summary", {})
        critical_conditions  = state.get("critical_conditions", {})
        monitoring_plan      = state.get("monitoring_plan", {})
        transition_context   = state.get("transition_context", {})
        op_treatment_journey = state.get("op_treatment_journey", {})
        admission_context    = state.get("admission_context", {})
        risk_stratification  = state.get("risk_stratification", {})
        specialty            = state["specialty"]

        neo4j_diag = sorted(state.get("neo4j_diagnoses", set()))
        neo4j_med  = sorted(state.get("neo4j_medications", set()))
        neo4j_proc = sorted(state.get("neo4j_procedures", set()))

        system = (
            f"You are a senior {specialty} specialist writing a detailed, step-by-step "
            "IP care plan for THIS specific patient. Every item must be grounded in clinical data. "
            "No generic or template outputs. Always respond with valid JSON only."
        )

        prompt = f"""
GROUNDING: Diagnoses: {neo4j_diag} | Medications: {neo4j_med} | Procedures: {neo4j_proc}

SPECIALTY: {specialty}

CLINICAL SUMMARY (A4):
{json.dumps(clinical_summary, indent=2, default=str)}

CRITICAL CONDITIONS (A6):
{json.dumps(critical_conditions, indent=2, default=str)}

MONITORING PLAN (A7):
{json.dumps(monitoring_plan, indent=2, default=str)}

TRANSITION CONTEXT (A2 — expected IP course):
{json.dumps(transition_context, indent=2, default=str)}

OP TREATMENT JOURNEY (A1 — what was tried, escalation reason):
{json.dumps(op_treatment_journey, indent=2, default=str)}

ADMISSION CONTEXT (A3):
{json.dumps(admission_context, indent=2, default=str)}

RISK STRATIFICATION (A5):
{json.dumps(risk_stratification, indent=2, default=str)}

TASK: Write a complete, individualized, step-by-step IP Care Plan.

STEP 1 — IMMEDIATE (0-6 hours) — prioritized by urgency
STEP 2 — DAY 1 PLAN
STEP 3 — DIAGNOSTIC WORKUP (pending investigations)
STEP 4 — TREATMENT PLAN (active treatments with indication/details)
STEP 5 — PROCEDURE/SURGICAL PLAN (if applicable)
STEP 6 — CONSULTATIONS REQUIRED
STEP 7 — NUTRITION & FLUID PLAN
STEP 8 — REHABILITATION / ALLIED HEALTH
STEP 9 — DISCHARGE PLANNING (criteria, follow-up, patient education)

Return ONLY valid JSON:
{{
  "immediate_actions_0_6h": [
    {{
      "step": 1,
      "action": "...",
      "reason": "...",
      "priority": "CRITICAL|HIGH|ROUTINE",
      "responsible": "Doctor|Nurse|Both"
    }}
  ],
  "day_1_plan": [
    {{
      "item": "...",
      "category": "Investigation|Medication|Monitoring|Consultation|Procedure|Other",
      "details": "...",
      "timing": "..."
    }}
  ],
  "diagnostic_workup": [
    {{
      "investigation": "...",
      "purpose": "...",
      "urgency": "STAT|Urgent|Routine",
      "when_to_order": "...",
      "expected_impact_on_management": "..."
    }}
  ],
  "treatment_plan": [
    {{
      "treatment": "...",
      "type": "Medication|Procedure|Intervention|Chemotherapy|Radiotherapy|Other",
      "indication": "...",
      "details": "...",
      "duration": "...",
      "response_assessment": "..."
    }}
  ],
  "procedure_surgical_plan": [
    {{
      "procedure": "...",
      "indication": "...",
      "planned_timing": "...",
      "pre_procedure_requirements": ["..."],
      "post_procedure_monitoring": ["..."]
    }}
  ],
  "consultations": [
    {{
      "department": "...",
      "reason": "...",
      "urgency": "Urgent|Routine",
      "expected_contribution": "..."
    }}
  ],
  "nutrition_fluid_plan": {{
    "diet_type": "...",
    "nutritional_support": "...",
    "iv_fluids": "...",
    "fluid_restriction": "...",
    "io_monitoring": "..."
  }},
  "rehabilitation_allied_health": [
    {{
      "service": "...",
      "reason": "...",
      "frequency": "..."
    }}
  ],
  "discharge_planning": {{
    "expected_discharge_criteria": ["..."],
    "estimated_los": "...",
    "post_discharge_medications": ["..."],
    "follow_up_plan": "...",
    "patient_education_needed": ["..."]
  }},
  "care_plan_summary": "..."
}}
"""
        state["care_plan"] = await self._invoke(system, prompt)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A9 · INSURANCE & DOCUMENTATION AGENT
# ============================================================

class InsuranceDocumentationAgent(BaseAgent):
    """
    Pre-authorization criteria assessment, ICD-10 coding,
    documentation gaps, cost estimation.
    """

    agent_id = "A9"

    async def run(self, state: IPOnboardingState) -> IPOnboardingState:
        logger.info(f"{self.agent_id} · InsuranceDocumentationAgent — START")
        t0 = datetime.now().timestamp()

        clinical_summary  = state.get("clinical_summary", {})
        admission_context = state.get("admission_context", {})
        transition_context= state.get("transition_context", {})
        care_plan         = state.get("care_plan", {})
        latest_clin_notes = state.get("latest_clinical_notes")
        specialty         = state["specialty"]

        system = (
            "You are a clinical documentation specialist evaluating insurance pre-authorization "
            "criteria and documentation requirements. Always respond with valid JSON only."
        )

        prompt = f"""
SPECIALTY: {specialty}

CLINICAL SUMMARY (A4):
{json.dumps(clinical_summary, indent=2, default=str)}

ADMISSION CONTEXT (A3):
{json.dumps(admission_context, indent=2, default=str)}

TRANSITION CONTEXT (A2):
{json.dumps(transition_context, indent=2, default=str)}

CARE PLAN (A8):
{json.dumps(care_plan, indent=2, default=str)}

LATEST CLINICAL NOTES:
{json.dumps(latest_clin_notes, indent=2, default=str)}

TASK: Evaluate insurance, documentation, ICD-10 coding.

SECTION 1 — CLINICAL CRITERIA FOR ADMISSION (met/not met with evidence)
SECTION 2 — PRE-AUTHORIZATION ASSESSMENT
SECTION 3 — REQUIRED DOCUMENTS (with availability status)
SECTION 4 — ICD-10 CODES (primary + secondary, grounded in actual diagnoses)
SECTION 5 — DOCUMENTATION GAPS
SECTION 6 — COST ESTIMATE TIER

Return ONLY valid JSON:
{{
  "clinical_criteria_met": {{
    "medical_necessity": {{"met": true, "evidence": "...", "strength": "Strong|Moderate|Weak"}},
    "severity_criteria": {{"met": true, "evidence": "...", "strength": "Strong|Moderate|Weak"}},
    "procedure_criteria": {{"met": true, "evidence": "...", "procedures": ["..."]}},
    "overall_criteria_met": true
  }},
  "pre_authorization": {{
    "status": "Likely Approved|Conditional|Likely Denied|Unknown",
    "justification_strength": "Strong|Moderate|Weak",
    "supporting_factors": ["..."],
    "denial_risks": ["..."],
    "recommended_actions": ["..."]
  }},
  "required_documents": [
    {{
      "document": "...",
      "purpose": "...",
      "urgency": "Immediate|Within 24h|Within 48h",
      "available": "Yes|No|Partial"
    }}
  ],
  "icd10_codes": {{
    "primary": {{"code": "...", "description": "..."}},
    "secondary": [{{"code": "...", "description": "..."}}],
    "procedure_codes": ["..."]
  }},
  "documentation_gaps": [
    {{"missing_document": "...", "impact": "...", "urgency": "..."}}
  ],
  "cost_estimate": {{
    "tier": "Low|Moderate|High|Very High",
    "key_cost_drivers": ["..."],
    "estimated_los_days": "..."
  }},
  "insurance_summary": "..."
}}
"""
        state["insurance_docs"] = await self._invoke(system, prompt)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A10 · FULL SYNTHESIS AGENT
# ============================================================

class IPOnboardingSynthesisAgent(BaseAgent):
    """
    Assembles the COMPLETE, DEFINITIVE IP Onboarding Summary
    from all 9 agent outputs. Final document for IP team.
    """

    agent_id = "A10"

    async def run(self, state: IPOnboardingState) -> IPOnboardingState:
        logger.info(f"{self.agent_id} · IPOnboardingSynthesisAgent — START")
        t0 = datetime.now().timestamp()

        specialty            = state["specialty"]
        demo                 = state.get("patient_demo", {})
        op_history           = state.get("op_history", {})
        op_treatment_journey = state.get("op_treatment_journey", {})
        transition_context   = state.get("transition_context", {})
        admission_context    = state.get("admission_context", {})
        clinical_summary     = state.get("clinical_summary", {})
        risk_stratification  = state.get("risk_stratification", {})
        critical_conditions  = state.get("critical_conditions", {})
        monitoring_plan      = state.get("monitoring_plan", {})
        care_plan            = state.get("care_plan", {})
        insurance_docs       = state.get("insurance_docs", {})

        neo4j_diag = sorted(state.get("neo4j_diagnoses", set()))
        neo4j_med  = sorted(state.get("neo4j_medications", set()))
        neo4j_proc = sorted(state.get("neo4j_procedures", set()))

        system = (
            f"You are a senior {specialty} specialist assembling the FINAL, DEFINITIVE "
            "IP Onboarding Summary for the complete IP care team. "
            "This is the canonical document before the first IP consultation. "
            "Every section must be patient-specific, grounded in data, and immediately actionable. "
            "CRITICAL: Only use entity names from these whitelists: "
            f"Diagnoses: {neo4j_diag} | Medications: {neo4j_med} | Procedures: {neo4j_proc}. "
            "Always respond with valid JSON only."
        )

        prompt = f"""
STRICT GROUNDING:
Valid diagnoses: {neo4j_diag}
Valid medications: {neo4j_med}
Valid procedures: {neo4j_proc}

PATIENT DEMOGRAPHICS:
{json.dumps(demo, indent=2, default=str)}

[A0 — OP HISTORY]:
{json.dumps(op_history, indent=2, default=str)}

[A1 — OP TREATMENT JOURNEY]:
{json.dumps(op_treatment_journey, indent=2, default=str)}

[A2 — OP→IP TRANSITION]:
{json.dumps(transition_context, indent=2, default=str)}

[A3 — ADMISSION CONTEXT]:
{json.dumps(admission_context, indent=2, default=str)}

[A4 — CLINICAL SUMMARY]:
{json.dumps(clinical_summary, indent=2, default=str)}

[A5 — RISK STRATIFICATION]:
{json.dumps(risk_stratification, indent=2, default=str)}

[A6 — CRITICAL CONDITIONS]:
{json.dumps(critical_conditions, indent=2, default=str)}

[A7 — MONITORING PLAN]:
{json.dumps(monitoring_plan, indent=2, default=str)}

[A8 — CARE PLAN]:
{json.dumps(care_plan, indent=2, default=str)}

[A9 — INSURANCE & DOCS]:
{json.dumps(insurance_docs, indent=2, default=str)}

TASK: Assemble the FINAL IP Onboarding Summary with ALL of these sections:

1. PATIENT HEADER
2. PREVIOUS OP SUMMARY (Chief Complaints | Unified Diagnoses | Doctor Plans | Trajectory)
3. OP TREATMENT JOURNEY (Treatments tried | Response | Escalation reason classified)
4. REASON FOR OP → IP ADMISSION (structured, specific, evidenced)
5. DISEASE PROGRESSION & CLINICAL INSIGHTS (graph-derived insights)
6. IP ADMISSION DETAILS
7. CURRENT CONDITION (vitals, problem list, working diagnosis)
8. CURRENT DOCUMENTS (all since admission)
9. IP CLINICAL SUMMARY NARRATIVE
10. RISK STRATIFICATION (MEWS/NEWS, risk level with explainability, priority flags)
11. CRITICAL CONDITIONS TO WATCH (with warning thresholds and escalation levels)
12. MONITORING PLAN (Parameter | Frequency | Range | Threshold | Action)
13. IP CARE PLAN STEP-BY-STEP
14. INSURANCE & DOCUMENTATION
15. BOTTOM LINE

SYNTHESIS RULES:
• Every item grounded in actual clinical data — no invented entities
• Escalation reason must be explicitly classified (not vague)
• MEWS/NEWS must be computed from actual vitals
• Risk level must include full explainability
• If any section has no data → flag "Insufficient Clinical Data — Needs Doctor Input"

Return ONLY valid JSON:
{{
  "generated_at": "{datetime.now().isoformat()}",
  "patient_header": {{
    "patient_id": "...",
    "name": "...",
    "age": "...",
    "sex": "...",
    "blood_group": "...",
    "allergies": ["..."],
    "phone": "...",
    "admission_date": "...",
    "location": "...",
    "department": "...",
    "specialty": "..."
  }},
  "previous_op_summary": {{
    "chief_complaints": [{{"complaint": "...", "date": "...", "source": "..."}}],
    "unified_diagnoses": [
      {{
        "diagnosis": "...",
        "date": "...",
        "confirmed_by": "...",
        "evidence": "...",
        "source_documents": ["..."]
      }}
    ],
    "doctor_plans_op": [{{"plan": "...", "date": "...", "type": "..."}}],
    "op_clinical_trajectory": "...",
    "data_quality_flag": "Complete|Insufficient OP Clinical Data|Partial"
  }},
  "op_treatment_journey": {{
    "treatments_tried": [
      {{
        "treatment": "...",
        "type": "...",
        "outcome": "Improved|No response|Worsened|Ongoing|Unknown",
        "outcome_evidence": "..."
      }}
    ],
    "treatment_response_summary": "...",
    "escalation_reason": {{
      "classification": "FAILED_OUTPATIENT_MANAGEMENT|ACUTE_DETERIORATION|PROCEDURE_INTERVENTION_NEEDED|MONITORING_REQUIREMENT|SURGICAL_PLANNING|DIAGNOSTIC_WORKUP|OTHER",
      "specific_reason": "...",
      "doctor_input_required": false,
      "evidence": "..."
    }},
    "failed_therapies": ["..."]
  }},
  "reason_for_op_to_ip": {{
    "primary_reason": "...",
    "clinical_justification": "...",
    "admission_type": "Planned|Unplanned|Diagnostic",
    "urgency": "Elective|Semi-elective|Urgent|Emergency",
    "specific_clinical_triggers": ["..."],
    "narrative": "..."
  }},
  "disease_progression_and_clinical_insights": {{
    "progression_pattern": "...",
    "key_disease_milestones": ["..."],
    "comorbidity_interactions": ["..."],
    "clinical_pathway_note": "...",
    "graph_derived_insights": ["..."]
  }},
  "ip_admission_details": {{
    "admission_date": "...",
    "admission_type": "Ward|Room|ICU",
    "location_details": "...",
    "department": "...",
    "admitting_diagnosis": "...",
    "chief_complaint_at_admission": "...",
    "patient_status": "..."
  }},
  "current_condition": {{
    "general_status": "Stable|Guarded|Serious|Critical",
    "primary_diagnosis": "...",
    "diagnosis_certainty": "Confirmed|Working|Suspected",
    "active_problems": ["..."],
    "relevant_comorbidities": ["..."],

  }},
  "current_documents": [
    {{"document": "...", "type": "...", "date": "...", "key_findings": ["..."]}}
  ],
  "ip_clinical_summary_narrative": "...",
  "risk_stratification": {{
    "mews_score": 0,
    "mews_band": "Low|Moderate|High",
    "news_score": 0,
    "news_band": "Low|Medium|High",
    "overall_risk_level": "Low|Moderate|High|Critical",
    "risk_explainability": "...",
    "key_risk_drivers": ["..."],
    "priority_flags": [
      {{"flag": "...", "action": "...", "timeframe": "..."}}
    ]
  }},
  "critical_conditions_to_watch": {{
    "top_critical_conditions": [
      {{
        "condition": "...",
        "why_critical": "...",
        "priority": "IMMEDIATE|HIGH|MODERATE",
        "current_status": "Active|Monitoring|Stabilized",
        "action_required": "..."
      }}
    ],
    "critical_warning_indicators": [
      {{
        "indicator": "...",
        "warning_threshold": "...",
        "immediate_action": "...",
        "escalation_level": "Nurse|Senior Resident|Attending|ICU"
      }}
    ],
    "conditions_to_watch": ["..."]
  }},
  "monitoring_plan": {{
    "monitoring_acuity": "Standard|Enhanced|Intensive|Critical",
    "vital_signs": [
      {{
        "parameter": "...",
        "frequency": "...",
        "normal_range": "...",
        "warning_threshold": "...",
        "action_on_breach": "..."
      }}
    ],
    "laboratory_parameters": [
      {{
        "parameter": "...",
        "frequency": "...",
        "normal_range": "...",
        "warning_threshold": "..."
      }}
    ],
    "disease_specific_parameters": [
      {{"parameter": "...", "frequency": "...", "normal_range": "..."}}
    ]
  }},
  "ip_care_plan_step_by_step": {{
    "immediate_0_6h": [
      {{"step": 1, "action": "...", "reason": "...", "priority": "CRITICAL|HIGH|ROUTINE"}}
    ],
    "day_1_plan": ["..."],
    "diagnostic_workup": [
      {{"investigation": "...", "urgency": "STAT|Urgent|Routine", "purpose": "..."}}
    ],
    "treatment_plan": [
      {{"treatment": "...", "indication": "...", "details": "..."}}
    ],
    "procedure_plan": ["..."],
    "consultations": [
      {{"department": "...", "reason": "...", "urgency": "..."}}
    ],
    "discharge_planning": {{
      "criteria": ["..."],
      "estimated_los": "...",
      "follow_up": "..."
    }}
  }},
  "insurance_and_documentation": {{
    "pre_authorization_status": "Likely Approved|Conditional|Likely Denied|Unknown",
    "criteria_met": true,
    "criteria_details": [
      {{"criterion": "...", "met": true, "evidence": "..."}}
    ],
    "required_documents": [
      {{"document": "...", "available": "Yes|No|Partial", "urgency": "..."}}
    ],
    "icd10_primary": {{"code": "...", "description": "..."}},
    "documentation_gaps": ["..."],
    "insurance_narrative": "..."
  }},
  "bottom_line": "One sentence: [Patient name], admitted for [specific reason], primary diagnosis: [diagnosis], risk: [level], immediate priority: [action]."
}}
"""
        raw_summary = await self._invoke(system, prompt)

        # Apply structure
        structured_summary = enforce_output_structure(state, raw_summary)

        # Apply validation
        validation_errors = validate_summary(state, structured_summary)

        state["ip_onboarding_summary"] = structured_summary
        state["validation_errors"] = validation_errors
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A11 · QUALITY AGENT
# ============================================================

class IPOnboardingQualityAgent(BaseAgent):
    """
    Audits the final IP Onboarding Summary for:
    - Completeness
    - Clinical accuracy
    - Hallucination risk
    - Patient-specificity (no generic outputs)
    - Risk score validity
    """

    agent_id = "A11"

    async def run(self, state: IPOnboardingState) -> IPOnboardingState:
        logger.info(f"{self.agent_id} · IPOnboardingQualityAgent — START")
        t0 = datetime.now().timestamp()

        ip_summary  = state.get("ip_onboarding_summary", {})
        all_op_docs = state["op_graph_docs"]
        all_ip_docs = state["ip_graph_docs"]
        neo4j_diag  = sorted(state.get("neo4j_diagnoses", set()))
        neo4j_med   = sorted(state.get("neo4j_medications", set()))
        system = (
            "You are a clinical quality assurance expert auditing an IP onboarding summary. "
            "Score based on ACTUAL data availability, not ideal state. "
            "If data is missing from source documents, score appropriately low but DO NOT penalize heavily. "
            "Penalize ONLY for invented/hallucinated content, not for missing data. "
            "Always respond with valid JSON only."
        )
        prompt = f"""
IP ONBOARDING SUMMARY (A10 output — what was generated):
{json.dumps(ip_summary, indent=2, default=str)}

SOURCE OP DOCUMENTS (ground truth):
{json.dumps(all_op_docs, indent=2, default=str)}

SOURCE IP DOCUMENTS (ground truth):
{json.dumps(all_ip_docs, indent=2, default=str)}

NEO4J VALID DIAGNOSES: {neo4j_diag}
NEO4J VALID MEDICATIONS: {neo4j_med}

QUALITY AUDIT — Score each 0.0–1.0:

1. DATA COMPLETENESS [0.20]
   Are all OP complaints, unified diagnoses (not per-report), plans captured?
   Are IP documents, vitals, care plan complete?

2. CLINICAL ACCURACY [0.20]
   Correct diagnoses, vitals, medications — no misquotation?

3. HALLUCINATION RISK [0.20]
   Any entities not present in source documents or Neo4j whitelists?
   Any invented diagnoses, medications, procedures?

4. PATIENT-SPECIFICITY [0.15]
   Is this summary specific to THIS patient or generic/template?

5. RISK SCORE VALIDITY [0.10]
   Are MEWS/NEWS computed from actual vitals? Is risk level justified?

6. ESCALATION REASON QUALITY [0.10]
   Is escalation reason explicitly classified and evidenced?

7. CARE PLAN QUALITY [0.05]
   Is the care plan sequenced, actionable, patient-specific?

OVERALL = weighted sum.

Return ONLY valid JSON:
{{
  "scores": {{
    "data_completeness": 0.0,
    "clinical_accuracy": 0.0,
    "hallucination_risk": 0.0,
    "patient_specificity": 0.0,
    "risk_score_validity": 0.0,
    "escalation_reason_quality": 0.0,
    "care_plan_quality": 0.0,
    "overall": 0.0
  }},
  "confidence_band": "High (>0.85)|Moderate (0.70-0.85)|Low (<0.70)",
  "hallucination_flags": ["..."],
  "missing_from_summary": ["..."],
  "accuracy_concerns": ["..."],
  "generic_output_flags": ["..."],
  "improvement_recommendations": ["..."],
  "approved_for_clinical_use": true,
  "review_priority_items": ["..."]
}}
"""
        raw = await self._invoke(system, prompt)
        if "scores" in raw:
            weights = {
                "data_completeness": 0.20,
                "clinical_accuracy": 0.20,
                "hallucination_risk": 0.20,
                "patient_specificity": 0.15,
                "risk_score_validity": 0.10,
                "escalation_reason_quality": 0.10,
                "care_plan_quality": 0.05,
            }
            s = raw["scores"]
            for k in list(s.keys()):
                try:
                    s[k] = float(s[k])
                except (TypeError, ValueError):
                    s[k] = 0.0
            if s.get("overall", 0.0) == 0.0:
                s["overall"] = round(
                    sum(s.get(k, 0.0) * w for k, w in weights.items()), 3
                )
            raw["scores"] = s

        state["quality_score"] = raw
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# POST-SYNTHESIS HALLUCINATION SCRUBBER
# ============================================================

def scrub_hallucinations(state: IPOnboardingState) -> IPOnboardingState:
    """
    After A10 synthesis, validate and scrub any non-grounded entities.
    """
    summary = state.get("ip_onboarding_summary", {})
    if not summary:
        return state

    neo4j_diag  = state.get("neo4j_diagnoses", set())
    neo4j_meds  = state.get("neo4j_medications", set())
    neo4j_proc  = state.get("neo4j_procedures", set())
    neo4j_find  = state.get("neo4j_findings", set())

    diag_lower  = {d.lower(): d for d in neo4j_diag}
    meds_lower  = {m.lower(): m for m in neo4j_meds}
    proc_lower  = {p.lower(): p for p in neo4j_proc}
    find_lower  = {f.lower(): f for f in neo4j_find}

    def is_grounded(name: str, whitelist: dict) -> bool:
        if not name:
            return False
        n = name.lower().strip()
        if n in whitelist:
            return True
        for key in whitelist:
            if key in n or n in key:
                return True
        return False

    def best_grounded(current: str, whitelist: dict) -> str:
        if is_grounded(current, whitelist):
            return current
        if whitelist:
            return max(whitelist.values(), key=len)
        return "Not documented"

    # Fix primary diagnosis
    cc = summary.get("current_condition", {})
    cc["primary_diagnosis"] = best_grounded(cc.get("primary_diagnosis", ""), diag_lower)

    # Filter active problems
    cc["active_problems"] = [
        p for p in cc.get("active_problems", [])
        if is_grounded(p, diag_lower) or is_grounded(p, find_lower)
    ] or list(neo4j_diag)[:3]
    summary["current_condition"] = cc

    # Filter unified diagnoses in OP summary
    op_sum = summary.get("previous_op_summary", {})
    kept_diag = []
    removed_diag = []
    for d in op_sum.get("unified_diagnoses", []):
        if is_grounded(d.get("diagnosis", ""), diag_lower):
            kept_diag.append(d)
        else:
            removed_diag.append(d.get("diagnosis", ""))
    if removed_diag:
        logger.warning(f"🚨 Removed non-grounded OP diagnoses: {removed_diag}")
    op_sum["unified_diagnoses"] = kept_diag
    summary["previous_op_summary"] = op_sum

    # Filter treatment plan
    care = summary.get("ip_care_plan_step_by_step", {})
    kept_tx = []
    for tx in care.get("treatment_plan", []):
        tx_name = tx.get("treatment", "")
        if is_grounded(tx_name, meds_lower) or is_grounded(tx_name, proc_lower):
            kept_tx.append(tx)
        else:
            logger.warning(f"🚨 Removed non-grounded treatment: {tx_name}")
    care["treatment_plan"] = kept_tx

    # Fix ICD-10
    ins = summary.get("insurance_and_documentation", {})
    icd = ins.get("icd10_primary", {})
    if not is_grounded(icd.get("description", ""), diag_lower):
        primary_for_icd = max(neo4j_diag, key=len) if neo4j_diag else ""
        logger.warning(f"🚨 ICD-10 not grounded. Using: {primary_for_icd}")
        icd["description"] = primary_for_icd
        icd["code"] = "REQUIRES_MANUAL_CODING"
        icd["note"] = f"Please assign correct ICD-10 for: {primary_for_icd}"
    ins["icd10_primary"] = icd
    summary["insurance_and_documentation"] = ins

    # Fix bottom_line
    bottom = summary.get("bottom_line", "")
    if bottom:
        any_grounded = any(d.lower() in bottom.lower() for d in neo4j_diag)
        if not any_grounded:
            primary = cc.get("primary_diagnosis", "")
            name = summary.get("patient_header", {}).get("name", "Patient")
            reason = summary.get("ip_admission_details", {}).get("chief_complaint_at_admission", "admission")
            status = cc.get("general_status", "")
            summary["bottom_line"] = (
                f"{name}, admitted for {reason}, "
                f"primary diagnosis: {primary}, current status: {status}."
            )

    summary["ip_care_plan_step_by_step"] = care
    state["ip_onboarding_summary"] = summary
    logger.info("✅ Hallucination scrub complete")
    return state



# ============================================================
# POST-SYNTHESIS COMPLETENESS ENSURER (ADD THIS)
# ============================================================
def ensure_complete_summary(summary: Dict, state: IPOnboardingState) -> Dict:
    """
    Ensures all required fields are populated - ONLY from actual data.
    NO HARDCODED DEFAULTS - flag missing data instead.
    """
    if not summary:
        return summary
    
    neo4j_diag = list(state.get("neo4j_diagnoses", set()))
    
    # 1. Fix unified_diagnoses - ONLY if data exists in Neo4j
    op_summary = summary.get("previous_op_summary", {})
    if not op_summary.get("unified_diagnoses") or len(op_summary.get("unified_diagnoses", [])) == 0:
        if neo4j_diag:
            # Use actual Neo4j data
            op_summary["unified_diagnoses"] = [
                {
                    "diagnosis": diag,
                    "date": "Date not documented in available records",
                    "confirmed_by": "Not documented",
                    "evidence": "Extracted from Neo4j graph relationships",
                    "source_documents": ["Neo4j Clinical Graph"]
                }
                for diag in neo4j_diag[:5]
            ]
            logger.info(f"✅ Added {len(neo4j_diag[:5])} unified diagnoses from Neo4j")
        else:
            # NO DATA - flag it honestly
            op_summary["unified_diagnoses"] = []
            op_summary["data_quality_flag"] = "Insufficient OP Clinical Data - No diagnoses found"
            logger.warning("⚠️ No diagnoses found in Neo4j - marking as insufficient data")
    
    # 2. Fix current_condition - ONLY from actual data
    current = summary.get("current_condition", {})
    if not current.get("primary_diagnosis") or current.get("primary_diagnosis") in ["Not documented", ""]:
        if neo4j_diag:
            current["primary_diagnosis"] = neo4j_diag[0]
            logger.info(f"✅ Set primary_diagnosis to: {neo4j_diag[0]}")
        else:
            current["primary_diagnosis"] = "⚠️ Not documented - requires doctor input"
            current["diagnosis_certainty"] = "Unknown"
    
    if not current.get("active_problems") or len(current.get("active_problems", [])) == 0:
        if neo4j_diag:
            current["active_problems"] = neo4j_diag[:3]
        else:
            current["active_problems"] = ["No active problems documented in available records"]
    
    # DON'T invent comorbidities - use what's there or flag honestly
    if not current.get("relevant_comorbidities") or len(current.get("relevant_comorbidities", [])) == 0:
        current["relevant_comorbidities"] = ["No comorbidities documented in available records"]
    
    summary["current_condition"] = current
    
    # 3. Fix bottom_line - DON'T invent, use what exists or flag missing
    bottom = summary.get("bottom_line", "")
    if bottom and ("[Patient name]" in bottom or "Not documented" in bottom or bottom == ""):
        name = summary.get("patient_header", {}).get("name", "Patient")
        reason = summary.get("ip_admission_details", {}).get("chief_complaint_at_admission", "admission documented")
        primary = current.get("primary_diagnosis", "primary diagnosis not documented")
        status = current.get("general_status", "status not documented")
        risk = summary.get("risk_stratification", {}).get("overall_risk_level", "risk level not documented")
        
        if "⚠️" in primary or "requires doctor input" in primary:
            summary["bottom_line"] = (
                f"{name} admitted for {reason}. "
                f"⚠️ Primary diagnosis not documented in available records. "
                f"Current status: {status}. Risk level: {risk}. "
                f"**Doctor input required for complete assessment.**"
            )
        else:
            summary["bottom_line"] = (
                f"{name}, admitted for {reason}, "
                f"primary diagnosis: {primary}, "
                f"current status: {status}, "
                f"risk level: {risk}."
            )
        logger.info(f"✅ Fixed bottom_line with available data")
    
    # 4. Don't force "Worsening" - use actual or flag missing
    if not op_summary.get("op_clinical_trajectory") or op_summary.get("op_clinical_trajectory") == "Worsening":
        op_summary["op_clinical_trajectory"] = "Not documented in available OP records"
    
    summary["previous_op_summary"] = op_summary
    
    return summary
# ============================================================
# PIPELINE RUNNER
# ============================================================

async def run_ip_onboarding_pipeline(state: IPOnboardingState) -> IPOnboardingState:
    """
    Full 12-agent IP Onboarding pipeline:
    A0 → A1 → A2 → A3 → A4 → A5 → A6 → A7 → A8 → A9 → A10 → A11
    """
    pipeline = [
        OPHistoryAnchorAgent(llm),              # A0
        OPTreatmentJourneyAgent(llm),           # A1
        OPToIPTransitionReasonerAgent(llm),     # A2
        IPAdmissionContextAgent(llm),           # A3
        IPClinicalSummaryAgent(llm_synthesis),  # A4
        ClinicalRiskStratificationAgent(llm),   # A5
        CriticalConditionsAgent(llm),           # A6
        MonitoringPlanAgent(llm),               # A7
        IPCarePlanAgent(llm_synthesis),         # A8
        InsuranceDocumentationAgent(llm),       # A9
        IPOnboardingSynthesisAgent(llm_synthesis), # A10
        IPOnboardingQualityAgent(llm),          # A11
    ]

    # Build Neo4j ground truth whitelists
    wl = build_neo4j_whitelists(state.get("op_graph_docs", []), state.get("ip_graph_docs", []))
    state["neo4j_diagnoses"]  = wl["diagnoses"]
    state["neo4j_medications"] = wl["medications"]
    state["neo4j_procedures"]  = wl["procedures"]
    state["neo4j_findings"]    = wl["findings"]
    state["ground_truth"] = {}

    logger.info(f"✅ Neo4j diagnoses: {wl['diagnoses']}")
    logger.info(f"✅ Neo4j medications: {wl['medications']}")

    for agent in pipeline:
        try:
            state = await agent.run(state)

            # Post-A3: inject chief complaint from admission record
            if agent.agent_id == "A3":
                admission_record = state.get("admission_record", {})
                adm_ctx = state.get("admission_context", {})
                if adm_ctx and admission_record.get("chief_complaint"):
                    logistics = adm_ctx.get("admission_logistics", {})
                    if not logistics.get("chief_complaint_at_admission"):
                        logistics["chief_complaint_at_admission"] = admission_record.get("chief_complaint")
                        adm_ctx["admission_logistics"] = logistics
                        state["admission_context"] = adm_ctx

            # Post-A10: scrub hallucinations
            # Post-A10: scrub hallucinations AND ensure completeness
            if agent.agent_id == "A10":
                state = scrub_hallucinations(state)
                # ADD THIS LINE:
                state["ip_onboarding_summary"] = ensure_complete_summary(state.get("ip_onboarding_summary", {}), state)

        except Exception as e:
            logger.error(f"{agent.agent_id} failed: {e}")
            state["errors"].append(f"{agent.agent_id}: {str(e)}")

    return state


# ============================================================
# INITIAL STATE FACTORY
# ============================================================

def build_initial_state(
    request: IPOnboardingRequest,
    op_graph_docs:    List[Dict],
    ip_graph_docs:    List[Dict],
    admission_record: Optional[Dict],
    patient_demo:     Optional[Dict],
    op_diagnosis_history: List[Dict],
    documentation_features: List[Dict],
    latest_docs: Dict[str, Optional[Dict]],
) -> IPOnboardingState:
    return IPOnboardingState(
        patient_id=request.patient_id,
        doctor_id=request.doctor_id,
        specialty=request.specialty,
        op_graph_docs=op_graph_docs,
        ip_graph_docs=ip_graph_docs,
        admission_record=admission_record,
        patient_demo=patient_demo or {},
        op_diagnosis_history=op_diagnosis_history,
        documentation_features=documentation_features,
        latest_clinical_notes=latest_docs.get("clinical_notes"),
        latest_investigation_notes=latest_docs.get("investigation_notes"),
        latest_medication_analysis=latest_docs.get("medication_analysis"),
        latest_treatment_plan=latest_docs.get("treatment_plan"),
        latest_treatment_summary=latest_docs.get("treatment_summary"),
        neo4j_diagnoses=set(),
        neo4j_medications=set(),
        neo4j_procedures=set(),
        neo4j_findings=set(),
        ground_truth={},
        op_history=None,
        op_treatment_journey=None,
        transition_context=None,
        admission_context=None,
        clinical_summary=None,
        risk_stratification=None,
        critical_conditions=None,
        monitoring_plan=None,
        care_plan=None,
        insurance_docs=None,
        ip_onboarding_summary=None,
        quality_score=None,
        errors=[],
        agent_timings={},
    )


# ============================================================
# API ENDPOINT
# ============================================================

@router.post("/internal/run-ip-onboarding")
async def run_ip_onboarding(request: IPOnboardingRequest):
    """
    IP Patient Onboarding Summary — Full 12-Agent Pipeline.

    Data Sources:
      1. patient_users → demographics
      2. patient_appointments → IP admission record (visit_type=IP), chief complaint
      3. Neo4j → OP graph docs (before admission_date), IP graph docs (from admission_date)
      4. diagnosis/history API → latest OP diagnoses
      5. get_documentation_features_by_patient API → latest per feature_id
      6. MongoDB documentation collections → latest clinical notes, investigation notes,
         medication analysis, treatment plan, treatment summary

    Agent Pipeline (12 agents):
      A0  OP History Anchor
      A1  OP Treatment Journey + Escalation Reason Classification
      A2  OP→IP Transition Reasoner
      A3  IP Admission Context
      A4  IP Clinical Summary (integrated)
      A5  Clinical Risk Engine (MEWS/NEWS/Red flags/Comorbidities)
      A6  Critical Conditions + Warning Indicators
      A7  Monitoring Plan (Parameter|Frequency|Threshold|Action)
      A8  IP Care Plan (step-by-step)
      A9  Insurance & Documentation
      A10 Full Synthesis
      A11 Quality Audit
    """
    start_ms = datetime.now().timestamp() * 1000
    logger.info(
        f"IP Onboarding Pipeline | patient={request.patient_id} | doctor={request.doctor_id}"
    )

    try:
        fetcher = IPOnboardingDataFetcher()

        # Fetch all data concurrently
        (
            demo,
            admission_record,
            op_diag_history,
            doc_features,
        ) = await asyncio.gather(
            fetcher.fetch_patient_demographics(request.patient_id),
            fetcher.fetch_ip_admission_record(request.patient_id, request.doctor_id),
            fetcher.fetch_op_diagnosis_history(request.patient_id, request.doctor_id),
            fetcher.fetch_documentation_features(request.patient_id),
        )

        # Fallback: any IP admission
        if not admission_record:
            admission_record = await fetcher.fetch_ip_admission_record(
                request.patient_id, "ANY"
            )

        if not admission_record:
            raise HTTPException(
                status_code=404,
                detail=f"No IP admission record found for patient {request.patient_id}"
            )

        admission_date = admission_record.get("date")
        if not admission_date:
            raise HTTPException(
                status_code=422,
                detail="IP admission record has no 'date' field."
            )

        logger.info(f"Admission date: {admission_date}")
        logger.info(f"OP diagnosis history: {len(op_diag_history)} entries")
        logger.info(f"Documentation features: {len(doc_features)} entries")

        # Fetch Neo4j docs + MongoDB docs concurrently
        (
            op_graph_docs,
            ip_graph_docs,
            latest_docs,
        ) = await asyncio.gather(
            fetcher.fetch_graph_documents_range(
                patient_id=request.patient_id,
                from_date=None,
                to_date=admission_date,
                direction="before"
            ),
            fetcher.fetch_graph_documents_range(
                patient_id=request.patient_id,
                from_date=admission_date,
                to_date=None,
                direction="from"
            ),
            fetcher.fetch_latest_documentation(request.patient_id, request.doctor_id),
        )

        logger.info(f"OP docs: {len(op_graph_docs)} | IP docs: {len(ip_graph_docs)}")
        # ================= VITALS INJECTION (FIXED) =================

        mongo_vitals_dict = await fetcher.fetch_patient_vitals(request.patient_id)
        mongo_vitals = extract_latest_vitals(mongo_vitals_dict)  # Convert dict to list

        neo4j_vitals = extract_vitals_from_neo4j(ip_graph_docs)

        merged_vitals = merge_vitals(mongo_vitals, neo4j_vitals)

        # DEBUG (optional but VERY useful)
        logger.info(f"Mongo vitals: {len(mongo_vitals)}")
        logger.info(f"Neo4j vitals: {len(neo4j_vitals)}")
        logger.info(f"Merged vitals: {len(merged_vitals)}")

        total_docs = len(op_graph_docs) + len(ip_graph_docs)
        if total_docs == 0 and not op_diag_history and not doc_features:
            raise HTTPException(
                status_code=404,
                detail=f"No clinical data found for patient {request.patient_id}"
            )

        # Build initial state
        # Build initial state
        initial_state = build_initial_state(
            request=request,
            op_graph_docs=op_graph_docs,
            ip_graph_docs=ip_graph_docs,
            admission_record=admission_record,
            patient_demo=demo,
            op_diagnosis_history=op_diag_history,
            documentation_features=doc_features,
            latest_docs=latest_docs,
        )
        
        # Add vitals to state
        initial_state["patient_vitals"] = merged_vitals
        
        # Build Neo4j whitelists for logging (before pipeline)
        wl = build_neo4j_whitelists(op_graph_docs, ip_graph_docs)
        initial_state["neo4j_diagnoses"] = wl["diagnoses"]
        initial_state["neo4j_medications"] = wl["medications"]
        initial_state["neo4j_procedures"] = wl["procedures"]
        initial_state["neo4j_findings"] = wl["findings"]
        
        # PRINT COMPREHENSIVE INPUT LOGGING
        log_ip_onboarding_input(initial_state)

        # ✅ ADD THIS DATA AVAILABILITY CHECK
        data_availability = {
            "has_op_docs": len(initial_state.get("op_graph_docs", [])) > 0,
            "has_ip_docs": len(initial_state.get("ip_graph_docs", [])) > 0,
            "has_diagnosis_history": len(initial_state.get("op_diagnosis_history", [])) > 0,
            "has_vitals": len(initial_state.get("patient_vitals", [])) > 0,
            "has_demographics": bool(initial_state.get("patient_demo")),
            "has_admission_record": bool(initial_state.get("admission_record")),
            "has_treatment_plan": bool(initial_state.get("latest_treatment_plan")),
        }

        logger.info("=" * 50)
        logger.info("📊 DATA AVAILABILITY SUMMARY:")
        for key, value in data_availability.items():
            logger.info(f"   {key}: {'✅ YES' if value else '❌ NO'}")
        logger.info("=" * 50)

        if not data_availability["has_op_docs"] and not data_availability["has_diagnosis_history"]:
            logger.warning("⚠️ WARNING: No OP clinical data found - summary will have missing sections")
            initial_state["errors"].append("No OP clinical data available - output will be incomplete")
        
        # Run pipeline
        result = await run_ip_onboarding_pipeline(initial_state)

        # Persist to MongoDB
        save_payload = {
            "patient_id":         request.patient_id,
            "doctor_id":          request.doctor_id,
            "admission_date":     admission_date,
            "generated_at":       datetime.utcnow(),
            "documents_analyzed": total_docs,
            "op_docs_count":      len(op_graph_docs),
            "ip_docs_count":      len(ip_graph_docs),
            "op_diagnosis_count": len(op_diag_history),
            "doc_features_count": len(doc_features),
            **{k: v for k, v in result.items()
              if k not in ["errors", "agent_timings", "op_graph_docs", "ip_graph_docs",
                            "neo4j_diagnoses", "neo4j_medications", "neo4j_procedures",
                            "neo4j_findings", "ground_truth"]},
        }

        try:
            await ip_onboarding_summary_collection.insert_one(save_payload)
        except Exception as e:
            logger.error(f"MongoDB save failed: {e}")

        elapsed = round(datetime.now().timestamp() * 1000 - start_ms)
        logger.info(
            f"IP Onboarding complete | patient={request.patient_id} | "
            f"{elapsed}ms | {total_docs} graph docs"
        )

        response = {
            "patient_id":         request.patient_id,
            "doctor_id":          request.doctor_id,
            "generated_at":       datetime.now().isoformat(),
            "admission_date":     admission_date,
            "documents_analyzed": total_docs,
            "op_docs_analyzed":   len(op_graph_docs),
            "ip_docs_analyzed":   len(ip_graph_docs),
            "op_diagnoses_found": len(op_diag_history),
            "doc_features_found": len(doc_features),
            "processing_time_ms": elapsed,
            "agent_timings":      result.get("agent_timings", {}),
            "errors":             result.get("errors", []),
            "version":            "2.0.0",

            # Primary output
            "ip_onboarding_summary": result.get("ip_onboarding_summary", {}),

            # Quality score
            "score": result.get("quality_score", {}),
        }

        if request.include_intermediates:
            response["intermediate"] = {
                "op_history":            result.get("op_history"),
                "op_treatment_journey":  result.get("op_treatment_journey"),
                "transition_context":    result.get("transition_context"),
                "admission_context":     result.get("admission_context"),
                "clinical_summary":      result.get("clinical_summary"),
                "risk_stratification":   result.get("risk_stratification"),
                "critical_conditions":   result.get("critical_conditions"),
                "monitoring_plan":       result.get("monitoring_plan"),
                "care_plan":             result.get("care_plan"),
                "insurance_docs":        result.get("insurance_docs"),
            }

        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"IP Onboarding Pipeline failed | patient={request.patient_id} | {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/ip-onboarding/health")
async def ip_onboarding_health():
    return {
        "status": "ok",
        "version": "2.0.0",
        "agents": 12,
        "pipeline": [
            "A0  — OP History Anchor          (OP graph + diagnosis API + doc features → unified history)",
            "A1  — OP Treatment Journey       (treatments tried + response + escalation reason classified)",
            "A2  — OP→IP Transition Reasoner  (structured justification, urgency, expected IP course)",
            "A3  — IP Admission Context       (logistics, vitals, current docs, current medications)",
            "A4  — IP Clinical Summary        (integrated OP+IP problem list, working diagnosis, timeline)",
            "A5  — Clinical Risk Engine       (MEWS/NEWS/red flags/comorbidities with explainability)",
            "A6  — Critical Conditions Agent  (critical factors, warning indicators, priority flags)",
            "A7  — Monitoring Plan Agent      (parameter | frequency | threshold | action)",
            "A8  — IP Care Plan Agent         (step-by-step sequenced care plan)",
            "A9  — Insurance & Documentation  (pre-auth, ICD-10, criteria, gaps)",
            "A10 — Full Synthesis Agent       (final IP onboarding summary assembly)",
            "A11 — Quality Agent             (completeness, hallucination, patient-specificity, risk validity)",
        ],
        "data_sources": {
            "neo4j_op":       "Graph docs with document_date BEFORE admission_date",
            "neo4j_ip":       "Graph docs with document_date >= admission_date to NOW",
            "admission_record": "patient_appointments collection — IP visit_type record",
            "demographics":   "patient_users collection",
            "op_diagnoses":   "diagnosis/history external API — latest OP diagnoses",
            "doc_features":   "get_documentation_features_by_patient external API",
            "mongo_docs": {
                "clinical_notes":      "documentation-clinical-notes collection (latest)",
                "investigation_notes": "documentation-investigation-notes collection (latest)",
                "medication_analysis": "documentation-medication-analysis collection (latest)",
                "treatment_plan":      "documentation-treatment-plan collection (latest)",
                "treatment_summary":   "documentation-treatment-summary collection (latest)",
            }
        },
        "output_sections": [
            "1.  Patient Header",
            "2.  Previous OP Summary (Chief Complaints | Unified Diagnoses | Doctor Plans | Trajectory)",
            "3.  OP Treatment Journey (Treatments Tried | Response | Escalation Reason Classified)",
            "4.  Reason for OP → IP Admission (structured + clinical justification)",
            "5.  Disease Progression & Clinical Insights (graph-derived)",
            "6.  IP Admission Details",
            "7.  Current Condition (vitals, problem list, working diagnosis)",
            "8.  Current Documents (all since admission)",
            "9.  IP Clinical Summary Narrative",
            "10. Risk Stratification (MEWS/NEWS/risk level with explainability)",
            "11. Critical Conditions To Watch (warning thresholds + escalation levels)",
            "12. Monitoring Plan (Parameter|Frequency|Range|Threshold|Action)",
            "13. IP Care Plan Step-By-Step",
            "14. Insurance & Documentation",
            "15. Bottom Line",
        ],
        "validation_rules": {
            "missing_op_data":        "Flag: Insufficient OP Clinical Data",
            "escalation_not_derivable": "Flag: Needs Doctor Input",
            "hallucinations":         "All entities scrubbed against Neo4j whitelist",
            "diagnosis_rule":         "Unified diagnosis from ALL reports — NOT one per report",
            "risk_scores":            "MEWS/NEWS computed from actual vitals only",
        }
    }


# ============================================================
# ENTRYPOINT
# ============================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "ip_onboarding_summary:app",
        host="0.0.0.0",
        port=8001,
        reload=False,
        log_level="info",
    )
