"""
Clinical Report Data Agentic Workflow
-------------------------------------

Purpose:
    Process the text that handwritten_task.py has already extracted from an
    uploaded medical document.

This file contains ONLY the new clinical-report-data workflow:
    1. classify the uploaded report
    2. extract structured laboratory OR diagnostic information
    3. validate the extraction against the source text
    4. persist the result in MongoDB
    5. expose Clinical Report Data read endpoints

Architecture:
    handwritten_task.py
            |
            | document_text
            v
    /clinical-report/internal/process-report
            |
            v
    LangGraph
      classify_agent
            |
            +--> lab_extraction_agent
            |          |
            |          v
            |    validation_agent
            |
            +--> diagnostic_extraction_agent
                       |
                       v
                 validation_agent
            |
            v
        MongoDB

LLM policy:
    - Uses the same GROQ_API_KEY / Groq client pattern as the existing
      agentic workflow.
    - No new model provider is introduced here.
    - OpenRouter remains the existing document/Vision extraction path in
      handwritten_task.py. This workflow receives that already extracted text.
"""

from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, TypedDict

from fastapi import APIRouter, HTTPException
from groq import Groq
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel

from langgraph.graph import StateGraph, END


# =====================================================================
# CONFIG — same application MongoDB / Groq configuration pattern
# =====================================================================

MONGO_URI = os.getenv("MONGO_URI", "")
MONGO_DB = os.getenv("MONGO_DB", "doctorassistai")

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")

_client = AsyncIOMotorClient(MONGO_URI)
_db = _client[MONGO_DB]

clinical_report_data = _db["clinical_report_data"]
clinical_lab_results = _db["clinical_lab_results"]
clinical_diagnostic_reports = _db["clinical_diagnostic_reports"]

groq_client = Groq(api_key=GROQ_API_KEY)


router = APIRouter(
    prefix="/clinical-report",
    tags=["Clinical Report Data"],
)

# =====================================================================
# REQUEST MODELS
# =====================================================================

class ProcessClinicalReportRequest(BaseModel):
    patient_id: str
    doctor_id: Optional[str] = None
    appointment_id: Optional[str] = None
    document_id: Optional[str] = None
    filename: Optional[str] = None
    document_date: Optional[str] = None
    document_text: str


# =====================================================================
# LANGGRAPH STATE
# =====================================================================

class ClinicalReportState(TypedDict, total=False):
    patient_id: str
    doctor_id: Optional[str]
    appointment_id: Optional[str]
    document_id: str
    filename: Optional[str]
    document_date: Optional[str]
    document_text: str

    document_family: str
    document_type: str
    classification: Dict[str, Any]

    extracted_data: Dict[str, Any]
    validated_data: Dict[str, Any]
    clinical_intelligence: str

    error: Optional[str]


# =====================================================================
# GROQ HELPERS
# =====================================================================

def _strip_json_fence(value: str) -> str:
    value = (value or "").strip()

    if value.startswith("```"):
        value = re.sub(r"^```(?:json)?\s*", "", value, flags=re.IGNORECASE)
        value = re.sub(r"\s*```$", "", value)

    return value.strip()


def _groq_json(system_prompt: str, user_prompt: str) -> Dict[str, Any]:
    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY is not configured")

    response = groq_client.chat.completions.create(
        model=GROQ_MODEL,
        temperature=0.0,
        max_tokens=12000,
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": system_prompt,
            },
            {
                "role": "user",
                "content": user_prompt,
            },
        ],
    )

    content = response.choices[0].message.content or "{}"
    return json.loads(_strip_json_fence(content))

def _groq_text(
    system_prompt: str,
    user_prompt: str,
) -> str:

    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY is not configured")

    response = groq_client.chat.completions.create(
        model=GROQ_MODEL,
        temperature=0.0,
        max_tokens=3200,
        messages=[
            {
                "role": "system",
                "content": system_prompt,
            },
            {
                "role": "user",
                "content": user_prompt,
            },
        ],
    )

    return (
        response.choices[0]
        .message
        .content
        or ""
    ).strip()
# =====================================================================
# AGENT 1 — DOCUMENT CLASSIFICATION
# =====================================================================

