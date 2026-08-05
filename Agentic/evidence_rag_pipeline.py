"""
rag_pipeline.py
===============
Agentic Graph RAG — 8-Stage Clinical Knowledge Pipeline.

All models imported ONLY from models.py.

Pipeline stages
───────────────
  Stage 1  DocumentParsingAgent          — typed sections + doc-type
  Stage 2  ClinicalEntityExtractionAgent — 13 node types via LLM
  Stage 3  RelationshipExtractionAgent   — 30 typed edges
  Stage 4  KnowledgeGraphAgent           — unified graph construction
  Stage 5  ProtocolPathwayAgent          — clinical decision flows
  Stage 6  GuidelineDeltaAgent           — version change detection
  Stage 7  EvidenceLinkingAgent          — study → node linkage
  Stage 8  AgenticReasoningAgent         — 7 doctor questions

Install
───────
  pip install groq pydantic loguru
"""

from __future__ import annotations

import json
import os
import re
import textwrap
import uuid
from typing import Any, Dict, List, Optional, Tuple

from loguru import logger

# ── All models from models.py ─────────────────────────────────────
from Agentic.evidence_models import (
    # Enums
    AgentRole, DeltaChangeType, DeltaImpactLevel, DocumentType,
    EdgeRelation, EvidenceQuality, GuidelineSource, NodeColorGroup,
    NodeFlag, NodeType, ReasoningStepType, RecommendationStrength,
    SourceType, StatisticType, StudyType, OutcomeType, OutcomeDirection,
    # Document
    DocumentSection, DocumentSource, ParsedDocument, DocumentMetadata,
    ReplacedDocument,
    # Nodes
    AnyNode, BaseNode, BiomarkerNode, DiseaseNode, DrugNode,
    OutcomeNode, PatientSubgroupNode, RecommendationNode, StudyNode,
    SymptomSignNode, DiagnosticTestNode, RiskFactorNode,
    SurgicalProcedureNode, ClassificationSystemNode, ResearchGapNode,
    # Edges & graph
    GraphEdge, GraphConfig,
    # Protocol
    ProtocolFlowGraph, ProtocolStep,
    # Delta
    AffectedPatientSubgroup, GuidelineDelta,
    # Evidence
    EvidenceImpactEntry,
    # Reasoning
    ClinicalReasoningChain, ReasoningStep,
    # Agent audit
    AgentOutput,
    # Master output
    ClinicalKnowledgeGraph,
    # API
    PipelineRunRequest, PipelineRunResponse,
    DeltaQueryRequest, DeltaQueryResponse,
)


from Agentic.evidence_validation_agents import (
    ChunkRecord, CoverageReport,
    build_chunk_records,
    CoverageValidationAgent,
    MissingEntityCriticAgent,
    RetryExtractionAgent,
    GraphRepairAgent,
    build_coverage_score,
)

# ─────────────────────────────────────────────────────────────────
# CONFIGURATION
# ────────────────────────────────────────────────────────────────

GROQ_API_KEY:          str = os.getenv("GROQ_API_KEY", "")
MODEL:                 str = os.getenv("CLINICAL_LLM_MODEL", "llama-3.3-70b-versatile")
TEMPERATURE:           float = 0.1
MAX_TOKENS:            int   = 8000
SECTION_CONTEXT_LIMIT: int   = 12_000
NODE_BATCH_SIZE:       int   = 30

DOCTOR_QUESTIONS = [
    "What changed in the guideline?",
    "Why did the guideline change?",
    "Which patient groups are affected by the change?",
    "What treatment pathway is modified?",
    "What evidence caused the change?",
    "What is now contraindicated?",
    "What has stronger or weaker evidence than before?",
]

# Node type → color group mapping (consistent with models.py)
NODE_TYPE_TO_COLOR: Dict[str, str] = {
    NodeType.DISEASE.value:            NodeColorGroup.DISEASE.value,
    NodeType.DRUG.value:               NodeColorGroup.DRUG.value,
    NodeType.STUDY.value:              NodeColorGroup.STUDY.value,
    NodeType.BIOMARKER.value:          NodeColorGroup.BIOMARKER.value,
    NodeType.RECOMMENDATION.value:     NodeColorGroup.RECOMMENDATION.value,
    NodeType.PATIENT_SUBGROUP.value:   NodeColorGroup.SUBGROUP.value,
    NodeType.OUTCOME.value:            NodeColorGroup.OUTCOME.value,
    NodeType.SYMPTOM_SIGN.value:       NodeColorGroup.SYMPTOM.value,
    NodeType.DIAGNOSTIC_TEST.value:    NodeColorGroup.TEST.value,
    NodeType.RISK_FACTOR.value:        NodeColorGroup.RISK.value,
    NodeType.SURGICAL_PROCEDURE.value: NodeColorGroup.SURGICAL.value,
    NodeType.CLASSIFICATION_SYSTEM.value: NodeColorGroup.CLASSIFICATION.value,
    NodeType.RESEARCH_GAP.value:       NodeColorGroup.RESEARCH.value,
}


# ─────────────────────────────────────────────────────────────────
# LLM CLIENT  (Groq)
# ─────────────────────────────────────────────────────────────────

class LLMClient:
    """Groq-based LLM used by all 8 pipeline stages."""

    def __init__(self, api_key: str = GROQ_API_KEY, model: str = MODEL):
        if not api_key:
            raise ValueError("GROQ_API_KEY environment variable is missing.")
        from groq import Groq
        self._client = Groq(api_key=api_key)
        self.model   = model

    def complete(self, system: str, user: str,
                 max_tokens: int = MAX_TOKENS,
                 temperature: float = TEMPERATURE) -> str:
        resp = self._client.chat.completions.create(
            model=self.model, temperature=temperature, max_tokens=max_tokens,
            messages=[{"role": "system", "content": system},
                      {"role": "user",   "content": user}],
        )
        return resp.choices[0].message.content.strip()

    def complete_json(self, system: str, user: str,
                  max_tokens: int = MAX_TOKENS) -> Any:

        system = (
            system
            + "\n\n"
            + "Return ONLY valid JSON."
        )

        user = (
            user
            + "\n\n"
            + "Respond in JSON format."
        )

        resp = self._client.chat.completions.create(
            model=self.model,
            temperature=TEMPERATURE,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )

        return json.loads(
            resp.choices[0].message.content
        )

# ─────────────────────────────────────────────────────────────────
# STAGE 1 — DOCUMENT PARSING AGENT
# ─────────────────────────────────────────────────────────────────

class DocumentParsingAgent:
    """
    Stage 1: Converts raw text / PDF bytes / URL into a ParsedDocument.
    Uses LLM to classify document type and split into typed sections.
    """

    SYSTEM = textwrap.dedent("""
        You are an expert clinical document parser trained on medical society guidelines
(ACOG, ESHRE, NICE, NCCN, ASCO, AHA), randomised controlled trials, systematic
reviews, meta-analyses, and clinical journals.
 
YOUR TASKS
──────────
1. Identify the EXACT document type from:
   clinical_practice_guideline | rct | systematic_review | meta_analysis |
   cohort_study | case_control_study | expert_consensus | journal_article |
   asco_update | nccn_update
 
2. Extract ALL metadata visible on the first two pages:
   • title, version/number, publication_date (YYYY-MM), issuing body
   • target population, condition
   • "REPLACES" or "SUPERSEDES" references — list every prior document
     replaced (document type + number + year, e.g. "Practice Bulletin 114,
     July 2010")
 
3. Split the document into typed sections. Use these section_type values:
   executive_summary | summary_of_recommendations | recommendation |
   good_practice_point | evidence_summary | methodology | background |
   patient_population | imaging | biomarkers | surgical_diagnosis |
   classification_staging | risk_factors | differential_diagnosis |
   barriers_and_equity | protocol_steps | outcomes | contraindications |
   appendix | references | other
 
   IMPORTANT RULES FOR SECTION SPLITTING:
   • Each individual ACOG/ESHRE recommendation statement is its own section
     with section_type = "recommendation".
   • Each "Good Practice Point" is its own section with
     section_type = "good_practice_point".
   • Tables (imaging accuracy, differential diagnosis, classification) are
     their own sections — include the FULL table text verbatim.
   • Do NOT merge multiple recommendations into one section.
   • Include the FULL content of every section — do not truncate.
 
RESPONSE FORMAT
───────────────
Respond ONLY with valid JSON (no markdown fences, no prose):
{
  "document_type": "<type>",
  "title": "<full title>",
  "version": "<guideline number or null>",
  "publication_date": "<YYYY-MM or null>",
  "issuing_body": "<e.g. ACOG or null>",
  "target_population": "<text or null>",
  "condition": "<primary condition or null>",
  "replaces": [
    {"document_type": "<type>", "number": "<id>", "date": "<Mon YYYY>"}
  ],
  "sections": [
    {
      "title": "<section title>",
      "content": "<FULL section text — never truncate>",
      "section_type": "<type>",
      "page_number": <int or null>,
      "recommendation_strength": "<STRONG|CONDITIONAL|GOOD_PRACTICE_POINT|null>",
      "evidence_quality": "<HIGH|MODERATE|LOW|VERY_LOW|null>"
    }
  ]
}
""")

    def __init__(self, llm: LLMClient):
        self._llm = llm

    def parse_pdf(self, pdf_bytes: bytes, source: DocumentSource) -> ParsedDocument:
        text = self._extract_pdf_text(pdf_bytes)
        return self._parse_raw(text, source)

    def parse_text(self, text: str, source: DocumentSource) -> ParsedDocument:
        return self._parse_raw(text, source)

    async def parse_url(self, url: str, source: DocumentSource) -> ParsedDocument:
        text = await self._fetch_url(url)
        return self._parse_raw(text, source)

    def _parse_raw(self, raw_text: str, source: DocumentSource) -> ParsedDocument:
        logger.info(f"[Stage 1] Parsing '{source.name}' ({len(raw_text):,} chars)")
        chunks = chunk_text_with_overlap(
            raw_text,
            chunk_size=12000,
            overlap=1500
        )

        chunk_records = build_chunk_records(raw_text)

        all_sections = []
        metadata = {}

        for chunk in chunks:

            try:

                data = self._llm.complete_json(
                    self.SYSTEM,
                    f"""
                    Source: {source.name}
                    Guideline: {source.guideline_source.value}

                    DOCUMENT CHUNK:
                    {chunk}
                    """
                )

            except Exception as e:

                logger.exception(
                    f"Chunk parsing failed: {e}"
                )

                continue

            # merge metadata
            for key in [
                "document_type",
                "title",
                "version",
                "publication_date",
                "issuing_body",
                "target_population",
                "condition"
            ]:
                if data.get(key) and not metadata.get(key):
                    metadata[key] = data.get(key)

            all_sections.extend(
                data.get("sections", [])
            )
        sections = [
            DocumentSection(
                title=(s.get("title") or "Untitled Section").strip(),
                content=(s.get("content") or "").strip(),
                section_type=(s.get("section_type") or "other"),
                page_number=s.get("page_number"),
            )
            for s in all_sections
        ]
        doc_type_raw = metadata.get(
            "document_type",
            "journal_article"
        )

        try:
            doc_type = DocumentType(doc_type_raw)
        except ValueError:
            doc_type = DocumentType.JOURNAL_ARTICLE

        doc = ParsedDocument(
            source_id=source.source_id,
            source_type=source.source_type,
            guideline_source=source.guideline_source,
            source_name=source.name,
            version=data.get("version") or source.version,
            document_type=doc_type,
            raw_text=raw_text,
            sections=sections,
        )

        # attach chunk records
        doc.chunk_records = [
            cr.__dict__ for cr in chunk_records
        ]

        return doc

    @staticmethod
    def _extract_pdf_text(pdf_bytes: bytes) -> str:
        try:
            import fitz
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            return "\n\n".join(p.get_text() for p in doc)
        except ImportError:
            try:
                import pypdf, io
                reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
                return "\n\n".join(
                    (p.extract_text() or "") for p in reader.pages
                )
            except ImportError:
                raise ImportError("Install PyMuPDF or pypdf: pip install PyMuPDF")

    @staticmethod
    async def _fetch_url(url: str) -> str:
        try:
            import httpx
            from bs4 import BeautifulSoup
        except ImportError:
            raise ImportError("pip install httpx beautifulsoup4")
        async with httpx.AsyncClient(follow_redirects=True, timeout=30) as c:
            resp = await c.get(url)
            resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        for tag in soup(["script", "style", "nav", "footer"]):
            tag.decompose()
        return soup.get_text(separator="\n", strip=True)


