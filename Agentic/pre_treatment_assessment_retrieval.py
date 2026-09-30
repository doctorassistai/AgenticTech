# ============================================================
# FILE 1
# pre_treatment_assessment_retrieval.py
#
# RESPONSIBILITY
# --------------------------------------------------------
# 1. Receive frontend pre-treatment assessment request
# 2. Retrieve doctor information from MongoDB
# 3. Retrieve patient information from MongoDB
# 4. Retrieve LATEST state from Patient Clinical/Event Graph
# 5. Retrieve the latest clinical/synthesis state
# 6. Build one source-preserving clinical context
# 7. Pass the latest context to File 2 Agent Harness
#
# IMPORTANT
# ------------------------------------------------------------
# - No disease-specific logic
# - No specialty-specific logic
# - No hardcoded clinical fields
# - No keyword mapping
# - No predefined assessment checklist
# - No hardcoded treatment rules
# - Latest clinical retrieval is isolated in this file.
# - File 2 must receive only the latest retrieved clinical state.
#
# FILE 2 will contain:
# - Agents
# - Prompts
# - Agent Harness
# - Orchestration
# - Agentic retrieval loop
# - Assessment generation
# - Evidence verification
# ============================================================


import os
import json
import asyncio
from typing import Dict, Any, List, Optional

from datetime import datetime, timezone

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from pydantic import BaseModel, Field

from motor.motor_asyncio import AsyncIOMotorClient
from neo4j import AsyncGraphDatabase

from loguru import logger

from dotenv import load_dotenv
from Agentic.pre_treatment_assessment_agent import (
    run_pre_treatment_harness,
    invoke_agent,
    extract_json,
)

# Canonical/default skill definitions are kept in clinical_expertise_skills.py.
# MongoDB is the runtime source of skill documents and doctor customizations.
from Agentic.clinical_expertise_skills import (
    SPECIALTY_SKILLS,
    DISEASE_SKILLS,
    TREATMENT_SKILLS,
    FACILITY_SKILLS,
    build_expertise_context as build_registry_expertise_context,
    resolve_disease_skills as _registry_resolve_disease_skills,
    resolve_treatment_skills as _registry_resolve_treatment_skills,
    resolve_facility_skills as _registry_resolve_facility_skills,
)

# ============================================================
# ENVIRONMENT
# ============================================================

load_dotenv()


# ============================================================
# ROUTER
# ============================================================

router = APIRouter(
    prefix="/pre-treatment-assessment-new",
    tags=["pre-treatment-assessment"],
)


# ============================================================
# MONGODB
# ============================================================

MONGO_URI = os.getenv("MONGO_URI")

MONGO_DB = os.getenv(
    "MONGO_DB",
    "doctorassistai",
)


if not MONGO_URI:
    logger.warning(
        "MONGO_URI is not configured"
    )


mongodb_client = AsyncIOMotorClient(
    MONGO_URI
)

_db = mongodb_client[MONGO_DB]


doctor_user_collection = _db.doctor_users

patient_user_collection = _db.patient_users

pre_treatment_assessments_collection = (
    _db.pre_treatment_assessments
)


# ============================================================
# CLINICAL EXPERTISE MONGODB COLLECTIONS
# ============================================================

clinical_expertise_skills_collection = (
    _db.clinical_expertise_skills
)

doctor_skill_profiles_collection = (
    _db.doctor_skill_profiles
)

_skill_seed_lock = asyncio.Lock()
_skill_indexes_ready = False



# ============================================================
# CLINICAL EXPERTISE MONGODB ARCHITECTURE
# ============================================================

def _skill_catalog() -> List[Dict[str, Any]]:
    """
    Flatten the predefined Python skill registries into MongoDB seed
    documents.

    The Python file is a seed/default source only. It is not used as
    the runtime skill store after the documents exist in MongoDB.
    """
    documents: List[Dict[str, Any]] = []

    for registry in (
        SPECIALTY_SKILLS,
        DISEASE_SKILLS,
        TREATMENT_SKILLS,
        FACILITY_SKILLS,
    ):
        for skill_id, skill in registry.items():
            if not isinstance(skill, dict):
                continue

            document = _safe_copy(skill)
            document["skill_id"] = skill_id
            document["catalog_source"] = "clinical_expertise_skills.py"
            document.setdefault("version", 1)
            document.setdefault("status", "active")
            documents.append(document)

    return documents


async def ensure_skill_mongodb_indexes() -> None:
    """
    Create indexes required by the runtime resolver.

    This is idempotent and is intentionally kept in this file so no
    additional application file is required.
    """
    global _skill_indexes_ready

    if _skill_indexes_ready:
        return

    async with _skill_seed_lock:
        if _skill_indexes_ready:
            return

        await clinical_expertise_skills_collection.create_index(
            [("skill_id", 1)],
            unique=True,
            name="clinical_expertise_skill_id_unique",
        )

        await doctor_skill_profiles_collection.create_index(
            [("doctor_id", 1), ("skill_id", 1)],
            unique=True,
            name="doctor_skill_profile_unique",
        )

        _skill_indexes_ready = True

        logger.info(
            "[PreTreatment Skills] MongoDB indexes ready | "
            "canonical_collection=clinical_expertise_skills | "
            "doctor_collection=doctor_skill_profiles"
        )


async def ensure_skill_catalog_seeded() -> None:
    """
    Insert predefined skills into MongoDB if they are not already there.

    IMPORTANT:
      - Existing MongoDB skill documents are NOT overwritten.
      - Doctor customizations are stored separately.
      - Therefore a doctor customization cannot be lost when the
        application restarts.
    """
    await ensure_skill_mongodb_indexes()

    seed_documents = _skill_catalog()

    inserted = 0
    existing = 0

    for skill in seed_documents:
        result = await clinical_expertise_skills_collection.update_one(
            {"skill_id": skill["skill_id"]},
            {
                "$setOnInsert": skill,
            },
            upsert=True,
        )

        if result.upserted_id is not None:
            inserted += 1
        else:
            existing += 1

    logger.info(
        "[PreTreatment Skills] Skill catalog checked | "
        f"total={len(seed_documents)} | "
        f"inserted={inserted} | existing={existing}"
    )

# ============================================================
# LLM-ASSISTED SKILL SUGGESTION
# ============================================================
#
# IMPORTANT
# ------------------------------------------------------------
# This endpoint NEVER writes anything to MongoDB.
# It NEVER feeds directly into assessment generation.
# It ONLY returns candidate canonical skill_ids, constrained to
# the existing catalog, for a clinician to review and confirm.
#
# The LLM cannot invent a skill_id: any id it returns that is not
# already in the catalog is discarded before the response leaves
# this function.
# ============================================================

class ExpertiseSkillSuggestionRequest(BaseModel):
    patient_id: str = Field(...)
    doctor_id: str = Field(...)


SKILL_SUGGESTION_PROMPT = """
You are classifying already-documented clinical text against a FIXED
catalog of canonical skill IDs.

You may only return skill_id values that appear in the supplied
catalog. If nothing in the catalog reasonably matches, return an
empty list for that category.

Do not invent a skill_id.
Do not guess beyond what the supplied text actually documents.
Do not select a skill_id "for completeness" if the text does not
support it.
A patient may reasonably match zero, one, or several disease/
treatment/modality/facility skill_ids if the documented text
supports it. "modality" and "treatment" are separate catalog types —
only place an id under the category matching its own catalog "type".

Return JSON only:

{
  "disease_skill_ids": [],
  "treatment_skill_ids": [],
  "modality_skill_ids": [],
  "facility_skill_ids": [],
  "reasoning": ""
}
"""


@router.post(
    "/skills/suggest"
)
async def suggest_expertise_skills(
    payload: ExpertiseSkillSuggestionRequest,
):
    """
    Suggest candidate disease/treatment/facility skill_ids for a
    patient, for clinician review. Never persists anything.
    """
    try:
        await ensure_skill_catalog_seeded()

        patient_data = await fetch_patient_mongodb_data(
            payload.patient_id
        )

        if not patient_data:
            return JSONResponse(
                status_code=404,
                content={"status": "error", "message": "Patient not found"},
            )

        graph_data = await fetch_latest_graph_data(
            patient_id=payload.patient_id,
            doctor_id=payload.doctor_id,
        )

        graph_state = (graph_data or {}).get("data") or {}

        # Only real, already-documented text goes into the prompt.
        documented_text = {
            "conditions": graph_state.get("conditions"),
            "profile": graph_state.get("profile"),
            "summaries": graph_state.get("summaries"),
        }

        catalog = await clinical_expertise_skills_collection.find(
            {
                "status": {"$ne": "inactive"},
                "type": {"$in": ["disease", "treatment", "modality", "facility"]},
            },
            {"_id": 0, "skill_id": 1, "name": 1, "type": 1},
        ).to_list(length=None)

        user_payload = {
            "catalog": _safe_copy(catalog),
            "documented_clinical_text": _safe_copy(documented_text),
        }

        response = await invoke_agent(
            system_prompt=SKILL_SUGGESTION_PROMPT,
            user_prompt=json.dumps(user_payload, indent=2, default=str),
        )

        parsed = extract_json(response) or {}

        valid_ids = {s["skill_id"] for s in catalog if s.get("skill_id")}

        suggested = {
            "disease_skill_ids": [
                s for s in parsed.get("disease_skill_ids", []) if s in valid_ids
            ],
            "treatment_skill_ids": [
                s for s in parsed.get("treatment_skill_ids", []) if s in valid_ids
            ],
            "modality_skill_ids": [
                s for s in parsed.get("modality_skill_ids", []) if s in valid_ids
            ],
            "facility_skill_ids": [
                s for s in parsed.get("facility_skill_ids", []) if s in valid_ids
            ],
            "reasoning": parsed.get("reasoning", ""),
        }

        logger.info(
            "[PreTreatment Skills] Suggestion generated | "
            f"patient={payload.patient_id} | doctor={payload.doctor_id} | "
            f"suggested={json.dumps(suggested, default=str)}"
        )

        return JSONResponse(
            status_code=200,
            content={
                "status": "success",
                "patient_id": payload.patient_id,
                "doctor_id": payload.doctor_id,
                "suggested": suggested,
            },
        )

    except Exception as exc:
        logger.exception(
            "[PreTreatment Skills] Suggestion generation failed"
        )

        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "Failed to generate skill suggestions",
                "reason": str(exc),
            },
        )


# ============================================================
# PERSIST CLINICIAN-CONFIRMED SKILL TAGS
# ============================================================
#
# This is the ONLY place canonical disease/treatment/facility
# skill_ids get written onto the patient record. Every id is
# validated against the catalog before being saved — an invalid
# id is rejected rather than silently stored.
#
# Once saved here, no other file needs to change: build_clinical_
# context() -> _build_expertise_routing_context() already reads
# these exact field names directly off the patient document.
# ============================================================
class PatientExpertiseTagRequest(BaseModel):
    patient_id: str = Field(...)
    disease_skill_ids: List[str] = Field(default_factory=list)
    treatment_skill_ids: List[str] = Field(default_factory=list)
    modality_skill_ids: List[str] = Field(default_factory=list)
    facility_skill_ids: List[str] = Field(default_factory=list)