CLASSIFICATION_SYSTEM = """
You are the Clinical Report Classification Agent.

Classify ONE uploaded medical document using only the supplied document
text.

Return JSON only:

{
  "document_family": "lab | diagnostic | other",
  "document_type": "specific report type as supported by the source",
  "confidence": 0.0,
  "evidence": "short source-supported evidence"
}

SEMANTIC RULES:

1. Determine the document family from the actual content of the source
   document.

2. Determine the most specific document type that the source supports.

3. Do not depend on the filename alone.

4. Do not use a predefined list of report types.

5. Do not infer a document type from a single isolated word.

6. The classification must be based on the overall semantic content of
   the document.

7. A report containing primarily structured laboratory measurements may
   be classified as lab.

8. A report containing primarily diagnostic observations, imaging
   interpretation, pathology, histology, cytology, or equivalent
   diagnostic information may be classified as diagnostic.

9. If the source does not provide enough evidence to determine the
   family, use other.

10. Do not invent a document type.

11. Preserve source evidence supporting the classification.
"""

def classify_agent(state: ClinicalReportState) -> ClinicalReportState:
    try:
        result = _groq_json(
            CLASSIFICATION_SYSTEM,
            (
                "DOCUMENT FILENAME:\n"
                f"{state.get('filename') or 'unknown'}\n\n"
                "DOCUMENT TEXT:\n"
                f"{state['document_text']}"
            ),
        )

        family = str(result.get("document_family") or "other").lower().strip()
        document_type = str(
            result.get("document_type") or "unknown"
        ).strip()

        if family not in {"lab", "diagnostic", "other"}:
            family = "other"

        return {
            **state,
            "document_family": family,
            "document_type": document_type,
            "classification": result,
        }

    except Exception as exc:
        logger.exception("Clinical report classification failed")
        return {
            **state,
            "error": f"classification_failed: {exc}",
        }


# =====================================================================
# AGENT 2A — LAB EXTRACTION
# =====================================================================

LAB_EXTRACTION_SYSTEM = """
You are the Clinical Laboratory Extraction Agent.

Extract EVERY laboratory result explicitly present in the source document.

Return JSON only using this structure:

{
  "document_date": null,
  "assessment": [
    {
      "field_name": "exact laboratory field/test name",
      "value": "exact reported value",
      "unit": "exact reported unit or null",
      "reference_range": "exact reported reference range or null",

      "reference_status": {
        "status": "normal | abnormal | unknown",
        "basis": "brief source-supported explanation"
      },

      "abnormality": {
        "present": true,
        "description": "source-supported abnormality description",
        "evidence": "source evidence"
      },

      "evidence": "source evidence for the complete result"
    }
  ],

  "findings": [],
  "abnormalities": [],
  "impression": null
}

SEMANTIC RULES:

1. Create exactly one assessment object for every distinct laboratory
   result reported in the source document.

2. Preserve the exact test/field name, reported value, unit and reference
   range.

3. Determine reference_status ONLY from the relationship between the
   reported value and an explicitly supplied reference range or an
   explicit source statement about its current status.

4. If the source does not provide enough information to determine the
   current reference status, use:
      "status": "unknown"

5. Do NOT infer a current abnormality from a longitudinal comparison.

6. Longitudinal change and current reference-range status are separate
   concepts.

7. If the report explicitly compares the current value with a previous
   value, preserve that comparison under trend.

8. If no longitudinal comparison is explicitly present, use:
      "direction": "unknown"
      "comparison": null

9. An abnormality must remain associated with the laboratory field that
   produced it.

10. Never return an anonymous abnormality such as:
      "Low"
      "High"
      "Abnormal"

    without associating it with the corresponding field_name.

11. If an abnormality is supported by the source, place the corresponding
    information inside that field's "abnormality" object.

12. Do not diagnose a disease from a laboratory result.

13. Do not infer an abnormality from medical knowledge when the source
    does not support it.

14. Do not drop normal results.

15. Never invent a missing value, unit, reference range, trend,
    abnormality or interpretation.

16. If the source explicitly contains a laboratory impression or
    conclusion, preserve it.

17. Do not convert the laboratory result into a diagnosis.

18. Every clinical statement must remain traceable to source evidence.
"""

def lab_extraction_agent(state: ClinicalReportState) -> ClinicalReportState:
    if state.get("document_family") != "lab":
        return state

    if state.get("error"):
        return state

    try:
        extracted = _groq_json(
            LAB_EXTRACTION_SYSTEM,
            (
                f"DOCUMENT TYPE: {state.get('document_type')}\n"
                f"DOCUMENT DATE: {state.get('document_date')}\n\n"
                "SOURCE DOCUMENT:\n"
                f"{state['document_text']}"
            ),
        )

        return {
            **state,
            "extracted_data": extracted,
        }

    except Exception as exc:
        logger.exception("Laboratory extraction failed")
        return {
            **state,
            "error": f"lab_extraction_failed: {exc}",
        }


