"""
Structured Clinical Knowledge Graph
Optimized for agent traversal with minimal token usage.
Neo4j property graph with temporal layers.
"""

from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Union
from dataclasses import dataclass, field
from enum import Enum
import json
import os
from uuid import uuid4
from loguru import logger
from neo4j import AsyncGraphDatabase


# ==============================
# TEMPORAL & SEMANTIC ENUMS
# ==============================

class TemporalLayer(Enum):
    STATIC = "static"          # Permanent: age, sex, genetics, allergies
    EPISODIC = "episodic"      # Current admission/context
    EVENT = "event"            # Point-in-time: vitals, labs, notes
    INTERVAL = "interval"      # Duration-bound: medications, devices, isolation


class ClinicalStatus(Enum):
    ACTIVE = "active"
    RESOLVED = "resolved"
    CHRONIC = "chronic"
    DISCONTINUED = "discontinued"
    COMPLETED = "completed"


# ==============================
# CONFIG MODELS
# ==============================

@dataclass
class TemporalBounds:
    recorded_at: datetime
    valid_from: Optional[datetime] = None
    valid_until: Optional[datetime] = None
    layer: TemporalLayer = TemporalLayer.EVENT
    
    def is_current(self, as_of: Optional[datetime] = None) -> bool:
        check = as_of or datetime.utcnow()
        if self.layer == TemporalLayer.STATIC:
            return True
        if self.valid_from and check < self.valid_from:
            return False
        if self.valid_until and check > self.valid_until:
            return False
        return True
    
    def to_dict(self) -> Dict:
        return {
            "recorded_at": self.recorded_at.isoformat() if self.recorded_at else None,
            "valid_from": self.valid_from.isoformat() if self.valid_from else None,
            "valid_until": self.valid_until.isoformat() if self.valid_until else None,
            "layer": self.layer.value,
            "is_current": self.is_current()
        }


# ==============================
# STRUCTURED CLINICAL GRAPH
# ==============================

