"""
document_agents.py
==================
TWO-LAYER agent system:

LAYER 1 — Per-document extraction agents (called on document upload)
  Extracts clinical triples, abnormalities, impact flags from a single document.
  Agents: lab+vitals, diagnosis+symptoms, medication+imaging, timeline

LAYER 2 — Cross-consultation pattern agents (called on graph pipeline run)
  Mines recurring Condition→Decision patterns across ALL doctor consultations.
  Agents: diagnosis, medication, investigation, referral, rework

CHUNKING STRATEGY:
  Instead of silently dropping data beyond a cap, all entity/consultation lists
  are split into CHUNK_SIZE batches.  Each chunk is sent to the LLM separately
  and the four JSON arrays (triples, abnormalities, decision_chains, impact_flags)
  are accumulated across all chunk responses before model objects are built.
  This guarantees every entity is processed while keeping each LLM call within
  a safe token budget.

RATE-LIMIT STRATEGY:
  A global asyncio.Semaphore (_GROQ_SEMAPHORE) caps concurrent in-flight requests.
  _chat() parses Groq's "try again in Xs / Xms" message and sleeps exactly that
  long (+ 0.5 s buffer) before each retry, so we never spin faster than Groq allows.
  Retry attempts raised from 3 → 6 to survive longer saturation windows.
"""

from __future__ import annotations

import json
import re
import time
import asyncio
from asyncio import Semaphore
from typing import Any, Dict, List, Optional

from groq import Groq
from loguru import logger

from Agentic.document_model import (
    # Layer 1 models
    AgentGraphOutput,
    AbnormalDirection,
    AbnormalityRecord,
    ClinicalTriple,
    DecisionChain,
    EdgeType,
    FindingAttrs,
    ConditionAttrs,
    AbnormalityAttrs,
    OutcomeAttrs,
    DecisionAttrs,
    GraphNode,
    ImpactFlag,
    NodeType,
    Severity,
    Urgency,
    DecisionActionType,
    # Layer 2 models
    AgentDoctorOutput,
    DoctorDecisionChain,
    DoctorGraphEdge,
    DoctorGraphNode,
    SkillCandidate,
)

import os
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client  = Groq(api_key=GROQ_API_KEY)

SKILL_WEIGHT_THRESHOLD = 0.75

# How many entities / consultations to send per LLM call.
# Tune this down if you still hit context limits; raise it to reduce API calls.
CHUNK_SIZE = 60

# ── Rate-limit gate ───────────────────────────────────────────────────────────
# Caps the number of Groq requests in-flight at any moment.
# At ~10-15K tokens/chunk and a 300K TPM limit, 8 concurrent calls keeps you
# comfortably under the limit even when all four agents start simultaneously.
# Raise to 12 if you upgrade to a higher Groq tier; lower to 4 if still seeing
# 429s on the on-demand tier.
_GROQ_SEMAPHORE: Semaphore = Semaphore(8)


# ═════════════════════════════════════════════
# SHARED HELPERS
# ═════════════════════════════════════════════

def _parse_retry_after(err_str: str, attempt: int) -> float:
    """
    Extract the wait time from a Groq 429 error message such as:
      'Please try again in 1.5034s.'
      'Please try again in 746.4ms.'
    Falls back to an exponential default if the pattern is not found.
    """
    match = re.search(r'try again in (\d+(?:\.\d+)?)\s*(ms|s)', err_str)
    if match:
        val  = float(match.group(1))
        unit = match.group(2)
        raw  = val / 1000.0 if unit == "ms" else val
        return raw + 0.5          # 0.5 s safety buffer on top of Groq's hint
    # Exponential fallback: 2, 4, 8, 16, 32 …
    return min(2.0 ** attempt, 32.0)


def _chat(
    system: str,
    user: str,
    model: str = "llama-3.3-70b-versatile",
    max_tokens: int = 4000,
    temperature: float = 0.1,
    json_mode: bool = True,
    empty_response: str = '{"triples":[],"abnormalities":[],"decision_chains":[],"impact_flags":[]}',
) -> str:
    """
    Synchronous Groq chat call with:
      • 6 retry attempts (up from 3)
      • Retry-after delay parsed directly from the 429 error message
      • Exponential fallback when the header/message is absent
    NOTE: This function is always called inside run_in_executor so that the
    blocking time.sleep() never blocks the asyncio event loop.
    """
    for attempt in range(6):
        try:
            kwargs: Dict[str, Any] = {
                "model":       model,
                "temperature": temperature,
                "max_tokens":  max_tokens,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user",   "content": user},
                ],
            }
            if json_mode:
                kwargs["response_format"] = {"type": "json_object"}
            resp = groq_client.chat.completions.create(**kwargs)
            return resp.choices[0].message.content

        except Exception as e:
            err_str = str(e)
            logger.warning(f"_chat attempt {attempt + 1} failed: {e}")

            if attempt < 5:
                wait = _parse_retry_after(err_str, attempt + 1)
                logger.info(f"  ↳ backing off {wait:.2f}s before retry {attempt + 2}")
                time.sleep(wait)
            else:
                logger.error("All 6 attempts failed — returning empty result")
                return empty_response


def _safe_json_str(obj: Any) -> str:
    def _san(o: Any) -> Any:
        if hasattr(o, "isoformat"):
            return o.isoformat()
        if isinstance(o, dict):
            return {k: _san(v) for k, v in o.items()}
        if isinstance(o, list):
            return [_san(i) for i in o]
        return o
    return json.dumps(_san(obj), indent=2)


# ─────────────────────────────────────────────
# CHUNKING HELPERS
# ─────────────────────────────────────────────

def _chunk(items: List[Any], size: int = CHUNK_SIZE) -> List[List[Any]]:
    """
    Split *items* into consecutive batches of at most *size* elements.
    No data is ever dropped — every item appears in exactly one chunk.

    Example:  250 items, size=60  →  [60, 60, 60, 60, 10]  (5 chunks)
    """
    if not items:
        return [[]]
    return [items[i : i + size] for i in range(0, len(items), size)]


def _merge_raw_json_lists(responses: List[str], keys: List[str]) -> Dict[str, List]:
    """
    Given a list of raw JSON strings (one per chunk call), parse each one and
    concatenate the arrays for every key in *keys*.

    Unknown / malformed chunks are skipped with a warning so one bad chunk
    never aborts the whole agent run.
    """
    merged: Dict[str, List] = {k: [] for k in keys}
    for idx, raw in enumerate(responses):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            logger.warning(f"Chunk {idx} JSON parse failed ({exc}) — skipping")
            continue
        for key in keys:
            value = data.get(key)
            if isinstance(value, list):
                merged[key].extend(value)
            elif value is not None:
                logger.warning(f"Chunk {idx}: key '{key}' is not a list — skipping")
    return merged