@router.put(
    "/skills/patient-tags"
)
async def set_patient_expertise_tags(
    payload: PatientExpertiseTagRequest,
):
    try:
        await ensure_skill_catalog_seeded()

        all_ids = (
            payload.disease_skill_ids
            + payload.treatment_skill_ids
            + payload.modality_skill_ids
            + payload.facility_skill_ids
        )

        valid_skills = await _load_canonical_skills(all_ids)
        valid_ids = {s.get("skill_id") for s in valid_skills}

        invalid = [i for i in all_ids if i not in valid_ids]

        if invalid:
            return JSONResponse(
                status_code=400,
                content={
                    "status": "error",
                    "message": "One or more skill_ids are not in the catalog",
                    "invalid_skill_ids": invalid,
                },
            )

        # ------------------------------------------------------------
        # DEFENSE IN DEPTH — type-matching check.
        #
        # This does not hardcode any clinical name. It only checks
        # that the catalog's own "type" field for a given skill_id
        # matches the routing dimension it is being saved under, so
        # a disease id can't accidentally end up under treatment_
        # skill_ids (or vice versa) due to a UI/integration mistake.
        # ------------------------------------------------------------

        skills_by_id = {s.get("skill_id"): s for s in valid_skills}

        def _wrong_type(ids: List[str], expected_type: str) -> List[str]:
            return [
                i for i in ids
                if skills_by_id.get(i, {}).get("type") != expected_type
            ]

        type_mismatches = (
            _wrong_type(payload.disease_skill_ids, "disease")
            + _wrong_type(payload.treatment_skill_ids, "treatment")
            + _wrong_type(payload.modality_skill_ids, "modality")
            + _wrong_type(payload.facility_skill_ids, "facility")
        )

        if type_mismatches:
            return JSONResponse(
                status_code=400,
                content={
                    "status": "error",
                    "message": (
                        "One or more skill_ids do not match the catalog "
                        "type for the field they were submitted under"
                    ),
                    "mismatched_skill_ids": type_mismatches,
                },
            )

        update_result = await patient_user_collection.update_one(
            {"sys_user_id": payload.patient_id},
            {
                "$set": {
                    "disease_skill_ids": payload.disease_skill_ids,
                    "treatment_skill_ids": payload.treatment_skill_ids,
                    "modality_skill_ids": payload.modality_skill_ids,
                    "facility_skill_ids": payload.facility_skill_ids,
                }
            },
        )

        logger.info(
            "[PreTreatment Skills] Patient expertise tags saved | "
            f"patient={payload.patient_id} | "
            f"disease={payload.disease_skill_ids} | "
            f"treatment={payload.treatment_skill_ids} | "
            f"modality={payload.modality_skill_ids} | "
            f"facility={payload.facility_skill_ids} | "
            f"modified={update_result.modified_count}"
        )

        return JSONResponse(
            status_code=200,
            content={
                "status": "success",
                "patient_id": payload.patient_id,
                "disease_skill_ids": payload.disease_skill_ids,
                "treatment_skill_ids": payload.treatment_skill_ids,
                "modality_skill_ids": payload.modality_skill_ids,
                "facility_skill_ids": payload.facility_skill_ids,
            },
        )

    except Exception as exc:
        logger.exception(
            "[PreTreatment Skills] Failed to save patient expertise tags"
        )

        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "Failed to save patient expertise tags",
                "reason": str(exc),
            },
        )

