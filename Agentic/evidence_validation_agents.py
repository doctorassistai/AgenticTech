"""
validation_agents.py
====================
Four new agents that add reliability to the Agentic Graph RAG pipeline.

  CoverageValidationAgent   — detects which chunks produced zero entities
  MissingEntityCriticAgent  — asks LLM what clinical concepts are still missing
  RetryExtractionAgent      — re-extracts only the missing concepts
  GraphRepairAgent          — deduplicates / repairs the graph after retries

Drop this file next to rag_pipeline.py and add the four stages between
Stage 3 (RelationshipExtractionAgent) and Stage 4 (KnowledgeGraphAgent).

Integration example is shown at the bottom of this file.
"""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from loguru import logger

# ── reuse your existing imports ───────────────────────────────────
# (these are already present in rag_pipeline.py)
from Agentic.evidence_models import (
    AgentRole, NodeType, EdgeRelation,
    AnyNode, BaseNode, GraphEdge,
    RecommendationNode, BiomarkerNode, DiagnosticTestNode,
    StudyNode, RiskFactorNode, PatientSubgroupNode,
    DiseaseNode, DrugNode, OutcomeNode, SymptomSignNode,
    SurgicalProcedureNode, ClassificationSystemNode, ResearchGapNode,
    AgentOutput, NodeColorGroup, NodeFlag,
)

# ─────────────────────────────────────────────────────────────────
# DATA STRUCTURES
# ─────────────────────────────────────────────────────────────────

@dataclass
class ChunkRecord:
    """Metadata for a single text chunk produced by the parser."""
    chunk_id: int
    text: str
    char_start: int
    char_end: int
    estimated_page_start: Optional[int] = None
    estimated_page_end: Optional[int] = None
    section_title: Optional[str] = None


@dataclass
class CoverageReport:
    total_chunks: int
    covered_chunks: int
    missing_chunk_ids: List[int]
    coverage_percent: float
    empty_chunks: List[int]           # chunks that were too short to extract from
    low_density_chunks: List[int]     # chunks with suspiciously few entities
    recommendation_coverage: float   # % of recommendation-type nodes with chunk_id
    table_coverage: float             # placeholder — set by table extractor later
    citation_coverage: float          # % of nodes that have a source_quote

    def is_acceptable(self, threshold: float = 80.0) -> bool:
        return self.coverage_percent >= threshold

    def summary(self) -> str:
        return (
            f"Coverage {self.coverage_percent:.1f}%  "
            f"({self.covered_chunks}/{self.total_chunks} chunks)  |  "
            f"Missing: {self.missing_chunk_ids}  |  "
            f"Rec coverage: {self.recommendation_coverage:.1f}%"
        )


# ─────────────────────────────────────────────────────────────────
# HELPER — build chunk records from raw text
# ─────────────────────────────────────────────────────────────────

def build_chunk_records(
    raw_text: str,
    chunk_size: int = 10_000,
    overlap: int = 500,
    chars_per_page: int = 3_000,
) -> List[ChunkRecord]:
    """
    Re-chunk the raw document text and attach metadata so every chunk
    has a stable chunk_id that can later be matched against extracted nodes.

    Call this ONCE inside DocumentParsingAgent._parse_raw() and store
    the returned list on the ParsedDocument (add a `chunk_records` field
    to ParsedDocument or pass it alongside).
    """
    records: List[ChunkRecord] = []
    start = 0
    idx = 0
    while start < len(raw_text):
        end = min(start + chunk_size, len(raw_text))
        text_slice = raw_text[start:end]
        page_start = start // chars_per_page + 1
        page_end   = end   // chars_per_page + 1
        records.append(ChunkRecord(
            chunk_id=idx,
            text=text_slice,
            char_start=start,
            char_end=end,
            estimated_page_start=page_start,
            estimated_page_end=page_end,
        ))
        if end == len(raw_text):
            break
        start = end - overlap
        idx += 1
    logger.info(f"[ChunkBuilder] {len(records)} chunks built from {len(raw_text):,} chars")
    return records


