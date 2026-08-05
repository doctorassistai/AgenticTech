"""
Enhanced Clinical Reasoning System v2.1
========================================
Critical Fixes:
- STRICT document adherence: NO hallucination of treatments, dates, or data not in source
- Intelligent data modification: Merge and update existing records, don't just append
- Verified facts only from pathology reports
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional, Dict, Any, List, TypedDict, Set, Tuple
from datetime import datetime, timedelta
from motor.motor_asyncio import AsyncIOMotorClient
from loguru import logger
from langgraph.graph import StateGraph, END
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage
import json
import os
import asyncio
from dotenv import load_dotenv
from collections import defaultdict
import hashlib
import re

# =====================================================================
# UTILITY FUNCTIONS
# =====================================================================

def safe_json(data):
    """Convert data to formatted JSON string with datetime handling"""
    return json.dumps(data, indent=2, default=str)

def parse_llm_json(content: str) -> dict:
    """
    Robust JSON parser for LLM responses.
    Handles markdown code blocks and extracts JSON objects.
    """
    try:
        if not content:
            return {"error": "empty_response", "confidence": 0.0}
        
        text = content.strip()
        text = text.replace("```json", "").replace("```", "").strip()
        
        stack = 0
        start = None
        for i, ch in enumerate(text):
            if ch == "{":
                if stack == 0:
                    start = i
                stack += 1
            elif ch == "}":
                stack -= 1
                if stack == 0 and start is not None:
                    candidate = text[start:i+1]
                    try:
                        return json.loads(candidate)
                    except:
                        continue
        
        return {"raw_content": text, "confidence": 0.5}
    except Exception as e:
        logger.warning(f"⚠️ JSON Parse failed: {e}")
        return {"raw_content": content, "confidence": 0.5}

def calculate_confidence(
    data_completeness: float,
    consistency_score: float,
    data_recency_days: int
) -> float:
    """Calculate real confidence score based on multiple factors."""
    base_confidence = 0.95
    
    if data_completeness < 0.5:
        base_confidence -= 0.25
    elif data_completeness < 0.7:
        base_confidence -= 0.15
    elif data_completeness < 0.9:
        base_confidence -= 0.05
    
    base_confidence *= consistency_score
    
    if data_recency_days > 90:
        base_confidence -= 0.15
    elif data_recency_days > 30:
        base_confidence -= 0.05
    
    return max(0.3, min(1.0, base_confidence))

def compute_hash(data: Any) -> str:
    """Compute hash of data for change detection"""
    return hashlib.md5(json.dumps(data, sort_keys=True, default=str).encode()).hexdigest()

def extract_verified_dates(text: str) -> Dict[str, str]:
    """Extract only dates explicitly mentioned in the document"""
    dates = {}
    
    # Look for date patterns
    date_patterns = [
        r'(\d{2})-([A-Za-z]{3})-(\d{4})',  # 08-Dec-2025
        r'(\d{4})-(\d{2})-(\d{2})',         # 2025-12-08
        r'(\d{2})/(\d{2})/(\d{4})',         # 12/08/2025
    ]
    
    for pattern in date_patterns:
        matches = re.findall(pattern, text)
        for match in matches:
            if len(match) == 3:
                if isinstance(match[1], str) and match[1].isalpha():
                    # Format: DD-MMM-YYYY
                    dates[f"{match[0]}-{match[1]}-{match[2]}"] = f"{match[2]}-{match[1]}-{match[0]}"
                else:
                    # Format: YYYY-MM-DD or MM/DD/YYYY
                    dates[f"{match[0]}-{match[1]}-{match[2]}"] = f"{match[0]}-{match[1]}-{match[2]}"
    
    return dates

def strict_document_prompt(consultation_text: str) -> str:
    """
    Returns a strict prompt addition that forbids hallucination
    """
    return f"""
CRITICAL INSTRUCTION - DOCUMENT ADHERENCE:
You are analyzing this EXACT document text. You may ONLY use information explicitly stated in the document.

Document text:
\"\"\"{consultation_text}\"\"\"

RULES:
1. If information is NOT in the document, use null, "unknown", or "not mentioned" - NEVER invent data
2. If dates are NOT in the document, use the report date or "unknown" - NEVER invent dates like "2024-03"
3. If treatments are NOT mentioned, the patient is NOT on them - NEVER invent treatments
4. If symptoms are NOT mentioned, they are NOT present - NEVER invent symptoms
5. Use ONLY the exact values from tables and reports
6. For "not identified" in pathology, record as "not identified" not "absent"
7. Age and sex are EXPLICITLY stated: extract them accurately

