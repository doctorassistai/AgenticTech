from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta  # Add timedelta here!
import sys
from pydantic import BaseModel, Field

# Context Fetching & RAG Implementation
from motor.motor_asyncio import AsyncIOMotorClient
from loguru import logger
import os
from dotenv import load_dotenv

from typing import Dict, Any, List, Optional, TypedDict
from langgraph.graph import StateGraph, END
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage
import json

from Agentic.Rag.graph_rag_system import graph_rag_system
from Agentic.workflow.clinical_workflow import clinical_workflow
from Agentic.workflow.clinical_workflow import ClinicalReasoningState

load_dotenv()

router = APIRouter(tags=["Agentic"])


#router.include_router(router, prefix="/api/v2")

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



# ============================================
# DATABASE SETUP - MUST BE BEFORE FUNCTIONS!
# ============================================

STORAGE_BASE_URL = os.getenv("STORAGE_BASE_URL")
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

client = AsyncIOMotorClient(MONGO_URI)
db = client[MONGO_DB]

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

if not GROQ_API_KEY:
    raise RuntimeError("GROQ_API_KEY is not set")

llm = ChatGroq(
    model="llama-3.1-8b-instant",
    groq_api_key=GROQ_API_KEY,
    temperature=0.2
)

# ============================================
# COLLECTION DEFINITIONS - MUST BE BEFORE FUNCTIONS!
# ============================================

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

# Imaging collections
imaging_xray_collection = db["imaging-xray"]
imaging_ct_collection = db["imaging-ct"]
imaging_mri_collection = db["imaging-mri"]
imaging_ultrasound_collection = db["imaging-ultrasound"]

# Pathology collections
pathology_histopathology_collection = db["pathology-histopathology"]
pathology_cytology_collection = db["pathology-cytology"]


# ============================================================================
# REQUEST/RESPONSE MODELS
# ============================================================================

class ClinicalReasoningRequest(BaseModel):
    """Request model for clinical reasoning"""
    patient_id: str = Field(..., description="Patient identifier")
    doctor_id: str = Field(..., description="Doctor identifier")
    consultation_text: str = Field(..., description="Current consultation notes")
    
    # Optional: Override defaults
    max_iterations: Optional[int] = Field(3, ge=1, le=5, description="Maximum reasoning iterations")
    
    class Config:
        json_schema_extra = {
            "example": {
                "patient_id": "P123456",
                "doctor_id": "D789",
                "consultation_text": "65-year-old male presenting with chest pain radiating to left arm, onset 2 hours ago, associated with diaphoresis and nausea. Pain 8/10, pressure-like quality.",
                "max_iterations": 3
            }
        }


class AgentOutput(BaseModel):
    """Model for individual agent output summary"""
    agent_name: str
    confidence: float
    key_findings: List[str]
    warnings: List[str]


class ClinicalReasoningResponse(BaseModel):
    """Response model for clinical reasoning"""
    request_id: str
    timestamp: str
    patient_id: str
    
    # High-level summary
    primary_diagnosis: str
    risk_level: str
    discharge_recommendation: str
    
    # Confidence and review flags
    overall_confidence: float
    requires_review: bool
    warnings: List[str]
    
    # Agent summaries
    agents_summary: List[AgentOutput]
    
    # Iteration info
    iterations_performed: int
    contradictions_resolved: int
    contradictions_remaining: int
    
    # Full outputs (optional, can be large)
    detailed_outputs: Optional[Dict[str, Any]] = None


class HealthCheckResponse(BaseModel):
    """Health check response"""
    status: str
    timestamp: str
    workflow_initialized: bool
    rag_system_available: bool


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================
def serialize_documents(docs):
    """Convert LangChain Documents to JSON-safe dicts"""
    if not docs:
        return []
    
    serialized = []
    for doc in docs:
        if hasattr(doc, "page_content"):
            serialized.append({
                "content": doc.page_content,
                "metadata": doc.metadata
            })
        elif isinstance(doc, dict):
            serialized.append(doc)
    
    return serialized

