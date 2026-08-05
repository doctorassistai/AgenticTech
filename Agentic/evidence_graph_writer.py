"""
evidence_graph_writer.py
========================
Neo4j graph writer for the Clinical Knowledge Graph pipeline.

Writes all 6 parts of the ClinicalKnowledgeGraph schema:
  Part 1 — DocumentMetadata         → :DocumentMetadata node
  Part 2 — 13 typed clinical nodes  → :ClinicalNode nodes with type-specific labels
  Part 3 — GraphEdge relations      → :CLINICAL_RELATION relationships
  Part 4 — ProtocolFlowGraph        → :ClinicalPathway + :PathwayStep nodes
  Part 5 — EvidenceImpactEntry      → :EvidenceEntry nodes linked to clinical nodes
  Part 6 — GraphConfig              → stored as metadata on the pipeline root node

Strategy:
  - MERGE nodes by (pipeline_id, id)          — idempotent re-runs.
  - MERGE edges by (source_id, relation, target_id, pipeline_id).
  - ON MATCH: update weight as running average, increment occurrence_count.
  - All nodes carry doctor_id for multi-tenant isolation.

Install:
    pip install neo4j loguru fastapi
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from loguru import logger
from neo4j import AsyncGraphDatabase, AsyncDriver

# ── All models from evidence_models.py (single source of truth) ──
from Agentic.evidence_models import (
    ClinicalKnowledgeGraph,
    AnyNode,
    NodeType,
    DiseaseNode,
    DrugNode,
    StudyNode,
    BiomarkerNode,
    RecommendationNode,
    PatientSubgroupNode,
    OutcomeNode,
    SymptomSignNode,
    DiagnosticTestNode,
    RiskFactorNode,
    SurgicalProcedureNode,
    ClassificationSystemNode,
    ResearchGapNode,
    GraphEdge,
    EdgeRelation,
    ProtocolFlowGraph,
    ProtocolStep,
    EvidenceImpactEntry,
    DocumentMetadata,
    GraphConfig,
)


# ─────────────────────────────────────────────────────────────────
# CONNECTION
# ─────────────────────────────────────────────────────────────────

NEO4J_URI      = os.getenv("NEO4J_URI")
NEO4J_USER     = os.getenv("NEO4J_USER")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")

_driver: Optional[AsyncDriver] = None


async def get_driver() -> AsyncDriver:
    global _driver
    if _driver is None:
        _driver = AsyncGraphDatabase.driver(
            NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD)
        )
    return _driver


async def close_driver() -> None:
    global _driver
    if _driver:
        await _driver.close()
        _driver = None


# ─────────────────────────────────────────────────────────────────
# HIGH-VALUE RELATION PRIORITY SET
# Matches EdgeRelation enum values from evidence_models.py
# ─────────────────────────────────────────────────────────────────

HIGH_VALUE_RELATIONS = {
    # Diagnostic pathway
    "first_line_for",
    "confirms_diagnosis_of",
    "superior_to",
    "guides_planning_of",
    # Recommendation logic
    "recommends",
    "recommends_against",
    # Clinical relationships
    "presents_with",
    "increases_risk_of",
    "delays_diagnosis_of",
    # Evidence
    "supported_by",
    "upgrades",
    "downgrades",
    # Treatment
    "treats",
    "contraindicated",
}


# ─────────────────────────────────────────────────────────────────
# HELPERS — flatten node dicts for Neo4j property maps
# Neo4j properties must be primitives (no nested dicts/lists of dicts).
# Lists of strings are fine; lists of dicts must be JSON-stringified.
# ─────────────────────────────────────────────────────────────────

import json


def _safe_props(d: Dict[str, Any]) -> Dict[str, Any]:
    """
    Flatten a node dict into Neo4j-safe scalar/list[str] properties.
    - Nested dicts → JSON string
    - Lists of dicts → JSON string
    - Lists of scalars → kept as-is
    - Booleans, ints, floats, strings → kept as-is
    """
    out: Dict[str, Any] = {}
    for k, v in d.items():
        if v is None:
            continue  # skip nulls — Neo4j treats missing and null the same
        if isinstance(v, dict):
            out[k] = json.dumps(v)
        elif isinstance(v, list):
            if v and isinstance(v[0], dict):
                out[k] = json.dumps(v)
            else:
                out[k] = [
                    str(i) if not isinstance(i, (str, int, float, bool)) else i
                    for i in v
                ]
        elif isinstance(v, (str, int, float, bool)):
            out[k] = v
        else:
            out[k] = str(v)
    return out


# ─────────────────────────────────────────────────────────────────
# GRAPH WRITER
# ─────────────────────────────────────────────────────────────────


NODE_MODEL_MAP = {
    "disease": DiseaseNode,
    "drug": DrugNode,
    "study": StudyNode,
    "biomarker": BiomarkerNode,
    "recommendation": RecommendationNode,
    "patient_subgroup": PatientSubgroupNode,
    "outcome": OutcomeNode,
    "symptom_sign": SymptomSignNode,
    "diagnostic_test": DiagnosticTestNode,
    "risk_factor": RiskFactorNode,
    "surgical_procedure": SurgicalProcedureNode,
    "classification_system": ClassificationSystemNode,
    "research_gap": ResearchGapNode,
}

class ClinicalGraphWriter:
    """
    Writes a complete ClinicalKnowledgeGraph into Neo4j.

    Model name mapping (graph_writer ← evidence_models.py):
      ClinicalPathway  ← ProtocolFlowGraph
      PathwayStep      ← ProtocolStep
      EvidenceEntry    ← EvidenceImpactEntry
      graph.pathways   ← graph.protocol_graphs
      graph.evidence_table ← graph.evidence_map

    Node labels used:
      :ClinicalNode                    — all 13 clinical node types (Part 2)
      :DocumentMetadata                — document-level metadata (Part 1)
      :ClinicalPathway                 — pathway container (Part 4)
      :PathwayStep                     — individual step in a pathway (Part 4)
      :EvidenceEntry                   — one evidence statistic row (Part 5)
      :PipelineRun                     — root node tracking the pipeline run

    Relationship types:
      :CLINICAL_RELATION               — all typed edges from Part 3
      :HAS_STEP                        — Pathway → PathwayStep
      :HAS_EVIDENCE                    — PipelineRun → EvidenceEntry
      :HAS_PATHWAY                     — PipelineRun → ClinicalPathway
      :HAS_METADATA                    — PipelineRun → DocumentMetadata
      :HAS_NODE                        — PipelineRun → ClinicalNode
      :STEP_REFERENCES                 — PathwayStep → ClinicalNode
      :NEXT_STEP                       — PathwayStep → PathwayStep (ordering)
      :SUPPORTED_BY_EVIDENCE           — ClinicalNode → EvidenceEntry
    """

    async def load_doctor_graph(
        self,
        doctor_id: str,
    ) -> Optional[ClinicalKnowledgeGraph]:

        driver = await get_driver()

        async with driver.session() as session:

            node_query = """
            MATCH (n:ClinicalNode {
                doctor_id: $doctor_id,
                graph_source: "evidence"
            })
            RETURN properties(n) as node
            """

            edge_query = """
            MATCH (a:ClinicalNode {doctor_id: $doctor_id})
                -[r:CLINICAL_RELATION]->
                (b:ClinicalNode {doctor_id: $doctor_id})

            RETURN {
                id: r.id,
                source: a.id,
                target: b.id,
                relation: r.relation,
                weight: r.weight,
                label: r.label,
                evidence_basis: r.evidence_basis,
                bidirectional: r.bidirectional,
                is_new: r.is_new
            } as edge
            """

            node_result = await session.run(
                node_query,
                doctor_id=doctor_id
            )

            edge_result = await session.run(
                edge_query,
                doctor_id=doctor_id
            )

            nodes = []
            edges = []

            async for record in node_result:

                node = record["node"]

                try:

                    node_type = node.get("type", "recommendation")

                    model_cls = NODE_MODEL_MAP.get(
                        node_type,
                        RecommendationNode
                    )

                    nodes.append(
                        model_cls(**node)
                    )

                except Exception as exc:
                    logger.warning(f"Failed loading node: {exc}")

            async for record in edge_result:

                edge = record["edge"]

                try:

                    edges.append(
                        GraphEdge(
                            id=edge.get("id", ""),
                            source=edge["source"],
                            target=edge["target"],
                            relation=EdgeRelation(edge["relation"]),
                            weight=edge.get("weight", 1),
                            label=edge.get("label", ""),
                            evidence_basis=edge.get("evidence_basis", ""),
                            bidirectional=edge.get("bidirectional", False),
                            is_new=edge.get("is_new", False),
                        )
                    )

                except Exception as exc:
                    logger.warning(f"Failed loading edge: {exc}")

            if not nodes:
                return None

            graph = ClinicalKnowledgeGraph(

                nodes=[
                    n.model_dump()
                    if hasattr(n, "model_dump")
                    else n
                    for n in nodes
                ],

                edges=[
                    e.model_dump()
                    if hasattr(e, "model_dump")
                    else e
                    for e in edges
                ],
            )

            return graph


    async def load_pipeline_graph(
        self,
        doctor_id: str,
        pipeline_id: str,
    ) -> Optional[ClinicalKnowledgeGraph]:

        driver = await get_driver()

        async with driver.session() as session:

            node_query = """
            MATCH (n:ClinicalNode {
                doctor_id: $doctor_id,
                pipeline_id: $pipeline_id
            })

            RETURN properties(n) as node
            """

            edge_query = """
            MATCH (a:ClinicalNode {
                doctor_id: $doctor_id,
                pipeline_id: $pipeline_id
            })
            -[r:CLINICAL_RELATION {
                pipeline_id: $pipeline_id
            }]->
            (b:ClinicalNode {
                doctor_id: $doctor_id,
                pipeline_id: $pipeline_id
            })

            RETURN {
                id: r.id,
                source: a.id,
                target: b.id,
                relation: r.relation,
                weight: r.weight,
                label: r.label,
                evidence_basis: r.evidence_basis,
                bidirectional: r.bidirectional,
                is_new: r.is_new
            } as edge
            """

            node_result = await session.run(
                node_query,
                doctor_id=doctor_id,
                pipeline_id=pipeline_id
            )

            edge_result = await session.run(
                edge_query,
                doctor_id=doctor_id,
                pipeline_id=pipeline_id
            )

            nodes = []
            edges = []

            async for record in node_result:

                node = record["node"]

                try:

                    node_type = node.get("type", "recommendation")

                    model_cls = NODE_MODEL_MAP.get(
                        node_type,
                        RecommendationNode
                    )

                    nodes.append(
                        model_cls(**node)
                    )

                except Exception as exc:
                    logger.warning(f"Failed loading node: {exc}")

            async for record in edge_result:

                edge = record["edge"]

                try:

                    edges.append(
                        GraphEdge(
                            id=edge.get("id", ""),
                            source=edge["source"],
                            target=edge["target"],
                            relation=EdgeRelation(edge["relation"]),
                            weight=edge.get("weight", 1),
                            label=edge.get("label", ""),
                            evidence_basis=edge.get("evidence_basis", ""),
                            bidirectional=edge.get("bidirectional", False),
                            is_new=edge.get("is_new", False),
                        )
                    )

                except Exception as exc:
                    logger.warning(f"Failed loading edge: {exc}")

            if not nodes:
                return None

            graph = ClinicalKnowledgeGraph(

                nodes=[
                    n.model_dump()
                    if hasattr(n, "model_dump")
                    else n
                    for n in nodes
                ],

                edges=[
                    e.model_dump()
                    if hasattr(e, "model_dump")
                    else e
                    for e in edges
                ],
            )

            return graph

    async def write_graph(
        self,
        graph: ClinicalKnowledgeGraph,
        doctor_id: str,
    ) -> Dict[str, Any]:
        """
        Top-level entry point.
        Writes all 6 parts of the ClinicalKnowledgeGraph to Neo4j.
        Returns write stats.
        """
        driver = await get_driver()
        pid    = graph.pipeline_id
        ts     = graph.generated_at
        stats  = {
            "pipeline_id":      pid,
            "nodes_written":    0,
            "edges_written":    0,
            "pathways_written": 0,
            "evidence_written": 0,
        }

        async with driver.session() as session:
            await self._ensure_indexes(session)

            # ── Part 0: Pipeline root node ───────────────────────
            await self._merge_pipeline_root(session, graph, doctor_id, ts)

            # ── Part 1: Document metadata ────────────────────────
            for meta in graph.metadata:
                await self._merge_metadata(session, meta, pid, doctor_id, ts)

            # ── Part 2: Clinical nodes ───────────────────────────
            for node_dict in graph.nodes:
                await self._merge_clinical_node(session, node_dict, pid, doctor_id, ts)
                stats["nodes_written"] += 1

            # ── Part 3: Typed edges ──────────────────────────────
            for edge in graph.edges:
                await self._merge_clinical_edge(session, edge, pid, doctor_id, ts)
                stats["edges_written"] += 1

            # ── Part 4: Protocol pathways ────────────────────────
            # graph.protocol_graphs  ←  was: graph.pathways
            for pathway in graph.protocol_graphs:
                await self._merge_pathway(session, pathway, pid, doctor_id, ts)
                stats["pathways_written"] += 1

            # ── Part 5: Evidence map ─────────────────────────────
            # graph.evidence_map  ←  was: graph.evidence_table
            for entry in graph.evidence_map:
                await self._merge_evidence(session, entry, pid, doctor_id, ts)
                stats["evidence_written"] += 1

        logger.info(
            f"Neo4j write complete | pipeline={pid} | doctor={doctor_id} | "
            f"nodes={stats['nodes_written']} | edges={stats['edges_written']} | "
            f"pathways={stats['pathways_written']} | evidence={stats['evidence_written']}"
        )
        return stats

    # ──────────────────────────────────────────────────────────────
    # INDEXES
    # ──────────────────────────────────────────────────────────────

    async def _ensure_indexes(self, session) -> None:
        stmts = [
            "CREATE INDEX clinical_node_id     IF NOT EXISTS FOR (n:ClinicalNode)     ON (n.id, n.pipeline_id)",
            "CREATE INDEX clinical_node_type   IF NOT EXISTS FOR (n:ClinicalNode)     ON (n.type)",
            "CREATE INDEX clinical_node_doctor IF NOT EXISTS FOR (n:ClinicalNode)     ON (n.doctor_id)",
            "CREATE INDEX metadata_pipeline    IF NOT EXISTS FOR (n:DocumentMetadata) ON (n.pipeline_id)",
            "CREATE INDEX pathway_id           IF NOT EXISTS FOR (n:ClinicalPathway)  ON (n.id, n.pipeline_id)",
            "CREATE INDEX evidence_id          IF NOT EXISTS FOR (n:EvidenceEntry)    ON (n.id, n.pipeline_id)",
            "CREATE INDEX pipeline_root_id     IF NOT EXISTS FOR (n:PipelineRun)      ON (n.pipeline_id)",
        ]
        for stmt in stmts:
            await session.run(stmt)

    # ──────────────────────────────────────────────────────────────
    # PART 0 — PIPELINE ROOT
    # ──────────────────────────────────────────────────────────────

    async def _merge_pipeline_root(
        self,
        session,
        graph: ClinicalKnowledgeGraph,
        doctor_id: str,
        ts: str,
    ) -> None:
        props = _safe_props({
            "pipeline_id":    graph.pipeline_id,
            "doctor_id":      doctor_id,
            "graph_source": "evidence",
            "generated_at":   ts,
            "source_names":   graph.source_names,
            "total_nodes":    graph.total_nodes,
            "total_edges":    graph.total_edges,
            "total_pathways": graph.total_pathways,
            "total_evidence": graph.total_evidence,
            # Part 6 — graph config flattened
            "recommended_layout": graph.graph_config.recommended_layout,
            "cluster_as_layers":  graph.graph_config.cluster_as_layers,
            "default_filter":     graph.graph_config.default_filter,
        })
        await session.run(
            """
            MERGE (p:PipelineRun {pipeline_id: $pipeline_id, doctor_id: $doctor_id})
            ON CREATE SET p += $props, p.created_at = $ts
            ON MATCH  SET p += $props, p.updated_at = $ts
            """,
            pipeline_id=graph.pipeline_id,
            doctor_id=doctor_id,
            props=props,
            ts=ts,
        )

    # ──────────────────────────────────────────────────────────────
    # PART 1 — DOCUMENT METADATA
    # ──────────────────────────────────────────────────────────────

    async def _merge_metadata(
        self,
        session,
        metadata: DocumentMetadata,
        pipeline_id: str,
        doctor_id: str,
        ts: str,
    ) -> None:
        props = _safe_props({
            "pipeline_id":        pipeline_id,
            "doctor_id":          doctor_id,
            "graph_source": "evidence",
            "title":              metadata.title,
            "document_type":      metadata.document_type.value if hasattr(metadata.document_type, "value") else str(metadata.document_type),
            "guideline_source":   metadata.guideline_source.value if metadata.guideline_source else None,
            "issuing_body":       metadata.issuing_body,
            "publication_date":   metadata.publication_date,
            "target_population":  metadata.target_population,
            "condition":          metadata.condition,
            "purpose":            metadata.purpose,
            "evidence_framework": metadata.evidence_framework,
            "version":            metadata.version,
            # replaces is List[ReplacedDocument] — flatten to strings
            "replaces": [f"{r.title} ({r.year})" for r in metadata.replaces],
        })
        await session.run(
            """
            MERGE (m:DocumentMetadata {pipeline_id: $pipeline_id, doctor_id: $doctor_id, title: $title})
            ON CREATE SET m += $props, m.created_at = $ts
            ON MATCH  SET m += $props, m.updated_at = $ts
            WITH m
            MATCH (p:PipelineRun {pipeline_id: $pipeline_id, doctor_id: $doctor_id})
            MERGE (p)-[:HAS_METADATA]->(m)
            """,
            pipeline_id=pipeline_id,
            doctor_id=doctor_id,
            title=metadata.title,
            props=props,
            ts=ts,
        )

    # ──────────────────────────────────────────────────────────────
    # PART 2 — CLINICAL NODES  (all 13 types)
    # ──────────────────────────────────────────────────────────────

    async def _merge_clinical_node(
        self,
        session,
        node: Dict[str, Any],
        pipeline_id: str,
        doctor_id: str,
        ts: str,
    ) -> None:
        """
        MERGE a ClinicalNode.
        The node's 'type' field (e.g. 'recommendation') is stored as a property
        so queries can filter by type directly without dynamic labels.
        """
        node_id   = node.get("id", "")
        node_type = node.get("type", "unknown")

        props = _safe_props({
            **node,
            "pipeline_id": pipeline_id,
            "doctor_id":   doctor_id,
            "graph_source": "evidence",
            "updated_at":  ts,
        })

        await session.run(
            """
           MERGE (n:ClinicalNode {
                id: $node_id,
                pipeline_id: $pipeline_id,
                doctor_id: $doctor_id
            })
            ON CREATE SET n += $props, n.created_at = $ts, n.occurrence_count = 1
            ON MATCH  SET n += $props, n.updated_at = $ts,
                          n.occurrence_count = n.occurrence_count + 1
            WITH n
            MATCH (p:PipelineRun {pipeline_id: $pipeline_id, doctor_id: $doctor_id})
            MERGE (p)-[:HAS_NODE]->(n)
            """,
            node_id=node_id,
            pipeline_id=pipeline_id,
            doctor_id=doctor_id,
            props=props,
            ts=ts,
        )

    # ──────────────────────────────────────────────────────────────
    # PART 3 — TYPED EDGES
    # ──────────────────────────────────────────────────────────────

    async def _merge_clinical_edge(
        self,
        session,
        edge: GraphEdge,
        pipeline_id: str,
        doctor_id: str,
        ts: str,
    ) -> None:
        """
        MERGE a typed :CLINICAL_RELATION between two ClinicalNodes.
        The EdgeRelation value is stored as a 'relation' property.
        ON MATCH: running average weight.
        """
        priority = "high" if edge.relation.value in HIGH_VALUE_RELATIONS else "normal"

        await session.run(
            """
            MATCH (a:ClinicalNode {
                id: $source,
                pipeline_id: $pipeline_id,
                doctor_id: $doctor_id
            })

            MATCH (b:ClinicalNode {
                id: $target,
                pipeline_id: $pipeline_id,
                doctor_id: $doctor_id
            })
            MERGE (a)-[r:CLINICAL_RELATION {
                relation:    $relation,
                pipeline_id: $pipeline_id,
                doctor_id:   $doctor_id
            }]->(b)
            ON CREATE SET
                r.id             = $edge_id,
                r.weight         = $weight,
                r.label          = $label,
                r.evidence_basis = $evidence_basis,
                r.bidirectional  = $bidirectional,
                r.is_new         = $is_new,
                r.priority       = $priority,
                r.count          = 1,
                r.created_at     = $ts,
                r.updated_at     = $ts
            ON MATCH SET
                r.weight     = (r.weight * r.count + $weight) / (r.count + 1),
                r.count      = r.count + 1,
                r.updated_at = $ts
            """,
            source=edge.source,
            target=edge.target,
            relation=edge.relation.value,
            pipeline_id=pipeline_id,
            doctor_id=doctor_id,
            edge_id=edge.id,
            weight=edge.weight,
            label=edge.label,
            evidence_basis=edge.evidence_basis,
            bidirectional=edge.bidirectional,
            is_new=edge.is_new,
            priority=priority,
            ts=ts,
        )

        # If bidirectional, also write the reverse edge
        if edge.bidirectional:
            await session.run(
                """
                MATCH (a:ClinicalNode {id: $source, pipeline_id: $pipeline_id, doctor_id: $doctor_id})
                MATCH (b:ClinicalNode {id: $target, pipeline_id: $pipeline_id, doctor_id: $doctor_id})
                MERGE (b)-[r:CLINICAL_RELATION {
                    relation:    $relation,
                    pipeline_id: $pipeline_id,
                    doctor_id:   $doctor_id
                }]->(a)
                ON CREATE SET
                    r.id             = $edge_id + '_rev',
                    r.weight         = $weight,
                    r.label          = $label + ' (reverse)',
                    r.evidence_basis = $evidence_basis,
                    r.bidirectional  = true,
                    r.priority       = $priority,
                    r.count          = 1,
                    r.created_at     = $ts,
                    r.updated_at     = $ts
                ON MATCH SET
                    r.weight     = (r.weight * r.count + $weight) / (r.count + 1),
                    r.count      = r.count + 1,
                    r.updated_at = $ts
                """,
                source=edge.source,
                target=edge.target,
                relation=edge.relation.value,
                pipeline_id=pipeline_id,
                doctor_id=doctor_id,
                edge_id=edge.id,
                weight=edge.weight,
                label=edge.label,
                evidence_basis=edge.evidence_basis,
                priority=priority,
                ts=ts,
            )

    # ──────────────────────────────────────────────────────────────
    # PART 4 — PROTOCOL PATHWAYS  (ProtocolFlowGraph + ProtocolStep)
    # ──────────────────────────────────────────────────────────────

    async def _merge_pathway(
        self,
        session,
        pathway: ProtocolFlowGraph,          # ← was ClinicalPathway
        pipeline_id: str,
        doctor_id: str,
        ts: str,
    ) -> None:
        """
        Persist a ProtocolFlowGraph and its ordered ProtocolSteps.
        Steps are linked by :HAS_STEP and chained by :NEXT_STEP.
        Each step is linked to its ClinicalNode by :STEP_REFERENCES.

        ProtocolFlowGraph field mapping vs old ClinicalPathway:
          pathway.steps                 → List[ProtocolStep]
          step.branch_positive          → step.branch_positive  (same)
          step.branch_negative          → step.branch_negative  (same)
          step.condition_to_proceed     → step.condition_to_proceed (same)
          step.condition_to_stop        → step.condition_to_stop    (same)
          step.time_constraint          → step.time_constraint      (same)
          step.notes                    → step.notes                (same)
        """
        pathway_props = _safe_props({
            "id":                    pathway.id,
            "graph_source": "evidence",
            "name":                  pathway.name,
            "clinical_question":     pathway.clinical_question,
            "applicable_population": pathway.applicable_population,
            "entry_criteria":        pathway.entry_criteria,
            "terminal_outcomes":     pathway.terminal_outcomes,
            "source_id":             pathway.source_id,
            "version":               pathway.version,
            "guideline_source":      pathway.guideline_source.value if pathway.guideline_source else None,
            "pipeline_id":           pipeline_id,
            "doctor_id":             doctor_id,
        })

        # Merge the pathway node and link to pipeline root
        await session.run(
            """
            MERGE (pw:ClinicalPathway {id: $pid, pipeline_id: $pipeline_id, doctor_id: $doctor_id})
            ON CREATE SET pw += $props, pw.created_at = $ts
            ON MATCH  SET pw += $props, pw.updated_at = $ts
            WITH pw
            MATCH (p:PipelineRun {pipeline_id: $pipeline_id, doctor_id: $doctor_id})
            MERGE (p)-[:HAS_PATHWAY]->(pw)
            """,
            pid=pathway.id,
            pipeline_id=pipeline_id,
            doctor_id=doctor_id,
            props=pathway_props,
            ts=ts,
        )

        prev_step_id: Optional[str] = None

        for step in pathway.steps:
            # ProtocolStep fields (from evidence_models.py)
            step_node_id = f"{pathway.id}_step_{step.step_number}"
            step_props = _safe_props({
                "id":                   step_node_id,
                "graph_source": "evidence",
                "step_number":          step.step_number,
                "action":               step.action,
                "node_id":              step.node_id,
                "node_type":            step.node_type.value if step.node_type else None,
                "condition_to_proceed": step.condition_to_proceed,
                "condition_to_stop":    step.condition_to_stop,
                "branch_positive":      step.branch_positive,
                "branch_negative":      step.branch_negative,
                "time_constraint":      step.time_constraint,
                "notes":                step.notes,
                "pipeline_id":          pipeline_id,
                "doctor_id":            doctor_id,
            })

            # Merge step node and link to pathway
            await session.run(
                """
                MERGE (s:PathwayStep {id: $sid, pipeline_id: $pipeline_id, doctor_id: $doctor_id})
                ON CREATE SET s += $props, s.created_at = $ts
                ON MATCH  SET s += $props, s.updated_at = $ts
                WITH s
                MATCH (pw:ClinicalPathway {id: $pathway_id, pipeline_id: $pipeline_id, doctor_id: $doctor_id})
                MERGE (pw)-[:HAS_STEP]->(s)
                """,
                sid=step_node_id,
                pipeline_id=pipeline_id,
                doctor_id=doctor_id,
                props=step_props,
                pathway_id=pathway.id,
                ts=ts,
            )

            # Link step → the ClinicalNode it references
            if step.node_id:
                await session.run(
                    """
                    MATCH (s:PathwayStep {id: $sid, pipeline_id: $pipeline_id, doctor_id: $doctor_id})
                    MATCH (n:ClinicalNode {id: $nid, pipeline_id: $pipeline_id, doctor_id: $doctor_id})
                    MERGE (s)-[:STEP_REFERENCES]->(n)
                    """,
                    sid=step_node_id,
                    nid=step.node_id,
                    pipeline_id=pipeline_id,
                    doctor_id=doctor_id,
                )

            # Chain steps sequentially
            if prev_step_id:
                await session.run(
                    """
                    MATCH (prev:PathwayStep {id: $prev_id, pipeline_id: $pipeline_id, doctor_id: $doctor_id})
                    MATCH (curr:PathwayStep {id: $curr_id, pipeline_id: $pipeline_id, doctor_id: $doctor_id})
                    MERGE (prev)-[:NEXT_STEP]->(curr)
                    """,
                    prev_id=prev_step_id,
                    curr_id=step_node_id,
                    pipeline_id=pipeline_id,
                    doctor_id=doctor_id,
                )

            prev_step_id = step_node_id

    # ──────────────────────────────────────────────────────────────
    # PART 5 — EVIDENCE MAP  (EvidenceImpactEntry)
    # ──────────────────────────────────────────────────────────────

    async def _merge_evidence(
        self,
        session,
        entry: EvidenceImpactEntry,          # ← was EvidenceEntry
        pipeline_id: str,
        doctor_id: str,
        ts: str,
    ) -> None:
        """
        Persist one EvidenceImpactEntry and link it to every ClinicalNode
        it supports via :SUPPORTED_BY_EVIDENCE.

        EvidenceImpactEntry fields (from evidence_models.py):
          entry.study_node_id        — which study node this describes
          entry.study_type           — StudyType enum
          entry.finding              — plain-English finding
          entry.statistic_type       — StatisticType enum or None
          entry.statistic_value      — float or None
          entry.ci_lower / ci_upper  — confidence interval bounds
          entry.p_value              — string or None
          entry.evidence_quality     — EvidenceQuality enum
          entry.supports_node_ids    — List[str]  nodes this entry supports
          entry.modifies_edge_ids    — List[str]
          entry.impacts_pathway_ids  — List[str]
          entry.citation_text        — string
          entry.limitation           — string or None
        """
        ev_props = _safe_props({
            "id":                  entry.id,
            "graph_source": "evidence",
            "study_node_id":       entry.study_node_id,
            "study_type":          entry.study_type.value,
            "finding":             entry.finding,
            "statistic_type":      entry.statistic_type.value if entry.statistic_type else None,
            "statistic_value":     entry.statistic_value,
            "ci_lower":            entry.ci_lower,
            "ci_upper":            entry.ci_upper,
            "p_value":             entry.p_value,
            "evidence_quality":    entry.evidence_quality.value,
            "supports_node_ids":   entry.supports_node_ids,
            "modifies_edge_ids":   entry.modifies_edge_ids,
            "impacts_pathway_ids": entry.impacts_pathway_ids,
            "citation_text":       entry.citation_text,
            "limitation":          entry.limitation,
            "pipeline_id":         pipeline_id,
            "doctor_id":           doctor_id,
        })

        await session.run(
            """
            MERGE (e:EvidenceEntry {id: $eid, pipeline_id: $pipeline_id, doctor_id: $doctor_id})
            ON CREATE SET e += $props, e.created_at = $ts
            ON MATCH  SET e += $props, e.updated_at = $ts
            WITH e
            MATCH (p:PipelineRun {pipeline_id: $pipeline_id, doctor_id: $doctor_id})
            MERGE (p)-[:HAS_EVIDENCE]->(e)
            """,
            eid=entry.id,
            pipeline_id=pipeline_id,
            doctor_id=doctor_id,
            props=ev_props,
            ts=ts,
        )

        # Link evidence → every ClinicalNode it supports
        for node_id in entry.supports_node_ids:
            await session.run(
                """
                MATCH (e:EvidenceEntry {id: $eid, pipeline_id: $pipeline_id, doctor_id: $doctor_id})
                MATCH (n:ClinicalNode  {id: $nid, pipeline_id: $pipeline_id, doctor_id: $doctor_id})
                MERGE (n)-[:SUPPORTED_BY_EVIDENCE]->(e)
                """,
                eid=entry.id,
                nid=node_id,
                pipeline_id=pipeline_id,
                doctor_id=doctor_id,
            )


# ─────────────────────────────────────────────────────────────────
# ORCHESTRATOR
# ─────────────────────────────────────────────────────────────────

_writer = ClinicalGraphWriter()


async def write_to_graph(
    graph: ClinicalKnowledgeGraph,
    doctor_id: str,
) -> Dict[str, Any]:
    """
    Write a completed ClinicalKnowledgeGraph to Neo4j.
    Call this from evidence_pipeline.py after the pipeline run completes.

    Example:
        graph = pipeline.run_from_text(text, source)
        stats = await write_to_graph(graph, doctor_id="dr_abc123")
    """
    return await _writer.write_graph(graph, doctor_id)


# ─────────────────────────────────────────────────────────────────
# FASTAPI ROUTER
# ─────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/graph", tags=["Clinical Knowledge Graph — Neo4j"])


# ── GET: full network for a doctor ────────────────────────────────

@router.get("/network/{doctor_id}")
async def get_network(
    doctor_id:  str,
    min_weight: float = Query(1, ge=1, le=5),
    limit:      int   = Query(500, ge=1, le=2000),
):
    """
    Return all ClinicalNodes and CLINICAL_RELATION edges for a doctor.
    Suitable for feeding directly into the React/D3 frontend.
    """
    driver = await get_driver()

    async with driver.session() as session:

        node_result = await session.run(
            """
            MATCH (n:ClinicalNode)
            WHERE n.doctor_id = $doctor_id
            RETURN
                n.id               AS id,
                n.label            AS label,
                n.type             AS type,
                n.color_group      AS color_group,
                n.visual_priority  AS visual_priority,
                n.cluster          AS cluster,
                n.description      AS description,
                n.flags            AS flags,
                n.occurrence_count AS occurrence_count,
                n.pipeline_id      AS pipeline_id
            ORDER BY n.visual_priority ASC, n.occurrence_count DESC
            LIMIT $limit
            """,
            doctor_id=doctor_id,
            limit=limit,
        )
        nodes = await node_result.data()

        edge_result = await session.run(
            """
            MATCH (a:ClinicalNode)-[r:CLINICAL_RELATION]->(b:ClinicalNode)
            WHERE r.doctor_id = $doctor_id
              AND r.weight >= $min_weight
            RETURN
                r.id            AS id,
                a.id            AS source,
                b.id            AS target,
                r.relation      AS relation,
                r.weight        AS weight,
                r.label         AS label,
                r.bidirectional AS bidirectional,
                r.priority      AS priority
            ORDER BY r.weight DESC
            LIMIT $limit
            """,
            doctor_id=doctor_id,
            min_weight=min_weight,
            limit=limit,
        )
        edges = await edge_result.data()

    return {
        "doctor_id":   doctor_id,
        "total_nodes": len(nodes),
        "total_edges": len(edges),
        "nodes":       nodes,
        "edges":       edges,
    }


# ── GET: nodes filtered by type ───────────────────────────────────

@router.get("/nodes/{doctor_id}")
async def get_nodes(
    doctor_id:       str,
    node_type:       Optional[str] = None,
    visual_priority: Optional[int] = None,
    cluster:         Optional[str] = None,
    pipeline_id:     Optional[str] = None,
):
    """
    Return ClinicalNodes for a doctor with optional filters.
    node_type: one of the 13 NodeType values (e.g. 'recommendation')
    visual_priority: 1 | 2 | 3
    """
    driver = await get_driver()

    query = """
        MATCH (n:ClinicalNode)
        WHERE n.doctor_id = $doctor_id
    """
    params: Dict[str, Any] = {"doctor_id": doctor_id}

    if node_type:
        query += " AND n.type = $node_type"
        params["node_type"] = node_type

    if visual_priority is not None:
        query += " AND n.visual_priority = $visual_priority"
        params["visual_priority"] = visual_priority

    if cluster:
        query += " AND n.cluster = $cluster"
        params["cluster"] = cluster

    if pipeline_id:
        query += " AND n.pipeline_id = $pipeline_id"
        params["pipeline_id"] = pipeline_id

    query += """
        RETURN
            n.id AS id, n.label AS label, n.type AS type,
            n.description AS description, n.color_group AS color_group,
            n.visual_priority AS visual_priority, n.cluster AS cluster,
            n.flags AS flags, n.source_quote AS source_quote,
            n.pipeline_id AS pipeline_id, n.occurrence_count AS occurrence_count
        ORDER BY n.visual_priority ASC, n.occurrence_count DESC
    """

    async with driver.session() as session:
        result = await session.run(query, **params)
        nodes  = await result.data()

    return {"doctor_id": doctor_id, "total": len(nodes), "nodes": nodes}


# ── GET: node neighbours (graph expansion) ────────────────────────

@router.get("/node/{node_id}/neighbours")
async def get_neighbours(
    node_id:    str,
    doctor_id:  str,
    max_depth:  int   = Query(1, ge=1, le=3),
    min_weight: float = Query(1, ge=1, le=5),
):
    """
    Return the neighbourhood of a ClinicalNode up to max_depth hops.
    Used by the frontend to expand a node on click.
    """
    driver = await get_driver()

    async with driver.session() as session:
        result = await session.run(
            """
            MATCH path = (start:ClinicalNode {id: $node_id, doctor_id: $doctor_id})
                         -[r:CLINICAL_RELATION*1..$depth]-(neighbour:ClinicalNode)
            WHERE ALL(rel IN relationships(path) WHERE rel.weight >= $min_weight)
            UNWIND relationships(path) AS rel
            WITH
                startNode(rel).id    AS source,
                startNode(rel).label AS source_label,
                startNode(rel).type  AS source_type,
                rel.relation         AS relation,
                rel.weight           AS weight,
                rel.label            AS edge_label,
                endNode(rel).id      AS target,
                endNode(rel).label   AS target_label,
                endNode(rel).type    AS target_type
            RETURN DISTINCT source, source_label, source_type,
                            relation, weight, edge_label,
                            target, target_label, target_type
            ORDER BY weight DESC
            LIMIT 200
            """,
            node_id=node_id,
            doctor_id=doctor_id,
            depth=max_depth,
            min_weight=min_weight,
        )
        edges = await result.data()

    node_map: Dict[str, Dict] = {}
    for e in edges:
        node_map[e["source"]] = {"id": e["source"], "label": e["source_label"], "type": e["source_type"]}
        node_map[e["target"]] = {"id": e["target"], "label": e["target_label"], "type": e["target_type"]}

    return {
        "center":      node_id,
        "total_nodes": len(node_map),
        "total_edges": len(edges),
        "nodes":       list(node_map.values()),
        "edges":       edges,
    }


# ── GET: pathways for a doctor ────────────────────────────────────

@router.get("/pathways/{doctor_id}")
async def get_pathways(
    doctor_id:   str,
    pipeline_id: Optional[str] = None,
):
    """Return all ProtocolFlowGraphs (stored as ClinicalPathway) with ordered steps."""
    driver = await get_driver()

    path_query = """
        MATCH (pw:ClinicalPathway)
        WHERE pw.doctor_id = $doctor_id
    """
    params: Dict[str, Any] = {"doctor_id": doctor_id}

    if pipeline_id:
        path_query += " AND pw.pipeline_id = $pipeline_id"
        params["pipeline_id"] = pipeline_id

    path_query += """
        OPTIONAL MATCH (pw)-[:HAS_STEP]->(s:PathwayStep)
        WITH pw, s ORDER BY s.step_number ASC
        RETURN
            pw.id AS id, pw.name AS name,
            pw.clinical_question     AS clinical_question,
            pw.applicable_population AS applicable_population,
            pw.entry_criteria        AS entry_criteria,
            pw.terminal_outcomes     AS terminal_outcomes,
            COLLECT({
                step_number:          s.step_number,
                action:               s.action,
                node_id:              s.node_id,
                node_type:            s.node_type,
                condition_to_proceed: s.condition_to_proceed,
                condition_to_stop:    s.condition_to_stop,
                branch_positive:      s.branch_positive,
                branch_negative:      s.branch_negative,
                time_constraint:      s.time_constraint,
                notes:                s.notes
            }) AS steps
        ORDER BY pw.name
    """

    async with driver.session() as session:
        result   = await session.run(path_query, **params)
        pathways = await result.data()

    return {"doctor_id": doctor_id, "total": len(pathways), "pathways": pathways}


# ── GET: evidence for a doctor ────────────────────────────────────

@router.get("/evidence/{doctor_id}")
async def get_evidence(
    doctor_id:   str,
    pipeline_id: Optional[str] = None,
    study_type:  Optional[str] = None,
    node_id:     Optional[str] = None,
):
    """
    Return EvidenceImpactEntry rows (stored as EvidenceEntry nodes).
    node_id: filter to evidence supporting a specific ClinicalNode.
    """
    driver = await get_driver()

    if node_id:
        query = """
            MATCH (n:ClinicalNode {id: $node_id, doctor_id: $doctor_id})
                  -[:SUPPORTED_BY_EVIDENCE]->(e:EvidenceEntry)
        """
        params: Dict[str, Any] = {"node_id": node_id, "doctor_id": doctor_id}
    else:
        query  = "MATCH (e:EvidenceEntry) WHERE e.doctor_id = $doctor_id"
        params = {"doctor_id": doctor_id}

    if pipeline_id:
        query += " AND e.pipeline_id = $pipeline_id"
        params["pipeline_id"] = pipeline_id

    if study_type:
        query += " AND e.study_type = $study_type"
        params["study_type"] = study_type

    query += """
        RETURN
            e.id                  AS id,
            e.study_node_id       AS study_node_id,
            e.study_type          AS study_type,
            e.finding             AS finding,
            e.statistic_type      AS statistic_type,
            e.statistic_value     AS statistic_value,
            e.ci_lower            AS ci_lower,
            e.ci_upper            AS ci_upper,
            e.p_value             AS p_value,
            e.evidence_quality    AS evidence_quality,
            e.supports_node_ids   AS supports_node_ids,
            e.citation_text       AS citation_text,
            e.limitation          AS limitation,
            e.pipeline_id         AS pipeline_id
        ORDER BY e.statistic_value DESC
    """

    async with driver.session() as session:
        result   = await session.run(query, **params)
        evidence = await result.data()

    return {"doctor_id": doctor_id, "total": len(evidence), "evidence": evidence}


# ── GET: recommendations only ────────────────────────────────────

@router.get("/recommendations/{doctor_id}")
async def get_recommendations(
    doctor_id:   str,
    strength:    Optional[str] = None,
    limit:       int = Query(100, ge=1, le=500),
):
    """
    Return all recommendation nodes for a doctor.
    strength: strong_for | strong_against | conditional_for | conditional_against | good_practice_point
    """
    driver = await get_driver()

    query  = "MATCH (n:ClinicalNode) WHERE n.doctor_id = $doctor_id AND n.type = 'recommendation'"
    params: Dict[str, Any] = {"doctor_id": doctor_id, "limit": limit}

    if strength:
        query += " AND n.strength = $strength"
        params["strength"] = strength

    query += """
        RETURN
            n.id               AS id,
            n.label            AS label,
            n.description      AS description,
            n.strength         AS strength,
            n.evidence_quality AS evidence_quality,
            n.clinical_context AS clinical_context,
            n.source_quote     AS source_quote,
            n.flags            AS flags,
            n.is_new           AS is_new,
            n.pipeline_id      AS pipeline_id
        ORDER BY
            CASE n.strength
                WHEN 'strong_for'          THEN 1
                WHEN 'strong_against'      THEN 2
                WHEN 'conditional_for'     THEN 3
                WHEN 'conditional_against' THEN 4
                ELSE 5
            END
        LIMIT $limit
    """

    async with driver.session() as session:
        result = await session.run(query, **params)
        recs   = await result.data()

    return {"doctor_id": doctor_id, "total": len(recs), "recommendations": recs}


# ── GET: pipeline summaries for a doctor ─────────────────────────

@router.get("/pipelines/{doctor_id}")
async def list_pipelines(doctor_id: str):
    """List all pipeline runs for a doctor with summary stats."""
    driver = await get_driver()

    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (p:PipelineRun {doctor_id: $doctor_id})
            RETURN
                p.pipeline_id    AS pipeline_id,
                p.generated_at   AS generated_at,
                p.source_names   AS source_names,
                p.total_nodes    AS total_nodes,
                p.total_edges    AS total_edges,
                p.total_pathways AS total_pathways,
                p.total_evidence AS total_evidence
            ORDER BY p.generated_at DESC
            """,
            doctor_id=doctor_id,
        )
        pipelines = await result.data()

    return {"doctor_id": doctor_id, "total": len(pipelines), "pipelines": pipelines}