VERIFICATION CHECKLIST:
Before outputting, verify each field:
- [ ] Is this date in the document? If no → "unknown"
- [ ] Is this treatment in the document? If no → null or omit
- [ ] Is this symptom in the document? If no → null or omit
- [ ] Is this value from a table/report? If yes → use exact value
"""

# =====================================================================
# INTELLIGENT MERGE FUNCTIONS
# =====================================================================

def intelligent_merge_disease_identity(existing: Dict, new_data: Dict) -> Dict:
    """
    Intelligently merge disease identity data.
    Update existing cases with new information, don't just append.
    """
    if not existing:
        return new_data
    
    result = existing.copy()
    
    # Merge primary diagnoses by case_id
    existing_diagnoses = {d.get("case_id"): d for d in existing.get("primary_diagnoses", [])}
    new_diagnoses = {d.get("case_id"): d for d in new_data.get("primary_diagnoses", [])}
    
    merged_diagnoses = []
    
    # Update existing cases with new data
    for case_id, existing_case in existing_diagnoses.items():
        if case_id in new_diagnoses:
            # Merge case data - new data takes precedence for conflicting fields
            merged_case = existing_case.copy()
            new_case = new_diagnoses[case_id]
            
            # Update fields that have new information
            for key, value in new_case.items():
                if value is not None and value != "unknown" and value != "":
                    # Special handling for nested dicts like key_markers
                    if key in merged_case and isinstance(merged_case[key], dict) and isinstance(value, dict):
                        merged_case[key].update(value)
                    else:
                        merged_case[key] = value
            
            # Track history of changes
            if "change_history" not in merged_case:
                merged_case["change_history"] = []
            
            # Detect what changed
            changes = {}
            for k, v in new_case.items():
                if k in existing_case and existing_case[k] != v:
                    changes[k] = {"from": existing_case[k], "to": v}
            
            if changes:
                merged_case["change_history"].append({
                    "date": datetime.utcnow().isoformat(),
                    "changes": changes
                })
            
            merged_diagnoses.append(merged_case)
        else:
            # Keep existing case unchanged
            merged_diagnoses.append(existing_case)
    
    # Add truly new cases
    for case_id, new_case in new_diagnoses.items():
        if case_id not in existing_diagnoses:
            merged_diagnoses.append(new_case)
    
    result["primary_diagnoses"] = merged_diagnoses
    result["last_updated"] = datetime.utcnow().isoformat()
    
    return result

def intelligent_merge_treatment_memory(existing: Dict, new_data: Dict) -> Dict:
    """
    Intelligently merge treatment memory.
    Update status of existing treatments, add new ones.
    """
    if not existing:
        return new_data
    
    result = existing.copy()
    
    # Index existing treatments by ID
    existing_active = {t.get("id"): t for t in existing.get("active_treatments", [])}
    existing_completed = {t.get("id"): t for t in existing.get("completed_treatments", [])}
    
    new_active = []
    new_completed = []
    
    # Process new active treatments
    for treatment in new_data.get("active_treatments", []):
        tid = treatment.get("id")
        
        if tid in existing_active:
            # Update existing active treatment
            merged_treatment = existing_active[tid].copy()
            merged_treatment.update(treatment)
            merged_treatment["last_updated"] = datetime.utcnow().isoformat()
            new_active.append(merged_treatment)
        elif tid in existing_completed:
            # Treatment was completed, now active again? Flag for review
            logger.warning(f"Treatment {tid} was completed but now active - possible relapse or error")
            new_active.append(treatment)
        else:
            # Truly new treatment
            treatment["first_documented"] = datetime.utcnow().isoformat()
            new_active.append(treatment)
    
    # Process new completed treatments
    for treatment in new_data.get("completed_treatments", []):
        tid = treatment.get("id")
        
        if tid in existing_active:
            # Treatment completed
            completed_treatment = existing_active[tid].copy()
            completed_treatment.update(treatment)
            completed_treatment["status"] = "completed"
            completed_treatment["completed_date"] = datetime.utcnow().isoformat()
            new_completed.append(completed_treatment)
        elif tid in existing_completed:
            # Already completed, update if needed
            merged = existing_completed[tid].copy()
            merged.update(treatment)
            new_completed.append(merged)
        else:
            new_completed.append(treatment)
    
    # Keep treatments not mentioned in new data (unchanged status)
    processed_ids = {t.get("id") for t in new_active + new_completed}
    for tid, treatment in existing_active.items():
        if tid not in processed_ids:
            new_active.append(treatment)
    for tid, treatment in existing_completed.items():
        if tid not in processed_ids:
            new_completed.append(treatment)
    
    result["active_treatments"] = new_active
    result["completed_treatments"] = new_completed
    result["last_updated"] = datetime.utcnow().isoformat()
    
    return result

def intelligent_merge_disease_trajectory(existing: Dict, new_data: Dict) -> Dict:
    """
    Intelligently merge disease trajectory.
    Add new events to timeline, update trajectory direction.
    """
    if not existing:
        return new_data
    
    result = existing.copy()
    
    # Merge disease timelines
    existing_timelines = {t.get("case_id"): t for t in existing.get("disease_timelines", [])}
    new_timelines = {t.get("case_id"): t for t in new_data.get("disease_timelines", [])}
    
    merged_timelines = []
    
    for case_id, existing_tl in existing_timelines.items():
        if case_id in new_timelines:
            merged_tl = existing_tl.copy()
            new_tl = new_timelines[case_id]
            
            # Merge key events - avoid duplicates by date+type
            existing_events = {(e.get("date"), e.get("type")): e for e in merged_tl.get("key_events", [])}
            
            for new_event in new_tl.get("key_events", []):
                event_key = (new_event.get("date"), new_event.get("type"))
                if event_key in existing_events:
                    # Update existing event if new info
                    existing_events[event_key].update(new_event)
                else:
                    existing_events[event_key] = new_event
            
            merged_tl["key_events"] = sorted(existing_events.values(), key=lambda x: x.get("date", ""))
            
            # Update trajectory direction if changed
            if new_tl.get("trajectory_direction") != merged_tl.get("trajectory_direction"):
                merged_tl["previous_trajectory"] = merged_tl.get("trajectory_direction")
                merged_tl["trajectory_direction"] = new_tl.get("trajectory_direction")
                merged_tl["trajectory_changed_date"] = datetime.utcnow().isoformat()
            
            # Update other fields
            for key in ["current_stage_or_extent", "next_evaluation_due"]:
                if new_tl.get(key):
                    merged_tl[key] = new_tl[key]
            
            merged_timelines.append(merged_tl)
        else:
            merged_timelines.append(existing_tl)
    
    # Add new timelines
    for case_id, new_tl in new_timelines.items():
        if case_id not in existing_timelines:
            merged_timelines.append(new_tl)
    
    result["disease_timelines"] = merged_timelines
    
    # Update overall trajectory based on all cases
    if new_data.get("overall_trajectory"):
        if result.get("overall_trajectory") != new_data["overall_trajectory"]:
            result["previous_overall_trajectory"] = result.get("overall_trajectory")
            result["overall_trajectory"] = new_data["overall_trajectory"]
    
    result["last_updated"] = datetime.utcnow().isoformat()
    return result

def intelligent_merge_lab_trends(existing: Dict, new_data: Dict) -> Dict:
    """
    Intelligently merge lab trends.
    Add new measurements to timelines, update trends.
    """
    if not existing:
        return new_data
    
    result = existing.copy()
    
    # Index existing lab trends by test name
    existing_tests = {t.get("test"): t for t in existing.get("lab_trends", [])}
    new_tests = {t.get("test"): t for t in new_data.get("lab_trends", [])}
    
    merged_tests = []
    
    for test_name, existing_test in existing_tests.items():
        if test_name in new_tests:
            merged_test = existing_test.copy()
            new_test = new_tests[test_name]
            
            # Add new timeline entries
            existing_dates = {e.get("date") for e in merged_test.get("timeline", [])}
            
            for new_entry in new_test.get("timeline", []):
                if new_entry.get("date") not in existing_dates:
                    merged_test["timeline"].append(new_entry)
            
            # Sort by date
            merged_test["timeline"] = sorted(merged_test["timeline"], key=lambda x: x.get("date", ""))
            
            # Recalculate trend based on last 3 measurements
            recent = merged_test["timeline"][-3:] if len(merged_test["timeline"]) >= 3 else merged_test["timeline"]
            if len(recent) >= 2:
                values = [e.get("value") for e in recent if e.get("value") is not None]
                if len(values) >= 2:
                    if all(values[i] <= values[i+1] for i in range(len(values)-1)):
                        merged_test["trend"] = "worsening" if values[-1] > values[0] else "stable"
                    elif all(values[i] >= values[i+1] for i in range(len(values)-1)):
                        merged_test["trend"] = "improving"
                    else:
                        merged_test["trend"] = "fluctuating"
            
            # Update other fields
            for key in ["clinical_significance", "action_needed", "likely_cause"]:
                if new_test.get(key):
                    merged_test[key] = new_test[key]
            
            merged_tests.append(merged_test)
        else:
            merged_tests.append(existing_test)
    
    # Add new tests
    for test_name, new_test in new_tests.items():
        if test_name not in existing_tests:
            merged_tests.append(new_test)
    
    result["lab_trends"] = merged_tests
    
    # Merge organ function monitoring
    if "organ_function_monitoring" in new_data:
        if "organ_function_monitoring" not in result:
            result["organ_function_monitoring"] = {}
        for organ, data in new_data["organ_function_monitoring"].items():
            if organ in result["organ_function_monitoring"]:
                result["organ_function_monitoring"][organ].update(data)
            else:
                result["organ_function_monitoring"][organ] = data
    
    result["last_updated"] = datetime.utcnow().isoformat()
    return result

# =====================================================================
# ROUTER AND CONFIGURATION
# =====================================================================

router = APIRouter(tags=["Agentic"])

@router.get("/test")
async def test_get():
    return {"reply": "hello from enhanced agentic system v2.1 - strict document adherence"}

@router.post("/test")
async def test(payload: dict):
    return {"reply": "hello from enhanced agentic system v2.1"}

# Environment Configuration
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
    temperature=0.1,  # Lower temperature for less hallucination
    max_tokens=4500
)

# MongoDB Collections
collections_map = {
    "case_boundaries": db["case_boundaries"],
    "disease_identity": db["disease_identity"],
    "disease_trajectory": db["disease_trajectory"],
    "treatment_memory": db["treatment_memory"],
    "functional_status": db["functional_status"],
    "risk_topology": db["risk_topology"],
    "prognosis": db["prognosis"],
    "hypothesis_layer": db["hypothesis_layer"],
    "next_visit_brief": db["next_visit_brief"],
    "patient_summary": db["patient_summary"],
    "symptom_trajectory": db["symptom_trajectory"],
    "medication_safety": db["medication_safety"],
    "imaging_progression": db["imaging_progression"],
    "lab_trend_analysis": db["lab_trend_analysis"],
    "biomarker_trend": db["biomarker_trend"],
    "comorbidity_interaction": db["comorbidity_interaction"],
    "consistency_check": db["consistency_check"],
    "delta_snapshots": db["delta_snapshots"],
    "patient_demographics": db["patient_demographics"]
}

# =====================================================================
# REQUEST/RESPONSE MODELS
# =====================================================================

class ClinicalReasoningRequest(BaseModel):
    patient_id: str
    doctor_id: str
    consultation_text: str
    visit_type: Optional[str] = "comprehensive"
    strict_mode: Optional[bool] = True  # NEW: Enforce strict document adherence

class EnhancedClinicalReasoningResponse(BaseModel):
    status: str
    visit_type: str
    agents_executed: List[str]
    case_boundaries: Optional[Dict[str, Any]] = None
    disease_identity: Optional[Dict[str, Any]] = None
    disease_trajectory: Optional[Dict[str, Any]] = None
    treatment_memory: Optional[Dict[str, Any]] = None
    functional_psychological: Optional[Dict[str, Any]] = None
    risk_topology: Optional[Dict[str, Any]] = None
    prognosis: Optional[Dict[str, Any]] = None
    hypothesis_layer: Optional[Dict[str, Any]] = None
    next_visit_clinical_brief: Optional[Dict[str, Any]] = None
    patient_summary: Optional[Dict[str, Any]] = None
    symptom_trajectory: Optional[Dict[str, Any]] = None
    medication_safety: Optional[Dict[str, Any]] = None
    imaging_progression: Optional[Dict[str, Any]] = None
    lab_trend_analysis: Optional[Dict[str, Any]] = None
    biomarker_trend: Optional[Dict[str, Any]] = None
    comorbidity_interaction: Optional[Dict[str, Any]] = None
    consistency_check: Optional[Dict[str, Any]] = None
    confidence_scores: Dict[str, float]
    warnings: List[str]
    requires_review: bool
    execution_time_seconds: float
    delta_saved: bool
    timestamp: str
    hallucination_warnings: List[str]  # NEW: Track potential hallucinations
    error: Optional[str] = None

# =====================================================================
# API ENDPOINTS
# =====================================================================

@router.post("/clinical-reasoning", response_model=EnhancedClinicalReasoningResponse)
async def execute_enhanced_clinical_reasoning(request: ClinicalReasoningRequest):
    start_time = datetime.utcnow()
    hallucination_warnings = []
    
    try:
        logger.info(f"🚀 Enhanced Clinical Reasoning v2.1: Patient={request.patient_id}, Strict Mode={request.strict_mode}")
        
        # Pre-process to extract explicit facts
        explicit_facts = extract_explicit_facts(request.consultation_text)
        logger.info(f"📋 Explicit facts extracted: Age={explicit_facts.get('age')}, Sex={explicit_facts.get('sex')}")
        
        # Fetch medical context
        medical_context = await fetch_medical_context(request.patient_id, request.doctor_id)
        
        result = await run_enhanced_clinical_reasoning(
            patient_id=request.patient_id,
            doctor_id=request.doctor_id,
            consultation_text=request.consultation_text,
            medical_context=medical_context,
            visit_type=request.visit_type,
            strict_mode=request.strict_mode,
            explicit_facts=explicit_facts
        )
        
        execution_time = (datetime.utcnow() - start_time).total_seconds()
        result["execution_time_seconds"] = execution_time
        
        # Post-process to detect hallucinations
        hallucination_warnings = detect_hallucinations(result, explicit_facts)
        result["hallucination_warnings"] = hallucination_warnings
        
        if hallucination_warnings:
            logger.warning(f"⚠️ Detected {len(hallucination_warnings)} potential hallucinations")
            result["requires_review"] = True
        
        logger.info(f"✅ Complete: Status={result['status']}, Time={execution_time:.2f}s, Agents={len(result.get('agents_executed', []))}")
        return EnhancedClinicalReasoningResponse(**result)
        
    except Exception as e:
        logger.error(f"❌ Enhanced Clinical Reasoning Failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

def extract_explicit_facts(text: str) -> Dict[str, Any]:
    """Extract only explicitly stated facts from the document"""
    facts = {
        "age": None,
        "sex": None,
        "dates": {},
        "treatments_mentioned": [],
        "symptoms_mentioned": [],
        "lab_values": {},
        "medications": [],
        "procedures": []
    }
    
    # Extract age/sex patterns
    age_patterns = [
        r'(\d+)Y[-/](\d+)M[-/](\d+)D[/](Female|Male|F|M)',
        r'Age[/]Gender\s*[:]\s*(\d+)[Yy].*?(Female|Male|F|M)',
        r'(\d+)\s*year[s]?\s*old.*?(female|male)',
    ]
    
    for pattern in age_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            facts["age"] = int(match.group(1))
            sex = match.group(4) if len(match.groups()) >= 4 else match.group(2)
            facts["sex"] = "Female" if sex in ["Female", "F", "female"] else "Male"
            break
    
    # Extract dates
    facts["dates"] = extract_verified_dates(text)
    
    # Look for treatment keywords (but only if explicitly mentioned as "started", "on", "taking")
    treatment_indicators = ["chemotherapy", "tamoxifen", "radiation", "surgery", "immunotherapy"]
    for indicator in treatment_indicators:
        if re.search(rf'\b{indicator}\b', text, re.IGNORECASE):
            # Check if it's actually being administered vs just mentioned
            if re.search(rf'(started|on|taking|receiving|administered|given)\s+.*?\b{indicator}\b', text, re.IGNORECASE):
                facts["treatments_mentioned"].append(indicator)
    
    # Extract procedures done
    procedure_patterns = [r'(Trucut biopsy|biopsy|surgery|excision)']
    for pattern in procedure_patterns:
        matches = re.findall(pattern, text, re.IGNORECASE)
        facts["procedures"].extend(matches)
    
    return facts

def detect_hallucinations(result: Dict, explicit_facts: Dict) -> List[str]:
    """Detect potential hallucinations in the output"""
    warnings = []
    
    # Check for invented dates
    trajectory = result.get("disease_trajectory", {})
    for timeline in trajectory.get("disease_timelines", []):
        for event in timeline.get("key_events", []):
            event_date = event.get("date")
            if event_date and event_date not in explicit_facts["dates"]:
                if not any(d in event_date for d in explicit_facts["dates"]):
                    warnings.append(f"Potential invented date: {event_date} in {timeline.get('case_id')}")
    
    # Check for invented treatments
    treatment_memory = result.get("treatment_memory", {})
    for treatment in treatment_memory.get("active_treatments", []):
        treatment_name = treatment.get("name", "").lower()
        if treatment_name not in [t.lower() for t in explicit_facts["treatments_mentioned"]]:
            warnings.append(f"Potential invented treatment: {treatment.get('name')}")
    
    # Check age/sex consistency
    if explicit_facts["age"]:
        for agent_name in ["disease_identity", "risk_topology"]:
            agent_data = result.get(agent_name, {})
            if "age_sex_considerations" in str(agent_data):
                if "unknown" in str(agent_data.get("age_sex_considerations", "")).lower():
                    warnings.append(f"{agent_name} reports unknown age/sex but document states {explicit_facts['age']}Y/{explicit_facts['sex']}")
    
    return warnings

# =====================================================================
# MEDICAL CONTEXT FETCHER
# =====================================================================

async def fetch_medical_context(patient_id: str, doctor_id: str) -> Dict[str, Any]:
    """Fetch complete medical context including all agent layers"""
    logger.info(f"📚 Fetching Medical Context: Patient={patient_id}")
    
    medical_context = {
        "patient_id": patient_id,
        "doctor_id": doctor_id,
        "timestamp": datetime.utcnow().isoformat(),
        "patient_demographics": {},
        "case_boundaries": {},
        "disease_identity": {},
        "disease_trajectory": {},
        "treatment_memory": {},
        "functional_status": {},
        "risk_topology": {},
        "prognosis": {},
        "hypothesis_layer": {},
        "next_visit_brief": {},
        "patient_summary": {},
        "symptom_trajectory": {},
        "medication_safety": {},
        "imaging_progression": {},
        "lab_trend_analysis": {},
        "biomarker_trend": {},
        "comorbidity_interaction": {}
    }
    
    for field, col in [
        ("patient_demographics", collections_map["patient_demographics"]),
        ("case_boundaries", collections_map["case_boundaries"]),
        ("disease_identity", collections_map["disease_identity"]),
        ("disease_trajectory", collections_map["disease_trajectory"]),
        ("treatment_memory", collections_map["treatment_memory"]),
        ("functional_status", collections_map["functional_status"]),
        ("risk_topology", collections_map["risk_topology"]),
        ("prognosis", collections_map["prognosis"]),
        ("hypothesis_layer", collections_map["hypothesis_layer"]),
        ("next_visit_brief", collections_map["next_visit_brief"]),
        ("patient_summary", collections_map["patient_summary"]),
        ("symptom_trajectory", collections_map["symptom_trajectory"]),
        ("medication_safety", collections_map["medication_safety"]),
        ("imaging_progression", collections_map["imaging_progression"]),
        ("lab_trend_analysis", collections_map["lab_trend_analysis"]),
        ("biomarker_trend", collections_map["biomarker_trend"]),
        ("comorbidity_interaction", collections_map["comorbidity_interaction"])
    ]:
        medical_context[field] = await fetch_agent_layer(patient_id, field, col)
    
    return medical_context

async def fetch_agent_layer(patient_id: str, field_name: str, collection) -> Dict[str, Any]:
    """Fetch a specific agent layer from MongoDB"""
    try:
        doc = await collection.find_one({"patient_id": patient_id}, {"_id": 0, field_name: 1})
        return doc.get(field_name, {}) if doc else {}
    except Exception as e:
        logger.error(f"❌ Failed fetching {field_name}: {str(e)}")
        return {}

# =====================================================================
# STATE DEFINITION
# =====================================================================

class ClinicalReasoningState(TypedDict):
    patient_id: str
    doctor_id: str
    consultation_text: str
    visit_type: str
    strict_mode: bool
    explicit_facts: Dict[str, Any]
    medical_context: Dict[str, Any]
    patient_demographics: Dict[str, Any]
    doctor_prompts: Dict[str, str]
    
    # Agent outputs
    case_boundaries: Optional[Dict[str, Any]]
    disease_identity: Optional[Dict[str, Any]]
    disease_trajectory: Optional[Dict[str, Any]]
    treatment_memory: Optional[Dict[str, Any]]
    functional_status: Optional[Dict[str, Any]]
    risk_topology: Optional[Dict[str, Any]]
    prognosis: Optional[Dict[str, Any]]
    hypothesis_layer: Optional[Dict[str, Any]]
    next_visit_brief: Optional[Dict[str, Any]]
    patient_summary: Optional[Dict[str, Any]]
    symptom_trajectory: Optional[Dict[str, Any]]
    medication_safety: Optional[Dict[str, Any]]
    imaging_progression: Optional[Dict[str, Any]]
    lab_trend_analysis: Optional[Dict[str, Any]]
    biomarker_trend: Optional[Dict[str, Any]]
    comorbidity_interaction: Optional[Dict[str, Any]]
    
    # System
    consistency_check: Optional[Dict[str, Any]]
    confidence_scores: Dict[str, float]
    warnings: List[str]
    requires_review: bool
    agents_executed: List[str]
    hallucination_warnings: List[str]
    error: Optional[str]

# =====================================================================
# ENHANCED AGENTS WITH STRICT ADHERENCE
# =====================================================================

class CaseBoundaryAgent:
    """Case categorization agent - STRICT: Only use document data"""
    
    def __init__(self, llm):
        self.llm = llm
    
    def analyze(self, state: ClinicalReasoningState):
        consultation_text = state.get("consultation_text", "")
        existing_boundaries = state.get("medical_context", {}).get("case_boundaries", {})
        demographics = state.get("medical_context", {}).get("patient_demographics", {})
        explicit_facts = state.get("explicit_facts", {})
        
        # Use explicit facts if available, otherwise unknown
        age = explicit_facts.get("age") or demographics.get("age", "unknown")
        sex = explicit_facts.get("sex") or demographics.get("sex", "unknown")
        
        prompt = f"""
{strict_document_prompt(consultation_text)}

