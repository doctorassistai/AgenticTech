"""
agentic_graph_rag.py
====================
True Agentic GraphRAG for the clinical pipeline.

THREE layers of agents, all sharing one WorkingMemory:

  Layer 0 — Supervisor (1 LLM call)
    Reads the ScoutBundle, decides which exploration agents run
    and what budget each gets.

  Layer 1 — Exploration agents (up to MAX_AGENTS_PER_RUN, each ≤ 2 LLM calls)
    Each agent:
      1. Reasons about incoming entities + working memory snapshot
      2. Decides what to query in Neo4j (recursive, budget-gated)
      3. Writes findings into working memory
      4. Optionally requests a second-pass expansion

  Layer 2 — Synthesis agent (1 LLM call)
    Reads working memory, produces the final graph primitives.

Design principles
-----------------
* No hardcoded agent names — agents are registered via AgentDefinition.
  Adding a new specialty agent (oncology_agent, psych_agent, …) requires
  only a new AgentDefinition entry; nothing else in this file changes.

* No hardcoded risk rules in the supervisor prompt — risk categories come
  from ScoutBundle.active_risk_categories (graph-derived, set at ingest
  time).  The supervisor sees whatever the graph actually flagged.

* No hardcoded entity-type-to-agent mapping — each AgentDefinition declares
  the entity types it cares about; _extract_focus_labels() reads that
  declaration at runtime.

* Full compatibility with the refactored WorkingMemory API (bucket-based,
  generic counters).

Total worst-case LLM calls:
  1 (supervisor) + 5 agents × 2 (initial + expand) + 1 (synthesis) = 12

FIXES (2026-05-21):
  1. Step 3 now correctly calls _run_synthesis_agent (was wrongly calling
     _run_weight_update_only, which always returns empty triples/chains).
  2. When entities=[] but raw_sections is present (run-direct path), the
     supervisor skip is overridden so agents actually run.
  3. _run_exploration_agent now injects raw_sections directly into its LLM
     prompt so the document text is available even when entities list is empty.
"""
from __future__ import annotations

import json
import asyncio
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from loguru import logger
from neo4j import AsyncGraphDatabase, AsyncDriver
import os

from Agentic.graph_scout import GraphScout, ScoutBundle
from Agentic.working_memory import WorkingMemory
from Agentic.document_model import AgentGraphOutput
from Agentic.document_agents import (
    _chat, _GROQ_SEMAPHORE,
    _build_triples, _build_abnormalities,
    _build_doc_decision_chains, _build_impact_flags,
    merge_agent_outputs,
    _raw_sections_block,
)

GROQ_API_KEY   = os.getenv("GROQ_API_KEY")
NEO4J_URI      = os.getenv("NEO4J_URI",      "bolt://neo4j:7687")
NEO4J_USER     = os.getenv("NEO4J_USER",     "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "password")

# ── Hard budget limits ────────────────────────────────────────────────────────
MAX_LLM_CALLS_TOTAL     = 14   # supervisor(1) + agents(≤10) + synthesis(1) + buffer(2)
MAX_NEO4J_QUERIES_TOTAL = 25
MAX_AGENTS_PER_RUN      = 5
MAX_QUERIES_PER_AGENT   = 5
MAX_DEPTH_PER_AGENT     = 2

_neo4j_driver: Optional[AsyncDriver] = None


async def _get_neo4j() -> AsyncDriver:
    global _neo4j_driver
    if _neo4j_driver is None:
        _neo4j_driver = AsyncGraphDatabase.driver(
            NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD)
        )
    return _neo4j_driver


# ═══════════════════════════════════════════════════════════════════════════════
# AGENT REGISTRY
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class AgentDefinition:
    """
    Declarative description of one exploration agent.

    name            : unique identifier returned by the supervisor
    description     : one-line description injected into the supervisor prompt
    entity_types    : entity_type values this agent focuses on for Neo4j pre-fetch.
                      Compared case-insensitively against entity["entity_type"].
                      Empty tuple = agent receives ALL entity names (use sparingly).
    default_depth   : Neo4j hop depth if the supervisor doesn't override it
    output_buckets  : WorkingMemory bucket names this agent writes to.
                      Must match the keys used in _run_exploration_agent().
    """
    name: str
    description: str
    entity_types: Tuple[str, ...]
    default_depth: int = 1
    output_buckets: Tuple[str, ...] = (
        "conditions", "decision_chains", "contradictions",
        "impact_flags", "high_risk_patterns",
    )


