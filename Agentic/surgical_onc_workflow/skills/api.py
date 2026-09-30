"""FastAPI router for Surgical Oncology Intelligence + Doctor Skill configuration.

The existing dashboard routes remain unchanged. The Skill endpoints are added to
the SAME router so the platform mount remains:

/hms/users/ai-legacy/surgical-oncology/...

Skill routes:
/hms/users/ai-legacy/surgical-oncology/skills/surgical-oncology/...
"""

import os
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import PlainTextResponse
from langchain_groq import ChatGroq
from loguru import logger
from pydantic import BaseModel, ConfigDict, Field

from Agentic.surgical_onc_workflow.workflow import create_dashboard_workflow
from Agentic.surgical_onc_workflow.store import get_latest_dashboard, save_dashboard, list_dashboard_history
from .surgical_oncology_skill_service import (
    get_skill_catalog,
    get_doctor_skill_configuration,
    save_doctor_skill_configuration,
    edit_skill_parameter,
    add_custom_parameter,
    activate_skill,
    generate_doctor_skill_output,
    generate_skill_markdown,
    ensure_indexes,
)

router = APIRouter(prefix="/surgical-oncology", tags=["Surgical Oncology Dashboard"])

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
_llm = ChatGroq(model="openai/gpt-oss-120b", temperature=0.1, api_key=GROQ_API_KEY)
_graph = create_dashboard_workflow(_llm)


# ============================================================
# Existing dashboard helpers/routes
# ============================================================

def _display_stamp(iso: str) -> str:
    if not iso:
        return ""
    try:
        return datetime.fromisoformat(iso).strftime("%d %b %Y, %H:%M UTC")
    except ValueError:
        return iso


def _core_from_final(final: dict) -> dict:
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
    patient = dict(doc.get("patient") or {})
    patient["reportGenerated"] = {
        "value": _display_stamp(doc.get("generated_at", ""))
    }
    return {
        "success": True,
        "patient_id": doc.get("patient_id"),
        "cached": cached,
        "version": doc.get("version"),
        "generated_at": doc.get("generated_at", ""),
        "patient": patient,
        "kpis": doc.get("kpis", {}),
        "modules": doc.get("modules", {}),
        "warnings": doc.get("warnings", []),
    }


async def _run_and_store(patient_id: str) -> dict:
    final = await _graph.ainvoke({"patient_id": patient_id})
    doc = await save_dashboard(patient_id, _core_from_final(final))
    logger.info(f"[dashboard] stored v{doc.get('version')} for {patient_id}")
    return doc


@router.get("/dashboard/{patient_id}")
async def get_dashboard(patient_id: str):
    try:
        existing = await get_latest_dashboard(patient_id)
        if existing:
            return _payload_from_doc(existing, cached=True)
        doc = await _run_and_store(patient_id)
        return _payload_from_doc(doc, cached=False)
    except Exception as e:
        logger.error(f"[dashboard] GET failed for {patient_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Dashboard build failed: {e}")


@router.post("/dashboard/{patient_id}/regenerate")
async def regenerate_dashboard(patient_id: str):
    try:
        doc = await _run_and_store(patient_id)
        return _payload_from_doc(doc, cached=False)
    except Exception as e:
        logger.error(f"[dashboard] regenerate failed for {patient_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Dashboard regeneration failed: {e}")


@router.get("/dashboard/{patient_id}/history")
async def get_dashboard_history(patient_id: str):
    try:
        history = await list_dashboard_history(patient_id)
        return {"success": True, "patient_id": patient_id, "history": history}
    except Exception as e:
        logger.error(f"[dashboard] history failed for {patient_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Dashboard history failed: {e}")


# ============================================================
# Skill request models
# ============================================================

class SkillConfigurationRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    doctor_id: str = Field(..., alias="doctorId")
    enabled_parameters: List[str] = Field(default_factory=list, alias="enabledParameters")
    skill_name: Optional[str] = Field(None, alias="skillName")
    active: bool = False
    parameter_overrides: Dict[str, Any] = Field(default_factory=dict, alias="parameterOverrides")
    custom_parameters: List[Dict[str, Any]] = Field(default_factory=list, alias="customParameters")
    selected_parameter_definitions: List[Dict[str, Any]] = Field(
        default_factory=list,
        alias="selectedParameterDefinitions",
    )


class EditSkillParameterRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    doctor_id: str = Field(..., alias="doctorId")
    name: Optional[str] = None
    description: Optional[str] = None


class CustomSkillParameterRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    doctor_id: str = Field(..., alias="doctorId")
    name: str
    description: str = ""


class SkillActivationRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    doctor_id: str = Field(..., alias="doctorId")
    active: bool


class SkillTestRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    doctor_id: str = Field(..., alias="doctorId")
    patient_id: str = Field(..., alias="patientId")
    force_regenerate: bool = Field(False, alias="forceRegenerate")


# ============================================================
# Skill endpoints
# ============================================================

SKILL_PREFIX = "/skills/surgical-oncology"


@router.get(f"{SKILL_PREFIX}/catalog")
async def skill_catalog():
    try:
        return {"success": True, "data": get_skill_catalog()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get(f"{SKILL_PREFIX}/configuration")
async def skill_configuration(doctorId: str = Query(...)):
    try:
        await ensure_indexes()
        return {"success": True, "data": await get_doctor_skill_configuration(str(doctorId))}
    except Exception as e:
        logger.error(f"[surgical skill] configuration load failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put(f"{SKILL_PREFIX}/configuration")
async def save_skill_configuration(request: SkillConfigurationRequest):
    try:
        await ensure_indexes()
        saved = await save_doctor_skill_configuration(
            doctor_id=str(request.doctor_id),
            enabled_parameters=request.enabled_parameters,
            skill_name=request.skill_name,
            active=request.active,
            parameter_overrides=request.parameter_overrides,
            custom_parameters=request.custom_parameters,
            selected_parameter_definitions=request.selected_parameter_definitions,
        )
        return {"success": True, "data": saved}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"[surgical skill] configuration save failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch(f"{SKILL_PREFIX}/parameters/{{parameter_id}}")
async def edit_skill_parameter_endpoint(
    parameter_id: str,
    request: EditSkillParameterRequest,
):
    try:
        saved = await edit_skill_parameter(
            doctor_id=str(request.doctor_id),
            parameter_id=parameter_id,
            name=request.name,
            description=request.description,
        )
        return {"success": True, "data": saved}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post(f"{SKILL_PREFIX}/parameters/custom")
async def add_custom_skill_parameter(request: CustomSkillParameterRequest):
    try:
        saved = await add_custom_parameter(
            doctor_id=str(request.doctor_id),
            name=request.name,
            description=request.description,
        )
        return {"success": True, "data": saved}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post(f"{SKILL_PREFIX}/activation")
async def skill_activation(request: SkillActivationRequest):
    try:
        saved = await activate_skill(
            doctor_id=str(request.doctor_id),
            active=request.active,
        )
        return {"success": True, "data": saved}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post(f"{SKILL_PREFIX}/test")
async def test_skill(request: SkillTestRequest):
    try:
        await ensure_indexes()
        result = await generate_doctor_skill_output(
            doctor_id=str(request.doctor_id),
            patient_id=str(request.patient_id),
            force_regenerate=request.force_regenerate,
            persist_output=True,
        )
        return {"success": True, "data": result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(
            f"[surgical skill] test failed doctor={request.doctor_id} "
            f"patient={request.patient_id}: {e}"
        )
        raise HTTPException(status_code=500, detail=f"Skill test failed: {e}")


@router.get(f"{SKILL_PREFIX}/export", response_class=PlainTextResponse)
async def export_skill(
    doctorId: str = Query(...),
    patientId: str = Query(...),
    forceRegenerate: bool = Query(False),
):
    try:
        await ensure_indexes()
        markdown = await generate_skill_markdown(
            doctor_id=str(doctorId),
            patient_id=str(patientId),
            force_regenerate=forceRegenerate,
        )
        return PlainTextResponse(
            content=markdown,
            media_type="text/markdown",
            headers={
                "Content-Disposition": 'attachment; filename="surgical_oncology_skill.md"'
            },
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"[surgical skill] export failed: {e}")
        raise HTTPException(status_code=500, detail=f"Skill export failed: {e}")
