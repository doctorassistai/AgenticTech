"""
Treatment Validation Agent
Validates treatment plans against guidelines, contraindications, and patient-specific factors
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
    from Agentic.core.context_builder import build_treatment_validation_context
except ImportError:
    from core.context_builder import build_treatment_validation_context


class TreatmentValidationAgent:
    """
    Validates treatment recommendations against:
    - Evidence-based guidelines
    - Drug interactions
    - Contraindications
    - Patient-specific factors
    """
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
    
    async def analyze(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Validate treatment plan"""
        
        logger.info("💊 Treatment Validation Agent: Starting analysis")
        
        try:
            # Build optimized context
            context = build_treatment_validation_context(state)
            logger.info(f"treat context:{context}")
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
            state["treatment_validation"] = result
            state["confidence_scores"]["treatment"] = result.get("confidence_score", 0.0)
            
            # Add warnings
            self._add_warnings(state, result)
            
            logger.info("✅ Treatment Validation Agent: Analysis complete")
            return state
            
        except Exception as e:
            logger.error(f"❌ Treatment Validation Agent failed: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            state["error"] = f"Treatment validation failed: {str(e)}"
            return state
    
    def _get_system_message(self) -> str:
        """System message defining agent role"""
        return """You are a clinical pharmacologist and treatment expert specializing in evidence-based medicine.

Your expertise:
- Clinical practice guidelines (NICE, AHA, ACP, IDSA, etc.)
- Drug interactions and contraindications
- Renal/hepatic dosing adjustments
- Guideline-directed medical therapy
- Risk-benefit analysis
- Medication safety

Your output must show explicit reasoning for treatment recommendations with guideline citations."""
    
    def _build_prompt(self, context: str, consultation: str) -> str:
        """Build the main prompt"""
        
        return f"""
{context}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CURRENT CONSULTATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{consultation}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR TASK: EVIDENCE-BASED TREATMENT VALIDATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Develop and validate a comprehensive treatment plan based on:
1. Working diagnosis and disease severity
2. Current evidence-based guidelines
3. Patient-specific factors (renal/hepatic function, allergies, comorbidities)
4. Medication safety (interactions, contraindications)
5. Risk stratification and treatment urgency

TREATMENT PLANNING FRAMEWORK:

**STEP 1: GUIDELINE-DIRECTED THERAPY**
- Identify applicable clinical guidelines (cite specific guidelines)
- Determine disease stage/severity and corresponding treatment tier
- List recommended first-line, second-line, and alternative therapies

**STEP 2: PATIENT-SPECIFIC ADJUSTMENTS**
- Renal dosing: Calculate CrCl/eGFR and adjust medications accordingly
- Hepatic dosing: Assess liver function (Child-Pugh) and adjust if needed
- Drug allergies: Avoid allergens and cross-reactive medications
- Comorbidity interactions: Consider diabetes, CKD, heart failure, etc.

**STEP 3: MEDICATION SAFETY CHECK**
- Drug-drug interactions: Check current medications vs proposed additions
- Contraindications: Absolute and relative contraindications
- Adverse effect profile: What to monitor for
- QTc prolongation risk

**STEP 4: MONITORING PLAN**
- What parameters to monitor (labs, vitals, symptoms)
- Monitoring frequency
- Target goals and thresholds for adjustment
- When to escalate or de-escalate therapy

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{{
  "clinical_reasoning": {{
    "treatment_rationale": "Comprehensive explanation of treatment approach based on diagnosis, guidelines, and patient-specific factors",
    "guideline_basis": [
      {{
        "guideline": "Name of guideline (e.g., AHA/ACC Heart Failure Guideline 2022)",
        "recommendation": "Specific recommendation being followed",
        "strength_of_recommendation": "Class I/IIa/IIb/III and Level A/B/C",
        "applicability_to_patient": "Why this guideline applies to this specific patient"
      }}
    ],
    "key_decision_points": [
      "Major decision 1 with reasoning",
      "Major decision 2 with reasoning"
    ]
  }},
  
  "recommended_treatment_plan": {{
    "immediate_interventions": [
      {{
        "intervention": "Specific treatment (medication, procedure, etc.)",
        "rationale": "Why this intervention now",
        "dose_and_route": "Specific dosing instructions with route",
        "duration": "How long to continue",
        "expected_benefit": "What improvement to expect and timeline",
        "monitoring_required": "What to monitor while on this intervention"
      }}
    ],
    
    "ongoing_management": [
      {{
        "therapy": "Long-term therapy name",
        "indication": "Why patient needs this",
        "regimen": "Specific dosing with frequency",
        "patient_specific_adjustments": "Any adjustments made for this patient (renal, hepatic, etc.)",
        "titration_plan": "How to adjust dose over time if needed",
        "goal": "Target parameter or outcome"
      }}
    ],
    
    "medications_to_discontinue": [
      {{
        "medication": "Name of medication",
        "reason_for_discontinuation": "Why stopping",
        "tapering_required": true|false,
        "tapering_schedule": "If applicable"
      }}
    ],
    
    "lifestyle_modifications": [
      {{
        "modification": "Specific lifestyle change",
        "rationale": "Why important for this patient",
        "expected_impact": "Benefit if adhered to"
      }}
    ]
  }},
  
  "medication_safety_assessment": {{
    "drug_interactions": [
      {{
        "interacting_drugs": ["Drug A", "Drug B"],
        "interaction_type": "Pharmacokinetic|Pharmacodynamic",
        "severity": "Major|Moderate|Minor",
        "clinical_consequence": "What could happen",
        "management": "How to manage this interaction (dose adjustment, monitoring, alternative)"
      }}
    ],
    
    "contraindications": [
      {{
        "medication": "Name",
        "contraindication": "Absolute|Relative",
        "reason": "Why contraindicated",
        "alternative": "Alternative medication to consider"
      }}
    ],
    
    "renal_dosing_adjustments": {{
      "egfr_or_crcl": "Value in mL/min",
      "adjustments_required": [
        {{
          "medication": "Name",
          "standard_dose": "Normal dose",
          "adjusted_dose": "Dose for this renal function",
          "reasoning": "Why adjustment needed"
        }}
      ]
    }},
    
    "hepatic_dosing_adjustments": {{
      "liver_function_assessment": "Child-Pugh class or other assessment",
      "adjustments_required": [
        {{
          "medication": "Name",
          "standard_dose": "Normal dose",
          "adjusted_dose": "Dose for this hepatic function",
          "reasoning": "Why adjustment needed"
        }}
      ]
    }},
    
    "allergy_considerations": [
      {{
        "allergen": "Known allergy",
        "medications_to_avoid": ["List of medications"],
        "cross_reactivity_concerns": "Any cross-reactive drugs to avoid"
      }}
    ]
  }},
  
  "monitoring_plan": {{
    "laboratory_monitoring": [
      {{
        "parameter": "Lab test name",
        "baseline": "Get before starting therapy: yes|no",
        "frequency": "How often to check",
        "target_range": "Goal values",
        "action_thresholds": "When to adjust therapy or escalate"
      }}
    ],
    
    "clinical_monitoring": [
      {{
        "parameter": "Vital sign or symptom",
        "frequency": "How often to assess",
        "concerning_findings": "What findings require action",
        "action_plan": "What to do if concerning finding"
      }}
    ],
    
    "response_assessment": {{
      "timeframe": "When to assess if treatment working",
      "success_criteria": "What defines treatment success",
      "failure_criteria": "What defines treatment failure",
      "next_steps_if_successful": "Continue, adjust, or add",
      "next_steps_if_failing": "Alternative treatment plan"
    }}
  }},
  
  "alternative_treatment_options": [
    {{
      "alternative": "Second-line or alternative therapy",
      "when_to_use": "Situations where this would be preferred",
      "advantages": "Benefits compared to primary plan",
      "disadvantages": "Drawbacks compared to primary plan"
    }}
  ],
  
  "patient_education_priorities": [
    {{
      "topic": "What patient needs to know",
      "key_points": ["Point 1", "Point 2"],
      "importance": "Why this is critical"
    }}
  ],
  
  "safety_warnings": [
    {{
      "concern": "Specific safety issue",
      "likelihood": "Common|Uncommon|Rare",
      "severity_if_occurs": "Minor|Moderate|Severe",
      "prevention_strategy": "How to minimize risk",
      "monitoring_for_this": "What to watch for"
    }}
  ],
  
  "contraindications_or_concerns": [
    {{
      "issue": "Why this plan might not work or is risky",
      "severity": "Minor concern|Moderate concern|Major contraindication",
      "mitigation": "How to address this concern",
      "alternative_if_insurmountable": "What to do instead"
    }}
  ],
  
  "confidence_score": 0.0-1.0,
  "confidence_rationale": "Why this confidence level - what evidence is strong vs weak",
  
  "requires_specialist_input": true|false,
  "recommended_specialist": "If specialist needed, which specialty"
}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXAMPLE (Congestive Heart Failure)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Patient: 65yo M with newly diagnosed HFrEF (EF 30%), NYHA Class II symptoms

{{
  "clinical_reasoning": {{
    "treatment_rationale": "Patient has heart failure with reduced ejection fraction (HFrEF) and is symptomatic (NYHA II). Per 2022 AHA/ACC guidelines, foundational therapy includes four pillars: ACE-I/ARB/ARNI, beta-blocker, MRA, and SGLT2 inhibitor. These have been shown to reduce mortality and hospitalizations in multiple RCTs. Patient has CKD stage 3a (eGFR 52), requiring renal dosing adjustments.",
    
    "guideline_basis": [
      {{
        "guideline": "2022 AHA/ACC/HFSA Heart Failure Guideline",
        "recommendation": "Four-pillar GDMT for HFrEF: ARNI/ACE-I/ARB + beta-blocker + MRA + SGLT2i",
        "strength_of_recommendation": "Class I, Level A for each component",
        "applicability_to_patient": "Patient has HFrEF with EF 30% and symptomatic HF, making him perfect candidate for all four pillars"
      }}
    ]
  }},
  
  "recommended_treatment_plan": {{
    "immediate_interventions": [
      {{
        "intervention": "Start Sacubitril/Valsartan (ARNI)",
        "rationale": "Superior to ACE-I in reducing CV death and HF hospitalization (PARADIGM-HF trial). Patient not on ACE-I currently so can start directly without washout.",
        "dose_and_route": "Start 24/26 mg PO BID (low dose given renal function)",
        "duration": "Indefinite - chronic therapy",
        "expected_benefit": "Reduce mortality by ~20%, reduce HF hospitalizations by ~21% over ACE-I",
        "monitoring_required": "BP, renal function, potassium (check in 1-2 weeks after starting)"
      }}
    ],
    
    "ongoing_management": [
      {{
        "therapy": "Carvedilol",
        "indication": "Beta-blocker proven to reduce mortality in HFrEF",
        "regimen": "Start 3.125 mg PO BID",
        "patient_specific_adjustments": "No adjustments needed for renal function. Starting at low dose given symptomatic HF.",
        "titration_plan": "Up-titrate every 2 weeks: 3.125 → 6.25 → 12.5 → 25 mg BID as tolerated (target dose 25mg BID for <85kg patient)",
        "goal": "Achieve target dose or maximum tolerated dose; target HR 60-70 bpm at rest"
      }},
      {{
        "therapy": "Spironolactone",
        "indication": "MRA reduces mortality in HFrEF (RALES trial)",
        "regimen": "25 mg PO daily",
        "patient_specific_adjustments": "Standard dose appropriate. Potassium is 4.2 (acceptable). eGFR 52 (acceptable - use if eGFR >30)",
        "titration_plan": "Can increase to 50 mg daily if K+ <5.0 and no side effects after 4-8 weeks",
        "goal": "Maximum tolerated dose up to 50mg daily while maintaining K+ <5.0"
      }}
    ]
  }},
  
  "medication_safety_assessment": {{
    "drug_interactions": [
      {{
        "interacting_drugs": ["Sacubitril/Valsartan", "Spironolactone"],
        "interaction_type": "Pharmacodynamic",
        "severity": "Moderate",
        "clinical_consequence": "Both increase potassium - risk of hyperkalemia, especially with reduced renal function",
        "management": "Monitor K+ closely (baseline, 1 week, 4 weeks, then Q3 months). Hold spironolactone if K+ >5.5. Patient education on avoiding high-K foods."
      }}
    ],
    
    "renal_dosing_adjustments": {{
      "egfr_or_crcl": "52 mL/min (CKD Stage 3a)",
      "adjustments_required": [
        {{
          "medication": "Sacubitril/Valsartan",
          "standard_dose": "Start 49/51 mg BID typically",
          "adjusted_dose": "Start 24/26 mg BID for eGFR 30-60",
          "reasoning": "Valsartan is renally cleared; reduce initial dose and titrate cautiously"
        }}
      ]
    }}
  }}
}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NOW ANALYZE THE ACTUAL PATIENT ABOVE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Use the same depth of reasoning and structure shown in the example.

CRITICAL REQUIREMENTS:
✓ Base recommendations on actual clinical guidelines (cite them)
✓ Show explicit reasoning for every medication choice
✓ Calculate renal/hepatic adjustments with actual numbers
✓ Identify and manage all drug interactions
✓ Provide specific monitoring plans with frequencies
✓ Consider patient-specific factors (age, comorbidities, allergies)
✓ Use complete clinical sentences - NO word limits
✓ Think about what could go wrong and how to prevent it

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
            logger.warning(f"⚠️ Treatment Validation JSON parse failed: {e}")
            return {
                "raw_content": content[:1000],
                "confidence_score": 0.5,
                "clinical_reasoning": {
                    "treatment_rationale": "Parse failed"
                }
            }
    
    def _add_warnings(self, state: Dict[str, Any], result: Dict[str, Any]):
        """Add warnings to state based on treatment validation"""
        
        # Check for major drug interactions
        interactions = result.get("medication_safety_assessment", {}).get("drug_interactions", [])
        for interaction in interactions:
            if interaction.get("severity") == "Major":
                state["warnings"].append(
                    f"⚠️ MAJOR DRUG INTERACTION: {interaction.get('interacting_drugs')} - {interaction.get('clinical_consequence', '')[:100]}"
                )
                state["requires_review"] = True
        
        # Check for absolute contraindications
        contraindications = result.get("medication_safety_assessment", {}).get("contraindications", [])
        for contra in contraindications:
            if contra.get("contraindication") == "Absolute":
                state["warnings"].append(
                    f"🚫 ABSOLUTE CONTRAINDICATION: {contra.get('medication')} - {contra.get('reason', '')}"
                )
                state["requires_review"] = True
        
        # Check for major safety concerns
        concerns = result.get("contraindications_or_concerns", [])
        for concern in concerns:
            if concern.get("severity") == "Major contraindication":
                state["warnings"].append(
                    f"⚠️ MAJOR CONCERN: {concern.get('issue', '')[:100]}"
                )
                state["requires_review"] = True
        
        # Check if specialist needed
        if result.get("requires_specialist_input"):
            specialist = result.get("recommended_specialist")
            if specialist:
                state["warnings"].append(f"🔔 Specialist consultation recommended: {specialist}")