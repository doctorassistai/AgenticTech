"""
Clinical Reasoning State Definitions
Defines the state structure for the clinical reasoning workflow
"""

from typing import Dict, Any, List, Optional, TypedDict


class ReasoningStep(TypedDict):
    """A single step in clinical reasoning chain"""
    step: int
    observation: str
    interpretation: str
    hypothesis: str
    confidence: float


class ClinicalReasoning(TypedDict):
    """Structured clinical reasoning output"""
    problem_representation: str
    reasoning_steps: List[ReasoningStep]
    key_insights: List[str]
    confidence_rationale: str


class DiagnosisWithReasoning(TypedDict):
    """Diagnosis with explicit reasoning chain"""
    diagnosis: str
    probability: float
    clinical_reasoning: ClinicalReasoning
    supporting_evidence: List[str]
    contradicting_evidence: List[str]
    discriminating_features: List[str]


class ClinicalReasoningState(TypedDict):
    """Enhanced state with proper clinical reasoning structure"""
    
    # ============ INPUT DATA ============
    patient_id: str
    doctor_id: str
    consultation_text: str
    
    # Raw contexts from database
    medical_context: Dict[str, Any]
    clinical_context: Dict[str, Any]
    longitudinal_context: Dict[str, Any]
    
    # ============ RAG CONTEXT ============
    rag_context_structured: Optional[Dict[str, Any]]
    relevant_documents: Optional[List[Any]]
    graph_relationships: Optional[Dict[str, Any]]
    temporal_trends: Optional[Dict[str, Any]]
    
    # ============ AGENT OUTPUTS ============
    # Each agent now includes reasoning chains
    differential_diagnosis: Optional[Dict[str, Any]]
    medication_reconciliation: Optional[Dict[str, Any]]
    risk_stratification: Optional[Dict[str, Any]]
    treatment_validation: Optional[Dict[str, Any]]
    guideline_compliance: Optional[Dict[str, Any]]
    clinical_deterioration_warning: Optional[Dict[str, Any]]
    discharge_readiness: Optional[Dict[str, Any]]
    
    # ============ COORDINATOR OUTPUTS ============
    reasoning_coordination: Optional[Dict[str, Any]]
    contradictions_identified: List[str]
    resolution_notes: List[str]
    
    # ============ ITERATION CONTROL ============
    iteration_count: int
    max_iterations: int
    requires_reanalysis: bool
    reanalysis_reason: Optional[str]
    
    # ============ FINAL OUTPUTS ============
    final_assessment: Optional[Dict[str, Any]]
    confidence_scores: Dict[str, float]
    warnings: List[str]
    requires_review: bool
    error: Optional[str]
    timestamp: str


class StructuredRAGContext(TypedDict):
    """Hierarchical RAG context structure"""
    critical_summary: str  # 100-200 tokens: Most critical findings
    domain_indices: Dict[str, Any]  # 300-400 tokens: What data is available
    full_context: Dict[str, Any]  # Complete data (accessed on-demand)


class AgentContext(TypedDict):
    """Context provided to each agent"""
    critical_findings: str
    relevant_data: Dict[str, Any]
    consultation: str
    previous_reasoning: Optional[Dict[str, Any]]
    domain_specific_data: Optional[List[Any]]