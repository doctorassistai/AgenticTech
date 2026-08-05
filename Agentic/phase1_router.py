"""
phase1_router.py  (v2)
======================
FastAPI router for Phase 1 – Clinical Knowledge Creation.

Changes from v1
---------------
* /upload now stores raw_text in the job cache (for the embedding step).
* New GET /skills/{doctor_id}/{skill_id}/markdown  — returns Markdown rendering.
* /graph endpoint supports filter by subtype and node_type.
* All responses include schema_version = "v2" for client detection.

Mount in your main app:
    from phase1_router import router as phase1_router
    app.include_router(phase1_router, prefix="/api/phase1", tags=["Phase 1"])

Endpoints:
    POST /upload                                     — Upload doc, run pipeline, return preview
    POST /approve                                    — Doctor approves (+ optional edits), save to MongoDB
    GET  /jobs/{doc_id}                              — Job status
    GET  /skills/{doctor_id}                         — List all skills for a doctor
    GET  /skills/{doctor_id}/{skill_id}              — Full skill document
    GET  /skills/{doctor_id}/{skill_id}/markdown     — Skill rendered as Markdown
    GET  /graph/{doctor_id}                          — Knowledge graph (nodes + edges)
"""

from __future__ import annotations

import uuid
from typing import Optional
import base64
import os
from fastapi import APIRouter, HTTPException, UploadFile, File, Query
from pydantic import BaseModel, Field
from motor.motor_asyncio import AsyncIOMotorClient
from loguru import logger

from celery import Celery

from Agentic.phase1_knowledge_pipeline import (
    approve_and_save,
    MONGO_URI,
    MONGO_DB,
    CHROMA_PERSIST_PATH,
    CHROMA_COLLECTION_NAME,
)
from Agentic.skill_markdown import skill_body_to_markdown
import glob
import chromadb

# Skill-vector Chroma collection names — mirrored from
# phase2_skill_retrieval_service.py's SKILL_CHROMA_DIAGNOSIS_COLLECTION /
# SKILL_CHROMA_TREATMENT_COLLECTION constants. Duplicated as plain strings
# here (rather than imported) to avoid pulling phase2's heavier retrieval
# dependencies into the phase1 router just for two collection names.
_SKILL_CHROMA_DIAGNOSIS_COLLECTION = "phase1_diagnosis_skills_vectors"
_SKILL_CHROMA_TREATMENT_COLLECTION = "phase1_treatment_skills_vectors"
# ── Simple local file store (swap for S3/MinIO in production) ─-
UPLOAD_DIR = os.getenv("PHASE1_UPLOAD_DIR", "/tmp/phase1_uploads")
AGENTIC_URL = os.getenv("AGENTIC_URL", "http://agentic:8000")   # for self-serve URL

CELERY_BROKER_URL = os.getenv(
    "CELERY_BROKER_URL",
    "amqp://legacy_ai_user:strongpassword@rabbitmq:5672/legacy_pdf_ai"
)

celery_client = Celery(
    "phase1_client",
    broker=CELERY_BROKER_URL,
)

os.makedirs(UPLOAD_DIR, exist_ok=True)

router = APIRouter(prefix="/phase1", tags=["Phase 1 – Knowledge Creation"])

SCHEMA_VERSION = "v2"


# ─────────────────────────────────────────────────────────────────
# PYDANTIC MODELS
# ─────────────────────────────────────────────────────────────────

class ApproveRequest(BaseModel):
    doc_id:             str
    doctor_id:          str
    approved_skill_ids: list[str]
    edited_skills:      dict[str, dict] = Field(default_factory=dict)


# ─────────────────────────────────────────────────────────────────
# DB HELPER
# ─────────────────────────────────────────────────────────────────

def _get_db():
    client = AsyncIOMotorClient(MONGO_URI)
    return client[MONGO_DB]

def _subtype_name(subtype):
    """
    Extract subtype name regardless of storage format.

    
    """
    if not subtype:
        return None

    if isinstance(subtype, str):
        return subtype.strip()

    if isinstance(subtype, dict):
        return (
            subtype.get("name")
            or subtype.get("subtype")
            or subtype.get("label")
        )

    return str(subtype)

async def _get_preview_skills(db, doc_id: str, doctor_id: str) -> list[dict]:
    skills = await db["phase1_preview_skills"].find(
        {"doc_id": doc_id, "doctor_id": doctor_id}
    ).to_list(length=None)
    for s in skills:
        s.pop("_id", None)
    return skills

# ─────────────────────────────────────────────────────────────────
# MARKDOWN RENDERER  (skill → human-readable Markdown)
# ─────────────────────────────────────────────────────────────────