# =====================================================================
# AGENT 2B — DIAGNOSTIC / RADIOLOGY / PATHOLOGY EXTRACTION
# =====================================================================

DIAGNOSTIC_EXTRACTION_SYSTEM = """
You are the Clinical Diagnostic Report Extraction Agent.

Extract the clinically relevant information explicitly stated in the
source document.

This agent handles any diagnostic, imaging, pathology, biopsy,
histopathology, cytology, laboratory-adjacent diagnostic, or other
clinical report without relying on a predefined document-type list.

Return JSON only:

{
  "document_date": null,

  "assessment": null,

  "findings": [
    {
      "name": "source-supported finding name",
      "value": "source-supported finding value or description",
      "status": "positive | negative | normal | present | absent | unknown",
      "evidence": "source evidence"
    }
  ],

  "abnormalities": [
    {
      "name": "source-supported abnormality name",
      "value": "source-supported abnormality value or description",
      "status": "positive | present | abnormal",
      "evidence": "source evidence"
    }
  ],

  "impression": null,

  "diagnosis": [
    {
      "name": "explicit diagnosis name",
      "value": "exact source-supported diagnosis",
      "status": "explicit",
      "evidence": "source evidence"
    }
  ],

  "recommendations": [],

  "measurements": [
    {
      "name": "measurement name",
      "value": "reported measurement",
      "unit": "reported unit or null",
      "context": "source-supported context or null",
      "evidence": "source evidence"
    }
  ],

  "markers": [
    {
      "name": "explicit biological/clinical marker name",
      "value": "reported marker value/status",
      "unit": "reported unit or null",
      "status": "reported status or null",
      "evidence": "source evidence"
    }
  ]
}

SEMANTIC RULES:

1. Extract information from the source document itself.

2. Do not use a predefined list of findings, diagnoses, measurements,
   markers, diseases, cancer types or report sections.

3. A diagnosis belongs in diagnosis[] ONLY when the source explicitly
   states it as a diagnosis, histologic diagnosis, pathologic diagnosis,
   clinical diagnosis, provisional diagnosis, final diagnosis, or an
   equivalent explicit diagnostic conclusion.

4. Do not manufacture a diagnosis by interpreting findings.

5. Findings represent statements made by the report about what was
   observed, identified, absent, or not identified.

6. Abnormalities represent source-supported abnormal findings.

7. Negative statements remain findings with a negative/absent status.
   They must not be converted into abnormalities.

8. Measurements represent quantitative measurements reported by the
   source, including dimensions, quantities, values with units, scores,
   indices, uptake measurements, or other explicitly measured quantities.

9. Markers represent biological or clinical marker information when the
   source explicitly treats the information as a marker or marker status.

10. Do not classify an item as a marker merely because it is numeric.

11. If an item is a measurement, keep it in measurements[] and do not
    duplicate it in markers[].

12. Each extracted fact should have one primary semantic category.

13. Do not duplicate the same fact across measurements[] and markers[]
    unless the source itself explicitly presents it as two semantically
    distinct pieces of information.

14. Preserve the exact value and unit from the source.

15. Preserve explicit impression/conclusion text.

16. Preserve explicit diagnosis text.

17. Preserve explicit recommendations.

18. Preserve negative findings when clinically relevant.

19. Never infer a diagnosis, staging, response, metastasis, biomarker
    status, or disease status that the source does not explicitly support.

20. If a section is absent, return null or [].

21. Every clinical statement must be traceable to source evidence.

When multiple statements in the source document refer to the same
clinical finding, determine the final source-supported status using
the complete document context.

Prefer the statement that represents the final, definitive,
amended, or otherwise resolved result within the source document.

Do not expose intermediate or superseded statements as separate
final findings when the document itself establishes a final result.

The final output must represent the clinically applicable result
supported by the source document.

Do not use external medical knowledge to resolve the result.

Do not infer a result that is not supported by the source document.

Preserve the source evidence supporting the final result.
"""

