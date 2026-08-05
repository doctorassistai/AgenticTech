"""
ETAI — Complete Dynamic Emergency Triage System
================================================
NO PREDEFINED THRESHOLDS - Everything is dynamically determined by LLM
based on actual patient data from MongoDB and Neo4j
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import datetime
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorClient
from neo4j import AsyncGraphDatabase
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage

# ============================================================
# ENVIRONMENT
# ============================================================

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = os.getenv("MONGO_DB", "doctorassistai")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
NEO4J_URI = os.getenv("NEO4J_URI")
NEO4J_USER = os.getenv("NEO4J_USER")
NEO4J_PASS = os.getenv("NEO4J_PASSWORD")

if not GROQ_API_KEY:
    raise ValueError("GROQ_API_KEY is required")

# Database connections
mongo_client = AsyncIOMotorClient(MONGO_URI)
mongo_db = mongo_client[MONGO_DB]

patient_appointments_collection = mongo_db["patient_appointments"]
patient_user_collection = mongo_db["patient_users"]
patient_vitals_collection = mongo_db["patient_vitals"]
triage_records_collection = mongo_db["triage_records"]

# Neo4j
neo4j_driver = None
try:
    neo4j_driver = AsyncGraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASS))
    logger.info("Neo4j connected")
except Exception as e:
    logger.warning(f"Neo4j not available: {e}")

# LLM
llm = ChatGroq(
    model="llama-3.3-70b-versatile",
    temperature=0.1,
    max_tokens=8000,
    groq_api_key=GROQ_API_KEY,
)

router = APIRouter(prefix="/emergency", tags=["Emergency Triage"])

# ============================================================
# MODELS
# ============================================================

class TriageRequest(BaseModel):
    patient_id: str
    doctor_id: str
    appointment_id: Optional[str] = None
    include_raw_data: bool = False

class DynamicTriageResponse(BaseModel):
    patient_id: str
    doctor_id: str
    triage_timestamp: str
    processing_time_ms: int
    triage_level: int
    triage_category: str
    triage_standard_used: str
    why_this_level: str
    why_this_standard: str
    clinical_findings: Dict[str, Any]
    risk_analysis: Dict[str, Any]
    immediate_actions: List[Dict[str, Any]]
    monitoring_plan: Dict[str, Any]
    referrals_needed: List[Dict[str, Any]]
    transfer_decision: Dict[str, Any]
    triage_summary: str
    disposition_plan: str
    raw_data: Optional[Dict[str, Any]] = None
    errors: List[str] = []

# ============================================================
# FETCH ACTUAL PATIENT DATA (NO TRANSFORMATIONS)
# ============================================================

async def fetch_complete_patient_data(patient_id: str, appointment_id: Optional[str] = None) -> Dict[str, Any]:
    """Fetch raw data exactly as stored in databases - no preprocessing"""
    
    # Get appointments as-is
    appointment_doc = await patient_appointments_collection.find_one(
        {"sys_user_id": patient_id}, {"_id": 0}
    )
    
    # Get user profile as-is
    profile = await patient_user_collection.find_one(
        {"sys_user_id": patient_id}, {"_id": 0}
    )
    
    # Get vitals as-is
    vitals_doc = await patient_vitals_collection.find_one(
        {"sys_user_id": patient_id}, {"_id": 0}
    )
    
    # Get Neo4j data as-is
    neo4j_data = {"nodes": [], "relationships": []}
    if neo4j_driver:
        try:
            async with neo4j_driver.session() as session:
                result = await session.run(
                    "MATCH (p:Patient {patient_id: $id})-[r]-(n) RETURN p, r, n LIMIT 100",
                    id=patient_id
                )
                records = await result.data()
                neo4j_data = {"records": records}
        except Exception as e:
            logger.warning(f"Neo4j error: {e}")
    
    return {
        "patient_id": patient_id,
        "appointment_document": appointment_doc,
        "user_profile_document": profile,
        "vitals_document": vitals_doc,
        "neo4j_graph_data": neo4j_data,
        "appointment_id_filter": appointment_id,
        "fetch_timestamp": datetime.now().isoformat()
    }

# ============================================================
# COMPLETE DYNAMIC TRIAGE - EVERYTHING DETERMINED BY LLM
# ============================================================

async def dynamic_clinical_triage(patient_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Complete dynamic triage where LLM analyzes raw data and makes all decisions
    NO predefined thresholds, NO hardcoded scores, EVERYTHING is contextually determined
    """
    
    # Convert raw data to JSON string for LLM
    raw_data_json = json.dumps(patient_data, indent=2, default=str)
    
    system_prompt = """
    You are a senior emergency medicine physician with 20 years of experience.
    
    CRITICAL RULES:
    1. You have NO predefined thresholds or normal ranges
    2. You MUST analyze the ACTUAL data provided for THIS specific patient
    3. Every decision must be based on the numbers, text, and history in the data
    4. Do NOT assume anything not in the data
    5. If a value is abnormal for THIS patient based on their context, flag it
    6. Consider trends, not just single values
    7. Be specific - use the actual numbers from the data
    
    Your task: Perform a complete emergency triage assessment based ONLY on the data below.
    """
    
    user_prompt = f"""
    Here is the COMPLETE RAW PATIENT DATA from our hospital systems:
    
    {raw_data_json}
    
    Based ONLY on this data, provide a complete emergency triage assessment.
    
    Analyze:
    
    1. **VITAL SIGNS** - Look at every vital sign in the data. What are the actual values? 
       What trends do you see across timestamps? For THIS patient, given their age, history, 
       and presentation, which values are concerning?
    
    2. **CHIEF COMPLAINT** - What is the patient's main problem? How severe does it seem 
       based on the description?
    
    3. **MEDICAL HISTORY** - From the Neo4j graph data and user profile, what conditions 
       does this patient have? What medications? What allergies?
    
    4. **CLINICAL RISK** - Based on the combination of vitals, complaint, and history, 
       what is the risk level for deterioration? Why?
    
    5. **TRIAGE LEVEL** - Assign 1-5 where:
       1 = Immediate life threat, needs resuscitation now
       2 = High risk for deterioration, needs emergent care
       3 = Stable but potentially serious, needs urgent care
       4 = Minor condition, needs non-urgent care
       5 = Non-urgent, can wait or go to primary care
       
       EXPLAIN why THIS patient gets THIS level using THEIR specific data.
    
    6. **TRIAGE STANDARD** - Based on this patient's presentation, which standard (ESI, CTAS, or MTS) 
       is most appropriate? WHY? Provide specific reasons from their data.
    
    7. **CRITICAL FINDINGS** - What specific findings in the data are immediately dangerous? 
       List each with the actual value from the data.
    
    8. **IMMEDIATE ACTIONS** - Based on the actual vitals and complaint, what must be done NOW?
       Be specific: "Give O2 at X L for SpO2 of Y%", "Start IV fluids for BP of Z", etc.
    
    9. **MONITORING PLAN** - Based on the acuity level determined from the data, what needs 
       monitoring and how often? Use the data to justify frequency.
    
    10. **REFERRALS** - Based on the presentation and history, which specialists are needed?
    
    11. **TRANSFER** - Does this patient need ICU? Another facility? Based on what findings?
    
    12. **SUMMARY** - Write a complete clinical summary paragraph that any doctor can understand.
    
    Return your assessment as a JSON object with these exact keys:
    {{
        "vital_signs_analysis": {{
            "findings": "text analysis of actual vital signs",
            "concerning_values": ["list actual concerning values with reasons"],
            "trends": "what the timeline shows"
        }},
        "chief_complaint_analysis": "text",
        "history_analysis": "text",
        "risk_assessment": {{
            "level": "Low/Moderate/High/Critical",
            "reasoning": "based on specific data points",
            "deterioration_risk": "what might happen and why"
        }},
        "triage_level": 1-5,
        "triage_level_reasoning": "detailed explanation using actual data",
        "triage_standard": "ESI or CTAS or MTS",
        "triage_standard_reasoning": "why this standard fits this patient",
        "triage_category": "Resuscitation Bay or Critical Care or Observation or Fast Track or Green Zone",
        "critical_alerts": [
            {{
                "finding": "the actual abnormal value",
                "why_critical": "explanation",
                "immediate_response": "what to do"
            }}
        ],
        "immediate_actions": [
            {{
                "priority": "1st/2nd/3rd",
                "action": "specific action with numbers from vitals",
                "rationale": "based on which data point",
                "who": "nurse/doctor/respiratory/etc"
            }}
        ],
        "monitoring_plan": {{
            "vital_signs_frequency": "based on acuity level",
            "specific_parameters_to_watch": ["list from the data"],
            "escalation_triggers": "what would prompt reassignment",
            "reassessment_timing": "when to re-evaluate"
        }},
        "referrals": [
            {{
                "specialty": "which service",
                "urgency": "stat/urgent/routine",
                "reason": "based on which finding"
            }}
        ],
        "transfer_decision": {{
            "required": true/false,
            "destination": "ICU/OR/Another facility/None",
            "reason": "specific clinical justification"
        }},
        "disposition": "where this patient should go immediately",
        "triage_summary": "complete paragraph summary for medical record"
    }}
    
    Remember: Use ONLY the actual data provided. No assumptions. No predefined normal values.
    If the data has specific numbers, use those exact numbers in your reasoning.
    """
    
    try:
        response = await llm.ainvoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt)
        ])
        
        # Parse JSON from response
        content = response.content
        json_match = re.search(r'\{.*\}', content, re.DOTALL)
        if json_match:
            result = json.loads(json_match.group(0))
        else:
            result = json.loads(content)
        
        return result
        
    except Exception as e:
        logger.error(f"LLM triage failed: {e}")
        raise

