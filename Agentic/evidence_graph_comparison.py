"""
evidence_graph_comparison.py
============================
Clinical Knowledge Graph Comparison Engine.

Compares two ClinicalKnowledgeGraph instances and detects:
  • Outdated recommendations
  • Changed evidence grades
  • Contraindications (new / removed)
  • Removed treatments
  • Safety alerts
  • Changed drug approvals
  • Changed staging criteria
  • Conflicting evidence
  • Missing biomarkers
  • Newer / superior studies
  • Pathway differences

Architecture:
  - GraphComparisonAgent        — node/edge semantic matching
  - ContradictionDetectionAgent — conflicting recommendations
  - EvidenceDriftAgent          — evidence quality changes
  - PathwayDifferenceAgent      — protocol flow changes
  - RiskScoringAgent            — severity + overall score
  - ClinicalGraphComparisonEngine — orchestrator

FastAPI router is provided at the bottom.

Install (same deps as main pipeline):
    pip install neo4j loguru fastapi groq pydantic
"""

from __future__ import annotations

import json
import os
import textwrap
import uuid
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from loguru import logger
from pydantic import BaseModel, Field
from pymongo import MongoClient

mongo_client = MongoClient(os.getenv("MONGO_URI"))
db = mongo_client["doctor_assist"]
comparison_collection = db["graph_comparison_reports"]

# ── Reuse all existing models ─────────────────────────────────────
from Agentic.evidence_models import (
    ClinicalKnowledgeGraph,
    DocumentSource,
    EdgeRelation,
    EvidenceQuality,
    GraphEdge,
    GuidelineSource,
    NodeType,
    RecommendationStrength,
    SourceType,
)
from Agentic.evidence_graph_writer import ClinicalGraphWriter, get_driver
from Agentic.evidence_rag_pipeline import AgenticGraphRAGPipeline
from Agentic.evidence_ingestion import extract_file, extract_url, _detect_guideline_source


# ═══════════════════════════════════════════════════════════════════
# COMPARISON OUTPUT MODELS
# ═══════════════════════════════════════════════════════════════════

class FindingSeverity(str, Enum):
    CRITICAL = "critical"   # contradictions / new contraindications
    HIGH     = "high"       # removed treatments / pathway changes
    MODERATE = "moderate"   # evidence downgrades / staging changes
    LOW      = "low"        # wording changes / minor additions
    INFO     = "info"       # new concepts not present in baseline


class FindingCategory(str, Enum):
    OUTDATED_RECOMMENDATION  = "outdated_recommendation"
    CHANGED_EVIDENCE         = "changed_evidence"
    NEW_CONTRAINDICATION     = "new_contraindication"
    REMOVED_CONTRAINDICATION = "removed_contraindication"
    REMOVED_TREATMENT        = "removed_treatment"
    SAFETY_ALERT             = "safety_alert"
    DRUG_APPROVAL_CHANGE     = "drug_approval_change"
    STAGING_CRITERIA_CHANGE  = "staging_criteria_change"
    CONFLICTING_EVIDENCE     = "conflicting_evidence"
    MISSING_BIOMARKER        = "missing_biomarker"
    SUPERIOR_STUDY           = "superior_study"
    PATHWAY_CHANGE           = "pathway_change"
    ADDED_RECOMMENDATION     = "added_recommendation"
    EVIDENCE_UPGRADE         = "evidence_upgrade"
    EVIDENCE_DOWNGRADE       = "evidence_downgrade"


class ComparisonFinding(BaseModel):
    id:          str           = Field(default_factory=lambda: f"find_{uuid.uuid4().hex[:8]}")
    category:    FindingCategory
    severity:    FindingSeverity
    title:       str
    description: str
    baseline_value:   Optional[str] = None   # what was in the original graph
    comparison_value: Optional[str] = None   # what is in the uploaded graph
    baseline_node_id:   Optional[str] = None
    comparison_node_id: Optional[str] = None
    clinical_impact:    str = ""
    action_required:    str = ""
    evidence_quote:     str = ""


class PathwayDiff(BaseModel):
    pathway_id:       str
    pathway_name:     str
    change_type:      str     # "added" | "removed" | "modified" | "reordered"
    description:      str
    steps_added:      List[str] = Field(default_factory=list)
    steps_removed:    List[str] = Field(default_factory=list)
    steps_reordered:  bool = False