def diagnostic_extraction_agent(
    state: ClinicalReportState,
) -> ClinicalReportState:

    if state.get("document_family") != "diagnostic":
        return state

    if state.get("error"):
        return state

    try:
        extracted = _groq_json(
            DIAGNOSTIC_EXTRACTION_SYSTEM,
            (
                f"DOCUMENT TYPE: {state.get('document_type')}\n"
                f"DOCUMENT DATE: {state.get('document_date')}\n\n"
                "SOURCE DOCUMENT:\n"
                f"{state['document_text']}"
            ),
        )

        return {
            **state,
            "extracted_data": extracted,
        }

    except Exception as exc:
        logger.exception("Diagnostic extraction failed")
        return {
            **state,
            "error": f"diagnostic_extraction_failed: {exc}",
        }


# =====================================================================
# AGENT 3 — VALIDATION
# =====================================================================

VALIDATION_SYSTEM = """
You are the Clinical Report Validation Agent.

Your task is to validate EXTRACTED_DATA against SOURCE_DOCUMENT and
return a corrected version of the extracted data.

The SOURCE_DOCUMENT is authoritative.

Return JSON only.

CORE PRINCIPLE:

Do not merely check whether individual words exist.

Validate the semantic relationship between each extracted fact and the
source document.

GENERAL RULES:

1. Every clinical value must be directly supported by the source.

2. Remove information that is invented, inferred without source support,
   or unsupported.

3. Recover information that is explicitly present in the source but was
   missed by extraction.

4. Preserve exact reported values, units, measurements and relevant
   source wording.

5. Never invent diagnoses.

6. Never infer a diagnosis from a finding.

7. Never convert a negative finding into an abnormality.

8. Preserve explicit negative findings.

9. Preserve explicit impressions and conclusions.

10. Preserve explicit recommendations.

LABORATORY SEMANTICS:

11. Every laboratory result must remain associated with its field_name.

12. An abnormality may never exist as an anonymous value such as
    "High", "Low" or "Abnormal".

13. If a laboratory result has an abnormality, that abnormality must
    remain inside the corresponding laboratory assessment object.

14. Current reference-range status and longitudinal trend are separate
    concepts.

15. Validate current reference status only from the current value and
    explicitly supplied reference information or explicit source wording.

16. A longitudinal increase or decrease does not automatically mean the
    current value is abnormal.

17. Preserve an explicit longitudinal comparison separately under trend.

18. If no trend is stated, do not create one.

DIAGNOSTIC SEMANTICS:

19. An explicit diagnosis stated by the source must be represented in
    diagnosis[].

20. Do not create a diagnosis merely because a finding sounds diagnostic.

21. Findings and abnormalities must retain their relationship to the
    corresponding source statement.

22. Negative or absent statements remain negative/absent findings.

23. Measurements are quantitative source-reported measurements.

24. A numeric value is NOT automatically a marker.

25. A measurement must not be moved to markers merely because it is
    numeric.

26. If the same source fact appears in both measurements[] and markers[]
    only because of an extraction mistake, retain it in the semantically
    correct category and remove the duplicate.

27. Markers should contain marker information only when the source itself
    presents the information as such.

28. Do not invent marker status or marker results.

29. Preserve explicit pathology/histology diagnoses in diagnosis[].

30. Preserve explicit biomarker/marker information separately from
    measurements when the source explicitly distinguishes it.

SCHEMA INTEGRITY:

31. Preserve the expected JSON structure.

32. Do not collapse structured objects into plain strings when the schema
    provides fields for their meaning.

33. Do not create anonymous arrays of clinical facts when those facts can
    be associated with a field, finding, measurement, diagnosis or marker.

34. Do not add information from general medical knowledge.

35. Source evidence takes precedence over model assumptions.

36. If information is uncertain or absent, use null, [], or an appropriate
    unknown state rather than guessing.

When multiple source statements refer to the same clinical finding,
evaluate the complete source context and retain the final
source-supported result.

If the source itself establishes that one statement is final,
definitive, amended, corrected, or supersedes another statement,
return the final source-supported result only.

Do not expose superseded intermediate statements as separate
final findings.

Do not resolve discrepancies using external medical knowledge.

Every retained final result must have supporting source evidence.
"""

