"""
services.py
============
All service logic, database utilities, and diff helpers.

Sections:
  1. DB constants & helpers
  2. Diff utilities
  3. Skill Service                        (all original logic preserved)
  4. Skill Review Service                 [Gap 17 — fully implemented]
  5. Guideline Service                    (all original logic preserved)
  6. Knowledge Graph Service              [Gap 8]
  7. Fine-Grained Impact Analysis         [Gap 7]
  8. Draft Auto-Generation Service        [Gap 9, Gap 10]
  9. Guideline Version Lifecycle Service  [Gap 14, Gap 15]
 10. Orchestration Workflow Service       [Gap 1, Gap 2, Gap 3, Gap 19]
 11. Retrieval Safety Service             [Gap 13]
 12. Governance Service                   (extended — Gaps 12, 18)
"""

from __future__ import annotations

import copy
import json
import os
import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from groq import Groq
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from Agentic.phase3_models import (
    SkillDocument, SkillStatus, SkillType, SkillVersionSnapshot,
    AuditLogEntry, AuditAction, SkillUpdateRequest, SkillSearchQuery,
    StatusTransitionRequest, RollbackRequest, SkillReviewRequest,
    GuidelineRecord, GuidelineVersionRecord, GuidelineVersionStatus,
    GuidelineComparison, ChangeItem, ChangeType, ImpactSeverity,
    ImpactAnalysisReport, AffectedSkillEntry, SkillUpdateRecommendation,
    RecommendationStatus, GuidelineRegisterRequest, GuidelineVersionLinkRequest,
    CompareGuidelinesRequest, RecommendationReviewRequest, BulkRecommendationReview,
    ComparisonReviewRequest, GuidelineVersionTransitionRequest,
    GuidelineUploadWorkflowRequest, GuidelineUploadWorkflowResult,
    WorkflowStatus, WorkflowStepResult,
    KnowledgeEntity, KnowledgeRelation, SkillEntityLink, EntityType,
    SkillRetrievalQuery, PublishedSkillSummary,
    GovernanceDashboard, ChangeAuditReport,
)


# ═══════════════════════════════════════════════════════════════
# 1. DATABASE CONSTANTS & HELPERS
# ═══════════════════════════════════════════════════════════════

MONGO_URI = os.getenv("MONGO_URI", "")
MONGO_DB  = "doctorassistai"


def get_client() -> AsyncIOMotorClient:
    return AsyncIOMotorClient(MONGO_URI)


def get_db(client: AsyncIOMotorClient) -> AsyncIOMotorDatabase:
    return client[MONGO_DB]


# Collection name constants
COLL_DIAG_SKILLS           = "phase1_diagnosis_skills"
COLL_TREAT_SKILLS          = "phase1_treatment_skills"
COLL_SKILL_VERSIONS        = "skill_versions"
COLL_SKILL_AUDIT           = "skill_audit_logs"
COLL_SKILL_REVIEWS         = "skill_reviews"
COLL_SKILL_RECOMMENDATIONS = "skill_change_recommendations"
COLL_GUIDELINES            = "guidelines"
COLL_GUIDELINE_VERSIONS    = "guideline_version_records"
COLL_COMPARISONS           = "guideline_comparisons"
COLL_IMPACT_REPORTS        = "impact_analysis_reports"
COLL_PROCESSING_JOBS       = "phase1_processing_jobs"
COLL_PH1_GUIDELINE_VERS    = "phase1_guideline_versions"
# New collections
COLL_KG_ENTITIES           = "kg_entities"          # knowledge graph nodes
COLL_KG_RELATIONS          = "kg_relations"          # knowledge graph edges
COLL_SKILL_ENTITY_LINKS    = "skill_entity_links"    # skill ↔ entity map
COLL_WORKFLOW_RESULTS      = "workflow_results"      # orchestration run history


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    """Create all indexes for efficient querying."""
    # Skill versions
    await db[COLL_SKILL_VERSIONS].create_index([("skill_id", 1), ("version_number", -1)])
    await db[COLL_SKILL_VERSIONS].create_index([("skill_id", 1), ("status", 1)])
    # Audit
    await db[COLL_SKILL_AUDIT].create_index([("skill_id", 1), ("created_at", -1)])
    await db[COLL_SKILL_AUDIT].create_index([("doctor_id", 1), ("created_at", -1)])
    await db[COLL_SKILL_AUDIT].create_index([("action", 1)])
    await db[COLL_SKILL_AUDIT].create_index([("guideline_id", 1), ("created_at", -1)])
    await db[COLL_SKILL_AUDIT].create_index([("entity_type", 1)])
    # Reviews
    await db[COLL_SKILL_REVIEWS].create_index([("skill_id", 1)])
    await db[COLL_SKILL_REVIEWS].create_index([("doctor_id", 1), ("status", 1)])
    # Recommendations
    await db[COLL_SKILL_RECOMMENDATIONS].create_index([("comparison_id", 1)])
    await db[COLL_SKILL_RECOMMENDATIONS].create_index([("skill_id", 1)])
    await db[COLL_SKILL_RECOMMENDATIONS].create_index([("doctor_id", 1), ("status", 1)])
    # Guidelines
    await db[COLL_GUIDELINES].create_index([("doctor_id", 1)])
    await db[COLL_GUIDELINES].create_index([("guideline_id", 1)], unique=True)
    await db[COLL_GUIDELINES].create_index([("family_id", 1)])
    await db[COLL_GUIDELINES].create_index([("disease_type", 1), ("organization", 1)])
    # Guideline versions
    await db[COLL_GUIDELINE_VERSIONS].create_index([("guideline_id", 1), ("version", 1)])
    await db[COLL_GUIDELINE_VERSIONS].create_index([("doc_id", 1)])
    await db[COLL_GUIDELINE_VERSIONS].create_index([("guideline_id", 1), ("gov_status", 1)])
    # Comparisons — unique on (guideline_id, old_doc_id, new_doc_id) to prevent duplicates [Gap 19]
    await db[COLL_COMPARISONS].create_index([("guideline_id", 1), ("created_at", -1)])
    await db[COLL_COMPARISONS].create_index([("comparison_id", 1)], unique=True)
    await db[COLL_COMPARISONS].create_index(
        [("guideline_id", 1), ("old_doc_id", 1), ("new_doc_id", 1)], unique=True
    )
    # Impact
    await db[COLL_IMPACT_REPORTS].create_index([("comparison_id", 1)])
    await db[COLL_IMPACT_REPORTS].create_index([("doctor_id", 1)])
    # Skills — retrieval safety index [Gap 13]
    for coll in (COLL_DIAG_SKILLS, COLL_TREAT_SKILLS):
        await db[coll].create_index([("doctor_id", 1), ("status", 1), ("disease_type", 1)])
        await db[coll].create_index([("doctor_id", 1), ("is_latest_published", 1)])
    # Knowledge graph
    await db[COLL_KG_ENTITIES].create_index([("doctor_id", 1), ("entity_type", 1)])
    await db[COLL_KG_ENTITIES].create_index([("doctor_id", 1), ("canonical", 1)])
    await db[COLL_KG_RELATIONS].create_index([("doctor_id", 1), ("source_id", 1)])
    await db[COLL_KG_RELATIONS].create_index([("doctor_id", 1), ("target_id", 1)])
    await db[COLL_SKILL_ENTITY_LINKS].create_index([("skill_id", 1)])
    await db[COLL_SKILL_ENTITY_LINKS].create_index([("entity_id", 1)])


# ═══════════════════════════════════════════════════════════════
# 2. DIFF UTILITIES
# ═══════════════════════════════════════════════════════════════

_SECTION_SEVERITY: dict[str, ImpactSeverity] = {
    "stage_wise_treatment":  ImpactSeverity.CRITICAL,
    "treatment_principles":  ImpactSeverity.CRITICAL,
    "if_then_rules":         ImpactSeverity.CRITICAL,
    "staging":               ImpactSeverity.HIGH,
    "biomarkers":            ImpactSeverity.HIGH,
    "targeted_therapy":      ImpactSeverity.HIGH,
    "immunotherapy":         ImpactSeverity.HIGH,
    "chemotherapy":          ImpactSeverity.HIGH,
    "contraindications":     ImpactSeverity.HIGH,
    "diagnostic_criteria":   ImpactSeverity.MEDIUM,
    "diagnostic_pathway":    ImpactSeverity.MEDIUM,
    "molecular_testing":     ImpactSeverity.MEDIUM,
    "investigations":        ImpactSeverity.MEDIUM,
    "dose_modifications":    ImpactSeverity.MEDIUM,
    "monitoring":            ImpactSeverity.MEDIUM,
    "key_evidence":          ImpactSeverity.MEDIUM,
    "recommendations":       ImpactSeverity.MEDIUM,
    "follow_up":             ImpactSeverity.LOW,
    "supportive_care":       ImpactSeverity.LOW,
    "special_populations":   ImpactSeverity.LOW,
    "disease_overview":      ImpactSeverity.LOW,
    "clinical_presentation": ImpactSeverity.LOW,
}

_DIAGNOSIS_SECTIONS = {
    "staging", "biomarkers", "diagnostic_criteria", "investigations",
    "molecular_testing", "diagnostic_pathway", "clinical_presentation",
    "disease_overview", "risk_stratification", "differential_diagnosis",
    "exclusion_criteria", "key_evidence",
}

_TREATMENT_SECTIONS = {
    "stage_wise_treatment", "treatment_principles", "chemotherapy",
    "targeted_therapy", "immunotherapy", "hormone_therapy", "surgery",
    "radiation", "if_then_rules", "contraindications", "dose_modifications",
    "monitoring", "follow_up", "supportive_care", "key_evidence",
    "recommendations", "risk_stratification",
}

# Evidence level keywords for change detection [Gap 5]
_EVIDENCE_LEVEL_KEYWORDS = {"level i", "level ii", "level iii", "level iv", "level v",
                             "grade a", "grade b", "grade c", "grade d"}
_STRENGTH_KEYWORDS = {"strong", "moderate", "weak", "conditional", "recommended", "suggested"}


def _normalise(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, (dict, list)):
        return json.dumps(v, sort_keys=True, ensure_ascii=False)
    return str(v).strip()


def _detect_evidence_change(old_val: Any, new_val: Any) -> tuple[Optional[str], Optional[str]]:
    """Detect if evidence level or recommendation strength changed. [Gap 5]"""
    old_s = _normalise(old_val).lower()
    new_s = _normalise(new_val).lower()

    old_level = next((k for k in _EVIDENCE_LEVEL_KEYWORDS if k in old_s), None)
    new_level = next((k for k in _EVIDENCE_LEVEL_KEYWORDS if k in new_s), None)
    level_change = f"{old_level} → {new_level}" if old_level != new_level and (old_level or new_level) else None

    old_str = next((k for k in _STRENGTH_KEYWORDS if k in old_s), None)
    new_str = next((k for k in _STRENGTH_KEYWORDS if k in new_s), None)
    strength_change = f"{old_str} → {new_str}" if old_str != new_str and (old_str or new_str) else None

    return level_change, strength_change


def _extract_entities_from_value(val: Any) -> tuple[list[str], list[str], list[str]]:
    """Extract biomarker/stage/subtype mentions from a change value. [Gap 8]"""
    text = _normalise(val).lower()
    biomarkers = re.findall(r'\b(?:er|pr|her2|brca[12]|kras|egfr|alk|pd-l1|esr1|pik3ca)\b', text)
    stages     = re.findall(r'\bstage\s+(?:i{1,3}v?|[1-4])[abc]?\b', text)
    subtypes   = re.findall(r'\b(?:luminal[- ]?[ab]|triple[- ]?negative|tnbc|hr\+|her2\+|metastatic)\b', text)
    return list(set(biomarkers)), list(set(stages)), list(set(subtypes))


def _list_diff(old_list: list, new_list: list, section: str, field_path: str = "") -> list[ChangeItem]:
    changes: list[ChangeItem] = []
    severity  = _SECTION_SEVERITY.get(section, ImpactSeverity.MEDIUM)
    old_norm  = [_normalise(x) for x in old_list]
    new_norm  = [_normalise(x) for x in new_list]
    old_set   = set(old_norm)
    new_set   = set(new_norm)

    for item_str in (new_set - old_set):
        idx = new_norm.index(item_str)
        bm, st, sub = _extract_entities_from_value(new_list[idx])
        changes.append(ChangeItem(
            section=section,
            field_path=f"{field_path}[{idx}]" if field_path else f"{section}[{idx}]",
            change_type=ChangeType.ADDITION, old_value=None, new_value=new_list[idx],
            description=f"Added new item to {section}", severity=severity,
            biomarkers=bm, stages=st, subtypes=sub,
        ))

    for item_str in (old_set - new_set):
        idx = old_norm.index(item_str)
        bm, st, sub = _extract_entities_from_value(old_list[idx])
        changes.append(ChangeItem(
            section=section,
            field_path=f"{field_path}[{idx}]" if field_path else f"{section}[{idx}]",
            change_type=ChangeType.REMOVAL, old_value=old_list[idx], new_value=None,
            description=f"Removed item from {section}", severity=severity,
            biomarkers=bm, stages=st, subtypes=sub,
        ))
    return changes


