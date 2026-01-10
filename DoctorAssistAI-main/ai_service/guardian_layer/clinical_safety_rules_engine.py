import json
import re
import os
from groq import Groq
from fastapi import HTTPException

groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))

# -------------------------------
# SYSTEM PROMPT (GUARDRAIL MODE)
# -------------------------------

SAFETY_VERIFIER_SYSTEM_PROMPT = """
You are a Clinical Safety Verification Engine operating as a guardrail.

Your role is to VERIFY and FLAG safety-relevant content
in the provided clinical analysis output.

YOU MUST:
- Verify the presence of safety-relevant facts or claims
- Flag threshold violations, contradictions, or red-flag mentions
- Use ONLY information explicitly present in the inputs

STRICT PROHIBITIONS:
- Do NOT diagnose any condition
- Do NOT infer etiology or causality
- Do NOT suggest likelihood, risk, or severity
- Do NOT recommend actions or treatments
- Do NOT reinterpret or summarize clinically
- Do NOT add new medical knowledge

OUTPUT RULES:
- Output ONLY valid JSON
- Each finding must be factual and referential
- Use neutral, verification-style language
"""

# -------------------------------
# JSON EXTRACTION
# -------------------------------

def _safe_json_extract(text: str):
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError("No JSON object found in LLM output")
    return json.loads(match.group())

# -------------------------------
# MAIN VERIFIER
# -------------------------------

async def run_clinical_safety_rules_engine(
    llm_output_text: str,
    raw_patient_data: dict,
    output_categories: list
) -> dict:
    """
    POST-LLM Clinical Safety Rules Engine (Guardrail Layer)

    Inputs:
    - llm_output_text: text produced by common / feature LLM
    - raw_patient_data: original structured patient data
    - output_categories: fixed safety categories
    """

    user_prompt = f"""
RAW PATIENT DATA
----------------
{json.dumps(raw_patient_data, indent=2)}

LLM OUTPUT TO VERIFY
-------------------
{llm_output_text}

VERIFICATION TASKS
------------------
Perform SAFETY VERIFICATION ONLY.

1. Lab Value Threshold Flags
   - Flag laboratory values that are explicitly outside reference ranges

2. Dosing Range Flags
   - Flag medication doses that are explicitly outside documented ranges

3. Contradiction Checks
   - Flag logical inconsistencies between demographic data, conditions, or statements

4. Red Flag Mentions
   - Flag mentions of clinically notable safety-related events or findings

IMPORTANT:
- Do NOT explain causes
- Do NOT assess severity
- Do NOT infer diagnoses
- Do NOT restate full clinical narratives

OUTPUT FORMAT (STRICT)
---------------------
Return ONE JSON object with ONLY the following keys:

{json.dumps(output_categories, indent=2)}

Rules:
- Each key maps to an ARRAY OF STRINGS
- Each string must be a factual verification or flag
- If no flags exist, return an empty array
"""

    response = groq_client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[
            {"role": "system", "content": SAFETY_VERIFIER_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt}
        ],
        temperature=0.0
    )

    raw_output = response.choices[0].message.content.strip()

    try:
        parsed = _safe_json_extract(raw_output)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Clinical safety verifier returned invalid JSON: {str(e)}"
        )

    # Enforce deterministic structure
    return {
        category: parsed.get(category, [])
        for category in output_categories
    }
