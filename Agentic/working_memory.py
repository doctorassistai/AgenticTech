"""
working_memory.py
=================
Thread-safe shared working memory for the Agentic GraphRAG reasoning loop.

All exploration agents write their findings here.
The supervisor reads it to decide if another expansion round is needed.
The synthesis agent reads it to produce the final graph primitives.

Design principles
-----------------
* No hardcoded domain buckets (conditions, contradictions, …).
  Agents declare their own bucket names at write time; the memory
  accepts anything.  A cardiology pipeline and an oncology pipeline
  use the same class without modification.

* No hardcoded truncation limits.  Each bucket carries the limit that
  was set when it was first registered (or the global default).
  The synthesis prompt respects per-bucket limits automatically.

* Budget tracking is generic — any counter name is valid.

* to_synthesis_prompt() iterates all registered buckets dynamically;
  adding a new agent/bucket requires zero changes here.
"""
from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple


# ---------------------------------------------------------------------------
# Per-bucket metadata
# ---------------------------------------------------------------------------

@dataclass
class _Bucket:
    """
    One named collection of agent findings.
    Created lazily the first time an agent writes to a name.
    """
    name: str
    items: List[Dict]        = field(default_factory=list)
    # How many items to surface in the synthesis prompt (0 = all)
    synthesis_limit: int     = 0
    # Free-text description injected as a header in the synthesis prompt
    description: str         = ""


# ---------------------------------------------------------------------------
# WorkingMemory
# ---------------------------------------------------------------------------

class WorkingMemory:
    """
    Shared state across all agents in one document processing run.

    Agents write to named buckets:

        await wm.add("conditions", items, agent="condition_agent")
        await wm.add("contradictions", items, agent="risk_agent")
        await wm.add("chemo_toxicity", items, agent="onco_agent")  # specialty bucket

    The supervisor/synthesis layer reads them generically — it never
    needs to know which buckets exist in advance.

    Parameters
    ----------
    doctor_id        : str
    source_doc       : str
    default_limit    : int
        Default number of items per bucket included in the synthesis
        prompt (0 = no limit).  Can be overridden per bucket via
        register_bucket().
    """

    def __init__(
        self,
        doctor_id: str,
        source_doc: str,
        default_limit: int = 30,
    ) -> None:
        self.doctor_id     = doctor_id
        self.source_doc    = source_doc
        self.default_limit = default_limit

        # Keyed by bucket name
        self._buckets: Dict[str, _Bucket] = {}
        # Raw Cypher / subgraph results (structural, not domain-specific)
        self._subgraphs: List[Dict]        = []
        # Agent thought traces
        self._reasoning: List[str]         = []
        # Generic counters — any string key is valid
        self._counters: Dict[str, int]     = {}

        self._lock = asyncio.Lock()

    # -----------------------------------------------------------------------
    # Optional: pre-register a bucket with a description / custom limit.
    # Not required — buckets are also created lazily on first write.
    # -----------------------------------------------------------------------

    def register_bucket(
        self,
        name: str,
        description: str = "",
        synthesis_limit: int = 0,
    ) -> None:
        """
        Pre-declare a bucket with metadata.
        Safe to call even if the bucket was already auto-created.
        """
        if name not in self._buckets:
            self._buckets[name] = _Bucket(
                name=name,
                description=description,
                synthesis_limit=synthesis_limit or self.default_limit,
            )
        else:
            # Update metadata on an existing bucket without touching items
            b = self._buckets[name]
            if description:
                b.description = description
            if synthesis_limit:
                b.synthesis_limit = synthesis_limit

    # -----------------------------------------------------------------------
    # Write API
    # -----------------------------------------------------------------------

    async def add(
        self,
        bucket: str,
        items: List[Dict],
        agent: str,
    ) -> None:
        """
        Append items to a named bucket.
        The bucket is created automatically if it does not exist yet.
        Each item is tagged with the writing agent's name.
        """
        if not items:
            return
        async with self._lock:
            b = self._buckets.setdefault(
                bucket,
                _Bucket(name=bucket, synthesis_limit=self.default_limit),
            )
            for item in items:
                item["_agent"] = agent
            b.items.extend(items)

    async def add_subgraph(self, cypher_result: List[Dict]) -> None:
        """Store raw Neo4j path / subgraph results."""
        async with self._lock:
            self._subgraphs.extend(cypher_result)

    async def add_reasoning(self, thought: str, agent: str) -> None:
        async with self._lock:
            self._reasoning.append(f"[{agent}] {thought}")

    # -----------------------------------------------------------------------
    # Counter API  (replaces increment_llm_calls / increment_neo4j_queries)
    # -----------------------------------------------------------------------

    async def increment(self, counter: str, n: int = 1) -> None:
        """Increment any named counter (e.g. 'llm_calls', 'neo4j_queries')."""
        async with self._lock:
            self._counters[counter] = self._counters.get(counter, 0) + n

    # -----------------------------------------------------------------------
    # Read API
    # -----------------------------------------------------------------------

    def get_bucket(self, name: str) -> List[Dict]:
        """Return all items in a bucket (empty list if it doesn't exist)."""
        return list(self._buckets[name].items) if name in self._buckets else []

    def all_buckets(self) -> Dict[str, List[Dict]]:
        """Return a snapshot of all buckets and their items."""
        return {name: list(b.items) for name, b in self._buckets.items()}

    def bucket_names(self) -> List[str]:
        return list(self._buckets.keys())

    def reasoning_trace(self) -> List[str]:
        return list(self._reasoning)

    def counter(self, name: str) -> int:
        return self._counters.get(name, 0)

    def counters(self) -> Dict[str, int]:
        return dict(self._counters)

    # -----------------------------------------------------------------------
    # Synthesis helpers
    # -----------------------------------------------------------------------

    def to_synthesis_prompt(self) -> str:
        """
        Compact representation for the synthesis agent's single LLM call.

        Iterates all registered buckets dynamically — no bucket name is
        hardcoded here.  Each bucket is rendered up to its own
        synthesis_limit (or self.default_limit if unset).
        """
        parts: List[str] = []

        for name, bucket in self._buckets.items():
            if not bucket.items:
                continue
            limit = bucket.synthesis_limit or self.default_limit or len(bucket.items)
            header = bucket.description.upper() if bucket.description else name.upper()
            parts.append(
                f"{header}:\n"
                + json.dumps(bucket.items[:limit], indent=1)
            )

        return "\n\n".join(parts)

    def budget_status(self) -> Dict[str, int]:
        """Return all counters — not just llm/neo4j."""
        return self.counters()

    # -----------------------------------------------------------------------
    # Introspection (useful for supervisor planning)
    # -----------------------------------------------------------------------

    def summary(self) -> Dict[str, Any]:
        """
        High-level summary the supervisor can use to decide whether
        another expansion round is needed.
        """
        return {
            "doctor_id":       self.doctor_id,
            "source_doc":      self.source_doc,
            "buckets":         {
                name: len(b.items) for name, b in self._buckets.items()
            },
            "subgraph_rows":   len(self._subgraphs),
            "reasoning_steps": len(self._reasoning),
            "counters":        self.counters(),
        }

    def __repr__(self) -> str:
        bucket_str = ", ".join(
            f"{k}={len(v.items)}" for k, v in self._buckets.items()
        )
        return (
            f"WorkingMemory(doctor={self.doctor_id!r}, "
            f"doc={self.source_doc!r}, "
            f"buckets=[{bucket_str}], "
            f"counters={self._counters})"
        )