class ClinicalComparisonReport(BaseModel):
    """Master output of the comparison engine."""
    id:             str = Field(default_factory=lambda: f"cmp_{uuid.uuid4().hex[:12]}")
    generated_at:   str = Field(default_factory=lambda: datetime.utcnow().isoformat())

    baseline_pipeline_id:   str
    comparison_pipeline_id: str
    baseline_source:        str = ""
    comparison_source:      str = ""

    # Aggregated findings by category
    findings:               List[ComparisonFinding] = Field(default_factory=list)
    pathway_diffs:          List[PathwayDiff]       = Field(default_factory=list)

    # Quick-access buckets
    critical_findings:       List[ComparisonFinding] = Field(default_factory=list)
    safety_alerts:           List[ComparisonFinding] = Field(default_factory=list)
    contraindications:       List[ComparisonFinding] = Field(default_factory=list)
    evidence_changes:        List[ComparisonFinding] = Field(default_factory=list)
    removed_treatments:      List[ComparisonFinding] = Field(default_factory=list)
    added_recommendations:   List[ComparisonFinding] = Field(default_factory=list)
    conflicting_evidence:    List[ComparisonFinding] = Field(default_factory=list)
    missing_biomarkers:      List[ComparisonFinding] = Field(default_factory=list)
    superior_studies:        List[ComparisonFinding] = Field(default_factory=list)

    # Risk
    risk_score:       float = 0.0   # 0–100
    overall_severity: str   = "low"
    executive_summary: str  = ""

    # Stats
    total_findings:    int = 0
    critical_count:    int = 0
    high_count:        int = 0
    moderate_count:    int = 0
    low_count:         int = 0

    def compute_stats(self) -> None:
        self.total_findings = len(self.findings)
        self.critical_count = sum(1 for f in self.findings if f.severity == FindingSeverity.CRITICAL)
        self.high_count     = sum(1 for f in self.findings if f.severity == FindingSeverity.HIGH)
        self.moderate_count = sum(1 for f in self.findings if f.severity == FindingSeverity.MODERATE)
        self.low_count      = sum(1 for f in self.findings if f.severity == FindingSeverity.LOW)

        # Populate quick-access buckets
        self.critical_findings    = [f for f in self.findings if f.severity == FindingSeverity.CRITICAL]
        self.safety_alerts        = [f for f in self.findings if f.category == FindingCategory.SAFETY_ALERT]
        self.contraindications    = [f for f in self.findings if f.category in (FindingCategory.NEW_CONTRAINDICATION, FindingCategory.REMOVED_CONTRAINDICATION)]
        self.evidence_changes     = [f for f in self.findings if f.category in (FindingCategory.CHANGED_EVIDENCE, FindingCategory.EVIDENCE_UPGRADE, FindingCategory.EVIDENCE_DOWNGRADE)]
        self.removed_treatments   = [f for f in self.findings if f.category == FindingCategory.REMOVED_TREATMENT]
        self.added_recommendations= [f for f in self.findings if f.category == FindingCategory.ADDED_RECOMMENDATION]
        self.conflicting_evidence = [f for f in self.findings if f.category == FindingCategory.CONFLICTING_EVIDENCE]
        self.missing_biomarkers   = [f for f in self.findings if f.category == FindingCategory.MISSING_BIOMARKER]
        self.superior_studies     = [f for f in self.findings if f.category == FindingCategory.SUPERIOR_STUDY]

        # Risk score
        self.risk_score = min(100.0, round(
            self.critical_count * 30 +
            self.high_count     * 15 +
            self.moderate_count *  5 +
            self.low_count      *  1,
            1
        ))
        if self.risk_score >= 60:
            self.overall_severity = "critical"
        elif self.risk_score >= 35:
            self.overall_severity = "high"
        elif self.risk_score >= 15:
            self.overall_severity = "moderate"
        else:
            self.overall_severity = "low"


# ═══════════════════════════════════════════════════════════════════
# LLM CLIENT  (reuse same Groq client pattern)
# ═══════════════════════════════════════════════════════════════════

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
MODEL        = os.getenv("CLINICAL_LLM_MODEL", "llama-3.3-70b-versatile")
MAX_TOKENS   = 6000
TEMPERATURE  = 0.1


class _LLMClient:
    def __init__(self):
        from groq import Groq
        self._client = Groq(api_key=GROQ_API_KEY)

    def complete_json(self, system: str, user: str) -> Any:
        system = system + "\n\nReturn ONLY valid JSON."
        user   = user   + "\n\nRespond in JSON format."
        resp = self._client.chat.completions.create(
            model=MODEL, temperature=TEMPERATURE, max_tokens=MAX_TOKENS,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": system},
                      {"role": "user",   "content": user}],
        )
        return json.loads(resp.choices[0].message.content)


# ═══════════════════════════════════════════════════════════════════
# AGENT 1 — NODE MATCHER
# Semantic matching between baseline and comparison node lists
# ═══════════════════════════════════════════════════════════════════

