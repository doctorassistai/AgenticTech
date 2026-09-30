# clinical_agents.py
"""
Clinical Reasoning Agent + Clinical Autonomous Agent (v5 — evidence-ranked reasoning)
---------------------------------------------------------------------------------------
This version implements the evidence-priority model described in the
"Clinical Agent — Required Changes and Implementation Specification":

  1. The full extracted patient graph is always passed to the LLM.
  2. `QuestionAnalyzer.requires_data` remains a routing/coverage mechanism —
     it is never used to filter what the LLM receives.
  3. When the graph contains inconsistent information about the same
     clinical fact, the agent no longer treats a broad summary statement
     as automatically authoritative. Instead it:
         - collects evidence items with their SOURCE and SPECIFICITY
           (structured > specific/granular > broad summary > inference),
         - prefers specific evidence that is repeated across independent
           sections over a single broad statement,
         - and explicitly preserves uncertainty (asks for verification)
           when the evidence cannot be cleanly resolved.
  4. `clinical_picture` is a faithful synthesis of the graph — it does not
     silently resolve contradictions and does not replace the full graph.
  5. `recommended_next_steps` is only populated for recommendation/
     management-oriented questions.
  6. Nothing is hard-coded to a specific patient (e.g. "Cycle 1"). The
     evidence-ranking mechanism is general and topic-agnostic; today it is
     wired up for chemotherapy-cycle completion (the concrete example in
     the spec) but new topics can be added by supplying additional
     extractors — the ranking/verdict logic itself does not change.
  7. Nothing is emitted to the caller as a "conflict", "flag", or
     "reconciliation" block — inconsistency handling is internal guidance
     for the LLM only, expressed through `unresolved_data_issues` and the
     prose of `answer` / `clinical_picture` when genuinely unresolved.

Import:
    from clinical_agents import ClinicalReasoningAgent, ClinicalAutonomousAgent
    from clinical_agents import clear_agent_memory
"""
from __future__ import annotations

import json
import os
import re
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

import httpx
from loguru import logger
from langchain_groq import ChatGroq
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
API_BASE_URL = os.getenv("VITE_BACKEND_URL", "https://doctorassist.ai/api/")

PATIENT_CONTEXT_ENDPOINT = os.getenv(
    "PATIENT_CONTEXT_ENDPOINT",
    "hms/users/ai-legacy/documents/patient/{patient_id}/latest-clinical-state?doctor_id={doctor_id}",
)

reasoning_llm = ChatGroq(
    model="openai/gpt-oss-120b",
    temperature=0.0,
    groq_api_key=GROQ_API_KEY,
    max_tokens=5000,
)

ACTION_WHITELIST: Dict[str, bool] = {
    "flag_data_conflict": False,
    "notify_doctor": False,
    "create_followup_task": False,
    "hold_next_step": True,
    "schedule_next_step": True,
    "update_encounter_status": True,
}

MAX_HISTORY_TURNS = 8
STALE_SUMMARY_DAYS = 30


# ============================================================
# STEP 1 — INPUT VALIDATION
# ============================================================