def validation_agent(state: ClinicalReportState) -> ClinicalReportState:
    if state.get("error"):
        return state

    try:
        validated = _groq_json(
            VALIDATION_SYSTEM,
            (
                "SOURCE DOCUMENT:\n"
                f"{state['document_text']}\n\n"
                "EXTRACTED_DATA:\n"
                f"{json.dumps(state.get('extracted_data', {}), ensure_ascii=False)}"
            ),
        )

        return {
            **state,
            "validated_data": validated,
        }

    except Exception as exc:
        logger.exception("Clinical report validation failed")
        return {
            **state,
            "error": f"validation_failed: {exc}",
        }

# =====================================================================
# AGENT 4 — CLINICAL INTELLIGENCE / DOCTOR SUMMARY
# =====================================================================

CLINICAL_INTELLIGENCE_SYSTEM = """
You are a Clinical Intelligence Agent.

Your task is to generate ONE concise, doctor-facing clinical
interpretation paragraph from the validated clinical information
provided to you.

The input may originate from ANY type of medical report.

It may contain laboratory assessments, abnormal laboratory results,
diagnostic findings, imaging findings, pathology findings,
histopathology findings, immunohistochemistry findings, diagnoses,
measurements, markers, impressions, or other clinically relevant
information.

Do not assume a particular report type, disease, cancer type, organ,
patient population, or clinical specialty.

Your task is NOT to summarize the report.

Your task is to explain what the clinically important information
MEANS and what it MAY INDICATE clinically.

The paragraph should focus on the clinically meaningful abnormalities,
findings, diagnoses, assessments, measurements, markers, and/or
impressions contained in the validated data.

Explain their clinical significance rather than simply repeating them.

The interpretation may explain:
- what an abnormal finding indicates;
- what physiological or pathological state it may represent;
- why an important finding is clinically relevant;
- what the overall pattern of clinically important findings may
  indicate;
- what clinical correlation may be useful when the available
  information does not establish a definitive cause.

RULES:

- Return exactly ONE paragraph.
- Return plain text only.
- Do not return JSON.
- Do not return bullets.
- Do not create multiple sections.
- Do not create multiple fields.
- Do not repeat the report as a summary.
- Do not simply restate the values or findings.
- Do not list normal results unless they materially change the
  interpretation.
- Do not repeat measurements merely for the purpose of describing
  the report.
- Interpret clinically meaningful information instead of duplicating
  it.
- When multiple related abnormalities are present, synthesize their
  clinical significance into one coherent paragraph.
- Base every interpretation only on the validated clinical
  information provided.
- Do not introduce information that is not supported by the input.
- Do not infer a definitive diagnosis when the supplied information
  does not support one.
- Do not infer a specific underlying cause when the available
  information is insufficient.
- Preserve appropriate uncertainty.
- Do not infer cancer type, stage, recurrence, progression,
  metastasis, prognosis, or treatment response unless explicitly
  supported by the supplied information.
- Do not generate treatment recommendations.
- Do not generate longitudinal trends.
- Do not compare the current report with previous reports.
- Do not use external medical information that would require
  assumptions beyond the supplied clinical information.
- Do not use hardcoded report-specific rules.
- Do not use keyword-to-diagnosis mappings.
- Do not use predefined disease mappings.
- Do not use predefined cancer-specific logic.
- Do not use report-type-specific templates.
- Do not invent findings or diagnoses.
- Do not mention the extraction, validation, agent, AI, prompt, or
  source-processing process.

The output should be a short clinical interpretation that helps a
doctor understand the significance of the important information
already identified in the report.

If the supplied validated information does not contain enough
clinically meaningful information to provide a safe interpretation,
return one concise paragraph stating that no specific clinical
interpretation can be derived from the available information.

Return ONLY the single paragraph.
"""

def clinical_intelligence_agent(
    state: ClinicalReportState,
) -> ClinicalReportState:

    if state.get("error"):
        return state

    try:
        validated_data = state.get("validated_data") or {}

        if not validated_data:
            return {
                **state,
                "clinical_intelligence": "",
            }

        interpretation = _groq_text(
            CLINICAL_INTELLIGENCE_SYSTEM,
            (
                "VALIDATED CLINICAL INFORMATION:\n"
                f"{json.dumps(validated_data, ensure_ascii=False)}"
            ),
        )

        return {
            **state,
            "clinical_intelligence": interpretation,
        }

    except Exception as exc:
        logger.exception(
            "Clinical intelligence generation failed"
        )

        return {
            **state,
            "error": f"clinical_intelligence_failed: {exc}",
        }
# =====================================================================
# LANGGRAPH
# =====================================================================