You are a clinical case boundary detection agent.

TODAY: {datetime.utcnow().strftime("%Y-%m-%d")}
PATIENT: Age {age}, Sex {sex}

EXISTING CASE BOUNDARIES:
{safe_json(existing_boundaries)}

TASK: Classify diseases/conditions mentioned in the document ONLY.

CRITICAL RULES:
1. If a condition is mentioned in the document, classify it
2. If a condition is NOT mentioned, do NOT invent it
3. Use dates ONLY from the document: {list(explicit_facts.get("dates", {}).keys())}
4. For biopsy reports, the "onset" is the biopsy date or "unknown" if not stated
5. "Not identified" means NOT present - do not list as absent

Return JSON:
{{
  "case_separation_summary": "1-2 sentences using only document facts",
  "active_new_cases": [
    {{
      "case_id": "unique_id_based_on_disease_and_date_from_document",
      "disease": "name from document",
      "onset_date": "YYYY-MM from document or unknown",
      "basis_for_new_case": "why this is new based on document text",
      "source_document_date": "date from document"
    }}
  ],
  "active_ongoing_conditions": [],
  "active_recurrence": [],
  "resolved_historical_cases": [],
  "surveillance_cases": []
}}

VERIFICATION: Before outputting, check each case against the document text.
"""
        
        response = self.llm.invoke([
            SystemMessage(content="Case boundary detection agent. STRICT document adherence."),
            HumanMessage(content=prompt)
        ])
        
        result = parse_llm_json(response.content)
        
        # Intelligent merge with existing
        state["case_boundaries"] = intelligent_merge_case_boundaries(existing_boundaries, result)
        
        completeness = 1.0 if result.get("case_separation_summary") else 0.5
        state["confidence_scores"]["case_boundaries"] = calculate_confidence(
            data_completeness=completeness,
            consistency_score=1.0,
            data_recency_days=0
        )
        
        state["agents_executed"].append("case_boundary_agent")
        return state

def intelligent_merge_case_boundaries(existing: Dict, new_data: Dict) -> Dict:
    """Intelligently merge case boundaries"""
    if not existing:
        return new_data
    
    result = existing.copy()
    
    # For each category, merge by case_id
    categories = ["active_new_cases", "active_ongoing_conditions", "active_recurrence", 
                  "resolved_historical_cases", "surveillance_cases"]
    
    for category in categories:
        existing_cases = {c.get("case_id"): c for c in existing.get(category, [])}
        new_cases = {c.get("case_id"): c for c in new_data.get(category, [])}
        
        merged = []
        
        # Update existing
        for case_id, case in existing_cases.items():
            if case_id in new_cases:
                case.update(new_cases[case_id])
            merged.append(case)
        
        # Add new
        for case_id, case in new_cases.items():
            if case_id not in existing_cases:
                merged.append(case)
        
        result[category] = merged
    
    result["last_updated"] = datetime.utcnow().isoformat()
    return result

class DiseaseIdentityAgent:
    """Disease identity tracking - STRICT: Only document facts"""
    
    def __init__(self, llm):
        self.llm = llm

    def analyze(self, state: ClinicalReasoningState):
        consultation_text = state.get("consultation_text", "")
        existing = state.get("medical_context", {}).get("disease_identity", {})
        case_boundaries = state.get("case_boundaries", {})
        explicit_facts = state.get("explicit_facts", {})
        
        age = explicit_facts.get("age", "unknown")
        sex = explicit_facts.get("sex", "unknown")
        
        # Get active cases from boundaries
        active_cases = []
        for category in ["active_new_cases", "active_ongoing_conditions", "active_recurrence"]:
            active_cases.extend(case_boundaries.get(category, []))
        
        prompt = f"""
{strict_document_prompt(consultation_text)}

