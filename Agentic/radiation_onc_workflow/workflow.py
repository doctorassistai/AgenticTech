"""
workflow.py — Agent registry, runner, and cache-aware orchestration.

Maps dashboard module slugs/ids to their agent classes. As each new Phase-1..3 agent
is built it is added to REGISTRY; nothing else changes.

Caching policy (see store.py): agents do NOT run on every page visit.
    get_or_generate() → load latest saved version; generate + save only if none exists
    regenerate()      → always run the agent and save a NEW version (silent history)
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional, Type

from . import store
from .agents.analytics import AnalyticsAgent
from .agents.base import BaseAgent
from .agents.delivery import DeliveryAgent
from .agents.documentation import DocumentationAgent
from .agents.dose import DoseAgent
from .agents.gaps import GapsAgent
from .agents.mdt import MDTAgent
from .agents.physics import PhysicsAgent
from .agents.planning import PlanningAgent
from .agents.quality import QualityAgent
from .agents.readiness import ReadinessAgent
from .agents.response import ResponseAgent
from .agents.toxicity import ToxicityAgent
from .data_sources import RTDataSource, get_data_source
from .header import build_header
from .state import ModuleResult, success_envelope

# slug + moduleId → agent. Extend as modules 06/07/05/… are built.
REGISTRY: Dict[str, Type[BaseAgent]] = {
    "documentation": DocumentationAgent,
    "m9": DocumentationAgent,
    "readiness": ReadinessAgent,
    "m1": ReadinessAgent,
    "planning": PlanningAgent,
    "m2": PlanningAgent,
    "dose": DoseAgent,
    "m3": DoseAgent,
    "quality": QualityAgent,
    "m4": QualityAgent,
    "delivery": DeliveryAgent,
    "m5": DeliveryAgent,
    "gaps": GapsAgent,
    "m6": GapsAgent,
    "toxicity": ToxicityAgent,
    "m7": ToxicityAgent,
    "response": ResponseAgent,
    "m8": ResponseAgent,
    "physics": PhysicsAgent,
    "m10": PhysicsAgent,
    "mdt": MDTAgent,
    "m11": MDTAgent,
    "analytics": AnalyticsAgent,
    "m12": AnalyticsAgent,
}


def available_modules() -> List[str]:
    return sorted({cls.slug for cls in REGISTRY.values()})


def _distinct_agents() -> List[Type[BaseAgent]]:
    """Each registered agent once (REGISTRY maps both slug and mN to the same class)."""
    seen: set = set()
    out: List[Type[BaseAgent]] = []
    for cls in REGISTRY.values():
        if cls.slug not in seen:
            seen.add(cls.slug)
            out.append(cls)
    return out


def get_agent(module: str, data_source: Optional[RTDataSource] = None) -> BaseAgent:
    key = module.lower().strip()
    if key not in REGISTRY:
        raise KeyError(f"No agent registered for module '{module}'. "
                       f"Available: {available_modules()}")
    return REGISTRY[key](data_source or get_data_source())


# ── raw run (no persistence) ─────────────────────────────────────────────────
async def run_module(
    module: str,
    patient_id: Optional[str] = None,
    data_source: Optional[RTDataSource] = None,
) -> ModuleResult:
    return await get_agent(module, data_source).run(patient_id)


# ── cache-aware orchestration (persists to radiation_onco_agentic) ───────────
async def get_or_generate(
    module: str,
    patient_id: Optional[str] = None,
    doctor_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Page-visit path: return the latest saved generation; generate + save only if this
    module has never been generated for the patient. Response marks whether it was
    served from cache.
    """
    agent = get_agent(module)  # validates slug + DB config early
    cached = await store.get_latest(patient_id, agent.slug)
    if cached is not None:
        return _envelope(cached, cached_hit=True)

    result = await agent.run(patient_id)
    saved = await store.save(result.to_dict(), patient_id=patient_id, doctor_id=doctor_id)
    return _envelope(saved, cached_hit=False)


async def regenerate(
    module: str,
    patient_id: Optional[str] = None,
    doctor_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Regenerate-button path: always run the agent fresh and insert a NEW version.
    Prior versions are retained as silent history.
    """
    agent = get_agent(module)
    result = await agent.run(patient_id)
    saved = await store.save(result.to_dict(), patient_id=patient_id, doctor_id=doctor_id)
    return _envelope(saved, cached_hit=False)


def _envelope(stored: Dict[str, Any], *, cached_hit: bool) -> Dict[str, Any]:
    """Universal envelope, enriched with version/cache metadata for the frontend."""
    return {
        "status": "success",
        "cached": cached_hit,
        "version": stored.get("version"),
        "generatedAt": stored.get("generatedAt"),
        "data": stored.get("data"),
    }


async def run_module_envelope(
    module: str,
    patient_id: Optional[str] = None,
    data_source: Optional[RTDataSource] = None,
) -> Dict[str, Any]:
    """Stateless run without persistence (used by tooling/tests)."""
    return success_envelope(await run_module(module, patient_id, data_source))


# ── whole-dashboard fan-out (ONE call runs every registered agent) ───────────
async def _one_module(fn, slug: str) -> Optional[Dict[str, Any]]:
    """Run a single module op; swallow its error so one bad agent can't sink the load."""
    try:
        return await fn(slug)
    except Exception:  # noqa: BLE001 - a failed module is simply omitted from the map
        return None


async def get_or_generate_dashboard(
    patient_id: Optional[str] = None,
    doctor_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Page-visit path for the WHOLE dashboard: load-or-generate every registered module
    concurrently and return them keyed by moduleId. Adding an agent to REGISTRY is all
    it takes to appear here — the frontend makes a single call and never maintains a list.
    """
    agents = _distinct_agents()
    results = await asyncio.gather(
        *(_one_module(lambda s: get_or_generate(s, patient_id, doctor_id), a.slug)
          for a in agents)
    )
    return await _with_header(_dashboard_map(agents, results), patient_id)


async def regenerate_dashboard(
    patient_id: Optional[str] = None,
    doctor_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Regenerate-button path for the WHOLE dashboard: run every module fresh + new version."""
    agents = _distinct_agents()
    results = await asyncio.gather(
        *(_one_module(lambda s: regenerate(s, patient_id, doctor_id), a.slug)
          for a in agents)
    )
    return await _with_header(_dashboard_map(agents, results), patient_id)


async def _with_header(
    dashboard: Dict[str, Any], patient_id: Optional[str]
) -> Dict[str, Any]:
    """Attach the header strip + KPI roll-up. A header failure never sinks the dashboard."""
    try:
        dashboard["header"] = await build_header(patient_id, dashboard.get("modules"))
    except Exception:  # noqa: BLE001 - header is a summary; omit it if it can't be built
        dashboard["header"] = None
    return dashboard


def _dashboard_map(
    agents: List[Type[BaseAgent]], results: List[Optional[Dict[str, Any]]]
) -> Dict[str, Any]:
    """Shape: {"status":"success","modules":{ "m1": {envelope}, "m9": {envelope}, ... }}."""
    modules: Dict[str, Any] = {}
    for agent, env in zip(agents, results):
        if env is not None:
            modules[agent.moduleId] = env
    return {"status": "success", "modules": modules}
