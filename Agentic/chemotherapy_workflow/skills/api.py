"""
Chemotherapy Intelligence Skill API

This API provides endpoints for:

1. Getting the master Skill catalog
2. Getting all Skill parameters
3. Getting a doctor's Skill configuration
4. Saving a doctor's Skill configuration
5. Editing an existing Skill parameter
6. Adding a custom Skill parameter
7. Activating / deactivating a Skill
8. Testing a Skill against an existing chemotherapy report
9. Exporting the doctor's Skill as skill.md

IMPORTANT:
- Existing chemotherapy agents are NOT modified.
- Existing chemotherapy workflow is NOT modified.
- Clinical calculations are NOT performed here.
- The Skill does NOT contain clinical decision logic.
- The Skill only configures which chemotherapy checks the doctor wants.
- Existing chemotherapy backend remains the source of clinical results.
"""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .service import (
    get_skill_catalog,
    get_skill_information,
    get_all_skill_parameters,
    get_doctor_skill_configuration,
    save_doctor_skill_configuration,
    generate_doctor_skill_output,
    edit_skill_parameter,
    add_custom_parameter,
    activate_skill,
    generate_skill_markdown,
)


# ============================================================
# ROUTER
# ============================================================

router = APIRouter(
    prefix="/chemotherapy-intelligence/skills/chemotherapy",
    tags=["Chemotherapy Intelligence Skill"],
)


# ============================================================
# REQUEST MODELS
# ============================================================


class ChemotherapySkillConfigurationRequest(BaseModel):
    """
    Save the complete doctor's Skill configuration.

    enabled_parameters:
        IDs of predefined chemotherapy checks selected
        by the doctor.

    parameter_overrides:
        Changes made by the doctor to existing parameters.

    custom_parameters:
        Additional doctor-created checking points.

    active:
        Whether the Skill is currently active.
    """

    doctor_id: str

    skill_name: Optional[str] = None

    enabled_parameters: List[str] = Field(
        default_factory=list
    )

    parameter_overrides: Dict[str, Any] = Field(
        default_factory=dict
    )

    custom_parameters: List[Dict[str, Any]] = Field(
        default_factory=list
    )

    active: bool = False


class ChemotherapySkillParameterEditRequest(BaseModel):
    """
    Edit an existing predefined Skill parameter.

    The master JSON is NOT modified.

    The changes are stored as doctor-specific overrides
    in MongoDB.
    """

    doctor_id: str

    parameter_id: str

    name: Optional[str] = None

    description: Optional[str] = None


class ChemotherapySkillCustomParameterRequest(BaseModel):
    """
    Add a new doctor-defined checking point.

    Custom parameters are configuration/checklist items.

    They do not automatically create new clinical
    calculation logic in the chemotherapy backend.
    """

    doctor_id: str

    name: str

    description: str


class ChemotherapySkillActivationRequest(BaseModel):
    """
    Activate or deactivate the doctor's Skill.
    """

    doctor_id: str

    active: bool


class ChemotherapySkillTestRequest(BaseModel):
    """
    Test the doctor's Skill.

    Preferred production flow:

        doctor_id
        patient_id

    The Skill backend obtains the existing chemotherapy
    report and filters it.

    chemotherapy_report is retained as optional support
    for testing with an already generated report.
    """

    doctor_id: str

    patient_id: Optional[str] = None

    treatment_id: Optional[str] = None

    cycle_num: Optional[str] = None

    chemotherapy_report: Optional[Dict[str, Any]] = None

    force_regenerate: bool = False


# ============================================================
# 1. GET SKILL INFORMATION
# ============================================================


@router.get("")
async def get_chemotherapy_skill_information():
    """
    Return basic information about the Chemotherapy Skill.

    Example:

    {
        "success": true,
        "data": {
            "skill_id": "chemotherapy_intelligence",
            "skill_name": "Chemotherapy Intelligence Skill",
            "module_count": 12,
            "parameter_count": 131
        }
    }
    """

    try:

        information = get_skill_information()

        return {
            "success": True,
            "data": information,
        }

    except Exception as exc:

        raise HTTPException(
            status_code=500,
            detail=str(exc),
        )