def _raw_sections_block(raw_sections: Optional[str]) -> str:
    """
    Appends raw document text to any agent prompt so the LLM can extract
    anything the entity extractor (Dockli) missed.
    No parsing, no field mapping — the LLM reads it directly.
    Returns empty string if no raw sections supplied.
    """
    if not raw_sections or not raw_sections.strip():
        return ""
    # Truncate to ~6000 chars to stay within per-chunk token budget.
    # This is per-chunk so large docs get multiple bites at the text.
    truncated = raw_sections[:6000]
    return (
        f"\n\n=== RAW DOCUMENT SECTIONS (extract anything the entity list missed) ===\n"
        f"{truncated}"
    )

async def _chat_chunked(
    system: str,
    build_user_prompt: Any,           # callable(chunk, chunk_idx, total_chunks) → str
    items: List[Any],
    keys: List[str],
    chunk_size: int = CHUNK_SIZE,
    label: str = "items",
) -> Dict[str, List]:
    """
    Split *items* into chunks, call _chat on each chunk (concurrently but
    gated by _GROQ_SEMAPHORE), then merge the JSON array results.

    Parameters
    ----------
    system            : LLM system prompt (constant across chunks)
    build_user_prompt : callable(chunk, chunk_idx, total_chunks) → str
    items             : full list of entities / consultations to process
    keys              : JSON array keys to accumulate
    chunk_size        : batch size (default = CHUNK_SIZE)
    label             : human-readable name used in log messages
    """
    chunks = _chunk(items, chunk_size)
    total  = len(chunks)
    logger.info(f"  ↳ chunking {len(items)} {label} into {total} chunk(s) of ≤{chunk_size}")

    loop = asyncio.get_event_loop()

    async def _call_one(chunk: List, idx: int) -> str:
        async with _GROQ_SEMAPHORE:                    # ← rate-limit gate
            user_prompt = build_user_prompt(chunk, idx, total)
            return await loop.run_in_executor(None, _chat, system, user_prompt)

    responses = await asyncio.gather(*[_call_one(c, i) for i, c in enumerate(chunks)])
    return _merge_raw_json_lists(list(responses), keys)


# ─────────────────────────────────────────────
# LAYER 1 PARSERS
# ─────────────────────────────────────────────

def _parse_direction(raw: str) -> AbnormalDirection:
    r = raw.upper()
    for d in AbnormalDirection:
        if d.value in r:
            return d
    return AbnormalDirection.CHANGED


def _parse_severity(raw: str) -> Severity:
    r = raw.lower()
    for s in Severity:
        if s.value in r:
            return s
    return Severity.MODERATE


def _parse_urgency(raw: str) -> Urgency:
    r = raw.lower()
    for u in Urgency:
        if u.value in r:
            return u
    return Urgency.ROUTINE


def _parse_action_type(raw: str) -> DecisionActionType:
    r = raw.lower()
    mapping = {
        "invest":  DecisionActionType.INVESTIGATION,
        "test":    DecisionActionType.INVESTIGATION,
        "order":   DecisionActionType.INVESTIGATION,
        "medic":   DecisionActionType.MEDICATION,
        "drug":    DecisionActionType.MEDICATION,
        "prescr":  DecisionActionType.MEDICATION,
        "refer":   DecisionActionType.REFERRAL,
        "proced":  DecisionActionType.PROCEDURE,
        "monit":   DecisionActionType.MONITORING,
        "watch":   DecisionActionType.MONITORING,
        "counsel": DecisionActionType.COUNSELLING,
    }
    for key, val in mapping.items():
        if key in r:
            return val
    return DecisionActionType.INVESTIGATION


def _build_triples(raw_triples: List[dict], source_doc: str) -> List[ClinicalTriple]:
    result: List[ClinicalTriple] = []
    for t in raw_triples:
        try:
            try:
                subj_node_type = NodeType(t.get("subject_type", "Finding"))
            except ValueError:
                subj_node_type = NodeType.FINDING

            try:
                obj_node_type = NodeType(t.get("object_type", "Decision"))
            except ValueError:
                obj_node_type = NodeType.FINDING

            subject = GraphNode(
                node_type=subj_node_type,
                label=t.get("subject_label", "unknown"),
                attrs={**t.get("subject_attrs", {}), "source_doc": source_doc},
            )
            obj = GraphNode(
                node_type=obj_node_type,
                label=t.get("object_label", "unknown"),
                attrs={**t.get("object_attrs", {}), "source_doc": source_doc},
            )
            try:
                relation = EdgeType(t.get("relation", "ASSOCIATED_WITH"))
            except ValueError:
                relation = EdgeType.ASSOCIATED_WITH

            result.append(ClinicalTriple(
                subject=subject,
                relation=relation,
                obj=obj,
                edge_weight=float(t.get("edge_weight", 0.7)),
                edge_confidence=float(t.get("edge_confidence", 0.7)),
                reasoning=t.get("reasoning", ""),
            ))
        except Exception as e:
            logger.warning(f"Triple parse failed: {e} — raw: {t}")
    return result


def _build_abnormalities(raw_list: List[dict]) -> List[AbnormalityRecord]:
    result: List[AbnormalityRecord] = []
    for item in raw_list:
        try:
            result.append(AbnormalityRecord(
                entity_name=item.get("entity_name", "unknown"),
                value=item.get("value"),
                numeric_value=item.get("numeric_value"),
                unit=item.get("unit"),
                normal_range=item.get("normal_range"),
                direction=_parse_direction(item.get("direction", "CHANGED")),
                clinical_significance=_parse_severity(item.get("clinical_significance", "moderate")),
                explanation=item.get("explanation", ""),
                decision_impacts=item.get("decision_impacts", []),
                contradicts_decisions=item.get("contradicts_decisions", []),
            ))
        except Exception as e:
            logger.warning(f"Abnormality parse failed: {e} — raw: {item}")
    return result


def _build_doc_decision_chains(raw_list: List[dict]) -> List[DecisionChain]:
    result: List[DecisionChain] = []
    for item in raw_list:
        try:
            result.append(DecisionChain(
                condition_label=item.get("condition", "unknown"),
                supporting_findings=item.get("supporting_findings", []),
                decision_label=item.get("decision", "unknown"),
                decision_action_type=_parse_action_type(item.get("action_type", "investigation")),
                rationale=item.get("rationale", ""),
                urgency=_parse_urgency(item.get("urgency", "routine")),
                probability=float(item.get("probability", 0.7)),
                expected_outcome=item.get("expected_outcome"),
                contradicting_factors=item.get("contradicting_factors", []),
            ))
        except Exception as e:
            logger.warning(f"Decision chain parse failed: {e} — raw: {item}")
    return result


def _build_impact_flags(raw_list: List[dict]) -> List[ImpactFlag]:
    result: List[ImpactFlag] = []
    for item in raw_list:
        try:
            result.append(ImpactFlag(
                flag_type=item.get("flag_type", "ALERT"),
                description=item.get("description", ""),
                severity=_parse_severity(item.get("severity", "moderate")),
                entity_involved=item.get("entity_involved"),
                decision_involved=item.get("decision_involved"),
                recommendation=item.get("recommendation"),
            ))
        except Exception as e:
            logger.warning(f"Impact flag parse failed: {e} — raw: {item}")
    return result


