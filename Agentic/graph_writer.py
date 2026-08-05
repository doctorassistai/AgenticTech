"""
graph_writer.py — Phase 3, 4, 5
=================================
CHANGED: All Neo4j graph operations are now DOCTOR-CENTRIC.

Phase 3: Neo4j writer
  - MERGE nodes by (doctor_id, node_type, label)  ← doctor_id added to MERGE key
  - MERGE edges by (doctor_id, from_label, relation, to_label)
  - Weight average is maintained per doctor's edge, not per patient
  - Indexes are on doctor_id instead of patient_id

Phase 4: Rework detection + weight decay/boost
  - Rework queries filter by doctor_id

Phase 5: Skill threshold checker + doctor confirmation
  - Unchanged in logic (already doctor-scoped)

Summary of ALL field changes in Neo4j:
  OLD: n.patient_ids (array), WHERE $patient_id IN n.patient_ids
  NEW: n.doctor_id   (string), WHERE n.doctor_id = $doctor_id

  OLD: r.patient_ids (array), WHERE $patient_id IN r.patient_ids
  NEW: r.doctor_id   (string), WHERE r.doctor_id = $doctor_id

  ImpactFlag: patient_id field → doctor_id field (primary)
              patient_id kept as optional metadata property
"""

from __future__ import annotations

import os
import asyncio
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException, BackgroundTasks
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import MongoClient
from neo4j import AsyncGraphDatabase, AsyncDriver
from pydantic import BaseModel, Field

from Agentic.document_model import (
    ClinicalGraphPayload,
    DecisionChain,
    DoctorSkillAttrs,
    GraphEdge,
    GraphNode,
    ImpactFlag,
    AbnormalityRecord,
    SkillCandidate,
    Severity,
)

# ─────────────────────────────────────────────
# CONNECTION SETUP
# ─────────────────────────────────────────────

