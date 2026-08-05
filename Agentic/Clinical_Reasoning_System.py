"""
Integrated Clinical Reasoning System
=====================================

Main orchestrator that combines:
1. Document processing (MinerU/Docling)
2. Knowledge graph construction with evidence
3. Clinical reasoning agents
4. Follow-up visit handling with change logs
"""
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime, timedelta
from pathlib import Path
import json
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel
from uuid import uuid4

# Local imports
from document_processing_system import (
    BatchFolderProcessor,
    ProcessingEngine,
    DocumentType
)
from Agentic.enhanced_knowledge_graph import (
    EnhancedMedicalKnowledgeGraph,
    Evidence,
    ChangeType
)

# =====================================================================
# REQUEST/RESPONSE MODELS
# =====================================================================

class InitialVisitRequest(BaseModel):
    """Request for initial patient visit"""
    patient_id: str
    doctor_id: str
    documents_folder: str  # Path to folder containing patient documents
    visit_date: str
    consultation_text: Optional[str] = None

class FollowUpVisitRequest(BaseModel):
    """Request for follow-up visit"""
    patient_id: str
    doctor_id: str
    new_documents_folder: str  # Path to NEW documents since last visit
    visit_date: str
    consultation_text: Optional[str] = None

class ClinicalSystemResponse(BaseModel):
    """Response from integrated system"""
    status: str
    patient_id: str
    visit_date: str
    visit_type: str  # "initial" or "followup"
    documents_processed: int
    knowledge_graph_created: bool
    medical_history: Optional[Dict[str, Any]] = None
    current_condition: Optional[Dict[str, Any]] = None
    timeline_summary: List[Dict[str, Any]]
    changes_detected: Optional[Dict[str, Any]] = None
    warnings: List[str]
    timestamp: str

# =====================================================================
# INTEGRATED CLINICAL SYSTEM ORCHESTRATOR
# =====================================================================