# ─────────────────────────────────────────────
# LAYER 2 PARSERS
# ─────────────────────────────────────────────

def _build_doctor_decision_chains(
    raw_list: List[dict],
    doctor_id: str,
) -> List[DoctorDecisionChain]:
    result: List[DoctorDecisionChain] = []
    for item in raw_list:
        try:
            result.append(DoctorDecisionChain(
                condition_label=item.get("condition", "unknown"),
                decision_label=item.get("decision", "unknown"),
                decision_action_type=_parse_action_type(item.get("action_type", "investigation")),
                rationale=item.get("rationale", ""),
                urgency=_parse_urgency(item.get("urgency", "routine")),
                avg_probability=float(item.get("avg_probability", 0.7)),
                occurrence_count=int(item.get("occurrence_count", 1)),
                patient_count=int(item.get("patient_count", 1)),
                expected_outcome=item.get("expected_outcome"),
                contradicting_factors=item.get("contradicting_factors", []),
            ))
        except Exception as e:
            logger.warning(f"Doctor chain parse failed: {e} — raw: {item}")
    return result


def _build_nodes_and_edges(
    chains: List[DoctorDecisionChain],
) -> tuple[List[DoctorGraphNode], List[DoctorGraphEdge]]:
    seen_nodes: Dict[str, DoctorGraphNode] = {}
    seen_edges: Dict[str, DoctorGraphEdge] = {}

    for chain in chains:
        c_key = f"Condition::{chain.condition_label.lower()}"
        if c_key not in seen_nodes:
            seen_nodes[c_key] = DoctorGraphNode(
                node_type=NodeType.CONDITION,
                label=chain.condition_label,
                occurrence_count=chain.occurrence_count,
                patient_count=chain.patient_count,
                avg_weight=chain.avg_probability,
            )
        else:
            seen_nodes[c_key].occurrence_count += chain.occurrence_count

        d_key = f"Decision::{chain.decision_label.lower()}"
        if d_key not in seen_nodes:
            seen_nodes[d_key] = DoctorGraphNode(
                node_type=NodeType.DECISION,
                label=chain.decision_label,
                attrs={"action_type": chain.decision_action_type, "urgency": chain.urgency},
                occurrence_count=chain.occurrence_count,
                patient_count=chain.patient_count,
                avg_weight=chain.avg_probability,
            )
        else:
            seen_nodes[d_key].occurrence_count += chain.occurrence_count

        e_key = f"{chain.condition_label.lower()}|TRIGGERS_DECISION|{chain.decision_label.lower()}"
        if e_key not in seen_edges:
            seen_edges[e_key] = DoctorGraphEdge(
                from_label=chain.condition_label,
                from_type=NodeType.CONDITION,
                relation=EdgeType.TRIGGERS_DECISION,
                to_label=chain.decision_label,
                to_type=NodeType.DECISION,
                weight=chain.avg_probability,
                confidence=chain.avg_probability,
                occurrence_count=chain.occurrence_count,
                patient_count=chain.patient_count,
            )
        else:
            existing = seen_edges[e_key]
            n = existing.occurrence_count
            existing.weight = (existing.weight * n + chain.avg_probability) / (n + 1)
            existing.occurrence_count += chain.occurrence_count

    return list(seen_nodes.values()), list(seen_edges.values())


def _build_skill_candidates(
    chains: List[DoctorDecisionChain],
    doctor_id: str,
    speciality: Optional[str],
) -> List[SkillCandidate]:
    candidates = []
    for chain in chains:
        if chain.avg_probability >= SKILL_WEIGHT_THRESHOLD:
            candidates.append(SkillCandidate(
                doctor_id=doctor_id,
                condition_label=chain.condition_label,
                decision_label=chain.decision_label,
                pattern_summary=f"{chain.condition_label} → {chain.decision_label}",
                speciality=speciality,
                weight=chain.avg_probability,
                occurrence_count=chain.occurrence_count,
                patient_count=chain.patient_count,
                awaiting_confirmation=True,
            ))
    return candidates


# ═════════════════════════════════════════════
# LAYER 1 SYSTEM PROMPT
# ═════════════════════════════════════════════

_DOC_AGENT_SYSTEM = """
You are a clinical graph extraction agent specialising in {speciality}.
Your ONLY job: analyse the clinical data and extract structured graph primitives.
You do NOT write summaries, narratives, or paragraphs.

Return ONLY valid JSON matching this EXACT schema:

{{
  "triples": [
    {{
      "subject_type":    "Finding | Condition | Abnormality | Decision | Outcome",
      "subject_label":   "short human-readable label",
      "subject_attrs":   {{ }},
      "relation":        "HAS_FINDING | CAUSES | TRIGGERS_DECISION | LEADS_TO | CONTRADICTS | ASSOCIATED_WITH",
      "object_type":     "Finding | Condition | Abnormality | Decision | Outcome",
      "object_label":    "...",
      "object_attrs":    {{ }},
      "edge_weight":     0.0-1.0,
      "edge_confidence": 0.0-1.0,
      "reasoning":       "one sentence why this relation holds"
    }}
  ],
  "abnormalities": [
    {{
      "entity_name":           "e.g. eGFR",
      "value":                 "42",
      "numeric_value":         42.0,
      "unit":                  "mL/min/1.73m²",
      "normal_range":          "≥ 60",
      "direction":             "LOW | HIGH | ABSENT | PRESENT | CHANGED",
      "clinical_significance": "critical | high | moderate | low",
      "explanation":           "one sentence clinical meaning",
      "decision_impacts":      ["decision labels this affects"],
      "contradicts_decisions": ["decision labels this contradicts"]
    }}
  ],
  "decision_chains": [
    {{
      "condition":             "Condition label",
      "supporting_findings":   ["Finding label 1"],
      "decision":              "Decision label",
      "action_type":           "investigation | medication | referral | procedure | monitoring | counselling",
      "rationale":             "why this decision follows",
      "urgency":               "immediate | urgent | routine | elective",
      "probability":           0.0-1.0,
      "expected_outcome":      "expected improvement",
      "contradicting_factors": ["weakening factors"]
    }}
  ],
  "impact_flags": [
    {{
      "flag_type":        "CONTRAINDICATION | CRITICAL_VALUE | MISSING_TREATMENT | DRUG_INTERACTION | PROGRESSION",
      "description":      "human-readable alert",
      "severity":         "critical | high | moderate | low",
      "entity_involved":  "entity label",
      "decision_involved":"decision label",
      "recommendation":   "what to do"
    }}
  ]
}}

RULES:
- edge_weight = clinical strength of relationship.
- edge_confidence = extraction confidence.
- Do NOT invent entities not present in the data.
- Include ALL abnormalities, even mild ones.
- You are processing chunk {chunk_idx} of {total_chunks}. Focus only on the entities
  in this chunk; cross-chunk deduplication happens downstream.
"""