# ─────────────────────────────────────────────────────────────────
# STAGE 2 — CLINICAL ENTITY EXTRACTION AGENT
# ─────────────────────────────────────────────────────────────────


RECOMMENDATION_SYSTEM = """
Extract ONLY recommendation nodes.
"""

IMAGING_SYSTEM = """
Extract ONLY diagnostic_test nodes.
Include sensitivity/specificity.
"""

BIOMARKER_SYSTEM = """
Extract ONLY biomarker nodes.
"""

STUDY_SYSTEM = """
Extract ONLY study nodes.
Include OR/RR/HR/AUC statistics.
"""

RISK_FACTOR_SYSTEM = """
Extract ONLY risk_factor nodes.
"""

class ClinicalEntityExtractionAgent:
    """
    Stage 2: Extracts all 13 clinical node types from ParsedDocument sections.

    Node types: disease | drug | study | biomarker | recommendation |
                patient_subgroup | outcome | symptom_sign | diagnostic_test |
                risk_factor | surgical_procedure | classification_system |
                research_gap
    """

    SYSTEM = textwrap.dedent("""
        You are a senior clinical informatics specialist and biomedical knowledge
engineer with expertise in extracting structured clinical entities from:
  • Medical society guidelines (ACOG, ESHRE, NICE, NCCN, ASCO, ESC)
  • Randomised controlled trials and systematic reviews
  • Diagnostic accuracy studies and meta-analyses
  • Clinical journals and evidence synthesis reports
 
YOUR TASK
─────────
Extract ALL clinically significant entities. For a clinical practice
guideline you MUST extract:
  ✓ Every recommendation statement (one node per recommendation)
  ✓ Every Good Practice Point (one node per GPP)
  ✓ Every disease subtype, staging system, classification system
  ✓ Every diagnostic test/imaging modality with its accuracy metrics
  ✓ Every biomarker mentioned (including those recommended against)
  ✓ Every drug, hormone, or treatment modality
  ✓ Every patient subgroup (adolescents, transgender, racial/ethnic groups)
  ✓ Every outcome measure (pain score, quality of life, fertility, cancer risk)
  ✓ Every risk factor with its direction and magnitude
  ✓ Every surgical procedure with its role
  ✓ Every study cited with its key finding
  ✓ Every symptom/sign complex with anatomic domain
  ✓ Every research gap identified
 
EXTRACTION ANCHORS — look for these patterns:
  "ACOG recommends"           → recommendation node, strength = strong_for or strong_against
  "ACOG recommends against"   → recommendation node, strength = strong_against
  "ACOG suggests"             → recommendation node, strength = conditional_for
  "GOOD PRACTICE POINT"       → recommendation node, strength = good_practice_point
  "(STRONG RECOMMENDATION,"   → parse inline strength + evidence quality
  "(CONDITIONAL RECOMMENDATION," → conditional strength
  "sensitivity … specificity" → diagnostic_test node with those values
  "OR [0-9]"  "HR [0-9]"      → study node with statistic_type + value
  "CA 125"  "biomarker"       → biomarker node
  "stage I–IV"  "rASRM"       → classification_system node
  "risk factor"  "associated" → risk_factor node
  "laparoscopy"  "biopsy"     → surgical_procedure node
  "endometrioma"  "deep"      → disease subtype node
  "research is needed"        → research_gap node
  Racial/ethnic disparities   → patient_subgroup node with equity_note
 
RESPONSE FORMAT
───────────────
Return a JSON array of nodes. Each node MUST include ALL required fields.
No prose, no markdown fences — ONLY a valid JSON array.
 
REQUIRED FIELDS FOR EVERY NODE:
  id           – unique snake_case slug (e.g. "rec_tvus_initial_imaging")
                 Prefix by type: rec_ | dis_ | drug_ | study_ | bio_ |
                 sub_ | out_ | sym_ | test_ | risk_ | surg_ | class_ | gap_
  type         – one of: disease | drug | study | biomarker | recommendation |
                 patient_subgroup | outcome | symptom_sign | diagnostic_test |
                 risk_factor | surgical_procedure | classification_system |
                 research_gap
  label        – ≤ 8 words, clinically precise
  description  – 2–4 sentence clinical description including key numbers
  source_quote – verbatim ≤ 80-word excerpt proving this entity exists
  visual_priority – 1 (directly actionable) | 2 (standard) | 3 (contextual)
  flags        – list from: new_in_version | changed_in_version |
                 contraindicated | equity_consideration |
                 shared_decision_making | awaits_research |
                 high_impact_change | urgent
                 (empty list [] if none apply)
 
PER-TYPE ADDITIONAL FIELDS:
 
recommendation:
  strength            – strong_for | strong_against | conditional_for |
                        conditional_against | good_practice_point
  evidence_quality    – high | moderate | low | very_low | ungraded
  recommendation_text – full verbatim recommendation statement
  clinical_context    – the clinical scenario this applies to
  is_new              – true if new vs any prior version mentioned
 
disease:
  icd_code  – ICD-10 code if inferable
  stage     – staging info or "varies"
  subtype   – subtype or "multiple"
 
diagnostic_test:
  modality     – imaging modality or test name
  sensitivity  – numeric (0–1) or null
  specificity  – numeric (0–1) or null
  limitations  – list of known limitations
 
biomarker:
  biomarker_name   – exact name
  biomarker_type   – predictive | prognostic | diagnostic
  specimen_type    – blood | urine | endometrial | saliva | tissue | other
  threshold        – cutoff value if given
  sensitivity      – numeric or null
  specificity      – numeric or null
  clinical_utility – "not recommended" | "investigational" | "recommended"
 
study:
  study_name       – author/trial name
  study_type       – rct | meta_analysis | systematic_review | cohort |
                     case_control | cross_sectional | expert_opinion
  n_participants   – integer or null
  primary_endpoint – main outcome
  key_finding      – one-sentence finding
  p_value          – string or null
  statistic_type   – OR | RR | HR | AUC | sensitivity | specificity |
                     prevalence | incidence | other | null
  statistic_value  – numeric or null
  publication_year – integer or null
  journal          – journal name or null
 
patient_subgroup:
  subgroup_label           – concise label
  defining_characteristics – list
  biomarker_defined        – boolean
  special_considerations   – list of clinical notes
  equity_note              – disparity or equity issue, or ""
 
symptom_sign:
  symptom_name   – clinical term
  pattern        – cyclic | noncyclic | both | unknown
  anatomic_domain – list of anatomic sites
 
risk_factor:
  factor_name – name of risk factor
  direction   – increases_risk | decreases_risk
  magnitude   – numeric (OR/RR/HR) or descriptive string
 
surgical_procedure:
  procedure_name – name
  role           – diagnostic | therapeutic | both
  indication     – when indicated
  complications  – list
 
classification_system:
  system_name          – full name
  stages_or_categories – list
  limitations          – list
 
research_gap:
  gap_description  – what is unknown
  proposed_approach – suggested research direction
""")

    def __init__(self, llm: LLMClient):
        self._llm = llm

    def extract(self, doc: ParsedDocument) -> Tuple[List[AnyNode], AgentOutput]:
        logger.info(f"[Stage 2] Entity extraction: '{doc.source_name}' "
                    f"({len(doc.sections)} sections)")
        all_raw: List[Dict] = []
        for chunk_idx, section in enumerate(doc.sections):

            section_type = section.section_type

            SECTION_PROMPT_MAP = {

                "recommendation": RECOMMENDATION_SYSTEM,
                "imaging": IMAGING_SYSTEM,
                "biomarkers": BIOMARKER_SYSTEM,
                "evidence_summary": STUDY_SYSTEM,
                "risk_factors": RISK_FACTOR_SYSTEM,
            }
            system_prompt = SECTION_PROMPT_MAP.get(
                section.section_type,
                self.SYSTEM
            )

            raw = self._llm.complete_json(
                system_prompt,
                section.content
            )

            # attach chunk id to extracted nodes
            if isinstance(raw, list):

                for node_raw in raw:
                    node_raw["chunk_id"] = chunk_idx

                all_raw.extend(raw)

            elif isinstance(raw, dict) and "nodes" in raw:

                for node_raw in raw["nodes"]:
                    node_raw["chunk_id"] = chunk_idx

                all_raw.extend(raw["nodes"])

        nodes = self._cast_nodes(all_raw, doc)
        logger.info(f"[Stage 2] Extracted {len(nodes)} nodes from '{doc.source_name}'")

        return nodes, AgentOutput(
            agent_name=self.__class__.__name__,
            agent_role=AgentRole.ENTITY_EXTRACTOR,
            source_id=doc.source_id,
            nodes=[n.model_dump() for n in nodes],
            confidence=0.88,
        )

    def _cast_nodes(self, raw_nodes: List[Dict], doc: ParsedDocument) -> List[AnyNode]:
        nodes: List[AnyNode] = []
        seen: set = set()
        for raw in raw_nodes:
            node_id = raw.get("id", "")
            if not node_id or node_id in seen:
                continue
            seen.add(node_id)
            raw["source_id"]        = doc.source_id
            raw["guideline_source"] = doc.guideline_source.value
            raw["version"]          = doc.version

            ntype_str = raw.get("type", "")
            try:
                ntype = NodeType(ntype_str)
            except ValueError:
                continue
            raw["color_group"] = NODE_TYPE_TO_COLOR.get(ntype.value, NodeColorGroup.RECOMMENDATION.value)

            # Sanitise flags
            valid_flags = {f.value for f in NodeFlag}
            raw["flags"] = [f for f in raw.get("flags", []) if f in valid_flags]

            try:
                node = self._build_node(ntype, raw)
                if node:
                    nodes.append(node)
            except Exception as exc:
                logger.debug(f"  Node cast failed [{node_id}]: {exc}")
        return nodes

    @staticmethod
    def _build_node(ntype: NodeType, raw: Dict) -> Optional[AnyNode]:
        model_map = {
            NodeType.DISEASE:              DiseaseNode,
            NodeType.DRUG:                 DrugNode,
            NodeType.STUDY:                StudyNode,
            NodeType.BIOMARKER:            BiomarkerNode,
            NodeType.RECOMMENDATION:       RecommendationNode,
            NodeType.PATIENT_SUBGROUP:     PatientSubgroupNode,
            NodeType.OUTCOME:              OutcomeNode,
            NodeType.SYMPTOM_SIGN:         SymptomSignNode,
            NodeType.DIAGNOSTIC_TEST:      DiagnosticTestNode,
            NodeType.RISK_FACTOR:          RiskFactorNode,
            NodeType.SURGICAL_PROCEDURE:   SurgicalProcedureNode,
            NodeType.CLASSIFICATION_SYSTEM: ClassificationSystemNode,
            NodeType.RESEARCH_GAP:         ResearchGapNode,
        }
        cls = model_map.get(ntype)
        return cls(**raw) if cls else None