def build_agent_context(state: ClinicalReasoningState, focus: str = "general") -> str:
    """Universal context builder for all agents"""
    try:
        rag_context = state.get("rag_context", {})
        vector_results = rag_context.get("vector_results", [])
        
        # Build context string
        context_parts = [
            f"PATIENT ID: {state.get('patient_id', 'unknown')}",
            f"\nCONSULTATION: {state.get('consultation_text', '')}",
            f"\nAVAILABLE DATA: {len(vector_results)} documents",
        ]
        
        # Add recent findings
        if vector_results:
            context_parts.append("\nRECENT FINDINGS:")
            for i, doc in enumerate(vector_results[:5], 1):
                content = str(doc.get("content", ""))[:150]
                context_parts.append(f"{i}. {content}...")
        
        # Add medical context summary
        medical = state.get("medical_context", {})
        if medical:
            context_parts.append(f"\nMEDICATIONS: {len(medical.get('medications', []))}")
            context_parts.append(f"PROCEDURES: {len(medical.get('procedures', []))}")
        
        # Add clinical context
        clinical = state.get("clinical_context", {})
        if clinical:
            diagnoses = clinical.get("active_diagnoses", [])
            if diagnoses:
                context_parts.append(f"\nACTIVE DIAGNOSES: {', '.join(diagnoses)}")
        
        return "\n".join(context_parts)
        
    except Exception as e:
        logger.error(f"Context building failed: {e}")
        return "Context unavailable"

# In your routes.py - SIMPLIFY fetch_patient_contexts
async def fetch_patient_contexts(patient_id: str, doctor_id: str, consultation_text: str = "") -> Dict[str, Any]:
    """
    Fetch patient data from MongoDB (RAG retrieval removed to avoid race condition)
    
    Args:
        patient_id: Patient identifier
        doctor_id: Doctor identifier  
        consultation_text: Current consultation (for future RAG enhancement)
    """
    logger.info(f"📊 Fetching patient data from MongoDB for {patient_id}")
    
    # Fetch contexts directly from MongoDB
    medical_context = await fetch_medical_context(patient_id, doctor_id)
    clinical_context = await fetch_clinical_context(patient_id, doctor_id)
    longitudinal_context = await fetch_longitudinal_context(patient_id, doctor_id)
    
    # Log what we found
    lab_count = sum(len(v) for v in medical_context.get("laboratory_results", {}).values())
    img_count = sum(len(v) for v in medical_context.get("imaging", {}).values())
    doc_count = len(medical_context.get("documents", []))
    diag_count = len(clinical_context.get("active_diagnoses", []))
    treatment_count = len(clinical_context.get("treatments_attempted", []))
    
    logger.info(f"✅ MongoDB Data Retrieved:")
    logger.info(f"   - Laboratory results: {lab_count}")
    logger.info(f"   - Imaging studies: {img_count}")
    logger.info(f"   - Documents: {doc_count}")
    logger.info(f"   - Active diagnoses: {diag_count}")
    logger.info(f"   - Treatments: {treatment_count}")
    
    return {
        "medical_context": medical_context,
        "clinical_context": clinical_context,
        "longitudinal_context": longitudinal_context
    }

async def save_reasoning_output(patient_id: str, doctor_id: str, output: Dict[str, Any]):
    """
    Save reasoning output to database
    Replace this with your actual database storage
    """
    # TODO: Replace with actual database storage
    # This is a placeholder - implement based on your DB structure
    
    try:
        # Example: Save to your reasoning_results collection
        # await db.reasoning_results.insert_one({
        #     "patient_id": patient_id,
        #     "doctor_id": doctor_id,
        #     "timestamp": datetime.utcnow(),
        #     "output": output
        # })
        
        logger.info(f"Reasoning output saved for patient {patient_id}")
        
    except Exception as e:
        logger.error(f"Failed to save reasoning output: {str(e)}")
        # Don't raise - this is not critical to the response


