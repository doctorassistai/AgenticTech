"""FastAPI router for the Surgical Oncology Intelligence dashboard.

Frontend path: `getDashboard()` in components/surgical-oncology/shared/api.js calls
    {VITE_BACKEND_URL}hms/users/ai-legacy/surgical-oncology/dashboard/{patient_id}

So this router is mounted under the agentic prefix `/hms/users/ai-legacy`
(e.g. `app.include_router(dashboard_router, prefix="/hms/users/ai-legacy")`) —
NOT under /hms/users/data where the CRUD surgical-oncology router lives.

CACHING: the 12-agent pipeline is expensive, so it does NOT run on every page visit.
  - GET  /dashboard/{id}             → returns the latest stored snapshot; only if NONE
                                        exists does it run the pipeline once and store it.
  - POST /dashboard/{id}/regenerate  → always re-runs the pipeline and INSERTS a new
                                        snapshot (history is kept — see store.py).
  - GET  /dashboard/{id}/history     → snapshot metadata (versions + timestamps).

The ONLY collection written is `surgical_onco_agentic` (see store.py). Every source
collection stays strictly read-only.
"""

import os
from datetime import datetime

from fastapi import APIRouter, HTTPException
from langchain_groq import ChatGroq
from loguru import logger

from .workflow import create_dashboard_workflow
from .store import get_latest_dashboard, save_dashboard, list_dashboard_history

router = APIRouter(prefix="/surgical-oncology", tags=["Surgical Oncology Dashboard"])

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

# One workflow graph, compiled once and reused across requests.
_llm = ChatGroq(model="openai/gpt-oss-120b", temperature=0.1, api_key=GROQ_API_KEY)
_graph = create_dashboard_workflow(_llm)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _display_stamp(iso: str) -> str:
    """Human-readable 'Report Generated' cell value from a stored ISO timestamp."""
    if not iso:
        return ""
    try:
        return datetime.fromisoformat(iso).strftime("%d %b %Y, %H:%M UTC")
    except ValueError:
        return iso


def _core_from_final(final: dict) -> dict:
    """Reduce the raw LangGraph output to the plain-dict payload we persist."""
    modules = final.get("modules") or {}
    return {
        "patient": final.get("patient", {}),
        "kpis": final.get("kpis", {}),
        "modules": {
            mid: (m.model_dump() if hasattr(m, "model_dump") else m)
            for mid, m in modules.items()
        },
        "warnings": final.get("warnings", []),
    }


def _payload_from_doc(doc: dict, cached: bool) -> dict:
    """Shape a stored snapshot into the frontend response contract. The patient strip's
    'reportGenerated' cell is stamped from the snapshot's true generation time (not now),
    so a cached load shows when it was actually built."""
    patient = dict(doc.get("patient") or {})
    patient["reportGenerated"] = {"value": _display_stamp(doc.get("generated_at", ""))}
    return {
        "success": True,
        "patient_id": doc.get("patient_id"),
        "cached": cached,                       # True = loaded, False = freshly generated
        "version": doc.get("version"),
        "generated_at": doc.get("generated_at", ""),
        "patient": patient,
        "kpis": doc.get("kpis", {}),
        "modules": doc.get("modules", {}),
        "warnings": doc.get("warnings", []),
    }


async def _run_and_store(patient_id: str) -> dict:
    """Run the 12-agent pipeline once and persist the result as a new snapshot."""
    final = await _graph.ainvoke({"patient_id": patient_id})
    doc = await save_dashboard(patient_id, _core_from_final(final))
    logger.info(f"[dashboard] stored v{doc.get('version')} for {patient_id}")
    return doc


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get(
    "/dashboard/{patient_id}",
    responses={404: {"description": "No surgery record for patient"}},
)
async def get_dashboard(patient_id: str):
    """Load the latest stored snapshot; generate + store once if none exists yet."""
    logger.info("━" * 60)
    logger.info(f"[dashboard] GET patient_id={patient_id}")
    try:
        existing = await get_latest_dashboard(patient_id)
        if existing:
            logger.info(f"[dashboard] serving cached v{existing.get('version')}")
            return _payload_from_doc(existing, cached=True)

        logger.info("[dashboard] no snapshot yet → generating")
        doc = await _run_and_store(patient_id)
        return _payload_from_doc(doc, cached=False)
    except Exception as e:  # noqa: BLE001
        logger.error(f"[dashboard] GET failed for {patient_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Dashboard build failed: {e}")


@router.post(
    "/dashboard/{patient_id}/regenerate",
    responses={500: {"description": "Pipeline failed"}},
)
async def regenerate_dashboard(patient_id: str):
    """Always re-run the pipeline and insert a NEW snapshot (keeps history)."""
    logger.info("━" * 60)
    logger.info(f"[dashboard] REGENERATE patient_id={patient_id}")
    try:
        doc = await _run_and_store(patient_id)
        return _payload_from_doc(doc, cached=False)
    except Exception as e:  # noqa: BLE001
        logger.error(f"[dashboard] regenerate failed for {patient_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Dashboard regeneration failed: {e}")


@router.get("/dashboard/{patient_id}/history")
async def get_dashboard_history(patient_id: str):
    """Snapshot metadata (version + timestamp + warning count), newest first."""
    try:
        history = await list_dashboard_history(patient_id)
        return {"success": True, "patient_id": patient_id, "history": history}
    except Exception as e:  # noqa: BLE001
        logger.error(f"[dashboard] history failed for {patient_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Dashboard history failed: {e}")