# ─────────────────────────────────────────────────────────────────
# STAGE 3 — RELATIONSHIP EXTRACTION AGENT
# ─────────────────────────────────────────────────────────────────

class RelationshipExtractionAgent:
    """
    Stage 3: Extracts typed GraphEdge relationships between nodes.
    Uses the full EdgeRelation enum from models.py.
    """

    VALID_RELATIONS = {e.value for e in EdgeRelation}

    SYSTEM = textwrap.dedent("""
        You are a clinical relationship extraction specialist trained on medical
society guidelines, clinical trials, and evidence synthesis documents.
 
YOUR TASK
─────────
Given a list of clinical entity nodes and the source document text, extract
ALL clinically meaningful, text-supported relationships between nodes.
 
RELATIONSHIP ANCHORS — look for these language patterns:
  "ACOG recommends [test/drug]"      → recommends
  "ACOG recommends against [X]"      → recommends_against
  "is sufficient to initiate"        → indicated_for
  "preferred … modality"             → first_line_for
  "alternative … if not appropriate" → second_line_after
  "replaces [prior document]"        → replaces
  "sensitivity … for [condition]"    → facilitates_diagnosis_of
  "cannot reliably detect"           → cannot_detect
  "is associated with increased risk"→ increases_risk_of
  "does not exclude the possibility" → associated_with
  "guide … treatment planning"       → guides_planning_of
  "confirm … diagnosis"              → confirms_diagnosis_of
  "similar presentation"             → mimics / distinguished_from
  "studied in … participants"        → studied_in
  "affects … subgroup"               → affects_subgroup
  "supported by … evidence"          → supported_by
  "CA 125 … not recommended"         → recommends_against + contraindicated flag
  "biopsy … histologic confirmation" → confirms_diagnosis_of
  "concurrent treatment"             → treats (surgical → disease)
 
REQUIRED EDGE FIELDS:
  id            – unique slug, e.g. "edge_tvus_confirms_endometrioma"
  source        – source node id (must exist in node list)
  target        – target node id (must exist in node list)
  relation      – one of the 29 allowed relation types (see below)
  weight        – 1–5  (5 = primary clinical pathway, 1 = contextual)
  label         – ≤ 6 words
  evidence_basis – verbatim ≤ 60-word excerpt from document
  bidirectional  – true | false
  is_new         – true if this relationship is new vs prior guideline version
 
ALLOWED RELATION TYPES:
  treats | contraindicated | first_line_for | second_line_after | replaces |
  upgrades | downgrades | supported_by | superior_to | comparable_to |
  recommends | recommends_against | indicated_for | improves |
  associated_with | studied_in | affects_subgroup | predicts | monitors |
  confirms_diagnosis_of | cannot_detect | guides_planning_of |
  presents_with | increases_risk_of | mimics | distinguished_from |
  applies_to | facilitates_diagnosis_of | delays_diagnosis_of
 
QUALITY RULES:
  • Only extract edges that are DIRECTLY supported by a passage in the text.
  • Every recommendation node should have at least one outgoing edge.
  • Imaging test nodes should be linked to what they detect (or cannot detect).
  • Study nodes should be linked to the recommendation they support.
  • Biomarker nodes recommended against must have a recommends_against edge.
  • Patient subgroup nodes must be linked to the disease via affects_subgroup.
  • Risk factor nodes must link to disease via increases_risk_of.
 
Respond ONLY with a valid JSON array — no prose, no markdown fences.
""")

    def __init__(self, llm: LLMClient):
        self._llm = llm

    def extract(self, nodes: List[AnyNode], doc: ParsedDocument) -> Tuple[List[GraphEdge], AgentOutput]:
        logger.info(f"[Stage 3] Relationship extraction: {len(nodes)} nodes")
        all_edges: List[GraphEdge] = []
        seen: set = set()

        section_text = "\n\n".join(
            f"[{s.title}]\n{s.content[:2000]}"
            for s in doc.sections if len(s.content.strip()) > 50
        )[:SECTION_CONTEXT_LIMIT]

        for i in range(0, len(nodes), NODE_BATCH_SIZE):
            batch = nodes[i: i + NODE_BATCH_SIZE]
            node_summary = json.dumps(
                [{"id": n.id, "type": n.type.value, "label": n.label} for n in batch], indent=2
            )
            try:
                raw_edges = self._llm.complete_json(
                    self.SYSTEM,
                    f"Source: {doc.source_name} | Version: {doc.version or 'unknown'}\n\n"
                    f"NODES:\n{node_summary}\n\nTEXT:\n{section_text}",
                )
                if isinstance(raw_edges, dict) and "edges" in raw_edges:
                    raw_edges = raw_edges["edges"]
                for raw in (raw_edges if isinstance(raw_edges, list) else []):
                    edge = self._cast_edge(raw, doc)
                    if edge and edge.id not in seen:
                        seen.add(edge.id)
                        all_edges.append(edge)
            except Exception as exc:
                logger.warning(f"  Edge batch {i} failed: {exc}")

        logger.info(f"[Stage 3] Extracted {len(all_edges)} edges")
        return all_edges, AgentOutput(
            agent_name=self.__class__.__name__,
            agent_role=AgentRole.RELATIONSHIP_EXTRACTOR,
            source_id=doc.source_id,
            edges=[e.model_dump() for e in all_edges],
            confidence=0.85,
        )

    def _cast_edge(self, raw: Dict, doc: ParsedDocument) -> Optional[GraphEdge]:
        relation_str = raw.get("relation", "associated_with")
        if relation_str not in self.VALID_RELATIONS:
            relation_str = "associated_with"
        try:
            return GraphEdge(
                id=raw.get("id", f"edge_{uuid.uuid4().hex[:8]}"),
                source=raw["source"],
                target=raw["target"],
                relation=EdgeRelation(relation_str),
                weight=max(1, min(5, int(raw.get("weight", 2)))),
                label=raw.get("label", relation_str),
                evidence_basis=raw.get("evidence_basis", ""),
                source_id=doc.source_id,
                guideline_source=doc.guideline_source,
                version=doc.version,
                bidirectional=bool(raw.get("bidirectional", False)),
                is_new=bool(raw.get("is_new", False)),
            )
        except (KeyError, TypeError) as exc:
            logger.debug(f"  Edge cast failed: {exc}")
            return None


# ─────────────────────────────────────────────────────────────────
# STAGE 4 — KNOWLEDGE GRAPH CONSTRUCTION AGENT
# ─────────────────────────────────────────────────────────────────

