"""
Discharge Readiness Agent
Assesses patient readiness for safe discharge with comprehensive transition planning
"""

from typing import Dict, Any
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage
from loguru import logger
import json
import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

try:
    from Agentic.core.context_builder import build_discharge_readiness_context
except ImportError:
    from core.context_builder import build_discharge_readiness_context


class DischargeReadinessAgent:
    """
    Evaluates patient readiness for discharge and creates transition plan
    
    Assesses:
    - Clinical stability
    - Treatment plan completion
    - Follow-up arrangements
    - Patient/caregiver education
    - Social determinants of health
    - Readmission risk
    """
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
    
    async def analyze(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Assess discharge readiness"""
        
        logger.info("🏥 Discharge Readiness Agent: Starting analysis")
        
        try:
            # Build optimized context
            context = build_discharge_readiness_context(state)
            consultation = state.get("consultation_text", "")
            
            # Construct prompt
            prompt = self._build_prompt(context, consultation)
            
            # Call LLM
            response = self.llm.invoke([
                SystemMessage(content=self._get_system_message()),
                HumanMessage(content=prompt)
            ])
            
            # Parse response
            result = self._parse_response(response.content)
            
            # Store in state
            state["discharge_readiness"] = result
            state["confidence_scores"]["discharge"] = result.get("confidence_score", 0.0)
            
            # Add warnings
            self._add_warnings(state, result)
            
            logger.info("✅ Discharge Readiness Agent: Analysis complete")
            return state
            
        except Exception as e:
            logger.error(f"❌ Discharge Readiness Agent failed: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            state["error"] = f"Discharge readiness assessment failed: {str(e)}"
            return state
    
    def _get_system_message(self) -> str:
        """System message defining agent role"""
        return """You are a discharge planning specialist and care coordinator.

Your expertise:
- Safe discharge criteria assessment
- Transition of care planning
- Readmission risk prediction (LACE Index, HOSPITAL Score)
- Social determinants of health evaluation
- Care coordination across settings
- Patient education and health literacy

Your goal: Ensure safe transitions and prevent avoidable readmissions."""
    
    def _build_prompt(self, context: str, consultation: str) -> str:
        """Build the main prompt"""
        
        return f"""
{context}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CURRENT CONSULTATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{consultation}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR TASK: COMPREHENSIVE DISCHARGE READINESS ASSESSMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Evaluate patient readiness for safe discharge using structured framework:

**FRAMEWORK: 5 DOMAINS OF DISCHARGE READINESS**

1. **CLINICAL STABILITY**
   - Vital signs stable and within acceptable limits
   - Acute illness treated/resolved
   - Pain controlled
   - Able to maintain oxygenation without excessive support
   - No pending critical test results
   - Trajectory: improving not declining

2. **FUNCTIONAL STATUS**
   - Ambulation: Can patient move safely?
   - ADLs: Eating, toileting, hygiene
   - Mental status: Alert and oriented, able to follow instructions
   - Fall risk assessment
   - Need for DME (durable medical equipment)

3. **TREATMENT PLAN**
   - Medications reconciled and prescribed
   - Patient/caregiver understands medication regimen
   - Follow-up appointments scheduled
   - Pending tests arranged
   - Home health/services arranged if needed

4. **SOCIAL DETERMINANTS & SUPPORT**
   - Safe discharge destination
   - Caregiver availability if needed
   - Transportation for follow-up
   - Medication access (insurance, pharmacy, cost)
   - Food security
   - Housing stability

5. **EDUCATION & HEALTH LITERACY**
   - Understanding of diagnosis
   - Red flags that require return to hospital
   - Medication education completed
   - Disease-specific education (CHF, COPD, diabetes, etc.)
   - Written discharge instructions provided

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
READMISSION RISK SCORES TO CALCULATE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**LACE Index** (predicts 30-day readmission):
- Length of stay: 1-6 days = 1-3 points, 7-13 days = 4-5 points, 14+ = 7 points
- Acuity of admission: Emergency = 3 points
- Comorbidity: Charlson index
- ED visits: 0-1 visits in past 6 months = 0-1 points, 2-3 = 2 points, 4+ = 4 points
Score ≥10 = high readmission risk

**HOSPITAL Score** (alternative):
- Hemoglobin <12 g/dL = 1 point
- Oncology service discharge = 2 points
- Sodium <135 mEq/L = 1 point
- Procedure during hospitalization = 1 point
- Index admission type (urgent/emergent) = 1 point
- Previous admissions in last year: 0-1 = 0 points, 2-5 = 2 points, >5 = 5 points
- Length of stay ≥5 days = 2 points
Score ≥5 = high readmission risk

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{{
  "overall_discharge_readiness": "ready|ready_with_conditions|not_ready",
  
  "readiness_assessment": {{
    "clinical_stability": {{
      "status": "stable|improving|concerning|unstable",
      "vital_signs_acceptable": true|false,
      "acute_process_resolved": true|false,
      "pain_controlled": true|false,
      "oxygen_requirements_met": true|false,
      "pending_critical_results": [],
      "trajectory": "improving|stable|declining",
      "concerns": ["Any clinical concerns preventing discharge"],
      "ready_for_discharge": true|false
    }},
    
    "functional_status": {{
      "mobility": "Independent|Assistance needed|Bedbound",
      "adl_status": "Independent|Partial assistance|Total assistance",
      "fall_risk": "Low|Moderate|High",
      "cognitive_status": "Alert and oriented|Mild impairment|Significant impairment",
      "dme_needs": ["Walker", "Wheelchair", "Hospital bed", "etc"],
      "home_safety_concerns": ["List any concerns"],
      "ready_for_discharge": true|false
    }},
    
    "treatment_plan_completion": {{
      "medications_reconciled": true|false,
      "prescriptions_written": true|false,
      "patient_understands_medications": true|false,
      "follow_up_scheduled": {{
        "primary_care": {{"scheduled": true|false, "timeframe": "days"}},
        "specialists": [{{"specialty": "name", "scheduled": true|false, "timeframe": "days"}}]
      }},
      "pending_tests_arranged": true|false,
      "home_services_arranged": {{"needed": true|false, "arranged": true|false, "type": "VNA, PT, OT"}},
      "ready_for_discharge": true|false
    }},
    
    "social_determinants": {{
      "discharge_destination": "Home|SNF|Rehab|Other",
      "caregiver_available": true|false,
      "caregiver_capable": true|false,
      "transportation_arranged": true|false,
      "medication_access": {{"has_insurance": true|false, "pharmacy_identified": true|false, "cost_concerns": true|false}},
      "food_security": "Adequate|Concerning|Unknown",
      "housing_stability": "Stable|Unstable|Homeless",
      "barriers_identified": ["List barriers"],
      "ready_for_discharge": true|false
    }},
    
    "education_and_literacy": {{
      "diagnosis_understanding": "Good|Partial|Poor",
      "red_flags_reviewed": true|false,
      "medication_education_complete": true|false,
      "disease_specific_education": true|false,
      "written_instructions_provided": true|false,
      "teach_back_performed": true|false,
      "health_literacy_concerns": true|false,
      "interpreter_needed": true|false,
      "ready_for_discharge": true|false
    }}
  }},
  
  "readmission_risk_assessment": {{
    "lace_index": {{
      "length_of_stay_points": 0-7,
      "acuity_points": 0-3,
      "comorbidity_points": 0-7,
      "ed_visits_points": 0-4,
      "total_score": 0-19,
      "risk_level": "Low (<5)|Moderate (5-9)|High (≥10)",
      "interpretation": "Detailed interpretation with estimated readmission risk percentage"
    }},
    
    "hospital_score": {{
      "hemoglobin_points": 0-1,
      "oncology_points": 0-2,
      "sodium_points": 0-1,
      "procedure_points": 0-1,
      "admission_type_points": 0-1,
      "admissions_points": 0-5,
      "los_points": 0-2,
      "total_score": 0-13,
      "risk_level": "Low (0-4)|Moderate (5-6)|High (7-9)|Very High (≥10)",
      "interpretation": "Interpretation with readmission risk"
    }},
    
    "clinical_risk_factors": [
      {{
        "factor": "Specific risk factor",
        "impact": "How this increases readmission risk",
        "mitigation": "How to address this"
      }}
    ]
  }},
  
  "barriers_to_discharge": [
    {{
      "barrier": "Specific barrier",
      "category": "Clinical|Functional|Social|Educational|Administrative",
      "severity": "Critical blocker|Major concern|Minor issue",
      "resolution_strategy": "How to overcome this barrier",
      "estimated_time_to_resolve": "hours|days|weeks",
      "responsible_party": "Who needs to address this"
    }}
  ],
  
  "discharge_plan": {{
    "recommended_discharge_date": "Earliest safe discharge date",
    "discharge_destination": "Home|Home with services|SNF|LTAC|Rehab",
    
    "medication_plan": {{
      "discharge_medications": [
        {{
          "medication": "Name with dose and frequency",
          "new_or_continued": "New|Continued|Modified",
          "indication": "Why taking",
          "duration": "How long",
          "special_instructions": "Any special instructions"
        }}
      ],
      "medications_stopped": [
        {{
          "medication": "Name",
          "reason": "Why stopped"
        }}
      ],
      "medication_education_completed": true|false
    }},
    
    "follow_up_plan": {{
      "appointments": [
        {{
          "provider": "Who to see",
          "timeframe": "When (specific date or 'within X days')",
          "reason": "Why this follow-up",
          "scheduled": true|false,
          "patient_has_appointment_card": true|false
        }}
      ],
      "pending_results_to_follow": [
        {{
          "test": "What test",
          "when_available": "When results expected",
          "who_will_follow_up": "Which provider will review",
          "patient_notified": true|false
        }}
      ]
    }},
    
    "home_services": {{
      "vna_ordered": true|false,
      "vna_services": ["Wound care", "IV antibiotics", "etc"],
      "physical_therapy": true|false,
      "occupational_therapy": true|false,
      "home_health_aide": true|false,
      "meal_delivery": true|false,
      "other_services": []
    }},
    
    "dme_arranged": [
      {{
        "equipment": "Name of equipment",
        "ordered": true|false,
        "vendor": "Company name",
        "delivery_arranged": true|false
      }}
    ],
    
    "patient_education_completed": {{
      "diagnosis_education": true|false,
      "medication_education": true|false,
      "red_flags_warning_signs": [
        "Specific symptom that should prompt return to ED or call doctor"
      ],
      "self_care_instructions": [
        "Specific instruction for patient"
      ],
      "activity_restrictions": [
        "Any restrictions on activity"
      ],
      "diet_instructions": "Any dietary modifications",
      "wound_care_instructions": "If applicable",
      "disease_specific_education": [
        "Heart failure daily weights and symptom monitoring",
        "COPD inhaler technique",
        "Diabetes glucose monitoring",
        "etc"
      ]
    }},
    
    "discharge_instructions_written": true|false,
    "patient_copy_provided": true|false
  }},
  
  "discharge_recommendations": [
    {{
      "recommendation": "Specific recommendation",
      "priority": "High|Medium|Low",
      "rationale": "Why this is recommended",
      "responsible_party": "Who should do this"
    }}
  ],
  
  "red_flags_for_readmission": [
    {{
      "warning_sign": "Specific symptom or finding",
      "significance": "Why this is concerning",
      "action": "What patient should do if this occurs"
    }}
  ],
  
  "transition_of_care_summary": {{
    "primary_diagnosis": "Main diagnosis for this hospitalization",
    "secondary_diagnoses": ["Other active problems"],
    "procedures_performed": ["Any procedures during stay"],
    "hospital_course_summary": "Brief narrative summary for receiving provider (2-3 sentences)",
    "key_tests_and_findings": [
      "Important test results and their significance"
    ],
    "pending_issues": [
      "What still needs to be addressed in outpatient setting"
    ],
    "follow_up_priorities": [
      "What receiving provider should focus on first"
    ]
  }},
  
  "safe_to_discharge": true|false,
  "if_not_safe_what_needs_to_happen": ["List requirements before discharge if not safe"],
  
  "estimated_readmission_risk": "Low|Moderate|High|Very High",
  "strategies_to_reduce_readmission": [
    "Specific strategy with expected impact"
  ],
  
  "confidence_score": 0.0-1.0,
  "confidence_rationale": "Why this confidence level"
}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL REQUIREMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ Be comprehensive - missed discharge planning leads to readmissions
✓ Calculate actual LACE or HOSPITAL score with component breakdown
✓ Identify ALL barriers to safe discharge
✓ Consider social determinants - clinical stability isn't enough
✓ Ensure medication access - prescriptions don't help if patient can't afford them
✓ Verify understanding - not just that education was "done" but that patient understands
✓ Think about what happens at 2 AM at home - will patient be safe?
✓ Red flags MUST be specific and actionable

NEVER discharge a patient:
- With unstable vital signs
- Without clear follow-up plan
- Without medication reconciliation
- To unsafe environment
- Without addressing barriers to care
- Without adequate caregiver support if needed

OUTPUT: Return ONLY valid JSON matching the structure above. No markdown, no explanations outside JSON.
"""
    
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
                "raw_content": content[:1000],
                "confidence_score": 0.5,
                "overall_discharge_readiness": "unknown",
                "safe_to_discharge": False
            }
    
    def _add_warnings(self, state: Dict[str, Any], result: Dict[str, Any]):
        """Add warnings to state based on discharge assessment"""
        
        # Check if not safe to discharge
        if not result.get("safe_to_discharge"):
            state["warnings"].append("🚫 PATIENT NOT READY FOR DISCHARGE")
            state["requires_review"] = True
            
            # Add specific requirements
            requirements = result.get("if_not_safe_what_needs_to_happen", [])
            for req in requirements[:5]:  # Top 5
                state["warnings"].append(f"  → Required: {req}")
        
        # Check overall readiness
        readiness = result.get("overall_discharge_readiness", "").lower()
        if readiness == "not_ready":
            state["warnings"].append("⚠️ Discharge readiness: NOT READY")
            state["requires_review"] = True
        elif readiness == "ready_with_conditions":
            state["warnings"].append("⚠️ Discharge readiness: CONDITIONAL - Barriers must be addressed")
        
        # Check for critical barriers
        barriers = result.get("barriers_to_discharge", [])
        critical_barriers = [b for b in barriers if b.get("severity") == "Critical blocker"]
        if critical_barriers:
            state["warnings"].append(
                f"🚫 {len(critical_barriers)} CRITICAL BARRIER(S) to discharge"
            )
            state["requires_review"] = True
        
        # Check readmission risk
        risk_assessment = result.get("readmission_risk_assessment", {})
        lace = risk_assessment.get("lace_index", {})
        if lace.get("risk_level", "").startswith("High"):
            state["warnings"].append(
                f"⚠️ HIGH READMISSION RISK (LACE {lace.get('total_score')})"
            )
        
        hospital_score = risk_assessment.get("hospital_score", {})
        if hospital_score.get("risk_level") in ["High", "Very High"]:
            state["warnings"].append(
                f"⚠️ HIGH READMISSION RISK (HOSPITAL Score {hospital_score.get('total_score')})"
            )
        
        # Check for incomplete discharge planning
        discharge_plan = result.get("discharge_plan", {})
        if not discharge_plan.get("discharge_instructions_written"):
            state["warnings"].append("⚠️ Discharge instructions not yet written")
            state["requires_review"] = True
        
        follow_up = discharge_plan.get("follow_up_plan", {})
        appointments = follow_up.get("appointments", [])
        unscheduled = [apt for apt in appointments if not apt.get("scheduled")]
        if unscheduled:
            state["warnings"].append(
                f"⚠️ {len(unscheduled)} follow-up appointment(s) not yet scheduled"
            )