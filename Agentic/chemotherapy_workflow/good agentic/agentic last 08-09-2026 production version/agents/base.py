"""
agents/base.py — Base Agent Template and Wrapper for Chemotherapy Workflow.
"""

from typing import Dict, Any, List, Optional, Callable
from ..state import ModuleState, ModuleCheckResult


class BaseChemoAgent:
    """
    Standard interface wrapping each of the 12 Chemotherapy AI Modules.
    """

    module_id: int = 0
    slug: str = ""
    title: str = ""

    def __init__(self, evaluator_fn: Optional[Callable[[Dict[str, Any]], ModuleState]] = None):
        self._evaluator_fn = evaluator_fn

    def evaluate(self, parsed_data: Dict[str, Any]) -> ModuleState:
        """
        Executes module evaluation, applies missing data safety, and computes rollups.
        """
        if self._evaluator_fn:
            state = self._evaluator_fn(parsed_data)
        else:
            state = ModuleState(module_id=self.module_id, module_name=self.title, title=self.title)

        state.status = state.rollup_status()
        return state
