"""
radiation_onc_workflow — backend agent platform that populates the
RadiationOncologyIntelligence dashboard from the radiotherapy databases.

One agent per dashboard module, built in data-readiness order. Module 09
(Documentation) is the first fully-built vertical slice.
"""

from .state import ModuleResult, Row, success_envelope, error_envelope
from .workflow import run_module, run_module_envelope, available_modules, get_agent

__all__ = [
    "ModuleResult",
    "Row",
    "success_envelope",
    "error_envelope",
    "run_module",
    "run_module_envelope",
    "available_modules",
    "get_agent",
]
