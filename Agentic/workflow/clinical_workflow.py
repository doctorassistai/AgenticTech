"""
Clinical Reasoning Workflow
LangGraph workflow orchestrating all clinical reasoning agents with iteration support
"""

from typing import Dict, Any, Literal
from langgraph.graph import StateGraph, END
from langchain_groq import ChatGroq
from loguru import logger
import os
from datetime import datetime

# Import agents
from Agentic.agents.differential_diagnosis_agent import DifferentialDiagnosisAgent
from Agentic.agents.medication_reconciliation_agent import MedicationReconciliationAgent
from Agentic.agents.risk_stratification_agent import RiskStratificationAgent
from Agentic.agents.treatment_validation_agent import TreatmentValidationAgent
from Agentic.agents.discharge_readiness_agent import DischargeReadinessAgent

# Import coordinator
from Agentic.core.reasoning_coordinator import ClinicalReasoningCoordinator

# Import RAG system
from Agentic.Rag.graph_rag_system import graph_rag_system

# Import state
from Agentic.core.clinical_state import ClinicalReasoningState


class ClinicalReasoningWorkflow:
    """
    LangGraph workflow for iterative clinical reasoning
    
    Workflow:
    1. Index patient data in RAG system
    2. Run core clinical reasoning agents
    3. Coordinate and check for contradictions
    4. Re-analyze if needed (up to max iterations)
    5. Generate final assessment
    """
    
    def __init__(self):
        # Initialize LLM
        self.llm = ChatGroq(
            model="llama-3.3-70b-versatile",
            temperature=0.1,
            api_key=os.getenv("GROQ_API_KEY")
        )
        
        # Initialize agents
        self.differential_diagnosis_agent = DifferentialDiagnosisAgent(self.llm)
        self.medication_agent = MedicationReconciliationAgent(self.llm)
        self.risk_agent = RiskStratificationAgent(self.llm)
        self.treatment_agent = TreatmentValidationAgent(self.llm)
        self.discharge_agent = DischargeReadinessAgent(self.llm)
        
        # Initialize coordinator
        self.coordinator = ClinicalReasoningCoordinator(self.llm)
        
        # Build workflow graph
        self.workflow = self._build_workflow()
        
        logger.info("✅ Clinical Reasoning Workflow initialized")
    
    def _build_workflow(self) -> StateGraph:
        """Build the LangGraph workflow"""
        
        # Create state graph
        workflow = StateGraph(dict)
        
        # Add nodes for each step
        workflow.add_node("initialize", self._initialize_state)
        workflow.add_node("index_rag", self._index_patient_data)
        workflow.add_node("build_context", self._build_hierarchical_context)
        workflow.add_node("differential_diagnosis", self._run_differential_diagnosis)
        workflow.add_node("medication_reconciliation", self._run_medication_reconciliation)
        workflow.add_node("risk_stratification", self._run_risk_stratification)
        workflow.add_node("treatment_validation", self._run_treatment_validation)
        workflow.add_node("discharge_readiness", self._run_discharge_readiness)
        workflow.add_node("coordinate", self._coordinate_reasoning)
        workflow.add_node("finalize", self._finalize_assessment)
        
        # Define edges
        workflow.set_entry_point("initialize")
        
        # Linear flow through initial agents
        workflow.add_edge("initialize", "index_rag")
        workflow.add_edge("index_rag", "build_context")
        workflow.add_edge("build_context", "differential_diagnosis")
        workflow.add_edge("differential_diagnosis", "medication_reconciliation")
        workflow.add_edge("medication_reconciliation", "risk_stratification")
        workflow.add_edge("risk_stratification", "treatment_validation")
        workflow.add_edge("treatment_validation", "discharge_readiness")
        workflow.add_edge("discharge_readiness", "coordinate")
        
        # Conditional edge: coordinate → re-analyze or finalize
        workflow.add_conditional_edges(
            "coordinate",
            self._should_iterate,
            {
                "iterate": "differential_diagnosis",  # Loop back
                "finalize": "finalize"
            }
        )
        
        workflow.add_edge("finalize", END)
        
        return workflow.compile()
    
    async def _initialize_state(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Initialize state with defaults"""
        logger.info("🔧 Initializing workflow state")
        
        state.setdefault("iteration_count", 0)
        state.setdefault("max_iterations", 3)
        state.setdefault("requires_reanalysis", False)
        state.setdefault("warnings", [])
        state.setdefault("confidence_scores", {})
        state.setdefault("requires_review", False)
        state.setdefault("contradictions_identified", [])
        state.setdefault("resolution_notes", [])
        state["timestamp"] = datetime.utcnow().isoformat()
        
        return state
    
    async def _index_patient_data(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Index patient data in RAG system"""
        logger.info("📊 Indexing patient data in RAG system")
        
        try:
            patient_id = state.get("patient_id")
            medical_context = state.get("medical_context", {})
            clinical_context = state.get("clinical_context", {})
            longitudinal_context = state.get("longitudinal_context", {})
            
            # Index in RAG system
            await graph_rag_system.index_patient_data(
                patient_id=patient_id,
                medical_context=medical_context,
                clinical_context=clinical_context,
                longitudinal_context=longitudinal_context
            )
            
            logger.info("✅ Patient data indexed successfully")
            
        except Exception as e:
            logger.error(f"❌ RAG indexing failed: {str(e)}")
            state["warnings"].append(f"RAG indexing failed: {str(e)}")
        
        return state
    
    async def _build_hierarchical_context(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Build hierarchical RAG context"""
        logger.info("🔍 Building hierarchical context")
        
        try:
            patient_id = state.get("patient_id")
            consultation = state.get("consultation_text", "")
            
            # Retrieve relevant context from RAG
            rag_context = await graph_rag_system.retrieve_relevant_context(
                query=consultation,
                patient_id=patient_id,
                top_k=10
            )
            
            # Build hierarchical structure
            vector_results = rag_context.get("vector_results", [])
            graph_results = rag_context.get("graph_results", {})
            temporal_results = rag_context.get("temporal_results", {})
            logger.debug(f"Vector results: {vector_results}")
            logger.debug(f"Graph results: {graph_results}")
            logger.debug(f"Temporal results: {temporal_results}")
            # Create critical summary (top priority findings)
            critical_summary = self._extract_critical_findings(
                vector_results, graph_results, temporal_results
            )
            
            # Create domain indices (what data is available)
            domain_indices = self._create_domain_indices(
                vector_results, graph_results, temporal_results
            )
            
            # Store structured context
            state["rag_context_structured"] = {
                "critical_summary": critical_summary,
                "domain_indices": domain_indices,
                "full_context": {
                    "vector_results": [self._doc_to_dict(doc) for doc in vector_results],
                    "graph_results": graph_results,
                    "temporal_results": temporal_results
                }
            }
            
            logger.info("✅ Hierarchical context built successfully")
            
        except Exception as e:
            logger.error(f"❌ Context building failed: {str(e)}")
            state["warnings"].append(f"Context building failed: {str(e)}")
        
        return state
    
    def _extract_critical_findings(self, vector_results, graph_results, temporal_results) -> str:
        """Extract top critical findings from all sources"""
        critical = []
        
        # From vector results (top 3)
        for doc in vector_results[:3]:
            if hasattr(doc, 'page_content'):
                content = doc.page_content[:200]
                critical.append(f"• {content}")
        
        # From graph results
        diagnoses = graph_results.get("diagnoses", [])
        if diagnoses:
            critical.append(f"• Active diagnoses: {', '.join(diagnoses[:5])}")
        
        # From temporal trends
        trends = temporal_results.get("trends", [])
        if trends:
            critical.append(f"• Recent trends: {len(trends)} data points tracked")
        
        return "\n".join(critical) if critical else "No critical findings extracted"
    
    def _create_domain_indices(self, vector_results, graph_results, temporal_results) -> Dict[str, Any]:
        """Create indices showing what data is available"""
        
        # Count document types
        doc_breakdown = {}
        for doc in vector_results:
            if hasattr(doc, 'metadata'):
                doc_type = doc.metadata.get('type', 'unknown')
                doc_subtype = doc.metadata.get('subtype', 'unknown')
                
                if doc_type not in doc_breakdown:
                    doc_breakdown[doc_type] = {}
                
                doc_breakdown[doc_type][doc_subtype] = doc_breakdown[doc_type].get(doc_subtype, 0) + 1
        
        return {
            "vector_search_results": f"{len(vector_results)} documents retrieved",
            "document_breakdown": doc_breakdown,
            "graph_relationships": {
                "diagnoses": len(graph_results.get("diagnoses", [])),
                "labs": len(graph_results.get("labs", [])),
                "imaging": len(graph_results.get("imaging", [])),
                "treatments": len(graph_results.get("treatments", []))
            },
            "temporal_data": {
                "trends_available": len(temporal_results.get("trends", []))
            }
        }
    
    def _doc_to_dict(self, doc) -> Dict[str, Any]:
        """Convert LangChain Document to dict"""
        if hasattr(doc, 'page_content'):
            return {
                "content": doc.page_content,
                "metadata": doc.metadata if hasattr(doc, 'metadata') else {}
            }
        return {"content": str(doc), "metadata": {}}
    
    async def _run_differential_diagnosis(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Run differential diagnosis agent"""
        logger.info("🔍 Running Differential Diagnosis Agent")
        return await self.differential_diagnosis_agent.analyze(state)
    
    async def _run_medication_reconciliation(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Run medication reconciliation agent"""
        logger.info("💊 Running Medication Reconciliation Agent")
        return await self.medication_agent.analyze(state)
    
    async def _run_risk_stratification(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Run risk stratification agent"""
        logger.info("⚠️ Running Risk Stratification Agent")
        return await self.risk_agent.analyze(state)
    
    async def _run_treatment_validation(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Run treatment validation agent"""
        logger.info("💊 Running Treatment Validation Agent")
        return await self.treatment_agent.analyze(state)
    
    async def _run_discharge_readiness(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Run discharge readiness agent"""
        logger.info("🏥 Running Discharge Readiness Agent")
        return await self.discharge_agent.analyze(state)
    
    async def _coordinate_reasoning(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Coordinate and check for contradictions"""
        logger.info("🎯 Coordinating clinical reasoning")
        return await self.coordinator.coordinate(state)
    
    def _should_iterate(self, state: Dict[str, Any]) -> Literal["iterate", "finalize"]:
        """Decide whether to iterate or finalize"""
        
        # Check if we should iterate
        if state.get("requires_reanalysis", False):
            if state.get("iteration_count", 0) < state.get("max_iterations", 3):
                logger.info(f"🔄 Iteration {state.get('iteration_count')} - Re-analyzing")
                return "iterate"
            else:
                logger.info("⚠️ Max iterations reached, proceeding to finalize")
                state["warnings"].append("Max iterations reached - some contradictions may remain unresolved")
        
        return "finalize"
    
    async def _finalize_assessment(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Generate final assessment"""
        logger.info("📋 Finalizing clinical assessment")
        
        try:
            # Compile final assessment
            final_assessment = {
                "timestamp": datetime.utcnow().isoformat(),
                "patient_id": state.get("patient_id"),
                "iterations_performed": state.get("iteration_count", 0),
                
                "primary_diagnosis": self._extract_primary_diagnosis(state),
                "risk_level": self._extract_risk_level(state),
                "treatment_plan_summary": self._extract_treatment_summary(state),
                "discharge_recommendation": self._extract_discharge_recommendation(state),
                
                "confidence_scores": state.get("confidence_scores", {}),
                "overall_confidence": self._calculate_overall_confidence(state),
                
                "warnings": state.get("warnings", []),
                "requires_review": state.get("requires_review", False),
                
                "contradictions_resolved": len(state.get("resolution_notes", [])),
                "contradictions_remaining": len(state.get("contradictions_identified", []))
            }
            
            state["final_assessment"] = final_assessment
            
            logger.info("✅ Clinical reasoning workflow complete")
            logger.info(f"   Overall confidence: {final_assessment['overall_confidence']:.2f}")
            logger.info(f"   Warnings: {len(state.get('warnings', []))}")
            logger.info(f"   Requires review: {state.get('requires_review', False)}")
            
        except Exception as e:
            logger.error(f"❌ Final assessment generation failed: {str(e)}")
            state["error"] = f"Final assessment failed: {str(e)}"
        
        return state
    
    def _extract_primary_diagnosis(self, state: Dict[str, Any]) -> str:
        """Extract primary diagnosis from differential"""
        diagnosis = state.get("differential_diagnosis", {})
        most_likely = diagnosis.get("most_likely_diagnoses", [])
        if most_likely:
            return most_likely[0].get("diagnosis", "Unknown")
        return "Pending further evaluation"
    
    def _extract_risk_level(self, state: Dict[str, Any]) -> str:
        """Extract overall risk level"""
        risk = state.get("risk_stratification", {})
        return risk.get("overall_risk_level", "unknown")
    
    def _extract_treatment_summary(self, state: Dict[str, Any]) -> str:
        """Extract treatment plan summary"""
        treatment = state.get("treatment_validation", {})
        plan = treatment.get("recommended_treatment_plan", {})
        immediate = plan.get("immediate_interventions", [])
        
        if immediate:
            return f"{len(immediate)} immediate intervention(s) recommended"
        return "Treatment plan pending"
    
    def _extract_discharge_recommendation(self, state: Dict[str, Any]) -> str:
        """Extract discharge recommendation"""
        discharge = state.get("discharge_readiness", {})
        readiness = discharge.get("overall_discharge_readiness", "unknown")
        safe = discharge.get("safe_to_discharge", False)
        
        if safe:
            return f"Ready for discharge ({readiness})"
        return f"Not ready for discharge ({readiness})"
    
    def _calculate_overall_confidence(self, state: Dict[str, Any]) -> float:
        """Calculate overall confidence score"""
        scores = state.get("confidence_scores", {})
        if not scores:
            return 0.0
        
        return sum(scores.values()) / len(scores)
    
    async def run(self, input_state: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute the clinical reasoning workflow
        
        Args:
            input_state: Initial state with patient data and consultation
            
        Returns:
            Final state with all agent outputs and assessments
        """
        logger.info("🚀 Starting Clinical Reasoning Workflow")
        logger.info(f"   Patient ID: {input_state.get('patient_id')}")
        logger.info(f"   Consultation length: {len(input_state.get('consultation_text', ''))} chars")
        
        try:
            # Run workflow
            final_state = await self.workflow.ainvoke(input_state)
            
            logger.info("✅ Workflow execution complete")
            return final_state
            
        except Exception as e:
            logger.error(f"❌ Workflow execution failed: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            
            # Return error state
            input_state["error"] = str(e)
            input_state["final_assessment"] = {
                "error": str(e),
                "timestamp": datetime.utcnow().isoformat()
            }
            return input_state


# Global workflow instance
clinical_workflow = ClinicalReasoningWorkflow()