class GraphComparisonAgent:
    """
    Matches nodes between two graphs by semantic similarity of labels.
    Returns:
      matched_pairs   — [(baseline_node, comparison_node)]
      added_nodes     — nodes in comparison not in baseline
      removed_nodes   — nodes in baseline not in comparison
    """

    SYSTEM = textwrap.dedent("""
    You are a clinical ontology matching specialist.

    You receive two lists of clinical entity nodes (baseline and comparison).
    Your task: match nodes that represent the SAME clinical concept across the two lists.

    MATCHING RULES:
    • Match by clinical concept — not exact string. "TVUS" = "Transvaginal Ultrasound"
    • Only match nodes of the SAME type (recommendation ↔ recommendation, etc.)
    • A node can only be matched once.
    • Unmatched baseline nodes = REMOVED concepts.
    • Unmatched comparison nodes = ADDED concepts.

    RESPONSE FORMAT (JSON only):
    {
      "matched_pairs": [
        {"baseline_id": "...", "comparison_id": "...", "confidence": 0.0–1.0, "reason": "..."}
      ],
      "unmatched_baseline_ids": ["..."],
      "unmatched_comparison_ids": ["..."]
    }
    """)

    def __init__(self, llm: _LLMClient):
        self._llm = llm

    def match(
        self,
        baseline_nodes:    List[Dict],
        comparison_nodes:  List[Dict],
    ) -> Tuple[List[Tuple[Dict, Dict]], List[Dict], List[Dict]]:
        """Returns (matched_pairs, removed, added)."""
        if not baseline_nodes or not comparison_nodes:
            return [], baseline_nodes, comparison_nodes

        # Work in batches of 40 per side to keep prompt manageable
        b_summary = json.dumps([{"id": n.get("id"), "type": n.get("type"), "label": n.get("label")} for n in baseline_nodes[:60]], indent=2)
        c_summary = json.dumps([{"id": n.get("id"), "type": n.get("type"), "label": n.get("label")} for n in comparison_nodes[:60]], indent=2)

        try:
            result = self._llm.complete_json(
                self.SYSTEM,
                f"BASELINE NODES:\n{b_summary}\n\nCOMPARISON NODES:\n{c_summary}",
            )
        except Exception as exc:
            logger.warning(f"[NodeMatcher] LLM call failed: {exc}")
            return [], baseline_nodes, comparison_nodes

        b_map = {n["id"]: n for n in baseline_nodes}
        c_map = {n["id"]: n for n in comparison_nodes}

        matched_pairs: List[Tuple[Dict, Dict]] = []
        matched_b: set = set()
        matched_c: set = set()

        for pair in result.get("matched_pairs", []):
            bid = pair.get("baseline_id")
            cid = pair.get("comparison_id")
            if bid in b_map and cid in c_map:
                matched_pairs.append((b_map[bid], c_map[cid]))
                matched_b.add(bid)
                matched_c.add(cid)

        removed = [n for n in baseline_nodes   if n["id"] not in matched_b]
        added   = [n for n in comparison_nodes if n["id"] not in matched_c]

        logger.info(f"[NodeMatcher] matched={len(matched_pairs)} removed={len(removed)} added={len(added)}")
        return matched_pairs, removed, added


# ═══════════════════════════════════════════════════════════════════
# AGENT 2 — CONTRADICTION DETECTOR
# ═══════════════════════════════════════════════════════════════════

class ContradictionDetectionAgent:
    """Finds nodes that are matched but have conflicting recommendation directions."""

    SYSTEM = textwrap.dedent("""
    You are a clinical contradiction detection specialist.

    You receive pairs of matched clinical nodes — one from a baseline document,
    one from a comparison document. Both represent the SAME clinical concept
    but may have DIFFERENT recommendations, evidence grades, strengths, or values.

    For each pair identify if there is a clinically meaningful contradiction or change.

    CONTRADICTION TYPES to detect:
      1. DIRECTION FLIP: baseline recommends FOR, comparison recommends AGAINST (or vice versa)
      2. STRENGTH CHANGE: strong → conditional or conditional → strong
      3. EVIDENCE DOWNGRADE: high → low, moderate → very_low, etc.
      4. EVIDENCE UPGRADE: low → high (positive change — still report it)
      5. CONTRAINDICATION ADDED: comparison flags as contraindicated
      6. CONTRAINDICATION REMOVED: baseline was contraindicated, comparison is not
      7. APPROVAL STATUS CHANGE: drug approval status changed
      8. STAGING CHANGE: classification criteria changed
      9. SAFETY CHANGE: new safety warnings or removals

    SEVERITY RULES:
      critical  — direction flip, new contraindication
      high      — contraindication removed, strength downgrade, staging change
      moderate  — evidence grade change, approval change
      low       — wording refinement with no clinical impact

    RESPONSE FORMAT (JSON only):
    {
      "contradictions": [
        {
          "baseline_id": "...",
          "comparison_id": "...",
          "contradiction_type": "...",
          "severity": "critical|high|moderate|low",
          "title": "...",
          "description": "...",
          "baseline_value": "...",
          "comparison_value": "...",
          "clinical_impact": "...",
          "action_required": "..."
        }
      ]
    }
    """)

    def __init__(self, llm: _LLMClient):
        self._llm = llm

    def detect(self, matched_pairs: List[Tuple[Dict, Dict]]) -> List[ComparisonFinding]:
        if not matched_pairs:
            return []

        pairs_payload = [
            {"baseline": b, "comparison": c}
            for b, c in matched_pairs[:50]   # cap to avoid token overflow
        ]

        try:
            result = self._llm.complete_json(
                self.SYSTEM,
                json.dumps(pairs_payload, indent=2),
            )
        except Exception as exc:
            logger.warning(f"[ContradictionAgent] LLM call failed: {exc}")
            return []

        findings: List[ComparisonFinding] = []
        for raw in result.get("contradictions", []):
            ct = raw.get("contradiction_type", "").lower()
            category = self._map_category(ct)
            severity = self._map_severity(raw.get("severity", "low"))
            findings.append(ComparisonFinding(
                category=category,
                severity=severity,
                title=raw.get("title", "Recommendation Change"),
                description=raw.get("description", ""),
                baseline_value=raw.get("baseline_value"),
                comparison_value=raw.get("comparison_value"),
                baseline_node_id=raw.get("baseline_id"),
                comparison_node_id=raw.get("comparison_id"),
                clinical_impact=raw.get("clinical_impact", ""),
                action_required=raw.get("action_required", ""),
            ))

        logger.info(f"[ContradictionAgent] Found {len(findings)} contradictions/changes")
        return findings

    @staticmethod
    def _map_category(ct: str) -> FindingCategory:
        if "contraindication" in ct and "remov" in ct:
            return FindingCategory.REMOVED_CONTRAINDICATION
        if "contraindication" in ct:
            return FindingCategory.NEW_CONTRAINDICATION
        if "direction" in ct or "flip" in ct:
            return FindingCategory.CONFLICTING_EVIDENCE
        if "safety" in ct:
            return FindingCategory.SAFETY_ALERT
        if "approv" in ct:
            return FindingCategory.DRUG_APPROVAL_CHANGE
        if "staging" in ct or "classif" in ct:
            return FindingCategory.STAGING_CRITERIA_CHANGE
        if "downgrad" in ct:
            return FindingCategory.EVIDENCE_DOWNGRADE
        if "upgrad" in ct:
            return FindingCategory.EVIDENCE_UPGRADE
        return FindingCategory.CHANGED_EVIDENCE

    @staticmethod
    def _map_severity(s: str) -> FindingSeverity:
        return {
            "critical": FindingSeverity.CRITICAL,
            "high":     FindingSeverity.HIGH,
            "moderate": FindingSeverity.MODERATE,
            "low":      FindingSeverity.LOW,
        }.get(s.lower(), FindingSeverity.LOW)


