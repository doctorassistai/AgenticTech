"""
Clinical Synthetic Reasoning Engine
Generates LLM-based clinical inferences and stores them as 
clearly-marked synthetic nodes in Neo4j.
"""

import json
import os
from datetime import datetime
from typing import Dict, List, Optional, Any
from uuid import uuid4
from loguru import logger
from neo4j import AsyncGraphDatabase
from groq import Groq

api_key = os.getenv("GROQ_API_KEY")
groq_client = Groq(api_key=api_key) if api_key else None


class ClinicalReasoningEngine:
    """
    Uses LLM to generate synthetic clinical reasoning:
    - Vital change indications & organ impact
    - Lab interpretation (existing vs new, med-induced, normalization targets)
    - Medication effectiveness tracking
    - Procedure recovery trajectories
    - Cross-domain correlations
    """
    
    def __init__(self, uri: str, user: str, password: str):
        
        self.driver = AsyncGraphDatabase.driver(uri, auth=(user, password))
    
    async def close(self):
        await self.driver.close()
    
    # ==================== LLM PROMPTS ====================
    
    def _call_llm(self, prompt: str, model: str = "llama-3.3-70b-versatile", 
                  max_tokens: int = 4000, temperature: float = 0.1) -> str:
        """Synchronous LLM call (matches your existing pattern)."""
        if not groq_client:
            raise RuntimeError("GROQ_API_KEY not set")
        completion = groq_client.chat.completions.create(
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}]
        )
        return completion.choices[0].message.content
    
    def _build_vital_prompt(self, vitals: List[Dict], conditions: List[Dict], 
                           medications: List[Dict], demographics: Dict) -> str:
        return f"""
You are a senior critical care physician analyzing vital sign changes.
Given the patient's current vitals, conditions, and medications, generate clinical reasoning.

INPUT:
Demographics: {json.dumps(demographics)}
Active Conditions: {json.dumps(conditions)}
Current Medications: {json.dumps(medications)}
Recent Vitals: {json.dumps(vitals)}

TASK:
For EACH vital sign, determine:
1. What does this value/indicate clinically? (indication)
2. Which organ systems are affected? (organs: ["Cardiovascular", "Respiratory", "Renal", "Neurological", "Hepatic", "Endocrine"])
3. Which parameters should be monitored as a result? (monitoring_params)
4. Is this likely related to a condition, medication, or procedure? (correlation_source)
5. What would be the target/normal value? (target_value)
6. What trend should we watch for? (trend_alert)

For the patient overall:
7. Are there conflicting vital signs that suggest a complex clinical picture? (conflicts)
8. What is the highest priority monitoring concern? (priority_concern)

RULES:
- Be specific. Don't say "monitor patient" — say "monitor urine output hourly for AKI"
- Link vitals to medications when plausible (e.g., beta-blocker → low HR)
- Flag critical combinations (e.g., low BP + high HR = shock)
- Return ONLY valid JSON.

OUTPUT FORMAT:
{{
  "vital_indications": [
    {{
      "vital_type": "Blood Pressure",
      "value": "145/92",
      "indication": "Stage 1 Hypertension, poorly controlled",
      "severity": "moderate",
      "organs_affected": ["Cardiovascular", "Renal"],
      "monitoring_params": [
        {{"param": "Serum Creatinine", "frequency": "Daily", "reason": "Hypertensive nephropathy risk"}},
        {{"param": "Urine Output", "frequency": "Hourly", "reason": "Renal perfusion"}}
      ],
      "correlation_source": "Condition: Hypertension",
      "target_value": "<130/80 mmHg",
      "trend_alert": "Rising trend over 3 days — risk of hypertensive emergency",
      "is_critical": false
    }}
  ],
  "overall_assessment": {{
    "conflicts": "Low SpO2 despite normal HR suggests primary pulmonary issue vs cardiac",
    "priority_concern": "Respiratory compromise",
    "recommended_investigations": ["ABG", "Chest X-ray", "BNP"]
  }},
  "confidence": 0.85
}}
"""
    
    def _build_lab_prompt(self, labs: List[Dict], conditions: List[Dict],
                          medications: List[Dict], previous_labs: List[Dict]) -> str:
        return f"""
You are a senior pathologist and clinical biochemist interpreting laboratory results.

INPUT:
Active Conditions: {json.dumps(conditions)}
Current Medications: {json.dumps(medications)}
Current Labs: {json.dumps(labs)}
Previous Labs (if any): {json.dumps(previous_labs)}

TASK:
For EACH lab result, determine:
1. Is this NEW (first time abnormal), EXISTING (known chronic abnormality), ACUTE_CHANGE (worsening from baseline), or IMPROVING? (status)
2. What condition does it indicate or track? (indicated_condition)
3. Could this be caused by a medication? (medication_induced)
4. What medication or treatment would normalize this value? (normalization_target)
5. What parameters and target values indicate successful treatment? (success_parameters)
6. What side effects or downstream effects should be monitored? (downstream_effects)
7. Is this critical/life-threatening? (is_critical)
8. What organ system is primarily affected? (organ_system)

For the panel overall:
9. Are there patterns across multiple labs suggesting a single underlying issue? (pattern_analysis)
10. What additional labs would clarify the picture? (recommended_labs)

RULES:
- If Potassium is high and patient is on ACE inhibitor → flag as medication-induced
- If Creatinine rises with NSAID use → flag nephrotoxicity
- Link HbA1c to diabetes control, TSH to thyroid medication dosing
- Return ONLY valid JSON.

OUTPUT FORMAT:
{{
  "lab_interpretations": [
    {{
      "test_name": "Potassium",
      "value": "5.8 mmol/L",
      "status": "ACUTE_CHANGE",
      "status_reason": "Increased from 4.2 mmol/L 3 days ago",
      "indicated_condition": "Hyperkalemia",
      "severity": "moderate",
      "medication_induced": true,
      "causing_medication": "Spironolactone",
      "mechanism": "Potassium-sparing diuretic effect",
      "normalization_target": "Stop/adjust Spironolactone, target K+ 3.5-5.0",
      "success_parameters": [
        {{"param": "Potassium", "target": "3.5-5.0 mmol/L", "timeline": "48-72 hours"}}
      ],
      "downstream_effects": [
        {{"effect": "Cardiac arrhythmia risk", "monitor": "ECG continuously"}},
        {{"effect": "Metabolic acidosis", "monitor": "ABG, bicarbonate"}}
      ],
      "organ_system": "Renal/Cardiovascular",
      "is_critical": false
    }}
  ],
  "pattern_analysis": "Rising creatinine + hyperkalemia + low eGFR suggests acute kidney injury",
  "recommended_labs": ["ABG", "Urinalysis", "Renal ultrasound"],
  "confidence": 0.82
}}
"""
    
    def _build_medication_effectiveness_prompt(self, medications: List[Dict], 
                                                vitals: List[Dict], labs: List[Dict],
                                                symptoms: List[Dict], conditions: List[Dict]) -> str:
        return f"""
You are a clinical pharmacologist evaluating medication effectiveness.

INPUT:
Active Conditions: {json.dumps(conditions)}
Current Medications: {json.dumps(medications)}
Recent Vitals: {json.dumps(vitals)}
Recent Labs: {json.dumps(labs)}
Active Symptoms: {json.dumps(symptoms)}

TASK:
For EACH medication, determine:
1. What is the intended therapeutic goal? (therapeutic_goal)
2. Which parameters (vitals/labs/symptoms) should improve to prove effectiveness? (effectiveness_markers)
3. What is the expected timeline for improvement? (expected_timeline)
4. Has improvement already occurred based on available data? (current_status: effective / partial / ineffective / too_early)
5. What alternative medications could be considered if ineffective? (alternatives)
6. What drug interactions or contraindications exist with current meds/conditions? (interactions)
7. What monitoring proves the medication is working AND not causing harm? (monitoring_plan)

For treatment comparison:
8. If multiple meds treat the same condition, which appears more effective in this patient? (comparative_effectiveness)

RULES:
- Metformin → monitor HbA1c, fasting glucose, renal function
- Antibiotics → monitor WBC, fever curve, CRP, culture results
- Diuretics → monitor weight, edema, electrolytes, renal function
- Return ONLY valid JSON.

OUTPUT FORMAT:
{{
  "medication_assessments": [
    {{
      "drug_name": "Metformin",
      "therapeutic_goal": "Reduce HbA1c to <7% and fasting glucose <130 mg/dL",
      "effectiveness_markers": [
        {{"marker": "HbA1c", "target": "<7%", "current": "7.2%", "trend": "improving"}},
        {{"marker": "Fasting Glucose", "target": "<130 mg/dL", "current": "142 mg/dL", "trend": "stable"}}
      ],
      "expected_timeline": "3 months for full HbA1c effect",
      "current_status": "partial",
      "status_reason": "HbA1c decreased from 8.1% but not yet at target",
      "alternatives": ["GLP-1 agonist", "SGLT2 inhibitor"],
      "interactions": [
        {{"drug": "Contrast dye", "risk": "Lactic acidosis", "action": "Hold 48h before contrast"}}
      ],
      "monitoring_plan": [
        {{"param": "HbA1c", "frequency": "Every 3 months"}},
        {{"param": "Serum Creatinine", "frequency": "Every 6 months", "reason": "Metformin contraindicated if eGFR <30"}}
      ]
    }}
  ],
  "comparative_effectiveness": [
    {{
      "condition": "Type 2 Diabetes",
      "medications_compared": ["Metformin", "Glipizide"],
      "more_effective": "Metformin",
      "reason": "Better HbA1c reduction with lower hypoglycemia risk"
    }}
  ],
  "confidence": 0.88
}}
"""
    
    def _build_procedure_recovery_prompt(self, procedure: Dict, patient_profile: Dict,
                                          vitals: List[Dict], labs: List[Dict]) -> str:
        return f"""
You are a surgeon and perioperative care specialist creating a recovery monitoring plan.

INPUT:
Procedure: {json.dumps(procedure)}
Patient Profile: {json.dumps(patient_profile)}
Recent Vitals: {json.dumps(vitals)}
Recent Labs: {json.dumps(labs)}

TASK:
1. What is the normal recovery trajectory for this procedure? (normal_trajectory)
   - Phases with expected timelines
   - Expected vital sign ranges per phase
   - Expected lab normalization per phase
2. What abnormal parameters must be monitored? (abnormal_monitors)
   - Early warning signs of complications
   - Specific thresholds for concern
3. What are the most common complications and their indicators? (complication_risks)
4. What interventions should be ready if recovery deviates? (contingency_plan)
5. When can the patient transition between care levels? (transition_criteria)

RULES:
- Be procedure-specific (cardiac surgery vs appendectomy vs catheterization)
- Consider patient age, comorbidities
- Include specific numeric thresholds where possible
- Return ONLY valid JSON.

OUTPUT FORMAT:
{{
  "recovery_trajectory": {{
    "procedure": "Laparoscopic Appendectomy",
    "normal_phases": [
      {{
        "phase": "Immediate Post-op (0-6h)",
        "vitals_target": {{"HR": "60-100", "BP": "SBP >100", "Temp": "<38°C"}},
        "pain_target": "VAS <4",
        "mobility": "Bed rest, leg exercises",
        "diet": "NPO → clear liquids",
        "labs_expected": "WBC trending down, Hgb stable"
      }},
      {{
        "phase": "Early Recovery (6-24h)",
        "vitals_target": {{"HR": "60-90", "BP": "normotensive", "Temp": "<37.5°C"}},
        "pain_target": "VAS <3",
        "mobility": "Ambulate with assistance",
        "diet": "Soft diet tolerated",
        "labs_expected": "WBC <11,000, Creatinine stable"
      }},
      {{
        "phase": "Late Recovery (24-72h)",
        "vitals_target": {{"HR": "60-80", "BP": "baseline", "Temp": "<37.2°C"}},
        "pain_target": "VAS <2 on oral analgesics",
        "mobility": "Independent ambulation",
        "diet": "Regular diet",
        "discharge_criteria": "Afebrile 24h, tolerating diet, pain controlled"
      }}
    ],
    "abnormal_monitors": [
      {{
        "parameter": "Temperature",
        "threshold": ">38.5°C",
        "indicates": "Surgical site infection or intra-abdominal abscess",
        "action": "Blood cultures, CT abdomen, broaden antibiotics"
      }},
      {{
        "parameter": "WBC",
        "threshold": ">15,000 or rising after day 2",
        "indicates": "Perforation, abscess, or ongoing infection",
        "action": "Imaging, surgical re-evaluation"
      }},
      {{
        "parameter": "HR/BP",
        "threshold": "HR >110 + SBP <90",
        "indicates": "Hemorrhage or sepsis",
        "action": "Fluid resuscitation, transfusion, return to OR"
      }}
    ],
    "complication_risks": [
      {{"complication": "Surgical site infection", "probability": "low", "signs": "Fever, erythema, purulent drainage"}},
      {{"complication": "Intra-abdominal abscess", "probability": "low", "signs": "Fever, ileus, localized tenderness"}}
    ],
    "contingency_plan": "If fever >38.5°C after 48h → CT abdomen with contrast. If WBC rises → reassess for perforation.",
    "expected_discharge": "Post-op day 1-2"
  }},
  "confidence": 0.80
}}
"""
    
    def _build_cross_correlation_prompt(self, all_entities: List[Dict]) -> str:
        return f"""
You are a master diagnostician finding hidden correlations across all patient data.

INPUT:
All Clinical Entities: {json.dumps(all_entities)}

TASK:
Find NON-OBVIOUS correlations between:
- Symptoms ↔ Labs
- Vitals ↔ Medications  
- Labs ↔ Medications
- Procedures ↔ Labs/Vitals
- Conditions ↔ Conditions (comorbidity interactions)

For each correlation found:
1. What entities are correlated? (entity_a, entity_b)
2. What is the nature of correlation? (correlation_type: "causal", "associative", "adverse_effect", "therapeutic_response", "complication")
3. What is the clinical reasoning? (reasoning)
4. What should be done about it? (action)
5. Confidence level? (confidence: 0.0-1.0)

RULES:
- Only report correlations with clinical significance
- Don't state obvious facts (e.g., "diabetes has high glucose")
- Look for drug-lab interactions, symptom clusters, vital-lab patterns
- Return ONLY valid JSON.

OUTPUT FORMAT:
{{
  "correlations": [
    {{
      "entity_a": {{"type": "Medication", "name": "Furosemide"}},
      "entity_b": {{"type": "Lab", "name": "Potassium"}},
      "correlation_type": "causal",
      "direction": "causes_depletion",
      "reasoning": "Loop diuretics increase renal potassium wasting",
      "clinical_significance": "Hypokalemia risk increases arrhythmia susceptibility",
      "action": "Monitor K+ daily, supplement if <3.5",
      "confidence": 0.95
    }},
    {{
      "entity_a": {{"type": "Symptom", "name": "Orthopnea"}},
      "entity_b": {{"type": "Vital", "name": "Blood Pressure"}},
      "correlation_type": "associative",
      "direction": "co_occurs_with",
      "reasoning": "Orthopnea suggests heart failure which often presents with hypertension",
      "clinical_significance": "Both suggest decompensated CHF",
      "action": "Check BNP, echo, adjust diuretics",
      "confidence": 0.78
    }}
  ],
  "confidence": 0.85
}}
"""
    
    # ==================== SYNTHETIC NODE CREATORS ====================
    
    async def _create_synthetic_inference(self, patient_id: str, inference_type: str,
                                          description: str, confidence: float,
                                          source_entity_ids: List[str],
                                          clinical_rationale: str,
                                          recommended_actions: List[Dict],
                                          severity: Optional[str] = None) -> str:
        """Create a synthetic ClinicalInference node."""
        inference_id = f"inf_{uuid4().hex[:10]}"
        async with self.driver.session() as session:
            await session.run("""
                MATCH (p:Patient {patient_id: $patient_id})
                CREATE (inf:ClinicalInference {
                    inference_id: $inference_id,
                    inference_type: $inference_type,
                    description: $description,
                    confidence: $confidence,
                    is_synthetic: true,
                    source_entity_ids: $source_entity_ids,
                    clinical_rationale: $clinical_rationale,
                    recommended_actions: $recommended_actions,
                    severity: $severity,
                    generated_at: datetime(),
                    reviewed: false
                })
                CREATE (p)-[:HAS_INFERENCE {recorded_at: datetime(), is_synthetic: true}]->(inf)
                RETURN $inference_id AS id
            """, patient_id=patient_id, inference_id=inference_id,
                inference_type=inference_type, description=description,
                confidence=confidence, source_entity_ids=source_entity_ids,
                clinical_rationale=clinical_rationale,
                recommended_actions=json.dumps(recommended_actions),
                severity=severity)
        return inference_id
    
    async def _link_inference_to_entity(self, inference_id: str, entity_id: str,
                                         entity_type: str, edge_type: str,
                                         properties: Optional[Dict] = None):
        """Link synthetic inference to source factual entity."""
        props = properties or {}
        async with self.driver.session() as session:
            # Dynamic node label matching
            await session.run(f"""
                MATCH (inf:ClinicalInference {{inference_id: $inference_id}})
                MATCH (e:{entity_type} {{vital_id: $entity_id}})
                    WHERE e.vital_id = $entity_id OR e.lab_id = $entity_id 
                    OR e.proc_id = $entity_id OR e.meas_id = $entity_id
                    OR e.inv_id = $entity_id OR e.tx_id = $entity_id
                    OR e.finding_id = $entity_id
                CREATE (inf)-[:{edge_type} $props]->(e)
            """, inference_id=inference_id, entity_id=entity_id,
                props=json.dumps(props))
    
    async def _create_organ_impact(self, inference_id: str, organ: str,
                                    impact_type: str, severity: str,
                                    monitoring_params: List[Dict]):
        """Create organ impact nodes linked to inference."""
        async with self.driver.session() as session:
            await session.run("""
                MATCH (inf:ClinicalInference {inference_id: $inference_id})
                MERGE (o:OrganSystem {name: $organ})
                ON CREATE SET o.created_at = datetime()
                CREATE (inf)-[:AFFECTS_ORGAN {
                    impact_type: $impact_type,
                    severity: $severity,
                    is_synthetic: true
                }]->(o)
            """, inference_id=inference_id, organ=organ,
                impact_type=impact_type, severity=severity)
            
            for param in monitoring_params:
                param_id = f"mon_{uuid4().hex[:8]}"
                await session.run("""
                    MATCH (inf:ClinicalInference {inference_id: $inference_id})
                    MATCH (o:OrganSystem {name: $organ})
                    CREATE (mp:MonitoringParam {
                        param_id: $param_id,
                        name: $name,
                        frequency: $frequency,
                        reason: $reason,
                        is_synthetic: true,
                        created_at: datetime()
                    })
                    CREATE (inf)-[:REQUIRES_MONITORING {
                        priority: $priority,
                        is_synthetic: true
                    }]->(mp)
                    CREATE (mp)-[:MONITORS_ORGAN]->(o)
                """, inference_id=inference_id, organ=organ,
                    param_id=param_id, name=param.get("param"),
                    frequency=param.get("frequency", "As needed"),
                    reason=param.get("reason", ""),
                    priority=param.get("priority", "routine"))
    
    async def _create_lab_interpretation(self, patient_id: str, lab_id: str,
                                          test_name: str, interpretation: Dict) -> str:
        """Create synthetic lab interpretation node."""
        interp_id = f"labi_{uuid4().hex[:10]}"
        async with self.driver.session() as session:
            await session.run("""
                MATCH (p:Patient {patient_id: $patient_id})
                MATCH (l:LabResult {lab_id: $lab_id})
                
                CREATE (li:LabInterpretation {
                    interp_id: $interp_id,
                    test_name: $test_name,
                    status: $status,
                    status_reason: $status_reason,
                    indicated_condition: $indicated_condition,
                    severity: $severity,
                    medication_induced: $medication_induced,
                    causing_medication: $causing_medication,
                    mechanism: $mechanism,
                    normalization_target: $normalization_target,
                    organ_system: $organ_system,
                    is_critical: $is_critical,
                    is_synthetic: true,
                    confidence: $confidence,
                    generated_at: datetime()
                })
                
                CREATE (l)-[:INTERPRETED_AS {is_synthetic: true}]->(li)
                CREATE (p)-[:HAS_INTERPRETATION {is_synthetic: true}]->(li)
                
                // Link to indicated condition if exists
                WITH li
                OPTIONAL MATCH (p2:Patient {patient_id: $patient_id})-[:PRESENTS_WITH]->(c:Condition)
                WHERE c.name = $indicated_condition OR c.name CONTAINS $indicated_condition
                FOREACH (x IN CASE WHEN c IS NOT NULL THEN [c] ELSE [] END |
                    CREATE (li)-[:INDICATES_CONDITION {is_synthetic: true}]->(x)
                )
                
                RETURN li.interp_id as id
            """, patient_id=patient_id, lab_id=lab_id, interp_id=interp_id,
                test_name=test_name, status=interpretation.get("status"),
                status_reason=interpretation.get("status_reason"),
                indicated_condition=interpretation.get("indicated_condition"),
                severity=interpretation.get("severity"),
                medication_induced=interpretation.get("medication_induced", False),
                causing_medication=interpretation.get("causing_medication"),
                mechanism=interpretation.get("mechanism"),
                normalization_target=interpretation.get("normalization_target"),
                organ_system=interpretation.get("organ_system"),
                is_critical=interpretation.get("is_critical", False),
                confidence=interpretation.get("confidence", 0.8))
        return interp_id
    
    async def _create_expected_response(self, patient_id: str, med_name: str,
                                         assessment: Dict) -> str:
        """Create medication expected response node."""
        resp_id = f"resp_{uuid4().hex[:10]}"
        async with self.driver.session() as session:
            await session.run("""
                MATCH (p:Patient {patient_id: $patient_id})
                MATCH (m:Medication {name: $med_name})<-[:PRESCRIBED]-(p)
                
                CREATE (er:ExpectedResponse {
                    resp_id: $resp_id,
                    therapeutic_goal: $therapeutic_goal,
                    expected_timeline: $expected_timeline,
                    current_status: $current_status,
                    status_reason: $status_reason,
                    is_synthetic: true,
                    confidence: $confidence,
                    generated_at: datetime()
                })
                
                CREATE (m)-[:HAS_EXPECTED_RESPONSE {is_synthetic: true}]->(er)
                CREATE (p)-[:HAS_RESPONSE_PLAN {is_synthetic: true}]->(er)
                
                RETURN er.resp_id as id
            """, patient_id=patient_id, med_name=med_name, resp_id=resp_id,
                therapeutic_goal=assessment.get("therapeutic_goal"),
                expected_timeline=assessment.get("expected_timeline"),
                current_status=assessment.get("current_status"),
                status_reason=assessment.get("status_reason"),
                confidence=assessment.get("confidence", 0.8))
        return resp_id
    
    async def _create_recovery_trajectory(self, patient_id: str, proc_id: str,
                                           procedure_name: str, recovery: Dict) -> str:
        """Create procedure recovery trajectory node."""
        traj_id = f"rec_{uuid4().hex[:10]}"
        async with self.driver.session() as session:
            await session.run("""
                MATCH (p:Patient {patient_id: $patient_id})
                MATCH (pr:Procedure {proc_id: $proc_id})
                
                CREATE (rt:RecoveryTrajectory {
                    traj_id: $traj_id,
                    procedure_name: $procedure_name,
                    expected_discharge: $expected_discharge,
                    contingency_plan: $contingency_plan,
                    is_synthetic: true,
                    confidence: $confidence,
                    generated_at: datetime()
                })
                
                CREATE (pr)-[:HAS_RECOVERY_TRAJECTORY {is_synthetic: true}]->(rt)
                CREATE (p)-[:HAS_RECOVERY_PLAN {is_synthetic: true}]->(rt)
                
                RETURN rt.traj_id as id
            """, patient_id=patient_id, proc_id=proc_id, traj_id=traj_id,
                procedure_name=procedure_name,
                expected_discharge=recovery.get("expected_discharge"),
                contingency_plan=recovery.get("contingency_plan"),
                confidence=recovery.get("confidence", 0.8))
        return traj_id
    
    async def _create_recovery_phase(self, traj_id: str, phase: Dict):
        """Create recovery phase under trajectory."""
        phase_id = f"ph_{uuid4().hex[:8]}"
        async with self.driver.session() as session:
            await session.run("""
                MATCH (rt:RecoveryTrajectory {traj_id: $traj_id})
                CREATE (rp:RecoveryPhase {
                    phase_id: $phase_id,
                    phase_name: $phase_name,
                    duration: $duration,
                    vitals_target: $vitals_target,
                    labs_expected: $labs_expected,
                    mobility: $mobility,
                    diet: $diet,
                    is_synthetic: true
                })
                CREATE (rt)-[:HAS_PHASE {is_synthetic: true}]->(rp)
            """, traj_id=traj_id, phase_id=phase_id,
                phase_name=phase.get("phase"),
                duration=phase.get("duration", ""),
                vitals_target=json.dumps(phase.get("vitals_target", {})),
                labs_expected=phase.get("labs_expected", ""),
                mobility=phase.get("mobility", ""),
                diet=phase.get("diet", ""))
    
    async def _create_abnormal_monitor(self, traj_id: str, monitor: Dict):
        """Create abnormal parameter monitor under trajectory."""
        mon_id = f"abm_{uuid4().hex[:8]}"
        async with self.driver.session() as session:
            await session.run("""
                MATCH (rt:RecoveryTrajectory {traj_id: $traj_id})
                CREATE (am:AbnormalMonitor {
                    mon_id: $mon_id,
                    parameter: $parameter,
                    threshold: $threshold,
                    indicates: $indicates,
                    action: $action,
                    is_synthetic: true
                })
                CREATE (rt)-[:REQUIRES_ABNORMAL_MONITORING {is_synthetic: true}]->(am)
            """, traj_id=traj_id, mon_id=mon_id,
                parameter=monitor.get("parameter"),
                threshold=monitor.get("threshold"),
                indicates=monitor.get("indicates"),
                action=monitor.get("action"))
    
    # ==================== PUBLIC API ====================
    
    async def generate_vital_indications(self, patient_id: str, vitals: List[Dict],
                                          conditions: List[Dict], medications: List[Dict],
                                          demographics: Dict) -> List[str]:
        """Generate and store synthetic vital sign clinical reasoning."""
        if not vitals:
            return []
        
        try:
            prompt = self._build_vital_prompt(vitals, conditions, medications, demographics)
            response = self._call_llm(prompt)
            data = json.loads(response)
            
            inference_ids = []
            for v in data.get("vital_indications", []):
                inference_id = await self._create_synthetic_inference(
                    patient_id=patient_id,
                    inference_type="vital_indication",
                    description=v.get("indication", ""),
                    confidence=data.get("confidence", 0.8) * v.get("confidence", 1.0),
                    source_entity_ids=[v.get("vital_type")],
                    clinical_rationale=v.get("trend_alert", ""),
                    recommended_actions=[{
                        "action": "monitor",
                        "params": v.get("monitoring_params", [])
                    }],
                    severity=v.get("severity")
                )
                
                # Create organ impacts
                if v.get("organs_affected"):
                    await self._create_organ_impact(
                        inference_id=inference_id,
                        organ=v.get("organs_affected")[0],  # Primary organ
                        impact_type="primary",
                        severity=v.get("severity", "moderate"),
                        monitoring_params=v.get("monitoring_params", [])
                    )
                
                inference_ids.append(inference_id)
            
            # Store overall assessment as separate inference
            overall = data.get("overall_assessment", {})
            if overall:
                inf_id = await self._create_synthetic_inference(
                    patient_id=patient_id,
                    inference_type="overall_assessment",
                    description=overall.get("priority_concern", ""),
                    confidence=data.get("confidence", 0.8),
                    source_entity_ids=[],
                    clinical_rationale=overall.get("conflicts", ""),
                    recommended_actions=[{
                        "action": "investigate",
                        "params": overall.get("recommended_investigations", [])
                    }],
                    severity="high" if overall.get("priority_concern") else "moderate"
                )
                inference_ids.append(inf_id)
            
            logger.info(f"Generated {len(inference_ids)} vital indication inferences for {patient_id}")
            return inference_ids
            
        except Exception as e:
            logger.error(f"Vital indication generation failed: {e}")
            return []
    
    async def generate_lab_interpretations(self, patient_id: str, labs: List[Dict],
                                            conditions: List[Dict], medications: List[Dict],
                                            previous_labs: List[Dict] = None) -> List[str]:
        """Generate and store synthetic lab interpretations."""
        if not labs:
            return []
        
        try:
            prompt = self._build_lab_prompt(labs, conditions, medications, previous_labs or [])
            response = self._call_llm(prompt)
            data = json.loads(response)
            
            interp_ids = []
            for li in data.get("lab_interpretations", []):
                # Find matching lab node (approximate by name)
                lab_id = await self._find_lab_node(patient_id, li.get("test_name"))
                if lab_id:
                    interp_id = await self._create_lab_interpretation(
                        patient_id=patient_id,
                        lab_id=lab_id,
                        test_name=li.get("test_name"),
                        interpretation=li
                    )
                    
                    # Create success parameter nodes
                    for sp in li.get("success_parameters", []):
                        await self._create_success_parameter(interp_id, sp)
                    
                    # Create downstream effect nodes
                    for de in li.get("downstream_effects", []):
                        await self._create_downstream_effect(interp_id, de)
                    
                    interp_ids.append(interp_id)
            
            logger.info(f"Generated {len(interp_ids)} lab interpretations for {patient_id}")
            return interp_ids
            
        except Exception as e:
            logger.error(f"Lab interpretation generation failed: {e}")
            return []
    
    async def _find_lab_node(self, patient_id: str, test_name: str) -> Optional[str]:
        """Find lab node ID by test name."""
        async with self.driver.session() as session:
            result = await session.run("""
                MATCH (p:Patient {patient_id: $patient_id})-[:HAS_LAB_RESULT]->(l:LabResult)
                WHERE l.test_name CONTAINS $test_name OR $test_name CONTAINS l.test_name
                RETURN l.lab_id as lab_id
                ORDER BY l.created_at DESC
                LIMIT 1
            """, patient_id=patient_id, test_name=test_name)
            record = await result.single()
            return record["lab_id"] if record else None
    
    async def _create_success_parameter(self, interp_id: str, param: Dict):
        """Create target parameter node for lab normalization."""
        param_id = f"sp_{uuid4().hex[:8]}"
        async with self.driver.session() as session:
            await session.run("""
                MATCH (li:LabInterpretation {interp_id: $interp_id})
                CREATE (sp:SuccessParameter {
                    param_id: $param_id,
                    param_name: $name,
                    target_value: $target,
                    timeline: $timeline,
                    is_synthetic: true
                })
                CREATE (li)-[:EXPECTED_TO_NORMALIZE {is_synthetic: true}]->(sp)
            """, interp_id=interp_id, param_id=param_id,
                name=param.get("param"), target=param.get("target"),
                timeline=param.get("timeline", ""))
    
    async def _create_downstream_effect(self, interp_id: str, effect: Dict):
        """Create downstream effect monitoring node."""
        effect_id = f"dse_{uuid4().hex[:8]}"
        async with self.driver.session() as session:
            await session.run("""
                MATCH (li:LabInterpretation {interp_id: $interp_id})
                CREATE (de:DownstreamEffect {
                    effect_id: $effect_id,
                    effect: $effect,
                    monitor: $monitor,
                    is_synthetic: true
                })
                CREATE (li)-[:HAS_DOWNSTREAM_EFFECT {is_synthetic: true}]->(de)
            """, interp_id=interp_id, effect_id=effect_id,
                effect=effect.get("effect"), monitor=effect.get("monitor"))
    
    async def generate_medication_effectiveness(self, patient_id: str,
                                                 medications: List[Dict], vitals: List[Dict],
                                                 labs: List[Dict], symptoms: List[Dict],
                                                 conditions: List[Dict]) -> List[str]:
        """Generate and store medication effectiveness assessments."""
        if not medications:
            return []
        
        try:
            prompt = self._build_medication_effectiveness_prompt(
                medications, vitals, labs, symptoms, conditions
            )
            response = self._call_llm(prompt)
            data = json.loads(response)
            
            resp_ids = []
            for ma in data.get("medication_assessments", []):
                resp_id = await self._create_expected_response(
                    patient_id=patient_id,
                    med_name=ma.get("drug_name"),
                    assessment=ma
                )
                
                # Link effectiveness markers
                for marker in ma.get("effectiveness_markers", []):
                    await self._link_effectiveness_marker(resp_id, marker, patient_id)
                
                # Create monitoring plan nodes
                for mp in ma.get("monitoring_plan", []):
                    await self._create_response_monitoring(resp_id, mp)
                
                resp_ids.append(resp_id)
            
            # Store comparative effectiveness
            for ce in data.get("comparative_effectiveness", []):
                await self._create_comparative_effectiveness(patient_id, ce)
            
            logger.info(f"Generated {len(resp_ids)} medication effectiveness assessments for {patient_id}")
            return resp_ids
            
        except Exception as e:
            logger.error(f"Medication effectiveness generation failed: {e}")
            return []
    
    async def _link_effectiveness_marker(self, resp_id: str, marker: Dict, patient_id: str):
        """Link expected response to vital/lab/symptom it should improve."""
        marker_type = marker.get("marker", "")
        async with self.driver.session() as session:
            # Try to match to VitalSign, LabResult, or Symptom
            await session.run("""
                MATCH (er:ExpectedResponse {resp_id: $resp_id})
                
                OPTIONAL MATCH (p:Patient {patient_id: $patient_id})-[:HAS_VITAL]->(v:VitalSign)
                WHERE v.vital_type CONTAINS $marker OR $marker CONTAINS v.vital_type
                
                OPTIONAL MATCH (p)-[:HAS_LAB_RESULT]->(l:LabResult)
                WHERE l.test_name CONTAINS $marker OR $marker CONTAINS l.test_name
                
                OPTIONAL MATCH (p)-[:HAS_SYMPTOM]->(s:Symptom)
                WHERE s.name CONTAINS $marker OR $marker CONTAINS s.name
                
                WITH er, v, l, s,
                    CASE 
                        WHEN v IS NOT NULL THEN [v, 'VitalSign']
                        WHEN l IS NOT NULL THEN [l, 'LabResult']
                        WHEN s IS NOT NULL THEN [s, 'Symptom']
                        ELSE [null, 'Unknown']
                    END as target
                
                WITH er, target[0] as node, target[1] as label
                WHERE node IS NOT NULL
                
                CALL apoc.create.relationship(er, 'SHOULD_IMPROVE_' + label, 
                    {target: $target, current: $current, trend: $trend, is_synthetic: true}, node) YIELD rel
                RETURN rel
            """, resp_id=resp_id, patient_id=patient_id, marker=marker_type,
                target=marker.get("target"), current=marker.get("current"),
                trend=marker.get("trend", "unknown"))
    
    async def _create_response_monitoring(self, resp_id: str, mp: Dict):
        """Create monitoring requirement for medication response."""
        mon_id = f"rpm_{uuid4().hex[:8]}"
        async with self.driver.session() as session:
            await session.run("""
                MATCH (er:ExpectedResponse {resp_id: $resp_id})
                CREATE (rpm:ResponseMonitoring {
                    mon_id: $mon_id,
                    param: $param,
                    frequency: $frequency,
                    reason: $reason,
                    is_synthetic: true
                })
                CREATE (er)-[:REQUIRES_MONITORING {is_synthetic: true}]->(rpm)
            """, resp_id=resp_id, mon_id=mon_id,
                param=mp.get("param"), frequency=mp.get("frequency"),
                reason=mp.get("reason", ""))
    
    async def _create_comparative_effectiveness(self, patient_id: str, ce: Dict):
        """Store which medication is more effective for a condition."""
        async with self.driver.session() as session:
            await session.run("""
                MATCH (p:Patient {patient_id: $patient_id})
                CREATE (tc:TreatmentComparison {
                    comp_id: $comp_id,
                    condition: $condition,
                    medications_compared: $meds,
                    more_effective: $more_effective,
                    reason: $reason,
                    is_synthetic: true,
                    generated_at: datetime()
                })
                CREATE (p)-[:HAS_COMPARISON {is_synthetic: true}]->(tc)
            """, patient_id=patient_id, comp_id=f"tc_{uuid4().hex[:8]}",
                condition=ce.get("condition"),
                meds=json.dumps(ce.get("medications_compared", [])),
                more_effective=ce.get("more_effective"),
                reason=ce.get("reason"))
    
    async def generate_procedure_recovery(self, patient_id: str, procedure: Dict,
                                           patient_profile: Dict, vitals: List[Dict],
                                           labs: List[Dict]) -> Optional[str]:
        """Generate and store procedure recovery trajectory."""
        if not procedure:
            return None
        
        try:
            prompt = self._build_procedure_recovery_prompt(
                procedure, patient_profile, vitals, labs
            )
            response = self._call_llm(prompt)
            data = json.loads(response)
            
            recovery = data.get("recovery_trajectory", {})
            proc_id = procedure.get("proc_id") or f"prc_{uuid4().hex[:8]}"
            
            traj_id = await self._create_recovery_trajectory(
                patient_id=patient_id,
                proc_id=proc_id,
                procedure_name=procedure.get("name", "Unknown"),
                recovery=recovery
            )
            
            # Create phases
            for phase in recovery.get("normal_phases", []):
                await self._create_recovery_phase(traj_id, phase)
            
            # Create abnormal monitors
            for monitor in recovery.get("abnormal_monitors", []):
                await self._create_abnormal_monitor(traj_id, monitor)
            
            logger.info(f"Generated recovery trajectory for procedure {procedure.get('name')} for {patient_id}")
            return traj_id
            
        except Exception as e:
            logger.error(f"Procedure recovery generation failed: {e}")
            return None
    
    async def generate_cross_correlations(self, patient_id: str, 
                                           all_entities: List[Dict]) -> List[str]:
        """Generate and store cross-domain correlations."""
        if len(all_entities) < 3:
            return []
        
        try:
            prompt = self._build_cross_correlation_prompt(all_entities)
            response = self._call_llm(prompt, max_tokens=4000)
            data = json.loads(response)
            
            corr_ids = []
            for corr in data.get("correlations", []):
                corr_id = f"corr_{uuid4().hex[:10]}"
                async with self.driver.session() as session:
                    await session.run("""
                        MATCH (p:Patient {patient_id: $patient_id})
                        CREATE (c:CrossCorrelation {
                            corr_id: $corr_id,
                            entity_a_type: $entity_a_type,
                            entity_a_name: $entity_a_name,
                            entity_b_type: $entity_b_type,
                            entity_b_name: $entity_b_name,
                            correlation_type: $correlation_type,
                            direction: $direction,
                            reasoning: $reasoning,
                            clinical_significance: $clinical_significance,
                            action: $action,
                            confidence: $confidence,
                            is_synthetic: true,
                            generated_at: datetime()
                        })
                        CREATE (p)-[:HAS_CORRELATION {is_synthetic: true}]->(c)
                    """, patient_id=patient_id, corr_id=corr_id,
                        entity_a_type=corr.get("entity_a", {}).get("type"),
                        entity_a_name=corr.get("entity_a", {}).get("name"),
                        entity_b_type=corr.get("entity_b", {}).get("type"),
                        entity_b_name=corr.get("entity_b", {}).get("name"),
                        correlation_type=corr.get("correlation_type"),
                        direction=corr.get("direction"),
                        reasoning=corr.get("reasoning"),
                        clinical_significance=corr.get("clinical_significance"),
                        action=corr.get("action"),
                        confidence=corr.get("confidence", 0.7))
                corr_ids.append(corr_id)
            
            logger.info(f"Generated {len(corr_ids)} cross-correlations for {patient_id}")
            return corr_ids
            
        except Exception as e:
            logger.error(f"Cross-correlation generation failed: {e}")
            return []
    
    # ==================== AGENT RETRIEVAL ====================
    
    async def get_synthetic_insights(
        self,
        patient_id: str,
        inference_type: Optional[str] = None
    ) -> List[Dict]:

        async with self.driver.session() as session:

            query = """
            MATCH (p:Patient {patient_id:$patient_id})-[:HAS_CORRELATION]->(c:CrossCorrelation)
            RETURN properties(c) AS insight
            ORDER BY c.generated_at DESC
            """

            result = await session.run(
                query,
                patient_id=patient_id
            )

            records = await result.data()

            return [r["insight"] for r in records]
    
    async def get_medication_monitoring_plan(self, patient_id: str, 
                                              med_name: Optional[str] = None) -> List[Dict]:
        """Get comprehensive medication monitoring (factual + synthetic)."""
        async with self.driver.session() as session:
            query = """
                MATCH (p:Patient {patient_id: $patient_id})
            """
            if med_name:
                query += """
                    MATCH (p)-[:PRESCRIBED]->(m:Medication {name: $med_name})
                """
            else:
                query += """
                    MATCH (p)-[:PRESCRIBED {is_current: true}]->(m:Medication)
                """
            
            query += """
                OPTIONAL MATCH (m)-[:HAS_EXPECTED_RESPONSE]->(er:ExpectedResponse)
                OPTIONAL MATCH (er)-[:REQUIRES_MONITORING]->(rpm:ResponseMonitoring)
                OPTIONAL MATCH (m)-[:MONITORED_FOR]->(mon:MonitoringParam)
                
                RETURN {
                    medication: m.name,
                    dose: (p)-[:PRESCRIBED]->(m).dose,
                    synthetic_goal: er.therapeutic_goal,
                    synthetic_status: er.current_status,
                    synthetic_monitoring: collect(DISTINCT {
                        param: rpm.param,
                        frequency: rpm.frequency,
                        reason: rpm.reason,
                        is_synthetic: true
                    }),
                    factual_monitoring: collect(DISTINCT {
                        param: mon.name,
                        expected_effect: mon.expected_effect,
                        adverse_risk: mon.adverse_effect_risk,
                        is_synthetic: false
                    })
                } as plan
            """
            
            result = await session.run(query, patient_id=patient_id, med_name=med_name)
            records = await result.data()
            return [r["plan"] for r in records]
    
    async def get_recovery_status(self, patient_id: str, proc_id: Optional[str] = None) -> List[Dict]:
        """Get procedure recovery status with abnormal monitors."""
        async with self.driver.session() as session:
            query = """
                MATCH (p:Patient {patient_id: $patient_id})-[:HAS_RECOVERY_PLAN]->(rt:RecoveryTrajectory)
            """
            if proc_id:
                query += " MATCH (rt)<-[:HAS_RECOVERY_TRAJECTORY]-(pr:Procedure {proc_id: $proc_id})"
            else:
                query += " MATCH (rt)<-[:HAS_RECOVERY_TRAJECTORY]-(pr:Procedure)"
            
            query += """
                OPTIONAL MATCH (rt)-[:HAS_PHASE]->(ph:RecoveryPhase)
                OPTIONAL MATCH (rt)-[:REQUIRES_ABNORMAL_MONITORING]->(am:AbnormalMonitor)
                
                RETURN {
                    procedure: pr.name,
                    expected_discharge: rt.expected_discharge,
                    contingency: rt.contingency_plan,
                    phases: collect(DISTINCT {
                        name: ph.phase_name,
                        duration: ph.duration,
                        vitals: ph.vitals_target,
                        is_synthetic: true
                    }),
                    abnormal_monitors: collect(DISTINCT {
                        parameter: am.parameter,
                        threshold: am.threshold,
                        indicates: am.indicates,
                        action: am.action,
                        is_synthetic: true
                    })
                } as recovery
            """
            
            result = await session.run(query, patient_id=patient_id, proc_id=proc_id)
            records = await result.data()
            return [r["recovery"] for r in records]
    
    async def get_correlated_findings(self, patient_id: str, entity_name: str) -> List[Dict]:
        """Get all synthetic correlations for a specific entity."""
        async with self.driver.session() as session:
            result = await session.run("""
                MATCH (p:Patient {patient_id: $patient_id})-[:HAS_CORRELATION]->(c:CrossCorrelation)
                WHERE c.entity_a_name CONTAINS $entity_name OR c.entity_b_name CONTAINS $entity_name
                RETURN {
                    entity_a: c.entity_a_name,
                    entity_b: c.entity_b_name,
                    type: c.correlation_type,
                    direction: c.direction,
                    reasoning: c.reasoning,
                    action: c.action,
                    confidence: c.confidence,
                    is_synthetic: true
                } as correlation
                ORDER BY c.confidence DESC
            """, patient_id=patient_id, entity_name=entity_name)
            records = await result.data()
            return [r["correlation"] for r in records]