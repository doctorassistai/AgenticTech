"""
Chemotherapy Intelligence Skill Service

This file contains the complete backend logic for the configurable
Chemotherapy Intelligence Skill.

Responsibilities:
1. Load the master chemotherapy_skill.json
2. Connect to the existing MongoDB instance
3. Store doctor-specific Skill configurations
4. Retrieve doctor-specific Skill configurations
5. Validate selected parameter IDs
6. Return all available Skill parameters
7. Filter an existing chemotherapy backend report
   and return only the parameters selected by the doctor

IMPORTANT:
- This file does NOT modify the existing chemotherapy agents.
- This file does NOT perform clinical calculations.
- This file does NOT contain clinical decision rules.
- Existing chemotherapy workflow remains the source of clinical results.
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from loguru import logger
from motor.motor_asyncio import AsyncIOMotorClient


# ============================================================
# 1. MASTER SKILL JSON
# ============================================================

SKILL_FILE = Path(__file__).resolve().parent / "chemotherapy_skill.json"


def load_chemotherapy_skill() -> Dict[str, Any]:
    """
    Load the master chemotherapy Skill JSON.
    """

    if not SKILL_FILE.exists():
        raise FileNotFoundError(
            f"Chemotherapy skill file not found: {SKILL_FILE}"
        )

    with SKILL_FILE.open("r", encoding="utf-8") as f:
        return json.load(f)


# ============================================================
# 2. MONGODB CONNECTION
# ============================================================

MONGO_URI = os.getenv("MONGO_URI")

MONGO_DB = os.getenv(
    "MONGO_DB",
    "doctorassistai",
)

if not MONGO_URI:
    logger.warning(
        "MONGO_URI is not configured for Chemotherapy Skill"
    )


mongodb_client = AsyncIOMotorClient(
    MONGO_URI
) if MONGO_URI else None


_db = (
    mongodb_client[MONGO_DB]
    if mongodb_client is not None
    else None
)


# Dedicated collection for doctor Skill configurations
chemotherapy_skill_configuration_collection = (
    _db.chemotherapy_skill_configurations
    if _db is not None
    else None
)

# ============================================================
# DOCTOR SKILL STRUCTURE
# ============================================================

DEFAULT_SKILL_NAME = "My Chemotherapy Skill"


def create_empty_skill(doctor_id: str, skill_id: str) -> Dict[str, Any]:
    return {
        "doctor_id": doctor_id,
        "skill_id": skill_id,
        "skill_name": DEFAULT_SKILL_NAME,
        "active": False,

        "enabled_parameters": [],

        # Doctor edits existing predefined parameters
        "parameter_overrides": {},

        # Doctor-created parameters
        "custom_parameters": [],

        "version": 1,
        "created_at": None,
        "updated_at": None,
    }

# ============================================================
# 3. BASIC SKILL INFORMATION
# ============================================================

def get_skill_information() -> Dict[str, Any]:
    """
    Return basic Skill metadata.
    """

    skill = load_chemotherapy_skill()

    parameters = get_all_skill_parameters()

    return {
        "skill_id": skill.get(
            "skill_id",
            "chemotherapy_intelligence",
        ),
        "skill_name": skill.get(
            "skill_name",
            "Chemotherapy Intelligence Skill",
        ),
        "version": skill.get(
            "version",
            1,
        ),
        "purpose": skill.get(
            "purpose",
            "",
        ),
        "module_count": len(
            skill.get("modules", [])
        ),
        "parameter_count": len(parameters),
    }


# ============================================================
# 4. GET ALL MODULES + PARAMETERS
# ============================================================

def get_skill_catalog() -> Dict[str, Any]:
    """
    Return the complete Skill catalog.

    This is what the frontend can use to display:

    Module 1
       - parameter 1
       - parameter 2
       ...

    Module 12
       - parameter 1
       - parameter 2
       ...
    """

    skill = load_chemotherapy_skill()

    return skill


# ============================================================
# 5. GET ALL PARAMETERS
# ============================================================

def get_all_skill_parameters() -> List[Dict[str, Any]]:
    """
    Return all 131 predefined parameters.
    """

    skill = load_chemotherapy_skill()

    parameters: List[Dict[str, Any]] = []

    for module in skill.get("modules", []):

        module_id = module.get(
            "module_id"
        )

        module_name = module.get(
            "module_name",
            module.get("title", ""),
        )

        for parameter in module.get(
            "parameters",
            []
        ):

            item = {
                **parameter,
                "module_id": module_id,
                "module_name": module_name,
            }

            parameters.append(item)

    return parameters


# ============================================================
# 6. GET ONE PARAMETER
# ============================================================

def get_skill_parameter(
    parameter_id: str,
) -> Optional[Dict[str, Any]]:
    """
    Find one Skill parameter by ID.

    Example:

        M01-P01
        M02-P04
        M08-P01
    """

    parameters = get_all_skill_parameters()

    for parameter in parameters:

        if parameter.get("id") == parameter_id:
            return parameter

    return None


# ============================================================
# 7. VALIDATE PARAMETER IDs
# ============================================================

def validate_parameter_ids(
    parameter_ids: List[str],
) -> Dict[str, Any]:
    """
    Validate that all selected IDs exist in the master Skill.

    Returns:
        valid_ids
        invalid_ids
    """

    all_parameters = get_all_skill_parameters()

    valid_ids = {
        parameter.get("id")
        for parameter in all_parameters
        if parameter.get("id")
    }

    requested_ids = set(
        parameter_ids
    )

    valid_selected_ids = sorted(
        requested_ids.intersection(
            valid_ids
        )
    )

    invalid_ids = sorted(
        requested_ids.difference(
            valid_ids
        )
    )

    return {
        "valid_ids": valid_selected_ids,
        "invalid_ids": invalid_ids,
    }


# ============================================================
# 8. GET SELECTED PARAMETERS
# ============================================================

def get_selected_parameters(
    selected_parameter_ids: List[str],
) -> List[Dict[str, Any]]:
    """
    Return master definitions for selected parameter IDs.
    """

    parameters = get_all_skill_parameters()

    selected_ids = set(
        selected_parameter_ids
    )

    return [
        parameter
        for parameter in parameters
        if parameter.get("id") in selected_ids
    ]


# ============================================================
# 9. MONGODB CONFIGURATION HELPERS
# ============================================================

def _ensure_mongodb_available() -> None:
    """
    Make sure MongoDB is configured before attempting
    configuration operations.
    """

    if (
        mongodb_client is None
        or chemotherapy_skill_configuration_collection is None
    ):
        raise RuntimeError(
            "MongoDB is not configured. "
            "Please configure MONGO_URI."
        )


# ============================================================
# 10. GET DOCTOR CONFIGURATION
# ============================================================

async def get_doctor_skill_configuration(
    doctor_id: str,
) -> Dict[str, Any]:
    """
    Retrieve a doctor's Chemotherapy Skill configuration.

    If no configuration exists yet, return an empty/default
    configuration.

    IMPORTANT:
    The master JSON is never modified.
    """

    _ensure_mongodb_available()

    skill = load_chemotherapy_skill()

    skill_id = skill.get(
        "skill_id",
        "chemotherapy_intelligence",
    )

    configuration = await (
        chemotherapy_skill_configuration_collection.find_one(
            {
                "doctor_id": doctor_id,
                "skill_id": skill_id,
            }
        )
    )


    # No doctor configuration yet
    if configuration:
        configuration.pop("_id", None)
        return configuration

    return create_empty_skill(
        doctor_id=doctor_id,
        skill_id=skill_id,
    )


# ============================================================
# 11. SAVE DOCTOR CONFIGURATION
# ============================================================

async def save_doctor_skill_configuration(
    doctor_id: str,
    enabled_parameters: List[str],
    skill_name: Optional[str] = None,
    active: bool = False,
    parameter_overrides: Optional[Dict[str, Any]] = None,
    custom_parameters: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Save the doctor's selected Skill parameters.

    Example:

        doctor selects 45 / 131

    MongoDB stores only those 45 IDs.
    """

    _ensure_mongodb_available()

    skill = load_chemotherapy_skill()

    skill_id = skill.get(
        "skill_id",
        "chemotherapy_intelligence",
    )

    # Remove duplicates while preserving order
    unique_parameter_ids = list(
        dict.fromkeys(
            enabled_parameters
        )
    )

    # Validate selected parameters
    validation = validate_parameter_ids(
        unique_parameter_ids
    )

    valid_ids = validation["valid_ids"]
    invalid_ids = validation["invalid_ids"]

    if invalid_ids:
        raise ValueError(
            "Invalid chemotherapy Skill parameter IDs: "
            + ", ".join(invalid_ids)
        )

    now = datetime.now(
        timezone.utc
    )

    existing = await (
        chemotherapy_skill_configuration_collection.find_one(
            {
                "doctor_id": doctor_id,
                "skill_id": skill_id,
            }
        )
    )

    if existing:

        new_version = (
            existing.get(
                "version",
                1,
            )
            + 1
        )

        created_at = existing.get(
            "created_at"
        )

        await (
            chemotherapy_skill_configuration_collection.update_one(
                {
                    "_id": existing["_id"]
                },
                {
                    "$set": {
                        "skill_name": skill_name or DEFAULT_SKILL_NAME,
                        "active": active,
                        "enabled_parameters": valid_ids,
                        "parameter_overrides": parameter_overrides or {},
                        "custom_parameters": custom_parameters or [],
                        "version": new_version,
                        "updated_at": now,
                    }
                },
            )
        )

    else:

        new_version = 1

        created_at = now

        await (
            chemotherapy_skill_configuration_collection.insert_one(
                {
                    "doctor_id": doctor_id,
                    "skill_id": skill_id,
                    "skill_name": skill_name or DEFAULT_SKILL_NAME,
                    "active": active,

                    "enabled_parameters": valid_ids,

                    "parameter_overrides": parameter_overrides or {},
                    "custom_parameters": custom_parameters or [],

                    "version": new_version,
                    "created_at": created_at,
                    "updated_at": now,
                }
            )
        )

    return {
        "doctor_id": doctor_id,
        "skill_id": skill_id,
        "enabled_parameters": valid_ids,
        "selected_count": len(
            valid_ids
        ),
        "total_available": len(
            get_all_skill_parameters()
        ),
        "version": new_version,
        "created_at": created_at,
        "updated_at": now,
    }