# ═══════════════════════════════════════════════════════════════════
# AGENT 3 — EVIDENCE DRIFT AGENT
# ═══════════════════════════════════════════════════════════════════

class EvidenceDriftAgent:
    """Identifies removed treatments, missing biomarkers, and superior newer studies."""

    SYSTEM = textwrap.dedent("""
    You are a clinical evidence drift analyst.

    You receive:
      1. Nodes REMOVED from baseline (present in original, absent in comparison)
      2. Nodes ADDED in comparison (absent in original, present in comparison)
      3. Matched study nodes from both sides (for superiority comparison)

    Your tasks:

    A. REMOVED TREATMENTS: find removed DrugNode / RecommendationNode / SurgicalProcedureNode
       that were in baseline but missing in comparison. These are CRITICAL if they were
       strong recommendations or first-line treatments.

    B. MISSING BIOMARKERS: BiomarkerNode in baseline not matched in comparison.

    C. SUPERIOR STUDIES: StudyNode in comparison with higher evidence quality, larger N,
       or better statistics (HR, OR, AUC) than matched study in baseline.

    D. OUTDATED RECOMMENDATIONS: RecommendationNode in baseline that appears superseded by
       a stronger/different recommendation in comparison.

    E. SAFETY ALERTS: any added node with flags containing "contraindicated" or "urgent",
       or removed nodes that were positive safety signals.

    RESPONSE FORMAT (JSON only):
    {
      "removed_treatments": [
        {"node_id": "...", "label": "...", "severity": "critical|high|moderate|low",
         "description": "...", "clinical_impact": "...", "action_required": "..."}
      ],
      "missing_biomarkers": [
        {"node_id": "...", "label": "...", "severity": "...", "description": "..."}
      ],
      "superior_studies": [
        {"comparison_node_id": "...", "baseline_node_id": "...", "label": "...",
         "severity": "moderate|low", "description": "...", "why_superior": "..."}
      ],
      "outdated_recommendations": [
        {"baseline_node_id": "...", "label": "...", "severity": "...", "description": "...",
         "superseded_by": "..."}
      ],
      "safety_alerts": [
        {"node_id": "...", "label": "...", "severity": "critical|high",
         "description": "...", "action_required": "..."}
      ]
    }
    """)

    def __init__(self, llm: _LLMClient):
        self._llm = llm

    def analyse(
        self,
        removed_nodes:    List[Dict],
        added_nodes:      List[Dict],
        matched_pairs:    List[Tuple[Dict, Dict]],
    ) -> List[ComparisonFinding]:
        study_pairs = [
            {"baseline": b, "comparison": c}
            for b, c in matched_pairs
            if b.get("type") == "study"
        ]
        payload = {
            "removed_nodes":      removed_nodes[:40],
            "added_nodes":        added_nodes[:40],
            "matched_study_pairs": study_pairs[:20],
        }
        try:
            result = self._llm.complete_json(self.SYSTEM, json.dumps(payload, indent=2))
        except Exception as exc:
            logger.warning(f"[EvidenceDriftAgent] LLM call failed: {exc}")
            return []

        findings: List[ComparisonFinding] = []

        for r in result.get("removed_treatments", []):
            findings.append(ComparisonFinding(
                category=FindingCategory.REMOVED_TREATMENT,
                severity=ContradictionDetectionAgent._map_severity(r.get("severity", "high")),
                title=f"Removed: {r.get('label', 'Treatment')}",
                description=r.get("description", ""),
                baseline_node_id=r.get("node_id"),
                clinical_impact=r.get("clinical_impact", ""),
                action_required=r.get("action_required", ""),
            ))

        for r in result.get("missing_biomarkers", []):
            findings.append(ComparisonFinding(
                category=FindingCategory.MISSING_BIOMARKER,
                severity=ContradictionDetectionAgent._map_severity(r.get("severity", "moderate")),
                title=f"Missing Biomarker: {r.get('label', 'Biomarker')}",
                description=r.get("description", ""),
                baseline_node_id=r.get("node_id"),
            ))

        for r in result.get("superior_studies", []):
            findings.append(ComparisonFinding(
                category=FindingCategory.SUPERIOR_STUDY,
                severity=FindingSeverity.MODERATE,
                title=f"Newer/Superior Study: {r.get('label', 'Study')}",
                description=r.get("description", ""),
                comparison_node_id=r.get("comparison_node_id"),
                baseline_node_id=r.get("baseline_node_id"),
                clinical_impact=r.get("why_superior", ""),
            ))

        for r in result.get("outdated_recommendations", []):
            findings.append(ComparisonFinding(
                category=FindingCategory.OUTDATED_RECOMMENDATION,
                severity=ContradictionDetectionAgent._map_severity(r.get("severity", "high")),
                title=f"Outdated: {r.get('label', 'Recommendation')}",
                description=r.get("description", ""),
                baseline_node_id=r.get("baseline_node_id"),
                clinical_impact=r.get("superseded_by", ""),
            ))

        for r in result.get("safety_alerts", []):
            findings.append(ComparisonFinding(
                category=FindingCategory.SAFETY_ALERT,
                severity=ContradictionDetectionAgent._map_severity(r.get("severity", "high")),
                title=f"⚠ Safety Alert: {r.get('label', '')}",
                description=r.get("description", ""),
                action_required=r.get("action_required", ""),
            ))

        logger.info(f"[EvidenceDriftAgent] {len(findings)} drift findings")
        return findings


