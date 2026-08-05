"""
grounded_evis/shadow_compare.py
==============================================================
Runs the grounded pipeline alongside ambulance.py's existing output for
the SAME request, and records a comparison. It does NOT return anything
that should be sent to the caller/frontend — the response returned to the
person using the app stays exactly what ambulance.py's evis_workflow
produces, unchanged, for this entire phase.

CALL PATTERN (deliberately inverted from "shadow_compare owns both
pipelines"): the caller runs the OLD pipeline itself (as it already does
today) and passes the resulting dict in as `legacy_result`. This module
only runs the NEW pipeline and builds the comparison. That keeps this
module blast-radius-limited — a bug here can, at worst, fail to log a
comparison; it can never accidentally become the response path, because
it never has the opportunity to construct one.

Example call site (illustrative — actual wiring happens where
process_combined_entries() is called in ambulance.py's endpoint):

    legacy_result = await process_combined_entries(...)   # existing call, unchanged
    asyncio.create_task(run_shadow_comparison(             # fire-and-forget
        patient_id=patient_id,
        entries=entries,
        clinical_actions=clinical_actions,
        image_entries=image_entries,
        patient_record=patient_record,
        source_counts=source_counts,
        legacy_result=legacy_result,
        comparison_collection=shadow_comparisons_collection,  # optional
    ))
    return legacy_result   # <-- response is ALWAYS the legacy result during shadow mode

Using asyncio.create_task (fire-and-forget) rather than awaiting this
inline is deliberate: a slow or failing shadow comparison must never add
latency to, or risk breaking, the real response path. Errors inside this
module are caught and logged, never raised to the caller.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

try:
    from loguru import logger
except ImportError:
    import logging as _logging

    class _LoguruShim:
        def __init__(self):
            self._logger = _logging.getLogger("grounded_evis.shadow_compare")

        def info(self, msg, *a, **k):
            self._logger.info(msg)

        def warning(self, msg, *a, **k):
            self._logger.warning(msg)

        def error(self, msg, *a, **k):
            self._logger.error(msg)

    logger = _LoguruShim()

from .pipeline import run_grounded_pipeline


def _extract_legacy_fields(legacy_result: Dict) -> Dict[str, Any]:
    """
    Best-effort extraction of the handful of headline fields worth
    comparing from ambulance.py's response shape. Defensive against the
    two different shapes process_combined_entries() can return
    (full-pipeline A8 output vs. SIMPLE_SYNTH output) — both nest under
    result["suggestions"]["patient_snapshot"] per today's schema, so a
    single path covers both, but this stays defensive (.get chains) since
    that's still an assumption about a system this module doesn't own.
    """
    suggestions = legacy_result.get("suggestions") or {}
    snapshot = suggestions.get("patient_snapshot") or {}
    risk_strat = legacy_result.get("risk_stratification") or {}

    return {
        "case_type": legacy_result.get("case_type"),
        "is_trauma": legacy_result.get("is_trauma"),
        "care_setting": legacy_result.get("care_setting"),
        "triage_colour": snapshot.get("triage_colour"),
        "overall_risk": snapshot.get("overall_risk") or risk_strat.get("overall_risk_level"),
        "criticality_score": snapshot.get("criticality_score"),
        "suspected_diagnoses": (suggestions.get("clinical_impression") or {}).get(
            "suspected_diagnoses"
        ),
    }


def _extract_new_fields(new_result: Dict) -> Dict[str, Any]:
    return {
        "case_type": new_result.get("case_type"),
        "is_trauma": "is_trauma" in new_result.get("triggers_fired", []),
        "care_setting": new_result.get("care_setting"),
        "triage_colour": new_result.get("triage_colour"),
        "triage_colour_source": new_result.get("triage_colour_source"),
        "overall_risk": new_result.get("overall_risk_level"),
        "suspected_diagnoses": [
            c.get("value") for c in new_result.get("suspected_diagnoses", [])
        ],
        "stage3_claims_dropped_ungrounded": new_result.get("audit", {}).get(
            "stage3_claims_dropped_ungrounded"
        ),
        "facts_dropped_ungrounded": new_result.get("audit", {}).get(
            "facts_dropped_ungrounded"
        ),
    }


def _build_comparison_record(
    request_id: str,
    patient_id: str,
    legacy_fields: Dict[str, Any],
    new_fields: Dict[str, Any],
    new_result: Dict,
    error: Optional[str] = None,
) -> Dict[str, Any]:
    disagreements: List[str] = []
    if error is None:
        for key in ("case_type", "is_trauma", "care_setting", "triage_colour"):
            if legacy_fields.get(key) != new_fields.get(key):
                disagreements.append(
                    f"{key}: legacy={legacy_fields.get(key)!r} vs new={new_fields.get(key)!r}"
                )
        legacy_dx = set(legacy_fields.get("suspected_diagnoses") or [])
        new_dx = set(new_fields.get("suspected_diagnoses") or [])
        if legacy_dx != new_dx:
            disagreements.append(
                f"suspected_diagnoses: legacy={sorted(legacy_dx)} vs new={sorted(new_dx)}"
            )

    return {
        "request_id": request_id,
        "patient_id": patient_id,
        "compared_at_utc": datetime.now(timezone.utc).isoformat(),
        "error": error,
        "legacy": legacy_fields,
        "new": new_fields,
        "disagreements": disagreements,
        "disagreement_count": len(disagreements),
        "new_pipeline_processing_time_ms": new_result.get("processing_time_ms"),
        "new_pipeline_agent_timings": new_result.get("agent_timings"),
    }


async def run_shadow_comparison(
    patient_id: str,
    entries: List[Dict],
    clinical_actions: Optional[List[Dict]],
    image_entries: Optional[List[Dict]],
    patient_record: Optional[Dict],
    source_counts: Optional[Dict],
    legacy_result: Dict[str, Any],
    comparison_collection: Optional[Any] = None,
    llm: Optional[Any] = None,
) -> Dict[str, Any]:
    """
    Runs the new grounded pipeline and compares it against legacy_result
    (already computed by the caller from the existing ambulance.py
    pipeline). Persists the comparison to comparison_collection if given,
    otherwise logs it as a structured warning line. NEVER raises — any
    failure here is caught and logged, since this must never be able to
    break or slow down the real request path it's shadowing.

    Returns the comparison record (useful for tests/direct inspection);
    callers using the fire-and-forget asyncio.create_task pattern shown
    in the module docstring won't await this return value at all.
    """
    request_id = str(uuid.uuid4())

    try:
        new_result = await run_grounded_pipeline(
            patient_id=patient_id,
            entries=entries,
            clinical_actions=clinical_actions,
            image_entries=image_entries,
            patient_record=patient_record,
            source_counts=source_counts,
            llm=llm,
        )
    except Exception as e:
        logger.error(
            f"shadow_compare: new pipeline FAILED for patient={patient_id} "
            f"request_id={request_id}: {e}"
        )
        record = _build_comparison_record(
            request_id, patient_id, {}, {}, {}, error=str(e)
        )
        await _persist(record, comparison_collection)
        return record

    legacy_fields = _extract_legacy_fields(legacy_result)
    new_fields = _extract_new_fields(new_result)
    record = _build_comparison_record(
        request_id, patient_id, legacy_fields, new_fields, new_result
    )

    if record["disagreement_count"] > 0:
        logger.warning(
            f"SHADOW_COMPARE disagreement | request_id={request_id} patient_id={patient_id} "
            f"count={record['disagreement_count']} details={record['disagreements']}"
        )
    else:
        logger.info(
            f"SHADOW_COMPARE agreement | request_id={request_id} patient_id={patient_id} "
            f"triage_colour={new_fields.get('triage_colour')} "
            f"stage3_claims_dropped_ungrounded={new_fields.get('stage3_claims_dropped_ungrounded')}"
        )

    await _persist(record, comparison_collection)
    return record


async def _persist(record: Dict[str, Any], comparison_collection: Optional[Any]) -> None:
    if comparison_collection is None:
        return
    try:
        await comparison_collection.insert_one(dict(record))
    except Exception as e:
        # A failed write to the comparison store must never propagate —
        # it's a side-channel, not the response path.
        logger.error(f"shadow_compare: failed to persist comparison record: {e}")