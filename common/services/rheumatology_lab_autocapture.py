"""
common/services/rheumatology_lab_autocapture.py
─────────────────────────────────────────────────────────────────────────────
Rheumatology-specific auto-capture hook.

Called ONCE, at the tail of common/celery_worker/handwritten_task.py's
process_handwritten_document, AFTER the existing document_evidence /
processed_documents writes. Purpose: if the uploading doctor is a
Rheumatologist, take the already-extracted "Lab Result" entities for this
document and, where they match the closed Module-5 catalog
(users/patient_data/rheumatology_lab_trends_api.py: LAB_TEST_CATALOG),
insert them into the SAME "rheumatology_lab_results" collection that
Module 5 reads from — tagged as auto-extracted — so they show up in
RheumatologyLabTrends.jsx without the doctor re-typing them.

DESIGN CONSTRAINTS (do not relax these without re-reading the handoff):
  - This module must NEVER raise out to its caller. Every public entry
    point is wrapped in try/except and logs-and-returns on any failure.
    A bug here must never break the primary upload/OCR flow.
  - This module does NOT modify LAB_TEST_CATALOG, the add-result schema,
    or any existing collection's read path. It only ever INSERTS new
    documents into rheumatology_lab_results, using the exact same shape
    /rheumatology-labs/add-result already writes, plus two extra fields
    (source, source_document_id) that add-result's schema does not
    forbid and that the existing GET endpoint already returns verbatim
    (it does `flat.append(doc)` with no field allowlist).
  - No LLM call. Matching is a plain dict lookup against a small alias
    table (LAB_TEST_CATALOG has 15 entries — see rheumatology_lab_trends_api.py).
  - This is SYNC code (Celery worker context), matching the sync style
    of the rest of handwritten_task.py.
"""

import re
import logging
from datetime import datetime
from typing import Optional, List, Tuple

from common.HMS.db import sync_db, doctor_user_collection_sync

logger = logging.getLogger(__name__)

# Must exactly mirror LAB_TEST_CATALOG in
# users/patient_data/rheumatology_lab_trends_api.py. Duplicated (not
# imported) on purpose — that file lives in a different service/process
# and importing across services here would create a runtime coupling
# this task doesn't currently have. If the catalog changes, update both.
LAB_TEST_CATALOG = {
    "ESR": "mm/hr",
    "CRP": "mg/L",
    "Hemoglobin": "g/dL",
    "White Blood Cell Count (WBC)": "x10\u2079/L",
    "Platelet Count": "x10\u2079/L",
    "Creatinine": "mg/dL",
    "eGFR": "mL/min/1.73m\u00b2",
    "AST": "U/L",
    "ALT": "U/L",
    "Serum Uric Acid": "mg/dL",
    "Complement C3": "mg/dL",
    "Complement C4": "mg/dL",
    "Anti-dsDNA Titer": "IU/mL",
    "Creatine Kinase (CK)": "U/L",
    "Urine Protein-to-Creatinine Ratio (UPCR)": "mg/g",
}

# entity_name as GPT-4o writes it (free text, exactly as printed on the
# source document) -> canonical LAB_TEST_CATALOG key. Keys here are
# normalized via _normalize() before lookup. Extend as real-world
# variants are observed in production logs — this list is deliberately
# not exhaustive on day one.
_ALIAS_TO_CANONICAL = {
    "esr": "ESR",
    "erythrocyte sedimentation rate": "ESR",
    "westergren esr": "ESR",
    "crp": "CRP",
    "c reactive protein": "CRP",
    "c-reactive protein": "CRP",
    "hs crp": "CRP",
    "hs-crp": "CRP",
    "hemoglobin": "Hemoglobin",
    "haemoglobin": "Hemoglobin",
    "hb": "Hemoglobin",
    "wbc": "White Blood Cell Count (WBC)",
    "wbc count": "White Blood Cell Count (WBC)",
    "white blood cell count": "White Blood Cell Count (WBC)",
    "total leucocyte count": "White Blood Cell Count (WBC)",
    "total leukocyte count": "White Blood Cell Count (WBC)",
    "tlc": "White Blood Cell Count (WBC)",
    "platelet count": "Platelet Count",
    "platelets": "Platelet Count",
    "creatinine": "Creatinine",
    "serum creatinine": "Creatinine",
    "egfr": "eGFR",
    "estimated gfr": "eGFR",
    "estimated glomerular filtration rate": "eGFR",
    "ast": "AST",
    "sgot": "AST",
    "aspartate aminotransferase": "AST",
    "alt": "ALT",
    "sgpt": "ALT",
    "alanine aminotransferase": "ALT",
    "serum uric acid": "Serum Uric Acid",
    "uric acid": "Serum Uric Acid",
    "complement c3": "Complement C3",
    "c3": "Complement C3",
    "complement c4": "Complement C4",
    "c4": "Complement C4",
    "anti-dsdna": "Anti-dsDNA Titer",
    "anti dsdna": "Anti-dsDNA Titer",
    "anti-dsdna titer": "Anti-dsDNA Titer",
    "anti-dsdna antibody": "Anti-dsDNA Titer",
    "ck": "Creatine Kinase (CK)",
    "cpk": "Creatine Kinase (CK)",
    "creatine kinase": "Creatine Kinase (CK)",
    "creatine phosphokinase": "Creatine Kinase (CK)",
    "upcr": "Urine Protein-to-Creatinine Ratio (UPCR)",
    "urine protein creatinine ratio": "Urine Protein-to-Creatinine Ratio (UPCR)",
    "urine protein to creatinine ratio": "Urine Protein-to-Creatinine Ratio (UPCR)",
    "urine pcr": "Urine Protein-to-Creatinine Ratio (UPCR)",
}