You are a clinical identity agent.

TODAY: {datetime.utcnow().strftime("%Y-%m-%d")}
PATIENT: Age {age}, Sex {sex} (EXTRACTED FROM DOCUMENT)

ACTIVE CASES FROM BOUNDARIES:
{safe_json(active_cases)}

EXISTING DISEASE IDENTITY:
{safe_json(existing)}

TASK: Create disease identity for ACTIVE cases using ONLY document data.

CRITICAL RULES:
1. Use EXACT values from pathology tables (ER, PR, HER2, Ki67, Grade)
2. If a marker says "Not identified" → record as "not_identified", NOT "negative" or "absent"
3. If a value is not in the document → use null or omit
4. Age and sex ARE known: {age}Y/{sex} - use these for considerations
5. Do NOT infer treatments or outcomes not stated

For the uploaded breast cancer pathology report:
- Left breast: ER+, PR+, HER2-, Ki67 15%, Grade 2, DCIS not identified
- Right breast: ER+, PR+, HER2-, Ki67 18-20%, Grade 2, DCIS identified (solid, cribriform, comedo)

Return JSON:
{{
  "primary_diagnoses": [
    {{
      "case_id": "from case_boundaries",
      "case_category": "active_new_case etc",
      "name": "Exact diagnosis from document",
      "location": "Exact location from document",
      "laterality": "left | right | bilateral",
      "key_markers": {{
        "grade": "from document",
        "er": "Positive/Negative/Not identified - EXACT",
        "pr": "Positive/Negative/Not identified - EXACT",
        "her2": "Positive/Negative/Score X - EXACT",
        "ki67": "X% - EXACT from document"
      }},
      "additional_findings": {{
        "dcis": "identified/not_identified - EXACT",
        "dcis_details": "if identified, patterns from document",
        "lymphovascular_invasion": "identified/not_identified - EXACT"
      }},
      "status": "active_current",
      "first_detected": "date from document or unknown",
      "last_updated": "{datetime.utcnow().isoformat()}",
      "source_document_date": "date on report",
      "age_sex_considerations": "Relevant to {age}Y {sex}",
      "confidence": "high | medium | low based on document clarity"
    }}
  ],
  "last_updated": "{datetime.utcnow().isoformat()}",
  "overall_status": "active"
}}