# ---------------------------------------------------------------------------
# Default agents — extend this list to add new specialties.
# Nothing else in this file needs to change.
# ---------------------------------------------------------------------------
_DEFAULT_AGENT_REGISTRY: List[AgentDefinition] = [
    AgentDefinition(
        name="symptom_agent",
        description="Maps symptoms/findings → conditions; finds diagnostic patterns",
        entity_types=("symptom", "finding", "sign", "complaint",
                      "diagnosis", "condition"),
        default_depth=2,
    ),
    AgentDefinition(
        name="medication_agent",
        description="Checks drug safety, interactions, contraindications",
        entity_types=("medication", "drug", "prescription", "pharmacology"),
        default_depth=2,
    ),
    AgentDefinition(
        name="temporal_agent",
        description="Detects progression, recurrence, and worsening trends",
        entity_types=("diagnosis", "condition", "icd",
                      "lab result", "vital sign", "vital"),
        default_depth=1,
    ),
    AgentDefinition(
        name="contradiction_agent",
        description="Finds conflicts between entities and existing decisions",
        entity_types=("medication", "drug", "lab result",
                      "abnormality", "vital sign"),
        default_depth=2,
    ),
    AgentDefinition(
        name="decision_agent",
        description="Extracts Condition→Decision chains and updates edge weights",
        entity_types=("diagnosis", "condition", "icd", "finding"),
        default_depth=2,
    ),
]


def build_agent_registry(
    extra_agents: Optional[List[AgentDefinition]] = None,
) -> Dict[str, AgentDefinition]:
    """
    Returns the active agent registry as {name: AgentDefinition}.
    Pass extra_agents to add specialty agents at call time without
    modifying the module-level defaults.
    """
    registry = {a.name: a for a in _DEFAULT_AGENT_REGISTRY}
    for agent in (extra_agents or []):
        registry[agent.name] = agent
    return registry


def _agent_registry_for_prompt(registry: Dict[str, AgentDefinition]) -> str:
    """Render the agent registry as a bullet list for the supervisor prompt."""
    lines = []
    for defn in registry.values():
        lines.append(f"  - {defn.name:<26}: {defn.description}")
    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════════════════════
# LAYER 0 — SUPERVISOR
# ═══════════════════════════════════════════════════════════════════════════════

_SUPERVISOR_SYSTEM_TEMPLATE = """
You are a clinical reasoning supervisor.
You receive:
  1. A list of incoming clinical entities from a new document
  2. A scout report showing what is already in this doctor's knowledge graph,
     including any RISK CATEGORIES detected from the graph itself.
  3. Optionally, raw document text that should be analysed even if the entity
     list is empty.

Your job: decide which exploration agents to launch and with what depth/focus.

Available agents (determined at runtime — do NOT assume fixed names):
{agent_list}

Return ONLY valid JSON:
{{
  "reasoning": "one paragraph explaining your dispatch strategy",
  "agents_to_run": ["<agent_name>", ...],
  "agent_configs": {{
    "<agent_name>": {{"depth": 1, "focus": "short focus instruction"}},
    ...
  }},
  "skip_deep_extraction": false,
  "reason_for_skip": ""
}}

RULES:
- Choose agents whose descriptions match the risk categories and entity types
  present in the scout report. The scout report lists risk categories; use
  those to guide your choice — do not assume specific category names.
- skip_deep_extraction = true ONLY when ALL entities are known AND the scout
  reports zero risk categories and zero contradictions AND there is no raw
  document text to analyse.
  In that case return agents_to_run = [] and a weight-update note in reason_for_skip.
- If raw document text is present (even with empty entities), you MUST set
  skip_deep_extraction = false and run at least the symptom_agent and
  decision_agent to extract findings from the document.
- Never run more than {max_agents} agents.
- Depth 1 = one Neo4j hop. Depth 2 = two-hop neighbourhood.
- Prefer depth 2 for agents investigating high-weight risk categories.
"""


