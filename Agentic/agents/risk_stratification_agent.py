"""
Risk Stratification Agent
Comprehensive risk assessment with validated scoring systems
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
    from Agentic.core.context_builder import build_risk_stratification_context
except ImportError:
    from core.context_builder import build_risk_stratification_context


class RiskStratificationAgent:
    """
    Comprehensive risk assessment using validated scores and clinical reasoning
    """
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
    
    async def analyze(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Perform risk stratification"""
        
        logger.info("⚠️ Risk Stratification Agent: Starting analysis")
        
        try:
            # Build optimized context
            context = build_risk_stratification_context(state)
            logger.info(f"risk context;{context}")
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
            state["risk_stratification"] = result
            state["confidence_scores"]["risk"] = result.get("confidence_score", 0.0)
            
            # Add warnings
            self._add_warnings(state, result)
            
            logger.info("✅ Risk Stratification Agent: Analysis complete")
            return state
            
        except Exception as e:
            logger.error(f"❌ Risk Stratification Agent failed: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            state["error"] = f"Risk stratification failed: {str(e)}"
            return state
    
    def _get_system_message(self) -> str:
        """System message defining agent role"""
        return """You are a risk assessment expert specializing in validated clinical risk scores.

Your expertise:
- NEWS2 (National Early Warning Score)
- qSOFA (Quick SOFA for sepsis)
- MEWS (Modified Early Warning Score)
- LACE Index (readmission risk)
- CHADS2-VASc, HAS-BLED (stroke/bleeding risk)
- TIMI, GRACE (cardiac risk)
- APACHE II, SOFA (ICU mortality)

Your output must show explicit calculations with clinical interpretation."""
    
    def _build_prompt(self, context: str, consultation: str) -> str:
        """Build the main prompt"""
        
        return f"""
{context}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CURRENT CONSULTATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{consultation}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR TASK: COMPREHENSIVE RISK ASSESSMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Calculate validated risk scores and assess patient risk across multiple domains.

VALIDATED RISK SCORES TO CALCULATE (where applicable):

**NEWS2 (National Early Warning Score 2):**
- Respiratory rate: 0-3 points
- Oxygen saturation: 0-3 points  
- Supplemental oxygen: 0 or 2 points
- Temperature: 0-3 points
- Systolic BP: 0-3 points
- Heart rate: 0-3 points
- Consciousness (AVPU): 0-3 points
Interpretation: 0-4 (low), 5-6 (medium), 7+ (high risk)

**qSOFA (Quick Sepsis):**
- Respiratory rate ≥22/min: 1 point
- Altered mental status: 1 point
- Systolic BP ≤100 mmHg: 1 point
Interpretation: ≥2 = high sepsis risk

RISK ASSESSMENT DOMAINS:

1. **Mortality Risk**
   - Short-term (in-hospital, 30-day)
   - Long-term (1-year, 5-year)
   - Based on validated scores and clinical factors

2. **Morbidity Risk**
   - Complication probability
   - Severity if occurs
   - Specific complications to watch

3. **Treatment Risk**
   - Medication adverse effects
   - Procedure complications
   - Risk vs benefit analysis

4. **Time-Sensitive Risks**
   - Immediate (hours): requires urgent action
   - Short-term (days-weeks): requires monitoring
   - Long-term (months-years): requires management

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{{
  "clinical_reasoning": {{
    "overall_assessment": "Comprehensive narrative of patient's risk profile with supporting evidence from clinical data, vital signs, lab results, and calculated risk scores",
    "key_risk_factors": [
      "Risk factor 1 with detailed explanation of why this increases risk and magnitude of impact",
      "Risk factor 2 with evidence and clinical significance"
    ]
  }},
  
  "validated_risk_scores": {{
    "NEWS2": {{
      "total_score": 0-20,
      "risk_level": "low|medium|high",
      "component_breakdown": {{
        "respiratory_rate": {{"value": "number/min", "points": 0-3}},
        "oxygen_saturation": {{"value": "number%", "points": 0-3}},
        "supplemental_oxygen": {{"on_oxygen": true|false, "points": 0-2}},
        "temperature": {{"value": "number°C", "points": 0-3}},
        "systolic_bp": {{"value": "number mmHg", "points": 0-3}},
        "heart_rate": {{"value": "number/min", "points": 0-3}},
        "consciousness": {{"level": "Alert|Voice|Pain|Unresponsive", "points": 0-3}}
      }},
      "interpretation": "Clinical interpretation with recommended actions",
      "monitoring_frequency": "continuous|Q15min|Q1hr|Q4hr|routine"
    }},
    
    "qSOFA": {{
      "total_score": 0-3,
      "risk_level": "low|high",
      "components": {{
        "respiratory_rate_≥22": true|false,
        "altered_mental_status": true|false,
        "systolic_bp_≤100": true|false
      }},
      "interpretation": "Sepsis risk assessment with recommended actions"
    }}
  }},
  
  "overall_risk_level": "low|moderate|high|critical",
  
  "mortality_risk": {{
    "short_term": {{
      "level": "low|moderate|high",
      "reasoning": "Detailed explanation with supporting evidence",
      "estimated_percentage": "Best estimate with range (e.g., 15-20%)",
      "timeframe": "in-hospital|30-day"
    }},
    "long_term": {{
      "level": "low|moderate|high",
      "reasoning": "Detailed explanation",
      "estimated_percentage": "e.g., 40% 1-year mortality",
      "timeframe": "1-year|5-year"
    }}
  }},
  
  "morbidity_risk": {{
    "complication_probability": "low|moderate|high",
    "severity_if_occurs": "mild|moderate|severe",
    "specific_complications": [
      {{
        "complication": "Name of complication",
        "probability": "percentage or low/moderate/high",
        "clinical_impact": "Description of impact if occurs",
        "prevention_strategy": "How to prevent"
      }}
    ]
  }},
  
  "time_sensitive_risks": [
    {{
      "risk": "Detailed description of specific risk",
      "urgency": "immediate|urgent|soon|routine",
      "timeframe": "hours|days|weeks",
      "mitigation": "Specific actions to take now",
      "monitoring_required": "What to monitor and how often"
    }}
  ],
  
  "risk_mitigation_priorities": [
    {{
      "risk": "Specific risk to mitigate",
      "intervention": "Detailed intervention with specifics",
      "expected_benefit": "How much risk reduction expected",
      "feasibility": "easy|moderate|difficult",
      "priority": 1-5,
      "rationale": "Why this priority level"
    }}
  ],
  
  "requires_immediate_action": true|false,
  "immediate_action_items": ["Specific action 1", "Specific action 2"],
  
  "confidence_score": 0.0-1.0,
  "confidence_rationale": "Why this confidence level - what data is solid vs uncertain"
}}

CRITICAL REQUIREMENTS:
✓ Calculate actual risk scores with explicit component breakdown
✓ Show your reasoning for all risk assessments  
✓ Use patient-specific data to justify risk levels
✓ Provide specific mitigation strategies
✓ Quantify risks with percentages when possible
✓ Use complete clinical sentences - NO word limits

OUTPUT: Return ONLY valid JSON. No markdown, no explanations outside JSON.
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
            logger.warning(f"⚠️ Risk Stratification JSON parse failed: {e}")
            return {
                "raw_content": content[:1000],
                "confidence_score": 0.5,
                "overall_risk_level": "unknown"
            }
    
    def _add_warnings(self, state: Dict[str, Any], result: Dict[str, Any]):
        """Add warnings to state based on risk assessment"""
        
        # Check if immediate action required
        if result.get("requires_immediate_action"):
            state["warnings"].append("🚨 IMMEDIATE ACTION REQUIRED - Critical risk identified")
            state["requires_review"] = True
            
            # Add specific action items
            for action in result.get("immediate_action_items", []):
                state["warnings"].append(f"  → {action}")
        
        # Check overall risk level
        overall_risk = result.get("overall_risk_level", "").lower()
        if overall_risk in ["high", "critical"]:
            state["requires_review"] = True
        
        # Check NEWS2 score
        validated_scores = result.get("validated_risk_scores", {})
        news2 = validated_scores.get("NEWS2", {})
        if news2.get("risk_level") in ["medium", "high"]:
            score = news2.get("total_score", 0)
            state["warnings"].append(
                f"⚠️ NEWS2 SCORE: {score} - {news2.get('risk_level', '').upper()} RISK"
            )
        
        # Check qSOFA
        qsofa = validated_scores.get("qSOFA", {})
        if qsofa.get("risk_level") == "high":
            state["warnings"].append("🚨 qSOFA ≥2 - HIGH SEPSIS RISK")
            state["requires_review"] = True