def _skill_to_markdown(skill: dict) -> str:
    """
    Render a skill document as a Markdown string that matches the
    reference SKILL.md format used by the sir's skill pipeline.
    """
    body         = skill.get("body", {})
    subtype      = skill.get("subtype", "General")
    cancer_type  = skill.get("cancer_type", "")
    skill_type   = skill.get("skill_type", "")
    guideline    = skill.get("guideline", "")
    version      = skill.get("guideline_version", "")
    skill_id     = skill.get("skill_index", skill.get("skill_id", ""))
    triggers     = skill.get("trigger_keywords", [])

    lines: list[str] = []

    # ── Header ────────────────────────────────────────────────────
    lines.append(f"# SKILL: {subtype} {cancer_type} — {skill_type.title()}")
    lines.append("")
    lines.append("## metadata")
    lines.append(f"- skill_id: {skill_id}")
    lines.append(f"- guideline_source: {guideline} {version}".strip())
    lines.append(f"- category: oncology | {skill_type}")
    if triggers:
        lines.append(f'- triggers: {json.dumps(triggers[:10])}')
    lines.append("")

    # ── Disease scope ─────────────────────────────────────────────
    lines.append("## disease_scope")
    if skill_type == "diagnosis":
        defn = (body.get("disease_overview") or {}).get("definition", "")
        if defn:
            lines.append(f"Applies to: {defn[:200]}")
    else:
        lines.append(f"Applies to: {subtype} {cancer_type}")
    sb = body.get("skill_boundaries") or {}
    if sb.get("does_not_cover"):
        lines.append(f"Excludes: {', '.join(sb['does_not_cover'])}")
    lines.append("")

    # ─── DIAGNOSIS-specific sections ─────────────────────────────
    if skill_type == "diagnosis":
        # Risk stratification
        rs = body.get("risk_stratification") or {}
        if any(rs.values()):
            lines.append("## risk_stratification")
            for level in ("low_risk", "intermediate_risk", "high_risk"):
                val = rs.get(level, "")
                if val:
                    lines.append(f"- {level.replace('_', ' ').title()}: {val}")
            lines.append("")

        # Diagnostic pathway
        dp = body.get("diagnostic_pathway") or []
        if dp:
            lines.append("## diagnostic_pathway")
            for step in dp:
                lines.append(f"- {step}")
            lines.append("")

        # Staging
        staging = body.get("staging") or []
        if staging:
            lines.append("## staging")
            for s in staging:
                if isinstance(s, dict):
                    lines.append(
                        f"- **{s.get('stage', '')}**: {s.get('criteria', '')} — {s.get('description', '')}"
                    )
            lines.append("")

        # Biomarkers
        bms = body.get("biomarkers") or []
        if bms:
            lines.append("## biomarkers")
            for bm in bms:
                if isinstance(bm, dict):
                    lines.append(f"- **{bm.get('name', '')}**: {bm.get('significance', '')}")
                else:
                    lines.append(f"- {bm}")
            lines.append("")

        # Investigations
        inv = body.get("investigations") or {}
        if any(v for v in inv.values() if v):
            lines.append("## investigations")
            for cat, items in inv.items():
                if items:
                    lines.append(f"### {cat.replace('_', ' ').title()}")
                    for item in items:
                        lines.append(f"- {item}")
            lines.append("")

        # Molecular testing
        mt = body.get("molecular_testing") or {}
        if any(v for v in mt.values() if v):
            lines.append("## molecular_testing")
            for cat, items in mt.items():
                if items:
                    lines.append(f"### {cat.replace('_', ' ').title()}")
                    for item in items:
                        lines.append(f"- {item}")
            lines.append("")

    # ─── TREATMENT-specific sections ─────────────────────────────
    if skill_type == "treatment":
        # Treatment principles
        tp = body.get("treatment_principles", "")
        if tp:
            lines.append("## treatment_principles")
            lines.append(tp[:500])
            lines.append("")

        # Risk stratification
        rs_list = body.get("risk_stratification") or []
        if rs_list:
            lines.append("## risk_stratification")
            for rs in rs_list:
                if isinstance(rs, dict):
                    lines.append(
                        f"- **{rs.get('risk_group', '')}**: {rs.get('criteria', '')} "
                        f"→ {rs.get('implication', '')}"
                    )
            lines.append("")

        # Stage-wise treatment
        swt = body.get("stage_wise_treatment") or []
        if swt:
            lines.append("## stage_wise_treatment")
            for entry in swt:
                if isinstance(entry, dict):
                    lines.append(f"### {entry.get('stage', 'Unknown stage')}")
                    lines.append(f"Primary: {entry.get('primary_treatment', '')}")
                    for opt in (entry.get("options") or []):
                        lines.append(f"- {opt}")
            lines.append("")

        # Chemotherapy regimens
        regimens = (body.get("chemotherapy") or {}).get("regimens") or []
        if regimens:
            lines.append("## chemotherapy_regimens")
            for r in regimens:
                if isinstance(r, dict):
                    drugs = ", ".join(r.get("drugs") or [])
                    lines.append(f"### {r.get('name', '')}")
                    lines.append(f"- Drugs: {drugs}")
                    lines.append(f"- Indication: {r.get('indication', '')}")
            lines.append("")

        # Targeted therapy
        tt = body.get("targeted_therapy") or {}
        if tt.get("drugs"):
            lines.append("## targeted_therapy")
            lines.append(f"- Drugs: {', '.join(tt['drugs'])}")
            if tt.get("targets"):
                lines.append(f"- Targets: {', '.join(tt['targets'])}")
            if tt.get("indications"):
                lines.append(f"- Indications: {tt['indications'][:200]}")
            lines.append("")

        # Immunotherapy
        it = body.get("immunotherapy") or {}
        if it.get("drugs"):
            lines.append("## immunotherapy")
            lines.append(f"- Drugs: {', '.join(it['drugs'])}")
            if it.get("biomarker_selection"):
                lines.append(f"- Biomarker selection: {it['biomarker_selection'][:200]}")
            lines.append("")

        # Contraindications
        ci = body.get("contraindications") or []
        if ci:
            lines.append("## contraindications")
            for c in ci:
                if isinstance(c, dict):
                    lines.append(
                        f"- **{c.get('drug_or_action', '')}**: "
                        f"avoid if {c.get('condition', '')} — {c.get('reason', '')}"
                    )
            lines.append("")

        # Dose modifications
        dm = body.get("dose_modifications") or []
        if dm:
            lines.append("## dose_modifications")
            for d in dm:
                if isinstance(d, dict):
                    lines.append(
                        f"- {d.get('condition', '')}: "
                        f"{d.get('drug', '')} → {d.get('modification', '')}"
                    )
            lines.append("")

        # Monitoring
        mon = body.get("monitoring") or {}
        if mon.get("parameters") or mon.get("red_flags"):
            lines.append("## monitoring")
            for p in (mon.get("parameters") or []):
                lines.append(f"- {p}")
            if mon.get("frequency"):
                lines.append(f"- Frequency: {mon['frequency']}")
            if mon.get("red_flags"):
                lines.append("### red_flags")
                for rf in mon["red_flags"]:
                    lines.append(f"- {rf}")
            lines.append("")

        # Follow-up
        fu = body.get("follow_up") or {}
        if fu.get("schedule") or fu.get("monitoring_tests"):
            lines.append("## follow_up")
            if fu.get("schedule"):
                lines.append(f"- Schedule: {fu['schedule'][:200]}")
            for t in (fu.get("monitoring_tests") or []):
                lines.append(f"- {t}")
            lines.append("")

    # ─── Shared sections ──────────────────────────────────────────
    # Special populations
    sp = body.get("special_populations") or {}
    if any(v for v in sp.values() if v):
        lines.append("## special_populations")
        for pop, text in sp.items():
            if text:
                lines.append(f"- **{pop.replace('_', ' ').title()}**: {text[:200]}")
        lines.append("")

    # Key evidence
    ke = body.get("key_evidence") or []
    if ke:
        lines.append("## key_evidence")
        for ev in ke:
            if isinstance(ev, dict):
                lines.append(f"- **{ev.get('trial', '')}**: {ev.get('finding', '')}")
        lines.append("")

    # Skill boundaries
    if sb.get("related_skills"):
        lines.append("## skill_boundaries")
        if sb.get("does_not_cover"):
            lines.append(f"- Does not cover: {', '.join(sb['does_not_cover'])}")
        if sb.get("related_skills"):
            lines.append(f"- Related skills: {', '.join(sb['related_skills'])}")
        lines.append("")

    # Gaps
    gaps = body.get("gaps") or []
    if gaps:
        lines.append("## gaps")
        for g in gaps:
            lines.append(f"- {g}")
        lines.append("")

    return "\n".join(lines)


# Need json for markdown renderer
import json


# ─────────────────────────────────────────────────────────────────
# ENDPOINT: Upload document → run Phase 1 pipeline → preview
# ─────────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_document(
    file:      UploadFile = File(...),
    doctor_id: str = Query(...),
    doc_id:    Optional[str] = Query(default=None),
):
    """
    Upload a clinical document (PDF / DOCX / TXT).

    Dispatches to the phase1_queue Celery worker and returns immediately.
    Poll GET /phase1/jobs/{doc_id} for status updates.

    Status flow: queued → processing → pending_review → completed
    """
    if not file.filename:
        raise HTTPException(400, "No filename provided.")

    doc_id = doc_id or str(uuid.uuid4())

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(400, "Uploaded file is empty.")

    # ── 1. Save file to disk (NOT through RabbitMQ) ──
    safe_name  = f"{doc_id}_{file.filename}"
    local_path = os.path.join(UPLOAD_DIR, safe_name)
    with open(local_path, "wb") as f:
        f.write(file_bytes)

    # ── 2. Build URL the Celery worker will download from ──
    file_url = f"{AGENTIC_URL}/phase1/files/{safe_name}"

    # ── 3. Insert "queued" job record before dispatching ──
    db = _get_db()
    await db["phase1_processing_jobs"].update_one(
        {"doc_id": doc_id},
        {
            "$set": {
                "doc_id":         doc_id,
                "doctor_id":      doctor_id,
                "status":         "queued",
                "schema_version": SCHEMA_VERSION,
                "filename":       file.filename,
                "file_url":       file_url,
                "local_path":     local_path,
            }
        },
        upsert=True,
    )

    # ── 4. Dispatch to Celery — returns immediately ──
    logger.info(f"CELERY_BROKER_URL={CELERY_BROKER_URL}")

    task = celery_client.send_task(
        "agentic.phase1_pipeline",
        kwargs={
            "doctor_id": doctor_id,
            "doc_id": doc_id,
            "filename": file.filename,
            "file_url": file_url,
        },
        queue="phase1_queue",
        routing_key="phase1",
    )

    logger.info(f"CELERY TASK SENT: {task.id}")

    logger.info(
        f"[phase1/upload] queued | doctor={doctor_id} | doc_id={doc_id} | "
        f"task_id={task.id} | file={file.filename} | size={len(file_bytes):,}"
    )

    # ── 5. Return immediately — pipeline runs in background ──
    return {
        "doc_id":         doc_id,
        "task_id":        task.id,
        "status":         "queued",
        "schema_version": SCHEMA_VERSION,
    }


from fastapi.responses import FileResponse

@router.get("/files/{filename}")
async def serve_upload(filename: str):
    """
    Serves uploaded PDFs so the Celery worker can download them by URL.
    In production replace this with a signed S3/MinIO URL.
    """
    path = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(path):
        raise HTTPException(404, "File not found")
    return FileResponse(path)


# ─────────────────────────────────────────────────────────────────
# ENDPOINT: Doctor approves + optional edits → save to MongoDB
# ─────────────────────────────────────────────────────────────────