def _route_after_classification(state: ClinicalReportState) -> str:
    if state.get("error"):
        return "end"

    family = state.get("document_family")

    if family == "lab":
        return "lab"

    if family == "diagnostic":
        return "diagnostic"

    return "end"


def build_clinical_report_graph():
    graph = StateGraph(ClinicalReportState)

    graph.add_node("classify_agent", classify_agent)
    graph.add_node("lab_extraction_agent", lab_extraction_agent)
    graph.add_node(
        "diagnostic_extraction_agent",
        diagnostic_extraction_agent,
    )
    graph.add_node("validation_agent", validation_agent)
    graph.add_node(
        "clinical_intelligence_agent",
        clinical_intelligence_agent,
    )

    graph.set_entry_point("classify_agent")

    graph.add_conditional_edges(
        "classify_agent",
        _route_after_classification,
        {
            "lab": "lab_extraction_agent",
            "diagnostic": "diagnostic_extraction_agent",
            "end": END,
        },
    )

    graph.add_edge(
        "lab_extraction_agent",
        "validation_agent",
    )

    graph.add_edge(
        "diagnostic_extraction_agent",
        "validation_agent",
    )

    graph.add_edge(
        "validation_agent",
        "clinical_intelligence_agent",
    )

    graph.add_edge(
        "clinical_intelligence_agent",
        END,
    )
    return graph.compile()


clinical_report_graph = build_clinical_report_graph()


# =====================================================================
# MONGODB PERSISTENCE
# =====================================================================

def normalize_validated_clinical_data(
    state: ClinicalReportState,
) -> Dict[str, Any]:
    """
    Structural normalization only.

    This function MUST NOT perform medical interpretation,
    document-type detection, keyword mapping, or clinical inference.

    The LLM agents are responsible for semantic extraction.
    This function only guarantees a predictable JSON structure.
    """

    data = state.get("validated_data") or {}

    if not isinstance(data, dict):
        return {}

    # ---------------------------------------------------------------
    # Ensure expected top-level containers exist
    # ---------------------------------------------------------------

    data.setdefault("document_date", state.get("document_date"))

    if state.get("document_family") == "lab":
        data.setdefault("assessment", [])
        data.setdefault("findings", [])
        data.setdefault("impression", None)

        # Laboratory abnormalities are owned by their corresponding
        # assessment item. Do not maintain a second anonymous abnormality list.
        data["abnormalities"] = []

        if not isinstance(data["assessment"], list):
            data["assessment"] = []

        normalized_assessment = []

        for item in data["assessment"]:
            if not isinstance(item, dict):
                continue

            item.setdefault("field_name", None)
            item.setdefault("value", None)
            item.setdefault("unit", None)
            item.setdefault("reference_range", None)

            item.setdefault(
                "reference_status",
                {
                    "status": "unknown",
                    "basis": None,
                },
            )



            item.setdefault(
                "abnormality",
                {
                    "present": False,
                    "description": None,
                    "evidence": None,
                },
            )

            item.setdefault("evidence", None)

            normalized_assessment.append(item)

        data["assessment"] = normalized_assessment

    elif state.get("document_family") == "diagnostic":
        data.setdefault("assessment", None)
        data.setdefault("findings", [])
        data.setdefault("abnormalities", [])
        data.setdefault("impression", None)
        data.setdefault("diagnosis", [])
        data.setdefault("recommendations", [])
        data.setdefault("measurements", [])
        data.setdefault("markers", [])

        for key in (
            "findings",
            "abnormalities",
            "diagnosis",
            "recommendations",
            "measurements",
            "markers",
        ):
            if not isinstance(data.get(key), list):
                data[key] = []

    return data

def _now() -> datetime:
    return datetime.now(timezone.utc)