def _deep_merge(
    base: Dict[str, Any],
    override: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Recursively apply a doctor customization to a canonical skill.

    Lists/scalars are intentionally replaced by the doctor override;
    dictionaries are merged recursively.
    """
    result = _safe_copy(base)

    if not isinstance(override, dict):
        return result

    for key, value in override.items():
        if (
            isinstance(result.get(key), dict)
            and isinstance(value, dict)
        ):
            result[key] = _deep_merge(
                result[key],
                value,
            )
        else:
            result[key] = _safe_copy(value)

    return result


def _normalize_skill_ids(value: Any) -> List[str]:
    """
    Normalize explicitly supplied canonical skill IDs.

    This function performs transport normalization only:
      - accepts a scalar ID or a list/tuple/set of IDs
      - converts IDs to strings
      - removes duplicates while preserving order

    It does NOT infer, interpret, classify, or map clinical text.
    """
    if value is None:
        return []

    values = value if isinstance(value, (list, tuple, set)) else [value]

    result: List[str] = []
    seen = set()

    for item in values:
        if item is None:
            continue

        if isinstance(item, dict):
            item = (
                item.get("skill_id")
                or item.get("id")
            )

        if item is None:
            continue

        item = str(item).strip()

        if not item or item in seen:
            continue

        seen.add(item)
        result.append(item)

    return result


def _read_routing_ids(
    source: Any,
    *,
    plural_key: str,
    singular_keys: tuple = (),
) -> List[str]:
    """
    Read canonical routing IDs from a structured object.

    Plural fields are preferred. Singular fields are retained only for
    backward compatibility with the existing API/context contract.

    No clinical text is inspected.
    """
    if not isinstance(source, dict):
        return []

    ids = _normalize_skill_ids(source.get(plural_key))

    if ids:
        return ids

    for key in singular_keys:
        ids = _normalize_skill_ids(source.get(key))
        if ids:
            return ids

    return []



def _extract_nested_skill_ids(
    value: Any,
) -> Dict[str, List[str]]:
    """
    Recursively extract ONLY canonical skill-ID fields from structured
    graph/application data.

    This does not inspect clinical names, descriptions, prose, or
    arbitrary text. It only recognizes the canonical routing field names
    already used by this application's skill contract.
    """
    result: Dict[str, List[str]] = {
        "disease_skill_ids": [],
        "treatment_skill_ids": [],
        "modality_skill_ids": [],
        "facility_skill_ids": [],
    }

    field_map = {
        "disease_skill_ids": "disease_skill_ids",
        "disease_skill_id": "disease_skill_ids",
        "cancer_skill_id": "disease_skill_ids",
        "treatment_skill_ids": "treatment_skill_ids",
        "treatment_skill_id": "treatment_skill_ids",
        "modality_skill_ids": "modality_skill_ids",
        "modality_skill_id": "modality_skill_ids",
        "facility_skill_ids": "facility_skill_ids",
        "facility_skill_id": "facility_skill_ids",
        "facility_capability_skill_id": "facility_skill_ids",
    }

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            for key, item in node.items():
                target = field_map.get(key)
                if target:
                    for skill_id in _normalize_skill_ids(item):
                        if skill_id not in result[target]:
                            result[target].append(skill_id)

                if isinstance(item, (dict, list, tuple, set)):
                    walk(item)

        elif isinstance(node, (list, tuple, set)):
            for item in node:
                walk(item)

    walk(value)
    return result


async def _resolve_missing_skills_from_graph(
    clinical_context: Dict[str, Any],
    resolved: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Resolve missing non-specialty skills from the latest graph state.

    The latest clinical Cypher query remains completely unchanged.

    Resolution order:
      1. explicit canonical skill IDs already present in graph/application data
      2. LLM classification against the live MongoDB skill catalog,
         using ONLY the retrieved graph state as clinical evidence

    The LLM is constrained to existing MongoDB skill IDs and the catalog
    type of each ID. No keyword mapping, substring matching, disease
    aliases, treatment aliases, or hardcoded clinical names are used.
    """
    resolved = _safe_copy(resolved) if isinstance(resolved, dict) else {}

    for key in (
        "disease_skill_ids",
        "treatment_skill_ids",
        "modality_skill_ids",
        "facility_skill_ids",
    ):
        resolved.setdefault(key, [])

    graph_wrapper = clinical_context.get("secondary_graph_context", {})
    graph_data = (
        graph_wrapper.get("data")
        if isinstance(graph_wrapper, dict)
        else {}
    )

    if not isinstance(graph_data, dict):
        graph_data = {}

    graph_state = graph_data.get("data")
    if not isinstance(graph_state, dict):
        graph_state = graph_data

    if not graph_state:
        return resolved

    # ------------------------------------------------------------
    # First: collect canonical IDs if the graph already contains them
    # anywhere in its structured result.
    # ------------------------------------------------------------
    explicit_from_graph = _extract_nested_skill_ids(graph_state)

    for key in (
        "disease_skill_ids",
        "treatment_skill_ids",
        "modality_skill_ids",
        "facility_skill_ids",
    ):
        for skill_id in explicit_from_graph.get(key, []):
            if skill_id not in resolved[key]:
                resolved[key].append(skill_id)

    if all(
        resolved.get(key)
        for key in (
            "disease_skill_ids",
            "treatment_skill_ids",
            "modality_skill_ids",
        )
    ):
        resolved["graph_skill_resolution_source"] = (
            "graph_explicit_canonical_ids"
        )
        return resolved

    await ensure_skill_catalog_seeded()

    catalog = await clinical_expertise_skills_collection.find(
        {
            "status": {"$ne": "inactive"},
            "type": {
                "$in": [
                    "disease",
                    "treatment",
                    "modality",
                    "facility",
                ],
            },
        },
        {
            "_id": 0,
        },
    ).to_list(length=None)

    if not catalog:
        logger.warning(
            "[PreTreatment Skills] MongoDB skill catalog is empty; "
            "graph skill routing skipped"
        )
        return resolved

    # Only expose the catalog and the retrieved graph state to the
    # routing agent. This keeps the routing grounded in the graph.
    catalog_for_llm = []
    for skill in catalog:
        if not isinstance(skill, dict):
            continue

        catalog_for_llm.append(
            {
                key: _safe_copy(skill.get(key))
                for key in (
                    "skill_id",
                    "name",
                    "type",
                    "description",
                    "focus",
                    "questions",
                    "clinical_domains",
                )
                if skill.get(key) is not None
            }
        )

    graph_skill_prompt = """
You are a structured clinical expertise router.

Your job is to select canonical expertise skill IDs from the supplied
MongoDB catalog using ONLY the supplied latest patient clinical graph.

The graph is the clinical evidence source. The MongoDB catalog is the
only allowed source of skill IDs.

Rules:
- Return ONLY skill_id values that exist in the supplied catalog.
- Match each selected ID to its own catalog "type".
- Keep disease IDs under disease_skill_ids.
- Keep treatment IDs under treatment_skill_ids.
- Keep modality IDs under modality_skill_ids.
- Keep facility IDs under facility_skill_ids.
- Do not invent IDs.
- Do not create IDs from names.
- Do not use keyword tables, aliases, substring rules, or hardcoded
  disease/treatment/modality knowledge.
- Do not infer a skill merely because it would be clinically useful.
- Select a skill only when the supplied graph actually provides enough
  evidence for that skill.
- Zero, one, or multiple IDs are valid for each category.
- Do not return specialty_skill_id; specialty is resolved separately.
- Use the graph state, including conditions, summaries, synthesis,
  profile, and any structured fields contained in it.
- Return JSON only.

Required JSON:
{
  "disease_skill_ids": [],
  "treatment_skill_ids": [],
  "modality_skill_ids": [],
  "facility_skill_ids": [],
  "reasoning": ""
}
"""

    user_payload = {
        "skill_catalog": catalog_for_llm,
        "latest_clinical_graph": _safe_copy(graph_state),
        "already_resolved_skill_ids": {
            "disease_skill_ids": resolved.get(
                "disease_skill_ids",
                [],
            ),
            "treatment_skill_ids": resolved.get(
                "treatment_skill_ids",
                [],
            ),
            "modality_skill_ids": resolved.get(
                "modality_skill_ids",
                [],
            ),
            "facility_skill_ids": resolved.get(
                "facility_skill_ids",
                [],
            ),
        },
    }

    try:
        response = await invoke_agent(
            system_prompt=graph_skill_prompt,
            user_prompt=json.dumps(
                user_payload,
                indent=2,
                default=str,
            ),
        )

        parsed = extract_json(response) or {}

        by_type: Dict[str, set] = {
            "disease": {
                skill.get("skill_id")
                for skill in catalog
                if isinstance(skill, dict)
                and skill.get("type") == "disease"
                and skill.get("skill_id")
            },
            "treatment": {
                skill.get("skill_id")
                for skill in catalog
                if isinstance(skill, dict)
                and skill.get("type") == "treatment"
                and skill.get("skill_id")
            },
            "modality": {
                skill.get("skill_id")
                for skill in catalog
                if isinstance(skill, dict)
                and skill.get("type") == "modality"
                and skill.get("skill_id")
            },
            "facility": {
                skill.get("skill_id")
                for skill in catalog
                if isinstance(skill, dict)
                and skill.get("type") == "facility"
                and skill.get("skill_id")
            },
        }

        category_map = (
            ("disease_skill_ids", "disease"),
            ("treatment_skill_ids", "treatment"),
            ("modality_skill_ids", "modality"),
            ("facility_skill_ids", "facility"),
        )

        for output_key, catalog_type in category_map:
            proposed = _normalize_skill_ids(
                parsed.get(output_key)
            )

            for skill_id in proposed:
                if skill_id in by_type[catalog_type]:
                    if skill_id not in resolved[output_key]:
                        resolved[output_key].append(skill_id)

        resolved["graph_skill_resolution_source"] = (
            "graph_explicit_ids_and_catalog_llm"
            if explicit_from_graph
            else "catalog_llm_from_graph"
        )
        resolved["graph_skill_resolution_reasoning"] = (
            parsed.get("reasoning", "")
        )

        logger.info(
            "[PreTreatment Skills] GRAPH SKILL ROUTING | "
            f"disease={resolved.get('disease_skill_ids', [])} | "
            f"treatment={resolved.get('treatment_skill_ids', [])} | "
            f"modality={resolved.get('modality_skill_ids', [])} | "
            f"facility={resolved.get('facility_skill_ids', [])} | "
            f"source={resolved.get('graph_skill_resolution_source')}"
        )

    except Exception as exc:
        logger.exception(
            "[PreTreatment Skills] Graph skill routing failed | "
            f"reason={exc}"
        )

    return resolved


def _resolve_skill_ids_from_context(
    clinical_context: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Resolve canonical skill IDs from explicit structured routing metadata.

    IMPORTANT
    ------------------------------------------------------------
    This resolver NEVER:
      - reads clinical prose to classify a disease
      - reads summaries to classify a treatment
      - performs keyword matching
      - performs substring matching
      - uses disease aliases
      - uses treatment aliases
      - asks an LLM to select skills
      - creates a skill ID from a clinical name

    Skill selection must already have happened upstream and must be
    represented as canonical IDs.

    Supported sources, in precedence order:
        1. clinical_context["expertise_routing"]
        2. clinical_context["expertise_metadata"]
        3. doctor_context / patient_context / treatment_context /
           facility_context
        4. secondary graph context

    The function only transports and deduplicates explicit IDs.
    """
    if not isinstance(clinical_context, dict):
        clinical_context = {}

    routing = clinical_context.get("expertise_routing")
    if not isinstance(routing, dict):
        routing = {}

    expertise_metadata = clinical_context.get("expertise_metadata")
    if not isinstance(expertise_metadata, dict):
        expertise_metadata = {}

    doctor_context = clinical_context.get("doctor_context")
    if not isinstance(doctor_context, dict):
        doctor_context = {}

    patient_context = clinical_context.get("patient_context")
    if not isinstance(patient_context, dict):
        patient_context = {}

    treatment_context = clinical_context.get("treatment_context")
    if not isinstance(treatment_context, dict):
        treatment_context = {}

    facility_context = clinical_context.get("facility_context")
    if not isinstance(facility_context, dict):
        facility_context = {}

    graph_wrapper = clinical_context.get("secondary_graph_context")
    if not isinstance(graph_wrapper, dict):
        graph_wrapper = {}

    graph_data = graph_wrapper.get("data")
    if not isinstance(graph_data, dict):
        graph_data = {}

    graph_state = graph_data.get("data")
    if not isinstance(graph_state, dict):
        graph_state = graph_data

    graph_routing = graph_state.get("expertise_routing")
    if not isinstance(graph_routing, dict):
        graph_routing = {}

    # ------------------------------------------------------------
    # Preserve existing singular specialty resolution.
    # Specialty identity is resolved by the existing registry resolver
    # only from structured doctor/application metadata.
    # ------------------------------------------------------------
    specialty_skill_id = None

    for source in (
        routing,
        expertise_metadata,
        doctor_context,
        graph_routing,
        graph_state,
    ):
        if not isinstance(source, dict):
            continue

        candidate = (
            source.get("specialty_skill_id")
            or source.get("expertise_skill_id")
        )

        if candidate:
            specialty_skill_id = str(candidate).strip()
            break

    if not specialty_skill_id:
        registry_context = build_registry_expertise_context(
            clinical_context
        )
        specialty = registry_context.get("specialty_skill") or {}

        if isinstance(specialty, dict):
            specialty_skill_id = specialty.get("id")

    # ------------------------------------------------------------
    # Disease IDs
    # ------------------------------------------------------------
    disease_skill_ids: List[str] = []

    for source in (
        routing,
        expertise_metadata,
        patient_context,
        graph_routing,
        graph_state,
    ):
        disease_skill_ids.extend(
            _read_routing_ids(
                source,
                plural_key="disease_skill_ids",
                singular_keys=(
                    "disease_skill_id",
                    "cancer_skill_id",
                ),
            )
        )

    # ------------------------------------------------------------
    # Treatment IDs
    # ------------------------------------------------------------
    treatment_skill_ids: List[str] = []

    for source in (
        routing,
        expertise_metadata,
        treatment_context,
        graph_routing,
        graph_state,
    ):
        treatment_skill_ids.extend(
            _read_routing_ids(
                source,
                plural_key="treatment_skill_ids",
                singular_keys=("treatment_skill_id",),
            )
        )

    # ------------------------------------------------------------
    # Modality IDs are kept as an explicit routing dimension.
    #
    # They are NOT silently converted into treatment IDs.
    # This prevents semantic assumptions between modality and treatment.
    # ------------------------------------------------------------
    modality_skill_ids: List[str] = []

    for source in (
        routing,
        expertise_metadata,
        treatment_context,
        graph_routing,
        graph_state,
    ):
        modality_skill_ids.extend(
            _read_routing_ids(
                source,
                plural_key="modality_skill_ids",
                singular_keys=("modality_skill_id",),
            )
        )

    # ------------------------------------------------------------
    # Facility IDs
    # ------------------------------------------------------------
    facility_skill_ids: List[str] = []

    for source in (
        routing,
        expertise_metadata,
        facility_context,
        graph_routing,
        graph_state,
    ):
        facility_skill_ids.extend(
            _read_routing_ids(
                source,
                plural_key="facility_skill_ids",
                singular_keys=(
                    "facility_skill_id",
                    "facility_capability_skill_id",
                ),
            )
        )

    # Deduplicate while preserving first-seen order.
        # Deduplicate while preserving first-seen order.
    disease_skill_ids = _normalize_skill_ids(disease_skill_ids)
    treatment_skill_ids = _normalize_skill_ids(treatment_skill_ids)
    modality_skill_ids = _normalize_skill_ids(modality_skill_ids)
    facility_skill_ids = _normalize_skill_ids(facility_skill_ids)

    return {
        "specialty_skill_id": specialty_skill_id,
        "disease_skill_ids": disease_skill_ids,
        "treatment_skill_ids": treatment_skill_ids,
        "modality_skill_ids": modality_skill_ids,
        "facility_skill_ids": facility_skill_ids,
        "selection_source": (
            "explicit_structured_routing"
            if (
                disease_skill_ids
                or treatment_skill_ids
                or modality_skill_ids
                or facility_skill_ids
                or specialty_skill_id
            )
            else "no_structured_skill_ids"
        ),
    }


async def _load_canonical_skills(
    skill_ids: List[str],
) -> List[Dict[str, Any]]:
    if not skill_ids:
        return []

    documents = await clinical_expertise_skills_collection.find(
        {
            "skill_id": {
                "$in": list(dict.fromkeys(skill_ids)),
            },
            "status": {
                "$ne": "inactive",
            },
        },
        {
            "_id": 0,
        },
    ).to_list(length=None)

    by_id = {
        document.get("skill_id"): document
        for document in documents
        if isinstance(document, dict)
    }

    # Preserve resolver order rather than MongoDB return order.
    return [
        by_id[skill_id]
        for skill_id in skill_ids
        if skill_id in by_id
    ]


async def _load_doctor_skill_profiles(
    doctor_id: str,
    skill_ids: List[str],
) -> Dict[str, Dict[str, Any]]:
    if not doctor_id or not skill_ids:
        return {}

    documents = await doctor_skill_profiles_collection.find(
        {
            "doctor_id": doctor_id,
            "skill_id": {
                "$in": list(dict.fromkeys(skill_ids)),
            },
        },
        {
            "_id": 0,
        },
    ).to_list(length=None)

    return {
        document.get("skill_id"): document
        for document in documents
        if isinstance(document, dict)
        and document.get("skill_id")
    }



async def _apply_specialty_dominant_treatment_scope(
    clinical_context: Dict[str, Any],
    resolved: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Make doctor specialty the controlling scope for treatment skills.

    Treatment skills are still selected from the live MongoDB catalog and
    grounded in the latest graph.  The specialty skill is supplied as the
    primary scope constraint to the LLM.  The router may only RETAIN treatment
    IDs that are already present in ``resolved``; it cannot invent or add a
    treatment merely because it is compatible with a specialty.

    This is deliberately catalog-driven rather than a hardcoded map such as
    radiation_oncology -> radiation_therapy.  The relationship is determined
    from the actual specialty skill, treatment skill definitions, and current
    graph evidence.
    """
    resolved = _safe_copy(resolved) if isinstance(resolved, dict) else {}
    treatment_ids = _normalize_skill_ids(
        resolved.get("treatment_skill_ids")
    )
    resolved["treatment_skill_ids"] = treatment_ids

    specialty_id = resolved.get("specialty_skill_id")
    if not specialty_id or not treatment_ids:
        resolved["treatment_scope_resolution_source"] = (
            "not_applied_no_specialty_or_treatment_candidates"
        )
        return resolved

    await ensure_skill_catalog_seeded()

    specialty_skill = await clinical_expertise_skills_collection.find_one(
        {
            "skill_id": specialty_id,
            "type": "specialty",
            "status": {"$ne": "inactive"},
        },
        {"_id": 0},
    )

    if not isinstance(specialty_skill, dict):
        resolved["treatment_scope_resolution_source"] = (
            "not_applied_specialty_not_found"
        )
        logger.warning(
            "[PreTreatment Skills] Specialty treatment scope skipped | "
            f"specialty_id={specialty_id} | reason=specialty_not_found"
        )
        return resolved

    treatment_catalog = await clinical_expertise_skills_collection.find(
        {
            "skill_id": {"$in": treatment_ids},
            "type": "treatment",
            "status": {"$ne": "inactive"},
        },
        {"_id": 0},
    ).to_list(length=None)

    if not treatment_catalog:
        resolved["treatment_skill_ids"] = []
        resolved["treatment_scope_resolution_source"] = (
            "specialty_scope_no_catalog_candidates"
        )
        return resolved

    # Preserve resolver order so the final output remains deterministic.
    catalog_by_id = {
        item.get("skill_id"): item
        for item in treatment_catalog
        if isinstance(item, dict) and item.get("skill_id")
    }
    ordered_candidates = [
        catalog_by_id[skill_id]
        for skill_id in treatment_ids
        if skill_id in catalog_by_id
    ]

    graph_wrapper = clinical_context.get("secondary_graph_context", {})
    graph_data = (
        graph_wrapper.get("data")
        if isinstance(graph_wrapper, dict)
        else {}
    )
    graph_state = (
        graph_data.get("data")
        if isinstance(graph_data, dict)
        else {}
    )
    if not isinstance(graph_state, dict):
        graph_state = graph_data if isinstance(graph_data, dict) else {}

    specialty_scope_prompt = """
You are the treatment-scope controller in a clinical expertise routing system.

Your task is to determine which ALREADY SELECTED treatment skill IDs are
within the professional scope represented by the supplied doctor specialty.
The doctor specialty is the PRIMARY scope constraint.

Inputs:
1. specialty_skill: the canonical specialty skill from the MongoDB catalog
2. treatment_candidates: treatment skills already selected from the latest
   patient graph and MongoDB catalog
3. latest_clinical_graph: the same latest graph state used by the assessment

Rules:
- Return ONLY IDs from treatment_candidates.
- Never invent a skill_id.
- Never add a treatment that is not already in treatment_candidates.
- The specialty skill is the dominant constraint for treatment scope.
- Retain a treatment only when its own catalog definition is consistent with
  the scope/perspective/domains of the supplied specialty skill and the
  current graph provides evidence that the treatment is relevant.
- If a treatment belongs primarily to a different specialty scope, exclude it
  even if it appears in the patient's broader longitudinal graph.
- Do not use hardcoded specialty-to-treatment mappings.
- Do not use keyword tables, aliases, substring rules, or string matching.
- Do not infer a treatment from a disease name alone.
- Do not recommend, prescribe, or choose a treatment for the patient. This is
  an expertise-scope filter only.
- If no candidate satisfies the specialty scope, return an empty list.
- Preserve the candidate order for retained IDs.
- Return JSON only.

Required JSON:
{
  "treatment_skill_ids": [],
  "reasoning": ""
}
"""

    user_payload = {
        "specialty_skill": _safe_copy(specialty_skill),
        "treatment_candidates": _safe_copy(ordered_candidates),
        "latest_clinical_graph": _safe_copy(graph_state),
    }

    try:
        response = await invoke_agent(
            system_prompt=specialty_scope_prompt,
            user_prompt=json.dumps(
                user_payload,
                indent=2,
                default=str,
            ),
        )

        parsed = extract_json(response) or {}
        allowed_ids = set(catalog_by_id)
        proposed = _normalize_skill_ids(
            parsed.get("treatment_skill_ids")
        )

        retained = [
            skill_id
            for skill_id in treatment_ids
            if skill_id in proposed and skill_id in allowed_ids
        ]

        resolved["treatment_skill_ids"] = retained
        resolved["treatment_scope_resolution_source"] = (
            "specialty_dominant_catalog_scope"
        )
        resolved["treatment_scope_resolution_reasoning"] = (
            parsed.get("reasoning", "")
        )

        logger.info(
            "[PreTreatment Skills] SPECIALTY-DOMINANT TREATMENT SCOPE | "
            f"specialty_id={specialty_id} | "
            f"candidate_treatments={treatment_ids} | "
            f"retained_treatments={retained} | "
            f"reasoning={parsed.get('reasoning', '')}"
        )

    except Exception as exc:
        logger.exception(
            "[PreTreatment Skills] Specialty treatment scope failed | "
            f"specialty_id={specialty_id} | reason={exc}"
        )
        # Fail closed: if specialty scope cannot be established, do not pass
        # unrelated treatment skills through merely because they were present
        # elsewhere in the patient's graph.
        resolved["treatment_skill_ids"] = []
        resolved["treatment_scope_resolution_source"] = (
            "specialty_scope_failed_fail_closed"
        )
        resolved["treatment_scope_resolution_reasoning"] = str(exc)

    return resolved


async def resolve_mongodb_expertise_context(
    clinical_context: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Build the effective runtime expertise context.

    Architecture
    ------------------------------------------------------------
        explicit structured routing IDs
                    ->
        MongoDB canonical skill documents
                    ->
        doctor-specific overrides
                    ->
        effective expertise context

    This function resolves skill IDs through the following generic path:

      1. explicit canonical IDs already present in structured context
      2. canonical IDs embedded anywhere in the latest graph result
      3. when still missing, graph-grounded LLM selection against the
         live MongoDB skill catalog

    There is:
      - no keyword matching
      - no substring matching
      - no hardcoded disease/treatment/modality names
      - no alias-based disease/treatment routing
      - no skill ID invention

    Therefore arbitrary diseases/treatments/modalities remain supported
    as long as the MongoDB catalog contains the corresponding canonical
    skills or the graph contains enough evidence to select them from
    that catalog.
    """
    await ensure_skill_catalog_seeded()

    request_context = (
        clinical_context.get("request", {})
        if isinstance(clinical_context, dict)
        else {}
    )

    doctor_id = request_context.get("doctor_id")

    resolved = _resolve_skill_ids_from_context(
        clinical_context
    )

    # The latest clinical Cypher query is intentionally unchanged.
    # Resolve any missing disease/treatment/modality/facility skills
    # from the graph result itself, using explicit graph skill IDs when
    # available and otherwise the live MongoDB catalog + graph-grounded
    # LLM router.
    resolved = await _resolve_missing_skills_from_graph(
        clinical_context=clinical_context,
        resolved=resolved,
    )

    # Doctor specialty is the dominant scope for treatment skills.
    # This filters broader patient-journey treatment IDs before the final
    # MongoDB skill documents are loaded, so unrelated specialty skills do not
    # reach File 2. The latest Neo4j clinical query is untouched.
    resolved = await _apply_specialty_dominant_treatment_scope(
        clinical_context=clinical_context,
        resolved=resolved,
    )

    specialty_id = resolved.get("specialty_skill_id")

    all_ids: List[str] = []

    if specialty_id:
        all_ids.append(str(specialty_id))

    for key in (
        "disease_skill_ids",
        "treatment_skill_ids",
        "modality_skill_ids",
        "facility_skill_ids",
    ):
        for skill_id in resolved.get(key, []):
            if skill_id and skill_id not in all_ids:
                all_ids.append(skill_id)

    canonical_skills = await _load_canonical_skills(
        all_ids
    )

    canonical_ids = {
        skill.get("skill_id")
        for skill in canonical_skills
        if isinstance(skill, dict)
        and skill.get("skill_id")
    }

    missing_ids = [
        skill_id
        for skill_id in all_ids
        if skill_id not in canonical_ids
    ]

    if missing_ids:
        logger.warning(
            "[PreTreatment Skills] Structured skill IDs not found in MongoDB | "
            f"missing_ids={missing_ids}"
        )

    doctor_profiles = await _load_doctor_skill_profiles(
        doctor_id=doctor_id,
        skill_ids=all_ids,
    )

    effective_by_id: Dict[str, Dict[str, Any]] = {}
    customization_metadata: List[Dict[str, Any]] = []

    for canonical in canonical_skills:
        skill_id = canonical.get("skill_id")

        if not skill_id:
            continue

        profile = doctor_profiles.get(skill_id)

        if profile and profile.get("enabled") is False:
            customization_metadata.append(
                {
                    "skill_id": skill_id,
                    "enabled": False,
                    "customized": bool(
                        profile.get("overrides")
                    ),
                    "profile_updated_at": profile.get(
                        "updated_at"
                    ),
                }
            )
            continue

        overrides = (
            profile.get("overrides", {})
            if isinstance(profile, dict)
            else {}
        )

        effective = _deep_merge(
            canonical,
            overrides
            if isinstance(overrides, dict)
            else {},
        )

        effective["skill_id"] = skill_id
        effective["effective_source"] = (
            "mongodb_doctor_customization"
            if overrides
            else "mongodb_canonical"
        )

        effective_by_id[skill_id] = effective

        customization_metadata.append(
            {
                "skill_id": skill_id,
                "enabled": True,
                "customized": bool(overrides),
                "profile_updated_at": (
                    profile.get("updated_at")
                    if profile
                    else None
                ),
            }
        )

    specialty_skill = (
        effective_by_id.get(specialty_id)
        if specialty_id
        else None
    )

    disease_skills = [
        effective_by_id[skill_id]
        for skill_id in resolved.get("disease_skill_ids", [])
        if skill_id in effective_by_id
    ]

    treatment_skills = [
        effective_by_id[skill_id]
        for skill_id in resolved.get("treatment_skill_ids", [])
        if skill_id in effective_by_id
    ]

    modality_skills = [
        effective_by_id[skill_id]
        for skill_id in resolved.get("modality_skill_ids", [])
        if skill_id in effective_by_id
    ]

    facility_skills = [
        effective_by_id[skill_id]
        for skill_id in resolved.get("facility_skill_ids", [])
        if skill_id in effective_by_id
    ]

    specialty_name = (
        specialty_skill.get("name")
        if isinstance(specialty_skill, dict)
        else None
    )

    if not specialty_name:
        doctor_context = clinical_context.get("doctor_context") or {}

        if isinstance(doctor_context, dict):
            specialty_name = (
                doctor_context.get("specialty")
                or doctor_context.get("doctor_specialty")
            )

    effective_context = {
        "version": "3.0",
        "source": "mongodb",
        "selection_policy": {
            "composition": (
                "specialty + disease + treatment + modality + facility"
            ),
            "matching": (
                "explicit canonical IDs plus graph-grounded catalog "
                "resolution for missing IDs"
            ),
            "keyword_matching": False,
            "substring_matching": False,
            "llm_skill_routing": True,
            "specialty_dominant_treatment_scope": True,
            "skills_are_patient_evidence": False,
            "doctor_customization_applied": True,
            "doctor_customization_is_selection": False,
        },
        "doctor_id": doctor_id,
        "doctor_specialty": specialty_name,
        "specialty_skill": specialty_skill,
        "disease_skills": disease_skills,
        "treatment_skills": treatment_skills,
        "modality_skills": modality_skills,
        "facility_skills": facility_skills,
        "resolved_skill_ids": {
            "specialty_skill_id": specialty_id,
            "disease_skill_ids": resolved.get(
                "disease_skill_ids",
                [],
            ),
            "treatment_skill_ids": resolved.get(
                "treatment_skill_ids",
                [],
            ),
            "modality_skill_ids": resolved.get(
                "modality_skill_ids",
                [],
            ),
            "facility_skill_ids": resolved.get(
                "facility_skill_ids",
                [],
            ),
        },
        "resolution_metadata": {
            "selection_source": resolved.get(
                "selection_source"
            ),
            "requested_skill_ids": all_ids,
            "loaded_skill_ids": list(
                canonical_ids
            ),
            "missing_skill_ids": missing_ids,
            "graph_skill_resolution_source": resolved.get(
                "graph_skill_resolution_source"
            ),
            "graph_skill_resolution_reasoning": resolved.get(
                "graph_skill_resolution_reasoning",
                "",
            ),
            "treatment_scope_resolution_source": resolved.get(
                "treatment_scope_resolution_source"
            ),
            "treatment_scope_resolution_reasoning": resolved.get(
                "treatment_scope_resolution_reasoning",
                "",
            ),
        },
        "doctor_skill_customizations": (
            customization_metadata
        ),
    }

    logger.info(
        "[PreTreatment Skills] EFFECTIVE SKILL RESOLUTION | "
        f"doctor_id={doctor_id} | "
        f"specialty_id={specialty_id} | "
        f"disease_ids={resolved.get('disease_skill_ids', [])} | "
        f"treatment_ids={resolved.get('treatment_skill_ids', [])} | "
        f"modality_ids={resolved.get('modality_skill_ids', [])} | "
        f"facility_ids={resolved.get('facility_skill_ids', [])} | "
        f"selection_source={resolved.get('selection_source')}"
    )

    logger.info(
        "[PreTreatment Skills] CUSTOMIZATION STATUS | "
        f"{json.dumps(customization_metadata, default=str)}"
    )

    logger.info(
        "[PreTreatment Skills] EFFECTIVE SPECIALTY SKILL | "
        f"{json.dumps(specialty_skill, indent=2, default=str)}"
    )

    logger.info(
        "[PreTreatment Skills] LOADED SKILL IDS FROM MONGODB | "
        f"disease={[s.get('skill_id') for s in disease_skills]} | "
        f"treatment={[s.get('skill_id') for s in treatment_skills]} | "
        f"modality={[s.get('skill_id') for s in modality_skills]} | "
        f"facility={[s.get('skill_id') for s in facility_skills]}"
    )

    logger.info(
        "[PreTreatment Skills] EFFECTIVE DISEASE SKILLS | "
        f"{json.dumps(disease_skills, indent=2, default=str)}"
    )

    logger.info(
        "[PreTreatment Skills] EFFECTIVE TREATMENT SKILLS | "
        f"{json.dumps(treatment_skills, indent=2, default=str)}"
    )

    logger.info(
        "[PreTreatment Skills] EFFECTIVE MODALITY SKILLS | "
        f"{json.dumps(modality_skills, indent=2, default=str)}"
    )

    logger.info(
        "[PreTreatment Skills] EFFECTIVE FACILITY SKILLS | "
        f"{json.dumps(facility_skills, indent=2, default=str)}"
    )

    return effective_context


class DoctorSkillCustomizationRequest(BaseModel):
    """
    Generic frontend customization payload.

    `overrides` can contain any existing skill property without this
    endpoint having to know clinical fields.
    """

    doctor_id: str = Field(...)
    skill_id: str = Field(...)
    enabled: bool = Field(default=True)
    overrides: Dict[str, Any] = Field(
        default_factory=dict
    )


async def save_doctor_skill_customization(
    payload: DoctorSkillCustomizationRequest,
) -> Dict[str, Any]:
    await ensure_skill_catalog_seeded()

    canonical = await clinical_expertise_skills_collection.find_one(
        {
            "skill_id": payload.skill_id,
            "status": {
                "$ne": "inactive",
            },
        },
        {
            "_id": 0,
        },
    )

    if not canonical:
        raise ValueError(
            f"Unknown skill_id: {payload.skill_id}"
        )

    now = datetime.now(timezone.utc).isoformat()

    document = {
        "doctor_id": payload.doctor_id,
        "skill_id": payload.skill_id,
        "enabled": payload.enabled,
        "overrides": _safe_copy(payload.overrides),
        "updated_at": now,
        "version": 1,
    }

    result = await doctor_skill_profiles_collection.update_one(
        {
            "doctor_id": payload.doctor_id,
            "skill_id": payload.skill_id,
        },
        {
            "$set": {
                "enabled": document["enabled"],
                "overrides": document["overrides"],
                "updated_at": document["updated_at"],
            },
            "$setOnInsert": {
                "doctor_id": document["doctor_id"],
                "skill_id": document["skill_id"],
                "version": document["version"],
            },
        },
        upsert=True,
    )

    saved = await doctor_skill_profiles_collection.find_one(
        {
            "doctor_id": payload.doctor_id,
            "skill_id": payload.skill_id,
        },
        {
            "_id": 0,
        },
    )

    logger.info(
        "[PreTreatment Skills] DOCTOR CUSTOMIZATION SAVED | "
        f"doctor_id={payload.doctor_id} | "
        f"skill_id={payload.skill_id} | "
        f"enabled={payload.enabled} | "
        f"modified={bool(result.modified_count or result.upserted_id)}"
    )

    logger.info(
        "[PreTreatment Skills] SAVED CUSTOMIZATION | "
        f"{json.dumps(saved, indent=2, default=str)}"
    )

    return {
        "status": "success",
        "doctor_id": payload.doctor_id,
        "skill_id": payload.skill_id,
        "saved_profile": _safe_copy(saved),
        "effective_skill": _deep_merge(
            canonical,
            payload.overrides,
        ),
    }


# ============================================================
# NEO4J
# ============================================================

NEO4J_URI = os.getenv(
    "NEO4J_URI",
    "bolt://neo4j:7687",
)

NEO4J_USER = os.getenv(
    "NEO4J_USER",
    "neo4j",
)

NEO4J_PASS = os.getenv(
    "NEO4J_PASSWORD",
    "password",
)


neo4j_driver = AsyncGraphDatabase.driver(
    NEO4J_URI,
    auth=(
        NEO4J_USER,
        NEO4J_PASS,
    ),
)

async def run_neo4j_query(
    cypher: str,
    parameters: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """
    Execute a Cypher query using the shared async Neo4j driver.

    Returns each Neo4j record as a plain dictionary.
    """

    parameters = parameters or {}

    async with neo4j_driver.session() as session:
        result = await session.run(
            cypher,
            parameters,
        )

        records = await result.data()

    return records


# ============================================================
# REQUEST MODEL
# ============================================================

class PreTreatmentAssessmentRequest(BaseModel):

    patient_id: str = Field(
        ...,
        description="Patient system user ID",
    )

    doctor_id: str = Field(
        ...,
        description="Doctor system user ID",
    )

    # --------------------------------------------------------
    # Optional encounter identifier.
    #
    # Useful when frontend already knows the active encounter.
    #
    # We do not force it because the graph may determine the
    # latest encounter itself.
    # --------------------------------------------------------

    encounter_id: Optional[str] = Field(
        default=None,
        description="Current encounter ID if available",
    )

    # --------------------------------------------------------
    # Frontend dictation.
    #
    # Kept generic because the doctor can dictate anything.
    # --------------------------------------------------------

    dictation: Optional[Any] = Field(
        default=None,
        description="Doctor's current consultation dictation",
    )

    # --------------------------------------------------------
    # Dynamic frontend form data.
    #
    # IMPORTANT:
    #
    # Do not define clinical fields here.
    #
    # The frontend can send arbitrary structured data.
    # --------------------------------------------------------

    form_data: Dict[str, Any] = Field(
        default_factory=dict,
        description="Dynamic frontend consultation form data",
    )

    # --------------------------------------------------------
    # Optional additional frontend context.
    #
    # This can contain non-clinical UI/request metadata.
    # --------------------------------------------------------

    frontend_context: Dict[str, Any] = Field(
        default_factory=dict,
        description="Additional frontend context",
    )

    expertise_metadata: Dict[str, Any] = Field(
        default_factory=dict,
        description="Canonical expertise routing metadata supplied by the application",
    )


# ============================================================
# GENERIC SAFE COPY
# ============================================================

def _safe_copy(value: Any) -> Any:
    """
    Create a JSON-safe copy of arbitrary MongoDB / Neo4j /
    frontend data.

    This function does not select clinical fields.
    It only makes values serializable where possible.
    """

    try:

        return json.loads(
            json.dumps(
                value,
                default=str,
            )
        )

    except Exception:

        return str(value)


# ============================================================
# 1. DOCTOR INFORMATION
# ============================================================

async def fetch_doctor_information(
    doctor_id: str,
) -> Optional[Dict[str, Any]]:
    """
    Retrieve doctor information from MongoDB.
    """

    doctor = await doctor_user_collection.find_one(
        {
            "sys_user_id": doctor_id
        },
        {
            "_id": 0,
        },
    )

    logger.info(
        "[PreTreatment] Doctor MongoDB data | doctor_id={} | data={}",
        doctor_id,
        doctor,
    )

    if not doctor:
        logger.warning(
            "[PreTreatment] Doctor not found | doctor_id={}",
            doctor_id,
        )
        return None

    result = _safe_copy(doctor)

    logger.info(
        "[PreTreatment] Doctor context prepared | data={}",
        result,
    )

    return result


# ============================================================
# 2. PATIENT MONGODB INFORMATION
# ============================================================

async def fetch_patient_mongodb_data(
    sys_user_id: str,
) -> Optional[Dict[str, Any]]:
    """
    Retrieve the complete patient MongoDB document.
    """

    patient = await patient_user_collection.find_one(
        {
            "sys_user_id": sys_user_id
        },
        {
            "_id": 0
        },
    )

    logger.info(
        "[PreTreatment] Patient MongoDB data | sys_user_id={} | data={}",
        sys_user_id,
        patient,
    )

    if not patient:
        logger.warning(
            "[PreTreatment] Patient not found | sys_user_id={}",
            sys_user_id,
        )
        return None

    patient_data = _safe_copy(patient)

    logger.info(
        "[PreTreatment] Patient data prepared | data={}",
        patient_data,
    )

    return patient_data


# ============================================================
# 3. RESOLVE PATIENT GRAPH ID
# ============================================================

def resolve_patient_graph_id(
    patient_data: Dict[str, Any],
    patient_id: str,
) -> Optional[str]:
    """
    Resolve the graph patient identifier from the MongoDB
    patient document.

    IMPORTANT:
    --------------------------------------------------------
    The graph uses patient_id.

    The frontend provides sys_user_id.

    Therefore the application first retrieves the patient
    document and then attempts to obtain the graph patient ID.

    We keep this small amount of identifier handling here.

    No clinical field mapping is performed.
    """

    possible_keys = (
        "patient_id",
        "patientId",
        "graph_patient_id",
    )

    for key in possible_keys:

        value = patient_data.get(key)

        if value:
            return str(value)

    # --------------------------------------------------------
    # If the system's MongoDB schema guarantees that
    # sys_user_id itself is the graph patient ID, this fallback
    # can be retained.
    #
    # If that is NOT true in your database, remove this fallback
    # after confirming the actual identifier relationship.
    # --------------------------------------------------------

    return None


# ============================================================
# 4. LATEST PATIENT CLINICAL/EVENT GRAPH
# ============================================================
#=========================================================
# GET ALL ENCOUNTERS FOR THIS PATIENT AND DOCTOR
# Sorted by date (latest first)
#=========================================================

async def fetch_latest_graph_data(
    patient_id: str,
    doctor_id: str,
) -> Dict[str, Any]:
    """
    Retrieve the latest graph state for the patient/doctor.

    The latest query returns the patient clinical/event data
    and clinical synthesis data together.

    No clinical fields are selected in Python.
    The Cypher query defines the returned structure.
    """

    if not patient_id:
        raise ValueError("patient_id is required")

    if not doctor_id:
        raise ValueError("doctor_id is required")

    cypher = """
    // ==========================================================
    // STEP 1: Get event_id for the latest encounter
    // ==========================================================
    MATCH (p:Patient {patient_id: $patient_id})
        -[:HAS_ENCOUNTER]->(e:Encounter)

    WHERE e.patient_id = $patient_id
    AND e.doctor_id = $doctor_id

    WITH e.event_id AS event_id
    ORDER BY coalesce(
        e.closed_at,
        e.opened_at,
        e.created_at
    ) DESC
    LIMIT 1

    // ==========================================================
    // STEP 2: Get latest summaries for each type
    // ==========================================================
    MATCH (ce:ClinicalEvent {event_id: event_id})
        -[:HAS_ENCOUNTER]->(enc:Encounter)
        -[:HAS_SUMMARY]->(s:ClinicalSummary)

    WHERE s.summary_type IS NOT NULL
    AND s.summary_type <> ''
    AND s.summary IS NOT NULL
    AND s.summary <> ''

    WITH
        event_id,
        s.summary_type AS summary_type,
        s.summary AS summary,
        s.is_baseline AS is_baseline,
        s.summary_date AS summary_date,
        enc.encounter_id AS encounter_id,
        enc.doctor_id AS doctor_id,
        enc.encounter_date AS encounter_date,
        coalesce(
            enc.closed_at,
            enc.opened_at,
            enc.created_at
        ) AS sort_date

    ORDER BY sort_date DESC

    WITH
        event_id,
        summary_type,
        COLLECT({
            summary: summary,
            is_baseline: is_baseline,
            summary_date: summary_date,
            encounter_id: encounter_id,
            doctor_id: doctor_id,
            encounter_date: encounter_date
        }) AS summaries_by_type

    WITH
        event_id,
        COLLECT({
            type: summary_type,
            latest_summary: summaries_by_type[0]
        }) AS latest_summaries

    // ==========================================================
    // STEP 3: Get latest clinical synthesis for each type
    // ==========================================================
    OPTIONAL MATCH (p:Patient {patient_id: $patient_id})
        -[:HAS_SYNTHESIS]->(cs:ClinicalSynthesis)

    WHERE cs.event_id = event_id
    AND cs.summary_type IS NOT NULL
    AND cs.summary_type <> ''
    AND cs.reasoning IS NOT NULL
    AND cs.reasoning <> ''

    WITH
        event_id,
        latest_summaries,
        cs

    ORDER BY cs.updated_at DESC

    WITH
        event_id,
        latest_summaries,
        cs.summary_type AS synthesis_type,
        COLLECT({
            reasoning: cs.reasoning,
            encounter_count: cs.encounter_count,
            last_encounter_id: cs.last_encounter_id
        }) AS synthesis_versions

    WITH
        event_id,
        latest_summaries,
        COLLECT({
            type: synthesis_type,
            latest_synthesis: synthesis_versions[0]
        }) AS latest_synthesis

    // ==========================================================
    // STEP 4: Get patient profile
    // ==========================================================
    OPTIONAL MATCH (p:Patient {patient_id: $patient_id})
        -[:HAS_PROFILE_ITEM]->(pi:PatientProfileItem)

    WHERE pi.patient_id = $patient_id
    AND pi.category IS NOT NULL
    AND pi.category <> ''
    AND pi.value IS NOT NULL
    AND pi.value <> ''

    WITH
        event_id,
        latest_summaries,
        latest_synthesis,
        pi.category AS category,
        pi.value AS value,
        pi.status AS status,
        pi.detail AS detail,
        pi.first_noted_at AS first_noted_at

    ORDER BY category ASC, first_noted_at DESC

    WITH
        event_id,
        latest_summaries,
        latest_synthesis,
        category,
        COLLECT(DISTINCT {
            value: value,
            status: status,
            detail: detail,
            first_noted_at: first_noted_at
        }) AS profile_items

    WITH
        event_id,
        latest_summaries,
        latest_synthesis,
        COLLECT({
            category: category,
            items: profile_items
        }) AS patient_profile

    // ==========================================================
    // STEP 5: Get event and latest encounter details
    // ==========================================================
    OPTIONAL MATCH (ce:ClinicalEvent {event_id: event_id})
        -[:HAS_ENCOUNTER]->(enc:Encounter)
        -[:HAS_SUMMARY]->(s:ClinicalSummary)

    WHERE s.summary_type IS NOT NULL
    AND s.summary_type <> ''
    AND s.summary IS NOT NULL
    AND s.summary <> ''

    WITH
        event_id,
        latest_summaries,
        latest_synthesis,
        patient_profile,
        ce,
        enc

    ORDER BY coalesce(
        enc.closed_at,
        enc.opened_at,
        enc.created_at
    ) DESC

    LIMIT 1

    // ==========================================================
    // STEP 6: Get doctors for this event
    // ==========================================================
    OPTIONAL MATCH (ce)-[:HAS_DOCTOR]->(d:Doctor)

    WITH
        event_id,
        patient_profile,
        latest_summaries,
        latest_synthesis,
        ce,
        enc,
        d

    ORDER BY d.name ASC

    WITH
        event_id,
        ce.conditions AS conditions,
        ce.created_at AS event_created_at,
        enc.encounter_id AS encounter_id,
        enc.encounter_number AS encounter_number,
        enc.status AS encounter_status,
        enc.encounter_date AS encounter_date,
        enc.opened_at AS encounter_opened_at,
        enc.closed_at AS encounter_closed_at,
        enc.appointment_id AS appointment_id,
        enc.doctor_id AS encounter_doctor_id,
        latest_summaries,
        latest_synthesis,
        patient_profile,

        COLLECT(DISTINCT {
            doctor_id: d.doctor_id,
            doctor_name: d.name,
            doctor_specialty: d.specialty
        }) AS event_doctors

    // ==========================================================
    // STEP 7: Return result
    // ==========================================================
    RETURN {
        patient_id: $patient_id,
        event_id: event_id,
        conditions: conditions,
        event_created_at: event_created_at,

        doctor_id: encounter_doctor_id,

        doctor_name:
            CASE
                WHEN size(event_doctors) > 0
                THEN event_doctors[0].doctor_name
                ELSE null
            END,

        doctor_specialty:
            CASE
                WHEN size(event_doctors) > 0
                THEN event_doctors[0].doctor_specialty
                ELSE null
            END,

        encounter_id: encounter_id,
        encounter_number: encounter_number,
        encounter_status: encounter_status,
        encounter_date: encounter_date,
        encounter_opened_at: encounter_opened_at,
        encounter_closed_at: encounter_closed_at,
        appointment_id: appointment_id,

        summaries: latest_summaries,
        synthesis: latest_synthesis,
        profile: patient_profile
    } AS result
    """

    logger.info(
        "[PreTreatment] Fetching latest graph | "
        f"patient={patient_id} | doctor={doctor_id}"
    )

    # Use your existing Neo4j session/driver here.....
    result = await run_neo4j_query(
        cypher,
        {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
        },
    )

    rows = [record for record in result]

    if not rows:
        logger.warning(
            "[PreTreatment] No latest graph data found | "
            f"patient={patient_id} | doctor={doctor_id}"
        )

        return {
            "status": "not_found",
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "data": None,
        }

    latest_record = rows[0]

    # Neo4j returns the projected map under the
    # RETURN alias "result".
    #
    # Unwrap that transport-level envelope so that
    # encounter_id and the other graph fields are
    # read from the actual returned graph object.
    if (
        isinstance(latest_record, dict)
        and isinstance(latest_record.get("result"), dict)
    ):
        latest = latest_record["result"]
    else:
        latest = latest_record

    latest = _safe_copy(latest)

    logger.info(
        "[PreTreatment] Latest graph retrieved | "
        f"patient={patient_id} | "
        f"doctor={doctor_id} | "
        f"event={latest.get('event_id')} | "
        f"encounter={latest.get('encounter_id')}"
    )

    return {
        "status": "success",
        "source": "clinical_graph",
        "retrieval_mode": "latest_current_clinical_state",
        "patient_id": patient_id,
        "doctor_id": doctor_id,
        "encounter_id": latest.get("encounter_id"),
        "data": latest,
    }


# =========================================================
# 9. BUILD CURRENT CONSULTATION CONTEXT
# ============================================================

def build_current_consultation_context(
    request_data: PreTreatmentAssessmentRequest,
) -> Dict[str, Any]:
    """
    Build the current frontend consultation context.

    Clinical form fields remain completely dynamic.
    """

    return {

        "dictation": _safe_copy(
            request_data.dictation
        ),

        "form_data": _safe_copy(
            request_data.form_data
        ),

        "frontend_context": _safe_copy(
            request_data.frontend_context
        ),

        "encounter_id": request_data.encounter_id,

    }


# ============================================================
# 10. BUILD UNIFIED CLINICAL CONTEXT
# ============================================================

def _first_non_empty(
    *values: Any,
) -> Optional[Any]:
    """
    Return the first usable value.

    This is generic metadata handling only.
    It does NOT inspect clinical text and does NOT perform
    keyword/substring matching.
    """

    for value in values:
        if value is None:
            continue

        if isinstance(value, str):
            value = value.strip()
            if value:
                return value
        else:
            return value

    return None


def _get_structured_metadata(
    source: Any,
    *keys: str,
) -> Optional[Any]:
    """
    Read explicitly stored metadata from a dictionary.

    No clinical interpretation.
    No keyword matching.
    No substring matching.
    """

    if not isinstance(source, dict):
        return None

    for key in keys:
        if key in source:
            value = source.get(key)

            if isinstance(value, str):
                value = value.strip()

                if value:
                    return value

            elif value is not None:
                return value

    return None


def _build_expertise_routing_context(
    *,
    expertise_metadata: Dict[str, Any],
    doctor_data: Dict[str, Any],
    patient_data: Dict[str, Any],
    frontend_context: Dict[str, Any],
    graph_context: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Preserve canonical skill-routing metadata as a structured object.

    This is a transport layer only. It never derives IDs from clinical
    names, dictation, summaries, diagnoses, or treatment prose.
    """
    candidates: List[Dict[str, Any]] = []

    for source in (
        expertise_metadata,
        frontend_context,
        doctor_data,
        patient_data,
        graph_context,
    ):
        if not isinstance(source, dict):
            continue

        nested = source.get("expertise_routing")

        if isinstance(nested, dict):
            candidates.append(nested)

        candidates.append(source)

    result: Dict[str, Any] = {
        "specialty_skill_id": None,
        "disease_skill_ids": [],
        "treatment_skill_ids": [],
        "modality_skill_ids": [],
        "facility_skill_ids": [],
    }

    for source in candidates:
        if not isinstance(source, dict):
            continue

        if not result["specialty_skill_id"]:
            value = source.get("specialty_skill_id")

            if value:
                result["specialty_skill_id"] = str(value).strip()

        for field, singular in (
            ("disease_skill_ids", "disease_skill_id"),
            ("treatment_skill_ids", "treatment_skill_id"),
            ("modality_skill_ids", "modality_skill_id"),
            ("facility_skill_ids", "facility_skill_id"),
        ):
            values = _normalize_skill_ids(
                source.get(field)
            )

            if not values:
                values = _normalize_skill_ids(
                    source.get(singular)
                )

            for value in values:
                if value not in result[field]:
                    result[field].append(value)

    return result


def build_clinical_context(
    request_data,
    doctor_data,
    patient_data,
    patient_graph_id,
    graph_data,
) -> Dict[str, Any]:
    """
    Build one source-preserving clinical context.

    IMPORTANT
    ------------------------------------------------------------
    This function only transports explicitly structured metadata.
    It does NOT:
      - inspect dictation for routing
      - perform keyword matching
      - infer disease from clinical text
      - infer treatment from summaries
      - infer facility capabilities
      - contain disease/specialty-specific rules

    Expertise routing metadata may be supplied explicitly by the
    application in request_data.expertise_metadata. Existing
    doctor/patient/frontend/graph structured metadata remains
    supported as fallback sources.
    """

    # ========================================================
    # FRONTEND METADATA
    # ========================================================

    frontend_context = (
        request_data.frontend_context
        if isinstance(
            request_data.frontend_context,
            dict,
        )
        else {}
    )

    # ========================================================
    # EXPLICIT EXPERTISE ROUTING METADATA
    # ========================================================
    #
    # This is the preferred source for skill IDs.
    #
    # The application supplies canonical IDs; this layer does not
    # decide which skill an arbitrary clinical sentence means.
    # ========================================================

    expertise_metadata = (
        request_data.expertise_metadata
        if isinstance(request_data.expertise_metadata, dict)
        else {}
    )

    # ========================================================
    # GRAPH DATA
    # ========================================================

    graph_context = (
        graph_data.get("data")
        if isinstance(graph_data, dict)
        and isinstance(graph_data.get("data"), dict)
        else {}
    )

    # ========================================================
    # VISIT / ENCOUNTER CONTEXT
    # ========================================================

    visit_context = {
        "current_visit": {
            "encounter_id": graph_context.get("encounter_id"),
            "encounter_number": graph_context.get("encounter_number"),
            "encounter_date": graph_context.get("encounter_date"),
            "appointment_id": graph_context.get("appointment_id"),
            "encounter_status": graph_context.get("encounter_status"),
            "doctor_id": graph_context.get("doctor_id"),
        }
    }

    # ========================================================
    # EXPERTISE ROUTING METADATA
    # ==========================================

    # --------------------------------------------------------
    # SPECIALTY
    # --------------------------------------------------------

    specialty_skill_id = _first_non_empty(
        _get_structured_metadata(
            expertise_metadata,
            "specialty_skill_id",
            "expertise_skill_id",
        ),
        _get_structured_metadata(
            doctor_data,
            "specialty_skill_id",
            "expertise_skill_id",
        ),
        _get_structured_metadata(
            frontend_context,
            "specialty_skill_id",
            "expertise_skill_id",
        ),
    )

    specialty_identity = _first_non_empty(
        _get_structured_metadata(
            expertise_metadata,
            "specialty",
            "specialization",
            "speciality",
            "doctor_specialty",
        ),
        _get_structured_metadata(
            doctor_data,
            "specialty",
            "specialization",
            "speciality",
            "doctor_specialty",
        ),
        _get_structured_metadata(
            frontend_context,
            "specialty",
            "specialization",
            "speciality",
            "doctor_specialty",
        ),
    )

    # --------------------------------------------------------
    # DISEASE
    # --------------------------------------------------------

    disease_skill_id = _first_non_empty(
        _get_structured_metadata(
            expertise_metadata,
            "disease_skill_id",
            "cancer_skill_id",
        ),
        _get_structured_metadata(
            patient_data,
            "disease_skill_id",
            "cancer_skill_id",
        ),
        _get_structured_metadata(
            graph_context,
            "disease_skill_id",
            "cancer_skill_id",
        ),
        _get_structured_metadata(
            frontend_context,
            "disease_skill_id",
            "cancer_skill_id",
        ),
    )

    disease_identity = _first_non_empty(
        _get_structured_metadata(
            expertise_metadata,
            "disease",
            "disease_name",
            "cancer_type",
            "cancer",
            "primary_diagnosis",
        ),
        _get_structured_metadata(
            patient_data,
            "disease",
            "disease_name",
            "cancer_type",
            "cancer",
            "primary_diagnosis",
        ),
        _get_structured_metadata(
            frontend_context,
            "disease",
            "disease_name",
            "cancer_type",
            "cancer",
            "primary_diagnosis",
        ),
        _get_structured_metadata(
            graph_context,
            "disease",
            "disease_name",
            "cancer_type",
            "cancer",
            "primary_diagnosis",
        ),
    )

    # --------------------------------------------------------
    # TREATMENT
    # --------------------------------------------------------

    treatment_skill_id = _first_non_empty(
        _get_structured_metadata(
            expertise_metadata,
            "treatment_skill_id",
        ),
        _get_structured_metadata(
            frontend_context,
            "treatment_skill_id",
        ),
        _get_structured_metadata(
            patient_data,
            "treatment_skill_id",
        ),
        _get_structured_metadata(
            graph_context,
            "treatment_skill_id",
        ),
    )

    modality_skill_id = _first_non_empty(
        _get_structured_metadata(
            expertise_metadata,
            "modality_skill_id",
        ),
        _get_structured_metadata(
            frontend_context,
            "modality_skill_id",
        ),
        _get_structured_metadata(
            patient_data,
            "modality_skill_id",
        ),
        _get_structured_metadata(
            graph_context,
            "modality_skill_id",
        ),
    )

    treatment_identity = _first_non_empty(
        _get_structured_metadata(
            expertise_metadata,
            "treatment_type",
            "treatment_modality",
            "modality",
            "therapy_type",
        ),
        _get_structured_metadata(
            frontend_context,
            "treatment_type",
            "treatment_modality",
            "modality",
            "therapy_type",
        ),
        _get_structured_metadata(
            patient_data,
            "treatment_type",
            "treatment_modality",
            "modality",
            "therapy_type",
        ),
        _get_structured_metadata(
            graph_context,
            "treatment_type",
            "treatment_modality",
            "modality",
            "therapy_type",
        ),
    )

    # --------------------------------------------------------
    # FACILITY
    # --------------------------------------------------------

    facility_skill_id = _first_non_empty(
        _get_structured_metadata(
            expertise_metadata,
            "facility_skill_id",
            "facility_capability_skill_id",
        ),
        _get_structured_metadata(
            frontend_context,
            "facility_skill_id",
            "facility_capability_skill_id",
        ),
        _get_structured_metadata(
            patient_data,
            "facility_skill_id",
            "facility_capability_skill_id",
        ),
        _get_structured_metadata(
            graph_context,
            "facility_skill_id",
            "facility_capability_skill_id",
        ),
    )

    facility_capability_skill_id = _first_non_empty(
        _get_structured_metadata(
            expertise_metadata,
            "facility_capability_skill_id",
        ),
        _get_structured_metadata(
            frontend_context,
            "facility_capability_skill_id",
        ),
        _get_structured_metadata(
            patient_data,
            "facility_capability_skill_id",
        ),
        _get_structured_metadata(
            graph_context,
            "facility_capability_skill_id",
        ),
    )

    facility_identity = _first_non_empty(
        _get_structured_metadata(
            expertise_metadata,
            "facility_name",
            "facility",
        ),
        _get_structured_metadata(
            frontend_context,
            "facility_name",
            "facility",
        ),
        _get_structured_metadata(
            patient_data,
            "facility_name",
            "facility",
        ),
        _get_structured_metadata(
            graph_context,
            "facility_name",
            "facility",
        ),
    )

    # ========================================================
    # CANONICAL EXPERTISE ROUTING
    # ========================================================
    #
    # Preserve explicit canonical IDs as a first-class structured
    # contract. Nothing here interprets clinical prose.
    # ========================================================

    expertise_routing = _build_expertise_routing_context(
        expertise_metadata=expertise_metadata,
        doctor_data=doctor_data,
        patient_data=patient_data,
        frontend_context=frontend_context,
        graph_context=graph_context,
    )

    logger.info(
        "[PreTreatment] Canonical expertise routing | "
        f"{json.dumps(expertise_routing, default=str)}"
    )

    # ========================================================
    # DEBUG — RESOLVED ROUTING INPUT
    # ========================================================

    logger.info(
        "[PreTreatment] Expertise routing metadata | "
        "specialty_id={} | specialty_identity={} | "
        "disease_id={} | disease_identity={} | "
        "treatment_id={} | treatment_identity={} | "
        "modality_id={} | "
        "facility_id={} | facility_identity={} | "
        "facility_capability_skill_id={}",
        specialty_skill_id,
        specialty_identity,
        disease_skill_id,
        disease_identity,
        treatment_skill_id,
        treatment_identity,
        modality_skill_id,
        facility_skill_id,
        facility_identity,
        facility_capability_skill_id,
    )

    # ========================================================
    # UNIFIED CONTEXT
    # ========================================================

    clinical_context = {
        "context_version": "2.2",

        "created_at": datetime.now(
            timezone.utc
        ).isoformat(),

        # ====================================================
        # REQUEST
        # ====================================================

        "request": {
            "patient_id": request_data.patient_id,
            "doctor_id": request_data.doctor_id,
            "encounter_id": request_data.encounter_id,
            "patient_graph_id": patient_graph_id,
        },

        # ====================================================
        # EXPLICIT EXPERTISE METADATA
        # ====================================================
        #
        # Preserve the application-supplied metadata without
        # interpreting it. This is useful for debugging and for
        # downstream components that need to audit routing input.
        # ====================================================

        "expertise_metadata": _safe_copy(
            expertise_metadata
        ),

        "expertise_routing": _safe_copy(
            expertise_routing
        ),

        # ====================================================
        # EXPERTISE IDENTITY
        # ====================================================

        "doctor_context": {
            "source": "doctor_users",
            "data": _safe_copy(doctor_data),

            "specialty": specialty_identity,
            "specialty_skill_id": specialty_skill_id,
        },

        "patient_context": {
            "source": "patient_users",
            "data": _safe_copy(patient_data),

            "disease": disease_identity,
            "disease_skill_id": disease_skill_id,
            "disease_skill_ids": _safe_copy(
                expertise_routing.get("disease_skill_ids", [])
            ),
        },

        "treatment_context": {
            "treatment_type": treatment_identity,
            "treatment_skill_id": treatment_skill_id,
            "treatment_skill_ids": _safe_copy(
                expertise_routing.get("treatment_skill_ids", [])
            ),
            "modality_skill_id": modality_skill_id,
            "modality_skill_ids": _safe_copy(
                expertise_routing.get("modality_skill_ids", [])
            ),
        },

        "facility_context": {
            "facility_name": facility_identity,
            "facility_skill_id": facility_skill_id,
            "facility_skill_ids": _safe_copy(
                expertise_routing.get("facility_skill_ids", [])
            ),
            "facility_capability_skill_id":
                facility_capability_skill_id,
        },

        # ====================================================
        # AUTHORITATIVE SOURCES
        # ====================================================

        "authoritative_sources": {

            "current_consultation": {
                "source_type":
                    "direct_current_input",

                "data": _safe_copy(
                    build_current_consultation_context(
                        request_data
                    )
                ),
            },

            "patient_source": {
                "source_type":
                    "patient_source",

                "data": _safe_copy(
                    patient_data
                ),
            },
        },

        # ====================================================
        # SECONDARY GRAPH CONTEXT
        # ====================================================

        "secondary_graph_context": {

            "source_type":
                "clinical_graph",

            "retrieval_mode":
                "latest_with_available_history",

            "data": _safe_copy(
                graph_data
            ),
        },
        "visit_context": visit_context,
    }

    # ========================================================
    # FINAL EXPERTISE INPUT
    # ========================================================

    logger.info(
        "[PreTreatment] FINAL EXPERTISE INPUT | "
        "doctor_context={} | "
        "patient_context={} | "
        "treatment_context={} | "
        "facility_context={}",
        json.dumps(
            clinical_context.get(
                "doctor_context",
                {}
            ),
            default=str,
        ),
        json.dumps(
            clinical_context.get(
                "patient_context",
                {}
            ),
            default=str,
        ),
        json.dumps(
            clinical_context.get(
                "treatment_context",
                {}
            ),
            default=str,
        ),
        json.dumps(
            clinical_context.get(
                "facility_context",
                {}
            ),
            default=str,
        ),
    )

    return clinical_context



# ============================================================
# DOCTOR SKILL CUSTOMIZATION ENDPOINT
# ============================================================

@router.put(
    "/skills/customize"
)
async def customize_doctor_skill(
    payload: DoctorSkillCustomizationRequest,
):
    """
    Save a generic doctor-specific skill customization.

    The frontend can customize Focus, Questions, clinical domains,
    perspective, or other existing properties without this endpoint
    containing specialty-specific clinical logic.
    """
    try:
        result = await save_doctor_skill_customization(
            payload
        )

        return JSONResponse(
            status_code=200,
            content=result,
        )

    except ValueError as exc:
        logger.warning(
            "[PreTreatment Skills] Customization rejected | "
            f"reason={exc}"
        )

        return JSONResponse(
            status_code=400,
            content={
                "status": "error",
                "message": str(exc),
            },
        )

    except Exception as exc:
        logger.exception(
            "[PreTreatment Skills] Customization save failed"
        )

        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "Failed to save doctor skill customization",
                "reason": str(exc),
            },
        )



# ============================================================
# DOCTOR EFFECTIVE SKILLS READ ENDPOINT
# ============================================================

@router.get(
    "/skills/doctor/{doctor_id}"
)
async def get_doctor_effective_skills(
    doctor_id: str,
):
    """
    Return the canonical skill catalog plus the doctor-specific
    effective/customized skills.

    This endpoint is generic: the frontend does not need specialty-
    specific knowledge to render the returned skill structures.
    """
    try:
        await ensure_skill_catalog_seeded()

        canonical = await clinical_expertise_skills_collection.find(
            {
                "status": {
                    "$ne": "inactive",
                },
            },
            {
                "_id": 0,
            },
        ).sort(
            [
                ("type", 1),
                ("skill_id", 1),
            ]
        ).to_list(length=None)

        profiles = await doctor_skill_profiles_collection.find(
            {
                "doctor_id": doctor_id,
            },
            {
                "_id": 0,
            },
        ).to_list(length=None)

        profile_by_id = {
            profile.get("skill_id"): profile
            for profile in profiles
            if isinstance(profile, dict)
            and profile.get("skill_id")
        }

        effective = []

        for skill in canonical:
            skill_id = skill.get("skill_id")
            profile = profile_by_id.get(skill_id)

            if profile and profile.get("enabled") is False:
                continue

            overrides = (
                profile.get("overrides", {})
                if isinstance(profile, dict)
                else {}
            )

            effective_skill = _deep_merge(
                skill,
                overrides
                if isinstance(overrides, dict)
                else {},
            )

            effective_skill["customized"] = bool(
                overrides
            )
            effective_skill["enabled"] = True

            effective.append(
                effective_skill
            )

        logger.info(
            "[PreTreatment Skills] Doctor skill catalog requested | "
            f"doctor_id={doctor_id} | "
            f"canonical={len(canonical)} | "
            f"profiles={len(profiles)} | "
            f"effective={len(effective)}"
        )

        return JSONResponse(
            status_code=200,
            content={
                "status": "success",
                "doctor_id": doctor_id,
                "skills": _safe_copy(effective),
                "catalog": _safe_copy(canonical),
            },
        )

    except Exception as exc:
        logger.exception(
            "[PreTreatment Skills] Failed to load doctor skills"
        )

        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "Failed to load doctor skills",
                "reason": str(exc),
            },
        )