# ============================================================
# API ENDPOINTS
# ============================================================

@router.post("/triage/dynamic", response_model=DynamicTriageResponse)
async def emergency_triage(request: TriageRequest, background_tasks: BackgroundTasks):
    """
    COMPLETE DYNAMIC TRIAGE
    
    This endpoint:
    1. Fetches raw patient data from your databases
    2. Sends the EXACT raw data to the LLM
    3. LLM analyzes everything without predefined thresholds
    4. Returns completely dynamic triage decision
    
    NO hardcoded scores
    NO predefined normal ranges
    EVERYTHING determined by LLM from your actual data
    """
    
    start_time = datetime.now()
    logger.info(f"🚨 Dynamic triage for patient: {request.patient_id}")
    
    try:
        # Fetch raw data exactly as stored
        raw_patient_data = await fetch_complete_patient_data(
            request.patient_id, 
            request.appointment_id
        )
        
        # Verify we have data
        has_data = any([
            raw_patient_data.get("appointment_document"),
            raw_patient_data.get("user_profile_document"),
            raw_patient_data.get("vitals_document")
        ])
        
        if not has_data:
            raise HTTPException(
                status_code=404, 
                detail=f"No clinical data found for patient {request.patient_id}"
            )
        
        # Let LLM analyze everything dynamically
        triage_result = await dynamic_clinical_triage(raw_patient_data)
        
        processing_ms = int((datetime.now() - start_time).total_seconds() * 1000)
        
        # Build response
        response = DynamicTriageResponse(
            patient_id=request.patient_id,
            doctor_id=request.doctor_id,
            triage_timestamp=datetime.now().isoformat(),
            processing_time_ms=processing_ms,
            triage_level=triage_result.get("triage_level", 4),
            triage_category=triage_result.get("triage_category", "Fast Track"),
            triage_standard_used=triage_result.get("triage_standard", "ESI"),
            why_this_level=triage_result.get("triage_level_reasoning", "Based on clinical assessment"),
            why_this_standard=triage_result.get("triage_standard_reasoning", "Based on presentation"),
            clinical_findings={
                "vitals_analysis": triage_result.get("vital_signs_analysis", {}),
                "complaint_analysis": triage_result.get("chief_complaint_analysis", ""),
                "history_analysis": triage_result.get("history_analysis", "")
            },
            risk_analysis=triage_result.get("risk_assessment", {}),
            immediate_actions=triage_result.get("immediate_actions", []),
            monitoring_plan=triage_result.get("monitoring_plan", {}),
            referrals_needed=triage_result.get("referrals", []),
            transfer_decision=triage_result.get("transfer_decision", {"required": False}),
            triage_summary=triage_result.get("triage_summary", "Triage assessment completed"),
            disposition_plan=triage_result.get("disposition", "Emergency Department"),
            raw_data=raw_patient_data if request.include_raw_data else None,
            errors=[]
        )
        
        # Save record
        background_tasks.add_task(save_triage_record, response, raw_patient_data)
        
        logger.info(f"✅ Triage complete | Level {response.triage_level} | {processing_ms}ms")
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"❌ Triage failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/health")
async def health():
    """Health check"""
    mongo_ok = False
    try:
        await mongo_client.admin.command('ping')
        mongo_ok = True
    except:
        pass
    
    return {
        "status": "operational",
        "mongodb": mongo_ok,
        "neo4j": neo4j_driver is not None,
        "triage_mode": "COMPLETELY DYNAMIC - No predefined thresholds",
        "message": "Every triage decision is generated fresh from patient data"
    }

@router.get("/test")
async def test():
    """Test endpoint"""
    return {"message": "Emergency triage router is working", "dynamic": True}

async def save_triage_record(response: DynamicTriageResponse, raw_data: Dict):
    """Save to MongoDB"""
    try:
        record = {
            "patient_id": response.patient_id,
            "doctor_id": response.doctor_id,
            "triage_timestamp": response.triage_timestamp,
            "triage_level": response.triage_level,
            "triage_category": response.triage_category,
            "triage_summary": response.triage_summary,
            "disposition": response.disposition_plan,
            "created_at": datetime.now()
        }
        await triage_records_collection.insert_one(record)
        logger.info(f"Saved triage for {response.patient_id}")
    except Exception as e:
        logger.error(f"Save failed: {e}")

# Cleanup
import atexit

@atexit.register
def cleanup():
    if neo4j_driver:
        asyncio.create_task(neo4j_driver.close())
    mongo_client.close()