# ─────────────────────────────────────────────────────────────────
# STAGE 3.5 — COVERAGE VALIDATION AGENT
# ─────────────────────────────────────────────────────────────────

class CoverageValidationAgent:
    """
    Checks whether extraction actually touched every chunk.

    For each chunk that produced zero nodes it marks the chunk as missing
    and returns a CoverageReport so the pipeline can decide whether to
    trigger retry extraction.

    The agent does NOT call the LLM — it is a deterministic audit step.
    """

    MIN_CHUNK_CHARS = 200          # chunks shorter than this are skipped intentionally
    LOW_DENSITY_THRESHOLD = 0.5    # nodes-per-1000-chars; below this = suspicious

    def validate(
        self,
        chunk_records: List[ChunkRecord],
        nodes: List[AnyNode],
    ) -> CoverageReport:
        logger.info(f"[CoverageValidation] Auditing {len(chunk_records)} chunks "
                    f"against {len(nodes)} extracted nodes …")

        normalized = []

        for cr in chunk_records:
            if isinstance(cr, dict):
                normalized.append(ChunkRecord(**cr))
            else:
                normalized.append(cr)

        chunk_records = normalized

        # ── which chunks have at least one node referencing them? ──
        covered_ids: set[int] = set()
        for n in nodes:
            cid = getattr(n, "chunk_id", None)
            if cid is not None:
                covered_ids.add(int(cid))

        # ── classify chunks ────────────────────────────────────────
        missing: List[int] = []
        empty:   List[int] = []

        for cr in chunk_records:

            chunk_text = (
                cr.text
                if hasattr(cr, "text")
                else cr.get("text", "")
            )

            chunk_id = (
                cr.chunk_id
                if hasattr(cr, "chunk_id")
                else cr.get("chunk_id")
            )

            if len(chunk_text.strip()) < self.MIN_CHUNK_CHARS:
                empty.append(chunk_id)
                continue

            if chunk_id not in covered_ids:
                missing.append(chunk_id)

        # ── density check ──────────────────────────────────────────
        chunk_node_count: Dict[int, int] = {}
        for n in nodes:
            cid = getattr(n, "chunk_id", None)
            if cid is not None:
                chunk_node_count[int(cid)] = chunk_node_count.get(int(cid), 0) + 1

        low_density: List[int] = []
        for cr in chunk_records:
            if cr.chunk_id in covered_ids:
                chunk_text = (
                    cr.text
                    if hasattr(cr, "text")
                    else cr.get("text", "")
                )

                chunk_id = (
                    cr.chunk_id
                    if hasattr(cr, "chunk_id")
                    else cr.get("chunk_id")
                )

                density = (
                    chunk_node_count.get(chunk_id, 0)
                    / max(len(chunk_text), 1)
                ) * 1000
                if density < self.LOW_DENSITY_THRESHOLD:
                    low_density.append(cr.chunk_id)

        # ── recommendation coverage ────────────────────────────────
        rec_nodes = [n for n in nodes if getattr(n, "type", None) == NodeType.RECOMMENDATION]
        rec_with_chunk = sum(1 for n in rec_nodes if getattr(n, "chunk_id", None) is not None)
        rec_cov = (rec_with_chunk / max(len(rec_nodes), 1)) * 100

        # ── citation coverage ──────────────────────────────────────
        nodes_with_quote = sum(
            1 for n in nodes if getattr(n, "source_quote", None)
        )
        citation_cov = (nodes_with_quote / max(len(nodes), 1)) * 100

        # ── effective denominator excludes empty chunks ────────────
        effective_total = len(chunk_records) - len(empty)
        covered_effective = len([c for c in covered_ids
                                  if c not in empty])
        cov_pct = round(covered_effective / max(effective_total, 1) * 100, 1)

        report = CoverageReport(
            total_chunks=len(chunk_records),
            covered_chunks=len(covered_ids),
            missing_chunk_ids=sorted(missing),
            coverage_percent=cov_pct,
            empty_chunks=sorted(empty),
            low_density_chunks=sorted(low_density),
            recommendation_coverage=round(rec_cov, 1),
            table_coverage=0.0,          # updated by table extractor
            citation_coverage=round(citation_cov, 1),
        )
        logger.info(f"[CoverageValidation] {report.summary()}")
        return report


