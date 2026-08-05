"""
CCGI Clinical Graph Intelligence — Lean 3-Agent Reasoning System (v4.6)
=====================================================================

Architecture:
  A1  Timeline Agent          → date-wise chronological reconstruction from graph data,
                                 organized by ENTITY TYPE within each date (not a document
                                 dump). Processes documents in BATCHES of TIMELINE_BATCH_SIZE
                                 (concurrently), merges the batches deterministically in
                                 Python, then writes narratives in TWO further batched steps:

                                   (a) PER-DOCUMENT narrative generation — flattened across
                                   ALL dates into batches of NARRATIVE_BATCH_SIZE documents
                                   (mixing dates freely, since each document's narrative is
                                   grounded strictly in its own entities and is completely
                                   independent of any other document). This is what actually
                                   fixes the old failure mode: previously ALL dates were sent
                                   in a SINGLE LLM call to write both the date-level and
                                   document-level narratives together, so a date with many
                                   documents piled onto it (e.g. 20+ documents on one day)
                                   could blow past the model's context/output limit in that
                                   one call and silently fall back to an undifferentiated,
                                   unreadable dump of every entity name with no per-document
                                   separation. Now each batch of NARRATIVE_BATCH_SIZE
                                   documents is a small, independent, bounded call.

                                   (b) DATE-level narrative — built 100% DETERMINISTICALLY in
                                   Python (no LLM call) by concatenating each date's already-
                                   generated per-document narratives into
                                   "Document: <name>\n\n<narrative>" sections, exactly per
                                   spec. This removes the date-level narrative as a failure
                                   point entirely and guarantees the required
                                   one-document-per-section structure regardless of how many
                                   documents share a date.

                                 Each date also lists exactly which source documents are
                                 present on that date, AND a fully DOCUMENT-WISE breakdown
                                 ("documents_detail") so multiple same-date documents are
                                 never blended into a single undifferentiated bucket. Dates
                                 are ordered LATEST FIRST.

  A2  Clinical Summary Agent  → doctor-letter-style narrative (multi-paragraph), grounded
                                 ONLY in graph document data, no recommendations/predictions.
                                 Any diagnosis stated as CONFIRMED (biopsy/histopathology or
                                 other gold-standard confirmation in the record — never a
                                 merely suspected/probable one) is wrapped in markdown
                                 **bold** in the narrative and in the diagnosis header.
                                 Fully mines STRUCTURED WORKFLOW DOCUMENTS (chemotherapy,
                                 radiotherapy, surgical, nursing, treatment-planning, or any
                                 structured EMR/JSON-style document) for treatment-management
                                 detail — treatment intent, protocol, cycle counts, dose
                                 adjustments, concurrent therapy, administration details,
                                 monitoring observations, and treatment status — instead of
                                 only surfacing the diagnosis/medication from them.

                                 NEW IN v4.4: prompts strengthened for richer, more complete
                                 output — when the record contains MULTIPLE documents of the
                                 same type (e.g. several separate chemotherapy administration
                                 records, several dictations), each is described as its own
                                 individual clinical event with its own date/time/detail,
                                 never folded into one generic combined sentence. Sentence
                                 count guidance now scales with how much is documented.

                                 NEW IN v4.5: the final synthesis pass now writes the summary
                                 as one continuous, doctor-narrated STORY of the patient's
                                 course — chronological, connected with natural clinical
                                 transitions ("Following this...", "He was subsequently
                                 started on...") — instead of a dense back-to-back list of
                                 facts, while still requiring every individual chemotherapy
                                 administration, radiotherapy session/plan, surgical event,
                                 and other structured workflow detail to be narrated as its
                                 own moment in the story (never merged or summarized away).
                                 The final-synthesis call now also uses its own
                                 SUMMARY_SYNTHESIS_MAX_TOKENS budget (defaults to
                                 GROQ_MAX_TOKENS) so a long, fully-documented story is never
                                 silently truncated, without changing the token budget of any
                                 other call in the pipeline. OUTPUT JSON SCHEMA for A2 is
                                 UNCHANGED.

                                 NEW IN v4.6: fixes chemotherapy/systemic-therapy treatment
                                 course being under-represented in the final summary even
                                 though it was correctly extracted into the Timeline. Both
                                 the fact-extraction pass (Pass 1) and the synthesis pass
                                 (Pass 2) now explicitly treat chemotherapy/radiotherapy/
                                 surgical/treatment-workflow documents as the AUTHORITATIVE
                                 source for treatment information, and are required to always
                                 surface: treatment modality, treatment intent, regimen/
                                 protocol, current treatment status, current cycle vs planned
                                 cycles, and any documented treatment response or toxicity.
                                 Multiple workflow documents describing the SAME regimen are
                                 now woven into ONE continuous chronological treatment
                                 narrative in the synthesis pass (rather than repeated as
                                 separate boilerplate paragraphs) — this changes ONLY how
                                 they are connected in prose; every cycle's own date, dose,
                                 and status is still individually preserved, nothing is
                                 dropped. Purely operational/administrative workflow metadata
                                 (nurse verification, pharmacy verification, consent capture,
                                 IV/venous access mechanics, drug labeling/preparation
                                 checklists) is explicitly excluded from the clinical summary
                                 UNLESS it reflects an actual clinical event (e.g. a reaction,
                                 extravasation, or documented toxicity) — the Timeline (A1)
                                 continues to retain this detail at the document level
                                 regardless, since A1's prompts are unchanged. OUTPUT JSON
                                 SCHEMA for A2 is UNCHANGED — no keys added, removed, or
                                 renamed.

                                 BATCHED, TWO-PASS, LIKE A1 (bounded, regardless of patient
                                 document volume):
                                   Pass 1 (fact extraction): graph_documents are split into
                                   batches of SUMMARY_BATCH_SIZE (default 10) and processed
                                   CONCURRENTLY. Each batch call only ever sees its own small
                                   slice of documents.
                                   Merge (deterministic, no LLM): all batches' extracted
                                   facts are concatenated in Python.
                                   Pass 2 (synthesis): ONE final, much smaller LLM call takes
                                   the concatenated facts + a COMPACT projection of the A1
                                   timeline (date + documents + narrative only) and writes
                                   the final doctor-narrated story.
                                 The OUTPUT JSON SCHEMA for A2 is unchanged.

  A3  Organ System Agent      → organ/system-wise consolidated analysis.

                                 BATCHED, TWO-PASS, LIKE A1/A2:
                                   Pass 1 (concurrent, per-batch extraction): graph_documents
                                   are split into batches of ORGAN_BATCH_SIZE (default 10)
                                   documents. Each batch call extracts a flat list of
                                   {system, finding, date, source_document} entries.
                                   Merge (deterministic, no LLM): all batches' findings are
                                   grouped by system name in Python, first/latest documented
                                   dates computed deterministically.
                                   Pass 2 (single, final synthesis call): takes ONLY the
                                   compact, deduplicated per-system findings list and asks
                                   the LLM to write consolidated_status and trend per system.
                                 OUTPUT JSON SCHEMA for A3 is unchanged.

Design principles:
  - No hardcoded disease logic, no demo/oncology-specific schemas.
  - Every output must be traceable to entities actually present in
    `graph_documents` fetched from Neo4j. Nothing is invented or predicted.
  - The Clinical Summary agent explicitly must NOT recommend treatment or
    predict future course — it only reports what is documented (including
    documented referrals — reporting "patient was referred to X" is a fact,
    not a recommendation).
  - The timeline's per-document narrative is written strictly from that
    document's own organized entities — never inferred or extrapolated
    beyond what's actually present. The date-level narrative is a
    deterministic, lossless concatenation of its documents' narratives —
    never a separate LLM call, so it can never blend documents together
    or silently fail into an unreadable dump.
  - Agents run sequentially so each stage builds on cleaner, more organized
    input from the previous stage (Timeline -> Summary -> Organ Analysis).
  - EVERY LLM call in the pipeline is sized so it does NOT scale linearly
    with the patient's total raw document/entity volume — A1, A2, and A3
    all batch their raw-document (or, for A1's narrative pass, flattened
    per-document) reads, merge/assemble deterministically in Python, and
    only ever run bounded-size calls — never a single call whose size
    scales with total patient document count.
  - Output JSON keys already relied upon by the frontend are never removed
    or renamed — changes in this version are additive-only (new nested
    fields) or internal/prompt-only (no schema impact). v4.5's story-style
    rewrite is prompt-only: A2's output keys (diagnosis_header,
    confirmed_diagnosis_present, confirmed_diagnoses, paragraphs, full_text,
    source_coverage_check) are byte-for-byte the same shape as before. v4.6
    is likewise prompt-only — same guarantee.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import datetime, date as date_cls
from typing import Any, Dict, List, Optional, TypedDict
from langchain_openai import ChatOpenAI
from fastapi import APIRouter, HTTPException
from loguru import logger
from neo4j import AsyncGraphDatabase
from pydantic import BaseModel

from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import StateGraph, END

from motor.motor_asyncio import AsyncIOMotorClient

# ============================================================
# ENVIRONMENT / CLIENTS
# ============================================================

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

mongo_client = AsyncIOMotorClient(MONGO_URI)
mongo_db = mongo_client[MONGO_DB]

summary_collection = mongo_db["patient_summary"]

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
NEO4J_URI    = os.getenv("NEO4J_URI", "bolt://neo4j:7687")
NEO4J_USER   = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASS   = os.getenv("NEO4J_PASSWORD", "password")

neo4j_driver = AsyncGraphDatabase.driver(
    NEO4J_URI,
    auth=(NEO4J_USER, NEO4J_PASS),
    max_connection_lifetime=3600,
    max_connection_pool_size=50,
)

# How many completion tokens each LLM call is allowed to produce. Set
# explicitly (rather than relying on the client default, which can be much
# smaller) so that the Clinical Summary letter and other longer outputs are
# never silently truncated. Comfortably under llama-3.3-70b-versatile's
# published completion cap.
GROQ_MAX_TOKENS = int(os.getenv("GROQ_MAX_TOKENS", "8000"))

# Max tokens for A2's FINAL SYNTHESIS call specifically (the one that writes
# the story-style clinical summary). Split out from GROQ_MAX_TOKENS so it can
# be tuned independently — a fully story-narrated summary for a heavily
# documented patient (many chemo cycles, radio sessions, etc.) runs longer
# than the old fact-list style, and this gives you a dedicated knob to avoid
# truncation WITHOUT changing the token budget/cost of every other call in
# the pipeline (A1 batches, A2 fact-extraction batches, A3 batches all still
# use GROQ_MAX_TOKENS as before). Defaults to GROQ_MAX_TOKENS if not set, so
# behavior is unchanged unless you explicitly raise it in the environment.
SUMMARY_SYNTHESIS_MAX_TOKENS = int(
    os.getenv("SUMMARY_SYNTHESIS_MAX_TOKENS", str(GROQ_MAX_TOKENS))
)

# Max tokens for A2's Pass-1 FACT-EXTRACTION calls specifically. v4.6 asks
# each extraction batch to pull out more structured treatment-course detail
# per workflow document (modality/intent/regimen/status/cycles/response or
# toxicity) than before, which can make a batch's own JSON output longer —
# especially a batch that happens to contain several chemo/radio workflow
# documents. Splitting this out from GROQ_MAX_TOKENS gives a dedicated knob
# to raise if you see extraction-pass truncation in logs (parse_llm_json
# falling back to {"raw_output": ...}), without touching the token budget of
# A1 or A3. Defaults to GROQ_MAX_TOKENS, so behavior/cost is unchanged unless
# explicitly raised.
SUMMARY_EXTRACTION_MAX_TOKENS = int(
    os.getenv("SUMMARY_EXTRACTION_MAX_TOKENS", str(GROQ_MAX_TOKENS))
)

# Single high-quality LLM used for all agents.
llm_synthesis = ChatGroq(
    model="llama-3.3-70b-versatile",
    temperature=0.1,
    groq_api_key=GROQ_API_KEY,
    max_tokens=GROQ_MAX_TOKENS,
)

router = APIRouter(prefix="", tags=["Clinical Reasoning"])

# Timeline batching — process this many documents per LLM call, then merge
# the batches deterministically. Keeps each call small/relile dls
# of how many documents the patient has.
TIMELINE_BATCH_SIZE = int(os.getenv("TIMELINE_BATCH_SIZE", "5"))

# Narrative batching — how many documents' worth of per-document narrative
# to request per LLM call in A1's narrative-writing pass. Flattened across
# ALL dates (mixing dates freely is safe, since each document's narrative
# is independently grounded in only its own entities). This is the setting
# that keeps a date with many documents piled onto it (e.g. 20+ documents
# on one day) from ever being sent to the LLM in a single oversized call.
NARRATIVE_BATCH_SIZE = int(os.getenv("NARRATIVE_BATCH_SIZE", "10"))

# Clinical-summary batching — same idea as TIMELINE_BATCH_SIZE, but for A2's
# fact-extraction pass. This is what keeps A2 from ever sending all raw
# documents in one call — it reads them BATCH_SIZE at a time and merges
# deterministically.
SUMMARY_BATCH_SIZE = int(os.getenv("SUMMARY_BATCH_SIZE", "10"))

# Organ-analysis batching — same idea again, for A3's per-system-finding
# extraction pass. Keeps A3 from ever sending the full entity-level
# timeline or the full A2 narrative in one call.
ORGAN_BATCH_SIZE = int(os.getenv("ORGAN_BATCH_SIZE", "10"))


def _chunk_list(items: List[Any], size: int) -> List[List[Any]]:
    """Generic, shared chunking helper used by the Timeline, Clinical
    Summary, and Organ Analysis agents to split raw documents (or, for
    A1's narrative pass, flattened per-document entries) into small,
    safely sized batches."""
    if size <= 0:
        return [items] if items else []
    return [items[i:i + size] for i in range(0, len(items), size)]


def _safe_date_key(d: Optional[str]) -> str:
    """Sort key for ISO-ish date strings that tolerates None/garbage
    values by sorting them last, without ever raising."""
    if not d or d in ("None", "null", "NaT"):
        return "9999-99-99"
    return str(d)


# ============================================================
# REQUEST / RESPONSE MODELS
# ============================================================

class ClinicalRequest(BaseModel):
    patient_id:        str
    doctor_id:         str
    consultation_text: str
    specialty:         str
    include_intermediates: bool = False


class Clinical(BaseModel):
    patient_id: str
    doctor_id:  str


class ClinicalResponse(BaseModel):
    patient_id:         str
    doctor_id:          str
    generated_at:       str
    documents_analyzed: int
    processing_time_ms: int
    summary:            Dict[str, Any]
    timeline:            Dict[str, Any]
    organ_analysis:      Dict[str, Any]
    intermediate:        Optional[Dict[str, Any]] = None


# ============================================================
# CLINICAL STATE
# ============================================================

class ClinicalState(TypedDict):
    # Inputs
    patient_id:        str
    doctor_id:         str
    consultation_text: str
    specialty:         str
    graph_documents:   List[Dict]
    dob:               Optional[str]
    sex:               Optional[str]
    age:               Optional[int]
    patient_name:       Optional[str]

    # A1 — Timeline
    timeline: Optional[Dict]

    # A2 — Clinical Summary (doctor-style narrative)
    clinical_summary: Optional[Dict]

    # A3 — Organ System Analysis
    organ_analysis: Optional[Dict]

    # Telemetry
    errors:        List[str]
    agent_timings: Dict[str, float]


# ============================================================
# NEO4J / MONGO FETCH  (generic — no disease-specific logic)
# ============================================================

def _calculate_age(dob_value: Any) -> Optional[int]:
    """Best-effort age calculation from a DOB stored in Mongo. Accepts
    datetime, date, or common string formats. Returns None if it can't
    be parsed — never guesses."""
    if not dob_value:
        return None

    dob_date: Optional[date_cls] = None

    if isinstance(dob_value, datetime):
        dob_date = dob_value.date()
    elif isinstance(dob_value, date_cls):
        dob_date = dob_value
    elif isinstance(dob_value, str):
        for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y", "%d-%b-%Y"):
            try:
                dob_date = datetime.strptime(dob_value.strip(), fmt).date()
                break
            except ValueError:
                continue

    if not dob_date:
        return None

    today = datetime.now().date()
    age = today.year - dob_date.year - (
        (today.month, today.day) < (dob_date.month, dob_date.day)
    )
    if age < 0 or age > 130:
        return None
    return age


async def fetch_patient_demographics(patient_id: str) -> dict:
    """Fetch DOB, gender, and (if present) name for a patient."""
    try:
        patient = await mongo_db["patient_users"].find_one(
            {"sys_user_id": patient_id},
            {
                "_id": 0,
                "date_of_birth": 1,
                "gender": 1,
                "name": 1,
                "full_name": 1,
                "patient_name": 1,
            },
        )
        if not patient:
            return {"dob": None, "sex": None, "name": None}

        name = (
            patient.get("name")
            or patient.get("full_name")
            or patient.get("patient_name")
        )

        return {
            "dob":  patient.get("date_of_birth"),
            "sex":  patient.get("gender"),
            "name": name,
        }
    except Exception:
        logger.exception(f"Failed to fetch demographics for patient {patient_id}")
        return {"dob": None, "sex": None, "name": None}


async def fetch_patient_graph_documents(patient_id: str) -> List[Dict]:
    cypher = """
    MATCH (p:Patient {patient_id: $patient_id})-[r]->(n)
    OPTIONAL MATCH (n)-[:SUPPORTED_BY_EVIDENCE]->(e:Evidence)

    WITH r, n, e,
        CASE
            WHEN e IS NULL OR e.document_date IS NULL OR e.document_date = "null"
            THEN NULL
            ELSE toString(e.document_date)
        END AS raw_date,
        coalesce(e.document_name, "unknown") AS document

    WITH r, n, e, document, raw_date,
        CASE
            WHEN raw_date IS NULL THEN NULL
            WHEN raw_date =~ '\\d{4}-\\d{2}-\\d{2}'
            THEN date(raw_date)
            WHEN raw_date =~ '\\d{2}-\\d{2}-\\d{4}'
            THEN date({
                year:  toInteger(split(raw_date,'-')[2]),
                month: toInteger(split(raw_date,'-')[1]),
                day:   toInteger(split(raw_date,'-')[0])
            })
            WHEN raw_date =~ '\\d{2}-[A-Za-z]{3}-\\d{4}'
            THEN date({
                year:  toInteger(split(raw_date,'-')[2]),
                month: CASE split(raw_date,'-')[1]
                    WHEN 'Jan' THEN 1 WHEN 'Feb' THEN 2 WHEN 'Mar' THEN 3
                    WHEN 'Apr' THEN 4 WHEN 'May' THEN 5 WHEN 'Jun' THEN 6
                    WHEN 'Jul' THEN 7 WHEN 'Aug' THEN 8 WHEN 'Sep' THEN 9
                    WHEN 'Oct' THEN 10 WHEN 'Nov' THEN 11 WHEN 'Dec' THEN 12
                    ELSE NULL END,
                day: toInteger(split(raw_date,'-')[0])
            })
            ELSE NULL
        END AS document_date

    WITH document, document_date,
        collect({
            relation: type(r),
            entity_type: CASE
                WHEN n:Treatment THEN "Treatment"
                WHEN n:Procedure THEN "Procedure"
                WHEN n:Diagnosis THEN "Diagnosis"
                WHEN n:Medication THEN "Medication"
                WHEN n:LabResult THEN "Lab Result"
                WHEN n:VitalSign THEN "Vital Sign"
                WHEN n:Finding THEN "Finding"
                WHEN n:Anatomy THEN "Anatomy"
                WHEN n:Measurement THEN "Measurement"
                ELSE head(labels(n))
            END,
            name: coalesce(
                n.name, n.details, n.description, n.drug_name,
                n.test_name, n.vital_type, n.value
            ),
            date: raw_date,
            evidence: e.evidence_text
        }) AS entities

    RETURN document, document_date, entities
    ORDER BY document_date ASC
    """

    try:
        async with neo4j_driver.session() as session:
            result = await session.run(cypher, patient_id=patient_id)
            docs: List[Dict] = []
            async for record in result:
                docs.append({
                    "document":      record["document"],
                    "document_date": str(record["document_date"]),
                    "entities":      record["entities"],
                })
            logger.info(f"Graph fetch: {len(docs)} documents for patient {patient_id}")
            return docs
    except Exception as e:
        logger.error(f"Neo4j fetch failed for patient {patient_id}: {e}")
        raise


# ============================================================
# BASE AGENT
# ============================================================

def parse_llm_json(text: str):
    if not text:
        return {}
    text = text.strip()
    text = re.sub(r"```json", "", text)
    text = re.sub(r"```", "", text)
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        text = match.group(0)
    try:
        return json.loads(text)
    except Exception:
        return {"raw_output": text}


class BaseAgent:
    def __init__(self, llm):
        self.llm = llm

    async def _invoke(self, system: str, user: str, max_tokens: Optional[int] = None):
        """Invoke the shared LLM. If max_tokens is given, bind a
        per-call override (used by A2's fact-extraction and final
        synthesis passes so neither gets silently truncated) without
        changing the token budget of any other call, which keeps using
        the client's default GROQ_MAX_TOKENS."""
        llm = self.llm.bind(max_tokens=max_tokens) if max_tokens else self.llm
        response = await llm.ainvoke([
            SystemMessage(content=system),
            HumanMessage(content=user),
        ])
        return parse_llm_json(response.content)

    def _elapsed(self, start: float) -> float:
        return round((datetime.now().timestamp() - start) * 1000, 1)


# ============================================================
# A1 · TIMELINE AGENT  (BATCHED, ENTITY-TYPE-GROUPED, WITH BATCHED
#                        PER-DOCUMENT NARRATIVE AND DETERMINISTIC
#                        DATE-LEVEL ASSEMBLY)
#
# Structure produced:
#   date -> entity_type -> [entities]   (NOT date -> document -> entities)
# so the timeline still reads as a clinical chronology grouped by what kind
# of information it is (Diagnosis, Finding, Lab Result, Measurement, etc.),
# with each individual entity still tagged with its source_document for
# traceability.
#
# Each date entry ALSO carries "documents_detail" — a fully document-wise
# breakdown, built PURELY DETERMINISTICALLY in Python from each entity's
# own "source_document" field (no extra LLM call, no risk of drifting from
# the source data). When two or more documents share the same date, their
# entities are therefore never silently pooled into one undifferentiated
# bucket — each document keeps its own entity-type grouping AND its own
# short narrative, in addition to the existing date-level narrative.
#
# Batches of TIMELINE_BATCH_SIZE documents are organized concurrently and
# merged deterministically in Python (no LLM in the merge step, so nothing
# can be lost or hallucinated there). Which source documents fall on which
# date is also computed deterministically straight from the raw documents
# (no LLM needed for that — it's just grouping by document_date).
#
# NARRATIVES: generated in two steps.
#   (1) PER-DOCUMENT narrative — every (date, document) pair across the
#       whole timeline is flattened into one list, then batched into
#       groups of NARRATIVE_BATCH_SIZE documents (mixing dates freely,
#       since each document's narrative only ever depends on its own
#       entities). Each batch is one small, independent, bounded LLM call.
#   (2) DATE-level narrative — built with ZERO additional LLM calls, by
#       deterministically concatenating each date's already-generated
#       per-document narratives into "Document: <name>\n\n<narrative>"
#       sections, in document order. This guarantees the required
#       one-document-per-section structure and removes the date-level
#       narrative as a failure point — a date with many documents can
#       never blow past a context limit here, because there IS no LLM
#       call at this step.
#
# Dates are returned LATEST FIRST (most recent date at the top), matching
# how a clinician wants to scan a chart — newest information first.
# ============================================================

class TimelineAgent(BaseAgent):
    agent_id = "A1"

    def _chunk_documents(self, docs: List[Dict]) -> List[List[Dict]]:
        return _chunk_list(docs, TIMELINE_BATCH_SIZE)

    # ---- Batch processing -------------------------------------------------

    async def _process_batch(
        self, batch_docs: List[Dict], specialty: str, batch_index: int
    ) -> Dict:
        """Organize a single batch of documents into date -> entity_type ->
        entities groups. Returns 'timeline' and 'undated' for this batch
        only — date_range/documents-per-date/documents_detail/narratives
        are computed after all batches merge."""

        docs_json = json.dumps(batch_docs, indent=2, default=str)

        system = (
            "You are a meticulous clinical data organizer. Your only job is to take "
            "a batch of raw clinical graph documents (each with a document date and a "
            "list of extracted entities) and reorganize them by DATE, then by ENTITY "
            "TYPE within each date — NOT by document. You do NOT diagnose, interpret "
            "significance, or predict anything. You do NOT omit any entity in this "
            "batch — every single entity you are given must appear in your output, "
            "tagged with the document it came from. You never invent a date, value, "
            "or finding that is not present in the source data. "
            "Always respond with valid JSON only."
        )

        prompt = f"""
You are reading a BATCH of raw clinical graph documents (batch #{batch_index + 1}) for a
patient being seen by a {specialty} specialist. This is a subset of the patient's full
record — only organize what is given below.

RAW CLINICAL GRAPH DOCUMENTS IN THIS BATCH:
{docs_json}

══════════════════════════════════════════════════════════
TASK — ORGANIZE THIS BATCH BY DATE, THEN BY ENTITY TYPE
══════════════════════════════════════════════════════════

RULES (STRICT):
  1. Use ONLY the data given above. Do not add, infer, or predict anything not
     explicitly present.
  2. Group entities by document_date first. If a document's date is
     null/"None"/"null", its entities go into "undated" instead — do not
     guess a date.
  3. WITHIN each date, group entities by their entity_type (e.g. "Diagnosis",
     "Finding", "Lab Result", "Measurement", "Procedure", "Treatment",
     "Medication", "Vital Sign", "Anatomy", or whatever type is given).
     Do NOT group by document — a single date's entry should show all its
     entity types with their entities pooled together, regardless of which
     document each came from.
  4. Every entity keeps its own "source_document" field so it stays
     traceable — this is critical, because the document-wise breakdown is
     later reconstructed purely from this field. Never leave it blank if
     the source document is known.
  5. Preserve exact values (sizes, lab values, drug names, measurements) —
     do not summarize or round them.
  6. Do not add clinical commentary or interpretation beyond directly
     reporting what the evidence text says.
  7. This is only ONE batch out of several — just organize exactly what you
     were given, completely.

Return ONLY valid JSON:
{{
  "timeline": [
    {{
      "date": "YYYY-MM-DD",
      "entity_types": [
        {{
          "entity_type": "...",
          "entities": [
            {{
              "name": "...",
              "relation": "...",
              "evidence": "...",
              "source_document": "..."
            }}
          ]
        }}
      ]
    }}
  ],
  "undated": [
    {{
      "entity_type": "...",
      "entities": [
        {{
          "name": "...",
          "relation": "...",
          "evidence": "...",
          "source_document": "..."
        }}
      ]
    }}
  ]
}}
"""
        result = await self._invoke(system, prompt)
        if not isinstance(result, dict) or (
            "timeline" not in result and "undated" not in result
        ):
            logger.warning(
                f"{self.agent_id} · batch {batch_index + 1} returned unparseable "
                f"output — falling back to deterministic grouping for this batch"
            )
            return self._deterministic_fallback(batch_docs)

        return result

    def _deterministic_fallback(self, batch_docs: List[Dict]) -> Dict:
        """If an LLM call fails/malforms for a batch, group entities by
        date -> entity_type in pure Python so nothing is lost."""
        date_map: Dict[str, Dict[str, List[Dict]]] = {}
        undated_map: Dict[str, List[Dict]] = {}

        for doc in batch_docs:
            d = doc.get("document_date")
            doc_name = doc.get("document", "unknown")
            for e in doc.get("entities", []) or []:
                etype = e.get("entity_type") or "Unknown"
                entity_entry = {
                    "name":            e.get("name"),
                    "relation":        e.get("relation"),
                    "evidence":        e.get("evidence"),
                    "source_document": doc_name,
                }
                if d and d not in ("None", "null", "NaT"):
                    date_map.setdefault(d, {}).setdefault(etype, []).append(entity_entry)
                else:
                    undated_map.setdefault(etype, []).append(entity_entry)

        timeline = [
            {
                "date": d,
                "entity_types": [
                    {"entity_type": et, "entities": ents}
                    for et, ents in groups.items()
                ],
            }
            for d, groups in date_map.items()
        ]
        undated = [
            {"entity_type": et, "entities": ents}
            for et, ents in undated_map.items()
        ]
        return {"timeline": timeline, "undated": undated}

    # ---- Deterministic: which source documents fall on which date ---------

    def _compute_documents_per_date(self, docs: List[Dict]) -> Dict[str, List[str]]:
        """Pure Python, no LLM — groups the original document names by their
        document_date so each date entry can show 'what documents are
        present on this date' (order-preserving, de-duplicated)."""
        mapping: Dict[str, List[str]] = {}
        for doc in docs:
            d = doc.get("document_date")
            name = doc.get("document") or "unknown"
            if not d or d in ("None", "null", "NaT"):
                continue
            bucket = mapping.setdefault(d, [])
            if name not in bucket:
                bucket.append(name)
        return mapping

    # ---- Deterministic merge (no LLM) --------------------------------------

    def _merge_batches(self, batch_results: List[Dict], docs: List[Dict]) -> Dict:
        """Merge all batches' date -> entity_type -> entities groups. Purely
        deterministic (dict grouping + sort) — nothing can be lost or
        hallucinated here. Dates are ordered LATEST FIRST. Each date entry
        also gets a deterministic 'documents' list of the source documents
        present on that date, AND a deterministic 'documents_detail'
        document-wise breakdown (date -> document -> entity_type ->
        entities), built purely from each entity's own 'source_document'
        field — so documents sharing a date are never silently pooled
        together without a way to tell them apart."""
        date_map: Dict[str, Dict[str, List[Dict]]] = {}
        undated_map: Dict[str, List[Dict]] = {}
        # date -> document -> entity_type -> [entities]
        doc_map: Dict[str, Dict[str, Dict[str, List[Dict]]]] = {}

        for batch in batch_results:
            for entry in batch.get("timeline", []) or []:
                d = entry.get("date")
                if not d or d in ("None", "null", "NaT"):
                    for et in entry.get("entity_types", []) or []:
                        etype = et.get("entity_type") or "Unknown"
                        undated_map.setdefault(etype, []).extend(et.get("entities", []) or [])
                    continue
                bucket = date_map.setdefault(d, {})
                for et in entry.get("entity_types", []) or []:
                    etype = et.get("entity_type") or "Unknown"
                    entities = et.get("entities", []) or []
                    bucket.setdefault(etype, []).extend(entities)

                    # Deterministically fan the same entities out into a
                    # per-document grouping, keyed off source_document.
                    for ent in entities:
                        doc_name = ent.get("source_document") or "unknown"
                        (
                            doc_map
                            .setdefault(d, {})
                            .setdefault(doc_name, {})
                            .setdefault(etype, [])
                            .append(ent)
                        )

            for et in batch.get("undated", []) or []:
                etype = et.get("entity_type") or "Unknown"
                undated_map.setdefault(etype, []).extend(et.get("entities", []) or [])

        documents_per_date = self._compute_documents_per_date(docs)

        # Latest date first.
        sorted_dates = sorted(date_map.keys(), reverse=True)
        timeline = []
        total_dated_entities = 0
        for d in sorted_dates:
            entity_types_list = []
            for etype, entities in date_map[d].items():
                entity_types_list.append({"entity_type": etype, "entities": entities})
                total_dated_entities += len(entities)

            # Build documents_detail — preserve the deterministic document
            # order from documents_per_date, then append any documents that
            # only surfaced via source_document (e.g. "unknown").
            ordered_doc_names = list(documents_per_date.get(d, []))
            for dn in doc_map.get(d, {}).keys():
                if dn not in ordered_doc_names:
                    ordered_doc_names.append(dn)

            documents_detail = []
            for dn in ordered_doc_names:
                et_map = doc_map.get(d, {}).get(dn)
                if not et_map:
                    continue
                documents_detail.append({
                    "document": dn,
                    "narrative": None,  # filled in by _assemble_narratives
                    "entity_types": [
                        {"entity_type": et, "entities": ents}
                        for et, ents in et_map.items()
                    ],
                })

            timeline.append({
                "date": d,
                "documents": documents_per_date.get(d, []),
                "narrative": None,  # filled in by _assemble_narratives
                "documents_detail": documents_detail,
                "entity_types": entity_types_list,
            })

        undated_list = []
        total_undated_entities = 0
        for etype, entities in undated_map.items():
            undated_list.append({"entity_type": etype, "entities": entities})
            total_undated_entities += len(entities)

        return {
            "timeline": timeline,
            "undated": undated_list,
            "date_range": {
                "earliest_date": sorted_dates[-1] if sorted_dates else None,
                "latest_date":   sorted_dates[0] if sorted_dates else None,
                "total_dates": len(sorted_dates),
                "total_dated_entities": total_dated_entities,
                "total_undated_entities": total_undated_entities,
            },
            "completeness_check": {
                "all_entities_included": True,
                "notes": (
                    f"Built from {len(batch_results)} batch(es) of up to "
                    f"{TIMELINE_BATCH_SIZE} documents each, merged deterministically, "
                    f"grouped by date then entity type, ordered latest date first, and "
                    f"additionally broken out document-wise per date in "
                    f"'documents_detail' (derived deterministically from each entity's "
                    f"own source_document field)."
                ),
            },
        }

    # ---- Step (1): batched PER-DOCUMENT narrative generation --------------

    async def _process_narrative_batch(
        self, batch: List[Dict[str, Any]], specialty: str, batch_index: int
    ) -> Dict[str, str]:
        """One small, bounded LLM call that writes a narrative for EACH
        document in this batch. batch is a list of
        {"document": ..., "date": ..., "entity_types": [...]} — documents
        from DIFFERENT dates can freely appear in the same batch, since
        each document's narrative is grounded strictly in its own
        entities and never references any other document or date.
        Returns {document_name: narrative}."""

        payload_json = json.dumps(batch, indent=2, default=str)

        system = (
            "You are a clinical documentation assistant. You are given a batch of "
            "individual clinical documents (each with its date and its own organized "
            "entities, grouped by entity type). For EACH document, write ONE narrative "
            "that reads like a doctor summarizing that single document's findings in a "
            "chart note — full sentences, NOT bullet points, NOT a list. Use ONLY the "
            "entities given for that specific document — never borrow content from any "
            "other document, even if it shares the same date. Do not compare documents, "
            "do not state trends, do not predict anything, and do not invent any "
            "finding or value not present in the data. Always respond with valid JSON "
            "only."
        )

        prompt = f"""
BATCH OF INDIVIDUAL CLINICAL DOCUMENTS (batch #{batch_index + 1}) for a patient under a
{specialty} specialist. Each object below is ONE document with its own date and its own
organized entities:

{payload_json}

══════════════════════════════════════════════════════════
TASK — WRITE ONE NARRATIVE PER DOCUMENT
══════════════════════════════════════════════════════════

For EACH document object above, generate one narrative using ONLY the entities
belonging to that document. Never include entities from another document, even
if it shares the same date as this one.

COMPLETENESS REQUIREMENTS — this is a lossless clinical reconstruction, not a
summary. Mention EVERY clinically relevant fact given for that document. Never
omit: diagnoses, findings, procedures, investigations, laboratory results,
vital signs, measurements, medications, allergies, organ function,
performance status, or clinical assessments. Workflow-specific information
must ALWAYS be preserved when present, including: treatment intent, selected
protocol, protocol details, drug schedule/frequency, dose, dose per m²,
calculated dose, planned/current/completed cycles, treatment status/phase,
dose adjustments, concurrent therapy, administration route, drug
preparation, label/pharmacy/nurse verification, venous access, emergency
medications, monitoring/infusion observations, toxicities, follow-up
instructions, and recommendations. Preserve every numerical value, unit,
frequency, date, cycle number, protocol name, and lab/vital value exactly.

If a document contains only one or two entities, a short narrative is
acceptable. If a document contains many workflow fields, generate a detailed
narrative that surfaces every one of them.

STRICT RULES:
  • Use ONLY the supplied entities for that document.
  • Never hallucinate, never infer, never recommend, never predict.
  • Never merge entities from a different document into this narrative.
  • Never compress several workflow fields into one generic sentence.

Return ONLY valid JSON:
{{
  "document_narratives": [
    {{
      "document": "exact document name as given above",
      "narrative": "Full narrative text for this document only..."
    }}
  ]
}}
"""
        result = await self._invoke(system, prompt)
        out: Dict[str, str] = {}
        if isinstance(result, dict) and isinstance(result.get("document_narratives"), list):
            for item in result["document_narratives"]:
                if isinstance(item, dict) and item.get("document"):
                    out[str(item["document"])] = item.get("narrative") or ""
        return out

    async def _generate_all_document_narratives(
        self, merged_timeline: Dict, specialty: str, state: ClinicalState
    ) -> Dict[str, Dict[str, str]]:
        """Flattens every (date, document) pair across the WHOLE timeline
        into one list, batches it into groups of NARRATIVE_BATCH_SIZE
        documents (dates mixed freely), runs those batches CONCURRENTLY,
        and returns {date: {document: narrative}}. Each batch is a small,
        independent, bounded call — a date with many documents piled onto
        it can never cause a single oversized call here, because
        documents from that date are simply spread across several
        batches alongside documents from other dates."""

        flat: List[tuple] = []
        for entry in merged_timeline.get("timeline", []) or []:
            d = entry["date"]
            for doc_entry in entry.get("documents_detail", []) or []:
                flat.append((d, doc_entry))

        if not flat:
            return {}

        batches = _chunk_list(flat, NARRATIVE_BATCH_SIZE)
        payload_batches = [
            [
                {
                    "document": doc_entry["document"],
                    "date": d,
                    "entity_types": doc_entry.get("entity_types", []),
                }
                for d, doc_entry in batch
            ]
            for batch in batches
        ]

        logger.info(
            f"{self.agent_id} · {len(flat)} documents (across all dates) split into "
            f"{len(batches)} narrative batch(es) of up to {NARRATIVE_BATCH_SIZE}"
        )

        batch_results = await asyncio.gather(
            *[
                self._process_narrative_batch(payload_batches[i], specialty, i)
                for i in range(len(batches))
            ],
            return_exceptions=True,
        )

        narratives: Dict[str, Dict[str, str]] = {}
        for i, r in enumerate(batch_results):
            if isinstance(r, Exception):
                logger.error(f"{self.agent_id} · narrative batch {i + 1} failed: {r}")
                state["errors"].append(f"A1-narrative-batch-{i + 1}: {str(r)}")
                r = {}
            for d, doc_entry in batches[i]:
                doc_name = doc_entry["document"]
                narrative = r.get(doc_name)
                if not narrative:
                    narrative = self._deterministic_document_narrative_fallback(doc_entry)
                narratives.setdefault(d, {})[doc_name] = narrative

        return narratives

    # ---- Step (2): deterministic date-level assembly (NO LLM call) --------

    def _assemble_date_narrative(self, entry: Dict, per_doc_narratives: Dict[str, str]) -> None:
        """Builds the date-level narrative with ZERO LLM calls — pure
        deterministic string assembly from each document's own,
        already-generated narrative, in the exact
        'Document: <name>\n\n<narrative>' section structure the spec
        requires. Also stamps each document_entry's own 'narrative' field.
        This is what removes the date-level narrative as a failure point:
        there is no LLM call here at all, so a date with many documents
        can never overflow anything at this step."""
        sections = []
        for doc_entry in entry.get("documents_detail", []) or []:
            doc_name = doc_entry["document"]
            narrative = per_doc_narratives.get(doc_name)
            if not narrative:
                narrative = self._deterministic_document_narrative_fallback(doc_entry)
            doc_entry["narrative"] = narrative
            sections.append(f"Document: {doc_name}\n\n{narrative}")

        entry["narrative"] = (
            "\n\n".join(sections) if sections else self._deterministic_narrative_fallback(entry)
        )

    def _deterministic_narrative_fallback(self, entry: Dict) -> str:
        """If a date somehow ends up with no document narratives at all
        (e.g. documents_detail itself is empty), build a plain,
        non-bulleted fallback sentence purely in Python so the date entry
        is never left without a narrative."""
        docs = entry.get("documents", [])
        doc_phrase = (
            f"Document(s) recorded: {', '.join(docs)}. " if docs else ""
        )
        pieces = []
        for et in entry.get("entity_types", []) or []:
            names = [e.get("name") for e in et.get("entities", []) or [] if e.get("name")]
            if names:
                pieces.append(f"{et.get('entity_type', 'Finding')}: {', '.join(names)}")
        body = "; ".join(pieces) if pieces else "No further detail available."
        return f"{doc_phrase}{body}."

    def _deterministic_document_narrative_fallback(self, doc_entry: Dict) -> str:
        """Same idea as _deterministic_narrative_fallback but scoped to a
        single document, used if that document's narrative batch fails or
        omits it."""
        doc_name = doc_entry.get("document", "This document")
        pieces = []
        for et in doc_entry.get("entity_types", []) or []:
            names = [e.get("name") for e in et.get("entities", []) or [] if e.get("name")]
            if names:
                pieces.append(f"{et.get('entity_type', 'Finding')}: {', '.join(names)}")
        body = "; ".join(pieces) if pieces else "No further detail available."
        return f"{doc_name} recorded: {body}."

    # ---- Main run -----------------------------------------------------------

    async def run(self, state: ClinicalState) -> ClinicalState:
        logger.info(f"{self.agent_id} · TimelineAgent (batched, entity-type-grouped, document-wise) — START")
        t0 = datetime.now().timestamp()

        specialty = state.get("specialty", "General Medicine")
        docs = state["graph_documents"]
        batches = self._chunk_documents(docs)

        logger.info(
            f"{self.agent_id} · {len(docs)} documents split into "
            f"{len(batches)} batch(es) of up to {TIMELINE_BATCH_SIZE}"
        )

        batch_results = await asyncio.gather(
            *[
                self._process_batch(batch, specialty, i)
                for i, batch in enumerate(batches)
            ],
            return_exceptions=True,
        )

        clean_results = []
        for i, r in enumerate(batch_results):
            if isinstance(r, Exception):
                logger.error(f"{self.agent_id} · batch {i + 1} failed: {r}")
                state["errors"].append(f"A1-batch-{i + 1}: {str(r)}")
                clean_results.append(self._deterministic_fallback(batches[i]))
            else:
                clean_results.append(r)

        merged = self._merge_batches(clean_results, docs)

        # Step (1): batched per-document narrative generation (bounded LLM calls).
        try:
            per_doc_narratives = await self._generate_all_document_narratives(merged, specialty, state)
        except Exception as e:
            logger.error(f"{self.agent_id} · document narrative generation failed: {e}")
            state["errors"].append(f"A1-narratives: {str(e)}")
            per_doc_narratives = {}

        # Step (2): deterministic date-level assembly — zero additional LLM calls.
        for entry in merged["timeline"]:
            d = entry["date"]
            self._assemble_date_narrative(entry, per_doc_narratives.get(d, {}))

        state["timeline"] = merged
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(
            f"{self.agent_id} · TimelineAgent — DONE "
            f"({state['agent_timings'][self.agent_id]}ms) | "
            f"{len(state['timeline']['timeline'])} dated entries, "
            f"{len(state['timeline'].get('undated', []))} undated groups"
        )
        return state


# ============================================================
# A2 · CLINICAL SUMMARY AGENT  (doctor-narrated STORY, bold confirmed
#                                 diagnoses, structured-workflow-aware,
#                                 BATCHED)
#
# Written in the dense, formal clinical-letter register: patient
# identification + age + comorbidities -> presenting complaint with duration
# -> department -> investigations with exact dates/measurements -> biopsy /
# diagnosis with staging (if documented) -> the FULL treatment story
# (surgery/chemo/radio, each event narrated individually, in chronological
# order) -> documented referral/current status. Grounded strictly in
# graph_documents. No recommendations, no predictions — but documented
# referrals ARE reported (facts, not AI suggestions).
#
# Any diagnosis explicitly CONFIRMED in the record (by histopathology,
# biopsy, or other gold-standard confirmation — never a merely suspected or
# radiologically-probable one) is wrapped in markdown **bold** wherever it
# is stated in full, and in the diagnosis_header.
#
# This agent also fully mines STRUCTURED WORKFLOW DOCUMENTS — chemotherapy,
# radiotherapy, surgical, nursing, treatment-planning forms, or any
# structured EMR/JSON-style document — for the full treatment-management
# picture (intent, protocol, cycles, dose adjustments, concurrent therapy,
# administration details, monitoring observations, treatment status), not
# just the diagnosis/medication name. These workflow documents are treated
# as the AUTHORITATIVE source of treatment information (see v4.6 notes
# below) — operational/administrative workflow metadata that carries no
# clinical meaning on its own (nurse verification, pharmacy verification,
# consent capture, IV/venous access mechanics, drug labeling/preparation
# checklists) is filtered out of the summary unless it reflects an actual
# clinical event (a reaction, extravasation, or documented toxicity).
#
# v4.4: prompts strengthened for richer, more complete output. When the
# record contains MULTIPLE documents of the same type (e.g. several
# separate chemotherapy administration records on different dates/times,
# several dictations), each must be described as its own individual
# clinical event with its own date/time/detail — never folded into one
# generic combined sentence like "the patient received several cycles of
# chemotherapy." Sentence-count guidance now scales with how much is
# documented.
#
# v4.5: the final synthesis pass now writes the whole thing as ONE
# continuous, doctor-narrated STORY — chronological, connected with
# natural clinical transitions — instead of a dense back-to-back list of
# facts. Every individual chemo/radio/surgical/workflow event still gets
# its own narrated moment in the story (this is NOT the same as
# summarizing them away); it's the connective tissue between facts that
# changes, not the completeness requirement. Output JSON schema is
# unchanged — same keys, same shape.
#
# v4.6: fixes chemotherapy/systemic-therapy treatment course being
# under-represented in the final summary. Workflow documents are now
# explicitly treated as the AUTHORITATIVE source for treatment
# information in both passes, and the agent is required to always surface
# treatment modality, treatment intent, regimen/protocol, current
# treatment status, current-vs-planned cycle counts, and any documented
# response/toxicity. When multiple workflow documents describe the SAME
# regimen, the synthesis pass now weaves them into ONE continuous
# chronological treatment narrative (rather than a separate boilerplate
# paragraph per document) while still individually preserving every
# cycle's own date/dose/status — nothing is dropped, only how it's
# connected in prose changes. Purely operational/administrative workflow
# fields are excluded from the summary. Output JSON schema is unchanged.
#
# BATCHED, TWO-PASS (bounded, regardless of patient document volume):
#   Pass 1 (concurrent, per-batch fact extraction): graph_documents are
#   split into batches of SUMMARY_BATCH_SIZE (default 10) documents.
#   Merge (deterministic, no LLM): all batches' facts are concatenated in
#   Python.
#   Pass 2 (single, final synthesis call): takes the concatenated facts +
#   a COMPACT projection of the A1 timeline (date + documents + narrative
#   only) and writes the final doctor-narrated story. Uses its own
#   SUMMARY_SYNTHESIS_MAX_TOKENS budget so a long story is never silently
#   truncated.
#
# OUTPUT JSON SCHEMA for A2 is unchanged.
# ============================================================

class ClinicalSummaryAgent(BaseAgent):
    agent_id = "A2"

    # ---- Pass 1: per-batch fact extraction ---------------------------------

    async def _extract_batch_facts(
        self, batch_docs: List[Dict], specialty: str, batch_index: int
    ) -> Dict[str, Any]:
        """Extract dense, doctor-style clinical facts from ONE small batch
        of raw documents. This is NOT the final letter — it is a grounded,
        fact-dense extraction that the final synthesis pass will turn into
        prose. Keeping this call scoped to one batch is what prevents the
        context-length error, since the call's size no longer grows with
        the patient's total document count."""

        docs_json = json.dumps(batch_docs, indent=2, default=str)

        system = (
            f"You are a senior {specialty} specialist extracting every clinically "
            "relevant fact from a BATCH of raw clinical graph documents, so that "
            "another physician can later write the formal chart summary from your "
            "extraction. You do NOT write the final letter yet — you extract dense, "
            "doctor-style clinical facts, each with its date and exact documented "
            "values, strictly from the documents given to you in this batch. You "
            "never invent, infer, or predict anything not explicitly present. If two "
            "or more documents in this batch are of the same type (e.g. multiple "
            "separate chemotherapy administration records, multiple dictations), you "
            "extract facts for EACH one individually and keep them clearly attached "
            "to their own document/date — you never merge them into one combined "
            "fact. "
            "TREATMENT DOCUMENTS ARE AUTHORITATIVE: chemotherapy, radiotherapy, "
            "surgical, nursing, and treatment-planning documents (or any structured "
            "EMR/JSON-style workflow record) are your PRIMARY, AUTHORITATIVE source "
            "for the patient's treatment course — never a secondary detail. For every "
            "such document you must extract, whenever present: treatment modality "
            "(surgery/chemotherapy/radiotherapy/other), treatment intent (curative, "
            "palliative, adjuvant, neoadjuvant, etc.), selected protocol/regimen "
            "name, planned/current/completed cycle counts, dose adjustments, "
            "concurrent therapy, administration details, monitoring observations, "
            "documented treatment response or toxicity, and treatment status — not "
            "just the diagnosis or drug name. Extracting this treatment-course detail "
            "is MANDATORY whenever it is present in the document, not optional. "
            "You must also distinguish clinically meaningful treatment detail from "
            "purely OPERATIONAL/ADMINISTRATIVE workflow metadata — fields such as "
            "nurse verification, pharmacy verification, consent-form capture, "
            "IV/venous-access line mechanics, drug labeling checks, and preparation "
            "checklists are procedural bookkeeping, not clinical facts, and should "
            "NOT be extracted as standalone facts UNLESS they describe an actual "
            "clinical event (e.g. an infusion reaction, extravasation, or a "
            "documented toxicity noted during that check), in which case that "
            "clinical event IS extracted. You must also flag, using the CONFIRMED "
            "DIAGNOSIS RULE below, any diagnosis that is confirmed by a "
            "gold-standard investigation (histopathology, biopsy, cytology, or "
            "another definitive method explicitly stated as producing that "
            "diagnosis) — as opposed to a merely suspected/probable one. "
            "Always respond with valid JSON only."
        )

        prompt = f"""
You are reading a BATCH of raw clinical graph documents (batch #{batch_index + 1})
for a patient being seen by a {specialty} specialist. This is only a subset of the
patient's full record — extract facts ONLY from what is given below.

RAW CLINICAL GRAPH DOCUMENTS IN THIS BATCH:
{docs_json}

══════════════════════════════════════════════════════════
TASK — EXTRACT DENSE CLINICAL FACTS FROM THIS BATCH
══════════════════════════════════════════════════════════

For EVERY document in this batch, extract every clinically relevant fact —
investigations, imaging, pathology, laboratory results, procedures,
diagnoses (with staging/grading if documented), medications, referrals,
comorbidities, and follow-up — each as its own dense clinical sentence or
clause carrying its date and exact documented values.

IMPORTANT — INDIVIDUAL DOCUMENTS STAY INDIVIDUAL: if this batch contains
several documents of the same type (e.g. six separate chemotherapy
administration records, several dictations on different dates/times), treat
EACH ONE as its own distinct clinical event. Extract facts for each
document separately, each tagged with its own exact date/time and document
name. Never combine repeated same-type documents into a single averaged or
generic fact — a reader must be able to tell, from your extracted facts
alone, that there were multiple distinct administrations/events, not one.

══════════════════════════════════════════════════════════
TREATMENT COURSE COMPLETENESS RULE (MANDATORY)
══════════════════════════════════════════════════════════
Treat chemotherapy, radiotherapy, surgical, nursing, and treatment-planning
documents as the AUTHORITATIVE source for this patient's treatment course.
For EVERY such document, extract, whenever present:
  • Treatment modality (surgery / chemotherapy / radiotherapy / other)
  • Treatment intent (curative, palliative, adjuvant, neoadjuvant, etc.)
  • Selected protocol / regimen name
  • Planned / current / completed cycle counts
  • Dose adjustments (with dose/percentage/reason if documented)
  • Concurrent therapy
  • Administration details (route, date, setting)
  • Monitoring observations tied to the workflow
  • Documented treatment response or toxicity
  • Treatment status (ongoing/completed/deferred/discontinued + reason if given)
This treatment-course detail must be extracted whenever it is present — do
not summarize a treatment workflow document down to just its drug name or
diagnosis.

EXCLUDE PURELY OPERATIONAL/ADMINISTRATIVE METADATA: do not extract, as
standalone facts, procedural bookkeeping such as nurse verification,
pharmacy verification, consent-form signing, IV/venous-access line
mechanics, drug labeling checks, or preparation checklists. These add no
clinical value to a chart summary. The ONLY exception is when such a field
records an actual clinical event (e.g. a reaction, extravasation, or a
documented toxicity/tolerance note) — that clinical event must still be
extracted, just not the surrounding administrative checklist item.

RULES (STRICT):
  • Use ONLY the data given above — never invent, infer, or predict.
  • Do not omit any document in this batch — every document must
    contribute at least one fact line, even if another document in the
    batch is of the same type.
  • Do not compress multiple distinct findings into one vague sentence.
  • Preserve exact values (sizes, lab values, drug names, doses, cycle
    numbers) — never round or paraphrase away specifics.
  • This is only ONE batch — just extract exactly what you were given.

Return ONLY valid JSON:
{{
  "batch_facts": [
    "Dense clinical fact sentence 1, with its date and exact values, source document noted in parentheses...",
    "Dense clinical fact sentence 2..."
  ],
  "confirmed_diagnoses_in_batch": ["exact confirmed diagnosis text, including staging if documented, ..."],
  "documents_covered": ["document_name_1", "document_name_2"]
}}
"""
        result = await self._invoke(system, prompt, max_tokens=SUMMARY_EXTRACTION_MAX_TOKENS)
        if not isinstance(result, dict) or "batch_facts" not in result:
            logger.warning(
                f"{self.agent_id} · batch {batch_index + 1} fact extraction "
                f"returned unparseable output — falling back to a minimal "
                f"deterministic extraction for this batch"
            )
            return self._deterministic_batch_fallback(batch_docs)
        return result

    def _deterministic_batch_fallback(self, batch_docs: List[Dict]) -> Dict[str, Any]:
        """If a batch's LLM extraction fails entirely, build a minimal,
        purely deterministic fact list in Python — one fact line PER
        DOCUMENT (never merged across documents) — so nothing is silently
        dropped or blended from the final summary."""
        facts: List[str] = []
        docs_covered: List[str] = []
        for doc in batch_docs:
            doc_name = doc.get("document", "unknown")
            doc_date = doc.get("document_date")
            docs_covered.append(doc_name)
            names = [
                e.get("name") for e in doc.get("entities", []) or [] if e.get("name")
            ]
            if names:
                facts.append(
                    f"On {doc_date}, {doc_name} recorded: {', '.join(names)}."
                )
        return {
            "batch_facts": facts,
            "confirmed_diagnoses_in_batch": [],
            "documents_covered": docs_covered,
        }

    # ---- Pass 2: final synthesis from batched facts + compact timeline ----

    async def _synthesize_summary(
        self,
        all_facts: List[str],
        all_confirmed_diagnoses: List[str],
        timeline: Dict,
        specialty: str,
        age_str: str,
        sex: str,
        patient_name: Optional[str],
    ) -> Dict[str, Any]:
        """The ONLY call in A2 that produces the final letter. Its input is
        the concatenated fact list (small) plus a COMPACT projection of
        the A1 timeline (date + documents + narrative only) — never the
        full entity-level timeline, and never the raw graph_documents
        again — so its size does not scale with the patient's total
        document/entity volume.

        v4.5: this call now asks for a continuous, doctor-narrated STORY
        instead of a fact-list-style letter, while still requiring every
        individual event (each chemo administration, each radio session,
        etc.) to be named in its own right within that story. Uses its own
        SUMMARY_SYNTHESIS_MAX_TOKENS budget so a long, fully-narrated story
        for a heavily-documented patient is never silently truncated.

        v4.6: explicitly requires the full treatment course (modality,
        intent, regimen/protocol, status, current-vs-planned cycles,
        response/toxicity) to always be surfaced, and asks that multiple
        documents describing the SAME regimen be woven into one
        continuous chronological treatment narrative rather than repeated
        as separate boilerplate paragraphs — without dropping any
        individual cycle's date/dose/status."""

        facts_text = "\n".join(f"- {f}" for f in all_facts)
        num_facts = len(all_facts)

        compact_timeline = [
            {
                "date": entry.get("date"),
                "documents": entry.get("documents", []),
                "narrative": entry.get("narrative"),
            }
            for entry in (timeline.get("timeline") or [])
        ]
        timeline_json = json.dumps(compact_timeline, indent=2, default=str)

        confirmed_hint = (
            "\n".join(f"- {d}" for d in all_confirmed_diagnoses)
            if all_confirmed_diagnoses
            else "None extracted."
        )

        # Scale the target length with how much has actually been
        # documented, so a heavily-documented patient (many structured
        # workflow documents, many distinct facts) gets a proportionally
        # longer, more complete story instead of being compressed down to
        # the same length as a lightly-documented one.
        if num_facts >= 60:
            length_guidance = (
                "This patient has EXTENSIVE documentation. Tell a long, thorough "
                "story — typically 30-50+ complete clinical sentences flowing across "
                "multiple paragraphs, with a DEDICATED narrative section for each "
                "treatment modality present (e.g. one flowing section for the "
                "diagnostic workup, one for systemic/chemotherapy management "
                "narrating EACH administration individually as its own moment in the "
                "story, one for radiotherapy planning and delivery, one for surgical "
                "care, etc.), each section flowing naturally into the next. Do not "
                "compress this down to a short summary — the source material "
                "supports, and requires, this level of narrated detail."
            )
        elif num_facts >= 25:
            length_guidance = (
                "This patient has substantial documentation. Tell a detailed story "
                "of roughly 20-35 complete clinical sentences flowing across "
                "multiple paragraphs, covering every distinct documented event in "
                "chronological, connected prose."
            )
        else:
            length_guidance = (
                "Tell a complete story of roughly 12-25 complete clinical sentences, "
                "or fewer only if the source facts themselves are limited — but "
                "still flowing as connected prose rather than a list of facts."
            )

        system = (
            f"You are a senior {specialty} specialist writing the formal clinical "
            "summary section of a patient's chart note — the kind read by another "
            "consultant before they see the patient. You write this as a single, "
            "CONTINUOUS clinical STORY of the patient's course — the way a doctor "
            "narrates a case to a colleague, not as a checklist or a set of "
            "disconnected fact statements bolted together. Each paragraph should "
            "read as connected prose, one event flowing into the next through "
            "natural clinical transitions ('Following this,' 'He was subsequently "
            "started on,' 'During the course of treatment,' 'On follow-up "
            "evaluation,' 'Three weeks later,') so the whole narrative reads the "
            "way a real chart summary or discharge letter does — while remaining "
            "fully grounded, dense, and complete. "
            "You open with patient identification and age, comorbidities named in "
            "the same breath, the presenting complaint and its duration, then "
            "narrate the documented course of investigations and findings — each "
            "with its date and exact reported values — leading into the diagnosis "
            "as staged/graded in the record, and then the FULL treatment story: "
            "every surgical, chemotherapy, and radiotherapy event actually "
            "documented, narrated in the order it happened, and finally any "
            "documented referral, follow-up, or current status. "
            "TREATMENT DOCUMENTS ARE AUTHORITATIVE: chemotherapy, radiotherapy, "
            "surgical, and other treatment-workflow documents are your primary "
            "source for the patient's treatment course, and the treatment course is "
            "NEVER optional in this summary — you must always surface treatment "
            "modality, treatment intent, regimen/protocol, current treatment status, "
            "current cycle versus planned cycles, and any documented treatment "
            "response or toxicity, whenever the facts below contain them. "
            "You are given a pre-extracted list of dense clinical facts (already "
            "pulled from the patient's raw documents by an earlier extraction pass, "
            "including full structured-workflow treatment-management detail, with "
            "repeated same-type documents such as multiple chemotherapy "
            "administrations kept as separate individual facts) plus a compact "
            "date-wise narrative timeline — you weave ALL of these into one "
            "continuous story; you do not need to re-derive facts from scratch, "
            "and you must not silently drop any of them. "
            "IMPORTANT: telling it as a story does NOT mean summarizing detail "
            "away. When multiple facts describe SEPARATE cycles/sessions of the "
            "SAME regimen or protocol (e.g. six chemotherapy administrations of the "
            "same drug combination, several radiotherapy fractions), you weave them "
            "into ONE continuous chronological treatment narrative — a short run of "
            "connected sentences that reads as a single unfolding course of "
            "treatment — rather than six separate, repetitive boilerplate "
            "paragraphs. Within that continuous narrative you must still name EACH "
            "cycle/session individually with its own date, dose, and status (e.g. "
            "'Cycle 1 of FOLFOX was administered on [date]; Cycle 2 followed on "
            "[date] with a dose reduction to [x]% for [reason]; Cycle 3 was given "
            "on [date] as planned...') — this changes only how the events are "
            "CONNECTED in prose, not whether each one is individually mentioned. "
            "You never collapse them into a single vague sentence like 'the patient "
            "received several cycles of chemotherapy' with no per-cycle detail — "
            "that is data loss, not summarization. "
            "OPERATIONAL/ADMINISTRATIVE WORKFLOW METADATA — such as nurse "
            "verification, pharmacy verification, consent-form capture, "
            "IV/venous-access mechanics, drug labeling, or preparation checklist "
            "items — is EXCLUDED from this clinical narrative unless it reflects an "
            "actual clinical event (a reaction, extravasation, or documented "
            "toxicity/tolerance note), since it adds no clinical value to a chart "
            "summary; the Timeline module already retains this detail separately at "
            "the document level. "
            "You report ONLY what is in the given facts/timeline — you never "
            "recommend a treatment or predict an outcome. Reporting an "
            "already-documented referral or plan is reporting a fact, not a "
            "recommendation. Always respond with valid JSON only."
        )

        prompt = f"""
Write the final clinical summary for this patient's chart, for a {specialty}
specialist about to see them, as one continuous, doctor-narrated STORY of the
case — not a bulleted list, not a checklist, not a set of short disconnected
statements.

══════════════════════════════════════════════════════════
PATIENT IDENTIFICATION
══════════════════════════════════════════════════════════
Name (if documented): {patient_name or "Not documented — refer to the patient generically (e.g. 'The patient') if no name is available"}
Age: {age_str}
Sex: {sex}

══════════════════════════════════════════════════════════
PRE-EXTRACTED DENSE CLINICAL FACTS (from ALL {num_facts} facts extracted
batch-by-batch across the patient's documents in an earlier pass — this is
your primary source of truth; every fact below is already grounded in the
raw record; repeated same-type events are kept as separate individual
facts, not merged)
══════════════════════════════════════════════════════════
{facts_text}

══════════════════════════════════════════════════════════
CONFIRMED DIAGNOSES FLAGGED DURING EXTRACTION (gold-standard confirmed —
apply the BOLD RULE below to these)
══════════════════════════════════════════════════════════
{confirmed_hint}

══════════════════════════════════════════════════════════
COMPACT DATE-WISE TIMELINE (A1 output, narrative form — for chronological
structure only, ordered latest date first)
══════════════════════════════════════════════════════════
{timeline_json}

══════════════════════════════════════════════════════════
STYLE TO MATCH (story flow + density reference only — do NOT copy this
example's content; note how it reads as one continuous narrative, not a
list)
══════════════════════════════════════════════════════════
"Mr. [Name], an [age]-year-old [gentleman/lady] with comorbidities including
[comorbidity 1], [comorbidity 2], and [comorbidity 3], presented with complaints
of [chief complaint] for [duration]. He/She was evaluated in the Department of
[department], where [investigation] ([date]) demonstrated [finding], and
[additional exam finding] was also noted. Biopsy from the lesion ([specimen ID])
was subsequently reported as [histology]. Around the same time, a [imaging
study] ([date]) revealed a [size] [location] lesion involving [structures], with
[additional imaging findings] and no [negative finding] identified. In view of
[diagnosis/stage summary], he/she was then referred to the Department of
[department], where treatment was initiated. He/She first underwent
[surgical/first-line event] on [date], [detail]. This was followed by
[chemotherapy regimen], with the first cycle administered on [date] at a dose
of [dose], followed by [second cycle detail on its own date], and so on for
each individual cycle actually documented. [If radiotherapy present:] Once
systemic therapy was complete, he/she proceeded to radiotherapy planning on
[date], with treatment delivered as [detail]. On most recent follow-up
([date]), [current status/monitoring finding]."

══════════════════════════════════════════════════════════
TREATMENT COURSE SUMMARIZATION RULE (MANDATORY)
══════════════════════════════════════════════════════════
  • ALWAYS surface the full treatment course when the facts contain it:
    treatment modality, treatment intent, regimen/protocol name, current
    treatment status, current cycle versus planned cycles, and any
    documented treatment response or toxicity.
  • When several facts describe separate cycles/sessions of the SAME
    regimen, narrate them as ONE continuous chronological treatment
    passage (not a separate paragraph per cycle) — but keep every
    cycle's own date, dose, and status individually named within that
    passage. Do not compress them into one generic sentence with no
    per-cycle detail.
  • Do NOT include purely operational/administrative workflow detail
    (nurse verification, pharmacy verification, consent capture,
    IV/venous-access mechanics, drug labeling, preparation checklists) —
    omit these unless they describe an actual clinical event (a reaction,
    extravasation, or documented toxicity/tolerance note).

══════════════════════════════════════════════════════════
BOLD RULE FOR CONFIRMED DIAGNOSES (MANDATORY)
══════════════════════════════════════════════════════════
  • The FIRST time a CONFIRMED diagnosis (per the flagged list above, or any
    other diagnosis in the facts that is explicitly gold-standard confirmed)
    is stated in full in the narrative, wrap the entire diagnosis phrase
    (including staging/grading if documented) in markdown bold:
    **squamous cell carcinoma of the supraglottic larynx, cT2N0M0**
  • Bold each distinct confirmed diagnosis the first time it is stated in
    full, if more than one exists.
  • Do NOT bold a suspected/probable/imaging-only diagnosis.
  • Do NOT bold anything else — no dates, investigations, comorbidities.
  • diagnosis_header should also be wrapped in ** only if confirmed; if only
    a working/suspected diagnosis exists, state it in plain text with
    "(not yet confirmed)".

══════════════════════════════════════════════════════════
TASK
══════════════════════════════════════════════════════════
Write this patient's clinical summary as one continuous, doctor-narrated
STORY of their case — chronological, connected with natural narrative
transitions, the way a consultant would narrate the case out loud to a
colleague. At the same time, this must be a LOSSLESS story: every fact
given to you above must appear somewhere in the narrative, in full detail —
especially every chemotherapy administration, every radiotherapy
session/planning detail, every surgical event, and any other structured
workflow detail (excluding purely operational/administrative metadata as
noted above). Do not compress a distinct event into a vague generic
mention; narrate it as its own moment in the story — with its date,
protocol/regimen, dose, cycle number, and outcome/observation exactly as
documented — before flowing into the next event. If the patient underwent
multiple lines or phases of treatment (e.g. surgery, then chemotherapy,
then radiotherapy, or several distinct chemotherapy regimens), tell the
story of each phase in its own connected section of the narrative, in the
order it was documented, so the whole thing reads like a doctor telling the
patient's story from presentation through to their current status.

{length_guidance}

Return ONLY valid JSON:
{{
  "diagnosis_header": "One-line diagnosis exactly as documented (including staging/grading if explicitly present). Wrapped in ** bold ** ONLY if confirmed. If only a working/suspected diagnosis exists, state it in PLAIN text and note '(not yet confirmed)'. If no diagnosis at all, use 'Not documented'.",
  "confirmed_diagnosis_present": true,
  "confirmed_diagnoses": ["exact bolded-equivalent text of each confirmed diagnosis, without ** markers"],
  "paragraphs": [
    "Full story paragraph 1 text, flowing prose...",
    "Full story paragraph 2 text if warranted, continuing the story...",
    "Additional paragraphs as needed to narrate every distinct documented event as part of one connected story..."
  ],
  "full_text": "All paragraphs joined together, exactly as they should be read in sequence, preserving ** bold ** markers.",
  "source_coverage_check": {{
    "all_documents_referenced": true,
    "documents_not_referenced_and_why": ["..."],
    "no_recommendations_included": true,
    "no_predictions_included": true,
    "bold_rule_followed": true
  }}
}}
"""
        return await self._invoke(system, prompt, max_tokens=SUMMARY_SYNTHESIS_MAX_TOKENS)

    # ---- Main run -----------------------------------------------------------

    async def run(self, state: ClinicalState) -> ClinicalState:
        logger.info(f"{self.agent_id} · ClinicalSummaryAgent (batched, story-style) — START")
        t0 = datetime.now().timestamp()

        specialty    = state.get("specialty", "General Medicine")
        age          = state.get("age")
        sex          = state.get("sex") or "Not documented"
        patient_name = state.get("patient_name") or None
        age_str      = str(age) if age is not None else "Not documented"

        docs = state["graph_documents"]
        batches = _chunk_list(docs, SUMMARY_BATCH_SIZE)

        logger.info(
            f"{self.agent_id} · {len(docs)} documents split into "
            f"{len(batches)} batch(es) of up to {SUMMARY_BATCH_SIZE} for fact extraction"
        )

        batch_results = await asyncio.gather(
            *[
                self._extract_batch_facts(batch, specialty, i)
                for i, batch in enumerate(batches)
            ],
            return_exceptions=True,
        )

        all_facts: List[str] = []
        all_confirmed: List[str] = []
        for i, r in enumerate(batch_results):
            if isinstance(r, Exception):
                logger.error(f"{self.agent_id} · fact batch {i + 1} failed: {r}")
                state["errors"].append(f"A2-batch-{i + 1}: {str(r)}")
                r = self._deterministic_batch_fallback(batches[i])
            all_facts.extend(r.get("batch_facts", []) or [])
            all_confirmed.extend(r.get("confirmed_diagnoses_in_batch", []) or [])

        # De-duplicate confirmed diagnoses while preserving order.
        seen = set()
        dedup_confirmed = []
        for d in all_confirmed:
            if d not in seen:
                seen.add(d)
                dedup_confirmed.append(d)

        try:
            raw = await self._synthesize_summary(
                all_facts,
                dedup_confirmed,
                state.get("timeline", {}),
                specialty,
                age_str,
                sex,
                patient_name,
            )
        except Exception as e:
            logger.error(f"{self.agent_id} · final synthesis failed: {e}")
            state["errors"].append(f"A2-synthesis: {str(e)}")
            # Never leave clinical_summary empty — fall back to the raw
            # extracted facts themselves so the pipeline still returns
            # something useful even if the final synthesis call fails.
            raw = {
                "diagnosis_header": "Not documented",
                "confirmed_diagnosis_present": bool(dedup_confirmed),
                "confirmed_diagnoses": dedup_confirmed,
                "paragraphs": all_facts,
                "full_text": " ".join(all_facts),
                "source_coverage_check": {
                    "all_documents_referenced": False,
                    "documents_not_referenced_and_why": ["synthesis call failed — raw facts returned instead"],
                    "no_recommendations_included": True,
                    "no_predictions_included": True,
                    "bold_rule_followed": False,
                },
            }

        state["clinical_summary"] = raw
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · ClinicalSummaryAgent — DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A3 · ORGAN SYSTEM ANALYSIS AGENT  (BATCHED, TWO-PASS)
#
# Consolidates fragmented, multi-date findings into organ/system-level
# status entries.
#
#   Pass 1 (concurrent, per-batch extraction): graph_documents are split
#   into batches of ORGAN_BATCH_SIZE (default 10). Each batch call reads
#   ONLY its own small slice of raw documents and extracts a flat list of
#   {system, finding, date, source_document} entries — which organ/body
#   system each entity belongs to, plus the finding itself. No trend
#   analysis or prose yet — that's deliberately deferred to Pass 2 so this
#   call stays small and bounded.
#
#   Merge (deterministic, no LLM): all batches' findings are grouped by
#   system name in Python, and each system's first/latest documented dates
#   are computed with a simple deterministic string-sort — no LLM needed.
#
#   Pass 2 (single, final synthesis call): takes ONLY the compact,
#   deduplicated per-system findings list (with first/latest dates already
#   attached) — never the raw graph_documents, never the full entity-level
#   timeline, never the full A2 narrative — and asks the LLM to write the
#   consolidated_status and trend text per system. This call's size scales
#   with the number of distinct findings, not with the patient's raw
#   document/entity volume.
#
# OUTPUT JSON SCHEMA for A3 is unchanged.
# ============================================================

class OrganAnalysisAgent(BaseAgent):
    agent_id = "A3"

    # ---- Pass 1: per-batch system-finding extraction -----------------------

    async def _extract_batch_system_findings(
        self, batch_docs: List[Dict], specialty: str, batch_index: int
    ) -> Dict[str, Any]:
        """Extract a flat list of {system, finding, date, source_document}
        entries from ONE small batch of raw documents. Deliberately does
        NOT attempt trend analysis or prose — that's left to the final
        synthesis pass over the much smaller, merged result."""

        docs_json = json.dumps(batch_docs, indent=2, default=str)

        system = (
            f"You are an expert {specialty} physician doing systems-based clinical "
            "triage on a BATCH of raw clinical graph documents. Your only job here is "
            "to identify, for every entity in this batch, which organ or body system "
            "it belongs to (e.g. genitourinary, hepatobiliary, renal, cardiovascular, "
            "respiratory, gastrointestinal, musculoskeletal, neurological, "
            "otolaryngological, etc. — based purely on what the entity actually "
            "concerns) and restate the finding as a short, exact clinical phrase with "
            "its date. You do NOT write a consolidated status or assess a trend yet — "
            "that happens later, once all batches are combined. You never invent, "
            "infer, or predict anything not explicitly present in this batch. Always "
            "respond with valid JSON only."
        )

        prompt = f"""
You are reading a BATCH of raw clinical graph documents (batch #{batch_index + 1})
for a patient being seen by a {specialty} specialist. This is only a subset of the
patient's full record — extract findings ONLY from what is given below.

RAW CLINICAL GRAPH DOCUMENTS IN THIS BATCH:
{docs_json}

══════════════════════════════════════════════════════════
TASK — TAG EVERY ENTITY IN THIS BATCH WITH ITS ORGAN/BODY SYSTEM
══════════════════════════════════════════════════════════

For EVERY clinically relevant entity in this batch (diagnoses, findings,
procedures, investigations, laboratory results, vital signs, measurements,
medications, treatments), produce one entry with:
  • "system": the organ/body system this entity belongs to, based only on
    what it actually concerns (e.g. "Genitourinary", "Hepatobiliary",
    "Renal", "Cardiovascular", "Respiratory", "Gastrointestinal",
    "Musculoskeletal", "Neurological", "Otolaryngological",
    "Hematological/Oncological", etc.) — use the most specific and
    clinically accurate system, do not force everything into a generic
    bucket.
  • "finding": a short, exact clinical phrase for what was found/done,
    preserving exact values (sizes, lab values, drug names, doses).
  • "date": the document_date this entity was recorded on (or null if
    undated — never guess a date).
  • "source_document": the document name this entity came from.

RULES (STRICT):
  • Use ONLY the data given above — never invent, infer, or predict.
  • Do not omit any clinically relevant entity in this batch.
  • Do not assess trend, status, or significance here — just tag and
    restate. That step happens later.
  • This is only ONE batch — just extract exactly what you were given.

Return ONLY valid JSON:
{{
  "system_findings": [
    {{
      "system": "...",
      "finding": "...",
      "date": "YYYY-MM-DD or null",
      "source_document": "..."
    }}
  ]
}}
"""
        result = await self._invoke(system, prompt)
        if not isinstance(result, dict) or "system_findings" not in result:
            logger.warning(
                f"{self.agent_id} · batch {batch_index + 1} system-finding "
                f"extraction returned unparseable output — falling back to a "
                f"minimal deterministic extraction for this batch"
            )
            return self._deterministic_system_fallback(batch_docs)
        return result

    def _deterministic_system_fallback(self, batch_docs: List[Dict]) -> Dict[str, Any]:
        """If a batch's LLM extraction fails entirely, build a minimal,
        purely deterministic findings list in Python (tagged as
        'Unclassified' since we can't safely infer a system without the
        LLM) so nothing is silently dropped from the organ analysis."""
        findings: List[Dict[str, Any]] = []
        for doc in batch_docs:
            doc_name = doc.get("document", "unknown")
            doc_date = doc.get("document_date")
            for e in doc.get("entities", []) or []:
                name = e.get("name")
                if name:
                    findings.append({
                        "system": "Unclassified",
                        "finding": name,
                        "date": doc_date,
                        "source_document": doc_name,
                    })
        return {"system_findings": findings}

    # ---- Deterministic merge (no LLM) --------------------------------------

    def _merge_system_findings(
        self, batch_results: List[Dict[str, Any]]
    ) -> Dict[str, List[Dict[str, Any]]]:
        """Group all batches' findings by system name. Purely deterministic
        — nothing can be lost or hallucinated here."""
        merged: Dict[str, List[Dict[str, Any]]] = {}
        for r in batch_results:
            for item in r.get("system_findings", []) or []:
                if not isinstance(item, dict):
                    continue
                sysname = (item.get("system") or "Unclassified").strip() or "Unclassified"
                merged.setdefault(sysname, []).append({
                    "finding":         item.get("finding"),
                    "date":            item.get("date"),
                    "source_document": item.get("source_document"),
                })
        return merged

    def _compute_first_last(self, findings: List[Dict[str, Any]]) -> (Optional[str], Optional[str]):
        """Deterministic first/latest documented date for one system's
        findings — simple ISO-date string sort, no LLM needed."""
        dates = sorted(
            {
                f.get("date") for f in findings
                if f.get("date") and f.get("date") not in ("None", "null", "NaT")
            }
        )
        if not dates:
            return None, None
        return dates[0], dates[-1]

    # ---- Pass 2: final synthesis from merged per-system findings ----------

    async def _synthesize_organ_analysis(
        self, merged_systems: Dict[str, List[Dict[str, Any]]], specialty: str
    ) -> Dict[str, Any]:
        """The ONLY call in A3 that produces the final organ-system
        analysis. Its input is the compact, deduplicated per-system
        findings list (with first/latest dates already computed
        deterministically) — never the raw graph_documents, never the
        full entity-level timeline, never the full A2 narrative — so its
        size scales with the number of distinct findings, not with the
        patient's raw document/entity volume."""

        systems_payload = []
        for sysname, findings in merged_systems.items():
            first_d, last_d = self._compute_first_last(findings)
            systems_payload.append({
                "system": sysname,
                "findings": findings,
                "first_documented_computed": first_d,
                "latest_documented_computed": last_d,
            })
        # Order systems by how much is documented (most-documented first)
        # purely for readability — this has no bearing on content.
        systems_payload.sort(key=lambda s: len(s["findings"]), reverse=True)

        payload_json = json.dumps(systems_payload, indent=2, default=str)

        system = (
            "You are an expert physician trained in systems-based clinical reasoning. "
            "You are given a pre-extracted, per-system list of findings (already "
            "grouped by organ/body system across the patient's entire record, with "
            "each system's first- and latest-documented dates already computed "
            "deterministically). Your job is to write, for EACH system, a "
            "consolidated_status (what is documented about this system, referencing "
            "the specific findings and their dates) and a trend assessment. You do "
            "not recommend treatment and you do not predict outcomes — you describe "
            "documented status only, using ONLY the findings given below. Only assert "
            "a trend (worsening/stable/improving/resolved) if the findings across "
            "multiple dates for that system actually support it; otherwise use "
            "'undetermined' or 'single data point, no trend assessable'. Always "
            "respond with valid JSON only."
        )

        prompt = f"""
Consolidate this patient's documented findings by organ/body system, for a
{specialty} specialist.

══════════════════════════════════════════════════════════
PRE-EXTRACTED, PER-SYSTEM FINDINGS (deterministically grouped from the
patient's entire record; first_documented_computed / latest_documented_computed
are already computed — use them as-is unless a finding's own date
contradicts them, which should not happen)
══════════════════════════════════════════════════════════
{payload_json}

══════════════════════════════════════════════════════════
TASK
══════════════════════════════════════════════════════════

For EACH system object above, write:
  • "consolidated_status": one or two dense sentences describing what is
    documented for this system, referencing the specific findings and
    their dates given above.
  • "key_findings": copy through the "finding"/"date"/"source_document"
    entries as given (do not invent new ones, do not drop any).
  • "trend": "worsening|stable|improving|resolved|undetermined|single data
    point, no trend assessable" — only assert a real trend if the given
    findings across multiple dates actually support it.
  • "first_documented" / "latest_documented": use the
    first_documented_computed / latest_documented_computed values given
    above.

DO NOT:
  • Recommend any treatment or monitoring plan.
  • Predict future course.
  • Invent a system-level status that isn't backed by the given findings.
  • Drop a system entirely, even if it only has one finding.

Return ONLY valid JSON:
{{
  "organ_systems": [
    {{
      "system": "...",
      "consolidated_status": "...",
      "key_findings": [
        {{"finding": "...", "date": "...", "source_document": "..."}}
      ],
      "trend": "worsening|stable|improving|resolved|undetermined|single data point, no trend assessable",
      "first_documented": "...",
      "latest_documented": "..."
    }}
  ],
  "systems_summary_note": "One or two sentences noting how many systems have documented findings and which system has the most extensive documentation, based only on the data above.",
  "completeness_check": {{
    "all_documented_findings_assigned_to_a_system": true,
    "notes": "..."
  }}
}}
"""
        return await self._invoke(system, prompt)

    def _deterministic_organ_fallback(
        self, merged_systems: Dict[str, List[Dict[str, Any]]]
    ) -> Dict[str, Any]:
        """If the final synthesis call fails entirely, build a minimal,
        purely deterministic organ_systems array (no trend/prose) so the
        pipeline still returns something useful."""
        organ_systems = []
        for sysname, findings in merged_systems.items():
            first_d, last_d = self._compute_first_last(findings)
            organ_systems.append({
                "system": sysname,
                "consolidated_status": (
                    "; ".join(
                        f"{f.get('finding')} ({f.get('date')})"
                        for f in findings if f.get("finding")
                    ) or "No further detail available."
                ),
                "key_findings": findings,
                "trend": "undetermined",
                "first_documented": first_d,
                "latest_documented": last_d,
            })
        return {
            "organ_systems": organ_systems,
            "systems_summary_note": (
                f"{len(organ_systems)} system(s) had documented findings. "
                "This is a fallback consolidation — the final synthesis call failed."
            ),
            "completeness_check": {
                "all_documented_findings_assigned_to_a_system": True,
                "notes": "Built deterministically after the synthesis LLM call failed.",
            },
        }

    # ---- Main run -----------------------------------------------------------

    async def run(self, state: ClinicalState) -> ClinicalState:
        logger.info(f"{self.agent_id} · OrganAnalysisAgent (batched) — START")
        t0 = datetime.now().timestamp()

        specialty = state.get("specialty", "General Medicine")
        docs = state["graph_documents"]
        batches = _chunk_list(docs, ORGAN_BATCH_SIZE)

        logger.info(
            f"{self.agent_id} · {len(docs)} documents split into "
            f"{len(batches)} batch(es) of up to {ORGAN_BATCH_SIZE} for system-finding extraction"
        )

        batch_results = await asyncio.gather(
            *[
                self._extract_batch_system_findings(batch, specialty, i)
                for i, batch in enumerate(batches)
            ],
            return_exceptions=True,
        )

        clean_results = []
        for i, r in enumerate(batch_results):
            if isinstance(r, Exception):
                logger.error(f"{self.agent_id} · system-finding batch {i + 1} failed: {r}")
                state["errors"].append(f"A3-batch-{i + 1}: {str(r)}")
                clean_results.append(self._deterministic_system_fallback(batches[i]))
            else:
                clean_results.append(r)

        merged_systems = self._merge_system_findings(clean_results)

        try:
            raw = await self._synthesize_organ_analysis(merged_systems, specialty)
        except Exception as e:
            logger.error(f"{self.agent_id} · final synthesis failed: {e}")
            state["errors"].append(f"A3-synthesis: {str(e)}")
            raw = self._deterministic_organ_fallback(merged_systems)

        state["organ_analysis"] = raw
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(
            f"{self.agent_id} · OrganAnalysisAgent — DONE "
            f"({state['agent_timings'][self.agent_id]}ms) | "
            f"{len(merged_systems)} system(s) identified"
        )
        return state


# ============================================================
# WORKFLOW GRAPH DEFINITION
# ============================================================

def create_ccgi_workflow() -> Any:
    workflow = StateGraph(ClinicalState)

    workflow.add_node("A1_TIMELINE", TimelineAgent(llm_synthesis).run)
    workflow.add_node("A2_SUMMARY",  ClinicalSummaryAgent(llm_synthesis).run)
    workflow.add_node("A3_ORGAN",    OrganAnalysisAgent(llm_synthesis).run)

    workflow.set_entry_point("A1_TIMELINE")
    workflow.add_edge("A1_TIMELINE", "A2_SUMMARY")
    workflow.add_edge("A2_SUMMARY", "A3_ORGAN")
    workflow.add_edge("A3_ORGAN", END)

    return workflow.compile()


ccgi_workflow = create_ccgi_workflow()


# ============================================================
# INITIAL STATE FACTORY
# ============================================================

def build_initial_state(
    request: ClinicalRequest,
    graph_docs: List[Dict],
    dob: Optional[str] = None,
    sex: Optional[str] = None,
    age: Optional[int] = None,
    patient_name: Optional[str] = None,
) -> ClinicalState:
    return ClinicalState(
        patient_id=request.patient_id,
        doctor_id=request.doctor_id,
        consultation_text=request.consultation_text,
        specialty=request.specialty,
        graph_documents=graph_docs,
        dob=dob,
        sex=sex,
        age=age,
        patient_name=patient_name,
        timeline=None,
        clinical_summary=None,
        organ_analysis=None,
        errors=[],
        agent_timings={},
    )


# ============================================================
# API ENDPOINTS
# ============================================================

@router.post("/clinical-reasoning-summary")
async def trigger_summary(request: Clinical):
    from Agentic.client import send_patient_summary_task
    send_patient_summary_task(request.patient_id, request.doctor_id)
    return {"status": "queued"}


@router.post("/internal/run-reasoning")
async def run_reasoning(request: ClinicalRequest):
    """
    Lean 3-agent CCGI clinical reasoning pipeline (v4.6).

      A1 — Timeline: date-wise reconstruction from graph documents, grouped
           by ENTITY TYPE within each date (not a per-document dump).
           Processed in batches of TIMELINE_BATCH_SIZE documents, merged
           deterministically, ordered LATEST DATE FIRST. Narratives are
           generated per-document in batches of NARRATIVE_BATCH_SIZE
           (flattened across all dates, so a date with many documents is
           never sent to the LLM in one oversized call), and the
           date-level narrative is then assembled with ZERO additional
           LLM calls by deterministically concatenating each date's
           document narratives.
      A2 — Clinical Summary: doctor-NARRATED STORY, grounded strictly in
           graph document data, no recommendations or predictions.
           Confirmed diagnoses (gold-standard confirmed, not merely
           suspected) are wrapped in markdown **bold**. Structured
           workflow documents (chemo/radio/surgical/nursing/treatment
           planning) are treated as the AUTHORITATIVE source for
           treatment information and are fully mined for
           treatment-management detail (modality, intent, regimen,
           status, cycles, response/toxicity) — repeated same-type
           documents (e.g. multiple chemo administrations of the same
           regimen) are woven into one continuous chronological treatment
           narrative rather than repeated as separate boilerplate
           paragraphs, while purely operational/administrative workflow
           metadata is excluded. BATCHED (SUMMARY_BATCH_SIZE docs per
           fact-extraction call, each with its own
           SUMMARY_EXTRACTION_MAX_TOKENS budget, then one small synthesis
           call whose target length scales with how much was documented,
           using its own SUMMARY_SYNTHESIS_MAX_TOKENS budget).
      A3 — Organ Analysis: organ/system-wise consolidation of documented
           findings. BATCHED (ORGAN_BATCH_SIZE docs per system-tagging
           call, then one small synthesis call over the compact, merged
           per-system findings).
    """
    start_ms = datetime.now().timestamp() * 1000
    logger.info(
        f"CCGI (lean v4.6) request | patient={request.patient_id} | doctor={request.doctor_id}"
    )

    try:
        graph_docs = await fetch_patient_graph_documents(request.patient_id)

        if not graph_docs:
            raise HTTPException(
                status_code=404,
                detail=f"No clinical graph data found for patient {request.patient_id}",
            )

        demographics = await fetch_patient_demographics(request.patient_id)
        age = _calculate_age(demographics.get("dob"))

        initial_state = build_initial_state(
            request,
            graph_docs,
            dob=demographics.get("dob"),
            sex=demographics.get("sex"),
            age=age,
            patient_name=demographics.get("name"),
        )

        result = await ccgi_workflow.ainvoke(initial_state)

        elapsed = round(datetime.now().timestamp() * 1000 - start_ms)

        full_payload = {
            "patient_id":          request.patient_id,
            "doctor_id":           request.doctor_id,
            "generated_at":        datetime.utcnow(),
            "documents_analyzed":  len(graph_docs),
            "processing_time_ms":  elapsed,
            "summary":             result.get("clinical_summary", {}),
            "timeline":            result.get("timeline", {}),
            "organ_analysis":      result.get("organ_analysis", {}),
            "agent_timings":       result.get("agent_timings", {}),
            "errors":              result.get("errors", []),
        }

        try:
            await summary_collection.insert_one(dict(full_payload))
        except Exception as e:
            logger.error(f"MongoDB save failed: {e}")

        logger.info(
            f"CCGI (lean v4.6) complete | patient={request.patient_id} | "
            f"{elapsed}ms | {len(graph_docs)} documents"
        )

        # NOTE: response shape is unchanged — "timeline" is still the full
        # A1 output object, "summary" and "organ_analysis" still carry the
        # same keys as before. No existing key was removed/renamed, so any
        # frontend reading only the old keys keeps working unmodified.
        response = {
            "patient_id":          request.patient_id,
            "doctor_id":           request.doctor_id,
            "generated_at":        datetime.now().isoformat(),
            "documents_analyzed":  len(graph_docs),
            "processing_time_ms":  elapsed,
            "agent_timings":       result.get("agent_timings", {}),
            "errors":              result.get("errors", []),
            "version":             "lean-4.6.0",

            "summary": {
                "diagnosis_header":            result.get("clinical_summary", {}).get("diagnosis_header", "Not documented"),
                "confirmed_diagnosis_present": result.get("clinical_summary", {}).get("confirmed_diagnosis_present", False),
                "confirmed_diagnoses":         result.get("clinical_summary", {}).get("confirmed_diagnoses", []),
                "paragraphs":                  result.get("clinical_summary", {}).get("paragraphs", []),
                "full_text":                   result.get("clinical_summary", {}).get("full_text", ""),
            },

            "timeline": result.get("timeline", {}),

            "organ_analysis": result.get("organ_analysis", {}),
        }

        if request.include_intermediates:
            response["intermediate"] = {
                "clinical_summary_raw": result.get("clinical_summary", {}),
                "timeline_raw":         result.get("timeline", {}),
                "organ_analysis_raw":   result.get("organ_analysis", {}),
            }

        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(
            f"CCGI (lean v4.6) pipeline failed | patient={request.patient_id} | {e}"
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health")
async def health():
    return {
        "status": "ok",
        "version": "lean-4.6.0",
        "agents": 3,
        "workflow_compiled": ccgi_workflow is not None,
        "timeline_batch_size": TIMELINE_BATCH_SIZE,
        "narrative_batch_size": NARRATIVE_BATCH_SIZE,
        "summary_batch_size": SUMMARY_BATCH_SIZE,
        "organ_batch_size": ORGAN_BATCH_SIZE,
        "groq_max_tokens": GROQ_MAX_TOKENS,
        "summary_synthesis_max_tokens": SUMMARY_SYNTHESIS_MAX_TOKENS,
        "summary_extraction_max_tokens": SUMMARY_EXTRACTION_MAX_TOKENS,
        "agent_pipeline": [
            "A1-Timeline           [batched by "
            f"{TIMELINE_BATCH_SIZE} docs for entity organization, merged "
            "deterministically, grouped by date->entity_type, ordered latest date "
            "first, with per-date document list and a document-wise breakdown "
            "(documents_detail). Narratives generated per-document in batches of "
            f"{NARRATIVE_BATCH_SIZE} (flattened across all dates — a date with many "
            "documents is never sent to the LLM in one oversized call), with the "
            "date-level narrative then assembled deterministically (zero extra LLM "
            "calls) by concatenating each date's document narratives]",
            "A2-ClinicalSummary    [BATCHED by "
            f"{SUMMARY_BATCH_SIZE} docs for fact extraction (concurrent, own "
            f"{SUMMARY_EXTRACTION_MAX_TOKENS}-token budget, treats chemo/radio/"
            "surgical/treatment-workflow docs as the AUTHORITATIVE source for "
            "treatment-course detail and excludes purely operational/administrative "
            "workflow metadata), merged deterministically, then ONE final synthesis "
            "call over the merged facts + a compact narrative timeline, writing a "
            "continuous doctor-narrated STORY (not a fact list) — target length "
            "scales with how much was documented, the full treatment course "
            "(modality/intent/regimen/status/cycles/response-toxicity) is always "
            "surfaced, same-regimen cycles are woven into one continuous "
            "chronological treatment narrative without dropping per-cycle detail, "
            "and the synthesis call uses its own token budget "
            f"({SUMMARY_SYNTHESIS_MAX_TOKENS} tokens) so long stories aren't "
            "truncated. No recommendations/predictions]",
            "A3-OrganAnalysis      [BATCHED by "
            f"{ORGAN_BATCH_SIZE} docs for system-finding extraction (concurrent), "
            "merged deterministically by system name, then ONE final synthesis call "
            "over the compact per-system findings]",
        ],
    }


# ============================================================
# ENTRYPOINT
# ============================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "ccgi_clinical_reasoning:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        log_level="info",
    )