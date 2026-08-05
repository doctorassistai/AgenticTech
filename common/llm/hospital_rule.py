import json
import logging
import re
from typing import Dict, Any
from groq import Groq

logger = logging.getLogger(__name__)

groq_client = Groq(
    api_key=os.getenv("GROQ_API_KEY")
)

MODEL_FAST = "llama-3.1-8b-instant"


# ─────────────────────────────────────────────
# OCR CLEANING
# ─────────────────────────────────────────────

_OCR_FIXES = [
    (r"\|", "I"),
    (r"'€", "c"),
    (r"\bNe\b", "No"),
    (r"(?<=[a-z])_(?=[a-z])", " "),
    (r"[ \t]{2,}", " "),
    (r"(\w)-\n(\w)", r"\1\2"),
]


def clean_ocr_text(text: str) -> str:
    for pattern, replacement in _OCR_FIXES:
        try:
            text = re.sub(pattern, replacement, text)
        except re.error:
            pass

    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# ─────────────────────────────────────────────
# SAFE JSON PARSER
# ─────────────────────────────────────────────

def safe_parse_llm_json(raw: str) -> Dict[str, Any]:
    raw = re.sub(r"```(?:json)?", "", raw).strip()

    start = raw.find("{")
    end = raw.rfind("}")

    if start == -1 or end == -1:
        raise ValueError("No valid JSON found in LLM output")

    json_str = raw[start:end + 1]

    json_str = re.sub(r",\s*}", "}", json_str)
    json_str = re.sub(r",\s*]", "]", json_str)

    json_str = "".join(
        c for c in json_str if ord(c) >= 32 or c in "\n\t"
    )

    return json.loads(json_str)


# ─────────────────────────────────────────────
# MAIN FUNCTION
# ─────────────────────────────────────────────

def run_thomas(
    *,
    text: str,
    category: str,
    subcategory: str
) -> Dict[str, Any]:

    clean_text = clean_ocr_text(text)

    # ─────────────────────────
    # STEP 1 — EXTRACTION (PROMPT-DRIVEN)
    # ─────────────────────────

    extraction_prompt = f"""
You are a hospital-grade medical document extraction engine.

DOCUMENT CATEGORY: {category}
DOCUMENT SUBCATEGORY: {subcategory}

MISSION:
Extract EVERY medical finding present in the document.
Nothing should be missed.

══════════════════════════════════════
STRICT EXTRACTION RULES
══════════════════════════════════════

1. If it is written in the document and medically meaningful,
   it MUST be extracted.

2. Copy the FULL phrase exactly as written.
   Do NOT shorten.
   Do NOT summarize.
   Do NOT simplify.

3. If a percentage appears in a sentence,
   copy the complete phrase containing it.

4. If multiple findings appear in one sentence separated by commas,
   extract EACH separately.

5. Scan ALL sections including:
   - Clinical Data
   - Findings
   - Impression
   - Diagnosis
   - Microscopy
   - Gross
   - Radiology subsections
   - Tables
   - Percentages
   - Enumerations

6. Every test key MUST be unique.
   If repeated, append anatomical location or context.

7. Do NOT infer.
   Do NOT interpret.
   Do NOT calculate.
   Do NOT create values.

8. STATUS RULE:
   Use ONLY explicit wording in document.

   "abnormal" if document explicitly states:
   present, positive, identified, enlarged, suppressed,
   increased, malignant, invasive, metabolically active

   "normal" if document explicitly states:
   not identified, negative, absent, no evidence of,
   appears normal

   Otherwise use:
   "not_applicable"
9. DO NOT repeat identical findings.
   If the same sentence appears multiple times,
   extract it only once per case ID.
══════════════════════════════════════
OUTPUT FORMAT (STRICT)
══════════════════════════════════════

Return ONLY valid JSON.
No markdown.
No explanation.
No extra text.

{{
  "structured_data": {{
    "Unique Test Name WITH Context": {{
      "value": "exact full phrase from document",
      "status": "normal | abnormal | not_applicable",
      "reason": "exact section source"
    }}
  }}
}}

If nothing found:
{{
  "structured_data": {{}}
}}

══════════════════════════════════════
DOCUMENT:
{clean_text}
"""

    try:
        completion = groq_client.chat.completions.create(
            model=MODEL_FAST,
            messages=[{"role": "user", "content": extraction_prompt}],
            temperature=0,
            max_tokens=4000,
        )

        raw = completion.choices[0].message.content.strip()
        logger.info(f"thomas raw: {raw}")

        parsed = safe_parse_llm_json(raw)
        structured_data = parsed.get("structured_data", {})

        if not isinstance(structured_data, dict):
            structured_data = {}

    except Exception as e:
        logger.error(f"Extraction failed: {e}", exc_info=True)
        return {
            "structured_data": {},
            "clinical_abstract": "Extraction failed."
        }

    # ─────────────────────────
    # STEP 2 — ABSTRACT (PROMPT-DRIVEN)
    # ─────────────────────────

    if not structured_data:
        return {
            "structured_data": {},
            "clinical_abstract": "No significant structured findings detected."
        }

    findings_text = "\n".join(
        f"{test_name}: {data.get('value', '')}"
        for test_name, data in structured_data.items()
        if isinstance(data, dict)
    )

    abstract_prompt = f"""
You are a senior clinician.

Write a concise professional clinical summary (maximum 80 words).

Use ONLY the extracted findings below.
Do NOT add new information.
Do NOT interpret beyond what is written.

CATEGORY: {category}
SUBCATEGORY: {subcategory}

FINDINGS:
{findings_text}
"""

    try:
        completion = groq_client.chat.completions.create(
            model=MODEL_FAST,
            messages=[{"role": "user", "content": abstract_prompt}],
            temperature=0,
            max_tokens=200,
        )

        clinical_abstract = completion.choices[0].message.content.strip()

    except Exception as e:
        logger.error(f"Abstract generation failed: {e}", exc_info=True)
        clinical_abstract = "Clinical summary unavailable."

    return {
        "structured_data": structured_data,
        "clinical_abstract": clinical_abstract
    }