# ── GET: graph stats (global) ────────────────────────────────────

@router.get("/stats")
async def get_graph_stats():
    """Return aggregate statistics across the entire knowledge graph."""
    driver = await get_driver()

    async with driver.session() as session:
        node_result = await session.run("""
            MATCH (n:ClinicalNode)
            RETURN n.type AS type, COUNT(n) AS count
            ORDER BY count DESC
        """)
        node_counts = await node_result.data()

        edge_result = await session.run("""
            MATCH ()-[r:CLINICAL_RELATION]->()
            RETURN r.relation AS relation, COUNT(r) AS count
            ORDER BY count DESC
        """)
        edge_counts = await edge_result.data()

        total_result = await session.run("""
            MATCH (n:ClinicalNode)
            WITH COUNT(n) AS total_nodes
            MATCH ()-[r:CLINICAL_RELATION]->()
            RETURN total_nodes, COUNT(r) AS total_edges
        """)
        totals = await total_result.single()

    return {
        "total_nodes":       totals["total_nodes"] if totals else 0,
        "total_edges":       totals["total_edges"] if totals else 0,
        "nodes_by_type":     node_counts,
        "edges_by_relation": edge_counts,
    }


# ── GET: search entities ──────────────────────────────────────────

@router.get("/search")
async def search_entities(
    q:          str           = Query(..., min_length=2),
    doctor_id:  Optional[str] = None,
    node_types: Optional[str] = None,
    limit:      int           = Query(50, ge=1, le=200),
):
    """
    Full-text search across ClinicalNode labels and descriptions.
    node_types: comma-separated list of NodeType values to filter.
    """
    driver = await get_driver()

    query = """
        MATCH (n:ClinicalNode)
        WHERE (toLower(n.label) CONTAINS toLower($q)
            OR (n.description IS NOT NULL AND toLower(n.description) CONTAINS toLower($q)))
    """
    params: Dict[str, Any] = {"q": q, "limit": limit}

    if doctor_id:
        query += " AND n.doctor_id = $doctor_id"
        params["doctor_id"] = doctor_id

    if node_types:
        types_list = [t.strip() for t in node_types.split(",")]
        query += " AND n.type IN $types"
        params["types"] = types_list

    query += """
        RETURN
            n.id AS id, n.label AS label, n.type AS type,
            n.description AS description, n.visual_priority AS visual_priority,
            n.occurrence_count AS occurrence_count, n.pipeline_id AS pipeline_id
        ORDER BY n.occurrence_count DESC, n.label ASC
        LIMIT $limit
    """

    async with driver.session() as session:
        result = await session.run(query, **params)
        hits   = await result.data()

    return {"query": q, "total": len(hits), "results": hits}