@router.post("/approve")
async def approve_skills(request: ApproveRequest):
    """
    Doctor reviews the preview, approves skills (with optional body edits),
    and persists everything to MongoDB.

    Body:
        doc_id:             str
        doctor_id:          str
        approved_skill_ids: [skill_id, ...]
        edited_skills:      {skill_id: {body_dict}, ...}   (optional)

    Returns:
        { "doc_id": str, "status": "saved", "saved": { collection: count } }
    """
    db  = _get_db()
    job = await db["phase1_processing_jobs"].find_one({"doc_id": request.doc_id})

    if not job:
        raise HTTPException(404, f"No pipeline job found for doc_id={request.doc_id}")
    if job.get("status") == "completed":
        raise HTTPException(409, "Skills for this document have already been saved.")

    pipeline_result: dict = job["pipeline_result"]
    skills = await _get_preview_skills(db, request.doc_id, request.doctor_id)

    try:
        saved = await approve_and_save(
            pipeline_result=pipeline_result,
            doctor_id=request.doctor_id,
            approved_skill_ids=request.approved_skill_ids,
            skills=skills,
            edited_skills=request.edited_skills,
        )
    except Exception as e:
        logger.exception(f"Approval save error for doc_id={request.doc_id}")
        raise HTTPException(500, f"Save failed: {e}")

    # Best-effort: index newly-approved skills into the clinical_skills Chroma
    # collection for the Skill-RAG agent. Never let this fail the approval —
    # the skills are already durably saved in MongoDB at this point.
    try:
        from Agentic.diagnostic_skill_agent import index_all_skills_for_doctor
        await index_all_skills_for_doctor(request.doctor_id, only_approved=True)
    except Exception as e:
        logger.warning(f"[Approve] skill reindex failed for doctor_id={request.doctor_id}: {e}")

   
    await db["phase1_processing_jobs"].update_one(
        {"doc_id": request.doc_id},
        {"$set": {"status": "completed", "saved_summary": saved}},
    )

    return {
        "doc_id":         request.doc_id,
        "status":         "saved",
        "schema_version": SCHEMA_VERSION,
        "saved":          saved,
    }


# ─────────────────────────────────────────────────────────────────
# ENDPOINT: Check job status
# ─────────────────────────────────────────────────────────────────

@router.get("/jobs/{doc_id}")
async def get_job_status(doc_id: str, doctor_id: str = Query(...)):
    db  = _get_db()
    job = await db["phase1_processing_jobs"].find_one(
        {"doc_id": doc_id, "doctor_id": doctor_id},
        {"_id": 0, "pipeline_result": 0},   # exclude the huge payload
    )
    if not job:
        raise HTTPException(404, f"Job not found: {doc_id}")
    return job


@router.get("/jobs/{doc_id}/result")
async def get_job_result(doc_id: str, doctor_id: str = Query(...)):
    """
    Called once when polling detects status=pending_review.
    Returns the full pipeline result including preview.
    """
    db  = _get_db()
    job = await db["phase1_processing_jobs"].find_one(
        {"doc_id": doc_id, "doctor_id": doctor_id},
        {"_id": 0}   # include everything
    )
    if not job:
        raise HTTPException(404, f"Job not found: {doc_id}")

    pr      = job.get("pipeline_result") or {}
    preview = pr.get("preview") or {}
    skills  = await _get_preview_skills(db, doc_id, doctor_id)

    # Merge body back into skills_preview
    body_by_id = {s["skill_id"]: s.get("body", {}) for s in skills}
    if preview.get("skills_preview"):
        for sp in preview["skills_preview"]:
            if not sp.get("body"):
                sp["body"] = body_by_id.get(sp["skill_id"], {})

    return {
        "doc_id":   doc_id,
        "status":   job.get("status"),
        "filename": job.get("filename", ""),
        "preview":  preview,
        "skills":   skills,
    }

# ─────────────────────────────────────────────────────────────────
# ENDPOINT: List all skills for a doctor
# ─────────────────────────────────────────────────────────────────

@router.get("/skills/{doctor_id}")
async def list_skills(
    doctor_id:  str,
    skill_type: Optional[str] = None,   # "diagnosis" | "treatment"
    cancer_type: Optional[str] = None,
    subtype:     Optional[str] = None,
):
    """
    List all skills saved for a given doctor.

    Optional query params:
        skill_type   — "diagnosis" | "treatment"
        cancer_type  — filter by cancer type (case-insensitive substring)
        subtype      — filter by subtype (case-insensitive substring)
    """
    db    = _get_db()
    query: dict = {"doctor_id": doctor_id}
    if cancer_type:
        query["cancer_type"] = {"$regex": cancer_type, "$options": "i"}
    if subtype:
        query["subtype"] = {"$regex": subtype, "$options": "i"}

    diag_query  = {**query, "skill_type": "diagnosis"}
    treat_query = {**query, "skill_type": "treatment"}
    if skill_type == "diagnosis":
        treat_query = None
    elif skill_type == "treatment":
        diag_query = None

    diagnosis_skills = []
    if diag_query is not None:
        diagnosis_skills = await db["phase1_diagnosis_skills"].find(
            diag_query, {"body": 0}
        ).to_list(length=200)

    treatment_skills = []
    if treat_query is not None:
        treatment_skills = await db["phase1_treatment_skills"].find(
            treat_query, {"body": 0}
        ).to_list(length=200)

    for doc in diagnosis_skills + treatment_skills:
        doc.pop("_id", None)

    return {
        "doctor_id":        doctor_id,
        "schema_version":   SCHEMA_VERSION,
        "diagnosis_skills": diagnosis_skills,
        "treatment_skills": treatment_skills,
        "total":            len(diagnosis_skills) + len(treatment_skills),
    }

# ─────────────────────────────────────────────────────────────────
# ENDPOINT: List ALL skills for a doctor — full data, no embedding
# ─────────────────────────────────────────────────────────────────

@router.get("/skills/{doctor_id}/full")
async def list_skills_full(
    doctor_id:   str,
    skill_type:  Optional[str] = None,   # "diagnosis" | "treatment"
    doc_id:      Optional[str] = None,
    cancer_type: Optional[str] = None,
    subtype:     Optional[str] = None,
):
    """
    Return every skill for a doctor with FULL data (including body),
    excluding only the embedding vector fields — keeps the payload
    usable for review/export/UI without carrying 3072-dim floats.

    Optional query params:
        skill_type   — "diagnosis" | "treatment"
        doc_id       — restrict to one guideline/document
        cancer_type  — filter by disease_type (case-insensitive substring)
        subtype      — filter by subtype (case-insensitive substring)
    """
    db    = _get_db()
    query: dict = {"doctor_id": doctor_id}
    if doc_id:
        query["doc_id"] = doc_id
    if cancer_type:
        query["disease_type"] = {"$regex": cancer_type, "$options": "i"}
    if subtype:
        query["subtype"] = {"$regex": subtype, "$options": "i"}

    # exclude ONLY embedding-related fields — everything else (body,
    # source_pages, references, trigger_keywords, etc.) comes through
    projection = {"_id": 0, "embedding": 0, "embedding_model": 0}

    diag_query  = {**query, "skill_type": "diagnosis"}
    treat_query = {**query, "skill_type": "treatment"}
    if skill_type == "diagnosis":
        treat_query = None
    elif skill_type == "treatment":
        diag_query = None

    diagnosis_skills = []
    if diag_query is not None:
        diagnosis_skills = await db["phase1_diagnosis_skills"].find(
            diag_query, projection
        ).to_list(length=None)

    treatment_skills = []
    if treat_query is not None:
        treatment_skills = await db["phase1_treatment_skills"].find(
            treat_query, projection
        ).to_list(length=None)

    return {
        "doctor_id":        doctor_id,
        "schema_version":   SCHEMA_VERSION,
        "diagnosis_skills": diagnosis_skills,
        "treatment_skills": treatment_skills,
        "total":            len(diagnosis_skills) + len(treatment_skills),
    }



# ─────────────────────────────────────────────────────────────────
# ENDPOINT: Delete a document and ALL derived content
# ─────────────────────────────────────────────────────────────────

def _get_chroma_client():
    return chromadb.PersistentClient(path=CHROMA_PERSIST_PATH)


async def _safe_delete_many(coll, query: dict) -> int:
    """Best-effort delete_many — never lets one collection's failure abort
    the rest of the cleanup. Returns deleted_count, or -1 on error."""
    try:
        result = await coll.delete_many(query)
        return result.deleted_count
    except Exception as e:
        logger.warning(f"[DeleteDocument] delete_many failed on {coll.name}: {e}")
        return -1