async def _run_supervisor(
    entities: List[dict],
    scout: ScoutBundle,
    memory: WorkingMemory,
    registry: Dict[str, AgentDefinition],
    has_raw_sections: bool = False,
) -> Dict[str, Any]:
    """Single LLM call — decides dispatch strategy."""
    loop = asyncio.get_event_loop()

    system = _SUPERVISOR_SYSTEM_TEMPLATE.format(
        agent_list=_agent_registry_for_prompt(registry),
        max_agents=MAX_AGENTS_PER_RUN,
    )

    user = (
        f"=== INCOMING ENTITIES ({len(entities)}) ===\n"
        f"{json.dumps(entities[:50], indent=1)}\n\n"
        f"=== RAW DOCUMENT PRESENT: {has_raw_sections} ===\n\n"
        f"{scout.to_prompt_str()}"
    )

    default_plan = json.dumps({
        "reasoning": "Parse failed — default dispatch",
        "agents_to_run": list(registry.keys())[:2],
        "agent_configs": {
            name: {"depth": registry[name].default_depth, "focus": ""}
            for name in list(registry.keys())[:2]
        },
        "skip_deep_extraction": False,
        "reason_for_skip": "",
    })

    async with _GROQ_SEMAPHORE:
        raw = await loop.run_in_executor(
            None, _chat,
            system, user,
            "llama-3.3-70b-versatile", 1200, 0.1, True,
            default_plan,
        )

    await memory.increment("llm_calls")

    try:
        plan = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Supervisor JSON parse failed — running default agents")
        plan = json.loads(default_plan)

    # Validate: only run agents that exist in the registry
    plan["agents_to_run"] = [
        name for name in plan.get("agents_to_run", [])
        if name in registry
    ]

    await memory.add_reasoning(plan.get("reasoning", ""), "supervisor")
    logger.info(
        f"  [Supervisor] agents={plan.get('agents_to_run')} | "
        f"skip={plan.get('skip_deep_extraction')}"
    )
    return plan


# ═══════════════════════════════════════════════════════════════════════════════
# LAYER 1 — EXPLORATION AGENTS
# ═══════════════════════════════════════════════════════════════════════════════

_EXPLORATION_SYSTEM = """
You are a clinical graph exploration agent: {agent_name}.
Focus: {focus}

You receive:
  1. Incoming clinical entities from a new document (may be empty — use raw
     document text below in that case)
  2. A snapshot of the working memory (what other agents already found)
  3. Graph subgraph results retrieved from Neo4j for context
  4. Raw document text (when present) — extract findings directly from this

Your job (TWO steps):

STEP 1 — REASON:
Analyse the entities AND the raw document text (if provided).
Identify what is clinically significant in your focus area.
When the entity list is empty, derive everything from the raw document text.

STEP 2 — EXTRACT:
Extract graph primitives from your reasoning.

Return ONLY valid JSON:
{{
  "reasoning": "your clinical reasoning (2-3 sentences)",
  "needs_expansion": false,
  "expansion_query_hint": "what additional graph context would help (if needs_expansion=true)",
  "findings": {{
    "conditions":     [{{"name": "...", "confidence": 0.0, "supporting": ["..."]}}],
    "decision_chains": [
      {{
        "condition": "...", "decision": "...",
        "action_type": "investigation|medication|referral|procedure|monitoring|counselling",
        "rationale": "...", "urgency": "immediate|urgent|routine|elective",
        "probability": 0.0, "expected_outcome": "...",
        "contradicting_factors": ["..."]
      }}
    ],
    "contradictions":  [{{"entity": "...", "contradicts_decision": "...", "reason": "...", "severity": "critical|high|moderate|low"}}],
    "impact_flags":    [{{"flag_type": "CONTRAINDICATION|CRITICAL_VALUE|MISSING_TREATMENT|DRUG_INTERACTION|PROGRESSION", "description": "...", "severity": "critical|high|moderate|low", "entity_involved": "...", "decision_involved": "...", "recommendation": "..."}}],
    "high_risk_patterns": [{{"pattern": "...", "risk_level": "critical|high|moderate"}}]
  }}
}}

RULES:
- Only extract what you can justify from the data or the raw document.
- needs_expansion = true ONLY if a specific additional graph query would materially change your findings.
- Keep reasoning concise — this is a reasoning trace, not a report.
"""

_EXPLORATION_DEFAULT_JSON = json.dumps({
    "reasoning": "",
    "needs_expansion": False,
    "expansion_query_hint": "",
    "findings": {
        "conditions": [],
        "decision_chains": [],
        "contradictions": [],
        "impact_flags": [],
        "high_risk_patterns": [],
    },
})