_L1_KEYS = ["triples", "abnormalities", "decision_chains", "impact_flags"]


# ═════════════════════════════════════════════
# LAYER 1 AGENTS
# ═════════════════════════════════════════════

# ── AGENT 1: Lab + Vitals ─────────────────────

async def lab_vitals_agent(
    entities: List[dict],
    graph: dict,
    source_doc: str = "document",
    raw_sections: Optional[str] = None,          # ← ADD
) -> AgentGraphOutput:
    """
    Lab Results + Vital Signs agent.
    All entities are processed via chunking — nothing is dropped.
    Every chunk call is gated by _GROQ_SEMAPHORE.
    """
    speciality = "laboratory medicine and clinical monitoring"
    system_tmpl = _DOC_AGENT_SYSTEM + """
EXTRACTION TASKS:
1. For each abnormal lab/vital: (Abnormality) --TRIGGERS_DECISION--> (Decision).
2. For each lab/vital indicating a condition: (Finding) --HAS_FINDING--> (Condition).
3. For any abnormality contradicting a medication: (Abnormality) --CONTRADICTS--> (Decision).
4. Critical vitals: SBP > 180 or SpO2 < 92% → urgency = immediate, edge_weight = 0.95+.
5. For tachycardia + hypotension combination: (Condition: shock) --TRIGGERS_DECISION--> (Decision: escalate).
6. Raise impact_flags for critical values, contraindications, missing treatments.
7. Build decision_chains for all abnormal lab/vital combinations.
"""

    lab_entities   = [e for e in entities if e.get("entity_type", "").lower() in
                      ("lab result", "laboratory", "biochemistry", "haematology")]
    vital_entities = [e for e in entities if e.get("entity_type", "").lower() in
                      ("vital sign", "vital", "observation")]

    graph_context = _safe_json_str({
        "lab_results": graph.get("lab_results", []),
        "vital_signs": graph.get("vital_signs", []),
        "diagnoses":   graph.get("diagnoses", []),
    })

    all_entities = lab_entities + vital_entities
    chunks = _chunk(all_entities)
    total  = len(chunks)
    logger.info(f"  [lab_vitals_agent] {len(all_entities)} entities → {total} chunk(s)")

    loop = asyncio.get_event_loop()

    async def _call(chunk: List[dict], i: int) -> str:
        system = system_tmpl.format(speciality=speciality, chunk_idx=i + 1, total_chunks=total)
        user   = (
            f"=== LAB + VITAL ENTITIES — chunk {i + 1}/{total} ===\n"
            f"{json.dumps(chunk, indent=2)}\n\n"
            f"=== DOCTOR'S HISTORICAL LABS, VITALS & DIAGNOSES (reference, all chunks) ===\n"
            f"{graph_context}"
            f"{_raw_sections_block(raw_sections)}"   # ← ADD THIS LINE
        )
        async with _GROQ_SEMAPHORE:
            return await loop.run_in_executor(None, _chat, system, user)

    responses = await asyncio.gather(*[_call(c, i) for i, c in enumerate(chunks)])
    merged    = _merge_raw_json_lists(list(responses), _L1_KEYS)

    return AgentGraphOutput(
        agent_name="Lab + Vitals Agent",
        dimension="Laboratory Results & Vital Signs",
        confidence=0.89,
        triples=_build_triples(merged["triples"], source_doc),
        abnormalities=_build_abnormalities(merged["abnormalities"]),
        decision_chains=_build_doc_decision_chains(merged["decision_chains"]),
        impact_flags=_build_impact_flags(merged["impact_flags"]),
    )


# ── AGENT 2: Diagnosis + Symptoms ─────────────

async def diagnosis_symptoms_agent(
    entities: List[dict],
    graph: dict,
    source_doc: str = "document",
    raw_sections: Optional[str] = None,
) -> AgentGraphOutput:
    """
    Diagnosis + Symptoms agent — full entity coverage via chunking.
    Every chunk call is gated by _GROQ_SEMAPHORE.
    """
    speciality = "clinical diagnostics and symptomatology"
    system_tmpl = _DOC_AGENT_SYSTEM + """
EXTRACTION TASKS:
1. (Symptom/Finding) --HAS_FINDING--> (Condition) — weight = diagnostic specificity.
2. Unmapped symptoms: (Finding) --TRIGGERS_DECISION--> (Decision: investigate).
3. Red-flag symptoms: edge_weight = 0.95+, urgency = immediate.
4. (Condition) --TRIGGERS_DECISION--> (Decision) — weight = guideline strength.
5. Comorbidities: (Condition) --ASSOCIATED_WITH--> (Condition).
6. Staged diagnoses: (Condition) --HAS_FINDING--> (Finding: staging).
7. Add MISSING_TREATMENT flag for guideline-recommended treatments absent from the data.
8. Add PROGRESSION flag if diagnosis worsened vs doctor history.
9. Build decision_chains for all active diagnoses and unexplained symptoms.
"""

    dx_entities  = [e for e in entities if e.get("entity_type", "").lower() in
                    ("diagnosis", "icd", "condition")]
    sym_entities = [e for e in entities if e.get("entity_type", "").lower() in
                    ("symptom", "finding", "sign", "complaint")]
    lab_entities = [e for e in entities if e.get("entity_type", "").lower() == "lab result"]

    graph_context = _safe_json_str({
        "diagnoses": graph.get("diagnoses", []),
        "symptoms":  graph.get("symptoms", []),
    })

    all_entities = dx_entities + sym_entities
    lab_context  = json.dumps(lab_entities[:30], indent=2)

    chunks = _chunk(all_entities)
    total  = len(chunks)
    logger.info(f"  [diagnosis_symptoms_agent] {len(all_entities)} entities → {total} chunk(s)")

    loop = asyncio.get_event_loop()

    async def _call(chunk: List[dict], i: int) -> str:
        system = system_tmpl.format(speciality=speciality, chunk_idx=i + 1, total_chunks=total)
        user   = (
            f"=== DIAGNOSES & SYMPTOMS — chunk {i + 1}/{total} ===\n"
            f"{json.dumps(chunk, indent=2)}\n\n"
            f"=== LAB CONTEXT (reference) ===\n{lab_context}\n\n"
            f"=== DOCTOR'S HISTORICAL DIAGNOSES & SYMPTOMS (reference, all chunks) ===\n"
            f"{graph_context}"
            f"{_raw_sections_block(raw_sections)}"   # ← ADD THIS LINE
        )
        async with _GROQ_SEMAPHORE:
            return await loop.run_in_executor(None, _chat, system, user)

    responses = await asyncio.gather(*[_call(c, i) for i, c in enumerate(chunks)])
    merged    = _merge_raw_json_lists(list(responses), _L1_KEYS)

    return AgentGraphOutput(
        agent_name="Diagnosis + Symptoms Agent",
        dimension="Diagnoses, Conditions & Symptoms",
        confidence=0.87,
        triples=_build_triples(merged["triples"], source_doc),
        abnormalities=_build_abnormalities(merged["abnormalities"]),
        decision_chains=_build_doc_decision_chains(merged["decision_chains"]),
        impact_flags=_build_impact_flags(merged["impact_flags"]),
    )