async def persist_clinical_report(state: ClinicalReportState) -> None:
    document_id = state["document_id"]
    patient_id = state["patient_id"]
    family = state.get("document_family")
    document_type = state.get("document_type")
    data = state.get("validated_data") or {}
    report_date = data.get("document_date") or state.get("document_date")

    base_record = {
        "patient_id": patient_id,
        "doctor_id": state.get("doctor_id"),
        "appointment_id": state.get("appointment_id"),
        "document_id": document_id,
        "filename": state.get("filename"),
        "document_date": report_date,
        "document_family": family,
        "document_type": document_type,
        "classification": state.get("classification") or {},
        "data": data,
         "clinical_intelligence": (
            state.get("clinical_intelligence") or ""
        ),

        "updated_at": _now(),
    }

    # One master document record.
    await clinical_report_data.update_one(
        {
            "patient_id": patient_id,
            "document_id": document_id,
        },
        {
            "$set": base_record,
            "$setOnInsert": {
                "created_at": _now(),
            },
        },
        upsert=True,
    )

    if family == "lab":
        # Replace only this document's old rows so reprocessing is idempotent.
        await clinical_lab_results.delete_many(
            {
                "patient_id": patient_id,
                "document_id": document_id,
            }
        )

        rows = []

        for item in data.get("assessment") or []:
            if not isinstance(item, dict):
                continue

            field_name = str(item.get("field_name") or "").strip()
            if not field_name:
                continue

            rows.append(
                {
                    "record_id": str(uuid.uuid4()),
                    "patient_id": patient_id,
                    "doctor_id": state.get("doctor_id"),
                    "appointment_id": state.get("appointment_id"),
                    "document_id": document_id,
                    "filename": state.get("filename"),
                    "document_date": report_date,
                    "document_type": document_type,
                    "field_name": field_name,
                    "value": item.get("value"),
                    "unit": item.get("unit"),
                    "reference_range": item.get("reference_range"),
                    "reference_status": item.get("reference_status"),
                    "abnormality": item.get("abnormality"),
                    "evidence": item.get("evidence"),
                    "clinical_intelligence": (
                        state.get("clinical_intelligence") or {}
                    ),
                    "created_at": _now(),
                }
            )

        if rows:
            await clinical_lab_results.insert_many(rows)

    elif family == "diagnostic":
        await clinical_diagnostic_reports.update_one(
            {
                "patient_id": patient_id,
                "document_id": document_id,
            },
            {
                "$set": {
                    **base_record,
                    "assessment": data.get("assessment"),
                    "findings": data.get("findings") or [],
                    "abnormalities": data.get("abnormalities") or [],
                    "impression": data.get("impression"),
                    "diagnosis": data.get("diagnosis") or [],
                    "recommendations": data.get("recommendations") or [],
                    "measurements": data.get("measurements") or [],
                    "markers": data.get("markers") or [],
                    "source_sections": data.get("source_sections") or [],
                },
                "$setOnInsert": {
                    "created_at": _now(),
                },
            },
            upsert=True,
        )


# =====================================================================
# PIPELINE ENTRYPOINT
# =====================================================================

async def process_clinical_report(
    *,
    patient_id: str,
    doctor_id: Optional[str],
    appointment_id: Optional[str],
    document_id: Optional[str],
    filename: Optional[str],
    document_date: Optional[str],
    document_text: str,
) -> Dict[str, Any]:

    resolved_document_id = document_id or str(uuid.uuid4())

    initial_state: ClinicalReportState = {
        "patient_id": patient_id,
        "doctor_id": doctor_id,
        "appointment_id": appointment_id,
        "document_id": resolved_document_id,
        "filename": filename,
        "document_date": document_date,
        "document_text": document_text,
    }

    result = await clinical_report_graph.ainvoke(initial_state)

    if result.get("error"):
        raise RuntimeError(result["error"])

    if result.get("document_family") == "other":
        return {
            "status": "ignored",
            "document_id": resolved_document_id,
            "document_family": "other",
            "document_type": result.get("document_type"),
        }

    result["validated_data"] = normalize_validated_clinical_data(result)
    await persist_clinical_report(result)

    return {
        "status": "success",
        "document_id": resolved_document_id,
        "document_family": result.get("document_family"),
        "document_type": result.get("document_type"),
        "document_date": (
            result.get("validated_data") or {}
        ).get("document_date") or document_date,
    }


# =====================================================================
# INTERNAL TRIGGER ENDPOINT
# =====================================================================

@router.post("/internal/process-report")
async def process_report(request: ProcessClinicalReportRequest):
    if not request.patient_id:
        raise HTTPException(status_code=400, detail="patient_id is required")

    if not request.document_text.strip():
        raise HTTPException(status_code=400, detail="document_text is required")

    try:
        return await process_clinical_report(
            patient_id=request.patient_id,
            doctor_id=request.doctor_id,
            appointment_id=request.appointment_id,
            document_id=request.document_id,
            filename=request.filename,
            document_date=request.document_date,
            document_text=request.document_text,
        )
    except Exception as exc:
        logger.exception(
            "Clinical report workflow failed | patient_id={} | document_id={}",
            request.patient_id,
            request.document_id,
        )
        raise HTTPException(
            status_code=500,
            detail=f"Clinical report workflow failed: {exc}",
        )