# ============================================================
# CANONICAL SKILL CATALOG — FOR PICKER UIs
# ============================================================

@router.get(
    "/skills/catalog"
)
async def get_skill_catalog(
    skill_type: Optional[str] = None,
):
    """
    Generic catalog listing for frontend pickers.

    Returns whatever skills currently exist in MongoDB for the
    requested type. Nothing about a specific disease, treatment,
    or facility is hardcoded here — this just reflects the catalog.
    """
    try:
        await ensure_skill_catalog_seeded()

        query: Dict[str, Any] = {"status": {"$ne": "inactive"}}

        if skill_type:
            query["type"] = skill_type

        skills = await clinical_expertise_skills_collection.find(
            query,
            {"_id": 0, "skill_id": 1, "name": 1, "type": 1},
        ).sort([("type", 1), ("name", 1)]).to_list(length=None)

        return JSONResponse(
            status_code=200,
            content={
                "status": "success",
                "skills": _safe_copy(skills),
            },
        )

    except Exception as exc:
        logger.exception(
            "[PreTreatment Skills] Failed to load skill catalog"
        )

        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "Failed to load skill catalog",
                "reason": str(exc),
            },
        )

# ============================================================
# 11. PRE-TREATMENT ASSESSMENT ENDPOINT
# ============================================================