# ═══════════════════════════════════════════════════════════════════
# AGENT 4 — PATHWAY DIFFERENCE AGENT
# ═══════════════════════════════════════════════════════════════════

class PathwayDifferenceAgent:
    """Compares ProtocolFlowGraph lists between two graphs."""

    SYSTEM = textwrap.dedent("""
    You are a clinical protocol comparison specialist.

    You receive the protocol pathway lists from two clinical knowledge graphs:
    BASELINE and COMPARISON. Each pathway contains ordered clinical steps.

    Identify for each pathway pair:
      1. ADDED pathways: in comparison but not baseline
      2. REMOVED pathways: in baseline but not comparison
      3. MODIFIED pathways: same clinical question, different steps
      4. REORDERED pathways: same steps but different sequence

    For modified pathways, list:
      - steps_added (in comparison but not baseline)
      - steps_removed (in baseline but not comparison)

    Severity guide:
      critical — pathway removed entirely, or new mandatory step added
      high     — step order changed, step removed
      moderate — step added as optional
      low      — description/wording only

    RESPONSE FORMAT (JSON only):
    {
      "pathway_diffs": [
        {
          "pathway_id": "...",
          "pathway_name": "...",
          "change_type": "added|removed|modified|reordered",
          "severity": "critical|high|moderate|low",
          "description": "...",
          "steps_added": ["..."],
          "steps_removed": ["..."],
          "steps_reordered": true|false
        }
      ]
    }
    """)

    def __init__(self, llm: _LLMClient):
        self._llm = llm

    def compare(
        self,
        baseline_pathways:   List[Dict],
        comparison_pathways: List[Dict],
    ) -> Tuple[List[PathwayDiff], List[ComparisonFinding]]:
        if not baseline_pathways and not comparison_pathways:
            return [], []

        payload = {
            "baseline":   [{"id": p.get("id"), "name": p.get("name"),
                            "clinical_question": p.get("clinical_question"),
                            "steps": len(p.get("steps", []))} for p in baseline_pathways[:10]],
            "comparison": [{"id": p.get("id"), "name": p.get("name"),
                            "clinical_question": p.get("clinical_question"),
                            "steps": len(p.get("steps", []))} for p in comparison_pathways[:10]],
        }
        try:
            result = self._llm.complete_json(self.SYSTEM, json.dumps(payload, indent=2))
        except Exception as exc:
            logger.warning(f"[PathwayDiffAgent] LLM call failed: {exc}")
            return [], []

        diffs: List[PathwayDiff] = []
        findings: List[ComparisonFinding] = []

        for raw in result.get("pathway_diffs", []):
            d = PathwayDiff(
                pathway_id=raw.get("pathway_id", ""),
                pathway_name=raw.get("pathway_name", ""),
                change_type=raw.get("change_type", "modified"),
                description=raw.get("description", ""),
                steps_added=raw.get("steps_added", []),
                steps_removed=raw.get("steps_removed", []),
                steps_reordered=raw.get("steps_reordered", False),
            )
            diffs.append(d)

            findings.append(ComparisonFinding(
                category=FindingCategory.PATHWAY_CHANGE,
                severity=ContradictionDetectionAgent._map_severity(raw.get("severity", "high")),
                title=f"Pathway {'Changed' if d.change_type == 'modified' else d.change_type.title()}: {d.pathway_name}",
                description=d.description,
                clinical_impact=f"Steps added: {len(d.steps_added)} | Steps removed: {len(d.steps_removed)}",
            ))

        logger.info(f"[PathwayDiffAgent] {len(diffs)} pathway diffs")
        return diffs, findings