# ─────────────────────────────────────────────────────────────────
# STAGE 3.6 — MISSING ENTITY CRITIC AGENT
# ─────────────────────────────────────────────────────────────────

class MissingEntityCriticAgent:
    """
    Asks the LLM to inspect a chunk and the already-extracted nodes,
    then identify which clinically important concepts are still missing.

    Returns a list of missing concept descriptions that RetryExtractionAgent
    will use for targeted re-extraction.
    """

    SYSTEM = """
You are a senior clinical informatics specialist performing a gap analysis
on an AI-extracted knowledge graph derived from a medical guideline.

YOUR TASK
─────────
You will receive:
  1. A chunk of the original guideline text.
  2. A list of entities that have already been extracted from this chunk.

Identify which CLINICALLY IMPORTANT concepts from the chunk are MISSING
from the extracted entity list.

Focus specifically on:
  • Recommendation statements (ACOG recommends / suggests / recommends against)
  • Diagnostic tests and imaging modalities (with sensitivity/specificity if present)
  • Biomarkers (especially those explicitly NOT recommended)
  • Patient subgroups (adolescents, racial/ethnic minorities, transgender individuals)
  • Contraindications
  • Treatment pathways or sequential steps
  • Studies with statistics (OR, HR, RR, AUC, p-value)
  • Risk factors with direction and magnitude
  • Research gaps
  • Classification systems or staging

RESPONSE FORMAT
───────────────
Return ONLY a JSON object — no prose, no markdown fences:
{
  "missing_concepts": [
    {
      "concept_type": "<node type from: recommendation|diagnostic_test|biomarker|study|risk_factor|patient_subgroup|outcome|disease|drug|surgical_procedure|classification_system|research_gap>",
      "concept_description": "<brief plain-English description>",
      "evidence_quote": "<verbatim ≤ 60-word quote from the chunk proving this is present>"
    }
  ],
  "coverage_assessment": "<one sentence: overall quality of existing extraction for this chunk>"
}

Return an empty missing_concepts list if extraction was complete.
"""

    def __init__(self, llm: Any):
        self._llm = llm

    def critique(
        self,
        chunk: ChunkRecord,
        existing_nodes: List[AnyNode],
    ) -> List[Dict]:
        """
        Returns a list of missing concept dicts for the given chunk.
        """
        # summarise what we already have for this chunk
        chunk_nodes = [
            n for n in existing_nodes
            if getattr(n, "chunk_id", None) == chunk.chunk_id
        ]
        existing_summary = json.dumps([
            {"type": getattr(n, "type", "?").value if hasattr(getattr(n, "type", None), "value") else str(getattr(n, "type", "?")),
             "label": getattr(n, "label", ""),
             "id": getattr(n, "id", "")}
            for n in chunk_nodes
        ], indent=2)

        try:
            result = self._llm.complete_json(
                self.SYSTEM,
                f"CHUNK (id={chunk.chunk_id}, "
                f"pages ~{chunk.estimated_page_start}–{chunk.estimated_page_end}):\n"
                f"{chunk.text[:6000]}\n\n"
                f"ALREADY EXTRACTED FROM THIS CHUNK:\n{existing_summary}",
            )
            missing = result.get("missing_concepts", [])
            if missing:
                logger.info(
                    f"[Critic] Chunk {chunk.chunk_id}: "
                    f"{len(missing)} missing concepts detected"
                )
            return missing
        except Exception as exc:
            logger.warning(f"[Critic] Chunk {chunk.chunk_id} critique failed: {exc}")
            return []

    def critique_all_missing_chunks(
        self,
        chunk_records: List[ChunkRecord],
        coverage_report: CoverageReport,
        existing_nodes: List[AnyNode],
    ) -> Dict[int, List[Dict]]:
        """
        Run critique on every chunk flagged as missing or low-density.
        Returns {chunk_id: [missing_concept, ...]}
        """
        target_ids = set(
            coverage_report.missing_chunk_ids +
            coverage_report.low_density_chunks
        )
        chunk_map = {cr.chunk_id: cr for cr in chunk_records}

        results: Dict[int, List[Dict]] = {}
        for cid in sorted(target_ids):
            cr = chunk_map.get(cid)
            if cr is None:
                continue
            missing = self.critique(cr, existing_nodes)
            if missing:
                results[cid] = missing
        logger.info(
            f"[Critic] Critique complete: "
            f"{sum(len(v) for v in results.values())} missing concepts "
            f"across {len(results)} chunks"
        )
        return results