async def _neo4j_exploration_query(
    session,
    doctor_id: str,
    labels: List[str],
    depth: int,
    memory: WorkingMemory,
) -> List[Dict]:
    """
    Recursive neighbourhood expansion.
    Budget-gated — returns empty list if total Neo4j queries are exhausted.
    """
    if memory.counter("neo4j_queries") >= MAX_NEO4J_QUERIES_TOTAL:
        logger.warning("  [Neo4j] Budget exhausted — skipping query")
        return []
    if not labels:
        return []

    await memory.increment("neo4j_queries")

    if depth == 1:
        result = await session.run(
            """
            MATCH (n:ClinicalNode {doctor_id: $did})
            WHERE any(lbl IN $labels WHERE toLower(n.label) CONTAINS toLower(lbl))
            MATCH (n)-[r:CLINICAL_EDGE {doctor_id: $did}]->(m:ClinicalNode)
            WHERE r.weight >= 0.4
            RETURN n.label AS from_label, n.node_type AS from_type,
                   r.relation AS relation, r.weight AS weight,
                   m.label AS to_label, m.node_type AS to_type
            ORDER BY r.weight DESC LIMIT 20
            """,
            did=doctor_id, labels=labels,
        )
    else:
        result = await session.run(
            """
            MATCH (n:ClinicalNode {doctor_id: $did})
            WHERE any(lbl IN $labels WHERE toLower(n.label) CONTAINS toLower(lbl))
            MATCH path = (n)-[r1:CLINICAL_EDGE {doctor_id: $did}]->
                         (m:ClinicalNode)-[r2:CLINICAL_EDGE {doctor_id: $did}]->
                         (o:ClinicalNode)
            WHERE r1.weight >= 0.4 AND r2.weight >= 0.4
            RETURN n.label AS hop0, r1.relation AS rel1, r1.weight AS w1,
                   m.label AS hop1, r2.relation AS rel2, r2.weight AS w2,
                   o.label AS hop2
            ORDER BY (r1.weight + r2.weight) DESC LIMIT 20
            """,
            did=doctor_id, labels=labels,
        )

    rows = await result.data()
    await memory.add_subgraph(rows)
    return rows


def _extract_focus_labels(
    defn: AgentDefinition,
    entities: List[dict],
    scout: ScoutBundle,
) -> List[str]:
    """
    Build the list of entity labels to pre-fetch from Neo4j for this agent.

    Uses the agent's declared entity_types (from AgentDefinition) rather
    than a hardcoded lookup table.  An empty entity_types tuple means the
    agent gets all entity names (useful for cross-cutting agents).
    """
    if not defn.entity_types:
        labels = [e["entity_name"] for e in entities]
    else:
        labels = [
            e["entity_name"] for e in entities
            if e.get("entity_type", "").lower() in defn.entity_types
        ]

    # Supplement decision/symptom-focused agents with conditions from scout
    # patterns — these are graph-derived, not hardcoded.
    if any(t in defn.entity_types for t in ("diagnosis", "condition", "icd", "finding")):
        labels += [p["condition"] for p in scout.existing_patterns[:5]]

    return list(dict.fromkeys(labels))[:15]   # deduplicate, preserve order


def _hint_to_labels(hint: str, entities: List[dict]) -> List[str]:
    """Extract query labels from an agent's expansion hint string."""
    all_names = [e["entity_name"] for e in entities]
    matched = [n for n in all_names if n.lower() in hint.lower()]
    return matched[:5] if matched else all_names[:5]