class StructuredClinicalGraph:
    """
    Neo4j-based clinical knowledge graph with:
    - Typed nodes (Patient, Condition, Medication, LabResult, etc.)
    - Semantic relationships (TREATS, MONITORED_FOR, CONTRAINDICATED_WITH)
    - Temporal properties on every relationship
    - Evidence linking to source documents
    """
    
    def __init__(self, uri: str, user: str, password: str):
        self.driver = AsyncGraphDatabase.driver(uri, auth=(user, password))
        self._ensure_schema_lock = False
    
    async def close(self):
        await self.driver.close()
    
    async def _ensure_schema(self):
        """Create constraints and indexes once."""
        if self._ensure_schema_lock:
            return
        async with self.driver.session() as session:
            # Constraints
            await session.run("""
                CREATE CONSTRAINT patient_id IF NOT EXISTS
                FOR (p:Patient) REQUIRE p.patient_id IS UNIQUE
            """)
            await session.run("""
                CREATE CONSTRAINT document_id IF NOT EXISTS
                FOR (d:Document) REQUIRE d.document_id IS UNIQUE
            """)
            # Indexes for fast traversal
            await session.run("""
                CREATE INDEX entity_name IF NOT EXISTS
                FOR (n:Condition) ON (n.name)
            """)
            await session.run("""
                CREATE INDEX med_name IF NOT EXISTS
                FOR (n:Medication) ON (n.name)
            """)
            await session.run("""
                CREATE INDEX rel_current IF NOT EXISTS
                FOR ()-[r:PRESCRIBED]-() ON (r.is_current)
            """)
        self._ensure_schema_lock = True
    
    # ==================== NODE CREATORS ====================
    
    async def create_patient_node(self, patient_id: str, demographics: Dict[str, Any], 
                                   visit_date: Optional[str] = None):
        """Create/merge patient with static demographic layer."""
        
        async with self.driver.session() as session:
            await session.run("""
                MERGE (p:Patient {patient_id: $patient_id})
                ON CREATE SET p.created_at = datetime()
                SET p.age = $age,
                    p.sex = $sex,
                    p.visit_date = $visit_date,
                    p.layer = 'static'
            """, patient_id=patient_id, 
                age=demographics.get("age"),
                sex=demographics.get("sex"),
                visit_date=visit_date)
    
    async def add_document_node(self, document_id: str, patient_id: str,
                                 file_name: str, document_date: Optional[str] = None,
                                 file_hash: Optional[str] = None) -> str:
        """Create document node linked to patient."""
        async with self.driver.session() as session:
            await session.run("""
                MATCH (p:Patient {patient_id: $patient_id})
                MERGE (d:Document {document_id: $document_id})
                ON CREATE SET d.file_name = $file_name,
                              d.document_date = $document_date,
                              d.file_hash = $file_hash,
                              d.processed_at = datetime()
                MERGE (p)-[:HAS_DOCUMENT {recorded_at: datetime()}]->(d)
            """, patient_id=patient_id, document_id=document_id,
                file_name=file_name, document_date=document_date,
                file_hash=file_hash)
        return document_id
    
    async def add_evidence_node(self, evidence_id: str, document_id: str,
                                 evidence_text: str, confidence: float,
                                 entity_name: str) -> str:
        """Create evidence node linked to document."""
        async with self.driver.session() as session:
            await session.run("""
                MATCH (d:Document {document_id: $document_id})
                MERGE (e:Evidence {evidence_id: $evidence_id})
                ON CREATE SET e.evidence_text = $evidence_text,
                              e.confidence = $confidence,
                              e.entity_name = $entity_name,
                              e.created_at = datetime()
                MERGE (d)-[:HAS_EVIDENCE {recorded_at: datetime()}]->(e)
            """, document_id=document_id, evidence_id=evidence_id,
                evidence_text=evidence_text, confidence=confidence,
                entity_name=entity_name)
        return evidence_id
    
    # ==================== CONDITION (DIAGNOSIS) ====================
    
    async def add_condition(self, patient_id: str, condition_name: str,
                            document_id: str, evidence_id: str,
                            icd10: Optional[str] = None,
                            snomed_ct: Optional[str] = None,
                            status: str = "active",
                            severity: Optional[str] = None,
                            category: Optional[str] = None,
                            onset_date: Optional[str] = None,
                            resolution_date: Optional[str] = None,
                            is_hai: bool = False,
                            is_communicable: bool = False,
                            is_primary: bool = False,
                            recorded_at: Optional[datetime] = None):
        """Add diagnosis with temporal episodic/interval layer."""
        rec = recorded_at or datetime.utcnow()
        layer = TemporalLayer.EPISODIC if status == "active" else TemporalLayer.INTERVAL
        
        async with self.driver.session() as session:
            result = await session.run("""
                MATCH (p:Patient {patient_id: $patient_id})
                MATCH (d:Document {document_id: $document_id})
                MATCH (ev:Evidence {evidence_id: $evidence_id})
                
                MERGE (c:Condition {name: $name, patient_id: $patient_id})
                ON CREATE SET c.icd10 = $icd10,
                              c.snomed_ct = $snomed_ct,
                              c.category = $category,
                              c.is_hai = $is_hai,
                              c.is_communicable = $is_communicable,
                              c.created_at = datetime()
                
                SET c.current_status = $status,
                    c.current_severity = $severity
                
                MERGE (p)-[r:PRESENTS_WITH]->(c)
                ON CREATE SET r.recorded_at = $recorded_at,
                              r.valid_from = $onset_date,
                              r.valid_until = $resolution_date,
                              r.status = $status,
                              r.severity = $severity,
                              r.is_primary = $is_primary,
                              r.layer = $layer,
                              r.is_current = $is_current
                
                MERGE (c)-[:DOCUMENTED_IN {recorded_at: datetime()}]->(d)
                MERGE (c)-[:SUPPORTED_BY {recorded_at: datetime()}]->(ev)
                
                RETURN c.name as condition_name
            """, patient_id=patient_id, name=condition_name,
                document_id=document_id, evidence_id=evidence_id,
                icd10=icd10, snomed_ct=snomed_ct,
                status=status, severity=severity, category=category,
                onset_date=onset_date, resolution_date=resolution_date,
                is_hai=is_hai, is_communicable=is_communicable,
                is_primary=is_primary, recorded_at=rec.isoformat(),
                layer=layer.value, is_current=layer != TemporalLayer.INTERVAL or not resolution_date)
            return await result.single()
    
    # ==================== MEDICATION ====================
    
    async def add_medication(self, patient_id: str, drug_name: str,
                             document_id: str, evidence_id: str,
                             generic_name: Optional[str] = None,
                             dose: Optional[str] = None,
                             frequency: Optional[str] = None,
                             route: Optional[str] = None,
                             indication: Optional[str] = None,
                             prescribed_by: Optional[str] = None,
                             start_date: Optional[str] = None,
                             end_date: Optional[str] = None,
                             status: str = "active",
                             drug_class: Optional[str] = None,
                             is_antimicrobial: bool = False,
                             is_anaesthetic: bool = False,
                             treats_condition: Optional[str] = None,
                             monitoring_params: Optional[List[Dict]] = None,
                             recorded_at: Optional[datetime] = None):
        """Add medication with interval temporal layer and monitoring links."""
        rec = recorded_at or datetime.utcnow()
        med_id = f"med_{uuid4().hex[:8]}"
        
        async with self.driver.session() as session:
            # Create medication node and PRESCRIBED edge
            await session.run("""
                MATCH (p:Patient {patient_id: $patient_id})
                MATCH (d:Document {document_id: $document_id})
                MATCH (ev:Evidence {evidence_id: $evidence_id})
                
                MERGE (m:Medication {name: $drug_name, patient_id: $patient_id})
                ON CREATE SET m.generic_name = $generic_name,
                              m.drug_class = $drug_class,
                              m.is_antimicrobial = $is_antimicrobial,
                              m.is_anaesthetic = $is_anaesthetic,
                              m.created_at = datetime()
                
                MERGE (p)-[r:PRESCRIBED {med_id: $med_id}]->(m)
                ON CREATE SET r.recorded_at = $recorded_at,
                              r.valid_from = $start_date,
                              r.valid_until = $end_date,
                              r.dose = $dose,
                              r.frequency = $frequency,
                              r.route = $route,
                              r.indication = $indication,
                              r.prescribed_by = $prescribed_by,
                              r.status = $status,
                              r.layer = 'interval',
                              r.is_current = $is_current
                
                MERGE (m)-[:DOCUMENTED_IN {recorded_at: datetime()}]->(d)
                MERGE (m)-[:SUPPORTED_BY {recorded_at: datetime()}]->(ev)
            """, patient_id=patient_id, drug_name=drug_name,
                document_id=document_id, evidence_id=evidence_id,
                med_id=med_id, generic_name=generic_name,
                dose=dose, frequency=frequency, route=route,
                indication=indication, prescribed_by=prescribed_by,
                start_date=start_date, end_date=end_date,
                status=status, drug_class=drug_class,
                is_antimicrobial=is_antimicrobial, is_anaesthetic=is_anaesthetic,
                recorded_at=rec.isoformat(), is_current=status == "active")
            
            # Link to condition it treats
            if treats_condition:
                await session.run("""
                    MATCH (p:Patient {patient_id: $patient_id})-[:PRESENTS_WITH]->(c:Condition)
                    WHERE c.name = $treats_condition OR c.name CONTAINS $treats_condition
                    MATCH (p)-[:PRESCRIBED {med_id: $med_id}]->(m:Medication)
                    MERGE (m)-[t:TREATS]->(c)
                    ON CREATE SET t.recorded_at = $recorded_at,
                                  t.efficacy = 'unknown',
                                  t.is_targeted = false
                """, patient_id=patient_id, treats_condition=treats_condition,
                    med_id=med_id, recorded_at=rec.isoformat())
            
            # Create monitoring nodes for side-effect tracking
            if monitoring_params:
                for param in monitoring_params:
                    param_id = f"mon_{uuid4().hex[:8]}"
                    await session.run("""
                        MATCH (p:Patient {patient_id: $patient_id})
                        MATCH (p)-[:PRESCRIBED {med_id: $med_id}]->(m:Medication)
                        
                        CREATE (mon:MonitoringParam {
                            param_id: $param_id,
                            name: $name,
                            expected_effect: $expected_effect,
                            adverse_effect_risk: $adverse_risk,
                            frequency: $frequency,
                            alert_threshold: $threshold,
                            created_at: datetime()
                        })
                        
                        CREATE (m)-[r:MONITORED_FOR {
                            recorded_at: $recorded_at,
                            layer: 'interval',
                            is_current: true
                        }]->(mon)
                        
                        CREATE (p)-[:SHOULD_MONITOR {
                            param_id: $param_id,
                            recorded_at: $recorded_at
                        }]->(mon)
                    """, patient_id=patient_id, med_id=med_id,
                        param_id=param_id, name=param.get("name"),
                        expected_effect=param.get("expected_effect"),
                        adverse_risk=param.get("adverse_effect_risk"),
                        frequency=param.get("frequency"),
                        threshold=json.dumps(param.get("alert_threshold")) if param.get("alert_threshold") else None,
                        recorded_at=rec.isoformat())
        
        return med_id
    
    # ==================== LAB RESULT ====================
    
    async def add_lab_result(self, patient_id: str, test_name: str,
                             document_id: str, evidence_id: str,
                             value: Optional[str] = None,
                             unit: Optional[str] = None,
                             reference_low: Optional[float] = None,
                             reference_high: Optional[float] = None,
                             is_abnormal: bool = False,
                             is_critical: bool = False,
                             test_date: Optional[str] = None,
                             specimen_type: Optional[str] = None,
                             recorded_at: Optional[datetime] = None):
        """Add lab result as event node."""
        rec = recorded_at or datetime.utcnow()
        
        async with self.driver.session() as session:
            await session.run("""
                MATCH (p:Patient {patient_id: $patient_id})
                MATCH (d:Document {document_id: $document_id})
                MATCH (ev:Evidence {evidence_id: $evidence_id})
                
                CREATE (l:LabResult {
                    lab_id: $lab_id,
                    test_name: $test_name,
                    value: $value,
                    unit: $unit,
                    reference_low: $reference_low,
                    reference_high: $reference_high,
                    is_abnormal: $is_abnormal,
                    is_critical: $is_critical,
                    specimen_type: $specimen_type,
                    created_at: datetime()
                })
                
                CREATE (p)-[r:HAS_LAB_RESULT {
                    recorded_at: $recorded_at,
                    test_date: $test_date,
                    layer: 'event',
                    is_current: true
                }]->(l)
                
                CREATE (l)-[:DOCUMENTED_IN {recorded_at: datetime()}]->(d)
                CREATE (l)-[:SUPPORTED_BY {recorded_at: datetime()}]->(ev)
            """, patient_id=patient_id, document_id=document_id,
                evidence_id=evidence_id, lab_id=f"lab_{uuid4().hex[:8]}",
                test_name=test_name, value=str(value) if value is not None else None,
                unit=unit, reference_low=reference_low,
                reference_high=reference_high, is_abnormal=is_abnormal,
                is_critical=is_critical, specimen_type=specimen_type,
                recorded_at=rec.isoformat(), test_date=test_date)
    
    # ==================== VITAL SIGN ====================
    
    async def add_vital_sign(self, patient_id: str, vital_type: str,
                             document_id: str, evidence_id: str,
                             value: Optional[str] = None,
                             unit: Optional[str] = None,
                             trend: Optional[str] = None,
                             measurement_date: Optional[str] = None,
                             is_abnormal: bool = False,
                             recorded_at: Optional[datetime] = None):
        """Add vital sign as event node."""
        rec = recorded_at or datetime.utcnow()
        
        async with self.driver.session() as session:
            await session.run("""
                MATCH (p:Patient {patient_id: $patient_id})
                MATCH (d:Document {document_id: $document_id})
                MATCH (ev:Evidence {evidence_id: $evidence_id})
                
                CREATE (v:VitalSign {
                    vital_id: $vital_id,
                    vital_type: $vital_type,
                    value: $value,
                    unit: $unit,
                    trend: $trend,
                    is_abnormal: $is_abnormal,
                    created_at: datetime()
                })
                
                CREATE (p)-[r:HAS_VITAL {
                    recorded_at: $recorded_at,
                    measurement_date: $measurement_date,
                    layer: 'event',
                    is_current: true
                }]->(v)
                
                CREATE (v)-[:DOCUMENTED_IN {recorded_at: datetime()}]->(d)
                CREATE (v)-[:SUPPORTED_BY {recorded_at: datetime()}]->(ev)
            """, patient_id=patient_id, document_id=document_id,
                evidence_id=evidence_id, vital_id=f"vit_{uuid4().hex[:8]}",
                vital_type=vital_type, value=str(value) if value is not None else None,
                unit=unit, trend=trend, is_abnormal=is_abnormal,
                recorded_at=rec.isoformat(), measurement_date=measurement_date)
    
    # ==================== SYMPTOM ====================
    
    async def add_symptom(self, patient_id: str, symptom_name: str,
                          document_id: str, evidence_id: str,
                          onset_date: Optional[str] = None,
                          severity: Optional[str] = None,
                          status: str = "active",
                          recorded_at: Optional[datetime] = None):
        rec = recorded_at or datetime.utcnow()
        
        async with self.driver.session() as session:
            await session.run("""
                MATCH (p:Patient {patient_id: $patient_id})
                MATCH (d:Document {document_id: $document_id})
                MATCH (ev:Evidence {evidence_id: $evidence_id})
                
                MERGE (s:Symptom {name: $name, patient_id: $patient_id})
                ON CREATE SET s.created_at = datetime()
                
                SET s.current_severity = $severity
                
                MERGE (p)-[r:HAS_SYMPTOM]->(s)
                ON CREATE SET r.recorded_at = $recorded_at,
                              r.onset_date = $onset_date,
                              r.severity = $severity,
                              r.status = $status,
                              r.layer = 'episodic',
                              r.is_current = $is_current
                
                CREATE (s)-[:DOCUMENTED_IN {recorded_at: datetime()}]->(d)
                CREATE (s)-[:SUPPORTED_BY {recorded_at: datetime()}]->(ev)
            """, patient_id=patient_id, name=symptom_name,
                document_id=document_id, evidence_id=evidence_id,
                onset_date=onset_date, severity=severity,
                status=status, recorded_at=rec.isoformat(),
                is_current=status == "active")
    
    # ==================== FINDING ====================
    
    async def add_finding(self, patient_id: str, finding_name: str,
                          document_id: str, evidence_id: str,
                          category: Optional[str] = None,
                          date: Optional[str] = None,
                          recorded_at: Optional[datetime] = None):
        rec = recorded_at or datetime.utcnow()
        
        async with self.driver.session() as session:
            await session.run("""
                MATCH (p:Patient {patient_id: $patient_id})
                MATCH (d:Document {document_id: $document_id})
                MATCH (ev:Evidence {evidence_id: $evidence_id})
                
                CREATE (f:Finding {
                    finding_id: $finding_id,
                    name: $name,
                    category: $category,
                    created_at: datetime()
                })
                
                CREATE (p)-[r:HAS_FINDING {
                    recorded_at: $recorded_at,
                    date: $date,
                    layer: 'event',
                    is_current: true
                }]->(f)
                
                CREATE (f)-[:DOCUMENTED_IN {recorded_at: datetime()}]->(d)
                CREATE (f)-[:SUPPORTED_BY {recorded_at: datetime()}]->(ev)
            """, patient_id=patient_id, document_id=document_id,
                evidence_id=evidence_id, finding_id=f"fnd_{uuid4().hex[:8]}",
                name=finding_name, category=category,
                recorded_at=rec.isoformat(), date=date)
    
    # ==================== PROCEDURE ====================
    
    async def add_procedure(self, patient_id: str, procedure_name: str,
                            document_id: str, evidence_id: str,
                            procedure_type: Optional[str] = None,
                            procedure_date: Optional[str] = None,
                            outcome: Optional[str] = None,
                            recorded_at: Optional[datetime] = None):
        rec = recorded_at or datetime.utcnow()
        
        async with self.driver.session() as session:
            await session.run("""
                MATCH (p:Patient {patient_id: $patient_id})
                MATCH (d:Document {document_id: $document_id})
                MATCH (ev:Evidence {evidence_id: $evidence_id})
                
                CREATE (pr:Procedure {
                    proc_id: $proc_id,
                    name: $name,
                    type: $type,
                    outcome: $outcome,
                    created_at: datetime()
                })
                
                CREATE (p)-[r:UNDERWENT {
                    recorded_at: $recorded_at,
                    procedure_date: $procedure_date,
                    layer: 'event',
                    is_current: true
                }]->(pr)
                
                CREATE (pr)-[:DOCUMENTED_IN {recorded_at: datetime()}]->(d)
                CREATE (pr)-[:SUPPORTED_BY {recorded_at: datetime()}]->(ev)
            """, patient_id=patient_id, document_id=document_id,
                evidence_id=evidence_id, proc_id=f"prc_{uuid4().hex[:8]}",
                name=procedure_name, type=procedure_type,
                outcome=outcome, recorded_at=rec.isoformat(),
                procedure_date=procedure_date)
    
    # ==================== MEASUREMENT ====================
    
    async def add_measurement(self, patient_id: str, measurement_name: str,
                              document_id: str, evidence_id: str,
                              value: Optional[str] = None,
                              unit: Optional[str] = None,
                              date: Optional[str] = None,
                              recorded_at: Optional[datetime] = None):
        rec = recorded_at or datetime.utcnow()
        
        async with self.driver.session() as session:
            await session.run("""
                MATCH (p:Patient {patient_id: $patient_id})
                MATCH (d:Document {document_id: $document_id})
                MATCH (ev:Evidence {evidence_id: $evidence_id})
                
                CREATE (m:Measurement {
                    meas_id: $meas_id,
                    name: $name,
                    value: $value,
                    unit: $unit,
                    created_at: datetime()
                })
                
                CREATE (p)-[r:HAS_MEASUREMENT {
                    recorded_at: $recorded_at,
                    date: $date,
                    layer: 'event',
                    is_current: true
                }]->(m)
                
                CREATE (m)-[:DOCUMENTED_IN {recorded_at: datetime()}]->(d)
                CREATE (m)-[:SUPPORTED_BY {recorded_at: datetime()}]->(ev)
            """, patient_id=patient_id, document_id=document_id,
                evidence_id=evidence_id, meas_id=f"msr_{uuid4().hex[:8]}",
                name=measurement_name, value=str(value) if value is not None else None,
                unit=unit, recorded_at=rec.isoformat(), date=date)
    
    # ==================== INVESTIGATION ====================
    
    async def add_investigation(self, patient_id: str, investigation_name: str,
                                document_id: str, evidence_id: str,
                                details: Optional[str] = None,
                                investigation_date: Optional[str] = None,
                                recorded_at: Optional[datetime] = None):
        rec = recorded_at or datetime.utcnow()
        
        async with self.driver.session() as session:
            await session.run("""
                MATCH (p:Patient {patient_id: $patient_id})
                MATCH (d:Document {document_id: $document_id})
                MATCH (ev:Evidence {evidence_id: $evidence_id})
                
                CREATE (i:Investigation {
                    inv_id: $inv_id,
                    name: $name,
                    details: $details,
                    created_at: datetime()
                })
                
                CREATE (p)-[r:HAS_INVESTIGATION {
                    recorded_at: $recorded_at,
                    date: $investigation_date,
                    layer: 'event',
                    is_current: true
                }]->(i)
                
                CREATE (i)-[:DOCUMENTED_IN {recorded_at: datetime()}]->(d)
                CREATE (i)-[:SUPPORTED_BY {recorded_at: datetime()}]->(ev)
            """, patient_id=patient_id, document_id=document_id,
                evidence_id=evidence_id, inv_id=f"inv_{uuid4().hex[:8]}",
                name=investigation_name, details=details,
                recorded_at=rec.isoformat(), investigation_date=investigation_date)
    
    # ==================== TREATMENT ====================
    
    async def add_treatment(self, patient_id: str, treatment_name: str,
                            document_id: str, evidence_id: str,
                            value: Optional[str] = None,
                            treatment_date: Optional[str] = None,
                            recorded_at: Optional[datetime] = None):
        rec = recorded_at or datetime.utcnow()
        
        async with self.driver.session() as session:
            await session.run("""
                MATCH (p:Patient {patient_id: $patient_id})
                MATCH (d:Document {document_id: $document_id})
                MATCH (ev:Evidence {evidence_id: $evidence_id})
                
                CREATE (t:Treatment {
                    tx_id: $tx_id,
                    name: $name,
                    value: $value,
                    created_at: datetime()
                })
                
                CREATE (p)-[r:RECEIVES_TREATMENT {
                    recorded_at: $recorded_at,
                    date: $treatment_date,
                    layer: 'interval',
                    is_current: true
                }]->(t)
                
                CREATE (t)-[:DOCUMENTED_IN {recorded_at: datetime()}]->(d)
                CREATE (t)-[:SUPPORTED_BY {recorded_at: datetime()}]->(ev)
            """, patient_id=patient_id, document_id=document_id,
                evidence_id=evidence_id, tx_id=f"tx_{uuid4().hex[:8]}",
                name=treatment_name, value=value,
                recorded_at=rec.isoformat(), treatment_date=treatment_date)
    
    # ==================== ANATOMY ====================
    
    async def add_anatomy(self, patient_id: str, anatomy_name: str,
                          document_id: str, evidence_id: str,
                          date: Optional[str] = None,
                          recorded_at: Optional[datetime] = None):
        rec = recorded_at or datetime.utcnow()
        
        async with self.driver.session() as session:
            await session.run("""
                MATCH (p:Patient {patient_id: $patient_id})
                MATCH (d:Document {document_id: $document_id})
                MATCH (ev:Evidence {evidence_id: $evidence_id})
                
                MERGE (a:Anatomy {name: $name})
                ON CREATE SET a.created_at = datetime()
                
                CREATE (p)-[r:HAS_ANATOMY {
                    recorded_at: $recorded_at,
                    date: $date,
                    layer: 'static',
                    is_current: true
                }]->(a)
                
                CREATE (a)-[:DOCUMENTED_IN {recorded_at: datetime()}]->(d)
                CREATE (a)-[:SUPPORTED_BY {recorded_at: datetime()}]->(ev)
            """, patient_id=patient_id, document_id=document_id,
                evidence_id=evidence_id, name=anatomy_name,
                recorded_at=rec.isoformat(), date=date)
    
    # ==================== ALLERGY ====================
    
    async def add_allergy(self, patient_id: str, allergen: str,
                          document_id: str, evidence_id: str,
                          allergen_type: str = "drug",
                          reaction: Optional[str] = None,
                          severity: Optional[str] = None,
                          mechanism: Optional[str] = None,
                          onset_date: Optional[str] = None,
                          recorded_at: Optional[datetime] = None):
        rec = recorded_at or datetime.utcnow()
        
        async with self.driver.session() as session:
            await session.run("""
                MATCH (p:Patient {patient_id: $patient_id})
                MATCH (d:Document {document_id: $document_id})
                MATCH (ev:Evidence {evidence_id: $evidence_id})
                
                MERGE (al:Allergy {allergen: $allergen, patient_id: $patient_id})
                ON CREATE SET al.allergen_type = $allergen_type,
                              al.reaction = $reaction,
                              al.severity = $severity,
                              al.mechanism = $mechanism,
                              al.onset_date = $onset_date,
                              al.created_at = datetime()
                
                MERGE (p)-[r:HAS_ALLERGY]->(al)
                ON CREATE SET r.recorded_at = $recorded_at,
                              r.layer = 'static',
                              r.is_current = true
                
                CREATE (al)-[:DOCUMENTED_IN {recorded_at: datetime()}]->(d)
                CREATE (al)-[:SUPPORTED_BY {recorded_at: datetime()}]->(ev)
            """, patient_id=patient_id, document_id=document_id,
                evidence_id=evidence_id, allergen=allergen,
                allergen_type=allergen_type, reaction=reaction,
                severity=severity, mechanism=mechanism,
                onset_date=onset_date, recorded_at=rec.isoformat())
    
    # ==================== AGENT RETRIEVAL QUERIES ====================
    
    async def get_patient_summary(self, patient_id: str) -> Dict[str, Any]:
        """
        Generate compact patient summary for LLM agent context.
        Minimizes token usage by pre-aggregating and filtering.
        """
        async with self.driver.session() as session:
            # Static profile
            static_result = await session.run("""
                MATCH (p:Patient {patient_id: $patient_id})
                OPTIONAL MATCH (p)-[:HAS_ALLERGY]->(al:Allergy)
                WITH p, collect(DISTINCT {
                    allergen: al.allergen,
                    type: al.allergen_type,
                    severity: al.severity,
                    reaction: al.reaction
                }) as allergies
                RETURN {
                    patient_id: p.patient_id,
                    age: p.age,
                    sex: p.sex,
                    allergies: allergies
                } as profile
            """, patient_id=patient_id)
            static_record = await static_result.single()
            profile = static_record["profile"] if static_record else {}
            
            # Current clinical state (active only)
            current_result = await session.run("""
                MATCH (p:Patient {patient_id: $patient_id})
                
                OPTIONAL MATCH (p)-[rc:PRESENTS_WITH {is_current: true}]->(c:Condition)
                WITH p, collect(DISTINCT {
                    name: c.name,
                    status: rc.status,
                    severity: rc.severity,
                    since: rc.valid_from
                }) as conditions
                
                OPTIONAL MATCH (p)-[rm:PRESCRIBED {is_current: true}]->(m:Medication)
                WITH p, conditions, collect(DISTINCT {
                    name: m.name,
                    dose: rm.dose,
                    frequency: rm.frequency,
                    indication: rm.indication,
                    since: rm.valid_from
                }) as medications
                
                OPTIONAL MATCH (p)-[rd:HAS_DEVICE {is_current: true}]->(d:InvasiveDevice)
                WITH p, conditions, medications, collect(DISTINCT {
                    type: d.device_type,
                    since: rd.inserted_date
                }) as devices
                
                OPTIONAL MATCH (p)-[ri:REQUIRES_ISOLATION {is_current: true}]->(i:TransmissionMode)
                RETURN {
                    active_conditions: conditions,
                    active_medications: medications,
                    active_devices: devices,
                    isolation: collect(DISTINCT {mode: i.mode, since: ri.valid_from})
                } as current
            """, patient_id=patient_id)
            current_record = await current_result.single()
            current = current_record["current"] if current_record else {}
            
            # Recent events (last 48 hours)
            cutoff = (datetime.utcnow() - timedelta(hours=48)).isoformat()
            recent_result = await session.run("""
                MATCH (p:Patient {patient_id: $patient_id})
                
                OPTIONAL MATCH (p)-[rv:HAS_VITAL]->(v:VitalSign)
                WHERE rv.recorded_at >= $cutoff
                WITH p, collect(DISTINCT {
                    type: v.vital_type,
                    value: v.value,
                    unit: v.unit,
                    timestamp: rv.recorded_at,
                    is_abnormal: v.is_abnormal
                }) as vitals
                
                OPTIONAL MATCH (p)-[rl:HAS_LAB_RESULT]->(l:LabResult)
                WHERE rl.recorded_at >= $cutoff
                WITH p, vitals, collect(DISTINCT {
                    test: l.test_name,
                    value: l.value,
                    unit: l.unit,
                    timestamp: rl.recorded_at,
                    is_abnormal: l.is_abnormal,
                    is_critical: l.is_critical
                }) as labs
                
                RETURN {
                    recent_vitals: vitals,
                    recent_labs: labs
                } as recent
            """, patient_id=patient_id, cutoff=cutoff)
            recent_record = await recent_result.single()
            recent = recent_record["recent"] if recent_record else {}
            
            # Medication monitoring requirements
            monitor_result = await session.run("""
                MATCH (p:Patient {patient_id: $patient_id})
                MATCH (p)-[:PRESCRIBED {is_current: true}]->(m:Medication)
                MATCH (m)-[:MONITORED_FOR]->(mon:MonitoringParam)
                RETURN collect(DISTINCT {
                    medication: m.name,
                    parameter: mon.name,
                    expected_effect: mon.expected_effect,
                    adverse_risk: mon.adverse_effect_risk,
                    frequency: mon.frequency,
                    alert_threshold: mon.alert_threshold
                }) as monitoring
            """, patient_id=patient_id)
            monitor_record = await monitor_result.single()
            monitoring = monitor_record["monitoring"] if monitor_record else []
            
            # Contraindications (active allergies vs active meds)
            contras_result = await session.run("""
                MATCH (p:Patient {patient_id: $patient_id})
                MATCH (p)-[:HAS_ALLERGY]->(al:Allergy)
                MATCH (p)-[:PRESCRIBED {is_current: true}]->(m:Medication)
                WHERE m.name CONTAINS al.allergen OR al.allergen CONTAINS m.name
                RETURN collect(DISTINCT {
                    allergen: al.allergen,
                    medication: m.name,
                    severity: al.severity,
                    mechanism: al.mechanism
                }) as contraindications
            """, patient_id=patient_id)
            contras_record = await contras_result.single()
            contras = contras_record["contraindications"] if contras_record else []
            
            return {
                "patient_id": patient_id,
                "static_profile": {
                    "demographics": {
                        "age": profile.get("age"),
                        "sex": profile.get("sex")
                    },
                    "allergies": profile.get("allergies", [])
                },
                "current_clinical_state": current,
                "recent_events_48h": {
                    "vitals": recent.get("recent_vitals", []),
                    "labs": recent.get("recent_labs", [])
                },
                "medication_monitoring": monitoring,
                "contraindications": contras,
                "graph_stats": await self._get_graph_stats(patient_id)
            }
    
    async def _get_graph_stats(self, patient_id: str) -> Dict:
        async with self.driver.session() as session:
            result = await session.run("""
                MATCH (p:Patient {patient_id: $patient_id})
                OPTIONAL MATCH (p)-[]->(n)
                OPTIONAL MATCH (p)-[r]->()
                RETURN count(DISTINCT n) as total_nodes,
                       count(DISTINCT r) as total_edges,
                       sum(CASE WHEN r.is_current = true THEN 1 ELSE 0 END) as active_edges
            """, patient_id=patient_id)
            record = await result.single()
            return {
                "total_nodes": record["total_nodes"],
                "total_edges": record["total_edges"],
                "active_edges": record["active_edges"]
            }
    
    async def get_vital_trend(self, patient_id: str, vital_type: str, 
                               days: int = 7) -> List[Dict]:
        """Get vital trend for specific type within N days."""
        cutoff = (datetime.utcnow() - timedelta(days=days)).isoformat()
        async with self.driver.session() as session:
            result = await session.run("""
                MATCH (p:Patient {patient_id: $patient_id})
                      -[r:HAS_VITAL]->(v:VitalSign)
                WHERE v.vital_type = $vital_type
                  AND r.recorded_at >= $cutoff
                RETURN {
                    timestamp: r.recorded_at,
                    value: v.value,
                    unit: v.unit,
                    trend: v.trend,
                    is_abnormal: v.is_abnormal
                } as reading
                ORDER BY r.recorded_at DESC
            """, patient_id=patient_id, vital_type=vital_type, cutoff=cutoff)
            records = await result.data()
            return [r["reading"] for r in records]
    
    async def get_current_medications(self, patient_id: str) -> List[Dict]:
        async with self.driver.session() as session:
            result = await session.run("""
                MATCH (p:Patient {patient_id: $patient_id})
                      -[r:PRESCRIBED {is_current: true}]->(m:Medication)
                RETURN {
                    name: m.name,
                    generic: m.generic_name,
                    dose: r.dose,
                    frequency: r.frequency,
                    route: r.route,
                    indication: r.indication,
                    since: r.valid_from,
                    drug_class: m.drug_class
                } as med
            """, patient_id=patient_id)
            records = await result.data()
            return [r["med"] for r in records]
    
    async def get_active_conditions(self, patient_id: str) -> List[Dict]:
        async with self.driver.session() as session:
            result = await session.run("""
                MATCH (p:Patient {patient_id: $patient_id})
                      -[r:PRESENTS_WITH {is_current: true}]->(c:Condition)
                RETURN {
                    name: c.name,
                    status: r.status,
                    severity: r.severity,
                    since: r.valid_from,
                    is_primary: r.is_primary
                } as condition
            """, patient_id=patient_id)
            records = await result.data()
            return [r["condition"] for r in records]
    
    async def get_medication_monitoring(self, patient_id: str, 
                                         med_name: Optional[str] = None) -> List[Dict]:
        async with self.driver.session() as session:
            if med_name:
                result = await session.run("""
                    MATCH (p:Patient {patient_id: $patient_id})
                          -[:PRESCRIBED]->(m:Medication {name: $med_name})
                          -[:MONITORED_FOR]->(mon:MonitoringParam)
                    RETURN {
                        medication: m.name,
                        parameter: mon.name,
                        expected_effect: mon.expected_effect,
                        adverse_risk: mon.adverse_effect_risk,
                        frequency: mon.frequency,
                        alert_threshold: mon.alert_threshold
                    } as monitor
                """, patient_id=patient_id, med_name=med_name)
            else:
                result = await session.run("""
                    MATCH (p:Patient {patient_id: $patient_id})
                          -[:PRESCRIBED {is_current: true}]->(m:Medication)
                          -[:MONITORED_FOR]->(mon:MonitoringParam)
                    RETURN {
                        medication: m.name,
                        parameter: mon.name,
                        expected_effect: mon.expected_effect,
                        adverse_risk: mon.adverse_effect_risk,
                        frequency: mon.frequency,
                        alert_threshold: mon.alert_threshold
                    } as monitor
                """, patient_id=patient_id)
            records = await result.data()
            return [r["monitor"] for r in records]
    
    async def get_clinical_timeline(self, patient_id: str,
                                     start: Optional[str] = None,
                                     end: Optional[str] = None) -> List[Dict]:
        """Get all events chronologically for timeline visualization."""
        async with self.driver.session() as session:
            result = await session.run("""
                MATCH (p:Patient {patient_id: $patient_id})-[r]->(n)
                WHERE n:Condition OR n:Medication OR n:LabResult 
                   OR n:VitalSign OR n:Procedure OR n:Symptom
                   OR n:Finding OR n:Treatment
                AND ($start IS NULL OR r.recorded_at >= $start)
                AND ($end IS NULL OR r.recorded_at <= $end)
                RETURN {
                    timestamp: r.recorded_at,
                    type: labels(n)[0],
                    name: n.name,
                    relationship: type(r),
                    status: r.status,
                    is_current: r.is_current
                } as event
                ORDER BY r.recorded_at DESC
            """, patient_id=patient_id, start=start, end=end)
            records = await result.data()
            return [r["event"] for r in records]