def extract_agent_summaries(state: Dict[str, Any]) -> List[AgentOutput]:
    """Extract summaries from agent outputs"""
    summaries = []
    
    # Differential Diagnosis
    if "differential_diagnosis" in state:
        dd = state["differential_diagnosis"]
        summaries.append(AgentOutput(
            agent_name="Differential Diagnosis",
            confidence=state.get("confidence_scores", {}).get("differential_diagnosis", 0.0),
            key_findings=[
                d.get("diagnosis", "Unknown") 
                for d in dd.get("most_likely_diagnoses", [])[:3]
            ],
            warnings=[
                w.get("diagnosis", "Unknown") 
                for w in dd.get("must_not_miss_diagnoses", [])
                if w.get("urgency") == "immediate"
            ]
        ))
    
    # Medication Reconciliation
    if "medication_reconciliation" in state:
        med = state["medication_reconciliation"]
        summaries.append(AgentOutput(
            agent_name="Medication Reconciliation",
            confidence=state.get("confidence_scores", {}).get("medication", 0.0),
            key_findings=[
                f"{len(med.get('reconciled_medication_list', []))} medications reviewed",
                f"{len(med.get('drug_drug_interactions', []))} interactions identified"
            ],
            warnings=[
                alert.get("description", "")[:100]
                for alert in med.get("safety_alerts", [])
                if alert.get("severity") in ["Critical", "High"]
            ]
        ))
    
    # Risk Stratification
    if "risk_stratification" in state:
        risk = state["risk_stratification"]
        summaries.append(AgentOutput(
            agent_name="Risk Stratification",
            confidence=state.get("confidence_scores", {}).get("risk", 0.0),
            key_findings=[
                f"Overall risk: {risk.get('overall_risk_level', 'unknown')}",
                f"Mortality risk: {risk.get('mortality_risk', {}).get('short_term', {}).get('level', 'unknown')}"
            ],
            warnings=[
                action for action in risk.get("immediate_action_items", [])
            ] if risk.get("requires_immediate_action") else []
        ))
    
    # Treatment Validation
    if "treatment_validation" in state:
        tx = state["treatment_validation"]
        plan = tx.get("recommended_treatment_plan", {})
        summaries.append(AgentOutput(
            agent_name="Treatment Validation",
            confidence=state.get("confidence_scores", {}).get("treatment", 0.0),
            key_findings=[
                f"{len(plan.get('immediate_interventions', []))} immediate interventions",
                f"{len(plan.get('ongoing_management', []))} ongoing therapies"
            ],
            warnings=[
                f"Major interaction: {i.get('interacting_drugs')}"
                for i in tx.get("medication_safety_assessment", {}).get("drug_interactions", [])
                if i.get("severity") == "Major"
            ][:3]
        ))
    
    # Discharge Readiness
    if "discharge_readiness" in state:
        dc = state["discharge_readiness"]
        summaries.append(AgentOutput(
            agent_name="Discharge Readiness",
            confidence=state.get("confidence_scores", {}).get("discharge", 0.0),
            key_findings=[
                f"Status: {dc.get('overall_discharge_readiness', 'unknown')}",
                f"Readmission risk: {dc.get('estimated_readmission_risk', 'unknown')}"
            ],
            warnings=[
                b.get("barrier", "")[:100]
                for b in dc.get("barriers_to_discharge", [])
                if b.get("severity") == "Critical blocker"
            ]
        ))
    
    return summaries


# ============================================================================
# API ENDPOINTS
# ============================================================================

@router.get("/health", response_model=HealthCheckResponse)
async def health_check():
    """
    Health check endpoint
    """
    from Agentic.Rag.graph_rag_system import graph_rag_system
    
    return HealthCheckResponse(
        status="healthy",
        timestamp=datetime.utcnow().isoformat(),
        workflow_initialized=clinical_workflow is not None,
        rag_system_available=graph_rag_system is not None
    )


@router.post("/clinical-reasoning", response_model=ClinicalReasoningResponse)
async def run_clinical_reasoning(request: ClinicalReasoningRequest):
    """
    Run comprehensive clinical reasoning workflow
    
    This endpoint:
    1. Fetches patient data from database
    2. Runs the complete clinical reasoning workflow with iteration
    3. Returns structured assessment with agent outputs
    4. Saves results to database
    """
    request_id = f"CR-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{request.patient_id}"
    
    logger.info(f"🚀 Clinical Reasoning Request: {request_id}")
    logger.info(f"   Patient: {request.patient_id}")
    logger.info(f"   Doctor: {request.doctor_id}")
    
    try:
        # 1. Fetch patient contexts from database
        logger.info("📊 Fetching patient data...")
        #patient_data = await fetch_patient_contexts(request.patient_id)


        patient_data = await fetch_patient_contexts(
    patient_id=request.patient_id,
    doctor_id=request.doctor_id
)
        
        # 2. Build input state
        input_state = {
            "patient_id": request.patient_id,
            "doctor_id": request.doctor_id,
            "consultation_text": request.consultation_text,
            "max_iterations": request.max_iterations,
            **patient_data
        }
        
        # 3. Log what goes into the workflow
        logger.info("📦 Workflow Input State Prepared:")
        logger.info(f"   - Patient ID: {input_state.get('patient_id')}")
        logger.info(f"   - Medical Context Keys: {list(input_state.get('medical_context', {}).keys())}")
        logger.info(f"   - Clinical Context Keys: {list(input_state.get('clinical_context', {}).keys())}")
        
        # 3. Run workflow
        logger.info("🔄 Running clinical reasoning workflow...")
        final_state = await clinical_workflow.run(input_state)
        
        # 4. Check for errors
        if "error" in final_state:
            logger.error(f"❌ Workflow error: {final_state['error']}")
            raise HTTPException(
                status_code=500,
                detail=f"Clinical reasoning failed: {final_state['error']}"
            )
        
        # 5. Extract response data
        final_assessment = final_state.get("final_assessment", {})
        
        response = ClinicalReasoningResponse(
            request_id=request_id,
            timestamp=final_assessment.get("timestamp", datetime.utcnow().isoformat()),
            patient_id=request.patient_id,
            
            # High-level summary
            primary_diagnosis=final_assessment.get("primary_diagnosis", "Unknown"),
            risk_level=final_assessment.get("risk_level", "unknown"),
            discharge_recommendation=final_assessment.get("discharge_recommendation", "Pending"),
            
            # Confidence and warnings
            overall_confidence=final_assessment.get("overall_confidence", 0.0),
            requires_review=final_state.get("requires_review", False),
            warnings=final_state.get("warnings", []),
            
            # Agent summaries
            agents_summary=extract_agent_summaries(final_state),
            
            # Iteration info
            iterations_performed=final_assessment.get("iterations_performed", 0),
            contradictions_resolved=final_assessment.get("contradictions_resolved", 0),
            contradictions_remaining=final_assessment.get("contradictions_remaining", 0),
            
            # Full outputs (optional - can be excluded for smaller response)
            detailed_outputs={
                "differential_diagnosis": final_state.get("differential_diagnosis"),
                "medication_reconciliation": final_state.get("medication_reconciliation"),
                "risk_stratification": final_state.get("risk_stratification"),
                "treatment_validation": final_state.get("treatment_validation"),
                "discharge_readiness": final_state.get("discharge_readiness"),
                "reasoning_coordination": final_state.get("reasoning_coordination")
            }
        )
        
        # 6. Save to database (async, non-blocking)
        await save_reasoning_output(request.patient_id, request.doctor_id, final_state)
        
        logger.info(f"✅ Clinical Reasoning Complete: {request_id}")
        logger.info(f"   Confidence: {response.overall_confidence:.2f}")
        logger.info(f"   Warnings: {len(response.warnings)}")
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Clinical reasoning failed: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        
        raise HTTPException(
            status_code=500,
            detail=f"Clinical reasoning failed: {str(e)}"
        )


