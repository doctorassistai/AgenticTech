# skill_markdown_router.py  (v3 — paired with skill_markdown.py v4)
#
# Changes from v2:
#   * markdown_to_skill_body() is now called with a `warnings` list so the
#     rare remaining JSON-fallback case (Issue 8) is surfaced to the
#     frontend instead of failing silently. The save is NOT blocked for
#     this -- nothing is lost, the field is just kept as text -- but the
#     doctor now finds out.
#   * A cheap post-save shape check flags fields whose TYPE changed in a
#     way that suggests structure was accidentally flattened (e.g. a list
#     the doctor edited collapsed to a string). Also a warning, not a
#     block, for the same reason: refusing entirely risks re-triggering
#     Issue 5 (deletions being unreliable) by making the safe path (typing
#     less) impossible.
import json
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse, Response
from motor.motor_asyncio import AsyncIOMotorClient
from loguru import logger
import re as _re

from Agentic.skill_markdown import skill_body_to_markdown, markdown_to_skill_body, finalize_saved_body
from Agentic.phase1_knowledge_pipeline import clean_empty_fields, MONGO_URI, MONGO_DB

router = APIRouter(prefix="/phase1/skills", tags=["skill-markdown"])



def _skill_filename(skill: dict, skill_id: str) -> str:
    """Turn the skill's name into a safe filename, e.g.
    'Neoadjuvant Chemo - HER2+' -> 'Neoadjuvant_Chemo_HER2.md'"""
    name = skill.get("name") or skill_id
    slug = _re.sub(r"[^A-Za-z0-9]+", "_", name).strip("_") or skill_id
    return f"{slug}.md"

def _coll(db, skill_type: str):
    return db["phase1_diagnosis_skills"] if skill_type == "diagnosis" else db["phase1_treatment_skills"]


def _markdown_meta(skill: dict, skill_id: str, skill_type: str) -> dict:
    # Metadata ALWAYS comes from the DB record, never from doctor-submitted
    # markdown (see skill_markdown.py's METADATA-block handling) -- this is
    # what makes metadata read-only (Issue 12) by construction rather than
    # by convention.
    return {
        "name": skill.get("name"), "skill_id": skill_id, "skill_type": skill_type,
        "disease_type": skill.get("disease_type"), "subtype": skill.get("subtype"),
        "skill_index": skill.get("skill_index"),
    }


def _shape_drift_warnings(new_body: dict, old_body: dict, path: str = "") -> list[str]:
    """Flag fields whose structural shape changed in a way that looks like
    accidental flattening (list/dict -> string) rather than a deliberate
    edit. Best-effort, non-blocking -- see module docstring."""
    warnings: list[str] = []
    for k, old_v in old_body.items():
        if k.startswith("_") or k not in new_body:
            continue
        new_v = new_body[k]
        p = f"{path}.{k}" if path else k
        if isinstance(old_v, (list, dict)) and old_v and isinstance(new_v, str):
            warnings.append(
                f"'{p}' used to be structured data and is now plain text -- "
                f"double-check this was intentional."
            )
        elif isinstance(old_v, dict) and isinstance(new_v, dict):
            warnings.extend(_shape_drift_warnings(new_v, old_v, p))
        elif isinstance(old_v, list) and isinstance(new_v, list):
            for i, item in enumerate(old_v):
                if i < len(new_v) and isinstance(item, dict) and isinstance(new_v[i], dict):
                    warnings.extend(_shape_drift_warnings(new_v[i], item, f"{p}[{i}]"))
    return warnings


@router.get("/{doctor_id}/{skill_id}/markdown", response_class=PlainTextResponse)
async def get_skill_markdown(doctor_id: str, skill_id: str, skill_type: str):
    client = AsyncIOMotorClient(MONGO_URI)
    try:
        skill = await _coll(client[MONGO_DB], skill_type).find_one(
            {"doctor_id": doctor_id, "skill_id": skill_id}
        )
        if not skill:
            raise HTTPException(404, "Skill not found")

        # Always regenerate from `body` (the source of truth) rather than
        # trusting a possibly-stale stored `skill_md` -- guarantees what the
        # doctor sees on open always matches the current JSON.
        return skill_body_to_markdown(
            skill["body"], meta=_markdown_meta(skill, skill_id, skill_type)
        )
    finally:
        client.close()