NEO4J_URI      = os.getenv("NEO4J_URI",      "bolt://neo4j:7687")
NEO4J_USER     = os.getenv("NEO4J_USER",     "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "password")
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"
NODES_DB = "doctorassistai_nodes"

mongodb_client = AsyncIOMotorClient(MONGO_URI)  # async (Motor)
database = mongodb_client[MONGO_DB]

client = MongoClient(MONGO_URI)  # sync (PyMongo)
db = client[MONGO_DB]

# CHANGED: collection names reflect doctor-graph
graph_payloads_col   = database["doctor_graph_payloads"]
skill_candidates_col = database["skill_candidates"]
doctor_skills_col    = database["doctor_skills"]
rework_log_col       = database["rework_log"]

SKILL_WEIGHT_THRESHOLD = 0.75
SKILL_MIN_COUNT        = 1
REWORK_DECAY_FACTOR    = 0.85
REWORK_BOOST           = 0.05


# ─────────────────────────────────────────────
# NEO4J DRIVER — singleton per process
# ─────────────────────────────────────────────

_driver: Optional[AsyncDriver] = None


async def get_driver() -> AsyncDriver:
    global _driver
    if _driver is None:
        _driver = AsyncGraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    return _driver


async def close_driver() -> None:
    global _driver
    if _driver:
        await _driver.close()
        _driver = None


# ─────────────────────────────────────────────
# PHASE 3 — NEO4J GRAPH WRITER
# ─────────────────────────────────────────────

class Neo4jGraphWriter:
    """
    Writes ClinicalGraphPayload into Neo4j — DOCTOR-CENTRIC.

    CHANGED strategy:
    - MERGE nodes by (doctor_id, node_type, label)
      → One node per unique clinical concept PER DOCTOR.
        Two doctors seeing "Hypertension" get two separate graph nodes.
    - MERGE edges by (doctor_id, from_label, relation, to_label)
      → Edge weight is the running average of this doctor's observations.
    - patient_id stored on nodes/edges as an array of provenance IDs (audit trail).
    """

    async def write_payload(self, payload: ClinicalGraphPayload) -> Dict[str, Any]:
        driver = await get_driver()
        did    = payload.doctor_id
        pid    = payload.patient_id or ""   # provenance metadata — may be empty
        src    = ", ".join(payload.source_documents)
        ts     = payload.generated_at

        stats = {
            "nodes_created":         0,
            "nodes_merged":          0,
            "edges_created":         0,
            "edges_merged":          0,
            "abnormalities_written": 0,
            "chains_written":        0,
            "flags_written":         0,
        }

        async with driver.session() as session:
            await self._ensure_indexes(session)

            for node in payload.graph_nodes:
                result = await self._merge_node(session, node, did, pid, src, ts)
                stats["nodes_created" if result == "created" else "nodes_merged"] += 1

            for edge in payload.graph_edges:
                result = await self._merge_edge(session, edge, did, pid, ts)
                stats["edges_created" if result == "created" else "edges_merged"] += 1

            for abn in payload.abnormalities:
                await self._write_abnormality(session, abn, did, pid, src, ts)
                stats["abnormalities_written"] += 1

            for chain in payload.decision_chains:
                await self._write_decision_chain(session, chain, did, pid, ts)
                stats["chains_written"] += 1

            for flag in payload.impact_flags:
                await self._write_impact_flag(session, flag, did, pid, ts)
                stats["flags_written"] += 1

        logger.info(f"✅ Neo4j write complete | doctor={did} | {stats}")
        return stats

    # ── Index creation ──────────────────────────────────────────────

    async def _ensure_indexes(self, session) -> None:
        indexes = [
            # CHANGED: primary index is now on doctor_id, not patient_id
            "CREATE INDEX doctor_node_idx IF NOT EXISTS FOR (n:ClinicalNode) ON (n.doctor_id)",
            "CREATE INDEX node_label_idx  IF NOT EXISTS FOR (n:ClinicalNode) ON (n.label)",
            "CREATE INDEX node_type_idx   IF NOT EXISTS FOR (n:ClinicalNode) ON (n.node_type)",
            # Composite index: (doctor_id, node_type, label) — the MERGE key
            "CREATE INDEX doctor_type_label_idx IF NOT EXISTS FOR (n:ClinicalNode) ON (n.doctor_id, n.node_type, n.label)",
            "CREATE INDEX skill_idx       IF NOT EXISTS FOR (n:DoctorSkill)  ON (n.doctor_id)",
        ]
        for q in indexes:
            await session.run(q)

    # ── Node MERGE ──────────────────────────────────────────────────

    async def _merge_node(
        self,
        session,
        node: GraphNode,
        doctor_id: str,
        patient_id: str,    # provenance metadata only
        source_doc: str,
        timestamp: str,
    ) -> str:
        """
        CHANGED: MERGE node by (doctor_id, node_type, label).
        - doctor_id is part of the MERGE key → each doctor has their own node.
        - patient_id is stored as an array for audit provenance only.
        - occurrence_count tracks how many times this doctor has seen this concept.
        """
        attrs = {k: v for k, v in node.attrs.items() if v is not None}

        node_type = (
            node.node_type
            or node.attrs.get("type")
            or "ClinicalConcept"
        )

        attrs["node_type"]  = node_type
        attrs["label"]      = node.label
        attrs["doctor_id"]  = doctor_id
        attrs["graph_source"] = "doctor_pattern"
        attrs["source_doc"] = source_doc
        attrs["updated_at"] = timestamp
        attrs["risk_category"] = node.attrs.get("risk_category", "")
        attrs["speciality"]    = node.attrs.get("speciality", "")

        result = await session.run(
            """
            MERGE (n:ClinicalNode {doctor_id: $doctor_id, node_type: $node_type, label: $label})
            ON CREATE SET
                n += $attrs,
                n.occurrence_count = 1,
                n.patient_ids      = CASE WHEN $patient_id <> '' THEN [$patient_id] ELSE [] END,
                n.created_at       = $timestamp,
                n.was_created      = true
            ON MATCH SET
                n.occurrence_count = n.occurrence_count + 1,
                n.patient_ids      = CASE
                    WHEN $patient_id <> '' AND NOT $patient_id IN n.patient_ids
                    THEN n.patient_ids + [$patient_id]
                    ELSE n.patient_ids END,
                n.updated_at       = $timestamp,
                n.was_created      = false
            RETURN n.was_created AS was_created
            LIMIT 1
            """,
            doctor_id=doctor_id,
            node_type=node_type,
            label=node.label,
            attrs=attrs,
            patient_id=patient_id,
            timestamp=timestamp,
        )
        record = await result.single()
        return "created" if record and record["was_created"] else "merged"

    # ── Edge MERGE ──────────────────────────────────────────────────

    async def _merge_edge(
        self,
        session,
        edge: GraphEdge,
        doctor_id: str,
        patient_id: str,    # provenance metadata only
        timestamp: str,
    ) -> str:
        """
        CHANGED: MERGE edge by (doctor_id, from_label, relation, to_label).
        - doctor_id is part of the MERGE key.
        - Running average weight is per doctor (not per patient).
        - patient_id stored in array for audit provenance only.
        """
        result = await session.run(
            """
            MATCH (a:ClinicalNode {doctor_id: $doctor_id, label: $from_label})
            MATCH (b:ClinicalNode {doctor_id: $doctor_id, label: $to_label})
            MERGE (a)-[r:CLINICAL_EDGE {doctor_id: $doctor_id, relation: $relation}]->(b)
            ON CREATE SET
                r.weight      = $weight,
                r.confidence  = $confidence,
                r.count       = 1,
                r.from_type   = $from_type,
                r.to_type     = $to_type,
                r.patient_ids = CASE WHEN $patient_id <> '' THEN [$patient_id] ELSE [] END,
                r.created_at  = $timestamp,
                r.updated_at  = $timestamp,
                r.was_created = true
            ON MATCH SET
                r.weight      = (r.weight * r.count + $weight) / (r.count + 1),
                r.count       = r.count + 1,
                r.patient_ids = CASE
                    WHEN $patient_id <> '' AND NOT $patient_id IN r.patient_ids
                    THEN r.patient_ids + [$patient_id]
                    ELSE r.patient_ids END,
                r.updated_at  = $timestamp,
                r.was_created = false
            RETURN r.was_created AS was_created
            """,
            doctor_id=doctor_id,
            from_label=edge.from_label,
            to_label=edge.to_label,
            relation=edge.relation,
            weight=edge.weight,
            confidence=edge.confidence,
            from_type=edge.from_type,
            to_type=edge.to_type,
            patient_id=patient_id,
            timestamp=timestamp,
        )
        record = await result.single()
        return "created" if record and record["was_created"] else "merged"

    # ── Abnormality node + CONTRADICTS edges ────────────────────────

    async def _write_abnormality(
        self,
        session,
        abn: AbnormalityRecord,
        doctor_id: str,
        patient_id: str,    # provenance metadata only
        source_doc: str,
        timestamp: str,
    ) -> None:
        """
        CHANGED: MERGE Abnormality node by (doctor_id, label).
        """
        await session.run(
            """
            MERGE (a:ClinicalNode:Abnormality {doctor_id: $doctor_id, node_type: 'Abnormality', label: $label})
            ON CREATE SET
                a.entity_name           = $entity_name,
                a.value                 = $value,
                a.numeric_value         = $numeric_value,
                a.unit                  = $unit,
                a.normal_range          = $normal_range,
                a.direction             = $direction,
                a.clinical_significance = $significance,
                a.explanation           = $explanation,
                a.source_doc            = $source_doc,
                a.patient_ids           = CASE WHEN $patient_id <> '' THEN [$patient_id] ELSE [] END,
                a.occurrence_count      = 1,
                a.created_at            = $timestamp
            ON MATCH SET
                a.occurrence_count = a.occurrence_count + 1,
                a.updated_at       = $timestamp,
                a.patient_ids      = CASE
                    WHEN $patient_id <> '' AND NOT $patient_id IN a.patient_ids
                    THEN a.patient_ids + [$patient_id]
                    ELSE a.patient_ids END
            """,
            doctor_id=doctor_id,
            label=abn.entity_name,
            entity_name=abn.entity_name,
            value=abn.value or "",
            numeric_value=abn.numeric_value,
            unit=abn.unit or "",
            normal_range=abn.normal_range or "",
            direction=abn.direction,
            significance=abn.clinical_significance,
            explanation=abn.explanation,
            source_doc=source_doc,
            patient_id=patient_id,
            timestamp=timestamp,
        )

        # CONTRADICTS edges — filter to doctor's nodes
        for decision_label in abn.contradicts_decisions:
            await session.run(
                """
                MATCH (a:ClinicalNode {doctor_id: $doctor_id, node_type: 'Abnormality', label: $abn_label})
                MATCH (d:ClinicalNode {doctor_id: $doctor_id, label: $decision_label})
                MERGE (a)-[r:CLINICAL_EDGE {doctor_id: $doctor_id, relation: 'CONTRADICTS'}]->(d)
                ON CREATE SET
                    r.weight      = 0.9,
                    r.count       = 1,
                    r.patient_ids = CASE WHEN $patient_id <> '' THEN [$patient_id] ELSE [] END,
                    r.created_at  = $timestamp
                ON MATCH SET
                    r.weight      = (r.weight * r.count + 0.9) / (r.count + 1),
                    r.count       = r.count + 1,
                    r.updated_at  = $timestamp
                """,
                doctor_id=doctor_id,
                abn_label=abn.entity_name,
                decision_label=decision_label,
                patient_id=patient_id,
                timestamp=timestamp,
            )

    # ── Decision chain path ─────────────────────────────────────────

    async def _write_decision_chain(
        self,
        session,
        chain: DecisionChain,
        doctor_id: str,
        patient_id: str,    # provenance metadata only
        timestamp: str,
    ) -> None:
        """
        CHANGED: All MERGE conditions include doctor_id.
        The running weight average accumulates per doctor across all cases.
        """
        prob = chain.probability

        # Condition --TRIGGERS_DECISION--> Decision (doctor-scoped MERGE)
        await session.run(
            """
            MERGE (c:ClinicalNode {doctor_id: $doctor_id, node_type: 'Condition', label: $condition})
            ON CREATE SET c.occurrence_count = 1, c.created_at = $timestamp
            ON MATCH  SET c.occurrence_count = c.occurrence_count + 1

            MERGE (d:ClinicalNode {doctor_id: $doctor_id, node_type: 'Decision', label: $decision})
            ON CREATE SET
                d.action_type      = $action_type,
                d.urgency          = $urgency,
                d.rationale        = $rationale,
                d.occurrence_count = 1,
                d.created_at       = $timestamp
            ON MATCH SET
                d.occurrence_count = d.occurrence_count + 1

            MERGE (c)-[r:CLINICAL_EDGE {doctor_id: $doctor_id, relation: 'TRIGGERS_DECISION'}]->(d)
            ON CREATE SET
                r.weight      = $prob,
                r.count       = 1,
                r.patient_ids = CASE WHEN $patient_id <> '' THEN [$patient_id] ELSE [] END,
                r.created_at  = $timestamp
            ON MATCH SET
                r.weight      = (r.weight * r.count + $prob) / (r.count + 1),
                r.count       = r.count + 1,
                r.updated_at  = $timestamp
            """,
            doctor_id=doctor_id,
            condition=chain.condition_label,
            decision=chain.decision_label,
            action_type=chain.decision_action_type,
            urgency=chain.urgency,
            rationale=chain.rationale,
            prob=prob,
            patient_id=patient_id,
            timestamp=timestamp,
        )

        # Finding --HAS_FINDING--> Condition (doctor-scoped)
        for finding_label in chain.supporting_findings:
            await session.run(
                """
                MERGE (f:ClinicalNode {doctor_id: $doctor_id, node_type: 'Finding', label: $finding})
                ON CREATE SET f.occurrence_count = 1, f.created_at = $timestamp
                ON MATCH  SET f.occurrence_count = f.occurrence_count + 1

                MERGE (c:ClinicalNode {doctor_id: $doctor_id, node_type: 'Condition', label: $condition})

                MERGE (f)-[r:CLINICAL_EDGE {doctor_id: $doctor_id, relation: 'HAS_FINDING'}]->(c)
                ON CREATE SET
                    r.weight      = $prob,
                    r.count       = 1,
                    r.patient_ids = CASE WHEN $patient_id <> '' THEN [$patient_id] ELSE [] END,
                    r.created_at  = $timestamp
                ON MATCH SET
                    r.weight      = (r.weight * r.count + $prob) / (r.count + 1),
                    r.count       = r.count + 1,
                    r.updated_at  = $timestamp
                """,
                doctor_id=doctor_id,
                finding=finding_label,
                condition=chain.condition_label,
                prob=prob,
                patient_id=patient_id,
                timestamp=timestamp,
            )

        # Decision --LEADS_TO--> Outcome (doctor-scoped)
        if chain.expected_outcome:
            await session.run(
                """
                MERGE (d:ClinicalNode {doctor_id: $doctor_id, node_type: 'Decision', label: $decision})
                MERGE (o:ClinicalNode {doctor_id: $doctor_id, node_type: 'Outcome',  label: $outcome})
                ON CREATE SET o.occurrence_count = 1, o.created_at = $timestamp
                ON MATCH  SET o.occurrence_count = o.occurrence_count + 1

                MERGE (d)-[r:CLINICAL_EDGE {doctor_id: $doctor_id, relation: 'LEADS_TO'}]->(o)
                ON CREATE SET
                    r.weight      = $prob,
                    r.count       = 1,
                    r.patient_ids = CASE WHEN $patient_id <> '' THEN [$patient_id] ELSE [] END,
                    r.created_at  = $timestamp
                ON MATCH SET
                    r.weight      = (r.weight * r.count + $prob) / (r.count + 1),
                    r.count       = r.count + 1,
                    r.updated_at  = $timestamp
                """,
                doctor_id=doctor_id,
                decision=chain.decision_label,
                outcome=chain.expected_outcome,
                prob=prob,
                patient_id=patient_id,
                timestamp=timestamp,
            )

    # ── ImpactFlag node ─────────────────────────────────────────────

    async def _write_impact_flag(
        self,
        session,
        flag: ImpactFlag,
        doctor_id: str,
        patient_id: str,    # provenance metadata only
        timestamp: str,
    ) -> None:
        """
        CHANGED: ImpactFlag's primary identity is doctor_id.
        patient_id stored as metadata for audit trail.
        """
        await session.run(
            """
            CREATE (f:ImpactFlag {
                flag_id:          $flag_id,
                flag_type:        $flag_type,
                description:      $description,
                severity:         $severity,
                entity_involved:  $entity_involved,
                decision_involved:$decision_involved,
                recommendation:   $recommendation,
                doctor_id:        $doctor_id,
                patient_id:       $patient_id,
                created_at:       $timestamp
            })
            """,
            flag_id=flag.flag_id,
            flag_type=flag.flag_type,
            description=flag.description,
            severity=flag.severity,
            entity_involved=flag.entity_involved or "",
            decision_involved=flag.decision_involved or "",
            recommendation=flag.recommendation or "",
            doctor_id=doctor_id,       # CHANGED: primary identity
            patient_id=patient_id,     # metadata / audit provenance
            timestamp=timestamp,
        )

        # Link flag to the DOCTOR's entity and decision nodes
        if flag.entity_involved:
            await session.run(
                """
                MATCH (f:ImpactFlag {flag_id: $flag_id})
                MATCH (n:ClinicalNode {doctor_id: $doctor_id, label: $label})
                MERGE (f)-[:REFERENCES]->(n)
                """,
                flag_id=flag.flag_id,
                doctor_id=doctor_id,
                label=flag.entity_involved,
            )
        if flag.decision_involved:
            await session.run(
                """
                MATCH (f:ImpactFlag {flag_id: $flag_id})
                MATCH (n:ClinicalNode {doctor_id: $doctor_id, label: $label})
                MERGE (f)-[:REFERENCES]->(n)
                """,
                flag_id=flag.flag_id,
                doctor_id=doctor_id,
                label=flag.decision_involved,
            )


# ─────────────────────────────────────────────
# PHASE 4 — REWORK DETECTION + WEIGHT CORRECTION
# ─────────────────────────────────────────────

class ReworkDetector:
    """
    CHANGED: Rework detection is doctor-scoped.
    All Neo4j queries now filter by doctor_id instead of patient_id.
    """

    async def handle_rework(
        self,
        old_decision_label: str,
        new_decision_label: str,
        condition_label: str,
        doctor_id: str,
        reason: str = "",
        patient_id: str = "",   # provenance metadata only
    ) -> Dict[str, Any]:
        """
        CHANGED: Call this when a DOCTOR changes a prior decision pattern.
        - doctor_id is the primary identity for all graph queries.
        - patient_id stored in log as audit metadata only.
        """
        driver = await get_driver()
        ts     = datetime.utcnow().isoformat()

        async with driver.session() as session:

            # ── Step 1: Decay old decision edge weight (doctor-scoped) ──
            decay_result = await session.run(
                """
                MATCH (c:ClinicalNode {doctor_id: $doctor_id, label: $condition})
                      -[r:CLINICAL_EDGE {doctor_id: $doctor_id, relation: 'TRIGGERS_DECISION'}]->
                      (d:ClinicalNode {doctor_id: $doctor_id, label: $old_decision})
                SET
                    r.weight       = r.weight * $decay,
                    r.rework_count = coalesce(r.rework_count, 0) + 1,
                    r.updated_at   = $timestamp
                RETURN r.weight AS new_weight, r.count AS count
                """,
                doctor_id=doctor_id,
                condition=condition_label,
                old_decision=old_decision_label,
                decay=REWORK_DECAY_FACTOR,
                timestamp=ts,
            )
            decay_rec = await decay_result.single()
            old_weight_after = decay_rec["new_weight"] if decay_rec else None

            # ── Step 2: Create REWORK_OF edge (doctor-scoped) ──
            await session.run(
                """
                MERGE (new_d:ClinicalNode {doctor_id: $doctor_id, label: $new_decision})
                ON CREATE SET new_d.node_type = 'Decision', new_d.occurrence_count = 1

                MERGE (old_d:ClinicalNode {doctor_id: $doctor_id, label: $old_decision})

                MERGE (new_d)-[r:CLINICAL_EDGE {doctor_id: $doctor_id, relation: 'REWORK_OF'}]->(old_d)
                ON CREATE SET
                    r.reason     = $reason,
                    r.doctor_id  = $doctor_id,
                    r.patient_id = $patient_id,
                    r.weight     = 1.0,
                    r.count      = 1,
                    r.created_at = $timestamp
                ON MATCH SET
                    r.count      = r.count + 1,
                    r.updated_at = $timestamp
                """,
                doctor_id=doctor_id,
                new_decision=new_decision_label,
                old_decision=old_decision_label,
                reason=reason,
                patient_id=patient_id,
                timestamp=ts,
            )

            # ── Step 3: Boost new decision edge weight (doctor-scoped) ──
            boost_result = await session.run(
                """
                MATCH (c:ClinicalNode {doctor_id: $doctor_id, label: $condition})
                      -[r:CLINICAL_EDGE {doctor_id: $doctor_id, relation: 'TRIGGERS_DECISION'}]->
                      (d:ClinicalNode {doctor_id: $doctor_id, label: $new_decision})
                SET
                    r.weight     = CASE
                        WHEN r.weight + $boost > 1.0 THEN 1.0
                        ELSE r.weight + $boost END,
                    r.updated_at = $timestamp
                RETURN r.weight AS new_weight
                """,
                doctor_id=doctor_id,
                condition=condition_label,
                new_decision=new_decision_label,
                boost=REWORK_BOOST,
                timestamp=ts,
            )
            boost_rec = await boost_result.single()
            new_weight_after = boost_rec["new_weight"] if boost_rec else None

        # ── Step 4: Log rework to MongoDB ──
        rework_event = {
            "rework_id":        f"rework_{uuid4().hex[:10]}",
            "doctor_id":        doctor_id,          # CHANGED: primary identity
            "patient_id":       patient_id,         # provenance metadata
            "condition_label":  condition_label,
            "old_decision":     old_decision_label,
            "new_decision":     new_decision_label,
            "reason":           reason,
            "old_weight_after": old_weight_after,
            "new_weight_after": new_weight_after,
            "timestamp":        ts,
        }
        await rework_log_col.insert_one(rework_event)
        logger.info(
            f"🔄 Rework logged | doctor={doctor_id} | "
            f"{old_decision_label} → {new_decision_label} | "
            f"old_weight={old_weight_after} | new_weight={new_weight_after}"
        )

        return rework_event

    async def detect_rework_from_payload(
        self,
        payload: ClinicalGraphPayload,
    ) -> List[Dict[str, Any]]:
        """CHANGED: Uses doctor_id as primary identity."""
        reworks = []
        for agent_output in payload.agent_outputs:
            for triple in agent_output.triples:
                if triple.relation == "REWORK_OF":
                    new_dec   = triple.subject.label
                    old_dec   = triple.obj.label
                    condition = self._find_condition_for_decision(new_dec, payload)

                    event = await self.handle_rework(
                        old_decision_label=old_dec,
                        new_decision_label=new_dec,
                        condition_label=condition,
                        doctor_id=payload.doctor_id,
                        reason=triple.reasoning or "Agent-detected rework",
                        patient_id=payload.patient_id or "",
                    )
                    reworks.append(event)

        return reworks

    def _find_condition_for_decision(
        self, decision_label: str, payload: ClinicalGraphPayload
    ) -> str:
        for chain in payload.decision_chains:
            if chain.decision_label.lower() == decision_label.lower():
                return chain.condition_label
        return "Unknown Condition"


# ─────────────────────────────────────────────
# PHASE 5 — SKILL THRESHOLD CHECKER + PROMOTION
# ─────────────────────────────────────────────

class SkillPromoter:
    """
    CHANGED: All queries use doctor_id directly (was previously consistent,
    but now also filters edge MERGE by doctor_id explicitly).
    """

    async def check_and_queue_candidates(
        self, doctor_id: str, patient_id: str = ""
    ) -> List[Dict[str, Any]]:
        """
        CHANGED: Query Neo4j for high-weight TRIGGERS_DECISION edges
        for this specific doctor (using doctor_id on the edge, not patient filter).
        """
        driver = await get_driver()

        async with driver.session() as session:
            result = await session.run(
                """
                MATCH (c:ClinicalNode {doctor_id: $doctor_id})
                      -[r:CLINICAL_EDGE {doctor_id: $doctor_id, relation: 'TRIGGERS_DECISION'}]->
                      (d:ClinicalNode {doctor_id: $doctor_id})
                WHERE r.weight >= $threshold
                    AND (r.count >= $min_count OR c.occurrence_count >= $node_occurrence_min)
                RETURN
                    c.label       AS condition,
                    d.label       AS decision,
                    d.action_type AS action_type,
                    r.weight      AS weight,
                    r.count       AS count,
                    c.node_type   AS condition_type
                ORDER BY r.weight DESC
                LIMIT 50
                """,
                doctor_id=doctor_id,
                threshold=SKILL_WEIGHT_THRESHOLD,
                min_count=SKILL_MIN_COUNT,
                node_occurrence_min=3,
            )
            rows = await result.data()

        new_candidates = []
        for row in rows:
            condition = row["condition"]
            decision  = row["decision"]
            key       = f"{doctor_id}::{condition}::{decision}"

            existing_skill = await doctor_skills_col.find_one({"skill_key": key})
            existing_cand  = await skill_candidates_col.find_one({"skill_key": key})

            if existing_skill or existing_cand:
                continue

            candidate = {
                "candidate_id":          f"cand_{uuid4().hex[:10]}",
                "skill_key":             key,
                "doctor_id":             doctor_id,
                "patient_id":            patient_id,   # provenance metadata
                "condition_label":       condition,
                "decision_label":        decision,
                "action_type":           row.get("action_type", ""),
                "pattern_summary":       f"{condition} → {decision}",
                "weight":                row["weight"],
                "occurrence_count":      row["count"],
                "awaiting_confirmation": True,
                "created_at":            datetime.utcnow().isoformat(),
            }
            await skill_candidates_col.insert_one(candidate)
            new_candidates.append(candidate)
            logger.info(
                f"⭐ Skill candidate queued: {condition} → {decision} | "
                f"doctor={doctor_id} | weight={row['weight']:.3f} | count={row['count']}"
            )

        return new_candidates

    async def confirm_skill(
        self,
        candidate_id: str,
        doctor_id: str,
        speciality: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Unchanged in logic — skill confirmation is already doctor-scoped."""
        candidate = await skill_candidates_col.find_one({"candidate_id": candidate_id})
        if not candidate:
            raise ValueError(f"Candidate {candidate_id} not found")
        if candidate["doctor_id"] != doctor_id:
            raise PermissionError("Candidate does not belong to this doctor")

        ts = datetime.utcnow().isoformat()

        driver = await get_driver()
        async with driver.session() as session:
            await session.run(
                """
                MERGE (s:DoctorSkill {skill_key: $skill_key})
                ON CREATE SET
                    s.doctor_id       = $doctor_id,
                    s.condition_label = $condition,
                    s.decision_label  = $decision,
                    s.pattern_summary = $pattern,
                    s.speciality      = $speciality,
                    s.confidence      = $weight,
                    s.occurrence_count= $count,
                    s.confirmed_at    = $timestamp,
                    s.confirmed_by_doctor = true

                WITH s
                MATCH (d:ClinicalNode {doctor_id: $doctor_id, label: $decision})
                MERGE (d)-[:MATCHES_SKILL]->(s)
                """,
                skill_key=candidate["skill_key"],
                doctor_id=doctor_id,
                condition=candidate["condition_label"],
                decision=candidate["decision_label"],
                pattern=candidate["pattern_summary"],
                speciality=speciality or "general",
                weight=candidate["weight"],
                count=candidate["occurrence_count"],
                timestamp=ts,
            )

        skill_doc = {
            **candidate,
            "skill_key":            candidate["skill_key"],
            "confirmed_at":         ts,
            "confirmed_by_doctor":  True,
            "speciality":           speciality or "general",
            "awaiting_confirmation": False,
        }
        await doctor_skills_col.insert_one(skill_doc)
        await skill_candidates_col.update_one(
            {"candidate_id": candidate_id},
            {"$set": {"awaiting_confirmation": False, "confirmed_at": ts}},
        )

        logger.info(
            f"✅ Skill promoted: {candidate['pattern_summary']} | "
            f"doctor={doctor_id} | weight={candidate['weight']:.3f}"
        )
        return skill_doc

    async def reject_skill(self, candidate_id: str, doctor_id: str) -> None:
        await skill_candidates_col.update_one(
            {"candidate_id": candidate_id, "doctor_id": doctor_id},
            {"$set": {
                "awaiting_confirmation": False,
                "rejected": True,
                "rejected_at": datetime.utcnow().isoformat(),
            }},
        )
        logger.info(f"❌ Skill candidate rejected: {candidate_id}")

    async def get_doctor_skills(self, doctor_id: str) -> List[Dict]:
        skills = await doctor_skills_col.find(
            {"doctor_id": doctor_id, "confirmed_by_doctor": True},
            {"_id": 0}
        ).to_list(length=None)
        return skills

    async def match_skills_to_consultation(
        self, doctor_id: str, condition_labels: List[str]
    ) -> List[Dict]:
        skills = await doctor_skills_col.find(
            {
                "doctor_id": doctor_id,
                "confirmed_by_doctor": True,
                "condition_label": {"$in": condition_labels},
            },
            {"_id": 0}
        ).sort("weight", -1).to_list(length=None)
        return skills


# ─────────────────────────────────────────────
# ORCHESTRATOR — ties Phases 3, 4, 5 together
# ─────────────────────────────────────────────

async def write_payload_to_graph(payload: ClinicalGraphPayload) -> Dict[str, Any]:
    """
    Full Phase 3 → 4 → 5 pipeline for one ClinicalGraphPayload.
    CHANGED: Uses doctor_id as primary identity throughout.
    """
    writer   = Neo4jGraphWriter()
    reworker = ReworkDetector()
    promoter = SkillPromoter()

    write_stats    = await writer.write_payload(payload)

    # Handle weight reinforcements from the weight-update-only path
    weight_reinforcements = getattr(payload, "_weight_reinforcements", [])
    if weight_reinforcements:
        driver = await get_driver()
        async with driver.session() as session:
            for upd in weight_reinforcements:
                await session.run(
                    """
                    MATCH (c:ClinicalNode {doctor_id: $did, label: $condition})
                        -[r:CLINICAL_EDGE {doctor_id: $did, relation: 'TRIGGERS_DECISION'}]->
                        (d:ClinicalNode {doctor_id: $did, label: $decision})
                    SET r.weight     = CASE WHEN r.weight + $delta > 1.0
                                            THEN 1.0 ELSE r.weight + $delta END,
                        r.count      = r.count + 1,
                        r.updated_at = $ts
                    """,
                    did=payload.doctor_id,
                    condition=upd.get("condition", ""),
                    decision=upd.get("decision", ""),
                    delta=float(upd.get("delta", 0.05)),
                    ts=payload.generated_at,
                )
        logger.info(f"  Weight reinforced: {len(weight_reinforcements)} edges")

    reworks        = await reworker.detect_rework_from_payload(payload)
    new_candidates = await promoter.check_and_queue_candidates(
        doctor_id=payload.doctor_id,
        patient_id=payload.patient_id or "",
    )

    return {
        "write_stats":          write_stats,
        "reworks_detected":     len(reworks),
        "rework_events":        reworks,
        "new_skill_candidates": len(new_candidates),
        "skill_candidates":     new_candidates,
    }


# ─────────────────────────────────────────────
# FASTAPI ROUTER
# ─────────────────────────────────────────────

router = APIRouter(prefix="/graph", tags=["Doctor Graph — Neo4j"])

_writer   = Neo4jGraphWriter()
_reworker = ReworkDetector()
_promoter = SkillPromoter()


# ── Request/Response models ──────────────────

class WritePayloadRequest(BaseModel):
    pipeline_id: str


class ReworkRequest(BaseModel):
    old_decision_label: str
    new_decision_label: str
    condition_label:    str
    doctor_id:          str
    reason:             str = ""
    patient_id:         str = ""   # provenance metadata only


class ConfirmSkillRequest(BaseModel):
    candidate_id: str
    doctor_id:    str
    speciality:   Optional[str] = None


class RejectSkillRequest(BaseModel):
    candidate_id: str
    doctor_id:    str


class MatchSkillsRequest(BaseModel):
    doctor_id:        str
    condition_labels: List[str]


# ── Endpoints ────────────────────────────────

@router.post("/write/{pipeline_id}")
async def write_graph_endpoint(pipeline_id: str, background_tasks: BackgroundTasks):
    """Phase 3: Write a ClinicalGraphPayload to Neo4j (doctor-centric)."""
    doc = await graph_payloads_col.find_one({"pipeline_id": pipeline_id})
    if not doc:
        raise HTTPException(status_code=404, detail=f"Pipeline {pipeline_id} not found.")

    doc.pop("_id", None)
    payload = ClinicalGraphPayload(**doc)
    background_tasks.add_task(_background_write, payload)

    return {
        "status":      "queued",
        "pipeline_id": pipeline_id,
        "doctor_id":   payload.doctor_id,
        "message":     "Graph write started in background.",
    }


async def _background_write(payload: ClinicalGraphPayload) -> None:
    try:
        result = await write_payload_to_graph(payload)
        logger.info(f"🏁 Background write done | pipeline={payload.pipeline_id} | {result}")
        await graph_payloads_col.update_one(
            {"pipeline_id": payload.pipeline_id},
            {"$set": {
                "graph_write_result": result,
                "graph_written_at": datetime.utcnow().isoformat(),
            }},
        )
    except Exception as e:
        logger.error(f"Background write failed | pipeline={payload.pipeline_id} | {e}")


@router.post("/write-sync/{pipeline_id}")
async def write_graph_sync_endpoint(pipeline_id: str):
    """Phase 3 (synchronous): Write payload to Neo4j and wait for result."""
    doc = await graph_payloads_col.find_one({"pipeline_id": pipeline_id})
    if not doc:
        raise HTTPException(status_code=404, detail=f"Pipeline {pipeline_id} not found.")

    doc.pop("_id", None)
    payload = ClinicalGraphPayload(**doc)
    result  = await write_payload_to_graph(payload)
    return {"status": "completed", "pipeline_id": pipeline_id, **result}


@router.post("/rework")
async def rework_endpoint(req: ReworkRequest):
    """
    Phase 4: Manually trigger a rework event.
    CHANGED: doctor_id is primary; patient_id is optional provenance.
    """
    event = await _reworker.handle_rework(
        old_decision_label=req.old_decision_label,
        new_decision_label=req.new_decision_label,
        condition_label=req.condition_label,
        doctor_id=req.doctor_id,
        reason=req.reason,
        patient_id=req.patient_id,
    )
    return {"status": "rework_processed", "event": event}


@router.get("/rework-log/{doctor_id}")
async def get_rework_log(doctor_id: str):
    """
    CHANGED: Fetch all rework events for a DOCTOR (was patient).
    """
    logs = await rework_log_col.find(
        {"doctor_id": doctor_id}, {"_id": 0}
    ).sort("timestamp", -1).to_list(length=None)
    return {"doctor_id": doctor_id, "reworks": logs}


@router.get("/skills/candidates/{doctor_id}")
async def get_skill_candidates(doctor_id: str):
    """Phase 5: Get all pending skill candidates for a doctor."""
    candidates = await skill_candidates_col.find(
        {"doctor_id": doctor_id, "awaiting_confirmation": True},
        {"_id": 0}
    ).sort("weight", -1).to_list(length=None)
    return {"doctor_id": doctor_id, "pending_candidates": candidates}


@router.post("/skills/confirm")
async def confirm_skill_endpoint(req: ConfirmSkillRequest):
    """Phase 5: Doctor confirms a skill candidate."""
    try:
        skill = await _promoter.confirm_skill(
            candidate_id=req.candidate_id,
            doctor_id=req.doctor_id,
            speciality=req.speciality,
        )
        return {"status": "skill_promoted", "skill": skill}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))


@router.post("/skills/reject")
async def reject_skill_endpoint(req: RejectSkillRequest):
    """Phase 5: Doctor rejects a skill candidate."""
    await _promoter.reject_skill(req.candidate_id, req.doctor_id)
    return {"status": "rejected", "candidate_id": req.candidate_id}


@router.get("/skills/{doctor_id}")
async def get_doctor_skills(doctor_id: str):
    """Fetch all confirmed skills for a doctor."""
    skills = await _promoter.get_doctor_skills(doctor_id)
    return {"doctor_id": doctor_id, "skills": skills, "total": len(skills)}


@router.post("/skills/match")
async def match_skills_endpoint(req: MatchSkillsRequest):
    """During consultation: match detected conditions to doctor skills."""
    matches = await _promoter.match_skills_to_consultation(
        doctor_id=req.doctor_id,
        condition_labels=req.condition_labels,
    )
    return {
        "doctor_id":      req.doctor_id,
        "conditions":     req.condition_labels,
        "matched_skills": matches,
        "total_matches":  len(matches),
    }


@router.get("/query/high-weight-edges/{doctor_id}")
async def get_high_weight_edges(doctor_id: str, threshold: float = 0.7):
    """
    CHANGED: Query Neo4j for high-weight TRIGGERS_DECISION edges
    for a specific doctor (using doctor_id on nodes and edges directly).
    """
    driver = await get_driver()
    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (c:ClinicalNode {doctor_id: $doctor_id})
                  -[r:CLINICAL_EDGE {doctor_id: $doctor_id, relation: 'TRIGGERS_DECISION'}]->
                  (d:ClinicalNode {doctor_id: $doctor_id})
            WHERE r.weight >= $threshold
            RETURN
                c.label        AS condition,
                d.label        AS decision,
                r.weight       AS weight,
                r.count        AS count,
                r.rework_count AS rework_count
            ORDER BY r.weight DESC
            LIMIT 100
            """,
            doctor_id=doctor_id,
            threshold=threshold,
        )
        rows = await result.data()

    return {
        "doctor_id": doctor_id,
        "threshold": threshold,
        "edges":     rows,
        "total":     len(rows),
    }


@router.get("/query/contradictions/{doctor_id}")
async def get_contradictions(doctor_id: str):
    """
    CHANGED: Query CONTRADICTS edges for a DOCTOR (was patient).
    Shows abnormalities in the doctor's graph that conflict with decisions.
    """
    driver = await get_driver()
    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (a:ClinicalNode {doctor_id: $doctor_id})
                  -[r:CLINICAL_EDGE {doctor_id: $doctor_id, relation: 'CONTRADICTS'}]->
                  (d:ClinicalNode {doctor_id: $doctor_id})
            RETURN
                a.label                 AS abnormality,
                d.label                 AS decision,
                r.weight                AS weight,
                a.clinical_significance AS severity
            ORDER BY r.weight DESC
            """,
            doctor_id=doctor_id,
        )
        rows = await result.data()

    return {"doctor_id": doctor_id, "contradictions": rows}


@router.get("/query/full-graph/{doctor_id}")
async def get_full_doctor_graph(doctor_id: str):
    """
    CHANGED: Return all nodes and edges for a DOCTOR's graph (was patient graph).
    This is the doctor's full accumulated clinical knowledge graph.
    """
    driver = await get_driver()

    async with driver.session() as session:

        # ── All ClinicalNodes for this doctor ──
        node_result = await session.run(
            """
            MATCH (n:ClinicalNode {
                doctor_id: $doctor_id,
                graph_source: "doctor_pattern"
            })
            RETURN
                n.label            AS label,
                n.node_type        AS node_type,
                n.occurrence_count AS occurrence_count,
                n.created_at       AS created_at,
                properties(n)      AS all_attrs
            ORDER BY n.node_type, n.label
            """,
            doctor_id=doctor_id,
        )
        nodes = await node_result.data()

        # ── All edges between this doctor's nodes ──
        edge_result = await session.run(
            """
            MATCH (a:ClinicalNode {doctor_id: $doctor_id})
                  -[r:CLINICAL_EDGE {doctor_id: $doctor_id}]->
                  (b:ClinicalNode {doctor_id: $doctor_id})
            RETURN
                a.label      AS from_label,
                a.node_type  AS from_type,
                b.label      AS to_label,
                b.node_type  AS to_type,
                r.relation   AS relation,
                r.weight     AS weight,
                r.count      AS count,
                r.created_at AS created_at
            ORDER BY r.weight DESC
            """,
            doctor_id=doctor_id,
        )
        edges = await edge_result.data()

        # ── Abnormality nodes for this doctor ──
        abn_result = await session.run(
            """
            MATCH (a:Abnormality {doctor_id: $doctor_id})
            RETURN
                a.label                 AS label,
                a.direction             AS direction,
                a.clinical_significance AS severity,
                a.explanation           AS explanation,
                a.value                 AS value,
                a.unit                  AS unit,
                a.normal_range          AS normal_range,
                a.occurrence_count      AS occurrence_count
            """,
            doctor_id=doctor_id,
        )
        abnormalities = await abn_result.data()

        # ── ImpactFlags for this doctor ──
        flag_result = await session.run(
            """
            MATCH (f:ImpactFlag {doctor_id: $doctor_id})
            RETURN
                f.flag_id           AS flag_id,
                f.flag_type         AS flag_type,
                f.severity          AS severity,
                f.description       AS description,
                f.entity_involved   AS entity_involved,
                f.decision_involved AS decision_involved,
                f.recommendation    AS recommendation,
                f.patient_id        AS patient_id,
                f.created_at        AS created_at
            ORDER BY f.severity DESC
            """,
            doctor_id=doctor_id,
        )
        flags = await flag_result.data()

        # ── Decision chains (condition → decision paths) for this doctor ──
        chain_result = await session.run(
            """
            MATCH (c:ClinicalNode {doctor_id: $doctor_id, node_type: 'Condition'})
                  -[r:CLINICAL_EDGE {doctor_id: $doctor_id, relation: 'TRIGGERS_DECISION'}]->
                  (d:ClinicalNode {doctor_id: $doctor_id, node_type: 'Decision'})
            OPTIONAL MATCH (d)-[r2:CLINICAL_EDGE {doctor_id: $doctor_id, relation: 'LEADS_TO'}]->(o:ClinicalNode)
            RETURN
                c.label       AS condition,
                d.label       AS decision,
                d.action_type AS action_type,
                d.urgency     AS urgency,
                r.weight      AS probability,
                o.label       AS expected_outcome
            ORDER BY r.weight DESC
            """,
            doctor_id=doctor_id,
        )
        chains = await chain_result.data()

    return {
        "doctor_id": doctor_id,
        "summary": {
            "total_nodes":         len(nodes),
            "total_edges":         len(edges),
            "total_abnormalities": len(abnormalities),
            "total_flags":         len(flags),
            "total_chains":        len(chains),
        },
        "nodes":           nodes,
        "edges":           edges,
        "abnormalities":   abnormalities,
        "impact_flags":    flags,
        "decision_chains": chains,
    }




# ─────────────────────────────────────────────
# DELETE APIs
# ─────────────────────────────────────────────

@router.delete("/skills/candidate/{candidate_id}")
async def delete_skill_candidate(candidate_id: str, doctor_id: str):
    """
    Delete a pending skill candidate.
    """

    result = await skill_candidates_col.delete_one({
        "candidate_id": candidate_id,
        "doctor_id": doctor_id,
    })

    if result.deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Skill candidate not found"
        )

    return {
        "status": "deleted",
        "candidate_id": candidate_id,
        "doctor_id": doctor_id,
    }


@router.delete("/skills/{skill_key}")
async def delete_confirmed_skill(skill_key: str, doctor_id: str):
    """
    Delete confirmed skill from MongoDB + Neo4j.
    """

    # Delete from MongoDB
    mongo_result = await doctor_skills_col.delete_one({
        "skill_key": skill_key,
        "doctor_id": doctor_id,
    })

    # Delete relationship in Neo4j
    driver = await get_driver()

    async with driver.session() as session:
        await session.run(
            """
            MATCH (d:ClinicalNode {doctor_id: $doctor_id})
                  -[r:MATCHES_SKILL]->
                  (s:DoctorSkill {skill_key: $skill_key})
            DELETE r
            """,
            doctor_id=doctor_id,
            skill_key=skill_key,
        )

        await session.run(
            """
            MATCH (s:DoctorSkill {
                skill_key: $skill_key
            })
            DELETE s
            """,
            skill_key=skill_key,
        )

    if mongo_result.deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Skill not found"
        )

    return {
        "status": "deleted",
        "skill_key": skill_key,
        "doctor_id": doctor_id,
    }


@router.delete("/rework/{rework_id}")
async def delete_rework_log(rework_id: str, doctor_id: str):
    """
    Delete rework log entry.
    """

    result = await rework_log_col.delete_one({
        "rework_id": rework_id,
        "doctor_id": doctor_id,
    })

    if result.deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Rework log not found"
        )

    return {
        "status": "deleted",
        "rework_id": rework_id,
    }


@router.delete("/doctor/{doctor_id}")
async def delete_full_doctor_graph(doctor_id: str):
    """
    Delete entire doctor graph from Neo4j + MongoDB.
    """

    driver = await get_driver()

    async with driver.session() as session:

        # Delete all relationships first
        await session.run(
            """
            MATCH (n {doctor_id: $doctor_id})-[r]-()
            DELETE r
            """,
            doctor_id=doctor_id,
        )

        # Delete all nodes
        await session.run(
            """
            MATCH (n {doctor_id: $doctor_id})
            DELETE n
            """,
            doctor_id=doctor_id,
        )

    # Delete MongoDB data
    await skill_candidates_col.delete_many({
        "doctor_id": doctor_id
    })

    await doctor_skills_col.delete_many({
        "doctor_id": doctor_id
    })

    await rework_log_col.delete_many({
        "doctor_id": doctor_id
    })

    await graph_payloads_col.delete_many({
        "doctor_id": doctor_id
    })

    return {
        "status": "deleted",
        "doctor_id": doctor_id,
        "message": "Entire doctor graph deleted"
    }


@router.delete("/pipeline/{pipeline_id}")
async def delete_pipeline_graph(
    pipeline_id: str,
    doctor_id: str,
):
    """
    Delete graph related to one pipeline.
    """

    payload = await graph_payloads_col.find_one({
        "pipeline_id": pipeline_id,
        "doctor_id": doctor_id,
    })

    if not payload:
        raise HTTPException(
            status_code=404,
            detail="Pipeline not found"
        )

    driver = await get_driver()

    async with driver.session() as session:

        # Delete nodes created from this source doc
        await session.run(
            """
            MATCH (n:ClinicalNode {
                doctor_id: $doctor_id
            })
            WHERE n.source_doc CONTAINS $pipeline_id
            DETACH DELETE n
            """,
            doctor_id=doctor_id,
            pipeline_id=pipeline_id,
        )

    # Delete payload document
    await graph_payloads_col.delete_one({
        "pipeline_id": pipeline_id,
        "doctor_id": doctor_id,
    })

    return {
        "status": "deleted",
        "pipeline_id": pipeline_id,
        "doctor_id": doctor_id,
    }