# ── DELETE: clear all data for a doctor ──────────────────────────

@router.delete("/clear/{doctor_id}")
async def clear_doctor_graph(
    doctor_id: str,
    confirm:   str = Query(..., description="Pass 'yes' to confirm deletion"),
):
    """
    ⚠️ Delete ALL graph data for a doctor (nodes, relationships, pipeline roots).
    """
    if confirm.lower() != "yes":
        raise HTTPException(
            status_code=400,
            detail="Pass confirm=yes to delete the doctor's graph data.",
        )

    driver = await get_driver()

    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (n)
            WHERE n.doctor_id = $doctor_id
            DETACH DELETE n
            RETURN count(n) AS deleted
            """,
            doctor_id=doctor_id,
        )
        record  = await result.single()
        deleted = record["deleted"] if record else 0

    logger.warning(f"Graph cleared | doctor_id={doctor_id} | deleted={deleted} nodes")

    return {
        "status":        "cleared",
        "doctor_id":     doctor_id,
        "deleted_nodes": deleted,
    }


# ── GET: summary for a doctor ─────────────────────────────────────

@router.get("/summary/{doctor_id}")
async def get_doctor_summary(doctor_id: str):
    """High-level graph summary for a single doctor."""
    driver = await get_driver()

    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (n:ClinicalNode {
                doctor_id: $doctor_id,
                graph_source: "evidence"
            })
            WITH COUNT(n) AS total_nodes
            MATCH ()-[r:CLINICAL_RELATION {doctor_id: $doctor_id}]->()
            RETURN total_nodes, COUNT(r) AS total_edges
            """,
            doctor_id=doctor_id,
        )
        row = await result.single()

        pipeline_result = await session.run(
            """
            MATCH (p:PipelineRun {doctor_id: $doctor_id})
            RETURN COUNT(p) AS total_pipelines
            """,
            doctor_id=doctor_id,
        )
        pr = await pipeline_result.single()

    return {
        "doctor_id":       doctor_id,
        "total_nodes":     row["total_nodes"]    if row else 0,
        "total_edges":     row["total_edges"]    if row else 0,
        "total_pipelines": pr["total_pipelines"] if pr else 0,
    }


