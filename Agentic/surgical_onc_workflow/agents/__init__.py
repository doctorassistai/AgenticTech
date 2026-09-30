"""Dashboard agents — one per frontend module (m1…m12).

Each agent is a small class following the same pattern (see `base.BaseDashboardAgent`):
slice its own data → guard empty → LLM structured output → reconcile row names.
Currently wired: m1 (ReadinessAgent).
"""

from .m1_readiness import ReadinessAgent
from .m2_staging import StagingAgent
from .m3_safety import SafetyAgent
from .m4_pathology_margin import PathologyMarginAgent
from .m5_postop import PostopAgent
from .m6_quality import QualityAgent
from .m7_adjuvant import AdjuvantAgent
from .m8_surveillance import SurveillanceAgent
from .m9_documentation import DocumentationAgent
from .m10_mdt import MDTAgent
from .m11_pathology_intel import PathologyIntelAgent
from .m12_department import DepartmentAgent

__all__ = ["ReadinessAgent", "StagingAgent", "SafetyAgent", "PathologyMarginAgent", "PostopAgent", "QualityAgent", "AdjuvantAgent", "SurveillanceAgent", "DocumentationAgent", "MDTAgent", "PathologyIntelAgent", "DepartmentAgent"]