@dataclass
class ValidationReport:
    ok: bool = True
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    missing_sections: List[str] = field(default_factory=list)
    empty_sections: List[str] = field(default_factory=list)
    stale_sections: List[str] = field(default_factory=list)
    details: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class QuestionValidation:
    ok: bool = True
    reason: str = ""
    is_empty: bool = False
    is_too_vague: bool = False
    word_count: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class InputValidator:
    REQUIRED_SECTIONS = ("conditions", "medications", "procedures")
    RECOMMENDED_SUMMARIES = (
        "lab_summary", "procedure_summary", "medication_summary",
        "vital_summary", "symptom_summary", "imaging_summary",
    )
    VAGUE_PATTERNS = (
        r"^\s*(what about|thoughts\??|any thoughts\??|hmm+|ok\??|okay\??)\s*$",
        r"^\s*(tell me more|continue|go on)\s*$",
    )

    def validate_graph(self, graph: Dict[str, Any]) -> ValidationReport:
        rep = ValidationReport()
        if not graph:
            rep.ok = False
            rep.errors.append("Patient graph is empty.")
            return rep

        if not graph.get("patient_id"):
            rep.errors.append("Patient graph has no patient_id.")

        for section in self.REQUIRED_SECTIONS:
            if section not in graph:
                rep.missing_sections.append(section)
                rep.warnings.append(f"Required section '{section}' is missing.")
            elif not graph.get(section):
                rep.empty_sections.append(section)
                rep.warnings.append(f"Required section '{section}' is empty.")

        for summary in self.RECOMMENDED_SUMMARIES:
            text = graph.get(summary, "") or ""
            if not text.strip():
                rep.empty_sections.append(summary)
                rep.warnings.append(f"Summary '{summary}' is empty.")

        encounter_date = graph.get("encounter_date")
        if encounter_date:
            age_days = self._age_in_days(encounter_date)
            if age_days is not None and age_days > STALE_SUMMARY_DAYS:
                rep.stale_sections.append("encounter")
                rep.warnings.append(
                    f"Patient encounter is {age_days} days old — clinical picture may be stale."
                )

        rep.ok = len(rep.errors) == 0
        rep.details["required_present"] = all(
            graph.get(s) for s in self.REQUIRED_SECTIONS
        )
        return rep

    def validate_question(self, query: str) -> QuestionValidation:
        q = (query or "").strip()
        v = QuestionValidation(word_count=len(q.split()))
        if not q:
            v.ok = False
            v.is_empty = True
            v.reason = "The doctor's question is empty."
            return v
        for pat in self.VAGUE_PATTERNS:
            if re.match(pat, q, re.IGNORECASE):
                v.ok = False
                v.is_too_vague = True
                v.reason = "The question is too vague to answer meaningfully."
                return v
        if v.word_count < 2 and len(q) < 6:
            v.ok = False
            v.is_too_vague = True
            v.reason = "The question is too short to determine intent."
        return v

    @staticmethod
    def _age_in_days(date_str: str) -> Optional[int]:
        for fmt in ("%Y-%m-%d", "%d-%b-%Y", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f"):
            try:
                dt = datetime.strptime(date_str[:len(fmt) + 6], fmt)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return (datetime.now(timezone.utc) - dt).days
            except Exception:
                continue
        return None


# ============================================================
# STEP 3 — QUESTION ANALYSIS
# ============================================================

@dataclass
class QuestionSpec:
    raw: str
    normalized: str
    intent: str
    target_entities: List[str] = field(default_factory=list)
    time_scope: str = "current"
    requires_data: List[str] = field(default_factory=list)
    is_broad: bool = False
    is_ambiguous: bool = False
    ambiguity_reason: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class QuestionAnalyzer:
    """
    NOTE: `requires_data` is a routing/coverage-check hint only. It must
    NEVER be used to filter which patient-context fields are sent to the
    LLM — the LLM always receives the full formatted patient graph
    (see `_format_patient_context`). This class only decides which fields
    the CoverageChecker should look at when deciding whether the graph
    has enough information to answer the question.
    """

    ENTITY_MAP: Dict[str, Tuple[List[str], str]] = {
        "chemo": (["procedure_summary", "medication_summary"], "chemotherapy"),
        "chemotherapy": (["procedure_summary", "medication_summary"], "chemotherapy"),
        "cycle": (["procedure_summary", "medication_summary"], "chemotherapy_cycles"),
        "cycles": (["procedure_summary", "medication_summary"], "chemotherapy_cycles"),
        "neoadjuvant": (["procedure_summary"], "chemotherapy"),
        "mastectomy": (["procedure_summary"], "surgery"),
        "surgery": (["procedure_summary"], "surgery"),
        "pathology": (["procedure_summary"], "pathology"),
        "histology": (["procedure_summary"], "pathology"),
        "stage": (["procedure_summary", "conditions"], "staging"),
        "staging": (["procedure_summary", "conditions"], "staging"),
        "tnm": (["procedure_summary"], "staging"),
        "wbc": (["lab_summary"], "wbc"),
        "white blood": (["lab_summary"], "wbc"),
        "hemoglobin": (["lab_summary"], "hemoglobin"),
        "platelet": (["lab_summary"], "platelets"),
        "lab": (["lab_summary"], "labs"),
        "labs": (["lab_summary"], "labs"),
        "blood": (["lab_summary"], "labs"),
        "medication": (["medications", "medication_summary"], "medications"),
        "medications": (["medications", "medication_summary"], "medications"),
        "drug": (["medications", "medication_summary"], "medications"),
        "prescription": (["medications", "medication_summary"], "medications"),
        "letrozole": (["medications", "medication_summary"], "medications"),
        "vital": (["vital_summary"], "vitals"),
        "vitals": (["vital_summary"], "vitals"),
        "bp": (["vital_summary"], "vitals"),
        "temperature": (["vital_summary"], "vitals"),
        "imaging": (["imaging_summary"], "imaging"),
        "mammography": (["imaging_summary"], "imaging"),
        "mammogram": (["imaging_summary"], "imaging"),
        "pet": (["imaging_summary"], "imaging"),
        "ct": (["imaging_summary"], "imaging"),
        "mri": (["imaging_summary"], "imaging"),
        "usg": (["imaging_summary"], "imaging"),
        "symptom": (["symptom_summary"], "symptoms"),
        "symptoms": (["symptom_summary"], "symptoms"),
        "pain": (["symptom_summary"], "symptoms"),
        "condition": (["conditions"], "conditions"),
        "diagnosis": (["conditions"], "conditions"),
        "response": (["procedure_summary", "imaging_summary"], "treatment_response"),
        "treatment response": (["procedure_summary", "imaging_summary"], "treatment_response"),
        "progress": (["procedure_summary", "imaging_summary"], "treatment_response"),
        "progression": (["procedure_summary", "imaging_summary"], "treatment_response"),
    }

    INTENT_PATTERNS: List[Tuple[str, re.Pattern]] = [
        ("response",    re.compile(r"\b(treatment response|respond|response|progress|progression)\b", re.I)),
        ("summarize",   re.compile(r"\b(summar(y|ize|ise)|overview|picture|status)\b", re.I)),
        ("trend",       re.compile(r"\b(trend|over time|evolution)\b", re.I)),
        ("compare",     re.compile(r"\b(compare|versus|vs\.?|difference|contrast)\b", re.I)),
        ("verify",      re.compile(r"\b(verify|confirm|check|double[- ]?check|validate)\b", re.I)),
        ("list",        re.compile(r"\b(list|enumerate|show me all|what are the)\b", re.I)),
        ("why",         re.compile(r"\b(why|reason for|cause of)\b", re.I)),
        ("recommend",   re.compile(r"\b(recommend|suggest|next step|plan|should we)\b", re.I)),
        ("identify",    re.compile(r"\b(identify|flag|find|spot|detect)\b", re.I)),
    ]

    HISTORICAL_RX = re.compile(r"\b(past|previous|historical|over time|history of|earlier|before)\b", re.I)
    SPECIFIC_DATE_RX = re.compile(
        r"\b(on\s+)?(\d{1,2}[-\s][A-Za-z]{3}[-\s]\d{4}|\d{4}-\d{2}-\d{2})\b"
    )

    def analyze(self, query: str) -> QuestionSpec:
        q = (query or "").strip()
        norm = q.lower()
        spec = QuestionSpec(raw=q, normalized=norm, intent="unknown")

        for intent, pat in self.INTENT_PATTERNS:
            if pat.search(norm):
                spec.intent = intent
                break
        if spec.intent == "unknown":
            spec.is_broad = True

        if re.search(r"\b(overview|overall|summar|full picture|clinical picture)\b", norm, re.I):
            spec.is_broad = True

        required: List[str] = []
        entities: List[str] = []
        for kw, (fields, canonical) in self.ENTITY_MAP.items():
            if re.search(rf"\b{re.escape(kw)}\b", norm):
                required.extend(fields)
                entities.append(canonical)

        spec.target_entities = sorted(set(entities))
        spec.requires_data = sorted(set(required))

        if not required and not spec.is_broad:
            spec.is_ambiguous = True
            spec.ambiguity_reason = "Could not map the question to specific clinical entities."

        if self.SPECIFIC_DATE_RX.search(norm):
            spec.time_scope = "specific_date"
        elif self.HISTORICAL_RX.search(norm):
            spec.time_scope = "historical"

        return spec


# ============================================================
# STEP 5 — COVERAGE CHECK
# ============================================================

@dataclass
class CoverageResult:
    fully_covered: bool
    missing_fields: List[str] = field(default_factory=list)
    reason: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class CoverageChecker:
    """
    Answers "does the graph contain the fields needed to answer this
    question?" — it never decides which fields are sent to the LLM. The
    LLM always receives the complete extracted context regardless of the
    outcome here.
    """

    def check(self, spec: QuestionSpec, graph: Dict[str, Any]) -> CoverageResult:
        if not spec.requires_data:
            return CoverageResult(fully_covered=True)
        missing: List[str] = []
        for field_name in spec.requires_data:
            value = graph.get(field_name)
            if value is None:
                missing.append(field_name)
            elif isinstance(value, (list, dict)) and len(value) == 0:
                missing.append(field_name)
            elif isinstance(value, str) and not value.strip():
                missing.append(field_name)
        if not missing:
            return CoverageResult(fully_covered=True)
        return CoverageResult(
            fully_covered=False,
            missing_fields=missing,
            reason=(
                f"The question requires data from {missing}, but the patient "
                f"graph has no content in those fields."
            ),
        )


# ============================================================
# STEP 7 — POST-LLM VERIFICATION (evidence only)
# ============================================================

@dataclass
class VerificationResult:
    ok: bool
    removed_claims: List[str] = field(default_factory=list)
    reason: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class PostLLMVerifier:
    """
    Validates that every evidence entry cites a known source field.

    Future improvement (per spec §14): verify not just that the source
    name is valid, but that the claim text is actually supported by the
    content of that source field. Left as a hook (`_claim_supported_by_source`)
    so it can be filled in without changing the calling contract.
    """

    KNOWN_SOURCES = {
        "conditions", "medications", "procedures",
        "lab_summary", "procedure_summary", "medication_summary",
        "vital_summary", "symptom_summary", "imaging_summary",
    }

    def verify(self, parsed: Dict[str, Any], graph: Dict[str, Any]) -> VerificationResult:
        evidence = parsed.get("evidence") or []
        cleaned: List[Dict[str, Any]] = []
        removed: List[str] = []
        for e in evidence:
            src = (e.get("source") or "").strip().lower()
            claim = e.get("claim", "")
            if src not in self.KNOWN_SOURCES:
                removed.append(claim or f"unknown source '{src}'")
                continue
            cleaned.append(e)
        parsed["evidence"] = cleaned
        return VerificationResult(
            ok=len(removed) == 0,
            removed_claims=removed,
            reason=("Some evidence entries cited unknown sources and were removed."
                    if removed else ""),
        )

    def _claim_supported_by_source(self, claim: str, source_text: str) -> bool:
        """Hook for a future content-level check. Currently a no-op that
        always returns True (source-name validity is the only check
        performed today)."""
        return True


# ============================================================
# EVIDENCE MODEL — general specificity/ranking mechanism
# ============================================================
#
# This is the general mechanism required by spec §4–§7: rather than
# hard-coding a rule for any one patient or fact, evidence about a given
# clinical topic is collected as a list of EvidenceItem records, each
# tagged with a SOURCE and a SPECIFICITY tier. A topic-agnostic ranking
# function then decides whether the graph supports one value confidently,
# prefers a repeated/specific value over a conflicting broad statement, or
# must be left unresolved.
#
# New clinical topics (surgery dates, staging, pathology, medication
# status, lab values, imaging findings, ...) can be added by writing a
# small extractor that emits EvidenceItem objects for that topic — the
# ranking logic itself does not need to change.

SPECIFICITY_WEIGHTS: Dict[str, int] = {
    "structured": 3,   # explicit structured fields, e.g. completedCycles: 1
    "specific": 2,      # granular, per-entry documentation (per-drug, per-cycle)
    "broad": 1,          # a single summary/aggregate statement
    "inferred": 0,        # a value the agent would have to guess/infer — never used to override
}


@dataclass
class EvidenceItem:
    source: str          # which patient-context field this came from
    topic: str            # canonical topic, e.g. "chemotherapy_cycles"
    specificity: str       # one of SPECIFICITY_WEIGHTS keys
    value: Any               # normalized comparable value (e.g. an int, or a frozenset)
    statement: str             # the raw text this was extracted from


@dataclass
class EvidenceVerdict:
    topic: str
    resolved: bool
    preferred_value: Optional[Any]
    note: str


class EvidenceRanker:
    """
    Topic-agnostic ranking over a list of EvidenceItem for a single topic.

    Rule (spec §4): specific/repeated evidence > single broad summary >
    general inference. Inference is never used to override documented
    evidence, so it never wins here — it is only included, when present,
    to explain a genuinely unresolved case.
    """

    def rank(self, topic: str, items: List[EvidenceItem]) -> Optional[EvidenceVerdict]:
        if not items:
            return None

        granular = [i for i in items if i.specificity in ("structured", "specific")]
        broad = [i for i in items if i.specificity == "broad"]

        if not granular and not broad:
            return None  # nothing but low-confidence inference — say nothing

        # Group granular evidence by value, weighting structured > specific,
        # and counting how many *independent sources* support each value.
        support: Dict[Any, Dict[str, Any]] = {}
        for it in granular:
            bucket = support.setdefault(it.value, {"sources": set(), "weight": 0, "statements": []})
            bucket["sources"].add(it.source)
            bucket["weight"] += SPECIFICITY_WEIGHTS[it.specificity]
            bucket["statements"].append(it.statement)

        broad_values = {}
        for it in broad:
            b = broad_values.setdefault(it.value, {"sources": set(), "statements": []})
            b["sources"].add(it.source)
            b["statements"].append(it.statement)

        if not support:
            # Only a broad statement exists — nothing specific to compare it
            # against, so there is no basis for a note either way.
            return None

        # Determine the best-supported granular value: most independent
        # sources first, then total specificity weight as a tiebreaker.
        ranked_values = sorted(
            support.items(),
            key=lambda kv: (len(kv[1]["sources"]), kv[1]["weight"]),
            reverse=True,
        )
        top_value, top_info = ranked_values[0]
        runner_up = ranked_values[1] if len(ranked_values) > 1 else None

        # Case A: granular evidence disagrees with itself and no value has a
        # clear lead (same source-count and weight) — genuinely unresolved.
        if runner_up is not None and len(runner_up[1]["sources"]) == len(top_info["sources"]) \
                and runner_up[1]["weight"] == top_info["weight"]:
            return EvidenceVerdict(
                topic=topic,
                resolved=False,
                preferred_value=None,
                note=(
                    f"The detailed records disagree with each other on {topic.replace('_', ' ')}: "
                    f"one set of entries documents {top_value!r}, another documents "
                    f"{runner_up[0]!r}. Neither is clearly more specific or more repeated than "
                    f"the other, so this should be treated as unresolved and verified against "
                    f"the source record rather than resolved automatically."
                ),
            )

        repeated = len(top_info["sources"]) > 1

        # Case B: no conflicting broad statement — nothing to reconcile.
        conflicting_broad = [v for v in broad_values if v != top_value]
        if not conflicting_broad:
            return None

        # Case C: granular value conflicts with a broad summary value.
        # Prefer the granular (specific/repeated) evidence, but phrase it as
        # a documentation point requiring verification, not as a resolved
        # fact and not as a "conflict"/flag.
        broad_desc = ", ".join(f"{v!r}" for v in conflicting_broad)
        repetition_desc = (
            f"repeatedly documented across {len(top_info['sources'])} independent sections"
            if repeated else "documented in one section"
        )
        note = (
            f"The supplied records contain different {topic.replace('_', ' ')} information. "
            f"Detailed, granular documentation is {repetition_desc} as {top_value!r}, while a "
            f"broader summary statement reports {broad_desc}. Prefer the repeated specific "
            f"evidence when summarizing the documented state, but do not claim the broader "
            f"figure without supporting detail. The exact value should be verified against the "
            f"underlying record."
        )
        return EvidenceVerdict(
            topic=topic,
            resolved=repeated,  # only call it "resolved" when specific evidence is repeated
            preferred_value=top_value,
            note=note,
        )


@dataclass
class ConsistencyNote:
    """Internal-only note passed to the LLM as reasoning guidance. Never
    returned to the caller as a 'conflict', 'flag', or 'reconciliation'
    block."""
    topic: str
    note: str


class ChemotherapyCycleExtractor:
    """
    Concrete extractor for the chemotherapy-cycle-completion topic — the
    worked example in the spec. Produces EvidenceItem objects tagged by
    source and specificity; contains no patient-specific hard-coding
    (no assumption about which cycle number is "correct").
    """

    TOPIC = "chemotherapy_cycles"

    _CYCLE_COMPLETED_RX = re.compile(
        r"cycle(?:s)?\s+(\d+)\s*(?:[-\u2013]\s*(\d+))?\s*"
        r"(?:was|were|is|are|:)?\s*(?:completed|administered|given|done)",
        re.IGNORECASE,
    )
    _TOTAL_CYCLES_COMPLETED_RX = re.compile(
        r"(?:all\s+)?(\d+)\s+cycles?\b[^.]{0,60}?"
        r"(?:completed|administered|given|done)",
        re.IGNORECASE,
    )
    _TOTAL_CYCLES_COMPLETED_RX_ALT = re.compile(
        r"(?:completed|administered|given|done)\s*\(?(?:all\s+)?(\d+)\s+cycles?",
        re.IGNORECASE,
    )
    # Per-drug, per-cycle granular entries, e.g.:
    #   "Doxorubicin — COMPLETED (Cycle 1)"
    _DRUG_CYCLE_STATUS_RX = re.compile(
        r"[\w][\w\s\-]{1,40}?\s*[—\-:]\s*(COMPLETED|DONE|ADMINISTERED|GIVEN)\s*\(?\s*"
        r"cycle\s*(\d+)\s*\)?",
        re.IGNORECASE,
    )
    # Structured symptom/telemetry-style fields, e.g.:
    #   "currentCycle: 1 completedCycles: 1 plannedCycles: 8"
    _STRUCTURED_COMPLETED_RX = re.compile(
        r"completedCycles\s*[:=]\s*(\d+)", re.IGNORECASE
    )

    def extract(self, graph: Dict[str, Any]) -> List[EvidenceItem]:
        items: List[EvidenceItem] = []
        text_sources = {
            "procedure_summary": graph.get("procedure_summary", "") or "",
            "medication_summary": graph.get("medication_summary", "") or "",
            "symptom_summary": graph.get("symptom_summary", "") or "",
        }

        for source, text in text_sources.items():
            if not text:
                continue

            # Structured field — highest specificity.
            for m in self._STRUCTURED_COMPLETED_RX.finditer(text):
                items.append(EvidenceItem(
                    source=source, topic=self.TOPIC, specificity="structured",
                    value=int(m.group(1)), statement=m.group(0),
                ))

            # Per-drug, per-cycle granular entries.
            for m in self._DRUG_CYCLE_STATUS_RX.finditer(text):
                items.append(EvidenceItem(
                    source=source, topic=self.TOPIC, specificity="specific",
                    value=int(m.group(2)), statement=m.group(0),
                ))

            # Generic "Cycle N [-M] completed" phrasing.
            for m in self._CYCLE_COMPLETED_RX.finditer(text):
                start = int(m.group(1))
                end = int(m.group(2)) if m.group(2) else start
                items.append(EvidenceItem(
                    source=source, topic=self.TOPIC, specificity="specific",
                    value=end, statement=m.group(0),
                ))

            # Broad aggregate statement, e.g. "All 8 cycles administered".
            for n in (
                self._TOTAL_CYCLES_COMPLETED_RX.findall(text)
                + self._TOTAL_CYCLES_COMPLETED_RX_ALT.findall(text)
            ):
                items.append(EvidenceItem(
                    source=source, topic=self.TOPIC, specificity="broad",
                    value=int(n), statement=f"{n} cycles completed/administered",
                ))

        return items


class ConsistencyAnalyzer:
    """
    Runs topic extractors over the graph, ranks the resulting evidence with
    EvidenceRanker, and produces internal-only ConsistencyNote guidance.
    Nothing here is surfaced to the caller as a conflict/flag — the notes
    only shape how the LLM phrases certainty and unresolved data.
    """

    def __init__(self):
        self._extractors = [ChemotherapyCycleExtractor()]
        self._ranker = EvidenceRanker()

    def analyze(self, graph: Dict[str, Any]) -> List[ConsistencyNote]:
        notes: List[ConsistencyNote] = []

        for extractor in self._extractors:
            items = extractor.extract(graph)
            if not items:
                continue
            verdict = self._ranker.rank(extractor.TOPIC, items)
            if verdict is not None:
                notes.append(ConsistencyNote(topic=verdict.topic, note=verdict.note))

        # General completion-language check (kept from the prior version,
        # reframed to match the new evidence-priority rule: this is only
        # ever phrased as "verify", never as one source being automatically
        # authoritative over another).
        proc = (graph.get("procedure_summary", "") or "").lower()
        med = (graph.get("medication_summary", "") or "").lower()
        symp = (graph.get("symptom_summary", "") or "").lower()
        completion_markers = ("completed", "all cycles administered", "regimen complete", "finished")
        pending_markers = ("planned", "upcoming", "scheduled", "to be given")
        proc_complete = any(m in proc for m in completion_markers)
        med_or_symp_pending = any(m in med for m in pending_markers) or \
                               any(m in symp for m in pending_markers)
        if proc_complete and med_or_symp_pending:
            notes.append(ConsistencyNote(
                topic="treatment_completion_status",
                note=(
                    "The procedure summary describes the regimen as completed, while the "
                    "medication/symptom summaries still reference planned cycles. Do not "
                    "assume either section is automatically authoritative — describe the "
                    "documented state from the more specific/granular entries and note that "
                    "the exact regimen completion status should be verified against the "
                    "chemotherapy administration record."
                ),
            ))

        return notes


def _format_consistency_notes(notes: List[ConsistencyNote]) -> str:
    """Render internal consistency notes as guidance for the LLM. The block
    is explicitly marked as NOT to be echoed back as a conflict/flag."""
    if not notes:
        return ""
    lines = [
        "=== INTERNAL EVIDENCE NOTES (for your reasoning only — do NOT echo",
        "    these as 'conflicts', 'flags', or a 'reconciliation report' in",
        "    your answer; use them only to decide which evidence to prefer",
        "    and how to phrase any remaining uncertainty) ===",
    ]
    for i, n in enumerate(notes, 1):
        lines.append(f"\n[{i}] topic={n.topic}")
        lines.append(f"    {n.note}")
    lines.append("=== END INTERNAL EVIDENCE NOTES ===")
    return "\n".join(lines)


# ============================================================
# GRAPH EXTRACTION + FORMATTERS
# ============================================================

def _extract_patient_graph(raw: Dict[str, Any]) -> Dict[str, Any]:
    data = raw.get("data", raw) or {}
    profile = data.get("profile", [])
    summaries = data.get("summaries", [])

    conditions, medications, procedures = [], [], []
    for block in profile:
        cat = block.get("category")
        items = block.get("items", [])
        if cat == "ACTIVE_CONDITIONS":
            conditions = items
        elif cat == "CURRENT_MEDICATIONS":
            medications = items
        elif cat in ("PREVIOUS_PROCEDURES", "PROCEDURES"):
            procedures = items

    by_type: Dict[str, str] = {}
    for s in summaries:
        t = s.get("type")
        latest = s.get("latest_summary", {}) or {}
        by_type[t] = latest.get("summary", "")

    return {
        "patient_id": data.get("patient_id") or raw.get("patient_id"),
        "doctor_name": data.get("doctor_name"),
        "doctor_specialty": data.get("doctor_specialty"),
        "encounter_status": data.get("encounter_status"),
        "encounter_date": data.get("encounter_date"),
        "conditions": conditions,
        "medications": medications,
        "procedures": procedures,
        "lab_summary": by_type.get("LAB_SUMMARY", ""),
        "procedure_summary": by_type.get("PROCEDURE_SUMMARY", ""),
        "medication_summary": by_type.get("MEDICATION_SUMMARY", ""),
        "vital_summary": by_type.get("VITAL_SUMMARY", ""),
        "symptom_summary": by_type.get("SYMPTOM_SUMMARY", ""),
        "imaging_summary": by_type.get("IMAGING_SUMMARY", ""),
    }


def _format_patient_context(graph: Dict[str, Any]) -> str:
    # This is the COMPLETE extracted patient graph — always sent to the LLM
    # in full, regardless of QuestionSpec.requires_data or coverage results.
    return (
        "Patient conditions: "
        f"{json.dumps(graph.get('conditions', []), default=str)}\n"
        "Current medications: "
        f"{json.dumps(graph.get('medications', []), default=str)}\n"
        "Procedures: "
        f"{json.dumps(graph.get('procedures', []), default=str)}\n\n"
        f"Lab summary:\n{graph.get('lab_summary', '')}\n\n"
        f"Procedure summary:\n{graph.get('procedure_summary', '')}\n\n"
        f"Medication summary:\n{graph.get('medication_summary', '')}\n\n"
        f"Vitals summary:\n{graph.get('vital_summary', '')}\n\n"
        f"Symptom summary:\n{graph.get('symptom_summary', '')}\n\n"
        f"Imaging summary:\n{graph.get('imaging_summary', '')}\n"
    )


def _format_question_spec(spec: QuestionSpec) -> str:
    return (
        "=== QUESTION ANALYSIS ===\n"
        f"intent: {spec.intent}\n"
        f"target_entities: {spec.target_entities}\n"
        f"time_scope: {spec.time_scope}\n"
        f"requires_data: {spec.requires_data}\n"
        f"is_broad: {spec.is_broad}\n"
        f"is_ambiguous: {spec.is_ambiguous}\n"
        + (f"ambiguity_reason: {spec.ambiguity_reason}\n" if spec.ambiguity_reason else "")
        + "=== END QUESTION ANALYSIS ==="
    )


# ============================================================
# CONTEXT FETCHER
# ============================================================

class PatientContextFetcher:
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=60.0)

    async def fetch(self, patient_id: str, doctor_id: str) -> Dict[str, Any]:
        url = f"{API_BASE_URL}{PATIENT_CONTEXT_ENDPOINT.format(patient_id=patient_id, doctor_id=doctor_id)}"
        try:
            resp = await self.client.get(url)
            if resp.status_code == 200:
                return _extract_patient_graph(resp.json())
            logger.error(f"[PatientContextFetcher] {resp.status_code} {resp.text[:300]}")
        except Exception as e:
            logger.error(f"[PatientContextFetcher] fetch failed: {e}")
        return {}