# ═══════════════════════════════════════════════════════════════════
# AGENT 5 — EXECUTIVE SUMMARY AGENT
# ═══════════════════════════════════════════════════════════════════

class ExecutiveSummaryAgent:
    SYSTEM = textwrap.dedent("""
    You are a senior clinical knowledge governance specialist.

    You receive a structured comparison report between two clinical knowledge graphs.
    Write a concise EXECUTIVE SUMMARY (3–5 sentences) that a clinician can read in
    under 30 seconds to understand:
      1. Overall risk level and what is driving it
      2. The single most critical finding (if any)
      3. The most important action required

    Do NOT list every finding. Be precise and clinical.

    RESPONSE FORMAT (JSON only):
    {"executive_summary": "..."}
    """)

    def __init__(self, llm: _LLMClient):
        self._llm = llm

    def summarise(self, report: ClinicalComparisonReport) -> str:
        snapshot = {
            "risk_score":       report.risk_score,
            "overall_severity": report.overall_severity,
            "critical_count":   report.critical_count,
            "high_count":       report.high_count,
            "critical_findings": [{"title": f.title, "description": f.description[:200]}
                                   for f in report.critical_findings[:3]],
            "safety_alerts":    [f.title for f in report.safety_alerts[:3]],
            "baseline_source":  report.baseline_source,
            "comparison_source": report.comparison_source,
        }
        try:
            r = self._llm.complete_json(self.SYSTEM, json.dumps(snapshot, indent=2))
            return r.get("executive_summary", "")
        except Exception as exc:
            logger.warning(f"[SummaryAgent] failed: {exc}")
            return (
                f"Comparison between '{report.baseline_source}' and "
                f"'{report.comparison_source}' identified {report.total_findings} findings "
                f"(risk score {report.risk_score:.0f}/100, severity: {report.overall_severity})."
            )


# ═══════════════════════════════════════════════════════════════════
# ORCHESTRATOR
# ═══════════════════════════════════════════════════════════════════

class ClinicalGraphComparisonEngine:
    """
    Main entry point. Call compare() with two ClinicalKnowledgeGraph instances.

    Example:
        engine = ClinicalGraphComparisonEngine()
        report = engine.compare(baseline_graph, comparison_graph)
        print(report.executive_summary)
        print(f"Risk score: {report.risk_score}")
    """

    def __init__(self):
        if not GROQ_API_KEY:
            raise RuntimeError("GROQ_API_KEY environment variable is missing.")
        llm = _LLMClient()
        self._matcher      = GraphComparisonAgent(llm)
        self._contradict   = ContradictionDetectionAgent(llm)
        self._evidence     = EvidenceDriftAgent(llm)
        self._pathway      = PathwayDifferenceAgent(llm)
        self._summariser   = ExecutiveSummaryAgent(llm)

    def compare(
        self,
        baseline:    ClinicalKnowledgeGraph,
        comparison:  ClinicalKnowledgeGraph,
    ) -> ClinicalComparisonReport:
        logger.info(
            f"[ComparisonEngine] Comparing "
            f"'{baseline.source_names}' vs '{comparison.source_names}'"
        )

        report = ClinicalComparisonReport(
            baseline_pipeline_id=baseline.pipeline_id,
            comparison_pipeline_id=comparison.pipeline_id,
            baseline_source=", ".join(baseline.source_names),
            comparison_source=", ".join(comparison.source_names),
        )

        b_nodes = baseline.nodes  if isinstance(baseline.nodes[0],  dict) else [n.model_dump() for n in baseline.nodes]  if baseline.nodes  else []
        c_nodes = comparison.nodes if isinstance(comparison.nodes[0], dict) else [n.model_dump() for n in comparison.nodes] if comparison.nodes else []

        # ── Step 1: Node matching ──────────────────────────────────
        matched_pairs, removed, added = self._matcher.match(b_nodes, c_nodes)

        # ── Step 2: Contradiction detection ───────────────────────
        contradiction_findings = self._contradict.detect(matched_pairs)
        report.findings.extend(contradiction_findings)

        # ── Step 3: Evidence drift ─────────────────────────────────
        drift_findings = self._evidence.analyse(removed, added, matched_pairs)
        report.findings.extend(drift_findings)

        # ── Step 4: Added recommendations (INFO) ──────────────────
        for n in added:
            if n.get("type") == "recommendation":
                report.findings.append(ComparisonFinding(
                    category=FindingCategory.ADDED_RECOMMENDATION,
                    severity=FindingSeverity.INFO,
                    title=f"New Recommendation: {n.get('label', n.get('id', ''))}",
                    description=n.get("description", ""),
                    comparison_node_id=n.get("id"),
                    clinical_impact=n.get("recommendation_text", ""),
                ))

        # ── Step 5: Pathway diff ───────────────────────────────────
        def _proto_to_dict(p):
            return p if isinstance(p, dict) else p.model_dump()

        b_proto = [_proto_to_dict(p) for p in (baseline.protocol_graphs  or [])]
        c_proto = [_proto_to_dict(p) for p in (comparison.protocol_graphs or [])]
        pathway_diffs, pathway_findings = self._pathway.compare(b_proto, c_proto)
        report.pathway_diffs = pathway_diffs
        report.findings.extend(pathway_findings)

        # ── Step 6: Stats + buckets ────────────────────────────────
        report.compute_stats()

        # ── Step 7: Executive summary ──────────────────────────────
        report.executive_summary = self._summariser.summarise(report)

        logger.info(
            f"[ComparisonEngine] Complete — "
            f"findings={report.total_findings} "
            f"risk={report.risk_score:.0f} "
            f"severity={report.overall_severity}"
        )
        return report