# ==============================
# ENTITY-TO-GRAPH MAPPER
# ==============================

async def push_to_structured_graph(
    scg: StructuredClinicalGraph,
    patient_id: str,
    document_id: str,
    entities: List[Any],  # List[ExtractedEntity]
    metadata: Dict[str, Any],
    document_date: Optional[str] = None
):
    """
    Maps extracted entities to structured clinical knowledge graph.
    Call this INSIDE process_mongo_document after entity validation.
    """
    file_name = metadata.get("file_name", "unknown")
    
    # 1. Create Document node
    await scg.add_document_node(
        document_id=document_id,
        patient_id=patient_id,
        file_name=file_name,
        document_date=document_date,
        file_hash=metadata.get("file_hash")
    )
    
    # 2. Process each entity
    for e in entities:
        entity_type = e.entity_type.lower().replace(" ", "_")
        evidence_id = f"ev_{uuid4().hex[:10]}"
        
        # Create evidence node first
        await scg.add_evidence_node(
            evidence_id=evidence_id,
            document_id=document_id,
            evidence_text=e.evidence_text,
            confidence=e.confidence,
            entity_name=e.entity_name
        )
        
        # Route to appropriate node creator
        try:
            if entity_type == "diagnosis":
                await scg.add_condition(
                    patient_id=patient_id,
                    condition_name=e.entity_name,
                    document_id=document_id,
                    evidence_id=evidence_id,
                    status="active",
                    recorded_at=datetime.utcnow()
                )
            
            elif entity_type == "medication":
                # Parse dose from entity_value if available
                dose = e.entity_value if e.entity_value else None
                await scg.add_medication(
                    patient_id=patient_id,
                    drug_name=e.entity_name,
                    document_id=document_id,
                    evidence_id=evidence_id,
                    dose=dose,
                    status="active",
                    recorded_at=datetime.utcnow()
                )
            
            elif entity_type == "lab_result":
                await scg.add_lab_result(
                    patient_id=patient_id,
                    test_name=e.entity_name,
                    document_id=document_id,
                    evidence_id=evidence_id,
                    value=e.entity_value,
                    test_date=document_date,
                    recorded_at=datetime.utcnow()
                )
            
            elif entity_type == "vital_sign":
                await scg.add_vital_sign(
                    patient_id=patient_id,
                    vital_type=e.entity_name,
                    document_id=document_id,
                    evidence_id=evidence_id,
                    value=e.entity_value,
                    measurement_date=document_date,
                    recorded_at=datetime.utcnow()
                )
            
            elif entity_type == "symptom":
                await scg.add_symptom(
                    patient_id=patient_id,
                    symptom_name=e.entity_name,
                    document_id=document_id,
                    evidence_id=evidence_id,
                    onset_date=document_date,
                    recorded_at=datetime.utcnow()
                )
            
            elif entity_type == "finding":
                await scg.add_finding(
                    patient_id=patient_id,
                    finding_name=e.entity_name,
                    document_id=document_id,
                    evidence_id=evidence_id,
                    date=document_date,
                    recorded_at=datetime.utcnow()
                )
            
            elif entity_type == "procedure":
                await scg.add_procedure(
                    patient_id=patient_id,
                    procedure_name=e.entity_name,
                    document_id=document_id,
                    evidence_id=evidence_id,
                    procedure_date=document_date,
                    recorded_at=datetime.utcnow()
                )
            
            elif entity_type == "measurement":
                await scg.add_measurement(
                    patient_id=patient_id,
                    measurement_name=e.entity_name,
                    document_id=document_id,
                    evidence_id=evidence_id,
                    value=e.entity_value,
                    date=document_date,
                    recorded_at=datetime.utcnow()
                )
            
            elif entity_type == "investigation":
                await scg.add_investigation(
                    patient_id=patient_id,
                    investigation_name=e.entity_name,
                    document_id=document_id,
                    evidence_id=evidence_id,
                    details=e.entity_value,
                    investigation_date=document_date,
                    recorded_at=datetime.utcnow()
                )
            
            elif entity_type == "treatment":
                await scg.add_treatment(
                    patient_id=patient_id,
                    treatment_name=e.entity_name,
                    document_id=document_id,
                    evidence_id=evidence_id,
                    value=e.entity_value,
                    treatment_date=document_date,
                    recorded_at=datetime.utcnow()
                )
            
            elif entity_type == "anatomy":
                await scg.add_anatomy(
                    patient_id=patient_id,
                    anatomy_name=e.entity_name,
                    document_id=document_id,
                    evidence_id=evidence_id,
                    date=document_date,
                    recorded_at=datetime.utcnow()
                )
            
            else:
                logger.warning(f"Unhandled entity type: {entity_type} for {e.entity_name}")
                
        except Exception as ex:
            logger.error(f"Failed to push entity {e.entity_name} ({entity_type}): {ex}")
    
    logger.info(f"Structured graph updated for patient={patient_id}, doc={document_id}, entities={len(entities)}")