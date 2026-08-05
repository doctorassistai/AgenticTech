import json
from typing import List, Dict
import os
from groq import GroqClient

groq_client = GroqClient(api_key=os.getenv("GROQ_API_KEY"))



api_key = os.getenv("GROQ_API_KEY")


DEFAULT_INTENTS = [
    "symptom_discussion",
    "lab_report_explanation",
    "medication_information",
    "lifestyle_advice",
    "administrative",
    "emergency_indicator",
    "non_medical",
    "unknown"
]


class LLMIntentClassifier:
    def __init__(
        self,
        llm_client,
        model: str = "llama-3.1-8b-instant",
        intents: List[str] = None,
        confidence_threshold: float = 0.7,
    ):
        self.llm_client = llm_client
        self.model = model
        self.intents = intents or DEFAULT_INTENTS
        self.confidence_threshold = confidence_threshold

        self.system_prompt = self._build_system_prompt()

    def _build_system_prompt(self) -> str:
        intents_list = "\n".join([f"- {i}" for i in self.intents])

        return f"""
You are an intent classification engine.

Your task is to classify the user's input into exactly ONE intent.

Allowed intents:
{intents_list}

Rules:
- Respond ONLY with valid JSON.
- Do NOT explain.
- Do NOT add extra fields.
- Do NOT add new intents.
- If unsure, choose "unknown".
- If the input suggests a medical emergency, choose "emergency_indicator".

JSON format:
{{
  "intent": "<one allowed intent>",
  "confidence": <number between 0 and 1>
}}
""".strip()

    def classify(self, user_text: str) -> Dict:
        try:
            response = self.llm_client.chat.completions.create(
                model=self.model,
                temperature=0,
                max_tokens=150,
                messages=[
                    {"role": "system", "content": self.system_prompt},
                    {"role": "user", "content": user_text},
                ],
            )

            raw = response.choices[0].message.content
            data = json.loads(raw)

            # Hard validation
            if (
                "intent" not in data
                or "confidence" not in data
                or data["intent"] not in self.intents
                or not isinstance(data["confidence"], (int, float))
            ):
                raise ValueError("Invalid LLM response")

            if data["confidence"] < self.confidence_threshold:
                data["intent"] = "unknown"

            return {
                "intent": data["intent"],
                "confidence": round(float(data["confidence"]), 3),
            }

        except Exception:
            # FAIL SAFE
            return {
                "intent": "unknown",
                "confidence": 0.0,
            }


# Usage Example:

# classifier = LLMIntentClassifier(
#     llm_client=groq_client,
#     model="llama-3.1-8b-instant"
# )

# result = classifier.classify(
#     "I have chest pain and feel dizzy"
# )