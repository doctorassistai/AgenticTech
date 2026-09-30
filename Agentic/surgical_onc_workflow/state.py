"""Shared LangGraph state + structured-output models for the dashboard pipeline.

One `SurgicalDashboardState` TypedDict is shared by every node. Each agent writes
ONLY its own module into the `modules` dict via the `merge_modules` reducer, so the
12 parallel agent nodes never clobber each other's output. `warnings` uses the same
concat-reducer trick for the same reason.
"""

from typing import TypedDict, Annotated, List, Dict, Literal, Any

from pydantic import BaseModel, Field


# ─── Structured output: what each agent returns ──────────────────────────────

class ParameterRow(BaseModel):
    """One row of a module's table.

    Field defaults are the anti-hallucination safety net: an un-filled row reads
    as "Not available" / neutral rather than inventing a value. Standard modules
    (m1–m8, m10–m12) use parameter/finding/reference/status/statusLabel/action;
    Module 9 (Documentation) additionally uses lastGenerated + completeness.
    """
    parameter: str
    finding: str = "Not available"
    reference: str = ""                                    # "Reference / Expected" column
    status: Literal["ok", "watch", "alert", "flag", "info", "neutral"] = "neutral"
    statusLabel: str = ""                                  # short pill text
    action: str = "No action."                             # "Indication / Action" column
    # Module 9 (Documentation) only — harmless empty strings elsewhere:
    lastGenerated: str = ""
    completeness: str = ""


class ModuleResult(BaseModel):
    module_id: str = ""                                    # "m1".."m12"
    title: str = ""
    rows: List[ParameterRow] = Field(default_factory=list)
    summary: str = ""                                      # short module-level note (optional)


# ─── Reducers (parallel-safe merges) ─────────────────────────────────────────

def merge_modules(left: Dict, right: Dict) -> Dict:
    """Union each agent's {module_id: ModuleResult} into one dict."""
    return {**(left or {}), **(right or {})}


def merge_warnings(left: List, right: List) -> List:
    """Concatenate warnings emitted by parallel nodes (None-safe)."""
    return (left or []) + (right or [])


# ─── The shared graph state ──────────────────────────────────────────────────

class SurgicalDashboardState(TypedDict, total=False):
    patient_id: str
    today: str                             # server calendar date 'YYYY-MM-DD' (date-context for m12)
    all_bookings: List[Dict[str, Any]]     # every surgery doc for the patient (newest first)
    active_booking: Dict[str, Any]         # the is_active doc (fallback: latest) — single episode
    labs: Dict[str, Any]                   # labs aggregated across ALL bookings
    completed_documents: List[Dict[str, Any]]   # all completed investigations (labs/path/imaging)
    pathology_documents: List[Dict[str, Any]]   # pathology/HPR subset of completed_documents
    investigation_register: List[Dict[str, Any]]  # ALL ordered investigations (any status) — m1 completeness
    pathology_case: Dict[str, Any]         # pathology dept's structured case: synoptic + tnm.latest
    clinical_context: Dict[str, Any]       # ECOG/KPS + clinical summary (chemotherapy + patient_summary)
    tumor_board: Dict[str, Any]            # MDT care-pathway plan (tumorBoardPlan): steps, approvals, safety flags
    ot_schedule: List[Dict[str, Any]]      # this theatre/day's raw OT reservations, all patients (m12)
    or_utilization: Dict[str, Any]         # deterministic OR-load numbers for the theatre/day (m12)
    case_scheduling: Dict[str, Any]        # this case's wait-days + postpone/cancel track record (m12)
    patient: Dict[str, Any]                # patient-strip cells (deterministic, no LLM)
    kpis: Dict[str, Any]                   # 6 KPI cards (derived deterministically in assemble)
    modules: Annotated[Dict[str, ModuleResult], merge_modules]
    warnings: Annotated[List[str], merge_warnings]
    error: str