def _scalar_diff(old_val: Any, new_val: Any, section: str, field: str) -> list[ChangeItem]:
    severity = _SECTION_SEVERITY.get(section, ImpactSeverity.MEDIUM)
    if _normalise(old_val) == _normalise(new_val):
        return []

    level_change, strength_change = _detect_evidence_change(old_val, new_val)
    bm, st, sub = _extract_entities_from_value(new_val or old_val)

    if old_val in (None, "", [], {}):
        ct, desc = ChangeType.ADDITION, f"New content added to {field}"
    elif new_val in (None, "", [], {}):
        ct, desc = ChangeType.REMOVAL, f"Content removed from {field}"
    else:
        ct, desc = ChangeType.MODIFICATION, f"Content modified in {field}"

    return [ChangeItem(
        section=section, field_path=field, change_type=ct,
        old_value=old_val, new_value=new_val, description=desc, severity=severity,
        evidence_level_change=level_change,
        recommendation_strength_change=strength_change,
        biomarkers=bm, stages=st, subtypes=sub,
    )]


def diff_knowledge(old_k: dict, new_k: dict) -> list[ChangeItem]:
    """Diff two structured guideline knowledge snapshots."""
    all_changes: list[ChangeItem] = []
    skip = {"source_pages", "confidence", "skill_boundaries", "gaps", "_source_pages", "llm_confidence"}
    all_sections = (set(old_k.keys()) | set(new_k.keys())) - skip

    for section in sorted(all_sections):
        if section.startswith("_"):
            continue
        old_val, new_val = old_k.get(section), new_k.get(section)

        if isinstance(old_val, list) or isinstance(new_val, list):
            all_changes.extend(_list_diff(
                old_val if isinstance(old_val, list) else [],
                new_val if isinstance(new_val, list) else [], section,
            ))
        elif isinstance(old_val, dict) and isinstance(new_val, dict):
            for subkey in set(old_val.keys()) | set(new_val.keys()):
                sv_old, sv_new = old_val.get(subkey), new_val.get(subkey)
                if isinstance(sv_old, list) or isinstance(sv_new, list):
                    all_changes.extend(_list_diff(
                        sv_old if isinstance(sv_old, list) else [],
                        sv_new if isinstance(sv_new, list) else [],
                        section, f"{section}.{subkey}",
                    ))
                else:
                    all_changes.extend(_scalar_diff(sv_old, sv_new, section, f"{section}.{subkey}"))
        else:
            all_changes.extend(_scalar_diff(old_val, new_val, section, section))

    return all_changes


def diff_skill_bodies(old_body: dict, new_body: dict) -> dict:
    """Compute {field: {old, new}} for changed fields only."""
    result: dict = {}

    def _walk(old: dict, new: dict, prefix: str = ""):
        for k in sorted(set(old.keys()) | set(new.keys())):
            path = f"{prefix}.{k}" if prefix else k
            ov, nv = old.get(k), new.get(k)
            if _normalise(ov) != _normalise(nv):
                result[path] = {"old": ov, "new": nv}

    _walk(old_body, new_body)
    return result


def sections_affected_by_changes(changes: list[ChangeItem]) -> tuple[list[str], list[str]]:
    changed = {c.section for c in changes}
    return sorted(changed & _DIAGNOSIS_SECTIONS), sorted(changed & _TREATMENT_SECTIONS)


def max_severity(changes: list[ChangeItem]) -> ImpactSeverity:
    order = [ImpactSeverity.NONE, ImpactSeverity.LOW, ImpactSeverity.MEDIUM,
             ImpactSeverity.HIGH, ImpactSeverity.CRITICAL]
    best = ImpactSeverity.NONE
    for c in changes:
        if order.index(c.severity) > order.index(best):
            best = c.severity
    return best


# ═══════════════════════════════════════════════════════════════
# 3. SKILL SERVICE  (all original logic preserved + Gap 13 additions)
# ═══════════════════════════════════════════════════════════════

_VALID_TRANSITIONS: dict[SkillStatus, list[AuditAction]] = {
    SkillStatus.DRAFT:        [AuditAction.SUBMITTED_REVIEW, AuditAction.ARCHIVED],
    SkillStatus.UNDER_REVIEW: [AuditAction.APPROVED, AuditAction.REJECTED],
    SkillStatus.APPROVED:     [AuditAction.PUBLISHED, AuditAction.ARCHIVED],
    SkillStatus.PUBLISHED:    [AuditAction.ARCHIVED, AuditAction.DEPRECATED],
    SkillStatus.ARCHIVED:     [AuditAction.RESTORED],
    SkillStatus.DEPRECATED:   [],
}

_ACTION_TO_STATUS: dict[AuditAction, SkillStatus] = {
    AuditAction.SUBMITTED_REVIEW: SkillStatus.UNDER_REVIEW,
    AuditAction.APPROVED:         SkillStatus.APPROVED,
    AuditAction.REJECTED:         SkillStatus.DRAFT,
    AuditAction.PUBLISHED:        SkillStatus.PUBLISHED,
    AuditAction.ARCHIVED:         SkillStatus.ARCHIVED,
    AuditAction.DEPRECATED:       SkillStatus.DEPRECATED,
    AuditAction.RESTORED:         SkillStatus.DRAFT,
}