# ============================================================
# 2. GET COMPLETE SKILL CATALOG
# ============================================================


@router.get("/catalog")
async def get_chemotherapy_skill_catalog():
    """
    Return all 12 modules and all predefined parameters.

    The frontend uses this endpoint to build the Skill
    configuration screen.

    The master catalog is read-only from the doctor's
    perspective.
    """

    try:

        catalog = get_skill_catalog()

        return {
            "success": True,
            "data": catalog,
        }

    except Exception as exc:

        raise HTTPException(
            status_code=500,
            detail=str(exc),
        )


# ============================================================
# 3. GET FLAT PARAMETER LIST
# ============================================================


@router.get("/parameters")
async def get_chemotherapy_skill_parameters():
    """
    Return all predefined Skill parameters as a flat list.

    Useful for:

    - Search
    - Filtering
    - Counting
    - Frontend selection
    """

    try:

        parameters = get_all_skill_parameters()

        return {
            "success": True,
            "count": len(parameters),
            "data": parameters,
        }

    except Exception as exc:

        raise HTTPException(
            status_code=500,
            detail=str(exc),
        )


# ============================================================
# 4. GET DOCTOR CONFIGURATION
# ============================================================


@router.get("/configuration")
async def get_chemotherapy_skill_configuration(
    doctorId: str = Query(
        ...,
        description="Doctor ID",
    )
):
    """
    Get the complete Skill configuration for a doctor.

    The response contains:

    - enabled_parameters
    - parameter_overrides
    - custom_parameters
    - active
    - version
    """

    try:

        configuration = (
            await get_doctor_skill_configuration(
                doctor_id=doctorId
            )
        )

        return {
            "success": True,
            "data": configuration,
        }

    except Exception as exc:

        raise HTTPException(
            status_code=500,
            detail=str(exc),
        )


# ============================================================
# 5. SAVE COMPLETE DOCTOR CONFIGURATION
# ============================================================


