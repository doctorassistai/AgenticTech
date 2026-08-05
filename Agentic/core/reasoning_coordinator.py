"""
Clinical Reasoning Coordinator
Meta-agent that reviews outputs, identifies contradictions, and manages iterations
"""

from typing import Dict, Any, List
from loguru import logger
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage
import json

from typing import Optional, Dict, Any, List

class ClinicalReasoningCoordinator:
    """
    Coordinates the clinical reasoning process
    - Identifies contradictions between agents
    - Determines if re-analysis is needed
    - Manages iteration flow
    """
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
    
    async def coordinate(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """
        Review all agent outputs and coordinate next steps
        """
        logger.info("🎯 Clinical Reasoning Coordinator: Reviewing agent outputs")
        
        try:
            # Check if we've exceeded max iterations
            if state.get("iteration_count", 0) >= state.get("max_iterations", 3):
                logger.info("Max iterations reached, proceeding to final assessment")
                return {
                    "requires_reanalysis": False,
                    "coordination_complete": True
                }
            
            # Gather all agent outputs
            diagnosis = state.get("differential_diagnosis")
            medications = state.get("medication_reconciliation")
            risk = state.get("risk_stratification")
            treatment = state.get("treatment_validation")
            deterioration = state.get("clinical_deterioration_warning")
            
            # Check if we have enough information to coordinate
            if not diagnosis or not medications:
                logger.info("Core agents not yet complete, skipping coordination")
                return {
                    "requires_reanalysis": False,
                    "coordination_complete": False
                }
            
            # Analyze for contradictions and inconsistencies
            coordination_result = await self._analyze_consistency(
                diagnosis, medications, risk, treatment, deterioration
            )
            
            # Store coordination results
            state["reasoning_coordination"] = coordination_result
            state["contradictions_identified"] = coordination_result.get("contradictions", [])
            state["resolution_notes"] = coordination_result.get("resolutions", [])
            
            # Determine if re-analysis is needed
            if coordination_result.get("requires_reanalysis"):
                state["requires_reanalysis"] = True
                state["reanalysis_reason"] = coordination_result.get("reanalysis_reason")
                state["iteration_count"] = state.get("iteration_count", 0) + 1
                logger.warning(f"🔄 Re-analysis triggered: {coordination_result.get('reanalysis_reason')}")
            else:
                state["requires_reanalysis"] = False
                logger.info("✅ Coordination complete, no re-analysis needed")
            
            return state
            
        except Exception as e:
            logger.error(f"❌ Coordination failed: {str(e)}")
            state["requires_reanalysis"] = False
            return state
    
    async def _analyze_consistency(
        self,
        diagnosis: Dict[str, Any],
        medications: Dict[str, Any],
        risk: Optional[Dict[str, Any]],
        treatment: Optional[Dict[str, Any]],
        deterioration: Optional[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Analyze consistency across agent outputs
        """
        
        prompt = f"""
You are a senior attending physician reviewing a case workup by multiple specialists.

Your task: Identify contradictions, inconsistencies, or critical missing information.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SPECIALIST ASSESSMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DIAGNOSTICIAN (Differential Diagnosis):
{json.dumps(diagnosis, indent=2, default=str)}

PHARMACIST (Medication Reconciliation):
{json.dumps(medications, indent=2, default=str)}

RISK ASSESSMENT TEAM:
{json.dumps(risk, indent=2, default=str) if risk else "Not yet assessed"}

TREATMENT TEAM:
{json.dumps(treatment, indent=2, default=str) if treatment else "Not yet assessed"}

RAPID RESPONSE TEAM (Clinical Deterioration):
{json.dumps(deterioration, indent=2, default=str) if deterioration else "Not yet assessed"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR TASK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Identify:
1. **Contradictions**: Do specialists disagree? Examples:
   - Diagnosis suggests urgent surgery, but risk assessment says too unstable
   - Medication reconciliation found drug causing symptoms in differential
   - Treatment plan conflicts with medication safety concerns

2. **Inconsistencies**: Do conclusions not match data? Examples:
   - Low-risk diagnosis but high clinical deterioration score
   - Stable diagnosis but labs showing worsening
   - Treatment recommended despite contraindications

3. **Critical Gaps**: What's missing that prevents safe decision-making? Examples:
   - High-risk diagnosis but no urgency assessment
   - Treatment plan but no safety monitoring defined
   - Discharge planned but medication access not verified

4. **Re-analysis Triggers**: Does NEW information require revisiting earlier conclusions?
   - Medication causing fever → should reconsider infectious differential
   - Adverse drug reaction → explains "disease progression"
   - Lab critical value → urgency level may be wrong

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT (JSON ONLY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{{
  "contradictions": [
    {{
      "agent_1": "differential_diagnosis",
      "agent_1_conclusion": "Urgent surgical condition",
      "agent_2": "risk_stratification",
      "agent_2_conclusion": "Too unstable for surgery",
      "severity": "critical|major|minor",
      "clinical_implication": "Cannot proceed with recommended treatment",
      "resolution_strategy": "ICU optimization before surgery vs medical management"
    }}
  ],
  
  "inconsistencies": [
    {{
      "agent": "differential_diagnosis",
      "finding": "Diagnosis suggests low risk",
      "conflicting_data": "NEWS2 score indicates high deterioration risk",
      "clinical_concern": "May be underestimating severity",
      "recommended_action": "Reassess urgency and monitoring plan"
    }}
  ],
  
  "critical_gaps": [
    {{
      "gap": "No renal dosing for medications despite CKD",
      "affected_agents": ["medication_reconciliation", "treatment_validation"],
      "patient_safety_impact": "high|moderate|low",
      "required_action": "Adjust all medications for GFR 35"
    }}
  ],
  
  "reanalysis_triggers": [
    {{
      "trigger": "Medication reconciliation identified beta-blocker as cause of bradycardia",
      "agent_to_rerun": "differential_diagnosis",
      "reason": "Symptom attributed to disease is actually drug side effect",
      "priority": "high|moderate|low"
    }}
  ],
  
  "requires_reanalysis": true|false,
  "reanalysis_reason": "Brief explanation if true, null if false",
  
  "resolutions": [
    {{
      "contradiction_or_gap": "Which issue are we resolving?",
      "resolution": "How should clinician reconcile this?",
      "confidence": "high|moderate|low"
    }}
  ],
  
  "overall_consistency": "consistent|minor_issues|major_concerns",
  "safe_to_proceed": true|false,
  "summary": "One sentence summary of coordination results"
}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Return ONLY valid JSON
- Empty lists if no issues found
- Be conservative: better to flag potential issue than miss one
- Focus on PATIENT SAFETY implications
- Trigger re-analysis for significant new information only (not minor clarifications)
"""
        
        try:
            response = self.llm.invoke([
                SystemMessage(content="You are a senior attending coordinating multi-specialist care."),
                HumanMessage(content=prompt)
            ])
            
            result = self._parse_response(response.content)
            logger.info(f"Coordination analysis complete: {result.get('summary', 'No summary')}")
            return result
            
        except Exception as e:
            logger.error(f"Consistency analysis failed: {str(e)}")
            return {
                "contradictions": [],
                "inconsistencies": [],
                "critical_gaps": [],
                "reanalysis_triggers": [],
                "requires_reanalysis": False,
                "reanalysis_reason": None,
                "resolutions": [],
                "overall_consistency": "unknown",
                "safe_to_proceed": True,
                "summary": "Coordination analysis failed"
            }
    
    def _parse_response(self, content: str) -> dict:
        """Parse LLM response to JSON"""
        try:
            content = content.strip()
            
            # Extract JSON from markdown
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
            logger.warning(f"⚠️ Coordination JSON parse failed: {e}")
            return {
                "contradictions": [],
                "inconsistencies": [],
                "critical_gaps": [],
                "reanalysis_triggers": [],
                "requires_reanalysis": False,
                "overall_consistency": "unknown",
                "safe_to_proceed": True,
                "summary": "Parse failed"
            }