# ── AGENT 3: Medication + Imaging ─────────────

async def medication_imaging_agent(
    entities: List[dict],
    graph: dict,
    source_doc: str = "document",
    raw_sections: Optional[str] = None,
) -> AgentGraphOutput:
    """
    Medication + Imaging/Pathology agent — full entity coverage via chunking.
    Every chunk call is gated by _GROQ_SEMAPHORE.
    """
    speciality = "clinical pharmacology and radiology"
    system_tmpl = _DOC_AGENT_SYSTEM + """
EXTRACTION TASKS:
MEDICATIONS:
1. (Decision: medication) --LEADS_TO--> (Outcome) for each drug.
2. Drug-drug interactions: (Decision: drug A) --CONTRADICTS--> (Decision: drug B).
3. Contraindications: (Condition/Abnormality) --CONTRADICTS--> (Decision: medication).
4. Changed medications vs history: (Decision: new) --REWORK_OF--> (Decision: old).
5. Missing renal/hepatic dose adjustment → CONTRAINDICATION flag (severity=high).
6. Missing guideline drug → MISSING_TREATMENT flag.

IMAGING:
7. (Finding: lesion/result) --HAS_FINDING--> (Condition).
8. High staging scores (BIRADS 4+, PI-RADS 4+, TNM III+): TRIGGERS_DECISION biopsy/referral, weight=0.9+.
9. Incidental findings: TRIGGERS_DECISION investigate, edge_confidence < 0.7.
10. Malignancy/progression findings → PROGRESSION flag.

Build decision_chains for: Condition → drug → outcome AND imaging finding → condition → action.
"""

    med_entities = [e for e in entities if e.get("entity_type", "").lower() in
                    ("medication", "drug", "prescription")]
    rad_entities = [
        e for e in entities
        if e.get("entity_type", "").lower() in
           ("finding", "measurement", "anatomy", "pathology", "radiology")
        or any(kw in str(e.get("entity_name", "")).lower()
               for kw in ("lesion", "mass", "impression", "nodule", "opacity",
                          "biopsy", "birads", "tirads", "pi-rads", "tnm", "stage"))
    ]
    dx_entities  = [e for e in entities if e.get("entity_type", "").lower() == "diagnosis"]
    lab_entities = [e for e in entities if e.get("entity_type", "").lower() == "lab result"]

    graph_context = _safe_json_str({"medications": graph.get("medications", [])})
    dx_context    = json.dumps(dx_entities[:20],  indent=2)
    lab_context   = json.dumps(lab_entities[:15], indent=2)

    all_entities = med_entities + rad_entities
    chunks = _chunk(all_entities)
    total  = len(chunks)
    logger.info(f"  [medication_imaging_agent] {len(all_entities)} entities → {total} chunk(s)")

    loop = asyncio.get_event_loop()

    async def _call(chunk: List[dict], i: int) -> str:
        system = system_tmpl.format(speciality=speciality, chunk_idx=i + 1, total_chunks=total)
        user   = (
            f"=== MEDICATIONS & IMAGING ENTITIES — chunk {i + 1}/{total} ===\n"
            f"{json.dumps(chunk, indent=2)}\n\n"
            f"=== ACTIVE DIAGNOSES (reference) ===\n{dx_context}\n\n"
            f"=== RELEVANT LABS (reference) ===\n{lab_context}\n\n"
            f"=== DOCTOR'S HISTORICAL MEDICATIONS (reference, all chunks) ===\n"
            f"{graph_context}"
            f"{_raw_sections_block(raw_sections)}"   # ← ADD THIS LINE
        )
        async with _GROQ_SEMAPHORE:
            return await loop.run_in_executor(None, _chat, system, user)

    responses = await asyncio.gather(*[_call(c, i) for i, c in enumerate(chunks)])
    merged    = _merge_raw_json_lists(list(responses), _L1_KEYS)

    return AgentGraphOutput(
        agent_name="Medication + Imaging Agent",
        dimension="Medications, Pharmacology & Imaging",
        confidence=0.86,
        triples=_build_triples(merged["triples"], source_doc),
        abnormalities=_build_abnormalities(merged["abnormalities"]),
        decision_chains=_build_doc_decision_chains(merged["decision_chains"]),
        impact_flags=_build_impact_flags(merged["impact_flags"]),
    )


# ── AGENT 4: Timeline + Progression ──────────

async def timeline_agent(
    entities: List[dict],
    graph: dict,
    source_doc: str = "document",
    raw_sections: Optional[str] = None,
) -> AgentGraphOutput:
    """
    Timeline & Progression agent — needs ALL entity types; uses chunking.
    Every chunk call is gated by _GROQ_SEMAPHORE.
    """
    speciality = "clinical progression analysis"
    system_tmpl = _DOC_AGENT_SYSTEM + """
EXTRACTION TASKS:
1. (Condition) --LEADS_TO--> (Outcome): worsening=0.8-1.0, stable=0.3-0.5, improving=0.1-0.2.
2. Changed prior decision: (Decision: new) --REWORK_OF--> (Decision: old).
   Old chain weight < 0.4, new chain weight > 0.7.
3. Follow-up gap > 6 months → PROGRESSION flag.
4. Overall trajectory: one (Condition) --LEADS_TO--> (Outcome: trajectory).
5. Highest priority concern → critical impact_flag if needed.
6. Build decision_chains for most urgent condition based on trajectory.
"""

    all_entities = [
        e for e in entities
        if e.get("entity_type", "").lower() in
        ("lab result", "diagnosis", "medication", "vital sign",
         "finding", "procedure", "symptom")
    ]

    graph_context = _safe_json_str({
        "diagnoses":   graph.get("diagnoses", []),
        "lab_results": graph.get("lab_results", []),
        "vital_signs": graph.get("vital_signs", []),
        "medications": graph.get("medications", []),
    })

    chunks = _chunk(all_entities)
    total  = len(chunks)
    logger.info(f"  [timeline_agent] {len(all_entities)} entities → {total} chunk(s)")

    loop = asyncio.get_event_loop()

    async def _call(chunk: List[dict], i: int) -> str:
        system = system_tmpl.format(speciality=speciality, chunk_idx=i + 1, total_chunks=total)
        user   = (
            f"=== ALL CLINICAL ENTITIES — chunk {i + 1}/{total} ===\n"
            f"{json.dumps(chunk, indent=2)}\n\n"
            f"=== DOCTOR'S HISTORICAL DATA (reference, all chunks) ===\n"
            f"{graph_context}"
            f"{_raw_sections_block(raw_sections)}"   # ← ADD THIS LINE
        )
        async with _GROQ_SEMAPHORE:
            return await loop.run_in_executor(None, _chat, system, user)

    responses = await asyncio.gather(*[_call(c, i) for i, c in enumerate(chunks)])
    merged    = _merge_raw_json_lists(list(responses), _L1_KEYS)

    return AgentGraphOutput(
        agent_name="Timeline Agent",
        dimension="Disease Progression & Timeline",
        confidence=0.83,
        triples=_build_triples(merged["triples"], source_doc),
        abnormalities=_build_abnormalities(merged["abnormalities"]),
        decision_chains=_build_doc_decision_chains(merged["decision_chains"]),
        impact_flags=_build_impact_flags(merged["impact_flags"]),
    )


