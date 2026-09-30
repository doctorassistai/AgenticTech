"""
patient_app/services/condition.py

Diagnosis text shown to the patient (handoff section 6.4). Source order:
  1. Latest non-"Nil", non-empty diagnosis_data row across the patient's
     doctors (every Save Session re-inserts an identical row; we just take
     the newest usable one, no need to physically dedupe).
  2. patient_summary.summary.confirmed_diagnoses[0]
  3. patient_summary.summary.diagnosis_header, with leading/trailing ** stripped
  4. None

Pure logic. care_data.py does the reads; routes.py resolves the doctor name
afterwards (this module never touches doctor_users).
"""

from __future__ import annotations

import re
from typing import Any, Optional

_NIL_RE = re.compile(r"^\s*nil\s*$", re.IGNORECASE)


def _clean(v: Any) -> str:
    return v.strip() if isinstance(v, str) else ""


def pick_condition(diagnosis_rows: list, summary_doc: Optional[dict]) -> Optional[dict]:
    """diagnosis_rows: [{doctor_id, diagnosis, updated_at, created_at}, ...] from
    care_data.load_diagnosis_docs (already sorted newest-first there; sorted again
    here so this function is correct even if called with an unsorted list)."""
    rows = sorted(
        (r for r in diagnosis_rows or [] if isinstance(r, dict)),
        key=lambda r: r.get("updated_at") or r.get("created_at") or "",
        reverse=True,
    )
    for r in rows:
        text = _clean(r.get("diagnosis"))
        if text and not _NIL_RE.match(text):
            return {
                "diagnosis": text,
                "source": "diagnosis_data",
                "updated_at": r.get("updated_at"),
                "doctor": {"doctor_id": r.get("doctor_id"), "name": None},
            }

    if summary_doc:
        summary = summary_doc.get("summary") or {}
        confirmed = summary.get("confirmed_diagnoses")
        if isinstance(confirmed, list):
            for item in confirmed:
                text = _clean(item)
                if text and not _NIL_RE.match(text):
                    return {
                        "diagnosis": text,
                        "source": "patient_summary",
                        "updated_at": summary_doc.get("updated_at") or summary_doc.get("generated_at"),
                        "doctor": {"doctor_id": summary_doc.get("doctor_id"), "name": None},
                    }
        header = _clean(summary.get("diagnosis_header")).strip("*").strip()
        if header and not _NIL_RE.match(header):
            return {
                "diagnosis": header,
                "source": "patient_summary",
                "updated_at": summary_doc.get("updated_at") or summary_doc.get("generated_at"),
                "doctor": {"doctor_id": summary_doc.get("doctor_id"), "name": None},
            }

    return None