# ============================================================
# MEMORY
# ============================================================

_AGENT_MEMORY: Dict[str, Dict[str, List[Dict[str, str]]]] = {}


def _get_memory(conversation_id: str, agent: str) -> List[Dict[str, str]]:
    entry = _AGENT_MEMORY.setdefault(conversation_id, {"reasoning": [], "autonomous": []})
    return entry.setdefault(agent, [])


def _append_memory(conversation_id: str, agent: str, role: str, content: str) -> None:
    if not conversation_id:
        return
    hist = _get_memory(conversation_id, agent)
    hist.append({"role": role, "content": content})
    if len(hist) > MAX_HISTORY_TURNS * 2:
        del hist[: len(hist) - MAX_HISTORY_TURNS * 2]


def _build_langchain_messages(history: List[Dict[str, str]]) -> List[Any]:
    msgs: List[Any] = []
    for m in history:
        if m.get("role") == "user":
            msgs.append(HumanMessage(content=m.get("content", "")))
        else:
            msgs.append(AIMessage(content=m.get("content", "")))
    return msgs


def clear_agent_memory(conversation_id: str) -> None:
    _AGENT_MEMORY.pop(conversation_id, None)


# ============================================================
# SYSTEM PROMPTS
# ============================================================

REASONING_SYSTEM_PROMPT = """
You are a clinical reasoning assistant supporting an oncologist. You are
NOT making a diagnosis or ordering anything — you only reason over the
patient data given to you and produce a clear, medically-grounded answer
for the doctor to review.

You will receive, on every turn:
  1. The COMPLETE extracted patient context (the full patient graph).
  2. A QUESTION ANALYSIS block — this tells you what the doctor is asking
     for and which entities matter. It is a routing hint, not a filter:
     you should still use any part of the full patient context that is
     relevant, not only the fields it names.
  3. INTERNAL EVIDENCE NOTES — guidance on how different sections of the
     graph relate to each other when they describe the same clinical fact.
     These are NOT conflicts. Do NOT surface them as a "conflict", "flag",
     "reconciliation report", or "high-severity" item. Use them only to
     decide which evidence to prefer and how to phrase uncertainty.
  4. The running conversation history.
  5. The doctor's current question.

HOW TO READ THE PATIENT DATA:
- Use all provided patient-context sections relevant to the question, not
  just the ones a keyword match would suggest.
- Do not invent, silently correct, or silently reconcile contradictory
  data. When multiple sections describe the same clinical fact, compare
  them before answering.
- Prefer specific, granular documentation (per-cycle, per-drug, structured
  fields, dated entries) over a broad summary statement.
- Prefer repeated, consistent specific statements over a single
  contradictory broad statement.
- Do not treat a summary statement as automatically authoritative merely
  because it is a summary — only treat it as authoritative when the
  record explicitly establishes that it is (e.g. it is clearly the final,
  reconciled note and nothing more specific contradicts it).
- Do not infer that treatment was completed merely because a treatment
  plan specifies a certain number of planned cycles. A plan is not a
  record of what was delivered.
- If the evidence remains genuinely unresolved after comparing sources,
  clearly state what is documented and what requires verification —
  do not manufacture a clinical fact from assumption or guesswork.
- When describing treatment response, ground it in pathology (residual
  disease, nodal status, margins, stage), imaging changes, labs/vitals
  trends, and the documented regimen — not inference from the plan alone.

IMPORTANT SAFETY DISTINCTION:
A documentation statement that a patient is "not ready for" a treatment
(e.g. chemotherapy) must NOT automatically be interpreted as that
treatment being medically contraindicated. Distinguish, based only on
what the record actually supports, between: patient preference, treatment
toxicity, incomplete staging, pending investigations, postoperative
recovery, organ dysfunction, performance status, a documented clinical
contraindication, and an administrative/scheduling issue. Only state the
reason the source data actually supports.

ANSWER STYLE:
- `answer`: direct and clinically useful, 4-8 sentences. Actually answer the
  question asked, with enough clinical detail that a doctor could act on it
  without needing to open the other fields — don't just gesture at the topic.
- `clinical_picture`: provide a concise but clinically useful synthesis of
  the patient graph — major diagnosis, disease extent/stage, treatment
  history, surgery, pathology, relevant laboratory/imaging findings, and
  current treatment phase. Use all relevant available evidence. If
  clinically important information is inconsistent, do NOT silently choose
  one value — describe the supported specific evidence and identify what
  requires verification. Do not invent missing information. This is a
  faithful summary, not a substitute for the full graph.
- `risk_flags`: only include items that are genuinely clinically notable
  (e.g. residual nodal disease, imaging progression, actionable toxicity).
  A documentation difference between two summaries is a data-quality point,
  not a clinical risk — do not create a flag for it.
- `recommended_next_steps`: provide concrete, ordered clinical next steps
  ONLY when the doctor's question explicitly asks for a recommendation,
  management plan, or next step, or when an immediate clinically relevant
  action is clearly required by the documented data. Otherwise return an
  empty array [].

Do not manufacture recommendations just to populate this field.

Examples:
- Factual question → []
- Lab/value question → []
- Medication/list question → []
- Summary question → []
- Comparison question → []
- "Why" question → []
- Recommendation/management question → provide appropriate next steps.
- `unresolved_data_issues`: only genuine missing, unclear, or unresolved
  data — not normal documentation wording differences.
- `confidence`: high | medium | low — reflect how well the graph supports
  the answer.
- `evidence`: every entry must have `claim` and `source` where `source` is
  one of: conditions, medications, procedures, lab_summary,
  procedure_summary, medication_summary, vital_summary, symptom_summary,
  imaging_summary.

Return ONLY valid JSON with EXACTLY these keys:

{
  "answer": "...",
  "clinical_picture": "...",
  "risk_flags": [{"flag": "", "why": "", "severity": "low|medium|high"}],
  "recommended_next_steps": [""],
  "unresolved_data_issues": [""],
  "confidence": "low|medium|high",
  "evidence": [{"claim": "", "source": "<field name>"}]
}
"""