async def _run_exploration_agent(
    defn: AgentDefinition,
    config: Dict,
    entities: List[dict],
    doctor_id: str,
    scout: ScoutBundle,
    memory: WorkingMemory,
    raw_sections: Optional[str] = None,   # FIX 3: injected directly into prompt
) -> None:
    """
    One exploration agent — up to 2 LLM calls (initial + optional expansion).
    Writes results into WorkingMemory using the bucket names declared in defn.

    FIX 3: raw_sections is now passed through and injected directly into the
    LLM user prompt so that when entities=[] the agent can still extract
    findings from the raw document text.
    """
    depth = config.get("depth", defn.default_depth)
    focus = config.get("focus", "")
    loop  = asyncio.get_event_loop()

    focus_labels = _extract_focus_labels(defn, entities, scout)

    driver = await _get_neo4j()
    async with driver.session() as session:
        graph_rows = await _neo4j_exploration_query(
            session, doctor_id, focus_labels, depth, memory
        )

    graph_context_str = json.dumps(graph_rows[:15], indent=1) if graph_rows else "[]"

    # ── LLM budget guard ──────────────────────────────────────────────────────
    if memory.counter("llm_calls") >= MAX_LLM_CALLS_TOTAL - 2:
        logger.warning(f"  [{defn.name}] LLM budget near limit — skipping")
        return

    system = _EXPLORATION_SYSTEM.format(agent_name=defn.name, focus=focus)

    # FIX 3: inject raw_sections directly into the agent's prompt.
    # _raw_sections_block() truncates to 6000 chars safely.
    user = (
        f"=== INCOMING ENTITIES ===\n"
        f"{json.dumps(entities[:40], indent=1)}\n\n"
        f"=== WORKING MEMORY SNAPSHOT ===\n"
        f"{memory.to_synthesis_prompt()[:1500]}\n\n"
        f"=== RETRIEVED GRAPH SUBGRAPH (depth={depth}) ===\n"
        f"{graph_context_str}\n\n"
        f"=== SCOUT CONTEXT ===\n"
        f"{scout.to_prompt_str()}"
        f"{_raw_sections_block(raw_sections)}"
    )

    async with _GROQ_SEMAPHORE:
        raw = await loop.run_in_executor(
            None, _chat, system, user,
            "llama-3.3-70b-versatile", 1500, 0.1, True,
            _EXPLORATION_DEFAULT_JSON,
        )

    await memory.increment("llm_calls")

    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning(f"  [{defn.name}] JSON parse failed pass 1")
        return

    findings = result.get("findings", {})
    await memory.add_reasoning(result.get("reasoning", ""), defn.name)

    # Write each finding bucket using the generic WorkingMemory.add() API.
    # Bucket names come from AgentDefinition.output_buckets, not hardcoded here.
    bucket_map = {
        "conditions":         findings.get("conditions", []),
        "decision_chains":    findings.get("decision_chains", []),
        "contradictions":     findings.get("contradictions", []),
        "impact_flags":       findings.get("impact_flags", []),
        "high_risk_patterns": findings.get("high_risk_patterns", []),
    }
    for bucket_name in defn.output_buckets:
        items = bucket_map.get(bucket_name, [])
        if items:
            await memory.add(bucket_name, items, agent=defn.name)

    logger.info(
        f"  [{defn.name}] pass1 | "
        f"chains={len(findings.get('decision_chains', []))} | "
        f"contradictions={len(findings.get('contradictions', []))} | "
        f"flags={len(findings.get('impact_flags', []))}"
    )

    # ── Pass 2: Optional expansion ────────────────────────────────────────────
    if not result.get("needs_expansion", False):
        return
    if memory.counter("llm_calls") >= MAX_LLM_CALLS_TOTAL - 2:
        return
    if memory.counter("neo4j_queries") >= MAX_NEO4J_QUERIES_TOTAL:
        return

    hint = result.get("expansion_query_hint", "")
    expansion_labels = _hint_to_labels(hint, entities)

    async with driver.session() as session:
        expanded_rows = await _neo4j_exploration_query(
            session, doctor_id, expansion_labels, depth, memory
        )

    if not expanded_rows:
        return

    user2 = (
        f"=== EXPANSION RESULT for: {hint} ===\n"
        f"{json.dumps(expanded_rows[:12], indent=1)}\n\n"
        f"=== UPDATED WORKING MEMORY ===\n"
        f"{memory.to_synthesis_prompt()[:1200]}\n\n"
        f"You already found (pass 1): {json.dumps(findings, indent=1)[:600]}\n"
        f"What ADDITIONAL findings does the expansion reveal? "
        f"Return same JSON schema. Only add NEW findings — do not repeat pass 1 results."
    )

    async with _GROQ_SEMAPHORE:
        raw2 = await loop.run_in_executor(
            None, _chat, system, user2,
            "llama-3.3-70b-versatile", 1000, 0.1, True,
            _EXPLORATION_DEFAULT_JSON,
        )

    await memory.increment("llm_calls")

    try:
        f2 = json.loads(raw2).get("findings", {})
        for bucket_name in defn.output_buckets:
            items = {
                "conditions":         f2.get("conditions", []),
                "decision_chains":    f2.get("decision_chains", []),
                "contradictions":     f2.get("contradictions", []),
                "impact_flags":       f2.get("impact_flags", []),
                "high_risk_patterns": f2.get("high_risk_patterns", []),
            }.get(bucket_name, [])
            if items:
                await memory.add(bucket_name, items, agent=f"{defn.name}_expand")
        logger.info(
            f"  [{defn.name}] expand | "
            f"extra chains={len(f2.get('decision_chains', []))}"
        )
    except json.JSONDecodeError:
        logger.warning(f"  [{defn.name}] JSON parse failed pass 2")


# ═══════════════════════════════════════════════════════════════════════════════
# LAYER 2 — SYNTHESIS AGENT
# ═══════════════════════════════════════════════════════════════════════════════