# =====================================================================
# CLINICAL TIMELINE READ ENDPOINT
# =====================================================================

@router.get("/reports/{patient_id}/lab-radiology")
async def get_lab_radiology_data(patient_id: str):
    """
    Frontend-ready response.

    Lab:
        Dynamic columns = every field_name found across the patient's
        laboratory reports.

        Each row represents:
            (report_date, document_type, document_id)

    Diagnostic:
        Grouped by document_type and sorted by report date.
    """

    lab_items = await clinical_lab_results.find(
        {"patient_id": patient_id},
        {"_id": 0},
    ).sort(
        [
            ("document_date", 1),
            ("document_type", 1),
            ("document_id", 1),
        ]
    ).to_list(length=None)

    clinical_reports = await clinical_report_data.find(
        {
            "patient_id": patient_id,
            "document_family": "lab",
        },
        {
            "_id": 0,
            "document_id": 1,
            "clinical_intelligence": 1,
        },
    ).to_list(length=None)

    clinical_intelligence_by_document = {
        item["document_id"]: item.get(
            "clinical_intelligence",
            "",
        )
        for item in clinical_reports
        if item.get("document_id")
    }

    # ---------------------------------------------------------------
    # Dynamic laboratory columns
    # ---------------------------------------------------------------

    columns: List[str] = []
    seen_columns = set()

    for item in lab_items:
        field_name = item.get("field_name")

        if field_name and field_name not in seen_columns:
            seen_columns.add(field_name)
            columns.append(field_name)

    grouped_rows: Dict[str, Dict[str, Any]] = {}

    for item in lab_items:
        date_value = item.get("document_date") or "Unknown"
        document_type = item.get("document_type") or "Unknown"
        document_id = item.get("document_id") or ""

        row_key = (
            f"{date_value}||"
            f"{document_type}||"
            f"{document_id}"
        )

        row = grouped_rows.setdefault(
            row_key,
            {
                "date": date_value,
                "document_type": document_type,
                "document_id": document_id,
                "filename": item.get("filename"),
                "values": {},
                "abnormalities": [],

                "clinical_intelligence": (
                    clinical_intelligence_by_document.get(
                        document_id,
                        {}
                    )
                ),
            },
        )

        field_name = item.get("field_name")

        if field_name:
            row["values"][field_name] = {
                "value": item.get("value"),
                "unit": item.get("unit"),
                "reference_range": item.get("reference_range"),
                "reference_status": item.get("reference_status"),
                "abnormality": item.get("abnormality"),
            }

    

    lab_rows = []

    for row in grouped_rows.values():
        output_row = {
            "date": row["date"],
            "document_type": row["document_type"],
            "document_id": row["document_id"],
            "filename": row["filename"],
            "abnormalities": row["abnormalities"],

            "clinical_intelligence": row[
                "clinical_intelligence"
            ],
        }

        for column in columns:
            output_row[column] = row["values"].get(
                column,
                {
                    "value": None,
                    "unit": None,
                    "reference_range": None,
                    "reference_status": {
                        "status": "unknown",
                        "basis": None,
                    },
                    "abnormality": {
                        "present": False,
                        "description": None,
                        "evidence": None,
                    },
                },
            )

        lab_rows.append(output_row)

    # ---------------------------------------------------------------
    # Diagnostic / radiology / pathology grouping
    # ---------------------------------------------------------------

    diagnostic_items = await clinical_diagnostic_reports.find(
        {"patient_id": patient_id},
        {"_id": 0},
    ).sort(
        [
            ("document_type", 1),
            ("document_date", 1),
        ]
    ).to_list(length=None)

    diagnostic_reports: Dict[str, List[dict]] = {}

    for item in diagnostic_items:
        document_type = item.get("document_type") or "Unknown"

        diagnostic_reports.setdefault(
            document_type,
            [],
        ).append(item)

    return {
        "patient_id": patient_id,
        "lab_trend": {
            "columns": columns,
            "rows": lab_rows,
        },
        "diagnostic_reports": diagnostic_reports,
        "counts": {
            "lab_rows": len(lab_rows),
            "diagnostic_reports": len(diagnostic_items),
        },
    }
