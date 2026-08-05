"""
Prompt builder for medical document analysis.
Used by Celery background tasks and FastAPI.
"""

from typing import Literal


# --------------------------------------------------
# Public API
# --------------------------------------------------
def build_medical_prompt(
    document_type: str,
    extracted_text: str
) -> str:
    """
    Entry point to build LLM prompt based on document type.
    """

    document_type = (document_type or "").lower()

    if document_type == "lab_report":
        return _lab_report_prompt(extracted_text)

    elif document_type == "bio_marker":
        return _biomarker_prompt(extracted_text)

    elif document_type in {"ct_scan", "mri", "ultrasound"}:
        return _radiology_prompt(extracted_text, document_type)

    else:
        return _generic_medical_prompt(extracted_text)


# --------------------------------------------------
# LAB REPORT PROMPT
# --------------------------------------------------
def _lab_report_prompt(extracted_text: str) -> str:
    return f"""
[INST] <<SYS>>
You are an expert medical AI assistant with deep knowledge of clinical medicine,
diagnostic criteria, and WHO/ICD standards.

Analyze the following LABORATORY REPORT and return structured medical insights.

========================
CRITICAL FLAG RULES
========================
- Always parse numeric values for test results and reference ranges.
- Compare test value numerically with reference range.
- Assign flags strictly as:
    "high"   → value > upper limit
    "low"    → value < lower limit
    "normal" → value within range
- Reference ranges may appear as:
    • min-max (e.g., 150-169)
    • ≤value (e.g., ≤7.0)
    • ≥value (e.g., ≥4.0)
- Handle all formats numerically.
- ONLY allowed flags: high, low, normal

========================
OUTPUT FORMAT (STRICT)
========================
Return ONLY valid JSON:

{{
  "structured_data": [
    {{
      "test_name": "test name",
      "value": "value",
      "unit": "unit",
      "reference_range": "reference range",
      "flag": "high|low|normal"
    }}
  ],
  "medical_insights": {{
    "summary": "medical summary",
    "key_findings": [],
    "recommendations": [],
    "risk_factors": [],
    "follow_up_required": true,
    "urgency_level": "routine|urgent|critical"
  }},
  "conditions": [
    {{
      "condition_name": "",
      "description": "",
      "severity": "low|medium|high|critical",
      "confidence": 0,
      "who_code": "",
      "icd_code": "",
      "indicators": [],
      "values_supporting": [],
      "recommendation": "",
      "progression_notes": "",
      "requires_immediate_attention": false
    }}
  ]
}}

========================
MEDICAL DOCUMENT
========================
{extracted_text}

<</SYS>>
[/INST]
""".strip()


# --------------------------------------------------
# BIOMARKER PROMPT
# --------------------------------------------------
def _biomarker_prompt(extracted_text: str) -> str:
    return f"""
[INST] <<SYS>>
You are an expert medical AI assistant specialized in biomarkers,
oncology, genetics, and diagnostic medicine.

Analyze the BIOMARKER REPORT and extract structured data.

RULES:
- Each biomarker must be a separate object
- Fields must be EXACTLY:
  test_name, value, unit, reference_range, flag
- Allowed flags: Normal, High, Low, Critical, Abnormal
- Use empty string "" for missing fields

Return ONLY valid JSON with this structure:

{{
  "structured_data": [
    {{
      "test_name": "",
      "value": "",
      "unit": "",
      "reference_range": "",
      "flag": ""
    }}
  ],
  "medical_insights": {{
    "summary": "",
    "key_findings": [],
    "recommendations": [],
    "risk_factors": [],
    "follow_up_required": true,
    "urgency_level": "routine|urgent|critical"
  }},
  "conditions": [ ]
}}

========================
MEDICAL DOCUMENT
========================
{extracted_text}

<</SYS>>
[/INST]
""".strip()


# --------------------------------------------------
# RADIOLOGY PROMPT
# --------------------------------------------------
def _radiology_prompt(extracted_text: str, modality: str) -> str:
    return f"""
[INST] <<SYS>>
You are an expert radiology AI assistant.

Analyze the following {modality.upper()} REPORT.

Focus on:
- Anatomical findings
- Measurements
- Abnormalities
- Clinical significance
- Urgency assessment

Return ONLY valid JSON.

========================
MEDICAL DOCUMENT
========================
{extracted_text}

<</SYS>>
[/INST]
""".strip()


# --------------------------------------------------
# GENERIC MEDICAL PROMPT
# --------------------------------------------------
def _generic_medical_prompt(extracted_text: str) -> str:
    return f"""
[INST] <<SYS>>
You are an expert medical AI assistant.

Analyze the following medical document and return structured insights.

Return ONLY valid JSON.

========================
MEDICAL DOCUMENT
========================
{extracted_text}

<</SYS>>
[/INST]
""".strip()