class KnowledgeGraphAgent:
    """
    Stage 4: Merges nodes + edges from all sources into ClinicalKnowledgeGraph.
    Deduplicates nodes, filters orphan edges, attaches GraphConfig.
    """

    def __init__(self, llm: LLMClient):
        self._llm = llm

    def build(
        self,
        all_nodes: List[AnyNode],
        all_edges: List[GraphEdge],
        source_docs: List[ParsedDocument],
        agent_outputs: List[AgentOutput],
    ) -> ClinicalKnowledgeGraph:
        logger.info(
            f"[Stage 4] Building graph: {len(all_nodes)} nodes, "
            f"{len(all_edges)} edges, {len(source_docs)} sources"
        )
        # Deduplicate nodes (prefer lower visual_priority = more important)
        node_map: Dict[str, AnyNode] = {}
        for n in all_nodes:
            existing = node_map.get(n.id)
            if existing is None or n.visual_priority < existing.visual_priority:
                node_map[n.id] = n

        # Deduplicate edges
        edge_map: Dict[str, GraphEdge] = {}
        for e in all_edges:
            if e.id not in edge_map:
                edge_map[e.id] = e

        valid_ids = set(node_map.keys())
        valid_edges = [e for e in edge_map.values()
                       if e.source in valid_ids and e.target in valid_ids]
        dropped = len(edge_map) - len(valid_edges)
        if dropped:
            logger.info(f"[Stage 4] Dropped {dropped} orphan edges")

        metadata = []
        version_map = {}
        for doc in source_docs:
            version_map[doc.source_name] = doc.version or "unknown"
            try:
                metadata.append(DocumentMetadata(
                    title=doc.source_name,
                    document_type=doc.document_type or DocumentType.JOURNAL_ARTICLE,
                    guideline_source=doc.guideline_source,
                    version=doc.version,
                ))
            except Exception as exc:
                logger.debug(f"Metadata build failed: {exc}")

        graph = ClinicalKnowledgeGraph(
            source_names=[d.source_name for d in source_docs],
            source_versions=version_map,
            metadata=metadata,
            nodes=[n.model_dump() for n in node_map.values()],
            edges=valid_edges,
            graph_config=GraphConfig(),
            agent_outputs=agent_outputs,
        )
        graph.compute_summary()
        logger.info(f"[Stage 4] Graph — nodes={graph.total_nodes}, edges={graph.total_edges}")
        return graph


# ─────────────────────────────────────────────────────────────────
# STAGE 5 — PROTOCOL PATHWAY EXTRACTION AGENT
# ─────────────────────────────────────────────────────────────────

class ProtocolPathwayAgent:
    """Stage 5: Extracts branching clinical decision flow graphs."""

    SYSTEM = textwrap.dedent("""
        You are a clinical protocol extraction specialist. Your task is to extract
EVERY branching clinical decision protocol that is explicitly or implicitly
described in the document.
 
For a clinical practice guideline on diagnosis (e.g. endometriosis),
look for and extract separate protocols for:
  1. Initial clinical evaluation pathway (symptom → history → exam)
  2. Imaging pathway (TVUS first → MRI if needed)
  3. Biomarker evaluation pathway (if/when to order)
  4. Diagnostic laparoscopy decision pathway (empiric treatment vs surgery)
  5. Adolescent-specific evaluation pathway
  6. Biopsy and histologic confirmation protocol
  7. Referral pathway (to specialist, to surgeon)
 
EACH protocol step must specify:
  • The clinical action in plain English
  • The decision point that leads to the next step (condition_to_proceed)
  • The stopping/exit rule (condition_to_stop)
  • Positive and negative branch node IDs (branch_positive, branch_negative)
  • Any time constraint (e.g. "offer empiric treatment while awaiting imaging")
 
Return a JSON array of protocol objects:
[
  {
    "id": "prot_<slug>",
    "name": "<Protocol name>",
    "clinical_question": "<What clinical question does this answer?>",
    "applicable_population": "<Patient population>",
    "entry_criteria": "<Trigger / inclusion criteria>",
    "terminal_outcomes": ["<expected end-states>"],
    "steps": [
      {
        "step_number": 1,
        "action": "<Plain-English clinical action>",
        "node_id": "<graph node id or null>",
        "node_type": "<disease|drug|diagnostic_test|recommendation|...>",
        "condition_to_proceed": "<condition or null>",
        "condition_to_stop": "<stopping rule or null>",
        "branch_positive": "<node_id or null>",
        "branch_negative": "<node_id or null>",
        "time_constraint": "<e.g. within 4 weeks or null>",
        "notes": "<clinical notes or null>"
      }
    ]
  }
]
 
Only include protocols clearly supported by the text.
Respond ONLY with a valid JSON array — no prose, no markdown fences.
""")

    def __init__(self, llm: LLMClient):
        self._llm = llm

    def extract(self, graph: ClinicalKnowledgeGraph,
                source_docs: List[ParsedDocument]) -> Tuple[List[ProtocolFlowGraph], AgentOutput]:
        logger.info("[Stage 5] Protocol pathway extraction")
        all_protocols: List[ProtocolFlowGraph] = []
        seen: set = set()

        for doc in source_docs:
            sections = [s for s in doc.sections
                        if s.section_type in ("recommendation", "protocol_steps",
                                              "background", "other")][:5]
            context = "\n\n".join(
                f"[{s.title}]\n{s.content[:3000]}" for s in sections
            )[:SECTION_CONTEXT_LIMIT]
            try:
                raw = self._llm.complete_json(
                    self.SYSTEM,
                    f"Source: {doc.source_name}\n\n{context}",
                )
                items = raw if isinstance(raw, list) else raw.get("protocols", [])
                for rp in items:
                    p = self._cast(rp, doc)
                    if p and p.id not in seen:
                        seen.add(p.id)
                        all_protocols.append(p)
            except Exception as exc:
                logger.warning(f"  Protocol extraction failed for {doc.source_name}: {exc}")

        logger.info(f"[Stage 5] Extracted {len(all_protocols)} protocols")
        return all_protocols, AgentOutput(
            agent_name=self.__class__.__name__,
            agent_role=AgentRole.PATHWAY_EXTRACTOR,
            source_id=source_docs[0].source_id if source_docs else "",
            pathways=[p.model_dump() for p in all_protocols],
            confidence=0.82,
        )

    @staticmethod
    def _cast(raw: Dict, doc: ParsedDocument) -> Optional[ProtocolFlowGraph]:
        try:
            steps = []
            for rs in raw.get("steps", []):
                try:
                    nt = NodeType(rs.get("node_type", "recommendation"))
                except ValueError:
                    nt = NodeType.RECOMMENDATION
                steps.append(ProtocolStep(
                    step_number=int(rs.get("step_number", 1)),
                    action=rs.get("action", ""),
                    node_id=rs.get("node_id", ""),
                    node_type=nt,
                    condition_to_proceed=rs.get("condition_to_proceed"),
                    condition_to_stop=rs.get("condition_to_stop"),
                    branch_positive=rs.get("branch_positive"),
                    branch_negative=rs.get("branch_negative"),
                    time_constraint=rs.get("time_constraint"),
                    notes=rs.get("notes"),
                ))
            return ProtocolFlowGraph(
                id=raw.get("id", f"prot_{uuid.uuid4().hex[:8]}"),
                name=raw.get("name", "Unnamed Protocol"),
                clinical_question=raw.get("clinical_question", ""),
                applicable_population=raw.get("applicable_population", ""),
                steps=steps,
                entry_criteria=raw.get("entry_criteria", ""),
                terminal_outcomes=raw.get("terminal_outcomes", []),
                source_id=doc.source_id,
                guideline_source=doc.guideline_source,
                version=doc.version,
            )
        except Exception as exc:
            logger.debug(f"  Protocol cast failed: {exc}")
            return None


# ─────────────────────────────────────────────────────────────────
# STAGE 6 — GUIDELINE DELTA DETECTION AGENT
# ─────────────────────────────────────────────────────────────────

