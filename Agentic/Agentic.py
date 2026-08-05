from fastapi import APIRouter
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional, Dict, Any
from datetime import datetime
import sys
#Context etching & RAG Implementation
from typing import Dict, Any, List
from datetime import datetime, timedelta
from motor.motor_asyncio import AsyncIOMotorClient
from loguru import logger
import os
from dotenv import load_dotenv
import re

from typing import Dict, Any, List, Optional, TypedDict
from langgraph.graph import StateGraph, END
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage
from loguru import logger
import json
from datetime import datetime
import os
from dotenv import load_dotenv
from fastapi import APIRouter, Request, Response
from Agentic.Rag.graph_rag_system import graph_rag_system

import json

def safe_json(data):
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


def safe_json(data):
    """Safely JSON-serialize objects (handles datetime, ObjectId, etc.)"""
    import json
    return json.dumps(data, indent=2, default=str)


router = APIRouter(
    tags=["Agentic"]
)


@router.get("/test")
async def test_get():
    return {"reply": "hello from agentic 44 (GET)"}

@router.post("/test")
async def test(payload: dict):
    return {"reply": "hello from agentic 44"}



#DB details


STORAGE_BASE_URL = os.getenv("STORAGE_BASE_URL")
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

client = AsyncIOMotorClient(MONGO_URI)  # async (Motor)
db = client[MONGO_DB]

# api_key = os.getenv("GROQ_API_KEY")

# groq_client = Groq(api_key=api_key)

# model = ChatGroq(
#     model="llama-3.1-8b-instant",
#     groq_api_key=api_key
# )


GROQ_API_KEY = os.getenv("GROQ_API_KEY")

if not GROQ_API_KEY:
    raise RuntimeError("GROQ_API_KEY is not set")

llm = ChatGroq(
    model="llama-3.1-8b-instant",
    groq_api_key=GROQ_API_KEY,
    temperature=0.2,
    max_tokens=4000
)


# Collections
document_categories_collection = db["document_categories"]
procedure_notes_collection = db["procedure_notes"]
conversation_user_collection = db["conversation_user"]
dictation_collection = db["dictation"]

documentation_treatment_plan_collection = db["documentation-treatment-plan"]
documentation_investigation_notes_collection = db["documentation-investigation-notes"]
documentation_medication_analysis_collection = db["documentation-medication-analysis"]
patient_vitals_collection = db["patient_vitals"]
# Laboratory collections
laboratory_hematology_collection = db["laboratory-hematology"]
laboratory_biochemistry_collection = db["laboratory-biochemistry"]
laboratory_microbiology_collection = db["laboratory-microbiology"]
doctor_user_collection = db["doctor_users"]
# Imaging collections
imaging_xray_collection = db["imaging-xray"]
imaging_ct_collection = db["imaging-ct"]
imaging_mri_collection = db["imaging-mri"]
imaging_ultrasound_collection = db["imaging-ultrasound"]

# Pathology collections
pathology_histopathology_collection = db["pathology-histopathology"]
pathology_cytology_collection = db["pathology-cytology"]


disease_identity_collection =db["disease_identity"]

disease_trajectory_collection = db["disease_trajectory"]

treatment_memory_collection = db["treatment_memory"]

functional_status_collection = db["functional_status"]

risk_topology_collection = db["risk_topology"]

prognosis_collection = db["prognosis"]

hypothesis_layer_collection = db["hypothesis_layer"]

next_visit_brief_collection = db["next_visit_brief"]

patient_user_collection = db["patient_users"]
eventdb_collection = db["eventdb"]

patient_summary_collection = db["patient_summary"]
case_boundaries_collection = db["case_boundaries"]


symptom_trajectory= db["symptom_trajectory"]
medication_safety= db["medication_safety"]
imaging_progression= db["imaging_progression"]
lab_trend_analysis= db["lab_trend_analysis"]
biomarker_trend= db["biomarker_trend"]
comorbidity_interaction= db["comorbidity_interaction"]
consistency_check= db["consistency_check"]
delta_snapshots= db["delta_snapshots"]


# from clinical_reasoning_with_rag import run_enhanced_clinical_reasoning
# from context_fetchers import (
#     fetch_medical_context,
#     fetch_clinical_context,
#     fetch_longitudinal_context
# )





class ClinicalReasoningRequest(BaseModel):
    patient_id: str
    doctor_id: str
    consultation_text: str


class EnhancedClinicalReasoningResponse(BaseModel):
    status: str
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
    patient_summary:Optional[Dict[str, Any]] = None
    confidence_scores: Dict[str, float]
    warnings: list
    requires_review: bool
    timestamp: str
    error: Optional[str] = None



# Rag and call start from here.
# Frontend: Doctor enters consultation text
# User types: "Patient presents with fever and abdominal pain for 3 days"
# ↓
# ClinicalReasoningDashboard component calls API:
# POST /api/hms/users/ai/clinical-reasoning-enhanced
# {
#   patient_id: "P12345",
#   doctor_id: "D67890",
#   consultation_text: "Patient presents with fever..."
# }


 
#Core Components Start call from here
@router.post("/clinical-reasoning-enhanced", response_model=EnhancedClinicalReasoningResponse)
async def execute_enhanced_clinical_reasoning(request: ClinicalReasoningRequest):
    """
    Execute comprehensive multi-agent clinical reasoning workflow with RAG enhancement
    
    This endpoint orchestrates 9 AI agents with Graph-RAG integration:
    - RAG Retrieval Agent (vector + graph + temporal search)
    - Context Enrichment Agent
    - Disease Causation Analysis (RAG-enhanced)
    - Staging and Severity Classification
    - Prognosis Prediction
    - Risk Stratification
    - Treatment Validation
    - Contraindication Checking
    - Final Integrated Recommendations
    """
    try:
        logger.info(f"🚀 Enhanced Clinical Reasoning Request: Patient={request.patient_id}, Doctor={request.doctor_id}")
        
        # Fetch contexts from database
        # medical_context = await fetch_medical_context(request.patient_id, request.doctor_id)
        # clinical_context = await fetch_clinical_context(request.patient_id, request.doctor_id)
        # longitudinal_context = await fetch_longitudinal_context(request.patient_id, request.doctor_id)
        
        # logger.info(f"📊 Contexts fetched: Medical={bool(medical_context)}, Clinical={bool(clinical_context)}, Longitudinal={bool(longitudinal_context)}")
        
        # # Execute enhanced reasoning workflow with RAG
        # result = await run_enhanced_clinical_reasoning(
        #     patient_id=request.patient_id,
        #     doctor_id=request.doctor_id,
        #     consultation_text=request.consultation_text,
        #     medical_context=medical_context,
        #     clinical_context=clinical_context,
        #     longitudinal_context=longitudinal_context
        # )



        medical_context = await fetch_medical_context(request.patient_id, request.doctor_id)
        clinical_context = await fetch_clinical_context(request.patient_id, request.doctor_id)
        longitudinal_context = await fetch_longitudinal_context(request.patient_id, request.doctor_id)
        
        # ✅ ADD VALIDATION: Check if we actually got data
        total_docs = (
            len(medical_context.get("laboratory_results", {}).get("hematology", [])) +
            len(medical_context.get("laboratory_results", {}).get("biochemistry", [])) +
            len(medical_context.get("imaging", {}).get("ct", [])) +
            len(clinical_context.get("active_diagnoses", []))
        )
        
        if total_docs == 0:
            logger.warning(f"⚠️ No patient data found for {request.patient_id} - Agents will work with empty context")
        
        logger.info(f"📊 Contexts fetched: Medical={len(medical_context.get('documents', []))} docs, "
                   f"Clinical={len(clinical_context.get('active_diagnoses', []))} diagnoses, "
                   f"Longitudinal={len(longitudinal_context.get('lab_trends', []))} trends")
        
        # Execute enhanced reasoning workflow with RAG
        result = await run_enhanced_clinical_reasoning(
            patient_id=request.patient_id,
            doctor_id=request.doctor_id,
            consultation_text=request.consultation_text,
            medical_context=medical_context,
            clinical_context=clinical_context,
            longitudinal_context=longitudinal_context
        )
        
        logger.info(f"✅ Enhanced Clinical Reasoning Complete: Status={result['status']}")
        
        return EnhancedClinicalReasoningResponse(**result)
        
        logger.info(f"✅ Enhanced Clinical Reasoning Complete: Status={result['status']}")
        
        return EnhancedClinicalReasoningResponse(**result)
        
    except Exception as e:
        logger.error(f"❌ Enhanced Clinical Reasoning Failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/clinical-reasoning/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "clinical-reasoning-enhanced",
        "timestamp": datetime.utcnow().isoformat()
    }


@router.post("/clinical-reasoning/index-patient")
async def index_patient_data(request: ClinicalReasoningRequest, background_tasks: BackgroundTasks):
    """
    Pre-index patient data into RAG system for faster retrieval
    """
    try:
        logger.info(f"📚 Indexing patient data: Patient={request.patient_id}")
        
        # Fetch contexts
        medical_context = await fetch_medical_context(request.patient_id, request.doctor_id)
        clinical_context = await fetch_clinical_context(request.patient_id, request.doctor_id)
        longitudinal_context = await fetch_longitudinal_context(request.patient_id, request.doctor_id)
        
        # Add indexing to background tasks
        from Rag.graph_rag_system import graph_rag_system
        
        background_tasks.add_task(
            graph_rag_system.index_patient_data,
            request.patient_id,
            medical_context,
            clinical_context,
            longitudinal_context
        )
        
        return {
            "status": "indexing_started",
            "patient_id": request.patient_id,
            "message": "Patient data indexing started in background"
        }
        
    except Exception as e:
        logger.error(f"❌ Indexing failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))





# =====================================================================
# MEDICAL CONTEXT FETCHER
# =====================================================================


async def fetch_medical_context(patient_id: str, doctor_id: str) -> Dict[str, Any]:
    """
    Fetch complete medical context from all sources:
    - Raw EventDB clinical facts
    - Agentic reasoning layers (separate collections)
    """

    logger.info(f"📚 Fetching Medical Context: Patient={patient_id}")

    try:
        medical_context = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "timestamp": datetime.utcnow().isoformat(),

            # ==============================
            # 🧾 RAW CLINICAL CONTEXT
           
            "demographics": {
                "age": None,
                "sex": None
            },

            "speciality":[],
           
            "conversation": [],
            "procedure_notes": [],
            "treatment_documents": [],
            "investigation_documents": [],
            "medication_analysis": [],
            "document_categories": [],           
            # ==============================
            # 🧠 AGENTIC LAYERS (NEW)
            # ==============================
            "disease_identity": {},
            "disease_trajectory": {},
            "treatment_memory": {},
            "functional_status": {},
            "risk_topology": {},
            "prognosis": {},
            "hypothesis_layer": {},
            "next_visit_brief": {},
            "symptom_trajectory":{},
            "lab_trend_analysis":{},
            "biomarker_trend":{},
            "imaging_progression":{},
            "case_boundaries":{},
            "comorbidity_interaction":{},
            "patient_summary":{},
            "case_boundaries":{},
            "clinical_summary": ""
        }

        # ======================================================
        # 🔥 EVENTDB FETCH (UNCHANGED)
        # ======================================================

        
        demographics = await fetch_patient_demographics(
            patient_id,
            patient_user_collection
        )
        
        
        # =====================================
        # 📄 DOCUMENT + NOTES COLLECTIONS
        # =====================================

        # medical_context["procedure_notes"] = await fetch_collection_data(
        #     patient_id,
        #     procedure_notes_collection
        # )

        # medical_context["conversation"] = await fetch_collection_data(
        #     patient_id,
        #     conversation_user_collection
        # )

        # medical_context["dictations"] = await fetch_collection_data(
        #     patient_id,
        #     dictation_collection
        # )

        # medical_context["treatment_documents"] = await fetch_collection_data(
        #     patient_id,
        #     documentation_treatment_plan_collection
        # )

        # medical_context["investigation_documents"] = await fetch_collection_data(
        #     patient_id,
        #     documentation_investigation_notes_collection
        # )

        # medical_context["medication_analysis"] = await fetch_collection_data(
        #     patient_id,
        #     documentation_medication_analysis_collection
        # )

        # medical_context["document_categories"] = await fetch_collection_data(
        #     patient_id,
        #     document_categories_collection
        # )

        # medical_context["vital_signs"] = await fetch_collection_data(
        #     patient_id,
        #     patient_vitals_collection
        # )
        # ======================================================
        # 🧠 FETCH AGENTIC LAYERS (NEW)
        # ======================================================

        medical_context["disease_identity"] = await fetch_agent_layer(
            patient_id, "disease_identity", disease_identity_collection
        )

        medical_context["disease_trajectory"] = await fetch_agent_layer(
            patient_id, "disease_trajectory", disease_trajectory_collection
        )

        medical_context["treatment_memory"] = await fetch_agent_layer(
            patient_id, "treatment_memory", treatment_memory_collection
        )

        medical_context["functional_status"] = await fetch_agent_layer(
            patient_id, "functional_status", functional_status_collection
        )

        medical_context["risk_topology"] = await fetch_agent_layer(
            patient_id, "risk_topology", risk_topology_collection
        )

        medical_context["prognosis"] = await fetch_agent_layer(
            patient_id, "prognosis", prognosis_collection
        )

        medical_context["hypothesis_layer"] = await fetch_agent_layer(
            patient_id, "hypothesis_layer", hypothesis_layer_collection
        )

        medical_context["next_visit_brief"] = await fetch_agent_layer(
            patient_id, "next_visit_brief", next_visit_brief_collection
        )
        medical_context["symptom_trajectory"] = await fetch_agent_layer(
            patient_id,"symptom_trajectory",symptom_trajectory
        )
        medical_context["medication_safety"] = await fetch_agent_layer(
            patient_id,"medication_safety",medication_safety
        )
        medical_context["imaging_progression"] = await fetch_agent_layer(
            patient_id,"imaging_progression",imaging_progression
        )
        medical_context["lab_trend_analysis"] = await fetch_agent_layer(
            patient_id,"lab_trend_analysis",lab_trend_analysis
        )
        medical_context["biomarker_trend"] = await fetch_agent_layer(
            patient_id,"biomarker_trend",biomarker_trend
        )
        medical_context["comorbidity_interaction"] = await fetch_agent_layer(
            patient_id,"comorbidity_interaction",comorbidity_interaction
        )
        medical_context["case_boundaries"] = await fetch_agent_layer(
            patient_id,"case_boundaries",case_boundaries_collection
        )
        medical_context["clinical_summary"] = await fetch_clinical_summary(patient_id)
        medical_context["demographics"] = demographics
        medical_context["speciality"] = await fetch_doctor_speciality(
            doctor_id,
            doctor_user_collection
        )
        logger.info("🧠 Agentic layers fetched and merged into medical_context")

        

        return medical_context

    except Exception as e:
        logger.error(f"❌ Failed to fetch medical context: {str(e)}")
        return {}






#########################5/3/26######################


from typing import List, Dict, Any



async def fetch_clinical_summary(patient_id: str) -> str:
    """
    Fetch latest clinical sumry raw_output only
    """

    try:

        doc = await patient_summary_collection.find_one(
            {"patient_id": patient_id},
            {
                "clinical_summary": 1,
                "_id": 0
            },
            sort=[("generated_at", -1)]
        )

        if not doc:
            return ""

        return doc.get("clinical_summary", "")

    except Exception as e:
        logger.error(f"❌ Failed fetching clinical summary: {str(e)}")
        return ""

async def fetch_collection_data(
    patient_id: str,
    collection,
    limit: int = 100
) -> List[Dict[str, Any]]:
    """
    Generic fetch function for any patient-based collection.
    """

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

########################5/3/26##################33




async def fetch_doctor_speciality(
    doctor_id: str,
    collection
) -> list:
    """
    Fetch doctor's speciality using doctor sys_user_id
    """

    try:
        doc = await collection.find_one(
            {"sys_user_id": doctor_id},
            {
                "_id": 0,
                "specialization": 1
            }
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



from datetime import datetime
from typing import Dict, Any


async def fetch_patient_demographics(
    patient_id: str,
    collection
) -> Dict[str, Any]:
    """
    Fetch patient age and sex from demographics collection.
    """

    try:
        doc = await collection.find_one(
            {"sys_user_id": patient_id},
            {
                "_id": 0,
                "date_of_birth": 1,
                "gender": 1
            }
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

        return {
            "age": age,
            "sex": gender
        }

    except Exception as e:
        logger.error(f"❌ Failed fetching demographics: {str(e)}")
        return {}

async def fetch_agent_layer(
    patient_id: str,
    field_name: str,
    collection
) -> Dict[str, Any]:
    """
    Generic fetch for any agent layer collection.
    """

    try:
        doc = await collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0, field_name: 1}
        )

        if not doc:
            logger.warning(f"⚠️ No {field_name} found | patient_id={patient_id}")
            return {}

        return doc.get(field_name, {})

    except Exception as e:
        logger.error(f"❌ Failed fetching {field_name}: {str(e)}")
        return {}



async def fetch_laboratory_data(patient_id: str, collection) -> List[Dict[str, Any]]:
    """Fetch laboratory data from specific collection"""
    try:
        cursor = collection.find(
            {"patient_id": patient_id}
        ).sort("report_date", -1).limit(50)
        
        results = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            results.append(doc)
        
        return results
    except Exception as e:
        logger.error(f"❌ Failed to fetch lab data: {str(e)}")
        return []



