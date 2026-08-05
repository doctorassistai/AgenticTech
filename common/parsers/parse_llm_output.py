"""
LLM output parsing and normalization layer.
Converts LLM JSON into structured domain objects.
"""

import logging
from typing import Dict, Any, List, Optional

from users.patient_data.patientcontext import (
    Labs,
    XrayDocuments,
    CTScanDocuments,
    Radiology,
    Documents,
)

logger = logging.getLogger(__name__)


# ==================================================
# PUBLIC ENTRY POINT
# ==================================================
def parse_llm_output(
    *,
    document_type: str,
    llm_output: Dict[str, Any],
    patient_id: str,
    doctor_id: Optional[str] = None,
    document_id: Optional[str] = None,
    appointment_id: Optional[str] = None,
    report_date: Optional[str] = None,
) -> Documents:
    """
    Dispatch parser based on document type.
    """

    document_type = document_type.lower()

    if document_type == "lab_report":
        labs = _parse_lab_report(
            llm_output=llm_output,
            patient_id=patient_id,
            doctor_id=doctor_id,
            document_id=document_id,
            appointment_id=appointment_id,
            report_date=report_date,
        )
        return Documents(
            patient_id=patient_id,
            doctor_id=doctor_id,
            labs=labs,
        )

    if document_type in {"xray", "ct_scan", "mri", "ultrasound"}:
        radiology = _parse_radiology(
            doc_type=document_type,
            llm_output=llm_output,
            patient_id=patient_id,
            doctor_id=doctor_id,
            document_id=document_id,
            appointment_id=appointment_id,
            report_date=report_date,
        )
        return Documents(
            patient_id=patient_id,
            doctor_id=doctor_id,
            radiology=[radiology],
        )

    logger.warning(f"⚠ Unsupported document type: {document_type}")
    return Documents(
        patient_id=patient_id,
        doctor_id=doctor_id,
    )


# ==================================================
# LAB REPORT PARSER
# ==================================================
def _parse_lab_report(
    *,
    llm_output: Dict[str, Any],
    patient_id: str,
    doctor_id: Optional[str],
    document_id: Optional[str],
    appointment_id: Optional[str],
    report_date: Optional[str],
) -> List[Labs]:
    """
    Converts structured_data → Labs[]
    """

    structured_data = llm_output.get("structured_data", [])
    medical_insights = llm_output.get("medical_insights", {})
    conditions = llm_output.get("conditions", [])

    labs: List[Labs] = []

    for test in structured_data:
        labs.append(
            Labs(
                patient_id=patient_id,
                doctor_id=doctor_id,
                document_id=document_id,
                appointment_id=appointment_id,
                report_date=report_date,
                test_name=str(test.get("test_name", "")),
                result_value=str(test.get("value", "")),
                unit=str(test.get("unit", "")),
                reference_range=str(test.get("reference_range", "")),
                status=str(test.get("flag", "")).lower(),
                medical_insights=str(medical_insights),
                conditions=str(conditions),
            )
        )

    logger.info(f"🧪 Parsed {len(labs)} lab tests")
    return labs


# ==================================================
# RADIOLOGY PARSER
# ==================================================
def _parse_radiology(
    *,
    doc_type: str,
    llm_output: Dict[str, Any],
    patient_id: str,
    doctor_id: Optional[str],
    document_id: Optional[str],
    appointment_id: Optional[str],
    report_date: Optional[str],
) -> Radiology:
    """
    Handles X-ray, CT, MRI, Ultrasound
    """

    base_fields = dict(
        patient_id=patient_id,
        doctor_id=doctor_id,
        document_id=document_id,
        appointment_id=appointment_id,
        report_date=report_date,
        findings=llm_output.get("findings"),
        abnormalities=str(llm_output.get("abnormalities", [])),
        recommendations=str(llm_output.get("recommendations", [])),
        diagnosis=llm_output.get("diagnosis"),
    )

    if doc_type == "xray":
        return Radiology(
            patient_id=patient_id,
            xray=XrayDocuments(**base_fields),
        )

    if doc_type == "ct_scan":
        return Radiology(
            patient_id=patient_id,
            ct_scan=CTScanDocuments(**base_fields),
        )

    if doc_type == "mri":
        from users.patient_data.patientcontext import MRIDocuments
        return Radiology(
            patient_id=patient_id,
            mri=MRIDocuments(**base_fields),
        )

    if doc_type == "ultrasound":
        from users.patient_data.patientcontext import UltrasoundDocuments
        return Radiology(
            patient_id=patient_id,
            ultrasound=UltrasoundDocuments(**base_fields),
        )

    raise ValueError(f"Unsupported radiology type: {doc_type}")