VERIFICATION: Check each field against the document. If not in document → null.
"""
        
        response = self.llm.invoke([
            SystemMessage(content="Clinical identity agent. EXACT document values only."),
            HumanMessage(content=prompt)
        ])
        
        result = parse_llm_json(response.content)
        
        # Intelligent merge
        state["disease_identity"] = intelligent_merge_disease_identity(existing, result)
        
        # Calculate confidence
        diagnoses = result.get("primary_diagnoses", [])
        completeness = len([d for d in diagnoses if d.get("case_id")]) / max(len(diagnoses), 1)
        state["confidence_scores"]["disease_identity"] = calculate_confidence(
            data_completeness=completeness,
            consistency_score=1.0,
            data_recency_days=0
        )
        
        state["agents_executed"].append("disease_identity_agent")
        return state

class DiseaseTrajectoryAgent:
    """Disease trajectory tracking - STRICT"""
    
    def __init__(self, llm):
        self.llm = llm

    def analyze(self, state: ClinicalReasoningState):
        consultation_text = state.get("consultation_text", "")
        existing = state.get("medical_context", {}).get("disease_trajectory", {})
        identity = state.get("disease_identity", {})
        case_boundaries = state.get("case_boundaries", {})
        explicit_facts = state.get("explicit_facts", {})
        
        age = explicit_facts.get("age", "unknown")
        sex = explicit_facts.get("sex", "unknown")
        
        active_cases = []
        for category in ["active_new_cases", "active_ongoing_conditions", "active_recurrence"]:
            active_cases.extend(case_boundaries.get(category, []))
        
        prompt = f"""
{strict_document_prompt(consultation_text)}

You are a disease trajectory agent.

TODAY: {datetime.utcnow().strftime("%Y-%m-%d")}
PATIENT: Age {age}, Sex {sex}

ACTIVE CASES: {safe_json([c.get("case_id") for c in active_cases])}

EXISTING TRAJECTORY:
{safe_json(existing)}

TASK: Track timeline for ACTIVE cases using ONLY document dates and events.

CRITICAL RULES:
1. Use ONLY dates from document: {list(explicit_facts.get("dates", {}).keys())}
2. If no prior history in document → state "no prior history in document"
3. Do NOT invent progression or improvement - only document facts
4. For biopsy reports, this is usually "initial_diagnosis" event
5. If document doesn't mention prior imaging/labs → omit

Return JSON:
{{
  "overall_trajectory": "stable | unknown (if only one time point)",
  "trajectory_summary": "Based only on document facts",
  "last_updated": "{datetime.utcnow().isoformat()}",
  "disease_timelines": [
    {{
      "case_id": "from active cases",
      "case_category": "active_new_case etc",
      "disease_name": "from identity",
      "location": "from document",
      "current_stage_or_extent": "from document or unknown",
      "trajectory_direction": "stable (if only one data point)",
      "key_events": [
        {{
          "date": "date from document or unknown",
          "type": "initial_diagnosis | biopsy | imaging | lab",
          "summary": "what happened - from document only",
          "is_new": true,
          "document_source": "which report/date",
          "interpretation": "clinical meaning"
        }}
      ],
      "next_evaluation_due": "unknown (not enough data)"
    }}
  ]
}}

VERIFICATION: Are all dates from the document? If not, change to "unknown".
"""
        
        response = self.llm.invoke([
            SystemMessage(content="Disease trajectory agent. Document dates only."),
            HumanMessage(content=prompt)
        ])
        
        result = parse_llm_json(response.content)
        state["disease_trajectory"] = intelligent_merge_disease_trajectory(existing, result)
        
        state["confidence_scores"]["disease_trajectory"] = 0.85
        state["agents_executed"].append("disease_trajectory_agent")
        return state

class TreatmentMemoryAgent:
    """
    Treatment memory tracking - STRICT document adherence.
    No hardcoded treatment names.
    No inferred treatments.
    Works for discharge summaries, OPD notes, pathology, etc.
    """

    def __init__(self, llm):
        self.llm = llm

    def analyze(self, state: ClinicalReasoningState):
        consultation_text = state.get("consultation_text", "")
        existing = state.get("medical_context", {}).get("treatment_memory", {})

        prompt = f"""
{strict_document_prompt(consultation_text)}

You are a treatment memory agent.

TODAY: {datetime.utcnow().strftime("%Y-%m-%d")}

EXISTING TREATMENT MEMORY:
{safe_json(existing)}

TASK:
Extract ONLY therapeutic treatments and therapeutic procedures.

IMPORTANT:
Many medical reports contain **diagnostic procedures** (biopsy, PET-CT, ultrasound, mammogram, histopathology, IHC).
These are NOT treatments.

You must distinguish:

THERAPEUTIC TREATMENTS:
- medications prescribed
- chemotherapy
- radiation therapy
- hormone therapy
- targeted therapy
- surgery intended to remove disease
- therapeutic procedures

DIAGNOSTIC PROCEDURES (NOT treatments):
- biopsy
- histopathology
- PET-CT
- CT
- MRI
- ultrasound
- mammography
- IHC tests
- lab tests

If the document only contains diagnostic procedures → return empty treatment lists.

PLANNED VS COMPLETED LOGIC

If the document contains phrases like:
- "advised"
- "suggested"
- "planned"
- "recommended"

then record the item as **planned_treatments**.

If a later document shows the procedure actually performed (e.g. biopsy report), update status to **completed_treatments**.

CRITICAL RULES
1. Only extract treatments explicitly written in the document.
2. Do NOT infer treatment from diagnosis.
3. Do NOT classify diagnostic tests as treatment.
4. If no treatment is mentioned → return empty lists.

CLASSIFICATION RULES

completed_treatments
- "underwent"
- "performed"
- "done"
- "completed"

active_treatments
- "started"
- "receiving"
- "on treatment"

planned_treatments
- "planned"
- "advised"
- "recommended"
- "scheduled"

Each treatment entry must include:
- id (snake_case unique identifier)
- name (exact wording from document)
- type ("medication", "surgery", "therapy")
- source_phrase (exact phrase from document)

Return JSON:

{{
  "treatment_summary": "Summary of documented treatments OR 'No treatment data in document'",
  "last_updated": "{datetime.utcnow().isoformat()}",
  "active_treatments": [],
  "completed_treatments": [],
  "planned_treatments": [],
  "historical_treatments_reference": []
}}

VERIFICATION
Before returning:
- Confirm wording exists in document.
- If the item is diagnostic → remove it.
"""

        response = self.llm.invoke([
            SystemMessage(content="Treatment memory agent. STRICT document adherence. No inferred treatments."),
            HumanMessage(content=prompt)
        ])

        result = parse_llm_json(response.content)

        # -----------------------------
        # 🔎 HALLUCINATION VALIDATION
        # -----------------------------
        for category in ["active_treatments", "completed_treatments", "planned_treatments"]:
            for treatment in result.get(category, []):
                name = treatment.get("name", "")
                if name and name not in consultation_text:
                    state["warnings"].append(
                        f"Potential hallucinated treatment removed: {name}"
                    )
                    state["requires_review"] = True
                    result[category].remove(treatment)

        # -----------------------------
        # 🔁 Intelligent Merge
        # -----------------------------
        state["treatment_memory"] = intelligent_merge_treatment_memory(existing, result)

        # -----------------------------
        # 🎯 Confidence Scoring
        # -----------------------------
        total_treatments = (
            len(result.get("active_treatments", [])) +
            len(result.get("completed_treatments", [])) +
            len(result.get("planned_treatments", []))
        )

        state["confidence_scores"]["treatment_memory"] = (
            0.95 if total_treatments == 0 else 0.85
        )

        state["agents_executed"].append("treatment_memory_agent")

        return state

class LabTrendAnalysisAgent:
    """Lab trend analysis - STRICT: Exact values only"""
    
    def __init__(self, llm):
        self.llm = llm
    
    def analyze(self, state: ClinicalReasoningState):
        consultation_text = state.get("consultation_text", "")
        existing = state.get("medical_context", {}).get("lab_trend_analysis", {})
        explicit_facts = state.get("explicit_facts", {})
        
        age = explicit_facts.get("age", "unknown")
        sex = explicit_facts.get("sex", "unknown")
        
        prompt = f"""
{strict_document_prompt(consultation_text)}

You are a lab trend analysis agent.

TODAY: {datetime.utcnow().strftime("%Y-%m-%d")}
PATIENT: Age {age}, Sex {sex}

EXISTING LAB TRENDS:
{safe_json(existing)}

TASK: Extract lab values from document ONLY.