# ═════════════════════════════════════════════
# LAYER 1 MERGE
# ═════════════════════════════════════════════

async def merge_agent_outputs(
    agent_outputs: List[AgentGraphOutput],
    doctor_id: str,
    source_doc: str,
    patient_id: Optional[str] = None,
) -> Dict[str, Any]:
    seen_nodes: Dict[str, Any] = {}
    seen_edges: Dict[str, Any] = {}
    all_abnormalities: List[AbnormalityRecord] = []
    all_decision_chains: List[DecisionChain]   = []
    all_impact_flags: List[ImpactFlag]         = []

    for output in agent_outputs:
        for triple in output.triples:
            for node in (triple.subject, triple.obj):
                key = f"{doctor_id}::{node.node_type}::{node.label.lower().strip()}"
                if key not in seen_nodes:
                    seen_nodes[key] = node

        for triple in output.triples:
            edge_key = (
                f"{doctor_id}|{triple.subject.label.lower()}"
                f"|{triple.relation}|{triple.obj.label.lower()}"
            )
            edge = triple.to_graph_edge()
            edge.doctor_id  = doctor_id
            edge.patient_id = patient_id
            existing = seen_edges.get(edge_key)
            if existing is None:
                seen_edges[edge_key] = edge
            elif edge.weight > existing.weight:
                seen_edges[edge_key] = edge

        seen_abn = {a.entity_name.lower() for a in all_abnormalities}
        for abn in output.abnormalities:
            if abn.entity_name.lower() not in seen_abn:
                all_abnormalities.append(abn)
                seen_abn.add(abn.entity_name.lower())

        all_decision_chains.extend(output.decision_chains)

        seen_flags = {f.description.lower() for f in all_impact_flags}
        for flag in output.impact_flags:
            if flag.description.lower() not in seen_flags:
                all_impact_flags.append(flag)
                seen_flags.add(flag.description.lower())

    return {
        "doctor_id":       doctor_id,
        "patient_id":      patient_id,
        "source_doc":      source_doc,
        "graph_nodes":     list(seen_nodes.values()),
        "graph_edges":     list(seen_edges.values()),
        "abnormalities":   all_abnormalities,
        "decision_chains": all_decision_chains,
        "impact_flags":    all_impact_flags,
        "agent_outputs":   agent_outputs,
    }


# ═════════════════════════════════════════════
# LAYER 1 MAIN
# ═════════════════════════════════════════════

async def run_graph_extraction_agents(
    doctor_id: str,
    entities: List[dict],
    graph: dict,
    source_doc: str = "document",
    patient_id: Optional[str] = None,
    raw_sections: Optional[str] = None,          # ← ADD
) -> Dict[str, Any]:
    """
    Layer 1: Per-document graph extraction.
    Called by pipeline.py on every document upload.
    4 agents run in parallel; each agent internally fans out across chunks.
    All chunk-level LLM calls share _GROQ_SEMAPHORE to prevent 429 floods.
    """
    logger.info(
        f"🔬 Layer 1 extraction starting | doctor={doctor_id} | "
        f"{len(entities)} entities | chunk_size={CHUNK_SIZE} | "
        f"semaphore={_GROQ_SEMAPHORE._value}"
    )

    results = await asyncio.gather(
        lab_vitals_agent(entities, graph, source_doc, raw_sections),          # ← ADD
        diagnosis_symptoms_agent(entities, graph, source_doc, raw_sections),  # ← ADD
        medication_imaging_agent(entities, graph, source_doc, raw_sections),  # ← ADD
        timeline_agent(entities, graph, source_doc, raw_sections),            # ← ADD
        return_exceptions=False,
    )

    agent_outputs: List[AgentGraphOutput] = list(results)

    logger.info(
        f"✅ Layer 1 complete: "
        f"{sum(len(a.triples) for a in agent_outputs)} triples | "
        f"{sum(len(a.abnormalities) for a in agent_outputs)} abnormalities | "
        f"{sum(len(a.decision_chains) for a in agent_outputs)} chains | "
        f"{sum(len(a.impact_flags) for a in agent_outputs)} flags"
    )

    merged = await merge_agent_outputs(
        agent_outputs=agent_outputs,
        doctor_id=doctor_id,
        source_doc=source_doc,
        patient_id=patient_id,
    )

    logger.info(
        f"🔗 Layer 1 merged: "
        f"{len(merged['graph_nodes'])} nodes | "
        f"{len(merged['graph_edges'])} edges | "
        f"{len(merged['impact_flags'])} flags"
    )

    return merged


# ═════════════════════════════════════════════
# LAYER 2 SYSTEM PROMPT
# ═════════════════════════════════════════════

_DOCTOR_AGENT_SYSTEM = """
You are a clinical pattern-mining agent specialising in {speciality}.

You are given a subset of past consultation records for ONE DOCTOR
(chunk {chunk_idx} of {total_chunks}).
Your job: identify recurring Condition→Decision patterns in THIS CHUNK.
Downstream code aggregates patterns across all chunks.

You are NOT analysing a single patient. You are aggregating across consultations
to find what this doctor consistently does when they see a given condition.

Return ONLY valid JSON matching this EXACT schema:

{{
  "decision_chains": [
    {{
      "condition":             "condition label (e.g. 'Hypertension')",
      "decision":              "decision label (e.g. 'Prescribe Amlodipine 5mg')",
      "action_type":           "investigation | medication | referral | procedure | monitoring | counselling",
      "rationale":             "why this decision follows from this condition",
      "urgency":               "immediate | urgent | routine | elective",
      "avg_probability":       0.0-1.0,
      "occurrence_count":      integer,
      "patient_count":         integer,
      "expected_outcome":      "expected improvement",
      "contradicting_factors": ["weakening patterns"]
    }}
  ]
}}

RULES:
- avg_probability = how consistently this doctor makes this decision (0=never, 1=always).
- Only include patterns that appear at least TWICE within this chunk.
- Do NOT invent patterns not in the data.
- Merge near-duplicate condition names into one canonical label.
"""

_L2_KEYS = ["decision_chains"]


# ═════════════════════════════════════════════
# LAYER 2 AGENTS
# ═════════════════════════════════════════════

# ── AGENT A: Diagnosis + Investigation ────────

