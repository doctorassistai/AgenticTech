"""
State Definition for Chemotherapy Intelligence Workflow
"""

from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field


class PatientMetaState(BaseModel):
    patient_id: str
    age: str = ""
    weight_kg: float = 0.0
    height_cm: float = 0.0
    bsa_actual: float = 0.0
    bsa_capped: float = 0.0
    regimen: str = ""
    indication: str = ""
    diagnosis: str = ""
    crcl: float = 60.0
    serum_creatinine: float = 0.9
    cycle_current: int = 1
    cycle_total: int = 6
    day: int = 1
    ecog: int = 0
    ecog_status: str = "Fit"


class ModuleCheckResult(BaseModel):
    parameter: str
    current_finding: str
    reference_expected: str
    status: str  # ok, watch, alert, flag, stop, neutral
    indication_action: str

    @classmethod
    def not_available(
        cls,
        parameter: str,
        *,
        reference_expected: str = "",
        indication_action: str = "Source data not linked; will populate when available.",
    ) -> "ModuleCheckResult":
        """
        Creates a standardized 'Not available' result when patient data is missing.
        Ensures we never fabricate clinical findings or crash on missing parameters.
        """
        return cls(
            parameter=parameter,
            current_finding="—",
            reference_expected=reference_expected,
            status="neutral",
            indication_action=indication_action,
        )


# Alias for compatibility across agent modules
ModuleCheckItem = ModuleCheckResult


class ModuleState(BaseModel):
    module_id: int
    title: str = ""
    module_name: str = ""
    summary_text: str = ""
    checks: List[ModuleCheckResult] = Field(default_factory=list)
    flagship_note: Optional[Dict[str, Any]] = None
    status: str = "ok"

    def model_post_init(self, __context: Any) -> None:
        if not self.title and self.module_name:
            self.title = self.module_name

    def rollup_status(self) -> str:
        """
        Derives the overall module status from its checks:
        alert/stop > watch/flag > ok/neutral
        """
        statuses = {c.status.lower() for c in self.checks}
        if "alert" in statuses or "stop" in statuses:
            return "alert"
        if "watch" in statuses or "flag" in statuses:
            return "watch"
        return "ok"


class ChemotherapyWorkflowState(BaseModel):
    patient: PatientMetaState
    modules: Dict[int, ModuleState] = Field(default_factory=dict)
    summary_kpis: List[Dict[str, Any]] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)

    def calculate_kpis(self) -> List[Dict[str, Any]]:
        """
        Generates summary KPIs across all 12 modules for the header strip.
        """
        total_checks = sum(len(m.checks) for m in self.modules.values())
        alerts = sum(
            1 for m in self.modules.values()
            for c in m.checks if c.status.lower() in ("alert", "stop")
        )
        watches = sum(
            1 for m in self.modules.values()
            for c in m.checks if c.status.lower() in ("watch", "flag")
        )
        not_available = sum(
            1 for m in self.modules.values()
            for c in m.checks if c.status.lower() == "neutral" or c.current_finding == "—"
        )

        kpis = [
            {"label": "Total Checks Evaluated", "value": str(total_checks), "status": "neutral"},
            {"label": "Critical Alerts", "value": str(alerts), "status": "alert" if alerts > 0 else "ok"},
            {"label": "Warnings / Watch", "value": str(watches), "status": "watch" if watches > 0 else "ok"},
            {"label": "Data Gaps (Not Available)", "value": str(not_available), "status": "neutral"},
        ]
        self.summary_kpis = kpis
        return kpis