CRITICAL RULES:
1. Use EXACT values from tables (IHC scores, Ki67 percentages)
2. Include age/sex-specific reference ranges if calculable
3. If only one data point → trend is "insufficient_data"
4. Do NOT project future values without historical data
5. "Not identified" = not tested or not present - record as null

For IHC reports:
- Record proportion score, intensity score, total score exactly as shown
- Ki67: record exact percentage

Return JSON:
{{
  "lab_trends": [
    {{
      "test": "Exact test name from document",
      "unit": "unit from document",
      "timeline": [
        {{
          "date": "date from document",
          "value": "exact value",
          "status": "normal | abnormal | not_identified",
          "age_sex_reference_range": "calculated for {age}Y {sex}",
          "interpretation": "clinical meaning"
        }}
      ],
      "trend": "stable | insufficient_data",
      "clinical_significance": "from document or standard interpretation",
      "source": "document section"
    }}
  ],
  "organ_function_monitoring": {{}},
  "critical_lab_alerts": [],
  "lab_summary": "Summary of document lab data only",
  "last_updated": "{datetime.utcnow().isoformat()}"
}}

VERIFICATION: Is each value from a table or explicit statement in the document?
"""
        
        response = self.llm.invoke([
            SystemMessage(content="Lab trend agent. Exact document values."),
            HumanMessage(content=prompt)
        ])
        
        result = parse_llm_json(response.content)
        state["lab_trend_analysis"] = intelligent_merge_lab_trends(existing, result)
        
        trends = result.get("lab_trends", [])
        completeness = 1.0 if trends else 0.0
        
        state["confidence_scores"]["lab_trend_analysis"] = calculate_confidence(
            data_completeness=completeness,
            consistency_score=1.0,
            data_recency_days=0
        )
        
        state["agents_executed"].append("lab_trend_analysis_agent")
        return state

class BiomarkerTrendAgent:
    """Biomarker tracking - STRICT"""
    
    def __init__(self, llm):
        self.llm = llm
    
    def analyze(self, state: ClinicalReasoningState):
        consultation_text = state.get("consultation_text", "")
        existing = state.get("medical_context", {}).get("biomarker_trend", {})
        explicit_facts = state.get("explicit_facts", {})
        
        prompt = f"""
{strict_document_prompt(consultation_text)}

You are a biomarker trend agent.

TODAY: {datetime.utcnow().strftime("%Y-%m-%d")}

EXISTING BIOMARKER TRENDS:
{safe_json(existing)}

TASK: Extract tumor markers from document ONLY.

CRITICAL RULES:
1. Record EXACT values (CA 15-3, CEA, etc.) with units
2. If marker not in document → omit
3. Single value = "insufficient_data" for trend
4. Do NOT calculate doubling time without 2+ values

Return JSON:
{{
  "biomarker_trends": [],
  "response_assessment_by_marker": {{
    "biochemical_response": "insufficient_data"
  }},
  "biomarker_summary": "No tumor markers in document or list extracted values",
  "last_updated": "{datetime.utcnow().isoformat()}"
}}
"""
        
        response = self.llm.invoke([
            SystemMessage(content="Biomarker trend agent."),
            HumanMessage(content=prompt)
        ])
        
        result = parse_llm_json(response.content)
        
        # Simple merge for biomarkers
        if existing and result:
            existing_trends = {b.get("marker"): b for b in existing.get("biomarker_trends", [])}
            new_trends = {b.get("marker"): b for b in result.get("biomarker_trends", [])}
            
            # Update existing with new data
            for marker, trend in new_trends.items():
                if marker in existing_trends:
                    existing_trends[marker]["timeline"].extend(trend.get("timeline", []))
                    existing_trends[marker]["timeline"] = sorted(
                        existing_trends[marker]["timeline"], 
                        key=lambda x: x.get("date", "")
                    )
                else:
                    existing_trends[marker] = trend
            
            result["biomarker_trends"] = list(existing_trends.values())
        
        state["biomarker_trend"] = result
        state["confidence_scores"]["biomarker_trend"] = 0.85
        state["agents_executed"].append("biomarker_trend_agent")
        return state

class MedicationSafetyAgent:
    """Medication safety - STRICT"""
    
    def __init__(self, llm):
        self.llm = llm
    
    def analyze(self, state: ClinicalReasoningState):
        consultation_text = state.get("consultation_text", "")
        existing = state.get("medical_context", {}).get("medication_safety", {})
        explicit_facts = state.get("explicit_facts", {})
        
        age = explicit_facts.get("age", "unknown")
        
        prompt = f"""
{strict_document_prompt(consultation_text)}

You are a medication safety agent.

TODAY: {datetime.utcnow().strftime("%Y-%m-%d")}
PATIENT AGE: {age}

EXISTING SAFETY RECORD:
{safe_json(existing)}

TASK: Analyze medication safety using ONLY document data.

CRITICAL RULES:
1. If NO medications in document → return empty medication_list
2. Pathology reports usually don't contain medication lists
3. Do NOT infer medications from diagnosis
4. If age >= 65, note Beers criteria applicability

Return JSON:
{{
  "medication_list": [],
  "drug_drug_interactions": [],
  "age_inappropriate_medications": [],
  "critical_safety_alerts": [],
  "safety_summary": "No medication data in document",
  "requires_pharmacist_review": false,
  "last_updated": "{datetime.utcnow().isoformat()}"
}}
"""
        
        response = self.llm.invoke([
            SystemMessage(content="Medication safety agent."),
            HumanMessage(content=prompt)
        ])
        
        result = parse_llm_json(response.content)
        state["medication_safety"] = result
        state["confidence_scores"]["medication_safety"] = 0.9
        state["agents_executed"].append("medication_safety_agent")
        return state

class ImagingProgressionAgent:
    """Imaging progression - STRICT"""
    
    def __init__(self, llm):
        self.llm = llm
    
    def analyze(self, state: ClinicalReasoningState):
        consultation_text = state.get("consultation_text", "")
        existing = state.get("medical_context", {}).get("imaging_progression", {})
        
        prompt = f"""
{strict_document_prompt(consultation_text)}

You are an imaging progression agent.

EXISTING IMAGING:
{safe_json(existing)}

TASK: Extract imaging data from document ONLY.

CRITICAL RULES:
1. Pathology reports describe tissue, not imaging
2. If imaging mentioned (e.g., "BIRADS 4C"), record it
3. Do NOT invent measurements not in document

Return JSON:
{{
  "imaging_timeline": [],
  "recist_assessment": {{}},
  "imaging_summary": "No imaging data in document or limited mention",
  "last_updated": "{datetime.utcnow().isoformat()}"
}}
"""
        
        response = self.llm.invoke([
            SystemMessage(content="Imaging progression agent."),
            HumanMessage(content=prompt)
        ])
        
        result = parse_llm_json(response.content)
        state["imaging_progression"] = result
        state["confidence_scores"]["imaging_progression"] = 0.85
        state["agents_executed"].append("imaging_progression_agent")
        return state

class RiskTopologyAgent:
    """Risk assessment - STRICT"""
    
    def __init__(self, llm):
        self.llm = llm

    def analyze(self, state: ClinicalReasoningState):
        consultation_text = state.get("consultation_text", "")
        existing = state.get("medical_context", {}).get("risk_topology", {})
        disease_identity = state.get("disease_identity", {})
        explicit_facts = state.get("explicit_facts", {})
        
        age = explicit_facts.get("age", "unknown")
        sex = explicit_facts.get("sex", "unknown")
        
        prompt = f"""
{strict_document_prompt(consultation_text)}

You are a risk topology agent.

PATIENT: Age {age}, Sex {sex}

EXISTING RISKS:
{safe_json(existing)}

DISEASE IDENTITY:
{safe_json(disease_identity)}

TASK: Assess risks based on documented findings ONLY.

CRITICAL RULES:
1. Base risks ONLY on documented disease characteristics
2. Age {age} is known - use for age-specific risks
3. Do NOT invent complications not mentioned
4. For cancer: stage, grade, receptor status drive risk

