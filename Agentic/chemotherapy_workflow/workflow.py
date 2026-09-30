"""
Workflow Orchestrator for Chemotherapy Intelligence Platform
Coordinates execution across the 12 AI Agent Modules with caching and fault-tolerance.
"""

import asyncio
from typing import Dict, Any, Optional, Callable, List
from .state import ChemotherapyWorkflowState, PatientMetaState, ModuleState
from .data_sources import parse_mongo_record, fetch_patient_emr_data
from . import store
from .agents.m01_readiness_agent import evaluate_m01_readiness
from .agents.m02_dose_calculation_agent import evaluate_m02_dose_calculation
from .agents.m03_order_verification_agent import evaluate_m03_order_verification
from .agents.m04_cycle_decision_agent import evaluate_m04_cycle_decision
from .agents.m05_toxicity_intelligence_agent import evaluate_m05_toxicity_intelligence
from .agents.m06_lifetime_exposure_agent import evaluate_m06_lifetime_exposure
from .agents.m07_treatment_performance_agent import evaluate_m07_treatment_performance
from .agents.m08_emergency_support_agent import evaluate_m08_emergency_support
from .agents.m09_monitoring_followup_agent import evaluate_m09_monitoring_followup
from .agents.m10_pharmacy_admin_agent import evaluate_m10_pharmacy_admin
from .agents.m11_documentation_agent import evaluate_m11_documentation
from .agents.m12_analytics_quality_agent import evaluate_m12_analytics_quality

# Registry mapping module ID / slug to evaluator functions
REGISTRY: Dict[int, Callable[[Dict[str, Any]], ModuleState]] = {
    1: evaluate_m01_readiness,
    2: evaluate_m02_dose_calculation,
    3: evaluate_m03_order_verification,
    4: evaluate_m04_cycle_decision,
    5: evaluate_m05_toxicity_intelligence,
    6: evaluate_m06_lifetime_exposure,
    7: evaluate_m07_treatment_performance,
    8: evaluate_m08_emergency_support,
    9: evaluate_m09_monitoring_followup,
    10: evaluate_m10_pharmacy_admin,
    11: evaluate_m11_documentation,
    12: evaluate_m12_analytics_quality,
}

MODULE_SLUGS: Dict[str, int] = {
    "readiness": 1, "m1": 1,
    "dose": 2, "m2": 2,
    "verification": 3, "m3": 3,
    "cycle": 4, "m4": 4,
    "toxicity": 5, "m5": 5,
    "exposure": 6, "m6": 6,
    "performance": 7, "m7": 7,
    "emergency": 8, "m8": 8,
    "monitoring": 9, "m9": 9,
    "pharmacy": 10, "m10": 10,
    "documentation": 11, "m11": 11,
    "analytics": 12, "m12": 12,
}


def run_module_safe(
    module_id: int,
    evaluator: Callable[[Dict[str, Any]], ModuleState],
    parsed: Dict[str, Any],
    state: ChemotherapyWorkflowState,
) -> None:
    """
    Executes a single module agent safely. If an error occurs, logs it and keeps remaining modules intact.
    """
    try:
        mod_state = evaluator(parsed)
        mod_state.status = mod_state.rollup_status()
        state.modules[module_id] = mod_state
    except Exception as e:
        err_msg = f"Module {module_id} evaluation failed: {e}"
        print(f"[ChemoWorkflow Warning] {err_msg}")
        state.errors.append(err_msg)
        # Fallback empty module state
        state.modules[module_id] = ModuleState(
            module_id=module_id,
            title=f"Module {module_id:02d}",
            summary_text="Evaluation temporarily unavailable due to data parsing issue.",
            status="neutral",
        )


def run_chemotherapy_workflow(
    raw_mongo_doc: Dict[str, Any],
    requested_cycle: Optional[str] = None,
    requested_treatment: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Executes all registered chemotherapy agent modules for the patient.
    """
    parsed = parse_mongo_record(raw_mongo_doc, requested_cycle=requested_cycle, requested_treatment=requested_treatment)
    demo = parsed["demographics"]

    state = ChemotherapyWorkflowState(
        patient=PatientMetaState(
            patient_id=parsed["patient_id"],
            age=str(demo["age"]) if demo.get("age") is not None else "",
            weight_kg=demo.get("weight_kg") or 0.0,
            height_cm=demo.get("height_cm") or 0.0,
            bsa_actual=demo.get("bsa_actual") or 0.0,
            bsa_capped=demo.get("bsa_capped") or 0.0,
            regimen=parsed.get("regimen", {}).get("name", ""),
            indication=demo.get("diagnosis", ""),
            diagnosis=demo.get("diagnosis", ""),
            crcl=demo.get("crcl") or 0.0,
            serum_creatinine=demo.get("serum_creatinine") or 0.0,
            cycle_current=demo.get("cycle_current") or 1,
            cycle_total=demo.get("cycle_total") or 1,
            ecog=demo.get("ecog") if demo.get("ecog") is not None else 0,
        )
    )

    # Execute all 12 modules with fault tolerance
    for mod_id in sorted(REGISTRY.keys()):
        run_module_safe(mod_id, REGISTRY[mod_id], parsed, state)

    state.calculate_kpis()
    return state.dict()


def get_or_generate(
    patient_id: str,
    raw_mongo_doc: Optional[Dict[str, Any]] = None,
    requested_cycle: Optional[str] = None,
    requested_treatment: Optional[str] = None,
    doctor_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Page visit path: loads latest saved report from cache store; runs & saves only on first visit.
    """
    cached = store.get_latest(patient_id)
    if cached is not None:
        return {
            "status": "success",
            "cached": True,
            "version": cached.get("version", 1),
            "generatedAt": cached.get("generatedAt", ""),
            "data": cached.get("data"),
        }

    if raw_mongo_doc is None:
        raw_mongo_doc = fetch_patient_emr_data(patient_id)

    res = run_chemotherapy_workflow(raw_mongo_doc, requested_cycle=requested_cycle, requested_treatment=requested_treatment)
    saved = store.save(res, patient_id=patient_id, doctor_id=doctor_id)
    return {
        "status": "success",
        "cached": False,
        "version": saved.get("version", 1),
        "generatedAt": saved.get("generatedAt", ""),
        "data": saved.get("data"),
    }


def regenerate(
    patient_id: str,
    raw_mongo_doc: Optional[Dict[str, Any]] = None,
    requested_cycle: Optional[str] = None,
    requested_treatment: Optional[str] = None,
    doctor_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Regenerate button path: re-evaluates all agents fresh and appends a new version to history.
    """
    if raw_mongo_doc is None:
        raw_mongo_doc = fetch_patient_emr_data(patient_id)

    res = run_chemotherapy_workflow(raw_mongo_doc, requested_cycle=requested_cycle, requested_treatment=requested_treatment)
    saved = store.save(res, patient_id=patient_id, doctor_id=doctor_id)
    return {
        "status": "success",
        "cached": False,
        "version": saved.get("version", 1),
        "generatedAt": saved.get("generatedAt", ""),
        "data": saved.get("data"),
    }