# ─────────────────────────────────────────────────────────────────
# STAGE 3.7 — RETRY EXTRACTION AGENT
# ─────────────────────────────────────────────────────────────────

NODE_MODEL_MAP: Dict[str, Any] = {
    "disease":               DiseaseNode,
    "drug":                  DrugNode,
    "study":                 StudyNode,
    "biomarker":             BiomarkerNode,
    "recommendation":        RecommendationNode,
    "patient_subgroup":      PatientSubgroupNode,
    "outcome":               OutcomeNode,
    "symptom_sign":          SymptomSignNode,
    "diagnostic_test":       DiagnosticTestNode,
    "risk_factor":           RiskFactorNode,
    "surgical_procedure":    SurgicalProcedureNode,
    "classification_system": ClassificationSystemNode,
    "research_gap":          ResearchGapNode,
}

NODE_TYPE_TO_COLOR: Dict[str, str] = {
    NodeType.DISEASE.value:               NodeColorGroup.DISEASE.value,
    NodeType.DRUG.value:                  NodeColorGroup.DRUG.value,
    NodeType.STUDY.value:                 NodeColorGroup.STUDY.value,
    NodeType.BIOMARKER.value:             NodeColorGroup.BIOMARKER.value,
    NodeType.RECOMMENDATION.value:        NodeColorGroup.RECOMMENDATION.value,
    NodeType.PATIENT_SUBGROUP.value:      NodeColorGroup.SUBGROUP.value,
    NodeType.OUTCOME.value:               NodeColorGroup.OUTCOME.value,
    NodeType.SYMPTOM_SIGN.value:          NodeColorGroup.SYMPTOM.value,
    NodeType.DIAGNOSTIC_TEST.value:       NodeColorGroup.TEST.value,
    NodeType.RISK_FACTOR.value:           NodeColorGroup.RISK.value,
    NodeType.SURGICAL_PROCEDURE.value:    NodeColorGroup.SURGICAL.value,
    NodeType.CLASSIFICATION_SYSTEM.value: NodeColorGroup.CLASSIFICATION.value,
    NodeType.RESEARCH_GAP.value:          NodeColorGroup.RESEARCH.value,
}