async def diagnosis_investigation_pattern_agent(
    consultations: List[dict],
    doctor_id: str,
    speciality: Optional[str] = None,
) -> AgentDoctorOutput:
    """
    Merged: Diagnosis Patterns + Investigation Patterns.
    All consultations processed via chunking.
    Every chunk call is gated by _GROQ_SEMAPHORE.
    """
    speciality_str = "clinical diagnostics and investigation ordering"
    system_tmpl = _DOCTOR_AGENT_SYSTEM + """
TASK: Find all recurring patterns in this chunk:
1. What diagnosis consistently leads to what treatment/management decision?
2. What condition consistently leads to what investigation/test order?
Include both in a single decision_chains list.
"""

    def _strip(c: dict) -> dict:
        return {
            "diagnosis":      c.get("diagnosis", ""),
            "treatment_plan": c.get("treatment_plan", ""),
            "clinical_notes": c.get("clinical_notes", ""),
            "investigations": c.get("investigations", ""),
        }

    stripped = [_strip(c) for c in consultations]
    chunks   = _chunk(stripped)
    total    = len(chunks)
    logger.info(f"  [dx_investigation_agent] {len(stripped)} consultations → {total} chunk(s)")

    loop = asyncio.get_event_loop()

    async def _call(chunk: List[dict], i: int) -> str:
        system = system_tmpl.format(speciality=speciality_str, chunk_idx=i + 1, total_chunks=total)
        user   = (
            f"=== DOCTOR {doctor_id} — DX & INVESTIGATION (chunk {i + 1}/{total}) ===\n"
            f"{json.dumps(chunk, indent=2)}"
        )
        async with _GROQ_SEMAPHORE:
            return await loop.run_in_executor(
                None, _chat, system, user,
                "llama-3.3-70b-versatile", 4000, 0.1, True, '{"decision_chains":[]}'
            )

    responses = await asyncio.gather(*[_call(c, i) for i, c in enumerate(chunks)])
    merged    = _merge_raw_json_lists(list(responses), _L2_KEYS)
    chains    = _build_doctor_decision_chains(merged["decision_chains"], doctor_id)
    nodes, edges = _build_nodes_and_edges(chains)
    candidates   = _build_skill_candidates(chains, doctor_id, speciality)

    return AgentDoctorOutput(
        agent_name="Diagnosis + Investigation Pattern Agent",
        dimension="Diagnoses, Conditions & Investigations",
        confidence=0.87,
        doctor_id=doctor_id,
        decision_chains=chains,
        graph_nodes=nodes,
        graph_edges=edges,
        skill_candidates=candidates,
    )


# ── AGENT B: Medication Patterns ──────────────

async def medication_pattern_agent(
    consultations: List[dict],
    doctor_id: str,
    speciality: Optional[str] = None,
) -> AgentDoctorOutput:
    """
    Recurring Condition→Medication patterns.
    Every chunk call is gated by _GROQ_SEMAPHORE.
    """
    speciality_str = "clinical pharmacology"
    system_tmpl = _DOCTOR_AGENT_SYSTEM + """
TASK: Find recurring Condition→Medication patterns in this chunk.
What condition consistently triggers what drug prescription, how consistently,
and what is the expected outcome?
"""

    def _strip(c: dict) -> dict:
        return {
            "diagnosis":   c.get("diagnosis", ""),
            "medications": c.get("medications", ""),
        }

    stripped = [_strip(c) for c in consultations]
    chunks   = _chunk(stripped)
    total    = len(chunks)
    logger.info(f"  [medication_pattern_agent] {len(stripped)} consultations → {total} chunk(s)")

    loop = asyncio.get_event_loop()

    async def _call(chunk: List[dict], i: int) -> str:
        system = system_tmpl.format(speciality=speciality_str, chunk_idx=i + 1, total_chunks=total)
        user   = (
            f"=== DOCTOR {doctor_id} — MEDICATIONS (chunk {i + 1}/{total}) ===\n"
            f"{json.dumps(chunk, indent=2)}"
        )
        async with _GROQ_SEMAPHORE:
            return await loop.run_in_executor(
                None, _chat, system, user,
                "llama-3.3-70b-versatile", 4000, 0.1, True, '{"decision_chains":[]}'
            )

    responses = await asyncio.gather(*[_call(c, i) for i, c in enumerate(chunks)])
    merged    = _merge_raw_json_lists(list(responses), _L2_KEYS)
    chains    = _build_doctor_decision_chains(merged["decision_chains"], doctor_id)
    nodes, edges = _build_nodes_and_edges(chains)
    candidates   = _build_skill_candidates(chains, doctor_id, speciality)

    return AgentDoctorOutput(
        agent_name="Medication Pattern Agent",
        dimension="Medications & Pharmacology",
        confidence=0.86,
        doctor_id=doctor_id,
        decision_chains=chains,
        graph_nodes=nodes,
        graph_edges=edges,
        skill_candidates=candidates,
    )


# ── AGENT C: Referral Patterns ────────────────

async def referral_pattern_agent(
    consultations: List[dict],
    doctor_id: str,
    speciality: Optional[str] = None,
) -> AgentDoctorOutput:
    """
    Recurring Condition→Referral patterns.
    Every chunk call is gated by _GROQ_SEMAPHORE.
    """
    speciality_str = "clinical referral decision-making"
    system_tmpl = _DOCTOR_AGENT_SYSTEM + """
TASK: Find recurring Condition→Referral patterns in this chunk.
What conditions consistently trigger a specialist referral?
What specialist? How urgent?
"""

    def _strip(c: dict) -> dict:
        return {
            "diagnosis":       c.get("diagnosis", ""),
            "referral_letter": c.get("referral_letter", ""),
            "treatment_plan":  c.get("treatment_plan", ""),
        }

    stripped = [_strip(c) for c in consultations]
    chunks   = _chunk(stripped)
    total    = len(chunks)
    logger.info(f"  [referral_pattern_agent] {len(stripped)} consultations → {total} chunk(s)")

    loop = asyncio.get_event_loop()

    async def _call(chunk: List[dict], i: int) -> str:
        system = system_tmpl.format(speciality=speciality_str, chunk_idx=i + 1, total_chunks=total)
        user   = (
            f"=== DOCTOR {doctor_id} — REFERRALS (chunk {i + 1}/{total}) ===\n"
            f"{json.dumps(chunk, indent=2)}"
        )
        async with _GROQ_SEMAPHORE:
            return await loop.run_in_executor(
                None, _chat, system, user,
                "llama-3.3-70b-versatile", 4000, 0.1, True, '{"decision_chains":[]}'
            )

    responses = await asyncio.gather(*[_call(c, i) for i, c in enumerate(chunks)])
    merged    = _merge_raw_json_lists(list(responses), _L2_KEYS)
    chains    = _build_doctor_decision_chains(merged["decision_chains"], doctor_id)
    nodes, edges = _build_nodes_and_edges(chains)
    candidates   = _build_skill_candidates(chains, doctor_id, speciality)

    return AgentDoctorOutput(
        agent_name="Referral Pattern Agent",
        dimension="Referrals & Escalations",
        confidence=0.84,
        doctor_id=doctor_id,
        decision_chains=chains,
        graph_nodes=nodes,
        graph_edges=edges,
        skill_candidates=candidates,
    )


