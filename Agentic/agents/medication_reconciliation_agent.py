"""
Medication Reconciliation Agent
Comprehensive medication safety analysis with interaction checking
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
    from Agentic.core.context_builder import build_medication_reconciliation_context
except ImportError:
    from core.context_builder import build_medication_reconciliation_context


class MedicationReconciliationAgent:
    """
    Performs comprehensive medication safety assessment
    
    Key features:
    - Complete medication list reconciliation
    - Drug-drug interaction checking
    - Allergy cross-reactivity analysis
    - Medication-induced symptoms identification
    - Transition of care planning
    """
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
    
    async def analyze(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Perform medication reconciliation"""
        
        logger.info("💊 Medication Reconciliation Agent: Starting analysis")
        
        try:
            # Build optimized context
            context = build_medication_reconciliation_context(state)
            logger.info(f"medication context:{context}")
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
            state["medication_reconciliation"] = result
            state["confidence_scores"]["medication"] = result.get("confidence_score", 0.0)
            
            # Add warnings
            self._add_warnings(state, result)
            
            logger.info("✅ Medication Reconciliation Agent: Analysis complete")
            return state
            
        except Exception as e:
            logger.error(f"❌ Medication Reconciliation Agent failed: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            state["error"] = f"Medication reconciliation failed: {str(e)}"
            return state
    
    def _get_system_message(self) -> str:
        """System message defining agent role"""
        return """You are a clinical pharmacist specializing in medication safety and polypharmacy management.

Your expertise:
- Medication reconciliation across care transitions
- Drug-drug interaction analysis
- Adverse drug reaction identification
- Deprescribing inappropriate medications
- Renal/hepatic dosing
- Drug allergy and cross-reactivity

Your mission: Prevent medication-related harm. Be thorough and conservative with safety."""
    
    def _build_prompt(self, context: str, consultation: str) -> str:
        """Build the main prompt"""
        
        return f"""
{context}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CURRENT CONSULTATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{consultation}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR TASK: COMPREHENSIVE MEDICATION SAFETY ASSESSMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Perform a complete medication safety review:

**STEP 1: MEDICATION RECONCILIATION**
Create accurate, complete medication list from all sources:
- Current medications (active prescriptions)
- Recently discontinued medications
- Over-the-counter medications
- Supplements and herbal products
- PRN medications
- Reconcile discrepancies between sources

**STEP 2: DRUG-DRUG INTERACTION ANALYSIS**
Identify ALL interactions:
- Major interactions (significant risk of adverse outcome)
- Moderate interactions (may require monitoring or dose adjustment)
- Minor interactions (usually clinically insignificant)
- Pharmacokinetic interactions (absorption, metabolism, excretion)
- Pharmacodynamic interactions (additive or antagonistic effects)

**STEP 3: DRUG-SYMPTOM CORRELATION**
Critical: Could any current medications be CAUSING the patient's symptoms?
- Review patient's presenting complaints
- Check if any medications have adverse effects matching these symptoms
- Consider timing: When was medication started vs when symptoms began?
- This is a KEY step - medication side effects often mimic diseases!

**STEP 4: ALLERGY ASSESSMENT**
- Verify documented allergies
- Assess cross-reactivity risks
- Identify any medications that should be avoided

**STEP 5: APPROPRIATENESS REVIEW**
- Beers Criteria for elderly patients
- Duplicate therapy
- Medications without indication
- Subtherapeutic or supratherapeutic dosing
- Renal/hepatic dosing appropriateness

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{{
  "reconciled_medication_list": [
    {{
      "medication_name": "Generic name (Brand name)",
      "dose": "Amount",
      "route": "PO|IV|SC|etc",
      "frequency": "BID|TID|QD|etc",
      "indication": "Why patient is taking this",
      "start_date": "When started if known",
      "prescriber": "If known",
      "adherence": "good|partial|poor|unknown",
      "source": "Where this information came from"
    }}
  ],
  
  "medication_discrepancies": [
    {{
      "issue": "Description of discrepancy",
      "severity": "critical|moderate|minor",
      "medications_involved": ["List"],
      "recommendation": "How to resolve",
      "requires_clarification": true|false
    }}
  ],
  
  "drug_drug_interactions": [
    {{
      "interacting_medications": ["Drug A", "Drug B"],
      "interaction_type": "Pharmacokinetic|Pharmacodynamic",
      "mechanism": "Detailed explanation of how drugs interact",
      "severity": "Major|Moderate|Minor",
      "clinical_consequence": "What could happen to the patient",
      "evidence_level": "Strong|Moderate|Weak",
      "management_strategy": "Specific actions to take (dose adjustment, monitoring, alternative drug, or acceptable with monitoring)",
      "monitoring_required": "What to monitor if continuing both drugs",
      "alternative_if_stopping_one": "Alternative medication options"
    }}
  ],
  
  "medication_induced_symptoms": [
    {{
      "symptom": "Patient's symptom that may be drug-induced",
      "potentially_causative_medication": "Medication name",
      "likelihood": "Definite|Probable|Possible|Unlikely",
      "timing_correlation": "Temporal relationship between drug and symptom",
      "supporting_evidence": "Why this medication is suspected",
      "naranjo_score": "If calculated (scale 0-13)",
      "recommendation": "Continue|Reduce dose|Switch to alternative|Discontinue",
      "alternative_if_stopping": "Alternative medication if this is the cause"
    }}
  ],
  
  "allergy_assessment": {{
    "documented_allergies": [
      {{
        "allergen": "Medication or substance",
        "reaction": "Type of reaction experienced",
        "severity": "Mild|Moderate|Severe|Anaphylaxis",
        "certainty": "Confirmed|Probable|Possible|Unknown",
        "cross_reactive_medications": ["List of medications to avoid"],
        "safe_alternatives": ["List of safe alternatives"]
      }}
    ],
    "medications_to_avoid": [
      {{
        "medication": "Name",
        "reason": "Why it should be avoided based on allergy",
        "alternative": "Safe alternative"
      }}
    ]
  }},
  
  "appropriateness_review": {{
    "inappropriate_medications": [
      {{
        "medication": "Name",
        "issue": "Why inappropriate (Beers Criteria, no indication, duplicate therapy, etc.)",
        "risk": "Specific risk to this patient",
        "recommendation": "Discontinue|Reduce|Switch to alternative",
        "alternative": "If applicable"
      }}
    ],
    
    "dosing_issues": [
      {{
        "medication": "Name",
        "current_dose": "What patient is taking",
        "issue": "Supratherapeutic|Subtherapeutic|Inappropriate for renal function|Inappropriate for hepatic function",
        "recommended_dose": "Correct dose for this patient",
        "rationale": "Why adjustment needed with specific calculations"
      }}
    ],
    
    "missing_indicated_medications": [
      {{
        "indication": "Condition that should be treated",
        "recommended_medication_class": "Drug class needed",
        "specific_recommendations": ["Specific drug options"],
        "rationale": "Why this medication is indicated"
      }}
    ]
  }},
  
  "polypharmacy_assessment": {{
    "total_medication_count": "Number",
    "polypharmacy_level": "None|Mild (5-9)|Moderate (10-14)|Severe (15+)",
    "deprescribing_opportunities": [
      {{
        "medication": "Name",
        "reason_for_deprescribing": "No clear indication|Ineffective|Risk exceeds benefit|Duplicate therapy",
        "deprescribing_strategy": "Abrupt discontinuation|Gradual taper",
        "monitoring_during_deprescribing": "What to watch for"
      }}
    ]
  }},
  
  "high_risk_medications_alert": [
    {{
      "medication": "Name",
      "risk_category": "High-risk drug class (anticoagulant, opioid, insulin, etc.)",
      "specific_risk": "What makes this high risk for this patient",
      "required_monitoring": "Mandatory monitoring for safety",
      "patient_education_priority": "Critical points patient must understand"
    }}
  ],
  
  "transition_of_care_plan": {{
    "medications_to_continue": [
      {{
        "medication": "Name with dose and frequency",
        "duration": "How long to continue",
        "follow_up_needed": "When to reassess"
      }}
    ],
    
    "medications_to_start": [
      {{
        "medication": "Name with initial dose",
        "indication": "Why starting",
        "titration_plan": "If applicable",
        "monitoring_plan": "What to monitor"
      }}
    ],
    
    "medications_to_stop": [
      {{
        "medication": "Name",
        "reason_for_stopping": "Why discontinuing",
        "when_to_stop": "Timing",
        "taper_needed": true|false,
        "taper_schedule": "If applicable"
      }}
    ],
    
    "pending_clarifications": [
      {{
        "issue": "What needs clarification",
        "who_to_contact": "Prescriber, patient, pharmacy, etc.",
        "urgency": "Routine|Urgent|Emergent"
      }}
    ]
  }},
  
  "safety_alerts": [
    {{
      "alert_type": "Drug interaction|Allergy concern|Dosing error|Other",
      "severity": "Critical|High|Moderate",
      "description": "Detailed description of safety concern",
      "immediate_action_required": "What to do right now",
      "timeframe": "How quickly this must be addressed"
    }}
  ],
  
  "recommendations_summary": [
    "Priority recommendation 1 with rationale",
    "Priority recommendation 2 with rationale",
    "Priority recommendation 3 with rationale"
  ],
  
  "confidence_score": 0.0-1.0,
  "confidence_rationale": "Why this confidence level - data completeness, complexity of regimen",
  
  "requires_pharmacist_review": true|false,
  "requires_prescriber_contact": true|false
}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL SAFETY REMINDERS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. **Always consider medication as cause of symptoms** - Drug side effects mimic diseases!
2. **Check renal/hepatic function** - Most medication errors involve dosing
3. **Don't miss high-risk drug interactions** - These can be life-threatening
4. **Verify allergies** - Document reaction type, not just "allergy"
5. **Consider age** - Beers Criteria for elderly, contraindications in young
6. **Look for drug-induced problems** - Falls, confusion, GI bleeding often medication-related

EXAMPLE: If patient has fever and is on beta-blockers → beta-blocker can mask tachycardia, making fever assessment harder
EXAMPLE: If patient has bradycardia and takes multiple medications → check for beta-blockers, CCBs, digoxin, amiodarone
EXAMPLE: Elderly patient with confusion → check anticholinergic burden

Be thorough. Be conservative. Prevent harm.

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
            logger.warning(f"⚠️ Medication Reconciliation JSON parse failed: {e}")
            return {
                "raw_content": content[:1000],
                "confidence_score": 0.5,
                "reconciled_medication_list": []
            }
    
    def _add_warnings(self, state: Dict[str, Any], result: Dict[str, Any]):
        """Add warnings to state based on medication analysis"""
        
        # Check for safety alerts
        safety_alerts = result.get("safety_alerts", [])
        for alert in safety_alerts:
            if alert.get("severity") in ["Critical", "High"]:
                state["warnings"].append(
                    f"🚨 MEDICATION SAFETY ALERT: {alert.get('description', '')[:100]}"
                )
                state["requires_review"] = True
        
        # Check for major drug interactions
        interactions = result.get("drug_drug_interactions", [])
        major_interactions = [i for i in interactions if i.get("severity") == "Major"]
        if major_interactions:
            state["warnings"].append(
                f"⚠️ {len(major_interactions)} MAJOR DRUG INTERACTION(S) IDENTIFIED"
            )
            state["requires_review"] = True
        
        # Check for medication-induced symptoms
        med_symptoms = result.get("medication_induced_symptoms", [])
        probable_causes = [m for m in med_symptoms if m.get("likelihood") in ["Definite", "Probable"]]
        if probable_causes:
            for symptom in probable_causes[:3]:  # Top 3
                state["warnings"].append(
                    f"💊 DRUG-INDUCED SYMPTOM: {symptom.get('symptom')} likely caused by {symptom.get('potentially_causative_medication')}"
                )
            state["requires_review"] = True
        
        # Check for allergy concerns
        allergy_issues = result.get("allergy_assessment", {}).get("medications_to_avoid", [])
        if allergy_issues:
            state["warnings"].append(
                f"⚠️ ALLERGY ALERT: {len(allergy_issues)} medication(s) should be avoided due to allergies"
            )
            state["requires_review"] = True
        
        # Check for high-risk medications
        high_risk = result.get("high_risk_medications_alert", [])
        if high_risk:
            state["warnings"].append(
                f"⚠️ {len(high_risk)} HIGH-RISK MEDICATION(S) requiring enhanced monitoring"
            )
        
        # Check if pharmacist review needed
        if result.get("requires_pharmacist_review"):
            state["warnings"].append("🔔 Clinical pharmacist review recommended")
            state["requires_review"] = True
        
        # Check if prescriber contact needed
        if result.get("requires_prescriber_contact"):
            state["warnings"].append("📞 Prescriber contact required for medication clarification")