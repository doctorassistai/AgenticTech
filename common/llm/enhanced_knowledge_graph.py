"""
Enhanced Knowledge Graph System with Evidence Tracking and Change Logging
==========================================================================

This module extends the knowledge graph to track evidence sources and
log changes across follow-up visits.
"""

from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime
from neo4j import AsyncGraphDatabase
from neo4j.time import DateTime as Neo4jDateTime
from pydantic import BaseModel
from enum import Enum
from loguru import logger
import json
from uuid import uuid4

# =====================================================================
# MODELS FOR CHANGE TRACKING
# =====================================================================

class ChangeType(str, Enum):
    """Types of changes in knowledge graph"""
    ADDED = "added"
    MODIFIED = "modified"
    RESOLVED = "resolved"
    DISCONTINUED = "discontinued"
    REACTIVATED = "reactivated"

class ChangeLog(BaseModel):
    """Log entry for graph changes"""
    change_id: str
    patient_id: str
    visit_date: datetime
    change_type: ChangeType
    entity_type: str
    entity_id: str
    entity_name: str
    old_value: Optional[Dict[str, Any]] = None
    new_value: Optional[Dict[str, Any]] = None
    reason: Optional[str] = None
    created_at: datetime

class Evidence(BaseModel):
    """Evidence source for clinical entities"""
    evidence_id: str
    document_id: str
    document_name: str
    document_type: str
    document_date: Optional[str] = None
    evidence_text: str
    page_number: Optional[int] = None
    confidence: float
    extraction_date: datetime

# =====================================================================
# ENHANCED MEDICAL KNOWLEDGE GRAPH WITH EVIDENCE
# =====================================================================