# ============================================================
# EDIT EXISTING PARAMETER
# ============================================================

async def edit_skill_parameter(
    doctor_id: str,
    parameter_id: str,
    name: Optional[str] = None,
    description: Optional[str] = None,
):
    config = await get_doctor_skill_configuration(doctor_id)

    overrides = config.get("parameter_overrides", {})

    overrides[parameter_id] = {
        "name": name,
        "description": description,
    }

    return await save_doctor_skill_configuration(
        doctor_id=doctor_id,
        enabled_parameters=config["enabled_parameters"],
        skill_name=config["skill_name"],
        active=config.get("active", False),
        parameter_overrides=overrides,
        custom_parameters=config.get("custom_parameters", []),
    )


# ============================================================
# ADD CUSTOM PARAMETER
# ============================================================

async def add_custom_parameter(
    doctor_id: str,
    name: str,
    description: str,
):
    config = await get_doctor_skill_configuration(doctor_id)

    custom = config.get("custom_parameters", [])

    new_id = f"CUSTOM-{len(custom)+1:03d}"

    custom.append({
        "id": new_id,
        "number": len(custom)+1,
        "name": name,
        "description": description,
        "type": "manual_review",
    })

    return await save_doctor_skill_configuration(
        doctor_id=doctor_id,
        enabled_parameters=config["enabled_parameters"],
        skill_name=config["skill_name"],
        active=config.get("active", False),
        parameter_overrides=config.get("parameter_overrides", {}),
        custom_parameters=custom,
    )