_VALUE_RE = re.compile(r"^\s*([-+]?\d*\.?\d+)\s*([^\|]*)")


def _normalize(name: str) -> str:
    name = (name or "").lower().strip()
    name = re.sub(r"[\(\)]", " ", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name


def _match_canonical_test_name(entity_name: str) -> Optional[str]:
    return _ALIAS_TO_CANONICAL.get(_normalize(entity_name))


def _parse_entity_value(entity_value: Optional[str]) -> Tuple[Optional[float], Optional[str]]:
    """
    entity_value from handwritten_task.py's extraction prompt looks like:
      "32 mg/L | range: 0-10 | flag: HIGH"
      "11.2 g/dL"
    range/flag segments are optional. Returns (numeric_value, unit_as_written)
    or (None, None) if no leading numeric value is present.
    """
    if not entity_value:
        return None, None
    main_part = entity_value.split("|")[0]
    match = _VALUE_RE.match(main_part)
    if not match:
        return None, None
    value_str, unit_str = match.groups()
    try:
        value = float(value_str)
    except (TypeError, ValueError):
        return None, None
    return value, (unit_str or "").strip() or None


def _is_rheumatologist(doctor_id: str) -> bool:
    doctor = doctor_user_collection_sync.find_one(
        {"sys_user_id": doctor_id},
        {"specialization": 1},
    )
    if not doctor or not doctor.get("specialization"):
        return False
    return doctor["specialization"].strip().lower() == "rheumatology"


def auto_capture_rheumatology_labs(
    patient_id: str,
    doctor_id: str,
    document_id: str,
    entities_with_date: List[Tuple[object, Optional[str]]],
    fallback_date: Optional[str] = None,
) -> None:
    """
    entities_with_date: same list already built in process_handwritten_document
    (list of (ExtractedEntity, document_date_str_or_None) tuples).
    fallback_date: report_date passed into the task, used when a given
    entity's own document_date came back None.

    Never raises. Logs and returns on any failure so the caller's own
    try/except is a backstop, not the primary safety net.
    """
    try:
        if not doctor_id or not patient_id:
            return

        if not _is_rheumatologist(doctor_id):
            return

        rheumatology_lab_results_collection = sync_db["rheumatology_lab_results"]

        inserted = 0
        for entity, entity_date in entities_with_date:
            try:
                entity_type = getattr(entity, "entity_type", "") or ""
                if entity_type.strip().lower() != "lab result":
                    continue

                canonical_name = _match_canonical_test_name(getattr(entity, "entity_name", ""))
                if not canonical_name:
                    continue

                value, _unit_as_written = _parse_entity_value(getattr(entity, "entity_value", None))
                if value is None:
                    continue

                date_str = entity_date or fallback_date or datetime.utcnow().strftime("%Y-%m-%d")
                try:
                    datetime.strptime(date_str, "%Y-%m-%d")
                except ValueError:
                    date_str = fallback_date or datetime.utcnow().strftime("%Y-%m-%d")

                document = {
                    "patient_id": patient_id,
                    "doctor_id": doctor_id,
                    "test_name": canonical_name,
                    "value": value,
                    "unit": LAB_TEST_CATALOG[canonical_name],
                    "date": date_str,
                    "notes": "",
                    "created_at": datetime.utcnow(),
                    "source": "auto_extracted",
                    "source_document_id": document_id,
                }
                rheumatology_lab_results_collection.insert_one(document)
                inserted += 1

            except Exception as inner_e:
                logger.warning(
                    f"Rheumatology auto-capture: skipped one entity | doc={document_id} | {inner_e}"
                )
                continue

        if inserted:
            logger.info(
                f"Rheumatology auto-capture: inserted {inserted} lab result(s) "
                f"| patient={patient_id} doctor={doctor_id} doc={document_id}"
            )

    except Exception as e:
        logger.error(
            f"Rheumatology auto-capture failed (non-fatal) | doc={document_id} | {e}",
            exc_info=True,
        )