class GuidelineDeltaAgent:
    """Stage 6: Detects changes across guideline versions."""

    VALID_CHANGE_TYPES = {e.value for e in DeltaChangeType}
    VALID_IMPACT_LEVELS = {e.value for e in DeltaImpactLevel}

    SYSTEM = textwrap.dedent("""
        You are a clinical guideline version-change specialist. Your task is to
identify ALL clinically significant changes in the current guideline compared
to any prior version, earlier document, or previously established practice.
 
CRITICAL FIRST STEP:
Look for "REPLACES", "SUPERSEDES", or "UPDATES" language on the first page
of the document. Extract every prior document that this guideline replaces
and treat it as a source of potential delta.
 
For a NEW clinical practice guideline (one that replaces older documents),
extract deltas by asking:
  • What recommendations are EXPLICITLY NEW that did not exist before?
  • What recommendations represent a SHIFT from requiring surgery to
    symptom-based clinical diagnosis?
  • What imaging test is now RECOMMENDED that may not have been before?
  • What biomarkers are now EXPLICITLY RECOMMENDED AGAINST?
  • What is now the PREFERRED pathway (clinical diagnosis + empiric treatment
    vs. mandatory laparoscopy)?
  • Are there any new EQUITY or DIVERSITY considerations?
  • Are there new recommendations for previously underrepresented groups
    (adolescents, transgender individuals, racial minorities)?
 
DELTA CHANGE TYPES (use the most specific one):
  new_recommendation | removed_recommendation | upgraded_evidence |
  downgraded_evidence | new_contraindication | removed_contraindication |
  pathway_modified | subgroup_added | subgroup_removed | drug_replaced |
  biomarker_added | strength_changed | scope_expanded | equity_update
 
IMPACT LEVELS:
  high   – changes clinical practice for most patients
  medium – changes practice for specific subgroups or scenarios
  low    – refinement, clarification, or contextual addition
 
REQUIRED FIELDS PER DELTA:
  change_type        – from list above
  impact_level       – high | medium | low
  what_changed       – plain-English summary (≥ 2 sentences)
  old_value          – prior recommendation/practice or "Not addressed"
  new_value          – current recommendation/practice
  why_changed        – evidence or reasoning cited in document
  evidence_node_ids  – study node ids that support this change
  affected_subgroups – [{"subgroup_label":"..","impact_summary":".."}]
  modified_pathway_ids – pathway ids this delta affects
  now_contraindicated  – node ids now explicitly not recommended
  stronger_evidence_ids – node ids with upgraded evidence
  weaker_evidence_ids   – node ids with downgraded evidence
  source_quote       – verbatim ≤ 80-word quote from document
  page_ref           – page number or null
 
If this is the FIRST version of a guideline (no prior version available),
treat all STRONG recommendations as new_recommendation deltas and all
explicit "recommends against" as new_contraindication deltas.
 
Respond ONLY with a valid JSON array — no prose, no markdown fences.
""")

    def __init__(self, llm: LLMClient):
        self._llm = llm

    def detect(self, graph: ClinicalKnowledgeGraph, source_docs: List[ParsedDocument],
               prior_graph: Optional[ClinicalKnowledgeGraph] = None) -> Tuple[List[GuidelineDelta], AgentOutput]:
        logger.info("[Stage 6] Guideline delta detection")
        all_deltas: List[GuidelineDelta] = []

        for doc in source_docs:
            current_text = "\n\n".join(
                f"[{s.title}]\n{s.content[:2000]}"
                for s in doc.sections
                if s.section_type in ("recommendation", "evidence_summary",
                                      "contraindications", "protocol_steps", "other")
            )[:SECTION_CONTEXT_LIMIT]

            prior_ctx = ""
            if prior_graph:
                prior_ctx = json.dumps({
                    "source_versions": prior_graph.source_versions,
                    "node_labels": [n.get("label", "") for n in prior_graph.nodes[:40]],
                }, indent=2)

            try:
                raw_deltas = self._llm.complete_json(
                    self.SYSTEM,
                    f"Source: {doc.source_name} | Version: {doc.version or 'unknown'}\n\n"
                    f"CURRENT TEXT:\n{current_text}\n\n"
                    + (f"PRIOR VERSION CONTEXT:\n{prior_ctx}" if prior_ctx else ""),
                )
                items = raw_deltas if isinstance(raw_deltas, list) else raw_deltas.get("deltas", [])
                for rd in items:
                    delta = self._cast(rd, doc)
                    if delta:
                        all_deltas.append(delta)
            except Exception as exc:
                logger.warning(f"  Delta detection failed for {doc.source_name}: {exc}")

        logger.info(f"[Stage 6] Detected {len(all_deltas)} deltas")
        return all_deltas, AgentOutput(
            agent_name=self.__class__.__name__,
            agent_role=AgentRole.DELTA_DETECTOR,
            source_id=source_docs[0].source_id if source_docs else "",
            deltas=[d.model_dump() for d in all_deltas],
            confidence=0.80,
        )

    def _cast(self, raw: Dict, doc: ParsedDocument) -> Optional[GuidelineDelta]:
        ct_str = raw.get("change_type", "new_recommendation")
        if ct_str not in self.VALID_CHANGE_TYPES:
            ct_str = "new_recommendation"
        il_str = raw.get("impact_level", "medium")
        if il_str not in self.VALID_IMPACT_LEVELS:
            il_str = "medium"
        try:
            subgroups = [
                AffectedPatientSubgroup(**sg)
                for sg in raw.get("affected_subgroups", [])
                if isinstance(sg, dict)
            ]
            return GuidelineDelta(
                change_type=DeltaChangeType(ct_str),
                impact_level=DeltaImpactLevel(il_str),
                what_changed=raw.get("what_changed", ""),
                old_value=raw.get("old_value"),
                new_value=raw.get("new_value"),
                why_changed=raw.get("why_changed", ""),
                evidence_node_ids=raw.get("evidence_node_ids", []),
                affected_subgroups=subgroups,
                modified_pathway_ids=raw.get("modified_pathway_ids", []),
                now_contraindicated=raw.get("now_contraindicated", []),
                stronger_evidence_ids=raw.get("stronger_evidence_ids", []),
                weaker_evidence_ids=raw.get("weaker_evidence_ids", []),
                source_guideline=doc.guideline_source,
                current_version=doc.version,
                source_id=doc.source_id,
                page_ref=raw.get("page_ref"),
                source_quote=raw.get("source_quote", ""),
            )
        except Exception as exc:
            logger.debug(f"  Delta cast failed: {exc}")
            return None


# ─────────────────────────────────────────────────────────────────
# STAGE 7 — EVIDENCE LINKING AGENT
# ─────────────────────────────────────────────────────────────────

class EvidenceLinkingAgent:
    """Stage 7: Maps study nodes to the graph elements they support."""

    VALID_STUDY_TYPES  = {e.value for e in StudyType}
    VALID_EQ           = {e.value for e in EvidenceQuality}
    VALID_STAT_TYPES   = {e.value for e in StatisticType}

    SYSTEM = textwrap.dedent("""
        You are a clinical evidence synthesis specialist. Your task is to create
structured evidence impact entries that link each study or evidence source
to the specific graph nodes and pathways it supports.
 
For clinical practice guidelines, link:
  • Each cited RCT/cohort/case-control study → the recommendation it underpins
  • Each meta-analysis → the imaging test or biomarker accuracy it quantifies
  • Each systematic review → the broader recommendation it informs
  • Accuracy statistics (sensitivity, specificity, AUC) → the diagnostic_test node
 
EVIDENCE QUALITY HIERARCHY (apply strictly):
  high      – RCTs and systematic reviews without serious flaws
  moderate  – RCTs with some limitations; strong observational studies
  low       – RCTs with serious flaws; some observational evidence
  very_low  – Unsystematic clinical observations; very indirect evidence
  ungraded  – Good Practice Points (expert opinion, no formal GRADE)
 
REQUIRED FIELDS:
  study_node_id       – id of the study node in the graph
  study_type          – rct | meta_analysis | systematic_review | cohort |
                        case_control | cross_sectional | expert_opinion
  finding             – key finding in plain English (include statistics)
  statistic_type      – OR | RR | HR | AUC | sensitivity | specificity |
                        prevalence | incidence | other | null
  statistic_value     – numeric or null
  ci_lower            – numeric or null
  ci_upper            – numeric or null
  p_value             – string or null
  evidence_quality    – from hierarchy above
  supports_node_ids   – list of node ids this evidence supports
  modifies_edge_ids   – list of edge ids this evidence strengthens
  impacts_pathway_ids – list of pathway ids impacted
  citation_text       – "Author et al. Journal Year"
  limitation          – key methodological limitation or null
 
Respond ONLY with a valid JSON array — no prose, no markdown fences.
""")

    def __init__(self, llm: LLMClient):
        self._llm = llm

    def link(self, graph: ClinicalKnowledgeGraph,
             source_docs: List[ParsedDocument]) -> Tuple[List[EvidenceImpactEntry], AgentOutput]:
        logger.info("[Stage 7] Evidence linking")
        study_nodes = [n for n in graph.nodes if n.get("type") == NodeType.STUDY.value]
        if not study_nodes:
            logger.info("[Stage 7] No study nodes — skipping")
            return [], AgentOutput(
                agent_name=self.__class__.__name__,
                agent_role=AgentRole.EVIDENCE_LINKER,
                source_id=source_docs[0].source_id if source_docs else "",
                confidence=1.0,
            )

        other_nodes = json.dumps(
            [{"id": n.get("id"), "type": n.get("type"), "label": n.get("label")}
             for n in graph.nodes if n.get("type") != NodeType.STUDY.value][:60], indent=2
        )
        pathway_ids = [p.id for p in graph.protocol_graphs]

        entries: List[EvidenceImpactEntry] = []
        try:
            raw = self._llm.complete_json(
                self.SYSTEM,
                f"Study nodes:\n{json.dumps(study_nodes[:30], indent=2)}\n\n"
                f"Other nodes:\n{other_nodes}\n\n"
                f"Pathway ids: {pathway_ids}\n"
                f"Edge ids: {[e.id for e in graph.edges[:50]]}",
            )
            items = raw if isinstance(raw, list) else raw.get("entries", [])
            for r in items:
                e = self._cast(r)
                if e:
                    entries.append(e)
        except Exception as exc:
            logger.warning(f"  Evidence linking failed: {exc}")

        logger.info(f"[Stage 7] Created {len(entries)} evidence impact entries")
        return entries, AgentOutput(
            agent_name=self.__class__.__name__,
            agent_role=AgentRole.EVIDENCE_LINKER,
            source_id=source_docs[0].source_id if source_docs else "",
            evidence=[e.model_dump() for e in entries],
            confidence=0.83,
        )

    def _cast(self, raw: Dict) -> Optional[EvidenceImpactEntry]:
        st = raw.get("study_type", "cohort")
        if st not in self.VALID_STUDY_TYPES:
            st = "cohort"
        eq = raw.get("evidence_quality", "ungraded")
        if eq not in self.VALID_EQ:
            eq = "ungraded"
        stat_type = None
        if raw.get("statistic_type") in self.VALID_STAT_TYPES:
            stat_type = StatisticType(raw["statistic_type"])
        try:
            return EvidenceImpactEntry(
                study_node_id=raw.get("study_node_id", ""),
                study_type=StudyType(st),
                finding=raw.get("finding", ""),
                statistic_type=stat_type,
                statistic_value=raw.get("statistic_value"),
                ci_lower=raw.get("ci_lower"),
                ci_upper=raw.get("ci_upper"),
                p_value=raw.get("p_value"),
                evidence_quality=EvidenceQuality(eq),
                supports_node_ids=raw.get("supports_node_ids", []),
                modifies_edge_ids=raw.get("modifies_edge_ids", []),
                impacts_pathway_ids=raw.get("impacts_pathway_ids", []),
                citation_text=raw.get("citation_text", ""),
                limitation=raw.get("limitation"),
            )
        except Exception as exc:
            logger.debug(f"  EvidenceEntry cast failed: {exc}")
            return None


