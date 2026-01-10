import json
import re
from groq import Groq
from typing import List, Dict, Any


class FactualityConfidenceScorer:
    """
    LLM-based scorer for:
    - Factuality (groundedness to provided data)
    - Linguistic confidence (assertiveness & internal consistency)

    IMPORTANT:
    - This scorer evaluates TEXT QUALITY ONLY
    - It does NOT assess clinical correctness or medical certainty
    """

    SYSTEM_PROMPT = """
You are a clinical text quality evaluation engine.

You evaluate analytical medical text for:
1. FACTUALITY (grounding to provided data)
2. CONFIDENCE (linguistic clarity and assertiveness)

STRICT RULES:
- You MUST NOT judge medical correctness
- You MUST NOT introduce new facts
- You MUST NOT interpret clinical meaning
- You MUST ONLY evaluate how well the text matches the provided data

SCORING DEFINITIONS:

FACTUALITY SCORE (0.0–1.0):
- 1.0 → Every statement is explicitly grounded in provided data
- 0.5 → Partial grounding, some generic statements
- 0.0 → Mostly ungrounded or generic text

CONFIDENCE SCORE (0.0–1.0):
- Measures linguistic confidence ONLY
- High score = clear, declarative, internally consistent
- Low score = excessive hedging, vague phrasing, fragmentation

You MUST return STRICT JSON only.
No explanations.
"""

    USER_PROMPT_TEMPLATE = """
DATA PROVIDED
-------------
{data_fetched}

MODEL OUTPUT TEXT
-----------------
{output_text}

TASK
----
Evaluate the MODEL OUTPUT TEXT using ONLY the DATA PROVIDED.

Return a JSON object with EXACTLY these keys:

{{
  "factuality_score": <float between 0 and 1>,
  "confidence_score": <float between 0 and 1>
}}

Rules:
- Scores must be decimals (e.g., 0.82)
- Do NOT add extra keys
- Do NOT add text outside JSON
"""

    def __init__(self, groq_api_key: str, model: str = "llama-3.1-8b-instant"):
        self.client = Groq(api_key=groq_api_key)
        self.model = model

    def _safe_json_extract(self, text: str) -> Dict[str, float]:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            raise ValueError("No JSON object returned by scorer LLM")
        return json.loads(match.group())

    async def score(
        self,
        data_fetched: List[Dict[str, Any]],
        output_texts: List[str]
    ) -> Dict[str, float]:
        """
        Returns:
        {
          "factuality_score": float,
          "confidence_score": float
        }
        """

        if not output_texts:
            return {
                "factuality_score": 0.0,
                "confidence_score": 0.0
            }

        combined_output = "\n".join(output_texts)

        user_prompt = self.USER_PROMPT_TEMPLATE.format(
            data_fetched=json.dumps(data_fetched, indent=2),
            output_text=combined_output
        )

        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": self.SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.0
        )

        raw_output = response.choices[0].message.content.strip()

        try:
            scores = self._safe_json_extract(raw_output)

            factuality = float(scores.get("factuality_score", 0.0))
            confidence = float(scores.get("confidence_score", 0.0))

            # Hard safety clamp
            return {
                "factuality_score": round(min(max(factuality, 0.0), 1.0), 2),
                "confidence_score": round(min(max(confidence, 0.0), 1.0), 2),
            }

        except Exception:
            # Fail-safe (never break feature execution)
            return {
                "factuality_score": 0.0,
                "confidence_score": 0.0
            }


# Example usage:

# from ai_service.quality.factuality_confidence_scorer import FactualityConfidenceScorer
# quality_scorer = FactualityConfidenceScorer(
#     groq_api_key=api_key
# )

# if structured_mode:
#     all_texts = []
#     for v in data_output.values():
#         all_texts.extend(v)
# else:
#     all_texts = [data_output["analysis_text"]]

# quality_scores = await quality_scorer.score(
#     data_fetched=data_fetched,
#     output_texts=all_texts
# )