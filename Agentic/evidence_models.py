"""
models.py
=========
Single source of truth for the Agentic Graph RAG clinical pipeline.

Covers all 8 pipeline stages:
  Stage 1  — Document Ingestion & Parsing
  Stage 2  — Clinical Entity Extraction  (13 node types)
  Stage 3  — Relationship Extraction     (30 edge types)
  Stage 4  — Knowledge Graph Construction
  Stage 5  — Protocol Pathway Extraction
  Stage 6  — Guideline Delta Detection
  Stage 7  — Evidence Linking
  Stage 8  — Agentic Reasoning

All enums and Pydantic models used by ingestion.py and rag_pipeline.py
live here. Import ONLY from this file — never cross-import between
ingestion.py and rag_pipeline.py.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Union
from uuid import uuid4


from pydantic import BaseModel, Field




# ═══════════════════════════════════════════════════════════════════
# SECTION 1 — SOURCE / INGESTION ENUMS
# ═══════════════════════════════════════════════════════════════════

class SourceType(str, Enum):
    PDF      = "pdf"
    DOCUMENT = "document"
    LINK     = "link"
    TEXT     = "text"


class GuidelineSource(str, Enum):
    NCCN   = "nccn"
    ACOG   = "acog"
    ESMO   = "esmo"
    NEJM   = "nejm"
    LANCET = "lancet"
    ASCO   = "asco"
    OTHER  = "other"


class DocumentType(str, Enum):
    CLINICAL_PRACTICE_GUIDELINE = "clinical_practice_guideline"
    RCT                         = "rct"
    SYSTEMATIC_REVIEW           = "systematic_review"
    META_ANALYSIS               = "meta_analysis"
    COHORT_STUDY                = "cohort_study"
    CASE_CONTROL_STUDY          = "case_control_study"
    EXPERT_CONSENSUS            = "expert_consensus"
    JOURNAL_ARTICLE             = "journal_article"
    ASCO_UPDATE                 = "asco_update"
    NCCN_UPDATE                 = "nccn_update"


# ═══════════════════════════════════════════════════════════════════
# SECTION 2 — DOCUMENT SOURCE & PARSED DOCUMENT
# ═══════════════════════════════════════════════════════════════════

class DocumentSource(BaseModel):
    source_id:        str             = Field(default_factory=lambda: f"src_{uuid4().hex[:10]}")
    source_type:      SourceType
    guideline_source: GuidelineSource = GuidelineSource.OTHER
    name:             str
    version:          Optional[str]   = None
    raw_text:         Optional[str]   = None
    page_count:       Optional[int]   = None
    created_at:       str             = Field(default_factory=lambda: datetime.utcnow().isoformat())


class DocumentSection(BaseModel):
    title:        str           = ""
    content:      str           = ""
    section_type: str           = "other"   # recommendation|evidence_summary|methodology|
                                             # background|patient_population|outcomes|
                                             # contraindications|biomarkers|protocol_steps|
                                             # references|other
    page_number:  Optional[int] = None


class ParsedDocument(BaseModel):
    """Output of Stage 1 — DocumentParsingAgent."""
    source_id:        str
    source_type:      SourceType
    guideline_source: GuidelineSource
    source_name:      str
    version:          Optional[str]          = None
    document_type:    Optional[DocumentType] = None
    raw_text:         str                    = ""
    sections:         List[DocumentSection]  = Field(default_factory=list)
    parsed_at:        str                    = Field(default_factory=lambda: datetime.utcnow().isoformat())

    chunk_records: List[Any] = Field(default_factory=list)
    coverage_score: Optional[Dict[str, Any]] = None


# ═══════════════════════════════════════════════════════════════════
# SECTION 3 — NODE TYPE ENUMS
# ═══════════════════════════════════════════════════════════════════

class NodeType(str, Enum):
    # Core 7 (used by entity extraction agent)
    DISEASE           = "disease"
    DRUG              = "drug"
    STUDY             = "study"
    BIOMARKER         = "biomarker"
    RECOMMENDATION    = "recommendation"
    PATIENT_SUBGROUP  = "patient_subgroup"
    OUTCOME           = "outcome"
    # Extended 6 (from rich schema)
    SYMPTOM_SIGN      = "symptom_sign"
    DIAGNOSTIC_TEST   = "diagnostic_test"
    RISK_FACTOR       = "risk_factor"
    SURGICAL_PROCEDURE = "surgical_procedure"
    CLASSIFICATION_SYSTEM = "classification_system"
    RESEARCH_GAP      = "research_gap"


class NodeColorGroup(str, Enum):
    DISEASE        = "disease"
    DRUG           = "drug"
    STUDY          = "study"
    BIOMARKER      = "biomarker"
    RECOMMENDATION = "recommendation"
    SUBGROUP       = "subgroup"
    OUTCOME        = "outcome"
    SYMPTOM        = "symptom"
    TEST           = "test"
    RISK           = "risk"
    SURGICAL       = "surgical"
    CLASSIFICATION = "classification"
    RESEARCH       = "research"


class NodeFlag(str, Enum):
    NEW_IN_VERSION       = "new_in_version"
    CHANGED_IN_VERSION   = "changed_in_version"
    CONTRAINDICATED      = "contraindicated"
    EQUITY_CONSIDERATION = "equity_consideration"
    SHARED_DECISION_MAKING = "shared_decision_making"
    AWAITS_RESEARCH      = "awaits_research"
    HIGH_IMPACT_CHANGE   = "high_impact_change"
    URGENT               = "urgent"


# ═══════════════════════════════════════════════════════════════════
# SECTION 4 — NODE MODELS
# ═══════════════════════════════════════════════════════════════════

class BaseNode(BaseModel):
    id:               str
    type:             NodeType
    label:            str                        # ≤ 6 words
    description:      str                        # 1–3 sentences
    source_quote:     str                        # verbatim excerpt ≤ 60 words
    page_ref:         Optional[str]  = None
    source_id:        Optional[str]  = None
    guideline_source: Optional[str]  = None
    version:          Optional[str]  = None
    color_group:      NodeColorGroup = NodeColorGroup.RECOMMENDATION
    visual_priority:  int            = Field(ge=1, le=3, default=2)
    flags:            List[NodeFlag] = Field(default_factory=list)
    cluster:          Optional[str]  = None
    chunk_id: Optional[int] = None


class DiseaseNode(BaseNode):
    type:       NodeType      = NodeType.DISEASE
    color_group: NodeColorGroup = NodeColorGroup.DISEASE
    icd_code:   Optional[str] = None
    stage:      Optional[str] = None
    subtype:    Optional[str] = None


class DrugNode(BaseNode):
    type:              NodeType        = NodeType.DRUG
    color_group:       NodeColorGroup  = NodeColorGroup.DRUG
    drug_name:         str             = ""
    drug_class:        Optional[str]   = None
    mechanism:         Optional[str]   = None
    approval_status:   Optional[str]   = None
    contraindications: List[str]       = Field(default_factory=list)
    line_of_therapy:   Optional[str]   = None


class StudyNode(BaseNode):
    type:              NodeType        = NodeType.STUDY
    color_group:       NodeColorGroup  = NodeColorGroup.STUDY
    study_name:        str             = ""
    study_type:        Optional[str]   = None   # StudyType value
    n_participants:    Optional[int]   = None
    primary_endpoint:  Optional[str]   = None
    key_finding:       Optional[str]   = None
    p_value:           Optional[str]   = None
    statistic_type:    Optional[str]   = None
    statistic_value:   Optional[float] = None
    publication_year:  Optional[int]   = None
    journal:           Optional[str]   = None


class BiomarkerNode(BaseNode):
    type:              NodeType        = NodeType.BIOMARKER
    color_group:       NodeColorGroup  = NodeColorGroup.BIOMARKER
    biomarker_name:    str             = ""
    biomarker_type:    Optional[str]   = None   # predictive|prognostic|diagnostic
    specimen_type:     Optional[str]   = None
    threshold:         Optional[str]   = None
    sensitivity:       Optional[float] = None
    specificity:       Optional[float] = None
    clinical_utility:  Optional[str]   = None


class RecommendationStrength(str, Enum):
    STRONG_FOR          = "strong_for"
    STRONG_AGAINST      = "strong_against"
    CONDITIONAL_FOR     = "conditional_for"
    CONDITIONAL_AGAINST = "conditional_against"
    GOOD_PRACTICE_POINT = "good_practice_point"


class EvidenceQuality(str, Enum):
    HIGH     = "high"
    MODERATE = "moderate"
    LOW      = "low"
    VERY_LOW = "very_low"
    UNGRADED = "ungraded"


class RecommendationNode(BaseNode):
    type:                 NodeType               = NodeType.RECOMMENDATION
    color_group:          NodeColorGroup          = NodeColorGroup.RECOMMENDATION
    strength:             RecommendationStrength  = RecommendationStrength.CONDITIONAL_FOR
    evidence_quality:     EvidenceQuality         = EvidenceQuality.UNGRADED
    recommendation_text:  str                     = ""
    clinical_context:     str                     = ""
    is_new:               bool                    = False


class PatientSubgroupNode(BaseNode):
    type:                   NodeType       = NodeType.PATIENT_SUBGROUP
    color_group:            NodeColorGroup = NodeColorGroup.SUBGROUP
    subgroup_label:         str            = ""
    defining_characteristics: List[str]   = Field(default_factory=list)
    biomarker_defined:      bool           = False
    special_considerations: List[str]      = Field(default_factory=list)
    equity_note:            Optional[str]  = None


class OutcomeType(str, Enum):
    CLINICAL         = "clinical"
    PATIENT_REPORTED = "patient_reported"
    SAFETY           = "safety"
    ECONOMIC         = "economic"


class OutcomeDirection(str, Enum):
    BENEFIT   = "benefit"
    HARM      = "harm"
    NEUTRAL   = "neutral"
    UNCERTAIN = "uncertain"


class OutcomeNode(BaseNode):
    type:         NodeType        = NodeType.OUTCOME
    color_group:  NodeColorGroup  = NodeColorGroup.OUTCOME
    outcome_name: str             = ""
    outcome_type: OutcomeType     = OutcomeType.CLINICAL
    direction:    OutcomeDirection = OutcomeDirection.UNCERTAIN
    magnitude:    Optional[str]   = None
    time_horizon: Optional[str]   = None


# Extended nodes

class SymptomSignNode(BaseNode):
    type:        NodeType       = NodeType.SYMPTOM_SIGN
    color_group: NodeColorGroup = NodeColorGroup.SYMPTOM
    symptom_name: str           = ""
    pattern:      Optional[str] = None
    anatomic_domain: List[str]  = Field(default_factory=list)


class DiagnosticTestNode(BaseNode):
    type:             NodeType       = NodeType.DIAGNOSTIC_TEST
    color_group:      NodeColorGroup = NodeColorGroup.TEST
    modality:         str            = ""
    sensitivity:      Optional[float] = None
    specificity:      Optional[float] = None
    limitations:      List[str]      = Field(default_factory=list)


class RiskFactorNode(BaseNode):
    type:        NodeType       = NodeType.RISK_FACTOR
    color_group: NodeColorGroup = NodeColorGroup.RISK
    factor_name: str            = ""
    direction:   str            = "increases_risk"
    magnitude:   Optional[str]  = None


class SurgicalProcedureNode(BaseNode):
    type:           NodeType       = NodeType.SURGICAL_PROCEDURE
    color_group:    NodeColorGroup = NodeColorGroup.SURGICAL
    procedure_name: str            = ""
    role:           str            = "therapeutic"
    indication:     str            = ""
    complications:  List[str]      = Field(default_factory=list)


class ClassificationSystemNode(BaseNode):
    type:                 NodeType       = NodeType.CLASSIFICATION_SYSTEM
    color_group:          NodeColorGroup = NodeColorGroup.CLASSIFICATION
    system_name:          str            = ""
    stages_or_categories: List[str]      = Field(default_factory=list)
    limitations:          List[str]      = Field(default_factory=list)


class ResearchGapNode(BaseNode):
    type:              NodeType       = NodeType.RESEARCH_GAP
    color_group:       NodeColorGroup = NodeColorGroup.RESEARCH
    gap_description:   str            = ""
    proposed_approach: Optional[str]  = None


AnyNode = Union[
    DiseaseNode, DrugNode, StudyNode, BiomarkerNode,
    RecommendationNode, PatientSubgroupNode, OutcomeNode,
    SymptomSignNode, DiagnosticTestNode, RiskFactorNode,
    SurgicalProcedureNode, ClassificationSystemNode, ResearchGapNode,
]


# ═══════════════════════════════════════════════════════════════════
# SECTION 5 — EDGE MODELS
# ═══════════════════════════════════════════════════════════════════

class EdgeRelation(str, Enum):
    # Treatment
    TREATS              = "treats"
    CONTRAINDICATED     = "contraindicated"
    FIRST_LINE_FOR      = "first_line_for"
    SECOND_LINE_AFTER   = "second_line_after"
    REPLACES            = "replaces"
    # Evidence hierarchy
    UPGRADES            = "upgrades"
    DOWNGRADES          = "downgrades"
    SUPPORTED_BY        = "supported_by"
    SUPERIOR_TO         = "superior_to"
    COMPARABLE_TO       = "comparable_to"
    # Clinical logic
    RECOMMENDS          = "recommends"
    RECOMMENDS_AGAINST  = "recommends_against"
    INDICATED_FOR       = "indicated_for"
    IMPROVES            = "improves"
    ASSOCIATED_WITH     = "associated_with"
    STUDIED_IN          = "studied_in"
    AFFECTS_SUBGROUP    = "affects_subgroup"
    PREDICTS            = "predicts"
    MONITORS            = "monitors"
    # Diagnostic
    CONFIRMS_DIAGNOSIS_OF = "confirms_diagnosis_of"
    CANNOT_DETECT       = "cannot_detect"
    GUIDES_PLANNING_OF  = "guides_planning_of"
    # Pathway
    PRESENTS_WITH       = "presents_with"
    INCREASES_RISK_OF   = "increases_risk_of"
    MIMICS              = "mimics"
    DISTINGUISHED_FROM  = "distinguished_from"
    APPLIES_TO          = "applies_to"
    FACILITATES_DIAGNOSIS_OF = "facilitates_diagnosis_of"
    DELAYS_DIAGNOSIS_OF = "delays_diagnosis_of"


class GraphEdge(BaseModel):
    id:               str
    source:           str
    target:           str
    relation:         EdgeRelation
    weight:           int          = Field(ge=1, le=5, default=2)
    label:            str          = ""
    evidence_basis:   str          = ""
    source_id:        Optional[str] = None
    guideline_source: Optional[GuidelineSource] = None
    version:          Optional[str] = None
    bidirectional:    bool          = False
    is_new:           bool          = False


# ═══════════════════════════════════════════════════════════════════
# SECTION 6 — PROTOCOL PATHWAY MODELS  (Stage 5)
# ═══════════════════════════════════════════════════════════════════

class ProtocolStep(BaseModel):
    step_number:          int
    action:               str
    node_id:              str
    node_type:            NodeType       = NodeType.RECOMMENDATION
    condition_to_proceed: Optional[str]  = None
    condition_to_stop:    Optional[str]  = None
    branch_positive:      Optional[str]  = None
    branch_negative:      Optional[str]  = None
    time_constraint:      Optional[str]  = None
    notes:                Optional[str]  = None


class ProtocolFlowGraph(BaseModel):
    id:                    str
    name:                  str
    clinical_question:     str
    applicable_population: str
    steps:                 List[ProtocolStep]   = Field(default_factory=list)
    entry_criteria:        str                  = ""
    terminal_outcomes:     List[str]            = Field(default_factory=list)
    source_id:             Optional[str]        = None
    guideline_source:      Optional[GuidelineSource] = None
    version:               Optional[str]        = None


# ═══════════════════════════════════════════════════════════════════
# SECTION 7 — GUIDELINE DELTA MODELS  (Stage 6)
# ═══════════════════════════════════════════════════════════════════

class DeltaChangeType(str, Enum):
    NEW_RECOMMENDATION       = "new_recommendation"
    REMOVED_RECOMMENDATION   = "removed_recommendation"
    UPGRADED_EVIDENCE        = "upgraded_evidence"
    DOWNGRADED_EVIDENCE      = "downgraded_evidence"
    NEW_CONTRAINDICATION     = "new_contraindication"
    REMOVED_CONTRAINDICATION = "removed_contraindication"
    PATHWAY_MODIFIED         = "pathway_modified"
    SUBGROUP_ADDED           = "subgroup_added"
    SUBGROUP_REMOVED         = "subgroup_removed"
    DRUG_REPLACED            = "drug_replaced"
    BIOMARKER_ADDED          = "biomarker_added"
    STRENGTH_CHANGED         = "strength_changed"


class DeltaImpactLevel(str, Enum):
    HIGH   = "high"
    MEDIUM = "medium"
    LOW    = "low"


class AffectedPatientSubgroup(BaseModel):
    subgroup_label: str
    impact_summary: str


class GuidelineDelta(BaseModel):
    id:                    str             = Field(default_factory=lambda: f"delta_{uuid4().hex[:8]}")
    change_type:           DeltaChangeType
    impact_level:          DeltaImpactLevel
    what_changed:          str
    old_value:             Optional[str]   = None
    new_value:             Optional[str]   = None
    why_changed:           str             = ""
    evidence_node_ids:     List[str]       = Field(default_factory=list)
    affected_subgroups:    List[AffectedPatientSubgroup] = Field(default_factory=list)
    modified_pathway_ids:  List[str]       = Field(default_factory=list)
    now_contraindicated:   List[str]       = Field(default_factory=list)
    stronger_evidence_ids: List[str]       = Field(default_factory=list)
    weaker_evidence_ids:   List[str]       = Field(default_factory=list)
    source_guideline:      Optional[GuidelineSource] = None
    prior_version:         Optional[str]   = None
    current_version:       Optional[str]   = None
    source_id:             Optional[str]   = None
    page_ref:              Optional[str]   = None
    source_quote:          str             = ""


# ═══════════════════════════════════════════════════════════════════
# SECTION 8 — EVIDENCE IMPACT MODELS  (Stage 7)
# ═══════════════════════════════════════════════════════════════════

class StudyType(str, Enum):
    RCT               = "rct"
    META_ANALYSIS     = "meta_analysis"
    SYSTEMATIC_REVIEW = "systematic_review"
    COHORT            = "cohort"
    CASE_CONTROL      = "case_control"
    CROSS_SECTIONAL   = "cross_sectional"
    EXPERT_OPINION    = "expert_opinion"


class StatisticType(str, Enum):
    OR          = "OR"
    RR          = "RR"
    HR          = "HR"
    SENSITIVITY = "sensitivity"
    SPECIFICITY = "specificity"
    AUC         = "AUC"
    PREVALENCE  = "prevalence"
    INCIDENCE   = "incidence"
    OTHER       = "other"


class EvidenceImpactEntry(BaseModel):
    id:                  str             = Field(default_factory=lambda: f"evi_{uuid4().hex[:8]}")
    study_node_id:       str
    study_type:          StudyType       = StudyType.COHORT
    finding:             str
    statistic_type:      Optional[StatisticType] = None
    statistic_value:     Optional[float] = None
    ci_lower:            Optional[float] = None
    ci_upper:            Optional[float] = None
    p_value:             Optional[str]   = None
    evidence_quality:    EvidenceQuality = EvidenceQuality.UNGRADED
    supports_node_ids:   List[str]       = Field(default_factory=list)
    modifies_edge_ids:   List[str]       = Field(default_factory=list)
    impacts_pathway_ids: List[str]       = Field(default_factory=list)
    citation_text:       str             = ""
    limitation:          Optional[str]   = None


# ═══════════════════════════════════════════════════════════════════
# SECTION 9 — AGENTIC REASONING MODELS  (Stage 8)
# ═══════════════════════════════════════════════════════════════════

class AgentRole(str, Enum):
    DOCUMENT_PARSER      = "document_parser"
    ENTITY_EXTRACTOR     = "entity_extractor"
    RELATIONSHIP_EXTRACTOR = "relationship_extractor"
    GRAPH_BUILDER        = "graph_builder"
    PATHWAY_EXTRACTOR    = "pathway_extractor"
    DELTA_DETECTOR       = "delta_detector"
    EVIDENCE_LINKER      = "evidence_linker"
    REASONING_AGENT      = "reasoning_agent"


class ReasoningStepType(str, Enum):
    OBSERVATION  = "observation"
    HYPOTHESIS   = "hypothesis"
    EVIDENCE_PULL = "evidence_pull"
    GRAPH_QUERY  = "graph_query"
    CONCLUSION   = "conclusion"
    UNCERTAINTY  = "uncertainty"


class ReasoningStep(BaseModel):
    step_number:   int
    step_type:     ReasoningStepType = ReasoningStepType.OBSERVATION
    content:       str
    node_ids_used: List[str]         = Field(default_factory=list)
    edge_ids_used: List[str]         = Field(default_factory=list)
    confidence:    float             = 0.8


class ClinicalReasoningChain(BaseModel):
    id:                         str             = Field(default_factory=lambda: f"chain_{uuid4().hex[:8]}")
    clinical_question:          str
    agent_role:                 AgentRole       = AgentRole.REASONING_AGENT
    steps:                      List[ReasoningStep] = Field(default_factory=list)
    # 7 doctor questions
    what_changed:               Optional[str]   = None
    why_changed:                Optional[str]   = None
    affected_patient_groups:    List[str]        = Field(default_factory=list)
    modified_pathway:           Optional[str]   = None
    evidence_that_caused_change: List[str]      = Field(default_factory=list)
    now_contraindicated:        List[str]        = Field(default_factory=list)
    stronger_evidence:          List[str]        = Field(default_factory=list)
    weaker_evidence:            List[str]        = Field(default_factory=list)
    final_answer:               str              = ""
    confidence:                 float            = 0.8
    graph_nodes_visited:        List[str]        = Field(default_factory=list)
    delta_ids_referenced:       List[str]        = Field(default_factory=list)


# ═══════════════════════════════════════════════════════════════════
# SECTION 10 — AGENT OUTPUT AUDIT
# ═══════════════════════════════════════════════════════════════════

class AgentOutput(BaseModel):
    """Audit record produced by each pipeline stage agent."""
    agent_name:       str
    agent_role:       AgentRole
    source_id:        str                   = ""
    nodes:            List[Dict[str, Any]]  = Field(default_factory=list)
    edges:            List[Dict[str, Any]]  = Field(default_factory=list)
    pathways:         List[Dict[str, Any]]  = Field(default_factory=list)
    deltas:           List[Dict[str, Any]]  = Field(default_factory=list)
    evidence:         List[Dict[str, Any]]  = Field(default_factory=list)
    reasoning_chains: List[Dict[str, Any]]  = Field(default_factory=list)
    confidence:       float                 = Field(ge=0.0, le=1.0, default=0.9)
    reasoning:        Optional[str]         = None


# ═══════════════════════════════════════════════════════════════════
# SECTION 11 — GRAPH CONFIG  (frontend layout hints)
# ═══════════════════════════════════════════════════════════════════

class GraphConfig(BaseModel):
    node_color_map: Dict[str, str] = Field(default_factory=lambda: {
        "disease":        "#FF6B6B",
        "drug":           "#4ECDC4",
        "study":          "#45B7D1",
        "biomarker":      "#96CEB4",
        "recommendation": "#FFEAA7",
        "subgroup":       "#DDA0DD",
        "outcome":        "#98D8C8",
        "symptom":        "#F7DC6F",
        "test":           "#85C1E9",
        "risk":           "#F1948A",
        "surgical":       "#82E0AA",
        "classification": "#AED6F1",
        "research":       "#D7BDE2",
    })
    edge_style_map: Dict[str, Dict[str, Any]] = Field(default_factory=lambda: {
        "treats":           {"style": "solid",      "color": "#2ECC71", "weight": 4},
        "contraindicated":  {"style": "dashed",     "color": "#E74C3C", "weight": 4},
        "first_line_for":   {"style": "solid_bold", "color": "#3498DB", "weight": 5},
        "second_line_after":{"style": "dashed",     "color": "#95A5A6", "weight": 2},
        "recommends":       {"style": "solid",      "color": "#27AE60", "weight": 3},
        "recommends_against":{"style":"dashed",     "color": "#C0392B", "weight": 3},
        "supported_by":     {"style": "dotted",     "color": "#7F8C8D", "weight": 2},
        "upgrades":         {"style": "solid",      "color": "#2980B9", "weight": 3},
        "downgrades":       {"style": "dashed",     "color": "#E67E22", "weight": 3},
        "associated_with":  {"style": "dotted",     "color": "#BDC3C7", "weight": 1},
    })
    recommended_layout: str  = "force_directed"
    cluster_as_layers:  bool = True
    default_filter:     str  = "visual_priority_1_2"


# ═══════════════════════════════════════════════════════════════════
# SECTION 12 — DOCUMENT METADATA
# ═══════════════════════════════════════════════════════════════════

class ReplacedDocument(BaseModel):
    title: str
    year:  str


class DocumentMetadata(BaseModel):
    title:              str
    document_type:      DocumentType
    guideline_source:   Optional[GuidelineSource] = None
    version:            Optional[str]             = None
    issuing_body:       Optional[str]             = None
    publication_date:   Optional[str]             = None
    target_population:  Optional[str]             = None
    condition:          Optional[str]             = None
    purpose:            Optional[str]             = None
    replaces:           List[ReplacedDocument]    = Field(default_factory=list)
    evidence_framework: Optional[str]             = None


# ═══════════════════════════════════════════════════════════════════
# SECTION 13 — MASTER PIPELINE OUTPUT
# ═══════════════════════════════════════════════════════════════════

class ClinicalKnowledgeGraph(BaseModel):
    """
    Complete output of one Agentic Graph RAG pipeline run.
    Consumed by the React/D3 frontend and by the reasoning agent.
    """
    pipeline_id:      str                          = Field(default_factory=lambda: f"ckg_{uuid4().hex[:12]}")
    generated_at:     str                          = Field(default_factory=lambda: datetime.utcnow().isoformat())
    source_names:     List[str]                    = Field(default_factory=list)
    source_versions:  Dict[str, str]               = Field(default_factory=dict)

    # Parts 1–8 outputs
    metadata:         List[DocumentMetadata]       = Field(default_factory=list)
    nodes:            List[Dict[str, Any]]          = Field(default_factory=list)
    edges:            List[GraphEdge]              = Field(default_factory=list)
    protocol_graphs:  List[ProtocolFlowGraph]      = Field(default_factory=list)
    deltas:           List[GuidelineDelta]         = Field(default_factory=list)
    evidence_map:     List[EvidenceImpactEntry]    = Field(default_factory=list)
    reasoning_chains: List[ClinicalReasoningChain] = Field(default_factory=list)
    graph_config:     GraphConfig                  = Field(default_factory=GraphConfig)

    # Audit trail
    agent_outputs:    List[AgentOutput]            = Field(default_factory=list)

    # Summary counts (computed via compute_summary())
    total_nodes:      int = 0
    total_edges:      int = 0
    total_pathways:   int = 0
    total_deltas:     int = 0
    total_evidence:   int = 0
    total_chains:     int = 0

    def compute_summary(self) -> None:
        self.total_nodes    = len(self.nodes)
        self.total_edges    = len(self.edges)
        self.total_pathways = len(self.protocol_graphs)
        self.total_deltas   = len(self.deltas)
        self.total_evidence = len(self.evidence_map)
        self.total_chains   = len(self.reasoning_chains)


# ═══════════════════════════════════════════════════════════════════
# SECTION 14 — API REQUEST / RESPONSE MODELS
# ═══════════════════════════════════════════════════════════════════

class PipelineRunRequest(BaseModel):
    urls:    List[str]      = Field(default_factory=list)
    options: Dict[str, Any] = Field(default_factory=dict)


class PipelineRunResponse(BaseModel):
    status:          str
    pipeline_id:     str
    total_nodes:     int
    total_edges:     int
    total_pathways:  int
    total_deltas:    int
    total_evidence:  int
    total_chains:    int
    source_names:    List[str]
    source_versions: Dict[str, str]
    graph:           Dict[str, Any]


class DeltaQueryRequest(BaseModel):
    clinical_question: str
    pipeline_id:       Optional[str] = None


class DeltaQueryResponse(BaseModel):
    pipeline_id:                 str
    clinical_question:           str
    what_changed:                Optional[str]  = None
    why_changed:                 Optional[str]  = None
    affected_patient_groups:     List[str]       = Field(default_factory=list)
    modified_pathway:            Optional[str]  = None
    evidence_that_caused_change: List[str]       = Field(default_factory=list)
    now_contraindicated:         List[str]       = Field(default_factory=list)
    stronger_evidence:           List[str]       = Field(default_factory=list)
    weaker_evidence:             List[str]       = Field(default_factory=list)
    reasoning_chain_id:          Optional[str]  = None
    confidence:                  float           = 0.0