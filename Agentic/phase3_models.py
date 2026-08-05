"""
phase3_models.py
==========
All Pydantic models for the clinical skill governance system.

Covers:
  - Skill Management & Version Control
  - Guideline Repository & Comparison
  - Governance Dashboard & Reporting
  - Knowledge Graph Entities                  [NEW - Gap 8]
  - Evidence Tracking                         [NEW - Gap 5]
  - Multi-Guideline Traceability              [NEW - Gap 6]
  - Orchestration Workflow                    [NEW - Gap 1]
  - Guideline Governance Lifecycle            [NEW - Gap 14]
  - Skill Review Workflow (full)              [NEW - Gap 17]
  - Governance Audit Events                   [NEW - Gap 18]
  - Draft-to-Recommendation Linkage           [NEW - Gap 10]
  - Retrieval Safety                          [NEW - Gap 13]

Skill lifecycle:  draft → under_review → approved → published → archived → deprecated
Guideline lifecycle: draft → under_review → approved → published → archived
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, Field
import uuid


# ═══════════════════════════════════════════════════════
# SKILL ENUMS
# ═══════════════════════════════════════════════════════

class SkillStatus(str, Enum):
    DRAFT        = "draft"
    UNDER_REVIEW = "under_review"
    APPROVED     = "approved"
    PUBLISHED    = "published"
    ARCHIVED     = "archived"
    DEPRECATED   = "deprecated"


class SkillType(str, Enum):
    DIAGNOSIS  = "diagnosis"
    TREATMENT  = "treatment"


class AuditAction(str, Enum):
    CREATED            = "created"
    UPDATED            = "updated"
    SUBMITTED_REVIEW   = "submitted_for_review"
    APPROVED           = "approved"
    REJECTED           = "rejected"
    PUBLISHED          = "published"
    ARCHIVED           = "archived"
    DEPRECATED         = "deprecated"
    RESTORED           = "restored"
    ROLLED_BACK        = "rolled_back"
    # Guideline-level audit actions [Gap 18]
    GUIDELINE_UPLOADED      = "guideline_uploaded"
    GUIDELINE_COMPARED      = "guideline_compared"
    IMPACT_ANALYSED         = "impact_analysed"
    RECOMMENDATION_ACCEPTED = "recommendation_accepted"
    RECOMMENDATION_REJECTED = "recommendation_rejected"
    DRAFT_GENERATED         = "draft_generated"
    WORKFLOW_STARTED        = "workflow_started"
    WORKFLOW_COMPLETED      = "workflow_completed"


# ═══════════════════════════════════════════════════════
# GUIDELINE ENUMS
# ═══════════════════════════════════════════════════════

class ChangeType(str, Enum):
    ADDITION     = "addition"
    REMOVAL      = "removal"
    MODIFICATION = "modification"
    NO_CHANGE    = "no_change"


class ImpactSeverity(str, Enum):
    CRITICAL  = "critical"
    HIGH      = "high"
    MEDIUM    = "medium"
    LOW       = "low"
    NONE      = "none"


class RecommendationStatus(str, Enum):
    PENDING   = "pending"
    ACCEPTED  = "accepted"
    REJECTED  = "rejected"
    MODIFIED  = "modified"


# [Gap 14] Guideline version lifecycle status
class GuidelineVersionStatus(str, Enum):
    DRAFT        = "draft"
    UNDER_REVIEW = "under_review"
    APPROVED     = "approved"
    PUBLISHED    = "published"
    ARCHIVED     = "archived"


# [Gap 8] Knowledge graph entity types
class EntityType(str, Enum):
    DISEASE    = "disease"
    BIOMARKER  = "biomarker"
    DRUG       = "drug"
    PROCEDURE  = "procedure"
    GENE       = "gene"
    STAGE      = "stage"
    SUBTYPE    = "subtype"
    POPULATION = "population"


# ═══════════════════════════════════════════════════════
# DIAGNOSIS SKILL BODY
# ═══════════════════════════════════════════════════════

class DiseaseOverview(BaseModel):
    definition:   str = ""
    epidemiology: str = ""
    risk_factors: list[str] = Field(default_factory=list)


class ClinicalPresentation(BaseModel):
    symptoms:         list[str] = Field(default_factory=list)
    signs:            list[str] = Field(default_factory=list)
    chief_complaints: list[str] = Field(default_factory=list)


class Investigations(BaseModel):
    laboratory_tests: list[str] = Field(default_factory=list)
    imaging:          list[str] = Field(default_factory=list)
    pathology:        list[str] = Field(default_factory=list)


class Biomarker(BaseModel):
    name:          str  = ""
    significance:  str  = ""
    source_stated: bool = True
    source_page:   int  = 0


class StagingEntry(BaseModel):
    stage:       str = ""
    criteria:    str = ""
    description: str = ""
    source_page: int = 0


class DiagnosticStep(BaseModel):
    step:             int = 0
    action:           str = ""
    rationale:        str = ""
    next_if_positive: str = ""
    next_if_negative: str = ""
    source_page:      int = 0


class DifferentialDiagnosis(BaseModel):
    condition:              str = ""
    distinguishing_feature: str = ""
    key_test:               str = ""
    source_page:            int = 0


class ExclusionCriteria(BaseModel):
    condition:       str = ""
    test_to_exclude: str = ""
    rationale:       str = ""


class KeyEvidence(BaseModel):
    trial:                 str  = ""
    finding:               str  = ""
    source_section:        str  = ""
    source_page:           int  = 0
    evidence_type:         str  = ""
    recommendation_grade:  str  = ""
    inline_recommendation: bool = False
    # [Gap 5] Evidence governance fields
    evidence_level:          str = ""   # Level I | II | III | IV | V
    recommendation_strength: str = ""   # Strong | Moderate | Weak | Conditional
    evidence_upgraded:       bool = False   # flag when level improved vs prior version
    evidence_downgraded:     bool = False


class SkillBoundaries(BaseModel):
    does_not_cover: list[str] = Field(default_factory=list)
    related_skills: list[str] = Field(default_factory=list)


class DiagnosisBody(BaseModel):
    disease_overview:       DiseaseOverview       = Field(default_factory=DiseaseOverview)
    clinical_presentation:  ClinicalPresentation  = Field(default_factory=ClinicalPresentation)
    diagnostic_criteria:    str                   = ""
    investigations:         Investigations        = Field(default_factory=Investigations)
    biomarkers:             list[Biomarker]       = Field(default_factory=list)
    molecular_testing:      dict[str, list]       = Field(default_factory=lambda: {"genetic_mutations": [], "genomic_tests": []})
    staging:                list[StagingEntry]    = Field(default_factory=list)
    risk_stratification:    dict[str, str]        = Field(default_factory=lambda: {"low_risk": "", "intermediate_risk": "", "high_risk": ""})
    subtypes:               list[dict]            = Field(default_factory=list)
    diagnostic_pathway:     list[DiagnosticStep]  = Field(default_factory=list)
    special_populations:    dict[str, str]        = Field(default_factory=dict)
    key_evidence:           list[KeyEvidence]     = Field(default_factory=list)
    differential_diagnosis: list[DifferentialDiagnosis] = Field(default_factory=list)
    exclusion_criteria:     list[ExclusionCriteria]     = Field(default_factory=list)
    skill_boundaries:       SkillBoundaries       = Field(default_factory=SkillBoundaries)
    gaps:                   list[str]             = Field(default_factory=list)
    source_pages:           list[int]             = Field(default_factory=list)
    clinical_rationale:     str                   = ""


# ═══════════════════════════════════════════════════════
# TREATMENT SKILL BODY
# ═══════════════════════════════════════════════════════

class ChemotherapyRegimen(BaseModel):
    name:       str       = ""
    drugs:      list[str] = Field(default_factory=list)
    indication: str       = ""
    dose:       str       = ""
    schedule:   str       = ""
    notes:      str       = ""


class StageOption(BaseModel):
    regimen_name:   str       = ""
    drugs:          list[str] = Field(default_factory=list)
    modality:       str       = ""
    line:           str       = ""
    evidence_trial: str       = ""
    notes:          str       = ""
    condition:      str       = ""
    source_page:    int       = 0


class StageWiseTreatment(BaseModel):
    stage:             str               = ""
    subtype:           str               = ""
    intent:            str               = ""
    primary_treatment: str               = ""
    conditions:        list[str]         = Field(default_factory=list)
    options:           list[StageOption] = Field(default_factory=list)
    surgery:           dict              = Field(default_factory=dict)
    radiation:         dict              = Field(default_factory=dict)
    source_pages:      list[int]         = Field(default_factory=list)


class IfThenRule(BaseModel):
    condition:           str = ""
    action:              str = ""
    population:          str = ""
    biomarker_condition: str = ""
    stage:               str = ""
    line:                str = ""
    intent:              str = ""
    source_page:         int = 0


class Contraindication(BaseModel):
    drug_or_action: str = ""
    condition:      str = ""
    reason:         str = ""
    source_page:    int = 0


class DoseModification(BaseModel):
    condition:    str = ""
    drug:         str = ""
    modification: str = ""
    source_page:  int = 0


class TreatmentBody(BaseModel):
    treatment_principles:  str                      = ""
    stage_wise_treatment:  list[StageWiseTreatment] = Field(default_factory=list)
    surgery:               dict                     = Field(default_factory=dict)
    radiation:             dict                     = Field(default_factory=dict)
    chemotherapy:          dict                     = Field(default_factory=lambda: {"regimens": []})
    immunotherapy:         dict                     = Field(default_factory=dict)
    targeted_therapy:      dict                     = Field(default_factory=dict)
    hormone_therapy:       dict                     = Field(default_factory=dict)
    follow_up:             dict                     = Field(default_factory=dict)
    supportive_care:       dict                     = Field(default_factory=dict)
    risk_stratification:   list[dict]               = Field(default_factory=list)
    contraindications:     list[Contraindication]   = Field(default_factory=list)
    dose_modifications:    list[DoseModification]   = Field(default_factory=list)
    monitoring:            dict                     = Field(default_factory=dict)
    special_populations:   dict[str, str]           = Field(default_factory=dict)
    key_evidence:          list[KeyEvidence]        = Field(default_factory=list)
    recommendations:       list[dict]               = Field(default_factory=list)
    if_then_rules:         list[IfThenRule]         = Field(default_factory=list)
    toxicity_monitoring:   list[dict]               = Field(default_factory=list)
    dose_hold_criteria:    list[dict]               = Field(default_factory=list)
    dose_resume_criteria:  list[dict]               = Field(default_factory=list)
    surveillance_schedule: list[dict]               = Field(default_factory=list)
    response_assessment:   dict                     = Field(default_factory=dict)
    skill_boundaries:      SkillBoundaries          = Field(default_factory=SkillBoundaries)
    gaps:                  list[str]                = Field(default_factory=list)
    source_pages:          list[int]                = Field(default_factory=list)
    clinical_rationale:    str                      = ""


# ═══════════════════════════════════════════════════════
# SKILL VERSION SNAPSHOT
# ═══════════════════════════════════════════════════════

class SkillVersionSnapshot(BaseModel):
    version_id:               str      = Field(default_factory=lambda: str(uuid.uuid4()))
    skill_id:                 str
    version_number:           int
    status:                   SkillStatus
    body:                     dict
    trigger_keywords:         list[str] = Field(default_factory=list)
    confidence:               dict      = Field(default_factory=dict)
    source_pages:             list[int] = Field(default_factory=list)
    source_guideline_id:      str       = ""
    source_guideline_version: str       = ""
    extraction_version:       str       = ""
    created_by:               str       = ""
    change_summary:           str       = ""
    change_type:              str       = ""   # manual_edit | guideline_update | ai_recommendation | draft_generated
    # [Gap 10] Link back to the recommendation that triggered this draft
    triggered_by_recommendation_id: Optional[str] = None
    triggered_by_comparison_id:     Optional[str] = None
    created_at:               datetime  = Field(default_factory=lambda: datetime.now(timezone.utc))


# ═══════════════════════════════════════════════════════
# SKILL DOCUMENT (canonical DB record)
# ═══════════════════════════════════════════════════════

class SkillDocument(BaseModel):
    skill_id:         str = Field(default_factory=lambda: str(uuid.uuid4()))
    skill_index:      str = ""
    doctor_id:        str
    doc_id:           str = ""
    skill_type:       SkillType
    disease_type:     str = ""
    subtype:          str = ""
    name:             str = ""
    description:      str = ""
    trigger_keywords: list[str] = Field(default_factory=list)
    graph_path:       str = ""

    # Versioning
    current_version:  int         = 1
    status:           SkillStatus = SkillStatus.DRAFT
    body:             dict        = Field(default_factory=dict)

    # [Gap 6] Multi-guideline traceability — replaces single source_guideline_id
    source_guidelines: list[dict] = Field(
        default_factory=list,
        description="[{guideline_id, guideline_title, version, organization}]"
    )
    # Legacy single-source fields kept for backward compatibility
    guideline:                str = ""
    guideline_version:        str = ""
    source_guideline_id:      str = ""
    source_guideline_version: str = ""
    extraction_version:       str = ""

    # [Gap 4] Full extraction audit metadata
    llm_model:         str = ""
    prompt_version:    str = ""
    embedding_model:   str = ""
    chunking_strategy: str = ""

    confidence:   dict     = Field(default_factory=dict)
    source_pages: list[int] = Field(default_factory=list)
    references:   dict     = Field(default_factory=dict)

    # Review tracking
    submitted_for_review_by: Optional[str]      = None
    submitted_for_review_at: Optional[datetime] = None
    reviewed_by:             Optional[str]      = None
    reviewed_at:             Optional[datetime] = None
    review_notes:            str                = ""
    approved_by:             Optional[str]      = None
    approved_at:             Optional[datetime] = None
    published_by:            Optional[str]      = None
    published_at:            Optional[datetime] = None
    archived_by:             Optional[str]      = None
    archived_at:             Optional[datetime] = None
    deprecated_by:           Optional[str]      = None
    deprecated_at:           Optional[datetime] = None
    deprecation_reason:      str                = ""

    # [Gap 13] Retrieval safety - always query status=published for Phase-2
    is_latest_published: bool = False

    created_at:       datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at:       datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    pipeline_version: str      = ""


# ═══════════════════════════════════════════════════════
# AUDIT LOG  (now covers both skill + guideline events)
# ═══════════════════════════════════════════════════════

class AuditLogEntry(BaseModel):
    audit_id:       str = Field(default_factory=lambda: str(uuid.uuid4()))
    # skill_id OR guideline_id, one may be empty
    skill_id:       str = ""
    guideline_id:   str = ""    # [Gap 18] guideline-level audit
    doctor_id:      str
    action:         AuditAction
    entity_type:    str = "skill"   # skill | guideline | comparison | recommendation
    from_status:    Optional[SkillStatus] = None
    to_status:      Optional[SkillStatus] = None
    from_version:   Optional[int]         = None
    to_version:     Optional[int]         = None
    change_summary: str       = ""
    change_fields:  list[str] = Field(default_factory=list)
    diff_snapshot:  dict      = Field(default_factory=dict)
    ip_address:     str       = ""
    user_agent:     str       = ""
    notes:          str       = ""
    metadata:       dict      = Field(default_factory=dict)   # flexible extra context
    created_at:     datetime  = Field(default_factory=lambda: datetime.now(timezone.utc))


# ═══════════════════════════════════════════════════════
# SKILL REVIEW (fully implemented - Gap 17)
# ═══════════════════════════════════════════════════════

class SkillReviewRequest(BaseModel):
    review_id:    str = Field(default_factory=lambda: str(uuid.uuid4()))
    skill_id:     str
    skill_type:   SkillType
    doctor_id:    str            # who submitted
    reviewer_id:  Optional[str] = None
    approver_id:  Optional[str] = None
    publisher_id: Optional[str] = None
    status:       str = "pending"   # pending | in_review | approved | rejected | published
    notes:        str = ""
    review_notes: str = ""
    reject_reason: str = ""
    version:      int = 1
    # [Gap 16] Multi-step workflow timestamps
    submitted_at:  datetime       = Field(default_factory=lambda: datetime.now(timezone.utc))
    reviewed_at:   Optional[datetime] = None
    approved_at:   Optional[datetime] = None
    published_at:  Optional[datetime] = None
    created_at:    datetime       = Field(default_factory=lambda: datetime.now(timezone.utc))


# ═══════════════════════════════════════════════════════
# SKILL REQUEST / RESPONSE MODELS
# ═══════════════════════════════════════════════════════

class SkillUpdateRequest(BaseModel):
    body:             dict
    trigger_keywords: Optional[list[str]] = None
    change_summary:   str = Field(..., min_length=5)
    change_type:      str = "manual_edit"
    # [Gap 10] Optional linkage when update is driven by recommendation/comparison
    triggered_by_recommendation_id: Optional[str] = None
    triggered_by_comparison_id:     Optional[str] = None


class SkillSearchQuery(BaseModel):
    doctor_id:    str
    skill_type:   Optional[SkillType]   = None
    disease_type: Optional[str]         = None
    subtype:      Optional[str]         = None
    status:       Optional[SkillStatus] = None
    keyword:      Optional[str]         = None
    guideline:    Optional[str]         = None
    # [Gap 13] Retrieval safety filters
    published_only:       bool = False
    latest_published_only: bool = False
    page:         int = 1
    page_size:    int = 20


class StatusTransitionRequest(BaseModel):
    action:      AuditAction
    notes:       str           = ""
    reviewer_id: Optional[str] = None


class RollbackRequest(BaseModel):
    target_version: int
    reason:         str = Field(..., min_length=5)


# ═══════════════════════════════════════════════════════
# GUIDELINE REPOSITORY
# ═══════════════════════════════════════════════════════

class GuidelineRecord(BaseModel):
    guideline_id:    str = Field(default_factory=lambda: f"GL-{str(uuid.uuid4())[:8].upper()}")
    doctor_id:       str
    title:           str
    organization:    str = ""
    disease_type:    str = ""
    specialty:       str = ""
    # [Gap 3] Stable family identifier for fuzzy matching
    family_id:       str = ""   # e.g. "NCCN-BREAST" — set on registration, never changes
    aliases:         list[str] = Field(default_factory=list)  # alternate title patterns
    current_version: str = ""
    current_doc_id:  str = ""
    status:          str = "active"   # active | superseded | retired
    created_at:      datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at:      datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class GuidelineVersionRecord(BaseModel):
    version_record_id:  str = Field(default_factory=lambda: str(uuid.uuid4()))
    guideline_id:       str
    doctor_id:          str
    version:            str
    doc_id:             str
    filename:           str                 = ""
    publication_date:   Optional[str]       = None
    uploaded_by:        str                 = ""
    upload_notes:       str                 = ""
    disease_type:       str                 = ""
    specialty:          str                 = ""
    subtypes:           list[str]           = Field(default_factory=list)
    diseases:           list[str]           = Field(default_factory=list)
    extraction_version: str                 = ""
    skill_ids:          list[str]           = Field(default_factory=list)
    knowledge_snapshot: dict                = Field(default_factory=dict)
    # [Gap 4] Full extraction audit metadata
    llm_model:         str = ""
    prompt_version:    str = ""
    embedding_model:   str = ""
    chunking_strategy: str = ""
    # [Gap 14] Guideline version lifecycle
    gov_status:        GuidelineVersionStatus = GuidelineVersionStatus.DRAFT
    reviewed_by:       Optional[str]          = None
    reviewed_at:       Optional[datetime]     = None
    approved_by:       Optional[str]          = None
    approved_at:       Optional[datetime]     = None
    published_by:      Optional[str]          = None
    published_at:      Optional[datetime]     = None
    archived_by:       Optional[str]          = None
    archived_at:       Optional[datetime]     = None
    created_at:        datetime               = Field(default_factory=lambda: datetime.now(timezone.utc))


# ═══════════════════════════════════════════════════════
# KNOWLEDGE GRAPH  [Gap 8]
# ═══════════════════════════════════════════════════════

class KnowledgeEntity(BaseModel):
    """A node in the clinical knowledge graph."""
    entity_id:    str = Field(default_factory=lambda: str(uuid.uuid4()))
    doctor_id:    str
    entity_type:  EntityType
    name:         str
    canonical:    str = ""   # normalized name for matching
    aliases:      list[str] = Field(default_factory=list)
    attributes:   dict      = Field(default_factory=dict)  # e.g. gene_symbol, stage_number
    disease_type: str       = ""
    subtype:      str       = ""
    source_guideline_ids: list[str] = Field(default_factory=list)
    created_at:   datetime  = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at:   datetime  = Field(default_factory=lambda: datetime.now(timezone.utc))


class KnowledgeRelation(BaseModel):
    """An edge in the clinical knowledge graph."""
    relation_id:   str = Field(default_factory=lambda: str(uuid.uuid4()))
    doctor_id:     str
    source_id:     str        # entity_id
    target_id:     str        # entity_id
    relation_type: str        # treats | biomarker_for | stage_of | subtype_of | contraindicates
    weight:        float = 1.0
    evidence:      str   = ""
    source_guideline_id: str = ""
    created_at:    datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class SkillEntityLink(BaseModel):
    """Links a skill to graph entities for fine-grained impact matching."""
    link_id:      str = Field(default_factory=lambda: str(uuid.uuid4()))
    skill_id:     str
    entity_id:    str
    entity_type:  EntityType
    entity_name:  str = ""
    relevance:    float = 1.0   # 0–1, higher = more central to the skill
    created_at:   datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ═══════════════════════════════════════════════════════
# COMPARISON ENGINE MODELS
# ═══════════════════════════════════════════════════════

class ChangeItem(BaseModel):
    change_id:     str = Field(default_factory=lambda: str(uuid.uuid4()))
    section:       str
    field_path:    str          = ""
    change_type:   ChangeType
    old_value:     Any          = None
    new_value:     Any          = None
    description:   str          = ""
    severity:      ImpactSeverity = ImpactSeverity.MEDIUM
    clinical_note: str          = ""
    # [Gap 5] Evidence-level change tracking
    evidence_level_change:          Optional[str] = None  # e.g. "Level III → Level I"
    recommendation_strength_change: Optional[str] = None  # e.g. "Weak → Strong"
    # [Gap 8] Entity references for fine-grained matching
    entity_ids: list[str] = Field(default_factory=list)   # which graph entities this change touches
    subtypes:   list[str] = Field(default_factory=list)
    stages:     list[str] = Field(default_factory=list)
    biomarkers: list[str] = Field(default_factory=list)


class GuidelineComparison(BaseModel):
    comparison_id:       str = Field(default_factory=lambda: str(uuid.uuid4()))
    guideline_id:        str
    doctor_id:           str
    old_version:         str
    new_version:         str
    old_doc_id:          str
    new_doc_id:          str
    total_changes:       int = 0
    additions:           int = 0
    removals:            int = 0
    modifications:       int = 0
    changes:             list[ChangeItem]            = Field(default_factory=list)
    changes_by_section:  dict[str, list[ChangeItem]] = Field(default_factory=dict)
    affected_skill_ids:  list[str]                   = Field(default_factory=list)
    impact_summary:      str = ""
    # [Gap 15] Comparison review/approval state
    review_status:   str = "pending"   # pending | reviewed | approved
    reviewed_by:     Optional[str]     = None
    reviewed_at:     Optional[datetime] = None
    approved_by:     Optional[str]     = None
    approved_at:     Optional[datetime] = None
    status:          str = "completed"
    created_at:      datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at:    Optional[datetime] = None


# ═══════════════════════════════════════════════════════
# IMPACT ANALYSIS
# ═══════════════════════════════════════════════════════

class AffectedSkillEntry(BaseModel):
    skill_id:        str
    skill_type:      str
    skill_name:      str           = ""
    subtype:         str           = ""
    disease_type:    str           = ""
    impact_sections: list[str]     = Field(default_factory=list)
    severity:        ImpactSeverity = ImpactSeverity.MEDIUM
    reason:          str           = ""
    # [Gap 7] Fine-grained matching metadata
    matched_biomarkers: list[str] = Field(default_factory=list)
    matched_stages:     list[str] = Field(default_factory=list)
    matched_subtypes:   list[str] = Field(default_factory=list)
    matched_drugs:      list[str] = Field(default_factory=list)
    match_confidence:   float     = 1.0   # 0–1, lower if only partial entity match


class ImpactAnalysisReport(BaseModel):
    impact_id:       str = Field(default_factory=lambda: str(uuid.uuid4()))
    comparison_id:   str
    guideline_id:    str
    doctor_id:       str
    old_version:     str
    new_version:     str
    affected_skills: list[AffectedSkillEntry] = Field(default_factory=list)
    total_affected:  int = 0
    critical_count:  int = 0
    high_count:      int = 0
    medium_count:    int = 0
    low_count:       int = 0
    # [Gap 7] Flag whether graph-based matching was used
    graph_matching_used: bool = False
    created_at:      datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ═══════════════════════════════════════════════════════
# AI SKILL UPDATE RECOMMENDATIONS
# ═══════════════════════════════════════════════════════

class SkillUpdateRecommendation(BaseModel):
    recommendation_id:    str = Field(default_factory=lambda: str(uuid.uuid4()))
    comparison_id:        str
    guideline_id:         str
    doctor_id:            str
    skill_id:             str
    skill_type:           str
    skill_name:           str           = ""
    triggered_by_changes: list[str]     = Field(default_factory=list)
    section_to_update:    str
    field_path:           str           = ""
    current_value:        Any           = None
    recommended_value:    Any           = None
    recommendation_text:  str
    confidence:           float         = 0.0
    reasoning:            str           = ""
    status:               RecommendationStatus = RecommendationStatus.PENDING
    doctor_notes:         str           = ""
    final_value:          Any           = None
    reviewed_by:          Optional[str] = None
    reviewed_at:          Optional[datetime] = None
    # [Gap 10] Link to the draft version created from this recommendation
    draft_version_id:     Optional[str] = None
    draft_skill_version:  Optional[int] = None
    created_at:           datetime      = Field(default_factory=lambda: datetime.now(timezone.utc))


# ═══════════════════════════════════════════════════════
# ORCHESTRATION WORKFLOW  [Gap 1]
# ═══════════════════════════════════════════════════════

class WorkflowStatus(str, Enum):
    RUNNING   = "running"
    COMPLETED = "completed"
    FAILED    = "failed"
    PARTIAL   = "partial"   # some steps succeeded, some failed


class WorkflowStepResult(BaseModel):
    step:      str          # link_version | compare | impact | recommend | draft
    status:    str          # success | skipped | failed
    message:   str  = ""
    result_id: str  = ""    # comparison_id | impact_id | etc.
    count:     int  = 0     # number of items created at this step


class GuidelineUploadWorkflowResult(BaseModel):
    """
    Result returned by the one-shot upload orchestrator.
    Covers: detect → link → compare → impact → recommend → draft.
    """
    workflow_id:     str = Field(default_factory=lambda: str(uuid.uuid4()))
    doctor_id:       str
    guideline_id:    str = ""
    doc_id:          str = ""
    version:         str = ""
    status:          WorkflowStatus = WorkflowStatus.RUNNING
    steps:           list[WorkflowStepResult] = Field(default_factory=list)
    # Convenience output IDs
    comparison_id:   str = ""
    impact_id:       str = ""
    recommendations_generated: int = 0
    drafts_generated:          int = 0
    error:           str = ""
    started_at:      datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at:    Optional[datetime] = None


# ═══════════════════════════════════════════════════════
# GUIDELINE REQUEST MODELS
# ═══════════════════════════════════════════════════════

class GuidelineRegisterRequest(BaseModel):
    title:        str
    organization: str = ""
    disease_type: str = ""
    specialty:    str = ""
    family_id:    str = ""   # [Gap 3] stable family ID
    aliases:      list[str] = Field(default_factory=list)


class GuidelineVersionLinkRequest(BaseModel):
    guideline_id:     str
    version:          str
    doc_id:           str
    publication_date: Optional[str] = None
    upload_notes:     str = ""
    # [Gap 4] extraction metadata
    llm_model:         str = ""
    prompt_version:    str = ""
    embedding_model:   str = ""
    chunking_strategy: str = ""


class CompareGuidelinesRequest(BaseModel):
    guideline_id: str
    old_doc_id:   str
    new_doc_id:   str


class RecommendationReviewRequest(BaseModel):
    recommendation_id: str
    action:            RecommendationStatus
    doctor_notes:      str = ""
    final_value:       Any = None


class BulkRecommendationReview(BaseModel):
    reviews: list[RecommendationReviewRequest]


# [Gap 15] Comparison review/approval
class ComparisonReviewRequest(BaseModel):
    comparison_id: str
    action:        str   # reviewed | approved
    notes:         str = ""


# [Gap 14] Guideline version lifecycle transition
class GuidelineVersionTransitionRequest(BaseModel):
    version_record_id: str
    action:            str   # approve | publish | archive
    notes:             str = ""


# [Gap 1] One-shot upload orchestration
class GuidelineUploadWorkflowRequest(BaseModel):
    """
    Single call that runs the full governance pipeline:
    detect → register/link → compare → impact → recommend → auto-draft.
    """
    doc_id:                str
    version:               str
    title:                 str
    organization:          str = ""
    disease_type:          str = ""
    specialty:             str = ""
    publication_date:      Optional[str] = None
    upload_notes:          str = ""
    family_id:             str = ""
    aliases:               list[str] = Field(default_factory=list)
    # [Gap 4] extraction metadata
    llm_model:             str = ""
    prompt_version:        str = ""
    embedding_model:       str = ""
    chunking_strategy:     str = ""
    # Workflow control flags
    auto_compare:          bool = True   # compare vs previous version automatically
    auto_impact:           bool = True
    auto_recommend:        bool = True
    auto_draft:            bool = False  # requires explicit opt-in for safety


# ═══════════════════════════════════════════════════════
# GOVERNANCE DASHBOARD & AUDIT REPORT
# ═══════════════════════════════════════════════════════

class GovernanceDashboard(BaseModel):
    doctor_id:               str
    pending_reviews:         int = 0
    pending_publications:    int = 0
    draft_skills:            int = 0
    approved_skills:         int = 0
    published_skills:        int = 0
    archived_skills:         int = 0
    deprecated_skills:       int = 0
    total_skills:            int = 0
    pending_comparisons:     int = 0
    pending_recommendations: int = 0
    # [Gap 12] Extended dashboard metrics
    guidelines_updated_30d:      int = 0
    skills_impacted_30d:         int = 0
    rejected_recommendations:    int = 0
    pending_comparison_reviews:  int = 0
    archived_guideline_versions: int = 0
    auto_drafts_pending_review:  int = 0
    recent_activity:             list[dict] = Field(default_factory=list)
    by_disease:                  dict[str, int] = Field(default_factory=dict)
    by_skill_type:               dict[str, int] = Field(default_factory=dict)
    by_guideline_org:            dict[str, int] = Field(default_factory=dict)
    generated_at:                datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ChangeAuditReport(BaseModel):
    report_id:     str = Field(default_factory=lambda: str(uuid.uuid4()))
    doctor_id:     str
    skill_id:      Optional[str]      = None
    guideline_id:  Optional[str]      = None   # [Gap 18]
    entity_type:   Optional[str]      = None   # skill | guideline | all
    date_from:     Optional[datetime] = None
    date_to:       Optional[datetime] = None
    actions:       list[str]          = Field(default_factory=list)
    audit_entries: list[dict]         = Field(default_factory=list)
    total:         int                = 0
    generated_at:  datetime           = Field(default_factory=lambda: datetime.now(timezone.utc))


# ═══════════════════════════════════════════════════════
# RETRIEVAL SAFETY  [Gap 13]
# ═══════════════════════════════════════════════════════

class SkillRetrievalQuery(BaseModel):
    """
    Used by Phase-2 retrieval. Enforces published-only, latest-version access.
    """
    doctor_id:    str
    skill_type:   Optional[SkillType] = None
    disease_type: Optional[str]       = None
    subtype:      Optional[str]       = None
    keywords:     list[str]           = Field(default_factory=list)
    # Safety enforcement: Phase-2 always sets these True
    published_only:        bool = True
    latest_version_only:   bool = True


class PublishedSkillSummary(BaseModel):
    """Lightweight projection for Phase-2 retrieval — body excluded until explicitly fetched."""
    skill_id:         str
    skill_type:       str
    name:             str
    disease_type:     str = ""
    subtype:          str = ""
    current_version:  int = 1
    published_at:     Optional[datetime] = None
    trigger_keywords: list[str] = Field(default_factory=list)
    is_latest_published: bool = True