AUTONOMOUS_SYSTEM_PROMPT = """
You are an autonomous clinical assistant supporting an oncologist.

You will receive:
  1. The COMPLETE extracted patient context (the full patient graph).
  2. A QUESTION ANALYSIS block describing what the doctor wants. It is a
     routing hint, not a filter — use any relevant part of the full graph.
  3. INTERNAL EVIDENCE NOTES — guidance only, NOT conflicts. Do NOT echo
     them as "conflicts", "flags", or a "reconciliation report".
  4. The running conversation history.
  5. The doctor's current question.

HOW TO READ THE PATIENT DATA:
- Do not invent, silently correct, or silently reconcile contradictory
  data. Prefer specific, granular, repeated documentation over a single
  broad summary statement. Do not treat a summary as automatically
  authoritative unless the record explicitly establishes it as such.
- Do not infer treatment completion merely from a planned-cycle count.
- If evidence is genuinely unresolved, say what is documented and what
  needs verification rather than guessing.
- A statement that a patient is "not ready for" a treatment is not the
  same as that treatment being medically contraindicated — only state the
  reason the record actually supports (see the reasoning agent's safety
  distinction: preference, toxicity, incomplete staging, pending workup,
  recovery, organ dysfunction, performance status, documented
  contraindication, or administrative/scheduling issue).

BEHAVIOUR:
- Produce a clean clinical answer based on the graph.
- Only propose actions that are directly justified by the data and the
  doctor's question. Prefer low-risk informational actions
  (flag_data_conflict, notify_doctor, create_followup_task) for
  documentation gaps. Only propose care-pathway changes (hold_next_step,
  schedule_next_step, update_encounter_status) when the data clearly
  warrants them.
- Do NOT invent conflicts. Do NOT label normal documentation variance as a
  "conflict" or "high severity". If something needs verification, phrase
  it as "verify against the administration/source record" — a routine
  documentation step, not an alarm.
- `recommended_next_steps` follows the same rule as the reasoning agent:
  only populate it when the question is recommendation/management-oriented.

Return ONLY valid JSON:

{
  "answer": "...",
  "clinical_picture": "...",
  "risk_flags": [{"flag": "", "why": "", "severity": "low|medium|high"}],
  "recommended_next_steps": [""],
  "unresolved_data_issues": [""],
  "confidence": "low|medium|high",
  "evidence": [{"claim": "", "source": "<field name>"}],
  "proposed_actions": [
     {
        "type": "flag_data_conflict | notify_doctor | create_followup_task | hold_next_step | schedule_next_step | update_encounter_status",
        "description": "Short human-readable description.",
        "topic": "optional"
     }
  ]
}
"""