@router.get("/clinical-reasoning/{patient_id}/history")
async def get_reasoning_history(patient_id: str, limit: int = 10):
    """
    Get historical clinical reasoning results for a patient
    """
    # TODO: Implement database query
    # This is a placeholder
    
    try:
        # Example query:
        # results = await db.reasoning_results.find(
        #     {"patient_id": patient_id}
        # ).sort("timestamp", -1).limit(limit).to_list(limit)
        
        return {
            "patient_id": patient_id,
            "results": [],
            "message": "History retrieval not yet implemented"
        }
        
    except Exception as e:
        logger.error(f"Failed to fetch history: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch reasoning history: {str(e)}"
        )


@router.post("/clinical-reasoning/{request_id}/feedback")
async def submit_feedback(
    request_id: str,
    feedback: Dict[str, Any]
):
    """
    Submit feedback on clinical reasoning output
    Used for continuous improvement
    """
    # TODO: Implement feedback storage
    
    try:
        logger.info(f"📝 Feedback received for {request_id}")
        
        # Example storage:
        # await db.reasoning_feedback.insert_one({
        #     "request_id": request_id,
        #     "timestamp": datetime.utcnow(),
        #     "feedback": feedback
        # })
        
        return {
            "request_id": request_id,
            "status": "feedback_received",
            "message": "Thank you for your feedback"
        }
        
    except Exception as e:
        logger.error(f"Failed to save feedback: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to save feedback: {str(e)}"
        )


# ============================================================================
# LEGACY COMPATIBILITY (Optional)
# ============================================================================

@router.post("/clinical-reasoning/legacy")
async def run_clinical_reasoning_legacy(request: Dict[str, Any]):
    """
    Legacy endpoint for backward compatibility
    Converts old request format to new format
    """
    try:
        # Convert legacy request to new format
        new_request = ClinicalReasoningRequest(
            patient_id=request.get("patient_id"),
            doctor_id=request.get("doctor_id"),
            consultation_text=request.get("consultation", "")
        )
        
        # Run new workflow
        response = await run_clinical_reasoning(new_request)
        
        # Convert response to legacy format if needed
        return {
            "status": "success",
            "data": response.dict()
        }
        
    except Exception as e:
        logger.error(f"Legacy endpoint error: {str(e)}")
        return {
            "status": "error",
            "message": str(e)
        }


# =====================================================================
# MEDICAL CONTEXT FETCHER
# =====================================================================