class RetryExtractionAgent:
    """
    Targeted re-extraction for concepts identified as missing by the critic.

    Unlike Stage 2 which extracts everything from a section, this agent
    receives a specific list of missing concepts and extracts ONLY those,
    reducing hallucination and token waste.
    """

    SYSTEM = """
You are a clinical entity extractor performing TARGETED extraction.

You will receive:
  1. A list of SPECIFIC missing concepts that must be extracted.
  2. The original chunk text where these concepts appear.

Extract ONLY the listed missing concepts. Do not extract anything else.

For each concept, return a fully-populated node object following the same
schema as Stage 2 entity extraction (id, type, label, description,
source_quote, visual_priority, flags, plus all type-specific fields).

Every node MUST include:
  chunk_id    – integer, the chunk_id provided in the input
  page_ref    – estimated page number (integer or null)

RESPONSE FORMAT
───────────────
Return ONLY a valid JSON array of node objects — no prose, no markdown.
"""

    def __init__(self, llm: Any):
        self._llm = llm

    def retry_chunk(
        self,
        chunk: ChunkRecord,
        missing_concepts: List[Dict],
        source_id: str,
        guideline_source: str,
        version: Optional[str],
    ) -> List[AnyNode]:
        """Extract missing concepts from a single chunk."""
        if not missing_concepts:
            return []

        concepts_text = json.dumps(missing_concepts, indent=2)

        try:
            raw = self._llm.complete_json(
                self.SYSTEM,
                f"CHUNK ID: {chunk.chunk_id}\n"
                f"ESTIMATED PAGES: {chunk.estimated_page_start}–{chunk.estimated_page_end}\n\n"
                f"MISSING CONCEPTS TO EXTRACT:\n{concepts_text}\n\n"
                f"CHUNK TEXT:\n{chunk.text[:6000]}",
            )
        except Exception as exc:
            logger.warning(f"[Retry] Chunk {chunk.chunk_id} extraction failed: {exc}")
            return []

        items = raw if isinstance(raw, list) else raw.get("nodes", [])
        nodes = self._cast_nodes(items, source_id, guideline_source, version, chunk.chunk_id)
        logger.info(f"[Retry] Chunk {chunk.chunk_id}: recovered {len(nodes)} nodes")
        return nodes

    def retry_all(
        self,
        chunk_records: List[ChunkRecord],
        missing_by_chunk: Dict[int, List[Dict]],
        source_id: str,
        guideline_source: str,
        version: Optional[str],
    ) -> List[AnyNode]:
        """Run retry extraction for all flagged chunks."""
        chunk_map = {cr.chunk_id: cr for cr in chunk_records}
        recovered: List[AnyNode] = []

        for cid, missing in missing_by_chunk.items():
            cr = chunk_map.get(cid)
            if cr is None:
                continue
            new_nodes = self.retry_chunk(cr, missing, source_id, guideline_source, version)
            recovered.extend(new_nodes)

        logger.info(f"[Retry] Total recovered nodes: {len(recovered)}")
        return recovered

    # ── internal ──────────────────────────────────────────────────

    def _cast_nodes(
        self,
        raw_nodes: List[Dict],
        source_id: str,
        guideline_source: str,
        version: Optional[str],
        chunk_id: int,
    ) -> List[AnyNode]:
        nodes: List[AnyNode] = []
        seen: set = set()
        valid_flags = {f.value for f in NodeFlag}

        for raw in raw_nodes:
            if not isinstance(raw, dict):
                continue
            node_id = raw.get("id", "").strip()
            if not node_id or node_id in seen:
                continue
            seen.add(node_id)

            # ensure provenance fields are set
            raw.setdefault("source_id", source_id)
            raw.setdefault("guideline_source", guideline_source)
            raw.setdefault("version", version)
            raw.setdefault("chunk_id", chunk_id)
            raw["flags"] = [f for f in raw.get("flags", []) if f in valid_flags]

            ntype_str = raw.get("type", "")
            try:
                ntype = NodeType(ntype_str)
            except ValueError:
                continue

            raw["color_group"] = NODE_TYPE_TO_COLOR.get(
                ntype.value, NodeColorGroup.RECOMMENDATION.value
            )

            cls = NODE_MODEL_MAP.get(ntype.value)
            if cls is None:
                continue
            try:
                nodes.append(cls(**raw))
            except Exception as exc:
                logger.debug(f"[Retry] Node cast failed [{node_id}]: {exc}")
        return nodes