@router.delete("/documents/{doctor_id}/{doc_id}")
async def delete_document(doctor_id: str, doc_id: str):
    """
    Permanently deletes a document and everything derived from it for this
    doctor: the processing job record, preview skills, saved diagnosis/
    treatment skills, knowledge graph nodes/edges, clinical relationships,
    structurally-derived clinical skills, guideline version record,
    subtype taxonomy entries, disease/subtype registry entries, the
    embedding-job tracker, the skill vectors in ChromaDB's two skill
    collections, the section embeddings in ChromaDB's medical_guidelines
    collection, and the raw uploaded file on disk.

    This does NOT touch phase2_retrieval_metrics (query logs are not
    scoped to a single document and are kept for historical analytics).

    Idempotent — safe to call again on an already-deleted doc_id (returns
    all-zero counts rather than erroring), so it's safe to retry on a
    partial-failure response.
    """
    db = _get_db()

    # ── Sanity check: does this doc_id/doctor_id combination exist at all,
    # in EITHER the live job record or the saved/approved collections?
    job = await db["phase1_processing_jobs"].find_one(
        {"doc_id": doc_id, "doctor_id": doctor_id}, {"_id": 0, "local_path": 1}
    )
    guideline = await db["phase1_guideline_versions"].find_one(
        {"doc_id": doc_id, "doctor_id": doctor_id}, {"_id": 0}
    )
    if not job and not guideline:
        raise HTTPException(404, f"No document found for doc_id={doc_id}, doctor_id={doctor_id}")

    deleted: dict[str, int] = {}

    # ── 1. Collect every skill_id belonging to this document BEFORE
    # deleting the Mongo records, so we know what to purge from Chroma. ──
    skill_id_docs = []
    for coll_name in ("phase1_diagnosis_skills", "phase1_treatment_skills", "phase1_preview_skills"):
        try:
            docs = await db[coll_name].find(
                {"doc_id": doc_id, "doctor_id": doctor_id}, {"_id": 0, "skill_id": 1}
            ).to_list(length=None)
            skill_id_docs.extend(docs)
        except Exception as e:
            logger.warning(f"[DeleteDocument] failed reading skill_ids from {coll_name}: {e}")

    skill_ids = list({d.get("skill_id") for d in skill_id_docs if d.get("skill_id")})

    # ── 2. Purge Chroma skill vectors (keyed by skill_id, so must happen
    # while we still have the id list — Mongo deletion below doesn't
    # affect Chroma at all, they're separate stores). ──
    if skill_ids:
        try:
            chroma_client = _get_chroma_client()
            diag_vec_coll = chroma_client.get_or_create_collection(_SKILL_CHROMA_DIAGNOSIS_COLLECTION)
            treat_vec_coll = chroma_client.get_or_create_collection(_SKILL_CHROMA_TREATMENT_COLLECTION)
            diag_vec_coll.delete(ids=skill_ids)
            treat_vec_coll.delete(ids=skill_ids)
            deleted["chroma_skill_vectors"] = len(skill_ids)
        except Exception as e:
            logger.warning(f"[DeleteDocument] Chroma skill vector delete failed: {e}")
            deleted["chroma_skill_vectors"] = -1
    else:
        deleted["chroma_skill_vectors"] = 0

    # ── 3. Purge Chroma section embeddings (medical_guidelines collection,
    # keyed by doc_id in metadata — one entry per document section). ──
    try:
        chroma_client = _get_chroma_client()
        section_coll = chroma_client.get_or_create_collection(CHROMA_COLLECTION_NAME)
        existing = section_coll.get(where={"doc_id": doc_id}, include=[])
        section_ids = existing.get("ids", [])
        if section_ids:
            section_coll.delete(ids=section_ids)
        deleted["chroma_section_embeddings"] = len(section_ids)
    except Exception as e:
        logger.warning(f"[DeleteDocument] Chroma section embedding delete failed: {e}")
        deleted["chroma_section_embeddings"] = -1

    # ── 4. Purge every Mongo collection scoped by doc_id + doctor_id. ──
    doc_scoped_collections = [
        "phase1_processing_jobs",
        "phase1_preview_skills",
        "phase1_guideline_versions",
        "phase1_diagnosis_skills",
        "phase1_treatment_skills",
        "phase1_graph_nodes",
        "phase1_graph_edges",
        "phase1_clinical_relationships",
        "phase1_clinical_skills",
        "phase1_subtype_taxonomy",
        "disease_registry",
        "subtype_registry",
        "embedding_jobs",
    ]
    for coll_name in doc_scoped_collections:
        count = await _safe_delete_many(
            db[coll_name], {"doc_id": doc_id, "doctor_id": doctor_id}
        )
        deleted[coll_name] = count

    # ── 5. Delete the raw uploaded file(s) on disk. Prefer the exact path
    # stored on the job record; fall back to a glob match on doc_id, since
    # a completed/approved document's job record may already be gone. ──
    deleted_files = 0
    local_path = (job or {}).get("local_path")
    candidate_paths = [local_path] if local_path else []
    candidate_paths += glob.glob(os.path.join(UPLOAD_DIR, f"{doc_id}_*"))
    for path in set(p for p in candidate_paths if p):
        try:
            if os.path.exists(path):
                os.remove(path)
                deleted_files += 1
        except OSError as e:
            logger.warning(f"[DeleteDocument] failed removing file {path}: {e}")
    deleted["uploaded_files"] = deleted_files

    logger.info(f"[DeleteDocument] doc_id={doc_id} doctor_id={doctor_id} | {deleted}")

    return {
        "doc_id":         doc_id,
        "doctor_id":      doctor_id,
        "status":         "deleted",
        "schema_version": SCHEMA_VERSION,
        "deleted":        deleted,
    }

# ─────────────────────────────────────────────────────────────────
# ENDPOINT: Get one full skill (with body)
# ─────────────────────────────────────────────────────────────────

@router.get("/skills/{doctor_id}/{skill_id}")
async def get_skill(doctor_id: str, skill_id: str):
    """Return the full skill document including body (JSON)."""
    db    = _get_db()
    skill = await db["phase1_diagnosis_skills"].find_one(
        {"doctor_id": doctor_id, "skill_id": skill_id}
    )
    if not skill:
        skill = await db["phase1_treatment_skills"].find_one(
            {"doctor_id": doctor_id, "skill_id": skill_id}
        )
    if not skill:
        raise HTTPException(404, f"Skill not found: {skill_id}")

    skill.pop("_id", None)
    return skill


# ─────────────────────────────────────────────────────────────────
# ENDPOINT: Get skill rendered as Markdown
# ─────────────────────────────────────────────────────────────────

@router.get("/skills/{doctor_id}/{skill_id}/markdown",
            response_class=None)
async def get_skill_markdown(doctor_id: str, skill_id: str):
    """
    Return the skill rendered as a Markdown string in the reference SKILL.md format.
    Useful for feeding into the embedding pipeline or human review.
    """
    from fastapi.responses import PlainTextResponse

    db    = _get_db()
    skill = await db["phase1_diagnosis_skills"].find_one(
        {"doctor_id": doctor_id, "skill_id": skill_id}
    )
    if not skill:
        skill = await db["phase1_treatment_skills"].find_one(
            {"doctor_id": doctor_id, "skill_id": skill_id}
        )
    if not skill:
        raise HTTPException(404, f"Skill not found: {skill_id}")

    skill.pop("_id", None)
    markdown = skill_body_to_markdown(
        skill["body"],
        meta={
            "name": skill.get("name"),
            "skill_id": skill.get("skill_id"),
            "skill_type": skill.get("skill_type"),
            "disease_type": skill.get("disease_type"),
            "subtype": skill.get("subtype"),
            "skill_index": skill.get("skill_index"),
        }
    )
    return PlainTextResponse(content=markdown, media_type="text/markdown")


# ─────────────────────────────────────────────────────────────────
# ENDPOINT: Knowledge graph
# ─────────────────────────────────────────────────────────────────

@router.get("/graph/{doctor_id}")
async def get_knowledge_graph(
    doctor_id:   str,
    cancer_type: Optional[str] = None,
    subtype:     Optional[str] = None,
    node_type:   Optional[str] = None,   # disease | subtype | stage | drug | biomarker | evidence
):
    """
    Return graph nodes and edges for a doctor.

    Optional filters:
        cancer_type  — name substring match
        subtype      — name substring match
        node_type    — exact node type (disease | subtype | stage | drug | biomarker | evidence)
    """
    db    = _get_db()
    query: dict = {"doctor_id": doctor_id}

    if cancer_type:
        query["name"] = {"$regex": cancer_type, "$options": "i"}
    if subtype and not cancer_type:
        query["name"] = {"$regex": subtype, "$options": "i"}
    if node_type:
        query["type"] = node_type

    nodes = await db["phase1_graph_nodes"].find(query).to_list(length=1000)
    edges = await db["phase1_graph_edges"].find(
        {"doctor_id": doctor_id}
    ).to_list(length=2000)

    node_ids = {n["index"] for n in nodes}
    if cancer_type or subtype or node_type:
        # Filter edges to only those connecting to visible nodes
        edges = [e for e in edges if e["from"] in node_ids or e["to"] in node_ids]

    for doc in nodes + edges:
        doc.pop("_id", None)

    return {
        "doctor_id":      doctor_id,
        "schema_version": SCHEMA_VERSION,
        "node_count":     len(nodes),
        "edge_count":     len(edges),
        "nodes":          nodes,
        "edges":          edges,
    }