# ═══════════════════════════════════════════════════════════════════
# FASTAPI ROUTER
# ═══════════════════════════════════════════════════════════════════

router = APIRouter(
    prefix="/pipeline/compare",
    tags=["Clinical Graph Comparison"],
)

_engine: Optional[ClinicalGraphComparisonEngine] = None

def _get_engine() -> ClinicalGraphComparisonEngine:
    global _engine
    if _engine is None:
        _engine = ClinicalGraphComparisonEngine()
    return _engine

_writer = ClinicalGraphWriter()


def _guideline_source_from_str(s: str) -> GuidelineSource:
    try:
        return GuidelineSource(s.lower())
    except ValueError:
        return GuidelineSource.OTHER


# ─────────────────────────────────────────────────────────────
# GET COMPARISON OUTPUT
# ─────────────────────────────────────────────────────────────

@router.get("/report")
async def retrieve_comparison_output(
    doctor_id: str = Query(...),
    baseline_pipeline_id: str = Query(...),
    comparison_pipeline_id: str = Query(...),
):
    """
    Retrieve previously generated comparison report.
    """

    return await get_comparison_report(
        doctor_id=doctor_id,
        baseline_pipeline_id=baseline_pipeline_id,
        comparison_pipeline_id=comparison_pipeline_id,
    )


@router.get("/report/latest")
async def get_latest_comparison_report(
    doctor_id: str = Query(...),
    baseline_pipeline_id: str = Query(...),
):
    logger.info(
        f"[ComparisonReport] Fetching latest for doctor={doctor_id} "
        f"baseline={baseline_pipeline_id}"
    )

    # Debug: check what's actually in the collection
    count = comparison_collection.count_documents({"doctor_id": doctor_id})
    logger.info(f"[ComparisonReport] Total docs for doctor in collection: {count}")

    report = comparison_collection.find_one(
        {
            "doctor_id": doctor_id,
            "baseline_pipeline_id": baseline_pipeline_id,
        },
        sort=[("created_at", -1)],
    )

    if not report:
        logger.warning(
            f"[ComparisonReport] Not found — doctor={doctor_id} "
            f"baseline={baseline_pipeline_id}"
        )
        raise HTTPException(status_code=404, detail="No comparison report found.")

    report["_id"] = str(report["_id"])
    return report

# ── POST /pipeline/compare/{pipeline_id}  (file upload) ───────────

@router.post("/{pipeline_id}")
async def compare_pipeline_with_file(
    pipeline_id: str,
    doctor_id: str = Query(...),
    files: List[UploadFile] = File(...),
    guideline_source: str = Form(default="other"),
    version: str = Form(default=""),
):
    baseline = await _writer.load_pipeline_graph(
        doctor_id=doctor_id,
        pipeline_id=pipeline_id,
    )
    if baseline is None:
        raise HTTPException(404, detail=f"Pipeline '{pipeline_id}' not found for doctor '{doctor_id}'.")


    if not files:
        raise HTTPException(400, detail="No comparison files provided.")

    gs  = _guideline_source_from_str(guideline_source)
    ver = version.strip() or None

    # ── Build temporary comparison graph ──────────────────────────
    pipeline = AgenticGraphRAGPipeline()

    for upload in files:
        filename   = upload.filename or "comparison_document"
        file_bytes = await upload.read()
        gs_det     = gs if gs != GuidelineSource.OTHER else _detect_guideline_source(filename)
        from pathlib import Path
        ext = Path(filename).suffix.lower()
        src_type = (
            SourceType.PDF      if ext == ".pdf"            else
            SourceType.DOCUMENT if ext in (".docx", ".doc") else
            SourceType.TEXT
        )
        source = DocumentSource(
            source_type=src_type,
            guideline_source=gs_det,
            name=filename,
            version=ver,
        )
        try:
            if src_type == SourceType.PDF:
                pipeline.run_from_pdf(file_bytes, source)
            else:
                try:
                    text = file_bytes.decode("utf-8")
                except Exception:
                    text = file_bytes.decode("latin-1", errors="replace")
                pipeline.run_from_text(text, source)
        except Exception as exc:
            logger.exception(f"Comparison pipeline failed for {filename}")
            raise HTTPException(500, detail=str(exc))

    comparison = pipeline.graph
    if comparison is None:
        raise HTTPException(500, detail="Comparison pipeline produced no graph.")

    # ── Run comparison engine ──────────────────────────────────────
    try:
        report = _get_engine().compare(baseline, comparison)
    except Exception as exc:
        logger.exception("Comparison engine failed")
        raise HTTPException(500, detail=str(exc))

    # ── FIX: force the correct pipeline_id from the URL, not the graph object ──
    report.baseline_pipeline_id = pipeline_id

    await save_comparison_report(
        doctor_id=doctor_id,
        report=report,
    )

    return report.model_dump()