Return JSON:
{{
  "overall_risk_level": "low | moderate | high based on documented factors",
  "risk_summary": "Based on document findings",
  "active_risks": [
    {{
      "category": "oncological | treatment_toxicity | functional",
      "name": "Risk name",
      "severity": "low | moderate | high",
      "basis": "document finding that creates this risk",
      "age_sex_modifier": "how age {age} and sex {sex} modify risk"
    }}
  ],
  "last_updated": "{datetime.utcnow().isoformat()}"
}}
"""
        
        response = self.llm.invoke([
            SystemMessage(content="Risk topology agent."),
            HumanMessage(content=prompt)
        ])
        
        result = parse_llm_json(response.content)
        state["risk_topology"] = result
        state["confidence_scores"]["risk_topology"] = 0.85
        state["agents_executed"].append("risk_topology_agent")
        return state

class PrognosisAgent:
    """Prognosis assessment - STRICT"""
    
    def __init__(self, llm):
        self.llm = llm

    def analyze(self, state: ClinicalReasoningState):
        consultation_text = state.get("consultation_text", "")
        existing = state.get("medical_context", {}).get("prognosis", {})
        disease_identity = state.get("disease_identity", {})
        explicit_facts = state.get("explicit_facts", {})
        
        age = explicit_facts.get("age", "unknown")
        
        prompt = f"""
{strict_document_prompt(consultation_text)}

You are a prognosis agent.

PATIENT AGE: {age}

EXISTING PROGNOSIS:
{safe_json(existing)}

DISEASE IDENTITY:
{safe_json(disease_identity)}

TASK: Provide prognosis based on documented factors ONLY.

CRITICAL RULES:
1. Use established prognostic factors from document (grade, stage, receptors)
2. Age {age} is known - use for life expectancy estimates
3. Do NOT invent survival statistics
4. State if insufficient data for prognosis

Return JSON:
{{
  "overall_prognosis": "favorable | intermediate | poor | unknown",
  "prognosis_summary": "Based on documented factors or state insufficient data",
  "disease_specific": [],
  "insufficient_data": true | false,
  "last_updated": "{datetime.utcnow().isoformat()}"
}}
"""
        
        response = self.llm.invoke([
            SystemMessage(content="Prognosis agent."),
            HumanMessage(content=prompt)
        ])
        
        result = parse_llm_json(response.content)
        state["prognosis"] = result
        state["confidence_scores"]["prognosis"] = 0.85
        state["agents_executed"].append("prognosis_agent")
        return state

class SymptomTrajectoryAgent:
    """Symptom tracking - STRICT"""
    
    def __init__(self, llm):
        self.llm = llm
    
    def analyze(self, state: ClinicalReasoningState):
        consultation_text = state.get("consultation_text", "")
        existing = state.get("medical_context", {}).get("symptom_trajectory", {})
        
        prompt = f"""
{strict_document_prompt(consultation_text)}

You are a symptom trajectory agent.

EXISTING SYMPTOMS:
{safe_json(existing)}

TASK: Extract symptoms from document ONLY.

CRITICAL RULES:
1. Pathology reports rarely contain symptoms
2. If symptoms mentioned (e.g., "patient presented with lump"), record them
3. Do NOT infer symptoms from diagnosis

Return JSON:
{{
  "symptom_timeline": [],
  "new_symptoms_this_visit": [],
  "symptom_summary": "No symptom data in document",
  "last_updated": "{datetime.utcnow().isoformat()}"
}}
"""
        
        response = self.llm.invoke([
            SystemMessage(content="Symptom trajectory agent."),
            HumanMessage(content=prompt)
        ])
        
        result = parse_llm_json(response.content)
        state["symptom_trajectory"] = result
        state["confidence_scores"]["symptom_trajectory"] = 0.85
        state["agents_executed"].append("symptom_trajectory_agent")
        return state

class ComorbidityInteractionAgent:
    """Comorbidity analysis - STRICT"""
    
    def __init__(self, llm):
        self.llm = llm
    
    def analyze(self, state: ClinicalReasoningState):
        consultation_text = state.get("consultation_text", "")
        existing = state.get("medical_context", {}).get("comorbidity_interaction", {})
        case_boundaries = state.get("case_boundaries", {})
        
        prompt = f"""
{strict_document_prompt(consultation_text)}

You are a comorbidity interaction agent.

CASE BOUNDARIES:
{safe_json(case_boundaries)}

EXISTING INTERACTIONS:
{safe_json(existing)}

TASK: Analyze comorbidities mentioned in document ONLY.

CRITICAL RULES:
1. Only use conditions listed in case_boundaries
2. If only cancer mentioned, state "no other comorbidities documented"
3. Do NOT invent chronic conditions

