"""
preview_skill_markdown_router.py
=================================
Markdown editing for PREVIEW skills, stored in their own collection
(phase1_preview_skills) — one document per skill, not embedded inside
phase1_processing_jobs.pipeline_result anymore.

Mirrors skill_markdown_router.py exactly in behavior — same renderer,
same parser, same reconciliation — only the storage location differs:

    skill_markdown_router.py         -> phase1_diagnosis_skills / phase1_treatment_skills
    preview_skill_markdown_router.py -> phase1_preview_skills

This file must NOT be touched once a skill is approved; after approval the
skill lives in the permanent collections and the existing router takes over.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import PlainTextResponse, Response
from motor.motor_asyncio import AsyncIOMotorClient

from Agentic.skill_markdown import (
    skill_body_to_markdown,
    markdown_to_skill_body,
    finalize_saved_body,
)
from Agentic.phase1_knowledge_pipeline import clean_empty_fields, MONGO_URI, MONGO_DB
from Agentic.skill_markdown_router import _shape_drift_warnings, _skill_filename

router = APIRouter(prefix="/phase1/jobs", tags=["preview-skill-markdown"])


def _markdown_meta(skill: dict) -> dict:
    return {
        "name":         skill.get("name"),
        "skill_id":     skill.get("skill_id"),
        "skill_type":   skill.get("skill_type"),
        "disease_type": skill.get("disease_type"),
        "subtype":      skill.get("subtype"),
        "skill_index":  skill.get("skill_index"),
    }


async def _load_preview_skill(
    doc_id: str, doctor_id: str, skill_id: str, client: AsyncIOMotorClient
) -> dict:
    skill = await client[MONGO_DB]["phase1_preview_skills"].find_one(
        {"doc_id": doc_id, "doctor_id": doctor_id, "skill_id": skill_id}
    )
    if not skill:
        raise HTTPException(404, "Skill not found in this job's preview")
    return skill


@router.get("/{doc_id}/skills/{skill_id}/markdown", response_class=PlainTextResponse)
async def get_preview_skill_markdown(doc_id: str, skill_id: str, doctor_id: str = Query(...)):
    client = AsyncIOMotorClient(MONGO_URI)
    try:
        skill = await _load_preview_skill(doc_id, doctor_id, skill_id, client)
        return skill_body_to_markdown(skill.get("body", {}), meta=_markdown_meta(skill))
    finally:
        client.close()


@router.get("/{doc_id}/skills/{skill_id}/download")
async def download_preview_skill_markdown(doc_id: str, skill_id: str, doctor_id: str = Query(...)):
    client = AsyncIOMotorClient(MONGO_URI)
    try:
        skill = await _load_preview_skill(doc_id, doctor_id, skill_id, client)
        markdown = skill_body_to_markdown(skill.get("body", {}), meta=_markdown_meta(skill))
        return Response(
            content=markdown,
            media_type="text/markdown",
            headers={"Content-Disposition": f'attachment; filename="{_skill_filename(skill, skill_id)}"'},
        )
    finally:
        client.close()


@router.put("/{doc_id}/skills/{skill_id}/markdown")
async def save_preview_skill_markdown(
    doc_id: str, skill_id: str, doctor_id: str, payload: dict
):
    md_text = payload.get("markdown", "")
    parse_warnings: list[str] = []
    new_body = markdown_to_skill_body(md_text, warnings=parse_warnings)

    if not new_body:
        raise HTTPException(
            400,
            "Could not parse any content from the submitted markdown. "
            "Refusing to save, to avoid wiping the skill's preview data.",
        )

    client = AsyncIOMotorClient(MONGO_URI)
    try:
        preview_coll = client[MONGO_DB]["phase1_preview_skills"]
        skill = await _load_preview_skill(doc_id, doctor_id, skill_id, client)
        old_body = skill.get("body", {})

        reconciled_body = finalize_saved_body(new_body, old_body)
        cleaned_body     = clean_empty_fields(reconciled_body) or reconciled_body

        shape_warnings = _shape_drift_warnings(cleaned_body, old_body)
        all_warnings   = parse_warnings + shape_warnings

        await preview_coll.update_one(
            {"doc_id": doc_id, "doctor_id": doctor_id, "skill_id": skill_id},
            {"$set": {
                "body":       cleaned_body,
                "edited":     True,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )

        return {
            "status":   "saved",
            "skill_id": skill_id,
            "body":     cleaned_body,
            "warnings": all_warnings,
        }
    finally:
        client.close()