# ============================================================
# ACTIVATE / DEACTIVATE
# ============================================================

async def activate_skill(
    doctor_id: str,
    active: bool = True,
):
    config = await get_doctor_skill_configuration(doctor_id)

    return await save_doctor_skill_configuration(
        doctor_id=doctor_id,
        enabled_parameters=config["enabled_parameters"],
        skill_name=config["skill_name"],
        active=active,
        parameter_overrides=config.get("parameter_overrides", {}),
        custom_parameters=config.get("custom_parameters", []),
    )



# ============================================================
# 12. BUILD SKILL RESULTS FROM EXISTING BACKEND OUTPUT
# ============================================================

def filter_existing_chemotherapy_output(
    chemotherapy_report: Dict[str, Any],
    selected_parameter_ids: List[str],
) -> Dict[str, Any]:
    """
    Filter the existing chemotherapy backend output.

    IMPORTANT:

    This function does NOT calculate clinical results.

    It simply finds the result generated by the existing
    chemotherapy backend for each parameter selected by
    the doctor.

    Existing backend result structure:

        parameter
        current_finding
        reference_expected
        status
        indication_action
    """

    selected_parameters = get_selected_parameters(
        selected_parameter_ids
    )

    # --------------------------------------------------------
    # Build mapping:
    #
    # parameter ID -> master definition
    # --------------------------------------------------------

    parameter_definitions = {
        parameter["id"]: parameter
        for parameter in selected_parameters
        if parameter.get("id")
    }

    # --------------------------------------------------------
    # Extract modules from existing report
    # --------------------------------------------------------

    data = chemotherapy_report.get(
        "data",
        chemotherapy_report,
    )

    modules = data.get(
        "modules",
        {}
    )

    # --------------------------------------------------------
    # Flatten all backend checks
    # --------------------------------------------------------

    backend_checks: List[Dict[str, Any]] = []

    if isinstance(
        modules,
        dict
    ):

        module_items = modules.items()

    elif isinstance(
        modules,
        list
    ):

        module_items = [
            (
                str(
                    module.get(
                        "module_id",
                        ""
                    )
                ),
                module,
            )
            for module in modules
        ]

    else:

        module_items = []

    for module_key, module in module_items:

        if not isinstance(
            module,
            dict
        ):
            continue

        module_id = module.get(
            "module_id",
            module_key,
        )

        module_name = module.get(
            "module_name",
            module.get(
                "title",
                "",
            ),
        )

        checks = module.get(
            "checks",
            []
        )

        for check in checks:

            if not isinstance(
                check,
                dict
            ):
                continue

            backend_check = {
                **check,
                "module_id": module_id,
                "module_name": module_name,
            }

            backend_checks.append(
                backend_check
            )

    # --------------------------------------------------------
    # Match selected Skill parameters with backend results
    # --------------------------------------------------------

    results: List[Dict[str, Any]] = []

    unmatched_parameters: List[str] = []

    for parameter_id, definition in (
        parameter_definitions.items()
    ):

        backend_parameter = definition.get(
            "backend_parameter",
            definition.get(
                "name",
                "",
            ),
        )

        match_mode = definition.get(
            "match_mode",
            "exact",
        )

        matched_check = None

        for check in backend_checks:

            actual_parameter = str(
                check.get(
                    "parameter",
                    ""
                )
            )

            if (
                match_mode == "prefix"
                and actual_parameter.startswith(
                    backend_parameter
                )
            ):
                matched_check = check
                break

            if (
                match_mode == "exact"
                and actual_parameter == backend_parameter
            ):
                matched_check = check
                break

        if matched_check:

            results.append(
                {
                    "module_id": matched_check.get(
                        "module_id"
                    ),
                    "module_name": matched_check.get(
                        "module_name",
                        definition.get(
                            "module_name",
                            "",
                        ),
                    ),
                    "parameter_id": parameter_id,
                    "parameter": matched_check.get(
                        "parameter",
                        definition.get(
                            "name",
                            "",
                        ),
                    ),
                    "current_finding": matched_check.get(
                        "current_finding"
                    ),
                    "reference_expected": matched_check.get(
                        "reference_expected"
                    ),
                    "status": matched_check.get(
                        "status"
                    ),
                    "indication_action": matched_check.get(
                        "indication_action"
                    ),
                }
            )

        else:

            unmatched_parameters.append(
                parameter_id
            )

    # --------------------------------------------------------
    # Final Skill output
    # --------------------------------------------------------

    return {
        "skill_id": "chemotherapy_intelligence",
        "selected_count": len(
            selected_parameter_ids
        ),
        "matched_count": len(
            results
        ),
        "unmatched_count": len(
            unmatched_parameters
        ),
        "unmatched_parameter_ids": unmatched_parameters,
        "results": results,
    }


