"""
api.py — Radiation Oncology Intelligence API + Doctor Skill API.

Existing dashboard routes are preserved exactly. The Skill routes are added
under the same radiotherapyagents router namespace.

The Skill is a configuration/filter layer over the existing radiation oncology
agents. It does not modify the agents or perform duplicate clinical calculations.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

try:
    from fastapi import APIRouter, FastAPI, HTTPException, Query
    from fastapi.responses import Response
    from pydantic import BaseModel, Field
except ImportError:  # pragma: no cover
    APIRouter = None  # type: ignore

from Agentic.radiation_onc_workflow import store
from Agentic.radiation_onc_workflow.workflow import (
    available_modules,
    get_or_generate,
    get_or_generate_dashboard,
    regenerate,
    regenerate_dashboard,
)


if APIRouter is not None:

    # ============================================================
    # Existing radiation intelligence API
    # ============================================================

    class RegenerateRequest(BaseModel):
        patientId: Optional[str] = None
        doctorId: Optional[str] = None

    router = APIRouter(
        prefix="/radiotherapyagents",
        tags=["radiation-oncology"],
    )

    @router.on_event("startup")
    async def _startup() -> None:
        try:
            await store.ensure_indexes()
        except Exception:
            pass

        try:
            from .radiation_oncology_skill_service import ensure_indexes as skill_indexes
            await skill_indexes()
        except Exception:
            pass

    @router.get("/modules")
    async def list_modules() -> Dict[str, Any]:
        return {
            "status": "success",
            "data": {
                "modules": available_modules()
            },
        }

    @router.get("/dashboard")
    async def load_dashboard(
        patientId: Optional[str] = Query(default=None),
        doctorId: Optional[str] = Query(default=None),
    ) -> Dict[str, Any]:
        return await _guard(
            lambda: get_or_generate_dashboard(
                patientId,
                doctorId,
            )
        )

    @router.post("/dashboard/regenerate")
    async def regenerate_dashboard_route(
        payload: RegenerateRequest,
    ) -> Dict[str, Any]:
        return await _guard(
            lambda: regenerate_dashboard(
                payload.patientId,
                payload.doctorId,
            )
        )

    @router.get("/module/{slug}")
    async def load_module(
        slug: str,
        patientId: Optional[str] = Query(default=None),
        doctorId: Optional[str] = Query(default=None),
    ) -> Dict[str, Any]:
        return await _guard(
            lambda: get_or_generate(
                slug,
                patientId,
                doctorId,
            )
        )

    @router.post("/module/{slug}/regenerate")
    async def regenerate_module(
        slug: str,
        payload: RegenerateRequest,
    ) -> Dict[str, Any]:
        return await _guard(
            lambda: regenerate(
                slug,
                payload.patientId,
                payload.doctorId,
            )
        )

    @router.get("/module/{slug}/history")
    async def module_history(
        slug: str,
        patientId: Optional[str] = Query(default=None),
    ) -> Dict[str, Any]:
        versions = await store.list_versions(
            patientId,
            slug,
        )

        return {
            "status": "success",
            "data": {
                "versions": versions
            },
        }

    @router.get("/documentation")
    async def documentation(
        patientId: Optional[str] = Query(default=None),
        doctorId: Optional[str] = Query(default=None),
    ) -> Dict[str, Any]:
        return await _guard(
            lambda: get_or_generate(
                "documentation",
                patientId,
                doctorId,
            )
        )

    @router.post("/documentation/regenerate")
    async def documentation_regenerate(
        payload: RegenerateRequest,
    ) -> Dict[str, Any]:
        return await _guard(
            lambda: regenerate(
                "documentation",
                payload.patientId,
                payload.doctorId,
            )
        )

    async def _guard(coro_factory) -> Dict[str, Any]:
        try:
            return await coro_factory()
        except KeyError as exc:
            raise HTTPException(
                status_code=404,
                detail=str(exc),
            )
        except RuntimeError as exc:
            raise HTTPException(
                status_code=503,
                detail=str(exc),
            )
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                status_code=500,
                detail=str(exc),
            )

    # ============================================================
    # Radiation Oncology Intelligence Skill API
    # ============================================================

    from .radiation_oncology_skill_service import (
        activate_skill,
        add_custom_parameter,
        edit_skill_parameter,
        generate_doctor_skill_output,
        generate_skill_markdown,
        get_doctor_skill_configuration,
        get_saved_skill_test_output,
        get_skill_catalog,
        save_doctor_skill_configuration,
        save_skill_test_output,
    )

    class SkillConfigurationRequest(BaseModel):
        doctor_id: str
        enabled_parameters: List[str] = Field(default_factory=list)
        skill_name: Optional[str] = None
        active: bool = False
        parameter_overrides: Dict[str, Any] = Field(default_factory=dict)
        custom_parameters: List[Dict[str, Any]] = Field(default_factory=list)

    class EditSkillParameterRequest(BaseModel):
        doctor_id: str
        name: Optional[str] = None
        description: Optional[str] = None

    class CustomSkillParameterRequest(BaseModel):
        doctor_id: str
        name: str
        description: str = ""

    class SkillActivationRequest(BaseModel):
        doctor_id: str
        active: bool

    class SkillTestRequest(BaseModel):
        doctor_id: str
        patient_id: str
        force_regenerate: bool = False

    # ------------------------------------------------------------
    # Catalog
    # ------------------------------------------------------------

    @router.get("/skills/radiation-oncology/catalog")
    async def radiation_skill_catalog() -> Dict[str, Any]:
        return {
            "status": "success",
            "data": get_skill_catalog(),
        }

    # ------------------------------------------------------------
    # Configuration
    # ------------------------------------------------------------

    @router.get("/skills/radiation-oncology/configuration")
    async def radiation_skill_configuration(
        doctorId: str = Query(...),
    ) -> Dict[str, Any]:

        try:
            data = await get_doctor_skill_configuration(
                doctor_id=doctorId,
            )

            return {
                "status": "success",
                "data": data,
            }

        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=str(exc),
            )

    @router.put("/skills/radiation-oncology/configuration")
    async def save_radiation_skill_configuration(
        payload: SkillConfigurationRequest,
    ) -> Dict[str, Any]:

        try:
            data = await save_doctor_skill_configuration(
                doctor_id=payload.doctor_id,
                enabled_parameters=payload.enabled_parameters,
                skill_name=payload.skill_name,
                active=payload.active,
                parameter_overrides=payload.parameter_overrides,
                custom_parameters=payload.custom_parameters,
            )

            return {
                "status": "success",
                "data": data,
            }

        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail=str(exc),
            )

        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=str(exc),
            )

    # ------------------------------------------------------------
    # Edit predefined parameter
    # ------------------------------------------------------------

    @router.patch("/skills/radiation-oncology/parameters/{parameter_id}")
    async def edit_radiation_skill_parameter(
        parameter_id: str,
        payload: EditSkillParameterRequest,
    ) -> Dict[str, Any]:

        try:
            data = await edit_skill_parameter(
                doctor_id=payload.doctor_id,
                parameter_id=parameter_id,
                name=payload.name,
                description=payload.description,
            )

            return {
                "status": "success",
                "data": data,
            }

        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail=str(exc),
            )

        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=str(exc),
            )

    # ------------------------------------------------------------
    # Add doctor custom parameter
    # ------------------------------------------------------------

    @router.post("/skills/radiation-oncology/parameters/custom")
    async def add_radiation_custom_parameter(
        payload: CustomSkillParameterRequest,
    ) -> Dict[str, Any]:

        try:
            data = await add_custom_parameter(
                doctor_id=payload.doctor_id,
                name=payload.name,
                description=payload.description,
            )

            return {
                "status": "success",
                "data": data,
            }

        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail=str(exc),
            )

        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=str(exc),
            )

    # ------------------------------------------------------------
    # Activate / deactivate
    # ------------------------------------------------------------

    @router.post("/skills/radiation-oncology/activation")
    async def radiation_skill_activation(
        payload: SkillActivationRequest,
    ) -> Dict[str, Any]:

        try:
            data = await activate_skill(
                doctor_id=payload.doctor_id,
                active=payload.active,
            )

            return {
                "status": "success",
                "data": data,
            }

        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=str(exc),
            )

    # ------------------------------------------------------------
    # Saved complete test output
    # ------------------------------------------------------------

    @router.get("/skills/radiation-oncology/test-output")
    async def radiation_skill_saved_test_output(
        doctorId: str = Query(...),
        patientId: str = Query(...),
    ) -> Dict[str, Any]:
        """
        Return the last COMPLETE patient-specific Skill test output.

        This is intentionally separate from the Skill configuration endpoint.
        Configuration stores doctor selections; this endpoint returns the
        patient-specific output produced by those selections.
        """
        try:
            data = await get_saved_skill_test_output(
                doctor_id=doctorId,
                patient_id=patientId,
            )

            return {
                "status": "success",
                "data": data,
                "found": data is not None,
            }

        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=str(exc),
            )

    # ------------------------------------------------------------
    # Test
    # ------------------------------------------------------------

    @router.post("/skills/radiation-oncology/test")
    async def radiation_skill_test(
        payload: SkillTestRequest,
    ) -> Dict[str, Any]:

        try:
            data = await generate_doctor_skill_output(
                doctor_id=payload.doctor_id,
                patient_id=payload.patient_id,
                force_regenerate=payload.force_regenerate,
            )

            # `data.results[*].output` contains the COMPLETE original backend
            # row for each selected predefined parameter. Do not flatten or
            # reconstruct these objects here.
            complete_results = [
                item
                for item in (data.get("results") or [])
                if isinstance(item, dict)
            ]

            return {
                "status": "success",
                "data": data,
                "complete_output": complete_results,
                "complete_output_count": len(complete_results),
                "output_saved": True,
            }

        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail=str(exc),
            )

        except KeyError as exc:
            raise HTTPException(
                status_code=404,
                detail=str(exc),
            )

        except RuntimeError as exc:
            raise HTTPException(
                status_code=503,
                detail=str(exc),
            )

        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=str(exc),
            )

    # ------------------------------------------------------------
    # Markdown export
    # ------------------------------------------------------------

    @router.get("/skills/radiation-oncology/export")
    async def radiation_skill_export(
        doctorId: str = Query(...),
        patientId: Optional[str] = Query(default=None),
        forceRegenerate: bool = Query(default=False),
    ):
        try:
            markdown = await generate_skill_markdown(
                doctor_id=doctorId,
                patient_id=patientId,
                force_regenerate=forceRegenerate,
            )

            return Response(
                content=markdown,
                media_type="text/markdown; charset=utf-8",
                headers={
                    "Content-Disposition":
                        'attachment; filename="radiation_oncology_skill.md"'
                },
            )

        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail=str(exc),
            )

        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=str(exc),
            )

    # ============================================================
    # Application factory
    # ============================================================

    def create_app() -> "FastAPI":
        app = FastAPI(
            title="Radiation Oncology Intelligence Agents"
        )

        app.include_router(router)

        return app

else:
    router = None