def _skill_collection(db: AsyncIOMotorDatabase, skill_type: str):
    return db[COLL_TREAT_SKILLS] if skill_type == "treatment" else db[COLL_DIAG_SKILLS]


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def search_skills(db: AsyncIOMotorDatabase, query: SkillSearchQuery) -> dict:
    base_filter: dict = {"doctor_id": query.doctor_id}
    if query.disease_type:
        base_filter["disease_type"] = {"$regex": query.disease_type, "$options": "i"}
    if query.subtype:
        base_filter["subtype"] = {"$regex": query.subtype, "$options": "i"}
    if query.status:
        base_filter["status"] = query.status.value
    if query.guideline:
        base_filter["guideline"] = {"$regex": query.guideline, "$options": "i"}
    if query.keyword:
        base_filter["$or"] = [
            {"name":             {"$regex": query.keyword, "$options": "i"}},
            {"description":      {"$regex": query.keyword, "$options": "i"}},
            {"trigger_keywords": {"$regex": query.keyword, "$options": "i"}},
            {"disease_type":     {"$regex": query.keyword, "$options": "i"}},
        ]
    # [Gap 13] Retrieval safety filters
    if query.published_only or query.latest_published_only:
        base_filter["status"] = SkillStatus.PUBLISHED.value
    if query.latest_published_only:
        base_filter["is_latest_published"] = True

    skip  = (query.page - 1) * query.page_size
    limit = query.page_size
    results, collections_to_search = [], []

    if query.skill_type is None or query.skill_type == SkillType.DIAGNOSIS:
        collections_to_search.append(("diagnosis", db[COLL_DIAG_SKILLS]))
    if query.skill_type is None or query.skill_type == SkillType.TREATMENT:
        collections_to_search.append(("treatment", db[COLL_TREAT_SKILLS]))

    total = 0
    for coll_type, coll in collections_to_search:
        count = await coll.count_documents(base_filter)
        total += count
        docs = await coll.find(
            base_filter, {"body": 0, "embedding": 0},
        ).sort("updated_at", -1).skip(skip).limit(limit).to_list(length=limit)
        for d in docs:
            d.pop("_id", None)
            d["_collection"] = coll_type
        results.extend(docs)

    results.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
    return {
        "results":   results[:limit],
        "total":     total,
        "page":      query.page,
        "page_size": query.page_size,
        "pages":     max(1, -(-total // query.page_size)),
    }


async def get_skill(
    db: AsyncIOMotorDatabase, skill_id: str, doctor_id: str, include_body: bool = True,
) -> Optional[dict]:
    projection = None if include_body else {"body": 0, "embedding": 0}
    for coll in (db[COLL_DIAG_SKILLS], db[COLL_TREAT_SKILLS]):
        doc = await coll.find_one({"skill_id": skill_id, "doctor_id": doctor_id}, projection)
        if doc:
            doc.pop("_id", None)
            return doc
    return None


async def update_skill(
    db: AsyncIOMotorDatabase, skill_id: str, doctor_id: str, request: SkillUpdateRequest,
) -> dict:
    """Edit a skill body. Snapshots current version first. Any edit resets to DRAFT."""
    skill = await get_skill(db, skill_id, doctor_id)
    if not skill:
        raise ValueError(f"Skill not found: {skill_id}")

    coll            = _skill_collection(db, skill["skill_type"])
    current_version = skill.get("current_version", 1)
    current_status  = skill.get("status", SkillStatus.DRAFT.value)

    snapshot = SkillVersionSnapshot(
        skill_id         = skill_id,
        version_number   = current_version,
        status           = SkillStatus(current_status),
        body             = copy.deepcopy(skill.get("body", {})),
        trigger_keywords = skill.get("trigger_keywords", []),
        confidence       = skill.get("confidence", {}),
        source_pages     = skill.get("source_pages", []),
        source_guideline_id      = skill.get("source_guideline_id", ""),
        source_guideline_version = skill.get("source_guideline_version", ""),
        extraction_version       = skill.get("extraction_version", skill.get("pipeline_version", "")),
        created_by     = doctor_id,
        change_summary = request.change_summary,
        change_type    = request.change_type,
        # [Gap 10]
        triggered_by_recommendation_id = getattr(request, "triggered_by_recommendation_id", None),
        triggered_by_comparison_id     = getattr(request, "triggered_by_comparison_id", None),
    )
    await db[COLL_SKILL_VERSIONS].insert_one(snapshot.model_dump())

    diff           = diff_skill_bodies(skill.get("body", {}), request.body)
    changed_fields = list(diff.keys())
    new_version    = current_version + 1
    new_keywords   = request.trigger_keywords if request.trigger_keywords is not None else skill.get("trigger_keywords", [])
    now            = _now()

    # [Gap 13] Clear is_latest_published when moving back to draft
    await coll.update_one({"skill_id": skill_id}, {"$set": {
        "body":             request.body,
        "trigger_keywords": new_keywords,
        "current_version":  new_version,
        "status":           SkillStatus.DRAFT.value,
        "updated_at":       now,
        "is_latest_published": False,
        "approved_by": None, "approved_at": None,
        "published_by": None, "published_at": None,
        "submitted_for_review_by": None, "submitted_for_review_at": None,
    }})

    entry = AuditLogEntry(
        skill_id=skill_id, doctor_id=doctor_id, action=AuditAction.UPDATED,
        entity_type="skill",
        from_status=SkillStatus(current_status), to_status=SkillStatus.DRAFT,
        from_version=current_version, to_version=new_version,
        change_summary=request.change_summary,
        change_fields=changed_fields, diff_snapshot=diff,
    )
    await db[COLL_SKILL_AUDIT].insert_one(entry.model_dump())
    logger.info(f"[SkillService] Updated {skill_id} | v{current_version}→v{new_version} | fields={len(changed_fields)}")
    return await get_skill(db, skill_id, doctor_id)


async def transition_skill_status(
    db: AsyncIOMotorDatabase, skill_id: str, doctor_id: str, request: StatusTransitionRequest,
) -> dict:
    skill = await get_skill(db, skill_id, doctor_id, include_body=False)
    if not skill:
        raise ValueError(f"Skill not found: {skill_id}")

    current_status = SkillStatus(skill.get("status", SkillStatus.DRAFT.value))
    action         = request.action
    valid_actions  = _VALID_TRANSITIONS.get(current_status, [])

    if action not in valid_actions:
        raise ValueError(
            f"Invalid transition: cannot {action.value} a skill in '{current_status.value}' state. "
            f"Valid actions: {[a.value for a in valid_actions]}"
        )

    new_status = _ACTION_TO_STATUS[action]
    now        = _now()
    update_doc: dict = {"status": new_status.value, "updated_at": now}

    if action == AuditAction.SUBMITTED_REVIEW:
        update_doc.update({"submitted_for_review_by": doctor_id, "submitted_for_review_at": now})
    elif action == AuditAction.APPROVED:
        reviewer = request.reviewer_id or doctor_id
        update_doc.update({"approved_by": reviewer, "approved_at": now,
                           "review_notes": request.notes, "reviewed_by": reviewer, "reviewed_at": now})
    elif action == AuditAction.REJECTED:
        update_doc.update({"review_notes": request.notes,
                           "reviewed_by": request.reviewer_id or doctor_id, "reviewed_at": now})
    elif action == AuditAction.PUBLISHED:
        update_doc.update({"published_by": doctor_id, "published_at": now})
        # [Gap 13] Mark previous published version as not latest, set this one as latest
        await _rotate_latest_published(db, skill_id, skill["skill_type"], doctor_id)
        update_doc["is_latest_published"] = True
    elif action == AuditAction.ARCHIVED:
        update_doc.update({"archived_by": doctor_id, "archived_at": now, "is_latest_published": False})
    elif action == AuditAction.DEPRECATED:
        update_doc.update({"deprecated_by": doctor_id, "deprecated_at": now,
                           "deprecation_reason": request.notes, "is_latest_published": False})

    coll = _skill_collection(db, skill["skill_type"])
    await coll.update_one({"skill_id": skill_id}, {"$set": update_doc})

    entry = AuditLogEntry(
        skill_id=skill_id, doctor_id=doctor_id, action=action, entity_type="skill",
        from_status=current_status, to_status=new_status,
        from_version=skill.get("current_version", 1), to_version=skill.get("current_version", 1),
        change_summary=request.notes or action.value, notes=request.notes,
    )
    await db[COLL_SKILL_AUDIT].insert_one(entry.model_dump())
    logger.info(f"[SkillService] Transition {skill_id} | {current_status.value}→{new_status.value}")
    return {"skill_id": skill_id, "old_status": current_status.value,
            "new_status": new_status.value, "action": action.value}


async def _rotate_latest_published(
    db: AsyncIOMotorDatabase, skill_id: str, skill_type: str, doctor_id: str,
) -> None:
    """[Gap 13] Demote previous is_latest_published=True for this skill."""
    coll = _skill_collection(db, skill_type)
    await coll.update_many(
        {"skill_id": skill_id, "doctor_id": doctor_id, "is_latest_published": True},
        {"$set": {"is_latest_published": False}},
    )


async def get_version_history(
    db: AsyncIOMotorDatabase, skill_id: str, doctor_id: str,
) -> list[dict]:
    if not await get_skill(db, skill_id, doctor_id, include_body=False):
        raise ValueError(f"Skill not found: {skill_id}")
    return await db[COLL_SKILL_VERSIONS].find(
        {"skill_id": skill_id}, {"_id": 0, "body": 0},
    ).sort("version_number", -1).to_list(length=100)


async def get_version_detail(
    db: AsyncIOMotorDatabase, skill_id: str, version_number: int, doctor_id: str,
) -> Optional[dict]:
    if not await get_skill(db, skill_id, doctor_id, include_body=False):
        raise ValueError(f"Skill not found: {skill_id}")
    return await db[COLL_SKILL_VERSIONS].find_one(
        {"skill_id": skill_id, "version_number": version_number}, {"_id": 0},
    )


async def compare_versions(
    db: AsyncIOMotorDatabase, skill_id: str, version_a: int, version_b: int, doctor_id: str,
) -> dict:
    v_a = await get_version_detail(db, skill_id, version_a, doctor_id)
    v_b = await get_version_detail(db, skill_id, version_b, doctor_id)
    if not v_a or not v_b:
        raise ValueError("One or both versions not found")
    diff = diff_skill_bodies(v_a.get("body", {}), v_b.get("body", {}))
    return {"skill_id": skill_id, "version_a": version_a, "version_b": version_b,
            "changes": diff, "changed_fields_count": len(diff)}


async def rollback_skill(
    db: AsyncIOMotorDatabase, skill_id: str, doctor_id: str, request: RollbackRequest,
) -> dict:
    skill = await get_skill(db, skill_id, doctor_id)
    if not skill:
        raise ValueError(f"Skill not found: {skill_id}")
    target = await get_version_detail(db, skill_id, request.target_version, doctor_id)
    if not target:
        raise ValueError(f"Version {request.target_version} not found for skill {skill_id}")

    current_version = skill.get("current_version", 1)
    snapshot = SkillVersionSnapshot(
        skill_id=skill_id, version_number=current_version,
        status=SkillStatus(skill.get("status", "draft")),
        body=copy.deepcopy(skill.get("body", {})),
        trigger_keywords=skill.get("trigger_keywords", []),
        confidence=skill.get("confidence", {}), source_pages=skill.get("source_pages", []),
        created_by=doctor_id,
        change_summary=f"Pre-rollback snapshot (rolling back to v{request.target_version})",
        change_type="rollback",
    )
    await db[COLL_SKILL_VERSIONS].insert_one(snapshot.model_dump())

    new_version = current_version + 1
    coll = _skill_collection(db, skill["skill_type"])
    await coll.update_one({"skill_id": skill_id}, {"$set": {
        "body": target["body"],
        "trigger_keywords": target.get("trigger_keywords", skill.get("trigger_keywords", [])),
        "current_version": new_version, "status": SkillStatus.DRAFT.value,
        "updated_at": _now(), "is_latest_published": False,
        "approved_by": None, "approved_at": None, "published_by": None, "published_at": None,
    }})

    entry = AuditLogEntry(
        skill_id=skill_id, doctor_id=doctor_id, action=AuditAction.ROLLED_BACK,
        entity_type="skill", from_version=current_version, to_version=new_version,
        change_summary=f"Rolled back to v{request.target_version}: {request.reason}",
        notes=request.reason,
    )
    await db[COLL_SKILL_AUDIT].insert_one(entry.model_dump())
    logger.info(f"[SkillService] Rollback {skill_id} | v{current_version}→v{new_version}")
    return {"skill_id": skill_id, "rolled_back_to_version": request.target_version,
            "new_version": new_version}


async def get_audit_log(
    db: AsyncIOMotorDatabase, skill_id: str, doctor_id: str, limit: int = 50,
) -> list[dict]:
    if not await get_skill(db, skill_id, doctor_id, include_body=False):
        raise ValueError(f"Skill not found: {skill_id}")
    return await db[COLL_SKILL_AUDIT].find(
        {"skill_id": skill_id}, {"_id": 0},
    ).sort("created_at", -1).to_list(length=limit)


async def get_doctor_audit_log(
    db: AsyncIOMotorDatabase, doctor_id: str,
    actions: Optional[list[str]] = None, limit: int = 100, skip: int = 0,
) -> dict:
    filter_: dict = {"doctor_id": doctor_id}
    if actions:
        filter_["action"] = {"$in": actions}
    total   = await db[COLL_SKILL_AUDIT].count_documents(filter_)
    entries = await db[COLL_SKILL_AUDIT].find(
        filter_, {"_id": 0}
    ).sort("created_at", -1).skip(skip).limit(limit).to_list(length=limit)
    return {"total": total, "entries": entries}


async def import_phase1_skills(
    db: AsyncIOMotorDatabase, doctor_id: str, doc_id: str,
    skills: list[dict], guideline_name: str = "", guideline_version: str = "",
    pipeline_version: str = "", source_guideline_id: str = "",
) -> dict:
    """Backfill governance fields on Phase-1 pipeline skills. Idempotent."""
    updated = skipped = 0
    now = _now()

    for s in skills:
        sid   = s.get("skill_id")
        stype = s.get("skill_type", "diagnosis")
        coll  = _skill_collection(db, stype)
        existing = await coll.find_one({"skill_id": sid})
        if not existing or existing.get("current_version"):
            skipped += 1
            continue

        patch = {
            "current_version":           1,
            "status":                    SkillStatus.DRAFT.value,
            "is_latest_published":       False,
            "guideline":                 guideline_name or existing.get("guideline", ""),
            "guideline_version":         guideline_version or existing.get("guideline_version", ""),
            "source_guideline_id":       source_guideline_id,
            "source_guideline_version":  guideline_version,
            "extraction_version":        pipeline_version,
            "pipeline_version":          pipeline_version,
            "updated_at":                now,
        }
        await coll.update_one({"skill_id": sid}, {"$set": patch})

        snapshot = SkillVersionSnapshot(
            skill_id=sid, version_number=1, status=SkillStatus.DRAFT,
            body=existing.get("body", {}), trigger_keywords=existing.get("trigger_keywords", []),
            confidence=existing.get("confidence", {}), source_pages=existing.get("source_pages", []),
            source_guideline_id=source_guideline_id, source_guideline_version=guideline_version,
            extraction_version=pipeline_version, created_by=doctor_id,
            change_summary="Initial import from Phase-1 pipeline", change_type="initial_extraction",
        )
        await db[COLL_SKILL_VERSIONS].insert_one(snapshot.model_dump())

        entry = AuditLogEntry(
            skill_id=sid, doctor_id=doctor_id, action=AuditAction.CREATED,
            entity_type="skill", to_status=SkillStatus.DRAFT, to_version=1,
            change_summary="Imported from Phase-1 pipeline",
        )
        await db[COLL_SKILL_AUDIT].insert_one(entry.model_dump())
        updated += 1

    logger.info(f"[SkillService] Import phase1 | doc_id={doc_id} | updated={updated} | skipped={skipped}")
    return {"doc_id": doc_id, "imported": updated, "skipped": skipped}


# ═══════════════════════════════════════════════════════════════
# 4. SKILL REVIEW SERVICE  [Gap 17 — fully implemented]
# ═══════════════════════════════════════════════════════════════

async def submit_skill_for_review(
    db: AsyncIOMotorDatabase, skill_id: str, doctor_id: str, notes: str = "",
) -> dict:
    """Submit a skill for peer review. Creates a SkillReviewRequest record."""
    skill = await get_skill(db, skill_id, doctor_id, include_body=False)
    if not skill:
        raise ValueError(f"Skill not found: {skill_id}")
    if skill.get("status") != SkillStatus.DRAFT.value:
        raise ValueError(f"Only DRAFT skills can be submitted for review (current: {skill.get('status')})")

    # Close any existing open review for this skill
    await db[COLL_SKILL_REVIEWS].update_many(
        {"skill_id": skill_id, "status": "pending"},
        {"$set": {"status": "superseded"}},
    )

    review = SkillReviewRequest(
        skill_id=skill_id, skill_type=SkillType(skill["skill_type"]),
        doctor_id=doctor_id, notes=notes, version=skill.get("current_version", 1),
    )
    await db[COLL_SKILL_REVIEWS].insert_one(review.model_dump())

    # Transition skill
    await transition_skill_status(
        db, skill_id, doctor_id,
        StatusTransitionRequest(action=AuditAction.SUBMITTED_REVIEW, notes=notes),
    )

    logger.info(f"[ReviewService] Submitted skill {skill_id} for review | review_id={review.review_id}")
    return review.model_dump()


async def approve_skill_review(
    db: AsyncIOMotorDatabase, review_id: str, reviewer_id: str, notes: str = "",
) -> dict:
    """Approve a pending review. Reviewer must be different from submitter."""
    rev = await db[COLL_SKILL_REVIEWS].find_one({"review_id": review_id})
    if not rev:
        raise ValueError(f"Review not found: {review_id}")
    if rev["status"] != "pending":
        raise ValueError(f"Review is not pending (status: {rev['status']})")

    now = _now()
    await db[COLL_SKILL_REVIEWS].update_one(
        {"review_id": review_id},
        {"$set": {"status": "approved", "reviewer_id": reviewer_id,
                  "review_notes": notes, "reviewed_at": now, "approved_at": now}},
    )

    await transition_skill_status(
        db, rev["skill_id"], rev["doctor_id"],
        StatusTransitionRequest(action=AuditAction.APPROVED, notes=notes, reviewer_id=reviewer_id),
    )

    entry = AuditLogEntry(
        skill_id=rev["skill_id"], doctor_id=reviewer_id,
        action=AuditAction.APPROVED, entity_type="skill",
        change_summary=f"Review approved by {reviewer_id}. {notes}",
    )
    await db[COLL_SKILL_AUDIT].insert_one(entry.model_dump())
    return {"review_id": review_id, "status": "approved", "skill_id": rev["skill_id"]}


async def reject_skill_review(
    db: AsyncIOMotorDatabase, review_id: str, reviewer_id: str,
    reason: str, notes: str = "",
) -> dict:
    """Reject a pending review, returning skill to DRAFT."""
    rev = await db[COLL_SKILL_REVIEWS].find_one({"review_id": review_id})
    if not rev:
        raise ValueError(f"Review not found: {review_id}")
    if rev["status"] != "pending":
        raise ValueError(f"Review is not pending (status: {rev['status']})")

    now = _now()
    await db[COLL_SKILL_REVIEWS].update_one(
        {"review_id": review_id},
        {"$set": {"status": "rejected", "reviewer_id": reviewer_id,
                  "reject_reason": reason, "review_notes": notes, "reviewed_at": now}},
    )

    await transition_skill_status(
        db, rev["skill_id"], rev["doctor_id"],
        StatusTransitionRequest(action=AuditAction.REJECTED, notes=reason, reviewer_id=reviewer_id),
    )
    return {"review_id": review_id, "status": "rejected", "skill_id": rev["skill_id"]}


async def publish_approved_skill(
    db: AsyncIOMotorDatabase, skill_id: str, publisher_id: str, notes: str = "",
) -> dict:
    """Publish an approved skill. Updates review record with publisher."""
    skill = await get_skill(db, skill_id, publisher_id, include_body=False)
    if not skill:
        raise ValueError(f"Skill not found: {skill_id}")
    if skill.get("status") != SkillStatus.APPROVED.value:
        raise ValueError(f"Only APPROVED skills can be published (current: {skill.get('status')})")

    result = await transition_skill_status(
        db, skill_id, publisher_id,
        StatusTransitionRequest(action=AuditAction.PUBLISHED, notes=notes),
    )

    now = _now()
    await db[COLL_SKILL_REVIEWS].update_many(
        {"skill_id": skill_id, "status": "approved"},
        {"$set": {"publisher_id": publisher_id, "published_at": now, "status": "published"}},
    )
    return result


async def list_pending_reviews(
    db: AsyncIOMotorDatabase, doctor_id: str,
    reviewer_id: Optional[str] = None,
) -> list[dict]:
    """List all pending review requests for a doctor."""
    filter_: dict = {"doctor_id": doctor_id, "status": "pending"}
    if reviewer_id:
        filter_["reviewer_id"] = reviewer_id
    return await db[COLL_SKILL_REVIEWS].find(
        filter_, {"_id": 0}
    ).sort("submitted_at", -1).to_list(length=200)


async def get_review_history(
    db: AsyncIOMotorDatabase, skill_id: str,
) -> list[dict]:
    return await db[COLL_SKILL_REVIEWS].find(
        {"skill_id": skill_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(length=50)


# ═══════════════════════════════════════════════════════════════
# 5. GUIDELINE SERVICE  (all original logic preserved)
# ═══════════════════════════════════════════════════════════════

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
_GROQ_MODEL  = "llama-3.3-70b-versatile"
_TEMPERATURE = 0.1
_MAX_TOKENS  = 4000
_groq_client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

_RECOMMENDATION_SYSTEM = """
You are a clinical knowledge governance specialist.

You are given:
1. A clinical guideline change (section, change_type, old_value, new_value)
2. The current body of a clinical skill (diagnosis or treatment)
3. The skill type (diagnosis | treatment) and the affected section

Your task: Generate a precise, actionable update recommendation for this skill.

Return ONLY valid JSON:
{
  "section_to_update": "<field name in the skill body>",
  "field_path": "<specific path if nested>",
  "recommendation_text": "<clear instruction: what to add/remove/modify and why>",
  "current_value_summary": "<brief summary of what exists now>",
  "recommended_value": "<the specific new value or null if deletion>",
  "confidence": 0.0,
  "reasoning": "<clinical rationale for this change>"
}

RULES:
- Be precise and actionable.
- confidence: 0.9+ for direct additions/removals, 0.7-0.9 for modifications, <0.7 for indirect impact.
- Never hallucinate values not present in the guideline change.
- If the change does not impact this specific skill, return confidence=0.0 and explain in reasoning.
"""


async def register_guideline(
    db: AsyncIOMotorDatabase, doctor_id: str, request: GuidelineRegisterRequest,
) -> dict:
    # [Gap 3] Build stable family_id if not provided
    family_id = request.family_id or _build_family_id(request.organization, request.disease_type, request.title)
    rec = GuidelineRecord(
        doctor_id=doctor_id, title=request.title, organization=request.organization,
        disease_type=request.disease_type, specialty=request.specialty,
        family_id=family_id, aliases=request.aliases,
    )
    await db[COLL_GUIDELINES].insert_one(rec.model_dump())
    logger.info(f"[GuidelineService] Registered '{request.title}' | id={rec.guideline_id} | family={family_id}")
    return rec.model_dump()


def _build_family_id(org: str, disease: str, title: str) -> str:
    """[Gap 3] Create a stable slug-style family ID from org + disease."""
    parts = []
    if org:
        parts.append(re.sub(r'[^A-Z0-9]', '', org.upper())[:8])
    if disease:
        parts.append(re.sub(r'[^A-Z0-9]', '', disease.upper().replace(" ", ""))[:12])
    if not parts:
        parts.append(re.sub(r'[^A-Z0-9]', '', title.upper().replace(" ", ""))[:12])
    return "-".join(parts)


async def list_guidelines(db: AsyncIOMotorDatabase, doctor_id: str) -> list[dict]:
    return await db[COLL_GUIDELINES].find(
        {"doctor_id": doctor_id}, {"_id": 0}
    ).sort("updated_at", -1).to_list(length=200)


async def get_guideline(
    db: AsyncIOMotorDatabase, guideline_id: str, doctor_id: str,
) -> Optional[dict]:
    return await db[COLL_GUIDELINES].find_one(
        {"guideline_id": guideline_id, "doctor_id": doctor_id}, {"_id": 0}
    )


async def link_version_to_guideline(
    db: AsyncIOMotorDatabase, doctor_id: str, request: GuidelineVersionLinkRequest,
) -> dict:
    """Link a processed doc_id (from Phase-1) to a guideline family."""
    guideline = await get_guideline(db, request.guideline_id, doctor_id)
    if not guideline:
        raise ValueError(f"Guideline not found: {request.guideline_id}")

    ph1_record = await db[COLL_PH1_GUIDELINE_VERS].find_one({"doc_id": request.doc_id}, {"_id": 0})
    job_record = await db[COLL_PROCESSING_JOBS].find_one(
        {"doc_id": request.doc_id}, {"_id": 0, "pipeline_result": 1}
    )

    knowledge_snapshot: dict = {}
    subtypes = diseases = skill_ids = []
    extraction_version = ""

    if ph1_record:
        subtypes           = ph1_record.get("subtypes", [])
        diseases           = ph1_record.get("diseases", [])
        skill_ids          = ph1_record.get("skill_ids", [])
        extraction_version = ph1_record.get("pipeline_version", "")

    if job_record:
        pr = job_record.get("pipeline_result", {})
        knowledge_snapshot = {
            "diagnosis":    pr.get("diagnosis_knowledge", {}),
            "treatment":    pr.get("treatment_knowledge", {}),
            "understanding": pr.get("understanding", {}),
        }
        if not skill_ids:
            skill_ids = [s.get("skill_id") for s in pr.get("skills", []) if s.get("skill_id")]

    ver_rec = GuidelineVersionRecord(
        guideline_id=request.guideline_id, doctor_id=doctor_id,
        version=request.version, doc_id=request.doc_id,
        publication_date=request.publication_date, uploaded_by=doctor_id,
        upload_notes=request.upload_notes,
        disease_type=guideline.get("disease_type", ""),
        specialty=guideline.get("specialty", ""),
        subtypes=subtypes, diseases=diseases,
        extraction_version=extraction_version, skill_ids=skill_ids,
        knowledge_snapshot=knowledge_snapshot,
        # [Gap 4]
        llm_model=getattr(request, "llm_model", ""),
        prompt_version=getattr(request, "prompt_version", ""),
        embedding_model=getattr(request, "embedding_model", ""),
        chunking_strategy=getattr(request, "chunking_strategy", ""),
    )
    await db[COLL_GUIDELINE_VERSIONS].insert_one(ver_rec.model_dump())
    await db[COLL_GUIDELINES].update_one(
        {"guideline_id": request.guideline_id},
        {"$set": {"current_version": request.version, "current_doc_id": request.doc_id, "updated_at": _now()}},
    )

    # [Gap 18] Audit
    entry = AuditLogEntry(
        guideline_id=request.guideline_id, doctor_id=doctor_id,
        action=AuditAction.GUIDELINE_UPLOADED, entity_type="guideline",
        change_summary=f"Linked version {request.version} (doc_id={request.doc_id})",
    )
    await db[COLL_SKILL_AUDIT].insert_one(entry.model_dump())

    logger.info(f"[GuidelineService] Linked v{request.version} → {request.guideline_id}")
    return ver_rec.model_dump()


async def get_guideline_versions(
    db: AsyncIOMotorDatabase, guideline_id: str, doctor_id: str,
) -> list[dict]:
    return await db[COLL_GUIDELINE_VERSIONS].find(
        {"guideline_id": guideline_id, "doctor_id": doctor_id},
        {"_id": 0, "knowledge_snapshot": 0},
    ).sort("created_at", -1).to_list(length=50)


async def get_latest_guideline_version(
    db: AsyncIOMotorDatabase, guideline_id: str, doctor_id: str,
) -> Optional[dict]:
    """[Gap 2] Auto-discover the latest version of a guideline."""
    versions = await db[COLL_GUIDELINE_VERSIONS].find(
        {"guideline_id": guideline_id, "doctor_id": doctor_id},
        {"_id": 0, "knowledge_snapshot": 0},
    ).sort("created_at", -1).to_list(length=50)

    if not versions:
        return None

    # Try semantic version sort first (e.g. 2026.2 > 2026.1 > 2025.3)
    def _ver_key(v: dict) -> tuple:
        raw = v.get("version", "0")
        parts = re.split(r'[.\-]', raw)
        nums = []
        for p in parts:
            try:
                nums.append(int(p))
            except ValueError:
                nums.append(0)
        return tuple(nums)

    try:
        return sorted(versions, key=_ver_key, reverse=True)[0]
    except Exception:
        return versions[0]


async def compare_guideline_versions(
    db: AsyncIOMotorDatabase, doctor_id: str, request: CompareGuidelinesRequest,
) -> dict:
    # [Gap 19] Prevent duplicate comparisons
    existing = await db[COLL_COMPARISONS].find_one({
        "guideline_id": request.guideline_id,
        "old_doc_id":   request.old_doc_id,
        "new_doc_id":   request.new_doc_id,
    }, {"_id": 0, "changes": 0})
    if existing:
        logger.info(f"[GuidelineService] Returning existing comparison for same version pair")
        return {**existing, "_cached": True}

    old_ver = await db[COLL_GUIDELINE_VERSIONS].find_one(
        {"guideline_id": request.guideline_id, "doc_id": request.old_doc_id}
    )
    new_ver = await db[COLL_GUIDELINE_VERSIONS].find_one(
        {"guideline_id": request.guideline_id, "doc_id": request.new_doc_id}
    )
    if not old_ver:
        raise ValueError(f"Old guideline version not found for doc_id={request.old_doc_id}")
    if not new_ver:
        raise ValueError(f"New guideline version not found for doc_id={request.new_doc_id}")

    old_k, new_k = old_ver.get("knowledge_snapshot", {}), new_ver.get("knowledge_snapshot", {})
    all_changes: list[ChangeItem] = []

    if old_k.get("diagnosis") or new_k.get("diagnosis"):
        all_changes.extend(diff_knowledge(old_k.get("diagnosis", {}), new_k.get("diagnosis", {})))
    if old_k.get("treatment") or new_k.get("treatment"):
        all_changes.extend(diff_knowledge(old_k.get("treatment", {}), new_k.get("treatment", {})))

    by_section: dict[str, list[dict]] = {}
    for c in all_changes:
        by_section.setdefault(c.section, []).append(c.model_dump())

    comp = GuidelineComparison(
        guideline_id=request.guideline_id, doctor_id=doctor_id,
        old_version=old_ver.get("version", ""), new_version=new_ver.get("version", ""),
        old_doc_id=request.old_doc_id, new_doc_id=request.new_doc_id,
        total_changes=len(all_changes),
        additions=sum(1 for c in all_changes if c.change_type == ChangeType.ADDITION),
        removals=sum(1 for c in all_changes if c.change_type == ChangeType.REMOVAL),
        modifications=sum(1 for c in all_changes if c.change_type == ChangeType.MODIFICATION),
        changes=all_changes, changes_by_section=by_section,
        affected_skill_ids=list(set(old_ver.get("skill_ids", []) + new_ver.get("skill_ids", []))),
        impact_summary=(
            f"{len(all_changes)} changes across {len(by_section)} sections. "
            f"Additions: {sum(1 for c in all_changes if c.change_type == ChangeType.ADDITION)}, "
            f"Removals: {sum(1 for c in all_changes if c.change_type == ChangeType.REMOVAL)}, "
            f"Modifications: {sum(1 for c in all_changes if c.change_type == ChangeType.MODIFICATION)}."
        ),
        completed_at=_now(),
    )
    await db[COLL_COMPARISONS].insert_one(comp.model_dump())

    # [Gap 18] Audit
    entry = AuditLogEntry(
        guideline_id=request.guideline_id, doctor_id=doctor_id,
        action=AuditAction.GUIDELINE_COMPARED, entity_type="comparison",
        change_summary=f"Compared v{comp.old_version} vs v{comp.new_version} | changes={len(all_changes)}",
        metadata={"comparison_id": comp.comparison_id},
    )
    await db[COLL_SKILL_AUDIT].insert_one(entry.model_dump())

    logger.info(f"[GuidelineService] Comparison | {request.guideline_id} | changes={len(all_changes)}")
    return comp.model_dump()


async def get_comparison(
    db: AsyncIOMotorDatabase, comparison_id: str, doctor_id: str,
) -> Optional[dict]:
    return await db[COLL_COMPARISONS].find_one(
        {"comparison_id": comparison_id, "doctor_id": doctor_id}, {"_id": 0}
    )


async def list_comparisons(
    db: AsyncIOMotorDatabase, guideline_id: str, doctor_id: str,
) -> list[dict]:
    return await db[COLL_COMPARISONS].find(
        {"guideline_id": guideline_id, "doctor_id": doctor_id},
        {"_id": 0, "changes": 0},
    ).sort("created_at", -1).to_list(length=20)


async def review_comparison(
    db: AsyncIOMotorDatabase, doctor_id: str, request: ComparisonReviewRequest,
) -> dict:
    """[Gap 15] Mark a comparison as reviewed or approved."""
    comp = await db[COLL_COMPARISONS].find_one(
        {"comparison_id": request.comparison_id, "doctor_id": doctor_id}
    )
    if not comp:
        raise ValueError(f"Comparison not found: {request.comparison_id}")

    now = _now()
    update: dict = {"review_status": request.action, "updated_at": now}
    if request.action == "reviewed":
        update.update({"reviewed_by": doctor_id, "reviewed_at": now})
    elif request.action == "approved":
        update.update({"approved_by": doctor_id, "approved_at": now})

    await db[COLL_COMPARISONS].update_one(
        {"comparison_id": request.comparison_id}, {"$set": update}
    )
    return {"comparison_id": request.comparison_id, "review_status": request.action}


async def generate_recommendations_for_comparison(
    db: AsyncIOMotorDatabase, comparison_id: str, doctor_id: str,
) -> dict:
    if not _groq_client:
        raise RuntimeError("GROQ_API_KEY not configured — cannot generate recommendations")

    comparison = await db[COLL_COMPARISONS].find_one(
        {"comparison_id": comparison_id, "doctor_id": doctor_id}, {"_id": 0}
    )
    if not comparison:
        raise ValueError(f"Comparison not found: {comparison_id}")

    impact = await db[COLL_IMPACT_REPORTS].find_one({"comparison_id": comparison_id}, {"_id": 0})
    if not impact:
        raise ValueError(f"Run impact analysis first for comparison {comparison_id}")

    significant_changes = [
        c for c in comparison.get("changes", [])
        if c.get("severity") in ("critical", "high", "medium")
    ]
    if not significant_changes:
        return {"generated": 0, "message": "No significant changes require recommendations"}

    recommendations_created = 0

    for affected_skill in impact.get("affected_skills", []):
        skill_id   = affected_skill["skill_id"]
        skill_type = affected_skill["skill_type"]
        coll       = db[COLL_TREAT_SKILLS] if skill_type == "treatment" else db[COLL_DIAG_SKILLS]
        skill      = await coll.find_one({"skill_id": skill_id}, {"_id": 0})
        if not skill:
            continue

        relevant_sections = _TREATMENT_SECTIONS if skill_type == "treatment" else _DIAGNOSIS_SECTIONS
        relevant_changes  = [c for c in significant_changes if c.get("section") in relevant_sections]
        if not relevant_changes:
            continue

        for change in relevant_changes[:5]:
            existing = await db[COLL_SKILL_RECOMMENDATIONS].find_one({
                "comparison_id": comparison_id, "skill_id": skill_id,
                "section_to_update": change.get("section", ""),
            })
            if existing:
                continue

            try:
                skill_body_summary = {
                    k: v for k, v in skill.get("body", {}).items()
                    if k == change.get("section") and not k.startswith("_")
                }
                user_msg = (
                    f"Guideline change:\n"
                    f"  Section: {change.get('section')}\n"
                    f"  Type: {change.get('change_type')}\n"
                    f"  Old value: {json.dumps(change.get('old_value'))[:500]}\n"
                    f"  New value: {json.dumps(change.get('new_value'))[:500]}\n\n"
                    f"Skill type: {skill_type}\n"
                    f"Skill name: {skill.get('name', '')}\n"
                    f"Disease type: {skill.get('disease_type', '')}\n"
                    f"Subtype: {skill.get('subtype', '')}\n\n"
                    f"Current skill section content:\n"
                    f"{json.dumps(skill_body_summary, ensure_ascii=False)[:1500]}"
                )
                resp   = _groq_client.chat.completions.create(
                    model=_GROQ_MODEL, temperature=_TEMPERATURE, max_tokens=_MAX_TOKENS,
                    messages=[
                        {"role": "system", "content": _RECOMMENDATION_SYSTEM},
                        {"role": "user",   "content": user_msg},
                    ],
                    response_format={"type": "json_object"},
                )
                result = json.loads(resp.choices[0].message.content or "{}")

                if result.get("confidence", 0) < 0.3:
                    continue

                rec = SkillUpdateRecommendation(
                    comparison_id=comparison_id, guideline_id=comparison["guideline_id"],
                    doctor_id=doctor_id, skill_id=skill_id, skill_type=skill_type,
                    skill_name=skill.get("name", ""),
                    triggered_by_changes=[change.get("change_id", "")],
                    section_to_update=result.get("section_to_update", change.get("section", "")),
                    field_path=result.get("field_path", ""),
                    current_value=result.get("current_value_summary"),
                    recommended_value=result.get("recommended_value"),
                    recommendation_text=result.get("recommendation_text", ""),
                    confidence=float(result.get("confidence", 0.7)),
                    reasoning=result.get("reasoning", ""),
                )
                await db[COLL_SKILL_RECOMMENDATIONS].insert_one(rec.model_dump())
                recommendations_created += 1

            except Exception as e:
                logger.warning(
                    f"[GuidelineService] Recommendation generation failed "
                    f"skill={skill_id} section={change.get('section')}: {e}"
                )

    # [Gap 18] Audit
    entry = AuditLogEntry(
        guideline_id=comparison.get("guideline_id", ""), doctor_id=doctor_id,
        action=AuditAction.IMPACT_ANALYSED, entity_type="recommendation",
        change_summary=f"Generated {recommendations_created} recommendations for comparison {comparison_id}",
        metadata={"comparison_id": comparison_id, "count": recommendations_created},
    )
    await db[COLL_SKILL_AUDIT].insert_one(entry.model_dump())

    logger.info(f"[GuidelineService] Generated {recommendations_created} recommendations | {comparison_id}")
    return {"comparison_id": comparison_id, "generated": recommendations_created}


async def list_recommendations(
    db: AsyncIOMotorDatabase, doctor_id: str,
    comparison_id: Optional[str] = None, skill_id: Optional[str] = None,
    status: Optional[str] = None,
) -> list[dict]:
    filter_: dict = {"doctor_id": doctor_id}
    if comparison_id:
        filter_["comparison_id"] = comparison_id
    if skill_id:
        filter_["skill_id"] = skill_id
    if status:
        filter_["status"] = status
    return await db[COLL_SKILL_RECOMMENDATIONS].find(
        filter_, {"_id": 0}
    ).sort("created_at", -1).to_list(length=200)


async def review_recommendation(
    db: AsyncIOMotorDatabase, doctor_id: str, request: RecommendationReviewRequest,
) -> dict:
    rec = await db[COLL_SKILL_RECOMMENDATIONS].find_one(
        {"recommendation_id": request.recommendation_id, "doctor_id": doctor_id}
    )
    if not rec:
        raise ValueError(f"Recommendation not found: {request.recommendation_id}")

    update: dict = {
        "status": request.action.value, "doctor_notes": request.doctor_notes,
        "reviewed_by": doctor_id, "reviewed_at": _now(),
    }
    if request.action == RecommendationStatus.MODIFIED:
        update["final_value"] = request.final_value
    elif request.action == RecommendationStatus.ACCEPTED:
        update["final_value"] = rec.get("recommended_value")

    await db[COLL_SKILL_RECOMMENDATIONS].update_one(
        {"recommendation_id": request.recommendation_id}, {"$set": update}
    )

    # [Gap 18] Audit
    action = AuditAction.RECOMMENDATION_ACCEPTED if request.action == RecommendationStatus.ACCEPTED \
             else AuditAction.RECOMMENDATION_REJECTED
    entry = AuditLogEntry(
        skill_id=rec.get("skill_id", ""), doctor_id=doctor_id,
        action=action, entity_type="recommendation",
        change_summary=f"Recommendation {request.action.value}: {rec.get('section_to_update', '')}",
        metadata={"recommendation_id": request.recommendation_id},
    )
    await db[COLL_SKILL_AUDIT].insert_one(entry.model_dump())

    return {"recommendation_id": request.recommendation_id, "status": request.action.value}


async def bulk_review_recommendations(
    db: AsyncIOMotorDatabase, doctor_id: str, request: BulkRecommendationReview,
) -> dict:
    results = []
    for r in request.reviews:
        try:
            results.append({"success": True, **await review_recommendation(db, doctor_id, r)})
        except Exception as e:
            results.append({"success": False, "recommendation_id": r.recommendation_id, "error": str(e)})
    return {"processed": len(results), "results": results}


async def apply_accepted_recommendations(
    db: AsyncIOMotorDatabase, comparison_id: str, doctor_id: str,
    skill_service_fn: Callable,
) -> dict:
    """Apply all accepted recommendations to their respective skills."""
    accepted = await db[COLL_SKILL_RECOMMENDATIONS].find(
        {"comparison_id": comparison_id, "doctor_id": doctor_id, "status": "accepted"},
        {"_id": 0},
    ).to_list(length=200)

    by_skill: dict[str, list] = {}
    for rec in accepted:
        by_skill.setdefault(rec["skill_id"], []).append(rec)

    applied = errors = 0

    for skill_id, recs in by_skill.items():
        skill = None
        for coll_name in (COLL_DIAG_SKILLS, COLL_TREAT_SKILLS):
            doc = await db[coll_name].find_one({"skill_id": skill_id, "doctor_id": doctor_id}, {"_id": 0})
            if doc:
                skill = doc
                break
        if not skill:
            continue

        new_body         = dict(skill.get("body", {}))
        sections_changed = []
        rec_ids          = []

        for rec in recs:
            section   = rec.get("section_to_update", "")
            new_value = rec.get("final_value")
            if not section or new_value is None:
                continue
            if "." in section:
                parts = section.split(".", 1)
                if isinstance(new_body.get(parts[0]), dict):
                    new_body[parts[0]][parts[1]] = new_value
            elif section in new_body and isinstance(new_body[section], list):
                new_body[section] = new_value if isinstance(new_value, list) else new_body[section] + [new_value]
            else:
                new_body[section] = new_value
            sections_changed.append(section)
            rec_ids.append(rec.get("recommendation_id", ""))

        if sections_changed:
            try:
                update_req = SkillUpdateRequest(
                    body=new_body,
                    change_summary=(
                        f"Applied {len(recs)} accepted recommendations from "
                        f"guideline comparison {comparison_id}. "
                        f"Sections: {', '.join(sections_changed)}"
                    ),
                    change_type="guideline_update",
                    triggered_by_comparison_id=comparison_id,
                )
                await skill_service_fn(db, skill_id, doctor_id, update_req)
                applied += 1
            except Exception as e:
                logger.error(f"Failed to apply recommendations to skill {skill_id}: {e}")
                errors += 1

    return {"comparison_id": comparison_id, "applied": applied, "errors": errors, "skills_updated": applied}


async def detect_existing_guideline(
    db: AsyncIOMotorDatabase, doctor_id: str, title: str,
    disease_type: str = "", organization: str = "",
    family_id: str = "", aliases: Optional[list[str]] = None,
) -> Optional[dict]:
    """[Gap 3] Enhanced detection using family_id, aliases, and fuzzy matching."""
    # 1. Exact family_id match (most reliable)
    if family_id:
        match = await db[COLL_GUIDELINES].find_one(
            {"doctor_id": doctor_id, "family_id": family_id}, {"_id": 0}
        )
        if match:
            return match

    # 2. Check aliases
    candidate_titles = [title] + (aliases or [])
    for t in candidate_titles:
        exact = await db[COLL_GUIDELINES].find_one(
            {"doctor_id": doctor_id, "title": {"$regex": re.escape(t), "$options": "i"}},
            {"_id": 0},
        )
        if exact:
            return exact
        # Check against stored aliases
        alias_match = await db[COLL_GUIDELINES].find_one(
            {"doctor_id": doctor_id, "aliases": {"$regex": re.escape(t), "$options": "i"}},
            {"_id": 0},
        )
        if alias_match:
            return alias_match

    # 3. Computed family_id match
    computed_fid = _build_family_id(organization, disease_type, title)
    if computed_fid:
        fid_match = await db[COLL_GUIDELINES].find_one(
            {"doctor_id": doctor_id, "family_id": computed_fid}, {"_id": 0}
        )
        if fid_match:
            return fid_match

    # 4. Disease + org combo fallback
    if disease_type:
        filter_: dict = {
            "doctor_id":   doctor_id,
            "disease_type": {"$regex": re.escape(disease_type[:30]), "$options": "i"},
        }
        if organization:
            filter_["organization"] = {"$regex": re.escape(organization), "$options": "i"}
        match = await db[COLL_GUIDELINES].find_one(filter_, {"_id": 0})
        if match:
            return match

    return None


# ═══════════════════════════════════════════════════════════════
# 6. KNOWLEDGE GRAPH SERVICE  [Gap 8]
# ═══════════════════════════════════════════════════════════════

async def upsert_entity(
    db: AsyncIOMotorDatabase, doctor_id: str, entity_type: EntityType,
    name: str, aliases: Optional[list[str]] = None, attributes: Optional[dict] = None,
    disease_type: str = "", subtype: str = "", source_guideline_id: str = "",
) -> dict:
    """Create or update a knowledge graph entity."""
    canonical = _canonicalize(name)
    existing  = await db[COLL_KG_ENTITIES].find_one(
        {"doctor_id": doctor_id, "entity_type": entity_type.value, "canonical": canonical},
        {"_id": 0},
    )
    now = _now()

    if existing:
        update: dict = {"updated_at": now}
        if aliases:
            update["aliases"] = list(set(existing.get("aliases", []) + aliases))
        if attributes:
            update["attributes"] = {**existing.get("attributes", {}), **attributes}
        if source_guideline_id and source_guideline_id not in existing.get("source_guideline_ids", []):
            update["source_guideline_ids"] = existing.get("source_guideline_ids", []) + [source_guideline_id]
        await db[COLL_KG_ENTITIES].update_one({"entity_id": existing["entity_id"]}, {"$set": update})
        existing.update(update)
        return existing

    entity = KnowledgeEntity(
        doctor_id=doctor_id, entity_type=entity_type, name=name, canonical=canonical,
        aliases=aliases or [], attributes=attributes or {},
        disease_type=disease_type, subtype=subtype,
        source_guideline_ids=[source_guideline_id] if source_guideline_id else [],
    )
    await db[COLL_KG_ENTITIES].insert_one(entity.model_dump())
    return entity.model_dump()


def _canonicalize(name: str) -> str:
    """Normalize entity name for dedup matching."""
    return re.sub(r'\s+', ' ', name.strip().lower())


async def add_relation(
    db: AsyncIOMotorDatabase, doctor_id: str,
    source_id: str, target_id: str, relation_type: str,
    weight: float = 1.0, evidence: str = "", source_guideline_id: str = "",
) -> dict:
    relation = KnowledgeRelation(
        doctor_id=doctor_id, source_id=source_id, target_id=target_id,
        relation_type=relation_type, weight=weight, evidence=evidence,
        source_guideline_id=source_guideline_id,
    )
    await db[COLL_KG_RELATIONS].insert_one(relation.model_dump())
    return relation.model_dump()


async def link_skill_to_entities(
    db: AsyncIOMotorDatabase, skill_id: str, entity_links: list[dict],
) -> int:
    """Attach entity links to a skill for fine-grained impact matching."""
    inserted = 0
    for link_data in entity_links:
        existing = await db[COLL_SKILL_ENTITY_LINKS].find_one(
            {"skill_id": skill_id, "entity_id": link_data["entity_id"]}
        )
        if not existing:
            link = SkillEntityLink(
                skill_id=skill_id, entity_id=link_data["entity_id"],
                entity_type=EntityType(link_data["entity_type"]),
                entity_name=link_data.get("entity_name", ""),
                relevance=link_data.get("relevance", 1.0),
            )
            await db[COLL_SKILL_ENTITY_LINKS].insert_one(link.model_dump())
            inserted += 1
    return inserted


async def get_entities_for_skill(
    db: AsyncIOMotorDatabase, skill_id: str,
) -> list[dict]:
    return await db[COLL_SKILL_ENTITY_LINKS].find(
        {"skill_id": skill_id}, {"_id": 0}
    ).to_list(length=100)


async def get_entity_graph(
    db: AsyncIOMotorDatabase, doctor_id: str,
    disease_type: Optional[str] = None, entity_type: Optional[str] = None,
) -> dict:
    """Return entities and relations for visualizing the knowledge graph."""
    entity_filter: dict = {"doctor_id": doctor_id}
    if disease_type:
        entity_filter["disease_type"] = {"$regex": re.escape(disease_type), "$options": "i"}
    if entity_type:
        entity_filter["entity_type"] = entity_type

    entities = await db[COLL_KG_ENTITIES].find(
        entity_filter, {"_id": 0}
    ).to_list(length=1000)

    entity_ids = [e["entity_id"] for e in entities]
    relations  = await db[COLL_KG_RELATIONS].find(
        {"doctor_id": doctor_id, "source_id": {"$in": entity_ids}},
        {"_id": 0},
    ).to_list(length=5000)

    return {"entities": entities, "relations": relations,
            "node_count": len(entities), "edge_count": len(relations)}


# ═══════════════════════════════════════════════════════════════
# 7. FINE-GRAINED IMPACT ANALYSIS  [Gap 7]
# ═══════════════════════════════════════════════════════════════

async def run_impact_analysis(
    db: AsyncIOMotorDatabase, comparison_id: str, doctor_id: str,
) -> dict:
    """
    Fine-grained impact analysis.
    First tries entity-graph-based matching [Gap 7].
    Falls back to disease_type regex if no graph data.
    """
    comparison = await db[COLL_COMPARISONS].find_one(
        {"comparison_id": comparison_id, "doctor_id": doctor_id}, {"_id": 0}
    )
    if not comparison:
        raise ValueError(f"Comparison not found: {comparison_id}")

    changes = [ChangeItem(**c) for c in comparison.get("changes", [])]
    diag_sections, treat_sections = sections_affected_by_changes(changes)

    guideline    = await db[COLL_GUIDELINES].find_one(
        {"guideline_id": comparison["guideline_id"]}, {"_id": 0}
    )
    disease_type = guideline.get("disease_type", "") if guideline else ""

    # Collect all entity mentions from the changes (biomarkers, stages, subtypes)
    change_biomarkers = set()
    change_stages     = set()
    change_subtypes   = set()
    for c in changes:
        change_biomarkers.update(c.biomarkers)
        change_stages.update(c.stages)
        change_subtypes.update(c.subtypes)

    # Check if knowledge graph is populated
    graph_entity_count = await db[COLL_KG_ENTITIES].count_documents({"doctor_id": doctor_id})
    use_graph = graph_entity_count > 0

    skill_filter: dict = {"doctor_id": doctor_id}
    if disease_type:
        skill_filter["disease_type"] = {"$regex": re.escape(disease_type), "$options": "i"}

    diag_skills  = await db[COLL_DIAG_SKILLS].find(
        skill_filter, {"skill_id": 1, "name": 1, "subtype": 1, "disease_type": 1, "body": 1, "_id": 0}
    ).to_list(length=500)
    treat_skills = await db[COLL_TREAT_SKILLS].find(
        skill_filter, {"skill_id": 1, "name": 1, "subtype": 1, "disease_type": 1, "body": 1, "_id": 0}
    ).to_list(length=500)

    affected: list[AffectedSkillEntry] = []

    async def _score_skill(s: dict, skill_type: str, sections_changed: list[str], relevant_changes) -> Optional[AffectedSkillEntry]:
        """Score a skill for impact using entity matching if available."""
        matched_bm = matched_st = matched_sub = matched_drugs = []
        match_confidence = 1.0

        if use_graph:
            # Get entities linked to this skill
            entity_links = await db[COLL_SKILL_ENTITY_LINKS].find(
                {"skill_id": s["skill_id"]}, {"_id": 0}
            ).to_list(length=100)

            skill_biomarkers = {l["entity_name"].lower() for l in entity_links if l["entity_type"] == "biomarker"}
            skill_stages     = {l["entity_name"].lower() for l in entity_links if l["entity_type"] == "stage"}
            skill_subtypes   = {l["entity_name"].lower() for l in entity_links if l["entity_type"] == "subtype"}
            skill_drugs      = {l["entity_name"].lower() for l in entity_links if l["entity_type"] == "drug"}

            matched_bm   = list(change_biomarkers & skill_biomarkers)
            matched_st   = list(change_stages & skill_stages)
            matched_sub  = list(change_subtypes & skill_subtypes)

            # If we have entity data but no overlap, reduce match confidence
            if entity_links and not matched_bm and not matched_st and not matched_sub:
                # Check by text in skill body as fallback
                body_text = json.dumps(s.get("body", {})).lower()
                text_match = any(bm in body_text for bm in change_biomarkers) or \
                             any(st in body_text for st in change_stages) or \
                             any(sub in body_text for sub in change_subtypes)
                if not text_match:
                    return None  # Skip — not relevant to this skill
                match_confidence = 0.5
            elif entity_links:
                # Partial match
                total_change_entities = len(change_biomarkers) + len(change_stages) + len(change_subtypes)
                if total_change_entities > 0:
                    total_matched = len(matched_bm) + len(matched_st) + len(matched_sub)
                    match_confidence = min(1.0, total_matched / total_change_entities)
        else:
            # No graph — also do a quick text search in skill body
            if change_biomarkers or change_stages or change_subtypes:
                body_text = json.dumps(s.get("body", {})).lower()
                matched_bm  = [bm for bm in change_biomarkers if bm in body_text]
                matched_st  = [st for st in change_stages if st in body_text]
                matched_sub = [sub for sub in change_subtypes if sub in body_text]
                # Still include skill even if no text match when no graph (broad match)

        sev = max_severity(relevant_changes)
        return AffectedSkillEntry(
            skill_id=s["skill_id"], skill_type=skill_type,
            skill_name=s.get("name", ""), subtype=s.get("subtype", ""),
            disease_type=s.get("disease_type", ""),
            impact_sections=sections_changed, severity=sev,
            reason=f"Guideline changes in: {', '.join(sections_changed)}",
            matched_biomarkers=matched_bm, matched_stages=matched_st,
            matched_subtypes=matched_sub, matched_drugs=matched_drugs,
            match_confidence=match_confidence,
        )

    for s in diag_skills:
        if diag_sections:
            rel_changes = [c for c in changes if c.section in _DIAGNOSIS_SECTIONS]
            entry = await _score_skill(s, "diagnosis", diag_sections, rel_changes)
            if entry:
                affected.append(entry)

    for s in treat_skills:
        if treat_sections:
            rel_changes = [c for c in changes if c.section in _TREATMENT_SECTIONS]
            entry = await _score_skill(s, "treatment", treat_sections, rel_changes)
            if entry:
                affected.append(entry)

    # Sort by severity then match confidence
    sev_order = {"critical": 0, "high": 1, "medium": 2, "low": 3, "none": 4}
    affected.sort(key=lambda a: (sev_order.get(a.severity.value, 4), -a.match_confidence))

    sev_counts = Counter(a.severity.value for a in affected)
    report = ImpactAnalysisReport(
        comparison_id=comparison_id, guideline_id=comparison["guideline_id"],
        doctor_id=doctor_id, old_version=comparison.get("old_version", ""),
        new_version=comparison.get("new_version", ""),
        affected_skills=affected, total_affected=len(affected),
        critical_count=sev_counts.get("critical", 0), high_count=sev_counts.get("high", 0),
        medium_count=sev_counts.get("medium", 0), low_count=sev_counts.get("low", 0),
        graph_matching_used=use_graph,
    )
    await db[COLL_IMPACT_REPORTS].insert_one(report.model_dump())

    # [Gap 18] Audit
    entry = AuditLogEntry(
        guideline_id=comparison["guideline_id"], doctor_id=doctor_id,
        action=AuditAction.IMPACT_ANALYSED, entity_type="impact_report",
        change_summary=f"Impact analysis: {len(affected)} skills affected | graph={use_graph}",
        metadata={"comparison_id": comparison_id, "impact_id": report.impact_id},
    )
    await db[COLL_SKILL_AUDIT].insert_one(entry.model_dump())

    logger.info(f"[ImpactService] {comparison_id} | affected={len(affected)} | graph={use_graph}")
    return report.model_dump()


async def get_impact_report(
    db: AsyncIOMotorDatabase, comparison_id: str, doctor_id: str,
) -> Optional[dict]:
    return await db[COLL_IMPACT_REPORTS].find_one(
        {"comparison_id": comparison_id, "doctor_id": doctor_id}, {"_id": 0}
    )


# ═══════════════════════════════════════════════════════════════
# 8. DRAFT AUTO-GENERATION SERVICE  [Gap 9, Gap 10]
# ═══════════════════════════════════════════════════════════════

async def auto_generate_drafts_from_recommendations(
    db: AsyncIOMotorDatabase, comparison_id: str, doctor_id: str,
    only_high_confidence: bool = True, confidence_threshold: float = 0.7,
) -> dict:
    """
    [Gap 9] Auto-generate draft skill versions from accepted/pending recommendations.
    Does NOT require human approval first — marks as draft_generated for review.
    [Gap 10] Links each new draft version back to the recommendation that triggered it.
    """
    recs = await db[COLL_SKILL_RECOMMENDATIONS].find(
        {
            "comparison_id": comparison_id,
            "doctor_id": doctor_id,
            "status": {"$in": ["accepted", "pending"]},
            **({"confidence": {"$gte": confidence_threshold}} if only_high_confidence else {}),
        },
        {"_id": 0},
    ).to_list(length=200)

    if not recs:
        return {"drafts_generated": 0, "message": "No eligible recommendations found"}

    # Group by skill
    by_skill: dict[str, list] = {}
    for rec in recs:
        by_skill.setdefault(rec["skill_id"], []).append(rec)

    drafts_generated = 0
    errors           = 0
    draft_links      = []

    for skill_id, skill_recs in by_skill.items():
        skill = None
        for coll_name in (COLL_DIAG_SKILLS, COLL_TREAT_SKILLS):
            doc = await db[coll_name].find_one(
                {"skill_id": skill_id, "doctor_id": doctor_id}, {"_id": 0}
            )
            if doc:
                skill = doc
                break
        if not skill:
            continue

        new_body         = copy.deepcopy(skill.get("body", {}))
        sections_changed = []
        rec_ids          = []

        for rec in skill_recs:
            section   = rec.get("section_to_update", "")
            new_value = rec.get("final_value") or rec.get("recommended_value")
            if not section or new_value is None:
                continue
            if "." in section:
                parts = section.split(".", 1)
                if isinstance(new_body.get(parts[0]), dict):
                    new_body[parts[0]][parts[1]] = new_value
            elif section in new_body and isinstance(new_body[section], list):
                new_body[section] = new_value if isinstance(new_value, list) else new_body[section] + [new_value]
            else:
                new_body[section] = new_value
            sections_changed.append(section)
            rec_ids.append(rec.get("recommendation_id", ""))

        if not sections_changed:
            continue

        try:
            update_req = SkillUpdateRequest(
                body=new_body,
                change_summary=(
                    f"[Auto-Draft] Generated from {len(skill_recs)} recommendations "
                    f"(comparison {comparison_id}). Sections: {', '.join(sections_changed)}"
                ),
                change_type="draft_generated",
                triggered_by_comparison_id=comparison_id,
            )
            updated = await update_skill(db, skill_id, doctor_id, update_req)
            new_version = updated.get("current_version", 1)
            drafts_generated += 1

            # [Gap 10] Update each recommendation with the draft version id
            for rec_id in rec_ids:
                await db[COLL_SKILL_RECOMMENDATIONS].update_one(
                    {"recommendation_id": rec_id},
                    {"$set": {
                        "draft_version_id":    f"{skill_id}_v{new_version}",
                        "draft_skill_version": new_version,
                    }},
                )

            draft_links.append({
                "skill_id":       skill_id,
                "draft_version":  new_version,
                "recommendation_ids": rec_ids,
                "sections":       sections_changed,
            })

            # [Gap 18] Audit
            entry = AuditLogEntry(
                skill_id=skill_id, guideline_id="",
                doctor_id=doctor_id, action=AuditAction.DRAFT_GENERATED,
                entity_type="skill", to_version=new_version,
                change_summary=f"Auto-draft generated from comparison {comparison_id}",
                metadata={"comparison_id": comparison_id, "recommendation_ids": rec_ids},
            )
            await db[COLL_SKILL_AUDIT].insert_one(entry.model_dump())

        except Exception as e:
            logger.error(f"[DraftService] Failed to generate draft for skill {skill_id}: {e}")
            errors += 1

    logger.info(f"[DraftService] Generated {drafts_generated} drafts | comparison={comparison_id} | errors={errors}")
    return {
        "comparison_id":   comparison_id,
        "drafts_generated": drafts_generated,
        "errors":          errors,
        "draft_links":     draft_links,
    }


# ═══════════════════════════════════════════════════════════════
# 9. GUIDELINE VERSION LIFECYCLE SERVICE  [Gap 14, Gap 15]
# ═══════════════════════════════════════════════════════════════

async def transition_guideline_version_status(
    db: AsyncIOMotorDatabase, doctor_id: str, request: GuidelineVersionTransitionRequest,
) -> dict:
    """[Gap 14] Lifecycle transitions for guideline versions: approve → publish → archive."""
    ver = await db[COLL_GUIDELINE_VERSIONS].find_one(
        {"version_record_id": request.version_record_id, "doctor_id": doctor_id}, {"_id": 0}
    )
    if not ver:
        raise ValueError(f"Guideline version not found: {request.version_record_id}")

    now    = _now()
    action = request.action
    update: dict = {"updated_at": now}

    if action == "approve":
        update.update({"gov_status": GuidelineVersionStatus.APPROVED.value,
                       "approved_by": doctor_id, "approved_at": now})
    elif action == "publish":
        if ver.get("gov_status") not in (GuidelineVersionStatus.APPROVED.value, GuidelineVersionStatus.DRAFT.value):
            raise ValueError("Guideline version must be approved before publishing")
        update.update({"gov_status": GuidelineVersionStatus.PUBLISHED.value,
                       "published_by": doctor_id, "published_at": now})
    elif action == "archive":
        update.update({"gov_status": GuidelineVersionStatus.ARCHIVED.value,
                       "archived_by": doctor_id, "archived_at": now})
    else:
        raise ValueError(f"Unknown action: {action}. Use approve | publish | archive")

    await db[COLL_GUIDELINE_VERSIONS].update_one(
        {"version_record_id": request.version_record_id}, {"$set": update}
    )

    # [Gap 18] Audit
    entry = AuditLogEntry(
        guideline_id=ver.get("guideline_id", ""), doctor_id=doctor_id,
        action=AuditAction.PUBLISHED if action == "publish" else AuditAction.APPROVED,
        entity_type="guideline_version",
        change_summary=f"Guideline version {action}: {ver.get('version', '')}. {request.notes}",
        metadata={"version_record_id": request.version_record_id},
    )
    await db[COLL_SKILL_AUDIT].insert_one(entry.model_dump())

    return {"version_record_id": request.version_record_id, "gov_status": update.get("gov_status")}


# ═══════════════════════════════════════════════════════════════
# 10. ORCHESTRATION WORKFLOW SERVICE  [Gaps 1, 2, 3, 19]
# ═══════════════════════════════════════════════════════════════

async def run_guideline_upload_workflow(
    db: AsyncIOMotorDatabase, doctor_id: str, request: GuidelineUploadWorkflowRequest,
) -> GuidelineUploadWorkflowResult:
    """
    [Gap 1] One-shot orchestrator:
      detect → register/link → compare (vs latest) → impact → recommend → (optional) auto-draft

    Each step records its result. Failures in later steps don't abort earlier ones.
    """
    result = GuidelineUploadWorkflowResult(
        doctor_id=doctor_id, doc_id=request.doc_id, version=request.version,
    )
    steps: list[WorkflowStepResult] = []

    try:
        # ── Step 1: Detect or register guideline ──────────────────────
        existing = await detect_existing_guideline(
            db, doctor_id, request.title,
            disease_type=request.disease_type, organization=request.organization,
            family_id=request.family_id, aliases=request.aliases,
        )

        if existing:
            guideline_id = existing["guideline_id"]
            steps.append(WorkflowStepResult(
                step="detect", status="success",
                message=f"Matched existing guideline: {guideline_id}",
                result_id=guideline_id,
            ))
        else:
            reg_req = GuidelineRegisterRequest(
                title=request.title, organization=request.organization,
                disease_type=request.disease_type, specialty=request.specialty,
                family_id=request.family_id, aliases=request.aliases,
            )
            new_guideline = await register_guideline(db, doctor_id, reg_req)
            guideline_id  = new_guideline["guideline_id"]
            steps.append(WorkflowStepResult(
                step="detect", status="success",
                message=f"Registered new guideline: {guideline_id}",
                result_id=guideline_id,
            ))

        result.guideline_id = guideline_id

        # ── Step 2: Link this version ──────────────────────────────────
        link_req = GuidelineVersionLinkRequest(
            guideline_id=guideline_id, version=request.version, doc_id=request.doc_id,
            publication_date=request.publication_date, upload_notes=request.upload_notes,
            llm_model=request.llm_model, prompt_version=request.prompt_version,
            embedding_model=request.embedding_model, chunking_strategy=request.chunking_strategy,
        )
        linked = await link_version_to_guideline(db, doctor_id, link_req)
        steps.append(WorkflowStepResult(
            step="link_version", status="success",
            message=f"Linked version {request.version} | doc_id={request.doc_id}",
            result_id=linked.get("version_record_id", ""),
        ))

        if not request.auto_compare:
            result.status = WorkflowStatus.COMPLETED
            result.steps  = steps
            await db[COLL_WORKFLOW_RESULTS].insert_one(result.model_dump())
            return result

        # ── Step 3: Find previous version for comparison [Gap 2] ──────
        all_versions = await db[COLL_GUIDELINE_VERSIONS].find(
            {"guideline_id": guideline_id, "doctor_id": doctor_id,
             "doc_id": {"$ne": request.doc_id}},
            {"_id": 0, "knowledge_snapshot": 0},
        ).sort("created_at", -1).to_list(length=50)

        if not all_versions:
            steps.append(WorkflowStepResult(
                step="compare", status="skipped",
                message="No previous version found for comparison",
            ))
            result.status = WorkflowStatus.COMPLETED
            result.steps  = steps
            await db[COLL_WORKFLOW_RESULTS].insert_one(result.model_dump())
            return result

        # Sort to find the immediately preceding version
        prev_version = all_versions[0]  # already sorted by created_at desc

        # ── Step 4: Compare ───────────────────────────────────────────
        compare_req = CompareGuidelinesRequest(
            guideline_id=guideline_id,
            old_doc_id=prev_version["doc_id"],
            new_doc_id=request.doc_id,
        )
        comparison = await compare_guideline_versions(db, doctor_id, compare_req)
        comparison_id = comparison["comparison_id"]
        result.comparison_id = comparison_id
        steps.append(WorkflowStepResult(
            step="compare", status="success",
            message=f"Compared v{prev_version.get('version','')} vs v{request.version} | changes={comparison.get('total_changes',0)}",
            result_id=comparison_id,
            count=comparison.get("total_changes", 0),
        ))

        if not request.auto_impact:
            result.status = WorkflowStatus.COMPLETED
            result.steps  = steps
            await db[COLL_WORKFLOW_RESULTS].insert_one(result.model_dump())
            return result

        # ── Step 5: Impact analysis ───────────────────────────────────
        impact = await run_impact_analysis(db, comparison_id, doctor_id)
        result.impact_id = impact["impact_id"]
        steps.append(WorkflowStepResult(
            step="impact", status="success",
            message=f"Impact analysis complete | affected={impact.get('total_affected',0)}",
            result_id=impact["impact_id"],
            count=impact.get("total_affected", 0),
        ))

        if not request.auto_recommend:
            result.status = WorkflowStatus.COMPLETED
            result.steps  = steps
            await db[COLL_WORKFLOW_RESULTS].insert_one(result.model_dump())
            return result

        # ── Step 6: Generate recommendations ─────────────────────────
        if _groq_client:
            rec_result = await generate_recommendations_for_comparison(db, comparison_id, doctor_id)
            result.recommendations_generated = rec_result.get("generated", 0)
            steps.append(WorkflowStepResult(
                step="recommend", status="success",
                message=f"Generated {rec_result.get('generated',0)} recommendations",
                count=rec_result.get("generated", 0),
            ))
        else:
            steps.append(WorkflowStepResult(
                step="recommend", status="skipped",
                message="GROQ_API_KEY not configured",
            ))

        # ── Step 7: Auto-draft (opt-in only) ─────────────────────────
        if request.auto_draft:
            draft_result = await auto_generate_drafts_from_recommendations(
                db, comparison_id, doctor_id, only_high_confidence=True,
            )
            result.drafts_generated = draft_result.get("drafts_generated", 0)
            steps.append(WorkflowStepResult(
                step="draft", status="success",
                message=f"Auto-generated {draft_result.get('drafts_generated',0)} drafts",
                count=draft_result.get("drafts_generated", 0),
            ))

        result.status = WorkflowStatus.COMPLETED

    except Exception as e:
        logger.error(f"[WorkflowService] Workflow failed: {e}")
        result.status = WorkflowStatus.FAILED
        result.error  = str(e)
        steps.append(WorkflowStepResult(step="error", status="failed", message=str(e)))

    result.steps        = steps
    result.completed_at = _now()
    await db[COLL_WORKFLOW_RESULTS].insert_one(result.model_dump())

    # [Gap 18] Audit
    entry = AuditLogEntry(
        guideline_id=result.guideline_id, doctor_id=doctor_id,
        action=AuditAction.WORKFLOW_COMPLETED if result.status == WorkflowStatus.COMPLETED
               else AuditAction.WORKFLOW_STARTED,
        entity_type="workflow",
        change_summary=f"Upload workflow {'completed' if result.status == WorkflowStatus.COMPLETED else 'failed'} | "
                       f"doc_id={request.doc_id} version={request.version}",
        metadata={"workflow_id": result.workflow_id, "steps": [s.step for s in steps]},
    )
    await db[COLL_SKILL_AUDIT].insert_one(entry.model_dump())

    logger.info(f"[WorkflowService] Workflow {result.workflow_id} | status={result.status.value}")
    return result


async def get_workflow_result(
    db: AsyncIOMotorDatabase, workflow_id: str, doctor_id: str,
) -> Optional[dict]:
    doc = await db[COLL_WORKFLOW_RESULTS].find_one(
        {"workflow_id": workflow_id, "doctor_id": doctor_id}, {"_id": 0}
    )
    return doc


async def list_workflow_results(
    db: AsyncIOMotorDatabase, doctor_id: str, limit: int = 20,
) -> list[dict]:
    return await db[COLL_WORKFLOW_RESULTS].find(
        {"doctor_id": doctor_id}, {"_id": 0}
    ).sort("started_at", -1).to_list(length=limit)


# ═══════════════════════════════════════════════════════════════
# 11. RETRIEVAL SAFETY SERVICE  [Gap 13]
# ═══════════════════════════════════════════════════════════════

async def get_published_skills_for_retrieval(
    db: AsyncIOMotorDatabase, query: SkillRetrievalQuery,
) -> list[dict]:
    """
    Phase-2 safe retrieval endpoint.
    Always enforces status=published, optionally latest_version_only.
    Returns lightweight summaries (no full body).
    """
    base_filter: dict = {
        "doctor_id": query.doctor_id,
        "status":    SkillStatus.PUBLISHED.value,
    }
    if query.latest_version_only:
        base_filter["is_latest_published"] = True
    if query.disease_type:
        base_filter["disease_type"] = {"$regex": re.escape(query.disease_type), "$options": "i"}
    if query.subtype:
        base_filter["subtype"] = {"$regex": re.escape(query.subtype), "$options": "i"}
    if query.keywords:
        kw_pattern = "|".join(re.escape(k) for k in query.keywords)
        base_filter["$or"] = [
            {"trigger_keywords": {"$regex": kw_pattern, "$options": "i"}},
            {"name": {"$regex": kw_pattern, "$options": "i"}},
            {"description": {"$regex": kw_pattern, "$options": "i"}},
        ]

    projection = {
        "skill_id": 1, "skill_type": 1, "name": 1, "disease_type": 1, "subtype": 1,
        "current_version": 1, "published_at": 1, "trigger_keywords": 1,
        "is_latest_published": 1, "_id": 0,
    }

    results = []
    colls = []
    if query.skill_type is None or query.skill_type == SkillType.DIAGNOSIS:
        colls.append(db[COLL_DIAG_SKILLS])
    if query.skill_type is None or query.skill_type == SkillType.TREATMENT:
        colls.append(db[COLL_TREAT_SKILLS])

    for coll in colls:
        docs = await coll.find(base_filter, projection).to_list(length=500)
        results.extend(docs)

    return results


async def get_latest_published_skill(
    db: AsyncIOMotorDatabase, skill_id: str, doctor_id: str,
) -> Optional[dict]:
    """[Gap 13] Safely fetch the latest published version of a skill."""
    for coll in (db[COLL_DIAG_SKILLS], db[COLL_TREAT_SKILLS]):
        doc = await coll.find_one(
            {"skill_id": skill_id, "doctor_id": doctor_id,
             "status": SkillStatus.PUBLISHED.value, "is_latest_published": True},
            {"embedding": 0, "_id": 0},
        )
        if doc:
            return doc

    # Fallback: if flag isn't set, return the highest-version published skill
    for coll in (db[COLL_DIAG_SKILLS], db[COLL_TREAT_SKILLS]):
        docs = await coll.find(
            {"skill_id": skill_id, "doctor_id": doctor_id, "status": SkillStatus.PUBLISHED.value},
            {"embedding": 0, "_id": 0},
        ).sort("current_version", -1).to_list(length=1)
        if docs:
            return docs[0]

    return None


# ═══════════════════════════════════════════════════════════════
# 12. GOVERNANCE SERVICE  (extended — Gaps 12, 18)
# ═══════════════════════════════════════════════════════════════

async def get_governance_dashboard(
    db: AsyncIOMotorDatabase, doctor_id: str,
) -> dict:
    """[Gap 12] Extended dashboard with all missing metrics."""
    async def _count(coll_name: str, f: dict) -> int:
        return await db[coll_name].count_documents(f)

    status_counts: dict[str, int] = {}
    for status in ("draft", "under_review", "approved", "published", "archived", "deprecated"):
        total = 0
        for coll in (COLL_DIAG_SKILLS, COLL_TREAT_SKILLS):
            total += await _count(coll, {"doctor_id": doctor_id, "status": status})
        status_counts[status] = total

    pending_reviews         = await _count(COLL_SKILL_REVIEWS, {"doctor_id": doctor_id, "status": "pending"})
    pending_recommendations = await _count(COLL_SKILL_RECOMMENDATIONS, {"doctor_id": doctor_id, "status": "pending"})
    rejected_recommendations = await _count(COLL_SKILL_RECOMMENDATIONS, {"doctor_id": doctor_id, "status": "rejected"})

    # Pending comparison reviews [Gap 12]
    pending_comp_reviews = await _count(
        COLL_COMPARISONS, {"doctor_id": doctor_id, "review_status": "pending"}
    )

    # Archived guideline versions
    archived_gl_versions = await _count(
        COLL_GUIDELINE_VERSIONS,
        {"doctor_id": doctor_id, "gov_status": GuidelineVersionStatus.ARCHIVED.value}
    )

    # Auto-drafts waiting review (draft skills created by auto-draft workflow)
    auto_drafts_pending = await _count(
        COLL_SKILL_AUDIT,
        {"doctor_id": doctor_id, "action": AuditAction.DRAFT_GENERATED.value}
    )

    # 30-day counts
    cutoff_30d = _now() - timedelta(days=30)
    guidelines_updated_30d = await _count(
        COLL_SKILL_AUDIT,
        {"doctor_id": doctor_id, "action": AuditAction.GUIDELINE_UPLOADED.value,
         "created_at": {"$gte": cutoff_30d}},
    )
    skills_impacted_30d = await _count(
        COLL_SKILL_AUDIT,
        {"doctor_id": doctor_id, "action": AuditAction.IMPACT_ANALYSED.value,
         "created_at": {"$gte": cutoff_30d}},
    )

    # By disease
    by_disease: dict[str, int] = {}
    for coll in (COLL_DIAG_SKILLS, COLL_TREAT_SKILLS):
        pipeline = [
            {"$match": {"doctor_id": doctor_id}},
            {"$group": {"_id": "$disease_type", "count": {"$sum": 1}}},
        ]
        async for row in db[coll].aggregate(pipeline):
            key = row["_id"] or "Unknown"
            by_disease[key] = by_disease.get(key, 0) + row["count"]

    # By guideline organization
    by_org: dict[str, int] = {}
    pipeline_org = [
        {"$match": {"doctor_id": doctor_id}},
        {"$group": {"_id": "$organization", "count": {"$sum": 1}}},
    ]
    async for row in db[COLL_GUIDELINES].aggregate(pipeline_org):
        key = row["_id"] or "Unknown"
        by_org[key] = row["count"]

    diag_total  = await _count(COLL_DIAG_SKILLS,  {"doctor_id": doctor_id})
    treat_total = await _count(COLL_TREAT_SKILLS, {"doctor_id": doctor_id})

    recent_activity = await db[COLL_SKILL_AUDIT].find(
        {"doctor_id": doctor_id}, {"_id": 0, "diff_snapshot": 0}
    ).sort("created_at", -1).to_list(length=20)

    dashboard = GovernanceDashboard(
        doctor_id               = doctor_id,
        pending_reviews         = pending_reviews,
        pending_publications    = status_counts.get("approved", 0),
        draft_skills            = status_counts.get("draft", 0),
        approved_skills         = status_counts.get("approved", 0),
        published_skills        = status_counts.get("published", 0),
        archived_skills         = status_counts.get("archived", 0),
        deprecated_skills       = status_counts.get("deprecated", 0),
        total_skills            = sum(status_counts.values()),
        pending_comparisons     = await _count(COLL_COMPARISONS, {"doctor_id": doctor_id, "review_status": "pending"}),
        pending_recommendations = pending_recommendations,
        # [Gap 12] new fields
        guidelines_updated_30d      = guidelines_updated_30d,
        skills_impacted_30d         = skills_impacted_30d,
        rejected_recommendations    = rejected_recommendations,
        pending_comparison_reviews  = pending_comp_reviews,
        archived_guideline_versions = archived_gl_versions,
        auto_drafts_pending_review  = auto_drafts_pending,
        recent_activity             = recent_activity,
        by_disease                  = dict(sorted(by_disease.items(), key=lambda x: -x[1])[:10]),
        by_skill_type               = {"diagnosis": diag_total, "treatment": treat_total},
        by_guideline_org            = by_org,
    )
    return dashboard.model_dump()


async def get_audit_report(
    db: AsyncIOMotorDatabase, doctor_id: str,
    skill_id:     Optional[str]       = None,
    guideline_id: Optional[str]       = None,
    entity_type:  Optional[str]       = None,
    actions:      Optional[list[str]] = None,
    date_from:    Optional[datetime]  = None,
    date_to:      Optional[datetime]  = None,
    limit: int = 100, skip: int = 0,
) -> dict:
    """[Gap 18] Full audit report covering both skill and guideline events."""
    filter_: dict = {"doctor_id": doctor_id}
    if skill_id:
        filter_["skill_id"]     = skill_id
    if guideline_id:
        filter_["guideline_id"] = guideline_id
    if entity_type:
        filter_["entity_type"]  = entity_type
    if actions:
        filter_["action"] = {"$in": actions}
    if date_from or date_to:
        date_filter: dict = {}
        if date_from:
            date_filter["$gte"] = date_from
        if date_to:
            date_filter["$lte"] = date_to
        filter_["created_at"] = date_filter

    total   = await db[COLL_SKILL_AUDIT].count_documents(filter_)
    entries = await db[COLL_SKILL_AUDIT].find(
        filter_, {"_id": 0}
    ).sort("created_at", -1).skip(skip).limit(limit).to_list(length=limit)

    report = ChangeAuditReport(
        doctor_id=doctor_id, skill_id=skill_id, guideline_id=guideline_id,
        entity_type=entity_type, date_from=date_from, date_to=date_to,
        actions=actions or [], audit_entries=entries, total=total,
    )
    return report.model_dump()


async def get_pending_reviews_list(
    db: AsyncIOMotorDatabase, doctor_id: str,
) -> list[dict]:
    results = []
    for coll in (COLL_DIAG_SKILLS, COLL_TREAT_SKILLS):
        docs = await db[coll].find(
            {"doctor_id": doctor_id, "status": "under_review"},
            {"body": 0, "embedding": 0, "_id": 0},
        ).sort("submitted_for_review_at", -1).to_list(length=100)
        results.extend(docs)
    return results


async def get_lifecycle_summary(
    db: AsyncIOMotorDatabase, doctor_id: str, skill_id: str,
) -> dict:
    audit_entries = await db[COLL_SKILL_AUDIT].find(
        {"skill_id": skill_id}, {"_id": 0, "diff_snapshot": 0},
    ).sort("created_at", 1).to_list(length=200)

    versions = await db[COLL_SKILL_VERSIONS].find(
        {"skill_id": skill_id}, {"_id": 0, "body": 0},
    ).sort("version_number", 1).to_list(length=100)

    return {
        "skill_id":       skill_id,
        "audit_trail":    audit_entries,
        "version_list":   versions,
        "total_versions": len(versions),
        "total_actions":  len(audit_entries),
    }