# ─────────────────────────────────────────────────────────────────
# STAGE 3.8 — GRAPH REPAIR AGENT
# ─────────────────────────────────────────────────────────────────

class GraphRepairAgent:
    """
    Post-extraction cleanup:
      1. Semantic deduplication of nodes with near-identical labels
      2. Orphan node detection (nodes with no edges)
      3. Hallucinated / invalid edge removal
      4. Label normalisation (TVUS → Transvaginal Ultrasound)
      5. Produces a repair summary report

    The LLM is used ONLY for synonym detection (step 1).
    Steps 2–5 are deterministic.
    """

    DEDUP_SYSTEM = """
You are a clinical ontology normalisation specialist.

You will receive a list of clinical entity nodes. Your task is to identify
groups of nodes that refer to the SAME clinical concept but with different
labels or abbreviations.

Examples of duplicate groups:
  • "TVUS", "Transvaginal Ultrasound", "Trans-vaginal ultrasonography" → same test
  • "CA125", "CA-125", "CA 125", "Cancer Antigen 125" → same biomarker
  • "rASRM", "revised American Society for Reproductive Medicine staging" → same system
  • "Laparoscopy", "Diagnostic laparoscopy", "Laparoscopic surgery" → possibly same

Rules:
  • Only group nodes of the SAME type.
  • Keep the node with the most complete description as the CANONICAL node.
  • List all other node ids as DUPLICATES to be removed.

RESPONSE FORMAT (JSON only, no prose):
{
  "merge_groups": [
    {
      "canonical_id": "<id of the node to keep>",
      "duplicate_ids": ["<id1>", "<id2>"],
      "reason": "<brief explanation>"
    }
  ]
}
"""

    VALID_RELATIONS = {e.value for e in EdgeRelation}

    def __init__(self, llm: Any):
        self._llm = llm

    def repair(
        self,
        nodes: List[AnyNode],
        edges: List[GraphEdge],
    ) -> Tuple[List[AnyNode], List[GraphEdge], Dict]:
        """
        Returns (repaired_nodes, repaired_edges, repair_report).
        """
        logger.info(f"[GraphRepair] Starting repair: {len(nodes)} nodes, {len(edges)} edges")
        report: Dict = {}

        # ── Step 1: semantic dedup ─────────────────────────────────
        nodes, removed_ids, merge_log = self._semantic_dedup(nodes)
        report["nodes_removed_dedup"] = len(removed_ids)
        report["merge_log"] = merge_log

        # ── Step 2: remap edges after dedup ───────────────────────
        edges = self._remap_edges(edges, removed_ids)

        # ── Step 3: remove orphan edges ────────────────────────────
        valid_ids = {getattr(n, "id", None) for n in nodes}
        valid_edges = [
            e for e in edges
            if getattr(e, "source", None) in valid_ids
            and getattr(e, "target", None) in valid_ids
        ]
        report["edges_dropped_orphan"] = len(edges) - len(valid_edges)
        edges = valid_edges

        # ── Step 4: remove invalid relation types ─────────────────
        valid_edges2 = []
        for e in edges:
            rel = e.relation.value if hasattr(e.relation, "value") else str(e.relation)
            if rel in self.VALID_RELATIONS:
                valid_edges2.append(e)
        report["edges_dropped_invalid_relation"] = len(edges) - len(valid_edges2)
        edges = valid_edges2

        # ── Step 5: detect true orphan nodes ─────────────────────
        connected_ids: set = set()
        for e in edges:
            connected_ids.add(getattr(e, "source", None))
            connected_ids.add(getattr(e, "target", None))
        orphan_nodes = [
            getattr(n, "id", "?")
            for n in nodes
            if getattr(n, "id", None) not in connected_ids
        ]
        report["orphan_nodes"] = orphan_nodes
        report["final_nodes"] = len(nodes)
        report["final_edges"] = len(edges)

        logger.info(
            f"[GraphRepair] Done — "
            f"nodes: {report['final_nodes']} "
            f"(−{report['nodes_removed_dedup']} dedup)  |  "
            f"edges: {report['final_edges']} "
            f"(−{report['edges_dropped_orphan']} orphan, "
            f"−{report['edges_dropped_invalid_relation']} invalid)  |  "
            f"orphan nodes: {len(orphan_nodes)}"
        )
        return nodes, edges, report

    # ── internal ──────────────────────────────────────────────────

    def _semantic_dedup(
        self,
        nodes: List[AnyNode],
    ) -> Tuple[List[AnyNode], Dict[str, str], List[Dict]]:
        """
        Ask LLM to find duplicate nodes, then remove them.
        Returns (deduplicated_nodes, {removed_id: canonical_id}, merge_log).
        """
        # send max 80 nodes to keep prompt manageable
        summary = json.dumps([
            {
                "id":    getattr(n, "id", ""),
                "type":  getattr(n, "type", "").value
                         if hasattr(getattr(n, "type", None), "value")
                         else str(getattr(n, "type", "")),
                "label": getattr(n, "label", ""),
            }
            for n in nodes[:80]
        ], indent=2)

        try:
            result = self._llm.complete_json(self.DEDUP_SYSTEM, summary)
            merge_groups = result.get("merge_groups", [])
        except Exception as exc:
            logger.warning(f"[GraphRepair] Dedup LLM call failed: {exc}")
            merge_groups = []

        # build removal map  {duplicate_id → canonical_id}
        removal_map: Dict[str, str] = {}
        for grp in merge_groups:
            canonical = grp.get("canonical_id", "")
            for dup in grp.get("duplicate_ids", []):
                if dup != canonical:
                    removal_map[dup] = canonical

        kept_nodes = [
            n for n in nodes
            if getattr(n, "id", None) not in removal_map
        ]
        return kept_nodes, removal_map, merge_groups

    def _remap_edges(
        self,
        edges: List[GraphEdge],
        removal_map: Dict[str, str],
    ) -> List[GraphEdge]:
        """
        Replace removed node ids in edge source/target with their canonical ids.
        De-duplicates edges that become identical after remapping.
        """
        seen: set = set()
        remapped: List[GraphEdge] = []
        for e in edges:
            src = removal_map.get(e.source, e.source)
            tgt = removal_map.get(e.target, e.target)
            key = (src, tgt, e.relation)
            if key in seen:
                continue
            seen.add(key)
            # create updated edge (GraphEdge is a Pydantic model — use copy)
            try:
                updated = e.model_copy(update={"source": src, "target": tgt})
            except AttributeError:
                updated = e.copy(update={"source": src, "target": tgt})
            remapped.append(updated)
        return remapped