async def fetch_latest_events(
    patient_id: str,
    eventdb_collection,
    limit: int = 5
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Fetch latest N events per feature in format:

    {
        "vital_signs": [
            { "date": "...", "data": {...} }
        ]
    }
    """

    try:
        logger.info(f"⏱ Fetching latest {limit} events | patient_id={patient_id}")

        doc = await eventdb_collection.find_one({"patient_id": patient_id})

        if not doc:
            return {}

        results = {}

        # ----------------------------------------------
        # 🔧 normalize date
        # ----------------------------------------------
        def extract_date(e):
            raw = (
                e.get("created_at")
                or e.get("report_date")
                or e.get("timestamp")
                or e.get("date")
                or ""
            )
            return raw.split("T")[0] if raw else ""

        # ----------------------------------------------
        # 🔵 FLAT FEATURES
        # ----------------------------------------------
        flat_features = [
            "vital_signs",
            "medication",
            "clinical_note",
            "treatment_plan",
            "investigation",
            "procedure_notes",
            "dictation",
            "dictations"
        ]

        for feature in flat_features:

            events = doc.get(feature, {}).get("event", [])

            formatted = []

            for e in sorted(
                events,
                key=lambda x: extract_date(x),
                reverse=True
            )[:limit]:

                formatted.append({
                    "date": extract_date(e),
                    "data": e.get("data", e)
                })

            if formatted:
                results[feature] = formatted

        # ----------------------------------------------
        # 🟣 DOCUMENT EVENTS (nested)
        # ----------------------------------------------
        document_tree = doc.get("document", {})

        document_events = []

        for category, subcats in document_tree.items():
            if not isinstance(subcats, dict):
                continue

            for subcategory, content in subcats.items():

                events = content.get("event", [])

                for e in events:
                    document_events.append({
                        "date": extract_date(e),
                        "category": category,
                        "subcategory": subcategory,
                        "data": e.get("data", e)
                    })

        if document_events:
            results["documents"] = sorted(
                document_events,
                key=lambda x: x.get("date", ""),
                reverse=True
            )[:limit]

        logger.info(f"✅ Latest events fetched | features={list(results.keys())}")

        return results

    except Exception as e:
        logger.error(f"❌ Failed to fetch latest events | error={str(e)}")
        return {}



async def fetch_pathology_data(patient_id: str, collection) -> List[Dict[str, Any]]:
    """Fetch pathology data from specific collection"""
    try:
        cursor = collection.find(
            {"patient_id": patient_id}
        ).sort("report_date", -1).limit(50)
        
        results = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            results.append(doc)
        
        return results
    except Exception as e:
        logger.error(f"❌ Failed to fetch pathology data: {str(e)}")
        return []


async def fetch_imaging_data(patient_id: str, collection) -> List[Dict[str, Any]]:
    """Fetch imaging data from specific collection"""
    try:
        cursor = collection.find(
            {"patient_id": patient_id}
        ).sort("report_date", -1).limit(50)
        
        results = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            results.append(doc)
        
        return results
    except Exception as e:
        logger.error(f"❌ Failed to fetch imaging data: {str(e)}")
        return []


async def fetch_procedure_notes(patient_id: str) -> List[Dict[str, Any]]:
    """Fetch all procedure notes"""
    try:
        cursor = procedure_notes_collection.find(
            {"patient_id": patient_id}
        ).sort("updated_at", -1).limit(50)
        
        results = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            results.append(doc)
        logger.info(f"procedure{results}")
        return results
    except Exception as e:
        logger.error(f"❌ Failed to fetch procedure notes: {str(e)}")
        return []




async def fetch_treatment_plan_minimum(patient_id: str, collection):
    try:
        logger.info(f"📄 Fetching treatment_plan minimum | patient_id={patient_id}")

        doc = await collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0, "treatment_plan.minimum": 1}
        )

        minimum = doc.get("treatment_plan", {}).get("minimum", []) if doc else []

        return minimum or []

    except Exception as e:
        logger.error(f"❌ fetch_treatment_plan_minimum error: {str(e)}")
        return []





async def fetch_investigation_minimum(patient_id: str, collection):
    try:
        logger.info(f"🧪 Fetching investigation minimum | patient_id={patient_id}")

        doc = await collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0, "investigation.minimum": 1}
        )

        minimum = doc.get("investigation", {}).get("minimum", []) if doc else []

        return minimum or []

    except Exception as e:
        logger.error(f"❌ fetch_investigation_minimum error: {str(e)}")
        return []






async def fetch_medication_minimum(patient_id: str, collection):
    try:
        logger.info(f"💊 Fetching medication minimum | patient_id={patient_id}")

        doc = await collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0, "medication.minimum": 1}
        )

        minimum = doc.get("medication", {}).get("minimum", []) if doc else []

        return minimum or []

    except Exception as e:
        logger.error(f"❌ fetch_medication_minimum error: {str(e)}")
        return []






async def fetch_clinical_note_minimum(patient_id: str, collection):
    try:
        logger.info(f"📝 Fetching clinical_note minimum | patient_id={patient_id}")

        doc = await collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0, "clinical_note.minimum": 1}
        )

        minimum = doc.get("clinical_note", {}).get("minimum", []) if doc else []

        return minimum or []

    except Exception as e:
        logger.error(f"❌ fetch_clinical_note_minimum error: {str(e)}")
        return []


async def fetch_dictation_minimum(
    patient_id: str,
    collection
):
    """
    Fetch ONLY consolidated minimum dictation
    from clinical eventDB.
    """

    try:
        logger.info(f"🎙️ Fetching dictation minimum | patient_id={patient_id}")

        doc = await collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0, "dictation.minimum": 1}
        )

        if not doc:
            logger.warning(
                f"⚠️ No dictation document found | patient_id={patient_id}"
            )
            return []

        minimum = doc.get("dictation", {}).get("minimum", [])

        if not minimum:
            logger.warning(
                f"⚠️ Dictation minimum empty | patient_id={patient_id}"
            )
            return []

        logger.info(
            f"✅ Dictation minimum fetched | patient_id={patient_id} | count={len(minimum)}"
        )

        logger.debug(f"🎙️ Dictation preview: {str(minimum)[:500]}")

        return minimum

    except Exception as e:
        logger.error(
            f"❌ Failed to fetch dictation minimum | patient_id={patient_id} | error={str(e)}"
        )
        return []



async def fetch_procedure_notes_minimum(
    patient_id: str,
    collection
):
    """
    Fetch ONLY consolidated minimum procedure notes
    from clinical eventDB.
    """

    try:
        logger.info(f"🩺 Fetching procedure_notes minimum | patient_id={patient_id}")

        doc = await collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0, "procedure_notes.minimum": 1}
        )

        if not doc:
            logger.warning(
                f"⚠️ No procedure_notes document found | patient_id={patient_id}"
            )
            return []

        minimum = doc.get("procedure_notes", {}).get("minimum", [])

        if not minimum:
            logger.warning(
                f"⚠️ procedure_notes minimum empty | patient_id={patient_id}"
            )
            return []

        logger.info(
            f"✅ procedure_notes minimum fetched | patient_id={patient_id} | count={len(minimum)}"
        )

        return minimum

    except Exception as e:
        logger.error(
            f"❌ Failed to fetch procedure_notes minimum | patient_id={patient_id} | error={str(e)}"
        )
        return []




async def fetch_all_documents(patient_id: str) -> List[Dict[str, Any]]:
    """Fetch all documents from document_categories"""
    try:
        cursor = document_categories_collection.find(
            {"patient_id": patient_id}
        ).sort("created_at", -1).limit(100)
        
        results = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            results.append(doc)
        
        return results
    except Exception as e:
        logger.error(f"❌ Failed to fetch documents: {str(e)}")
        return []

async def fetch_document_minimum(
    patient_id: str,
    eventdb_collection
) -> List[Dict[str, Any]]:
    """
    Fetch ALL nested document minimum snapshots
    and attach category + subcategory info
    """

    try:
        logger.info(f"📄 Fetching document minimum | patient_id={patient_id}")

        doc = await eventdb_collection.find_one(
            {"patient_id": patient_id},
            {"document": 1}
        )

        if not doc:
            logger.warning(f"⚠️ No eventdb document found | patient_id={patient_id}")
            return []

        document_tree = doc.get("document", {})

        results: List[Dict[str, Any]] = []

        # 🔥 Traverse nested structure
        for category, subcats in document_tree.items():

            if not isinstance(subcats, dict):
                continue

            for subcategory, content in subcats.items():

                minimum = content.get("minimum", [])

                if not isinstance(minimum, list):
                    continue

                for item in minimum:
                    results.append({
                        "category": category,
                        "subcategory": subcategory,
                        "data": item
                    })

        logger.info(f"✅ Document minimum fetched | count={len(results)}")

        return results

    except Exception as e:
        logger.error(
            f"❌ Failed to fetch document minimum | patient_id={patient_id} | error={str(e)}"
        )
        return []



async def fetch_vital_signs(
    patient_id: str,
    eventdb_collection
) -> List[Dict[str, Any]]:
    """
    Fetch ONLY consolidated minimum vitals
    based on save_feature_from_llm schema.
    """

    try:
        logger.info(f"📈 Fetching MINIMUM vital signs | patient_id={patient_id}")

        doc = await eventdb_collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0, "vitals.minimum": 1}
        )

        if not doc:
            logger.warning(
                f"⚠️ No vitals document found | patient_id={patient_id}"
            )
            return []

        minimum_vitals = doc.get("vitals", {}).get("minimum", [])

        if not minimum_vitals:
            logger.warning(
                f"⚠️ Minimum vitals empty | patient_id={patient_id}"
            )
            return []

        logger.info(
            f"✅ Minimum vitals fetched | patient_id={patient_id} | count={len(minimum_vitals)}"
        )

        logger.debug(f"📈 Minimum vitals snapshot: {minimum_vitals}")

        return minimum_vitals

    except Exception as e:
        logger.error(
            f"❌ Failed to fetch minimum vital signs | patient_id={patient_id} | error={str(e)}"
        )
        return []


# =====================================================================
# CLINICAL CONTEXT FETCHER
# =====================================================================

async def fetch_clinical_context(patient_id: str, doctor_id: str) -> Dict[str, Any]:
    """
    Fetch clinical context - interpreted, problem-focused clinical state
    
    Clinical Context = What the facts mean for current clinical problem
    - Primary active problem
    - Disease course from onset to present
    - Treatments attempted and responses
    - Diagnostics relevant to current problem
    - Cross-specialty interactions
    - Current clinical goals
    """
    logger.info(f"🏥 Fetching Clinical Context: Patient={patient_id}")
    
    try:
        clinical_context = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "timestamp": datetime.utcnow().isoformat(),
            "primary_problem": None,
            "active_diagnoses": [],
            "baseline_status": None,
            "disease_course": [],
            "treatments_attempted": [],
            "medication_changes": [],
            "relevant_diagnostics": {
                "labs": [],
                "imaging": [],
                "pathology": [],
                "microbiology": []
            },
            "comorbidities": [],
            "symptoms": [],
            "clinical_goals": [],
            "cross_specialty_notes": []
        }
        
        # Fetch conversation data (contains clinical reasoning)
        conversations = await fetch_conversations(patient_id, doctor_id)
        clinical_context["disease_course"] = conversations
        
        # Fetch dictation data (treatment plans, clinical notes)
        dictations = await fetch_dictations(patient_id, doctor_id)
        clinical_context["treatments_attempted"] = dictations
        
        # Fetch treatment plans
        treatment_plans = await fetch_treatment_plans(patient_id, doctor_id)
        clinical_context["medication_changes"] = treatment_plans
        
        # Fetch investigation notes
        investigations = await fetch_investigation_notes(patient_id, doctor_id)
        clinical_context["relevant_diagnostics"]["labs"] = investigations
        
        # Extract active diagnoses from recent data
        clinical_context["active_diagnoses"] = await extract_active_diagnoses(
            patient_id, doctor_id
        )
        
        logger.info(f"✅ Clinical Context Fetched: {len(clinical_context['active_diagnoses'])} active diagnoses")
        
        return clinical_context
        
    except Exception as e:
        logger.error(f"❌ Failed to fetch clinical context: {str(e)}")
        return {}


async def fetch_conversations(patient_id: str, doctor_id: str) -> List[Dict[str, Any]]:
    """Fetch doctor-patient conversations"""
    try:
        cursor = conversation_user_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("created_at", -1).limit(20)
        
        results = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            results.append(doc)
        
        return results
    except Exception as e:
        logger.error(f"❌ Failed to fetch conversations: {str(e)}")
        return []


async def fetch_dictations(patient_id: str, doctor_id: str) -> List[Dict[str, Any]]:
    """Fetch doctor dictations"""

    try:
        logger.info(
            f"📄 Fetching dictations for patient_id={patient_id}, doctor_id={doctor_id}"
        )

        cursor = dictation_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("created_at", -1).limit(20)

        results = []

        async for doc in cursor:
            logger.debug(f"➡️ Found dictation _id={doc.get('_id')}")

            doc["_id"] = str(doc["_id"])
            results.append(doc)

        logger.info(f"✅ Total dictations fetched: {len(results)}")

        return results

    except Exception as e:
        logger.error(f"❌ Failed to fetch dictations: {str(e)}", exc_info=True)
        return []


async def fetch_treatment_plans(patient_id: str, doctor_id: str) -> List[Dict[str, Any]]:
    """Fetch treatment plans"""
    try:
        cursor = documentation_treatment_plan_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("created_at", -1).limit(10)
        
        results = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            results.append(doc)
        
        return results
    except Exception as e:
        logger.error(f"❌ Failed to fetch treatment plans: {str(e)}")
        return []


async def fetch_investigation_notes(patient_id: str, doctor_id: str) -> List[Dict[str, Any]]:
    """Fetch investigation notes"""
    try:
        cursor = documentation_investigation_notes_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("created_at", -1).limit(20)
        
        results = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            results.append(doc)
        
        return results
    except Exception as e:
        logger.error(f"❌ Failed to fetch investigation notes: {str(e)}")
        return []


async def extract_active_diagnoses(patient_id: str, doctor_id: str) -> List[str]:
    """Extract active diagnoses from recent documentation"""
    try:
        # Get recent treatment plans and dictations
        recent_plans = await documentation_treatment_plan_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("created_at", -1).limit(5).to_list(5)
        
        diagnoses = []
        for plan in recent_plans:
            # Extract diagnoses from processed_data
            if "processed_data" in plan:
                for item in plan["processed_data"]:
                    if isinstance(item, dict) and "diagnosis" in item:
                        diagnoses.append(item["diagnosis"])
        
        return list(set(diagnoses))  # Remove duplicates
        
    except Exception as e:
        logger.error(f"❌ Failed to extract diagnoses: {str(e)}")
        return []


# =====================================================================
# LONGITUDINAL CONTEXT FETCHER
# =====================================================================

async def fetch_longitudinal_context(patient_id: str, doctor_id: str) -> Dict[str, Any]:
    """
    Fetch longitudinal context - time-based disease trajectory
    
    Longitudinal Context = How patient's condition changes over time
    - Baseline values
    - Sequential lab trends
    - Imaging evolution
    - Symptom progression
    - Treatment responses
    - Recurrence patterns
    - Outcomes tracking
    """
    logger.info(f"📈 Fetching Longitudinal Context: Patient={patient_id}")
    
    try:
        longitudinal_context = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "timestamp": datetime.utcnow().isoformat(),
            "baseline_values": {},
            "lab_trends": [],
            "imaging_evolution": [],
            "symptom_progression": [],
            "treatment_responses": [],
            "disease_trajectory": "unknown",  # improving/stable/deteriorating
            "time_series_data": {
                "last_7_days": [],
                "last_30_days": [],
                "last_90_days": [],
                "last_year": []
            }
        }
        
        # Fetch time-series lab data
        longitudinal_context["lab_trends"] = await fetch_lab_trends(patient_id)
        
        # Fetch time-series imaging
        longitudinal_context["imaging_evolution"] = await fetch_imaging_trends(patient_id)
        
        # Fetch treatment response timeline
        longitudinal_context["treatment_responses"] = await fetch_treatment_timeline(
            patient_id, doctor_id
        )
        
        # Calculate disease trajectory
        longitudinal_context["disease_trajectory"] = await calculate_trajectory(
            longitudinal_context["lab_trends"],
            longitudinal_context["imaging_evolution"]
        )
        
        # Organize by time periods
        longitudinal_context["time_series_data"] = await organize_by_timeperiod(
            patient_id, doctor_id
        )
        
        logger.info(f"✅ Longitudinal Context Fetched: Trajectory={longitudinal_context['disease_trajectory']}")
        
        return longitudinal_context
        
    except Exception as e:
        logger.error(f"❌ Failed to fetch longitudinal context: {str(e)}")
        return {}


async def fetch_lab_trends(patient_id: str) -> List[Dict[str, Any]]:
    """Fetch laboratory trends over time"""
    try:
        # Fetch from all lab collections
        collections = [
            laboratory_hematology_collection,
            laboratory_biochemistry_collection,
            laboratory_microbiology_collection
        ]
        
        all_trends = []
        
        for collection in collections:
            cursor = collection.find(
                {"patient_id": patient_id}
            ).sort("report_date", -1).limit(100)
            
            async for doc in cursor:
                doc["_id"] = str(doc["_id"])
                all_trends.append(doc)
        
        # Sort by date
        all_trends.sort(key=lambda x: x.get("report_date", ""), reverse=True)
        
        return all_trends
        
    except Exception as e:
        logger.error(f"❌ Failed to fetch lab trends: {str(e)}")
        return []


async def fetch_imaging_trends(patient_id: str) -> List[Dict[str, Any]]:
    """Fetch imaging trends over time"""
    try:
        collections = [
            imaging_xray_collection,
            imaging_ct_collection,
            imaging_mri_collection,
            imaging_ultrasound_collection
        ]
        
        all_imaging = []
        
        for collection in collections:
            cursor = collection.find(
                {"patient_id": patient_id}
            ).sort("report_date", -1).limit(50)
            
            async for doc in cursor:
                doc["_id"] = str(doc["_id"])
                all_imaging.append(doc)
        
        # Sort by date
        all_imaging.sort(key=lambda x: x.get("report_date", ""), reverse=True)
        
        return all_imaging
        
    except Exception as e:
        logger.error(f"❌ Failed to fetch imaging trends: {str(e)}")
        return []


async def fetch_treatment_timeline(patient_id: str, doctor_id: str) -> List[Dict[str, Any]]:
    """Fetch treatment timeline with responses"""
    try:
        # Fetch procedures with outcomes
        procedures = await procedure_notes_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("updated_at", -1).to_list(50)
        
        # Fetch medication changes
        medications = await documentation_medication_analysis_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("created_at", -1).to_list(50)
        
        timeline = []
        
        for proc in procedures:
            proc["_id"] = str(proc["_id"])
            proc["type"] = "procedure"
            timeline.append(proc)
        
        for med in medications:
            med["_id"] = str(med["_id"])
            med["type"] = "medication"
            timeline.append(med)
        
        # Sort by date
        timeline.sort(
            key=lambda x: x.get("updated_at") or x.get("created_at", datetime.min),
            reverse=True
        )
        
        return timeline
        
    except Exception as e:
        logger.error(f"❌ Failed to fetch treatment timeline: {str(e)}")
        return []




# Compares recent vs older values
# Returns: "improving" | "stable" | "deteriorating"
async def calculate_trajectory(lab_trends: List, imaging_trends: List) -> str:
    """Calculate disease trajectory from trends"""
    try:
        # Simple heuristic: check if recent values are better or worse
        if not lab_trends:
            return "unknown"
        
        # This is a simplified example - in production, implement proper
        # trend analysis with statistical methods
        
        recent_labs = lab_trends[:5]
        older_labs = lab_trends[5:10] if len(lab_trends) > 5 else []
        
        if not older_labs:
            return "stable"
        
        # Compare trends (simplified)
        # In production: analyze specific parameters, their reference ranges, etc.
        
        return "stable"  # Default for now
        
    except Exception as e:
        logger.error(f"❌ Failed to calculate trajectory: {str(e)}")
        return "unknown"


async def organize_by_timeperiod(patient_id: str, doctor_id: str) -> Dict[str, List]:
    """Organize data by time periods"""
    try:
        now = datetime.utcnow()
        
        periods = {
            "last_7_days": now - timedelta(days=7),
            "last_30_days": now - timedelta(days=30),
            "last_90_days": now - timedelta(days=90),
            "last_year": now - timedelta(days=365)
        }
        
        time_series = {}
        
        for period_name, cutoff_date in periods.items():
            # Fetch all data after cutoff date
            data = []
            
            # Labs
            cursor = laboratory_hematology_collection.find({
                "patient_id": patient_id,
                "report_date": {"$gte": cutoff_date.isoformat()}
            })
            async for doc in cursor:
                doc["_id"] = str(doc["_id"])
                doc["data_type"] = "lab"
                data.append(doc)
            
            # Imaging
            cursor = imaging_ct_collection.find({
                "patient_id": patient_id,
                "report_date": {"$gte": cutoff_date.isoformat()}
            })
            async for doc in cursor:
                doc["_id"] = str(doc["_id"])
                doc["data_type"] = "imaging"
                data.append(doc)
            
            # Procedures
            cursor = procedure_notes_collection.find({
                "patient_id": patient_id,
                "updated_at": {"$gte": cutoff_date}
            })
            async for doc in cursor:
                doc["_id"] = str(doc["_id"])
                doc["data_type"] = "procedure"
                data.append(doc)
            
            time_series[period_name] = data
        
        return time_series
        
    except Exception as e:
        logger.error(f"❌ Failed to organize by time period: {str(e)}")
        return {}

















# =====================================================================
# ENHANCED STATE WITH RAG CONTEXT
# =====================================================================

class ClinicalReasoningState(TypedDict):
    """Enhanced state with RAG context"""
    # Input
    patient_id: str
    doctor_id: str
    consultation_text: str
    medical_context: Dict[str, Any]
    clinical_context: Dict[str, Any]
    longitudinal_context: Dict[str, Any]
    
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


    #  NEW FIELDS FOR THE 7 CRITICAL AGENTS:
    differential_diagnosis: Optional[Dict[str, Any]]
    medication_reconciliation: Optional[Dict[str, Any]]
    guideline_compliance: Optional[Dict[str, Any]]
    clinical_deterioration_warning: Optional[Dict[str, Any]]
    diagnostic_test_appropriateness: Optional[Dict[str, Any]]
    comorbidity_interaction: Optional[Dict[str, Any]]
    discharge_readiness: Optional[Dict[str, Any]]
    patient_summary:Optional[Dict[str, Any]]
    longitudinal_story: Optional[Dict[str, Any]]



# =====================================================================
# RAG RETRIEVAL AGENT
# =====================================================================


#STEP 6: AGENT 1 - RAG Retrieval Agent

# Modify it in Version 2

# Version 2 New Modification
# 4-02-2026 Abi
# Start point
#_________________________________________

# async def retrieve_rag_context(state: ClinicalReasoningState) -> ClinicalReasoningState:
#     """
#     Retrieve relevant context using Graph-RAG system before reasoning
#     """
#     logger.info("🔍 RAG Retrieval Agent: Starting context retrieval")
    
#     try:
#         patient_id = state["patient_id"]
#         consultation_text = state["consultation_text"]
        
#         # Index patient data into RAG system
#         await graph_rag_system.index_patient_data(
#             patient_id=patient_id,
#             medical_context=state["medical_context"],
#             clinical_context=state["clinical_context"],
#             longitudinal_context=state["longitudinal_context"]
#         )



#          # Neo4j Graph Structure:
#     # (Patient:P12345)
#     #   ├─[:HAS_DIAGNOSIS]→(Diagnosis:Acute Appendicitis)
#     #   ├─[:HAS_LAB_RESULT]→(LabResult:Hematology:2026-01-25)
#     #   ├─[:HAS_IMAGING]→(Imaging:CT:2026-01-20)
#     #   └─[:RECEIVED_TREATMENT]→(Treatment:Antibiotics:2026-01-22)
        
#         # Retrieve relevant context
#         rag_results = await graph_rag_system.retrieve_relevant_context(
#             query=consultation_text,
#             patient_id=patient_id,
#             top_k=10
#         )


    
        
#         # Store RAG context in state
#         serialized_docs = serialize_documents(rag_results.get("vector_results", []))

#         state["rag_context"] = {
#             "vector_results": serialized_docs,
#             "graph_results": rag_results.get("graph_results", {}),
#             "temporal_results": rag_results.get("temporal_results", {})
#         }

#         state["relevant_documents"] = serialized_docs
#         state["graph_relationships"] = rag_results.get("graph_results", {})
#         state["temporal_trends"] = rag_results.get("temporal_results", {})

        
#         logger.info(f"✅ RAG Retrieval Complete: {len(state['relevant_documents'])} documents retrieved")
        
#     except Exception as e:
#         logger.error(f"❌ RAG Retrieval failed: {str(e)}")
#         state["error"] = f"RAG retrieval error: {str(e)}"
    
#     return state



# async def retrieve_rag_context(state: ClinicalReasoningState) -> ClinicalReasoningState:
#     """
#     Retrieve relevant context using Graph-RAG system before reasoning
#     NOW WITH HIERARCHICAL STRUCTURING
#     """
#     logger.info("🔍 RAG Retrieval Agent: Starting context retrieval")
    
#     try:
#         patient_id = state["patient_id"]
#         consultation_text = state["consultation_text"]
        
#         # Index patient data into RAG system
#         await graph_rag_system.index_patient_data(
#             patient_id=patient_id,
#             medical_context=state["medical_context"],
#             clinical_context=state["clinical_context"],
#             longitudinal_context=state["longitudinal_context"]
#         )
        
#         # Retrieve relevant context
#         rag_results = await graph_rag_system.retrieve_relevant_context(
#             query=consultation_text,
#             patient_id=patient_id,
#             top_k=10
#         )
        
#         # ✅ NEW: Structure the RAG context into tiers
#         logger.info("📊 Structuring RAG context into hierarchical tiers...")
        
#         # Extract critical facts (100-200 tokens)
#         critical_summary = await _extract_critical_facts(rag_results)
        
#         # Create domain index (300-400 tokens)
#         domain_indices = await _create_domain_index(rag_results)
        
#         # Store in structured format
#         serialized_docs = serialize_documents(rag_results.get("vector_results", []))
        
#         state["rag_context_structured"] = {
#             "critical_summary": critical_summary,
#             "domain_indices": domain_indices,
#             "full_context": {
#                 "vector_results": serialized_docs,
#                 "graph_results": rag_results.get("graph_results", {}),
#                 "temporal_results": rag_results.get("temporal_results", {})
#             }
#         }
        
#         # Keep old format for backward compatibility
#         state["rag_context"] = {
#             "vector_results": serialized_docs,
#             "graph_results": rag_results.get("graph_results", {}),
#             "temporal_results": rag_results.get("temporal_results", {})
#         }
        
#         state["relevant_documents"] = serialized_docs
#         state["graph_relationships"] = rag_results.get("graph_results", {})
#         state["temporal_trends"] = rag_results.get("temporal_results", {})
        
#         logger.info(f"✅ RAG Retrieval Complete with hierarchical structuring")
#         logger.info(f"   - Critical summary: {len(critical_summary)} chars")
#         logger.info(f"   - Domain indices: {len(domain_indices)} categories")
#         logger.info(f"   - Full context: {len(serialized_docs)} documents")
        
#     except Exception as e:
#         logger.error(f"❌ RAG Retrieval failed: {str(e)}")
#         state["error"] = f"RAG retrieval error: {str(e)}"
#         # Set empty structured context
#         state["rag_context_structured"] = {
#             "critical_summary": "RAG retrieval failed",
#             "domain_indices": {},
#             "full_context": {}
#         }
    
#     return state

# abi fix 08-02-2026

async def retrieve_rag_context(state: ClinicalReasoningState) -> ClinicalReasoningState:
    """
    Retrieve relevant context using Graph-RAG system before reasoning
    """
    logger.info("🔍 RAG Retrieval Agent: Starting context retrieval")
    
    try:
        patient_id = state["patient_id"]
        consultation_text = state["consultation_text"]
        
        # ✅ DEBUG: Log what we're indexing
        medical = state.get("medical_context", {})
        clinical = state.get("clinical_context", {})
        longitudinal = state.get("longitudinal_context", {})
        
        logger.info(f"📊 Indexing data for RAG:")
        logger.info(f"   - Labs: {sum(len(v) for v in medical.get('laboratory_results', {}).values())}")
        logger.info(f"   - Imaging: {sum(len(v) for v in medical.get('imaging', {}).values())}")
        logger.info(f"   - Diagnoses: {len(clinical.get('active_diagnoses', []))}")
        logger.info(f"   - Trends: {len(longitudinal.get('lab_trends', []))}")
        
        # Index patient data into RAG system
        await graph_rag_system.index_patient_data(
            patient_id=patient_id,
            medical_context=medical,
            clinical_context=clinical,
            longitudinal_context=longitudinal
        )
        
        # Retrieve relevant context
        rag_results = await graph_rag_system.retrieve_relevant_context(
            query=consultation_text,
            patient_id=patient_id,
            top_k=10
        )
        
        # ✅ CRITICAL FIX: Check if we got results
        vector_results = rag_results.get("vector_results", [])
        if not vector_results:
            logger.warning("⚠️ RAG retrieval returned no documents - agents will use raw context only")
        
        # Store in state
        serialized_docs = serialize_documents(vector_results)
        
        state["rag_context"] = {
            "vector_results": serialized_docs,
            "graph_results": rag_results.get("graph_results", {}),
            "temporal_results": rag_results.get("temporal_results", {})
        }
        state["relevant_documents"] = serialized_docs
        state["graph_relationships"] = rag_results.get("graph_results", {})
        state["temporal_trends"] = rag_results.get("temporal_results", {})
        
        logger.info(f"✅ RAG Retrieval Complete: {len(serialized_docs)} documents retrieved")
        
    except Exception as e:
        logger.error(f"❌ RAG Retrieval failed: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        state["error"] = f"RAG retrieval error: {str(e)}"
        # Don't fail the whole workflow if RAG fails
        state["rag_context"] = {"error": str(e), "vector_results": []}
        state["relevant_documents"] = []
    
    return state


async def _extract_critical_facts(rag_results: Dict[str, Any]) -> str:
    """
    Extract only the most critical clinical facts from RAG results
    Target: 100-200 tokens max
    """
    try:
        vector_results = rag_results.get("vector_results", [])
        
        if not vector_results:
            return "No critical findings from RAG retrieval."
        
        # Take top 5 most relevant documents
        top_docs = vector_results[:5]
        
        # Build compact summary
        facts = []
        for i, doc in enumerate(top_docs, 1):
            if hasattr(doc, 'page_content'):
                # Extract first 100 chars of most relevant content
                content = doc.page_content[:100].strip()
                doc_type = doc.metadata.get('subtype', 'unknown')
                facts.append(f"{i}. [{doc_type}] {content}...")
        
        if not facts:
            return "No critical findings extracted."
        
        # Use LLM to compress into 3 key findings
        prompt = f"""Extract ONLY the top 3 most critical clinical findings from these documents:

{chr(10).join(facts)}

Rules:
- Maximum 1 sentence per finding
- Focus on abnormal/critical values only
- Use medical abbreviations
- Format: 1. Finding, 2. Finding, 3. Finding

Critical Findings:"""
        
        try:
            response = llm.invoke([
                SystemMessage(content="You extract critical clinical facts concisely."),
                HumanMessage(content=prompt)
            ])
            return response.content.strip()
        except Exception as e:
            logger.warning(f"LLM compression failed, using raw summary: {e}")
            return "\n".join(facts[:3])
            
    except Exception as e:
        logger.error(f"Critical facts extraction failed: {e}")
        return "Critical facts extraction unavailable."


async def _create_domain_index(rag_results: Dict[str, Any]) -> Dict[str, str]:
    """
    Create metadata index showing what data is available
    Target: 300-400 tokens max
    """
    try:
        vector_results = rag_results.get("vector_results", [])
        graph_results = rag_results.get("graph_results", {})
        temporal_results = rag_results.get("temporal_results", {})
        
        # Count documents by type
        doc_counts = {}
        date_ranges = {}
        
        for doc in vector_results:
            if hasattr(doc, 'metadata'):
                doc_type = doc.metadata.get('type', 'unknown')
                doc_subtype = doc.metadata.get('subtype', 'unknown')
                key = f"{doc_type}_{doc_subtype}"
                
                doc_counts[key] = doc_counts.get(key, 0) + 1
                
                # Track date ranges if available
                # (You can extract dates from metadata if stored)
        
        # Build index
        index = {
            "vector_search_results": f"{len(vector_results)} documents retrieved",
            "document_breakdown": {},
            "graph_relationships": {},
            "temporal_data": {}
        }
        
        # Document breakdown
        for key, count in doc_counts.items():
            doc_type, subtype = key.split('_', 1)
            if doc_type not in index["document_breakdown"]:
                index["document_breakdown"][doc_type] = {}
            index["document_breakdown"][doc_type][subtype] = f"{count} records"
        
        # Graph relationships summary
        if graph_results:
            index["graph_relationships"] = {
                "diagnoses": f"{len(graph_results.get('diagnoses', []))} active diagnoses",
                "labs": f"{len(graph_results.get('labs', []))} lab results",
                "imaging": f"{len(graph_results.get('imaging', []))} imaging studies",
                "treatments": f"{len(graph_results.get('treatments', []))} treatments"
            }
        
        # Temporal data summary
        if temporal_results:
            trends = temporal_results.get('trends', [])
            index["temporal_data"] = {
                "trend_points": f"{len(trends)} temporal data points",
                "analysis": "Available" if temporal_results.get('analysis') else "Not computed"
            }
        
        return index
        
    except Exception as e:
        logger.error(f"Domain index creation failed: {e}")
        return {"error": "Domain indexing unavailable"}


def _format_domain_index_for_prompt(domain_index: Dict[str, Any]) -> str:
    """Format domain index into readable text for prompts"""
    lines = ["AVAILABLE DATA DOMAINS:"]
    
    # Vector results
    lines.append(f"\n📊 {domain_index.get('vector_search_results', 'No data')}")
    
    # Document breakdown
    breakdown = domain_index.get('document_breakdown', {})
    if breakdown:
        lines.append("\n📁 Document Types:")
        for doc_type, subtypes in breakdown.items():
            lines.append(f"  • {doc_type}:")
            for subtype, count in subtypes.items():
                lines.append(f"    - {subtype}: {count}")
    
    # Graph relationships
    graph = domain_index.get('graph_relationships', {})
    if graph:
        lines.append("\n🔗 Knowledge Graph:")
        for key, value in graph.items():
            lines.append(f"  • {key}: {value}")
    
    # Temporal data
    temporal = domain_index.get('temporal_data', {})
    if temporal:
        lines.append("\n📈 Temporal Analysis:")
        for key, value in temporal.items():
            lines.append(f"  • {key}: {value}")
    
    return "\n".join(lines)


async def _get_domain_specific_data(
    rag_context_structured: Dict[str, Any],
    domain: str,
    subdomain: Optional[str] = None,
    limit: int = 5
) -> List[Any]:
    """
    Extract specific domain data from full RAG context
    Used by agents to pull only what they need
    """
    try:
        full_context = rag_context_structured.get("full_context", {})
        vector_results = full_context.get("vector_results", [])
        
        filtered = []
        for doc in vector_results:
            if not hasattr(doc, 'metadata'):
                continue
                
            doc_type = doc.metadata.get('type', '')
            doc_subtype = doc.metadata.get('subtype', '')
            
            # Match domain
            if domain.lower() in doc_type.lower():
                if subdomain:
                    if subdomain.lower() in doc_subtype.lower():
                        filtered.append(doc)
                else:
                    filtered.append(doc)
        
        return filtered[:limit]
        
    except Exception as e:
        logger.error(f"Domain-specific data extraction failed: {e}")
        return []



#version 2 New Modification 
# 4-02-2026 Abi
# End point
#_________________________________________


# =====================================================================
# ENHANCED AGENTS WITH RAG CONTEXT
# =====================================================================

class EnhancedDiseaseCausationAgent:
    """Disease Causation Agent with RAG context"""
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
    
    async def analyze(self, state: ClinicalReasoningState) -> ClinicalReasoningState:
        """Analyze disease causation with RAG-enhanced context"""
        
        logger.info("🔬 Enhanced Disease Causation Agent: Starting analysis")
        
        # Extract RAG context
        relevant_docs = state.get("relevant_documents", [])
        graph_data = state.get("graph_relationships", {})
        temporal_data = state.get("temporal_trends", {})
        
        # Format RAG context for prompt
        rag_context_text = self._format_rag_context(relevant_docs, graph_data, temporal_data)
        
        prompt = f"""
You are a medical pathophysiology expert analyzing disease causation with access to comprehensive patient data.

PATIENT CLINICAL CONTEXT:
{safe_json(state.get("clinical_context", {}))}

CONSULTATION:
{state.get("consultation_text", "")}

RETRIEVED RELEVANT INFORMATION (RAG-Enhanced):
{rag_context_text}

KNOWLEDGE GRAPH RELATIONSHIPS:
Active Diagnoses: {', '.join(graph_data.get('diagnoses', []))}
Recent Labs: {len(graph_data.get('labs', []))} results
Recent Imaging: {len(graph_data.get('imaging', []))} studies
Treatments: {len(graph_data.get('treatments', []))} interventions

TEMPORAL TRENDS:
{safe_json(temporal_data)}

YOUR TASK:
Analyze disease causation using ALL available information including:
1. Current consultation findings
2. Historical patient data from RAG retrieval
3. Knowledge graph relationships
4. Temporal trends and progression patterns

Provide comprehensive analysis of:
1. PRIMARY ETIOLOGY - with evidence from multiple sources
2. RISK FACTORS - both modifiable and non-modifiable
3. CONTRIBUTING FACTORS - from patient history
4. DISEASE PROGRESSION PATHWAY - based on temporal data
5. CAUSATION CONFIDENCE - based on data completeness

CRITICAL RULES:
- Cross-reference findings across multiple data sources
- Use temporal trends to validate causation theories
- Consider relationships in knowledge graph
- Flag any conflicting information between sources
- Base confidence on data triangulation

1. You MUST ONLY use information explicitly present in the INPUT DATA below
2. If a field is empty/missing, you MUST state "No data provided" 
3. NEVER invent symptoms, lab values, imaging findings, or diagnoses
4. If insufficient data exists, you MUST respond with limitations
5. For "routine check-up" with no symptoms: Focus on health maintenance

OUTPUT FORMAT (JSON):
{{
  "primary_etiology": {{
    "diagnosis": "string",
    "mechanism": "detailed pathophysiology",
    "evidence_strength": "definite|probable|possible",
    "supporting_evidence": [
      {{
        "source": "rag|graph|temporal|consultation",
        "finding": "specific evidence",
        "date": "when observed"
      }}
    ],
    "confidence": 0.0-1.0
  }},
  "risk_factors": {{
    "modifiable": [...],
    "non_modifiable": [...]
  }},
  "contributing_factors": [...],
  "progression_pathway": {{
    "natural_history": "string",
    "expected_trajectory": "improving|stable|worsening",
    "reversibility": "fully_reversible|partially_reversible|irreversible",
    "evidence_from_trends": "string"
  }},
  "data_triangulation": {{
    "consistent_findings": ["findings that appear across multiple sources"],
    "conflicting_findings": ["any contradictions between sources"],
    "data_quality": "excellent|good|fair|poor"
  }},
  "missing_information": ["string"],
  "confidence_score": 0.0-1.0
}}
"""
        
        try:
            response = self.llm.invoke([
                SystemMessage(content="You are an expert medical pathophysiology analyst with access to comprehensive patient data."),
                HumanMessage(content=prompt)
            ])
            
            result = self._parse_response(response.content)
            state["disease_causation"] = result
            state["confidence_scores"]["disease_causation"] = result.get("confidence_score", 0.0)
            
            logger.info("✅ Enhanced Disease Causation Agent: Analysis complete")
            
        except Exception as e:
            logger.error(f"❌ Enhanced Disease Causation Agent failed: {str(e)}")
            state["error"] = f"Disease causation analysis failed: {str(e)}"
        
        return state
    
    def _format_rag_context(
        self,
        relevant_docs: List,
        graph_data: Dict,
        temporal_data: Dict
    ) -> str:
        """Format RAG context for prompt"""
        context_parts = []
        
        # Add relevant documents
        if relevant_docs:
            context_parts.append("RELEVANT HISTORICAL FINDINGS:")
            for i, doc in enumerate(relevant_docs[:5], 1):
                if hasattr(doc, 'page_content'):
                    context_parts.append(f"{i}. {doc.page_content[:300]}...")
                    if hasattr(doc, 'metadata'):
                        context_parts.append(f"   Source: {doc.metadata.get('type')} - {doc.metadata.get('subtype')}")
        
        # Add graph relationships
        if graph_data:
            context_parts.append("\nKNOWLEDGE GRAPH INSIGHTS:")
            if graph_data.get('diagnoses'):
                context_parts.append(f"Established Diagnoses: {', '.join(graph_data['diagnoses'])}")
            
            if graph_data.get('labs'):
                recent_labs = graph_data['labs'][:3]
                context_parts.append(f"Recent Lab Results: {len(recent_labs)} results available")
                for lab in recent_labs:
                    context_parts.append(f"  - {lab.get('type')}: {lab.get('date')}")
        
        # Add temporal insights
        if temporal_data and temporal_data.get('trends'):
            context_parts.append("\nTEMPORAL PROGRESSION:")
            trends = temporal_data['trends'][:5]
            for trend in trends:
                context_parts.append(f"  - {trend.get('type')}: {trend.get('date')}")
        
        return "\n".join(context_parts)
    
    def _parse_response(self, content: str) -> dict:
        try:
            content = content.strip()

            # Case 1: Extract JSON inside ```json blocks
            if "```json" in content:
                json_part = content.split("```json", 1)[1]
                json_part = json_part.split("```", 1)[0]
                return json.loads(json_part.strip())

            # Case 2: Extract any {...} JSON (fallback)
            start = content.find("{")
            end = content.rfind("}")
            if start != -1 and end != -1:
                return json.loads(content[start:end + 1])

            raise ValueError("No JSON found")

        except Exception as e:
            logger.warning(f"⚠️ Risk Stratification JSON parse failed: {e}")
            return {
                "raw_content": content,
                "confidence_score": 0.5
            }


# =====================================================================
# CONTEXT ENRICHMENT AGENT
# =====================================================================

class ContextEnrichmentAgent:
    """
    Agent that enriches clinical context with additional insights
    from RAG retrieval
    """
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
    

    #STEP 7: AGENT 2 - Context Enrichment Agent
    async def enrich(self, state: ClinicalReasoningState) -> ClinicalReasoningState:
        """Enrich context with RAG insights"""
        
        logger.info("💎 Context Enrichment Agent: Enriching context")
        
        try:
            optimized_context = build_staging_context(state)
            
            prompt = f"""
You are a clinical data integration expert. Your task is to identify key insights 
from retrieved patient data that should inform clinical reasoning.

RETRIEVED DATA:
{optimized_context}

CURRENT CONSULTATION:
{state.get("consultation_text", "")}

YOUR TASK:
Extract and highlight:
1. Critical historical findings relevant to current presentation
2. Disease progression patterns from temporal data
3. Treatment response patterns
4. Risk factors identified in historical data
5. Any red flags or concerning trends

OUTPUT FORMAT (JSON):
{{
  "key_insights": [
    {{
      "insight": "string",
      "clinical_significance": "critical|important|relevant",
      "source": "string",
      "recommendation": "how this should inform reasoning"
    }}
  ],
  "historical_context_summary": "concise summary of relevant history",
  "progression_indicators": {{
    "improving": ["factors suggesting improvement"],
    "worsening": ["factors suggesting deterioration"],
    "stable": ["factors suggesting stability"]
  }},
  "risk_signals": ["any concerning patterns or trends"],
  "treatment_insights": ["relevant treatment history"]
}}
"""
            
            response = self.llm.invoke([
                SystemMessage(content="You are a clinical data integration expert."),
                HumanMessage(content=prompt)
            ])
            
            result = self._parse_response(response.content)
            
            # Add enriched context to state
            state["enriched_context"] = result
            
            # Add key insights to warnings if critical
            for insight in result.get("key_insights", []):
                if insight.get("clinical_significance") == "critical":
                    state["warnings"].append(f"⚠️ CRITICAL INSIGHT: {insight.get('insight')}")
            
            logger.info("✅ Context Enrichment complete")
            
        except Exception as e:
            logger.error(f"❌ Context Enrichment failed: {str(e)}")
        
        return state
    
    def _parse_response(self, content: str) -> dict:
        try:
            content = content.strip()

            # Case 1: Extract JSON inside ```json blocks
            if "```json" in content:
                json_part = content.split("```json", 1)[1]
                json_part = json_part.split("```", 1)[0]
                return json.loads(json_part.strip())

            # Case 2: Extract any {...} JSON (fallback)
            start = content.find("{")
            end = content.rfind("}")
            if start != -1 and end != -1:
                return json.loads(content[start:end + 1])

            raise ValueError("No JSON found")

        except Exception as e:
            logger.warning(f"⚠️ Risk Stratification JSON parse failed: {e}")
            return {
                "raw_content": content,
                "confidence_score": 0.5
            }


# =====================================================================
# ENHANCED WORKFLOW WITH RAG
# =====================================================================


# STEP 5: LangGraph Workflow Initialization


# =====================================================================
# ENHANCED WORKFLOW WITH RAG - CORRECTED EDGES
# =====================================================================

# def create_enhanced_clinical_reasoning_workflow(llm: ChatGroq) -> StateGraph:
#     """
#     Create enhanced LangGraph workflow with RAG integration
#     """
    
#     # Initialize agents
#     rag_retrieval_agent = retrieve_rag_context
#     context_enrichment_agent = ContextEnrichmentAgent(llm)
#    # disease_agent = EnhancedDiseaseCausationAgent(llm)
#     staging_agent = StagingAgent(llm)
#     prognosis_agent = PrognosisAgent(llm)
#     risk_agent = RiskStratificationAgent(llm)
#     treatment_agent = TreatmentValidationAgent(llm)
#    # contraindication_agent = ContraindicationAgent(llm)
#    # outcome_agent = OutcomeReasoningAgent(llm)

#     # ✅ NEW AGENTS FOR THE 7 CRITICAL AREAS:
#     differential_diagnosis_agent = DifferentialDiagnosisAgent(llm)
#    # medication_reconciliation_agent = MedicationReconciliationAgent(llm)
#     guideline_compliance_agent = GuidelineComplianceAgent(llm)
#     clinical_deterioration_warning_agent = ClinicalDeteriorationWarningAgent(llm)
#    # diagnostic_test_appropriateness_agent = DiagnosticTestAppropriatenessAgent(llm)
#    # comorbidity_interaction_agent = ComorbidityInteractionAgent(llm)
#     discharge_readiness_agent = DischargeReadinessAgent(llm)
    
#     # Create workflow
#     workflow = StateGraph(ClinicalReasoningState)
    
#     # Add nodes with RAG integration
#     workflow.add_node("rag_retrieval", rag_retrieval_agent)
#     workflow.add_node("context_enrichment", context_enrichment_agent.enrich)
#    # workflow.add_node("disease_causation_agent", disease_agent.analyze)
#     workflow.add_node("staging_agent", staging_agent.analyze)
#     workflow.add_node("prognosis_agent", prognosis_agent.analyze)
#     workflow.add_node("risk_stratification_agent", risk_agent.analyze)
#     workflow.add_node("treatment_validation_agent", treatment_agent.analyze)
#    # workflow.add_node("contraindication_agent", contraindication_agent.analyze)
#   #  workflow.add_node("outcome_reasoning_agent", outcome_agent.analyze)

#     # ✅ NEW NODES FOR THE 7 CRITICAL AGENTS:
#     workflow.add_node("differential_diagnosis_agent", differential_diagnosis_agent.analyze)
#   #  workflow.add_node("medication_reconciliation_agent", medication_reconciliation_agent.analyze)
#     workflow.add_node("guideline_compliance_agent", guideline_compliance_agent.analyze)
#     workflow.add_node("clinical_deterioration_warning_agent", clinical_deterioration_warning_agent.analyze)
#    # workflow.add_node("diagnostic_test_appropriateness_agent", diagnostic_test_appropriateness_agent.analyze)  # ✅ CORRECTED NAME
#    # workflow.add_node("comorbidity_interaction_agent", comorbidity_interaction_agent.analyze)
#     workflow.add_node("discharge_readiness_agent", discharge_readiness_agent.analyze)

#     # Set entry point
#     workflow.set_entry_point("rag_retrieval")

#     # ✅ CORRECTED EDGES - Node names must match exactly
#     workflow.add_edge("rag_retrieval", "differential_diagnosis_agent")
#     workflow.add_edge("differential_diagnosis_agent", "context_enrichment")
#    # workflow.add_edge("context_enrichment", "disease_causation_agent")
#    # workflow.add_edge("disease_causation_agent", "comorbidity_interaction_agent")  # ✅ CORRECTED
#    # workflow.add_edge("comorbidity_interaction_agent", "diagnostic_test_appropriateness_agent")  # ✅ CORRECTED
#    # workflow.add_edge("diagnostic_test_appropriateness_agent", "staging_agent")  # ✅ CORRECTED
#     workflow.add_edge("staging_agent", "prognosis_agent")
#     workflow.add_edge("prognosis_agent", "risk_stratification_agent")
#     workflow.add_edge("risk_stratification_agent", "clinical_deterioration_warning_agent")  # ✅ CORRECTED
#     workflow.add_edge("clinical_deterioration_warning_agent", "medication_reconciliation_agent")  # ✅ CORRECTED
#    # workflow.add_edge("medication_reconciliation_agent", "treatment_validation_agent")
#     workflow.add_edge("treatment_validation_agent", "guideline_compliance_agent")
#    # workflow.add_edge("guideline_compliance_agent", "contraindication_agent")
#    # workflow.add_edge("contraindication_agent", "outcome_reasoning_agent")
#    # workflow.add_edge("outcome_reasoning_agent", "discharge_readiness_agent")
#     workflow.add_edge("discharge_readiness_agent", END)
    
#     return workflow.compile()

def create_enhanced_clinical_reasoning_workflow(llm: ChatGroq) -> StateGraph:
    """
    Create enhanced LangGraph workflow with RAG integration
    """
    # Initialize agents
    rag_retrieval_agent = retrieve_rag_context
    context_enrichment_agent = ContextEnrichmentAgent(llm)
    patient_summary_agent = PatientSummaryAgent(llm)
    staging_agent = StagingAgent(llm)
    prognosis_agent = PrognosisAgent(llm)
    risk_agent = RiskStratificationAgent(llm)
    treatment_agent = TreatmentValidationAgent(llm)
    treatment_intelligence_agent = AdvancedTreatmentIntelligenceAgent(llm)  # ✅
    
    differential_diagnosis_agent = DifferentialDiagnosisAgent(llm)
    guideline_compliance_agent = GuidelineComplianceAgent(llm)
    clinical_deterioration_warning_agent = ClinicalDeteriorationWarningAgent(llm)
    discharge_readiness_agent = DischargeReadinessAgent(llm)
    
    longitudinal_story_agent = LongitudinalStoryAgent(llm)
    
    # Create workflow
    workflow = StateGraph(ClinicalReasoningState)
    
    # ── ADD ALL NODES FIRST ──────────────────────────────────────────
    workflow.add_node("rag_retrieval", rag_retrieval_agent)
    workflow.add_node("context_enrichment", context_enrichment_agent.enrich)
    workflow.add_node("patient_summary_agent",patient_summary_agent.analyze)
    workflow.add_node("staging_agent", staging_agent.analyze)
    workflow.add_node("prognosis_agent", prognosis_agent.analyze)
    workflow.add_node("risk_stratification_agent", risk_agent.analyze)
    workflow.add_node("treatment_validation_agent", treatment_agent.analyze)
    workflow.add_node("treatment_intelligence_agent", treatment_intelligence_agent.analyze)  # ✅ ADD NODE
    workflow.add_node("differential_diagnosis_agent", differential_diagnosis_agent.analyze)
    workflow.add_node("guideline_compliance_agent", guideline_compliance_agent.analyze)
    workflow.add_node("clinical_deterioration_warning_agent", clinical_deterioration_warning_agent.analyze)
    workflow.add_node("discharge_readiness_agent", discharge_readiness_agent.analyze)

    # ── STORY NODE ───────────────────────────────────────────────────
    async def generate_story_node(state: ClinicalReasoningState) -> ClinicalReasoningState:
        logger.info(f"📖 Generating longitudinal story for patient {state['patient_id']}")
        try:
            story_result = await longitudinal_story_agent.generate_story(
                state["patient_id"],
                state
            )
            logger.info(f"✅ Story generated: {len(story_result.get('complete_story', ''))} chars")
            state["longitudinal_story"] = story_result
            if "enriched_context" not in state:
                state["enriched_context"] = {}
            state["enriched_context"]["longitudinal_story"] = story_result.get("complete_story", "")
            if story_result.get("error"):
                state["warnings"].append(f"Story generation warning: {story_result['error']}")
            return state
        except Exception as e:
            logger.error(f"❌ Story generation failed: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            state["longitudinal_story"] = {
                "error": str(e),
                "complete_story": "Story generation failed"
            }
            state["warnings"].append(f"Story generation error: {str(e)}")
            return state

    workflow.add_node("story_generation", generate_story_node)

    # ── SET ENTRY POINT ──────────────────────────────────────────────
    workflow.set_entry_point("rag_retrieval")

    # ── ADD ALL EDGES AFTER ALL NODES ARE REGISTERED ────────────────
    workflow.add_edge("rag_retrieval", "story_generation")
    workflow.add_edge("story_generation", "differential_diagnosis_agent")
    workflow.add_edge("differential_diagnosis_agent", "context_enrichment")
    workflow.add_edge("context_enrichment", "patient_summary_agent")
    workflow.add_edge("patient_summary_agent","staging_agent")
    workflow.add_edge("staging_agent", "prognosis_agent")
    workflow.add_edge("prognosis_agent", "risk_stratification_agent")
    workflow.add_edge("risk_stratification_agent", "clinical_deterioration_warning_agent")
    workflow.add_edge("clinical_deterioration_warning_agent", "treatment_validation_agent")
    workflow.add_edge("treatment_validation_agent", "guideline_compliance_agent")
    workflow.add_edge("guideline_compliance_agent", "treatment_intelligence_agent")  # ✅
    workflow.add_edge("treatment_intelligence_agent", "discharge_readiness_agent")   # ✅
    workflow.add_edge("discharge_readiness_agent", END)
    
    return workflow.compile()
# =====================================================================
# ENHANCED MAIN EXECUTION FUNCTION
# =====================================================================
from neo4j.time import DateTime as Neo4jDateTime
from neo4j.time import Date as Neo4jDate
from neo4j.time import Duration as Neo4jDuration

def sanitize_for_response(obj):
    if isinstance(obj, (Neo4jDateTime, Neo4jDate)):
        return obj.isoformat()
    if isinstance(obj, Neo4jDuration):
        return str(obj)
    if isinstance(obj, dict):
        return {k: sanitize_for_response(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_for_response(v) for v in obj]
    return obj



async def run_enhanced_clinical_reasoning(
    patient_id: str,
    doctor_id: str,
    consultation_text: str,
    medical_context: Dict[str, Any],
    clinical_context: Dict[str, Any],
    longitudinal_context: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Execute complete clinical reasoning workflow with RAG enhancement
    """
    logger.info("🚀 Starting Enhanced Clinical Reasoning Workflow with RAG")
    
    # Create workflow
    workflow = create_enhanced_clinical_reasoning_workflow(llm)
    
    # Initialize state
    initial_state: ClinicalReasoningState = {
        "patient_id": patient_id,
        "doctor_id": doctor_id,
        "consultation_text": consultation_text,
        "medical_context": medical_context,
        "clinical_context": clinical_context,
        "longitudinal_context": longitudinal_context,
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
        
        # ✅ DEBUG: Check if story is in final state
        logger.critical(f"🔍 FINAL STATE KEYS: {list(final_state.keys())}")
        logger.critical(f"🔍 longitudinal_story TYPE: {type(final_state.get('longitudinal_story'))}")
        logger.critical(f"🔍 longitudinal_story VALUE: {final_state.get('longitudinal_story')}")
        
        if final_state.get("longitudinal_story"):
            logger.info("✅ longitudinal_story present in final_state")
        else:
            logger.error("❌ longitudinal_story is NULL in final_state")
        
        logger.info("✅ Enhanced Clinical Reasoning Workflow Complete")
        
        response_payload = {
            "status": "success",
            "disease_causation": final_state.get("disease_causation"),
            "staging": final_state.get("staging_analysis"),
            "prognosis": final_state.get("prognosis_factors"),
            "risk_stratification": final_state.get("risk_stratification"),
            "treatment_validation": final_state.get("treatment_validation"),
            "contraindications": final_state.get("contraindication_check"),
            "final_recommendation": final_state.get("final_recommendation"),
            "enriched_context": final_state.get("enriched_context"),
            
            # ✅ NEW: 7 CRITICAL AGENT RESULTS
            "differential_diagnosis": final_state.get("differential_diagnosis"),
            "medication_reconciliation": final_state.get("medication_reconciliation"),
            "guideline_compliance": final_state.get("guideline_compliance"),
            "clinical_deterioration_warning": final_state.get("clinical_deterioration_warning"),
            "diagnostic_test_appropriateness": final_state.get("diagnostic_test_appropriateness"),
            "comorbidity_interaction": final_state.get("comorbidity_interaction"),
            "discharge_readiness": final_state.get("discharge_readiness"),
            
            "longitudinal_story": final_state.get("longitudinal_story"), 
            
            
            "patient_summary":final_state.get("patient_summary"),# ✅ This should now work

            "advanced_treatment_intelligence": final_state.get("advanced_treatment_intelligence"),
            "confidence_scores": final_state.get("confidence_scores"),
            "warnings": final_state.get("warnings"),
            "requires_review": final_state.get("requires_review"),
            "timestamp": datetime.utcnow().isoformat(),
        }
        
        # ✅ DEBUG: Check response payload
        logger.critical(f"🔍 response_payload longitudinal_story: {response_payload.get('longitudinal_story')}")

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
        # Close RAG system connections
        await graph_rag_system.close()
    


# Version 2 New Modification Helper functions
# 4-02-2026 Abi
# Start point
#_________________________________________

# =====================================================================
# AGENT-SPECIFIC CONTEXT BUILDERS
# =====================================================================

def build_differential_diagnosis_context(state: ClinicalReasoningState) -> str:
    """
    Build optimized context for Differential Diagnosis Agent
    Needs: symptoms, vitals, recent labs, recent imaging
    NOW ALSO INCLUDES GRAPH DOCUMENT DATA
    """
    try:
        structured = state.get("rag_context", {})

        critical = structured.get("vector_results", "")
        domain_idx = structured.get("domain_indices", {})

        # ---------------- VECTOR CONTEXT ----------------
        full_ctx = structured.get("full_context", {})
        vector_results = full_ctx.get("vector_results", [])

        relevant_labs = [
            d for d in vector_results
            if d.get("metadata", {}).get("subtype") in ["hematology", "biochemistry"]
        ][:3]

        relevant_imaging = [
            d for d in vector_results
            if d.get("metadata", {}).get("type") == "imaging"
        ][:2]

        relevant_clinical = [
            d for d in vector_results
            if d.get("metadata", {}).get("type") == "clinical"
        ][:3]

        # ---------------- GRAPH DOCUMENTS ----------------
        graph_results = structured.get("graph_results", {})
        graph_documents = graph_results.get("documents", [])
        logger.info(f"graph_documents{graph_documents}")
        graph_docs_formatted = []

        for doc in graph_documents[:5]:
            try:
                structured_data = doc.get("structured_data")

                # parse JSON stored in Neo4j
                if isinstance(structured_data, str):
                    structured_data = json.loads(structured_data)

                abnormal_items = []

                if isinstance(structured_data, dict):
                    for k, v in structured_data.items():
                        if isinstance(v, dict) and v.get("status") == "abnormal":
                            abnormal_items.append(f"{k}: {v.get('value')}")

                abnormal_summary = ", ".join(abnormal_items[:5]) if abnormal_items else "No major abnormalities"

                graph_docs_formatted.append(
                    f"""
Document: {doc.get('document_id')}
Category: {doc.get('category')} / {doc.get('subcategory')}
Date: {doc.get('date')}
Abstract: {doc.get('clinical_abstract')}
Key Findings: {abnormal_summary}
"""
                )

            except Exception as e:
                logger.warning(f"⚠️ Failed parsing graph document: {e}")

        graph_docs_text = "\n".join(graph_docs_formatted) if graph_docs_formatted else "None"

        # ---------------- FINAL CONTEXT ----------------
        context = f"""
CRITICAL FINDINGS (Top Priority):
{critical}

AVAILABLE DATA SUMMARY:
{_format_domain_index_for_prompt(domain_idx)}

RELEVANT RECENT LABS (Vector):
{_format_documents_compact(relevant_labs)}

RELEVANT IMAGING (Vector):
{_format_documents_compact(relevant_imaging)}

RECENT CLINICAL NOTES (Vector):
{_format_documents_compact(relevant_clinical)}

GRAPH DOCUMENT DATA (Structured Clinical Reports):
{graph_documents}

Note: Complete patient history available in full context if specific details needed.
"""

        return context

    except Exception as e:
        logger.error(f"Context building failed: {e}")
        return "Context building failed - using minimal data"


def build_medication_reconciliation_context(state: ClinicalReasoningState) -> str:
    """
    Build optimized context for Medication Reconciliation Agent
    Needs: ALL medications, allergies, renal/hepatic function
    Includes BOTH vector + graph documents
    """
    try:
        structured = state.get("rag_context_structured", {})
        critical = structured.get("critical_summary", "")

        # -----------------------------
        # Get ALL medication-related data (no truncation)
        # -----------------------------
        full_ctx = structured.get("full_context", {})
        vector_results = full_ctx.get("vector_results", [])

        # Graph results (NEW: include these)
        graph_results = structured.get("graph_results", {})
        graph_documents = graph_results.get("documents", [])

        # Combine ALL sources
        all_documents = []
        if isinstance(vector_results, list):
            all_documents.extend(vector_results)
        if isinstance(graph_documents, list):
            all_documents.extend(graph_documents)

        # -----------------------------
        # Extract medications from ALL docs
        # -----------------------------
        medications = [
            d for d in all_documents
            if "medication" in str(
                d.get("metadata", {}).get("subtype", "")
            ).lower()
        ]

        # -----------------------------
        # Extract renal/hepatic indicators
        # -----------------------------
        renal_keywords = ["creatinine", "egfr", "alt", "ast", "bilirubin"]

        renal_hepatic = [
            d for d in all_documents
            if any(
                kw in str(d.get("content", "")).lower()
                for kw in renal_keywords
            )
        ][:3]

        # -----------------------------
        # Optional logging (safe formatting)
        # -----------------------------
        logger.info("Total medication docs: %s", len(medications))
        logger.info("Graph docs included: %s", len(graph_documents))

        # -----------------------------
        # Build final context
        # -----------------------------
        context = f"""
CRITICAL CONTEXT:
{critical}

COMPLETE MEDICATION HISTORY (Vector + Graph Records):
{_format_documents_detailed(medications)}

RENAL/HEPATIC FUNCTION:
{_format_documents_compact(renal_hepatic)}

PATIENT MEDICATIONS FROM MEDICAL CONTEXT:
{safe_json(state.get("medical_context", {}).get("medications", []))}
"""
        return context

    except Exception as e:
        logger.error("Medication context building failed: %s", e)
        return "Medication context unavailable"






def build_guideline_compliance_context(state: ClinicalReasoningState) -> str:
    """
    Build context for Guideline Compliance Agent
    Needs: diagnosis, staging, treatment plan
    """
    try:
        structured = state.get("rag_context", {})
        
        critical = structured.get("vector_results", "")
        domain_idx = structured.get("domain_indices", {})
        
        context = f"""
CRITICAL CONTEXT:
{critical}

AVAILABLE DATA:
{_format_domain_index_for_prompt(domain_idx)}

DIAGNOSIS:
{safe_json(state.get("disease_causation", {}))}

STAGING:
{safe_json(state.get("staging_analysis", {}))}

TREATMENT PLAN:
{safe_json(state.get("treatment_validation", {}))}

CLINICAL CONTEXT:
Active Diagnoses: {', '.join(state.get("clinical_context", {}).get("active_diagnoses", []))}
"""
        return context
        
    except Exception as e:
        logger.error(f"Guideline context building failed: {e}")
        return "Guideline context unavailable"


def build_discharge_readiness_context(state: ClinicalReasoningState) -> str:
    """
    Build context for Discharge Readiness Agent
    Needs: comprehensive view of current status and plan
    """
    try:
        structured = state.get("rag_context", {})
        
        critical = structured.get("vector_results", "")
        domain_idx = structured.get("domain_indices", {})
        
        context = f"""
CRITICAL STATUS:
{critical}

PATIENT DATA SUMMARY:
{_format_domain_index_for_prompt(domain_idx)}

CLINICAL STATUS:
{safe_json(state.get("clinical_context", {}))}

TREATMENT PLAN:
{safe_json(state.get("final_recommendation", {}))}

RISK ASSESSMENT:
{safe_json(state.get("risk_stratification", {}))}

DETERIORATION RISK:
{safe_json(state.get("clinical_deterioration_warning", {}))}
"""
        return context
        
    except Exception as e:
        logger.error(f"Discharge context building failed: {e}")
        return "Discharge context unavailable"


def build_risk_stratification_context(state: ClinicalReasoningState) -> str:
    """
    Build optimized context for Risk Stratification Agent
    Needs: vitals, disease severity, comorbidities, recent trends
    """
    try:
        structured = state.get("rag_context", {})
        
        critical = structured.get("vector_results", "")
        domain_idx = structured.get("domain_indices", {})
        
        # Get temporal data for trends
        full_ctx = structured.get("full_context", {})
        temporal = structured.get("graph_results", {})
        
        context = f"""
CRITICAL FINDINGS:
{critical}

DATA AVAILABILITY:
{_format_domain_index_for_prompt(domain_idx)}

DISEASE ANALYSIS:
{safe_json(state.get("disease_causation", {}))}

STAGING:
{safe_json(state.get("staging_analysis", {}))}

TEMPORAL TRENDS:
{safe_json(temporal)}

VITAL SIGNS:
{safe_json(state.get("medical_context", {}).get("vital_signs", {}))}
"""
        return context
        
    except Exception as e:
        logger.error(f"Risk context building failed: {e}")
        return "Risk context unavailable"

def build_deterioration_warning_context(state: ClinicalReasoningState) -> str:
    """
    Build context for Clinical Deterioration Warning Agent
    Needs: vitals, lab trends, recent changes
    """
    try:
        structured = state.get("rag_context_structured", {})
        critical = structured.get("critical_summary", "")
        
        # Get temporal trends
        full_ctx = structured.get("full_context", {})
        temporal = full_ctx.get("temporal_results", {})
        
        # Get recent labs
        vector_results = full_ctx.get("vector_results", [])
        recent_labs = [d for d in vector_results 
                      if d.get("metadata", {}).get("type") == "medical" and
                         d.get("metadata", {}).get("subtype") in ["hematology", "biochemistry"]][:10]
        
        context = f"""
CRITICAL FINDINGS:
{critical}

VITAL SIGNS (Current):
{safe_json(state.get("medical_context", {}).get("vital_signs", {}))}

LAB TRENDS (Recent 10):
{_format_documents_detailed(recent_labs)}

TEMPORAL ANALYSIS:
{safe_json(temporal)}

RISK ASSESSMENT:
{safe_json(state.get("risk_stratification", {}))}
"""
        return context
        
    except Exception as e:
        logger.error(f"Deterioration context building failed: {e}")
        return "Deterioration context unavailable"

def build_deterioration_warning_context(state: ClinicalReasoningState) -> str:
    """
    Build context for Clinical Deterioration Warning Agent
    Needs: vitals, lab trends, recent changes
    """
    try:
        structured = state.get("rag_context", {})
        
        critical = structured.get("vector_results", "")
        
        # Get temporal trends
        full_ctx = structured.get("full_context", {})
        temporal = structured.get("graph_results", {})
        
        # Get recent labs
        vector_results = full_ctx.get("vector_results", [])
        recent_labs = [d for d in vector_results 
                      if d.get("metadata", {}).get("type") == "medical" and
                         d.get("metadata", {}).get("subtype") in ["hematology", "biochemistry"]][:10]
        
        context = f"""
CRITICAL FINDINGS:
{critical}

VITAL SIGNS (Current):
{safe_json(state.get("medical_context", {}).get("vital_signs", {}))}

LAB TRENDS (Recent 10):
{_format_documents_detailed(recent_labs)}

TEMPORAL ANALYSIS:
{safe_json(temporal)}

RISK ASSESSMENT:
{safe_json(state.get("risk_stratification", {}))}
"""
        return context
        
    except Exception as e:
        logger.error(f"Deterioration context building failed: {e}")
        return "Deterioration context unavailable"




# =====================================================================
# CLINICAL INTELLIGENCE HELPERS
# =====================================================================

def _extract_patient_clinical_profile(
    medical: dict,
    state: ClinicalReasoningState
) -> str:
    """
    Build comprehensive patient clinical profile considering:
    - Age-specific risk factors and treatment tolerability
    - Sex-specific conditions, dosing, and contraindications
    - Organ function (renal, hepatic, cardiac)
    - Performance status and functional reserve
    - Comorbidity burden
    - Frailty indicators
    - Reproductive status
    - Genetic/hereditary factors if available
    """
    demographics   = medical.get("demographics", {}) or {}
    age            = demographics.get("age")
    sex            = demographics.get("sex", "").lower()
    disease_id     = state.get("disease_identity") or medical.get("disease_identity", {})
    functional     = state.get("functional_status") or medical.get("functional_status", {})
    risk_topology  = state.get("risk_topology")     or medical.get("risk_topology", {})
    treatment_mem  = state.get("treatment_memory")  or medical.get("treatment_memory", {})

    lines = []

    # ── Age analysis ──────────────────────────────────────────────
    lines.append("AGE-SPECIFIC CLINICAL CONSIDERATIONS:")
    if age is None:
        lines.append("  ⚠ Age unknown — age-specific dosing and risk adjustments cannot be applied")
    else:
        age = int(age)
        lines.append(f"  Patient age: {age} years")

        if age < 18:
            lines.append("  ► PEDIATRIC PATIENT — mandatory considerations:")
            lines.append("    - Weight-based dosing required for ALL medications")
            lines.append("    - Avoid adult-only drugs (fluoroquinolones, tetracyclines, NSAIDs)")
            lines.append("    - Growth and developmental impact must be assessed for long-term therapy")
            lines.append("    - Immunization status check required before immunosuppressive therapy")
            lines.append("    - Parental/guardian consent and assent documentation required")
            lines.append("    - Pediatric oncology/subspecialty involvement mandatory for cancer")

        elif 18 <= age <= 39:
            lines.append("  ► YOUNG ADULT (18–39) — mandatory considerations:")
            lines.append("    - Fertility preservation counseling BEFORE gonadotoxic therapy")
            lines.append("    - Teratogenicity counseling and contraception for reproductive-age women")
            lines.append("    - Long-term treatment sequelae carry greater lifetime burden")
            lines.append("    - Psychosocial impact of chronic illness on career and relationships")
            lines.append("    - Genetic/hereditary cancer syndrome screening if early-onset malignancy")
            lines.append("    - Prefer treatment strategies preserving long-term organ function")

        elif 40 <= age <= 64:
            lines.append("  ► MIDDLE-AGED ADULT (40–64) — mandatory considerations:")
            lines.append("    - Cardiovascular risk assessment before cardiotoxic agents")
            lines.append("    - Metabolic syndrome screening (DM, HTN, dyslipidemia)")
            lines.append("    - Perimenopausal status relevant for hormone-sensitive conditions")
            lines.append("    - Occupational and functional impact of treatment side effects")
            lines.append("    - Bone density baseline before prolonged corticosteroids or AIs")
            lines.append("    - Hepatic function assessment for standard drug metabolism")

        elif 65 <= age <= 74:
            lines.append("  ► OLDER ADULT (65–74) — mandatory considerations:")
            lines.append("    - Geriatric assessment recommended (G8 or VES-13 screening)")
            lines.append("    - Renal function likely declining — eGFR-based dose adjustment required")
            lines.append("    - Polypharmacy review — Beers Criteria and STOPP/START mandatory")
            lines.append("    - Falls risk assessment before sedating or hypotensive agents")
            lines.append("    - Cognitive baseline before CNS-affecting drugs")
            lines.append("    - Nutrition and sarcopenia screening before major treatment")
            lines.append("    - Increased sensitivity to nephrotoxic and hepatotoxic agents")
            lines.append("    - Immunosenescence — modified vaccine schedules, infection risk higher")

        elif age >= 75:
            lines.append("  ► ELDERLY / VERY ELDERLY (75+) — HIGH PRIORITY MANDATORY CONSIDERATIONS:")
            lines.append("    - Comprehensive Geriatric Assessment (CGA) STRONGLY RECOMMENDED")
            lines.append("    - Frailty scoring (Clinical Frailty Scale or FRAIL) before any major treatment")
            lines.append("    - Significantly reduced drug clearance — start low, go slow principle")
            lines.append("    - Avoid ALL Beers Criteria medications unless no safe alternative")
            lines.append("    - High falls risk — avoid benzodiazepines, strong opioids, anticholinergics")
            lines.append("    - Delirium risk elevated — minimize sedating agents, ensure hydration")
            lines.append("    - Treatment goals must align with prognosis and patient preference")
            lines.append("    - Palliative care consultation if life expectancy <12 months")
            lines.append("    - Caregiver burden and social support assessment essential")
            lines.append("    - Reduced tolerance for cytotoxic chemotherapy — consider dose reduction")
            lines.append("    - Cardiac reserve reduced — lower threshold for cardiac monitoring")

    # ── Sex-specific analysis ─────────────────────────────────────
    lines.append("\nSEX-SPECIFIC CLINICAL CONSIDERATIONS:")
    if not sex or sex in ["unknown", "not specified", ""]:
        lines.append("  ⚠ Sex unknown — sex-specific recommendations cannot be fully applied")
    elif sex in ["female", "f", "woman", "women"]:
        lines.append("  ► FEMALE PATIENT — mandatory considerations:")

        if age and age < 55:
            lines.append("  REPRODUCTIVE / PREMENOPAUSAL:")
            lines.append("    - Pregnancy status MUST be confirmed before cytotoxic, teratogenic,")
            lines.append("      or radiation therapy (urine/serum β-hCG)")
            lines.append("    - Fertility preservation counseling BEFORE gonadotoxic chemotherapy")
            lines.append("      (alkylating agents, platinum compounds) — refer reproductive oncology")
            lines.append("    - Contraception counseling — avoid pregnancy during and 6–12 months post-treatment")
            lines.append("    - Menstrual cycle effects of chemotherapy, hormonal agents to be discussed")
            lines.append("    - Premature ovarian insufficiency risk with alkylating agents")

        if age and 40 <= age <= 60:
            lines.append("  PERIMENOPAUSAL:")
            lines.append("    - Menopausal status affects hormone-sensitive cancer treatment")
            lines.append("    - Ovarian function testing if relevant (FSH, estradiol, AMH)")
            lines.append("    - Chemotherapy-induced menopause possible — counsel accordingly")
            lines.append("    - Vasomotor symptoms may intensify with hormonal therapies")

        if age and age > 50:
            lines.append("  POSTMENOPAUSAL:")
            lines.append("    - Aromatase inhibitor eligibility if hormone receptor-positive cancer")
            lines.append("    - Bone density monitoring mandatory with AI therapy (DEXA at baseline)")
            lines.append("    - Cardiovascular risk higher post-menopause — lipid and BP monitoring")
            lines.append("    - Vaginal atrophy with hormonal therapies — local estrogen options")

        lines.append("  FEMALE GENERAL:")
        lines.append("    - Breast cancer screening status relevant for all female patients")
        lines.append("    - Cervical and ovarian pathology must be considered in abdominal symptoms")
        lines.append("    - Iron-deficiency anemia more common — check ferritin before attributing")
        lines.append("    - Autoimmune conditions more prevalent — consider in differential")
        lines.append("    - Drug pharmacokinetics differ: generally lower Vd, higher fat:lean ratio")
        lines.append("    - QT prolongation risk higher with certain drugs (azithromycin, antipsychotics)")
        lines.append("    - Thyroid dysfunction more common — check TSH if fatigue/weight change")

    elif sex in ["male", "m", "man", "men"]:
        lines.append("  ► MALE PATIENT — mandatory considerations:")

        if age and age >= 50:
            lines.append("  AGE ≥50 MALE:")
            lines.append("    - Prostate health relevant — PSA if urinary symptoms or hormone therapy")
            lines.append("    - Testosterone levels relevant if fatigue, weight gain, ADT considered")
            lines.append("    - Cardiovascular risk higher vs age-matched females after menopause")
            lines.append("    - Colorectal cancer screening status relevant")

        if age and age >= 40:
            lines.append("    - Erectile dysfunction may be treatment side effect — discuss proactively")
            lines.append("    - Testicular function relevant if gonadotoxic therapy planned")
            lines.append("    - Fertility preservation counseling before gonadotoxic chemotherapy")
            lines.append("    - Sperm banking should be offered before alkylating agents or radiation")

        lines.append("  MALE GENERAL:")
        lines.append("    - Higher muscle mass → higher Vd for water-soluble drugs → weight-based dosing")
        lines.append("    - Gout more prevalent — consider with diuretics or cyclosporine")
        lines.append("    - Higher alcohol consumption rates — hepatic function assessment important")
        lines.append("    - Occupational exposures more common in certain demographics — relevant history")
        lines.append("    - Delayed healthcare-seeking behavior — assess for underreported symptoms")

    # ── Organ function constraints ─────────────────────────────────
    lines.append("\nORGAN FUNCTION — TREATMENT CONSTRAINTS:")

    perf_status = functional.get("performance_status", {})
    ecog        = perf_status.get("score", "unknown")
    scale       = perf_status.get("scale", "")

    lines.append(f"  Performance Status: {scale} {ecog}")
    if ecog != "unknown":
        try:
            ecog_int = int(str(ecog).split()[0])
            if ecog_int == 0:
                lines.append("    → Full activity — no treatment restrictions from PS")
            elif ecog_int == 1:
                lines.append("    → Restricted strenuous activity — standard treatment generally tolerated")
            elif ecog_int == 2:
                lines.append("    → ≥50% ambulatory — reduced-intensity regimens preferred")
                lines.append("    → Avoid highly emetogenic or neurotoxic regimens without strong indication")
            elif ecog_int == 3:
                lines.append("    → Limited self-care — aggressive cytotoxic therapy HIGH RISK")
                lines.append("    → Supportive/palliative approach should be considered")
                lines.append("    → Single-agent or oral regimens preferred over combination IV chemotherapy")
            elif ecog_int >= 4:
                lines.append("    → Completely disabled — cytotoxic chemotherapy CONTRAINDICATED")
                lines.append("    → Palliative/supportive care is the appropriate treatment intent")
        except (ValueError, TypeError):
            lines.append(f"    → ECOG score '{ecog}' — manual review required for treatment intensity decision")

    mobility = functional.get("mobility", "unknown")
    adl      = functional.get("adl", "unknown")
    lines.append(f"  Mobility: {mobility} | ADL: {adl}")
    if mobility in ["wheelchair", "bedridden"]:
        lines.append("    → VTE prophylaxis consideration — immobility increases DVT/PE risk")
        lines.append("    → Pressure injury prevention protocols")
    if adl in ["partial_assistance", "full_assistance"]:
        lines.append("    → Oral medication compliance may require caregiver support")
        lines.append("    → Outpatient chemotherapy feasibility must be assessed with caregiver")

    # ── Active risk topology constraints ──────────────────────────
    active_risks = risk_topology.get("active_risks", [])
    if active_risks:
        lines.append("\nACTIVE RISK CONSTRAINTS ON TREATMENT SELECTION:")
        for risk in active_risks:
            category = risk.get("category", "")
            name     = risk.get("name", "")
            severity = risk.get("severity", "")
            basis    = risk.get("basis", "")

            if category == "cardiovascular" or severity in ["high", "critical"]:
                lines.append(f"  ⚠ {name} ({severity}) — {basis}")
                if "cardiotoxic" in name.lower() or category == "cardiovascular":
                    lines.append("    → Avoid anthracyclines or use liposomal formulation")
                    lines.append("    → Baseline ECHO/MUGA required before cardiotoxic agents")
                    lines.append("    → Cardio-oncology consultation recommended")

            if category == "metabolic":
                lines.append(f"  ⚠ {name} ({severity}) — {basis}")
                lines.append("    → Corticosteroid use may worsen metabolic control — monitor closely")
                lines.append("    → Tight glycemic management during chemotherapy required")

            if category == "treatment_toxicity":
                lines.append(f"  ⚠ {name} ({severity}) — {basis}")
                lines.append("    → Prior toxicity must inform new treatment selection")
                lines.append("    → Avoid same drug class if prior grade 3–4 toxicity documented")

    # ── Treatment history toxicity warnings ───────────────────────
    completed_tx = treatment_mem.get("completed_treatments", [])
    prior_toxicities = []
    for t in completed_tx:
        notes = t.get("notes", "").lower()
        name  = t.get("name", "")
        if any(term in notes for term in [
            "toxicity", "adverse", "intolerant", "discontinued due",
            "neuropathy", "nephrotoxic", "cardiotoxic", "hepatotoxic"
        ]):
            prior_toxicities.append(f"  ⚠ Prior toxicity with {name}: {t.get('notes', '')}")

    if prior_toxicities:
        lines.append("\nPRIOR TREATMENT TOXICITY FLAGS:")
        lines.extend(prior_toxicities)
        lines.append(
            "    → Do NOT re-challenge with same agent class without documented re-challenge justification"
        )

    return "\n".join(lines)


def _extract_comorbidity_constraints(
    medical: dict,
    state: ClinicalReasoningState
) -> str:
    """
    Extract comorbidity-based treatment constraints.
    Maps each comorbidity to specific treatment implications.
    """
    disease_id    = state.get("disease_identity") or medical.get("disease_identity", {})
    treatment_mem = state.get("treatment_memory") or medical.get("treatment_memory", {})
    risk_topology = state.get("risk_topology")    or medical.get("risk_topology",    {})

    ongoing = disease_id.get("active_ongoing_conditions", [])
    lines   = []

    # Known comorbidity → treatment implication map
    COMORBIDITY_RULES = {
        # Renal
        "ckd":              ["Dose-adjust ALL renally cleared drugs by eGFR",
                             "Avoid NSAIDs, nephrotoxic contrast, aminoglycosides",
                             "Metformin: hold if eGFR <30",
                             "LMWH: monitor anti-Xa levels or use UFH"],
        "renal failure":    ["Dose-adjust ALL renally cleared drugs by eGFR",
                             "Dialysis patients: post-dialysis dosing for dialyzable drugs",
                             "Avoid direct oral anticoagulants if eGFR <15"],
        "nephrotic":        ["Hypoalbuminemia alters drug protein binding — adjust doses",
                             "Increased infection risk — prophylactic antibiotics per protocol"],

        # Hepatic
        "cirrhosis":        ["Child-Pugh/MELD score required before hepatically metabolized drugs",
                             "Avoid hepatotoxic agents (MTX, high-dose paracetamol)",
                             "Coagulopathy — INR elevation not solely from vitamin K deficiency",
                             "Dose-reduce drugs with high first-pass hepatic metabolism"],
        "hepatitis b":      ["Reactivation risk with immunosuppression — antiviral prophylaxis",
                             "Lamivudine/entecavir prophylaxis before rituximab or steroids",
                             "Monitor LFTs every cycle if on cytotoxic therapy"],
        "hepatitis c":      ["Drug-drug interactions with DAA therapy — check all new drugs",
                             "Monitor LFTs — hepatotoxic drug threshold lower"],

        # Cardiac
        "heart failure":    ["Avoid negative inotropes (verapamil, diltiazem in HFrEF)",
                             "Fluid overload risk with IV therapies — monitor input/output",
                             "Anthracycline use requires cardiology clearance + baseline EF",
                             "LVEF monitoring every 3 cycles with cardiotoxic agents",
                             "Salt restriction — Na-containing IV fluids cautiously"],
        "atrial fibrillation": ["Anticoagulation management critical during procedures",
                                "Rate control drugs interact with many oncology agents",
                                "QT-prolonging drugs: extra caution — check QTc before each cycle"],
        "coronary artery disease": ["Avoid 5-FU and capecitabine (coronary vasospasm risk)",
                                    "Antiplatelet therapy management around procedures",
                                    "Stress testing before high-intensity regimens"],
        "hypertension":     ["Anti-VEGF agents (bevacizumab, sunitinib) worsen HTN — monitor BP weekly",
                             "Steroids elevate BP — increase antihypertensive as needed",
                             "Target BP <140/90 during treatment; <130/80 if proteinuria"],

        # Metabolic
        "diabetes":         ["Corticosteroids cause hyperglycemia — sliding scale insulin protocol",
                             "Metformin: hold day of contrast procedures",
                             "Monitor blood glucose every cycle during chemo",
                             "HbA1c >8% — optimize glycemic control before elective treatment",
                             "Peripheral neuropathy baseline important before neurotoxic drugs"],
        "hypothyroidism":   ["Thyroid function may worsen with immunotherapy (anti-PD1/PDL1)",
                             "Baseline TSH before immunotherapy is mandatory",
                             "Monitor TSH every 6–8 weeks on immunotherapy"],
        "hyperthyroidism":  ["Radioiodine therapy contraindicated with certain contrast agents",
                             "Beta-blockers for symptom control interact with chemo agents"],

        # Pulmonary
        "copd":             ["Bleomycin contraindicated (pulmonary fibrosis risk)",
                             "High-dose oxygen therapy may precipitate hypercapnic crisis",
                             "Pulmonary function tests before bleomycin or thoracic radiation",
                             "Respiratory reserve limits tolerance of highly emetogenic regimens"],
        "asthma":           ["Avoid aspirin, NSAIDs if aspirin-sensitive asthma",
                             "Beta-blockers contraindicated in poorly controlled asthma",
                             "Monitor for bronchospasm with taxanes (premedication required)"],
        "pulmonary fibrosis": ["Bleomycin absolutely contraindicated",
                               "Methotrexate contraindicated",
                               "Immunotherapy (anti-PD1) risk of pneumonitis elevated — close monitoring"],

        # Neurological
        "epilepsy":         ["Enzyme-inducing AEDs (carbamazepine, phenytoin) reduce chemo levels",
                             "Avoid seizure-threshold-lowering drugs (busulfan, cisplatin high-dose)",
                             "Switch to non-enzyme-inducing AED if possible before chemotherapy"],
        "peripheral neuropathy": ["Avoid or reduce dose of neurotoxic agents: oxaliplatin, vincristine, bortezomib",
                                  "Baseline neuropathy grade documentation required",
                                  "Grade ≥2 pre-existing neuropathy — neurotoxic agents require MDT decision"],
        "depression":       ["Avoid high-dose corticosteroids if possible (mood destabilization)",
                             "SSRIs interact with tamoxifen (CYP2D6) — avoid paroxetine, fluoxetine",
                             "Psycho-oncology referral for cancer patients with active depression"],

        # Hematological
        "anticoagulation":  ["Bridge therapy planning required around invasive procedures",
                             "DOAC interactions with azole antifungals, rifampicin, chemotherapy",
                             "Thrombocytopenia threshold: hold anticoagulation if plt <50,000"],
        "thrombocytopenia": ["Platelet transfusion threshold before invasive procedures: >50,000",
                             "Avoid antiplatelet agents unless cardiac indication outweighs risk",
                             "G-CSF use if chemotherapy-related neutropenia anticipated"],

        # Autoimmune
        "rheumatoid arthritis":    ["Methotrexate dose adjustment with concurrent nephrotoxic agents",
                                    "Immunotherapy (checkpoint inhibitors) risk of disease flare",
                                    "Rheumatology co-management during immunosuppressive therapy"],
        "systemic lupus":          ["Hydroxychloroquine continues during most cancer treatments",
                                    "Checkpoint inhibitor immunotherapy HIGH RISK of lupus flare",
                                    "Cyclophosphamide interactions — discuss with rheumatology"],
        "inflammatory bowel disease": ["Avoid NSAIDs — may trigger IBD flare",
                                       "Checkpoint inhibitor immunotherapy HIGH RISK of colitis",
                                       "5-ASA interactions with azathioprine (bone marrow suppression)"],

        # Infectious
        "hiv":              ["CD4 count determines immunosuppression tolerance",
                             "ART drug-drug interactions with chemotherapy — pharmacist review mandatory",
                             "PCP prophylaxis if CD4 <200 or on high-dose steroids",
                             "HIV viral load should be undetectable before immunosuppressive therapy"],
        "tuberculosis":     ["Active TB must be treated before immunosuppressive therapy",
                             "LTBI prophylaxis with isoniazid before anti-TNF or checkpoint inhibitors",
                             "Rifampicin is potent CYP3A4 inducer — reduces many drug levels significantly"],
    }

    if not ongoing:
        return "  No active comorbidities documented in disease identity"

    matched = False
    for condition_entry in ongoing:
        condition_name = (
            condition_entry.get("name", "")
            or condition_entry.get("condition", "")
        ).lower()

        for keyword, rules in COMORBIDITY_RULES.items():
            if keyword in condition_name:
                matched = True
                lines.append(
                    f"\n  ⚠ COMORBIDITY: {condition_entry.get('name', condition_name).upper()}"
                )
                for rule in rules:
                    lines.append(f"    → {rule}")

    if not matched:
        lines.append(
            "  Comorbidities present but no specific drug-interaction rules triggered — "
            "standard treatment protocols apply with routine monitoring"
        )

    return "\n".join(lines) if lines else "  No comorbidity constraints identified"


def _extract_sex_specific_screening(age, sex: str) -> str:
    """
    Age and sex-specific screening and preventive care reminders
    relevant to treatment planning decisions.
    """
    if not sex:
        return ""

    sex   = sex.lower()
    lines = ["\nSEX AND AGE-SPECIFIC PREVENTIVE CARE RELEVANT TO TREATMENT:"]

    if sex in ["female", "f", "woman"]:
        if age:
            if age >= 21:
                lines.append("  - Cervical cancer screening (Pap/HPV) — confirm status before immunosuppression")
            if age >= 40:
                lines.append("  - Mammography screening — confirm baseline before hormonal therapy")
            if age >= 50:
                lines.append("  - DEXA bone density — baseline before AI therapy or prolonged steroids")
                lines.append("  - Colorectal cancer screening — confirm up to date")
            if 45 <= age <= 75:
                lines.append("  - Cardiovascular risk stratification (Framingham/ASCVD) before cardiotoxic agents")
            if age < 50:
                lines.append("  - Pregnancy test MANDATORY before cytotoxic or teratogenic treatment")
                lines.append("  - Fertility preservation discussion and documentation required")

    elif sex in ["male", "m", "man"]:
        if age:
            if age >= 50:
                lines.append("  - PSA baseline if hormonal therapy or pelvic radiation planned")
                lines.append("  - Colorectal cancer screening — confirm up to date")
                lines.append("  - Cardiovascular risk stratification before cardiotoxic agents")
            if age >= 70:
                lines.append("  - Abdominal aortic aneurysm screening if smoker")
                lines.append("  - Frailty assessment (CFS) before major treatment decisions")
            if age < 50:
                lines.append("  - Testicular function assessment before gonadotoxic chemotherapy")
                lines.append("  - Sperm banking offer BEFORE alkylating agents — document offer and decision")

    return "\n".join(lines)


def _extract_drug_dosing_adjustments(
    age,
    sex: str,
    medical: dict,
    state: ClinicalReasoningState
) -> str:
    """
    Generate drug dosing adjustment requirements based on
    patient-specific factors: age, sex, organ function, weight.
    """
    lines = ["\nDRUG DOSING ADJUSTMENT REQUIREMENTS:"]

    if age:
        age = int(age)

        if age >= 65:
            lines.append("  AGE-BASED DOSE ADJUSTMENTS (≥65 years):")
            lines.append("    - Start at 50–75% of standard adult dose for narrow therapeutic index drugs")
            lines.append("    - Opioids: start low, titrate slowly — increased CNS sensitivity")
            lines.append("    - Benzodiazepines: AVOID (Beers) — use lowest dose if absolutely necessary")
            lines.append("    - Anticoagulants: increased bleeding risk — lower target INR range (2.0–2.5)")
            lines.append("    - Diuretics: higher hyponatremia and orthostatic hypotension risk")
            lines.append("    - Digoxin: toxicity at normal levels — target 0.5–0.9 ng/mL in elderly")

        if age >= 75:
            lines.append("  AGE-BASED DOSE ADJUSTMENTS (≥75 years):")
            lines.append("    - CrCl calculation using Cockcroft-Gault (not eGFR) for drug dosing")
            lines.append("    - Albumin-corrected drug levels for highly protein-bound drugs")
            lines.append("    - Chemotherapy: dose reduction 20–25% standard unless CGA supports full dose")
            lines.append("    - G-CSF support mandatory if chemotherapy planned (high febrile neutropenia risk)")

    if sex:
        sex = sex.lower()
        if sex in ["female", "f", "woman"]:
            lines.append("  SEX-BASED DOSE CONSIDERATIONS (Female):")
            lines.append("    - Lower Vd for many drugs → higher peak concentration for given dose")
            lines.append("    - Methotrexate: higher toxicity risk — monitor LFTs and CBC more frequently")
            lines.append("    - Fluorouracil: higher toxicity in females — consider 20% dose reduction")
            lines.append("    - QT-prolonging drugs: higher baseline QTc — check ECG before initiation")
            lines.append("    - Codeine: CYP2D6 variability higher — morphine preferred for predictability")

        elif sex in ["male", "m", "man"]:
            lines.append("  SEX-BASED DOSE CONSIDERATIONS (Male):")
            lines.append("    - Higher Vd for many drugs → may need higher mg/kg dosing")
            lines.append("    - Bleomycin pulmonary toxicity somewhat higher in males — monitor PFTs")

    # Organ function dose adjustments
    functional = state.get("functional_status") or medical.get("functional_status", {})
    risk_top   = state.get("risk_topology")     or medical.get("risk_topology", {})

    active_risks = risk_top.get("active_risks", [])
    for risk in active_risks:
        name     = risk.get("name", "").lower()
        category = risk.get("category", "").lower()
        basis    = risk.get("basis", "")

        if "renal" in name or "ckd" in name or "renal" in category:
            lines.append(f"\n  RENAL IMPAIRMENT ADJUSTMENT (basis: {basis}):")
            lines.append("    - Carboplatin: dose by Calvert formula using actual GFR (not eGFR)")
            lines.append("    - Cisplatin: reduce dose or substitute if CrCl <60 mL/min")
            lines.append("    - Pemetrexed: avoid if CrCl <45 mL/min")
            lines.append("    - Capecitabine: 75% dose if CrCl 30–50; avoid if <30")
            lines.append("    - LMWH: switch to UFH or anti-Xa monitoring if CrCl <30")
            lines.append("    - Allopurinol: reduce dose by 50% if CrCl <30")

        if "hepatic" in name or "liver" in name or "hepatic" in category:
            lines.append(f"\n  HEPATIC IMPAIRMENT ADJUSTMENT (basis: {basis}):")
            lines.append("    - Vinca alkaloids (vincristine/vinorelbine): 50% dose if bilirubin >1.5x ULN")
            lines.append("    - Taxanes: dose reduce if bilirubin elevated (Child-Pugh guided)")
            lines.append("    - Irinotecan: significantly increased toxicity in hepatic impairment")
            lines.append("    - Avoid MTX in significant hepatic impairment")
            lines.append("    - Tyrosine kinase inhibitors: hepatotoxic — weekly LFT monitoring initially")

    return "\n".join(lines)


# =====================================================================
# BUILD TREATMENT VALIDATION CONTEXT  (FINAL ENHANCED VERSION)
# =====================================================================

def build_treatment_validation_context(state: ClinicalReasoningState) -> str:
    """
    Build complete context for TreatmentValidationAgent.

    Incorporates:
    - Age and sex-specific treatment rules
    - Organ function constraints
    - Comorbidity drug interaction rules
    - Drug dosing adjustment requirements
    - Sex-specific screening requirements
    - Completed / active / planned treatment exclusions
    - Investigation exclusions
    - Agent-computed vs DB-stored data resolution
    """
    try:
        medical      = state.get("medical_context", {}) or {}
        demographics = medical.get("demographics",   {}) or {}

        age = demographics.get("age")
        sex = demographics.get("sex", "Unknown")

        # ── Resolve all fields: agent-computed first, DB fallback ─
        treatment_memory   = state.get("treatment_memory")   or medical.get("treatment_memory",   {})
        disease_identity   = state.get("disease_identity")   or medical.get("disease_identity",   {})
        disease_trajectory = state.get("disease_trajectory") or medical.get("disease_trajectory", {})
        
        case_boundaries    = state.get("case_boundaries",    {})

        prognosis = (
            state.get("prognosis_factors")
            or state.get("prognosis")
            or medical.get("prognosis", {})
        )

        # ── Exclusion blocks ──────────────────────────────────────
        already_completed    = _extract_completed_treatments(treatment_memory)
        already_active       = _extract_active_treatments(treatment_memory)
        # already_planned      = _extract_planned_treatments(treatment_memory)
        # already_investigated = _extract_completed_investigations(
        #     treatment_memory, disease_trajectory
        # )

        # ── Intelligence blocks ───────────────────────────────────
        clinical_profile     = _extract_patient_clinical_profile(medical, state)
        comorbidity_rules    = _extract_comorbidity_constraints(medical, state)
        dosing_adjustments   = _extract_drug_dosing_adjustments(age, sex, medical, state)
        screening_reminders  = _extract_sex_specific_screening(age, sex)

        treatment_summary    = treatment_memory.get("treatment_summary", "Not available")

        return f"""
TREATMENT VALIDATION INPUT
════════════════════════════════════════════════════════════════

DEMOGRAPHICS:
Age : {age if age else "Unknown"}
Sex : {sex}

════════════════════════════════════════════════════════════════
⛔  MANDATORY EXCLUSION — DO NOT RECOMMEND THESE AGAIN
════════════════════════════════════════════════════════════════

TREATMENTS ALREADY COMPLETED OR DISCONTINUED:
{already_completed}

TREATMENTS CURRENTLY ACTIVE (do NOT re-initiate):
{already_active}



════════════════════════════════════════════════════════════════
✅  NEW RECOMMENDATIONS MUST ONLY BE:
  1. Treatments NOT yet tried for the CURRENT case
  2. Next-line therapy after prior line failure/completion
  3. Investigations not yet done OR repeat justified by NEW findings
  4. Dose/schedule modifications to existing active treatments
  5. For EACH recommendation state:
       - Why NOT already covered
       - Line of therapy (1st / 2nd / 3rd)
       - Prior treatment failure/completion justifying this
════════════════════════════════════════════════════════════════

PATIENT CLINICAL PROFILE (age, sex, performance status, toxicity history):
{clinical_profile}

COMORBIDITY-BASED TREATMENT CONSTRAINTS:
{comorbidity_rules}

DRUG DOSING ADJUSTMENT REQUIREMENTS:
{dosing_adjustments}

{screening_reminders}

════════════════════════════════════════════════════════════════
CASE CONTEXT (past vs present separation):
{safe_json(case_boundaries)}

TREATMENT MEMORY SUMMARY:
{treatment_summary}

FULL TREATMENT MEMORY (agent-computed):
{safe_json(treatment_memory)}

DISEASE IDENTITY (agent-computed):
{safe_json(disease_identity)}

DISEASE TRAJECTORY (agent-computed):
{safe_json(disease_trajectory)}

STAGING (this session):
{safe_json(state.get("staging_analysis", {}))}

PROGNOSIS (this session):
{safe_json(prognosis)}

RISK STRATIFICATION (this session):
{safe_json(state.get("risk_stratification", {}))}



PROPOSED / CURRENT CONSULTATION TEXT:
{state.get("consultation_text", "")}
════════════════════════════════════════════════════════════════
""".strip()

    except Exception as e:
        logger.error(f"build_treatment_validation_context failed: {e}")
        return "Treatment validation context unavailable"


# =====================================================================
# BUILD ADVANCED TREATMENT INTELLIGENCE CONTEXT  (FINAL ENHANCED)
# =====================================================================




def _extract_completed_treatments(treatment_memory: dict) -> str:
    """
    Extract a clear list of completed treatments for the exclusion block
    """
    if not treatment_memory:
        return "No prior treatment history available"
    
    lines = []
    
    completed = treatment_memory.get("completed_treatments", [])
    for t in completed:
        name = t.get("name", "Unknown")
        type_ = t.get("type", "")
        for_disease = t.get("for_disease", "")
        started = t.get("started", "")
        response = t.get("response", "")
        notes = t.get("notes", "")
        lines.append(
            f"  ✗ {name} ({type_}) for {for_disease} | "
            f"Period: {started} | Response: {response} | {notes}"
        )
    
    # Also check active_treatments with status completed/discontinued
    active = treatment_memory.get("active_treatments", [])
    for t in active:
        if t.get("status") in ["completed", "discontinued"]:
            name = t.get("name", "Unknown")
            reason = t.get("notes", "")
            lines.append(f"  ✗ {name} — {t.get('status').upper()} | {reason}")
    
    return "\n".join(lines) if lines else "No completed treatments on record"


def _extract_active_treatments(treatment_memory: dict) -> str:
    """
    Extract currently active treatments to prevent re-initiation
    """
    if not treatment_memory:
        return "No active treatment history available"
    
    lines = []
    active = treatment_memory.get("active_treatments", [])
    
    for t in active:
        if t.get("status") == "ongoing":
            name = t.get("name", "Unknown")
            type_ = t.get("type", "")
            for_disease = t.get("for_disease", "")
            started = t.get("started", "")
            response = t.get("response", "")
            lines.append(
                f"  → {name} ({type_}) for {for_disease} | "
                f"Started: {started} | Current response: {response}"
            )
    
    return "\n".join(lines) if lines else "No currently active treatments"



def build_advanced_treatment_intelligence_context(
    state: ClinicalReasoningState,
) -> str:
    """
    Build complete context for AdvancedTreatmentIntelligenceAgent.

    Incorporates everything in build_treatment_validation_context PLUS:
    - All upstream agent outputs (differential, staging, prognosis,
      risk, guideline compliance, deterioration warning)
    - Full structured quick-reference summary of upstream results
    - Hypothesis layer and next visit brief
    - Complete treatment intelligence for the flagship agent
    """
    try:
        medical      = state.get("medical_context", {}) or {}
        demographics = medical.get("demographics",   {}) or {}

        age = demographics.get("age")
        sex = demographics.get("sex", "Unknown")

        # ── Resolve all fields ────────────────────────────────────
        treatment_memory   = state.get("treatment_memory")   or medical.get("treatment_memory",   {})
        disease_identity   = state.get("disease_identity")   or medical.get("disease_identity",   {})
        disease_trajectory = state.get("disease_trajectory") or medical.get("disease_trajectory", {})
        functional_status  = state.get("functional_status")  or medical.get("functional_status",  {})
        risk_topology      = state.get("risk_topology")      or medical.get("risk_topology",       {})
        hypothesis_layer   = state.get("hypothesis_layer")   or medical.get("hypothesis_layer",    {})
        next_visit_brief   = state.get("next_visit_brief")   or medical.get("next_visit_brief",    {})
        case_boundaries    = state.get("case_boundaries",    {})

        prognosis = (
            state.get("prognosis_factors")
            or state.get("prognosis")
            or medical.get("prognosis", {})
        )

        # ── Upstream agent outputs ────────────────────────────────
        differential    = state.get("differential_diagnosis",         {})
        staging         = state.get("staging_analysis",               {})
        risk_strat      = state.get("risk_stratification",            {})
        guideline       = state.get("guideline_compliance",           {})
        deterioration   = state.get("clinical_deterioration_warning", {})
        treatment_valid = state.get("treatment_validation",           {})

        # ── Exclusion blocks ──────────────────────────────────────
        already_completed    = _extract_completed_treatments(treatment_memory)
        already_active       = _extract_active_treatments(treatment_memory)
        # already_planned      = _extract_planned_treatments(treatment_memory)
        # already_investigated = _extract_completed_investigations(
        #     treatment_memory, disease_trajectory
        # )

        # ── Intelligence blocks ───────────────────────────────────
        clinical_profile    = _extract_patient_clinical_profile(medical, state)
        comorbidity_rules   = _extract_comorbidity_constraints(medical, state)
        dosing_adjustments  = _extract_drug_dosing_adjustments(age, sex, medical, state)
        screening_reminders = _extract_sex_specific_screening(age, sex)

        # ── Upstream quick-reference ──────────────────────────────
        primary_diagnosis = "Unknown"
        diag_confidence   = 0.0
        most_likely       = differential.get("most_likely_diagnoses", [])
        if most_likely:
            primary_diagnosis = most_likely[0].get("diagnosis", "Unknown")
            diag_confidence   = differential.get("overall_diagnostic_confidence", 0.0)

        must_not_miss = [
            d.get("diagnosis")
            for d in differential.get("must_not_miss_diagnoses", [])[:2]
        ]

        stage_value    = staging.get("primary_staging",    {}).get("stage",    "Unknown")
        severity_value = staging.get("severity_grade",     {}).get("grade",    "Unknown")
        stability      = staging.get("severity_grade",     {}).get("stability","Unknown")

        prognosis_cat  = prognosis.get("prognostic_category", "Unknown")
        short_outlook  = (
            prognosis.get("outcome_predictions", {})
                     .get("short_term", {})
                     .get("expected_outcome", "Unknown")
        )

        overall_risk = (
            risk_strat.get("overall_risk_category", {}).get("level", "Unknown")
            if isinstance(risk_strat.get("overall_risk_category"), dict)
            else risk_strat.get("overall_risk_category", "Unknown")
        )
        immediate_action = risk_strat.get("requires_immediate_action", False)

        guideline_assessment  = (
            guideline.get("guideline_adherence_summary", {})
                     .get("overall_assessment", "Unknown")
        )
        missing_interventions = [
            i.get("intervention")
            for i in guideline.get("missing_recommended_interventions", [])[:3]
        ]

        news2_risk = (
            deterioration.get("early_warning_scores", {})
                         .get("NEWS2", {})
                         .get("risk_level", "Unknown")
        )
        trending = (
            deterioration.get("trending_analysis", {})
                         .get("direction", "Unknown")
        )

        treatment_summary  = treatment_memory.get("treatment_summary",  "Not available")
        identity_summary   = disease_identity.get("patient_summary",    {})
        trajectory_summary = disease_trajectory.get("trajectory_summary","Not available")
        risk_summary       = risk_topology.get("risk_summary",          "Not available")

        return f"""
ADVANCED TREATMENT INTELLIGENCE INPUT
════════════════════════════════════════════════════════════════

DEMOGRAPHICS:
Age : {age if age else "Unknown"}
Sex : {sex}

════════════════════════════════════════════════════════════════
⛔  MANDATORY EXCLUSION — DO NOT RECOMMEND THESE AGAIN
════════════════════════════════════════════════════════════════

TREATMENTS ALREADY COMPLETED OR DISCONTINUED:
{already_completed}

TREATMENTS CURRENTLY ACTIVE (do NOT re-initiate):
{already_active}



════════════════════════════════════════════════════════════════
✅  NEW RECOMMENDATIONS MUST ONLY BE:
  1. Treatments NOT yet tried for the CURRENT case
  2. Next-line therapy after prior line failure/completion
  3. Investigations not yet done OR repeat justified by NEW findings
  4. Dose/schedule modifications to existing active treatments
  5. For EACH recommendation state line of therapy and justification
  6. Separate recommendations for CURRENT CASE vs HISTORICAL CASES
════════════════════════════════════════════════════════════════

PATIENT CLINICAL PROFILE (age, sex, performance status, toxicity history):
{clinical_profile}

COMORBIDITY-BASED TREATMENT CONSTRAINTS:
{comorbidity_rules}

DRUG DOSING ADJUSTMENT REQUIREMENTS:
{dosing_adjustments}

{screening_reminders}

════════════════════════════════════════════════════════════════
UPSTREAM AGENT OUTPUTS — QUICK REFERENCE
════════════════════════════════════════════════════════════════

DIFFERENTIAL DIAGNOSIS:
  Primary most likely  : {primary_diagnosis}
  Confidence           : {diag_confidence}
  Must-not-miss        : {must_not_miss}

STAGING:
  Stage                : {stage_value}
  Severity             : {severity_value}
  Stability            : {stability}

PROGNOSIS:
  Category             : {prognosis_cat}
  Short-term outlook   : {short_outlook}

RISK STRATIFICATION:
  Overall risk         : {overall_risk}
  Immediate action req : {immediate_action}

GUIDELINE COMPLIANCE:
  Overall assessment   : {guideline_assessment}
  Missing interventions: {missing_interventions}

DETERIORATION WARNING:
  NEWS2 risk level     : {news2_risk}
  Clinical trending    : {trending}

════════════════════════════════════════════════════════════════
FULL AGENT-COMPUTED DATA (current session)
════════════════════════════════════════════════════════════════

CASE CONTEXT (past vs present):
{safe_json(case_boundaries)}

TREATMENT MEMORY SUMMARY  : {treatment_summary}
PATIENT IDENTITY SUMMARY  : {safe_json(identity_summary)}
TRAJECTORY SUMMARY        : {trajectory_summary}
RISK TOPOLOGY SUMMARY     : {risk_summary}

FULL TREATMENT MEMORY     : {safe_json(treatment_memory)}
FULL DISEASE IDENTITY     : {safe_json(disease_identity)}
FULL DISEASE TRAJECTORY   : {safe_json(disease_trajectory)}
FULL FUNCTIONAL STATUS    : {safe_json(functional_status)}
FULL RISK TOPOLOGY        : {safe_json(risk_topology)}
FULL PROGNOSIS            : {safe_json(prognosis)}
HYPOTHESIS LAYER          : {safe_json(hypothesis_layer)}
NEXT VISIT BRIEF          : {safe_json(next_visit_brief)}

TREATMENT VALIDATION OUTPUT (this session):
{safe_json(treatment_valid)}

GUIDELINE COMPLIANCE OUTPUT (this session):
{safe_json(guideline)}

STAGING OUTPUT (this session):
{safe_json(staging)}

CONSULTATION TEXT:
{state.get("consultation_text", "")}
════════════════════════════════════════════════════════════════
""".strip()

    except Exception as e:
        logger.error(f"build_advanced_treatment_intelligence_context failed: {e}")
        return "Advanced treatment intelligence context unavailable"


# =====================================================================
# STATE PROPAGATION GUARD  (FINAL VERSION)
# =====================================================================

def ensure_treatment_state_propagation(
    state: ClinicalReasoningState,
) -> ClinicalReasoningState:
    """
    Syncs all agent-computed outputs into medical_context so every
    context-builder always finds the freshest data regardless of
    which read-path it uses.

    Also validates critical fields and logs data quality warnings
    so missing data is caught early rather than silently causing
    incorrect treatment recommendations.

    Wire as a pass-through workflow node between
    risk_topology_agent and prognosis_agent.
    """
    AGENT_KEYS = [
        "disease_identity",
        "disease_trajectory",
        "treatment_memory",
        "functional_status",
        "risk_topology",
        "prognosis",
        "hypothesis_layer",
        "case_boundaries",
    ]

    CRITICAL_KEYS_FOR_TREATMENT = [
        "treatment_memory",
        "disease_identity",
        "disease_trajectory",
        "functional_status",
    ]

    if "medical_context" not in state or state["medical_context"] is None:
        state["medical_context"] = {}

    if "warnings" not in state or state["warnings"] is None:
        state["warnings"] = []

    for key in AGENT_KEYS:
        agent_value  = state.get(key)
        stored_value = state["medical_context"].get(key)

        if agent_value:
            state["medical_context"][key] = agent_value
            logger.debug(
                f"✅ State sync: [{key}] propagated from "
                f"agent output → medical_context"
            )
        elif stored_value:
            logger.debug(
                f"⚠ State sync: [{key}] agent output empty — "
                f"retaining DB-stored value"
            )
        else:
            logger.warning(
                f"❌ State sync: [{key}] missing from BOTH "
                f"agent output and DB — treatment recommendations may be impaired"
            )
            if key in CRITICAL_KEYS_FOR_TREATMENT:
                state["warnings"].append(
                    f"⚠ DATA GAP: [{key}] not available — "
                    f"treatment recommendations will be based on incomplete data"
                )

    # ── Validate demographics ────────────────────────────────────
    demographics = state["medical_context"].get("demographics", {}) or {}
    age = demographics.get("age")
    sex = demographics.get("sex")

    if not age:
        logger.warning("❌ State sync: patient age missing — age-specific dosing cannot be applied")
        state["warnings"].append(
            "⚠ MISSING AGE: Age not available — "
            "age-specific drug dosing, Beers criteria, and geriatric "
            "assessment rules cannot be applied to treatment recommendations"
        )

    if not sex or str(sex).lower() in ["unknown", "not specified", ""]:
        logger.warning("❌ State sync: patient sex missing — sex-specific rules cannot be applied")
        state["warnings"].append(
            "⚠ MISSING SEX: Biological sex not documented — "
            "sex-specific contraindications, fertility counseling, "
            "and QT-prolongation risk assessment cannot be applied"
        )

    # ── Validate treatment memory structure ───────────────────────
    treatment_memory = state.get("treatment_memory") or {}
    if treatment_memory:
        active_tx    = treatment_memory.get("active_treatments", [])
        completed_tx = treatment_memory.get("completed_treatments", [])

        if not active_tx and not completed_tx:
            logger.warning(
                "⚠ State sync: treatment_memory present but both "
                "active_treatments and completed_treatments are empty"
            )
            state["warnings"].append(
                "⚠ TREATMENT MEMORY EMPTY: No treatment history available — "
                "duplication risk elevated; verify patient has no prior treatment"
            )

    # ── Validate functional status ────────────────────────────────
    functional = state.get("functional_status") or {}
    if functional:
        ps = functional.get("performance_status", {})
        if not ps.get("score") or ps.get("score") == "unknown":
            state["warnings"].append(
                "⚠ PERFORMANCE STATUS UNKNOWN: ECOG/KPS not documented — "
                "treatment intensity decision cannot be fully validated; "
                "assess performance status before initiating chemotherapy"
            )

    logger.info(
        f"✅ State propagation complete | "
        f"age={'present' if age else 'MISSING'} | "
        f"sex={'present' if sex else 'MISSING'} | "
        f"treatment_memory={'present' if treatment_memory else 'MISSING'}"
    )

    return state


def build_general_agent_context(state: ClinicalReasoningState) -> str:
    """
    Build optimized agent context using:
    - vector_results (RAG)
    - clinical_summary (graph snapshot)
    - medical.latest_events (recent timeline)
    """

    try:
        structured = state.get("rag_context", {})

        # ===================================================
        # 🔎 VECTOR RESULTS
        # ===================================================
        vector_docs = structured.get("vector_results", [])

        critical_chunks = []
        if isinstance(vector_docs, list):
            for doc in vector_docs[:5]:
                try:
                    critical_chunks.append(doc.page_content)
                except Exception:
                    continue

        critical_text = "\n".join(critical_chunks) if critical_chunks else "No critical findings"

        # ===================================================
        # 🧠 CLINICAL SUMMARY (GRAPH SNAPSHOT)
        # ===================================================
        graph = structured.get("graph_results", {})
        clinical_summary = graph.get("clinical_summary", {})

        summary_procedures = clinical_summary.get("procedures", "None")
        summary_medications = clinical_summary.get("medications", "None")
        summary_treatment_plan = clinical_summary.get("treatment_plan", "None")
        summary_clinical_note = clinical_summary.get("clinical_note", "None")
        summary_investigation = clinical_summary.get("investigation", "None")
        summary_dictation = clinical_summary.get("dictation", "None")
        summary_vitals = clinical_summary.get("vital_signs", "None")
        summary_reports = clinical_summary.get("documents", "None")
        logger.info("Clinical Summary Extracted")
        logger.debug(f"procedures: {summary_procedures}")
        logger.debug(f"medications: {summary_medications}")
        logger.debug(f"treatment_plan: {summary_treatment_plan}")
        logger.debug(f"clinical_note: {summary_clinical_note}")
        logger.debug(f"investigation: {summary_investigation}")
        logger.debug(f"dictation: {summary_dictation}")
        logger.debug(f"vital_signs: {summary_vitals}")
        logger.debug(f"documents: {summary_reports}")
        # ===================================================
        # ⏱️ MEDICAL LATEST EVENTS (NEW)
        # ===================================================
        medical = state.get("medical_context", {})
        latest_events = medical.get("latest_events", {})

        latest_events_text = ""

        if isinstance(latest_events, dict):
            for feature, events in latest_events.items():

                latest_events_text += f"\n{feature.upper()}:\n"

                for e in events[:5]:
                    date = e.get("date", "")
                    data = e.get("data", "")
                    latest_events_text += f"- [{date}] {data}\n"

        if not latest_events_text:
            latest_events_text = "No recent events"

        # ===================================================
        # 🧾 FINAL CONTEXT
        # ===================================================
        context = f"""
CRITICAL FINDINGS (VECTOR RAG):
{vector_docs}

CLINICAL SUMMARY (GRAPH SNAPSHOT):

Procedures:
{summary_procedures}

Medications:
{summary_medications}

Treatment Plan:
{summary_treatment_plan}

Clinical Notes:
{summary_clinical_note}

Investigation:
{summary_investigation}

Dictation:
{summary_dictation}

Vital Signs:
{summary_vitals}

Report Data:
{summary_reports}

-------------------------------------

LATEST CLINICAL EVENTS (TEMPORAL SIGNAL):
{latest_events_text}
"""

        return context

    except Exception as e:
        logger.error(f"General context building failed: {e}")
        return "Context unavailable"


def build_patient_summary_prompt(context: str) -> str:

    return f"""
You are a clinical documentation assistant.

Your task is to generate a **clear, doctor-friendly patient summary**
from the provided clinical information.

Use ONLY factual information present in the input.

INPUT DATA
{context}

IMPORTANT RULES

• Extract information exactly as documented.
• Do NOT infer diagnoses, stage, prognosis, or treatments.
• Do NOT invent symptoms or findings.
• Do NOT duplicate information.
• If information is missing, return an empty list or "No data provided".
• Keep wording concise and clinically clear.

STRUCTURE THE SUMMARY INTO THESE SECTIONS

1. Patient Overview
    - Age
    - Sex

2. Active Medical Conditions
    Include ONLY confirmed diagnoses.
    Example:
    - Invasive carcinoma of breast
    - Hypertension

3. Presenting Problems
    Symptoms or clinical concerns that led to evaluation.

4. Key Clinical Findings
    Important objective findings from examination or imaging.
    Examples:
    - Bilateral breast masses
    - Enlarged right axillary lymph nodes
    - FDG-avid breast lesions

5. Important Investigations
    Only major diagnostic results.

    Types allowed:
    - lab
    - imaging
    - pathology
    - other

    Examples:
    imaging → PET-CT showing FDG-avid breast lesions  
    pathology → Invasive carcinoma NST on biopsy  
    lab → Hemoglobin 9.8 g/dL

6. Biomarkers
    Only molecular or immunohistochemistry markers.

    Example:
    ER, PR, HER2, Ki67

7. Treatments
    Categorize into:
    - active
    - completed
    - planned

8. Clinical Summary
    Write a short **2–3 sentence doctor-readable summary**
    describing the patient's condition, key findings, and current plan.

OUTPUT FORMAT

Return STRICT JSON.

{{
  "patient_overview": {{
    "age": "string",
    "sex": "string"
  }},

  "active_conditions": [
    "string"
  ],

  "presenting_problems": [
    "string"
  ],

  "key_clinical_findings": [
    "string"
  ],

  "important_investigations": [
    {{
      "type": "lab|imaging|pathology|other",
      "finding": "string"
    }}
  ],

  "biomarkers": [
    {{
      "marker": "string",
      "value": "string"
    }}
  ],

  "treatments": {{
    "active": ["string"],
    "completed": ["string"],
    "planned": ["string"]
  }},

  "clinical_summary": "short doctor-friendly summary",

  "confidence_score": 0.0-1.0
}}

CRITICAL

Return ONLY JSON.

Do not include:
- markdown
- explanations
- notes
- additional text

Start with {{
End with }}
"""






def build_patient_summary_context(state: ClinicalReasoningState) -> str:
    try:
        medical = state.get("medical_context", {}) or {}

        demographics = medical.get("demographics", {})
        disease_identity = medical.get("disease_identity", {})
        disease_trajectory = medical.get("disease_trajectory", {})
        symptoms = medical.get("symptom_trajectory", {})
        labs = medical.get("lab_trend_analysis", {})
        biomarkers = medical.get("biomarker_trend", {})
        imaging = medical.get("imaging_progression", {})
        treatment = medical.get("treatment_memory", {})
        comorbidity = medical.get("comorbidity_interaction", {})
        functional_status = medical.get("functional_status", {})

        age = demographics.get("age", "Unknown")
        sex = demographics.get("sex", "Unknown")

        return f"""
PATIENT SUMMARY INPUT

DEMOGRAPHICS
Age: {age}
Sex: {sex}

DIAGNOSES
{disease_identity}

DISEASE TRAJECTORY
{disease_trajectory}

SYMPTOMS / PRESENTING PROBLEMS
{symptoms}

IMAGING FINDINGS
{imaging}

LABORATORY FINDINGS
{labs}

BIOMARKERS
{biomarkers}

TREATMENT HISTORY
{treatment}

COMORBID CONDITIONS
{comorbidity}

FUNCTIONAL STATUS
{functional_status}

IMPORTANT RULES
Use ONLY documented information.
Do NOT infer diagnoses.
Do NOT estimate stage.
Do NOT estimate prognosis.
If information missing → state "No data provided".
"""
    except Exception as e:
        logger.error(f"Patient summary context failed: {e}")
        return "Patient summary context unavailable"


from typing import Any
import logging

logger = logging.getLogger(__name__)


# -------------------------------------------------
# STAGING CONTEXT
# -------------------------------------------------

def build_staging_context(state) -> str:
    """
    Build staging-specific context using clinical summary.
    """
    try:
        medical = state.get("medical_context", {}) or {}

        demographics = medical.get("demographics", {})
        clinical_summary = medical.get("clinical_summary", "")

        age = demographics.get("age", "Unknown")
        sex = demographics.get("sex", "Unknown")

        context = f"""
STAGING INPUT

-------------------------------------

DEMOGRAPHICS:
Age: {age}
Sex: {sex}

-------------------------------------

CLINICAL SUMMARY:
{clinical_summary}
"""

        return context.strip()

    except Exception as e:
        logger.error(f"Staging context building failed: {e}")
        return "Staging context unavailable"


# -------------------------------------------------
# PROGNOSIS CONTEXT
# -------------------------------------------------

def build_prognosis_context(state) -> str:
    try:
        medical = state.get("medical_context", {}) or {}

        demographics = medical.get("demographics", {})
        clinical_summary = medical.get("clinical_summary", "")

        age = demographics.get("age", "Unknown")
        sex = demographics.get("sex", "Unknown")

        context = f"""
PROGNOSIS INPUT

DEMOGRAPHICS:
Age: {age}
Sex: {sex}

-------------------------------------

CLINICAL SUMMARY:
{clinical_summary}

-------------------------------------

STAGING:
{state.get("staging_analysis")}
"""

        return context.strip()

    except Exception as e:
        logger.error(f"Prognosis context building failed: {e}")
        return "Prognosis context unavailable"


# -------------------------------------------------
# RISK STRATIFICATION CONTEXT
# -------------------------------------------------

def build_risk_context(state) -> str:
    try:
        medical = state.get("medical_context", {}) or {}

        demographics = medical.get("demographics", {})
        clinical_summary = medical.get("clinical_summary", "")

        age = demographics.get("age", "Unknown")
        sex = demographics.get("sex", "Unknown")

        context = f"""
RISK STRATIFICATION INPUT

DEMOGRAPHICS:
Age: {age}
Sex: {sex}

-------------------------------------

CLINICAL SUMMARY:
{clinical_summary}

-------------------------------------

STAGING:
{state.get("staging_analysis")}

-------------------------------------

PROGNOSIS:
{state.get("prognosis_analysis")}
"""

        return context.strip()

    except Exception as e:
        logger.error(f"Risk context building failed: {e}")
        return "Risk context unavailable"


# -------------------------------------------------
# ONCOLOGY DIFFERENTIAL CONTEXT
# -------------------------------------------------

def build_oncology_differential_context(state) -> str:
    try:
        medical = state.get("medical_context", {}) or {}

        demographics = medical.get("demographics", {})
        clinical_summary = medical.get("clinical_summary", "")

        age = demographics.get("age", "Unknown")
        sex = demographics.get("sex", "Unknown")

        context = f"""
ONCOLOGY DIFFERENTIAL INPUT

DEMOGRAPHICS:
Age: {age}
Sex: {sex}

-------------------------------------

CLINICAL SUMMARY:
{clinical_summary}

-------------------------------------

PROGNOSIS:
{state.get("prognosis_analysis")}
"""

        return context.strip()

    except Exception as e:
        logger.error(f"Differential context failed: {e}")
        return "Differential context unavailable"


# -------------------------------------------------
# GUIDELINE CONTEXT
# -------------------------------------------------

def build_guideline_context(state) -> str:
    try:
        medical = state.get("medical_context", {}) or {}

        demographics = medical.get("demographics", {})
        clinical_summary = medical.get("clinical_summary", "")

        age = demographics.get("age", "Unknown")
        sex = demographics.get("sex", "Unknown")

        context = f"""
GUIDELINE COMPLIANCE INPUT

DEMOGRAPHICS:
Age: {age}
Sex: {sex}

-------------------------------------

CLINICAL SUMMARY:
{clinical_summary}

-------------------------------------

STAGING:
{state.get("staging_analysis")}

-------------------------------------

PROGNOSIS:
{state.get("prognosis_analysis")}

-------------------------------------

TREATMENT VALIDATION:
{state.get("treatment_validation")}
"""

        return context.strip()

    except Exception as e:
        logger.error(f"Guideline context failed: {e}")
        return "Guideline context unavailable"


# -------------------------------------------------
# CLINICAL DETERIORATION CONTEXT
# -------------------------------------------------

def build_deterioration_context(state) -> str:
    try:
        medical = state.get("medical_context", {}) or {}

        demographics = medical.get("demographics", {})
        clinical_summary = medical.get("clinical_summary", "")

        age = demographics.get("age", "Unknown")
        sex = demographics.get("sex", "Unknown")

        context = f"""
CLINICAL DETERIORATION INPUT

DEMOGRAPHICS:
Age: {age}
Sex: {sex}

-------------------------------------

CLINICAL SUMMARY:
{clinical_summary}

-------------------------------------

RISK STRATIFICATION:
{state.get("risk_stratification")}

-------------------------------------

PROGNOSIS:
{state.get("prognosis_analysis")}
"""

        return context.strip()

    except Exception as e:
        logger.error(f"Deterioration context failed: {e}")
        return "Deterioration context unavailable"


# -------------------------------------------------
# DISCHARGE CONTEXT
# -------------------------------------------------

def build_discharge_context(state) -> str:
    try:
        medical = state.get("medical_context", {}) or {}

        demographics = medical.get("demographics", {})
        clinical_summary = medical.get("clinical_summary", "")

        age = demographics.get("age", "Unknown")
        sex = demographics.get("sex", "Unknown")

        context = f"""
DISCHARGE READINESS INPUT

DEMOGRAPHICS:
Age: {age}
Sex: {sex}

-------------------------------------

CLINICAL SUMMARY:
{clinical_summary}

-------------------------------------

STAGING:
{state.get("staging_analysis")}

-------------------------------------

PROGNOSIS:
{state.get("prognosis_analysis")}

-------------------------------------

RISK STRATIFICATION:
{state.get("risk_stratification")}

-------------------------------------

TREATMENT VALIDATION:
{state.get("treatment_validation")}
"""

        return context.strip()

    except Exception as e:
        logger.error(f"Discharge context failed: {e}")
        return "Discharge context unavailable"




def _format_documents_compact(docs: List[Dict[str, Any]], max_chars: int = 150) -> str:
    """Format documents compactly for prompts"""
    if not docs:
        return "None available"
    
    lines = []
    for i, doc in enumerate(docs[:5], 1):
        content = doc.get("content", "")[:max_chars]
        doc_type = doc.get("metadata", {}).get("subtype", "unknown")
        lines.append(f"{i}. [{doc_type}] {content}...")
    
    return "\n".join(lines)


def _format_documents_detailed(docs: List[Dict[str, Any]]) -> str:
    """Format documents with full detail (for medication reconciliation)"""
    if not docs:
        return "None available"
    
    lines = []
    for i, doc in enumerate(docs, 1):
        content = doc.get("content", "")
        metadata = doc.get("metadata", {})
        lines.append(f"\n{i}. Type: {metadata.get('subtype', 'unknown')}")
        lines.append(f"   Content: {content}")
    
    return "\n".join(lines)
# Version 2 End Helper function ends
# 4-02-2026 Abi
# End point
#_________________________________________







# =====================================================================
# STATE DEFINITIONS
# =====================================================================



# =====================================================================
# AGENT 1: DISEASE CAUSATION & PATHOPHYSIOLOGY ANALYZER
# =====================================================================

class DiseaseCausationAgent:
    """
    Analyzes disease causation and underlying pathophysiology
    """
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
        
    def analyze(self, state: ClinicalReasoningState) -> ClinicalReasoningState:
        """Analyze disease causation and pathophysiology"""
        
        logger.info("🔬 Disease Causation Agent: Starting analysis")
        
        prompt = f"""
Expert in disease causation and pathophysiology.

CLINICAL CONTEXT:
{safe_json(state.get("clinical_context", {}))}

MEDICAL CONTEXT:
{safe_json(state.get("medical_context", {}))}

CONSULTATION:
{state.get("consultation_text", "")}

RAG CONTEXT:
{safe_json(state.get("rag_context", {}))}

TASK: Analyze disease causation and underlying pathophysiology.

ANALYZE:
1. PRIMARY DISEASE PROCESS
   - Definitive diagnosis or leading diagnosis
   - Confidence level
   - ICD-10 code if applicable
   - Disease classification (genetic, infectious, autoimmune, metabolic, neoplastic, degenerative, traumatic, iatrogenic)

2. PATHOPHYSIOLOGICAL MECHANISM
   - Molecular/cellular level: what goes wrong at basic level?
   - Organ/system level: how does dysfunction manifest?
   - Cascade of events: initiating event → progression → clinical manifestation
   - Key pathways involved (inflammatory, immune, metabolic, etc.)

3. ETIOLOGICAL FACTORS
   Primary cause:
   - Single identifiable cause OR multifactorial
   
   Contributing factors:
   - Genetic predisposition
   - Environmental exposures
   - Lifestyle factors
   - Comorbid conditions
   - Medications/iatrogenic
   
  
RULES:
- Base analysis on available clinical data
- Use evidence-based pathophysiology
- Flag uncertainties clearly
- Distinguish proven mechanisms from hypothesized
- Consider genetic, molecular, cellular, organ, and system levels
- Integrate all available data (history, exam, labs, imaging)


CRITICAL OUTPUT RULES:
- ALL string fields: Maximum 10 words unless marked [LONG]
- Rationales: Maximum 15 words, focus on KEY reason only
- Descriptions: Maximum 12 words, essential information only
- Lists: Maximum 5 items unless critical
- Use medical abbreviations: MI not "myocardial infarction"
- Be telegraphic: "Pt has 3 high-risk factors" not "The patient presents with three significant risk factors"
- NO preambles, NO explanations, DIRECT answers only
- Example good: "HTN, DM, CKD increase CVD risk 3x"
- Example bad: "The patient's hypertension, diabetes, and chronic kidney disease significantly increase their cardiovascular disease risk by approximately three times"

1. You MUST ONLY use information explicitly present in the INPUT DATA below
2. If a field is empty/missing, you MUST state "No data provided" 
3. NEVER invent symptoms, lab values, imaging findings, or diagnoses
4. If insufficient data exists, you MUST respond with limitations
5. For "routine check-up" with no symptoms: Focus on health maintenance


OUTPUT (JSON):
{{
  "primary_disease_process": {{
    "diagnosis": "string",
    "confidence": 0.0-1.0,
    "icd10_code": "string or null",
    "disease_classification": "genetic|infectious|autoimmune|metabolic|neoplastic|degenerative|traumatic|iatrogenic|multifactorial"
  }},
  
  "pathophysiological_mechanism": {{
    "molecular_cellular_level": "string - what goes wrong at basic level",
    "organ_system_level": "string - how dysfunction manifests",
    "cascade_of_events": [
      {{
        "step": 1,
        "event": "string",
        "mechanism": "string"
      }}
    ],
    "key_pathways": ["inflammatory|immune|metabolic|ischemic|thrombotic|other"]
  }},
  
  "etiological_factors": {{
    "primary_cause": {{
      "cause": "string",
      "certainty": "definite|probable|possible|unknown"
    }},
    "contributing_factors": [
      {{
        "factor": "string",
        "category": "genetic|environmental|lifestyle|comorbid|iatrogenic",
        "contribution_level": "major|moderate|minor"
      }}
    ],
    "precipitating_factors": [
      {{
        "factor": "string",
        "timing": "string",
        "relevance": "high|moderate|low"
      }}
    ]
  }},
  
  "risk_factors": {{
    "non_modifiable": [
      {{
        "factor": "string",
        "present": true|false,
        "relative_risk_contribution": "high|moderate|low"
      }}
    ],
    "modifiable": [
      {{
        "factor": "string",
        "present": true|false,
        "relative_risk_contribution": "high|moderate|low",
        "intervention_potential": "string"
      }}
    ]
  }},
  
  "disease_timeline": {{
    "natural_history": "string - typical course if untreated",
    "current_stage": "early|middle|late|end_stage",
    "acuity": "acute|subacute|chronic|acute_on_chronic",
    "rate_of_progression": "rapid|moderate|slow|static",
    "reversibility": "fully_reversible|partially_reversible|irreversible",
    "time_since_onset": "string"
  }},
  
  "complications": {{
    "present": [
      {{
        "complication": "string",
        "severity": "mild|moderate|severe",
        "impact": "string"
      }}
    ],
    "at_risk_for": [
      {{
        "complication": "string",
        "risk_level": "high|moderate|low",
        "timeframe": "immediate|short_term|long_term",
        "prevention_strategy": "string"
      }}
    ]
  }},
  
  "pathognomonic_features": {{
    "diagnostic_findings": ["findings that definitively diagnose this condition"],
    "strongly_supportive": ["findings that strongly support diagnosis"],
    "findings_against": ["findings that argue against this diagnosis"]
  }},
  
  "differential_pathophysiology": [
    {{
      "alternative_diagnosis": "string",
      "alternative_mechanism": "string",
      "distinguishing_features": "string"
    }}
  ],
  
  "therapeutic_targets": {{
    "pharmacological_targets": [
      {{
        "target": "string - specific pathway/receptor/enzyme",
        "intervention_type": "string",
        "expected_effect": "string"
      }}
    ],
    "non_pharmacological_targets": [
      {{
        "target": "string",
        "intervention_type": "string",
        "expected_effect": "string"
      }}
    ]
  }},
  
  "prognostic_pathophysiology": {{
    "favorable_features": [
      {{
        "feature": "string",
        "prognostic_significance": "string"
      }}
    ],
    "unfavorable_features": [
      {{
        "feature": "string",
        "prognostic_significance": "string"
      }}
    ],
    "biomarkers": [
      {{
        "biomarker": "string",
        "significance": "string",
        "current_value": "string or null"
      }}
    ]
  }},
  
  "mechanistic_uncertainties": [
    "areas where pathophysiology is unclear or debated"
  ],
  
  "confidence_score": 0.0-1.0
}}
"""
        
        try:
            response = self.llm.invoke([
                SystemMessage(content="You are an expert in disease pathophysiology and causation analysis."),
                HumanMessage(content=prompt)
            ])
            
            result = self._parse_response(response.content)
            state["disease_causation"] = result
            state["confidence_scores"]["disease_causation"] = result.get("confidence_score", 0.0)
            
            # Flag low confidence diagnoses
            primary_disease = result.get("primary_disease_process", {})
            if primary_disease.get("confidence", 0) < 0.6:
                state["warnings"].append(
                    f"⚠️ LOW DIAGNOSTIC CONFIDENCE: {primary_disease.get('diagnosis', 'Unknown')} - Consider additional workup"
                )
                state["requires_review"] = True
            
            # Flag high-risk complications
            complications = result.get("complications", {})
            for comp in complications.get("at_risk_for", []):
                if comp.get("risk_level") == "high" and comp.get("timeframe") == "immediate":
                    state["warnings"].append(
                        f"⚠️ HIGH RISK COMPLICATION: {comp['complication']} - Immediate prevention needed"
                    )
            
            logger.info("✅ Disease Causation Agent: Analysis complete")
            
        except Exception as e:
            logger.error(f"❌ Disease Causation Agent failed: {str(e)}")
            state["error"] = f"Disease causation analysis failed: {str(e)}"
            
        return state
    
    def _parse_response(self, content: str) -> dict:
        """Parse LLM response to JSON"""
        try:
            content = content.strip()

            # Case 1: Extract JSON inside ```json blocks
            if "```json" in content:
                json_part = content.split("```json", 1)[1]
                json_part = json_part.split("```", 1)[0]
                return json.loads(json_part.strip())

            # Case 2: Extract any {...} JSON (fallback)
            start = content.find("{")
            end = content.rfind("}")
            if start != -1 and end != -1:
                return json.loads(content[start:end + 1])

            raise ValueError("No JSON found")

        except Exception as e:
            logger.warning(f"⚠️ Disease Causation JSON parse failed: {e}")
            return {
                "raw_content": content,
                "confidence_score": 0.5
            }



class PatientSummaryAgent:

    def __init__(self, llm: ChatGroq):
        self.llm = llm

    def analyze(self, state: ClinicalReasoningState) -> ClinicalReasoningState:

        logger.info("🧾 Patient Summary Agent: Starting analysis")

        context = build_patient_summary_context(state)
        logger.info(f"patient_summary_context:{context}")
        prompt = build_patient_summary_prompt(context)

        try:

            response = self.llm.invoke([
                SystemMessage(
                    content="You are an expert clinical documentation specialist producing structured patient summaries."
                ),
                HumanMessage(content=prompt)
            ])

            result = self._parse_response(response.content)

            state["patient_summary"] = result
            state["confidence_scores"]["patient_summary"] = result.get(
                "confidence_score", 0.0
            )

            logger.info("✅ Patient Summary Agent: Analysis complete")

        except Exception as e:

            logger.error(f"❌ Patient Summary Agent failed: {str(e)}")
            state["error"] = f"Patient summary failed: {str(e)}"

        return state

    def _parse_response(self, content: str) -> dict:

        try:
            content = content.strip()

            if "```json" in content:
                json_part = content.split("```json", 1)[1]
                json_part = json_part.split("```", 1)[0]
                return json.loads(json_part.strip())

            start = content.find("{")
            end = content.rfind("}")

            if start != -1 and end != -1:
                return json.loads(content[start:end + 1])

            raise ValueError("No JSON found")

        except Exception as e:

            logger.warning(f"⚠️ Patient Summary JSON parse failed: {e}")

            return {
                "raw_content": content,
                "confidence_score": 0.5
            }


# =====================================================================
# AGENT 2: STAGING & SEVERITY CLASSIFICATION AGENT
# =====================================================================

class StagingAgent:
    """
    Determines disease stage, severity, and classification using
    specialty-specific scoring systems
    """
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
        
    def analyze(self, state: ClinicalReasoningState) -> ClinicalReasoningState:
        """Analyze disease staging and severity"""
        
        logger.info("📊 Staging Agent: Starting analysis")
        optimized_context = build_staging_context(state)
        logger.info(f"optimized_context:{optimized_context}")
        prompt = f"""
    Expert medical staging and severity classification.
    
    {optimized_context}
    
    DISEASE ANALYSIS:
    {json.dumps(state.get("disease_causation", {}))}
    
    TASK: Determine stage/severity using validated systems.
    
    APPLICABLE SYSTEMS BY SPECIALTY:
    Oncology: TNM, Ann Arbor, FIGO, Gleason
    Cardiology: NYHA, Killip, TIMI
    Hepatology: Child-Pugh, MELD
    Nephrology: CKD stages (eGFR)
    Neurology: GCS, NIHSS, Modified Rankin
    Pulmonology: GOLD, Asthma severity
    Infection: qSOFA, CURB-65, APACHE II
    Rheumatology: ACR, DAS28
    
    REQUIREMENTS:
    1. Identify applicable staging system(s)
    2. Calculate stage/score - SHOW WORK
    3. Grade severity: mild/moderate/severe/critical + stable/unstable/deteriorating
    4. Prognostic implications and monitoring needs
    5. Flag missing data that affects staging
    
    RULES:
    - Use ONLY validated systems
    - Show calculation steps
    - Flag incomplete data
    - Consider comorbidities

    CRITICAL OUTPUT RULES:
    - ALL string fields: Maximum 10 words unless marked [LONG]
    - Rationales: Maximum 15 words, focus on KEY reason only
    - Descriptions: Maximum 12 words, essential information only
    - Lists: Maximum 5 items unless critical
    - Use medical abbreviations: MI not "myocardial infarction"
    - Be telegraphic: "Pt has 3 high-risk factors" not "The patient presents with three significant risk factors"
    - NO preambles, NO explanations, DIRECT answers only
    - Example good: "HTN, DM, CKD increase CVD risk 3x"
    - Example bad: "The patient's hypertension, diabetes, and chronic kidney disease significantly increase their cardiovascular disease risk by approximately three times"
    1. You MUST ONLY use information explicitly present in the INPUT DATA below
    2. If a field is empty/missing, you MUST state "No data provided" 
    3. NEVER invent symptoms, lab values, imaging findings, or diagnoses
    4. If insufficient data exists, you MUST respond with limitations
    5. For "routine check-up" with no symptoms: Focus on health maintenance


    OUTPUT (JSON):
    {{
      "applicable_systems": [{{"name": "string", "specialty": "string", "relevance": "primary|secondary"}}],
      "primary_staging": {{
        "system": "string",
        "stage": "string",
        "calculation": {{
          "components": [{{"parameter": "string", "value": "string", "score": "number", "data_available": true|false}}],
          "total_score": "string",
          "interpretation": "string"
        }},
        "confidence": 0.0-1.0
      }},
      "severity_grade": {{
        "grade": "mild|moderate|severe|critical",
        "stability": "stable|unstable|deteriorating",
        "compensation_status": "compensated|decompensated|unknown",
        "rationale": "string"
      }},
      "prognostic_implications": {{
        "expected_outcome": "string",
        "progression_risk": "low|medium|high",
        "treatment_response_likelihood": "good|fair|poor",
        "survival_estimate": "string or null"
      }},
      "monitoring_plan": {{
        "parameters": ["string"],
        "frequency": "string",
        "escalation_triggers": ["string"]
      }},
      "missing_data": ["string"],
      "confidence_score": 0.0-1.0
    }}

    CRITICAL:
    Return ONLY valid JSON.
    No markdown.
    No bullets.
    No headings.
    No explanations.
    No text outside JSON.
    Start with {{ and end with }}.
    If you output anything else the system will crash.
    """

            
        try:
            response = self.llm.invoke([
                SystemMessage(content="You are an expert in medical staging and severity classification."),
                HumanMessage(content=prompt)
            ])
            
            result = self._parse_response(response.content)
            state["staging_analysis"] = result
            state["confidence_scores"]["staging"] = result.get("confidence_score", 0.0)
            
            logger.info("✅ Staging Agent: Analysis complete")
            
        except Exception as e:
            logger.error(f"❌ Staging Agent failed: {str(e)}")
            state["error"] = f"Staging analysis failed: {str(e)}"
            
        return state
    
    def _parse_response(self, content: str) -> dict:
        try:
            content = content.strip()

            # Case 1: Extract JSON inside ```json blocks
            if "```json" in content:
                json_part = content.split("```json", 1)[1]
                json_part = json_part.split("```", 1)[0]
                return json.loads(json_part.strip())

            # Case 2: Extract any {...} JSON (fallback)
            start = content.find("{")
            end = content.rfind("}")
            if start != -1 and end != -1:
                return json.loads(content[start:end + 1])

            raise ValueError("No JSON found")

        except Exception as e:
            logger.warning(f"⚠️ Risk Stratification JSON parse failed: {e}")
            return {
                "raw_content": content,
                "confidence_score": 0.5
            }


# =====================================================================
# AGENT 3: PROGNOSIS & OUTCOME PREDICTOR
# =====================================================================

class PrognosisAgent:
    """
    Predicts outcomes, estimates prognosis, and identifies prognostic factors
    """
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
        
    def analyze(self, state: ClinicalReasoningState) -> ClinicalReasoningState:
        """Analyze prognosis and predict outcomes"""
        optimized_context = build_prognosis_context(state)
        logger.info("🔮 Prognosis Agent: Starting analysis")
        
        prompt = f"""
    Medical prognostication expert.
    
    CONTEXT:
    {optimized_context}
    
    TASK: Comprehensive prognostic assessment.
    
    ANALYZE:
    1. PROGNOSTIC FACTORS
       - Favorable: factors improving prognosis (impact, evidence, modifiable)
       - Unfavorable: factors worsening prognosis
       
    2. OUTCOME PREDICTIONS
       - Short-term (days-weeks): clinical trajectory, complication risks
       - Medium-term (months): disease control, functional recovery
       - Long-term (years): survival, cure vs control, relapse risk
    
    3. MODIFIABLE FACTORS
       - Priority interventions for prognostic improvement
       - What can be changed vs fixed
    
    4. TRAJECTORY SCENARIOS
       - Best case: optimal treatment + response
       - Expected: standard treatment + typical response
       - Worst case: complications/poor response
    
    5. UNCERTAINTY
       - Confidence in predictions
       - Key unknowns
       - Need for prognostic markers
    
    RULES:
    - Use validated prognostic models
    - Distinguish population statistics from individual factors
    - Consider comorbidities
    - Flag high uncertainty
    - Avoid false reassurance/pessimism

    CRITICAL OUTPUT RULES:
    - ALL string fields: Maximum 10 words unless marked [LONG]
    - Rationales: Maximum 15 words, focus on KEY reason only
    - Descriptions: Maximum 12 words, essential information only
    - Lists: Maximum 5 items unless critical
    - Use medical abbreviations: MI not "myocardial infarction"
    - Be telegraphic: "Pt has 3 high-risk factors" not "The patient presents with three significant risk factors"
    - NO preambles, NO explanations, DIRECT answers only
    - Example good: "HTN, DM, CKD increase CVD risk 3x"
    - Example bad: "The patient's hypertension, diabetes, and chronic kidney disease significantly increase their cardiovascular disease risk by approximately three times"
    1. You MUST ONLY use information explicitly present in the INPUT DATA below
    2. If a field is empty/missing, you MUST state "No data provided" 
    3. NEVER invent symptoms, lab values, imaging findings, or diagnoses
    4. If insufficient data exists, you MUST respond with limitations
    5. For "routine check-up" with no symptoms: Focus on health maintenance
        
    OUTPUT (JSON):
    {{
      "prognostic_factors": {{
        "favorable": [{{"factor": "string", "impact": "strong|moderate|mild", "evidence": "strong|moderate|weak", "modifiable": true|false}}],
        "unfavorable": [{{"factor": "string", "impact": "strong|moderate|mild", "evidence": "strong|moderate|weak", "modifiable": true|false}}]
      }},
      "outcome_predictions": {{
        "short_term": {{"timeline": "string", "expected_outcome": "string", "confidence": 0.0-1.0}},
        "medium_term": {{"timeline": "string", "expected_outcome": "string", "confidence": 0.0-1.0}},
        "long_term": {{"timeline": "string", "expected_outcome": "string", "survival_estimate": "string or null", "confidence": 0.0-1.0}}
      }},
      "trajectory_scenarios": {{
        "best_case": "string",
        "expected_case": "string",
        "worst_case": "string"
      }},
      "modifiable_factors_priority": [{{
        "factor": "string",
        "intervention": "string",
        "expected_benefit": "string",
        "feasibility": "easy|moderate|difficult"
      }}],
      "prognostic_category": "excellent|good|guarded|poor|grave",
      "confidence_score": 0.0-1.0,
      "uncertainty_factors": ["string"]
    }}
    CRITICAL:
    Return ONLY valid JSON.
    No markdown.
    No bullets.
    No headings.
    No explanations.
    No text outside JSON.
    Start with {{ and end with }}.
    If you output anything else the system will crash.
    """
   
        
        try:
            response = self.llm.invoke([
                SystemMessage(content="You are an expert in medical prognostication and outcome prediction."),
                HumanMessage(content=prompt)
            ])
            
            result = self._parse_response(response.content)
            state["prognosis_factors"] = result
            state["confidence_scores"]["prognosis"] = result.get("confidence_score", 0.0)
            
            logger.info("✅ Prognosis Agent: Analysis complete")
            
        except Exception as e:
            logger.error(f"❌ Prognosis Agent failed: {str(e)}")
            state["error"] = f"Prognosis analysis failed: {str(e)}"
            
        return state
    
    def _parse_response(self, content: str) -> dict:
        try:
            content = content.strip()

            # Case 1: Extract JSON inside ```json blocks
            if "```json" in content:
                json_part = content.split("```json", 1)[1]
                json_part = json_part.split("```", 1)[0]
                return json.loads(json_part.strip())

            # Case 2: Extract any {...} JSON (fallback)
            start = content.find("{")
            end = content.rfind("}")
            if start != -1 and end != -1:
                return json.loads(content[start:end + 1])

            raise ValueError("No JSON found")

        except Exception as e:
            logger.warning(f"⚠️ Risk Stratification JSON parse failed: {e}")
            return {
                "raw_content": content,
                "confidence_score": 0.5
            }

# =====================================================================
# AGENT 4: RISK STRATIFICATION AGENT
# =====================================================================

class RiskStratificationAgent:
    """
    Performs comprehensive risk assessment and stratification
    """
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
        
    def analyze(self, state: ClinicalReasoningState) -> ClinicalReasoningState:
        """Perform risk stratification"""
        
        logger.info("⚠️ Risk Stratification Agent: Starting analysis")
        optimized_context = build_risk_context(state)
        prompt = f"""
    Medical risk assessment expert.
    
    ═══════════════════════════════════════════
    CRITICAL REQUIREMENT: FULL CLINICAL SENTENCES
    ═══════════════════════════════════════════
    NEVER output single words. EVERY value MUST be a complete sentence (≥10 words) explaining WHY it applies to THIS patient.
    
   
    
    TASK:
    Patient-specific risk stratification.

    {optimized_context}
    
    DOMAINS:
    1. OVERALL RISK: low/moderate/high/critical + explanation sentence
    2. MORTALITY RISK: short-term (in-hospital/30-day) + long-term + sudden death if applicable
    3. MORBIDITY RISK: complications, disability, progression
    4. TREATMENT RISK: medication adverse effects, procedure complications, treatment failure
    5. TIME-SENSITIVE RISKS: immediate (hours-days), near-term (weeks-months), long-term (years)
    6. MITIGATION: interventions reducing risks, priority order, feasibility
    7. RISK-BENEFIT: treatment vs disease risk, QOL vs survival trade-offs
    
    RULES:
    - Use validated risk scores when available
    - Consider cumulative risk from multiple conditions
    - Flag emergency/urgent situations
    - Quantify risks with numeric ranges when possible
    - Account for age, comorbidities, disease stage

    CRITICAL OUTPUT RULES:
    - ALL string fields: Maximum 10 words unless marked [LONG]
    - Rationales: Maximum 15 words, focus on KEY reason only
    - Descriptions: Maximum 12 words, essential information only
    - Lists: Maximum 5 items unless critical
    - Use medical abbreviations: MI not "myocardial infarction"
    - Be telegraphic: "Pt has 3 high-risk factors" not "The patient presents with three significant risk factors"
    - NO preambles, NO explanations, DIRECT answers only
    - Example good: "HTN, DM, CKD increase CVD risk 3x"
    - Example bad: "The patient's hypertension, diabetes, and chronic kidney disease significantly increase their cardiovascular disease risk by approximately three times"
    1. You MUST ONLY use information explicitly present in the INPUT DATA below
    2. If a field is empty/missing, you MUST state "No data provided" 
    3. NEVER invent symptoms, lab values, imaging findings, or diagnoses
    4. If insufficient data exists, you MUST respond with limitations
    5. For "routine check-up" with no symptoms: Focus on health maintenance   
    OUTPUT (JSON):
    {{
      "overall_risk_category": {{
        "level": "low|moderate|high|critical",
        "summary": "Full sentence explaining why this risk level applies to this patient."
      }},
      "risk_score": 0.0-1.0,
      "risk_domains": {{
        "mortality": {{
          "short_term": {{"level": "low|moderate|high", "description": "Full sentence.", "percentage": "string", "timeline": "string"}},
          "long_term": {{"level": "low|moderate|high", "description": "Full sentence.", "percentage": "string", "timeline": "string"}}
        }},
        "morbidity": {{
          "probability": {{"level": "low|moderate|high", "description": "Sentence."}},
          "severity_if_occurs": {{"level": "mild|moderate|severe", "description": "Sentence."}},
          "complications": ["Full sentence describing complication."]
        }},
        "treatment_risk": {{
          "overall_level": {{"level": "low|moderate|high", "description": "Sentence."}},
          "medication_adverse_effects": ["Full sentence."],
          "procedure_complications": ["Full sentence."]
        }}
      }},
      "time_sensitive_risks": [{{
        "risk": "Full sentence.",
        "urgency": {{"level": "immediate|urgent|soon|routine", "description": "Sentence explaining urgency."}},
        "timeline": "string",
        "mitigation": "Full sentence."
      }}],
      "risk_mitigation_priority": [{{
        "risk": "Full sentence.",
        "intervention": "Full sentence.",
        "risk_reduction": {{"level": "major|moderate|minor", "description": "Sentence."}},
        "feasibility": {{"level": "easy|moderate|difficult", "description": "Sentence."}},
        "priority": 1-10
      }}],
      "red_flags": ["Full sentence describing critical warning."],
      "requires_immediate_action": true|false,
      "confidence_score": 0.0-1.0
    }}
    CRITICAL:
    Return ONLY valid JSON.
    No markdown.
    No bullets.
    No headings.
    No explanations.
    No text outside JSON.
    Start with {{ and end with }}.
    If you output anything else the system will crash.
    """
        
        try:
            response = self.llm.invoke([
                SystemMessage(content="You are a medical risk stratification engine. "
    "You MUST output VALID JSON ONLY. "
    "Do not include markdown, headings, explanations, or notes outside JSON. "
    "If any field cannot be justified, omit it rather than breaking JSON."),
                HumanMessage(content=prompt)
            ])

            raw_result = self._parse_response(response.content)

            logger.debug("🧠 Raw Risk Stratification LLM Output:")
            logger.debug(raw_result)

            # ✅ STORE RAW OUTPUT ONLY
            state["risk_stratification"] = raw_result

            # ✅ CONFIDENCE SCORE DIRECTLY FROM RAW OUTPUT
            state["confidence_scores"]["risk"] = raw_result.get("confidence_score", 0.5)

            # ✅ CHECK FLAGS DIRECTLY FROM RAW OUTPUT
            if raw_result.get("requires_immediate_action", False):
                state["warnings"].append(
                    "⚠️ IMMEDIATE ACTION REQUIRED - Critical risk identified"
                )
                state["requires_review"] = True

            # Optional: escalate based on overall risk level (raw)
            overall_level = (
                raw_result
                .get("overall_risk_category", {})
                .get("level", "")
                .lower()
            )

            if overall_level == "critical":
                state["requires_review"] = True

            logger.info("✅ Risk Stratification Agent: Analysis complete")

        except Exception as e:
            logger.error(f"❌ Risk Stratification Agent failed: {str(e)}")
            state["error"] = f"Risk stratification failed: {str(e)}"

        return state
    
    

    def _parse_response(self, content: str) -> dict:
        try:
            content = content.strip()

            # Case 1: Extract JSON inside ```json blocks
            if "```json" in content:
                json_part = content.split("```json", 1)[1]
                json_part = json_part.split("```", 1)[0]
                return json.loads(json_part.strip())

            # Case 2: Extract any {...} JSON (fallback)
            start = content.find("{")
            end = content.rfind("}")
            if start != -1 and end != -1:
                return json.loads(content[start:end + 1])

            raise ValueError("No JSON found")

        except Exception as e:
            logger.warning(f"⚠️ Risk Stratification JSON parse failed: {e}")
            return {
                "raw_content": content,
                "confidence_score": 0.5
            }


# =====================================================================
# AGENT 5: TREATMENT VALIDATION AGENT
# =====================================================================

class TreatmentValidationAgent:
    """
    Validates treatment appropriateness, safety, and alignment with
    evidence-based guidelines
    """
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
        
    def analyze(self, state: ClinicalReasoningState) -> ClinicalReasoningState:
        """Validate proposed treatment plan"""
    
        logger.info("💊 Treatment Validation Agent: Starting analysis")
        optimized_context = build_treatment_validation_context(state)
        consultation = state.get("consultation_text", "")
    
        prompt = f"""
    Treatment validation expert - evidence-based, safe, appropriate care.

    {optimized_context}

    PROPOSED TREATMENT:
    {consultation}

    VALIDATE ACROSS:
    1. GUIDELINE ALIGNMENT (WHO, AHA, NCCN, NICE, etc.)
       - Standard-of-care match? Deviations justified?

    2. TREATMENT APPROPRIATENESS
       Pharmacological: drug selection, dose (age/weight/renal/hepatic), frequency, route, first/second-line, cost
       Procedural: indication strength, timing, patient optimization, alternatives
       Non-pharmacological: evidence base, feasibility, compliance

    3. PROGNOSIS ALIGNMENT
       - Treatment matches prognostic category? Goal: curative/disease-modifying/palliative?

    4. RISK ALIGNMENT
       - Treatment risk acceptable given disease risk? Monitoring adequate?

    5. MISSING TREATMENTS
       - Standard treatments omitted? Additional therapies needed? Preventive measures adequate?

    6. OVER-TREATMENT
       - Unnecessarily aggressive? Cheaper/simpler alternatives? Polypharmacy concerns?

    7. SEQUENCE & COMBINATION
       - Treatment order logical? Combinations evidence-based? Synergistic/antagonistic?

    8. MONITORING ADEQUACY
       - Safety monitoring sufficient? Efficacy endpoints defined? Follow-up frequency appropriate?

    RULES:
    - Compare against latest guidelines
    - Consider patient-specific factors
    - Flag under-treatment AND over-treatment
    - Provide specific alternatives
    - Consider resource availability/cost

    CRITICAL OUTPUT RULES:
    - ALL string fields: Maximum 10 words unless marked [LONG]
    - Rationales: Maximum 15 words, focus on KEY reason only
    - Descriptions: Maximum 12 words, essential information only
    - Lists: Maximum 5 items unless critical
    - Use medical abbreviations: MI not "myocardial infarction"
    - Be telegraphic: "Pt has 3 high-risk factors" not "The patient presents with three significant risk factors"
    - NO preambles, NO explanations, DIRECT answers only
    - Example good: "HTN, DM, CKD increase CVD risk 3x"
    - Example bad: "The patient's hypertension, diabetes, and chronic kidney disease significantly increase their cardiovascular disease risk by approximately three times"
   
    1. You MUST ONLY use information explicitly present in the INPUT DATA below
    2. If a field is empty/missing, you MUST state "No data provided" 
    3. NEVER invent symptoms, lab values, imaging findings, or diagnoses
    4. If insufficient data exists, you MUST respond with limitations
    5. For "routine check-up" with no symptoms: Focus on health maintenance
    OUTPUT (JSON):
    {{
      "overall_validity": {{"status": "appropriate|questionable|inappropriate", "confidence": 0.0-1.0, "summary": "string"}},
      "guideline_alignment": {{
        "applicable_guidelines": ["string"],
        "alignment_score": 0.0-1.0,
        "deviations": [{{"deviation": "string", "justification": "acceptable|questionable|unjustified", "rationale": "string"}}]
      }},
      "treatment_appropriateness": {{
        "pharmacological": [{{"drug": "string", "appropriateness": "appropriate|questionable|inappropriate", "dose_validation": "correct|needs_adjustment|incorrect", "concerns": ["string"], "recommendations": ["string"]}}],
        "procedural": [{{"procedure": "string", "indication_strength": "strong|moderate|weak", "timing": "appropriate|suboptimal", "concerns": ["string"], "recommendations": ["string"]}}],
        "non_pharmacological": [{{"intervention": "string", "evidence_strength": "strong|moderate|weak", "appropriateness": "appropriate|questionable", "recommendations": ["string"]}}]
      }},
      "prognosis_treatment_alignment": {{"aligned": true|false, "treatment_intensity": "appropriate|too_aggressive|too_conservative", "rationale": "string", "recommendations": ["string"]}},
      "missing_standard_treatments": [{{"treatment": "string", "importance": "critical|important|beneficial", "rationale": "string"}}],
      "over_treatment_concerns": [{{"concern": "string", "severity": "major|moderate|minor", "alternative": "string"}}],
      "monitoring_adequacy": {{"adequate": true|false, "gaps": ["string"], "recommendations": ["string"]}},
      "alternative_approaches": [{{"approach": "string", "advantages": ["string"], "disadvantages": ["string"], "appropriateness": "preferred|equivalent|inferior"}}],
      "red_flags": ["string"],
      "requires_expert_review": true|false,
      "confidence_score": 0.0-1.0
    }}
    CRITICAL:
    Return ONLY valid JSON.
    No markdown.
    No bullets.
    No headings.
    No explanations.
    No text outside JSON.
    Start with {{ and end with }}.
    If you output anything else the system will crash.
    """
        
        try:
            response = self.llm.invoke([
                SystemMessage(content="You are an expert in treatment validation and evidence-based medicine."),
                HumanMessage(content=prompt)
            ])
            
            result = self._parse_response(response.content)
            state["treatment_validation"] = result
            state["confidence_scores"]["treatment"] = result.get("confidence_score", 0.0)
            
            # Check for serious concerns
            if result.get("overall_validity", {}).get("status") == "inappropriate":
                state["warnings"].append("⚠️ TREATMENT CONCERNS - Proposed treatment may be inappropriate")
                state["requires_review"] = True
            
            if result.get("requires_expert_review"):
                state["requires_review"] = True
            
            logger.info("✅ Treatment Validation Agent: Analysis complete")
            
        except Exception as e:
            logger.error(f"❌ Treatment Validation Agent failed: {str(e)}")
            state["error"] = f"Treatment validation failed: {str(e)}"
            
        return state
    
    def _parse_response(self, content: str) -> dict:
        try:
            content = content.strip()

            # Case 1: Extract JSON inside ```json blocks
            if "```json" in content:
                json_part = content.split("```json", 1)[1]
                json_part = json_part.split("```", 1)[0]
                return json.loads(json_part.strip())

            # Case 2: Extract any {...} JSON (fallback)
            start = content.find("{")
            end = content.rfind("}")
            if start != -1 and end != -1:
                return json.loads(content[start:end + 1])

            raise ValueError("No JSON found")

        except Exception as e:
            logger.warning(f"⚠️ Risk Stratification JSON parse failed: {e}")
            return {
                "raw_content": content,
                "confidence_score": 0.5
            }


# =====================================================================
# AGENT 6: CONTRAINDICATION CHECKER AGENT
# =====================================================================

class ContraindicationAgent:
    """
    Identifies contraindications, drug interactions, and safety concerns
    """
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
        
    def analyze(self, state: ClinicalReasoningState) -> ClinicalReasoningState:
        """Check for contraindications and safety issues"""
    
        logger.info("🛡️ Contraindication Agent: Starting analysis")
    
        consultation = state.get("consultation_text", "")
    
        prompt = f"""
    Medication safety and contraindication expert.

    PATIENT:
    Medical: {safe_json(state.get("medical_context", {}))}
    Clinical: {safe_json(state.get("clinical_context", {}))}

    PROPOSED TREATMENT:
    {safe_json(state.get("treatment_validation", {}))}
    {consultation}

    TASK: Identify ALL contraindications, interactions, safety concerns.

    CHECK:
    1. ABSOLUTE CONTRAINDICATIONS: conditions prohibiting treatment, allergies, pregnancy/lactation, organ failure, disease-specific

    2. RELATIVE CONTRAINDICATIONS: caution/dose adjustment needed, increased monitoring, risk-benefit analysis, specialist consult

    3. DRUG-DRUG INTERACTIONS
       For each medication vs current medications:
       Severity: contraindicated/major/moderate/minor
       Mechanism: pharmacokinetic/pharmacodynamic
       Management: avoid/adjust_dose/monitor/separate_timing/acceptable

    4. DRUG-DISEASE INTERACTIONS: how diseases affect drug safety, exacerbation risks

    5. DRUG-FOOD/SUPPLEMENT: restrictions, timing

    6. ORGAN FUNCTION
       Renal: dose adjustment for eGFR, nephrotoxicity, dialysis
       Hepatic: dose adjustment, hepatotoxicity, metabolism
       Cardiac: QT prolongation, HF exacerbation, arrhythmia

    7. AGE-RELATED
       Pediatric: age-appropriate dosing, development concerns
       Geriatric: Beers Criteria, falls risk, cognitive impact, polypharmacy

    8. PROCEDURE CONTRAINDICATIONS: bleeding risk, anesthesia, post-procedure restrictions

    9. PREGNANCY & LACTATION: FDA category, teratogenicity, breastfeeding safety, alternatives

    10. MONITORING FOR SAFETY: parameters, frequency, safety thresholds

    RULES:
    - Flag ALL safety concerns
    - Provide severity ratings
    - Suggest alternatives when contraindicated
    - Consider cumulative risk

    CRITICAL OUTPUT RULES:
    - ALL string fields: Maximum 10 words unless marked [LONG]
    - Rationales: Maximum 15 words, focus on KEY reason only
    - Descriptions: Maximum 12 words, essential information only
    - Lists: Maximum 5 items unless critical
    - Use medical abbreviations: MI not "myocardial infarction"
    - Be telegraphic: "Pt has 3 high-risk factors" not "The patient presents with three significant risk factors"
    - NO preambles, NO explanations, DIRECT answers only
    - Example good: "HTN, DM, CKD increase CVD risk 3x"
    - Example bad: "The patient's hypertension, diabetes, and chronic kidney disease significantly increase their cardiovascular disease risk by approximately three times"

    1. You MUST ONLY use information explicitly present in the INPUT DATA below
    2. If a field is empty/missing, you MUST state "No data provided" 
    3. NEVER invent symptoms, lab values, imaging findings, or diagnoses
    4. If insufficient data exists, you MUST respond with limitations
    5. For "routine check-up" with no symptoms: Focus on health maintenance
    OUTPUT (JSON):
    {{
      "critical_safety_alerts": [{{"alert": "string", "severity": "life_threatening|major|moderate|minor", "immediate_action": "string"}}],
      "absolute_contraindications": [{{"medication_or_procedure": "string", "contraindication": "string", "reason": "string", "alternative": "string"}}],
      "relative_contraindications": [{{"medication_or_procedure": "string", "concern": "string", "severity": "major|moderate|minor", "mitigation": "string", "proceed": "with_caution|avoid|consult_specialist"}}],
      "drug_interactions": [{{"drug_1": "string", "drug_2": "string", "interaction_severity": "contraindicated|major|moderate|minor", "mechanism": "string", "clinical_effect": "string", "management": "avoid|adjust_dose|monitor|separate_timing|acceptable", "monitoring_required": ["string"]}}],
      "drug_disease_interactions": [{{"drug": "string", "disease": "string", "concern": "string", "severity": "major|moderate|minor", "recommendation": "string"}}],
      "organ_dysfunction_concerns": {{
        "renal": [{{"drug": "string", "concern": "string", "dose_adjustment": "string", "monitoring": ["string"]}}],
        "hepatic": [{{"drug": "string", "concern": "string", "dose_adjustment": "string", "monitoring": ["string"]}}],
        "cardiac": [{{"drug": "string", "concern": "string", "recommendation": "string"}}]
      }},
      "special_populations": {{
        "geriatric_concerns": ["string"],
        "pregnancy_safety": [{{"drug": "string", "category": "string", "risk": "string", "alternative": "string"}}]
      }},
      "monitoring_requirements": [{{"parameter": "string", "frequency": "string", "safety_threshold": "string", "action_if_abnormal": "string"}}],
      "overall_safety_assessment": {{
        "safe_to_proceed": true|false,
        "conditions_for_safety": ["string"],
        "requires_specialist_consultation": true|false
      }},
      "confidence_score": 0.0-1.0
    }}
    """
        
        try:
            response = self.llm.invoke([
                SystemMessage(content="You are an expert in medication safety and contraindication identification."),
                HumanMessage(content=prompt)
            ])
            
            result = self._parse_response(response.content)
            state["contraindication_check"] = result
            state["confidence_scores"]["contraindications"] = result.get("confidence_score", 0.0)
            
            # Check for critical alerts
            critical_alerts = result.get("critical_safety_alerts", [])
            for alert in critical_alerts:
                if alert.get("severity") in ["life_threatening", "major"]:
                    state["warnings"].append(f"🚨 CRITICAL SAFETY ALERT: {alert.get('alert')}")
                    state["requires_review"] = True
            
            if not result.get("overall_safety_assessment", {}).get("safe_to_proceed", True):
                state["requires_review"] = True
            
            logger.info("✅ Contraindication Agent: Analysis complete")
            
        except Exception as e:
            logger.error(f"❌ Contraindication Agent failed: {str(e)}")
            state["error"] = f"Contraindication check failed: {str(e)}"
            
        return state
    
    def _parse_response(self, content: str) -> dict:
        try:
            content = content.strip()

            # Case 1: Extract JSON inside ```json blocks
            if "```json" in content:
                json_part = content.split("```json", 1)[1]
                json_part = json_part.split("```", 1)[0]
                return json.loads(json_part.strip())

            # Case 2: Extract any {...} JSON (fallback)
            start = content.find("{")
            end = content.rfind("}")
            if start != -1 and end != -1:
                return json.loads(content[start:end + 1])

            raise ValueError("No JSON found")

        except Exception as e:
            logger.warning(f"⚠️ Risk Stratification JSON parse failed: {e}")
            return {
                "raw_content": content,
                "confidence_score": 0.5
            }


# =====================================================================
# AGENT 7: OUTCOME REASONING & DECISION SUPPORT AGENT
# =====================================================================

class OutcomeReasoningAgent:
    """
    Synthesizes all analyses to provide final clinical decision support
    """
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
        
    def analyze(self, state: ClinicalReasoningState) -> ClinicalReasoningState:
        """Synthesize final recommendation"""
    
        logger.info("🎯 Outcome Reasoning Agent: Starting synthesis")
    
        prompt = f"""
    Senior clinical decision support - synthesizing complex analyses.

    ALL ANALYSES:
    Disease: {safe_json(state.get("disease_causation", {}))}
    Staging: {safe_json(state.get("staging_analysis", {}))}
    Prognosis: {safe_json(state.get("prognosis_factors", {}))}
    Risk: {safe_json(state.get("risk_stratification", {}))}
    Treatment: {safe_json(state.get("treatment_validation", {}))}
    Contraindications: {safe_json(state.get("contraindication_check", {}))}

    PROVIDE:
    1. EXECUTIVE SUMMARY: patient status (2-3 sentences), key problem, urgency, trajectory

    2. DIAGNOSTIC CERTAINTY: confidence, differential diagnoses, confirmatory tests

    3. TREATMENT RECOMMENDATIONS
       Stratified: MUST DO / SHOULD DO / CONSIDER / AVOID
       Timeline: immediate (24hr) / short-term (week) / medium-term (month) / long-term

    4. SAFETY PRIORITIES: critical concerns, monitoring priorities, red flags, escalation triggers

    5. OUTCOME OPTIMIZATION: modifiable factors, highest-yield interventions, priority sequence, impact timeline

    6. PATIENT-CENTERED: treatment burden, QOL impact, shared decision points, preference sensitivity

    7. FOLLOW-UP: when to reassess, parameters to track, success/failure criteria, reassessment triggers

    8. CONSULTATION NEEDS: specialists needed, urgency, specific questions

    9. CONFLICTS & RESOLUTIONS: conflicts between analyses, resolution, rationale

    10. EVIDENCE CONFIDENCE: overall confidence, high/low certainty areas, knowledge gaps

    RULES:
    - Integrate ALL agent analyses
    - Resolve conflicts between analyses
    - Safety prioritized
    - Specific and actionable
    - Flag high-risk decisions
    - Balance evidence with judgment

    CRITICAL OUTPUT RULES:
    - ALL string fields: Maximum 10 words unless marked [LONG]
    - Rationales: Maximum 15 words, focus on KEY reason only
    - Descriptions: Maximum 12 words, essential information only
    - Lists: Maximum 5 items unless critical
    - Use medical abbreviations: MI not "myocardial infarction"
    - Be telegraphic: "Pt has 3 high-risk factors" not "The patient presents with three significant risk factors"
    - NO preambles, NO explanations, DIRECT answers only
    - Example good: "HTN, DM, CKD increase CVD risk 3x"
    - Example bad: "The patient's hypertension, diabetes, and chronic kidney disease significantly increase their cardiovascular disease risk by approximately three times"

    1. You MUST ONLY use information explicitly present in the INPUT DATA below
    2. If a field is empty/missing, you MUST state "No data provided" 
    3. NEVER invent symptoms, lab values, imaging findings, or diagnoses
    4. If insufficient data exists, you MUST respond with limitations
    5. For "routine check-up" with no symptoms: Focus on health maintenance
    OUTPUT (JSON):
    {{
      "executive_summary": {{"patient_status": "string", "key_problem": "string", "urgency": "emergent|urgent|semi_urgent|routine", "trajectory": "improving|stable|deteriorating|critical"}},
      "diagnostic_confidence": {{"primary_diagnosis": "string", "confidence": 0.0-1.0, "differential_diagnoses": ["string"], "confirmatory_tests_needed": ["string"]}},
      "treatment_recommendations": {{
        "immediate_actions": [{{"action": "string", "rationale": "string", "priority": 1-10, "evidence_strength": "strong|moderate|weak|expert_opinion"}}],
        "short_term_plan": ["string"],
        "medium_term_plan": ["string"],
        "long_term_strategy": ["string"],
        "must_do": ["string"],
        "should_do": ["string"],
        "consider": ["string"],
        "avoid": ["string"]
      }},
      "safety_priorities": {{
        "critical_concerns": ["string"],
        "monitoring_priorities": [{{"parameter": "string", "frequency": "string", "action_threshold": "string"}}],
        "red_flags": ["string"],
        "escalation_triggers": ["string"]
      }},
      "outcome_optimization": {{
        "highest_yield_interventions": [{{"intervention": "string", "expected_benefit": "string", "feasibility": "easy|moderate|difficult", "timeline": "string", "priority": 1-10}}],
        "modifiable_factors": ["string"],
        "intervention_sequence": ["string"]
      }},
      "patient_centered_factors": {{
        "treatment_burden": "low|moderate|high",
        "quality_of_life_impact": "minimal|moderate|significant",
        "shared_decision_points": ["string"],
        "patient_preferences_needed": ["string"]
      }},
      "follow_up_strategy": {{
        "next_assessment": "string",
        "parameters_to_track": ["string"],
        "success_criteria": ["string"],
        "failure_criteria": ["string"],
        "reassessment_triggers": ["string"]
      }},
      "consultation_needs": [{{"specialty": "string", "urgency": "emergent|urgent|routine", "specific_questions": ["string"]}}],
      "conflicts_and_resolutions": [{{"conflict": "string", "resolution": "string", "rationale": "string"}}],
      "evidence_confidence": {{
        "overall_confidence": 0.0-1.0,
        "high_certainty_areas": ["string"],
        "uncertainty_areas": ["string"],
        "knowledge_gaps": ["string"]
      }},
      "requires_human_review": true|false,
      "review_rationale": "string"
    }}
    """
        
        try:
            response = self.llm.invoke([
                SystemMessage(content="You are a senior clinical decision support specialist providing final integrated recommendations."),
                HumanMessage(content=prompt)
            ])
            
            result = self._parse_response(response.content)
            state["outcome_prediction"] = result
            state["final_recommendation"] = result
            state["confidence_scores"]["final"] = result.get("evidence_confidence", {}).get("overall_confidence", 0.0)
            
            # Check if human review required
            if result.get("requires_human_review"):
                state["requires_review"] = True
            
            if result.get("executive_summary", {}).get("urgency") in ["emergent", "urgent"]:
                state["warnings"].append("⚠️ URGENT ATTENTION REQUIRED")
            
            logger.info("✅ Outcome Reasoning Agent: Synthesis complete")
            
        except Exception as e:
            logger.error(f"❌ Outcome Reasoning Agent failed: {str(e)}")
            state["error"] = f"Outcome reasoning failed: {str(e)}"
            
        return state
    
    def _parse_response(self, content: str) -> dict:
        try:
            content = content.strip()

            # Case 1: Extract JSON inside ```json blocks
            if "```json" in content:
                json_part = content.split("```json", 1)[1]
                json_part = json_part.split("```", 1)[0]
                return json.loads(json_part.strip())

            # Case 2: Extract any {...} JSON (fallback)
            start = content.find("{")
            end = content.rfind("}")
            if start != -1 and end != -1:
                return json.loads(content[start:end + 1])

            raise ValueError("No JSON found")

        except Exception as e:
            logger.warning(f"⚠️ Risk Stratification JSON parse failed: {e}")
            return {
                "raw_content": content,
                "confidence_score": 0.5
            }










"""
Critical Clinical Agents for Enhanced Clinical Decision Support new abi
================================================================

7 Essential Agents:
1. Differential Diagnosis Agent - Core diagnostic reasoning
2. Medication Reconciliation Agent - Patient safety critical
3. Guideline Compliance Agent - Medicolegal + quality
4. Clinical Deterioration Warning Agent - Prevents adverse events
5. Diagnostic Test Appropriateness Agent - Cost + safety
6. Comorbidity Interaction Agent - Real-world complexity
7. Discharge Readiness Agent - Readmission prevention

"""




def safe_json(data):
    """Safely JSON-serialize objects"""
    return json.dumps(data, indent=2, default=str)





# =====================================================================
# AGENT 8: DIFFERENTIAL DIAGNOSIS AGENT ⭐ CRITICAL
# =====================================================================

class DifferentialDiagnosisAgent:
    """
    Generates comprehensive differential diagnoses with probability ranking
    
    CRITICAL IMPORTANCE:
    - Prevents diagnostic anchoring bias
    - Ensures rare diagnoses aren't missed
    - Provides structured diagnostic reasoning
    - Most common cause of medical errors is failure to consider alternatives
    
    PLACEMENT: Execute EARLY in workflow (right after RAG retrieval)
    """
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
        
    def analyze(self, state: dict) -> dict:
        """Generate differential diagnoses with probability ranking"""
        optimized_context = build_oncology_differential_context(state)
        logger.info("🔍 Differential Diagnosis Agent: Starting analysis")
    
        medical = state.get("medical_context", {}) or {}
        specialty = medical.get("speciality", [])

        prompt = f"""
        You are a senior clinical diagnostician performing differential diagnosis.

        SPECIALTY CONTEXT: {specialty}

        INPUT DATA:
        {state.get("consultation_text", "")}

        REFERENCE CLINICAL CONTEXT:
        {optimized_context}

        YOUR TASK
        Generate a structured differential diagnosis using ONLY the information provided.

        CRITICAL SAFETY RULES

        1. Use ONLY information explicitly present in the input data.
        2. NEVER invent symptoms, lab results, imaging findings, or diagnoses.
        3. If a required field is missing, state "No data provided".
        4. If insufficient data exists for reasoning, state diagnostic limitations.
        5. Do NOT assign probability to diagnoses already confirmed.

        CONFIRMED DIAGNOSIS RULE

        If a condition is confirmed by:
        - pathology
        - biopsy
        - surgical report
        - definitive imaging

        Then:
        - Mark it as established.
        - Do NOT include it in differential diagnosis lists.

        SPECIALTY FILTER RULE

        Focus ONLY on diagnoses relevant to the specialty: {specialty}

        If a finding belongs to another specialty:
        Do NOT diagnose it. Instead recommend referral.

        Example:
        Trivial aortic regurgitation → cardiology referral.

        INCIDENTAL FINDING RULE

        Common incidental findings should NOT appear in differential diagnosis.

        Examples include:
        - fatty liver
        - renal cortical cyst
        - diverticulosis
        - umbilical hernia
        - benign prostate enlargement

        Include them ONLY if they directly affect the specialty decision.

        ONCOLOGY RULE (only when specialty = oncology)

        If malignancy exists or suspected:

        Focus on:
        - tumor staging
        - local invasion
        - regional lymph nodes
        - metastatic disease
        - treatment complications
        - secondary malignancies

        Do NOT re-diagnose the already confirmed cancer.

        DIAGNOSTIC REASONING REQUIREMENTS

        Use:
        - symptom pattern recognition
        - epidemiology
        - risk factors
        - imaging findings
        - laboratory findings

        Avoid:
        - anchoring bias
        - confirmation bias
        - availability bias

        INVESTIGATION PRIORITIZATION RULE

        Recommended investigations must follow this order:

        1. Rule-out tests for MUST-NOT-MISS diagnoses
        2. Confirmation tests for MOST-LIKELY diagnoses
        3. Tests differentiating competing diagnoses
        4. Staging investigations if malignancy suspected
        5. Routine tests last

        URGENT INVESTIGATIONS
        Include ONLY tests needed to rule out life-threatening conditions.

        RECOMMENDED INVESTIGATION SEQUENCE
        Tests confirming or differentiating the leading diagnoses.

        OUTPATIENT TESTS
        Lower priority investigations that can safely wait.

        DIAGNOSTIC CATEGORIES

        1 MUST-NOT-MISS
        Life-threatening diagnoses supported by the data.

        2 MOST LIKELY
        High probability diagnoses supported by symptoms, labs, imaging.

        3 SERIOUS TO CONSIDER
        Moderate probability diagnoses needing rule-out.

        4 POSSIBLE
        Lower probability diagnoses supported by limited evidence.

        5 UNLIKELY BUT DOCUMENTED
        Considered but excluded.

        OUTPUT STYLE RULES

        - All string fields maximum 10 words
        - Rationales maximum 15 words
        - Lists maximum 5 items
        - Use medical abbreviations where appropriate
        - Use telegraphic clinical style

        GOOD EXAMPLE:
        "HTN, DM, smoking increase CAD risk"

        BAD EXAMPLE:
        "The patient's hypertension, diabetes, and smoking significantly increase risk."

        OUTPUT FORMAT (STRICT JSON)

        {{
        "must_not_miss_diagnoses":[{{
        "diagnosis":"string",
        "probability":0-100,
        "severity":"life_threatening|serious|moderate",
        "reasoning":"string",
        "key_features_present":["string"],
        "key_features_absent":["string"],
        "recommended_rule_out_tests":["string"],
        "urgency":"immediate|urgent|routine"
        }}],

        "most_likely_diagnoses":[{{
        "diagnosis":"string",
        "probability":0-100,
        "confidence":"high|moderate|low",
        "supporting_evidence":["string"],
        "contradicting_evidence":["string"],
        "diagnostic_criteria_met":"string",
        "next_steps_to_confirm":["string"]
        }}],

        "serious_considerations":[{{
        "diagnosis":"string",
        "probability":0-100,
        "why_considered":"string",
        "how_to_differentiate":"string"
        }}],

        "possible_diagnoses":[{{
        "diagnosis":"string",
        "probability":0-100,
        "rationale":"string",
        "would_be_supported_by":["string"]
        }}],

        "unlikely_but_considered":[{{
        "diagnosis":"string",
        "probability":0-100,
        "why_unlikely":"string",
        "what_would_make_more_likely":"string"
        }}],

        "discriminating_features":{{
        "top_differential_comparison":[{{
        "diagnosis_1":"string",
        "diagnosis_2":"string",
        "key_distinguishing_features":["string"],
        "gold_standard_test_to_differentiate":"string"
        }}]
        }},

        "diagnostic_strategy":{{
        "recommended_investigation_sequence":[{{
        "step":1,
        "test_or_action":"string",
        "rationale":"string",
        "expected_impact_on_differential":"string"
        }}],
        "urgent_investigations":["string"],
        "can_wait_for_outpatient":["string"]
        }},

        "diagnostic_uncertainty_factors":["string"],
        "red_flags_for_reconsidering":["string"],
        "overall_diagnostic_confidence":0.0,
        "requires_specialist_input":false,
        "recommended_specialist":null
        }}

        CRITICAL OUTPUT RULES

        Return ONLY valid JSON.
        No markdown.
        No explanations.
        No commentary.
        No text outside JSON.

        Start response with {{
        End response with }}

        If output is not valid JSON the system will crash.
        """
        
        try:
            response = self.llm.invoke([
                SystemMessage(content="You are an expert diagnostician preventing diagnostic errors through comprehensive differential diagnosis."),
                HumanMessage(content=prompt)
            ])
            
            result = self._parse_response(response.content)
            logger.debug("🧠 Raw Risk Stratification LLM Output:")
            logger.debug(response.content)
            state["differential_diagnosis"] = result
            
            # Set confidence score
            state["confidence_scores"]["differential_diagnosis"] = result.get("overall_diagnostic_confidence", 0.0)
            
            # Add warnings for must-not-miss diagnoses
            must_not_miss = result.get("must_not_miss_diagnoses", [])
            for diagnosis in must_not_miss:
                if diagnosis.get("urgency") == "immediate" and diagnosis.get("probability", 0) > 5:
                    state["warnings"].append(
                        f"⚠️ MUST-NOT-MISS: {diagnosis['diagnosis']} - {diagnosis['reasoning']}"
                    )
            
            # Flag if specialist needed
            if result.get("requires_specialist_input"):
                state["requires_review"] = True
                specialist = result.get("recommended_specialist")
                if specialist:
                    state["warnings"].append(f"🔔 Specialist consultation recommended: {specialist}")
            
            logger.info("✅ Differential Diagnosis Agent: Analysis complete")
            
        except Exception as e:
            logger.error(f"❌ Differential Diagnosis Agent failed: {str(e)}")
            state["error"] = f"Differential diagnosis generation failed: {str(e)}"
        
        return state
    
    def _parse_response(self, content: str) -> dict:
        """Parse LLM response to JSON"""
        try:
            content = content.strip()
            
            # Extract JSON from markdown code blocks
            if "```json" in content:
                json_part = content.split("```json", 1)[1]
                json_part = json_part.split("```", 1)[0]
                return json.loads(json_part.strip())
            
            # Extract any {...} JSON
            start = content.find("{")
            end = content.rfind("}")
            if start != -1 and end != -1:
                return json.loads(content[start:end + 1])
            
            raise ValueError("No JSON found in response")
            
        except Exception as e:
            logger.warning(f"⚠️ Differential Diagnosis JSON parse failed: {e}")
            return {
                "raw_content": content,
                "overall_diagnostic_confidence": 0.5
            }


# =====================================================================
# AGENT 9: MEDICATION RECONCILIATION AGENT ⭐ CRITICAL
# =====================================================================

class MedicationReconciliationAgent:
    """
    Comprehensive medication review and reconciliation
    
    CRITICAL IMPORTANCE:
    - #1 cause of preventable adverse events
    - Required for hospital accreditation (Joint Commission)
    - Transitions of care safety
    - Polypharmacy in elderly patients
    
    PLACEMENT: Execute BEFORE treatment validation
    """
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
    
    def analyze(self, state: dict) -> dict:
        """Perform comprehensive medication reconciliation"""
    
        logger.info("💊 Medication Reconciliation Agent: Starting analysis")
    
        prompt = f"""
    Medication safety expert - comprehensive reconciliation to prevent adverse drug events.

    CURRENT MEDICATIONS:
    {safe_json(state.get("medical_context", {}).get("medications", []))}

    PROPOSED:
    {state.get("consultation_text", "")}
    {safe_json(state.get("treatment_validation", {}))}

    PATIENT:
    Age: {state.get("clinical_context", {}).get("patient_age", "unknown")}
    Renal: {state.get("medical_context", {}).get("renal_function", "unknown")}
    Hepatic: {state.get("medical_context", {}).get("hepatic_function", "unknown")}
    Allergies: {state.get("medical_context", {}).get("allergies", [])}
    Comorbidities: {state.get("clinical_context", {}).get("active_diagnoses", [])}

    PERFORM:
    1. COMPLETE MEDICATION LIST
       - All current (home + hospital)
       - Dose, frequency, route
       - Start dates, indications
       - Missing history
       - OTC/supplements
       - Recently discontinued

    2. DUPLICATE THERAPY
       - Two NSAIDs, multiple anticoagulants
       - Same drug different brands
       - Therapeutic duplicates (e.g., two statins)
       Severity + recommendation

    3. THERAPEUTIC REDUNDANCIES
       - Multiple drugs for same indication when one sufficient

    4. APPROPRIATENESS
       Using: Beers Criteria (elderly), STOPP/START
       - Indication still present?
       - Dose appropriate for patient?
       - Safer alternative?
       - Duration appropriate?

    5. DEPRESCRIBING OPPORTUNITIES
       Stop/reduce/replace:
       - No longer indicated
       - Excessive dose
       - Safer alternative
       - Cheaper alternative
       Priority: benzodiazepines, anticholinergics, NSAIDs, PPIs (long-term), antipsychotics

    6. POLYPHARMACY
       - Total count
       - Category: 5+ polypharmacy, 10+ hyperpolypharmacy
       - Medication burden index
       - Simplification opportunities
       - Adherence concerns

    7. SAFETY ISSUES
       - High-alert medications
       - LASA (look-alike, sound-alike)
       - Monitoring required/missing

    8. COST OPTIMIZATION
       - Generic alternatives
       - Therapeutic substitutions
       - Insurance coverage issues

    9. TRANSITIONS OF CARE
       Home → Hospital → Discharge
       - Continue/stop/adjust/new

    10. ADHERENCE
        - Regimen complexity
        - Dosing frequency
        - Cost barriers
        - Administration challenges

    RULES:
    - Evidence-based deprescribing guidelines
    - Beers Criteria for ≥65 years
    - Check renal/hepatic dosing
    - High-risk combinations
    - Patient-specific factors

    CRITICAL OUTPUT RULES:
    - ALL string fields: Maximum 10 words unless marked [LONG]
    - Rationales: Maximum 15 words, focus on KEY reason only
    - Descriptions: Maximum 12 words, essential information only
    - Lists: Maximum 5 items unless critical
    - Use medical abbreviations: MI not "myocardial infarction"
    - Be telegraphic: "Pt has 3 high-risk factors" not "The patient presents with three significant risk factors"
    - NO preambles, NO explanations, DIRECT answers only
    - Example good: "HTN, DM, CKD increase CVD risk 3x"
    - Example bad: "The patient's hypertension, diabetes, and chronic kidney disease significantly increase their cardiovascular disease risk by approximately three times"

    1. You MUST ONLY use information explicitly present in the INPUT DATA below
    2. If a field is empty/missing, you MUST state "No data provided" 
    3. NEVER invent symptoms, lab values, imaging findings, or diagnoses
    4. If insufficient data exists, you MUST respond with limitations
    5. For "routine check-up" with no symptoms: Focus on health maintenance
    OUTPUT (JSON):
    {{
      "reconciled_medication_list": [{{
        "medication": "string",
        "dose": "string",
        "frequency": "string",
        "route": "string",
        "indication": "string",
        "start_date": "string",
        "status": "continue|discontinue|modify|unclear",
        "appropriateness": "appropriate|questionable|inappropriate",
        "concerns": ["string"]
      }}],
      "duplicate_therapy_issues": [{{
        "medications": ["string"],
        "duplication_type": "identical|therapeutic_duplicate|same_class",
        "severity": "critical|major|moderate|minor",
        "recommendation": "string",
        "action": "discontinue_one|adjust_both|acceptable_if_justified"
      }}],
      "therapeutic_redundancies": [{{
        "medications": ["string"],
        "indication": "string",
        "issue": "string",
        "recommendation": "string"
      }}],
      "inappropriate_medications": [{{
        "medication": "string",
        "issue": "string",
        "criteria": "Beers|STOPP|dose_too_high|no_indication|duration_too_long",
        "severity": "high|moderate|low",
        "recommendation": "string",
        "safer_alternative": "string or null"
      }}],
      "deprescribing_opportunities": [{{
        "medication": "string",
        "rationale": "string",
        "priority": "high|medium|low",
        "action": "stop|reduce_dose|switch_to_alternative",
        "alternative": "string or null",
        "expected_benefit": "string",
        "deprescribing_protocol": "string"
      }}],
      "polypharmacy_assessment": {{
        "total_medication_count": 0,
        "polypharmacy_category": "none|polypharmacy|hyperpolypharmacy",
        "medication_burden_index": 0.0,
        "complexity_score": "low|moderate|high|very_high",
        "adherence_risk": "low|moderate|high",
        "simplification_opportunities": ["string"]
      }},
      "medications_requiring_monitoring": [{{
        "medication": "string",
        "monitoring_required": ["string"],
        "frequency": "string",
        "current_monitoring_status": "adequate|inadequate|missing"
      }}],
      "high_alert_medications": [{{
        "medication": "string",
        "risk": "string",
        "special_precautions": ["string"]
      }}],
      "cost_optimization": [{{
        "current_medication": "string",
        "generic_available": true|false,
        "therapeutic_alternative": "string or null",
        "estimated_cost_savings": "string",
        "clinical_equivalence": "equivalent|inferior|superior"
      }}],
      "transition_of_care_plan": {{
        "continue_unchanged": ["string"],
        "discontinue": [{{"medication": "string", "reason": "string"}}],
        "modify": [{{"medication": "string", "current": "string", "new": "string", "reason": "string"}}],
        "new_medications": ["string"]
      }},
      "adherence_optimization": {{
        "regimen_complexity": "simple|moderate|complex|very_complex",
        "simplification_recommendations": ["string"],
        "dosing_frequency_optimization": ["string"],
        "administration_concerns": ["string"]
      }},
      "critical_safety_alerts": ["string"],
      "pharmacist_review_recommended": true|false,
      "overall_medication_safety_score": 0.0-1.0,
      "confidence_score": 0.0-1.0
    }}
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL OUTPUT CONTRACT — STRICT JSON

Return ONLY the JSON object above.

Do NOT output:
- explanations
- summaries
- markdown
- bullets
- notes
- code fences
- any text before or after JSON

Requirements:
- First character MUST be {{
- Last character MUST be }}
- Must exactly match the schema keys above
- Include ALL nested fields
- Do NOT omit any field
- Use [] or null if empty
- Must parse with python json.loads()
- No trailing commas
- No comments

If anything other than valid JSON is returned, the response is INVALID.

JSON ONLY. NO WORDS.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    """        
        try:
            response = self.llm.invoke([
                SystemMessage(content="You are a medication safety expert performing comprehensive medication reconciliation."),
                HumanMessage(content=prompt)
            ])
            
            result = self._parse_response(response.content)
            state["medication_reconciliation"] = result
            
            # Set confidence score
            state["confidence_scores"]["medication_reconciliation"] = result.get("confidence_score", 0.0)
            
            # Add critical safety alerts to warnings
            critical_alerts = result.get("critical_safety_alerts", [])
            for alert in critical_alerts:
                state["warnings"].append(f"💊 MEDICATION SAFETY: {alert}")
            
            # Flag for pharmacist review if needed
            if result.get("pharmacist_review_recommended"):
                state["requires_review"] = True
                state["warnings"].append("🔔 Pharmacist review recommended for medication reconciliation")
            
            # Flag high-risk polypharmacy
            polypharm = result.get("polypharmacy_assessment", {})
            if polypharm.get("polypharmacy_category") == "hyperpolypharmacy":
                state["warnings"].append("⚠️ HYPERPOLYPHARMACY DETECTED - Deprescribing review needed")
            
            logger.info("✅ Medication Reconciliation Agent: Analysis complete")
            
        except Exception as e:
            logger.error(f"❌ Medication Reconciliation Agent failed: {str(e)}")
            state["error"] = f"Medication reconciliation failed: {str(e)}"
        
        return state
    
    def _parse_response(self, content: str) -> dict:
        """Parse LLM response to JSON"""
        try:
            content = content.strip()
            
            if "```json" in content:
                json_part = content.split("```json", 1)[1]
                json_part = json_part.split("```", 1)[0]
                return json.loads(json_part.strip())
            
            start = content.find("{")
            end = content.rfind("}")
            if start != -1 and end != -1:
                return json.loads(content[start:end + 1])
            
            raise ValueError("No JSON found in response")
            
        except Exception as e:
            logger.warning(f"⚠️ Medication Reconciliation JSON parse failed: {e}")
            return {
                "raw_content": content,
                "confidence_score": 0.5
            }


# =====================================================================
# AGENT 10: GUIDELINE COMPLIANCE AGENT ⭐ CRITICAL
# =====================================================================

class GuidelineComplianceAgent:
    """
    Checks adherence to clinical practice guidelines
    
    CRITICAL IMPORTANCE:
    - Medicolegal protection (standard of care)
    - Quality metrics / performance evaluation
    - Insurance approval / reimbursement
    - Best practice adherence
    
    PLACEMENT: Execute AFTER treatment validation
    """
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
    
    def analyze(self, state: dict) -> dict:
        """Check guideline compliance"""
    
        logger.info("📋 Guideline Compliance Agent: Starting analysis")
        optimized_context = build_guideline_context(state)
    
        prompt = f"""
    Clinical guidelines expert - standard of care compliance for medicolegal protection and quality.

    {optimized_context}

    TASK:
    EVALUATE: Adherence to evidence-based guidelines.

    MAJOR GUIDELINE ORGANIZATIONS:
    Oncology: NCCN, ASCO, ESMO
    Cardiology: ACC/AHA, ESC, CHEST
    Infectious: IDSA, CDC, WHO, Sepsis-3
    Pulmonology: GOLD (COPD), GINA (Asthma), BTS/SIGN
    Nephrology: KDIGO, NKF
    Diabetes/Endocrine: ADA, AACE
    GI/Hepatology: AASLD, ACG
    Neurology: AAN, ASA/AHA (Stroke)
    Critical Care: Surviving Sepsis, SCCM
    General: NICE, UpToDate, Cochrane

    ANALYZE:
    1. APPLICABLE GUIDELINES
       - Which apply? Version/year
       - Recommendation strength: Class I/IIa/IIb/III
       - Evidence level: A/B/C

    2. ADHERENCE ASSESSMENT
       Class I (Must Do): all followed? Deviations documented/justified?
       Class IIa (Should Do): followed? Justification if not
       Class IIb (May Consider): noted if considered
       Class III (Must NOT Do): ensure NOT done, flag if present

    3. DEVIATIONS
       For each:
       - Specific recommendation not followed
       - Reason (if documented)
       - Justified? (patient-specific factors, resources)
       - Medicolegal risk: high/moderate/low
       - Documentation needed

    4. MISSING INTERVENTIONS
       - Should be done but not proposed
       - Priority level
       - Impact on outcome
       - Medicolegal risk if omitted

    5. QUALITY METRICS
       Joint Commission Core, HEDIS, CMS, specialty-specific
       - Compliance status
       - Current performance
       - Documentation requirements

    6. EVIDENCE STRENGTH
       - High-quality evidence support?
       - RCT data? Meta-analyses?
       - Expert opinion only?
       - Off-label use?

    7. REIMBURSEMENT
       - Insurance likely to cover?
       - Prior authorization required?
       - Medical necessity documentation
       - Alternative covered treatments

    8. DOCUMENTATION
       - Required for guideline compliance
       - Informed consent requirements
       - Shared decision-making
       - Deviation justification

    9. MEDICOLEGAL RISK
       - Overall: low/moderate/high/very_high
       - Specific vulnerabilities
       - Protective documentation
       - Consultation requirements

    RULES:
    - MOST RECENT guideline versions
    - Flag ALL Class I deviations
    - Consider patient-specific factors justifying deviations
    - Document WHY guidelines don't apply if they don't
    - Balance guideline adherence with individualized care

    CRITICAL OUTPUT RULES:
    - ALL string fields: Maximum 10 words unless marked [LONG]
    - Rationales: Maximum 15 words, focus on KEY reason only
    - Descriptions: Maximum 12 words, essential information only
    - Lists: Maximum 5 items unless critical
    - Use medical abbreviations: MI not "myocardial infarction"
    - Be telegraphic: "Pt has 3 high-risk factors" not "The patient presents with three significant risk factors"
    - NO preambles, NO explanations, DIRECT answers only
    - Example good: "HTN, DM, CKD increase CVD risk 3x"
    - Example bad: "The patient's hypertension, diabetes, and chronic kidney disease significantly increase their cardiovascular disease risk by approximately three times"

    1. You MUST ONLY use information explicitly present in the INPUT DATA below
    2. If a field is empty/missing, you MUST state "No data provided" 
    3. NEVER invent symptoms, lab values, imaging findings, or diagnoses
    4. If insufficient data exists, you MUST respond with limitations
    5. For "routine check-up" with no symptoms: Focus on health maintenance
    OUTPUT (JSON):
    {{
      "applicable_guidelines": [{{
        "guideline": "string (e.g., NCCN Breast Cancer v3.2024)",
        "organization": "string",
        "version": "string",
        "year": "string",
        "relevance": "primary|secondary",
        "url": "string or null"
      }}],
      "guideline_adherence_summary": {{
        "overall_compliance_score": 0.0-1.0,
        "class_1_compliance": 0.0-1.0,
        "class_2a_compliance": 0.0-1.0,
        "overall_assessment": "fully_compliant|mostly_compliant|partially_compliant|non_compliant"
      }},
      "class_1_recommendations": [{{
        "recommendation": "string",
        "guideline": "string",
        "evidence_level": "A|B|C",
        "status": "followed|not_followed|not_applicable",
        "rationale": "string"
      }}],
      "deviations_from_guidelines": [{{
        "guideline_recommendation": "string",
        "guideline": "string",
        "recommendation_class": "I|IIa|IIb|III",
        "deviation_type": "omission|commission|modification",
        "actual_practice": "string",
        "justification": "string",
        "justification_strength": "strong|moderate|weak|unjustified",
        "medicolegal_risk": "high|moderate|low",
        "requires_documentation": true|false,
        "documentation_elements": ["string"]
      }}],
      "missing_recommended_interventions": [{{
        "intervention": "string",
        "guideline": "string",
        "recommendation_class": "I|IIa|IIb",
        "priority": "critical|high|moderate|low",
        "expected_benefit": "string",
        "reason_not_done": "string or unknown",
        "should_be_added": true|false,
        "medicolegal_risk_if_omitted": "high|moderate|low"
      }}],
      "quality_metrics_compliance": [{{
        "metric": "string",
        "organization": "string",
        "status": "met|not_met|not_applicable",
        "current_value": "string or null",
        "target_value": "string",
        "documentation_complete": true|false
      }}],
      "evidence_strength_assessment": {{
        "overall_evidence_quality": "high|moderate|low|very_low",
        "rct_support": true|false,
        "meta_analysis_support": true|false,
        "off_label_use": true|false,
        "experimental_therapy": true|false,
        "evidence_summary": "string"
      }},
      "reimbursement_considerations": {{
        "likely_covered": true|false|uncertain,
        "prior_authorization_required": true|false,
        "medical_necessity_documentation": ["string"],
        "alternative_covered_options": ["string"]
      }},
      "documentation_requirements": {{
        "required_documentation": ["string"],
        "informed_consent_needed": true|false,
        "shared_decision_making_documented": true|false,
        "deviation_justification_documented": true|false,
        "missing_documentation": ["string"]
      }},
      "medicolegal_risk_assessment": {{
        "overall_risk_level": "very_high|high|moderate|low",
        "specific_vulnerabilities": ["string"],
        "protective_actions": ["string"],
        "consultation_recommended": true|false,
        "specialist_needed": "string or null"
      }},
      "recommendations_for_compliance": [{{
        "action": "string",
        "priority": "immediate|high|moderate|low",
        "expected_impact": "string",
        "resource_requirements": "string"
      }}],
      "confidence_score": 0.0-1.0
    }}
    
    CRITICAL:
    Return ONLY valid JSON.
    No markdown.
    No bullets.
    No headings.
    No explanations.
    No text outside JSON.
    Start with {{ and end with }}.
    If you output anything else the system will crash.

    """
        
        try:
            response = self.llm.invoke([
                SystemMessage(content="You are a clinical guidelines expert ensuring standard of care compliance."),
                HumanMessage(content=prompt)
            ])
            
            result = self._parse_response(response.content)
            state["guideline_compliance"] = result
            
            # Set confidence score
            state["confidence_scores"]["guideline_compliance"] = result.get("confidence_score", 0.0)
            
            # Check medicolegal risk
            medicolegal = result.get("medicolegal_risk_assessment", {})
            risk_level = medicolegal.get("overall_risk_level", "")
            
            if risk_level in ["very_high", "high"]:
                state["warnings"].append(
                    f"⚖️ MEDICOLEGAL RISK: {risk_level.upper()} - Review guideline compliance"
                )
                state["requires_review"] = True
            
            # Flag critical missing interventions
            missing = result.get("missing_recommended_interventions", [])
            for intervention in missing:
                if intervention.get("recommendation_class") == "I" and intervention.get("priority") == "critical":
                    state["warnings"].append(
                        f"📋 CRITICAL MISSING: {intervention['intervention']} - Class I recommendation"
                    )
                    state["requires_review"] = True
            
            # Flag deviations from Class I recommendations
            deviations = result.get("deviations_from_guidelines", [])
            for deviation in deviations:
                if deviation.get("recommendation_class") == "I" and deviation.get("medicolegal_risk") == "high":
                    state["warnings"].append(
                        f"⚠️ CLASS I DEVIATION: {deviation['guideline_recommendation']}"
                    )
            
            logger.info("✅ Guideline Compliance Agent: Analysis complete")
            
        except Exception as e:
            logger.error(f"❌ Guideline Compliance Agent failed: {str(e)}")
            state["error"] = f"Guideline compliance check failed: {str(e)}"
        
        return state
    
    def _parse_response(self, content: str) -> dict:
        """Parse LLM response to JSON"""
        try:
            content = content.strip()
            
            if "```json" in content:
                json_part = content.split("```json", 1)[1]
                json_part = json_part.split("```", 1)[0]
                return json.loads(json_part.strip())
            
            start = content.find("{")
            end = content.rfind("}")
            if start != -1 and end != -1:
                return json.loads(content[start:end + 1])
            
            raise ValueError("No JSON found in response")
            
        except Exception as e:
            logger.warning(f"⚠️ Guideline Compliance JSON parse failed: {e}")
            return {
                "raw_content": content,
                "confidence_score": 0.5
            }


# =====================================================================
# AGENT 11: CLINICAL DETERIORATION WARNING AGENT ⭐ CRITICAL
# =====================================================================

class ClinicalDeteriorationWarningAgent:
    """
    Predicts and warns of clinical deterioration
    
    CRITICAL IMPORTANCE:
    - Prevents ICU transfers
    - Identifies subtle deterioration early
    - Triggers rapid response teams
    - Reduces mortality
    
    PLACEMENT: Execute AFTER risk stratification
    """
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
    
    def analyze(self, state: dict) -> dict:
        """Assess risk of clinical deterioration"""
    
        logger.info("🚨 Clinical Deterioration Warning Agent: Starting analysis")
        optimized_context = build_deterioration_context(state)
        prompt = f"""
    Early warning system expert - detecting clinical deterioration to prevent ICU transfers and reduce mortality.

    {optimized_context}

    CALCULATE EARLY WARNING SCORES:

    NEWS2 (National Early Warning Score 2):
    - Respiratory rate (0-3), O2 sat (0-3), Supplemental O2 (2 if yes), Temp (0-3), SBP (0-3), HR (0-3), Consciousness (0-3)
    - Interpretation: 0-4 low, 5-6 medium (urgent), 7+ high (emergency), 3 in single parameter = medium

    qSOFA (Sepsis):
    - RR ≥22/min, Altered mental status, SBP ≤100 mmHg (1 point each)
    - ≥2 = high sepsis risk

    MEWS (Modified Early Warning Score):
    - RR, HR, SBP, Temp, AVPU score

    ORGAN-SPECIFIC DETERIORATION:
    Respiratory: increasing O2 needs, rising PaCO2, decreasing PaO2, RR trend
    Cardiovascular: decreasing BP, increasing lactate, decreasing UOP, rising HR
    Renal: rising Cr, decreasing UOP, fluid balance issues
    Hepatic: rising bilirubin, coagulopathy, encephalopathy
    Neurological: decreasing GCS, new confusion, focal deficits

    SUBTLE SIGNS:
    - Patient "doesn't look right"
    - Nursing/family concern
    - Subjective worsening
    - Deviation from expected trajectory

    ANALYZE:
    1. CALCULATE SCORES: NEWS2, qSOFA, MEWS - identify abnormal parameters

    2. TRENDING: improving/worsening? Rate of change? Trajectory prediction? Time to crisis?

    3. ORGAN DYSFUNCTION: SOFA if applicable, which organs, progression, multi-organ?

    4. DETERIORATION RISK FACTORS: patient-specific, disease state, iatrogenic, environmental

    5. TRIGGERS: thresholds crossed? Response tier needed? Urgency? Escalation pathway?

    6. PREVENTIVE INTERVENTIONS: what prevents deterioration? Monitoring frequency? Escalation triggers? Prophylaxis?

    7. RAPID RESPONSE/CODE: RRT criteria? Code blue criteria? ICU consult? Immediate actions?

    RULES:
    - Calculate actual scores, don't estimate
    - Flag missing vital signs
    - TREND > single value
    - Use validated scoring
    - Be sensitive (better false alarm than missed deterioration)
    - Consider subjective concerns seriously

    CRITICAL OUTPUT RULES:
    - ALL string fields: Maximum 10 words unless marked [LONG]
    - Rationales: Maximum 15 words, focus on KEY reason only
    - Descriptions: Maximum 12 words, essential information only
    - Lists: Maximum 5 items unless critical
    - Use medical abbreviations: MI not "myocardial infarction"
    - Be telegraphic: "Pt has 3 high-risk factors" not "The patient presents with three significant risk factors"
    - NO preambles, NO explanations, DIRECT answers only
    - Example good: "HTN, DM, CKD increase CVD risk 3x"
    - Example bad: "The patient's hypertension, diabetes, and chronic kidney disease significantly increase their cardiovascular disease risk by approximately three times"

    1. You MUST ONLY use information explicitly present in the INPUT DATA below
    2. If a field is empty/missing, you MUST state "No data provided" 
    3. NEVER invent symptoms, lab values, imaging findings, or diagnoses
    4. If insufficient data exists, you MUST respond with limitations
    5. For "routine check-up" with no symptoms: Focus on health maintenance
    OUTPUT (JSON):
    {{
      "early_warning_scores": {{
        "NEWS2": {{
          "total_score": 0-20,
          "risk_level": "low|medium|high",
          "component_scores": {{
            "respiratory_rate": 0-3,
            "oxygen_saturation": 0-3,
            "supplemental_oxygen": 0-2,
            "temperature": 0-3,
            "systolic_bp": 0-3,
            "heart_rate": 0-3,
            "consciousness": 0-3
          }},
          "interpretation": "string",
          "recommended_action": "routine|increased_monitoring|urgent_response|emergency_response"
        }},
        "qSOFA": {{
          "total_score": 0-3,
          "risk_level": "low|high",
          "components_positive": ["string"],
          "interpretation": "string"
        }},
        "MEWS": {{
          "total_score": 0-15,
          "risk_level": "low|medium|high",
          "interpretation": "string"
        }}
      }},
      "trending_analysis": {{
        "direction": "improving|stable|deteriorating|rapidly_deteriorating",
        "rate_of_change": "slow|moderate|rapid",
        "trajectory_prediction": "string",
        "estimated_time_to_crisis": "immediate|hours|days|unlikely",
        "confidence_in_prediction": 0.0-1.0
      }},
      "organ_dysfunction_assessment": {{
        "SOFA_score": 0-24,
        "organs_affected": [{{
          "organ": "respiratory|cardiovascular|renal|hepatic|neurological|coagulation",
          "dysfunction_severity": "none|mild|moderate|severe",
          "trend": "improving|stable|worsening",
          "specific_findings": ["string"]
        }}],
        "multi_organ_dysfunction": true|false
      }},
      "deterioration_risk_factors": [{{
        "factor": "string",
        "impact": "high|moderate|low",
        "modifiable": true|false
      }}],
      "trigger_thresholds_crossed": [{{
        "trigger": "string",
        "value": "string",
        "threshold": "string",
        "urgency": "immediate|urgent|soon",
        "recommended_action": "string"
      }}],
      "monitoring_recommendations": {{
        "vital_signs_frequency": "continuous|Q15min|Q30min|Q1hr|Q4hr",
        "specific_parameters_to_monitor": ["string"],
        "laboratory_monitoring": ["string"],
        "monitoring_duration": "string",
        "escalation_criteria": ["string"]
      }},
      "preventive_interventions": [{{
        "intervention": "string",
        "rationale": "string",
        "urgency": "immediate|urgent|routine",
        "expected_benefit": "string"
      }}],
      "escalation_requirements": {{
        "rapid_response_team_needed": true|false,
        "ICU_consultation_needed": true|false,
        "immediate_physician_notification": true|false,
        "code_blue_risk": "high|moderate|low|very_low",
        "recommended_level_of_care": "ICU|step_down|monitored_bed|general_floor"
      }},
      "red_flags_present": ["string"],
      "missing_data_affecting_assessment": ["string"],
      "overall_deterioration_risk": {{
        "risk_level": "very_high|high|moderate|low",
        "confidence": 0.0-1.0,
        "primary_concerns": ["string"],
        "timeframe": "immediate|hours|days"
      }},
      "requires_immediate_escalation": true|false,
      "confidence_score": 0.0-1.0
    }}
    
    CRITICAL:
    Return ONLY valid JSON.
    No markdown.
    No bullets.
    No headings.
    No explanations.
    No text outside JSON.
    Start with {{ and end with }}.
    If you output anything else the system will crash.
    
    """
        
        try:
            response = self.llm.invoke([
                SystemMessage(content="You are an early warning system expert detecting clinical deterioration."),
                HumanMessage(content=prompt)
            ])
            
            result = self._parse_response(response.content)
            state["clinical_deterioration_warning"] = result
            
            # Set confidence score
            state["confidence_scores"]["deterioration_warning"] = result.get("confidence_score", 0.0)
            
            # Check for immediate escalation needs
            if result.get("requires_immediate_escalation"):
                state["warnings"].append("🚨 CLINICAL DETERIORATION DETECTED - IMMEDIATE ESCALATION REQUIRED")
                state["requires_review"] = True
            
            # Check early warning scores
            early_warning = result.get("early_warning_scores", {})
            news2 = early_warning.get("NEWS2", {})
            
            if news2.get("risk_level") in ["medium", "high"]:
                state["warnings"].append(
                    f"⚠️ NEWS2 SCORE: {news2.get('total_score')} - {news2.get('risk_level').upper()} RISK"
                )
            
            qsofa = early_warning.get("qSOFA", {})
            if qsofa.get("risk_level") == "high":
                state["warnings"].append("🚨 qSOFA ≥2 - HIGH SEPSIS RISK")
                state["requires_review"] = True
            
            # Check trending
            trending = result.get("trending_analysis", {})
            if trending.get("direction") in ["deteriorating", "rapidly_deteriorating"]:
                state["warnings"].append(
                    f"📉 CLINICAL DETERIORATION: {trending.get('direction')} - Monitor closely"
                )
            
            # Check escalation requirements
            escalation = result.get("escalation_requirements", {})
            if escalation.get("rapid_response_team_needed"):
                state["warnings"].append("🚨 RAPID RESPONSE TEAM ACTIVATION RECOMMENDED")
                state["requires_review"] = True
            
            if escalation.get("ICU_consultation_needed"):
                state["warnings"].append("🔔 ICU CONSULTATION RECOMMENDED")
                state["requires_review"] = True
            
            logger.info("✅ Clinical Deterioration Warning Agent: Analysis complete")
            
        except Exception as e:
            logger.error(f"❌ Clinical Deterioration Warning Agent failed: {str(e)}")
            state["error"] = f"Deterioration warning analysis failed: {str(e)}"
        
        return state
    
    def _parse_response(self, content: str) -> dict:
        """Parse LLM response to JSON"""
        try:
            content = content.strip()
            
            if "```json" in content:
                json_part = content.split("```json", 1)[1]
                json_part = json_part.split("```", 1)[0]
                return json.loads(json_part.strip())
            
            start = content.find("{")
            end = content.rfind("}")
            if start != -1 and end != -1:
                return json.loads(content[start:end + 1])
            
            raise ValueError("No JSON found in response")
            
        except Exception as e:
            logger.warning(f"⚠️ Deterioration Warning JSON parse failed: {e}")
            return {
                "raw_content": content,
                "confidence_score": 0.5
            }


# =====================================================================
# AGENT 12: DIAGNOSTIC TEST APPROPRIATENESS AGENT
# =====================================================================

class DiagnosticTestAppropriatenessAgent:
    """
    Evaluates appropriateness of diagnostic testing
    
    IMPORTANCE:
    - Reduces unnecessary testing
    - Cost containment
    - Reduces patient harm (radiation, false positives)
    - Quality metrics / Choosing Wisely
    
    PLACEMENT: Execute AFTER differential diagnosis
    """
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
    
    def analyze(self, state: dict) -> dict:
        """Evaluate diagnostic test appropriateness"""
    
        logger.info("🔬 Diagnostic Test Appropriateness Agent: Starting analysis")
    
        prompt = f"""
    Diagnostic testing expert and health economics specialist.

    DIFFERENTIAL:
    {safe_json(state.get("differential_diagnosis", {}))}

    PROPOSED TESTS:
    {state.get("consultation_text", "")}

    CLINICAL:
    {safe_json(state.get("clinical_context", {}))}

    PREVIOUS RESULTS:
    {safe_json(state.get("medical_context", {}).get("laboratory_results", {}))}

    EVALUATE: Appropriateness using evidence-based criteria.

    FRAMEWORK:
    1. PRE-TEST PROBABILITY
       - What is pre-test probability?
       - Will test change management?
       - Bayesian reasoning: High pre-test (may not need), Very low (won't change management), Intermediate (most useful)

    2. TEST CHARACTERISTICS
       - Sensitivity/specificity
       - Positive/negative likelihood ratios
       - Post-test probability estimation
       - False positive/negative rates

    3. APPROPRIATENESS CRITERIA
       Use: ACR Appropriateness, Choosing Wisely, USPSTF, specialty guidelines
       Categories: Usually Appropriate (7-9), May Be Appropriate (4-6), Usually Not Appropriate (1-3)

    4. CHOOSING WISELY / LOW-VALUE CARE
       Common unnecessary:
       - Routine preop testing (low-risk surgery)
       - Imaging for uncomplicated low back pain <6wk
       - CT head for simple syncope
       - Vitamin D screening (asymptomatic)
       - Tumor markers for screening
       - Antibody panels without suspicion
       - Lyme serologies without exposure

    5. COST-EFFECTIVENESS
       - Test cost, cheaper alternatives with similar performance
       - Incremental benefit vs cost
       - Step-wise approach (start cheap, escalate)

    6. SAFETY
       - Radiation (especially CT)
       - Cumulative dose
       - Contrast risks
       - Invasive procedure risks
       - Incidental findings (psychological burden, cascade testing)

    7. TIMING
       - Urgent/stat needed?
       - Can wait for outpatient?
       - Optimal timing (e.g., morning cortisol)
       - Too early? (e.g., troponin <3hr)

    8. SEQUENCING & COMBINATIONS
       - Simpler tests first?
       - All tests in panel necessary?
       - Redundant tests?
       - Step-wise vs shotgun

    9. ALTERNATIVES
       - Therapeutic trial instead
       - Watchful waiting
       - Clinical criteria alone
       - Cheaper/safer alternatives

    10. MANAGEMENT IMPACT
        - Will result change management?
        - If positive, what do? If negative, what do?
        - If both → same action, test not needed

    RULES:
    - Bayesian reasoning every test
    - Question tests that won't change management
    - Consider radiation (especially young)
    - Check Choosing Wisely
    - Evaluate cost-effectiveness
    - Recommend step-wise approaches

    CRITICAL OUTPUT RULES:
    - ALL string fields: Maximum 10 words unless marked [LONG]
    - Rationales: Maximum 15 words, focus on KEY reason only
    - Descriptions: Maximum 12 words, essential information only
    - Lists: Maximum 5 items unless critical
    - Use medical abbreviations: MI not "myocardial infarction"
    - Be telegraphic: "Pt has 3 high-risk factors" not "The patient presents with three significant risk factors"
    - NO preambles, NO explanations, DIRECT answers only
    - Example good: "HTN, DM, CKD increase CVD risk 3x"
    - Example bad: "The patient's hypertension, diabetes, and chronic kidney disease significantly increase their cardiovascular disease risk by approximately three times"

    1. You MUST ONLY use information explicitly present in the INPUT DATA below
    2. If a field is empty/missing, you MUST state "No data provided" 
    3. NEVER invent symptoms, lab values, imaging findings, or diagnoses
    4. If insufficient data exists, you MUST respond with limitations
    5. For "routine check-up" with no symptoms: Focus on health maintenance
    OUTPUT (JSON):
    {{
      "proposed_tests_evaluation": [{{
        "test": "string",
        "appropriateness": "usually_appropriate|may_be_appropriate|usually_not_appropriate",
        "appropriateness_score": 1-9,
        "pre_test_probability": {{
          "disease": "string",
          "probability_estimate": 0-100,
          "probability_category": "very_low|low|intermediate|high|very_high"
        }},
        "test_characteristics": {{
          "sensitivity": "string",
          "specificity": "string",
          "positive_LR": "string",
          "negative_LR": "string"
        }},
        "post_test_probability_if_positive": 0-100,
        "post_test_probability_if_negative": 0-100,
        "will_change_management": true|false,
        "management_if_positive": "string",
        "management_if_negative": "string",
        "guideline_support": {{
          "supported_by_guidelines": true|false,
          "guideline": "string or null",
          "recommendation_strength": "strong|moderate|weak|against"
        }},
        "choosing_wisely_flag": {{
          "is_low_value_care": true|false,
          "choosing_wisely_recommendation": "string or null"
        }},
        "cost_considerations": {{
          "approximate_cost": "string",
          "cost_category": "low|moderate|high|very_high",
          "cheaper_alternative": "string or null",
          "cost_effective": true|false
        }},
        "safety_concerns": {{
          "radiation_exposure": "none|low|moderate|high",
          "radiation_dose_mSv": "string or null",
          "contrast_needed": true|false,
          "invasive": true|false,
          "complication_risk": "low|moderate|high",
          "specific_risks": ["string"]
        }},
        "timing": {{
          "urgency": "stat|urgent|routine|outpatient",
          "can_wait": true|false,
          "optimal_timing": "string"
        }},
        "alternatives": [{{
          "alternative_test": "string",
          "advantages": ["string"],
          "disadvantages": ["string"],
          "recommendation": "preferred|equivalent|inferior"
        }}],
        "recommendation": {{
          "action": "proceed|defer|alternative|not_indicated",
          "rationale": "string",
          "conditions": "string or null"
        }}
      }}],
      "unnecessary_tests_identified": [{{
        "test": "string",
        "reason_unnecessary": "string",
        "choosing_wisely_violation": true|false,
        "estimated_cost_savings": "string"
      }}],
      "recommended_test_sequence": [{{
        "step": 1,
        "test": "string",
        "rationale": "string",
        "if_positive_next": "string",
        "if_negative_next": "string"
      }}],
      "missing_appropriate_tests": [{{
        "test": "string",
        "indication": "string",
        "priority": "high|moderate|low",
        "rationale": "string"
      }}],
      "cumulative_radiation_concern": {{
        "total_radiation_proposed_mSv": "string",
        "excessive_radiation": true|false,
        "alternatives_to_reduce": ["string"]
      }},
      "overall_testing_strategy": {{
        "approach": "appropriate|over_testing|under_testing",
        "cost_efficiency": "cost_effective|acceptable|wasteful",
        "safety_profile": "safe|acceptable_risk|concerning",
        "recommendations": ["string"]
      }},
      "confidence_score": 0.0-1.0
    }}
    """
        
        try:
            response = self.llm.invoke([
                SystemMessage(content="You are a diagnostic testing expert evaluating test appropriateness."),
                HumanMessage(content=prompt)
            ])
            
            result = self._parse_response(response.content)
            state["diagnostic_test_appropriateness"] = result
            
            # Set confidence score
            state["confidence_scores"]["test_appropriateness"] = result.get("confidence_score", 0.0)
            
            # Flag unnecessary tests
            unnecessary = result.get("unnecessary_tests_identified", [])
            for test in unnecessary:
                if test.get("choosing_wisely_violation"):
                    state["warnings"].append(
                        f"⚠️ LOW-VALUE CARE: {test['test']} - {test['reason_unnecessary']}"
                    )
            
            # Flag radiation concerns
            radiation = result.get("cumulative_radiation_concern", {})
            if radiation.get("excessive_radiation"):
                state["warnings"].append(
                    f"☢️ EXCESSIVE RADIATION: {radiation.get('total_radiation_proposed_mSv')} - Consider alternatives"
                )
            
            # Flag over-testing
            strategy = result.get("overall_testing_strategy", {})
            if strategy.get("approach") == "over_testing":
                state["warnings"].append("📊 OVER-TESTING DETECTED - Review test appropriateness")
            
            logger.info("✅ Diagnostic Test Appropriateness Agent: Analysis complete")
            
        except Exception as e:
            logger.error(f"❌ Diagnostic Test Appropriateness Agent failed: {str(e)}")
            state["error"] = f"Test appropriateness evaluation failed: {str(e)}"
        
        return state
    
    def _parse_response(self, content: str) -> dict:
        """Parse LLM response to JSON"""
        try:
            content = content.strip()
            
            if "```json" in content:
                json_part = content.split("```json", 1)[1]
                json_part = json_part.split("```", 1)[0]
                return json.loads(json_part.strip())
            
            start = content.find("{")
            end = content.rfind("}")
            if start != -1 and end != -1:
                return json.loads(content[start:end + 1])
            
            raise ValueError("No JSON found in response")
            
        except Exception as e:
            logger.warning(f"⚠️ Test Appropriateness JSON parse failed: {e}")
            return {
                "raw_content": content,
                "confidence_score": 0.5
            }


# =====================================================================
# AGENT 13: COMORBIDITY INTERACTION AGENT
# =====================================================================

class ComorbidityInteractionAgent:
    """
    Analyzes how multiple conditions interact
    
    IMPORTANCE:
    - Most patients have multiple conditions
    - Treatment for one may worsen another
    - Overlapping symptoms complicate diagnosis
    - Cumulative medication burden
    
    PLACEMENT: Execute AFTER disease causation analysis
    """
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
    
    def analyze(self, state: dict) -> dict:
        """Analyze comorbidity interactions"""
    
        logger.info("🔗 Comorbidity Interaction Agent: Starting analysis")
    
        prompt = f"""
    Specialist in managing patients with multiple chronic conditions.

    ACTIVE DIAGNOSES:
    {safe_json(state.get("clinical_context", {}).get("active_diagnoses", []))}

    DISEASE:
    {safe_json(state.get("disease_causation", {}))}

    MEDICATIONS:
    {safe_json(state.get("medical_context", {}).get("medications", []))}

    TREATMENT:
    {safe_json(state.get("treatment_validation", {}))}

    ANALYZE: How multiple conditions interact and affect treatment.

    FRAMEWORK:
    1. COMORBIDITY BURDEN
       - Total conditions
       - Charlson Comorbidity Index
       - Cumulative Illness Rating Scale
       - Multimorbidity complexity

    2. DISEASE-DISEASE INTERACTIONS
       Common:
       - COPD + HF (diagnostic confusion, beta-blocker dilemma)
       - DM + CKD (medication adjustments, tight glycemic control risks)
       - HTN + CKD (BP targets differ)
       - Cancer + Autoimmune (immunosuppression dilemma)
       - Cirrhosis + DM (hypoglycemia risk)
       - Asthma + GERD (worsen each other)
       - Depression + Chronic Pain (amplify)
       - AFib + CKD (anticoagulation challenges)
   
       For each: How A affects B, B affects A, shared pathophysiology, conflicting treatment goals, synergistic complications

    3. DIAGNOSTIC CHALLENGES
       - Overlapping symptoms masking problem
       - Atypical presentations
       - Difficulty attributing symptoms
       - Multiple conditions explaining same finding

    4. TREATMENT CONFLICTS
       Examples:
       - Beta-blockers: HF benefit but COPD worsen
       - NSAIDs: CKD worsen but arthritis need
       - Corticosteroids: DM worsen but COPD/asthma need
       - Anticoagulation: AFib need but liver disease risky
   
       For each: competing priorities, risk-benefit, which priority, alternatives, modified strategies

    5. POLYPHARMACY & BURDEN
       - Total count
       - Pill burden per day
       - Medications treating side effects
       - Prescribing cascade
       - Adherence challenges

    6. SHARED PATHOPHYSIOLOGY
       - Common mechanisms
       - Medications treating multiple conditions
       - Single intervention multiple benefits

    7. CUMULATIVE RISK
       - Risk factors affecting multiple conditions
       - Compounding risks
       - Modifiable vs non-modifiable
       - Priority interventions with multiple benefits

    8. PROGNOSTIC IMPACT
       - How comorbidities affect primary condition prognosis
       - Survival, QOL, functional status

    9. CARE COORDINATION
       - Multiple specialists
       - Conflicting recommendations
       - Need for coordinating physician
       - Communication gaps

    10. SIMPLIFICATION
        - Medications treating multiple conditions
        - Discontinuing for resolved conditions
        - Simplifying regimen
        - Reducing pill burden

    RULES:
    - Identify ALL disease-disease interactions
    - Recognize competing priorities
    - Consider cumulative medication burden
    - Look for simplification opportunities
    - Prioritize patient-centered goals
    - Consider functional status and QOL

    CRITICAL OUTPUT RULES:
    - ALL string fields: Maximum 10 words unless marked [LONG]
    - Rationales: Maximum 15 words, focus on KEY reason only
    - Descriptions: Maximum 12 words, essential information only
    - Lists: Maximum 5 items unless critical
    - Use medical abbreviations: MI not "myocardial infarction"
    - Be telegraphic: "Pt has 3 high-risk factors" not "The patient presents with three significant risk factors"
    - NO preambles, NO explanations, DIRECT answers only
    - Example good: "HTN, DM, CKD increase CVD risk 3x"
    - Example bad: "The patient's hypertension, diabetes, and chronic kidney disease significantly increase their cardiovascular disease risk by approximately three times"

    1. You MUST ONLY use information explicitly present in the INPUT DATA below
    2. If a field is empty/missing, you MUST state "No data provided" 
    3. NEVER invent symptoms, lab values, imaging findings, or diagnoses
    4. If insufficient data exists, you MUST respond with limitations
    5. For "routine check-up" with no symptoms: Focus on health maintenance
    OUTPUT (JSON):
    {{
      "comorbidity_burden": {{
        "total_conditions": 0,
        "charlson_comorbidity_index": 0,
        "complexity_level": "low|moderate|high|very_high",
        "functional_impact": "minimal|moderate|severe"
      }},
      "disease_disease_interactions": [{{
        "condition_1": "string",
        "condition_2": "string",
        "interaction_type": "synergistic|antagonistic|conflicting|overlapping",
        "description": "string",
        "clinical_significance": "high|moderate|low",
        "specific_concerns": ["string"],
        "management_implications": "string"
      }}],
      "diagnostic_challenges": [{{
        "challenge": "string",
        "conditions_involved": ["string"],
        "impact": "string",
        "approach_to_clarify": "string"
      }}],
      "treatment_conflicts": [{{
        "medication_or_intervention": "string",
        "benefits_condition": "string",
        "harms_condition": "string",
        "severity_of_conflict": "major|moderate|minor",
        "resolution_strategy": "string",
        "priority_condition": "string",
        "alternative_approach": "string"
      }}],
      "cumulative_medication_burden": {{
        "total_medications": 0,
        "pills_per_day": 0,
        "dosing_times_per_day": 0,
        "complexity_score": "simple|moderate|complex|very_complex",
        "medications_treating_side_effects": [{{
          "medication": "string",
          "treating_side_effect_of": "string"
        }}],
        "prescribing_cascade_identified": true|false
      }},
      "shared_pathophysiology": [{{
        "conditions": ["string"],
        "shared_mechanism": "string",
        "therapeutic_opportunity": "string"
      }}],
      "medications_treating_multiple_conditions": [{{
        "medication": "string",
        "conditions_treated": ["string"],
        "benefit": "string"
      }}],
      "cumulative_risk_assessment": {{
        "compounded_risks": [{{
          "risk": "string",
          "contributing_conditions": ["string"],
          "cumulative_impact": "high|moderate|low"
        }}]
      }},
      "prognostic_impact": {{
        "primary_condition": "string",
        "comorbidities_worsening_prognosis": ["string"],
        "overall_prognosis": "improved|unchanged|worsened",
        "survival_impact": "string",
        "quality_of_life_impact": "string"
      }},
      "care_coordination": {{
        "specialists_involved": ["string"],
        "conflicting_recommendations": [{{
          "specialist_1": "string",
          "recommendation_1": "string",
          "specialist_2": "string",
          "recommendation_2": "string",
          "resolution": "string"
        }}],
        "coordinating_physician_needed": true|false
      }},
      "treatment_simplification_opportunities": [{{
        "opportunity": "string",
        "potential_benefit": "string",
        "feasibility": "easy|moderate|difficult",
        "recommendation": "string"
      }}],
      "priority_interventions_multiple_benefits": [{{
        "intervention": "string",
        "conditions_benefited": ["string"],
        "expected_impact": "string",
        "priority": "high|moderate|low"
      }}],
      "overall_management_strategy": {{
        "primary_focus": "string",
        "treatment_priorities_ranked": ["string"],
        "patient_centered_goals": ["string"],
        "recommended_approach": "string"
      }},
      "confidence_score": 0.0-1.0
    }}
    """        
        try:
            response = self.llm.invoke([
                SystemMessage(content="You are an expert in managing complex patients with multiple comorbidities."),
                HumanMessage(content=prompt)
            ])
            
            result = self._parse_response(response.content)
            state["comorbidity_interaction"] = result
            
            # Set confidence score
            state["confidence_scores"]["comorbidity_interaction"] = result.get("confidence_score", 0.0)
            
            # Flag major treatment conflicts
            conflicts = result.get("treatment_conflicts", [])
            for conflict in conflicts:
                if conflict.get("severity_of_conflict") == "major":
                    state["warnings"].append(
                        f"⚠️ TREATMENT CONFLICT: {conflict['medication_or_intervention']} - Benefits {conflict['benefits_condition']} but harms {conflict['harms_condition']}"
                    )
            
            # Flag high complexity
            burden = result.get("comorbidity_burden", {})
            if burden.get("complexity_level") in ["high", "very_high"]:
                state["warnings"].append(
                    f"🔗 HIGH COMORBIDITY COMPLEXITY - Specialist coordination recommended"
                )
            
            # Flag care coordination needs
            coordination = result.get("care_coordination", {})
            if coordination.get("coordinating_physician_needed"):
                state["warnings"].append("🔔 Care coordination needed - Multiple specialists involved")
            
            logger.info("✅ Comorbidity Interaction Agent: Analysis complete")
            
        except Exception as e:
            logger.error(f"❌ Comorbidity Interaction Agent failed: {str(e)}")
            state["error"] = f"Comorbidity interaction analysis failed: {str(e)}"
        
        return state
    
    def _parse_response(self, content: str) -> dict:
        """Parse LLM response to JSON"""
        try:
            content = content.strip()
            
            if "```json" in content:
                json_part = content.split("```json", 1)[1]
                json_part = json_part.split("```", 1)[0]
                return json.loads(json_part.strip())
            
            start = content.find("{")
            end = content.rfind("}")
            if start != -1 and end != -1:
                return json.loads(content[start:end + 1])
            
            raise ValueError("No JSON found in response")
            
        except Exception as e:
            logger.warning(f"⚠️ Comorbidity Interaction JSON parse failed: {e}")
            return {
                "raw_content": content,
                "confidence_score": 0.5
            }



#=================================================================
# Treatment plan
#===============================================================

# =====================================================================
# AGENT 15: ADVANCED CLINICAL TREATMENT INTELLIGENCE AGENT ⭐⭐⭐ FLAGSHIP
# =====================================================================

class AdvancedTreatmentIntelligenceAgent:
    """
    Advanced Clinical Treatment Intelligence Agent
    
    CAPABILITIES:
    - Multi-guideline specialty-aware recommendations
    - Structured objective-driven treatment planning
    - Pharmacological + Procedural + Non-pharmacological planning
    - Standard of care alignment with deviation logging
    - Cost & resource rationality evaluation
    - Durability & sustainability assessment
    - Integrated monitoring plan generation
    - Full physician authority model (advisory only)
    
    PLACEMENT: Execute AFTER guideline_compliance_agent, BEFORE discharge_readiness_agent
    """
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
    
    def analyze(self, state: dict) -> dict:
        logger.info("🧠 Advanced Treatment Intelligence Agent: Starting analysis")
        
        optimized_context = build_advanced_treatment_intelligence_context(state)
        logger.info(f"advanced_output:{optimized_context}")
        # Pull all upstream agent results for integration
        differential = state.get("differential_diagnosis", {})
        staging = state.get("staging_analysis", {})
        prognosis = state.get("prognosis_factors", {})
        risk = state.get("risk_stratification", {})
        guideline_compliance = state.get("guideline_compliance", {})
        deterioration = state.get("clinical_deterioration_warning", {})
        consultation = state.get("consultation_text", "")
        
        prompt = f"""
You are an elite clinical treatment intelligence system — functioning as a senior attending physician's AI co-pilot.

Your role is to Generate the safest guideline-consistent plan supported ONLY by patient data.

You must think at the level of:
- A senior specialist (not a generalist)
- A clinical pharmacologist (for drug decisions)
- A health economist (for cost-rationality)
- A patient advocate (for durability and adherence)

═══════════════════════════════════════════════════════════════
PATIENT CLINICAL DATA (from all upstream agents)
═══════════════════════════════════════════════════════════════

{optimized_context}

DOCTOR'S CONSULTATION TEXT:
{consultation}

DIFFERENTIAL DIAGNOSIS (from Diagnostic Agent):
Primary Most Likely: {differential.get("most_likely_diagnoses", [{}])[0].get("diagnosis", "Unknown") if differential.get("most_likely_diagnoses") else "Unknown"}
Confidence: {differential.get("overall_diagnostic_confidence", 0)}
Must-Not-Miss: {[d.get("diagnosis") for d in differential.get("must_not_miss_diagnoses", [])[:2]]}

DISEASE STAGING (from Staging Agent):
Stage: {staging.get("primary_staging", {}).get("stage", "Unknown")}
Severity: {staging.get("severity_grade", {}).get("grade", "Unknown")}
Stability: {staging.get("severity_grade", {}).get("stability", "Unknown")}

PROGNOSIS (from Prognosis Agent):
Category: {prognosis.get("prognostic_category", "Unknown")}
Short-term outlook: {prognosis.get("outcome_predictions", {}).get("short_term", {}).get("expected_outcome", "Unknown")}

RISK STRATIFICATION (from Risk Agent):
Overall Risk: {risk.get("overall_risk_category", {}).get("level", "Unknown") if isinstance(risk.get("overall_risk_category"), dict) else risk.get("overall_risk_category", "Unknown")}
Immediate Action Required: {risk.get("requires_immediate_action", False)}

GUIDELINE COMPLIANCE STATUS:
Overall Compliance: {guideline_compliance.get("guideline_adherence_summary", {}).get("overall_assessment", "Unknown")}
Missing Interventions: {[i.get("intervention") for i in guideline_compliance.get("missing_recommended_interventions", [])[:3]]}

DETERIORATION RISK (from Deterioration Agent):
NEWS2 Risk: {deterioration.get("early_warning_scores", {}).get("NEWS2", {}).get("risk_level", "Unknown")}
Trending: {deterioration.get("trending_analysis", {}).get("direction", "Unknown")}

═══════════════════════════════════════════════════════════════
YOUR TASK: GENERATE COMPLETE TREATMENT INTELLIGENCE PLAN
═══════════════════════════════════════════════════════════════

SECTION 1: CLINICAL OBJECTIVE IDENTIFICATION
Determine the single most appropriate treatment intent:
- curative / disease_modifying / palliative / symptom_control / functional_improvement / quality_of_life

Evidence basis for your selection.

SECTION 2: SPECIALTY & GUIDELINE SELECTION

GUIDELINE SELECTION RULES (MANDATORY — INDIA-ALIGNED):

Select guidelines strictly based on the primary clinical specialty and ALWAYS include regional adaptation when applicable.

SPECIALTY → REQUIRED GUIDELINES:

* Oncology → NCCN (PRIMARY EVIDENCE BACKBONE) + NCG India (MANDATORY CO-PRIMARY) + ASCO/ESMO (SECONDARY VALIDATION)
* Cardiology → ACC/AHA or ESC (+ NCG India alignment if applicable)
* Nephrology → KDIGO (+ NCG India contextual adaptation if available)
* Pulmonology → GOLD / GINA (+ NCG India where applicable)
* Infection → IDSA / WHO (+ NCG India national guidance where applicable)

MANDATORY ENFORCEMENT RULES:

1. ONCOLOGY STRICT RULE:

* NCCN MUST be cited.
* NCG India MUST ALSO be cited (NOT optional).
* ASCO/ESMO used only for supportive evidence or clarification.

2. REGIONAL ADAPTATION LOGIC:

* If NCCN and NCG differ:

  * Present BOTH recommendations explicitly.
  * Identify agreement vs conflict.
  * Prefer the option that preserves patient safety while remaining resource-appropriate.

3. GUIDELINE INTEGRITY:

* NEVER invent guideline statements.
* Apply ONLY recommendations supported by patient’s stage, biomarkers, risk category, and clinical context.

4. ELIGIBILITY CHECK RULE:
   If required data is missing (stage, biomarkers, ECOG/PS, organ function, imaging, labs):
   "Insufficient data — guideline recommendation cannot be applied."
   Also recommend the exact missing investigation.

5. EVIDENCE STRENGTH CLASSIFICATION:

* A = RCT/meta-analysis
* B = Observational/non-randomized
* C = Expert consensus
Identify:
- Primary specialty managing this condition
- Primary guideline (most authoritative, most recent version + year)
- Secondary reference guideline
- Where guidelines agree vs conflict
- Strength of evidence: A (RCT/meta-analysis), B (observational), C (expert opinion)

SECTION 3A: PHARMACOLOGICAL PLAN
For each drug recommended:
- Clinical rationale: WHY this drug for THIS patient (not generic)
- Guideline reference: which guideline, which recommendation class, evidence level
- Dose + frequency + route (patient-adjusted: weight, eGFR, LFTs if relevant)
- Duration + titration strategy
- What to monitor for efficacy + what to monitor for toxicity
- Alternatives if first-line fails or is contraindicated
- Flag any interactions with existing medications

SECTION 3B: PROCEDURAL/SURGICAL PLAN (if applicable)
- Indication strength: strong/moderate/weak
- Timing: immediate/urgent/elective
- Pre-procedure requirements
- Post-procedure monitoring
- Guideline support for procedure decision

SECTION 3C: NON-PHARMACOLOGICAL PLAN
- Specific dietary recommendations (not generic "eat healthy")
- Exercise: type, frequency, intensity, restrictions
- Lifestyle modifications with evidence basis
- Physiotherapy/rehabilitation if applicable
- Psychological support if indicated
- Patient education priorities

SECTION 4: INTEGRATED PLAN EVALUATION

4A. Standard of Care Alignment
- Is plan aligned with Class I recommendations?
- Any justified deviations? Explicitly state why.
- Medico-legal documentation requirements

4B. Practical Feasibility
- Monitoring requirements: can patient/facility support these?
- Any high-cost components? Alternatives?
- Follow-up infrastructure needed

4C. Patient-Centered Durability
- Adherence prediction: high/moderate/low + rationale
- Regimen simplification opportunities
- Long-term sustainability assessment

4D. Cost & Resource Rationality
- Flag high-cost interventions
- Generic/biosimilar alternatives where clinically equivalent
- Cost-effectiveness justification for expensive choices

SECTION 5: MONITORING & FOLLOW-UP PLAN
- Week 1: what to check, why, thresholds for action
- Month 1: targets and escalation criteria  
- Long-term: frequency, parameters, when to consider treatment change
- Emergency warning signs patient/caregiver must know

SECTION 6: TREATMENT INTELLIGENCE SUMMARY
- Top 3 priority actions (rank ordered)
- Single sentence justification for each
- Confidence in overall plan
- What would change this plan (if diagnosis differs / patient deteriorates)

═══════════════════════════════════════════════════════════════
CRITICAL OUTPUT RULES
═══════════════════════════════════════════════════════════════

NEVER generic. ALWAYS patient-specific.
Every drug: explain WHY for THIS patient.
Every guideline cited: name it, version, recommendation class.
If data is missing: state "Insufficient data — recommend [specific test] before finalizing."
Physician authority: mark every AI recommendation as [AI-ADVISORY] 

1. ONLY use information explicitly present in the patient data
2. If a field is empty: state "No data provided — [clinical implication]"
3. NEVER fabricate lab values, diagnoses, or imaging findings
4. Telegraphic style: use abbreviations, be concise but complete

OUTPUT (JSON):
{{
  "clinical_objectives": {{
    "primary_intent": "curative|disease_modifying|palliative|symptom_control|functional_improvement|quality_of_life",
    "intent_rationale": "string — WHY this intent for THIS patient based on stage/prognosis",
    "secondary_objectives": ["string"],
    "treatment_goals": [
      {{
        "goal": "string",
        "measurable_endpoint": "string",
        "timeframe": "string",
        "priority": "critical|high|moderate|low"
      }}
    ],
    "objective_confidence": 0.0-1.0
  }},
  
  "guideline_framework": {{
    "primary_specialty": "string",
    "primary_guideline": {{
      "name": "string (e.g., ACC/AHA 2023 Heart Failure Guidelines)",
      "organization": "string",
      "version_year": "string",
      "url": "string or null",
      "applicable_recommendation": "string — specific recommendation that applies"
    }},
    "secondary_guideline": {{
      "name": "string",
      "organization": "string",
      "version_year": "string",
      "key_difference_from_primary": "string"
    }},
    "guideline_consensus": {{
      "areas_of_agreement": ["string"],
      "areas_of_conflict": [
        {{
          "recommendation": "string",
          "guideline_1_says": "string",
          "guideline_2_says": "string",
          "recommended_resolution": "string",
          "rationale": "string"
        }}
      ]
    }}
  }},
  
  "pharmacological_plan": {{
    "first_line_therapy": [
      {{
        "drug": "string",
        "drug_class": "string",
        "clinical_rationale": "string — specific reason for THIS patient (not generic)",
        "guideline_support": {{
          "guideline": "string",
          "recommendation_class": "I|IIa|IIb|III",
          "evidence_level": "A|B|C",
          "specific_recommendation": "string — exact guideline statement paraphrased"
        }},
        "dosing": {{
          "starting_dose": "string",
          "target_dose": "string",
          "frequency": "string",
          "route": "string",
          "titration_schedule": "string",
          "patient_adjustments": "string — renal/hepatic/weight adjustments if applicable"
        }},
        "duration": "string",
        "efficacy_monitoring": {{
          "parameters": ["string"],
          "target_values": ["string"],
          "assessment_timeline": "string"
        }},
        "safety_monitoring": {{
          "parameters": ["string"],
          "frequency": "string",
          "action_thresholds": ["string"]
        }},
        "key_interactions_with_current_meds": ["string"],
        "contraindications_relevant": ["string"],
        "alternatives_if_fails": [
          {{
            "drug": "string",
            "reason_preferred_over_primary": "string",
            "guideline_support": "string"
          }}
        ]
      }}
    ],
    "adjunct_therapy": [
      {{
        "drug": "string",
        "indication": "string",
        "rationale": "string",
        "guideline_support": "string",
        "dose": "string",
        "duration": "string",
        "monitoring": "string"
      }}
    ],
    "rescue_medications": [
      {{
        "drug": "string",
        "trigger": "string — when to use",
        "dose": "string",
        "max_frequency": "string"
      }}
    ],
    "medications_to_continue_unchanged": ["string — existing meds to keep"],
    "medications_to_discontinue": [
      {{
        "drug": "string",
        "reason": "string",
        "how_to_stop": "string — abrupt/taper/substitute"
      }}
    ],
    "medications_to_adjust": [
      {{
        "drug": "string",
        "current": "string",
        "recommended": "string",
        "reason": "string"
      }}
    ],
    "polypharmacy_score": "low|moderate|high|critical",
    "deprescribing_opportunities": ["string"]
  }},
  
  "procedural_plan": {{
    "procedures_indicated": [
      {{
        "procedure": "string",
        "indication_strength": "strong|moderate|weak",
        "timing": "immediate|urgent_within_24h|urgent_within_week|elective",
        "guideline_support": {{
          "guideline": "string",
          "recommendation_class": "I|IIa|IIb",
          "evidence_level": "A|B|C"
        }},
        "clinical_rationale": "string",
        "pre_procedure_requirements": ["string"],
        "risk_stratification": "low|moderate|high",
        "post_procedure_monitoring": ["string"],
        "expected_benefit": "string",
        "alternative_if_procedure_not_possible": "string"
      }}
    ],
    "procedures_not_indicated": [
      {{
        "procedure": "string",
        "reason_not_indicated": "string"
      }}
    ]
  }},
  
  "non_pharmacological_plan": {{
    "dietary": [
      {{
        "recommendation": "string — specific, not generic",
        "rationale": "string",
        "evidence_basis": "strong|moderate|weak",
        "specific_targets": "string (e.g., sodium <2g/day, not 'reduce salt')"
      }}
    ],
    "exercise": {{
      "recommendation": "string",
      "type": "string",
      "frequency": "string",
      "intensity": "string (use MET or RPE scale)",
      "contraindicated_activities": ["string"],
      "evidence_basis": "string"
    }},
    "lifestyle_modifications": [
      {{
        "modification": "string",
        "evidence_strength": "strong|moderate|weak",
        "expected_benefit": "string",
        "patient_instruction": "string — how to implement"
      }}
    ],
    "rehabilitation": {{
      "indicated": true,
      "type": "string",
      "frequency": "string",
      "goals": ["string"]
    }},
    "psychological_support": {{
      "indicated": true,
      "rationale": "string",
      "type": "string"
    }},
    "patient_education_priorities": [
      {{
        "topic": "string",
        "key_message": "string",
        "urgency": "critical|high|routine"
      }}
    ]
  }},
  
  "plan_evaluation": {{
    "standard_of_care_alignment": {{
      "aligned": true,
      "compliance_score": 0.0-1.0,
      "class_1_recommendations_addressed": ["string"],
      "justified_deviations": [
        {{
          "deviation": "string",
          "justification": "string",
          "documentation_required": "string"
        }}
      ],
      "medicolegal_documentation_needed": ["string"]
    }},
    "practical_feasibility": {{
      "feasibility_score": 0.0-1.0,
      "monitoring_feasible": true,
      "specialist_access_required": true,
      "infrastructure_gaps": ["string"],
      "workarounds": ["string"]
    }},
    "patient_centered_durability": {{
      "adherence_prediction": "high|moderate|low",
      "adherence_barriers": ["string"],
      "simplification_opportunities": ["string"],
      "long_term_sustainability": "sustainable|challenging|unsustainable",
      "sustainability_rationale": "string"
    }},
    "cost_rationality": {{
      "high_cost_components": [
        {{
          "item": "string",
          "cost_category": "very_high|high|moderate",
          "generic_alternative": "string or null",
          "clinical_equivalence": "equivalent|inferior|superior",
          "justification_for_expensive_choice": "string or null"
        }}
      ],
      "cost_effectiveness_overall": "cost_effective|acceptable|expensive_but_justified|not_justified",
      "estimated_monthly_cost_tier": "low|moderate|high|very_high"
    }}
  }},
  
  "monitoring_and_followup": {{
    "immediate_week_1": {{
      "clinical_review": "string",
      "labs": ["string"],
      "vitals": ["string"],
      "action_thresholds": ["string"]
    }},
    "month_1": {{
      "targets_to_achieve": ["string"],
      "parameters_to_check": ["string"],
      "escalation_criteria": ["string"],
      "de_escalation_criteria": ["string"]
    }},
    "long_term": {{
      "review_frequency": "string",
      "key_parameters": ["string"],
      "treatment_change_triggers": ["string"],
      "remission_criteria": "string or null"
    }},
    "emergency_warning_signs": [
      {{
        "sign": "string",
        "action": "string — call physician / go to ED immediately / call 911"
      }}
    ]
  }},
  
  "treatment_intelligence_summary": {{
    "top_3_priority_actions": [
      {{
        "rank": 1,
        "action": "string",
        "justification": "string — one sentence, guideline-referenced",
        "urgency": "immediate|within_24h|within_week|routine"
      }},
      {{
        "rank": 2,
        "action": "string",
        "justification": "string",
        "urgency": "immediate|within_24h|within_week|routine"
      }},
      {{
        "rank": 3,
        "action": "string",
        "justification": "string",
        "urgency": "immediate|within_24h|within_week|routine"
      }}
    ],
    "plan_confidence": 0.0-1.0,
    "confidence_rationale": "string — what drives or limits confidence",
    "plan_modifiers": [
      {{
        "condition": "string — what would change the plan",
        "would_change_to": "string"
      }}
    ],
    "physician_advisory_notice": "All recommendations are AI-ADVISORY. Final clinical decisions rest solely with the treating physician. Deviations from AI suggestions must be based on clinical judgment and documented accordingly.",
    "data_gaps_affecting_plan": ["string — missing data that would refine this plan"],
    "recommended_consults": [
      {{
        "specialty": "string",
        "urgency": "emergent|urgent|routine",
        "specific_question": "string"
      }}
    ]
  }},
  
  "confidence_score": 0.0-1.0
}}

CRITICAL:
Return ONLY valid JSON. No markdown. No bullets. No text outside JSON.
Start with {{ and end with }}.
"""
        
        try:
            response = self.llm.invoke([
                SystemMessage(content=(
                    'You are a senior clinical treatment intelligence system.'
                    'Create a patient-specific, guideline-based treatment plan.'
                    'Explain WHY each recommendation applies to THIS patient.'
                    'Include guideline name, recommendation class, and evidence level.'
                    'Return ONLY valid JSON. No text outside JSON.'
                )),
                HumanMessage(content=prompt)
            ])
            logger.info(f"advanced treatmentplan:{response}")
            result = self._parse_response(response.content)
            
            # Store result
            state["advanced_treatment_intelligence"] = result
            state["confidence_scores"]["advanced_treatment_intelligence"] = result.get("confidence_score", 0.0)
            
            # Extract top priority warnings
            summary = result.get("treatment_intelligence_summary", {})
            top_actions = summary.get("top_3_priority_actions", [])
            
            for action in top_actions:
                if action.get("urgency") == "immediate":
                    state["warnings"].append(
                        f"🧠 TREATMENT PRIORITY [{action.get('rank')}]: {action.get('action')} — {action.get('justification')}"
                    )
            
            # Flag data gaps
            data_gaps = summary.get("data_gaps_affecting_plan", [])
            for gap in data_gaps:
                state["warnings"].append(f"⚠️ DATA GAP: {gap}")
            
            # Flag if plan confidence is low
            if result.get("confidence_score", 1.0) < 0.6:
                state["requires_review"] = True
                state["warnings"].append(
                    f"🔍 TREATMENT PLAN CONFIDENCE LOW ({result.get('confidence_score', 0):.0%}) — Senior physician review strongly recommended"
                )
            
            # Flag guideline conflicts
            guideline_framework = result.get("guideline_framework", {})
            conflicts = guideline_framework.get("guideline_consensus", {}).get("areas_of_conflict", [])
            for conflict in conflicts:
                state["warnings"].append(
                    f"⚖️ GUIDELINE CONFLICT: {conflict.get('recommendation')} — {conflict.get('recommended_resolution')}"
                )
            
            # Check cost rationality
            cost = result.get("plan_evaluation", {}).get("cost_rationality", {})
            if cost.get("cost_effectiveness_overall") == "not_justified":
                state["warnings"].append("💰 COST ALERT: Treatment plan cost-effectiveness not justified — review alternatives")
            
            # Flag poor adherence prediction
            durability = result.get("plan_evaluation", {}).get("patient_centered_durability", {})
            if durability.get("adherence_prediction") == "low":
                state["warnings"].append("⚠️ LOW ADHERENCE PREDICTED — Consider regimen simplification")
            
            logger.info("✅ Advanced Treatment Intelligence Agent: Analysis complete")
            logger.info(f"   Plan confidence: {result.get('confidence_score', 0):.0%}")
            logger.info(f"   Primary intent: {result.get('clinical_objectives', {}).get('primary_intent', 'unknown')}")
            logger.info(f"   Guideline: {result.get('guideline_framework', {}).get('primary_guideline', {}).get('name', 'unknown')}")
            
        except Exception as e:
            logger.error(f"❌ Advanced Treatment Intelligence Agent failed: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            state["error"] = f"Treatment intelligence analysis failed: {str(e)}"
        
        return state
    
    def _parse_response(self, content: str) -> dict:
        try:
            content = content.strip()

            # 🔥 Remove LangChain metadata after JSON
            if "additional_kwargs" in content:
                content = content.split("' additional_kwargs", 1)[0]

            # Extract JSON block
            start = content.find("{")
            if start == -1:
                raise ValueError("No JSON start")

            json_candidate = content[start:]

            # Try strict parse first
            return json.loads(json_candidate)

        except json.JSONDecodeError as e:
            logger.warning(f"⚠️ JSON incomplete (likely truncated): {e}")
            return {
                "raw_content": content,
                "confidence_score": 0.3,
                "retry_needed": True
            }












# =====================================================================
# AGENT 14: DISCHARGE READINESS AGENT
# =====================================================================

class DischargeReadinessAgent:
    """
    Evaluates discharge safety and planning
    
    IMPORTANCE:
    - Prevents 30-day readmissions (major quality metric)
    - Ensures safe transitions of care
    - Medicolegal protection
    - Patient safety
    
    PLACEMENT: Execute NEAR END of workflow (after outcome reasoning)
    """
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
    
    def analyze(self, state: dict) -> dict:
        """Assess discharge readiness"""
    
        logger.info("🏠 Discharge Readiness Agent: Starting analysis")
        optimized_context = build_discharge_context(state)
        prompt = f"""
    Discharge planning expert - safe care transitions to prevent 30-day readmissions.

    {optimized_context}

    EVALUATE: Discharge readiness and create comprehensive plan.

    CRITERIA:
    1. MEDICAL STABILITY
       - Vitals stable, no active deterioration, acute issues resolved/controlled
       - Pain controlled, no urgent issues, safe O2 on sustainable level
       - Acceptable oral intake, bowel/bladder function adequate

    2. TREATMENT GOALS MET
       - Primary admission goals achieved, key milestones reached
       - Diagnostic workup complete (or outpatient plan)
       - Treatment response adequate, surgical/procedural recovery appropriate

    3. ORAL MEDICATION TRANSITION
       - IV to PO complete, reconciliation done
       - Patient able to take oral meds
       - Drug-drug interactions addressed, prescription plan clear

    4. FUNCTIONAL STATUS
       - ADLs acceptable, mobility safe (or assistive devices arranged)
       - Fall risk assessed, PT completed/arranged, OT needs addressed

    5. HOME SUPPORT
       - Caregiver availability, home environment safe
       - DME arranged, home health services arranged if needed
       - Family education complete

    6. FOLLOW-UP ARRANGEMENTS
       - PCP appointment scheduled (within 7 days if high risk)
       - Specialist appointments scheduled
       - Pending test results tracked, who checks results?
       - 30-day readmission prevention plan

    7. PATIENT EDUCATION
       - Discharge diagnosis understood, medication instructions clear
       - Warning signs understood, when to seek emergency care
       - Activity restrictions clear, diet instructions clear
       - Wound care (if applicable)

    8. DOCUMENTATION COMPLETE
       - Discharge summary ready, medication reconciliation documented
       - Follow-up plan documented, pending tests documented
       - Contact information provided

    9. READMISSION RISK STRATIFICATION
       Tools: LACE Index (Length, Acuity, Comorbidities, ED visits), HOSPITAL Score
       High-risk: recent admission (<30d), multiple comorbidities, polypharmacy, low health literacy, poor social support, LAMA, unplanned discharge

    10. BARRIERS
        Medical, social, financial, transportation, home safety, caregiver burden

    SPECIAL POPULATIONS:
    Elderly: comprehensive geriatric assessment, medication review (Beers), fall prevention, cognitive assessment, caregiver stress
    Pediatric: parent education, immunization status, school/daycare return, developmental considerations
    Oncology: neutropenic precautions, bleeding precautions, when to call oncologist, chemo schedule
    Cardiology: weight monitoring, fluid restriction, HF red flags, anticoagulation plan

    RULES:
    - Never discharge unstable
    - Ensure 7-day PCP follow-up for high-risk
    - Document all barriers
    - Ensure medication access (insurance/cost)
    - Verify understanding with teach-back
    - Arrange transportation if needed

    CRITICAL OUTPUT RULES:
    - ALL string fields: Maximum 10 words unless marked [LONG]
    - Rationales: Maximum 15 words, focus on KEY reason only
    - Descriptions: Maximum 12 words, essential information only
    - Lists: Maximum 5 items unless critical
    - Use medical abbreviations: MI not "myocardial infarction"
    - Be telegraphic: "Pt has 3 high-risk factors" not "The patient presents with three significant risk factors"
    - NO preambles, NO explanations, DIRECT answers only
    - Example good: "HTN, DM, CKD increase CVD risk 3x"
    - Example bad: "The patient's hypertension, diabetes, and chronic kidney disease significantly increase their cardiovascular disease risk by approximately three times"

    OUTPUT (JSON):
    {{
      "discharge_readiness_assessment": {{
        "ready_for_discharge": true|false,
        "overall_readiness_score": 0.0-1.0,
        "assessment_summary": "string"
      }},
      "medical_stability": {{
        "stable": true|false,
        "criteria_met": [{{
          "criterion": "string",
          "status": "met|not_met|partially_met",
          "details": "string"
        }}],
        "outstanding_medical_issues": ["string"],
        "estimated_time_to_stability": "ready_now|hours|days"
      }},
      "treatment_goals_status": {{
        "primary_goals_met": true|false,
        "goals_achieved": ["string"],
        "goals_still_pending": ["string"],
        "acceptable_to_discharge_with_pending_goals": true|false
      }},
      "medication_plan": {{
        "iv_to_po_complete": true|false,
        "reconciliation_complete": true|false,
        "prescriptions_written": true|false,
        "patient_understands_medications": true|false,
        "medication_access_barriers": ["string"],
        "pharmacy_contacted": true|false
      }},
      "functional_status": {{
        "adl_status": "independent|needs_assistance|dependent",
        "mobility": "independent|walker|wheelchair|bedbound",
        "fall_risk": "low|moderate|high",
        "pt_ot_needs": "complete|arranged_outpatient|needs_arrangement"
      }},
      "home_support": {{
        "adequate_caregiver": true|false,
        "caregiver_name": "string or unknown",
        "home_environment_safe": true|false,
        "dme_needed": ["string"],
        "dme_arranged": true|false,
        "home_health_needed": true|false,
        "home_health_arranged": true|false,
        "barriers_to_home_discharge": ["string"]
      }},
      "follow_up_plan": {{
        "pcp_appointment": {{
          "scheduled": true|false,
          "date": "string or not_scheduled",
          "within_7_days": true|false
        }},
        "specialist_appointments": [{{
          "specialty": "string",
          "scheduled": true|false,
          "urgency": "urgent|routine",
          "date": "string or not_scheduled"
        }}],
        "pending_results": [{{
          "test": "string",
          "expected_date": "string",
          "who_will_check": "string",
          "action_if_abnormal": "string"
        }}]
      }},
      "patient_education": {{
        "education_completed": true|false,
        "teach_back_verified": true|false,
        "patient_understands": {{
          "diagnosis": true|false,
          "medications": true|false,
          "warning_signs": true|false,
          "when_to_seek_care": true|false,
          "activity_restrictions": true|false
        }},
        "written_instructions_provided": true|false,
        "health_literacy_concerns": true|false
      }},
      "readmission_risk": {{
        "risk_level": "low|moderate|high|very_high",
        "lace_index": 0-15,
        "hospital_score": 0-10,
        "risk_factors": [{{
          "factor": "string",
          "impact": "high|moderate|low"
        }}],
        "30_day_readmission_probability": 0-100,
        "prevention_strategies": ["string"]
      }},
      "barriers_to_discharge": [{{
        "barrier": "string",
        "category": "medical|social|financial|other",
        "severity": "critical|major|moderate|minor",
        "resolution_plan": "string",
        "estimated_resolution_time": "string"
      }}],
      "discharge_disposition": {{
        "recommended_disposition": "home|home_with_home_health|skilled_nursing|rehab|hospice|other",
        "alternative_dispositions": ["string"],
        "rationale": "string"
      }},
      "discharge_timing": {{
        "safe_to_discharge_today": true|false,
        "estimated_discharge_date": "string",
        "delays": ["string"]
      }},
      "required_actions_before_discharge": [{{
        "action": "string",
        "responsible_party": "string",
        "urgency": "must_complete|should_complete|nice_to_have",
        "estimated_time": "string"
      }}],
      "high_risk_patient_interventions": ["string"],
      "care_transitions_checklist": {{
        "discharge_summary_complete": true|false,
        "medication_list_reconciled": true|false,
        "follow_up_scheduled": true|false,
        "patient_education_documented": true|false,
        "dme_arranged": true|false,
        "home_services_arranged": true|false,
        "prescriptions_sent": true|false,
        "transportation_arranged": true|false
      }},
      "red_flags_preventing_discharge": ["string"],
      "confidence_score": 0.0-1.0
    }}
    CRITICAL:
    Return ONLY valid JSON.
    No markdown.
    No bullets.
    No headings.
    No explanations.
    No text outside JSON.
    Start with {{ and end with }}.
    If you output anything else the system will crash.

    1. You MUST ONLY use information explicitly present in the INPUT DATA below
    2. If a field is empty/missing, you MUST state "No data provided" 
    3. NEVER invent symptoms, lab values, imaging findings, or diagnoses
    4. If insufficient data exists, you MUST respond with limitations
    5. For "routine check-up" with no symptoms: Focus on health maintenance
    """
        
        try:
            response = self.llm.invoke([
                SystemMessage(content="You are a discharge planning expert ensuring safe care transitions."),
                HumanMessage(content=prompt)
            ])
            
            result = self._parse_response(response.content)
            state["discharge_readiness"] = result
            
            # Set confidence score
            state["confidence_scores"]["discharge_readiness"] = result.get("confidence_score", 0.0)
            
            # Check if ready for discharge
            assessment = result.get("discharge_readiness_assessment", {})
            if not assessment.get("ready_for_discharge"):
                state["warnings"].append(
                    f"🏥 NOT READY FOR DISCHARGE - {assessment.get('assessment_summary', 'Multiple barriers present')}"
                )
            
            # Check readmission risk
            readmission = result.get("readmission_risk", {})
            if readmission.get("risk_level") in ["high", "very_high"]:
                state["warnings"].append(
                    f"⚠️ HIGH READMISSION RISK - LACE: {readmission.get('lace_index')}, 30-day risk: {readmission.get('30_day_readmission_probability')}%"
                )
                state["requires_review"] = True
            
            # Flag red flags
            red_flags = result.get("red_flags_preventing_discharge", [])
            for flag in red_flags:
                state["warnings"].append(f"🚫 DISCHARGE RED FLAG: {flag}")
                state["requires_review"] = True
            
            # Flag critical barriers
            barriers = result.get("barriers_to_discharge", [])
            for barrier in barriers:
                if barrier.get("severity") == "critical":
                    state["warnings"].append(
                        f"⚠️ CRITICAL BARRIER: {barrier['barrier']}"
                    )
            
            logger.info("✅ Discharge Readiness Agent: Analysis complete")
            
        except Exception as e:
            logger.error(f"❌ Discharge Readiness Agent failed: {str(e)}")
            state["error"] = f"Discharge readiness assessment failed: {str(e)}"
        
        return state
    
    def _parse_response(self, content: str) -> dict:
        """Parse LLM response to JSON"""
        try:
            content = content.strip()
            
            if "```json" in content:
                json_part = content.split("```json", 1)[1]
                json_part = json_part.split("```", 1)[0]
                return json.loads(json_part.strip())
            
            start = content.find("{")
            end = content.rfind("}")
            if start != -1 and end != -1:
                return json.loads(content[start:end + 1])
            
            raise ValueError("No JSON found in response")
            
        except Exception as e:
            logger.warning(f"⚠️ Discharge Readiness JSON parse failed: {e}")
            return {
                "raw_content": content,
                "confidence_score": 0.5
            }







class LongitudinalStoryAgent:
    """
    Generates intelligent longitudinal patient stories using:
    - Knowledge Graph temporal relationships
    - Vector similarity for context
    - LLM for narrative generation with clinical reasoning
    """
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
    
    async def generate_story(
        self,
        patient_id: str,
        state: ClinicalReasoningState
    ) -> Dict[str, Any]:
        """
        Generate complete longitudinal story using hybrid RAG approach
        """
        logger.info(f"📖 Generating longitudinal story for patient {patient_id}")
        
        try:
            # Step 1: Get temporal story data from Knowledge Graph
            story_data = await graph_rag_system.get_temporal_story_data(patient_id)
            
            if not story_data or not story_data.get("events"):
                return {
                    "error": "No temporal data available",
                    "story": "Insufficient data to generate patient story"
                }
            
            events = story_data["events"]
            episodes = story_data.get("episodes", [])
            
            logger.info(f"📊 Retrieved {len(events)} events and {len(episodes)} episodes from graph")
            
            # Step 2: Group events into clinical episodes with reasoning
            episode_narratives = await self._generate_episode_narratives(
                events,
                episodes,
                state
            )
            logger.info(f"thomas_episode_narratives:{episode_narratives}")
            # Step 3: Generate overall story with correlations
            complete_story = await self._generate_complete_story(
                episode_narratives,
                events,
                state
            )
            logger.info(f"thomas_complete_story:{episode_narratives}")
            # Step 4: Extract insights
            insights = await self._extract_insights(complete_story, events)
            
            return {
                "patient_id": patient_id,
                "complete_story": complete_story,
                "episode_narratives": episode_narratives,
                "timeline_events": events,
                "insights": insights,
                "total_events": len(events),
                "total_episodes": len(episodes),
                "generated_at": datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"❌ Story generation failed: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            return {
                "error": str(e),
                "story": "Story generation failed"
            }
    
    async def _generate_episode_narratives(
        self,
        events: List[Dict[str, Any]],
        episodes: List[Dict[str, Any]],
        state: ClinicalReasoningState
    ) -> List[Dict[str, Any]]:
        """
        Generate narrative for each episode using graph relationships
        """
        episode_narratives = []
        
        # Group events by episode
        for ep_num, episode in enumerate(episodes, 1):
            # Get events for this episode
            ep_events = [e for e in events 
                        if e["date"] >= episode["start_date"] and e["date"] <= episode["end_date"]]
            
            if not ep_events:
                continue
            
            # Generate narrative with causal reasoning
            narrative = await self._generate_single_episode_narrative(
                ep_num,
                ep_events,
                episode,
                state
            )
            
            episode_narratives.append({
                "episode_number": ep_num,
                "start_date": str(episode["start_date"]),
                "end_date": str(episode["end_date"]),
                "duration_days": (episode["end_date"] - episode["start_date"]).days if hasattr(episode["end_date"], 'days') else 0,
                "event_count": len(ep_events),
                "narrative": narrative
            })
        
        return episode_narratives
    
    async def _generate_single_episode_narrative(
        self,
        episode_number: int,
        events: List[Dict[str, Any]],
        episode: Dict[str, Any],
        state: ClinicalReasoningState
    ) -> str:
        """
        Generate intelligent narrative for single episode
        Uses graph relationships to show causality
        """
        # Format events with causal relationships
        event_descriptions = []
        for event in events:
            desc = f"[{event['date']}] {event['summary']}"
            
            # Add causal relationships
            if event.get("influenced"):
                influenced = [inf for inf in event["influenced"] if inf]
                if influenced:
                    desc += f" → Led to: {', '.join(influenced[:2])}"
            
            event_descriptions.append(desc)
        
        # Get relevant context from RAG
        rag_context = state.get("rag_context", {})
        critical_summary = rag_context.get("vector_results", "")
        
        prompt = f"""You are a senior physician writing a clinical narrative for ONE episode of care.

EPISODE #{episode_number}
Duration: {episode.get('event_count', 0)} events over {(episode.get('end_date', episode.get('start_date')) - episode.get('start_date')).days if hasattr(episode.get('end_date'), '__sub__') else 'unknown'} days
Date Range: {episode.get('start_date')} to {episode.get('end_date')}

CHRONOLOGICAL EVENTS WITH CAUSAL RELATIONSHIPS:
{chr(10).join(event_descriptions)}

PATIENT CONTEXT:
{critical_summary}

TASK:
Write ONE paragraph (4-6 sentences) that tells the clinical story as a human physician would.

REQUIREMENTS:
1. **Show causality**: Use the "→ Led to:" information to explain WHY things happened
2. **Clinical reasoning**: Explain the logic behind decisions
3. **Connect events**: "Due to elevated troponin, cardiology recommended...", "Following CT findings of acute appendicitis, patient underwent..."
4. **Natural flow**: Write as you would in a discharge summary
5. **One paragraph only**: 4-6 sentences maximum

EXAMPLE GOOD NARRATIVE:
"Patient presented to ED with acute chest pain and was found to have elevated troponin at 2.5 ng/mL, prompting urgent cardiology consultation. Subsequent cardiac catheterization revealed 90% LAD stenosis, which led to immediate PCI with drug-eluting stent placement. Post-procedure course was complicated by access site bleeding requiring 2 units PRBC transfusion. Follow-up echocardiogram showed preserved EF at 55%, and patient was successfully transitioned to oral antiplatelet therapy with plans for outpatient cardiac rehabilitation."

Write the narrative (ONE paragraph, no headers, no bullets):"""
        
        try:
            response = await self.llm.ainvoke([
                SystemMessage(content="You are a senior physician writing concise clinical narratives with causal reasoning."),
                HumanMessage(content=prompt)
            ])
            logger.debug("long")
            logger.debug(response.content)
            narrative = response.content.strip()
            # Clean up formatting
            narrative = narrative.replace("**", "").replace("*", "").replace("#", "")
            # Remove any bullet points or numbers
            narrative = re.sub(r'^\d+\.\s*', '', narrative)
            narrative = re.sub(r'^[-•]\s*', '', narrative)
            
            return narrative
            
        except Exception as e:
            logger.error(f"Episode narrative generation failed: {e}")
            return f"Episode {episode_number}: {len(events)} events recorded."
    
    async def _generate_complete_story(
        self,
        episode_narratives: List[Dict[str, Any]],
        all_events: List[Dict[str, Any]],
        state: ClinicalReasoningState
    ) -> str:
        """
        Generate overall story connecting all episodes
        Shows progression and clinical trajectory
        """
        if not episode_narratives:
            return "No episodes available to generate story."
        
        # Format episode narratives
        episode_texts = []
        for ep in episode_narratives:
            episode_texts.append(f"""
**Episode {ep['episode_number']}** ({ep['start_date']} to {ep['end_date']}, {ep['event_count']} events):
{ep['narrative']}
""")
        
        # Get patient diagnosis context
        diagnoses = state.get("clinical_context", {}).get("active_diagnoses", [])
        primary_diagnosis = diagnoses[0] if diagnoses else "Unknown condition"
        
        # Calculate trajectory from graph relationships
        improvement_indicators = sum(1 for e in all_events if "improved" in str(e.get("summary", "")).lower())
        deterioration_indicators = sum(1 for e in all_events if any(term in str(e.get("summary", "")).lower() 
                                                                    for term in ["worsening", "elevated", "decreased"]))
        
        trajectory = "stable"
        if improvement_indicators > deterioration_indicators * 1.5:
            trajectory = "improving"
        elif deterioration_indicators > improvement_indicators * 1.5:
            trajectory = "declining"
        
        prompt = f"""You are a senior physician creating a comprehensive longitudinal summary spanning multiple episodes of care.

PRIMARY DIAGNOSIS: {primary_diagnosis}
OVERALL TRAJECTORY: {trajectory}
TOTAL EPISODES: {len(episode_narratives)}
TOTAL EVENTS: {len(all_events)}

EPISODE NARRATIVES:
{chr(10).join(episode_texts)}

TASK:
Write a cohesive 2-3 paragraph summary that connects all episodes into one patient journey.

STRUCTURE:
**Paragraph 1**: Opening + Initial presentation
- Start with: "This patient with [primary diagnosis] has had a [trajectory] clinical course over [timeframe]."
- Describe initial presentation and first episode

**Paragraph 2**: Disease progression and key turning points
- How did condition evolve across episodes?
- What were the critical moments? (diagnostic findings, treatment changes, complications)
- Show cause-and-effect across episodes: "Despite initial treatment, subsequent admission revealed..."

**Paragraph 3**: Current status and overall assessment
- Where patient stands now
- Overall response to treatment
- Remaining challenges or concerns

STYLE:
- Natural medical prose (not bullet points)
- Show clinical reasoning and causality
- Write for physician-to-physician communication
- Maximum 3 paragraphs, 4-6 sentences each

Write the complete story (2-3 paragraphs, no headers):"""
        
        try:
            response = await self.llm.ainvoke([
                SystemMessage(content="You are a senior physician synthesizing complex longitudinal patient journeys into coherent narratives."),
                HumanMessage(content=prompt)
            ])
            
            story = response.content.strip()
            # Clean formatting
            story = story.replace("**", "").replace("*", "")
            
            return story
            
        except Exception as e:
            logger.error(f"Complete story generation failed: {e}")
            # Fallback
            return "\n\n".join([f"Episode {ep['episode_number']}: {ep['narrative']}" 
                              for ep in episode_narratives])
    
    async def _extract_insights(
        self,
        complete_story: str,
        events: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Extract key clinical insights from story"""
        
        prompt = f"""Extract key clinical insights from this patient journey:

STORY:
{complete_story}

TOTAL EVENTS: {len(events)}

Extract and return as JSON:
{{
  "trajectory": "improving|stable|declining|fluctuating",
  "key_turning_points": ["event that changed outcome"],
  "recurring_patterns": ["patterns across episodes"],
  "treatment_response": "excellent|good|partial|poor",
  "current_state_summary": "one sentence",
  "ongoing_risks": ["risk factor"]
}}"""
        
        try:
            response = await self.llm.ainvoke([
                SystemMessage(content="Extract structured insights from narratives. Return only valid JSON."),
                HumanMessage(content=prompt)
            ])
            
            content = response.content.strip()
            if "```json" in content:
                content = content.split("```json", 1)[1].split("```", 1)[0]
            
            insights = json.loads(content)
            return insights
            
        except Exception as e:
            logger.error(f"Insights extraction failed: {e}")
            return {
                "trajectory": "unknown",
                "error": "Insights extraction failed"
            }




# =====================================================================
# WORKFLOW ORCHESTRATOR
# =====================================================================








# =====================================================================
# MAIN EXECUTION FUNCTION
# =====================================================================

def normalize_risk_stratification(raw: dict) -> dict:
    domains = raw.get("risk_domains", {})

    return {
        "risk_level": raw.get("overall_risk_category", "moderate"),
        "risk_score": raw.get("risk_score", 0.5),

        "mortality": {
            "short_term": domains.get("mortality", {})
                                 .get("short_term", {})
                                 .get("level", "unknown"),
            "long_term": domains.get("mortality", {})
                                .get("long_term", {})
                                .get("level", "unknown"),
        },

        "morbidity": {
            "level": domains.get("morbidity", {}).get("probability", "unknown"),
            "complications": domains.get("morbidity", {}).get("complications", [])
        },

        "treatment_risk": domains.get("treatment_risk", {}).get("overall_level", "unknown"),

        "time_sensitive": raw.get("requires_immediate_action", False),

        "immediate_risks": [
            r.get("risk") for r in raw.get("time_sensitive_risks", [])
        ],

        "mitigation_actions": [
            r.get("intervention") for r in raw.get("risk_mitigation_priority", [])[:3]
        ],

        "red_flags": raw.get("red_flags", []),

        "requires_review": (
            raw.get("requires_immediate_action", False)
            or raw.get("overall_risk_category") == "critical"
        ),

        "confidence_score": raw.get("confidence_score", 0.5)
    }






@router.post("/clinical-reasoning/longitudinal-story")
async def get_longitudinal_story(request: ClinicalReasoningRequest):
    """
    Generate longitudinal patient story using Graph-RAG
    Standalone endpoint for story retrieval
    """
    try:
        logger.info(f"📖 Longitudinal Story Request: Patient={request.patient_id}")
        
        # Fetch contexts
        medical_context = await fetch_medical_context(request.patient_id, request.doctor_id)
        clinical_context = await fetch_clinical_context(request.patient_id, request.doctor_id)
        longitudinal_context = await fetch_longitudinal_context(request.patient_id, request.doctor_id)
        
        # Index into Graph-RAG
        await graph_rag_system.index_patient_data(
            patient_id=request.patient_id,
            medical_context=medical_context,
            clinical_context=clinical_context,
            longitudinal_context=longitudinal_context
        )
        
        # Generate story
        story_result = await longitudinal_story_agent.generate_story(
            request.patient_id,
            {
                "patient_id": request.patient_id,
                "rag_context_structured": {},
                "clinical_context": clinical_context
            }
        )
        
        return {
            "status": "success",
            "story": story_result,
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"❌ Story generation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))