@router.get("/documents")
async def list_documents(doctor_id: str):
    """List all processed documents for a doctor."""
    client = AsyncIOMotorClient(MONGO_URI)
    db = client[MONGO_DB]
    try:
        cursor = db["phase1_guideline_versions"].find(
            {"doctor_id": doctor_id},
            {
                "_id": 0,
                "doc_id": 1,
                "guideline_name": 1,
                "guideline_version": 1,
                "disease_type": 1,
                "specialty": 1,
                "subtypes": 1,
                "confidence_stats": 1,
                "skill_ids": 1,
                "created_at": 1,
            }
        ).sort("created_at", -1)
        docs = await cursor.to_list(length=100)
        return {"documents": docs}
    finally:
        client.close()


@router.get("/documents/{doc_id}")
async def get_document(doc_id: str, doctor_id: str):
    """Get full pipeline output for a specific document."""
    client = AsyncIOMotorClient(MONGO_URI)
    db = client[MONGO_DB]
    try:
        # Guideline metadata
        guideline = await db["phase1_guideline_versions"].find_one(
            {"doc_id": doc_id, "doctor_id": doctor_id},
            {"_id": 0}
        )
        if not guideline:
            raise HTTPException(status_code=404, detail="Document not found")

        # Skills (both types)
        diag_skills = await db["phase1_diagnosis_skills"].find(
            {"doc_id": doc_id, "doctor_id": doctor_id}, {"_id": 0}
        ).to_list(length=200)

        treat_skills = await db["phase1_treatment_skills"].find(
            {"doc_id": doc_id, "doctor_id": doctor_id}, {"_id": 0}
        ).to_list(length=200)

        # Graph summary
        node_count  = await db["phase1_graph_nodes"].count_documents({"doc_id": doc_id})
        edge_count  = await db["phase1_graph_edges"].count_documents({"doc_id": doc_id})
        node_types  = await db["phase1_graph_nodes"].distinct("type", {"doc_id": doc_id})
        edge_types  = await db["phase1_graph_edges"].distinct("relationship", {"doc_id": doc_id})

        all_skills = diag_skills + treat_skills

        return {
            "doc_id":           doc_id,
            "guideline":        guideline,
            "skills":           all_skills,
            "skills_preview":   [
                {
                    "skill_id":         s["skill_id"],
                    "skill_index":      s.get("skill_index"),
                    "name":             s["name"],
                    "skill_type":       s["skill_type"],
                    "subtype":          s.get("subtype"),
                    "description":      s.get("description"),
                    "trigger_keywords": s.get("trigger_keywords", []),
                    "graph_path":       s.get("graph_path"),
                    "body":             s.get("body", {}),
                    "source_pages":     s.get("source_pages", []),
                    "confidence":       s.get("confidence", {}),
                    "status":           s.get("status"),
                }
                for s in all_skills
            ],
            "preview": {
                "guideline": {
                    "name":    guideline["guideline_name"],
                    "version": guideline["guideline_version"],
                },
                "summary": {
                    "disease_type":   guideline.get("disease_type"),
                    "specialty":      guideline.get("specialty"),
                    "diseases":       guideline.get("diseases", []),
                    "subtypes":       guideline.get("subtypes", []),
                    "drugs":          [],   # not stored at guideline level
                    "stages":         [],
                    "biomarkers":     [],
                    "investigations": [],
                    "regimens":       [],
                },
                "graph": {
                    "total_nodes": node_count,
                    "total_edges": edge_count,
                    "node_types":  sorted(node_types),
                    "edge_types":  sorted(edge_types),
                },
                "skills_preview": [
                    {
                        "skill_id":         s["skill_id"],
                        "skill_index":      s.get("skill_index"),
                        "name":             s["name"],
                        "skill_type":       s["skill_type"],
                        "subtype":          s.get("subtype"),
                        "description":      s.get("description"),
                        "trigger_keywords": s.get("trigger_keywords", []),
                        "graph_path":       s.get("graph_path"),
                        "body":             s.get("body", {}),
                        "source_pages":     s.get("source_pages", []),
                        "confidence":       s.get("confidence", {}),
                        "status":           s.get("status"),
                    }
                    for s in all_skills
                ],
                "diagnosis_knowledge":  next(
                    (s["body"] for s in diag_skills  if s.get("subtype") == "General"), {}
                ),
                "treatment_knowledge":  next(
                    (s["body"] for s in treat_skills if s.get("subtype") == "General"), {}
                ),
                "confidence_summary": guideline.get("confidence_stats", {}),
            },
        }
    finally:
        client.close()



@router.get("/jobs")
async def list_jobs(doctor_id: str):
    """
    List ALL pipeline jobs for a doctor, both pending_review and completed.

    This powers the "All Documents" library tab which shows every document
    that has ever been processed — not just those that were saved/approved.

    Returns a merged list sorted by created_at desc:
      - status="pending_review"  → processed but not yet approved
      - status="completed"       → approved and saved to guideline_versions
    """
    client = AsyncIOMotorClient(MONGO_URI)
    db = client[MONGO_DB]
    try:
        cursor = db["phase1_processing_jobs"].find(
            {"doctor_id": doctor_id},
            {
                "_id":          0,
                "doc_id":       1,
                "doctor_id":    1,
                "status":       1,
                "filename":     1,
                "created_at":   1,
                "completed_at": 1,
                "saved_summary": 1,
                # Pull guideline name / disease from the nested pipeline_result.preview
                "pipeline_result.preview.guideline":         1,
                "pipeline_result.preview.summary.disease_type": 1,
                "pipeline_result.preview.summary.specialty":    1,
                "pipeline_result.preview.summary.subtypes":     1,
                "pipeline_result.preview.summary.diseases":     1,
                "pipeline_result.skill_count":                  1,
                "pipeline_result.preview.confidence_summary":   1,
            }
        ).sort("created_at", -1)

        raw_jobs = await cursor.to_list(length=200)

        jobs = []
        for job in raw_jobs:
            pr = job.pop("pipeline_result", {}) or {}
            preview_g   = (pr.get("preview") or {}).get("guideline") or {}
            preview_s   = (pr.get("preview") or {}).get("summary")   or {}
            conf_summary = (pr.get("preview") or {}).get("confidence_summary") or {}
            jobs.append({
                **job,
                "guideline_name":    preview_g.get("name")    or job.get("filename", ""),
                "guideline_version": preview_g.get("version") or "",
                "disease_type":      preview_s.get("disease_type") or "",
                "specialty":         preview_s.get("specialty")    or "",
                "subtypes":          preview_s.get("subtypes")     or [],
                "diseases":          preview_s.get("diseases")     or [],
                "skill_count":       pr.get("skill_count", 0),
                "confidence_stats":  {
                    "mean": conf_summary.get("overall_mean", 0),
                } if conf_summary else None,
            })

        return {"jobs": jobs}
    finally:
        client.close()


