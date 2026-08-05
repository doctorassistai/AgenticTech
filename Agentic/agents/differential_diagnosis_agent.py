"""
Differential Diagnosis Agent
Generates comprehensive differential diagnoses with explicit clinical reasoning chains
"""

from typing import Dict, Any
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage
from loguru import logger
import json
import sys
sys.path.append('/tmp')
from Agentic.core.context_builder import build_differential_diagnosis_context


class DifferentialDiagnosisAgent:
    """
    Master diagnostician generating comprehensive differential diagnoses
    
    Key improvements over original:
    1. Uses hierarchical context (not raw JSON dumps)
    2. Requires explicit clinical reasoning chains
    3. Uses few-shot examples instead of 50+ rules
    4. No word limits - full clinical reasoning allowed
    5. Bayesian reasoning structure
    """
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
    
    async def analyze(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Generate differential diagnoses with clinical reasoning"""
        
        logger.info("🔍 Differential Diagnosis Agent: Starting analysis")
        
        try:
            # Build optimized context
            context = build_differential_diagnosis_context(state)
            logger.info(f"differcontext: {context}")

            consultation = state.get("consultation_text", "")
            logger.info(f"differconsult: {consultation}")
            # Get previous iteration context if available
            previous_diagnosis = state.get("differential_diagnosis")
            iteration_context = ""
            if previous_diagnosis and state.get("reanalysis_reason"):
                iteration_context = f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 RE-ANALYSIS REQUESTED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Reason: {state.get("reanalysis_reason")}

Previous Assessment:
{json.dumps(previous_diagnosis.get("most_likely_diagnoses", [])[:2], indent=2)}

Please reconsider your differential diagnosis in light of this new information.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
            
            # Construct prompt
            prompt = self._build_prompt(context, consultation, iteration_context)
            
            # Call LLM
            response = self.llm.invoke([
                SystemMessage(content=self._get_system_message()),
                HumanMessage(content=prompt)
            ])
            
            # Parse response
            result = self._parse_response(response.content)
            
            # Store in state
            state["differential_diagnosis"] = result
            state["confidence_scores"]["differential_diagnosis"] = result.get(
                "overall_diagnostic_confidence", 0.0
            )
            
            # Add warnings for must-not-miss diagnoses
            self._add_warnings(state, result)
            
            logger.info("✅ Differential Diagnosis Agent: Analysis complete")
            return state
            
        except Exception as e:
            logger.error(f"❌ Differential Diagnosis Agent failed: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            state["error"] = f"Differential diagnosis generation failed: {str(e)}"
            return state
    
    def _get_system_message(self) -> str:
        """System message defining agent role"""
        return """You are a master diagnostician with decades of experience preventing diagnostic errors.

Your expertise:
- Pattern recognition across thousands of cases
- Bayesian reasoning (pre-test probability → post-test probability)
- Identifying cognitive biases (anchoring, availability, confirmation bias)
- Remembering zebras when hoofbeats have stripes
- Structured clinical reasoning using problem representation

Your output must show your reasoning process explicitly - not just conclusions."""
    
    def _build_prompt(self, context: str, consultation: str, iteration_context: str) -> str:
        """Build the main prompt with examples"""
        
        return f"""
{context}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CURRENT CONSULTATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{consultation}

{iteration_context}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR TASK: CLINICAL REASONING FOR DIFFERENTIAL DIAGNOSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Think like an experienced clinician. Show your work.

STEP 1: PROBLEM REPRESENTATION
Synthesize this case into a one-liner (the "mental model"):
"[Age]-year-old [gender] with [key risk factors/PMH] presenting with [chief symptom] 
characterized by [key features] over [timeline], associated with [pertinent positives], 
notable for absence of [pertinent negatives]"

STEP 2: SEMANTIC QUALIFIERS
- Acuity: Acute (<24hr) | Subacute (days-weeks) | Chronic (months-years)
- Trajectory: Improving | Stable | Worsening | Fluctuating
- Severity: Mild | Moderate | Severe | Life-threatening
- Key discriminating features that narrow the differential

STEP 3: CLINICAL REASONING CHAIN
Walk through your thinking:
1. "I notice [observation] which makes me think [interpretation]"
2. "This could be [hypothesis] because [supporting evidence]"
3. "However, I'm also concerned about [alternative] because [reasoning]"
4. "To differentiate, I would look for [discriminating features] or order [key test]"

STEP 4: BAYESIAN REASONING FOR TOP DIAGNOSES
For each leading diagnosis:
- Pre-test probability (based on epidemiology, risk factors, pattern): X%
- Key supporting evidence: [list with impact on probability]
- Key contradicting evidence: [list with impact on probability]
- Post-test probability estimate: Y%

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXAMPLE OUTPUT (Learn from this structure)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Example Case: 45-year-old man with sudden severe headache, photophobia, and neck stiffness.

{{
  "clinical_reasoning": {{
    "problem_representation": "45-year-old previously healthy male presenting with sudden-onset ('thunderclap') severe headache reaching maximal intensity within seconds, associated with photophobia, neck stiffness, and nausea, without focal neurological deficits or altered consciousness",
    
    "semantic_qualifiers": {{
      "acuity": "acute",
      "acuity_reasoning": "Sudden onset within seconds to minutes, which is crucial - gradual onset would favor other diagnoses",
      "trajectory": "stable_but_severe",
      "severity": "severe",
      "key_discriminators": [
        "Thunderclap onset (reached max intensity in <1 minute) - this is THE key feature",
        "Meningismus without fever - suggests meningeal irritation from blood rather than infection",
        "No focal neuro deficits - suggests subarachnoid rather than intraparenchymal process",
        "Previously healthy - no chronic headache history that might suggest migraine"
      ]
    }},
    
    "reasoning_chain": [
      {{
        "step": 1,
        "observation": "The sudden thunderclap onset is the critical clinical feature",
        "interpretation": "Thunderclap headache has a limited differential and must rule out life-threatening causes",
        "hypothesis": "Primary concern is subarachnoid hemorrhage (SAH), must also consider cerebral venous thrombosis, cervical artery dissection, and reversible cerebral vasoconstriction syndrome",
        "confidence": 0.9
      }},
      {{
        "step": 2,
        "observation": "Patient has meningismus (neck stiffness, photophobia) WITHOUT fever",
        "interpretation": "Meningeal irritation is present, but afebrile presentation makes bacterial meningitis less likely",
        "hypothesis": "Blood in subarachnoid space causing chemical meningismus is most likely. SAH probability increases to ~70-80%",
        "confidence": 0.85
      }},
      {{
        "step": 3,
        "observation": "No focal neurological deficits, no altered consciousness",
        "interpretation": "Absence of focal deficits makes large intraparenchymal hemorrhage or ischemic stroke less likely",
        "hypothesis": "Still favors SAH over other intracranial processes. However, SAH can present without focal deficits.",
        "confidence": 0.8
      }},
      {{
        "step": 4,
        "observation": "Need to consider pre-test probability and what tests will help",
        "interpretation": "Ottawa SAH rule: if thunderclap headache + age ≥40 OR neck pain/stiffness OR witnessed LOC → investigate for SAH",
        "hypothesis": "Patient meets criteria. Next step: non-contrast CT head STAT (sens ~95% if <6hrs from onset). If negative, LP for xanthochromia.",
        "confidence": 0.9
      }}
    ]
  }},
  
  "must_not_miss_diagnoses": [
    {{
      "diagnosis": "Subarachnoid hemorrhage from ruptured cerebral aneurysm",
      "probability": 75,
      "severity": "life_threatening",
      "reasoning": "Thunderclap onset is classic for SAH. ~85% of SAH presents with sudden severe headache. Aneurysmal SAH mortality ~50% if untreated, with high re-rupture risk in first 24 hours.",
      "key_features_present": [
        "Thunderclap onset (most specific feature - present in >80% of SAH)",
        "Worst headache of life",
        "Meningismus without fever (blood irritating meninges)",
        "Nausea/vomiting (increased ICP)"
      ],
      "key_features_absent": [
        "Loss of consciousness (absent in ~50% of SAH, so doesn't rule out)",
        "Focal neurological deficits (absent in uncomplicated SAH without mass effect)"
      ],
      "recommended_rule_out_tests": [
        "STAT non-contrast CT head (95% sensitive if <6 hours from onset)",
        "If CT negative: LP after 6-12 hours from symptom onset (check for xanthochromia and RBC count)",
        "If SAH confirmed: CT angiography to identify aneurysm source"
      ],
      "urgency": "immediate",
      "clinical_reasoning": "This is a neurosurgical emergency. The pattern is pathognomonic enough that I would order imaging before even completing full workup. Time to aneurysm securing directly impacts outcomes."
    }},
    {{
      "diagnosis": "Cervical artery (carotid or vertebral) dissection",
      "probability": 15,
      "severity": "life_threatening",
      "reasoning": "Can present with thunderclap headache. ~20% of dissections present with headache as initial symptom. Risk of stroke is ~20% in first few days if untreated.",
      "key_features_present": [
        "Sudden severe headache"
      ],
      "key_features_absent": [
        "Neck pain (often present in dissection)",
        "Horner syndrome (present in ~50% of carotid dissections)",
        "Focal neurological deficits (may develop later if stroke occurs)"
      ],
      "recommended_rule_out_tests": [
        "CT angiography neck if SAH ruled out",
        "MRI/MRA if high suspicion and CTA unavailable"
      ],
      "urgency": "urgent",
      "clinical_reasoning": "Less likely than SAH given absence of neck pain and typical risk factors (trauma, recent chiropractic manipulation, connective tissue disease), but thunderclap onset keeps this in differential. Would rule out after SAH excluded."
    }}
  ],
  
  "most_likely_diagnoses": [
    {{
      "diagnosis": "Aneurysmal subarachnoid hemorrhage",
      "probability": 75,
      "confidence": "high",
      "bayesian_reasoning": {{
        "pre_test_probability": 60,
        "pre_test_reasoning": "Base rate for SAH in thunderclap headache is ~10-25% in ED populations. However, this patient has multiple high-risk features: age 45 (peak incidence 40-60), sudden onset, meningismus. Ottawa SAH rule positive. This raises pre-test to ~60%.",
        "supporting_evidence": [
          {{
            "finding": "Thunderclap onset",
            "impact_on_probability": "+40%",
            "reasoning": "Positive LR ~7-10 for SAH. Most specific symptom. Present in 80-85% of SAH patients."
          }},
          {{
            "finding": "Meningismus without fever",
            "impact_on_probability": "+10%",
            "reasoning": "Positive LR ~3-4. Blood in CSF causing chemical irritation. Helps distinguish from infection."
          }},
          {{
            "finding": "Age 45",
            "impact_on_probability": "+5%",
            "reasoning": "Peak age for aneurysmal SAH. Incidence increases sharply after age 40."
          }}
        ],
        "contradicting_evidence": [
          {{
            "finding": "No loss of consciousness",
            "impact_on_probability": "-5%",
            "reasoning": "LOC occurs in ~50% of SAH, but absence doesn't rule out. Small hemorrhages may not cause LOC."
          }},
          {{
            "finding": "No focal deficits",
            "impact_on_probability": "neutral",
            "reasoning": "Expected in uncomplicated SAH without mass effect or hydrocephalus. Doesn't lower probability."
          }}
        ],
        "post_test_probability": 75,
        "post_test_reasoning": "Strong positive evidence (thunderclap, meningismus) with no major contradicting features. Clinical picture is highly consistent with SAH. Estimated post-test probability ~75%. CT scan is critical next step."
      }},
      "supporting_evidence": [
        "Thunderclap headache (pathognomonic)",
        "Neck stiffness + photophobia (meningismus)",
        "Sudden maximal intensity",
        "Age 45 (peak SAH age)",
        "Previously healthy (no chronic headache pattern)"
      ],
      "contradicting_evidence": [
        "No witnessed LOC (but present in only ~50% of cases)",
        "No known risk factors documented (but 85% of aneurysms are sporadic)"
      ],
      "diagnostic_criteria_met": "Ottawa SAH Rule: Thunderclap headache + age ≥40 years → investigate",
      "next_steps_to_confirm": [
        "STAT non-contrast CT head (first-line, 95% sensitive if done <6 hours)",
        "LP if CT negative and symptom onset >6 hours (check xanthochromia, RBC count)",
        "CTA head/neck if SAH confirmed (identify aneurysm)"
      ]
    }},
    {{
      "diagnosis": "Reversible cerebral vasoconstriction syndrome (RCVS)",
      "probability": 10,
      "confidence": "moderate",
      "bayesian_reasoning": {{
        "pre_test_probability": 5,
        "pre_test_reasoning": "RCVS accounts for ~5-10% of thunderclap headaches in ED populations. More common in women (2:1). Often triggered by vasoactive substances.",
        "supporting_evidence": [
          {{
            "finding": "Thunderclap onset",
            "impact_on_probability": "+15%",
            "reasoning": "Thunderclap is characteristic of RCVS - typically recurrent over days to weeks. May be first episode."
          }}
        ],
        "contradicting_evidence": [
          {{
            "finding": "Presence of meningismus",
            "impact_on_probability": "-5%",
            "reasoning": "Meningismus is less typical for RCVS unless there's associated SAH (can occur in RCVS). Makes RCVS less likely as primary diagnosis."
          }},
          {{
            "finding": "No mention of triggers",
            "impact_on_probability": "-5%",
            "reasoning": "RCVS often triggered by sexual activity, exertion, Valsalva, vasoactive drugs, or postpartum state. Absence of triggers lowers probability slightly."
          }}
        ],
        "post_test_probability": 10,
        "post_test_reasoning": "Thunderclap onset fits, but meningismus and absence of typical triggers make this less likely than SAH. Would be reconsidered if CT/LP negative for SAH."
      }},
      "supporting_evidence": [
        "Thunderclap headache",
        "Age and gender demographics",
        "Could be first of recurrent thunderclap episodes"
      ],
      "contradicting_evidence": [
        "Meningismus (less typical for RCVS)",
        "No documented triggers (sexual activity, exertion, drugs, postpartum)",
        "No prior episodes (RCVS typically has multiple thunderclaps over 1-3 weeks)"
      ],
      "next_steps_to_confirm": [
        "Diagnosis of exclusion after SAH ruled out",
        "MRA or CTA showing reversible vasoconstriction (may need repeat imaging to show resolution)",
        "History of recurrent thunderclap headaches over subsequent days-weeks"
      ]
    }}
  ],
  
  "unlikely_but_considered": [
    {{
      "diagnosis": "Primary thunderclap headache (benign)",
      "probability": 5,
      "why_unlikely": "This is a diagnosis of exclusion only after all dangerous causes ruled out. Never diagnose this on first presentation without complete workup. Would require negative CT, negative LP, negative vascular imaging.",
      "what_would_make_more_likely": "Complete workup (CT, LP, CTA/MRA) negative. Resolution of headache. No recurrence. No new symptoms. But still requires careful consideration and possibly repeat imaging."
    }}
  ],
  
  "diagnostic_strategy": {{
    "recommended_investigation_sequence": [
      {{
        "step": 1,
        "test_or_action": "STAT non-contrast CT head",
        "rationale": "First-line test for SAH. 95% sensitive if performed within 6 hours of symptom onset. Fast, widely available, non-invasive. Sensitivity decreases with time (drops to ~50% by 1 week).",
        "expected_impact_on_differential": "If positive: confirms SAH, proceed to CTA for aneurysm. If negative: need LP to rule out SAH if symptom onset >6 hours ago."
      }},
      {{
        "step": 2,
        "test_or_action": "Lumbar puncture (if CT negative AND >6 hours from symptom onset)",
        "rationale": "CT negative doesn't fully exclude SAH (especially if delayed presentation). LP has higher sensitivity for small bleeds. Look for xanthochromia (peak sensitivity at 12 hours from onset) and persistent RBCs across tubes. Xanthochromia is pathognomonic for SAH.",
        "expected_impact_on_differential": "If LP shows xanthochromia or persistent RBCs: SAH confirmed. If normal: significantly lowers SAH probability, raises RCVS/primary thunderclap into differential."
      }},
      {{
        "step": 3,
        "test_or_action": "CT angiography head and neck",
        "rationale": "If SAH confirmed: identify aneurysm source for treatment planning. If CT/LP negative: evaluate for arterial dissection or RCVS (look for beading of vessels).",
        "expected_impact_on_differential": "If aneurysm found: confirms aneurysmal SAH, neurosurgery consult for coiling/clipping. If dissection found: confirms diagnosis, start anticoagulation/antiplatelet. If beading: suggests RCVS."
      }}
    ],
    "urgent_investigations": [
      "STAT non-contrast CT head - must be done within minutes of arrival"
    ],
    "can_wait_for_outpatient": [
      "None - thunderclap headache requires complete emergency workup"
    ]
  }},
  
  "diagnostic_uncertainty_factors": [
    "Cannot fully exclude SAH without CT + LP combination if CT negative",
    "RCVS and SAH can coexist (~10% of RCVS patients have associated SAH)",
    "Time from symptom onset affects CT sensitivity - need to know exact timing",
    "Quality of LP interpretation requires experienced operator and proper timing"
  ],
  
  "red_flags_for_reconsidering": [
    "If patient develops focal neurological deficits → suggests mass effect from hematoma or hydrocephalus",
    "If fever develops → reconsider infectious meningitis despite thunderclap onset",
    "If headache resolves completely and quickly → might suggest migraine, but still need full workup first time",
    "If recurrent thunderclap episodes over days → strongly suggests RCVS"
  ],
  
  "cognitive_biases_avoided": [
    "Anchoring bias: Didn't anchor on 'severe headache = migraine' just because migraines are common",
    "Availability bias: Didn't dismiss SAH just because it's rare - remembered that thunderclap onset is pathognomonic",
    "Premature closure: Included must-not-miss diagnoses even with strong SAH suspicion",
    "Zebra retreat: Considered rare diagnoses (RCVS) appropriate to clinical context"
  ],
  
  "overall_diagnostic_confidence": 0.85,
  "confidence_reasoning": "Clinical picture is highly consistent with SAH. Thunderclap onset is a strong discriminator with high positive likelihood ratio. Meningismus without fever further supports SAH over alternatives. However, cannot be definitive without imaging - 15% uncertainty reflects the ~10-20% chance this could be RCVS, dissection, or other cause. Confidence will increase to >95% with positive CT or LP findings.",
  
  "requires_specialist_input": true,
  "recommended_specialist": "Neurosurgery (if SAH confirmed) or Neurology (for other thunderclap causes)"
}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NOW ANALYZE THE ACTUAL PATIENT ABOVE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Use the same structure and depth of reasoning shown in the example.

CRITICAL REQUIREMENTS:
✓ Show your clinical reasoning explicitly (don't just list conclusions)
✓ Use Bayesian reasoning with actual probability estimates
✓ Explain why you're considering each diagnosis
✓ Identify discriminating features that help differentiate diagnoses
✓ Always include must-not-miss diagnoses even if probability is low
✓ Provide specific next-step recommendations
✓ Use complete clinical sentences - NO word limits
✓ Think like a doctor would think - show your mental process

OUTPUT: Return ONLY valid JSON matching the structure above. No markdown, no explanations outside JSON.
"""
    
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
            logger.warning(f"⚠️ Differential Diagnosis JSON parse failed: {e}")
            logger.warning(f"Raw content: {content[:500]}...")
            return {
                "raw_content": content[:1000],
                "overall_diagnostic_confidence": 0.5,
                "clinical_reasoning": {
                    "problem_representation": "Parse failed",
                    "reasoning_chain": []
                }
            }
    
    def _add_warnings(self, state: Dict[str, Any], result: Dict[str, Any]):
        """Add warnings to state based on diagnosis results"""

        must_not_miss = result.get("must_not_miss_diagnoses", [])

        for diagnosis in must_not_miss:
            probability_raw = diagnosis.get("probability", 0)

            # Normalize probability safely
            try:
                if isinstance(probability_raw, str):
                    probability_raw = probability_raw.replace("%", "").strip()
                probability = float(probability_raw)

                # Normalize 0–100 → 0–1 if needed
                if probability > 1:
                    probability /= 100

            except (TypeError, ValueError):
                probability = 0.0

            if diagnosis.get("urgency") == "immediate" and probability >= 0.05:
                state["warnings"].append(
                    f"🚨 MUST-NOT-MISS: {diagnosis.get('diagnosis')} "
                    f"(P≈{probability:.0%}) - "
                    f"{diagnosis.get('reasoning', '')[:100]}"
                )

        # Flag if specialist needed
        if result.get("requires_specialist_input"):
            specialist = result.get("recommended_specialist")
            if specialist:
                state["warnings"].append(
                    f"🔔 Specialist consultation recommended: {specialist}"
                )
                state["requires_review"] = True

        # Flag low diagnostic confidence
        try:
            confidence = float(result.get("overall_diagnostic_confidence", 0))
        except (TypeError, ValueError):
            confidence = 0.0

        if confidence < 0.6:
            state["warnings"].append(
                f"⚠️ LOW DIAGNOSTIC CONFIDENCE ({confidence:.2f}) - Consider additional workup"
            )
            state["requires_review"] = True