class IntegratedClinicalSystem:
    """
    Main orchestrator for the complete clinical reasoning system
    """
    
    def __init__(
        self,
        mongo_uri: str,
        mongo_db: str,
        neo4j_uri: str,
        neo4j_user: str,
        neo4j_password: str,
        groq_api_key: str
    ):
        self.mongo_uri = mongo_uri
        self.mongo_db_name = mongo_db
        
        # Initialize MongoDB client
        self.mongo_client = AsyncIOMotorClient(mongo_uri)
        self.db = self.mongo_client[mongo_db]
        
        # Initialize document processor
        self.doc_processor = BatchFolderProcessor(
            mongo_uri=mongo_uri,
            db_name=mongo_db,
            prefer_engine=ProcessingEngine.MINERU
        )
        
        # Initialize knowledge graph
        self.knowledge_graph = EnhancedMedicalKnowledgeGraph(
            uri=neo4j_uri,
            user=neo4j_user,
            password=neo4j_password,
            mongo_db=self.db
        )
        
        # Store Groq API key for clinical reasoning agents
        self.groq_api_key = groq_api_key
        
        logger.info("🚀 Integrated Clinical System initialized")
    
    async def close(self):
        """Close all connections"""
        await self.knowledge_graph.close()
        self.mongo_client.close()
    
    # =====================================================================
    # INITIAL VISIT PROCESSING
    # =====================================================================
    
    async def process_initial_visit(
        self,
        request: InitialVisitRequest
    ) -> ClinicalSystemResponse:
        """
        Process initial patient visit
        
        Workflow:
        1. Process all documents in folder (MinerU/Docling)
        2. Extract clinical entities with evidence
        3. Build knowledge graph
        4. Run medical history agent (>1 year data)
        5. Run current condition agent (<=1 year data)
        6. Generate timeline summary
        
        Args:
            request: Initial visit request
            
        Returns:
            Complete clinical system response
        """
        logger.info(f"🏥 Processing INITIAL visit for patient {request.patient_id}")
        
        warnings = []
        
        try:
            # Step 1: Process documents
            logger.info("📄 Step 1: Processing documents...")
            doc_results = await self.doc_processor.process_folder(
                folder_path=request.documents_folder,
                patient_id=request.patient_id,
                recursive=True
            )
            
            documents_processed = doc_results["processed"]
            logger.info(f"✅ Processed {documents_processed} documents")
            
            if doc_results["failed"] > 0:
                warnings.append(f"{doc_results['failed']} documents failed to process")
            
            # Step 2: Build knowledge graph with evidence
            logger.info("🔨 Step 2: Building knowledge graph...")
            await self._build_knowledge_graph_from_documents(
                patient_id=request.patient_id,
                visit_date=request.visit_date
            )
            
            # Step 3: Get patient demographics
            demographics = await self._get_patient_demographics(request.patient_id)
            logger.info(f"demographics:{demographics}")
            # Create patient node
            await self.knowledge_graph.create_patient_node(
                patient_id=request.patient_id,
                demographics=demographics,
                visit_date=request.visit_date
            )
            
            # Step 4: Run clinical reasoning agents
            logger.info("🧠 Step 3: Running clinical reasoning agents...")
            medical_history, current_condition = await self._run_clinical_reasoning_agents(
                patient_id=request.patient_id,
                doctor_id=request.doctor_id,
                consultation_text=request.consultation_text or ""
            )
            
            # Step 5: Get timeline summary
            logger.info("📅 Step 4: Generating timeline summary...")
            timeline_summary = await self._get_timeline_summary(request.patient_id)
            
            # Build response
            response = ClinicalSystemResponse(
                status="success",
                patient_id=request.patient_id,
                visit_date=request.visit_date,
                visit_type="initial",
                documents_processed=documents_processed,
                knowledge_graph_created=True,
                medical_history=medical_history,
                current_condition=current_condition,
                timeline_summary=timeline_summary,
                changes_detected=None,  # No changes on initial visit
                warnings=warnings,
                timestamp=datetime.utcnow().isoformat()
            )
            
            logger.info(f"✅ Initial visit processing complete for {request.patient_id}")
            return response
            
        except Exception as e:
            logger.error(f"❌ Initial visit processing failed: {e}")
            raise
    
    # =====================================================================
    # FOLLOW-UP VISIT PROCESSING
    # =====================================================================
    
    async def process_followup_visit(
        self,
        request: FollowUpVisitRequest
    ) -> ClinicalSystemResponse:
        """
        Process follow-up patient visit
        
        Workflow:
        1. Process NEW documents only
        2. Extract clinical entities with evidence
        3. Update existing knowledge graph
        4. Detect changes (symptoms resolved, medications stopped, etc.)
        5. Log all changes with reasons
        6. Re-run clinical reasoning agents
        7. Generate updated timeline summary
        
        Args:
            request: Follow-up visit request
            
        Returns:
            Complete clinical system response with change detection
        """
        logger.info(f"🔄 Processing FOLLOW-UP visit for patient {request.patient_id}")
        
        warnings = []
        
        try:
            # Step 1: Process NEW documents
            logger.info("📄 Step 1: Processing new documents...")
            doc_results = await self.doc_processor.process_folder(
                folder_path=request.new_documents_folder,
                patient_id=request.patient_id,
                recursive=True
            )
            
            documents_processed = doc_results["processed"]
            logger.info(f"✅ Processed {documents_processed} new documents")
            
            if doc_results["failed"] > 0:
                warnings.append(f"{doc_results['failed']} documents failed to process")
            
            # Step 2: Get newly extracted entities
            logger.info("🔨 Step 2: Extracting entities from new documents...")
            new_entities = await self._get_entities_from_recent_documents(
                patient_id=request.patient_id,
                since_date=request.visit_date
            )
            
            # Step 3: Update knowledge graph and detect changes
            logger.info("🔄 Step 3: Updating knowledge graph with change detection...")
            
            # First, add new entities to graph
            await self._add_new_entities_to_graph(
                patient_id=request.patient_id,
                entities=new_entities,
                visit_date=request.visit_date
            )
            
            # Then, detect and log changes
            changes = await self.knowledge_graph.update_on_followup(
                patient_id=request.patient_id,
                new_data=new_entities,
                visit_date=request.visit_date
            )
            
            logger.info(f"✅ Detected {changes['total_changes']} changes")
            
            # Step 4: Re-run clinical reasoning agents
            logger.info("🧠 Step 4: Re-running clinical reasoning agents...")
            medical_history, current_condition = await self._run_clinical_reasoning_agents(
                patient_id=request.patient_id,
                doctor_id=request.doctor_id,
                consultation_text=request.consultation_text or ""
            )
            
            # Step 5: Get updated timeline
            logger.info("📅 Step 5: Generating updated timeline...")
            timeline_summary = await self._get_timeline_summary(request.patient_id)
            
            # Step 6: Get detailed change log for this visit
            change_log = await self.knowledge_graph.get_visit_summary(
                patient_id=request.patient_id,
                visit_date=request.visit_date
            )
            
            # Build response
            response = ClinicalSystemResponse(
                status="success",
                patient_id=request.patient_id,
                visit_date=request.visit_date,
                visit_type="followup",
                documents_processed=documents_processed,
                knowledge_graph_created=True,
                medical_history=medical_history,
                current_condition=current_condition,
                timeline_summary=timeline_summary,
                changes_detected={
                    "summary": changes,
                    "detailed_log": change_log
                },
                warnings=warnings,
                timestamp=datetime.utcnow().isoformat()
            )
            
            logger.info(f"✅ Follow-up visit processing complete for {request.patient_id}")
            return response
            
        except Exception as e:
            logger.error(f"❌ Follow-up visit processing failed: {e}")
            raise
    
    # =====================================================================
    # HELPER METHODS
    # =====================================================================
    
    async def _build_knowledge_graph_from_documents(
        self,
        patient_id: str,
        visit_date: str
    ):
        """Build knowledge graph from processed documents"""
        
        # Get all processed documents for patient
        processed_docs = await self.db.processed_documents.find(
            {"metadata.patient_id": patient_id}
        ).to_list(length=None)
        
        logger.info(f"📊 Building graph from {len(processed_docs)} documents")
        
        for doc in processed_docs:
            metadata = doc["metadata"]
            entities = doc["extracted_entities"]
            
            # Create evidence object for this document
            base_evidence = Evidence(
                evidence_id=f"ev_{metadata['document_id']}",
                document_id=metadata["document_id"],
                document_name=metadata["file_name"],
                document_type=metadata["document_type"],
                evidence_text="",  # Will be filled per entity
                page_number=None,
                confidence=metadata["confidence_score"],
                extraction_date=datetime.fromisoformat(metadata["processing_date"])
            )
            
            # Determine record type based on document date
            doc_date = metadata.get("document_date")
            if doc_date:
                doc_datetime = datetime.fromisoformat(doc_date) if isinstance(doc_date, str) else doc_date
                cutoff = datetime.utcnow() - timedelta(days=365)
                record_type = "current" if doc_datetime >= cutoff else "historical"
            else:
                record_type = "current"
            
            # Add entities to graph
            for entity in entities:
                evidence = Evidence(
                    **{**base_evidence.dict(), "evidence_text": entity["evidence_text"]}
                )
                
                entity_type = entity["entity_type"]
                
                if entity_type == "diagnosis":
                    await self.knowledge_graph.add_diagnosis_with_evidence(
                        patient_id=patient_id,
                        diagnosis=entity["entity_name"],
                        diagnosis_date=entity.get("date", visit_date),
                        record_type=record_type,
                        confidence=str(entity["confidence"]),
                        evidence=evidence,
                        staging=None,
                        visit_date=visit_date
                    )
                
                elif entity_type == "symptom":
                    await self.knowledge_graph.add_symptom_with_evidence(
                        patient_id=patient_id,
                        symptom=entity["entity_name"],
                        onset_date=entity.get("date", visit_date),
                        severity=None,
                        record_type=record_type,
                        evidence=evidence,
                        visit_date=visit_date
                    )
                
                elif entity_type == "medication":
                    await self.knowledge_graph.add_medication_with_evidence(
                        patient_id=patient_id,
                        drug_name=entity["entity_name"],
                        dose=entity.get("entity_value", ""),
                        indication="",
                        start_date=entity.get("date", visit_date),
                        record_type=record_type,
                        evidence=evidence,
                        is_current=(record_type == "current"),
                        visit_date=visit_date
                    )
                
                elif entity_type == "lab_result":
                    await self.knowledge_graph.add_lab_result_with_evidence(
                        patient_id=patient_id,
                        test_name=entity["entity_name"],
                        value=entity.get("entity_value", ""),
                        test_date=entity.get("date", visit_date),
                        record_type=record_type,
                        is_abnormal=False,  # TODO: Add abnormal detection
                        evidence=evidence,
                        visit_date=visit_date
                    )
                
                elif entity_type == "vital_sign":
                    await self.knowledge_graph.add_vital_sign_with_evidence(
                        patient_id=patient_id,
                        vital_type=entity["entity_name"],
                        value=entity.get("entity_value", ""),
                        measurement_date=entity.get("date", visit_date),
                        is_abnormal=False,  # TODO: Add abnormal detection
                        evidence=evidence,
                        visit_date=visit_date
                    )
        
        logger.info("✅ Knowledge graph constructed")
    
    async def _get_entities_from_recent_documents(
        self,
        patient_id: str,
        since_date: str
    ) -> Dict[str, List[Dict[str, Any]]]:
        """Get entities from documents processed after a certain date"""
        
        since_datetime = datetime.fromisoformat(since_date)
        
        processed_docs = await self.db.processed_documents.find({
            "metadata.patient_id": patient_id,
            "metadata.processing_date": {"$gte": since_datetime}
        }).to_list(length=None)
        
        # Aggregate entities
        current_symptoms = []
        current_medications = []
        active_diagnoses = []
        
        for doc in processed_docs:
            for entity in doc["extracted_entities"]:
                if entity["entity_type"] == "symptom":
                    current_symptoms.append({
                        "name": entity["entity_name"],
                        "evidence": entity["evidence_text"]
                    })
                elif entity["entity_type"] == "medication":
                    current_medications.append({
                        "drug": entity["entity_name"],
                        "dose": entity.get("entity_value", ""),
                        "evidence": entity["evidence_text"]
                    })
                elif entity["entity_type"] == "diagnosis":
                    active_diagnoses.append({
                        "diagnosis": entity["entity_name"],
                        "evidence": entity["evidence_text"]
                    })
        
        return {
            "current_symptoms": current_symptoms,
            "current_medications": current_medications,
            "active_diagnoses": active_diagnoses
        }
    
    async def _add_new_entities_to_graph(
        self,
        patient_id: str,
        entities: Dict[str, List[Dict[str, Any]]],
        visit_date: str
    ):
        """Add newly discovered entities to knowledge graph"""
        
        # This is similar to _build_knowledge_graph_from_documents
        # but only for new entities
        
        for symptom in entities.get("current_symptoms", []):
            evidence = Evidence(
                evidence_id=f"ev_{uuid4().hex[:12]}",
                document_id="followup_visit",
                document_name=f"Follow-up visit {visit_date}",
                document_type="consultation_note",
                evidence_text=symptom.get("evidence", ""),
                confidence=0.9,
                extraction_date=datetime.utcnow()
            )
            
            await self.knowledge_graph.add_symptom_with_evidence(
                patient_id=patient_id,
                symptom=symptom["name"],
                onset_date=visit_date,
                severity=None,
                record_type="current",
                evidence=evidence,
                visit_date=visit_date
            )
        
        # Similar for medications and diagnoses...
    
    async def _run_clinical_reasoning_agents(
        self,
        patient_id: str,
        doctor_id: str,
        consultation_text: str
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        """
        Run medical history and current condition agents
        
        NOTE: This would integrate with your existing agent code
        """
        
        # Get knowledge graph
        kg = await self.knowledge_graph.get_patient_graph_with_evidence(patient_id)
        
        # TODO: Integrate with your existing agents from enhanced_clinical_reasoning_system.py
        # For now, return placeholders
        
        medical_history = {
            "summary_text": "Medical history agent would process here",
            "confirmed_diagnoses": [],
            "past_procedures": []
        }
        
        current_condition = {
            "summary_text": "Current condition agent would process here",
            "active_diagnoses": [],
            "current_symptoms": []
        }
        
        return medical_history, current_condition
    
    async def _get_timeline_summary(self, patient_id: str) -> List[Dict[str, Any]]:
        """Get timeline summary for patient"""
        
        timeline_events = await self.db.timeline_events.find(
            {"patient_id": patient_id}
        ).sort("event_date", -1).to_list(length=100)
        
        return timeline_events
    
    async def _get_patient_demographics(self, patient_id: str) -> Dict[str, Any]:
        """Get patient demographics"""
        
        patient = await self.db.patient_users.find_one({"sys_user_id": patient_id})
        logger.info(f"patient_data:{patient}")
        if not patient:
            return {"age": None, "sex": None}
        
        # Calculate age
        dob = patient.get("date_of_birth")
        age = None
        if dob:
            if isinstance(dob, str):
                dob = datetime.strptime(dob, "%Y-%m-%d").date()
            today = datetime.utcnow().date()
            age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
        
        return {
            "age": age,
            "sex": patient.get("gender")
        }

# =====================================================================
# USAGE EXAMPLE
# =====================================================================

async def example_usage():
    """Example of how to use the integrated system"""
    
    # Initialize system
    system = IntegratedClinicalSystem(
        mongo_uri=os.getenv("MONGO_URI"),
        mongo_db=os.getenv("MONGO_DB"),
        neo4j_uri=os.getenv("NEO4J_URI"),
        neo4j_user=os.getenv("NEO4J_USER"),
        neo4j_password=os.getenv("NEO4J_PASSWORD"),
        groq_api_key=os.getenv("GROQ_API_KEY"),

    )
    
    # Example 1: Initial Visit
    initial_request = InitialVisitRequest(
        patient_id="patient_12345",
        doctor_id="doctor_67890",
        documents_folder="/path/to/patient/documents",
        visit_date="2026-01-15",
        consultation_text="Patient presents with..."
    )
    
    initial_response = await system.process_initial_visit(initial_request)
    print("Initial Visit Response:")
    print(json.dumps(initial_response.dict(), indent=2, default=str))
    
    # Example 2: Follow-up Visit (2 months later)
    followup_request = FollowUpVisitRequest(
        patient_id="patient_12345",
        doctor_id="doctor_67890",
        new_documents_folder="/path/to/new/documents",
        visit_date="2026-03-15",
        consultation_text="Patient returns for follow-up..."
    )
    
    followup_response = await system.process_followup_visit(followup_request)
    print("\nFollow-up Visit Response:")
    print(json.dumps(followup_response.dict(), indent=2, default=str))
    
    # View change log
    changes = followup_response.changes_detected
    print("\nDetected Changes:")
    print(f"- Symptoms resolved: {changes['summary']['symptoms_resolved']}")
    print(f"- Medications discontinued: {changes['summary']['medications_discontinued']}")
    print(f"- Total changes: {changes['summary']['total_changes']}")
    
    await system.close()

if __name__ == "__main__":
    import asyncio
    asyncio.run(example_usage())