@router.post(
    "/generate/new"
)
async def generate_pre_treatment_assessment(
    payload: PreTreatmentAssessmentRequest,
    request: Request,
):
    """
    Main endpoint.

    Flow:

        Frontend
            ↓
        Doctor MongoDB
            ↓
        Patient MongoDB
            ↓
        Latest Patient Graph
            ↓
        Latest Synthesis Graph
            ↓
        Build Clinical Context
            ↓
        File 2 Agent Harness
            ↓
        Final verified assessment
    """

    started_at = datetime.now(
        timezone.utc
    )

    try:

        logger.info(
            "[PreTreatment] Assessment request started | "
            f"patient={payload.patient_id} | "
            f"doctor={payload.doctor_id}"
        )

        # ====================================================
        # STEP 1
        # Doctor
        # ====================================================

        doctor_data = (
            await fetch_doctor_information(
                payload.doctor_id
            )
        )

        if not doctor_data:

            return JSONResponse(
                status_code=404,
                content={
                    "status": "error",
                    "message": (
                        "Doctor not found"
                    ),
                    "doctor_id":
                        payload.doctor_id,
                },
            )

        # ====================================================
        # STEP 2
        # Patient MongoDB
        # ====================================================

        patient_data = (
            await fetch_patient_mongodb_data(
                payload.patient_id
            )
        )

        if not patient_data:

            return JSONResponse(
                status_code=404,
                content={
                    "status": "error",
                    "message": (
                        "Patient not found"
                    ),
                    "patient_id":
                        payload.patient_id,
                },
            )

        # ================================================
        # STEP 3
        # Resolve graph patient ID
        # ====================================================

        patient_graph_id = payload.patient_id

        if not patient_graph_id:

            return JSONResponse(
                status_code=422,
                content={
                    "status": "error",
                    "message": (
                        "Patient graph identifier could "
                        "not be resolved from patient data"
                    ),
                    "patient_id":
                        payload.patient_id,
                },
            )

        # ====================================================
        # STEP 4
        # Latest Combined Clinical Graph
        # =================================================

        graph_data = await fetch_latest_graph_data(
            patient_id=payload.patient_id,
            doctor_id=payload.doctor_id,
        )

        logger.info(
            "LATEST GRAPH DATA:\n{}",
            json.dumps(graph_data, indent=2, default=str)
        )

        latest_data = graph_data.get("data")

        if not latest_data:
            return JSONResponse(
                status_code=404,
                content={
                    "status": "error",
                    "message": "No latest clinical graph data found",
                    "patient_id": patient_graph_id,
                    "doctor_id": payload.doctor_id,
                },
            )

        # ====================================================
        # STEP 6
        # Build unified context
        # ====================================================

        clinical_context = (
            build_clinical_context(
                request_data=payload,
                doctor_data=doctor_data,
                patient_data=patient_data,
                patient_graph_id=patient_graph_id,
                graph_data=graph_data,
            )
        )

        # ====================================================
        # STEP 6B
        # MongoDB expertise resolution
        # ====================================================
        #
        # The clinical context is already built from the doctor,
        # patient, and latest graph. Skill selection now happens
        # deterministically from structured identities/skill IDs.
        # MongoDB supplies the canonical skill definitions and any
        # doctor-specific overrides.
        # ====================================================

        expertise_context = (
            await resolve_mongodb_expertise_context(
                clinical_context
            )
        )

        clinical_context["expertise_context"] = (
            expertise_context
        )

        # Expose the final resolved canonical IDs at the top level too,
        # so downstream agents/debugging can see exactly which skills
        # were selected from the latest graph and loaded from MongoDB.
        resolved_ids = expertise_context.get(
            "resolved_skill_ids",
            {}
        ) if isinstance(expertise_context, dict) else {}

        clinical_context["expertise_routing"] = {
            "specialty_skill_id": resolved_ids.get(
                "specialty_skill_id"
            ),
            "disease_skill_ids": _normalize_skill_ids(
                resolved_ids.get("disease_skill_ids")
            ),
            "treatment_skill_ids": _normalize_skill_ids(
                resolved_ids.get("treatment_skill_ids")
            ),
            "modality_skill_ids": _normalize_skill_ids(
                resolved_ids.get("modality_skill_ids")
            ),
            "facility_skill_ids": _normalize_skill_ids(
                resolved_ids.get("facility_skill_ids")
            ),
        }

        logger.info(
            "[PreTreatment Skills] FINAL ROUTING ATTACHED | "
            f"{json.dumps(clinical_context['expertise_routing'], default=str)}"
        )

        logger.info(
            "[PreTreatment Skills] Expertise context attached "
            "to clinical context | "
            f"doctor_id={payload.doctor_id} | "
            f"patient_id={payload.patient_id}"
        )

        # ====================================================
        # DEBUG: LOG EXACT CONTEXT SENT TO HARNESS
        # ====================================================

        logger.info(
            "[PreTreatment] CLINICAL CONTEXT SENT TO HARNESS:\n{}",
            json.dumps(
                clinical_context,
                indent=2,
                default=str,
            ),
        )

        # ====================================================
        # STEP 7
        # Check Agent Harness
        # ====================================================

        if run_pre_treatment_harness is None:

            return JSONResponse(
                status_code=503,
                content={
                    "status": "context_ready",
                    "message": (
                        "Clinical context was successfully "
                        "constructed, but File 2 Agent Harness "
                        "is not available yet."
                    ),
                    "patient_id":
                        patient_graph_id,
                    "clinical_context":
                        clinical_context,
                },
            )

        # ================================================
        # STEP 8
        # Run Agent Harness
        #
        # The Harness receives the latest source-preserving
        # clinical context.
        # ==============================================

        assessment_result = (
            await run_pre_treatment_harness(
                clinical_context=clinical_context,
            )
        )

        
        # ====================================================
        # LOG COMPLETE FINAL ASSESSMENT OUTPUT
        # ====================================================

        logger.info(
            "[PreTreatment] FINAL ASSESSMENT OUTPUT | "
            f"patient={patient_graph_id} | "
            f"doctor={payload.doctor_id} | "
            f"encounter={payload.encounter_id}"
        )

        logger.info(
            "[PreTreatment] FINAL ASSESSMENT RESULT:\n{}",
            json.dumps(
                assessment_result,
                indent=2,
                default=str,
            ),
        )



        # ====================================================
        # STEP 9
        # Save generated assessment to MongoDB
        # ====================================================

        finished_at = datetime.now(
            timezone.utc
        )

        execution_time_seconds = (
            finished_at - started_at
        ).total_seconds()

        # The encounter actually used by the latest graph
        generated_encounter_id = (
            graph_data.get("encounter_id")
        )

        # ----------------------------------------------------
        # Keep assessment metadata consistent
        # ----------------------------------------------------

        if isinstance(assessment_result, dict):

            assessment_result["patient_id"] = (
                patient_graph_id
            )

            assessment_result["doctor_id"] = (
                payload.doctor_id
            )

            assessment_result["encounter_id"] = (
                generated_encounter_id
            )

            assessment_result["generated_at"] = (
                finished_at.isoformat()
            )

        # ----------------------------------------------------
        # INSERT NEW ASSESSMENT
        #
        # Every Generate click creates a NEW MongoDB document.
        # Existing assessments are NOT overwritten.
        # ----------------------------------------------------

        saved_assessment = {

            "patient_id":
                patient_graph_id,

            "doctor_id":
                payload.doctor_id,

            "encounter_id":
                generated_encounter_id,

            "generated_at":
                finished_at,

            "execution": {

                "started_at":
                    started_at,

                "finished_at":
                    finished_at,

                "duration_seconds":
                    execution_time_seconds,
            },

            "assessment":
                assessment_result,
        }

        insert_result = (
            await pre_treatment_assessments_collection.insert_one(
                saved_assessment
            )
        )

        logger.info(
            "[PreTreatment] Assessment saved to MongoDB | "
            f"mongo_id={insert_result.inserted_id} | "
            f"patient={patient_graph_id} | "
            f"doctor={payload.doctor_id} | "
            f"encounter={generated_encounter_id}"
        )

        logger.info(
            "[PreTreatment] Assessment completed | "
            f"patient={patient_graph_id} | "
            f"time={execution_time_seconds:.3f}s"
        )

        # ====================================================
        # STEP 10
        # Return final result
        # ====================================================

        return {

            "status":
                "success",

            "patient_id":
                patient_graph_id,

            "doctor_id":
                payload.doctor_id,

            "encounter_id":
                generated_encounter_id,

            "execution": {

                "started_at":
                    started_at.isoformat(),

                "finished_at":
                    finished_at.isoformat(),

                "duration_seconds":
                    execution_time_seconds,
            },

            "assessment":
                assessment_result,
        }



    except Exception as e:

        logger.exception(
            "[PreTreatment] Assessment generation failed"
        )

        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": (
                    "Failed to generate "
                    "pre-treatment assessment"
                ),
                "reason": str(e),
            },
        )

