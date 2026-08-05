"""
graph_scout.py
==============
Pure Neo4j graph scout — runs BEFORE the supervisor, costs zero LLM calls.
Answers three questions the supervisor needs to plan its strategy:

  1. Which incoming entities already exist in this doctor's graph?
  2. What decision patterns does this doctor already have for matched conditions?
  3. What contradictions are already known for incoming medications/labs?

Returns a compact ScoutBundle that the supervisor consumes in its single LLM call.

Risk signal detection is fully dynamic — no hardcoded keyword lists. Risk categories
are inferred from:
  - `risk_category` properties already stored on ClinicalNode (set at ingest time)
  - RISK_FACTOR_FOR / CONTRAINDICATED_WITH / MONITORS edges in the doctor's graph
  - Entity type distribution of incoming entities (triggers type-aware queries)
  - High-occurrence contradiction pairs already mined from this doctor's history
"""
from __future__ import annotations

import os
import asyncio
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set

from neo4j import AsyncGraphDatabase, AsyncDriver
from loguru import logger


NEO4J_URI      = os.getenv("NEO4J_URI",      "bolt://neo4j:7687")
NEO4J_USER     = os.getenv("NEO4J_USER",     "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "password")

_driver: Optional[AsyncDriver] = None


async def _get_driver() -> AsyncDriver:
    global _driver
    if _driver is None:
        _driver = AsyncGraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    return _driver


# ---------------------------------------------------------------------------
# ScoutBundle
# ---------------------------------------------------------------------------

@dataclass
class ScoutBundle:
    """
    Everything the Supervisor needs to plan its agent dispatch strategy.
    Produced entirely from Neo4j — no LLM, no hardcoded domain lists.
    """
    doctor_id: str

    # Which incoming entities are already in the doctor's graph
    known_entities: List[Dict]          = field(default_factory=list)
    # Condition→Decision patterns the doctor already has (weight, count)
    existing_patterns: List[Dict]       = field(default_factory=list)
    # Known CONTRADICTS edges for incoming meds/labs
    known_conflicts: List[Dict]         = field(default_factory=list)
    # High-weight edges near incoming conditions (neighbor context)
    neighbor_context: List[Dict]        = field(default_factory=list)

    # Risk categories discovered dynamically from the graph.
    # Keys are arbitrary strings stored in ClinicalNode.risk_category
    # (e.g. "cardiac", "renal", "oncology", "pediatric", …).
    # The supervisor receives the full set — nothing is hard-filtered here.
    active_risk_categories: Set[str]    = field(default_factory=set)

    # Structural risk flags derived from graph topology, not keywords
    has_high_contradiction_load: bool   = False   # ≥1 CONTRADICTS edge found
    has_progression_signal: bool        = False   # rising/worsening edge weights
    has_novel_entities: bool            = False   # entities unseen in this graph

    novel_entity_count: int             = 0
    known_entity_count: int             = 0

    def to_prompt_str(self) -> str:
        """Compact text representation injected into the supervisor prompt."""
        lines = ["=== GRAPH SCOUT REPORT ==="]

        lines.append(
            f"\nEntity novelty: {self.novel_entity_count} new, "
            f"{self.known_entity_count} already in graph"
        )

        if self.active_risk_categories:
            lines.append(
                "\nRisk categories (graph-derived): "
                + ", ".join(sorted(self.active_risk_categories)).upper()
            )

        structural_flags = []
        if self.has_high_contradiction_load: structural_flags.append("CONTRADICTION_LOAD")
        if self.has_progression_signal:      structural_flags.append("PROGRESSION")
        if self.has_novel_entities:          structural_flags.append("NOVEL_ENTITIES")
        if structural_flags:
            lines.append(f"Structural signals: {', '.join(structural_flags)}")

        if self.existing_patterns:
            lines.append("\nEstablished patterns (condition → decision | weight × count):")
            for p in self.existing_patterns[:12]:
                lines.append(
                    f"  [{p['weight']:.2f}×{p['count']}] "
                    f"{p['condition']} → {p['decision']}"
                )

        if self.known_conflicts:
            lines.append("\nKnown contradictions (already in graph):")
            for c in self.known_conflicts[:8]:
                lines.append(f"  {c['from_entity']} CONTRADICTS {c['to_entity']}")

        if self.neighbor_context:
            lines.append(
                "\nNeighbor context (high-weight edges near incoming conditions):"
            )
            for n in self.neighbor_context[:8]:
                lines.append(
                    f"  {n['from_label']} --{n['relation']}--> "
                    f"{n['to_label']} [{n['weight']:.2f}]"
                )

        return "\n".join(lines)


# ---------------------------------------------------------------------------
# GraphScout
# ---------------------------------------------------------------------------

class GraphScout:
    """
    Runs parallel Cypher queries against Neo4j.
    Total time: ~200-500ms. Zero LLM calls. Zero hardcoded domain keywords.

    Risk signals are read from two sources:
      A) ClinicalNode.risk_category — set at ingestion time by whatever pipeline
         created the node (LLM extractor, ICD mapper, SNOMED tagger, etc.).
         This is the primary source of truth.
      B) Graph topology — CONTRADICTS edge load, progression-typed edge weights,
         and entity novelty counts that are specialty-agnostic.
    """

    def __init__(self, doctor_id: str):
        self.doctor_id = doctor_id

    async def scout(self, entities: List[dict]) -> ScoutBundle:
        bundle = ScoutBundle(doctor_id=self.doctor_id)

        entity_names = [e.get("entity_name", "") for e in entities]

        condition_names = [
            e["entity_name"] for e in entities
            if e.get("entity_type", "").lower() in
               ("diagnosis", "condition", "icd", "symptom", "finding")
        ]
        med_lab_names = [
            e["entity_name"] for e in entities
            if e.get("entity_type", "").lower() in
               ("medication", "drug", "prescription",
                "lab result", "laboratory", "vital sign", "vital")
        ]

        driver = await _get_driver()
        async def _run(coro_fn, *args):
            async with driver.session() as s:
                return await coro_fn(s, *args)

        (
            known_entities,
            existing_patterns,
            known_conflicts,
            neighbor_context,
            risk_categories,
            progression_signal,
        ) = await asyncio.gather(
            _run(self._query_known_entities,    entity_names),
            _run(self._query_existing_patterns, condition_names),
            _run(self._query_known_conflicts,   med_lab_names),
            _run(self._query_neighbor_context,  condition_names),
            _run(self._query_risk_categories,   entity_names),
            _run(self._query_progression_signal, condition_names),
        )
        bundle.known_entities    = known_entities
        bundle.existing_patterns = existing_patterns
        bundle.known_conflicts   = known_conflicts
        bundle.neighbor_context  = neighbor_context

        # --- risk category flags (fully dynamic) ---
        bundle.active_risk_categories = {
            row["risk_category"].lower()
            for row in risk_categories
            if row.get("risk_category")
        }

        # --- structural flags (topology-based, not keyword-based) ---
        bundle.has_high_contradiction_load = len(known_conflicts) > 0
        bundle.has_progression_signal      = progression_signal
        bundle.has_novel_entities          = bundle.novel_entity_count > 0

        # --- entity novelty counts ---
        known_labels = {n["label"].lower() for n in known_entities}
        bundle.known_entity_count = sum(
            1 for e in entities
            if e.get("entity_name", "").lower() in known_labels
        )
        bundle.novel_entity_count = len(entities) - bundle.known_entity_count
        bundle.has_novel_entities = bundle.novel_entity_count > 0

        logger.info(
            f"  [GraphScout] doctor={self.doctor_id} | "
            f"novel={bundle.novel_entity_count} | "
            f"known={bundle.known_entity_count} | "
            f"patterns={len(existing_patterns)} | "
            f"conflicts={len(known_conflicts)} | "
            f"risk_categories={bundle.active_risk_categories}"
        )
        return bundle

    # -----------------------------------------------------------------------
    # Cypher helpers
    # -----------------------------------------------------------------------

    async def _query_known_entities(
        self, session, names: List[str]
    ) -> List[Dict]:
        if not names:
            return []
        result = await session.run(
            """
            MATCH (n:ClinicalNode {doctor_id: $did})
            WHERE any(name IN $names
                      WHERE toLower(n.label) CONTAINS toLower(name)
                         OR toLower(name) CONTAINS toLower(n.label))
            RETURN n.label            AS label,
                   n.node_type        AS node_type,
                   n.occurrence_count AS occurrence_count,
                   n.risk_category    AS risk_category
            ORDER BY n.occurrence_count DESC
            LIMIT 40
            """,
            did=self.doctor_id, names=names,
        )
        return await result.data()

    async def _query_existing_patterns(
        self, session, conditions: List[str]
    ) -> List[Dict]:
        if not conditions:
            return []
        result = await session.run(
            """
            MATCH (c:ClinicalNode {doctor_id: $did})
            WHERE any(name IN $conds
                      WHERE toLower(c.label) CONTAINS toLower(name)
                         OR toLower(name) CONTAINS toLower(c.label))
            MATCH (c)-[r:CLINICAL_EDGE {doctor_id: $did, relation: 'TRIGGERS_DECISION'}]
                      ->(d:ClinicalNode {doctor_id: $did})
            WHERE r.weight >= 0.4
            RETURN c.label         AS condition,
                   d.label         AS decision,
                   d.action_type   AS action_type,
                   r.weight        AS weight,
                   r.count         AS count
            ORDER BY r.weight DESC
            LIMIT 30
            """,
            did=self.doctor_id, conds=conditions,
        )
        return await result.data()

    async def _query_known_conflicts(
        self, session, names: List[str]
    ) -> List[Dict]:
        if not names:
            return []
        result = await session.run(
            """
            MATCH (a:ClinicalNode {doctor_id: $did})
                  -[r:CLINICAL_EDGE {doctor_id: $did, relation: 'CONTRADICTS'}]->
                  (b:ClinicalNode {doctor_id: $did})
            WHERE any(name IN $names
                      WHERE toLower(a.label) CONTAINS toLower(name)
                         OR toLower(b.label) CONTAINS toLower(name))
            RETURN a.label  AS from_entity,
                   b.label  AS to_entity,
                   r.weight AS weight
            ORDER BY r.weight DESC
            LIMIT 20
            """,
            did=self.doctor_id, names=names,
        )
        return await result.data()

    async def _query_neighbor_context(
        self, session, conditions: List[str]
    ) -> List[Dict]:
        """1-hop neighbor expansion for matched conditions."""
        if not conditions:
            return []
        result = await session.run(
            """
            MATCH (c:ClinicalNode {doctor_id: $did})
            WHERE any(name IN $conds
                      WHERE toLower(c.label) CONTAINS toLower(name))
            MATCH (c)-[r:CLINICAL_EDGE {doctor_id: $did}]->(n:ClinicalNode {doctor_id: $did})
            WHERE r.weight >= 0.5
            RETURN c.label    AS from_label,
                   r.relation AS relation,
                   n.label    AS to_label,
                   r.weight   AS weight
            ORDER BY r.weight DESC
            LIMIT 20
            """,
            did=self.doctor_id, conds=conditions,
        )
        return await result.data()

    async def _query_risk_categories(
        self, session, names: List[str]
    ) -> List[Dict]:
        """
        Return every distinct risk_category tag on nodes that match the
        incoming entity names.  Categories are set at ingest time — they can
        be anything: 'cardiac', 'renal', 'oncology', 'pediatric', 'obstetric',
        'psychiatric', etc.  GraphScout never filters or interprets them.
        """
        if not names:
            return []
        result = await session.run(
            """
            MATCH (n:ClinicalNode {doctor_id: $did})
            WHERE any(name IN $names
                      WHERE toLower(n.label) CONTAINS toLower(name)
                         OR toLower(name) CONTAINS toLower(n.label))
              AND n.risk_category IS NOT NULL
            RETURN DISTINCT n.risk_category AS risk_category
            """,
            did=self.doctor_id, names=names,
        )
        return await result.data()

    async def _query_progression_signal(
        self, session, conditions: List[str]
    ) -> bool:
        """
        Structural progression signal: does any matched condition have an
        outgoing PROGRESSION or WORSENING edge with weight >= 0.5?
        No string matching against note text — purely graph topology.
        """
        if not conditions:
            return False
        result = await session.run(
            """
            MATCH (c:ClinicalNode {doctor_id: $did})
            WHERE any(name IN $conds
                      WHERE toLower(c.label) CONTAINS toLower(name))
            MATCH (c)-[r:CLINICAL_EDGE {doctor_id: $did}]->()
            WHERE r.relation IN ['PROGRESSION_OF', 'WORSENING_OF',
                                  'COMPLICATION_OF', 'ESCALATION_OF']
              AND r.weight >= 0.5
            RETURN count(r) AS hit_count
            LIMIT 1
            """,
            did=self.doctor_id, conds=conditions,
        )
        row = await result.single()
        return bool(row and row["hit_count"] > 0)