# ─────────────────────────────────────────────────────────────────
# STAGE 8 — AGENTIC REASONING AGENT
# ─────────────────────────────────────────────────────────────────

class AgenticReasoningAgent:
    """
    Stage 8: Answers the 7 doctor questions by traversing the knowledge graph.
    Produces one ClinicalReasoningChain per question.
    """

    SYSTEM = textwrap.dedent("""
        You are a senior clinical decision-support AI with deep expertise in
evidence-based medicine, clinical guideline interpretation, and
knowledge graph reasoning.
 
You have access to a structured clinical knowledge graph derived from a
medical society guideline or clinical evidence document. Your task is to
answer clinical questions by traversing the graph AND synthesising the
underlying evidence.
 
CRITICAL INSTRUCTION:
If the graph deltas array is empty but the document is a NEW or UPDATED
guideline (check source_names and metadata), you MUST infer deltas from:
  • Recommendation nodes with is_new = true
  • Nodes with flags containing "new_in_version" or "changed_in_version"
  • The "replaces" metadata in the document source
  • Strong recommendations that represent a shift from surgical to clinical
    diagnosis (this is a major paradigm change in endometriosis care)
 
ANSWER EACH QUESTION FULLY. Never return null or empty for:
  what_changed, why_changed, affected_patient_groups, final_answer
 
If graph data is sparse, reason from:
  1. Recommendation node texts (recommendation_text field)
  2. Evidence quality fields (evidence_quality, strength)
  3. Source quotes on nodes and edges
  4. Document metadata (replaces, condition, target_population)
 
REASONING CHAIN FORMAT — return a JSON object:
{
  "what_changed": "<Specific summary of guideline changes — cite replaced documents>",
  "why_changed": "<Evidence-based explanation citing studies, AUC values, etc.>",
  "affected_patient_groups": ["<precise subgroup labels>"],
  "modified_pathway": "<Pathway name or 'Clinical diagnosis → empiric treatment'>",
  "evidence_that_caused_change": ["<evidence entry ids or study names>"],
  "now_contraindicated": ["<node ids or descriptions>"],
  "stronger_evidence": ["<node ids with stronger evidence>"],
  "weaker_evidence": ["<node ids with weaker evidence>"],
  "final_answer": "<Comprehensive clinical answer ≤ 400 words — must be specific,
                   cite statistics and recommendation strength, never say 'no data'>",
  "confidence": <0.0–1.0>,
  "graph_nodes_visited": ["<node ids used in reasoning>"],
  "delta_ids_referenced": ["<delta ids referenced, or [] if none>"],
  "reasoning_steps": [
    {
      "step_number": 1,
      "step_type": "observation|hypothesis|evidence_pull|graph_query|conclusion|uncertainty",
      "content": "<reasoning content — must be specific, never generic>",
      "node_ids_used": ["<node ids>"],
      "edge_ids_used": ["<edge ids>"],
      "confidence": <0.0–1.0>
    }
  ]
}
 
QUALITY BAR FOR final_answer:
  ✓ Names specific recommendations with their strength (STRONG, CONDITIONAL)
  ✓ Cites at least one statistic (sensitivity, OR, AUC, CI) if available
  ✓ Names the specific patient populations affected
  ✓ Identifies what is now contraindicated or not recommended
  ✓ Mentions what prior document was replaced, if applicable
  ✗ NEVER returns "no data found" or "the graph does not contain"
  ✗ NEVER leaves what_changed or final_answer as null or empty
 
Respond ONLY with a valid JSON object — no prose, no markdown fences.
""")

    def __init__(self, llm: LLMClient):
        self._llm = llm

    def reason(self, question: str, graph: ClinicalKnowledgeGraph) -> ClinicalReasoningChain:
        logger.info(f"[Stage 8] Reasoning: '{question[:80]}…'")
        context = self._build_context(graph)
        raw = self._llm.complete_json(
            self.SYSTEM,
            f"CLINICAL QUESTION:\n{question}\n\nKNOWLEDGE GRAPH:\n{context}",
        )
        chain = self._cast(raw, question)
        logger.info(f"[Stage 8] Done — confidence={chain.confidence:.2f}, steps={len(chain.steps)}")
        return chain

    def reason_all(self, graph: ClinicalKnowledgeGraph) -> List[ClinicalReasoningChain]:
        chains = []
        for q in DOCTOR_QUESTIONS:
            try:
                chains.append(self.reason(q, graph))
            except Exception as exc:
                logger.warning(f"  Reasoning failed for '{q}': {exc}")
        return chains

    @staticmethod
    def _build_context(graph: ClinicalKnowledgeGraph) -> str:
        return json.dumps({
            "nodes": [{"id": n.get("id"), "type": n.get("type"),
                       "label": n.get("label"), "flags": n.get("flags", [])}
                      for n in graph.nodes[:80]],
            "edges": [{"id": e.id, "source": e.source, "target": e.target,
                       "relation": e.relation.value, "weight": e.weight,
                       "is_new": e.is_new} for e in graph.edges[:80]],
            "deltas": [{"id": d.id, "change_type": d.change_type.value,
                        "impact_level": d.impact_level.value,
                        "what_changed": d.what_changed,
                        "why_changed": d.why_changed} for d in graph.deltas[:20]],
            "evidence": [{"id": e.id, "study_node_id": e.study_node_id,
                          "finding": e.finding,
                          "evidence_quality": e.evidence_quality.value}
                         for e in graph.evidence_map[:20]],
            "protocols": [{"id": p.id, "name": p.name, "steps": len(p.steps)}
                          for p in graph.protocol_graphs],
        }, indent=2)

    @staticmethod
    def _cast(raw: Dict, question: str) -> ClinicalReasoningChain:
        steps = []
        for rs in raw.get("reasoning_steps", []):
            try:
                st = ReasoningStepType(rs.get("step_type", "observation"))
            except ValueError:
                st = ReasoningStepType.OBSERVATION
            steps.append(ReasoningStep(
                step_number=int(rs.get("step_number", 1)),
                step_type=st,
                content=rs.get("content", ""),
                node_ids_used=rs.get("node_ids_used", []),
                edge_ids_used=rs.get("edge_ids_used", []),
                confidence=float(rs.get("confidence", 0.8)),
            ))
        return ClinicalReasoningChain(
            clinical_question=question,
            agent_role=AgentRole.REASONING_AGENT,
            steps=steps,
            what_changed=raw.get("what_changed"),
            why_changed=raw.get("why_changed"),
            affected_patient_groups=raw.get("affected_patient_groups", []),
            modified_pathway=raw.get("modified_pathway"),
            evidence_that_caused_change=raw.get("evidence_that_caused_change", []),
            now_contraindicated=raw.get("now_contraindicated", []),
            stronger_evidence=raw.get("stronger_evidence", []),
            weaker_evidence=raw.get("weaker_evidence", []),
            final_answer=raw.get("final_answer", ""),
            confidence=float(raw.get("confidence", 0.8)),
            graph_nodes_visited=raw.get("graph_nodes_visited", []),
            delta_ids_referenced=raw.get("delta_ids_referenced", []),
        )


# ─────────────────────────────────────────────────────────────────
# PIPELINE ORCHESTRATOR
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

