"""
phase3_routers.py
===========
FastAPI router — all Phase-3 governance endpoints under a single router.

PREFIX: /governance  (mount at /api/hms/users/ai-legacy)

Skills:
  GET    /governance/skills                                      Search / list skills
  GET    /governance/skills/{skill_id}                           Full skill (with body)
  PUT    /governance/skills/{skill_id}                           Edit skill body (creates new version)
  POST   /governance/skills/{skill_id}/transition                Lifecycle transition
  GET    /governance/skills/{skill_id}/versions                  Version history
  GET    /governance/skills/{skill_id}/versions/compare/{a}/{b}  Side-by-side diff
  GET    /governance/skills/{skill_id}/versions/{v}              Specific version detail
  POST   /governance/skills/{skill_id}/rollback                  Rollback to a past version
  GET    /governance/skills/{skill_id}/audit                     Audit log for one skill
  GET    /governance/skills/{skill_id}/lifecycle                 Full lifecycle timeline
  POST   /governance/skills/import/phase1                        Import Phase-1 skills (backfill)

Guidelines:
  POST   /governance/guidelines/register                         Register guideline family
  GET    /governance/guidelines                                  List all guideline families
  POST   /governance/guidelines/detect                           Detect if guideline already exists
  POST   /governance/guidelines/link-version                     Link doc_id to a guideline version
  POST   /governance/guidelines/compare                          Run comparison between two versions
  POST   /governance/guidelines/upload-workflow                  One-shot upload orchestrator
  GET    /governance/guidelines/recommendations                  List recommendations
  POST   /governance/guidelines/recommendations/review           Review single recommendation
  POST   /governance/guidelines/recommendations/bulk-review      Bulk review
  GET    /governance/guidelines/comparisons/{id}                 Get comparison result
  POST   /governance/guidelines/comparisons/{id}/impact          Run impact analysis
  GET    /governance/guidelines/comparisons/{id}/impact          Get impact report
  POST   /governance/guidelines/comparisons/{id}/recommend       Generate AI recommendations
  POST   /governance/guidelines/comparisons/{id}/apply           Apply accepted recommendations
  GET    /governance/guidelines/{guideline_id}                   Get one guideline
  GET    /governance/guidelines/{guideline_id}/versions          List all versions
  GET    /governance/guidelines/{guideline_id}/comparisons       List comparisons for a guideline

Dashboard & Audit:
  GET    /governance/dashboard                                   Governance dashboard stats
  GET    /governance/audit                                       Doctor-level full audit log
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel

from Agentic.phase3_models import (
    # Skill models
    SkillUpdateRequest, SkillSearchQuery, StatusTransitionRequest,
    RollbackRequest, SkillType, SkillStatus,
    # Guideline models
    GuidelineRegisterRequest, GuidelineVersionLinkRequest,
    CompareGuidelinesRequest, RecommendationReviewRequest,
    BulkRecommendationReview, GuidelineUploadWorkflowRequest,
)
from Agentic.phase3_services import (
    # DB helpers
    get_client, get_db, ensure_indexes,
    # Skill service
    search_skills, get_skill, update_skill, transition_skill_status,
    get_version_history, get_version_detail, compare_versions,
    rollback_skill, get_audit_log, import_phase1_skills,
    # Guideline service
    register_guideline, list_guidelines, get_guideline,
    link_version_to_guideline, get_guideline_versions,
    compare_guideline_versions, get_comparison, list_comparisons,
    run_impact_analysis, get_impact_report,
    generate_recommendations_for_comparison,
    list_recommendations, review_recommendation,
    bulk_review_recommendations, apply_accepted_recommendations,
    detect_existing_guideline,
    # Workflow + governance
    run_guideline_upload_workflow,
    get_lifecycle_summary,
    get_governance_dashboard,
    get_doctor_audit_log,
    # Collection constants
    COLL_DIAG_SKILLS, COLL_TREAT_SKILLS,
)


# ═══════════════════════════════════════════════════════════════
# SINGLE ROUTER — all endpoints under /governance
# ═══════════════════════════════════════════════════════════════

router = APIRouter(prefix="/governance", tags=["Governance"])


# ── DB dependency ──────────────────────────────────────────────

async def _db() -> AsyncIOMotorDatabase:
    client = get_client()
    db     = get_db(client)
    await ensure_indexes(db)
    return db


# ── Local request models ───────────────────────────────────────

class Phase1ImportRequest(BaseModel):
    doc_id:              str
    guideline_name:      str = ""
    guideline_version:   str = ""
    pipeline_version:    str = ""
    source_guideline_id: str = ""


class DetectRequest(BaseModel):
    title:        str
    disease_type: str = ""
    organization: str = ""


# ═══════════════════════════════════════════════════════════════
# DASHBOARD & AUDIT
# ═══════════════════════════════════════════════════════════════

@router.get("/dashboard")
async def dashboard_endpoint(
    doctor_id: str = Query(...),
    db: AsyncIOMotorDatabase = Depends(_db),
):
    """Governance dashboard — skill counts, pending reviews, 30-day activity."""
    return await get_governance_dashboard(db, doctor_id)


@router.get("/audit")
async def doctor_audit_endpoint(
    doctor_id: str           = Query(...),
    actions:   Optional[str] = Query(None),   # comma-separated action names
    limit:     int           = Query(100, ge=1, le=500),
    skip:      int           = Query(0, ge=0),
    db: AsyncIOMotorDatabase = Depends(_db),
):
    """Full audit log for a doctor — covers skills, guidelines, comparisons."""
    action_list = [a.strip() for a in actions.split(",")] if actions else None
    return await get_doctor_audit_log(db, doctor_id, action_list, limit, skip)


# ═══════════════════════════════════════════════════════════════
# SKILLS
# ═══════════════════════════════════════════════════════════════

# ── Import from Phase-1  (must be before /{skill_id} to avoid path conflict) ──

@router.post("/skills/import/phase1")
async def import_phase1_endpoint(
    request:   Phase1ImportRequest,
    doctor_id: str = Query(...),
    db: AsyncIOMotorDatabase = Depends(_db),
):
    """
    Backfill governance metadata onto skills already extracted by Phase-1.
    Call once per doc_id after the pipeline completes.
    """
    diag_skills = await db[COLL_DIAG_SKILLS].find(
        {"doc_id": request.doc_id, "doctor_id": doctor_id}, {"_id": 0}
    ).to_list(length=500)
    treat_skills = await db[COLL_TREAT_SKILLS].find(
        {"doc_id": request.doc_id, "doctor_id": doctor_id}, {"_id": 0}
    ).to_list(length=500)
    all_skills = diag_skills + treat_skills

    if not all_skills:
        raise HTTPException(404, f"No skills found for doc_id={request.doc_id}")

    return await import_phase1_skills(
        db                  = db,
        doctor_id           = doctor_id,
        doc_id              = request.doc_id,
        skills              = all_skills,
        guideline_name      = request.guideline_name,
        guideline_version   = request.guideline_version,
        pipeline_version    = request.pipeline_version,
        source_guideline_id = request.source_guideline_id,
    )


# ── Search & list ──────────────────────────────────────────────

@router.get("/skills")
async def search_skills_endpoint(
    doctor_id:    str           = Query(...),
    skill_type:   Optional[str] = Query(None),
    disease_type: Optional[str] = Query(None),
    subtype:      Optional[str] = Query(None),
    status:       Optional[str] = Query(None),
    keyword:      Optional[str] = Query(None),
    guideline:    Optional[str] = Query(None),
    page:         int           = Query(1, ge=1),
    page_size:    int           = Query(20, ge=1, le=100),
    db: AsyncIOMotorDatabase = Depends(_db),
):
    """Search and filter skills with pagination."""
    query = SkillSearchQuery(
        doctor_id    = doctor_id,
        skill_type   = SkillType(skill_type) if skill_type else None,
        disease_type = disease_type,
        subtype      = subtype,
        status       = SkillStatus(status) if status else None,
        keyword      = keyword,
        guideline    = guideline,
        page         = page,
        page_size    = page_size,
    )
    return await search_skills(db, query)


# ── Version compare  (must be before /{skill_id}/versions/{version_number}) ──

@router.get("/skills/{skill_id}/versions/compare/{version_a}/{version_b}")
async def compare_versions_endpoint(
    skill_id:  str,
    version_a: int,
    version_b: int,
    doctor_id: str = Query(...),
    db: AsyncIOMotorDatabase = Depends(_db),
):
    """Side-by-side diff between two version snapshots."""
    try:
        return await compare_versions(db, skill_id, version_a, version_b, doctor_id)
    except ValueError as e:
        raise HTTPException(404, str(e))


# ── Version history ────────────────────────────────────────────

@router.get("/skills/{skill_id}/versions")
async def get_versions_endpoint(
    skill_id:  str,
    doctor_id: str = Query(...),
    db: AsyncIOMotorDatabase = Depends(_db),
):
    """Return all version snapshots for a skill (newest first, body excluded)."""
    try:
        versions = await get_version_history(db, skill_id, doctor_id)
        return {"skill_id": skill_id, "versions": versions, "count": len(versions)}
    except ValueError as e:
        raise HTTPException(404, str(e))


# ── Specific version detail ────────────────────────────────────

@router.get("/skills/{skill_id}/versions/{version_number}")
async def get_version_detail_endpoint(
    skill_id:       str,
    version_number: int,
    doctor_id:      str = Query(...),
    db: AsyncIOMotorDatabase = Depends(_db),
):
    """Return full body of a specific version snapshot."""
    try:
        version = await get_version_detail(db, skill_id, version_number, doctor_id)
        if not version:
            raise HTTPException(404, f"Version {version_number} not found")
        return version
    except ValueError as e:
        raise HTTPException(404, str(e))


# ── Audit log ─────────────────────────────────────────────────

@router.get("/skills/{skill_id}/audit")
async def get_audit_endpoint(
    skill_id:  str,
    doctor_id: str = Query(...),
    limit:     int = Query(50, ge=1, le=200),
    db: AsyncIOMotorDatabase = Depends(_db),
):
    """Full audit trail for a single skill."""
    try:
        entries = await get_audit_log(db, skill_id, doctor_id, limit)
        return {"skill_id": skill_id, "entries": entries, "total": len(entries)}
    except ValueError as e:
        raise HTTPException(404, str(e))


# ── Lifecycle timeline ─────────────────────────────────────────

@router.get("/skills/{skill_id}/lifecycle")
async def get_lifecycle_endpoint(
    skill_id:  str,
    doctor_id: str = Query(...),
    db: AsyncIOMotorDatabase = Depends(_db),
):
    """Full lifecycle timeline combining audit log + version history."""
    skill = await get_skill(db, skill_id, doctor_id, include_body=False)
    if not skill:
        raise HTTPException(404, f"Skill not found: {skill_id}")
    return await get_lifecycle_summary(db, doctor_id, skill_id)


# ── Lifecycle transition ───────────────────────────────────────

@router.post("/skills/{skill_id}/transition")
async def transition_status_endpoint(
    skill_id:  str,
    request:   StatusTransitionRequest,
    doctor_id: str = Query(...),
    db: AsyncIOMotorDatabase = Depends(_db),
):
    """
    Lifecycle state transition.
    draft → submitted_for_review | archived
    under_review → approved | rejected
    approved → published | archived
    published → archived | deprecated
    archived → restored
    """
    try:
        return await transition_skill_status(db, skill_id, doctor_id, request)
    except ValueError as e:
        raise HTTPException(400, str(e))


# ── Rollback ───────────────────────────────────────────────────

@router.post("/skills/{skill_id}/rollback")
async def rollback_endpoint(
    skill_id:  str,
    request:   RollbackRequest,
    doctor_id: str = Query(...),
    db: AsyncIOMotorDatabase = Depends(_db),
):
    """Rollback to a historical version. Creates a new snapshot and resets to draft."""
    try:
        return await rollback_skill(db, skill_id, doctor_id, request)
    except ValueError as e:
        raise HTTPException(400, str(e))


# ── Get one skill ──────────────────────────────────────────────

@router.get("/skills/{skill_id}")
async def get_skill_endpoint(
    skill_id:  str,
    doctor_id: str = Query(...),
    db: AsyncIOMotorDatabase = Depends(_db),
):
    """Get full skill document including body."""
    skill = await get_skill(db, skill_id, doctor_id)
    if not skill:
        raise HTTPException(404, f"Skill not found: {skill_id}")
    return skill


# ── Edit skill ─────────────────────────────────────────────────

@router.put("/skills/{skill_id}")
async def update_skill_endpoint(
    skill_id:  str,
    request:   SkillUpdateRequest,
    doctor_id: str = Query(...),
    db: AsyncIOMotorDatabase = Depends(_db),
):
    """
    Edit a skill body. Always snapshots the current version first.
    Any edit resets status to draft.
    body, change_summary (min 5 chars), and change_type are required.
    """
    try:
        updated = await update_skill(db, skill_id, doctor_id, request)
        return {"success": True, "skill": updated}
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, f"Update failed: {e}")


# ═══════════════════════════════════════════════════════════════
# GUIDELINES
# ═══════════════════════════════════════════════════════════════

# ── Static sub-paths first (before /{guideline_id}) ───────────

@router.post("/guidelines/register")
async def register_endpoint(
    request:   GuidelineRegisterRequest,
    doctor_id: str = Query(...),
    db: AsyncIOMotorDatabase = Depends(_db),
):
    """Register a new guideline family (e.g. 'NCCN Breast Cancer 2024')."""
    return await register_guideline(db, doctor_id, request)


@router.get("/guidelines")
async def list_guidelines_endpoint(
    doctor_id: str = Query(...),
    db: AsyncIOMotorDatabase = Depends(_db),
):
    """List all registered guideline families for a doctor."""
    docs = await list_guidelines(db, doctor_id)
    return {"guidelines": docs, "total": len(docs)}


@router.post("/guidelines/detect")
async def detect_guideline_endpoint(
    request:   DetectRequest,
    doctor_id: str = Query(...),
    db: AsyncIOMotorDatabase = Depends(_db),
):
    """Check whether a guideline already exists before uploading a new version."""
    match = await detect_existing_guideline(
        db, doctor_id, request.title, request.disease_type, request.organization
    )
    return {"found": match is not None, "guideline": match}


@router.post("/guidelines/link-version")
async def link_version_endpoint(
    request:   GuidelineVersionLinkRequest,
    doctor_id: str = Query(...),
    db: AsyncIOMotorDatabase = Depends(_db),
):
    """Link a Phase-1 processed doc_id to a guideline version record."""
    try:
        return await link_version_to_guideline(db, doctor_id, request)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/guidelines/compare")
async def compare_endpoint(
    request:   CompareGuidelinesRequest,
    doctor_id: str = Query(...),
    db: AsyncIOMotorDatabase = Depends(_db),
):
    """
    Structured comparison between two guideline versions.
    Both doc_ids must be linked first via /guidelines/link-version.
    Returns cached result if the same pair was already compared.
    """
    try:
        return await compare_guideline_versions(db, doctor_id, request)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/guidelines/upload-workflow")
async def upload_workflow_endpoint(
    request:   GuidelineUploadWorkflowRequest,
    doctor_id: str = Query(...),
    db: AsyncIOMotorDatabase = Depends(_db),
):
    """
    One-shot upload orchestrator:
    detect → register/link → compare → impact → recommend → (optional) auto-draft.
    Set auto_draft=true only when immediate draft generation is wanted.
    """
    return await run_guideline_upload_workflow(db, doctor_id, request)


# ── Recommendations (before /{guideline_id} to avoid conflict) ────────────────

@router.get("/guidelines/recommendations")
async def list_recommendations_endpoint(
    doctor_id:     str           = Query(...),
    comparison_id: Optional[str] = Query(None),
    skill_id:      Optional[str] = Query(None),
    status:        Optional[str] = Query(None),
    db: AsyncIOMotorDatabase = Depends(_db),
):
    """List AI update recommendations, optionally filtered by comparison, skill, or status."""
    docs = await list_recommendations(db, doctor_id, comparison_id, skill_id, status)
    return {"recommendations": docs, "total": len(docs)}


@router.post("/guidelines/recommendations/review")
async def review_recommendation_endpoint(
    request:   RecommendationReviewRequest,
    doctor_id: str = Query(...),
    db: AsyncIOMotorDatabase = Depends(_db),
):
    """
    Review a single AI recommendation.
    action: accepted | rejected | modified
    Provide final_value when action=modified.
    """
    try:
        return await review_recommendation(db, doctor_id, request)
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.post("/guidelines/recommendations/bulk-review")
async def bulk_review_endpoint(
    request:   BulkRecommendationReview,
    doctor_id: str = Query(...),
    db: AsyncIOMotorDatabase = Depends(_db),
):
    """Bulk accept / reject / modify multiple recommendations in one call."""
    return await bulk_review_recommendations(db, doctor_id, request)


# ── Comparisons (before /{guideline_id} to avoid conflict) ───────────────────

@router.get("/guidelines/comparisons/{comparison_id}")
async def get_comparison_endpoint(
    comparison_id: str,
    doctor_id:     str = Query(...),
    db: AsyncIOMotorDatabase = Depends(_db),
):
    """Get the full comparison result including all change items."""
    doc = await get_comparison(db, comparison_id, doctor_id)
    if not doc:
        raise HTTPException(404, f"Comparison not found: {comparison_id}")
    return doc


@router.post("/guidelines/comparisons/{comparison_id}/impact")
async def run_impact_endpoint(
    comparison_id: str,
    doctor_id:     str = Query(...),
    db: AsyncIOMotorDatabase = Depends(_db),
):
    """Run impact analysis — identifies which skills need updating and why."""
    try:
        return await run_impact_analysis(db, comparison_id, doctor_id)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/guidelines/comparisons/{comparison_id}/impact")
async def get_impact_endpoint(
    comparison_id: str,
    doctor_id:     str = Query(...),
    db: AsyncIOMotorDatabase = Depends(_db),
):
    """Retrieve a previously computed impact analysis report."""
    report = await get_impact_report(db, comparison_id, doctor_id)
    if not report:
        raise HTTPException(404, f"Impact report not found for comparison {comparison_id}")
    return report


@router.post("/guidelines/comparisons/{comparison_id}/recommend")
async def generate_recommendations_endpoint(
    comparison_id: str,
    doctor_id:     str = Query(...),
    db: AsyncIOMotorDatabase = Depends(_db),
):
    """
    Generate AI-powered skill update recommendations from guideline changes.
    Impact analysis must be run first.
    """
    try:
        return await generate_recommendations_for_comparison(db, comparison_id, doctor_id)
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/guidelines/comparisons/{comparison_id}/apply")
async def apply_recommendations_endpoint(
    comparison_id: str,
    doctor_id:     str = Query(...),
    db: AsyncIOMotorDatabase = Depends(_db),
):
    """
    Apply all accepted recommendations to their skills.
    Creates new skill versions; skills move back to draft.
    """
    try:
        return await apply_accepted_recommendations(
            db               = db,
            comparison_id    = comparison_id,
            doctor_id        = doctor_id,
            skill_service_fn = update_skill,
        )
    except Exception as e:
        raise HTTPException(500, f"Apply failed: {e}")


# ── Guideline detail + sub-resources  (parameterised — must be last) ────────

@router.get("/guidelines/{guideline_id}")
async def get_guideline_endpoint(
    guideline_id: str,
    doctor_id:    str = Query(...),
    db: AsyncIOMotorDatabase = Depends(_db),
):
    """Get a single guideline family record."""
    doc = await get_guideline(db, guideline_id, doctor_id)
    if not doc:
        raise HTTPException(404, f"Guideline not found: {guideline_id}")
    return doc


@router.get("/guidelines/{guideline_id}/versions")
async def guideline_versions_endpoint(
    guideline_id: str,
    doctor_id:    str = Query(...),
    db: AsyncIOMotorDatabase = Depends(_db),
):
    """List all linked versions for a guideline family."""
    versions = await get_guideline_versions(db, guideline_id, doctor_id)
    return {"guideline_id": guideline_id, "versions": versions}


@router.get("/guidelines/{guideline_id}/comparisons")
async def list_comparisons_endpoint(
    guideline_id: str,
    doctor_id:    str = Query(...),
    db: AsyncIOMotorDatabase = Depends(_db),
):
    """List all comparisons for a guideline (change list excluded for performance)."""
    docs = await list_comparisons(db, guideline_id, doctor_id)
    return {"guideline_id": guideline_id, "comparisons": docs}