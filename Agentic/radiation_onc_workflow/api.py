"""
api.py — FastAPI router exposing the module-agents with a persistent cache.

Mounted under /radiation-oncology. Routes:

  GET  /radiation-oncology/modules
  GET  /radiation-oncology/module/{slug}?patientId=...          load-or-generate
  POST /radiation-oncology/module/{slug}/regenerate {patientId} new version
  GET  /radiation-oncology/module/{slug}/history?patientId=...  version history
  GET  /radiation-oncology/documentation?patientId=...          convenience (m9)
  POST /radiation-oncology/documentation/regenerate {patientId} convenience (m9)

Envelope: {"status":"success","cached":bool,"version":int,"generatedAt":...,"data":{...}}
The `data` object is exactly what RadiationOncologyIntelligence.jsx renders.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

try:
    from fastapi import APIRouter, FastAPI, HTTPException, Query
    from pydantic import BaseModel
except ImportError:  # pragma: no cover - allows import without FastAPI installed
    APIRouter = None  # type: ignore

from . import store
from .workflow import (
    available_modules,
    get_or_generate,
    get_or_generate_dashboard,
    regenerate,
    regenerate_dashboard,
)


if APIRouter is not None:

    class RegenerateRequest(BaseModel):
        patientId: Optional[str] = None
        doctorId: Optional[str] = None

    router = APIRouter(prefix="/radiotherapyagents", tags=["radiation-oncology"])


    @router.on_event("startup")
    async def _startup() -> None:  # pragma: no cover - infra
        try:
            await store.ensure_indexes()
        except Exception:
            pass  # indexes are an optimization, not a hard requirement

    @router.get("/modules")
    async def list_modules() -> Dict[str, Any]:
        return {"status": "success", "data": {"modules": available_modules()}}

    # ── whole-dashboard routes (ONE call runs every registered agent) ─────────
    @router.get("/dashboard")
    async def load_dashboard(
        patientId: Optional[str] = Query(default=None),
        doctorId: Optional[str] = Query(default=None),
    ) -> Dict[str, Any]:
        """Single page-visit call: load-or-generate every registered module at once."""
        return await _guard(lambda: get_or_generate_dashboard(patientId, doctorId))

    @router.post("/dashboard/regenerate")
    async def regenerate_dashboard_route(payload: RegenerateRequest) -> Dict[str, Any]:
        """Single regenerate call: run every registered module fresh + new version."""
        return await _guard(
            lambda: regenerate_dashboard(payload.patientId, payload.doctorId)
        )

    # ── generic module routes ────────────────────────────────────────────────
    @router.get("/module/{slug}")
    async def load_module(
        slug: str,
        patientId: Optional[str] = Query(default=None),
        doctorId: Optional[str] = Query(default=None),
    ) -> Dict[str, Any]:
        """Page-visit path: latest saved version, or generate on first ever visit."""
        return await _guard(lambda: get_or_generate(slug, patientId, doctorId))

    @router.post("/module/{slug}/regenerate")
    async def regenerate_module(slug: str, payload: RegenerateRequest) -> Dict[str, Any]:
        """Regenerate button: run the agent and store a new version."""
        return await _guard(lambda: regenerate(slug, payload.patientId, payload.doctorId))

    @router.get("/module/{slug}/history")
    async def module_history(
        slug: str, patientId: Optional[str] = Query(default=None)
    ) -> Dict[str, Any]:
        versions = await store.list_versions(patientId, slug)
        return {"status": "success", "data": {"versions": versions}}

    # ── convenience routes for Module 09 ─────────────────────────────────────
    @router.get("/documentation")
    async def documentation(
        patientId: Optional[str] = Query(default=None),
        doctorId: Optional[str] = Query(default=None),
    ) -> Dict[str, Any]:
        return await _guard(lambda: get_or_generate("documentation", patientId, doctorId))

    @router.post("/documentation/regenerate")
    async def documentation_regenerate(payload: RegenerateRequest) -> Dict[str, Any]:
        return await _guard(
            lambda: regenerate("documentation", payload.patientId, payload.doctorId)
        )

    async def _guard(coro_factory) -> Dict[str, Any]:
        try:
            return await coro_factory()
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc))
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc))
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=str(exc))

    def create_app() -> "FastAPI":
        app = FastAPI(title="Radiation Oncology Intelligence Agents")
        app.include_router(router)
        return app