# ============================================================
# 13. GET DOCTOR SKILL RESULTS
# ============================================================

# ============================================================
# 13. GET DOCTOR SKILL RESULTS
# ============================================================

async def generate_doctor_skill_output(
    doctor_id: str,
    chemotherapy_report: Optional[Dict[str, Any]] = None,
    patient_id: Optional[str] = None,
    treatment_id: Optional[str] = None,
    cycle_num: Optional[str] = None,
    force_regenerate: bool = False,
) -> Dict[str, Any]:
    """
    Generate the doctor's Skill output.

    Production flow:

        doctor_id
            ↓
        MongoDB Skill configuration
            ↓
        selected parameter IDs
            ↓
        patient_id
            ↓
        existing chemotherapy workflow
            ↓
        full chemotherapy report
            ↓
        Skill filtering
            ↓
        selected actual backend results

    IMPORTANT:
    - Does NOT modify chemotherapy agents.
    - Does NOT perform clinical calculations.
    - Reuses the existing chemotherapy workflow.
    """

    # --------------------------------------------------------
    # 1. Load doctor's Skill configuration
    # --------------------------------------------------------

    configuration = await get_doctor_skill_configuration(
        doctor_id=doctor_id
    )

    selected_parameter_ids = configuration.get(
        "enabled_parameters",
        []
    )

    # --------------------------------------------------------
    # 2. Make sure the Skill has selected parameters
    # --------------------------------------------------------

    if not selected_parameter_ids:
        return {
            "skill_id": "chemotherapy_intelligence",
            "doctor_id": doctor_id,
            "skill_name": configuration.get(
                "skill_name",
                DEFAULT_SKILL_NAME,
            ),
            "active": configuration.get("active", False),
            "selected_count": 0,
            "matched_count": 0,
            "unmatched_count": 0,
            "unmatched_parameter_ids": [],
            "results": [],
            "configuration_version": configuration.get(
                "version",
                1,
            ),
            "message": "No chemotherapy parameters are selected in this Skill.",
        }

    # --------------------------------------------------------
    # 3. Obtain the chemotherapy report
    # --------------------------------------------------------
    #
    # If frontend/API already supplies a report, use it.
    #
    # Otherwise obtain it from the EXISTING chemotherapy workflow.
    # --------------------------------------------------------

    if chemotherapy_report is None:

        if not patient_id:
            raise ValueError(
                "patient_id is required when "
                "chemotherapy_report is not provided."
            )

        # Import here to avoid unnecessary module-level coupling
        # and possible circular imports.
        from Agentic.chemotherapy_workflow.workflow import get_or_generate, regenerate

        if force_regenerate:

            chemotherapy_report = regenerate(
                patient_id=patient_id,
                requested_cycle=cycle_num,
                requested_treatment=treatment_id,
                doctor_id=doctor_id,
            )

        else:

            chemotherapy_report = get_or_generate(
                patient_id=patient_id,
                requested_cycle=cycle_num,
                requested_treatment=treatment_id,
                doctor_id=doctor_id,
            )

    # --------------------------------------------------------
    # 4. Extract actual chemotherapy data
    # --------------------------------------------------------
    #
    # Existing workflow returns:
    #
    # {
    #     "status": "success",
    #     "cached": true/false,
    #     "version": ...,
    #     "generatedAt": ...,
    #     "data": {
    #         ...
    #     }
    # }
    #
    # filter_existing_chemotherapy_output() already supports
    # reports wrapped in "data".
    # --------------------------------------------------------

    result = filter_existing_chemotherapy_output(
        chemotherapy_report=chemotherapy_report,
        selected_parameter_ids=selected_parameter_ids,
    )

    # --------------------------------------------------------
    # 5. Add Skill metadata
    # --------------------------------------------------------

    result["doctor_id"] = doctor_id

    result["skill_name"] = configuration.get(
        "skill_name",
        DEFAULT_SKILL_NAME,
    )

    result["active"] = configuration.get(
        "active",
        False,
    )

    result["configuration_version"] = configuration.get(
        "version",
        1,
    )

    if patient_id:
        result["patient_id"] = patient_id

    if treatment_id:
        result["treatment_id"] = treatment_id

    if cycle_num:
        result["cycle_num"] = cycle_num

    # Preserve information about which chemotherapy report
    # was used, when available.
    if isinstance(chemotherapy_report, dict):

        result["chemotherapy_report_version"] = (
            chemotherapy_report.get("version")
        )

        result["chemotherapy_generated_at"] = (
            chemotherapy_report.get("generatedAt")
        )

        result["chemotherapy_cached"] = (
            chemotherapy_report.get("cached")
        )

    return result

