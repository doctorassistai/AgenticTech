"""
surgical_oncology_skill_service.py

Doctor-configurable Skill layer for the EXISTING Surgical Oncology Intelligence
12-agent dashboard.

The existing 12 agents are not modified. This layer configures, filters, tests,
persists and exports the output they already produce.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from langchain_groq import ChatGroq

from Agentic.surgical_onc_workflow.data_sources import mongo_safe
from Agentic.surgical_onc_workflow.store import get_latest_dashboard, save_dashboard
from Agentic.surgical_onc_workflow.workflow import create_dashboard_workflow

SKILL_FILE = Path(__file__).resolve().parent / "surgical_oncology_skill.json"
DEFAULT_SKILL_ID = "surgical_oncology_intelligence"
DEFAULT_SKILL_NAME = "Surgical Oncology Intelligence Skill"

CONFIG_COLLECTION_NAME = "surgical_oncology_skill_configurations"
TEST_COLLECTION_NAME = "surgical_oncology_skill_test_outputs"

_GROQ_API_KEY = os.getenv("GROQ_API_KEY")
_skill_llm = ChatGroq(
    model="openai/gpt-oss-120b",
    temperature=0.1,
    api_key=_GROQ_API_KEY,
)
_skill_graph = create_dashboard_workflow(_skill_llm)


# ============================================================
# Catalog
# ============================================================

def load_surgical_oncology_skill() -> Dict[str, Any]:
    if not SKILL_FILE.exists():
        raise FileNotFoundError(f"Surgical Oncology Skill file not found: {SKILL_FILE}")
    with SKILL_FILE.open("r", encoding="utf-8") as f:
        return json.load(f)


def get_skill_catalog() -> Dict[str, Any]:
    return load_surgical_oncology_skill()


def get_all_skill_parameters() -> List[Dict[str, Any]]:
    parameters: List[Dict[str, Any]] = []
    for module in load_surgical_oncology_skill().get("modules", []):
        module_id = module.get("module_id", "")
        module_name = module.get("module_name", module.get("title", ""))
        for parameter in module.get("parameters", []):
            parameters.append({
                **parameter,
                "module_id": module_id,
                "module_name": module_name,
            })
    return parameters


def get_selected_parameters(selected_parameter_ids: List[str]) -> List[Dict[str, Any]]:
    selected = set(selected_parameter_ids or [])
    return [
        p for p in get_all_skill_parameters()
        if p.get("id") in selected
    ]


def get_skill_parameter(parameter_id: str) -> Optional[Dict[str, Any]]:
    return next(
        (p for p in get_all_skill_parameters() if p.get("id") == parameter_id),
        None,
    )


def validate_parameter_ids(parameter_ids: List[str]) -> Dict[str, Any]:
    valid_ids = {p.get("id") for p in get_all_skill_parameters() if p.get("id")}
    requested = set(parameter_ids or [])
    valid = [
        p.get("id")
        for p in get_all_skill_parameters()
        if p.get("id") in requested
    ]
    invalid = sorted(requested.difference(valid_ids))
    return {"valid_ids": valid, "invalid_ids": invalid}


# ============================================================
# Mongo configuration
# ============================================================

def _config_collection():
    from Agentic.surgical_onc_workflow.data_sources import _database
    return _database[CONFIG_COLLECTION_NAME]


def _test_collection():
    from Agentic.surgical_onc_workflow.data_sources import _database
    return _database[TEST_COLLECTION_NAME]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _new_configuration(doctor_id: str) -> Dict[str, Any]:
    return {
        "doctor_id": doctor_id,
        "skill_id": DEFAULT_SKILL_ID,
        "skill_name": DEFAULT_SKILL_NAME,
        "active": False,
        "enabled_parameters": [],
        "selected_parameter_definitions": [],
        "parameter_overrides": {},
        "custom_parameters": [],
        "version": 1,
        "created_at": None,
        "updated_at": None,
        "last_test_patient_id": None,
        "last_test_at": None,
        "last_test_output_id": None,
    }


async def get_doctor_skill_configuration(doctor_id: str) -> Dict[str, Any]:
    configuration = await _config_collection().find_one(
        {"doctor_id": doctor_id, "skill_id": DEFAULT_SKILL_ID}
    )
    if configuration:
        configuration.pop("_id", None)
        if "selected_parameter_definitions" not in configuration:
            configuration["selected_parameter_definitions"] = get_selected_parameters(
                configuration.get("enabled_parameters", [])
            )
        return mongo_safe(configuration)
    return _new_configuration(doctor_id)


async def save_doctor_skill_configuration(
    doctor_id: str,
    enabled_parameters: List[str],
    skill_name: Optional[str] = None,
    active: bool = False,
    parameter_overrides: Optional[Dict[str, Any]] = None,
    custom_parameters: Optional[List[Dict[str, Any]]] = None,
    selected_parameter_definitions: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    validation = validate_parameter_ids(list(dict.fromkeys(enabled_parameters or [])))
    if validation["invalid_ids"]:
        raise ValueError(
            "Invalid Surgical Oncology Skill parameter IDs: "
            + ", ".join(validation["invalid_ids"])
        )

    override_map = parameter_overrides or {}
    # Never trust the client to define the catalog. Rebuild the complete selected
    # definition snapshot from the server-side JSON catalog.
    normalized_definitions = []
    for definition in get_selected_parameters(validation["valid_ids"]):
        item = dict(definition)
        override = dict(override_map.get(item["id"]) or {})
        if override.get("name"):
            item["configured_name"] = override["name"]
        if "description" in override:
            item["configured_description"] = override["description"]
        normalized_definitions.append(item)

    now = _now()
    collection = _config_collection()
    existing = await collection.find_one(
        {"doctor_id": doctor_id, "skill_id": DEFAULT_SKILL_ID}
    )

    if existing:
        version = int(existing.get("version", 1)) + 1
        created_at = existing.get("created_at")
        await collection.update_one(
            {"_id": existing["_id"]},
            {"$set": {
                "skill_name": skill_name or DEFAULT_SKILL_NAME,
                "active": bool(active),
                "enabled_parameters": validation["valid_ids"],
                "selected_parameter_definitions": normalized_definitions,
                "parameter_overrides": override_map,
                "custom_parameters": custom_parameters or [],
                "version": version,
                "updated_at": now,
            }},
        )
    else:
        version = 1
        created_at = now
        await collection.insert_one({
            "doctor_id": doctor_id,
            "skill_id": DEFAULT_SKILL_ID,
            "skill_name": skill_name or DEFAULT_SKILL_NAME,
            "active": bool(active),
            "enabled_parameters": validation["valid_ids"],
            "selected_parameter_definitions": normalized_definitions,
            "parameter_overrides": override_map,
            "custom_parameters": custom_parameters or [],
            "version": version,
            "created_at": created_at,
            "updated_at": now,
            "last_test_patient_id": None,
            "last_test_at": None,
            "last_test_output_id": None,
        })

    return mongo_safe({
        "doctor_id": doctor_id,
        "skill_id": DEFAULT_SKILL_ID,
        "skill_name": skill_name or DEFAULT_SKILL_NAME,
        "active": bool(active),
        "enabled_parameters": validation["valid_ids"],
        "selected_parameter_definitions": normalized_definitions,
        "selected_count": len(validation["valid_ids"]),
        "total_available": len(get_all_skill_parameters()),
        "parameter_overrides": override_map,
        "custom_parameters": custom_parameters or [],
        "version": version,
        "created_at": created_at,
        "updated_at": now,
    })


async def edit_skill_parameter(
    doctor_id: str,
    parameter_id: str,
    name: Optional[str] = None,
    description: Optional[str] = None,
) -> Dict[str, Any]:
    if not get_skill_parameter(parameter_id):
        raise ValueError(f"Unknown Surgical Oncology Skill parameter: {parameter_id}")

    config = await get_doctor_skill_configuration(doctor_id)
    overrides = dict(config.get("parameter_overrides") or {})
    item = dict(overrides.get(parameter_id) or {})

    if name is not None:
        item["name"] = name.strip()
    if description is not None:
        item["description"] = description.strip()

    overrides[parameter_id] = item
    return await save_doctor_skill_configuration(
        doctor_id=doctor_id,
        enabled_parameters=config.get("enabled_parameters", []),
        skill_name=config.get("skill_name", DEFAULT_SKILL_NAME),
        active=config.get("active", False),
        parameter_overrides=overrides,
        custom_parameters=config.get("custom_parameters", []),
    )


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
    used = {str(x.get("id")) for x in custom}
    number = 1
    while f"CUSTOM-{number:03d}" in used:
        number += 1

    custom.append({
        "id": f"CUSTOM-{number:03d}",
        "number": number,
        "name": name,
        "description": description,
        "type": "manual_review",
    })

    return await save_doctor_skill_configuration(
        doctor_id=doctor_id,
        enabled_parameters=config.get("enabled_parameters", []),
        skill_name=config.get("skill_name", DEFAULT_SKILL_NAME),
        active=config.get("active", False),
        parameter_overrides=config.get("parameter_overrides", {}),
        custom_parameters=custom,
    )


async def activate_skill(doctor_id: str, active: bool = True) -> Dict[str, Any]:
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
# Existing dashboard access
# ============================================================

async def _run_and_store_dashboard(patient_id: str) -> Dict[str, Any]:
    final = await _skill_graph.ainvoke({"patient_id": patient_id})
    result = {
        "patient": final.get("patient", {}),
        "kpis": final.get("kpis", {}),
        "modules": {
            mid: (
                module.model_dump()
                if hasattr(module, "model_dump")
                else module
            )
            for mid, module in (final.get("modules") or {}).items()
        },
        "warnings": final.get("warnings", []),
    }
    return await save_dashboard(patient_id, result)


async def _get_dashboard_for_skill(
    patient_id: str,
    force_regenerate: bool = False,
) -> Dict[str, Any]:
    if not force_regenerate:
        existing = await get_latest_dashboard(patient_id)
        if existing:
            return existing
    return await _run_and_store_dashboard(patient_id)


# ============================================================
# Result matching — COMPLETE original row is retained
# ============================================================

def _normalize(value: Any) -> str:
    text = str(value or "")
    text = text.replace("‐", "-").replace("‑", "-").replace("‒", "-")
    text = text.replace("–", "-").replace("—", "-")
    return re.sub(r"\s+", " ", text).strip().casefold()


def _dashboard_module_data(
    dashboard: Dict[str, Any],
    module_id: str,
) -> Dict[str, Any]:
    module = (dashboard.get("modules") or {}).get(module_id)
    if not module:
        return {}
    if isinstance(module, dict) and isinstance(module.get("data"), dict):
        return module["data"]
    return module if isinstance(module, dict) else {}


def filter_existing_surgical_output(
    dashboard: Dict[str, Any],
    selected_parameter_ids: List[str],
) -> Dict[str, Any]:
    results: List[Dict[str, Any]] = []
    unmatched: List[str] = []

    for definition in get_selected_parameters(selected_parameter_ids):
        parameter_id = definition["id"]
        module_id = definition.get("module_id", "")
        backend_parameter = definition.get(
            "backend_parameter",
            definition.get("name", ""),
        )
        rows = (_dashboard_module_data(dashboard, module_id).get("rows") or [])

        matched = None
        target = _normalize(backend_parameter)

        for row in rows:
            if not isinstance(row, dict):
                continue
            actual = row.get("parameter", row.get("param", ""))
            if _normalize(actual) == target:
                matched = row
                break

        if matched is None:
            unmatched.append(parameter_id)
            continue

        # DO NOT reconstruct the backend result. Keep every field emitted by the
        # existing agent, including m9's lastGenerated/completeness fields.
        full_output = mongo_safe(dict(matched))

        results.append({
            "parameter_id": parameter_id,
            "module_id": module_id,
            "module_name": definition.get("module_name", ""),
            "parameter": matched.get(
                "parameter",
                matched.get("param", definition.get("name", "")),
            ),
            "current_finding": matched.get(
                "finding",
                matched.get("current_finding"),
            ),
            "reference_expected": matched.get(
                "reference",
                matched.get("ref", matched.get("reference_expected")),
            ),
            "status": matched.get("status"),
            "status_label": matched.get(
                "statusLabel",
                matched.get("status_label"),
            ),
            "indication_action": matched.get(
                "action",
                matched.get("indication_action"),
            ),
            "output": full_output,
        })

    return {
        "skill_id": DEFAULT_SKILL_ID,
        "selected_count": len(selected_parameter_ids),
        "matched_count": len(results),
        "unmatched_count": len(unmatched),
        "unmatched_parameter_ids": unmatched,
        "results": results,
    }


# ============================================================
# Persist complete patient-specific test output
# ============================================================

async def _save_test_output(
    doctor_id: str,
    patient_id: str,
    configuration: Dict[str, Any],
    skill_output: Dict[str, Any],
) -> Dict[str, Any]:
    now = _now()
    document = {
        "doctor_id": doctor_id,
        "patient_id": patient_id,
        "skill_id": DEFAULT_SKILL_ID,
        "skill_name": configuration.get("skill_name", DEFAULT_SKILL_NAME),
        "configuration_version": configuration.get("version", 1),
        "generated_at": now,
        "selected_parameter_ids": configuration.get("enabled_parameters", []),
        "selected_parameter_definitions": (
            configuration.get("selected_parameter_definitions")
            or get_selected_parameters(configuration.get("enabled_parameters", []))
        ),
        "custom_parameters": configuration.get("custom_parameters", []),
        "output": mongo_safe(skill_output),
    }

    inserted = await _test_collection().insert_one(document)
    await _config_collection().update_one(
        {"doctor_id": doctor_id, "skill_id": DEFAULT_SKILL_ID},
        {"$set": {
            "last_test_patient_id": patient_id,
            "last_test_at": now,
            "last_test_output_id": inserted.inserted_id,
        }},
    )

    return {
        "test_output_id": str(inserted.inserted_id),
        "generated_at": now,
    }


async def get_latest_test_output(
    doctor_id: str,
    patient_id: str,
    configuration_version: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    query: Dict[str, Any] = {
        "doctor_id": doctor_id,
        "patient_id": patient_id,
        "skill_id": DEFAULT_SKILL_ID,
    }
    if configuration_version is not None:
        query["configuration_version"] = configuration_version

    doc = await _test_collection().find_one(query, sort=[("generated_at", -1)])
    return mongo_safe(doc) if doc else None


async def generate_doctor_skill_output(
    doctor_id: str,
    patient_id: Optional[str] = None,
    force_regenerate: bool = False,
    persist_output: bool = True,
) -> Dict[str, Any]:
    configuration = await get_doctor_skill_configuration(doctor_id)
    selected_ids = configuration.get("enabled_parameters", [])
    custom_parameters = configuration.get("custom_parameters", [])

    if not selected_ids and not custom_parameters:
        return {
            "skill_id": DEFAULT_SKILL_ID,
            "doctor_id": doctor_id,
            "skill_name": configuration.get("skill_name", DEFAULT_SKILL_NAME),
            "active": configuration.get("active", False),
            "configuration_version": configuration.get("version", 1),
            "selected_count": 0,
            "matched_count": 0,
            "unmatched_count": 0,
            "results": [],
            "custom_results": [],
            "message": "No Surgical Oncology parameters are selected.",
        }

    if not patient_id:
        raise ValueError(
            "patient_id is required when testing the Surgical Oncology Skill."
        )

    dashboard = await _get_dashboard_for_skill(
        patient_id,
        force_regenerate=force_regenerate,
    )

    filtered = filter_existing_surgical_output(dashboard, selected_ids)

    custom_results = []
    for item in custom_parameters:
        custom_results.append({
            "parameter_id": item.get("id"),
            "module_id": "custom",
            "module_name": "Doctor Added Checks",
            "parameter": item.get("name", ""),
            "current_finding": "Manual review required",
            "reference_expected": item.get("description", "Doctor-defined review"),
            "status": "neutral",
            "status_label": "Manual Review",
            "indication_action": "Manual clinical review",
            "type": "manual_review",
            "output": mongo_safe(dict(item)),
        })

    filtered.update({
        "doctor_id": doctor_id,
        "skill_name": configuration.get("skill_name", DEFAULT_SKILL_NAME),
        "active": configuration.get("active", False),
        "configuration_version": configuration.get("version", 1),
        "patient_id": patient_id,
        "custom_results": custom_results,
        "custom_count": len(custom_results),
        "dashboard_generated_at": dashboard.get("generated_at")
        or (
            dashboard.get("header", {}).get("generatedAt")
            if isinstance(dashboard.get("header"), dict)
            else None
        ),
    })

    if persist_output:
        filtered.update(await _save_test_output(
            doctor_id,
            patient_id,
            configuration,
            filtered,
        ))

    return mongo_safe(filtered)


# ============================================================
# Markdown export — summary + FULL original row JSON
# ============================================================

def _clean_markdown_cell(value: Any) -> str:
    if value is None:
        return "—"
    text = str(value).strip()
    if not text:
        return "—"
    text = text.replace("**", "").replace("__", "")
    text = text.replace("\r\n", " ").replace("\n", " ").replace("\r", " ")
    text = text.replace("|", "\\|")
    return " ".join(text.split())


async def generate_skill_markdown(
    doctor_id: str,
    patient_id: Optional[str] = None,
    force_regenerate: bool = False,
) -> str:
    if not patient_id:
        raise ValueError(
            "patient_id is required to export patient-specific Surgical Oncology Skill output."
        )

    config = await get_doctor_skill_configuration(doctor_id)
    selected_ids = config.get("enabled_parameters", [])
    custom_parameters = config.get("custom_parameters", [])

    if not selected_ids and not custom_parameters:
        return "# Surgical Oncology Intelligence Skill\n\nNo checks are configured for this Skill.\n"

    stored = None if force_regenerate else await get_latest_test_output(
        doctor_id=doctor_id,
        patient_id=patient_id,
        configuration_version=config.get("version", 1),
    )

    if stored:
        skill_output = stored.get("output") or {}
    else:
        skill_output = await generate_doctor_skill_output(
            doctor_id=doctor_id,
            patient_id=patient_id,
            force_regenerate=force_regenerate,
            persist_output=True,
        )

    result_by_id = {
        x.get("parameter_id"): x
        for x in skill_output.get("results", [])
        if x.get("parameter_id")
    }

    markdown = [
        "# Surgical Oncology Intelligence Skill\n\n",
        f"- Doctor ID: `{_clean_markdown_cell(doctor_id)}`\n",
        f"- Patient ID: `{_clean_markdown_cell(patient_id)}`\n",
        f"- Configuration version: `{_clean_markdown_cell(config.get('version', 1))}`\n",
        f"- Selected checks: `{_clean_markdown_cell(skill_output.get('selected_count', 0))}`\n",
        f"- Matched checks: `{_clean_markdown_cell(skill_output.get('matched_count', 0))}`\n",
        f"- Custom checks: `{_clean_markdown_cell(skill_output.get('custom_count', 0))}`\n\n",
    ]

    current_module = None
    number = 1

    for parameter in get_selected_parameters(selected_ids):
        module_id = parameter.get("module_id", "")
        module_name = parameter.get("module_name", "Surgical Oncology Assessment")

        if module_id != current_module:
            if current_module is not None:
                markdown.append("\n")
            current_module = module_id
            markdown.append(f"## {_clean_markdown_cell(module_name)}\n\n")
            markdown.append(
                "| # | Parameter | Current Finding | Reference / Expected | Status | Indication / Action |\n"
            )
            markdown.append("|---:|---|---|---|---|---|\n")

        parameter_id = parameter.get("id")
        override = dict((config.get("parameter_overrides") or {}).get(parameter_id) or {})
        title = override.get("name") or parameter.get("name") or ""
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
            f"| {number} | {_clean_markdown_cell(parameter_name)} | "
            f"{_clean_markdown_cell(current_finding)} | "
            f"{_clean_markdown_cell(reference_expected)} | "
            f"{_clean_markdown_cell(status)} | "
            f"{_clean_markdown_cell(indication_action)} |\n"
        )

        if result:
            markdown.append(
                f"\n### Complete Backend Output — {_clean_markdown_cell(parameter_name)}\n\n"
                "```json\n"
                + json.dumps(
                    result.get("output") or {},
                    indent=2,
                    ensure_ascii=False,
                    default=str,
                )
                + "\n```\n\n"
            )
        number += 1

    if custom_parameters:
        markdown.extend([
            "\n## Doctor Added Checks\n\n",
            "| # | Parameter | Current Finding | Reference / Expected | Status | Indication / Action |\n",
            "|---:|---|---|---|---|---|\n",
        ])
        for item in skill_output.get("custom_results", []):
            markdown.append(
                f"| {number} | {_clean_markdown_cell(item.get('parameter'))} | "
                f"{_clean_markdown_cell(item.get('current_finding'))} | "
                f"{_clean_markdown_cell(item.get('reference_expected'))} | "
                f"{_clean_markdown_cell(item.get('status_label'))} | "
                f"{_clean_markdown_cell(item.get('indication_action'))} |\n"
            )
            markdown.append(
                f"\n### Complete Custom Output — {_clean_markdown_cell(item.get('parameter'))}\n\n"
                "```json\n"
                + json.dumps(item.get("output") or {}, indent=2, ensure_ascii=False, default=str)
                + "\n```\n\n"
            )
            number += 1

    return "".join(markdown)


async def ensure_indexes() -> None:
    await _config_collection().create_index(
        [("doctor_id", 1), ("skill_id", 1)],
        unique=True,
    )
    await _test_collection().create_index([
        ("doctor_id", 1),
        ("patient_id", 1),
        ("skill_id", 1),
        ("configuration_version", 1),
        ("generated_at", -1),
    ])