@router.put("/configuration")
async def save_chemotherapy_skill_configuration(
    request: ChemotherapySkillConfigurationRequest,
):
    """
    Save the complete doctor's Skill configuration.

    Example:

    {
        "doctor_id": "DOC-123",
        "skill_name": "My Chemotherapy Skill",
        "enabled_parameters": [
            "M01-P01",
            "M01-P03",
            "M02-P01",
            "M05-P01"
        ],
        "parameter_overrides": {},
        "custom_parameters": [],
        "active": false
    }

    This does NOT modify chemotherapy_skill.json.
    """

    try:

        configuration = (
            await save_doctor_skill_configuration(
                doctor_id=request.doctor_id,
                enabled_parameters=request.enabled_parameters,
                skill_name=request.skill_name,
                active=request.active,
                parameter_overrides=request.parameter_overrides,
                custom_parameters=request.custom_parameters,
            )
        )

        return {
            "success": True,
            "data": configuration,
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


# ============================================================
# 6. EDIT EXISTING PARAMETER
# ============================================================


@router.patch("/parameters/{parameter_id}")
async def edit_chemotherapy_skill_parameter(
    parameter_id: str,
    request: ChemotherapySkillParameterEditRequest,
):
    """
    Edit an existing predefined Skill parameter.

    IMPORTANT:

    This does NOT modify the master JSON.

    Example:

        PATCH
        /parameters/M01-P01

    Body:

    {
        "doctor_id": "DOC-123",
        "parameter_id": "M01-P01",
        "name": "Pre-treatment Chemotherapy Eligibility",
        "description": "Review eligibility before treatment."
    }
    """

    if parameter_id != request.parameter_id:

        raise HTTPException(
            status_code=400,
            detail=(
                "parameter_id in URL does not match "
                "parameter_id in request body."
            ),
        )

    try:

        result = await edit_skill_parameter(
            doctor_id=request.doctor_id,
            parameter_id=request.parameter_id,
            name=request.name,
            description=request.description,
        )

        return {
            "success": True,
            "data": result,
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


# ============================================================
# 7. ADD CUSTOM PARAMETER
# ============================================================


@router.post("/parameters/custom")
async def add_chemotherapy_skill_custom_parameter(
    request: ChemotherapySkillCustomParameterRequest,
):
    """
    Add a doctor-defined checking point.

    Example:

    {
        "doctor_id": "DOC-123",
        "name": "Previous Chemotherapy Intolerance",
        "description": "Review previous treatment-limiting reactions."
    }

    The custom point is stored in the doctor's Skill.

    It does NOT automatically create clinical evaluation
    logic in the existing chemotherapy backend.
    """

    try:

        result = await add_custom_parameter(
            doctor_id=request.doctor_id,
            name=request.name,
            description=request.description,
        )

        return {
            "success": True,
            "data": result,
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


# ============================================================
# 8. ACTIVATE / DEACTIVATE SKILL
# ============================================================


@router.post("/activation")
async def activate_chemotherapy_skill(
    request: ChemotherapySkillActivationRequest,
):
    """
    Activate or deactivate the doctor's Skill.

    Example:

    {
        "doctor_id": "DOC-123",
        "active": true
    }
    """

    try:

        result = await activate_skill(
            doctor_id=request.doctor_id,
            active=request.active,
        )

        return {
            "success": True,
            "data": result,
        }

    except Exception as exc:

        raise HTTPException(
            status_code=500,
            detail=str(exc),
        )


# ============================================================
# 9. TEST SKILL
# ============================================================


@router.post("/test")
async def test_chemotherapy_skill(
    request: ChemotherapySkillTestRequest,
):
    """
    Test the doctor's active/configured Skill.

    Preferred request:

    {
        "doctor_id": "DOC-123",
        "patient_id": "PAT-123"
    }

    The Skill should then:

        1. Load doctor's configuration
        2. Read selected parameter IDs
        3. Obtain existing chemotherapy report
        4. Filter selected parameters
        5. Return actual existing backend results

    The Skill does NOT run its own clinical calculations.

    For development/testing, an already-generated
    chemotherapy_report can also be supplied.
    """

    try:

        # ----------------------------------------------------
        # Validate that we have enough information
        # ----------------------------------------------------

        if (
            request.patient_id is None
            and request.chemotherapy_report is None
        ):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Either patient_id or chemotherapy_report "
                    "must be provided."
                ),
            )

        # ----------------------------------------------------
        # Existing report supplied directly
        # ----------------------------------------------------

        if request.chemotherapy_report is not None:

            result = await generate_doctor_skill_output(
                doctor_id=request.doctor_id,
                chemotherapy_report=request.chemotherapy_report,
            )

        # ----------------------------------------------------
        # Dynamic patient-based flow
        #
        # NOTE:
        # This requires the service layer to connect to the
        # existing chemotherapy report generation/retrieval
        # function.
        # ----------------------------------------------------

        else:

            result = await generate_doctor_skill_output(
                doctor_id=request.doctor_id,
                patient_id=request.patient_id,
                treatment_id=request.treatment_id,
                cycle_num=request.cycle_num,
                force_regenerate=request.force_regenerate,
            )

        return {
            "success": True,
            "data": result,
        }

    except HTTPException:
        raise

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
# 10. EXPORT SKILL AS skill.md
# ============================================================


@router.get("/export")
async def export_skill(
    doctorId: str,
    patientId: str,
    treatmentId: Optional[str] = None,
    cycleNum: Optional[str] = None,
    forceRegenerate: bool = False,
):
    markdown = await generate_skill_markdown(
        doctor_id=doctorId,
        patient_id=patientId,
        treatment_id=treatmentId,
        cycle_num=cycleNum,
        force_regenerate=forceRegenerate,
    )

    return Response(
        content=markdown,
        media_type="text/markdown",
        headers={
            "Content-Disposition":
                'attachment; filename="skill.md"'
        },
    )