# ============================================================
# GENERATE MARKDOWN SKILL
# ============================================================


def _clean_markdown_cell(value: Any) -> str:
    """
    Convert a backend value into a safe, readable Markdown table cell.

    This only formats the value for export.
    It does NOT change the underlying chemotherapy result.
    """

    if value is None:
        return "—"

    text = str(value).strip()

    if not text:
        return "—"

    # Remove Markdown emphasis that can appear in backend text
    text = text.replace("**", "")
    text = text.replace("__", "")

    # Convert multiline clinical text into a single readable cell
    text = text.replace("\r\n", " ")
    text = text.replace("\n", " ")
    text = text.replace("\r", " ")

    # Escape Markdown table separators
    text = text.replace("|", "\\|")

    # Collapse excessive whitespace
    text = " ".join(text.split())

    return text

async def generate_skill_markdown(
    doctor_id: str,
    patient_id: Optional[str] = None,
    treatment_id: Optional[str] = None,
    cycle_num: Optional[str] = None,
    chemotherapy_report: Optional[Dict[str, Any]] = None,
    force_regenerate: bool = False,
) -> str:
    """
    Generate a clean patient-specific Chemotherapy Skill markdown export.

    Export contains ONLY:
        - Chemotherapy Skill title
        - Selected module headings
        - Selected parameter results

    It intentionally does NOT include:
        - Doctor ID
        - Patient ID
        - Treatment ID
        - Cycle number
        - Selected/matched/unmatched metadata

    Clinical results are taken directly from the existing
    chemotherapy workflow. This function only formats them
    for Markdown export.
    """

    # ------------------------------------------------------------
    # 1. Load doctor's Skill configuration
    # ------------------------------------------------------------

    config = await get_doctor_skill_configuration(
        doctor_id=doctor_id
    )

    selected_parameter_ids = config.get(
        "enabled_parameters",
        []
    )

    custom_parameters = config.get(
        "custom_parameters",
        []
    )

    # ------------------------------------------------------------
    # 2. Nothing selected
    # ------------------------------------------------------------

    if not selected_parameter_ids and not custom_parameters:
        return (
            "# Chemotherapy Intelligence Skill\n\n"
            "No checks are configured for this Skill.\n"
        )

    # ------------------------------------------------------------
    # 3. Get actual Skill execution results
    # ------------------------------------------------------------

    skill_output = await generate_doctor_skill_output(
        doctor_id=doctor_id,
        chemotherapy_report=chemotherapy_report,
        patient_id=patient_id,
        treatment_id=treatment_id,
        cycle_num=cycle_num,
        force_regenerate=force_regenerate,
    )

    results = skill_output.get(
        "results",
        []
    )

    overrides = config.get(
        "parameter_overrides",
        {}
    )

    # ------------------------------------------------------------
    # 4. Build lookup by parameter ID
    # ------------------------------------------------------------

    result_by_parameter_id = {
        result.get("parameter_id"): result
        for result in results
        if result.get("parameter_id")
    }

    selected = get_selected_parameters(
        selected_parameter_ids
    )

    # ------------------------------------------------------------
    # 5. Build Markdown
    # ------------------------------------------------------------

    markdown = []

    markdown.append(
        "# Chemotherapy Intelligence Skill\n\n"
    )

    current_module = None
    number = 1

    # ------------------------------------------------------------
    # 6. Predefined selected parameters
    # ------------------------------------------------------------

    for parameter in selected:

        module_name = parameter.get(
            "module_name",
            "Chemotherapy Assessment"
        )

        # New module
        if module_name != current_module:

            # Close previous table visually
            if current_module is not None:
                markdown.append("\n")

            current_module = module_name

            markdown.append(
                f"## {_clean_markdown_cell(module_name)}\n\n"
            )

            markdown.append(
                "| # | Parameter | Current Finding | "
                "Reference / Expected | Status | Indication / Action |\n"
            )

            markdown.append(
                "|---:|---|---|---|---|---|\n"
            )

        parameter_id = parameter.get(
            "id"
        )

        override = overrides.get(
            parameter_id,
            {}
        )

        title = (
            override.get("name")
            or parameter.get("name")
            or ""
        )

        result = result_by_parameter_id.get(
            parameter_id
        )

        # --------------------------------------------------------
        # Matched backend result
        # --------------------------------------------------------

        if result:

            parameter_name = (
                result.get("parameter")
                or title
            )

            current_finding = (
                result.get("current_finding")
            )

            reference_expected = (
                result.get("reference_expected")
            )

            status = (
                result.get("status")
            )

            indication_action = (
                result.get("indication_action")
            )

        # --------------------------------------------------------
        # Selected but backend result not found
        # --------------------------------------------------------

        else:

            parameter_name = title

            current_finding = (
                "No backend result available"
            )

            reference_expected = "—"

            status = "Unmatched"

            indication_action = (
                "Review parameter mapping"
            )

        # --------------------------------------------------------
        # Clean all values before putting them into Markdown
        # --------------------------------------------------------

        parameter_name = _clean_markdown_cell(
            parameter_name
        )

        current_finding = _clean_markdown_cell(
            current_finding
        )

        reference_expected = _clean_markdown_cell(
            reference_expected
        )

        status = _clean_markdown_cell(
            status
        )

        indication_action = _clean_markdown_cell(
            indication_action
        )

        # --------------------------------------------------------
        # Add table row
        # --------------------------------------------------------

        markdown.append(
            f"| {number} | "
            f"{parameter_name} | "
            f"{current_finding} | "
            f"{reference_expected} | "
            f"{status} | "
            f"{indication_action} |\n"
        )

        number += 1

    # ------------------------------------------------------------
    # 7. Doctor-added custom parameters
    # ------------------------------------------------------------

    if custom_parameters:

        if current_module is not None:
            markdown.append("\n")

        markdown.append(
            "## Doctor Added Checks\n\n"
        )

        markdown.append(
            "| # | Parameter | Current Finding | "
            "Reference / Expected | Status | Indication / Action |\n"
        )

        markdown.append(
            "|---:|---|---|---|---|---|\n"
        )

        for item in custom_parameters:

            name = _clean_markdown_cell(
                item.get("name", "")
            )

            description = _clean_markdown_cell(
                item.get("description", "")
            )

            markdown.append(
                f"| {number} | "
                f"{name} | "
                f"Manual review required | "
                f"{description or 'Doctor-defined review'} | "
                f"Manual Review | "
                f"Manual clinical review |\n"
            )

            number += 1

    return "".join(markdown)