# ============================================================
# GET LATEST SAVED PRE-TREATMENT ASSESSMENT
# ============================================================

@router.get(
    "/latest"
)
async def get_latest_pre_treatment_assessment(
    patient_id: str,
    doctor_id: str,
    encounter_id: Optional[str] = None,
):
    """
    Retrieve the latest previously generated pre-treatment
    assessment from MongoDB.

    IMPORTANT:
    --------------------------------------------------------
    This endpoint does NOT run the AI/agent workflow.

    It only reads the latest saved assessment from MongoDB.
    """

    try:

        logger.info(
            "[PreTreatment] Retrieving latest saved assessment | "
            f"patient={patient_id} | "
            f"doctor={doctor_id} | "
            f"encounter={encounter_id}"
        )

        # ----------------------------------------------------
        # Build MongoDB query
        # ----------------------------------------------------

        query = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
        }

        # If frontend provides encounter_id,
        # retrieve the latest assessment for that encounter.
        if encounter_id:
            query["encounter_id"] = encounter_id

        # ----------------------------------------------------
        # Get latest generated assessment
        # ----------------------------------------------------

        latest_assessment = (
            await pre_treatment_assessments_collection.find_one(
                query,
                sort=[
                    ("generated_at", -1)
                ],
            )
        )

        # ----------------------------------------------------
        # Nothing saved yet
        # ----------------------------------------------------

        if not latest_assessment:

            logger.info(
                "[PreTreatment] No saved assessment found | "
                f"patient={patient_id} | "
                f"doctor={doctor_id} | "
                f"encounter={encounter_id}"
            )

            return {
                "status": "success",
                "found": False,
                "patient_id": patient_id,
                "doctor_id": doctor_id,
                "encounter_id": encounter_id,
                "data": None,
            }

        # ----------------------------------------------------
        # Convert Mongo ObjectId to string
        # ----------------------------------------------------

        latest_assessment["_id"] = str(
            latest_assessment["_id"]
        )

        logger.info(
            "[PreTreatment] Latest saved assessment found | "
            f"mongo_id={latest_assessment['_id']} | "
            f"patient={patient_id} | "
            f"doctor={doctor_id} | "
            f"encounter={latest_assessment.get('encounter_id')}"
        )

        # ----------------------------------------------------
        # Return saved assessment
        # ----------------------------------------------------

        return {
            "status": "success",
            "found": True,

            "patient_id":
                patient_id,

            "doctor_id":
                doctor_id,

            "encounter_id":
                latest_assessment.get(
                    "encounter_id"
                ),

            "data":
                _safe_copy(
                    latest_assessment
                ),
        }

    except Exception as e:

        logger.exception(
            "[PreTreatment] Failed to retrieve "
            "latest saved assessment"
        )

        return JSONResponse(
            status_code=500,
            content={
                "status": "error",

                "message":
                    "Failed to retrieve latest "
                    "pre-treatment assessment",

                "reason":
                    str(e),
            },
        )