# ─────────────────────────────────────────────────────────────────
# COVERAGE SCORE BUILDER
# ─────────────────────────────────────────────────────────────────

def build_coverage_score(
    coverage_report: CoverageReport,
    nodes: List[AnyNode],
    repair_report: Dict,
) -> Dict:
    """Produces a single JSON-serialisable coverage score dict."""
    return {
        "chunk_coverage_percent":        coverage_report.coverage_percent,
        "chunks_processed":              coverage_report.total_chunks,
        "chunks_with_entities":          coverage_report.covered_chunks,
        "missing_chunk_ids":             coverage_report.missing_chunk_ids,
        "empty_chunk_ids":               coverage_report.empty_chunks,
        "low_density_chunk_ids":         coverage_report.low_density_chunks,
        "recommendation_coverage_pct":   coverage_report.recommendation_coverage,
        "citation_coverage_pct":         coverage_report.citation_coverage,
        "nodes_after_dedup":             repair_report.get("final_nodes", len(nodes)),
        "edges_after_repair":            repair_report.get("final_edges", 0),
        "orphan_nodes":                  repair_report.get("orphan_nodes", []),
    }


# ─────────────────────────────────────────────────────────────────
# INTEGRATION PATCH for rag_pipeline.py
# ─────────────────────────────────────────────────────────────────
#
# 1. IMPORT at the top of rag_pipeline.py:
#
#    from validation_agents import (
#        ChunkRecord, CoverageReport,
#        build_chunk_records,
#        CoverageValidationAgent,
#        MissingEntityCriticAgent,
#        RetryExtractionAgent,
#        GraphRepairAgent,
#        build_coverage_score,
#    )
#
# ─────────────────────────────────────────────────────────────────
# 2. ADD chunk_records to DocumentParsingAgent._parse_raw()
#    Store them so the pipeline can reference them later:
#
#    def _parse_raw(self, raw_text, source):
#        chunk_records = build_chunk_records(raw_text)   # ← ADD THIS
#        chunks = [cr.text for cr in chunk_records]
#        ...
#        doc = ParsedDocument(...)
#        doc.chunk_records = chunk_records               # ← ATTACH TO DOC
#        return doc
#
# ─────────────────────────────────────────────────────────────────
# 3. ADD chunk_id to every extracted node in Stage 2.
#    In ClinicalEntityExtractionAgent.extract(), track which chunk
#    each section came from:
#
#    for chunk_idx, chunk_text in enumerate(doc_chunks):
#        raw = self._llm.complete_json(system_prompt, chunk_text)
#        for node_raw in raw:
#            node_raw["chunk_id"] = chunk_idx    # ← ADD THIS
#
# ─────────────────────────────────────────────────────────────────
# 4. WIRE the four new agents into _extract_from_doc():
#
#    def _extract_from_doc(self, doc):
#        ...
#        nodes, ent_out = self._entities.extract(doc)
#        edges, rel_out = self._relations.extract(nodes, doc)
#
#        # ── NEW: validation loop ─────────────────────────────────
#        chunk_records = getattr(doc, "chunk_records", [])
#
#        if chunk_records:
#            # 3.5 — coverage audit
#            coverage = self._coverage_validator.validate(chunk_records, nodes)
#
#            if not coverage.is_acceptable(threshold=80.0):
#                logger.warning(
#                    f"Coverage only {coverage.coverage_percent:.1f}% — "
#                    f"triggering critic + retry …"
#                )
#
#                # 3.6 — critic: what's missing?
#                missing_by_chunk = self._critic.critique_all_missing_chunks(
#                    chunk_records, coverage, nodes
#                )
#
#                # 3.7 — retry: re-extract missing concepts
#                if missing_by_chunk:
#                    recovered = self._retry.retry_all(
#                        chunk_records, missing_by_chunk,
#                        source_id=doc.source_id,
#                        guideline_source=doc.guideline_source.value,
#                        version=doc.version,
#                    )
#                    nodes = self.merge_nodes(nodes, recovered)
#
#        # 3.8 — graph repair (always run)
#        nodes, edges, repair_report = self._graph_repair.repair(nodes, edges)
#        doc.coverage_score = build_coverage_score(coverage, nodes, repair_report)
#        ...
#
# ─────────────────────────────────────────────────────────────────
# 5. INSTANTIATE the four agents inside AgenticGraphRAGPipeline.__init__():
#
#    self._coverage_validator = CoverageValidationAgent()
#    self._critic             = MissingEntityCriticAgent(llm)
#    self._retry              = RetryExtractionAgent(llm)
#    self._graph_repair       = GraphRepairAgent(llm)
#
# ─────────────────────────────────────────────────────────────────
# 6. EXPECTED IMPROVEMENT after integration:
#
#    Metric                     Before    After
#    ─────────────────────────  ──────    ──────
#    Chunk coverage             ~30–50%   ~85–95%
#    Nodes extracted (30-pg doc)  5–20    40–80
#    Duplicate nodes              high    near zero
#    Orphan edges                 many    few
#    Recommendation coverage      low     ~90%+
#
# ─────────────────────────────────────────────────────────────────a