@router.get("/jobs/{doc_id}")
async def get_job(doc_id: str, doctor_id: str):
    """
    Get the full pipeline output for a job (pending OR completed).

    For completed jobs the data also exists in phase1_guideline_versions /
    phase1_diagnosis_skills etc., but pending jobs ONLY exist in
    phase1_processing_jobs.  This endpoint handles both cases.

    Returns the same shape as GET /documents/{doc_id} so the frontend
    can use a single DocumentDetailView component for both.
    """
    client = AsyncIOMotorClient(MONGO_URI)
    db = client[MONGO_DB]
    try:
        job = await db["phase1_processing_jobs"].find_one(
            {"doc_id": doc_id, "doctor_id": doctor_id},
            {"_id": 0}
        )
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        pr      = job.get("pipeline_result") or {}
        preview = pr.get("preview") or {}
        skills  = await _get_preview_skills(db, doc_id, doctor_id)

        # Normalise skills_preview — pipeline stores body inside each skill
        skills_preview = [
            {
                "skill_id":         s.get("skill_id"),
                "skill_index":      s.get("skill_index"),
                "name":             s.get("name"),
                "skill_type":       s.get("skill_type"),
                "subtype":          s.get("subtype"),
                "description":      s.get("description"),
                "trigger_keywords": s.get("trigger_keywords", []),
                "graph_path":       s.get("graph_path"),
                "body":             s.get("body", {}),
                "source_pages":     s.get("source_pages", []),
                "confidence":       s.get("confidence", {}),
                "status":           s.get("status"),
            }
            for s in skills
        ]

        # If preview already has skills_preview (from build_doctor_preview), use it
        # but make sure body is included (build_doctor_preview strips body_sections only)
        if preview.get("skills_preview"):
            # Merge body back in from the full skills list by skill_id
            body_by_id = {s["skill_id"]: s.get("body", {}) for s in skills}
            for sp in preview["skills_preview"]:
                if "body" not in sp or not sp["body"]:
                    sp["body"] = body_by_id.get(sp["skill_id"], {})
            skills_preview = preview["skills_preview"]

        return {
            "doc_id":     doc_id,
            "status":     job.get("status", "pending_review"),
            "filename":   job.get("filename", ""),
            "guideline":  preview.get("guideline") or {},
            "skills":     skills,
            "skills_preview": skills_preview,
            "preview": {
                **preview,
                "skills_preview": skills_preview,
                # Ensure diagnosis_knowledge + treatment_knowledge are present
                "diagnosis_knowledge": (
                    preview.get("diagnosis_knowledge")
                    or pr.get("diagnosis_knowledge")
                    or {}
                ),
                "treatment_knowledge": (
                    preview.get("treatment_knowledge")
                    or pr.get("treatment_knowledge")
                    or {}
                ),
            },
        }
    finally:
        client.close()


# ─────────────────────────────────────────────────────────────────
# ALSO UPDATE the existing list_documents endpoint to cross-reference
# jobs so status is consistent.  Replace list_documents with this:
# ─────────────────────────────────────────────────────────────────

@router.get("/documents")
async def list_documents(doctor_id: str):
    """
    List all SAVED (approved) documents for a doctor.
    Queries phase1_guideline_versions (persisted after approval).
    """
    client = AsyncIOMotorClient(MONGO_URI)
    db = client[MONGO_DB]
    try:
        cursor = db["phase1_guideline_versions"].find(
            {"doctor_id": doctor_id},
            {
                "_id": 0,
                "doc_id": 1,
                "guideline_name": 1,
                "guideline_version": 1,
                "disease_type": 1,
                "specialty": 1,
                "subtypes": 1,
                "confidence_stats": 1,
                "skill_ids": 1,
                "created_at": 1,
            }
        ).sort("created_at", -1)
        docs = await cursor.to_list(length=100)
        return {"documents": docs}
    finally:
        client.close()



@router.get("/jobs/{doc_id}/full")
async def get_full_pipeline_output(doc_id: str, doctor_id: str = Query(...)):
    """
    Returns everything the pipeline generated for a document:
    - skills (diagnosis + treatment, all subtypes)
    - knowledge graph (nodes + edges)
    - entities (diseases, subtypes, stages, biomarkers, drugs, regimens)
    - diagnosis_knowledge
    - treatment_knowledge
    - document summary
    """
    client = AsyncIOMotorClient(MONGO_URI)
    db = client[MONGO_DB]
    try:
        job = await db["phase1_processing_jobs"].find_one(
            {"doc_id": doc_id, "doctor_id": doctor_id},
            {"_id": 0}
        )
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        pr          = job.get("pipeline_result") or {}
        preview     = pr.get("preview") or {}
        summary     = preview.get("summary") or {}
        skills      = await _get_preview_skills(db, doc_id, doctor_id)
        graph       = pr.get("graph") or {}
        understanding = pr.get("understanding") or {}

        return {
            "doc_id":   doc_id,
            "status":   job.get("status"),
            "filename": job.get("filename", ""),
            "pipeline_version": pr.get("pipeline_version", ""),

            # ── Document summary ──────────────────────────────────
            "document_summary": {
                "guideline_name":    preview.get("guideline", {}).get("name", ""),
                "guideline_version": preview.get("guideline", {}).get("version", ""),
                "disease_type":      summary.get("disease_type", ""),
                "specialty":         summary.get("specialty", ""),
                "total_pages":       pr.get("total_pages", 0),
                "sections_processed": pr.get("sections_processed", 0),
                "llm_calls":         pr.get("llm_calls_estimate", 0),
            },

            # ── Entities ──────────────────────────────────────────
            "entities": {
                "diseases":       understanding.get("diseases", []),
                "subtypes":       understanding.get("subtypes", []),
                "stages":         understanding.get("stages", []),
                "biomarkers":     understanding.get("biomarkers", []),
                "drugs":          understanding.get("drugs", []),
                "regimens":       understanding.get("regimens", []),
                "investigations": understanding.get("investigations", []),
            },

            # ── Skills ────────────────────────────────────────────
            "skills": [
                {
                    "skill_id":         s.get("skill_id"),
                    "skill_index":      s.get("skill_index"),
                    "name":             s.get("name"),
                    "skill_type":       s.get("skill_type"),
                    "subtype":          s.get("subtype"),
                    "disease_type":     s.get("disease_type"),
                    "trigger_keywords": s.get("trigger_keywords", []),
                    "graph_path":       s.get("graph_path"),
                    "source_pages":     s.get("source_pages", []),
                    "confidence":       s.get("confidence", {}),
                    "status":           s.get("status"),
                    "body":             s.get("body", {}),
                }
                for s in skills
            ],
            "skills_count": {
                "total":     len(skills),
                "diagnosis": len([s for s in skills if s.get("skill_type") == "diagnosis"]),
                "treatment": len([s for s in skills if s.get("skill_type") == "treatment"]),
            },

            # ── Knowledge graph ───────────────────────────────────
            "knowledge_graph": {
                "nodes": graph.get("nodes", []),
                "edges": graph.get("edges", []),
                "node_count": len(graph.get("nodes", [])),
                "edge_count": len(graph.get("edges", [])),
                "node_types": sorted({n.get("type") for n in graph.get("nodes", []) if n.get("type")}),
                "edge_types": sorted({e.get("relationship") for e in graph.get("edges", []) if e.get("relationship")}),
            },

            # ── Diagnosis & treatment knowledge ───────────────────
            "diagnosis_knowledge": pr.get("diagnosis_knowledge") or {},
            "treatment_knowledge": pr.get("treatment_knowledge") or {},

            # ── Subtype breakdown ─────────────────────────────────
            "subtype_knowledge": {
                subtype: {
                    "diagnosis_confidence": data.get("diagnosis", {}).get("confidence", {}),
                    "treatment_confidence": data.get("treatment", {}).get("confidence", {}),
                    "stages": len(data.get("treatment", {}).get("stage_wise_treatment", [])),
                }
                for subtype, data in (pr.get("subtype_knowledge") or {}).items()
            },

            # ── Confidence summary ────────────────────────────────
            "confidence_summary": preview.get("confidence_summary") or {},
        }
    finally:
        client.close()


# ─────────────────────────────────────────────────────────────────
# ENDPOINT: Retrieve EVERYTHING for a doc_id (doctor_id-scoped)
# ─────────────────────────────────────────────────────────────────