# ============================================================
# 12. OPTIONAL CONTEXT-ONLY DEBUG ENDPOINT
# ============================================================
#
# This is useful while the graph is still being developed.
#
# It lets you test:
#
# Frontend
#   ↓
# MongoDB
#   ↓
# Graph retrieval
#   ↓
# Clinical Context
#
# WITHOUT running the agents.
#
# You can remove this endpoint later if you don't want it
# exposed in production.
# ============================================================


@router.post(
    "/debug/context"
)
async def debug_pre_treatment_context(
    payload: PreTreatmentAssessmentRequest,
    request: Request,
):
    """
    Development/debug endpoint.

    Returns the context that would be given to the Agent
    Harness.
    """

    try:

        # ----------------------------------------------------
        # Doctor
        # ----------------------------------------------------

        doctor_data = (
            await fetch_doctor_information(
                payload.doctor_id
            )
        )

        if not doctor_data:

            return JSONResponse(
                status_code=404,
                content={
                    "status": "error",
                    "message":
                        "Doctor not found",
                },
            )

        # ----------------------------------------------------
        # Patient
        # ----------------------------------------------------

        patient_data = (
            await fetch_patient_mongodb_data(
                payload.patient_id
            )
        )

        if not patient_data:

            return JSONResponse(
                status_code=404,
                content={
                    "status": "error",
                    "message":
                        "Patient not found",
                },
            )

        # ----------------------------------------------------
        # Graph ID
        # ----------------------------------------------------

        patient_graph_id = payload.patient_id


        if not patient_graph_id:

            return JSONResponse(
                status_code=422,
                content={
                    "status": "error",
                    "message": (
                        "Patient graph identifier "
                        "could not be resolved"
                    ),
                },
            )

        # ----------------------------------------------------
        # Latest Combined Clinical Graph
        # ----------------------------------------------------

        graph_data = await fetch_latest_graph_data(
            patient_id=payload.patient_id,
            doctor_id=payload.doctor_id,
        )

        latest_data = graph_data.get("data")

        if not latest_data:

            return JSONResponse(
                status_code=404,
                content={
                    "status": "error",
                    "message":
                        "No latest clinical graph data found",
                    "patient_id":
                        patient_graph_id,
                    "doctor_id":
                        payload.doctor_id,
                },
            )

        # ----------------------------------------------------
        # Build Unified Clinical Context
        # ----------------------------------------------------

        clinical_context = (
            build_clinical_context(
                request_data=payload,
                doctor_data=doctor_data,
                patient_data=patient_data,
                patient_graph_id=patient_graph_id,
                graph_data=graph_data,
            )
        )

        clinical_context["expertise_context"] = (
            await resolve_mongodb_expertise_context(
                clinical_context
            )
        )

        resolved_ids = clinical_context["expertise_context"].get(
            "resolved_skill_ids",
            {}
        )

        clinical_context["expertise_routing"] = {
            "specialty_skill_id": resolved_ids.get(
                "specialty_skill_id"
            ),
            "disease_skill_ids": _normalize_skill_ids(
                resolved_ids.get("disease_skill_ids")
            ),
            "treatment_skill_ids": _normalize_skill_ids(
                resolved_ids.get("treatment_skill_ids")
            ),
            "modality_skill_ids": _normalize_skill_ids(
                resolved_ids.get("modality_skill_ids")
            ),
            "facility_skill_ids": _normalize_skill_ids(
                resolved_ids.get("facility_skill_ids")
            ),
        }

        logger.info(
            "[PreTreatment Skills] DEBUG FINAL ROUTING ATTACHED | "
            f"{json.dumps(clinical_context['expertise_routing'], default=str)}"
        )

        return {

            "status":
                "success",

            "patient_id":
                patient_graph_id,

            "clinical_context":
                clinical_context,

        }

    except Exception as e:

        logger.exception(
            "[PreTreatment] Context generation failed"
        )

        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message":
                    "Failed to build clinical context",
                "reason": str(e),
            },
        )



# =======================================================
# 13. OPTIONAL SHUTDOWN HELPER
# ======================================================

async def close_pre_treatment_connections():
    """
    Close MongoDB and Neo4j connections during application
    shutdown if your main FastAPI application wants to call
    this explicitly.
    """

    try:

        mongodb_client.close()

    except Exception:

        logger.exception(
            "Failed to close MongoDB connection"
        )

    try:

        await neo4j_driver.close()

    except Exception:

        logger.exception(
            "Failed to close Neo4j connection"
        )