@router.get("/{doctor_id}/{skill_id}/download")
async def download_skill_markdown(doctor_id: str, skill_id: str, skill_type: str):
    client = AsyncIOMotorClient(MONGO_URI)
    try:
        skill = await _coll(client[MONGO_DB], skill_type).find_one(
            {"doctor_id": doctor_id, "skill_id": skill_id}
        )
        if not skill:
            raise HTTPException(404, "Skill not found")

        markdown = skill_body_to_markdown(
            skill["body"], meta=_markdown_meta(skill, skill_id, skill_type)
        )

        return Response(
            content=markdown,
            media_type="text/markdown",
            headers={
                "Content-Disposition": f'attachment; filename="{_skill_filename(skill, skill_id)}"'
            },
        )
    finally:
        client.close()


@router.put("/{doctor_id}/{skill_id}/markdown")
async def save_skill_markdown(doctor_id: str, skill_id: str, skill_type: str, payload: dict):
    md_text = payload.get("markdown", "")
    parse_warnings: list[str] = []
    new_body = markdown_to_skill_body(md_text, warnings=parse_warnings)

    # Guard against catastrophic accidental wipes (e.g. a frontend bug
    # sending an empty/truncated document). A save that would erase
    # everything is refused rather than silently accepted.
    if not new_body:
        raise HTTPException(
            400,
            "Could not parse any content from the submitted markdown. "
            "Refusing to save, to avoid wiping the skill's data.",
        )

    logger.info(f"[Markdown->JSON] doctor_id={doctor_id} skill_id={skill_id} skill_type={skill_type}")
    logger.debug(f"[RAW MD]\n{md_text}")
    logger.debug(f"[PARSED JSON]\n{json.dumps(new_body, indent=2, default=str)}")
    if parse_warnings:
        logger.warning(f"[Markdown->JSON] parse warnings for skill_id={skill_id}: {parse_warnings}")

    client = AsyncIOMotorClient(MONGO_URI)
    try:
        coll = _coll(client[MONGO_DB], skill_type)
        skill = await coll.find_one({"doctor_id": doctor_id, "skill_id": skill_id})
        if not skill:
            raise HTTPException(404, "Skill not found")

        old_body = skill.get("body", {})

        # NO MERGE with the old body for anything the doctor could see and
        # edit -- `new_body` is the complete clinical content the markdown
        # represents; a heading that's gone means that field was deleted,
        # on purpose. finalize_saved_body is a NARROWER, deliberate
        # exception: it only restores fields the doctor was never shown
        # (HIDDEN_FIELDS) and fixes the single-item-list ambiguity for flat
        # records -- it never brings back a field the doctor deleted.
        reconciled_body = finalize_saved_body(new_body, old_body)
        cleaned_body = clean_empty_fields(reconciled_body) or reconciled_body

        shape_warnings = _shape_drift_warnings(cleaned_body, old_body)
        all_warnings = parse_warnings + shape_warnings

        # Canonical markdown is always regenerated from the just-saved JSON
        # (never the doctor's raw text) -- guarantees skill_md exactly
        # reflects `body`, and that the SAME body always regenerates the
        # SAME markdown (idempotent -- fixes duplicate-heading drift).
        await coll.update_one(
            {"doctor_id": doctor_id, "skill_id": skill_id},
            {"$set": {
                "body": cleaned_body,
                "edited": True,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        return {
            "status": "saved",
            "skill_id": skill_id,
            "body": cleaned_body,
            "warnings": all_warnings,
        }
    finally:
        client.close()


@router.get("/{doctor_id}/{skill_id}/json")
async def get_skill_json(doctor_id: str, skill_id: str, skill_type: str):
    client = AsyncIOMotorClient(MONGO_URI)
    try:
        skill = await _coll(client[MONGO_DB], skill_type).find_one(
            {"doctor_id": doctor_id, "skill_id": skill_id}
        )
        if not skill:
            raise HTTPException(404, "Skill not found")
        return skill["body"]
    finally:
        client.close()