class AgenticGraphRAGPipeline:
    """
    Orchestrates all 8 stages of the Agentic Graph RAG pipeline.

    Quick start:
        pipeline = AgenticGraphRAGPipeline()
        source   = DocumentSource(
            source_type=SourceType.TEXT,
            guideline_source=GuidelineSource.NCCN,
            name="NCCN NSCLC 2024",
            version="2024.1",
        )
        graph = pipeline.run_from_text(text, source)
        chain = pipeline.query("What changed for HER2+ patients?")
        print(chain.final_answer)
        pipeline.export_graph_json("graph.json")
    """

    def __init__(self, api_key: str = GROQ_API_KEY, model: str = MODEL,
                 prior_graph: Optional[ClinicalKnowledgeGraph] = None):
        logger.info("Initialising AgenticGraphRAGPipeline …")
        llm = LLMClient(api_key=api_key, model=model)
        self._llm = llm
        self._parser      = DocumentParsingAgent(llm)
        self._entities    = ClinicalEntityExtractionAgent(llm)
        self._relations   = RelationshipExtractionAgent(llm)
        self._graph_agent = KnowledgeGraphAgent(llm)
        self._protocols   = ProtocolPathwayAgent(llm)
        self._deltas      = GuidelineDeltaAgent(llm)
        self._evidence    = EvidenceLinkingAgent(llm)
        self._reasoning   = AgenticReasoningAgent(llm)

        # ─────────────────────────────────────
        # VALIDATION + RECOVERY AGENTS
        # ─────────────────────────────────────
        self._coverage_validator = CoverageValidationAgent()

        self._critic = MissingEntityCriticAgent(
            self._llm
        )

        self._retry = RetryExtractionAgent(
            self._llm
        )

        self._graph_repair = GraphRepairAgent(
            self._llm
        )

        # LOAD EXISTING GRAPH
        # LOAD EXISTING GRAPH
        if prior_graph:

            self._all_nodes = []
            self._all_edges = []

            # ─────────────────────────────────────
            # RESTORE NODE OBJECTS
            # ─────────────────────────────────────
            for node in prior_graph.nodes:

                try:

                    if not isinstance(node, dict):
                        self._all_nodes.append(node)
                        continue

                    node_type = node.get("type")

                    model_cls = NODE_MODEL_MAP.get(
                        str(node_type).replace("NodeType.", "").lower(),
                        RecommendationNode
                    )

                    self._all_nodes.append(
                        model_cls(**node)
                    )

                except Exception as exc:
                    logger.warning(f"Failed restoring node: {exc}")

            # ─────────────────────────────────────
            # RESTORE EDGE OBJECTS
            # ─────────────────────────────────────
            for edge in prior_graph.edges:

                try:

                    if not isinstance(edge, dict):
                        self._all_edges.append(edge)
                        continue

                    relation = edge.get("relation")

                    if isinstance(relation, str):
                        relation = EdgeRelation(relation)

                    self._all_edges.append(
                        GraphEdge(
                            **{
                                **edge,
                                "relation": relation
                            }
                        )
                    )

                except Exception as exc:
                    logger.warning(f"Failed restoring edge: {exc}")

        else:

            self._all_nodes = []
            self._all_edges = []
        self._source_docs:  List[ParsedDocument]   = []
        self._agent_outputs: List[AgentOutput]     = []
        self._prior_graph   = prior_graph
        self.graph: Optional[ClinicalKnowledgeGraph] = None
        logger.info("Pipeline ready.")


    # ─────────────────────────────────────
    # DEDUP NODE MERGE
    # ─────────────────────────────────────
    # def merge_nodes(self, existing, new_nodes):

    #     existing_ids = {
    #         n["id"] if isinstance(n, dict) else n.id
    #         for n in existing
    #     }

    #     for n in new_nodes:

    #         node_id = n["id"] if isinstance(n, dict) else n.id

    #         if node_id not in existing_ids:
    #             existing.append(n)
    #             existing_ids.add(node_id)

    #     return existing


    # ─────────────────────────────────────
    # DEDUP EDGE MERGE
    # ─────────────────────────────────────
    def merge_edges(self, existing, new_edges):

        def edge_key(e):

            if isinstance(e, dict):
                return (
                    e["source"],
                    e["target"],
                    e["relation"]
                )

            return (
                e.source,
                e.target,
                e.relation
            )

        existing_keys = {
            edge_key(e)
            for e in existing
        }

        for e in new_edges:

            key = edge_key(e)

            if key not in existing_keys:
                existing.append(e)
                existing_keys.add(key)

        return existing


    def merge_nodes(self, existing, recovered):

        seen = {
            n.id for n in existing
        }

        merged = list(existing)

        for node in recovered:

            if node.id not in seen:
                merged.append(node)
                seen.add(node.id)

        return merged

    # ── Public ingestion ──────────────────────────────────────────

    def run_from_pdf(self, pdf_bytes: bytes,
                     source: DocumentSource) -> ClinicalKnowledgeGraph:
        doc = self._parser.parse_pdf(pdf_bytes, source)
        return self._run(doc)

    def run_from_text(self, text: str,
                      source: DocumentSource) -> ClinicalKnowledgeGraph:
        doc = self._parser.parse_text(text, source)
        return self._run(doc)

    async def run_from_url(self, url: str,
                           source: DocumentSource) -> ClinicalKnowledgeGraph:
        doc = await self._parser.parse_url(url, source)
        return self._run(doc)

    def run_batch(self, sources: List[Tuple[Any, DocumentSource]]) -> ClinicalKnowledgeGraph:
        """Ingest multiple documents into a single unified graph."""
        for content, source in sources:
            doc = (self._parser.parse_pdf(content, source)
                   if isinstance(content, bytes)
                   else self._parser.parse_text(str(content), source))
            self._extract_from_doc(doc)
        return self._build_graph()

    # ── Public query ──────────────────────────────────────────────

    def query(self, clinical_question: str) -> ClinicalReasoningChain:
        if self.graph is None:
            raise RuntimeError("Run the pipeline first.")
        chain = self._reasoning.reason(clinical_question, self.graph)
        self.graph.reasoning_chains.append(chain)
        self.graph.compute_summary()
        return chain

    def answer_doctor_questions(self) -> List[ClinicalReasoningChain]:
        if self.graph is None:
            raise RuntimeError("Run the pipeline first.")
        chains = self._reasoning.reason_all(self.graph)
        self.graph.reasoning_chains.extend(chains)
        self.graph.compute_summary()
        return chains

    def export_graph(self) -> Dict[str, Any]:
        if self.graph is None:
            raise RuntimeError("Run the pipeline first.")
        return self.graph.model_dump()

    def export_graph_json(self, path: str = "clinical_graph_output.json") -> str:
        data = json.dumps(self.export_graph(), indent=2, default=str)
        with open(path, "w") as fh:
            fh.write(data)
        logger.info(f"Graph exported → {path}")
        return path

    def handle_delta_query(self, request: DeltaQueryRequest) -> DeltaQueryResponse:
        if self.graph is None:
            raise RuntimeError("Run the pipeline first.")
        chain = self.query(request.clinical_question)
        return DeltaQueryResponse(
            pipeline_id=self.graph.pipeline_id,
            clinical_question=request.clinical_question,
            what_changed=chain.what_changed,
            why_changed=chain.why_changed,
            affected_patient_groups=chain.affected_patient_groups,
            modified_pathway=chain.modified_pathway,
            evidence_that_caused_change=chain.evidence_that_caused_change,
            now_contraindicated=chain.now_contraindicated,
            stronger_evidence=chain.stronger_evidence,
            weaker_evidence=chain.weaker_evidence,
            reasoning_chain_id=chain.id,
            confidence=chain.confidence,
        )

    # ── Internal ──────────────────────────────────────────────────

    def _run(self, doc: ParsedDocument) -> ClinicalKnowledgeGraph:
        self._extract_from_doc(doc)
        return self._build_graph()

    def _extract_from_doc(self, doc: ParsedDocument) -> None:

        self._source_docs.append(doc)

        # ─────────────────────────────────────
        # EXTRACT NODES
        # ─────────────────────────────────────
        nodes, ent_out = self._entities.extract(doc)

        # DEDUP NODE MERGE
        self._all_nodes = self.merge_nodes(
            self._all_nodes,
            nodes
        )

        self._agent_outputs.append(ent_out)

        # ─────────────────────────────────────
        # EXTRACT EDGES
        # ─────────────────────────────────────
        edges, rel_out = self._relations.extract(nodes, doc)

        # DEDUP EDGE MERGE
        self._all_edges = self.merge_edges(
            self._all_edges,
            edges
        )

        self._agent_outputs.append(rel_out)


        # ─────────────────────────────────────
        # COVERAGE VALIDATION
        # ─────────────────────────────────────

        coverage = None

        chunk_records = getattr(
            doc,
            "chunk_records",
            []
        )

        if chunk_records:

            # coverage audit
            coverage = self._coverage_validator.validate(
                chunk_records,
                nodes
            )

            logger.info(
                f"Coverage score: "
                f"{coverage.coverage_percent:.1f}%"
            )

            # retry extraction if low coverage
            if not coverage.is_acceptable(threshold=80.0):

                logger.warning(
                    f"Coverage only "
                    f"{coverage.coverage_percent:.1f}% "
                    f"— triggering critic + retry"
                )

                missing_by_chunk = (
                    self._critic.critique_all_missing_chunks(
                        chunk_records,
                        coverage,
                        nodes
                    )
                )

                if missing_by_chunk:

                    recovered = self._retry.retry_all(
                        chunk_records,
                        missing_by_chunk,
                        source_id=doc.source_id,
                        guideline_source=doc.guideline_source.value,
                        version=doc.version,
                    )

                    nodes = self.merge_nodes(
                        nodes,
                        recovered
                    )

                    self._all_nodes = self.merge_nodes(
                        self._all_nodes,
                        recovered
                    )

        # ─────────────────────────────────────
        # GRAPH REPAIR
        # ─────────────────────────────────────

        nodes, edges, repair_report = (
            self._graph_repair.repair(
                nodes,
                edges
            )
        )
        # sync repaired graph
        self._all_nodes = nodes
        self._all_edges = edges

        # coverage score
        if coverage:
            doc.coverage_score = build_coverage_score(
                coverage,
                nodes,
                repair_report
            )

    def _build_graph(self) -> ClinicalKnowledgeGraph:
        # Stage 4
        graph = self._graph_agent.build(
            self._all_nodes, self._all_edges,
            self._source_docs, self._agent_outputs,
        )
        # Stage 5
        protocols, p_out = self._protocols.extract(graph, self._source_docs)
        graph.protocol_graphs = protocols
        graph.agent_outputs.append(p_out)
        # Stage 6
        deltas, d_out = self._deltas.detect(graph, self._source_docs, self._prior_graph)
        graph.deltas = deltas
        graph.agent_outputs.append(d_out)
        # Stage 7
        evidence, e_out = self._evidence.link(graph, self._source_docs)
        graph.evidence_map = evidence
        graph.agent_outputs.append(e_out)
        # Stage 8
        chains = self._reasoning.reason_all(graph)
        graph.reasoning_chains = chains
        graph.agent_outputs.append(AgentOutput(
            agent_name=AgenticReasoningAgent.__name__,
            agent_role=AgentRole.REASONING_AGENT,
            source_id=self._source_docs[0].source_id if self._source_docs else "",
            reasoning_chains=[c.model_dump() for c in chains],
            confidence=sum(c.confidence for c in chains) / max(len(chains), 1),
        ))
        graph.compute_summary()
        self.graph = graph
        logger.info(
            f"\n{'─'*55}\n"
            f"  Pipeline complete — {graph.pipeline_id}\n"
            f"  Nodes:     {graph.total_nodes}\n"
            f"  Edges:     {graph.total_edges}\n"
            f"  Pathways:  {graph.total_pathways}\n"
            f"  Deltas:    {graph.total_deltas}\n"
            f"  Evidence:  {graph.total_evidence}\n"
            f"  Chains:    {graph.total_chains}\n"
            f"{'─'*55}"
        )
        return graph


# ─────────────────────────────────────────────────────────────────
# API WRAPPER
# ─────────────────────────────────────────────────────────────────