# ── POST /pipeline/compare/{pipeline_id}/url  (URL input) ─────────

@router.post("/{pipeline_id}/url")
async def compare_pipeline_with_url(
    pipeline_id: str,
    doctor_id: str = Query(...),
    url: str = Query(...),
    guideline_source: str = Query(default="other"),
    version: str = Query(default=""),
):
    """Compare an existing graph against a URL-sourced document."""
    baseline = await _writer.load_pipeline_graph(
        doctor_id=doctor_id,
        pipeline_id=pipeline_id,
    )
    if baseline is None:
        raise HTTPException(404, detail=f"Pipeline '{pipeline_id}' not found.")

    gs  = _guideline_source_from_str(guideline_source)
    ver = version.strip() or None

    pipeline = AgenticGraphRAGPipeline()
    source   = DocumentSource(
        source_type=SourceType.LINK,
        guideline_source=gs,
        name=url,
        version=ver,
    )
    try:
        await pipeline.run_from_url(url, source)
    except Exception as exc:
        raise HTTPException(500, detail=str(exc))

    comparison = pipeline.graph
    if comparison is None:
        raise HTTPException(500, detail="Comparison pipeline produced no graph.")

    try:
        report = _get_engine().compare(baseline, comparison)
    except Exception as exc:
        raise HTTPException(500, detail=str(exc))

    # ── FIX ──
    report.baseline_pipeline_id = pipeline_id

    await save_comparison_report(doctor_id=doctor_id, report=report)
    return report.model_dump()


# ── POST /pipeline/compare/graphs  (two pipeline IDs) ─────────────

@router.post("/graphs")
async def compare_two_stored_graphs(
    doctor_id: str = Query(...),
    baseline_pipeline_id: str = Query(...),
    compare_pipeline_id: str = Query(...),
):
    """Compare two already-stored pipeline graphs for the same doctor."""
    baseline = await _writer.load_pipeline_graph(
        doctor_id=doctor_id,
        pipeline_id=baseline_pipeline_id,
    )
    if baseline is None:
        raise HTTPException(404, detail=f"Baseline pipeline '{baseline_pipeline_id}' not found.")

    comparison = await _writer.load_pipeline_graph(
        doctor_id=doctor_id,
        pipeline_id=compare_pipeline_id,
    )
    if comparison is None:
        raise HTTPException(404, detail=f"Comparison pipeline '{compare_pipeline_id}' not found.")

    try:
        report = _get_engine().compare(baseline, comparison)
    except Exception as exc:
        raise HTTPException(500, detail=str(exc))

    # ── FIX: use the query param, not the graph object ──
    report.baseline_pipeline_id = baseline_pipeline_id
    report.comparison_pipeline_id = compare_pipeline_id

    await save_comparison_report(doctor_id=doctor_id, report=report)
    return report.model_dump()



# ─────────────────────────────────────────────────────────────
# SAVE COMPARISON REPORT
# ─────────────────────────────────────────────────────────────

async def save_comparison_report(
    doctor_id: str,
    report: ClinicalComparisonReport,
):
    import json
    # model_dump_json handles enums, datetimes cleanly
    data = json.loads(report.model_dump_json())
    data["doctor_id"] = doctor_id
    data["created_at"] = datetime.utcnow()

    logger.info(
        f"[ComparisonReport] Saving — id={report.id} "
        f"doctor={doctor_id} "
        f"baseline_pipeline_id={data.get('baseline_pipeline_id')!r}"   # ← verify this
    )

    try:
        result = comparison_collection.update_one(
            {"id": report.id},
            {"$set": data},
            upsert=True,
        )
        logger.info(
            f"[ComparisonReport] Saved report {report.id} for doctor {doctor_id} "
            f"upserted={result.upserted_id} modified={result.modified_count}"
        )
    except Exception as exc:
        logger.exception(f"[ComparisonReport] Failed to save {report.id}: {exc}")
        raise HTTPException(500, detail=str(exc))

    return {"status": "success", "comparison_id": report.id}
# ─────────────────────────────────────────────────────────────
# RETRIEVE COMPARISON REPORT
# ─────────────────────────────────────────────────────────────

async def get_comparison_report(
    doctor_id: str,
    baseline_pipeline_id: str,
    comparison_pipeline_id: str,
):
    """
    Retrieve stored comparison report.
    """

    report = comparison_collection.find_one({
        "doctor_id": doctor_id,
        "baseline_pipeline_id": baseline_pipeline_id,
        "comparison_pipeline_id": comparison_pipeline_id,
    })

    if not report:
        raise HTTPException(
            status_code=404,
            detail="Comparison report not found."
        )

    # Remove Mongo ObjectId
    report["_id"] = str(report["_id"])

    return report