_SYNTHESIS_SYSTEM = """
You are a clinical graph synthesis agent.

You receive a working memory containing findings from multiple exploration agents.
Your job: merge, deduplicate, and produce the FINAL graph primitives.

Return ONLY valid JSON matching this EXACT schema:
{
  "triples": [
    {
      "subject_type": "Finding|Condition|Abnormality|Decision|Outcome",
      "subject_label": "...", "subject_attrs": {},
      "relation": "HAS_FINDING|CAUSES|TRIGGERS_DECISION|LEADS_TO|CONTRADICTS|ASSOCIATED_WITH",
      "object_type": "Finding|Condition|Abnormality|Decision|Outcome",
      "object_label": "...", "object_attrs": {},
      "edge_weight": 0.0, "edge_confidence": 0.0,
      "reasoning": "one sentence"
    }
  ],
  "abnormalities": [
    {
      "entity_name": "...", "value": "...", "numeric_value": null,
      "unit": "...", "normal_range": "...",
      "direction": "LOW|HIGH|ABSENT|PRESENT|CHANGED",
      "clinical_significance": "critical|high|moderate|low",
      "explanation": "...", "decision_impacts": [], "contradicts_decisions": []
    }
  ],
  "decision_chains": [
    {
      "condition": "...", "supporting_findings": [],
      "decision": "...",
      "action_type": "investigation|medication|referral|procedure|monitoring|counselling",
      "rationale": "...", "urgency": "immediate|urgent|routine|elective",
      "probability": 0.0, "expected_outcome": "...", "contradicting_factors": []
    }
  ],
  "impact_flags": [
    {
      "flag_type": "CONTRAINDICATION|CRITICAL_VALUE|MISSING_TREATMENT|DRUG_INTERACTION|PROGRESSION",
      "description": "...", "severity": "critical|high|moderate|low",
      "entity_involved": "...", "decision_involved": "...", "recommendation": "..."
    }
  ]
}

RULES:
- Deduplicate near-identical entries (same condition + decision = one chain).
- Weight = highest probability from any contributing agent.
- critical flags must have a recommendation.
- Do NOT invent entities not present in the working memory.
"""

_SYNTHESIS_EMPTY = json.dumps({
    "triples": [], "abnormalities": [],
    "decision_chains": [], "impact_flags": [],
})


async def _run_synthesis_agent(
    memory: WorkingMemory,
    entities: List[dict],
    scout: ScoutBundle,
) -> Dict[str, Any]:
    """Single LLM call — produces final graph primitives from working memory."""
    loop = asyncio.get_event_loop()
    logger.info(
        f"  [Synthesis] starting | "
        f"llm_calls={memory.counter('llm_calls')} | "
        f"neo4j_queries={memory.counter('neo4j_queries')}"
    )

    user = (
        f"=== WORKING MEMORY ===\n"
        f"{memory.to_synthesis_prompt()}\n\n"
        f"=== ORIGINAL ENTITIES ({len(entities)}) ===\n"
        f"{json.dumps(entities[:30], indent=1)}\n\n"
        f"=== AGENT REASONING TRACES ===\n"
        + "\n".join(memory.reasoning_trace()[:10])
    )

    async with _GROQ_SEMAPHORE:
        raw = await loop.run_in_executor(
            None, _chat,
            _SYNTHESIS_SYSTEM, user,
            "llama-3.3-70b-versatile", 3000, 0.1, True,
            _SYNTHESIS_EMPTY,
        )

    await memory.increment("llm_calls")

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        logger.error("Synthesis JSON parse failed — returning empty")
        return json.loads(_SYNTHESIS_EMPTY)


# ═══════════════════════════════════════════════════════════════════════════════
# WEIGHT-UPDATE-ONLY PATH
# ═══════════════════════════════════════════════════════════════════════════════

_WEIGHT_UPDATE_SYSTEM = """
You are a clinical graph weight-update agent.
All entities in this document are ALREADY in the doctor's graph.
Your ONLY job: check if the new document reveals NEW contradictions or NEW flags
not already captured in the scout report.

Return ONLY valid JSON:
{
  "new_contradictions":    [{"entity": "...", "contradicts_decision": "...", "reason": "...", "severity": "..."}],
  "new_impact_flags":      [{"flag_type": "...", "description": "...", "severity": "...", "entity_involved": "...", "recommendation": "..."}],
  "weight_reinforcements": [{"condition": "...", "decision": "...", "delta": 0.0}]
}
"""

_WEIGHT_UPDATE_EMPTY = json.dumps({
    "new_contradictions": [], "new_impact_flags": [], "weight_reinforcements": [],
})


