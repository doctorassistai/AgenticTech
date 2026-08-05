"""
models.py — Step 1
==================
All Pydantic models== for the clinical graph pipeline.
Graph is built around the DOCTORdoctor_id is the primary identity).
Patient data is stored as metadata/provenance only — not the graph key.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import uuid4

from pydantic import BaseModel, Field, validator


# ─────────────────────────────────────────────
# ENUMERATIONS
# ─────────────────────────────────────────────

class NodeType(str, Enum):
    FINDING      = "Finding"
    CONDITION    = "Condition"
    ABNORMALITY  = "Abnormality"
    DECISION     = "Decision"
    OUTCOME      = "Outcome"
    DOCTOR_SKILL = "DoctorSkill"


class EdgeType(str, Enum):
    HAS_FINDING        = "HAS_FINDING"
    CAUSES             = "CAUSES"
    TRIGGERS_DECISION  = "TRIGGERS_DECISION"
    LEADS_TO           = "LEADS_TO"
    CONTRADICTS        = "CONTRADICTS"
    REWORK_OF          = "REWORK_OF"
    MATCHES_SKILL      = "MATCHES_SKILL"
    ASSOCIATED_WITH    = "ASSOCIATED_WITH"


class AbnormalDirection(str, Enum):
    HIGH    = "HIGH"
    LOW     = "LOW"
    ABSENT  = "ABSENT"
    PRESENT = "PRESENT"
    CHANGED = "CHANGED"


class DecisionActionType(str, Enum):
    INVESTIGATION = "investigation"
    MEDICATION    = "medication"
    REFERRAL      = "referral"
    PROCEDURE     = "procedure"
    MONITORING    = "monitoring"
    COUNSELLING   = "counselling"


class Urgency(str, Enum):
    IMMEDIATE = "immediate"
    URGENT    = "urgent"
    ROUTINE   = "routine"
    ELECTIVE  = "elective"


class Severity(str, Enum):
    CRITICAL = "critical"
    HIGH     = "high"
    MODERATE = "moderate"
    LOW      = "low"
    NORMAL   = "normal"


# ─────────────────────────────────────────────
# NODE ATTRIBUTE MODELS
# ─────────────────────────────────────────────

class FindingAttrs(BaseModel):
    """Attributes for a Finding node — raw clinical observation."""
    entity_name: str
    value: Optional[str]           = None
    numeric_value: Optional[float] = None
    unit: Optional[str]            = None
    source_doc: Optional[str]      = None
    # CHANGED: doctor_id replaces patient_id as primary provenance
    doctor_id: Optional[str]       = None
    # patient_id kept as audit metadata only
    patient_id: Optional[str]      = None
    timestamp: Optional[str]       = None
    entity_type: Optional[str]     = None
    raw_text: Optional[str]        = None


class ConditionAttrs(BaseModel):
    """Attributes for a Condition node — diagnosed or inferred clinical condition."""
    name: str
    icd_code: Optional[str]        = None
    speciality: Optional[str]      = None
    severity: Optional[Severity]   = None
    status: Optional[str]          = None
    staging: Optional[str]         = None
    onset: Optional[str]           = None
    source_doc: Optional[str]      = None


class AbnormalityAttrs(BaseModel):
    """Attributes for an Abnormality node."""
    entity_name: str
    value: Optional[str]                   = None
    numeric_value: Optional[float]         = None
    unit: Optional[str]                    = None
    normal_range: Optional[str]            = None
    direction: AbnormalDirection
    clinical_significance: Severity
    explanation: Optional[str]             = None
    source_doc: Optional[str]              = None


class DecisionAttrs(BaseModel):
    """Attributes for a Decision node."""
    action_type: DecisionActionType
    action_name: str
    rationale: Optional[str]               = None
    urgency: Urgency                       = Urgency.ROUTINE
    specific_detail: Optional[str]         = None
    guideline_reference: Optional[str]     = None
    source_doc: Optional[str]              = None


class OutcomeAttrs(BaseModel):
    """Attributes for an Outcome node."""
    result: Optional[str]                  = None
    improvement: Optional[bool]            = None
    follow_up_required: bool               = False
    rework_triggered: bool                 = False
    rework_reason: Optional[str]           = None
    source_doc: Optional[str]             = None


class DoctorSkillAttrs(BaseModel):
    """Attributes for a DoctorSkill node — promoted clinical pattern for a doctor."""
    doctor_id: str
    pattern_summary: str
    speciality: Optional[str]              = None
    confidence: float
    promoted_at: str                       = Field(default_factory=lambda: datetime.utcnow().isoformat())
    confirmed_by_doctor: bool              = False


class DoctorDecisionChain(BaseModel):
    chain_id: str = Field(default_factory=lambda: uuid4().hex[:12])
    condition_label: str
    decision_label: str
    decision_action_type: DecisionActionType
    rationale: str
    urgency: Urgency
    avg_probability: float = Field(ge=0.0, le=1.0)
    occurrence_count: int = 1
    patient_count: int = 1
    expected_outcome: Optional[str] = None
    contradicting_factors: List[str] = Field(default_factory=list)

    class Config:
        use_enum_values = True


class DoctorGraphNode(BaseModel):
    node_id: str = Field(default_factory=lambda: uuid4().hex[:16])
    node_type: NodeType
    label: str
    attrs: Dict[str, Any] = Field(default_factory=dict)
    occurrence_count: int = 1
    patient_count: int = 1
    avg_weight: float = 0.0

    class Config:
        use_enum_values = True


class DoctorGraphEdge(BaseModel):
    edge_id: str = Field(default_factory=lambda: uuid4().hex[:16])
    from_label: str
    from_type: NodeType
    relation: EdgeType
    to_label: str
    to_type: NodeType
    weight: float = Field(ge=0.0, le=1.0)
    confidence: float = Field(ge=0.0, le=1.0)
    occurrence_count: int = 1
    patient_count: int = 1
    doctor_id: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

    class Config:
        use_enum_values = True


class AgentDoctorOutput(BaseModel):
    agent_name: str
    dimension: str
    confidence: float = Field(ge=0.0, le=1.0)
    doctor_id: str
    decision_chains: List[DoctorDecisionChain] = Field(default_factory=list)
    graph_nodes: List[DoctorGraphNode] = Field(default_factory=list)
    graph_edges: List[DoctorGraphEdge] = Field(default_factory=list)
    skill_candidates: List[SkillCandidate] = Field(default_factory=list)
    agent_reasoning: Optional[str] = None


# ─────────────────────────────────────────────
# CORE GRAPH PRIMITIVES
# ─────────────────────────────────────────────

class GraphNode(BaseModel):
    """
    A single node ready to be written into Neo4j.
    CHANGED: doctor_id is now the primary graph owner field.
    patient_id is optional metadata/provenance.
    """
    node_id: str   = Field(default_factory=lambda: uuid4().hex[:16])
    node_type: NodeType
    label: str
    attrs: Dict[str, Any]

    class Config:
        use_enum_values = True


class GraphEdge(BaseModel):
    """
    A single directed edge between two nodes.
    CHANGED: doctor_id is the primary owner; patient_id is provenance metadata.
    """
    edge_id: str        = Field(default_factory=lambda: uuid4().hex[:16])
    from_label: str
    from_type: NodeType
    relation: EdgeType
    to_label: str
    to_type: NodeType

    weight: float       = Field(ge=0.0, le=1.0)
    confidence: float   = Field(ge=0.0, le=1.0)

    # CHANGED: doctor_id is the primary owner of this edge
    doctor_id: Optional[str]  = None
    # patient_id stored as provenance / audit metadata only
    patient_id: Optional[str] = None

    metadata: Dict[str, Any]  = Field(default_factory=dict)

    class Config:
        use_enum_values = True


# ─────────────────────────────────────────────
# TRIPLE — atomic unit of graph extraction
# ─────────────────────────────────────────────

class ClinicalTriple(BaseModel):
    """
    One (subject → relation → object) triple extracted by an agent.
    CHANGED: doctor_id is the primary provenance field.
    """
    triple_id: str     = Field(default_factory=lambda: uuid4().hex[:12])

    subject: GraphNode
    relation: EdgeType
    obj: GraphNode

    edge_weight: float      = Field(ge=0.0, le=1.0)
    edge_confidence: float  = Field(ge=0.0, le=1.0)
    edge_metadata: Dict[str, Any] = Field(default_factory=dict)

    reasoning: Optional[str] = None

    class Config:
        use_enum_values = True

    def to_graph_edge(self) -> GraphEdge:
        return GraphEdge(
            from_label=self.subject.label,
            from_type=self.subject.node_type,
            relation=self.relation,
            to_label=self.obj.label,
            to_type=self.obj.node_type,
            weight=self.edge_weight,
            confidence=self.edge_confidence,
            metadata=self.edge_metadata,
        )


# ─────────────────────────────────────────────
# DECISION CHAIN
# ─────────────────────────────────────────────

class DecisionChain(BaseModel):
    """Full causal chain: findings + condition → decision → expected outcome."""
    chain_id: str = Field(default_factory=lambda: uuid4().hex[:12])

    condition_label: str
    supporting_findings: List[str]
    decision_label: str
    decision_action_type: DecisionActionType
    rationale: str
    urgency: Urgency
    probability: float = Field(ge=0.0, le=1.0)

    expected_outcome: Optional[str]        = None
    contradicting_factors: List[str]       = Field(default_factory=list)

    class Config:
        use_enum_values = True


# ─────────────────────────────────────────────
# ABNORMALITY RECORD
# ─────────────────────────────────────────────

class AbnormalityRecord(BaseModel):
    """One abnormal finding with its clinical impact on decisions."""
    entity_name: str
    value: Optional[str]           = None
    numeric_value: Optional[float] = None
    unit: Optional[str]            = None
    normal_range: Optional[str]    = None
    direction: AbnormalDirection
    clinical_significance: Severity
    explanation: str

    decision_impacts: List[str]        = Field(default_factory=list)
    contradicts_decisions: List[str]   = Field(default_factory=list)

    class Config:
        use_enum_values = True


# ─────────────────────────────────────────────
# IMPACT FLAG
# ─────────────────────────────────────────────

class ImpactFlag(BaseModel):
    """A safety-critical conflict between an abnormality and a decision."""
    flag_id: str   = Field(default_factory=lambda: uuid4().hex[:10])
    flag_type: str
    description: str
    severity: Severity
    entity_involved: Optional[str]   = None
    decision_involved: Optional[str] = None
    recommendation: Optional[str]    = None

    class Config:
        use_enum_values = True


# ─────────────────────────────────────────────
# SKILL CANDIDATE
# ─────────────────────────────────────────────

class SkillCandidate(BaseModel):
    """A high-weight pattern awaiting doctor confirmation for promotion."""
    candidate_id: str    = Field(default_factory=lambda: uuid4().hex[:10])
    condition_label: str
    decision_label: str
    pattern_summary: str
    speciality: Optional[str] = None
    weight: float
    occurrence_count: int
    awaiting_confirmation: bool = True
    doctor_id: Optional[str]   = None


# ─────────────────────────────────────────────
# AGENT GRAPH OUTPUT
# ─────────────────────────────────────────────

class AgentGraphOutput(BaseModel):
    """Structured output from a single graph-extraction agent."""
    agent_name: str
    dimension: str
    confidence: float = Field(ge=0.0, le=1.0)

    triples: List[ClinicalTriple]           = Field(default_factory=list)
    abnormalities: List[AbnormalityRecord]  = Field(default_factory=list)
    decision_chains: List[DecisionChain]    = Field(default_factory=list)
    impact_flags: List[ImpactFlag]          = Field(default_factory=list)

    agent_reasoning: Optional[str]          = None


# ─────────────────────────────────────────────
# FINAL PIPELINE OUTPUT — doctor-graph payload
# ─────────────────────────────────────────────

class ClinicalGraphPayload(BaseModel):
    """
    The final output of the pipeline for one document/consultation processing run.
    CHANGED: Graph is now doctor-centric.
      - doctor_id  → primary graph identity (who owns this knowledge graph)
      - patient_id → audit/provenance metadata (who the encounter was with)
    """
    pipeline_id: str   = Field(default_factory=lambda: f"cgp_{uuid4().hex[:12]}")

    # CHANGED: doctor_id is the PRIMARY identity of this graph
    doctor_id: str

    # patient_id kept for provenance / audit — NOT used as graph key
    patient_id: Optional[str]      = None

    generated_at: str  = Field(default_factory=lambda: datetime.utcnow().isoformat())
    source_documents: List[str]    = Field(default_factory=list)
    speciality_detected: Optional[str] = None

    # ── Graph primitives ──
    graph_nodes: List[GraphNode]           = Field(default_factory=list)
    graph_edges: List[GraphEdge]           = Field(default_factory=list)

    # ── Derived ──
    abnormalities: List[AbnormalityRecord] = Field(default_factory=list)
    decision_chains: List[DecisionChain]   = Field(default_factory=list)
    impact_flags: List[ImpactFlag]         = Field(default_factory=list)
    skill_candidates: List[SkillCandidate] = Field(default_factory=list)

    # ── Per-agent raw outputs ──
    agent_outputs: List[AgentGraphOutput]  = Field(default_factory=list)

    # ── Summary counts ──
    total_nodes: int        = 0
    total_edges: int        = 0
    total_abnormalities: int = 0
    critical_flags: int     = 0

    def compute_summary(self) -> None:
        self.total_nodes         = len(self.graph_nodes)
        self.total_edges         = len(self.graph_edges)
        self.total_abnormalities = len(self.abnormalities)
        self.critical_flags      = sum(
            1 for f in self.impact_flags if f.severity == Severity.CRITICAL
        )

    class Config:
        use_enum_values = True