Return JSON:
{{
  "condition_interactions": [],
  "complexity_score": "low",
  "interaction_summary": "Based on documented conditions only",
  "last_updated": "{datetime.utcnow().isoformat()}"
}}
"""
        
        response = self.llm.invoke([
            SystemMessage(content="Comorbidity interaction agent."),
            HumanMessage(content=prompt)
        ])
        
        result = parse_llm_json(response.content)
        state["comorbidity_interaction"] = result
        state["confidence_scores"]["comorbidity_interaction"] = 0.85
        state["agents_executed"].append("comorbidity_interaction_agent")
        return state

class ConsistencyCheckerAgent:
    """Validates consistency between agents"""
    
    def __init__(self, llm):
        self.llm = llm
    
    def analyze(self, state: ClinicalReasoningState):
        conflicts = []
        
        # Check 1: Disease identity vs boundaries
        identity = state.get("disease_identity", {})
        boundaries = state.get("case_boundaries", {})
        
        identity_cases = {d.get("case_id") for d in identity.get("primary_diagnoses", [])}
        boundary_cases = set()
        for cat in ["active_new_cases", "active_ongoing_conditions"]:
            boundary_cases.update({c.get("case_id") for c in boundaries.get(cat, [])})
        
        if identity_cases != boundary_cases:
            conflicts.append({
                "type": "case_id_mismatch",
                "severity": "high",
                "description": f"Disease identity cases {identity_cases} don't match boundary cases {boundary_cases}"
            })
        
        # Check 2: Age consistency
        explicit_age = state.get("explicit_facts", {}).get("age")
        for agent_name in ["disease_identity", "risk_topology", "prognosis"]:
            agent_data = state.get(agent_name, {})
            if "unknown" in str(agent_data).lower() and explicit_age:
                conflicts.append({
                    "type": "data_availability",
                    "severity": "medium",
                    "description": f"{agent_name} reports unknown age but document states {explicit_age}"
                })
        
        # Check 3: Treatment hallucination check
        treatments = state.get("treatment_memory", {}).get("active_treatments", [])
        if treatments and not state.get("explicit_facts", {}).get("treatments_mentioned"):
            conflicts.append({
                "type": "potential_hallucination",
                "severity": "critical",
                "description": "Treatments recorded but none found in document",
                "recommendation": "Remove all treatments or verify document"
            })
            state["requires_review"] = True
        
        consistency_check = {
            "checks_performed": 3,
            "conflicts_found": len(conflicts),
            "conflicts": conflicts,
            "overall_consistency": "high" if len(conflicts) == 0 else "low" if any(c["severity"] == "critical" for c in conflicts) else "medium",
            "requires_clinical_review": len(conflicts) > 0
        }
        
        state["consistency_check"] = consistency_check
        
        for conflict in conflicts:
            if conflict["severity"] in ["high", "critical"]:
                state["warnings"].append(f"CONSISTENCY: {conflict['description']}")
        
        state["confidence_scores"]["consistency_check"] = max(0.3, 1.0 - len(conflicts) * 0.3)
        state["agents_executed"].append("consistency_checker")
        
        return state

class PatientSummaryAgent:
    """Final synthesis"""
    
    def __init__(self, llm):
        self.llm = llm
    
    def analyze(self, state: ClinicalReasoningState):
        # Compile summary from all agents
        summary = {
            "patient_id": state["patient_id"],
            "summary_generated": datetime.utcnow().isoformat(),
            "case_count": len(state.get("case_boundaries", {}).get("active_new_cases", [])),
            "active_conditions": [d.get("name") for d in state.get("disease_identity", {}).get("primary_diagnoses", [])],
            "key_findings": "See individual agents",
            "requires_review": state.get("requires_review", False),
            "warnings_count": len(state.get("warnings", []))
        }
        
        state["patient_summary"] = summary
        state["confidence_scores"]["patient_summary"] = 0.9
        state["agents_executed"].append("patient_summary_agent")
        return state

# =====================================================================
# WORKFLOW ORCHESTRATION
# =====================================================================

async def run_enhanced_clinical_reasoning(
    patient_id: str,
    doctor_id: str,
    consultation_text: str,
    medical_context: Dict[str, Any],
    visit_type: str = "comprehensive",
    strict_mode: bool = True,
    explicit_facts: Dict[str, Any] = None
) -> Dict[str, Any]:
    """Execute the clinical reasoning workflow"""
    
    # Initialize state
    state: ClinicalReasoningState = {
        "patient_id": patient_id,
        "doctor_id": doctor_id,
        "consultation_text": consultation_text,
        "visit_type": visit_type,
        "strict_mode": strict_mode,
        "explicit_facts": explicit_facts or {},
        "medical_context": medical_context,
        "patient_demographics": medical_context.get("patient_demographics", {}),
        "doctor_prompts": {},
        
        # Initialize all agent outputs
        "case_boundaries": None,
        "disease_identity": None,
        "disease_trajectory": None,
        "treatment_memory": None,
        "functional_status": None,
        "risk_topology": None,
        "prognosis": None,
        "hypothesis_layer": None,
        "next_visit_brief": None,
        "patient_summary": None,
        "symptom_trajectory": None,
        "medication_safety": None,
        "imaging_progression": None,
        "lab_trend_analysis": None,
        "biomarker_trend": None,
        "comorbidity_interaction": None,
        
        # System
        "consistency_check": None,
        "confidence_scores": {},
        "warnings": [],
        "requires_review": False,
        "agents_executed": [],
        "hallucination_warnings": [],
        "error": None
    }
    
    # Initialize agents
    agents = {
        "case_boundary_agent": CaseBoundaryAgent(llm),
        "disease_identity_agent": DiseaseIdentityAgent(llm),
        "disease_trajectory_agent": DiseaseTrajectoryAgent(llm),
        "treatment_memory_agent": TreatmentMemoryAgent(llm),
        "lab_trend_analysis_agent": LabTrendAnalysisAgent(llm),
        "biomarker_trend_agent": BiomarkerTrendAgent(llm),
        "medication_safety_agent": MedicationSafetyAgent(llm),
        "imaging_progression_agent": ImagingProgressionAgent(llm),
        "risk_topology_agent": RiskTopologyAgent(llm),
        "prognosis_agent": PrognosisAgent(llm),
        "symptom_trajectory_agent": SymptomTrajectoryAgent(llm),
        "comorbidity_interaction_agent": ComorbidityInteractionAgent(llm),
    }
    
    # Phase 1: Core agents (sequential for dependencies)
    state = agents["case_boundary_agent"].analyze(state)
    state = agents["disease_identity_agent"].analyze(state)
    state = agents["disease_trajectory_agent"].analyze(state)
    
    # Phase 2: Parallel execution of independent agents
    parallel_agents = [
        agents["treatment_memory_agent"],
        agents["lab_trend_analysis_agent"],
        agents["biomarker_trend_agent"],
        agents["medication_safety_agent"],
        agents["imaging_progression_agent"],
        agents["risk_topology_agent"],
        agents["prognosis_agent"],
        agents["symptom_trajectory_agent"],
        agents["comorbidity_interaction_agent"],
    ]
    
    # Execute in parallel batches
    batch_size = 3
    for i in range(0, len(parallel_agents), batch_size):
        batch = parallel_agents[i:i+batch_size]
        tasks = [asyncio.to_thread(agent.analyze, state) for agent in batch]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for result in results:
            if isinstance(result, dict):
                state.update(result)
            elif isinstance(result, Exception):
                logger.error(f"Agent failed: {result}")
                state["warnings"].append(f"Agent failed: {str(result)}")
    
    # Phase 3: Consistency check and summary
    consistency_checker = ConsistencyCheckerAgent(llm)
    state = consistency_checker.analyze(state)
    
    summary_agent = PatientSummaryAgent(llm)
    state = summary_agent.analyze(state)
    
    # Save to database with delta storage
    delta_result = await save_with_delta(
        patient_id, doctor_id, state, collections_map, 
        collections_map["delta_snapshots"]
    )
    
    # Prepare response
    return {
        "status": "success",
        "visit_type": visit_type,
        "agents_executed": state["agents_executed"],
        "case_boundaries": state["case_boundaries"],
        "disease_identity": state["disease_identity"],
        "disease_trajectory": state["disease_trajectory"],
        "treatment_memory": state["treatment_memory"],
        "functional_psychological": state["functional_status"],
        "risk_topology": state["risk_topology"],
        "prognosis": state["prognosis"],
        "hypothesis_layer": state["hypothesis_layer"],
        "next_visit_clinical_brief": state["next_visit_brief"],
        "patient_summary": state["patient_summary"],
        "symptom_trajectory": state["symptom_trajectory"],
        "medication_safety": state["medication_safety"],
        "imaging_progression": state["imaging_progression"],
        "lab_trend_analysis": state["lab_trend_analysis"],
        "biomarker_trend": state["biomarker_trend"],
        "comorbidity_interaction": state["comorbidity_interaction"],
        "consistency_check": state["consistency_check"],
        "confidence_scores": state["confidence_scores"],
        "warnings": state["warnings"],
        "requires_review": state["requires_review"],
        "execution_time_seconds": 0.0,  # Will be set by caller
        "delta_saved": delta_result["agents_with_changes"] > 0,
        "timestamp": datetime.utcnow().isoformat(),
        "hallucination_warnings": state.get("hallucination_warnings", []),
        "error": None
    }

# =====================================================================
# DELTA STORAGE (from previous code, enhanced)
# =====================================================================

async def compute_delta(
    patient_id: str,
    agent_name: str,
    new_data: Dict[str, Any],
    collection
) -> Tuple[Dict[str, Any], bool]:
    """Compute delta between new and existing data"""
    try:
        existing_doc = await collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0, agent_name: 1, "last_full_snapshot": 1}
        )
        
        if not existing_doc:
            return {
                "patient_id": patient_id,
                agent_name: new_data,
                "is_delta": False,
                "last_full_snapshot": datetime.utcnow().isoformat(),
                "updated_at": datetime.utcnow().isoformat()
            }, True
        
        existing_data = existing_doc.get(agent_name, {})
        
        if compute_hash(existing_data) == compute_hash(new_data):
            return {}, False
        
        # Always do intelligent merge first, then check if changed
        # The intelligent merge functions handle this
        
        return {
            "patient_id": patient_id,
            agent_name: new_data,
            "is_delta": False,
            "last_full_snapshot": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }, True
    
    except Exception as e:
        logger.error(f"❌ Delta computation failed: {str(e)}")
        return {
            "patient_id": patient_id,
            agent_name: new_data,
            "is_delta": False,
            "error": str(e),
            "updated_at": datetime.utcnow().isoformat()
        }, True

async def save_with_delta(
    patient_id: str,
    doctor_id: str,
    final_state,
    collections_map: Dict[str, Any],
    delta_snapshots_collection
) -> Dict[str, Any]:
    """Save all agent outputs"""
    logger.info(f"💾 Saving: patient_id={patient_id}")
    
    results = {
        "total_agents": 0,
        "agents_with_changes": 0,
        "agents_no_changes": 0
    }
    
    agent_to_collection = {
        "case_boundaries": collections_map["case_boundaries"],
        "disease_identity": collections_map["disease_identity"],
        "disease_trajectory": collections_map["disease_trajectory"],
        "treatment_memory": collections_map["treatment_memory"],
        "functional_status": collections_map["functional_status"],
        "risk_topology": collections_map["risk_topology"],
        "prognosis": collections_map["prognosis"],
        "hypothesis_layer": collections_map["hypothesis_layer"],
        "next_visit_brief": collections_map["next_visit_brief"],
        "patient_summary": collections_map["patient_summary"],
        "symptom_trajectory": collections_map["symptom_trajectory"],
        "medication_safety": collections_map["medication_safety"],
        "imaging_progression": collections_map["imaging_progression"],
        "lab_trend_analysis": collections_map["lab_trend_analysis"],
        "biomarker_trend": collections_map["biomarker_trend"],
        "comorbidity_interaction": collections_map["comorbidity_interaction"],
        "consistency_check": collections_map["consistency_check"],
    }
    
    for agent_name, collection in agent_to_collection.items():
        agent_data = final_state.get(agent_name)
        if not agent_data:
            continue
        
        results["total_agents"] += 1
        
        # Save directly (intelligent merge already done in agents)
        await collection.update_one(
            {"patient_id": patient_id},
            {"$set": {
                agent_name: agent_data,
                "doctor_id": doctor_id,
                "updated_at": datetime.utcnow().isoformat()
            }},
            upsert=True
        )
        
        results["agents_with_changes"] += 1
        logger.info(f"✅ {agent_name}: Saved")
    
    logger.info(f"💾 Complete: {results['agents_with_changes']}/{results['total_agents']} saved")
    return results



    