@router.get("/documents/{doctor_id}/{doc_id}/full")
async def get_full_document(doctor_id: str, doc_id: str):
    """
    Single source-of-truth retrieval for a document, regardless of
    pipeline stage (pending_review OR completed/approved).

    Lookup order:
      1. phase1_processing_jobs   — has the full pipeline_result blob,
                                     present for BOTH pending and completed
                                     jobs (approve_and_save never deletes it).
      2. phase1_guideline_versions
         + phase1_diagnosis_skills / phase1_treatment_skills
         + phase1_graph_nodes / phase1_graph_edges
                                   — fallback if the job record was purged
                                     but the document was approved & saved.

    Returns the full pipeline output: entities, skills (with bodies),
    knowledge graph, diagnosis/treatment knowledge, subtype breakdown,
    coverage report, and confidence stats.
    """
    client = AsyncIOMotorClient(MONGO_URI)
    db = client[MONGO_DB]
    try:
        job = await db["phase1_processing_jobs"].find_one(
            {"doc_id": doc_id, "doctor_id": doctor_id}, {"_id": 0}
        )

        # ── Path A: live job record (covers pending + completed) ──
        if job and job.get("pipeline_result"):
            pr            = job["pipeline_result"]
            preview       = pr.get("preview") or {}
            summary       = preview.get("summary") or {}
            understanding = pr.get("understanding") or {}
            skills        = await _get_preview_skills(db, doc_id, doctor_id)
            graph         = pr.get("graph") or {}

            return {
                "doc_id":           doc_id,
                "doctor_id":        doctor_id,
                "source":           "processing_job",
                "status":           job.get("status"),
                "filename":         job.get("filename", ""),
                "pipeline_version": pr.get("pipeline_version", ""),

                "document_summary": {
                    "guideline_name":     preview.get("guideline", {}).get("name", ""),
                    "guideline_version":  preview.get("guideline", {}).get("version", ""),
                    "disease_name":       summary.get("disease_name", ""),
                    "disease_type":       summary.get("disease_type", ""),
                    "specialty":          summary.get("specialty", ""),
                    "total_pages":        pr.get("total_pages", 0),
                    "sections_processed": pr.get("sections_processed", 0),
                    "llm_calls":          pr.get("llm_calls_estimate", 0),
                },

                "entities": {
                    "diseases":       understanding.get("diseases", []),
                    "subtypes":       understanding.get("subtypes", []),
                    "stages":         understanding.get("stages", []),
                    "biomarkers":     understanding.get("biomarkers", []),
                    "drugs":          understanding.get("drugs", []),
                    "regimens":       understanding.get("regimens", []),
                    "investigations": understanding.get("investigations", []),
                },

                "skills": [
                    {
                        "skill_id":         s.get("skill_id"),
                        "skill_index":      s.get("skill_index"),
                        "name":             s.get("name"),
                        "skill_type":       s.get("skill_type"),
                        "subtype":          s.get("subtype"),
                        "disease_type":     s.get("disease_type"),
                        "trigger_keywords": s.get("trigger_keywords", []),
                        "graph_path":       s.get("graph_path"),
                        "source_pages":     s.get("source_pages", []),
                        "confidence":       s.get("confidence", {}),
                        "status":           s.get("status"),
                        "is_generic_subtype": s.get("is_generic_subtype", False),
                        "body":             s.get("body", {}),
                    }
                    for s in skills
                ],
                "skills_count": {
                    "total":     len(skills),
                    "diagnosis": len([s for s in skills if s.get("skill_type") == "diagnosis"]),
                    "treatment": len([s for s in skills if s.get("skill_type") == "treatment"]),
                },

                "knowledge_graph": {
                    "nodes":      graph.get("nodes", []),
                    "edges":      graph.get("edges", []),
                    "node_count": len(graph.get("nodes", [])),
                    "edge_count": len(graph.get("edges", [])),
                    "node_types": sorted({n.get("type") for n in graph.get("nodes", []) if n.get("type")}),
                    "edge_types": sorted({e.get("relationship") for e in graph.get("edges", []) if e.get("relationship")}),
                },

                "diagnosis_knowledge": pr.get("diagnosis_knowledge") or {},
                "treatment_knowledge": pr.get("treatment_knowledge") or {},

                "subtype_knowledge": {
                    subtype: {
                        "diagnosis_confidence": (data.get("diagnosis") or {}).get("confidence", {}),
                        "treatment_confidence": (data.get("treatment") or {}).get("confidence", {}),
                        "stages":      len((data.get("treatment") or {}).get("stage_wise_treatment", [])),
                        "is_generic":  data.get("is_generic", False),
                        "rejected":    data.get("rejected", False),
                        "specificity": data.get("specificity_score"),
                    }
                    for subtype, data in (pr.get("subtype_knowledge") or {}).items()
                },

                "coverage_report":   pr.get("coverage_report") or {},
                "bucket_summary":    pr.get("bucket_summary") or {},
                "quality_warnings":  pr.get("quality_warnings") or {},
                "processing_config": pr.get("processing_config") or {},
                "confidence_summary": preview.get("confidence_summary") or {},
            }

        # ── Path B: fallback to normalized post-approval collections ──
        guideline = await db["phase1_guideline_versions"].find_one(
            {"doc_id": doc_id, "doctor_id": doctor_id}, {"_id": 0}
        )
        if not guideline:
            raise HTTPException(404, f"No document found for doc_id={doc_id}")

        diag_skills  = await db["phase1_diagnosis_skills"].find(
            {"doc_id": doc_id, "doctor_id": doctor_id}, {"_id": 0}
        ).to_list(length=200)
        treat_skills = await db["phase1_treatment_skills"].find(
            {"doc_id": doc_id, "doctor_id": doctor_id}, {"_id": 0}
        ).to_list(length=200)
        nodes = await db["phase1_graph_nodes"].find(
            {"doc_id": doc_id, "doctor_id": doctor_id}, {"_id": 0}
        ).to_list(length=2000)
        edges = await db["phase1_graph_edges"].find(
            {"doc_id": doc_id, "doctor_id": doctor_id}, {"_id": 0}
        ).to_list(length=4000)

        all_skills = diag_skills + treat_skills

        return {
            "doc_id":    doc_id,
            "doctor_id": doctor_id,
            "source":    "saved_collections",
            "status":    "completed",
            "filename":  guideline.get("guideline_name", ""),

            "document_summary": {
                "guideline_name":    guideline.get("guideline_name", ""),
                "guideline_version": guideline.get("guideline_version", ""),
                "disease_name":      guideline.get("disease_name", ""),
                "disease_type":      guideline.get("disease_type", ""),
                "specialty":         guideline.get("specialty", ""),
            },

            "entities": {
                "diseases": guideline.get("diseases", []),
                "subtypes": guideline.get("subtypes", []),
            },

            "skills": [
                {
                    "skill_id":         s.get("skill_id"),
                    "skill_index":      s.get("skill_index"),
                    "name":             s.get("name"),
                    "skill_type":       s.get("skill_type"),
                    "subtype":          s.get("subtype"),
                    "disease_type":     s.get("disease_type"),
                    "trigger_keywords": s.get("trigger_keywords", []),
                    "graph_path":       s.get("graph_path"),
                    "source_pages":     s.get("source_pages", []),
                    "confidence":       s.get("confidence", {}),
                    "status":           s.get("status"),
                    "body":             s.get("body", {}),
                }
                for s in all_skills
            ],
            "skills_count": {
                "total":     len(all_skills),
                "diagnosis": len(diag_skills),
                "treatment": len(treat_skills),
            },

            "knowledge_graph": {
                "nodes": nodes, "edges": edges,
                "node_count": len(nodes), "edge_count": len(edges),
                "node_types": sorted({n.get("type") for n in nodes if n.get("type")}),
                "edge_types": sorted({e.get("relationship") for e in edges if e.get("relationship")}),
            },

            "diagnosis_knowledge": next(
                (s["body"] for s in diag_skills if s.get("subtype") == "General"), {}
            ),
            "treatment_knowledge": next(
                (s["body"] for s in treat_skills if s.get("subtype") == "General"), {}
            ),

            "confidence_summary": guideline.get("confidence_stats", {}),
        }
    finally:
        client.close()





##29-07-2026


# ─────────────────────────────────────────────────────────────────
# VIEW 1 — Doctor Knowledge Overview (summary metrics)
# ─────────────────────────────────────────────────────────────────
 
@router.get("/doctor/{doctor_id}/knowledge-dashboard/overview")
async def get_knowledge_overview(doctor_id: str):
    db = _get_db()
 
    guidelines = await db["phase1_guideline_versions"].find(
        {"doctor_id": doctor_id},
        {"_id": 0, "diseases": 1, "disease_type": 1, "subtypes": 1, "doc_id": 1},
    ).to_list(length=None)
 
    disease_set: set[str] = set()
    subtype_set: set[str] = set()
    for g in guidelines:
        for d in (g.get("diseases") or []):
            if d:
                disease_set.add(d)
        if g.get("disease_type"):
            disease_set.add(g["disease_type"])
        for s in (g.get("subtypes") or []):
            name = _subtype_name(s)
            if name:
                subtype_set.add(name)
 
    documents_count = len(guidelines)
 
    diag_count = await db["phase1_diagnosis_skills"].count_documents({"doctor_id": doctor_id})
    treat_count = await db["phase1_treatment_skills"].count_documents({"doctor_id": doctor_id})
 
    biomarker_names = await db["phase1_graph_nodes"].distinct(
        "name", {"doctor_id": doctor_id, "type": "biomarker"}
    )
    drug_names = await db["phase1_graph_nodes"].distinct(
        "name", {"doctor_id": doctor_id, "type": "drug"}
    )
 
    node_count = await db["phase1_graph_nodes"].count_documents({"doctor_id": doctor_id})
    edge_count = await db["phase1_graph_edges"].count_documents({"doctor_id": doctor_id})
    relationship_count = await db["phase1_clinical_relationships"].count_documents(
        {"doctor_id": doctor_id}
    )
 
    return {
        "doctor_id": doctor_id,
        "documents": documents_count,
        "diseases": len(disease_set),
        "subtypes": len(subtype_set),
        "biomarkers": len(biomarker_names),
        "drugs": len(drug_names),
        "relationships": relationship_count,
        "skills": diag_count + treat_count,
        "diagnosis_skills": diag_count,
        "treatment_skills": treat_count,
        "knowledge_graph_nodes": node_count,
        "knowledge_graph_edges": edge_count,
    }
 
 
