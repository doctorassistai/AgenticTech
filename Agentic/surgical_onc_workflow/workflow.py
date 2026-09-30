"""Graph wiring - fan-out to the 12 module agents, fan-in to `assemble`.

All 12 agents (m1..m12) are wired. Adding/replacing an agent = one line in `build_agents`
(and its title in `MODULE_TITLES`); the fan-out / fan-in edges and the empty-module
backfill in `assemble` pick it up automatically.

`assemble` also derives the 6-slot KPI strip DETERMINISTICALLY (no extra LLM call) by
re-projecting specific rows the agents already produced - see `_derive_kpis`.
"""

from typing import Any, Dict

from langgraph.graph import StateGraph, END
from loguru import logger

from .state import SurgicalDashboardState, ModuleResult
from .data_sources import assemble_state
from .agents import ReadinessAgent, StagingAgent, SafetyAgent, PathologyMarginAgent, PostopAgent, QualityAgent, AdjuvantAgent, SurveillanceAgent, DocumentationAgent, MDTAgent, PathologyIntelAgent, DepartmentAgent

# Every dashboard module id the frontend renders (used to backfill missing agents).
ALL_MODULE_IDS = [f"m{i}" for i in range(1, 13)]

MODULE_TITLES = {
    "m1": "Patient Assessment & Surgical Readiness",
    "m2": "Diagnosis, Staging & Surgical Planning",
    "m3": "Surgical Safety & Intraoperative Intelligence",
    "m4": "Pathology Correlation & Margin Intelligence",
    "m5": "Post-operative Management",
    "m6": "Surgical Quality & Outcome Analytics",
    "m7": "Adjuvant Therapy Decision Support",
    "m8": "Follow-up & Recurrence Surveillance",
    "m9": "Documentation & Clinical Intelligence",
    "m10": "Multidisciplinary Oncology Intelligence",
    "m11": "Surgical Pathology Intelligence",
    "m12": "Department Analytics & Operations",
}


def _empty_module(mid: str) -> ModuleResult:
    return ModuleResult(module_id=mid, title=MODULE_TITLES.get(mid, ""), rows=[])


# ─── KPI strip (deterministic re-projection of agent rows) ───────────────────

# Each headline KPI maps to ONE row an agent already produced. First present row
# with a usable finding wins (so the KPI degrades gracefully if a module is empty).
_KPI_SOURCES = {
    "resectionStatus":   [("m6", "R0/R1/R2 Resection"), ("m4", "Margin Status Analysis")],
    "stageDiscordance":  [("m4", "Upstaging / Downstaging Detection")],
    "complications":     [("m5", "Clavien-Dindo Classification"),
                          ("m5", "Post-operative Complication Prediction")],
    "nodeYield":         [("m4", "Lymph Node Yield")],
    "adjuvantDecision":  [("m7", "Adjuvant Chemotherapy Recommendation"),
                          ("m7", "MDT Recommendation Generator")],
    "dischargeReadiness":[("m5", "Discharge Readiness Assessment")],
}

# status enum -> the short uppercase word shown under the KPI value.
_KPI_NOTE = {
    "ok": "ON TRACK", "watch": "MONITOR", "alert": "ALERT",
    "flag": "FLAGGED", "info": "NOTED", "neutral": "PENDING",
}


def _find_row(modules: Dict[str, ModuleResult], mid: str, parameter: str):
    mod = modules.get(mid)
    for row in (getattr(mod, "rows", None) or []):
        if row.parameter == parameter:
            return row
    return None


def _kpi_value(row) -> str:
    """A short headline for the KPI card. Use the actual clinical finding (e.g. 'R0',
    'Stage III') — NOT statusLabel, which is now a generic signal word (Noted/Normal/
    Review). Trim to ~32 chars; 'Not available' when the finding is empty."""
    finding = (row.finding or "").strip()
    if not finding or finding == "Not available":
        return "Not available"
    return finding if len(finding) <= 32 else finding[:29].rstrip() + "…"


def _derive_kpis(modules: Dict[str, ModuleResult]) -> Dict[str, Dict[str, str]]:
    """Build the 6 KPI cells from rows the agents already produced. Deterministic —
    no LLM, no fabrication: a KPI is only as populated as its source row."""
    kpis: Dict[str, Dict[str, str]] = {}
    for key, sources in _KPI_SOURCES.items():
        row = None
        for mid, parameter in sources:
            candidate = _find_row(modules, mid, parameter)
            # Prefer a row that actually carries content over a 'Not available' default.
            # statusLabel is now always a generic signal word, so it can't signal content —
            # judge by the finding alone.
            if candidate is not None:
                row = candidate
                if (candidate.finding or "").strip() not in ("", "Not available"):
                    break
        if row is None:
            kpis[key] = {"value": "Not available", "status": "neutral", "note": "PENDING"}
        else:
            status = row.status or "neutral"
            kpis[key] = {
                "value": _kpi_value(row),
                "status": status,
                "note": _KPI_NOTE.get(status, "PENDING"),
            }
    return kpis


def build_agents(llm) -> Dict[str, Any]:
    """Node-name → agent instance. Add m5..m12 here as they come online."""
    return {
        "agent_m1": ReadinessAgent(llm),
        "agent_m2": StagingAgent(llm),
        "agent_m3": SafetyAgent(llm),
        "agent_m4": PathologyMarginAgent(llm),
        "agent_m5": PostopAgent(llm),
        "agent_m6": QualityAgent(llm),
        "agent_m7": AdjuvantAgent(llm),
        "agent_m8": SurveillanceAgent(llm),
        "agent_m9": DocumentationAgent(llm),
        "agent_m10": MDTAgent(llm),
        "agent_m11": PathologyIntelAgent(llm),
        "agent_m12": DepartmentAgent(llm),
    }


async def load_data(state: SurgicalDashboardState) -> Dict[str, Any]:
    """Read the patient's record(s) once (read-only) and seed the shared state."""
    pid = state["patient_id"]
    logger.info(f"[load_data] patient_id={pid}")
    seed = await assemble_state(pid)
    logger.info(f"[load_data] {len(seed.get('all_bookings', []))} booking(s), "
                f"{len(seed.get('labs', {}))} lab key(s)")
    return seed


async def assemble(state: SurgicalDashboardState) -> Dict[str, Any]:
    """Fan-in: guarantee every module id exists even if an agent isn't wired yet, then
    derive the KPI strip from the produced rows (deterministic, no LLM)."""
    produced = state.get("modules") or {}
    modules = {mid: produced.get(mid) or _empty_module(mid) for mid in ALL_MODULE_IDS}
    kpis = _derive_kpis(modules)
    return {"modules": modules, "kpis": kpis}


def create_dashboard_workflow(llm):
    agents = build_agents(llm)

    g = StateGraph(SurgicalDashboardState)
    g.add_node("load_data", load_data)
    g.add_node("assemble", assemble)
    for name, agent in agents.items():
        g.add_node(name, agent.run)

    g.set_entry_point("load_data")
    for name in agents:            # fan-out (parallel)
        g.add_edge("load_data", name)
        g.add_edge(name, "assemble")   # fan-in
    g.add_edge("assemble", END)

    return g.compile()