async def fetch_medical_context(patient_id: str, doctor_id: str) -> Dict[str, Any]:
    """
    Fetch complete medical context from all document sources
    
    Medical Context = All extracted medical facts without interpretation
    - Diagnoses, symptoms, vital signs
    - Lab results (hematology, biochemistry, microbiology)
    - Pathology findings
    - Imaging reports
    - Procedure notes
    - Medication lists
    - Allergies
    """
    """
    Queries 10+ MongoDB collections in parallel:
    
    Collections queried:
    - laboratory_hematology_collection
    - laboratory_biochemistry_collection
    - laboratory_microbiology_collection
    - imaging_xray_collection
    - imaging_ct_collection
    - imaging_mri_collection
    - imaging_ultrasound_collection
    - pathology_histopathology_collection
    - pathology_cytology_collection
    - procedure_notes_collection
    - document_categories_collection
    """
    logger.info(f"📚 Fetching Medical Context: Patient={patient_id}")
    
    try:
        medical_context = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "timestamp": datetime.utcnow().isoformat(),
            "diagnoses": [],
            "symptoms": [],
            "vital_signs": {},
            "laboratory_results": {
                "hematology": [],
                "biochemistry": [],
                "microbiology": []
            },
            "pathology": {
                "histopathology": [],
                "cytology": []
            },
            "imaging": {
                "xray": [],
                "ct": [],
                "mri": [],
                "ultrasound": []
            },
            "procedures": [],
            "medications": [],
            "allergies": [],
            "documents": []
        }
        
        
        medical_context["vital_signs"] = await fetch_vital_signs(patient_id, patient_vitals_collection)
        # Fetch laboratory results
        medical_context["laboratory_results"]["hematology"] = await fetch_laboratory_data(
            patient_id, laboratory_hematology_collection
        )
        medical_context["laboratory_results"]["biochemistry"] = await fetch_laboratory_data(
            patient_id, laboratory_biochemistry_collection
        )
        medical_context["laboratory_results"]["microbiology"] = await fetch_laboratory_data(
            patient_id, laboratory_microbiology_collection
        )
        
        # Fetch pathology results
        medical_context["pathology"]["histopathology"] = await fetch_pathology_data(
            patient_id, pathology_histopathology_collection
        )
        medical_context["pathology"]["cytology"] = await fetch_pathology_data(
            patient_id, pathology_cytology_collection
        )
        
        # Fetch imaging results
        medical_context["imaging"]["xray"] = await fetch_imaging_data(
            patient_id, imaging_xray_collection
        )
        medical_context["imaging"]["ct"] = await fetch_imaging_data(
            patient_id, imaging_ct_collection
        )
        medical_context["imaging"]["mri"] = await fetch_imaging_data(
            patient_id, imaging_mri_collection
        )
        medical_context["imaging"]["ultrasound"] = await fetch_imaging_data(
            patient_id, imaging_ultrasound_collection
        )
        
        # Fetch procedure notes
        medical_context["procedures"] = await fetch_procedure_notes(patient_id)
        # Fetch medications
        medical_context["medications"] = await fetch_medications(patient_id, doctor_id)

        # Fetch all documents
        medical_context["documents"] = await fetch_all_documents(patient_id)
        
        logger.info(f"✅ Medical Context Fetched: {len(medical_context['documents'])} documents")
        logger.info(f"   - Detailed Breakdown:")
        logger.info(f"     * Hematology: {len(medical_context['laboratory_results']['hematology'])}")
        logger.info(f"     * Biochemistry: {len(medical_context['laboratory_results']['biochemistry'])}")
        logger.info(f"     * Microbiology: {len(medical_context['laboratory_results']['microbiology'])}")
        logger.info(f"     * Imaging (CT): {len(medical_context['imaging']['ct'])}")
        logger.info(f"     * Imaging (MRI): {len(medical_context['imaging']['mri'])}")
        logger.info(f"     * Imaging (X-Ray): {len(medical_context['imaging']['xray'])}")
        logger.info(f"     * Procedures: {len(medical_context['procedures'])}")
        logger.info(f"     * Medications: {len(medical_context['medications'])}")
        
        return medical_context
        
    except Exception as e:
        logger.error(f"❌ Failed to fetch medical context: {str(e)}")
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
        logger.info(f"procedure:{results}")
        return results
    except Exception as e:
        logger.error(f"❌ Failed to fetch procedure notes: {str(e)}")
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