# ─────────────────────────────────────────────────────────────────
# VIEW 2 — Disease Explorer (left panel listing diseases)
# ─────────────────────────────────────────────────────────────────
 
@router.get("/doctor/{doctor_id}/knowledge-dashboard/diseases")
async def list_dashboard_diseases(doctor_id: str):
    db = _get_db()
 
    guidelines = await db["phase1_guideline_versions"].find(
        {"doctor_id": doctor_id},
        {"_id": 0, "doc_id": 1, "diseases": 1, "disease_type": 1, "subtypes": 1},
    ).to_list(length=None)
 
    # name -> {"subtypes": set, "doc_ids": set}
    disease_map: dict[str, dict] = {}
    for g in guidelines:
        names = set(g.get("diseases") or [])
        if g.get("disease_type"):
            names.add(g["disease_type"])
        for name in names:
            if not name or name == "Unknown":
                continue
            entry = disease_map.setdefault(name, {"subtypes": set(), "doc_ids": set()})
            if g.get("doc_id"):
                entry["doc_ids"].add(g["doc_id"])
            for s in (g.get("subtypes") or []):
                sname = _subtype_name(s)
                if sname:
                    entry["subtypes"].add(sname)
 
    results = []
    for name, entry in disease_map.items():
        diag_n = await db["phase1_diagnosis_skills"].count_documents(
            {"doctor_id": doctor_id, "disease_type": name}
        )
        treat_n = await db["phase1_treatment_skills"].count_documents(
            {"doctor_id": doctor_id, "disease_type": name}
        )
        results.append({
            "disease": name,
            "subtype_count": len(entry["subtypes"]),
            "subtypes": sorted(entry["subtypes"])[:20],
            "document_count": len(entry["doc_ids"]),
            "skill_count": diag_n + treat_n,
        })
 
    results.sort(key=lambda x: x["skill_count"], reverse=True)
    return {"doctor_id": doctor_id, "diseases": results, "total": len(results)}
 
 
# ─────────────────────────────────────────────────────────────────
# VIEW 3 — Disease-specific Knowledge Graph (filtered graph)
# ─────────────────────────────────────────────────────────────────
 
@router.get("/doctor/{doctor_id}/knowledge-dashboard/diseases/{disease_name}/graph")
async def get_disease_graph(doctor_id: str, disease_name: str, max_hops: int = 2):
    db = _get_db()
 
    disease_node = await db["phase1_graph_nodes"].find_one(
        {"doctor_id": doctor_id, "type": "disease", "name": disease_name}, {"_id": 0}
    )
    if not disease_node:
        disease_node = await db["phase1_graph_nodes"].find_one(
            {
                "doctor_id": doctor_id,
                "type": "disease",
                "name": {"$regex": f"^{re.escape(disease_name)}$", "$options": "i"},
            },
            {"_id": 0},
        )
    if not disease_node:
        raise HTTPException(404, f"No graph node found for disease '{disease_name}'")
 
    start_index = disease_node["index"]
 
    all_edges = await db["phase1_graph_edges"].find(
        {"doctor_id": doctor_id}, {"_id": 0}
    ).to_list(length=None)
 
    adjacency: dict[str, list[dict]] = {}
    for e in all_edges:
        adjacency.setdefault(e["from"], []).append(e)
        adjacency.setdefault(e["to"], []).append(e)
 
    visited = {start_index}
    frontier = [start_index]
    collected_edges: list[dict] = []
 
    for _ in range(max(1, max_hops)):
        next_frontier = []
        for idx in frontier:
            for e in adjacency.get(idx, []):
                collected_edges.append(e)
                other = e["to"] if e["from"] == idx else e["from"]
                if other not in visited:
                    visited.add(other)
                    next_frontier.append(other)
        frontier = next_frontier
        if not frontier:
            break
 
    nodes = await db["phase1_graph_nodes"].find(
        {"doctor_id": doctor_id, "index": {"$in": list(visited)}}, {"_id": 0}
    ).to_list(length=None)
 
    seen_edge_keys = set()
    unique_edges = []
    for e in collected_edges:
        key = (e["from"], e["to"], e["relationship"])
        if key not in seen_edge_keys:
            seen_edge_keys.add(key)
            unique_edges.append(e)
 
    return {
        "disease": disease_name,
        "center_index": start_index,
        "nodes": nodes,
        "edges": unique_edges,
        "node_count": len(nodes),
        "edge_count": len(unique_edges),
        "node_types": sorted({n.get("type") for n in nodes if n.get("type")}),
    }
 
 
# ─────────────────────────────────────────────────────────────────
# VIEW 4 — Cross-document Skill Explorer
# ─────────────────────────────────────────────────────────────────
 
@router.get("/doctor/{doctor_id}/knowledge-dashboard/diseases/{disease_name}/skills")
async def get_disease_skills(doctor_id: str, disease_name: str):
    db = _get_db()
    projection = {"_id": 0, "embedding": 0, "embedding_model": 0, "body": 0}
 
    diag = await db["phase1_diagnosis_skills"].find(
        {"doctor_id": doctor_id, "disease_type": disease_name}, projection
    ).to_list(length=None)
    treat = await db["phase1_treatment_skills"].find(
        {"doctor_id": doctor_id, "disease_type": disease_name}, projection
    ).to_list(length=None)
 
    by_subtype: dict[str, dict] = {}
    for s in diag + treat:
        st = s.get("subtype") or "General"
        bucket = by_subtype.setdefault(st, {"diagnosis": [], "treatment": []})
        bucket[s["skill_type"]].append(s)
 
    # sort subtypes so "General" (disease-level) comes first
    ordered_subtypes = sorted(by_subtype.keys(), key=lambda k: (k != "General", k))
 
    return {
        "disease": disease_name,
        "total_skills": len(diag) + len(treat),
        "diagnosis_count": len(diag),
        "treatment_count": len(treat),
        "subtype_order": ordered_subtypes,
        "by_subtype": by_subtype,
    }
 
 
# ─────────────────────────────────────────────────────────────────
# VIEW 5 — Document Contribution
# ─────────────────────────────────────────────────────────────────
 
@router.get("/doctor/{doctor_id}/knowledge-dashboard/diseases/{disease_name}/documents")
async def get_disease_documents(doctor_id: str, disease_name: str):
    db = _get_db()
 
    guidelines = await db["phase1_guideline_versions"].find(
        {
            "doctor_id": doctor_id,
            "$or": [{"diseases": disease_name}, {"disease_type": disease_name}],
        },
        {"_id": 0, "doc_id": 1, "guideline_name": 1, "guideline_version": 1, "created_at": 1},
    ).to_list(length=None)
 
    contributions = []
    total = 0
    for g in guidelines:
        n_diag = await db["phase1_diagnosis_skills"].count_documents(
            {"doctor_id": doctor_id, "doc_id": g["doc_id"], "disease_type": disease_name}
        )
        n_treat = await db["phase1_treatment_skills"].count_documents(
            {"doctor_id": doctor_id, "doc_id": g["doc_id"], "disease_type": disease_name}
        )
        n = n_diag + n_treat
        total += n
        contributions.append({**g, "skill_count": n})
 
    for c in contributions:
        c["contribution_pct"] = round((c["skill_count"] / total) * 100, 1) if total else 0.0
 
    contributions.sort(key=lambda x: x["skill_count"], reverse=True)
 
    return {"disease": disease_name, "documents": contributions, "total_skills": total}
 