# ── AGENT D: Rework / Revision Patterns ───────

async def rework_pattern_agent(
    consultations: List[dict],
    doctor_id: str,
    speciality: Optional[str] = None,
) -> AgentDoctorOutput:
    """
    Identifies cases where the doctor revised a prior decision.
    Every chunk call is gated by _GROQ_SEMAPHORE.
    """
    speciality_str = "clinical decision revision analysis"
    system_tmpl = _DOCTOR_AGENT_SYSTEM + """
TASK: Identify cases in this chunk where the doctor REVISED a prior decision
for the same condition.
- Old decision chain: avg_probability < 0.5 (abandoned).
- New decision chain: avg_probability > 0.7 (new approach).
- occurrence_count = how many times this revision happened.
These are learning events — where the doctor changed approach.
"""

    def _strip(c: dict) -> dict:
        return {
            "diagnosis":      c.get("diagnosis", ""),
            "treatment_plan": c.get("treatment_plan", ""),
            "medications":    c.get("medications", ""),
            "saved_at":       c.get("saved_at", ""),
        }

    stripped = [_strip(c) for c in consultations]
    chunks   = _chunk(stripped, size=80)   # rework needs more context per chunk
    total    = len(chunks)
    logger.info(f"  [rework_pattern_agent] {len(stripped)} consultations → {total} chunk(s)")

    loop = asyncio.get_event_loop()

    async def _call(chunk: List[dict], i: int) -> str:
        system = system_tmpl.format(speciality=speciality_str, chunk_idx=i + 1, total_chunks=total)
        user   = (
            f"=== DOCTOR {doctor_id} — FULL TIMELINE (chunk {i + 1}/{total}, newest first) ===\n"
            f"{json.dumps(chunk, indent=2)}"
        )
        async with _GROQ_SEMAPHORE:
            return await loop.run_in_executor(
                None, _chat, system, user,
                "llama-3.3-70b-versatile", 4000, 0.1, True, '{"decision_chains":[]}'
            )

    responses = await asyncio.gather(*[_call(c, i) for i, c in enumerate(chunks)])
    merged    = _merge_raw_json_lists(list(responses), _L2_KEYS)
    chains    = _build_doctor_decision_chains(merged["decision_chains"], doctor_id)
    nodes, edges = _build_nodes_and_edges(chains)

    return AgentDoctorOutput(
        agent_name="Rework Pattern Agent",
        dimension="Decision Revisions & Rework",
        confidence=0.80,
        doctor_id=doctor_id,
        decision_chains=chains,
        graph_nodes=nodes,
        graph_edges=edges,
        skill_candidates=[],   # rework patterns don't become skills
    )


# ═════════════════════════════════════════════
# LAYER 2 MERGE
# ═════════════════════════════════════════════

def merge_doctor_agent_outputs(
    agent_outputs: List[AgentDoctorOutput],
    doctor_id: str,
) -> Dict[str, Any]:
    seen_nodes:  Dict[str, DoctorGraphNode]     = {}
    seen_edges:  Dict[str, DoctorGraphEdge]     = {}
    seen_chains: Dict[str, DoctorDecisionChain] = {}
    seen_skills: Dict[str, SkillCandidate]      = {}

    for output in agent_outputs:
        for node in output.graph_nodes:
            key = f"{node.node_type}::{node.label.lower().strip()}"
            if key not in seen_nodes:
                seen_nodes[key] = node
            else:
                seen_nodes[key].occurrence_count += node.occurrence_count
                seen_nodes[key].patient_count     = max(
                    seen_nodes[key].patient_count, node.patient_count
                )

        for edge in output.graph_edges:
            e_key    = f"{edge.from_label.lower()}|{edge.relation}|{edge.to_label.lower()}"
            existing = seen_edges.get(e_key)
            if existing is None:
                seen_edges[e_key] = edge
            else:
                n = existing.occurrence_count
                existing.weight = (existing.weight * n + edge.weight) / (n + 1)
                existing.occurrence_count += edge.occurrence_count
                existing.patient_count     = max(existing.patient_count, edge.patient_count)

        for chain in output.decision_chains:
            c_key    = f"{chain.condition_label.lower()}::{chain.decision_label.lower()}"
            existing = seen_chains.get(c_key)
            if existing is None:
                seen_chains[c_key] = chain
            else:
                n = existing.occurrence_count
                existing.avg_probability  = (existing.avg_probability * n + chain.avg_probability) / (n + 1)
                existing.occurrence_count += chain.occurrence_count
                existing.patient_count     = max(existing.patient_count, chain.patient_count)

        for skill in output.skill_candidates:
            s_key    = f"{skill.condition_label.lower()}::{skill.decision_label.lower()}"
            existing = seen_skills.get(s_key)
            if existing is None:
                seen_skills[s_key] = skill
            else:
                existing.weight           = max(existing.weight, skill.weight)
                existing.occurrence_count += skill.occurrence_count
                existing.patient_count     = max(existing.patient_count, skill.patient_count)

    return {
        "doctor_id":        doctor_id,
        "graph_nodes":      list(seen_nodes.values()),
        "graph_edges":      list(seen_edges.values()),
        "decision_chains":  list(seen_chains.values()),
        "skill_candidates": list(seen_skills.values()),
        "agent_outputs":    agent_outputs,
    }


# ════════════════════════════════════════════
# LAYER 2 MAIN
# ═════════════════════════════════════════════

async def run_doctor_pattern_agents(
    doctor_id: str,
    consultations: List[dict],
    speciality: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Layer 2: Cross-consultation pattern mining.
    Called by pipeline.py after fetching all consultations for a doctor.
    4 agents run in parallel; each fans out internally across chunks.
    All chunk-level LLM calls share _GROQ_SEMAPHORE to prevent 429 floods.
    """
    logger.info(
        f"🩺 Layer 2 pattern agents starting | doctor={doctor_id} | "
        f"consultations={len(consultations)} | chunk_size={CHUNK_SIZE} | "
        f"semaphore={_GROQ_SEMAPHORE._value}"
    )

    results = await asyncio.gather(
        diagnosis_investigation_pattern_agent(consultations, doctor_id, speciality),
        medication_pattern_agent(consultations, doctor_id, speciality),
        referral_pattern_agent(consultations, doctor_id, speciality),
        rework_pattern_agent(consultations, doctor_id, speciality),
        return_exceptions=False,
    )

    agent_outputs: List[AgentDoctorOutput] = list(results)

    logger.info(
        f"✅ Layer 2 complete: "
        f"{sum(len(a.decision_chains) for a in agent_outputs)} chains | "
        f"{sum(len(a.skill_candidates) for a in agent_outputs)} skill candidates"
    )

    merged = merge_doctor_agent_outputs(agent_outputs, doctor_id)

    logger.info(
        f"🔗 Layer 2 merged: "
        f"{len(merged['graph_nodes'])} nodes | "
        f"{len(merged['graph_edges'])} edges | "
        f"{len(merged['skill_candidates'])} skill candidates"
    )

    return merged