async def _run_weight_update_only(
    entities: List[dict],
    scout: ScoutBundle,
    memory: WorkingMemory,
    raw_sections: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Called when supervisor decides skip_deep_extraction=true.
    One lightweight LLM call to surface any new contradictions or flags only.
    """
    loop = asyncio.get_event_loop()

    user = (
        f"=== ENTITIES ===\n{json.dumps(entities[:30], indent=1)}\n\n"
        f"{scout.to_prompt_str()}"
        f"{_raw_sections_block(raw_sections)}"
    )

    async with _GROQ_SEMAPHORE:
        raw = await loop.run_in_executor(
            None, _chat,
            _WEIGHT_UPDATE_SYSTEM, user,
            "llama-3.3-70b-versatile", 600, 0.1, True,
            _WEIGHT_UPDATE_EMPTY,
        )

    await memory.increment("llm_calls")

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = json.loads(_WEIGHT_UPDATE_EMPTY)

    return {
        "triples": [], "abnormalities": [],
        "decision_chains": [],
        "impact_flags":              data.get("new_impact_flags", []),
        "_weight_reinforcements":    data.get("weight_reinforcements", []),
        "_new_contradictions":       data.get("new_contradictions", []),
    }


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN ENTRY POINT
# ═══════════════════════════════════════════════════════════════════════════════

async def run_agentic_graph_rag(
    doctor_id: str,
    entities: List[dict],
    source_doc: str = "document",
    patient_id: Optional[str] = None,
    extra_agents: Optional[List[AgentDefinition]] = None,
    raw_sections: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Full Agentic GraphRAG pipeline.
    Replaces run_graph_extraction_agents() in document_agents.py.
    Called by run_graph_pipeline() in pipeline.py.

    Parameters
    ----------
    doctor_id     : str
    entities      : list of entity dicts from the extraction step
    source_doc    : document identifier string
    patient_id    : optional patient identifier
    extra_agents  : optional list of AgentDefinition to add to the registry
                    for this run (e.g. specialty-specific agents injected by
                    the caller — no code changes needed here)
    raw_sections  : raw markdown/text from the document (used by run-direct path)

    Returns the same dict shape as run_graph_extraction_agents() so that
    merge_agent_outputs() and the rest of pipeline.py need zero changes.
    """
    registry = build_agent_registry(extra_agents)

    has_raw_sections = bool(raw_sections and raw_sections.strip())

    logger.info(
        f"🧠 Agentic GraphRAG | doctor={doctor_id} | "
        f"entities={len(entities)} | agents_available={list(registry)} | "
        f"has_raw_sections={has_raw_sections} | "
        f"budget: llm≤{MAX_LLM_CALLS_TOTAL} neo4j≤{MAX_NEO4J_QUERIES_TOTAL}"
    )

    # ── Step 0: Graph Scout (pure Neo4j, zero LLM) ───────────────────────────
    bundle = await GraphScout(doctor_id=doctor_id).scout(entities)
    memory = WorkingMemory(doctor_id=doctor_id, source_doc=source_doc)

    # Always store raw_sections in working memory so synthesis agent can read it
    if has_raw_sections:
        memory.register_bucket("raw_document_sections", description="Full raw document text")
        await memory.add(
            "raw_document_sections",
            [{"text": raw_sections[:8000]}],
            agent="document_ingestion",
        )

    # Pre-register the standard buckets with human-readable descriptions so
    # to_synthesis_prompt() headers are legible.  Agents can still write to
    # any name — these are just defaults.
    for name, desc in (
        ("conditions",         "Found conditions"),
        ("decision_chains",    "Decision chains"),
        ("contradictions",     "Contradictions"),
        ("impact_flags",       "Impact flags"),
        ("high_risk_patterns", "High-risk patterns"),
    ):
        memory.register_bucket(name, description=desc)

    # ── Step 1: Supervisor (1 LLM call) ──────────────────────────────────────
    plan = await _run_supervisor(
        entities, bundle, memory, registry,
        has_raw_sections=has_raw_sections,
    )

    # ── FIX 1: Safety override — never skip when novel entities exist ─────────
    if plan.get("skip_deep_extraction") and bundle.novel_entity_count > 0:
        logger.warning(
            f"  [Supervisor] skip_deep_extraction overridden — "
            f"{bundle.novel_entity_count} novel entities present"
        )
        plan["skip_deep_extraction"] = False
        if not plan.get("agents_to_run"):
            plan["agents_to_run"] = list(registry.keys())[:MAX_AGENTS_PER_RUN]
            plan["agent_configs"] = {
                name: {"depth": registry[name].default_depth, "focus": ""}
                for name in plan["agents_to_run"]
            }

    # ── FIX 2: Override skip when raw_sections present but entities empty ─────
    # This is the run-direct path: no pre-extracted entities, only raw markdown.
    # The supervisor may wrongly skip because entities=[] looks like "all known".
    if plan.get("skip_deep_extraction") and has_raw_sections and not entities:
        logger.warning(
            "  [Supervisor] skip_deep_extraction overridden — "
            "raw_sections present with empty entities (run-direct path)"
        )
        plan["skip_deep_extraction"] = False
        if not plan.get("agents_to_run"):
            plan["agents_to_run"] = list(registry.keys())[:MAX_AGENTS_PER_RUN]
            plan["agent_configs"] = {
                name: {
                    "depth": registry[name].default_depth,
                    "focus": "extract all clinical findings from the raw document text",
                }
                for name in plan["agents_to_run"]
            }

    # ── Step 2a: Weight-update-only path ─────────────────────────────────────
    if plan.get("skip_deep_extraction") and not plan.get("agents_to_run"):
        logger.info("  [Supervisor] skip_deep_extraction=true — weight-update path")
        raw_primitives = await _run_weight_update_only(entities, bundle, memory, raw_sections)
        return await _wrap_primitives(raw_primitives, doctor_id, patient_id, source_doc, memory)

    # ── Step 2b: Exploration agents (parallel, budget-gated) ─────────────────
    agents_to_run = plan.get("agents_to_run", [])[:MAX_AGENTS_PER_RUN]
    agent_configs = plan.get("agent_configs", {})

    if agents_to_run:
        await asyncio.gather(*[
            _run_exploration_agent(
                defn=registry[name],
                config=agent_configs.get(name, {}),
                entities=entities,
                doctor_id=doctor_id,
                scout=bundle,
                memory=memory,
                raw_sections=raw_sections,   # FIX 3: pass raw_sections to every agent
            )
            for name in agents_to_run
            if name in registry
        ])

    logger.info(
        f"  [Exploration done] "
        f"llm_calls={memory.counter('llm_calls')} | "
        f"neo4j_queries={memory.counter('neo4j_queries')} | "
        f"memory={memory.summary()['buckets']}"
    )

    # ── Step 3: Synthesis agent (1 LLM call) ─────────────────────────────────
    # FIX 1 (CRITICAL): was wrongly calling _run_weight_update_only here,
    # which always returns empty triples/chains/abnormalities.
    # Must call _run_synthesis_agent to produce actual graph primitives.
    raw_primitives = await _run_synthesis_agent(memory, entities, bundle)

    logger.info(
        f"✅ Agentic GraphRAG complete | "
        f"triples={len(raw_primitives.get('triples', []))} | "
        f"chains={len(raw_primitives.get('decision_chains', []))} | "
        f"flags={len(raw_primitives.get('impact_flags', []))} | "
        f"total_llm={memory.counter('llm_calls')} | "
        f"total_neo4j={memory.counter('neo4j_queries')}"
    )

    return await _wrap_primitives(raw_primitives, doctor_id, patient_id, source_doc, memory)


async def _wrap_primitives(
    raw: Dict,
    doctor_id: str,
    patient_id: Optional[str],
    source_doc: str,
    memory: WorkingMemory,
) -> Dict[str, Any]:
    """
    Convert synthesis output into the dict shape merge_agent_outputs() expects
    so pipeline.py needs zero changes.
    """
    synthetic_output = AgentGraphOutput(
        agent_name="Agentic GraphRAG — Synthesis",
        dimension="Full clinical extraction",
        confidence=0.88,
        triples=_build_triples(raw.get("triples", []), source_doc),
        abnormalities=_build_abnormalities(raw.get("abnormalities", [])),
        decision_chains=_build_doc_decision_chains(raw.get("decision_chains", [])),
        impact_flags=_build_impact_flags(raw.get("impact_flags", [])),
        agent_reasoning="\n".join(memory.reasoning_trace()),
    )

    merged = await merge_agent_outputs(
        agent_outputs=[synthetic_output],
        doctor_id=doctor_id,
        source_doc=source_doc,
        patient_id=patient_id,
    )
    merged["_weight_reinforcements"] = raw.get("_weight_reinforcements", [])
    merged["_new_contradictions"]    = raw.get("_new_contradictions", [])
    return merged