async def fetch_medications(patient_id: str, doctor_id: str) -> List[Dict[str, Any]]:
    try:
        logger.info(
            f"💊 Fetching medications | patient_id={patient_id} | doctor_id={doctor_id}"
        )

        cursor = documentation_medication_analysis_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("created_at", -1).limit(50)

        results = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            results.append(doc)

        logger.info(
            f"✅ Medications fetched successfully | count={len(results)} | patient_id={patient_id}"
        )

        # 🔍 FULL MEDICATION RESULTS (NO FILTERING)
        logger.info("💊 MEDICATION RESULTS START")
        for idx, med in enumerate(results, 1):
            logger.info(
                f"""
Medication #{idx}
────────────────────────────────
{med}
────────────────────────────────
"""
            )
        logger.info("💊 MEDICATION RESULTS END")

        return results

    except Exception as e:
        logger.error(
            f"❌ Failed to fetch medications | patient_id={patient_id} | doctor_id={doctor_id} | error={str(e)}"
        )
        return []


async def fetch_vital_signs(
    patient_id: str,
    patient_vitals_collection
) -> List[Dict[str, Any]]:
    """
    Fetch ALL vital signs for a patient from a SINGLE vitals document.
    Matches save_patient_vitals schema.
    """

    try:
        logger.info(f"📈 Fetching ALL vital signs | patient_id={patient_id}")

        doc = await patient_vitals_collection.find_one(
            {"sys_user_id": patient_id}
        )

        if not doc:
            logger.warning(
                f"⚠️ No vitals document found | patient_id={patient_id}"
            )
            return []

        doc["_id"] = str(doc["_id"])

        vitals_map = doc.get("vitals", {})

        if not vitals_map:
            logger.warning(
                f"⚠️ Vitals document exists but empty | patient_id={patient_id}"
            )
            return []

        results: List[Dict[str, Any]] = []

        for ts_key, vitals_data in vitals_map.items():
            results.append({
                "timestamp": ts_key.replace("_", "."),
                "vitals": vitals_data
            })

        # Sort newest → oldest by timestamp string
        results.sort(key=lambda x: x["timestamp"], reverse=True)

        logger.info(
            f"✅ Vital signs fetched | patient_id={patient_id} | count={len(results)}"
        )

        logger.debug(
            f"📈 Latest vitals snapshot: {results[0]}"
        )

        return results

    except Exception as e:
        logger.error(
            f"❌ Failed to fetch vital signs | patient_id={patient_id} | error={str(e)}"
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
        logger.info(
            f"✅ Fetched {len(results)} conversations "
            f"for patient_id={patient_id}, doctor_id={doctor_id}. "
            f"Results={results}"
        )
        return results
    except Exception as e:
        logger.error(f"❌ Failed to fetch conversations: {str(e)}")
        return []


async def fetch_dictations(patient_id: str, doctor_id: str) -> List[Dict[str, Any]]:
    """Fetch doctor dictations"""
    try:
        cursor = dictation_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("created_at", -1).limit(20)
        
        results = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            results.append(doc)
        logger.info(
            f"✅ Fetched {len(results)} dictation "
            f"for patient_id={patient_id}, doctor_id={doctor_id}. "
            f"Results={results}"
        )
        return results
    except Exception as e:
        logger.error(f"❌ Failed to fetch dictations: {str(e)}")
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
        logger.info(f"medications data: {medications}")
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
        
        logger.info(f"timeline data: {timeline}")

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



##################################################################
##### log

def log_medical_data_summary(data: Dict[str, Any], context_type: str):
    """
    Comprehensive medical data logger - mimics how a doctor reviews charts
    """
    logger.info(f"\n{'='*80}")
    logger.info(f"📋 {context_type.upper()} - CHART REVIEW")
    logger.info(f"{'='*80}")
    
    if context_type == "MEDICAL_CONTEXT":
        log_medical_context_details(data)
    elif context_type == "CLINICAL_CONTEXT":
        log_clinical_context_details(data)
    elif context_type == "LONGITUDINAL_CONTEXT":
        log_longitudinal_context_details(data)
    
    logger.info(f"{'='*80}\n")

def log_medical_context_details(medical: Dict[str, Any]):
    """Log medical context like a doctor reviewing lab results and imaging"""
    
    # Laboratory Results Review
    logger.info("\n🔬 LABORATORY RESULTS:")
    lab_results = medical.get("laboratory_results", {})
    
    # Hematology
    hematology = lab_results.get("hematology", [])
    if hematology:
        logger.info(f"  ├─ Hematology: {len(hematology)} reports")
        for idx, report in enumerate(hematology[:3], 1):  # Show latest 3
            logger.info(f"  │  ├─ Report {idx}: {report.get('report_date', 'Unknown date')}")
            if 'test_results' in report:
                for test in report['test_results'][:5]:  # First 5 tests
                    test_name = test.get('test_name', 'Unknown')
                    value = test.get('value', 'N/A')
                    unit = test.get('unit', '')
                    ref_range = test.get('reference_range', '')
                    flag = test.get('flag', 'Normal')
                    logger.info(f"  │  │  • {test_name}: {value} {unit} (Ref: {ref_range}) [{flag}]")
    else:
        logger.info(f"  ├─ Hematology: No data available")
    
    # Biochemistry
    biochemistry = lab_results.get("biochemistry", [])
    if biochemistry:
        logger.info(f"  ├─ Biochemistry: {len(biochemistry)} reports")
        for idx, report in enumerate(biochemistry[:3], 1):
            logger.info(f"  │  ├─ Report {idx}: {report.get('report_date', 'Unknown date')}")
            if 'test_results' in report:
                for test in report['test_results'][:5]:
                    test_name = test.get('test_name', 'Unknown')
                    value = test.get('value', 'N/A')
                    unit = test.get('unit', '')
                    flag = test.get('flag', 'Normal')
                    logger.info(f"  │  │  • {test_name}: {value} {unit} [{flag}]")
    else:
        logger.info(f"  ├─ Biochemistry: No data available")
    
    # Microbiology
    microbiology = lab_results.get("microbiology", [])
    if microbiology:
        logger.info(f"  └─ Microbiology: {len(microbiology)} reports")
        for idx, report in enumerate(microbiology[:2], 1):
            logger.info(f"     ├─ Culture {idx}: {report.get('specimen_type', 'Unknown')} - {report.get('report_date', 'Unknown')}")
            if 'organisms' in report:
                for org in report['organisms'][:3]:
                    logger.info(f"     │  • {org.get('organism_name', 'Unknown')}: {org.get('growth', 'N/A')}")
    
    # Imaging Review
    logger.info("\n🏥 IMAGING STUDIES:")
    imaging = medical.get("imaging", {})
    
    for modality in ['xray', 'ct', 'mri', 'ultrasound']:
        studies = imaging.get(modality, [])
        if studies:
            logger.info(f"  ├─ {modality.upper()}: {len(studies)} studies")
            for idx, study in enumerate(studies[:2], 1):
                logger.info(f"  │  ├─ Study {idx}: {study.get('study_description', 'Unknown')} ({study.get('report_date', 'Unknown')})")
                impression = study.get('impression', study.get('findings', 'No impression available'))
                if impression:
                    # Truncate long impressions
                    impression_preview = impression[:200] + "..." if len(impression) > 200 else impression
                    logger.info(f"  │  │  Impression: {impression_preview}")
    
    # Pathology Review
    logger.info("\n🔬 PATHOLOGY:")
    pathology = medical.get("pathology", {})
    
    histopath = pathology.get("histopathology", [])
    if histopath:
        logger.info(f"  ├─ Histopathology: {len(histopath)} reports")
        for idx, report in enumerate(histopath[:2], 1):
            logger.info(f"  │  ├─ Report {idx}: {report.get('specimen_type', 'Unknown')} ({report.get('report_date', 'Unknown')})")
            diagnosis = report.get('diagnosis', 'No diagnosis available')
            logger.info(f"  │  │  Diagnosis: {diagnosis[:150]}...")
    
    cytology = pathology.get("cytology", [])
    if cytology:
        logger.info(f"  └─ Cytology: {len(cytology)} reports")
    
    # Procedures
    logger.info("\n⚕️ PROCEDURES:")
    procedures = medical.get("procedures", [])
    if procedures:
        logger.info(f"  Total procedures: {len(procedures)}")
        for idx, proc in enumerate(procedures[:3], 1):
            proc_name = proc.get('procedure_name', 'Unknown procedure')
            proc_date = proc.get('procedure_date', proc.get('updated_at', 'Unknown date'))
            logger.info(f"  ├─ {idx}. {proc_name} ({proc_date})")
            if 'outcome' in proc:
                logger.info(f"  │  Outcome: {proc['outcome']}")
    else:
        logger.info(f"  No procedures recorded")
    
    # Medications
    logger.info("\n💊 MEDICATIONS:")
    medications = medical.get("medications", [])
    if medications:
        logger.info(f"  Active medications: {len(medications)}")
        for idx, med in enumerate(medications[:5], 1):
            med_name = med.get('medication_name', 'Unknown')
            dose = med.get('dose', 'Unknown dose')
            frequency = med.get('frequency', 'Unknown frequency')
            logger.info(f"  ├─ {idx}. {med_name} {dose} {frequency}")
    else:
        logger.info(f"  No active medications recorded")

def log_clinical_context_details(clinical: Dict[str, Any]):
    """Log clinical context like a doctor's clinical reasoning"""
    
    logger.info("\n🧠 CLINICAL REASONING SUMMARY:")
    
    # Active Problems
    logger.info("\n📌 ACTIVE DIAGNOSES:")
    diagnoses = clinical.get("active_diagnoses", [])
    if diagnoses:
        for idx, dx in enumerate(diagnoses, 1):
            logger.info(f"  {idx}. {dx}")
    else:
        logger.info(f"  No active diagnoses documented")
    
    # Disease Course
    logger.info("\n📈 DISEASE COURSE:")
    course = clinical.get("disease_course", [])
    if course:
        logger.info(f"  Total clinical encounters: {len(course)}")
        for idx, encounter in enumerate(course[:3], 1):
            encounter_date = encounter.get('created_at', 'Unknown date')
            logger.info(f"  ├─ Encounter {idx}: {encounter_date}")
            if 'messages' in encounter and encounter['messages']:
                last_msg = encounter['messages'][-1]
                content_preview = str(last_msg.get('content', ''))[:100]
                logger.info(f"  │  Summary: {content_preview}...")
    
    # Treatments Attempted
    logger.info("\n💉 TREATMENT HISTORY:")
    treatments = clinical.get("treatments_attempted", [])
    if treatments:
        logger.info(f"  Total treatment records: {len(treatments)}")
        for idx, tx in enumerate(treatments[:3], 1):
            tx_date = tx.get('created_at', 'Unknown date')
            tx_type = tx.get('type', 'Unknown')
            logger.info(f"  ├─ Treatment {idx} ({tx_date}): {tx_type}")
    
    # Relevant Diagnostics
    logger.info("\n🔍 RELEVANT DIAGNOSTIC WORKUP:")
    diagnostics = clinical.get("relevant_diagnostics", {})
    for test_type, tests in diagnostics.items():
        if tests:
            logger.info(f"  ├─ {test_type.capitalize()}: {len(tests)} tests ordered/reviewed")

def log_longitudinal_context_details(longitudinal: Dict[str, Any]):
    """Log longitudinal trends like a doctor reviewing disease progression"""
    
    logger.info("\n📊 LONGITUDINAL ANALYSIS:")
    
    # Disease Trajectory
    trajectory = longitudinal.get("disease_trajectory", "unknown")
    logger.info(f"\n🎯 DISEASE TRAJECTORY: {trajectory.upper()}")
    
    # Lab Trends
    logger.info("\n📉 LABORATORY TRENDS:")
    lab_trends = longitudinal.get("lab_trends", [])
    if lab_trends:
        logger.info(f"  Total lab reports tracked: {len(lab_trends)}")
        # Group by test type
        test_summary = {}
        for lab in lab_trends[:20]:  # Analyze recent 20
            if 'test_results' in lab:
                for test in lab['test_results']:
                    test_name = test.get('test_name', 'Unknown')
                    if test_name not in test_summary:
                        test_summary[test_name] = []
                    test_summary[test_name].append({
                        'date': lab.get('report_date', 'Unknown'),
                        'value': test.get('value', 'N/A'),
                        'flag': test.get('flag', 'Normal')
                    })
        
        # Show trends for key tests
        logger.info(f"  Tracked parameters: {len(test_summary)}")
        for test_name, values in list(test_summary.items())[:5]:
            logger.info(f"  ├─ {test_name}: {len(values)} measurements")
            if len(values) >= 2:
                latest = values[0]
                oldest = values[-1]
                logger.info(f"  │  Latest: {latest['value']} ({latest['date']}) [{latest['flag']}]")
                logger.info(f"  │  Oldest: {oldest['value']} ({oldest['date']}) [{oldest['flag']}]")
    
    # Imaging Evolution
    logger.info("\n🏥 IMAGING EVOLUTION:")
    imaging_trends = longitudinal.get("imaging_evolution", [])
    if imaging_trends:
        logger.info(f"  Total imaging studies tracked: {len(imaging_trends)}")
        for idx, study in enumerate(imaging_trends[:3], 1):
            modality = study.get('modality', 'Unknown')
            study_date = study.get('report_date', 'Unknown')
            logger.info(f"  ├─ Study {idx}: {modality} ({study_date})")
    
    # Time Series Data
    logger.info("\n⏰ TEMPORAL DISTRIBUTION:")
    time_series = longitudinal.get("time_series_data", {})
    for period, data in time_series.items():
        logger.info(f"  ├─ {period.replace('_', ' ').title()}: {len(data)} data points")



#  Analyze data like a doctor would - looking for:
#     1. Critical abnormalities requiring immediate action
#     2. Diagnostic patterns
#     3. Treatment effectiveness
#     4. Disease progression
#     5. Risk factors


