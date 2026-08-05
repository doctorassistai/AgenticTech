"""
Enhanced medical response parsers and validators.
Robust against markdown, partial JSON, and LLM formatting.
SAFE for FastAPI and Celery usage.
"""

import json
import logging
import re
from typing import Dict, Any, List

logger = logging.getLogger(__name__)


# -------------------------------------------------
# MAIN PARSER
# -------------------------------------------------
def parse_enhanced_medical_response(
    response: str,
    document_type: str
) -> Dict[str, Any]:
    """
    Parse enhanced medical analysis response from LLM.
    Handles markdown, multiple JSON blocks, and extra text.
    """

    try:
        cleaned_text = _strip_markdown(response)

        structured_data = _extract_json_block(
            cleaned_text, "structured_data", default=[]
        )
        medical_insights = _extract_json_block(
            cleaned_text, "medical_insights", default={}
        )
        conditions = _extract_json_block(
            cleaned_text, "conditions", default=[]
        )

        result = {
            "structured_data": structured_data,
            "medical_insights": medical_insights,
            "conditions": conditions,
        }

        # -------------------------
        # VALIDATE STRUCTURED DATA
        # -------------------------
        if document_type == "lab_report":
            result["structured_data"] = validate_lab_structured_data(
                result["structured_data"]
            )
        elif document_type == "bio_marker":
            result["structured_data"] = validate_biomarker_structured_data(
                result["structured_data"]
            )
        else:
            result["structured_data"] = validate_generic_structured_data(
                result["structured_data"]
            )

        # -------------------------
        # ENHANCE CONDITIONS
        # -------------------------
        result["conditions"] = enhance_condition_codes(
            result["conditions"]
        )

        # If nothing useful parsed → fallback
        if not result["structured_data"] and not result["medical_insights"]:
            return create_fallback_analysis(response, document_type)

        return result

    except Exception:
        logger.exception("Enhanced parser failed")
        return create_fallback_analysis(response, document_type)


# -------------------------------------------------
# MARKDOWN / JSON HELPERS
# -------------------------------------------------
def _strip_markdown(text: str) -> str:
    """
    Remove markdown fences and system prompts.
    """
    text = re.sub(r"```json", "", text, flags=re.IGNORECASE)
    text = re.sub(r"```", "", text)
    text = re.sub(r"\[INST\][\s\S]*?\<\/SYS\>\>", "", text)
    return text.strip()


def _extract_json_block(text: str, key: str, default):
    """
    Extract JSON array or object following `"key":`
    """
    try:
        pattern = rf'"{key}"\s*:\s*(\[[\s\S]*?\]|\{{[\s\S]*?\}})'
        match = re.search(pattern, text)

        if not match:
            return default

        return json.loads(match.group(1))

    except Exception as e:
        logger.warning(f"Failed parsing {key}: {e}")
        return default


# -------------------------------------------------
# STRUCTURED DATA VALIDATORS
# -------------------------------------------------
def validate_generic_structured_data(
    data: List[Dict]
) -> List[Dict]:
    validated = []

    for item in data:
        validated.append({
            "field_name": item.get("field_name", "unknown_field"),
            "field_label": item.get("field_label", "Unknown Field"),
            "field_value": item.get("field_value", ""),
            "field_type": item.get("field_type", "text"),
            "clinical_significance": item.get("clinical_significance", "normal"),
        })

    return validated


def validate_lab_structured_data(
    data: List[Dict]
) -> List[Dict]:
    validated = []

    for item in data:
        validated.append({
            "test_name": item.get("test_name", "Unknown Test"),
            "value": item.get("value", ""),
            "unit": item.get("unit", ""),
            "reference_range": item.get("reference_range", ""),
            "flag": item.get("flag", ""),
        })

    return validated


def validate_biomarker_structured_data(
    data: List[Dict]
) -> List[Dict]:
    return validate_lab_structured_data(data)


# -------------------------------------------------
# CONDITION ENRICHMENT
# -------------------------------------------------
def enhance_condition_codes(
    conditions: List[Dict]
) -> List[Dict]:
    condition_codes = {
        "diabetes": {"icd_code": "E11", "who_code": "DM-TYPE2"},
        "hypertension": {"icd_code": "I10", "who_code": "HTN-ESS"},
        "anemia": {"icd_code": "D64.9", "who_code": "ANEMIA-NOS"},
        "hyperlipidemia": {"icd_code": "E78.5", "who_code": "DYSLIP"},
        "kidney": {"icd_code": "N18", "who_code": "CKD"},
        "coronary": {"icd_code": "I25", "who_code": "CAD"},
        "atrial": {"icd_code": "I48", "who_code": "AFIB"},
        "pneumonia": {"icd_code": "J18", "who_code": "PNEUM"},
        "ovarian": {"icd_code": "C56", "who_code": "OVARIAN-CA"},
        "cancer": {"icd_code": "C80", "who_code": "MALIGNANCY"},
    }

    enhanced = []

    for condition in conditions:
        name = condition.get("condition_name", "").lower()

        for key, codes in condition_codes.items():
            if key in name:
                condition.update(codes)
                break

        if not condition.get("severity"):
            condition["severity"] = assess_condition_severity(condition)

        condition["requires_immediate_attention"] = (
            condition["severity"] in ["high", "critical"]
        )

        enhanced.append(condition)

    return enhanced


def assess_condition_severity(condition: Dict) -> str:
    description = condition.get("description", "").lower()
    indicators = " ".join(condition.get("indicators", [])).lower()
    values = condition.get("values_supporting", [])

    if any(k in description for k in ["critical", "severe", "aggressive"]):
        return "critical"

    if any(k in indicators for k in ["p53", "high-grade", "loss"]):
        return "high"

    for v in values:
        if any(k in str(v).lower() for k in ["very high", "very low", "critical"]):
            return "high"

    return "medium"


# -------------------------------------------------
# FALLBACK
# -------------------------------------------------
def create_fallback_analysis(
    response: str,
    document_type: str
) -> Dict[str, Any]:
    return {
        "structured_data": [
            {
                "field_name": "raw_analysis",
                "field_label": "AI Analysis",
                "field_value": (
                    response[:1000] + "..."
                    if len(response) > 1000 else response
                ),
                "field_type": "textarea",
                "clinical_significance": "normal",
            }
        ],
        "medical_insights": {
            "summary": "Automated analysis completed. Please review raw output.",
            "key_findings": ["Analysis available in structured data"],
            "recommendations": ["Manual review recommended"],
            "risk_factors": [],
            "follow_up_required": True,
            "urgency_level": "routine",
        },
        "conditions": [],
    }
