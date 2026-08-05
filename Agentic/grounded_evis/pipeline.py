"""
grounded_evis/pipeline.py
==============================================================
Orchestrator. Same return-contract shape as ambulance.py's
process_combined_entries() (patient_id, timestamps, source counts, etc.)
so the eventual cutover only needs to swap the function pointer the
FastAPI endpoint calls — not the endpoint itself.

Sequence: Stage 1 (extract) -> Stage 2 (ground-check + triggers)
          -> case_classification (LLM, deterministic overrides)
          -> Stage 3 (interpret, only fed grounded facts + fired triggers)
          -> Stage 4 (compose — the enforcement layer)

registered_incident_type is read from patient_record the same way
ambulance.py's _registered_incident_type() does, so this doesn't need a
different patient_record shape than what the existing endpoints already
fetch.

NOTE ON SCHEMA (open Q4, still unresolved): this returns the grounded-
native shape from Stage 4 plus the orchestration metadata below. It does
NOT map onto ambulance.py's legacy response keys yet — see
stage4_compose.py's module docstring. shadow_compare.py compares on
specific fields (overall_risk_level, case_type, triage-relevant claims)
rather than assuming a byte-for-byte schema match, until that's decided.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

try:
    from loguru import logger
except ImportError:
    import logging as _logging

    class _LoguruShim:
        def __init__(self):
            self._logger = _logging.getLogger("grounded_evis")

        def info(self, msg, *a, **k):
            self._logger.info(msg)

        def warning(self, msg, *a, **k):
            self._logger.warning(msg)

        def error(self, msg, *a, **k):
            self._logger.error(msg)

        def debug(self, msg, *a, **k):
            self._logger.debug(msg)

    logger = _LoguruShim()

from .case_classification import classify_case
from .llm_client import get_best_available_llm
from .prior_action_context import build_prior_action_context
from .stage1_extract import extract_facts
from .stage2_ground_check import compute_trigger_flags, ground_check_facts
from .stage3_interpret import interpret
from .stage4_compose import compose_final_output, ground_check_claims


def _registered_incident_type(patient_record: Optional[Dict]) -> Optional[str]:
    """Mirrors ambulance.py's _registered_incident_type() exactly, so this
    orchestrator can be handed the same patient_record shape the existing
    endpoints already fetch via _fetch_patient_record()."""
    accident = (patient_record or {}).get("accidentDetails", {}) or {}
    return accident.get("accidentType")


async def run_grounded_pipeline(
    patient_id: str,
    entries: List[Dict],
    clinical_actions: Optional[List[Dict]] = None,
    image_entries: Optional[List[Dict]] = None,
    patient_record: Optional[Dict] = None,
    source_counts: Optional[Dict] = None,
    llm: Optional[Any] = None,
) -> Dict[str, Any]:
    """
    Runs the full 4-stage grounded pipeline once across all entries for a
    patient. Returns a dict with the grounded-native output plus
    orchestration metadata (timings, audit counts) — see module docstring
    for the schema-mapping caveat.

    `llm` is injectable (defaults to llm_client.get_best_available_llm())
    so tests can pass a mock without needing a real API key/network call —
    production call sites should just omit it and get the real client.
    """
    clinical_actions = clinical_actions or []
    image_entries = image_entries or []
    source_counts = source_counts or {}

    start_ms = datetime.now().timestamp() * 1000
    timings: Dict[str, float] = {}
    registered_incident_type = _registered_incident_type(patient_record)

    if llm is None:
        llm = get_best_available_llm()

    # image_entries are already included in `entries` by the caller today
    # (ambulance.py's _fetch_all_clinical_entries merges all three sources
    # before calling process_combined_entries) — if that convention holds
    # here too, image_entries is only used for the A9-equivalent
    # discrepancy check inside Stage 2/3, not re-added to the entry list.
    # Flagging this assumption: confirm entries already contains
    # image-sourced items with _source == "image_extracted" the same way
    # ambulance.py's build_combined_state expects.

    # ── Stage 1 — EXTRACT ───────────────────────────────────────────
    t0 = datetime.now().timestamp()
    raw_facts, entry_id_map = await extract_facts(
        entries=entries,
        registered_incident_type=registered_incident_type,
        llm=llm,
    )
    timings["stage1_extract_ms"] = round((datetime.now().timestamp() - t0) * 1000, 1)
    logger.info(
        f"Stage 1 complete | patient={patient_id} facts_extracted={len(raw_facts)} "
        f"elapsed_ms={timings['stage1_extract_ms']}"
    )

    # ── Stage 2 — GROUND-CHECK ──────────────────────────────────────
    t0 = datetime.now().timestamp()
    grounded_facts, dropped_facts = ground_check_facts(
        raw_facts=raw_facts,
        entry_id_map=entry_id_map,
        registered_incident_type=registered_incident_type,
    )
    triggers = compute_trigger_flags(
        grounded_facts=grounded_facts,
        entry_id_map=entry_id_map,
        registered_incident_type=registered_incident_type,
    )
    timings["stage2_ground_check_ms"] = round((datetime.now().timestamp() - t0) * 1000, 1)
    logger.info(
        f"Stage 2 complete | patient={patient_id} facts_grounded={len(grounded_facts)} "
        f"facts_dropped_ungrounded={len(dropped_facts)} "
        f"triggers_fired={[k for k, v in triggers.items() if k != 'trigger_basis' and v]} "
        f"elapsed_ms={timings['stage2_ground_check_ms']}"
    )
    if dropped_facts:
        # A nonzero drop count here means Stage 1 tried to cite evidence
        # that doesn't actually exist in its claimed source — worth
        # watching the same way stage3_claims_dropped_ungrounded is,
        # since it's a signal Stage 1's extraction is drifting.
        logger.warning(
            f"Stage 1 produced {len(dropped_facts)} fact(s) that failed grounding "
            f"for patient={patient_id} — dropped, not trusted."
        )

    # ── case classification (LLM, deterministic overrides) ──────────
    t0 = datetime.now().timestamp()
    classification = await classify_case(
        grounded_facts=grounded_facts,
        triggers=triggers,
        registered_incident_type=registered_incident_type,
        llm=llm,
    )
    timings["case_classification_ms"] = round((datetime.now().timestamp() - t0) * 1000, 1)
    case_type = classification["case_type"]
    care_setting = classification["care_setting"]
    logger.info(
        f"Case classification complete | patient={patient_id} case_type={case_type} "
        f"care_setting={care_setting} elapsed_ms={timings['case_classification_ms']}"
    )

    # ── prior-action context (feedback-loop fix) ────────────────────
    prior_action_context = build_prior_action_context(clinical_actions)

    # ── Stage 3 — INTERPRET ──────────────────────────────────────────
    t0 = datetime.now().timestamp()
    raw_claims = await interpret(
        grounded_facts=grounded_facts,
        triggers=triggers,
        case_type=case_type,
        care_setting=care_setting,
        prior_action_context=prior_action_context,
        llm=llm,
    )
    timings["stage3_interpret_ms"] = round((datetime.now().timestamp() - t0) * 1000, 1)
    logger.info(
        f"Stage 3 complete | patient={patient_id} claims_generated={len(raw_claims)} "
        f"elapsed_ms={timings['stage3_interpret_ms']}"
    )

    # ── Stage 4 — COMPOSE (the enforcement layer) ────────────────────
    t0 = datetime.now().timestamp()
    print(f"[pipeline] about to call ground_check_claims with raw_claims count={len(raw_claims)}")
    grounded_claims, dropped_claims = ground_check_claims(
        raw_claims=raw_claims,
        grounded_facts=grounded_facts,
        triggers=triggers,
    )
    print(f"[pipeline] ground_check_claims returned kept={len(grounded_claims)} dropped={len(dropped_claims)}")
    output = compose_final_output(
        grounded_facts=grounded_facts,
        grounded_claims=grounded_claims,
        dropped_facts=dropped_facts,
        dropped_claims=dropped_claims,
        triggers=triggers,
        case_type=case_type,
        care_setting=care_setting,
        patient_id=patient_id,
    )
    timings["stage4_compose_ms"] = round((datetime.now().timestamp() - t0) * 1000, 1)

    elapsed_ms = round(datetime.now().timestamp() * 1000 - start_ms)
    output["processing_time_ms"] = elapsed_ms
    output["agent_timings"] = timings
    output["entry_count"] = len(entries)
    output["source_counts"] = source_counts
    output["routing_rationale"] = classification.get("rationale", "")

    # ── the one audit line the design doc asked for ─────────────────
    logger.warning(
        "AUDIT | request_id={} patient_id={} case_type={} is_trauma={} triggers_fired={} "
        "overall_risk={} stage3_claims_dropped_ungrounded={}".format(
            None,  # request_id wiring belongs to the FastAPI layer, not this function
            patient_id,
            case_type,
            triggers.get("is_trauma"),
            output["triggers_fired"],
            output["overall_risk_level"],
            output["audit"]["stage3_claims_dropped_ungrounded"],
        )
    )

    if output["audit"]["stage3_claims_dropped_ungrounded"] > 0:
        logger.warning(
            f"Stage 3 attempted {output['audit']['stage3_claims_dropped_ungrounded']} "
            f"claim(s) Stage 2 didn't support for patient={patient_id} — dropped safely, "
            f"but nonzero rate here means the model is still trying to fabricate and the "
            f"Stage 3 prompt may need tightening."
        )

    return output