# ============================================================
# CLARIFICATION RESPONSE HELPER
# ============================================================

def _build_clarification_response(
    *, patient_id: str, doctor_id: str, query: str,
    reason: str, kind: str,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return {
        "status": "clarification_needed",
        "generated_at": datetime.now().isoformat(),
        "patient_id": patient_id,
        "doctor_id": doctor_id,
        "query": query,
        "clarification": {"kind": kind, "reason": reason},
        "answer": reason,
        "clinical_picture": "",
        "risk_flags": [],
        "recommended_next_steps": [],
        "unresolved_data_issues": [reason],
        "confidence": "low",
        "evidence": [],
        **(extra or {}),
    }


# ============================================================
# REASONING AGENT
# ============================================================

class ClinicalReasoningAgent:
    def __init__(self):
        self.context_fetcher = PatientContextFetcher()
        self.validator = InputValidator()
        self.analyzer = QuestionAnalyzer()
        self.coverage = CoverageChecker()
        self.verifier = PostLLMVerifier()
        self.consistency = ConsistencyAnalyzer()

    async def run(
        self,
        patient_id: str,
        doctor_id: str,
        query: str = "",
        conversation_id: str = "",
        context_override: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:

        # STEP 1 — graph validation
        graph = context_override or await self.context_fetcher.fetch(patient_id, doctor_id)
        graph_validation = self.validator.validate_graph(graph)

        # STEP 2 — question validation
        question_validation = self.validator.validate_question(query)
        if question_validation.is_empty:
            return _build_clarification_response(
                patient_id=patient_id, doctor_id=doctor_id, query=query,
                kind="empty_question",
                reason="The doctor's question is empty. Please provide a specific question.",
                extra={"graph_validation": graph_validation.to_dict()},
            )
        if question_validation.is_too_vague:
            return _build_clarification_response(
                patient_id=patient_id, doctor_id=doctor_id, query=query,
                kind="vague_question",
                reason=("The question is too vague to answer meaningfully. "
                        "Try asking about a specific topic (e.g. chemotherapy "
                        "status, WBC trend, imaging response)."),
                extra={"graph_validation": graph_validation.to_dict()},
            )

        # STEP 3 — question analysis (routing/coverage hint only)
        spec = self.analyzer.analyze(query)

        # STEP 4 — internal evidence/consistency notes (NOT emitted to caller)
        consistency_notes = self.consistency.analyze(graph)

        # STEP 5 — coverage check (does NOT filter what's sent to the LLM)
        coverage = self.coverage.check(spec, graph)

        # STEP 6 — LLM call (always receives the FULL patient graph)
        effective_query = (query or "").strip() or (
            "Give me an overall clinical reasoning summary of this patient."
        )
        memory = _get_memory(conversation_id, "reasoning") if conversation_id else []

        messages: List[Any] = [SystemMessage(content=REASONING_SYSTEM_PROMPT)]
        messages.extend(_build_langchain_messages(memory))
        messages.append(HumanMessage(content=(
            f"{_format_patient_context(graph)}\n\n"
            f"{_format_question_spec(spec)}\n\n"
            f"{_format_consistency_notes(consistency_notes)}\n\n"
            f"COVERAGE: {json.dumps(coverage.to_dict(), default=str)}\n\n"
            f"Doctor's question:\n{effective_query}\n\n"
            "Produce your JSON response now."
        )))

        try:
            response = await reasoning_llm.ainvoke(messages)
            content = response.content.strip()
            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]
            parsed = json.loads(content)
            parsed = _remove_markdown_asterisks(parsed)
            # Only recommendation-oriented questions should produce next steps.
            RECOMMENDATION_INTENTS = {"recommend"}

            if spec.intent not in RECOMMENDATION_INTENTS:
                parsed["recommended_next_steps"] = []
        except Exception as e:
            logger.error(f"[ClinicalReasoningAgent] LLM failed: {e}")
            return {"status": "error", "error": str(e)}

        # STEP 7 — post-LLM verification (evidence only)
        verification = self.verifier.verify(parsed, graph)

        if not coverage.fully_covered and parsed.get("confidence") == "high":
            parsed["confidence"] = "medium"

        if conversation_id:
            _append_memory(conversation_id, "reasoning", "user", effective_query)
            _append_memory(conversation_id, "reasoning", "assistant", json.dumps(parsed))

        return {
            "status": "success",
            "generated_at": datetime.now().isoformat(),
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "query": effective_query,
            "pipeline": {
                "graph_validation": graph_validation.to_dict(),
                "question_validation": question_validation.to_dict(),
                "question_analysis": spec.to_dict(),
                "coverage": coverage.to_dict(),
                "post_llm_verification": verification.to_dict(),
            },
            # NOTE: no `reconciliation` block. No conflicts. No flags.
            **parsed,
        }


# ============================================================
# AUTONOMOUS AGENT
# ============================================================

class ClinicalAutonomousAgent:
    def __init__(self):
        self.context_fetcher = PatientContextFetcher()
        self.validator = InputValidator()
        self.analyzer = QuestionAnalyzer()
        self.coverage = CoverageChecker()
        self.verifier = PostLLMVerifier()
        self.consistency = ConsistencyAnalyzer()
        self.client = httpx.AsyncClient(timeout=60.0)

    async def _reason_with_actions(
        self,
        graph: Dict[str, Any],
        spec: QuestionSpec,
        coverage: CoverageResult,
        graph_validation: ValidationReport,
        consistency_notes: List[ConsistencyNote],
        query: str,
        conversation_id: str,
    ) -> Dict[str, Any]:
        effective_query = (query or "").strip() or (
            "Review this patient and propose the next actions you would take."
        )
        memory = _get_memory(conversation_id, "autonomous") if conversation_id else []

        messages: List[Any] = [SystemMessage(content=AUTONOMOUS_SYSTEM_PROMPT)]
        messages.extend(_build_langchain_messages(memory))
        messages.append(HumanMessage(content=(
            f"{_format_patient_context(graph)}\n\n"
            f"{_format_question_spec(spec)}\n\n"
            f"{_format_consistency_notes(consistency_notes)}\n\n"
            f"COVERAGE: {json.dumps(coverage.to_dict(), default=str)}\n\n"
            f"Doctor's question:\n{effective_query}\n\n"
            "Produce your JSON response now."
        )))

        response = await reasoning_llm.ainvoke(messages)
        content = response.content.strip()
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
        return json.loads(content)

    def _remove_markdown_asterisks(value):
        if isinstance(value, str):
            return value.replace("*", "")
        if isinstance(value, list):
            return [_remove_markdown_asterisks(v) for v in value]
        if isinstance(value, dict):
            return {k: _remove_markdown_asterisks(v) for k, v in value.items()}
        return value
    
    def _materialize_actions(
        self, raw_actions: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for a in raw_actions or []:
            a_type = a.get("type")
            if a_type not in ACTION_WHITELIST:
                logger.warning(f"[AutonomousAgent] dropping non-whitelisted action: {a_type}")
                continue
            out.append({
                "id": f"act_{uuid.uuid4().hex[:8]}",
                "type": a_type,
                "topic": a.get("topic"),
                "description": a.get("description", ""),
                "requires_confirmation": ACTION_WHITELIST[a_type],
            })
        return out

    async def _execute_action(
        self, action: Dict[str, Any], patient_id: str, doctor_id: str
    ) -> Dict[str, Any]:
        try:
            if action["type"] in ("flag_data_conflict", "notify_doctor", "create_followup_task"):
                payload = {
                    "doctor_id": doctor_id,
                    "patient_id": patient_id,
                    "task_type": action["type"],
                    "topic": action.get("topic"),
                    "description": action["description"],
                    "source": "autonomous_agent",
                    "created_at": datetime.now().isoformat(),
                }
                resp = await self.client.post(
                    f"{API_BASE_URL}hms/users/data/context/tasks/create",
                    json=payload,
                )
                ok = resp.status_code == 200
                return {**action, "executed": ok, "result": "ok" if ok else resp.text[:300]}
            return {**action, "executed": False, "result": "blocked: requires confirmation"}
        except Exception as e:
            logger.error(f"[AutonomousAgent] execute failed: {e}")
            return {**action, "executed": False, "result": str(e)}

    async def run(
        self,
        patient_id: str,
        doctor_id: str,
        query: str = "",
        conversation_id: str = "",
    ) -> Dict[str, Any]:
        graph = await self.context_fetcher.fetch(patient_id, doctor_id)
        graph_validation = self.validator.validate_graph(graph)
        if not graph_validation.ok:
            return {
                "status": "error",
                "error": "Could not load valid patient context for the autonomous run.",
                "graph_validation": graph_validation.to_dict(),
            }

        question_validation = self.validator.validate_question(query)
        if question_validation.is_empty or question_validation.is_too_vague:
            return _build_clarification_response(
                patient_id=patient_id, doctor_id=doctor_id, query=query,
                kind="vague_question" if question_validation.is_too_vague else "empty_question",
                reason=question_validation.reason,
                extra={"graph_validation": graph_validation.to_dict()},
            )

        spec = self.analyzer.analyze(query)
        consistency_notes = self.consistency.analyze(graph)
        coverage = self.coverage.check(spec, graph)

        try:
            parsed = await self._reason_with_actions(
                graph, spec, coverage, graph_validation,
                consistency_notes, query, conversation_id,
            )
            RECOMMENDATION_INTENTS = {"recommend"}
            if spec.intent not in RECOMMENDATION_INTENTS:
                parsed["recommended_next_steps"] = []
        except Exception as e:
            logger.error(f"[AutonomousAgent] LLM failed: {e}")
            return {"status": "error", "error": str(e)}

        raw_actions = parsed.pop("proposed_actions", []) or []
        llm_actions = self._materialize_actions(raw_actions)

        verification = self.verifier.verify(parsed, graph)

        if not coverage.fully_covered and parsed.get("confidence") == "high":
            parsed["confidence"] = "medium"

        auto_actions = [a for a in llm_actions if not a["requires_confirmation"]]
        pending_actions = [a for a in llm_actions if a["requires_confirmation"]]

        executed: List[Dict[str, Any]] = []
        for action in auto_actions:
            executed.append(await self._execute_action(action, patient_id, doctor_id))

        if conversation_id:
            effective_query = (query or "").strip() or (
                "Review this patient and propose the next actions you would take."
            )
            _append_memory(conversation_id, "autonomous", "user", effective_query)
            _append_memory(conversation_id, "autonomous", "assistant", json.dumps(parsed))

        return {
            "status": "success",
            "generated_at": datetime.now().isoformat(),
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "query": (query or "").strip(),
            "pipeline": {
                "graph_validation": graph_validation.to_dict(),
                "question_validation": question_validation.to_dict(),
                "question_analysis": spec.to_dict(),
                "coverage": coverage.to_dict(),
                "post_llm_verification": verification.to_dict(),
            },
            # NOTE: no `reconciliation` block. No conflicts. No flags.
            "reasoning": parsed,
            "executed_actions": executed,
            "pending_actions": pending_actions,
        }

    async def execute_confirmed(
        self, patient_id: str, doctor_id: str, action: Dict[str, Any]
    ) -> Dict[str, Any]:
        action_type = action.get("type")

        if action_type == "update_encounter_status":
            payload = {
                "doctor_id": doctor_id,
                "patient_id": patient_id,
                "status": action.get("target_status", "HELD"),
            }
            resp = await self.client.post(
                f"{API_BASE_URL}hms/users/data/context/encounter/update-status",
                json=payload,
            )
            return {**action, "executed": resp.status_code == 200, "result": resp.text[:300]}

        if action_type in ("hold_next_step", "schedule_next_step"):
            payload = {
                "doctor_id": doctor_id,
                "patient_id": patient_id,
                "task_type": action_type,
                "topic": action.get("topic"),
                "description": action.get("description"),
                "source": "autonomous_agent_confirmed",
                "created_at": datetime.now().isoformat(),
            }
            resp = await self.client.post(
                f"{API_BASE_URL}hms/users/data/context/tasks/create",
                json=payload,
            )
            return {**action, "executed": resp.status_code == 200, "result": resp.text[:300]}

        return {**action, "executed": False, "result": "unknown action type"}