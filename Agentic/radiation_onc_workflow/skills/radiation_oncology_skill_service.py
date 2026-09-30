"""
radiation_oncology_skill_service.py

Doctor-configurable Skill layer for the existing Radiation Oncology Intelligence
agent platform.

IMPORTANT:
- Existing radiation oncology agents are NOT modified.
- Existing workflow / clinical calculations are NOT duplicated here.
- Mongo reference collections remain read-only.
- This service only stores doctor configuration, filters existing agent output,
  supports custom manual-review checks, activation, testing and Markdown export.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from Agentic.radiation_onc_workflow.data_sources import get_mongo_db
from Agentic.radiation_onc_workflow.workflow import (
    get_or_generate_dashboard,
    regenerate_dashboard,
)

SKILL_FILE = Path(__file__).resolve().parent / "radiation_oncology_skill.json"
DEFAULT_SKILL_ID = "radiation_oncology_intelligence"
DEFAULT_SKILL_NAME = "Radiation Oncology Intelligence Skill"
COLLECTION_NAME = "radiation_oncology_skill_configurations"
TEST_OUTPUT_COLLECTION_NAME = "radiation_oncology_skill_test_outputs"


# ============================================================
# Catalog
# ============================================================

def load_radiation_oncology_skill() -> Dict[str, Any]:
    if not SKILL_FILE.exists():
        raise FileNotFoundError(f"Radiation Oncology Skill file not found: {SKILL_FILE}")

    with SKILL_FILE.open("r", encoding="utf-8") as f:
        return json.load(f)


def get_all_skill_parameters() -> List[Dict[str, Any]]:
    skill = load_radiation_oncology_skill()
    parameters: List[Dict[str, Any]] = []

    for module in skill.get("modules", []):
        module_id = module.get("module_id", "")
        module_name = module.get("module_name", module.get("title", ""))

        for parameter in module.get("parameters", []):
            parameters.append(
                {
                    **parameter,
                    "module_id": module_id,
                    "module_name": module_name,
                }
            )

    return parameters


def get_skill_catalog() -> Dict[str, Any]:
    return load_radiation_oncology_skill()


def get_selected_parameters(
    selected_parameter_ids: List[str],
) -> List[Dict[str, Any]]:
    selected = set(selected_parameter_ids)

    return [
        parameter
        for parameter in get_all_skill_parameters()
        if parameter.get("id") in selected
    ]


def validate_parameter_ids(
    parameter_ids: List[str],
) -> Dict[str, Any]:
    valid_ids = {
        p.get("id")
        for p in get_all_skill_parameters()
        if p.get("id")
    }

    requested = set(parameter_ids)

    return {
        "valid_ids": sorted(requested.intersection(valid_ids)),
        "invalid_ids": sorted(requested.difference(valid_ids)),
    }


# ============================================================
# Mongo configuration
# ============================================================

def _collection():
    return get_mongo_db()[COLLECTION_NAME]


def _test_output_collection():
    return get_mongo_db()[TEST_OUTPUT_COLLECTION_NAME]


def _now():
    return datetime.now(timezone.utc)


def _new_configuration(
    doctor_id: str,
) -> Dict[str, Any]:
    return {
        "doctor_id": doctor_id,
        "skill_id": DEFAULT_SKILL_ID,
        "skill_name": DEFAULT_SKILL_NAME,
        "active": False,
        "enabled_parameters": [],
        "parameter_overrides": {},
        "custom_parameters": [],
        "version": 1,
        "created_at": None,
        "updated_at": None,
    }


async def get_doctor_skill_configuration(
    doctor_id: str,
) -> Dict[str, Any]:
    configuration = await _collection().find_one(
        {
            "doctor_id": doctor_id,
            "skill_id": DEFAULT_SKILL_ID,
        }
    )

    if configuration:
        configuration.pop("_id", None)
        return configuration

    return _new_configuration(doctor_id)


async def save_doctor_skill_configuration(
    doctor_id: str,
    enabled_parameters: List[str],
    skill_name: Optional[str] = None,
    active: bool = False,
    parameter_overrides: Optional[Dict[str, Any]] = None,
    custom_parameters: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:

    unique_ids = list(dict.fromkeys(enabled_parameters or []))
    validation = validate_parameter_ids(unique_ids)

    if validation["invalid_ids"]:
        raise ValueError(
            "Invalid Radiation Oncology Skill parameter IDs: "
            + ", ".join(validation["invalid_ids"])
        )

    now = _now()

    collection = _collection()

    existing = await collection.find_one(
        {
            "doctor_id": doctor_id,
            "skill_id": DEFAULT_SKILL_ID,
        }
    )

    if existing:
        version = int(existing.get("version", 1)) + 1
        created_at = existing.get("created_at")

        await collection.update_one(
            {"_id": existing["_id"]},
            {
                "$set": {
                    "skill_name": skill_name or DEFAULT_SKILL_NAME,
                    "active": bool(active),
                    "enabled_parameters": validation["valid_ids"],
                    "parameter_overrides": parameter_overrides or {},
                    "custom_parameters": custom_parameters or [],
                    "version": version,
                    "updated_at": now,
                }
            },
        )
    else:
        version = 1
        created_at = now

        await collection.insert_one(
            {
                "doctor_id": doctor_id,
                "skill_id": DEFAULT_SKILL_ID,
                "skill_name": skill_name or DEFAULT_SKILL_NAME,
                "active": bool(active),
                "enabled_parameters": validation["valid_ids"],
                "parameter_overrides": parameter_overrides or {},
                "custom_parameters": custom_parameters or [],
                "version": version,
                "created_at": created_at,
                "updated_at": now,
            }
        )

    return {
        "doctor_id": doctor_id,
        "skill_id": DEFAULT_SKILL_ID,
        "skill_name": skill_name or DEFAULT_SKILL_NAME,
        "active": bool(active),
        "enabled_parameters": validation["valid_ids"],
        "selected_count": len(validation["valid_ids"]),
        "total_available": len(get_all_skill_parameters()),
        "parameter_overrides": parameter_overrides or {},
        "custom_parameters": custom_parameters or [],
        "version": version,
        "created_at": created_at,
        "updated_at": now,
    }


async def edit_skill_parameter(
    doctor_id: str,
    parameter_id: str,
    name: Optional[str] = None,
    description: Optional[str] = None,
) -> Dict[str, Any]:

    if not get_skill_parameter(parameter_id):
        raise ValueError(f"Unknown Radiation Oncology Skill parameter: {parameter_id}")

    config = await get_doctor_skill_configuration(doctor_id)
    overrides = dict(config.get("parameter_overrides") or {})

    existing = dict(overrides.get(parameter_id) or {})

    if name is not None:
        existing["name"] = name.strip()

    if description is not None:
        existing["description"] = description.strip()

    overrides[parameter_id] = existing

    return await save_doctor_skill_configuration(
        doctor_id=doctor_id,
        enabled_parameters=config.get("enabled_parameters", []),
        skill_name=config.get("skill_name", DEFAULT_SKILL_NAME),
        active=config.get("active", False),
        parameter_overrides=overrides,
        custom_parameters=config.get("custom_parameters", []),
    )


def get_skill_parameter(
    parameter_id: str,
) -> Optional[Dict[str, Any]]:
    for parameter in get_all_skill_parameters():
        if parameter.get("id") == parameter_id:
            return parameter
    return None


async def add_custom_parameter(
    doctor_id: str,
    name: str,
    description: str,
) -> Dict[str, Any]:

    name = (name or "").strip()
    description = (description or "").strip()

    if not name:
        raise ValueError("Custom parameter name is required.")

    config = await get_doctor_skill_configuration(doctor_id)

    custom = list(config.get("custom_parameters") or [])

    new_id = f"CUSTOM-{len(custom) + 1:03d}"

    custom.append(
        {
            "id": new_id,
            "number": len(custom) + 1,
            "name": name,
            "description": description,
            "type": "manual_review",
        }
    )

    return await save_doctor_skill_configuration(
        doctor_id=doctor_id,
        enabled_parameters=config.get("enabled_parameters", []),
        skill_name=config.get("skill_name", DEFAULT_SKILL_NAME),
        active=config.get("active", False),
        parameter_overrides=config.get("parameter_overrides", {}),
        custom_parameters=custom,
    )


async def activate_skill(
    doctor_id: str,
    active: bool = True,
) -> Dict[str, Any]:

    config = await get_doctor_skill_configuration(doctor_id)

    return await save_doctor_skill_configuration(
        doctor_id=doctor_id,
        enabled_parameters=config.get("enabled_parameters", []),
        skill_name=config.get("skill_name", DEFAULT_SKILL_NAME),
        active=active,
        parameter_overrides=config.get("parameter_overrides", {}),
        custom_parameters=config.get("custom_parameters", []),
    )


# ============================================================
# Result matching
# ============================================================

def _normalize(value: Any) -> str:
    """
    Normalize labels for matching the frozen dashboard labels to agent rows.

    Hyphen variants are unified because the frontend contains labels such as
    Follow-up / Follow‑up and Re-treatment / Re‑treatment.
    """

    text = str(value or "")
    text = text.replace("‐", "-")
    text = text.replace("‑", "-")
    text = text.replace("‒", "-")
    text = text.replace("–", "-")
    text = text.replace("—", "-")
    text = re.sub(r"\s+", " ", text)
    return text.strip().casefold()


def _dashboard_module_data(
    dashboard: Dict[str, Any],
    module_id: str,
) -> Dict[str, Any]:
    modules = dashboard.get("modules") or {}
    envelope = modules.get(module_id)

    if not envelope:
        return {}

    # Existing workflow dashboard shape:
    # modules[m1] = {"status": "success", "cached": ..., "data": {...}}
    return envelope.get("data") or {}


def filter_existing_radiation_output(
    dashboard: Dict[str, Any],
    selected_parameter_ids: List[str],
) -> Dict[str, Any]:
    """
    Filter the already-generated Radiation Oncology Intelligence dashboard.

    No agent is executed here. No clinical calculation is performed here.
    We simply locate the selected frozen `param` in the corresponding
    existing module result.
    """

    selected_parameters = get_selected_parameters(selected_parameter_ids)

    results: List[Dict[str, Any]] = []
    unmatched: List[str] = []

    for definition in selected_parameters:
        parameter_id = definition["id"]
        module_id = definition.get("module_id", "")
        backend_parameter = definition.get(
            "backend_parameter",
            definition.get("name", ""),
        )

        module_data = _dashboard_module_data(
            dashboard,
            module_id,
        )

        rows = module_data.get("rows") or []

        normalized_target = _normalize(backend_parameter)

        matched = None

        for row in rows:
            if not isinstance(row, dict):
                continue

            if _normalize(row.get("param")) == normalized_target:
                matched = row
                break

        if matched:
            # IMPORTANT: preserve the COMPLETE original backend row.
            # Do not reconstruct the result from only finding/ref/status/action.
            # The Skill layer must never discard fields produced by the existing
            # Radiation Oncology agents.
            results.append(
                {
                    "parameter_id": parameter_id,
                    "module_id": module_id,
                    "module_name": definition.get("module_name", ""),
                    "parameter": matched.get(
                        "param",
                        definition.get("name", ""),
                    ),

                    # Full, untouched backend parameter output.
                    "output": matched,

                    # Convenience fields retained for backward compatibility
                    # with the existing frontend. These are NOT the source of
                    # truth; `output` contains the complete result.
                    "current_finding": matched.get("finding"),
                    "reference_expected": matched.get("ref"),
                    "status": matched.get("status"),
                    "status_label": matched.get("statusLabel"),
                    "indication_action": matched.get("action"),
                }
            )
        else:
            unmatched.append(parameter_id)

    return {
        "skill_id": DEFAULT_SKILL_ID,
        "selected_count": len(selected_parameter_ids),
        "matched_count": len(results),
        "unmatched_count": len(unmatched),
        "unmatched_parameter_ids": unmatched,
        "results": results,
    }


# ============================================================
# Persisted test output
# ============================================================


def _json_safe(value: Any) -> Any:
    """
    Convert dashboard output into Mongo/JSON-safe values without changing
    the structure or discarding fields.
    """
    if isinstance(value, datetime):
        return value.isoformat()

    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}

    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]

    # Preserve primitive values. For uncommon non-JSON objects, use their
    # string representation rather than dropping the field.
    if value is None or isinstance(value, (str, int, float, bool)):
        return value

    return str(value)


async def save_skill_test_output(
    doctor_id: str,
    patient_id: str,
    configuration_version: int,
    skill_output: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Persist the COMPLETE selected-parameter output for a doctor/patient.

    Configuration and patient-specific execution output are intentionally
    stored separately. The configuration collection stores what the doctor
    selected; this collection stores what those selections produced.
    """
    now = _now()
    safe_output = _json_safe(skill_output)

    document = {
        "doctor_id": doctor_id,
        "patient_id": patient_id,
        "skill_id": DEFAULT_SKILL_ID,
        "configuration_version": configuration_version,
        "output": safe_output,
        "updated_at": now,
    }

    collection = _test_output_collection()

    await collection.update_one(
        {
            "doctor_id": doctor_id,
            "patient_id": patient_id,
            "skill_id": DEFAULT_SKILL_ID,
        },
        {
            "$set": document,
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )

    return document


async def get_saved_skill_test_output(
    doctor_id: str,
    patient_id: str,
    configuration_version: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    """Return the latest complete saved output for the doctor/patient."""
    query = {
        "doctor_id": doctor_id,
        "patient_id": patient_id,
        "skill_id": DEFAULT_SKILL_ID,
    }

    if configuration_version is not None:
        query["configuration_version"] = configuration_version

    document = await _test_output_collection().find_one(
        query,
        sort=[("updated_at", -1)],
    )

    if document:
        document.pop("_id", None)

    return document


# ============================================================
# Skill execution
# ============================================================

async def generate_doctor_skill_output(
    doctor_id: str,
    patient_id: Optional[str] = None,
    force_regenerate: bool = False,
) -> Dict[str, Any]:

    configuration = await get_doctor_skill_configuration(doctor_id)

    selected_ids = configuration.get(
        "enabled_parameters",
        [],
    )

    custom_parameters = configuration.get(
        "custom_parameters",
        [],
    )

    if not selected_ids and not custom_parameters:
        return {
            "skill_id": DEFAULT_SKILL_ID,
            "doctor_id": doctor_id,
            "skill_name": configuration.get(
                "skill_name",
                DEFAULT_SKILL_NAME,
            ),
            "active": configuration.get("active", False),
            "selected_count": 0,
            "matched_count": 0,
            "unmatched_count": 0,
            "results": [],
            "custom_results": [],
            "message": "No Radiation Oncology parameters are selected.",
        }

    if not patient_id:
        raise ValueError(
            "patient_id is required when testing the Radiation Oncology Skill."
        )

    # Reuse the existing WHOLE radiation dashboard workflow.
    # This does not change or duplicate any agent logic.
    if force_regenerate:
        dashboard = await regenerate_dashboard(
            patient_id=patient_id,
            doctor_id=doctor_id,
        )
    else:
        dashboard = await get_or_generate_dashboard(
            patient_id=patient_id,
            doctor_id=doctor_id,
        )

    filtered = filter_existing_radiation_output(
        dashboard,
        selected_ids,
    )

    custom_results = []

    for item in custom_parameters:
        custom_results.append(
            {
                "parameter_id": item.get("id"),
                "module_id": "custom",
                "module_name": "Doctor Added Checks",
                "parameter": item.get("name", ""),
                "current_finding": "Manual review required",
                "reference_expected": item.get(
                    "description",
                    "Doctor-defined review",
                ),
                "status": "neutral",
                "status_label": "Manual Review",
                "indication_action": "Manual clinical review",
                "type": "manual_review",
                "output": {
                    "id": item.get("id"),
                    "name": item.get("name", ""),
                    "description": item.get("description", ""),
                    "type": "manual_review",
                    "status": "neutral",
                    "statusLabel": "Manual Review",
                    "finding": "Manual review required",
                    "action": "Manual clinical review",
                },
            }
        )

    filtered["doctor_id"] = doctor_id
    filtered["skill_name"] = configuration.get(
        "skill_name",
        DEFAULT_SKILL_NAME,
    )
    filtered["active"] = configuration.get(
        "active",
        False,
    )
    filtered["configuration_version"] = configuration.get(
        "version",
        1,
    )
    filtered["patient_id"] = patient_id
    filtered["custom_results"] = custom_results
    filtered["custom_count"] = len(custom_results)

    # Preserve only useful dashboard generation metadata.
    filtered["dashboard_generated_at"] = dashboard.get("header", {}).get(
        "generatedAt"
    ) if isinstance(dashboard.get("header"), dict) else None

    # Persist the complete patient-specific Skill result. This includes the
    # untouched `output` object for every matched selected parameter.
    persisted_output = _json_safe(filtered)
    await save_skill_test_output(
        doctor_id=doctor_id,
        patient_id=patient_id,
        configuration_version=int(configuration.get("version", 1)),
        skill_output=persisted_output,
    )

    filtered["output_saved"] = True

    return filtered


# ============================================================
# Markdown export
# ============================================================

def _clean_markdown_cell(value: Any) -> str:
    if value is None:
        return "—"

    text = str(value).strip()

    if not text:
        return "—"

    text = text.replace("**", "")
    text = text.replace("__", "")
    text = text.replace("\r\n", " ")
    text = text.replace("\n", " ")
    text = text.replace("\r", " ")
    text = text.replace("|", "\\|")

    return " ".join(text.split())


async def generate_skill_markdown(
    doctor_id: str,
    patient_id: Optional[str] = None,
    force_regenerate: bool = False,
) -> str:
    """
    Export the selected Skill output without losing any backend fields.

    The export contains:
      1. A readable summary table.
      2. The COMPLETE original backend output for every selected parameter.
      3. Complete custom/manual-review output.

    A fresh Skill execution is used when patient_id is supplied so Export and
    Test always use the same complete-output pipeline.
    """
    config = await get_doctor_skill_configuration(doctor_id)

    selected_ids = config.get("enabled_parameters", [])
    custom_parameters = config.get("custom_parameters", [])

    if not selected_ids and not custom_parameters:
        return (
            "# Radiation Oncology Intelligence Skill\n\n"
            "No checks are configured for this Skill.\n"
        )

    if not patient_id:
        raise ValueError(
            "patient_id is required when exporting the Radiation Oncology Skill."
        )

    # This generates the same complete output that Test uses and also updates
    # the persisted patient-specific result.
    skill_output = await generate_doctor_skill_output(
        doctor_id=doctor_id,
        patient_id=patient_id,
        force_regenerate=force_regenerate,
    )

    results = skill_output.get("results", [])
    custom_results = skill_output.get("custom_results", [])

    result_by_id = {
        item.get("parameter_id"): item
        for item in results
        if item.get("parameter_id")
    }

    selected = get_selected_parameters(selected_ids)

    markdown: List[str] = [
        "# Radiation Oncology Intelligence Skill\n\n",
        f"**Patient ID:** {_clean_markdown_cell(patient_id)}  \n",
        f"**Doctor ID:** {_clean_markdown_cell(doctor_id)}  \n",
        f"**Configuration Version:** {_clean_markdown_cell(skill_output.get('configuration_version'))}  \n",
        f"**Generated At:** {_clean_markdown_cell(skill_output.get('dashboard_generated_at'))}\n\n",
    ]

    # ------------------------------------------------------------
    # 1. Readable summary table
    # ------------------------------------------------------------
    current_module = None
    number = 1

    for parameter in selected:
        module_id = parameter.get("module_id", "")
        module_name = parameter.get(
            "module_name",
            "Radiation Oncology Assessment",
        )

        if module_id != current_module:
            if current_module is not None:
                markdown.append("\n")

            current_module = module_id

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

        parameter_id = parameter.get("id")

        override = (
            config.get("parameter_overrides", {}).get(parameter_id)
            or {}
        )

        title = (
            override.get("name")
            or parameter.get("name")
            or ""
        )

        result = result_by_id.get(parameter_id)

        if result:
            parameter_name = result.get("parameter") or title
            current_finding = result.get("current_finding")
            reference_expected = result.get("reference_expected")
            status = result.get("status_label") or result.get("status")
            indication_action = result.get("indication_action")
        else:
            parameter_name = title
            current_finding = "No backend result available"
            reference_expected = "—"
            status = "Unmatched"
            indication_action = "Review parameter mapping"

        markdown.append(
            f"| {number} | "
            f"{_clean_markdown_cell(parameter_name)} | "
            f"{_clean_markdown_cell(current_finding)} | "
            f"{_clean_markdown_cell(reference_expected)} | "
            f"{_clean_markdown_cell(status)} | "
            f"{_clean_markdown_cell(indication_action)} |\n"
        )

        number += 1

    if custom_results:
        markdown.append("\n")
        markdown.append("## Doctor Added Checks\n\n")
        markdown.append(
            "| # | Parameter | Current Finding | "
            "Reference / Expected | Status | Indication / Action |\n"
        )
        markdown.append(
            "|---:|---|---|---|---|---|\n"
        )

        for item in custom_results:
            markdown.append(
                f"| {number} | "
                f"{_clean_markdown_cell(item.get('parameter'))} | "
                f"{_clean_markdown_cell(item.get('current_finding'))} | "
                f"{_clean_markdown_cell(item.get('reference_expected'))} | "
                f"{_clean_markdown_cell(item.get('status_label'))} | "
                f"{_clean_markdown_cell(item.get('indication_action'))} |\n"
            )
            number += 1

    # ------------------------------------------------------------
    # 2. COMPLETE backend output
    # ------------------------------------------------------------
    markdown.append("\n## Complete Backend Output\n\n")
    markdown.append(
        "The JSON below is the complete original backend output for each "
        "selected parameter. No backend fields are intentionally removed.\n\n"
    )

    for parameter in selected:
        parameter_id = parameter.get("id")
        result = result_by_id.get(parameter_id)

        markdown.append(
            f"### {number if False else parameter_id} — "
            f"{_clean_markdown_cell(parameter.get('name', ''))}\n\n"
        )

        if result and isinstance(result.get("output"), dict):
            complete_output = _json_safe(result["output"])
        elif result:
            complete_output = _json_safe(result.get("output"))
        else:
            complete_output = {
                "parameter_id": parameter_id,
                "message": "No backend result available",
            }

        markdown.append("```json\n")
        markdown.append(
            json.dumps(
                complete_output,
                ensure_ascii=False,
                indent=2,
            )
        )
        markdown.append("\n```\n\n")

    if custom_results:
        markdown.append("## Complete Custom Parameter Output\n\n")
        for item in custom_results:
            markdown.append(
                f"### {_clean_markdown_cell(item.get('parameter_id'))} — "
                f"{_clean_markdown_cell(item.get('parameter'))}\n\n"
            )
            markdown.append("```json\n")
            markdown.append(
                json.dumps(
                    _json_safe(item.get("output", item)),
                    ensure_ascii=False,
                    indent=2,
                )
            )
            markdown.append("\n```\n\n")

    return "".join(markdown)

async def ensure_indexes() -> None:
    collection = _collection()

    await collection.create_index(
        [
            ("doctor_id", 1),
            ("skill_id", 1),
        ],
        unique=True,
    )

    test_collection = _test_output_collection()

    await test_collection.create_index(
        [
            ("doctor_id", 1),
            ("patient_id", 1),
            ("skill_id", 1),
        ],
        unique=True,
    )

    await test_collection.create_index(
        [
            ("doctor_id", 1),
            ("patient_id", 1),
            ("configuration_version", 1),
            ("updated_at", -1),
        ]
    )
