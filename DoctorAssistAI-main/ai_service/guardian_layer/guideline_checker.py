import json
from typing import Dict, Any, Optional


# ============================================================
# Internal Groq Adapter
# ============================================================

class _GroqLLMAdapter:
    """
    Internal Groq adapter enforcing a stable .generate() interface.
    """

    def __init__(self, groq_client, model: str = "llama-3.1-8b-instant"):
        self.client = groq_client
        self.model = model

    def generate(self, prompt: str, temperature: float = 0.0) -> str:
        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a strict clinical guideline compliance auditor. "
                        "Return ONLY valid JSON. "
                        "Do NOT give medical advice. "
                        "Do NOT infer specialty or diagnosis."
                    )
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            temperature=temperature,
        )
        return response.choices[0].message.content.strip()


# ============================================================
# Dynamic Guideline Alignment Layer
# ============================================================

class DynamicGuidelineAlignmentLayer:
    """
    Guardian Layer 4

    Guideline compliance auditor with externally supplied condition.

    - Specialty selection is DETERMINISTIC (not inferred)
    - LLM only audits consistency
    - FAIL only on true guideline contradictions
    """

    LAYER_NAME = "LAYER_4_DYNAMIC_GUIDELINE_ALIGNMENT"

    GUIDELINE_AUTHORITIES = {
        "nephrology": {
            "authority": "KDIGO",
            "scope": "Kidney disease and nephrology"
        },
        "pediatrics": {
            "authority": "AAP",
            "scope": "Pediatric populations"
        },
        "diabetes": {
            "authority": "ADA",
            "scope": "Diabetes care"
        },
        "cardiology": {
            "authority": "ACC/AHA",
            "scope": "Cardiovascular medicine"
        },
        "oncology": {
            "authority": "NCCN, ASCO",
            "scope": "Cancer treatment and management"
        },
        "general": {
            "authority": "WHO",
            "scope": "General clinical guidance"
        }
    }

    def __init__(self, llm_client):
        self.llm = _GroqLLMAdapter(llm_client)

    # --------------------------------------------------------
    # Prompt Builder
    # --------------------------------------------------------

    def _build_prompt(
        self,
        condition: str,
        clinical_output: Dict[str, Any]
    ) -> str:
        authority = self.GUIDELINE_AUTHORITIES[condition]["authority"]
        scope = self.GUIDELINE_AUTHORITIES[condition]["scope"]

        return f"""
You are a clinical guideline compliance auditor.

The applicable clinical scope has ALREADY been determined.

Condition / Specialty:
{condition}

Guideline Authority:
{authority}

Guideline Scope:
{scope}

Your task:
- Evaluate whether the AI clinical response is CONSISTENT with
  high-level principles of the stated guideline authority.

Rules:
- DO NOT give medical advice
- DO NOT recommend treatments or management
- DO NOT invent missing data
- DO NOT penalize absence of recommendations
- If the response is purely observational or analytical,
  return verdict = "WARN"
- Only return verdict = "FAIL" if there is a CLEAR contradiction
  to well-established guideline principles

AI CLINICAL RESPONSE:
{json.dumps(clinical_output, indent=2)}

Return ONLY valid JSON:

{{
  "identified_specialty": "{condition}",
  "guideline_authority": "{authority}",
  "verdict": "PASS | WARN | FAIL",
  "confidence": 0-1,
  "aligned_points": [string],
  "missing_points": [string],
  "deviations": [string]
}}
""".strip()

    # --------------------------------------------------------
    # Core Execution
    # --------------------------------------------------------

    def run(
        self,
        condition: str = "general",
        clinical_output: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:

        if not clinical_output:
            return self._fail_closed(
                reason="EMPTY_CLINICAL_OUTPUT",
                raw_output=None
            )

        if condition not in self.GUIDELINE_AUTHORITIES:
            condition = "general"

        prompt = self._build_prompt(condition, clinical_output)

        try:
            raw_response = self.llm.generate(prompt, temperature=0.0)
        except Exception as e:
            return self._fail_closed(
                reason="GUIDELINE_LLM_CALL_FAILED",
                raw_output=str(e)
            )

        if not raw_response or "{" not in raw_response:
            return self._fail_closed(
                reason="EMPTY_OR_NON_JSON_GUIDELINE_OUTPUT",
                raw_output=raw_response
            )

        # ----------------------------------------------------
        # Strict JSON Parsing
        # ----------------------------------------------------
        try:
            parsed = json.loads(raw_response)
        except json.JSONDecodeError:
            return self._fail_closed(
                reason="INVALID_JSON_FROM_GUIDELINE_AUDITOR",
                raw_output=raw_response
            )

        # ----------------------------------------------------
        # Contract Enforcement
        # ----------------------------------------------------
        if not self._is_valid_contract(parsed):
            return self._fail_closed(
                reason="INVALID_GUIDELINE_CONTRACT",
                raw_output=parsed
            )

        return {
            "layer": self.LAYER_NAME,
            "status": "PASS",
            "result": parsed
        }

    # --------------------------------------------------------
    # Contract Validation
    # --------------------------------------------------------

    def _is_valid_contract(self, data: Dict[str, Any]) -> bool:
        required_keys = {
            "identified_specialty",
            "guideline_authority",
            "verdict",
            "confidence",
            "aligned_points",
            "missing_points",
            "deviations"
        }

        if not required_keys.issubset(data.keys()):
            return False

        if data["verdict"] not in {"PASS", "WARN", "FAIL"}:
            return False

        if not isinstance(data["confidence"], (int, float)):
            return False

        if not (0.0 <= data["confidence"] <= 1.0):
            return False

        for key in ["aligned_points", "missing_points", "deviations"]:
            if not isinstance(data[key], list):
                return False

        return True

    # --------------------------------------------------------
    # Fail Closed
    # --------------------------------------------------------

    def _fail_closed(self, reason: str, raw_output: Any) -> Dict[str, Any]:
        return {
            "layer": self.LAYER_NAME,
            "status": "FAIL",
            "reason": reason,
            "fallback_result": {
                "identified_specialty": "general",
                "guideline_authority": "WHO",
                "verdict": "FAIL",
                "confidence": 0.0,
                "aligned_points": [],
                "missing_points": ["Unable to verify guideline compliance"],
                "deviations": [reason]
            },
            "raw_output": raw_output
        }