class ClinicalPipelineAPI:
    def __init__(self):
        self._pipelines: Dict[str, AgenticGraphRAGPipeline] = {}

    def run(self, request: PipelineRunRequest) -> PipelineRunResponse:
        pipeline = AgenticGraphRAGPipeline()
        batch = []
        for url in request.urls:
            try:
                gs = GuidelineSource(request.options.get("guideline_source", "other"))
            except ValueError:
                gs = GuidelineSource.OTHER
            batch.append((url, DocumentSource(
                source_type=SourceType.LINK, guideline_source=gs, name=url
            )))
        graph = pipeline.run_batch(batch)
        self._pipelines[graph.pipeline_id] = pipeline
        return PipelineRunResponse(
            status="completed",
            pipeline_id=graph.pipeline_id,
            total_nodes=graph.total_nodes,
            total_edges=graph.total_edges,
            total_pathways=graph.total_pathways,
            total_deltas=graph.total_deltas,
            total_evidence=graph.total_evidence,
            total_chains=graph.total_chains,
            source_names=graph.source_names,
            source_versions=graph.source_versions,
            graph=graph.model_dump(),
        )

    def query(self, request: DeltaQueryRequest) -> DeltaQueryResponse:
        pid = request.pipeline_id
        pipeline = (self._pipelines.get(pid) or
                    (list(self._pipelines.values())[-1] if self._pipelines else None))
        if not pipeline:
            raise RuntimeError("No pipeline runs available.")
        return pipeline.handle_delta_query(request)


# ─────────────────────────────────────────────────────────────────────────────
# CHUNKED PARSING HELPER
# ─────────────────────────────────────────────────────────────────────────────
 
def chunk_text_with_overlap(text: str,
                             chunk_size: int = 10_000,
                             overlap: int = 500) -> list[str]:
    """
    Split a long document into overlapping chunks so the LLM sees the full
    document across multiple Stage 2 calls.
 
    Usage in DocumentParsingAgent._parse_raw():
        chunks = chunk_text_with_overlap(raw_text)
        for chunk in chunks:
            data = self._llm.complete_json(STAGE1_DOCUMENT_PARSING_SYSTEM, chunk)
            # merge sections from each chunk
    """
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        chunks.append(text[start:end])
        if end == len(text):
            break
        start = end - overlap
    return chunks
 
 
# ─────────────────────────────────────────────────────────────────────────────
# ENTITY EXTRACTION CHUNKED HELPER
# ─────────────────────────────────────────────────────────────────────────────
 
def get_extraction_user_prompt(source_name: str,
                                section_title: str,
                                section_content: str,
                                document_type: str = "clinical_practice_guideline",
                                guideline_source: str = "acog") -> str:
    """
    Build a richer user-turn prompt for Stage 2 entity extraction.
    Includes document-type context so the LLM applies the right extraction anchors.
    """
    return f"""
SOURCE: {source_name}
GUIDELINE SOURCE: {guideline_source.upper()}
DOCUMENT TYPE: {document_type}
SECTION: {section_title}
 
EXTRACTION INSTRUCTIONS FOR THIS SECTION:
- If this section contains "ACOG recommends" or "ACOG suggests", extract
  one recommendation node per statement with full verbatim recommendation_text.
- If this section contains imaging accuracy tables (sensitivity/specificity),
  extract one diagnostic_test node per imaging modality per subtype.
- If this section mentions biomarkers (CA 125, miRNA, etc.), extract each
  as a biomarker node with clinical_utility = "not recommended" if the text
  says "ACOG recommends against".
- If this section mentions studies (Ballard et al., Nisenblat et al., etc.),
  extract each as a study node with all available statistics.
- If this section mentions patient subgroups (adolescents, Black women,
  transgender men), extract each as a patient_subgroup node with equity_note.
- If this section mentions risk factors (early menarche, family history, BMI),
  extract each as a risk_factor node with magnitude from the text.
 
SECTION TEXT:
{section_content}
""".strip()
 
 
# ─────────────────────────────────────────────────────────────────────────────
# INTEGRATION PATCH — apply these changes to rag_pipeline.py
# ─────────────────────────────────────────────────────────────────────────────
 
INTEGRATION_INSTRUCTIONS = """
STEP-BY-STEP INTEGRATION
─────────────────────────
 
1. IMPORT at the top of rag_pipeline.py:
   from enhanced_agent_prompts import (
       STAGE1_DOCUMENT_PARSING_SYSTEM,
       STAGE2_ENTITY_EXTRACTION_SYSTEM,
       STAGE3_RELATIONSHIP_EXTRACTION_SYSTEM,
       STAGE5_PROTOCOL_PATHWAY_SYSTEM,
       STAGE6_DELTA_DETECTION_SYSTEM,
       STAGE7_EVIDENCE_LINKING_SYSTEM,
       STAGE8_REASONING_SYSTEM,
       SECTION_CONTEXT_LIMIT_ENHANCED,
       NODE_BATCH_SIZE_ENHANCED,
       MAX_TOKENS_ENHANCED,
       chunk_text_with_overlap,
       get_extraction_user_prompt,
   )
 
2. REPLACE SYSTEM STRINGS in each agent class:
   DocumentParsingAgent.SYSTEM          = STAGE1_DOCUMENT_PARSING_SYSTEM
   ClinicalEntityExtractionAgent.SYSTEM = STAGE2_ENTITY_EXTRACTION_SYSTEM
   RelationshipExtractionAgent.SYSTEM   = STAGE3_RELATIONSHIP_EXTRACTION_SYSTEM
   ProtocolPathwayAgent.SYSTEM          = STAGE5_PROTOCOL_PATHWAY_SYSTEM
   GuidelineDeltaAgent.SYSTEM           = STAGE6_DELTA_DETECTION_SYSTEM
   EvidenceLinkingAgent.SYSTEM          = STAGE7_EVIDENCE_LINKING_SYSTEM
   AgenticReasoningAgent.SYSTEM         = STAGE8_REASONING_SYSTEM
 
3. UPDATE global constants:
   SECTION_CONTEXT_LIMIT = SECTION_CONTEXT_LIMIT_ENHANCED  # 12 000
   NODE_BATCH_SIZE       = NODE_BATCH_SIZE_ENHANCED          # 30
   MAX_TOKENS            = MAX_TOKENS_ENHANCED               # 6 000
 
4. UPDATE DocumentParsingAgent._parse_raw() to chunk long documents:
 
   def _parse_raw(self, raw_text: str, source: DocumentSource) -> ParsedDocument:
       chunks = chunk_text_with_overlap(raw_text, chunk_size=12_000, overlap=1500)
       all_sections = []
       doc_type, title, version, pub_date, target_pop, condition = [None]*6
       replaces = []
 
       for i, chunk in enumerate(chunks):
           data = self._llm.complete_json(
               self.SYSTEM,
               f"Source: {source.name}\\nGuideline: {source.guideline_source.value}\\n"
               f"Chunk {i+1} of {len(chunks)}:\\n\\n{chunk}",
           )
           if i == 0:  # metadata only from first chunk
               doc_type   = data.get("document_type", "journal_article")
               title      = data.get("title", source.name)
               version    = data.get("version") or source.version
               pub_date   = data.get("publication_date")
               target_pop = data.get("target_population")
               condition  = data.get("condition")
               replaces   = data.get("replaces", [])
           sections_data = data.get("sections") or []

            if isinstance(sections_data, list):
                all_sections.extend(sections_data)
 
       # deduplicate sections by title+content hash
       seen = set()
       unique_sections = []
       for s in all_sections:
           key = s.get("title","") + s.get("content","")[:100]
           if key not in seen:
               seen.add(key)
               unique_sections.append(DocumentSection(
                   title=s.get("title", ""),
                   content=s.get("content", ""),
                   section_type=s.get("section_type", "other"),
                   page_number=s.get("page_number"),
               ))
       ...
 
5. UPDATE ClinicalEntityExtractionAgent.extract() to use richer user prompt:
 
   raw = self._llm.complete_json(
       self.SYSTEM,
       get_extraction_user_prompt(
           source_name=doc.source_name,
           section_title=section.title,
           section_content=section.content[:SECTION_CONTEXT_LIMIT],
           document_type=doc.document_type.value if doc.document_type else "clinical_practice_guideline",
           guideline_source=doc.guideline_source.value,
       ),
       max_tokens=MAX_TOKENS,
   )
 
6. UPDATE GuidelineDeltaAgent.detect() to pass replaces metadata:
 
   # Pass replaced document info in the user prompt
   replaces_ctx = ""
   if hasattr(doc, 'replaces') and doc.replaces:
       replaces_ctx = f"THIS DOCUMENT REPLACES: {json.dumps(doc.replaces)}\\n"
   # prepend replaces_ctx to the current_text in the user prompt
 
7. EXPECTED OUTPUT IMPROVEMENT after these changes (ACOG endometriosis CPG):
   Nodes:     5  →  ~40–60  (all recommendations, tests, studies, biomarkers)
   Edges:     4  →  ~60–90  (imaging→disease, rec→context, study→rec)
   Pathways:  0  →  ~5–7   (clinical eval, imaging, laparoscopy decision, etc.)
   Deltas:    0  →  ~8–12  (replaces PB 114 + CO 760; new TVUS rec; biomarker contraindication)
   Evidence:  0  →  ~15–20 (Nisenblat, Ballard, Chapron, Gerges studies)
   Chains:    7  →  7      (but all with real content instead of "no data")
"""
 
if __name__ == "__main__":
    print("Enhanced prompts module loaded.")
    print(f"Stage 1 prompt: {len(STAGE1_DOCUMENT_PARSING_SYSTEM)} chars")
    print(f"Stage 2 prompt: {len(STAGE2_ENTITY_EXTRACTION_SYSTEM)} chars")
    print(f"Stage 3 prompt: {len(STAGE3_RELATIONSHIP_EXTRACTION_SYSTEM)} chars")
    print(f"Stage 5 prompt: {len(STAGE5_PROTOCOL_PATHWAY_SYSTEM)} chars")
    print(f"Stage 6 prompt: {len(STAGE6_DELTA_DETECTION_SYSTEM)} chars")
    print(f"Stage 7 prompt: {len(STAGE7_EVIDENCE_LINKING_SYSTEM)} chars")
    print(f"Stage 8 prompt: {len(STAGE8_REASONING_SYSTEM)} chars")
    print()
    print(INTEGRATION_INSTRUCTIONS)