class EnhancedMedicalKnowledgeGraph:
    """
    Enhanced knowledge graph with evidence tracking and change logging
    """
    
    def __init__(self, uri: str, user: str, password: str, mongo_db):
        self.driver = AsyncGraphDatabase.driver(uri, auth=(user, password))
        self.mongo_db = mongo_db
        self.change_logs_collection = mongo_db["knowledge_graph_changes"]
        logger.info("🔗 Enhanced Knowledge Graph initialized with evidence tracking")
    
    async def close(self):
        """Close Neo4j connection"""
        await self.driver.close()
    
    # =====================================================================
    # CORE ENTITY CREATION WITH EVIDENCE
    # =====================================================================
    
    async def create_patient_node(
        self,
        patient_id: str,
        demographics: Dict[str, Any],
        visit_date: Optional[str] = None
    ):
        """Create or update patient root node"""
        query = """
        MERGE (p:Patient {patient_id: $patient_id})
        SET p.age = $age,
            p.sex = $sex,
            p.last_updated = datetime(),
            p.last_visit_date = $visit_date
        RETURN p
        """
        async with self.driver.session() as session:
            await session.run(
                query,
                patient_id=patient_id,
                age=demographics.get("age"),
                sex=demographics.get("sex"),
                visit_date=visit_date or datetime.utcnow().isoformat()
            )
            logger.info(f"✅ Patient node created/updated: {patient_id}")
    
    async def add_diagnosis_with_evidence(
        self,
        patient_id: str,
        diagnosis: str,
        diagnosis_date: str,
        record_type: str,
        confidence: str,
        evidence: Evidence,
        staging: Optional[Dict[str, Any]] = None,
        visit_date: Optional[str] = None
    ) -> str:
        """
        Add diagnosis with evidence tracking
        
        Returns:
            diagnosis_id
        """
        diagnosis_id = f"dx_{uuid4().hex[:12]}"
        
        query = """
        MATCH (p:Patient {patient_id: $patient_id})
        CREATE (d:Diagnosis {
            diagnosis_id: $diagnosis_id,
            name: $diagnosis,
            diagnosis_date: $diagnosis_date,
            record_type: $record_type,
            confidence: $confidence,
            stage: $stage,
            tnm_stage: $tnm_stage,
            grade: $grade,
            is_active: $is_active,
            created_at: datetime()
        })
        CREATE (p)-[:HAS_DIAGNOSIS {
            diagnosed_on: $diagnosis_date,
            record_type: $record_type,
            visit_date: $visit_date
        }]->(d)
        
        CREATE (e:Evidence {
            evidence_id: $evidence_id,
            document_id: $document_id,
            document_name: $document_name,
            document_type: $document_type,
            document_date:$document_date,
            evidence_text: $evidence_text,
            page_number: $page_number,
            confidence: $evidence_confidence,
            extraction_date: $extraction_date
        })
        CREATE (d)-[:SUPPORTED_BY_EVIDENCE]->(e)
        
        RETURN d, e
        """
        
        is_active = record_type in ["current", "active"]
        
        async with self.driver.session() as session:
            await session.run(
                query,
                patient_id=patient_id,
                diagnosis_id=diagnosis_id,
                diagnosis=diagnosis,
                diagnosis_date=diagnosis_date,
                record_type=record_type,
                confidence=confidence,
                stage=staging.get("stage", "") if staging else "",
                tnm_stage=staging.get("tnm_stage", "") if staging else "",
                grade=staging.get("grade", "") if staging else "",
                is_active=is_active,
                visit_date=visit_date or datetime.utcnow().isoformat(),
                # Evidence
                evidence_id=evidence.evidence_id,
                document_id=evidence.document_id,
                document_name=evidence.document_name,
                document_type=evidence.document_type,
                document_date=evidence.document_date,
                evidence_text=evidence.evidence_text,
                page_number=evidence.page_number,
                evidence_confidence=evidence.confidence,
                extraction_date=evidence.extraction_date.isoformat()
            )
        
        # Log change
        await self._log_change(
            patient_id=patient_id,
            visit_date=visit_date or datetime.utcnow().isoformat(),
            change_type=ChangeType.ADDED,
            entity_type="Diagnosis",
            entity_id=diagnosis_id,
            entity_name=diagnosis,
            new_value={"is_active": is_active, "confidence": confidence},
            reason=f"Added from document: {evidence.document_name}"
        )
        
        logger.info(f"✅ Diagnosis added with evidence: {diagnosis} [{record_type}]")
        return diagnosis_id
    
    async def add_symptom_with_evidence(
        self,
        patient_id: str,
        symptom: str,
        onset_date: str,
        severity: Optional[str],
        record_type: str,
        evidence: Evidence,
        visit_date: Optional[str] = None
    ) -> str:
        """Add symptom with evidence tracking"""
        symptom_id = f"sym_{uuid4().hex[:12]}"
        
        query = """
        MATCH (p:Patient {patient_id: $patient_id})
        CREATE (s:Symptom {
            symptom_id: $symptom_id,
            name: $symptom,
            onset_date: $onset_date,
            severity: $severity,
            is_active: true,
            created_at: datetime()
        })
        CREATE (p)-[:HAS_SYMPTOM {
            reported_on: $onset_date,
            is_current: true,
            visit_date: $visit_date
        }]->(s)
        
        CREATE (e:Evidence {
            evidence_id: $evidence_id,
            document_id: $document_id,
            document_name: $document_name,
            document_type: $document_type,
            document_date:$document_date,
            evidence_text: $evidence_text,
            page_number: $page_number,
            confidence: $evidence_confidence,
            extraction_date: $extraction_date
        })
        CREATE (s)-[:SUPPORTED_BY_EVIDENCE]->(e)
        
        RETURN s, e
        """
        
        async with self.driver.session() as session:
            await session.run(
                query,
                patient_id=patient_id,
                symptom_id=symptom_id,
                symptom=symptom,
                onset_date=onset_date,
                severity=severity or "unknown",
                visit_date=visit_date or datetime.utcnow().isoformat(),
                # Evidence
                evidence_id=evidence.evidence_id,
                document_id=evidence.document_id,
                document_name=evidence.document_name,
                document_type=evidence.document_type,
                document_date=evidence.document_date,
                evidence_text=evidence.evidence_text,
                page_number=evidence.page_number,
                evidence_confidence=evidence.confidence,
                extraction_date=evidence.extraction_date.isoformat()
            )
        
        # Log change
        await self._log_change(
            patient_id=patient_id,
            visit_date=visit_date or datetime.utcnow().isoformat(),
            change_type=ChangeType.ADDED,
            entity_type="Symptom",
            entity_id=symptom_id,
            entity_name=symptom,
            new_value={"is_active": True, "severity": severity},
            reason=f"Reported in document: {evidence.document_name}"
        )
        
        logger.info(f"✅ Symptom added with evidence: {symptom}")
        return symptom_id
    
    async def add_medication_with_evidence(
        self,
        patient_id: str,
        drug_name: str,
        dose: str,
        indication: str,
        start_date: str,
        record_type: str,
        evidence: Evidence,
        is_current: bool = True,
        visit_date: Optional[str] = None
    ) -> str:
        """Add medication with evidence tracking"""
        med_id = f"med_{uuid4().hex[:12]}"
        
        query = """
        MATCH (p:Patient {patient_id: $patient_id})
        CREATE (m:Medication {
            medication_id: $med_id,
            drug_name: $drug_name,
            dose: $dose,
            indication: $indication,
            start_date: $start_date,
            is_current: $is_current,
            record_type: $record_type,
            created_at: datetime()
        })
        CREATE (p)-[:TAKES_MEDICATION {
            started_on: $start_date,
            is_current: $is_current,
            visit_date: $visit_date
        }]->(m)
        
        CREATE (e:Evidence {
            evidence_id: $evidence_id,
            document_id: $document_id,
            document_name: $document_name,
            document_type: $document_type,
            document_date:$document_date,
            evidence_text: $evidence_text,
            page_number: $page_number,
            confidence: $evidence_confidence,
            extraction_date: $extraction_date
        })
        CREATE (m)-[:SUPPORTED_BY_EVIDENCE]->(e)
        
        RETURN m, e
        """
        
        async with self.driver.session() as session:
            await session.run(
                query,
                patient_id=patient_id,
                med_id=med_id,
                drug_name=drug_name,
                dose=dose,
                indication=indication,
                start_date=start_date,
                is_current=is_current,
                record_type=record_type,
                visit_date=visit_date or datetime.utcnow().isoformat(),
                # Evidence
                evidence_id=evidence.evidence_id,
                document_id=evidence.document_id,
                document_name=evidence.document_name,
                document_type=evidence.document_type,
                document_date=evidence.document_date,
                evidence_text=evidence.evidence_text,
                page_number=evidence.page_number,
                evidence_confidence=evidence.confidence,
                extraction_date=evidence.extraction_date.isoformat()
            )
        
        # Log change
        await self._log_change(
            patient_id=patient_id,
            visit_date=visit_date or datetime.utcnow().isoformat(),
            change_type=ChangeType.ADDED,
            entity_type="Medication",
            entity_id=med_id,
            entity_name=drug_name,
            new_value={"is_current": is_current, "dose": dose},
            reason=f"Prescribed in document: {evidence.document_name}"
        )
        
        logger.info(f"✅ Medication added with evidence: {drug_name}")
        return med_id
    
    async def add_lab_result_with_evidence(
        self,
        patient_id: str,
        test_name: str,
        value: str,
        test_date: str,
        record_type: str,
        is_abnormal: bool,
        evidence: Evidence,
        visit_date: Optional[str] = None
    ) -> str:
        """Add lab result with evidence tracking"""
        lab_id = f"lab_{uuid4().hex[:12]}"
        
        query = """
        MATCH (p:Patient {patient_id: $patient_id})
        CREATE (l:LabResult {
            lab_id: $lab_id,
            test_name: $test_name,
            value: $value,
            test_date: $test_date,
            is_abnormal: $is_abnormal,
            record_type: $record_type,
            created_at: datetime()
        })
        CREATE (p)-[:HAS_LAB_RESULT {
            tested_on: $test_date,
            is_recent: $is_recent,
            visit_date: $visit_date
        }]->(l)
        
        CREATE (e:Evidence {
            evidence_id: $evidence_id,
            document_id: $document_id,
            document_name: $document_name,
            document_type: $document_type,
            document_date:$document_date,
            evidence_text: $evidence_text,
            page_number: $page_number,
            confidence: $evidence_confidence,
            extraction_date: $extraction_date
        })
        CREATE (l)-[:SUPPORTED_BY_EVIDENCE]->(e)
        
        RETURN l, e
        """
        
        is_recent = record_type in ["current", "active"]
        
        async with self.driver.session() as session:
            await session.run(
                query,
                patient_id=patient_id,
                lab_id=lab_id,
                test_name=test_name,
                value=value,
                test_date=test_date,
                is_abnormal=is_abnormal,
                record_type=record_type,
                is_recent=is_recent,
                visit_date=visit_date or datetime.utcnow().isoformat(),
                # Evidence
                evidence_id=evidence.evidence_id,
                document_id=evidence.document_id,
                document_name=evidence.document_name,
                document_type=evidence.document_type,
                document_date=evidence.document_date,
                evidence_text=evidence.evidence_text,
                page_number=evidence.page_number,
                evidence_confidence=evidence.confidence,
                extraction_date=evidence.extraction_date.isoformat()
            )
        
        logger.info(f"✅ Lab result added with evidence: {test_name} = {value}")
        return lab_id
    
    async def add_vital_sign_with_evidence(
        self,
        patient_id: str,
        vital_type: str,
        value: str,
        measurement_date: str,
        is_abnormal: bool,
        evidence: Evidence,
        visit_date: Optional[str] = None
    ) -> str:
        """Add vital sign with evidence tracking"""
        vital_id = f"vital_{uuid4().hex[:12]}"
        
        query = """
        MATCH (p:Patient {patient_id: $patient_id})
        CREATE (v:VitalSign {
            vital_id: $vital_id,
            vital_type: $vital_type,
            value: $value,
            measurement_date: $measurement_date,
            is_abnormal: $is_abnormal,
            created_at: datetime()
        })
        CREATE (p)-[:HAS_VITAL_SIGN {
            measured_on: $measurement_date,
            visit_date: $visit_date
        }]->(v)
        
        CREATE (e:Evidence {
            evidence_id: $evidence_id,
            document_id: $document_id,
            document_name: $document_name,
            document_type: $document_type,
            document_date:$document_date,
            evidence_text: $evidence_text,
            page_number: $page_number,
            confidence: $evidence_confidence,
            extraction_date: $extraction_date
        })
        CREATE (v)-[:SUPPORTED_BY_EVIDENCE]->(e)
        
        RETURN v, e
        """
        
        async with self.driver.session() as session:
            await session.run(
                query,
                patient_id=patient_id,
                vital_id=vital_id,
                vital_type=vital_type,
                value=value,
                measurement_date=measurement_date,
                is_abnormal=is_abnormal,
                visit_date=visit_date or datetime.utcnow().isoformat(),
                # Evidence
                evidence_id=evidence.evidence_id,
                document_id=evidence.document_id,
                document_name=evidence.document_name,
                document_type=evidence.document_type,
                document_date=evidence.document_date,
                evidence_text=evidence.evidence_text,
                page_number=evidence.page_number,
                evidence_confidence=evidence.confidence,
                extraction_date=evidence.extraction_date.isoformat()
            )
        
        logger.info(f"✅ Vital sign added with evidence: {vital_type} = {value}")
        return vital_id
    
    
    async def add_anatomy_with_evidence(
        self,
        patient_id: str,
        anatomy: str,
        observation_date: str,
        evidence: Evidence,
        visit_date: Optional[str] = None
    ) -> str:

        anatomy_id = f"an_{uuid4().hex[:12]}"

        query = """
        MATCH (p:Patient {patient_id: $patient_id})

        CREATE (a:Anatomy {
            anatomy_id:$anatomy_id,
            name:$anatomy,
            observed_on:$observation_date,
            created_at:datetime()
        })

        CREATE (p)-[:HAS_ANATOMY {
            observed_on:$observation_date,
            visit_date:$visit_date
        }]->(a)

        CREATE (e:Evidence {
            evidence_id:$evidence_id,
            document_id:$document_id,
            document_name:$document_name,
            document_type:$document_type,
            document_date:$document_date,
            evidence_text:$evidence_text,
            page_number:$page_number,
            confidence:$confidence,
            extraction_date:$extraction_date
        })

        CREATE (a)-[:SUPPORTED_BY_EVIDENCE]->(e)
        """

        async with self.driver.session() as session:
            await session.run(
                query,
                patient_id=patient_id,
                anatomy_id=anatomy_id,
                anatomy=anatomy,
                observation_date=observation_date,
                visit_date=visit_date or datetime.utcnow().isoformat(),
                evidence_id=evidence.evidence_id,
                document_id=evidence.document_id,
                document_name=evidence.document_name,
                document_type=evidence.document_type,
                document_date=evidence.document_date,
                evidence_text=evidence.evidence_text,
                page_number=evidence.page_number,
                confidence=evidence.confidence,
                extraction_date=evidence.extraction_date.isoformat()
            )
            
        logger.info(f"✅ Diagnosis added with evidence:" )    
        return anatomy_id
    
    
    
    async def add_finding_with_evidence(
        self,
        patient_id: str,
        finding: str,
        finding_date: str,
        evidence: Evidence,
        visit_date: Optional[str] = None
    ) -> str:

        finding_id = f"find_{uuid4().hex[:12]}"

        query = """
        MATCH (p:Patient {patient_id:$patient_id})

        CREATE (f:Finding {
            finding_id:$finding_id,
            description:$finding,
            observed_on:$finding_date,
            created_at:datetime()
        })

        CREATE (p)-[:HAS_FINDING {
            observed_on:$finding_date,
            visit_date:$visit_date
        }]->(f)

        CREATE (e:Evidence {
            evidence_id:$evidence_id,
            document_id:$document_id,
            document_name:$document_name,
            document_type:$document_type,
            document_date:$document_date,
            evidence_text:$evidence_text,
            page_number:$page_number,
            confidence:$confidence,
            extraction_date:$extraction_date
        })

        CREATE (f)-[:SUPPORTED_BY_EVIDENCE]->(e)
        """

        async with self.driver.session() as session:
            await session.run(
                query,
                patient_id=patient_id,
                finding_id=finding_id,
                finding=finding,
                finding_date=finding_date,
                visit_date=visit_date or datetime.utcnow().isoformat(),
                evidence_id=evidence.evidence_id,
                document_id=evidence.document_id,
                document_name=evidence.document_name,
                document_type=evidence.document_type,
                document_date=evidence.document_date,
                evidence_text=evidence.evidence_text,
                page_number=evidence.page_number,
                confidence=evidence.confidence,
                extraction_date=evidence.extraction_date.isoformat()
            )
        logger.info(f"✅ Diagnosis added with evidence:" )  
        return finding_id
    
    
    
        
    
    async def add_procedure_with_evidence(
        self,
        patient_id: str,
        procedure: str,
        procedure_date: str,
        evidence: Evidence,
        visit_date: Optional[str] = None
    ) -> str:

        procedure_id = f"proc_{uuid4().hex[:12]}"

        query = """
        MATCH (p:Patient {patient_id:$patient_id})

        CREATE (pr:Procedure {
            procedure_id:$procedure_id,
            name:$procedure,
            recommended_on:$procedure_date,
            created_at:datetime()
        })

        CREATE (p)-[:HAS_PROCEDURE {
            recommended_on:$procedure_date,
            visit_date:$visit_date
        }]->(pr)

        CREATE (e:Evidence {
            evidence_id:$evidence_id,
            document_id:$document_id,
            document_name:$document_name,
            document_type:$document_type,
            document_date:$document_date,
            evidence_text:$evidence_text,
            page_number:$page_number,
            confidence:$confidence,
            extraction_date:$extraction_date
        })

        CREATE (pr)-[:SUPPORTED_BY_EVIDENCE]->(e)
        """

        async with self.driver.session() as session:
            await session.run(
                query,
                patient_id=patient_id,
                procedure_id=procedure_id,
                procedure=procedure,
                procedure_date=procedure_date,
                visit_date=visit_date or datetime.utcnow().isoformat(),
                evidence_id=evidence.evidence_id,
                document_id=evidence.document_id,
                document_name=evidence.document_name,
                document_type=evidence.document_type,
                document_date=evidence.document_date,
                evidence_text=evidence.evidence_text,
                page_number=evidence.page_number,
                confidence=evidence.confidence,
                extraction_date=evidence.extraction_date.isoformat()
            )
        logger.info(f"✅ Diagnosis added with evidence:" )  
        return procedure_id
    
    
    
    async def add_measurement_with_evidence(
        self,
        patient_id: str,
        measurement: str,
        measurement_date: str,
        evidence: Evidence,
        visit_date: Optional[str] = None
    ) -> str:

        meas_id = f"meas_{uuid4().hex[:12]}"

        query = """
        MATCH (p:Patient {patient_id:$patient_id})

        CREATE (m:Measurement {
            measurement_id:$meas_id,
            value:$measurement,
            recorded_on:$measurement_date,
            created_at:datetime()
        })

        CREATE (p)-[:HAS_MEASUREMENT {
            recorded_on:$measurement_date,
            visit_date:$visit_date
        }]->(m)

        CREATE (e:Evidence {
            evidence_id:$evidence_id,
            document_id:$document_id,
            document_name:$document_name,
            document_type:$document_type,
            document_date:$document_date,
            evidence_text:$evidence_text,
            page_number:$page_number,
            confidence:$confidence,
            extraction_date:$extraction_date
        })

        CREATE (m)-[:SUPPORTED_BY_EVIDENCE]->(e)
        """

        async with self.driver.session() as session:
            await session.run(
                query,
                patient_id=patient_id,
                meas_id=meas_id,
                measurement=measurement,
                measurement_date=measurement_date,
                visit_date=visit_date or datetime.utcnow().isoformat(),
                evidence_id=evidence.evidence_id,
                document_id=evidence.document_id,
                document_name=evidence.document_name,
                document_type=evidence.document_type,
                document_date=evidence.document_date,
                evidence_text=evidence.evidence_text,
                page_number=evidence.page_number,
                confidence=evidence.confidence,
                extraction_date=evidence.extraction_date.isoformat()
            )
        logger.info(f"✅ Diagnosis added with evidence:" )  
        return meas_id
    
    async def add_treatment_with_evidence(
        self,
        patient_id: str,
        treatment: str,
        details: str,
        treatment_date: str,
        evidence: Evidence,
        visit_date: Optional[str] = None
    ) -> str:

        treatment_id = f"treat_{uuid4().hex[:12]}"

        query = """
        MATCH (p:Patient {patient_id: $patient_id})

        CREATE (t:Treatment {
            treatment_id: $treatment_id,
            name: $treatment,
            details: $details,
            recommended_on: $treatment_date,
            created_at: datetime()
        })

        CREATE (p)-[:HAS_TREATMENT {
            recommended_on: $treatment_date,
            visit_date: $visit_date
        }]->(t)

        CREATE (e:Evidence {
            evidence_id: $evidence_id,
            document_id: $document_id,
            document_name: $document_name,
            document_type: $document_type,
            document_date: $document_date,
            evidence_text: $evidence_text,
            page_number: $page_number,
            confidence: $confidence,
            extraction_date: $extraction_date
        })

        CREATE (t)-[:SUPPORTED_BY_EVIDENCE]->(e)
        """

        async with self.driver.session() as session:
            await session.run(
                query,
                patient_id=patient_id,
                treatment_id=treatment_id,
                treatment=treatment,
                details=details,
                treatment_date=treatment_date,
                visit_date=visit_date or datetime.utcnow().isoformat(),

                # Evidence
                evidence_id=evidence.evidence_id,
                document_id=evidence.document_id,
                document_name=evidence.document_name,
                document_type=evidence.document_type,
                document_date=evidence.document_date,
                evidence_text=evidence.evidence_text,
                page_number=evidence.page_number,
                confidence=evidence.confidence,
                extraction_date=evidence.extraction_date.isoformat()
            )

        logger.info(f"✅ Treatment added with evidence: {treatment}")

        return treatment_id
    # =====================================================================
    # FOLLOW-UP VISIT CHANGE TRACKING
    # =====================================================================
    
    async def update_on_followup(
        self,
        patient_id: str,
        new_data: Dict[str, Any],
        visit_date: str
    ) -> Dict[str, Any]:
        """
        Handle follow-up visit with detailed change tracking
        
        Args:
            patient_id: Patient identifier
            new_data: New clinical data from follow-up
            visit_date: Date of follow-up visit
            
        Returns:
            Summary of changes made
        """
        logger.info(f"📝 Processing follow-up visit for {patient_id} on {visit_date}")
        
        changes = {
            "visit_date": visit_date,
            "symptoms_resolved": 0,
            "symptoms_added": 0,
            "medications_discontinued": 0,
            "medications_added": 0,
            "diagnoses_updated": 0,
            "total_changes": 0
        }
        
        # 1. Process symptoms
        if "current_symptoms" in new_data:
            symptom_changes = await self._update_symptoms(
                patient_id,
                new_data["current_symptoms"],
                visit_date
            )
            changes["symptoms_resolved"] = symptom_changes["resolved"]
            changes["symptoms_added"] = symptom_changes["added"]
        
        # 2. Process medications
        if "current_medications" in new_data:
            med_changes = await self._update_medications(
                patient_id,
                new_data["current_medications"],
                visit_date
            )
            changes["medications_discontinued"] = med_changes["discontinued"]
            changes["medications_added"] = med_changes["added"]
        
        # 3. Process diagnoses
        if "active_diagnoses" in new_data:
            dx_changes = await self._update_diagnoses(
                patient_id,
                new_data["active_diagnoses"],
                visit_date
            )
            changes["diagnoses_updated"] = dx_changes["updated"]
        
        # Calculate total changes
        changes["total_changes"] = sum([
            changes["symptoms_resolved"],
            changes["symptoms_added"],
            changes["medications_discontinued"],
            changes["medications_added"],
            changes["diagnoses_updated"]
        ])
        
        logger.info(f"✅ Follow-up processing complete: {changes['total_changes']} changes")
        
        return changes
    
    async def _update_symptoms(
        self,
        patient_id: str,
        current_symptoms: List[Dict[str, Any]],
        visit_date: str
    ) -> Dict[str, int]:
        """Update symptoms and track changes"""
        current_symptom_names = [s.get("name", s.get("symptom", "")) for s in current_symptoms]
        
        # Mark old symptoms as resolved
        query_resolve = """
        MATCH (p:Patient {patient_id: $patient_id})-[r:HAS_SYMPTOM]->(s:Symptom)
        WHERE s.is_active = true AND NOT s.name IN $current_symptoms
        SET s.is_active = false,
            s.resolved_date = $visit_date
        RETURN s.symptom_id as symptom_id, s.name as name
        """
        
        resolved_count = 0
        async with self.driver.session() as session:
            result = await session.run(
                query_resolve,
                patient_id=patient_id,
                current_symptoms=current_symptom_names,
                visit_date=visit_date
            )
            
            async for record in result:
                resolved_count += 1
                await self._log_change(
                    patient_id=patient_id,
                    visit_date=visit_date,
                    change_type=ChangeType.RESOLVED,
                    entity_type="Symptom",
                    entity_id=record["symptom_id"],
                    entity_name=record["name"],
                    old_value={"is_active": True},
                    new_value={"is_active": False},
                    reason="Not reported in follow-up visit"
                )
        
        logger.info(f"✅ Resolved {resolved_count} symptoms")
        
        return {"resolved": resolved_count, "added": 0}
    
    async def _update_medications(
        self,
        patient_id: str,
        current_medications: List[Dict[str, Any]],
        visit_date: str
    ) -> Dict[str, int]:
        """Update medications and track changes"""
        current_med_names = [m.get("drug", m.get("drug_name", "")) for m in current_medications]
        
        # Mark old medications as discontinued
        query_discontinue = """
        MATCH (p:Patient {patient_id: $patient_id})-[r:TAKES_MEDICATION]->(m:Medication)
        WHERE m.is_current = true AND NOT m.drug_name IN $current_meds
        SET m.is_current = false,
            m.discontinuation_date = $visit_date
        RETURN m.medication_id as med_id, m.drug_name as name, m.dose as dose
        """
        
        discontinued_count = 0
        async with self.driver.session() as session:
            result = await session.run(
                query_discontinue,
                patient_id=patient_id,
                current_meds=current_med_names,
                visit_date=visit_date
            )
            
            async for record in result:
                discontinued_count += 1
                await self._log_change(
                    patient_id=patient_id,
                    visit_date=visit_date,
                    change_type=ChangeType.DISCONTINUED,
                    entity_type="Medication",
                    entity_id=record["med_id"],
                    entity_name=record["name"],
                    old_value={"is_current": True, "dose": record["dose"]},
                    new_value={"is_current": False},
                    reason="Not prescribed in follow-up visit"
                )
        
        logger.info(f"✅ Discontinued {discontinued_count} medications")
        
        return {"discontinued": discontinued_count, "added": 0}
    
    async def _update_diagnoses(
        self,
        patient_id: str,
        active_diagnoses: List[Dict[str, Any]],
        visit_date: str
    ) -> Dict[str, int]:
        """Update diagnoses and track changes"""
        # This is primarily for updating staging or confidence
        # New diagnoses should be added via add_diagnosis_with_evidence
        
        updated_count = 0
        
        for dx in active_diagnoses:
            dx_name = dx.get("diagnosis", dx.get("name", ""))
            new_stage = dx.get("stage")
            new_confidence = dx.get("confidence")
            
            if new_stage or new_confidence:
                query = """
                MATCH (p:Patient {patient_id: $patient_id})-[]->(d:Diagnosis)
                WHERE d.name = $dx_name AND d.is_active = true
                SET d.stage = COALESCE($new_stage, d.stage),
                    d.confidence = COALESCE($new_confidence, d.confidence),
                    d.last_updated = $visit_date
                RETURN d.diagnosis_id as dx_id, d.name as name
                """
                
                async with self.driver.session() as session:
                    result = await session.run(
                        query,
                        patient_id=patient_id,
                        dx_name=dx_name,
                        new_stage=new_stage,
                        new_confidence=new_confidence,
                        visit_date=visit_date
                    )
                    
                    async for record in result:
                        updated_count += 1
                        await self._log_change(
                            patient_id=patient_id,
                            visit_date=visit_date,
                            change_type=ChangeType.MODIFIED,
                            entity_type="Diagnosis",
                            entity_id=record["dx_id"],
                            entity_name=record["name"],
                            new_value={"stage": new_stage, "confidence": new_confidence},
                            reason="Updated in follow-up visit"
                        )
        
        return {"updated": updated_count}
    
    async def _log_change(
        self,
        patient_id: str,
        visit_date: str,
        change_type: ChangeType,
        entity_type: str,
        entity_id: str,
        entity_name: str,
        old_value: Optional[Dict[str, Any]] = None,
        new_value: Optional[Dict[str, Any]] = None,
        reason: Optional[str] = None
    ):
        """Log change to MongoDB"""
        change_log = ChangeLog(
            change_id=f"change_{uuid4().hex[:12]}",
            patient_id=patient_id,
            visit_date=datetime.fromisoformat(visit_date),
            change_type=change_type,
            entity_type=entity_type,
            entity_id=entity_id,
            entity_name=entity_name,
            old_value=old_value,
            new_value=new_value,
            reason=reason,
            created_at=datetime.utcnow()
        )
        
        await self.change_logs_collection.insert_one(change_log.dict())
    
    # =====================================================================
    # QUERY FUNCTIONS WITH EVIDENCE
    # =====================================================================
    
    async def get_patient_graph_with_evidence(self, patient_id: str) -> Dict[str, Any]:
        """
        Retrieve complete patient knowledge graph with evidence
        """
        query = """
        MATCH (p:Patient {patient_id: $patient_id})
        OPTIONAL MATCH (p)-[r1:HAS_DIAGNOSIS]->(d:Diagnosis)-[:SUPPORTED_BY_EVIDENCE]->(ed:Evidence)
        OPTIONAL MATCH (p)-[r2:HAS_SYMPTOM]->(s:Symptom)-[:SUPPORTED_BY_EVIDENCE]->(es:Evidence)
        OPTIONAL MATCH (p)-[r3:TAKES_MEDICATION]->(m:Medication)-[:SUPPORTED_BY_EVIDENCE]->(em:Evidence)
        OPTIONAL MATCH (p)-[r4:HAS_LAB_RESULT]->(l:LabResult)-[:SUPPORTED_BY_EVIDENCE]->(el:Evidence)
        OPTIONAL MATCH (p)-[r5:HAS_VITAL_SIGN]->(v:VitalSign)-[:SUPPORTED_BY_EVIDENCE]->(ev:Evidence)
        
        RETURN p,
               collect(DISTINCT {diagnosis: d, evidence: ed}) as diagnoses,
               collect(DISTINCT {symptom: s, evidence: es}) as symptoms,
               collect(DISTINCT {medication: m, evidence: em}) as medications,
               collect(DISTINCT {lab: l, evidence: el}) as lab_results,
               collect(DISTINCT {vital: v, evidence: ev}) as vital_signs
        """
        
        async with self.driver.session() as session:
            result = await session.run(query, patient_id=patient_id)
            record = await result.single()
            
            if not record:
                return {"patient_id": patient_id, "graph_exists": False}
            
            return {
                "patient_id": patient_id,
                "graph_exists": True,
                "patient": dict(record["p"]),
                "diagnoses": [
                    {
                        "entity": dict(item["diagnosis"]) if item["diagnosis"] else None,
                        "evidence": dict(item["evidence"]) if item["evidence"] else None
                    }
                    for item in record["diagnoses"] if item["diagnosis"]
                ],
                "symptoms": [
                    {
                        "entity": dict(item["symptom"]) if item["symptom"] else None,
                        "evidence": dict(item["evidence"]) if item["evidence"] else None
                    }
                    for item in record["symptoms"] if item["symptom"]
                ],
                "medications": [
                    {
                        "entity": dict(item["medication"]) if item["medication"] else None,
                        "evidence": dict(item["evidence"]) if item["evidence"] else None
                    }
                    for item in record["medications"] if item["medication"]
                ],
                "lab_results": [
                    {
                        "entity": dict(item["lab"]) if item["lab"] else None,
                        "evidence": dict(item["evidence"]) if item["evidence"] else None
                    }
                    for item in record["lab_results"] if item["lab"]
                ],
                "vital_signs": [
                    {
                        "entity": dict(item["vital"]) if item["vital"] else None,
                        "evidence": dict(item["evidence"]) if item["evidence"] else None
                    }
                    for item in record["vital_signs"] if item["vital"]
                ]
            }
    
    async def get_change_log(
        self,
        patient_id: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Get change log for patient
        
        Args:
            patient_id: Patient identifier
            start_date: Filter changes after this date
            end_date: Filter changes before this date
            
        Returns:
            List of changes
        """
        query = {"patient_id": patient_id}
        
        if start_date or end_date:
            query["visit_date"] = {}
            if start_date:
                query["visit_date"]["$gte"] = datetime.fromisoformat(start_date)
            if end_date:
                query["visit_date"]["$lte"] = datetime.fromisoformat(end_date)
        
        changes = await self.change_logs_collection.find(query).sort("visit_date", -1).to_list(length=None)
        
        return [
            {
                "change_id": change["change_id"],
                "visit_date": change["visit_date"].isoformat(),
                "change_type": change["change_type"],
                "entity_type": change["entity_type"],
                "entity_name": change["entity_name"],
                "old_value": change.get("old_value"),
                "new_value": change.get("new_value"),
                "reason": change.get("reason")
            }
            for change in changes
        ]
    
    async def get_visit_summary(self, patient_id: str, visit_date: str) -> Dict[str, Any]:
        """
        Get summary of changes made during a specific visit
        """
        start_of_day = datetime.fromisoformat(visit_date).replace(hour=0, minute=0, second=0)
        end_of_day = datetime.fromisoformat(visit_date).replace(hour=23, minute=59, second=59)
        
        changes = await self.get_change_log(
            patient_id=patient_id,
            start_date=start_of_day.isoformat(),
            end_date=end_of_day.isoformat()
        )
        
        summary = {
            "visit_date": visit_date,
            "total_changes": len(changes),
            "changes_by_type": {},
            "changes_by_entity": {},
            "changes": changes
        }
        
        for change in changes:
            # By change type
            change_type = change["change_type"]
            if change_type not in summary["changes_by_type"]:
                summary["changes_by_type"][change_type] = 0
            summary["changes_by_type"][change_type] += 1
            
            # By entity type
            entity_type = change["entity_type"]
            if entity_type not in summary["changes_by_entity"]:
                summary["changes_by_entity"][entity_type] = 0
            summary["changes_by_entity"][entity_type] += 1
        
        return summary