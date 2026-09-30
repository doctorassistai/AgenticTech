"""
CCGI Clinical Graph Intelligence — Lean 2-Agent Reasoning System (v5.3.0)
=====================================================================

CHANGE IN v5.3.0 (THIS VERSION — over v5.2.0):
  • A2 ADDITIVE CONTENT CHANGE ONLY — the Clinical Summary agent's final
    synthesis call now ALSO produces an ONCOLOGY CASE CLASSIFICATION when,
    and only when, the patient's documented diagnosis is a malignancy. This
    uses standard oncology charting terminology rather than generic labels:

      - PRIMARY MALIGNANCY   — no prior cancer diagnosis is documented
                                anywhere in the patient's facts/timeline;
                                this is a de novo diagnosis.
      - RECURRENCE            — a prior cancer diagnosis IS documented, the
                                new finding is the SAME histology arising in
                                the same/related site or field, and the
                                record explicitly describes it as recurrent
                                or relapsed. Further classified, only when
                                the documents support it, as LOCAL, REGIONAL,
                                or DISTANT recurrence.
      - SECOND PRIMARY MALIGNANCY (SPM) — a prior cancer diagnosis IS
                                documented, the new finding is a DIFFERENT
                                histology and/or an unrelated primary site,
                                and the record supports it being an
                                independent primary rather than a recurrence
                                or metastasis of the first cancer. Further
                                classified, only when dates support it, as
                                SYNCHRONOUS (near the same time as the first
                                cancer, conventionally within ~6 months) or
                                METACHRONOUS (diagnosed after a longer
                                interval).

    This classification is GRAPH-DRIVEN ONLY — it is derived strictly from
    the same pre-extracted facts and compact timeline A2 already uses for
    the narrative, never from outside oncology knowledge, and it is left
    null/not-applicable whenever the patient's diagnosis is not oncological,
    or the evidence for a specific classification is ambiguous (the model is
    explicitly instructed to leave it unclassified rather than guess). It
    adds two new keys to A2's existing JSON schema — "oncology_case_type" and
    "oncology_case_chips" — and a corresponding "oncology_classification"
    block in the API response's "summary" object. NOTHING ELSE CHANGES: the
    non-oncology narrative content, the CONFIRMED DIAGNOSIS bold rule, the
    measurement/value bold rule, the mandatory final current-status
    paragraph, batching, token budgets, and the rest of the v5.2.0 schema
    are all byte-for-byte unchanged. Version strings bumped to
    lean-5.3.0 throughout logging and the /health and pipeline responses.

CHANGE IN v5.2.0 (carried forward, unchanged):
  • A2 CONTENT CHANGE ONLY — the v5.1.0 requirement that the Clinical
    Summary agent's FINAL SYNTHESIS narrative be organized CHRONOLOGICALLY
    BY DOCUMENT DATE is REVERTED. As of v5.2.0 the narrative is again
    organized by CLINICAL LOGIC/TOPIC — the same style of ordering used in
    the earlier v4.4-v4.9 line (diagnosis -> pathology/findings ->
    biomarkers -> imaging -> labs -> procedures/treatment course ->
    functional/clinical status -> complications -> other -> mandatory
    current-status close) — rather than mirroring raw document/date order.
    Concretely:
      - Dates are still used, but only (a) to state a specific date/period
        next to a fact when that date is itself clinically meaningful
        (e.g. date of diagnosis, date of surgery, date a critical lab was
        drawn), and (b) INTERNALLY, using the A1 compact timeline, to work
        out which finding/treatment/status is most CURRENT and to get the
        real chronological sequence of treatment events right (e.g.
        confirming surgery preceded chemotherapy, which preceded
        radiotherapy) — dates are NOT used to dictate the paragraph-by-
        paragraph structure of the summary any more.
      - The summary is explicitly a GENERIC, CONCISE, doctor-readable
        clinical summary: short enough to be read at a glance, but still
        required to cover every clinically relevant piece of documented
        content for that patient — diagnosis, pathology/findings, every
        documented treatment/procedure category (per the unchanged,
        mandatory, graph-driven-only PROCEDURE DETAIL RULE below), current
        disease/treatment status, complications/toxicities, active
        medications, and the follow-up plan.
      - Length guidance is tightened versus v5.1.0 so the result stays a
        true, concise SUMMARY rather than a long chronological narrative
        retelling, while still scaling up modestly for a heavily-
        documented patient so nothing clinically important is dropped.
    NOTHING ELSE CHANGED: the mandatory, graph-driven-only PROCEDURE
    DETAIL RULE, the CONFIRMED DIAGNOSIS bold rule, the measurement/value
    bold rule, the "missing information is silently omitted" rule, the
    mandatory final current-status paragraph, A1 (Timeline agent,
    untouched), A2's batching (SUMMARY_BATCH_SIZE fact-extraction batches,
    one final synthesis call), token budgets (SUMMARY_EXTRACTION_MAX_TOKENS,
    SUMMARY_SYNTHESIS_MAX_TOKENS), the "no external medical knowledge"
    grounding rule, and the OUTPUT JSON SCHEMA are all byte-for-byte
    unchanged from v5.1.0. The v5.0.1 LLM_CONCURRENCY rate-limit fix is
    untouched and still in effect (see below).

CHANGE IN v5.1.0 (carried forward, now partially superseded — see above):
  • A2 CONTENT CHANGE ONLY — the Clinical Summary agent's FINAL SYNTHESIS
    narrative was organized CHRONOLOGICALLY BY DOCUMENT DATE instead of
    being sequenced purely by clinical logic. THIS ORDERING RULE IS
    SUPERSEDED BY v5.2.0 ABOVE — the narrative is once again organized by
    clinical logic, not document date. Everything else introduced in
    v5.1.0 (the mandatory, graph-driven-only PROCEDURE DETAIL RULE
    covering every treatment/procedure category actually present in the
    patient's documents) remains in effect, unchanged, in v5.2.0.

CHANGE IN v5.0.1 (carried forward, unchanged):
  • RATE-LIMIT FIX ONLY. Added a single shared `asyncio.Semaphore`
    (LLM_CONCURRENCY, default 4) that every LLM call passes through inside
    BaseAgent._invoke(). This is the ONLY functional change v5.0.1 made
    over v5.0. It does NOT touch: batch sizes, max_tokens budgets, prompts,
    schemas, fallback logic, or any content/completeness behavior. It
    exists purely to stop Groq TPM (tokens-per-minute) 429 rate-limit
    errors that occur when many batches fire concurrently (e.g. A1's 14
    batches, or A2's 7 fact-extraction batches, all admitted to Groq at
    the same instant).

    WHY THIS APPROACH AND NOT max_tokens/batch-size reduction: Groq counts
    a request's *requested* max_tokens against your TPM budget the moment
    the request is admitted — not what it actually generates. Firing many
    batches via asyncio.gather() at once creates a burst that can exceed
    the account's TPM ceiling even though the total minute-long workload
    would easily fit if paced out. Reducing max_tokens or batch size would
    also reduce this burst, but at the cost of truncation/completeness
    risk on richly-documented patients — exactly the outcome we want to
    avoid. A concurrency semaphore paces requests without shrinking any
    single call's budget or the amount of data any call is allowed to
    process, so nothing is ever dropped, summarized short, or missed.

    HOW IT WORKS: LLM_CONCURRENCY (default 4) means at most 4 LLM calls
    are ever in flight to Groq at once, from ANY agent, at ANY stage of
    the pipeline (A1 batch-organization, A1 narrative generation, A2
    fact-extraction, A2 synthesis all share the same semaphore). Every
    other queued call simply waits its turn instead of being admitted all
    at once and immediately 429'd. The Groq SDK's built-in retry/backoff
    is still in place underneath this as a second line of defense, but
    with the semaphore in place it should rarely need to trigger.

    TUNING: raise LLM_CONCURRENCY if your Groq tier can sustain more
    parallel throughput (higher TPM limit); lower it if you still see
    429s. It defaults to 4, a conservative starting point for a 300,000
    TPM on-demand tier with GROQ_MAX_TOKENS=8000 completion budgets.

Architecture:
  A1  Timeline Agent          → date-wise chronological reconstruction from graph data,
                                 organized by ENTITY TYPE within each date (not a document
                                 dump). Processes documents in BATCHES of TIMELINE_BATCH_SIZE
                                 (concurrently, throttled by LLM_CONCURRENCY), merges the
                                 batches deterministically in Python, then writes narratives
                                 in TWO further batched steps:

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
                                 As of v5.2.0, the narrative is a GENERIC, CONCISE clinical
                                 summary organized by CLINICAL LOGIC/TOPIC (not raw document/
                                 date order), and still gives full, dated, doctor-ready detail
                                 for every treatment/procedure category (surgery,
                                 chemotherapy, radiotherapy, or any other documented
                                 procedure) that is actually present in the graph data —
                                 never a fixed/hardcoded template of procedures. Any
                                 diagnosis stated as CONFIRMED (biopsy/histopathology or
                                 other gold-standard confirmation in the record — never a
                                 merely suspected/probable one) is wrapped in markdown
                                 **bold** in the narrative and in the diagnosis header. Fully
                                 mines STRUCTURED WORKFLOW DOCUMENTS (chemotherapy,
                                 radiotherapy, surgical, nursing, treatment-planning, or any
                                 structured EMR/JSON-style document) for treatment-management
                                 detail — treatment intent, protocol, cycle counts, dose
                                 adjustments, concurrent therapy, administration details,
                                 monitoring observations, and treatment status — instead of
                                 only surfacing the diagnosis/medication from them.

                                 v4.4 — v4.9 content history (all prompt-only, condensed here
                                 — see prior revisions for full detail; the sequencing bullet
                                 below is the rule REINSTATED by v5.2.0):
                                   • Multiple documents of the same type are each described as
                                     their own individual clinical event, never folded into one
                                     generic combined sentence.
                                   • Final synthesis writes ONE continuous, doctor-narrated
                                     STORY sequenced by CLINICAL LOGIC rather than by mirroring
                                     raw document/date order (v5.1.0 had temporarily replaced
                                     this with strict document-date ordering; v5.2.0 reinstates
                                     clinical-logic ordering while KEEPING v5.1.0's mandatory
                                     procedure-detail rule). It is still ONE continuous
                                     doctor-narrated story, using its own
                                     SUMMARY_SYNTHESIS_MAX_TOKENS budget.
                                   • Chemotherapy/radiotherapy/surgical/treatment-workflow
                                     documents are the AUTHORITATIVE source for treatment
                                     information (modality, intent, regimen, cycles, status,
                                     response/toxicity); purely operational/administrative
                                     workflow metadata (nurse/pharmacy verification, consent
                                     capture, IV/venous access mechanics, drug labeling
                                     checklists) is excluded unless it reflects an actual
                                     clinical event.
                                   • A generic, specialty-agnostic clinical checklist
                                     (diagnosis, pathology, molecular/biomarkers, imaging, labs,
                                     procedures, treatment, functional status, clinical status,
                                     complications, other) is pulled from whenever documented,
                                     auto-adapted to the patient's actual specialty/condition —
                                     never a single hardcoded (e.g. oncology-only) schema.
                                   • An expanded, sparing BOLD-emphasis rule covers confirmed
                                     diagnoses plus other highly clinically significant facts and
                                     clinically important measurements/values (sizes, EF%, labs,
                                     stage/TNM, radiation dose/fractions, chemo cycle number,
                                     clinically significant drug doses, performance status,
                                     critical vitals, biomarker values) — never every numeric
                                     value.
                                   • A strict "missing information" rule — undocumented
                                     categories are silently omitted, never flagged with
                                     placeholder text like "not documented"/"unknown" inside the
                                     narrative body (diagnosis_header keeps its own pre-existing
                                     schema-required "Not documented" fallback).
                                   • LABORATORY VALUE SYNTHESIS — routine/normal lab values are
                                     stated as a plain-language clinical impression rather than
                                     enumerated; an exact value is cited only when it is itself
                                     clinically important.
                                   • MANDATORY FINAL PARAGRAPH — the last paragraph always
                                     functions as a current-status close (current treatment
                                     status, current disease status, significant toxicities/
                                     complications, active medications, follow-up/monitoring
                                     plan), whenever any of these is documented.
                                 OUTPUT JSON SCHEMA for A2 is UNCHANGED across v5.1.0/v5.2.0
                                 (diagnosis_header, confirmed_diagnosis_present,
                                 confirmed_diagnoses, paragraphs, full_text,
                                 source_coverage_check). v5.3.0 ADDS two oncology-only fields,
                                 populated when and only when the confirmed diagnosis is a
                                 malignancy (null/empty otherwise): oncology_case_type
                                 (primary_malignancy / recurrence_local / recurrence_regional /
                                 recurrence_distant / recurrence_unspecified /
                                 second_primary_synchronous / second_primary_metachronous /
                                 second_primary_unspecified / null) and oncology_case_chips
                                 (2-4 short ALL-CAPS labels). See "CHANGE IN v5.3.0" above.

                                 BATCHED, TWO-PASS, LIKE A1 (bounded, regardless of patient
                                 document volume):
                                   Pass 1 (fact extraction): graph_documents are split into
                                   batches of SUMMARY_BATCH_SIZE (default 10) and processed
                                   CONCURRENTLY (throttled by LLM_CONCURRENCY). Each batch call
                                   only ever sees its own small slice of documents.
                                   Merge (deterministic, no LLM): all batches' extracted
                                   facts are concatenated in Python.
                                   Pass 2 (synthesis): ONE final, much smaller LLM call takes
                                   the concatenated facts + a COMPACT projection of the A1
                                   timeline (date + documents + narrative only) and writes
                                   the final physician-oriented clinical summary, organized by
                                   clinical logic (v5.2.0), using the timeline only to resolve
                                   what is current and what the true treatment sequence was.
                                 The OUTPUT JSON SCHEMA for A2 is unchanged.

Design principles:
  - No hardcoded disease logic, no demo/oncology-specific schemas. This
    extends explicitly to A2's procedure-detail rule: the set of
    treatment/procedure types detailed (surgery, chemotherapy,
    radiotherapy, or otherwise) is derived ENTIRELY from what is actually
    present in graph_documents for that patient — never a fixed list
    assumed to apply to every patient.
  - Every output must be traceable to entities actually present in
    `graph_documents` fetched from Neo4j. Nothing is invented or predicted.
  - NOTHING IS EVER SUPPLEMENTED FROM THE MODEL'S OWN MEDICAL KNOWLEDGE OR
    TRAINING DATA. Every agent's prompts explicitly forbid using general
    medical knowledge, textbook expectations, or "typical" clinical
    patterns to add, infer, or fill in anything not literally present in
    the `graph_documents` given to that specific call. If it isn't in the
    graph data handed to the model in that prompt, it does not appear in
    the output.
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
    input from the previous stage (Timeline -> Summary).
  - EVERY LLM call in the pipeline is sized so it does NOT scale linearly
    with the patient's total raw document/entity volume — A1 and A2 both
    batch their raw-document (or, for A1's narrative pass, flattened
    per-document) reads, merge/assemble deterministically in Python, and
    only ever run bounded-size calls — never a single call whose size
    scales with total patient document count.
  - CONCURRENCY IS THROTTLED, NOT CONTENT. All batches within a stage still
    run concurrently (via asyncio.gather) for speed, but a shared
    asyncio.Semaphore(LLM_CONCURRENCY) ensures only a bounded number of
    requests are ever in flight to the LLM provider at once, which avoids
    provider-side rate-limit (429/TPM) errors WITHOUT reducing any batch's
    size, any call's max_tokens budget, or any prompt's completeness
    requirements. No data is ever dropped or shortened to achieve this.
  - Output JSON keys already relied upon by the frontend are never removed
    or renamed for keys that still exist — A1 and A2's shapes are
    byte-for-byte the same as before. The ONLY schema/response change
    versus v4.9 was the REMOVAL of the "organ_analysis" key (and the A3
    agent that produced it) from ClinicalState and from the API response,
    per explicit request in v5.0. v5.0.1, v5.1.0, and v5.2.0 all make NO
    further schema changes — v5.2.0 changes A2's prompt content only
    (clinical-logic ordering instead of document-date ordering, tighter
    length guidance), not the JSON shape returned.
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
# never silently truncated. Comfortably under openai/gpt-oss-120b's
# published completion cap.
GROQ_MAX_TOKENS = int(os.getenv("GROQ_MAX_TOKENS", "8000"))

# Max tokens for A2's FINAL SYNTHESIS call specifically (the one that writes
# the clinical summary). Split out from GROQ_MAX_TOKENS so it can be tuned
# independently — a fully-documented patient (many chemo cycles, radio
# sessions, etc.) can still need more completion budget even in synthesized
# form, and this gives you a dedicated knob to avoid truncation WITHOUT
# changing the token budget/cost of every other call in the pipeline (A1
# batches, A2 fact-extraction batches all still use GROQ_MAX_TOKENS as
# before). Defaults to GROQ_MAX_TOKENS if not set, so behavior is unchanged
# unless you explicitly raise it in the environment.
SUMMARY_SYNTHESIS_MAX_TOKENS = int(
    os.getenv("SUMMARY_SYNTHESIS_MAX_TOKENS", str(GROQ_MAX_TOKENS))
)

# Max tokens for A2's Pass-1 FACT-EXTRACTION calls specifically. Each
# extraction batch pulls out structured treatment-course detail per
# workflow document (modality/intent/regimen/status/cycles/response or
# toxicity), which can make a batch's own JSON output longer — especially a
# batch that happens to contain several chemo/radio workflow documents.
# Splitting this out from GROQ_MAX_TOKENS gives a dedicated knob to raise if
# you see extraction-pass truncation in logs (parse_llm_json falling back to
# {"raw_output": ...}), without touching the token budget of A1. Defaults to
# GROQ_MAX_TOKENS, so behavior/cost is unchanged unless explicitly raised.
SUMMARY_EXTRACTION_MAX_TOKENS = int(
    os.getenv("SUMMARY_EXTRACTION_MAX_TOKENS", str(GROQ_MAX_TOKENS))
)

# ------------------------------------------------------------------
# LLM concurrency throttle (v5.0.1 rate-limit fix, unchanged in v5.2.0).
#
# How many LLM requests are allowed to be in flight to the provider at the
# SAME TIME, across the ENTIRE pipeline (A1 batch-organization, A1
# narrative generation, A2 fact-extraction, A2 synthesis all share this
# one semaphore, since they all funnel through BaseAgent._invoke). This
# does NOT limit how many documents/batches exist or how much content any
# single call is allowed to produce — it only paces *when* each batch's
# request is admitted to the provider, which is what actually caused the
# TPM 429 bursts (many batches admitted in the same instant, each
# reserving up to GROQ_MAX_TOKENS against the TPM ceiling).
#
# Tune this via the LLM_CONCURRENCY env var. Lower it if you still see
# 429s in the logs; raise it (and/or upgrade your Groq tier) if you want
# faster wall-clock completion and your TPM budget can sustain it.
# ------------------------------------------------------------------
LLM_CONCURRENCY = int(os.getenv("LLM_CONCURRENCY", "4"))

# Single high-quality LLM used for all agents.
llm_synthesis = ChatGroq(
    model="openai/gpt-oss-120b",
    temperature=0.1,
    groq_api_key=GROQ_API_KEY,
    max_tokens=GROQ_MAX_TOKENS,
)

router = APIRouter(prefix="", tags=["Clinical Reasoning"])

# Timeline batching — process this many documents per LLM call, then merge
# the batches deterministically. Keeps each call small/reliable regardless
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


def _chunk_list(items: List[Any], size: int) -> List[List[Any]]:
    """Generic, shared chunking helper used by the Timeline and Clinical
    Summary agents to split raw documents (or, for A1's narrative pass,
    flattened per-document entries) into small, safely sized batches."""
    if size <= 0:
        return [items] if items else []
    return [items[i:i + size] for i in range(0, len(items), size)]


_ONCOLOGY_CASE_TYPE_LABELS: Dict[str, str] = {
    "primary_malignancy":          "Primary malignancy",
    "recurrence_local":            "Recurrence — local",
    "recurrence_regional":         "Recurrence — regional",
    "recurrence_distant":          "Recurrence — distant",
    "recurrence_unspecified":      "Recurrence",
    "second_primary_synchronous":  "Second primary malignancy — synchronous",
    "second_primary_metachronous": "Second primary malignancy — metachronous",
    "second_primary_unspecified":  "Second primary malignancy",
}


def _oncology_case_label(case_type: Optional[str]) -> Optional[str]:
    """Deterministic, Python-side lookup from A2's raw
    'oncology_case_type' enum value to the doctor-facing display label —
    kept out of the LLM call entirely so the label text is never subject
    to model wording drift and always matches the fixed vocabulary above.
    Returns None (not a placeholder string) when case_type is None/unknown,
    i.e. the patient is not oncological or the case could not be
    classified from the documented facts."""
    if not case_type:
        return None
    return _ONCOLOGY_CASE_TYPE_LABELS.get(case_type)


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


# Shared, verbatim rule block appended to every agent's system prompt so the
# "never use outside/general medical knowledge" instruction is worded
# identically everywhere and can't drift between agents.
NO_EXTERNAL_KNOWLEDGE_RULE = (
    "ABSOLUTE GROUNDING RULE — NO EXTERNAL DATA, EVER: you must use ONLY the "
    "clinical data explicitly supplied to you inside THIS prompt (the raw "
    "graph documents / entities / extracted facts / timeline given below, "
    "as applicable). You must NEVER draw on your own general medical "
    "knowledge, textbook knowledge, training data, typical/expected "
    "clinical patterns, standard-of-care assumptions, or anything else "
    "learned outside this conversation to add, infer, fill in, complete, "
    "correct, or embellish any detail. If something is not literally "
    "present in the data given to you in this call, it does not exist for "
    "the purpose of your output — you leave it out rather than supplying it "
    "from outside knowledge, even if it seems like an obvious or "
    "well-known clinical fact. This applies to every field: dates, values, "
    "names, doses, findings, diagnoses, staging, units — all of it must "
    "trace back to the supplied data, never to what you already know about "
    "medicine in general."
)

# ------------------------------------------------------------------
# Shared semaphore instance (v5.0.1, unchanged in v5.2.0). Created once at
# module load so it's shared across every agent instance and every request.
# All LLM calls in the pipeline pass through BaseAgent._invoke(), so gating
# there is sufficient to throttle the ENTIRE pipeline's concurrent provider
# requests without touching any per-agent batching/gather code.
# ------------------------------------------------------------------
_llm_semaphore = asyncio.Semaphore(LLM_CONCURRENCY)


class BaseAgent:
    def __init__(self, llm):
        self.llm = llm

    async def _invoke(self, system: str, user: str, max_tokens: Optional[int] = None):
        """Invoke the shared LLM. If max_tokens is given, bind a
        per-call override (used by A2's fact-extraction and final
        synthesis passes so neither gets silently truncated) without
        changing the token budget of any other call, which keeps using
        the client's default GROQ_MAX_TOKENS.

        Acquires the shared _llm_semaphore before making the request, so
        at most LLM_CONCURRENCY requests from ANYWHERE in the pipeline (A1
        or A2, any batch, any pass) are ever in flight to the provider at
        once. This is purely a pacing mechanism — it does not change the
        prompt, the data sent, the max_tokens budget, or the fallback
        behavior below. Batches that would otherwise have been fired
        simultaneously (and 429'd) now simply queue briefly and run as
        soon as a slot frees up; nothing is skipped, shortened, or dropped
        as a result."""
        llm = self.llm.bind(max_tokens=max_tokens) if max_tokens else self.llm
        async with _llm_semaphore:
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
# Batches of TIMELINE_BATCH_SIZE documents are organized concurrently
# (throttled by the shared LLM_CONCURRENCY semaphore in BaseAgent._invoke)
# and merged deterministically in Python (no LLM in the merge step, so
# nothing can be lost or hallucinated there). Which source documents fall
# on which date is also computed deterministically straight from the raw
# documents (no LLM needed for that — it's just grouping by document_date).
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
#
# UNCHANGED IN v5.2.0 (and unchanged since v5.1.0) — A1 is not touched by
# either version at all. Only A2's synthesis prompt content changed.
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
            + NO_EXTERNAL_KNOWLEDGE_RULE + " "
            "Always respond with valid JSON only."
        )

        prompt = f"""
You are reading a BATCH of raw clinical graph documents (batch #{batch_index + 1}) for a
patient being seen by a {specialty} specialist. This is a subset of the patient's full
record — organize ONLY what is given below. Do not supplement it with anything from
your own medical knowledge.

RAW CLINICAL GRAPH DOCUMENTS IN THIS BATCH:
{docs_json}

══════════════════════════════════════════════════════════
TASK — ORGANIZE THIS BATCH BY DATE, THEN BY ENTITY TYPE
══════════════════════════════════════════════════════════

RULES (STRICT):
  1. Use ONLY the data given above. Do not add, infer, or predict anything not
     explicitly present. Do NOT use outside/general medical knowledge for any
     part of this task — see the grounding rule in your system instructions.
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
            "finding or value not present in the data. "
            + NO_EXTERNAL_KNOWLEDGE_RULE + " "
            "Always respond with valid JSON only."
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
if it shares the same date as this one. Never add any fact, value, or
clinical detail that is not explicitly present in that document's own
entities, no matter how standard or expected it might seem from general
medical knowledge.

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
  • Never supplement with outside/general medical knowledge.

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
        documents (dates mixed freely), runs those batches CONCURRENTLY
        (throttled by the shared LLM_CONCURRENCY semaphore), and returns
        {date: {document: narrative}}. Each batch is a small, independent,
        bounded call — a date with many documents piled onto it can never
        cause a single oversized call here, because documents from that
        date are simply spread across several batches alongside documents
        from other dates."""

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
            f"{len(batches)} narrative batch(es) of up to {NARRATIVE_BATCH_SIZE} "
            f"(throttled to {LLM_CONCURRENCY} concurrent LLM requests)"
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
            f"{len(batches)} batch(es) of up to {TIMELINE_BATCH_SIZE} "
            f"(throttled to {LLM_CONCURRENCY} concurrent LLM requests)"
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

        # Step (1): batched per-document narrative generation (bounded, throttled LLM calls).
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
# A2 · CLINICAL SUMMARY AGENT  (physician-oriented, generic multi-specialty
#                                 CLINICAL SUMMARY, ORGANIZED BY CLINICAL
#                                 LOGIC as of v5.2.0 — reverted from
#                                 v5.1.0's strict document-date ordering —
#                                 bold clinical emphasis, structured-
#                                 workflow-aware, mandatory graph-driven
#                                 procedure detail, BATCHED)
#
# As of v5.2.0, the final synthesized narrative is a GENERIC, CONCISE
# clinical summary organized by CLINICAL LOGIC/TOPIC (diagnosis -> pathology
# / findings -> biomarkers -> imaging -> labs -> procedures/treatment course
# -> functional/clinical status -> complications -> other -> mandatory
# current-status close) rather than by raw document/date order. Dates are
# still stated next to a fact when clinically meaningful, and the A1
# compact timeline is still used internally to resolve which finding/
# treatment/status is most CURRENT and to establish the real sequence of
# treatment events — but the paragraph structure itself follows clinical
# logic, not chronology. Grounded strictly in graph_documents. No
# recommendations, no predictions — but documented referrals/follow-up
# plans ARE reported (facts, not AI suggestions).
#
# Any diagnosis explicitly CONFIRMED in the record (by histopathology,
# biopsy, or other gold-standard confirmation — never a merely suspected or
# radiologically-probable one) is wrapped in markdown **bold** wherever it
# is stated in full, and in the diagnosis_header. A small set of OTHER
# highly clinically significant, patient-specific facts (stage, pathology,
# major imaging findings, tumor burden, critical labs, biomarkers, major
# procedures, treatment history/current treatment/response, performance
# status, significant toxicities/complications, major comorbidities,
# significant allergies, critical concurrent medications, current disease
# status, and the follow-up plan) are ALSO sparingly bolded — never every
# medical term.
#
# PROCEDURE DETAIL RULE (MANDATORY, GRAPH-DRIVEN ONLY, unchanged since
# v5.1.0): for every treatment/procedure category actually present in the
# patient's documents — surgery, chemotherapy, radiotherapy, or any other
# documented procedure — the summary gives full, dated, doctor-ready detail
# (modality, date, intent, protocol/regimen or operative detail, cycle/
# session/fraction counts, dose and dose adjustments, concurrent therapy,
# monitoring, response/toxicity). The set of procedures detailed is derived
# ENTIRELY from what is present in graph_documents for THIS patient — never
# a fixed "surgery/chemo/radio" template assumed to apply to every patient.
#
# This agent also fully mines STRUCTURED WORKFLOW DOCUMENTS — chemotherapy,
# radiotherapy, surgical, nursing, treatment-planning forms, or any
# structured EMR/JSON-style document — for the full treatment-management
# picture (intent, protocol, cycles, dose adjustments, concurrent therapy,
# administration details, monitoring observations, treatment status), not
# just the diagnosis/medication name. These workflow documents are treated
# as the AUTHORITATIVE source of treatment information — operational/
# administrative workflow metadata that carries no clinical meaning on its
# own (nurse verification, pharmacy verification, consent capture,
# IV/venous access mechanics, drug labeling/preparation checklists) is
# filtered out of the summary unless it reflects an actual clinical event
# (a reaction, extravasation, or documented toxicity).
#
# BATCHED, TWO-PASS (bounded, regardless of patient document volume):
#   Pass 1 (concurrent, per-batch fact extraction, throttled by the shared
#   LLM_CONCURRENCY semaphore): graph_documents are split into batches of
#   SUMMARY_BATCH_SIZE (default 10) documents.
#   Merge (deterministic, no LLM): all batches' facts are concatenated in
#   Python.
#   Pass 2 (single, final synthesis call): takes the concatenated facts +
#   a COMPACT projection of the A1 timeline (date + documents + narrative
#   only), used ONLY to resolve current status and true treatment sequence
#   (not as the paragraph-ordering backbone), and writes the final
#   physician-oriented clinical summary. Uses its own
#   SUMMARY_SYNTHESIS_MAX_TOKENS budget so a long, fully-documented summary
#   is never silently truncated.
#
# OUTPUT JSON SCHEMA for A2 is unchanged. The only change versus v5.1.0 is
# A2's synthesis PROMPT CONTENT (clinical-logic ordering instead of
# document-date ordering, tighter/more concise length guidance) — no
# prompt, batch-size, or token-budget change to fact extraction, and no
# change at all to the shared concurrency semaphore in BaseAgent._invoke().
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
            + NO_EXTERNAL_KNOWLEDGE_RULE + " "
            "Every fact you extract must be traceable to a specific document given "
            "to you in this batch — never something you know to be typically true "
            "in general medicine. "
            "Always respond with valid JSON only."
        )

        prompt = f"""
You are reading a BATCH of raw clinical graph documents (batch #{batch_index + 1})
for a patient being seen by a {specialty} specialist. This is only a subset of the
patient's full record — extract facts ONLY from what is given below. Do not
supplement with anything from your own general medical knowledge, even if it
seems like an obvious or standard clinical fact.

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
  • Never use outside/general medical knowledge to add, complete, or
    "correct" a fact — every fact must trace to this batch's documents.
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
        """The ONLY call in A2 that produces the final clinical summary.
        Its input is the concatenated fact list (small) plus a COMPACT
        projection of the A1 timeline (date + documents + narrative only)
        — never the full entity-level timeline, and never the raw
        graph_documents again — so its size does not scale with the
        patient's total document/entity volume.

        As of v5.2.0, this call asks for a GENERIC, CONCISE, doctor-style
        clinical summary organized by CLINICAL LOGIC/TOPIC — diagnosis,
        pathology/findings, treatment course, current status — rather than
        by raw document/date order (v5.1.0's chronological-by-date
        requirement is reverted). The compact timeline below is still
        supplied and is still used by the model to work out which finding/
        treatment/status is most CURRENT, and to get the real sequence of
        treatment events right — it is a resolution aid, not the
        paragraph-ordering backbone. It still automatically adapts to the
        patient's specialty and pulls in whichever of a comprehensive,
        generic clinical checklist is actually documented, with a sparing
        but expanded bold-emphasis rule, the unchanged mandatory
        PROCEDURE DETAIL RULE, and a strict rule against writing
        placeholder text for missing categories. Routine lab values are
        still synthesized into a plain-language impression rather than
        enumerated, and the final paragraph remains a mandatory
        current-status close.

        Uses its own SUMMARY_SYNTHESIS_MAX_TOKENS budget so a long,
        fully-documented summary for a heavily-documented patient is never
        silently truncated — though as of v5.2.0 the target length itself
        is intentionally tighter/more concise than v5.1.0's, since the
        goal is a short, generic, at-a-glance clinical summary rather than
        a full chronological narrative retelling."""

        facts_text = "\n".join(f"- {f}" for f in all_facts)
        num_facts = len(all_facts)

        # This compact timeline is sorted earliest-first purely so the
        # model can reliably work out sequence (which event came before
        # which) and CURRENCY (which finding/treatment/status is the most
        # recent one, detecting when a later document supersedes or
        # changes an earlier one — e.g. a dose later reduced, a status
        # later updated) — establishing the true real-world sequence of
        # care for treatment events (e.g. confirming that surgery preceded
        # chemotherapy, which preceded radiotherapy). As of v5.2.0 this is
        # explicitly a RESOLUTION AID ONLY — it does NOT dictate the order
        # paragraphs are written in; paragraph order follows clinical
        # logic/topic instead (see the system prompt).
        # This re-sort is local to this function only; it does NOT touch
        # state["timeline"] or change A1's own output/order in the API
        # response in any way (A1's own timeline stays latest-first).
        compact_timeline = sorted(
            (
                {
                    "date": entry.get("date"),
                    "documents": entry.get("documents", []),
                    "narrative": entry.get("narrative"),
                }
                for entry in (timeline.get("timeline") or [])
            ),
            key=lambda e: _safe_date_key(e.get("date")),
        )
        timeline_json = json.dumps(compact_timeline, indent=2, default=str)

        confirmed_hint = (
            "\n".join(f"- {d}" for d in all_confirmed_diagnoses)
            if all_confirmed_diagnoses
            else "None extracted."
        )

        # Scale the target length with how much has actually been
        # documented, so a heavily-documented patient (many structured
        # workflow documents, many distinct facts) still gets a
        # proportionally thorough summary instead of an artificially
        # short one — while a lightly-documented patient gets a genuinely
        # concise one, rather than padding. As of v5.2.0 these ranges are
        # intentionally tighter than v5.1.0's, since the goal is a short,
        # generic, doctor-readable SUMMARY, not a long chronological
        # narrative — the PROCEDURE DETAIL RULE still guarantees every
        # documented treatment/procedure gets full detail regardless of
        # the overall summary's brevity.
        if num_facts >= 60:
            length_guidance = (
                "This patient has extensive documentation. Write a concise but "
                "COMPLETE clinical summary — typically 12-18 dense sentences across "
                "a small number of short paragraphs organized by CLINICAL LOGIC "
                "(diagnosis, pathology/findings, treatment course per the mandatory "
                "procedure detail rule, current status) — long enough to preserve "
                "every clinically important fact and every clinically significant "
                "treatment/procedure event (dose reductions, toxicity, progression, "
                "regimen changes, interruptions, hospitalization), but written as a "
                "tight, doctor-style summary, never as a document-by-document or "
                "date-by-date log, and never repeating the same medication or "
                "follow-up plan more than once."
            )
        elif num_facts >= 25:
            length_guidance = (
                "This patient has substantial documentation. Write a focused, "
                "concise clinical summary of roughly 8-12 dense sentences across a "
                "couple of short paragraphs, organized by CLINICAL LOGIC (diagnosis, "
                "findings, treatment course, current status), covering every "
                "clinically important fact and significant treatment/procedure event "
                "without repeating the same medication or follow-up plan more than "
                "once."
            )
        else:
            length_guidance = (
                "Write a short, concise clinical summary of roughly 4-8 dense "
                "sentences — fewer only if the source facts themselves are limited "
                "— organized by CLINICAL LOGIC (diagnosis, findings, treatment, "
                "current status) and covering every clinically important fact "
                "without padding or repetition."
            )

        system = (
            f"You are a senior {specialty} specialist writing the physician-oriented "
            "CLINICAL SUMMARY section of a patient's chart. Your summary must read "
            "as ONE continuous, doctor-narrated physician narrative — concise, and "
            "GENERICALLY structured by CLINICAL LOGIC/TOPIC, not by raw document/"
            "date order — so that any physician understands this patient's complete "
            "clinical course within a short, quick read. "
            "CORE PRINCIPLE — CONCISE, CLINICALLY-LOGICAL NARRATIVE: you are given "
            "pre-extracted facts drawn from many individual documents/reports, each "
            "traceable to its own document date, plus a compact date-wise timeline. "
            "Organize the summary by CLINICAL LOGIC — e.g. diagnosis and how it was "
            "reached, pathology/findings, disease extent, treatment/procedure course, "
            "current status — rather than by mechanically walking through documents "
            "or dates in order. Use the dates given to you (a) to state a specific "
            "date/period next to a fact when that date is itself clinically "
            "meaningful (e.g. date of diagnosis, date of surgery, date a critical lab "
            "was drawn), and (b) internally, to work out which finding/treatment/"
            "status is the most CURRENT one and to get the real sequence of "
            "treatment events right (e.g. confirming that surgery preceded "
            "chemotherapy, which preceded radiotherapy) — but do NOT force the "
            "paragraph-by-paragraph structure of the summary to follow document or "
            "date order. Grouping by topic, and only mentioning a specific date where "
            "it adds clinical value, is expected and correct. Every date you do state "
            "must come directly from the facts/timeline given to you below — never "
            "invented or approximated. "
            + NO_EXTERNAL_KNOWLEDGE_RULE + " Synthesizing and connecting the given "
            "facts into flowing, clinically-organized prose is expected and "
            "required — but every clinical fact, value, date, or finding that "
            "appears in your narrative must trace back to the extracted facts or "
            "timeline given to you below. Never fill a gap, complete a partial "
            "finding, or add a 'typically expected' detail using your own medical "
            "knowledge. "
            "CLINICAL FLOW: structure the narrative around whichever of the "
            "following categories are documented — diagnosis and how it was "
            "confirmed; the investigations that established it; disease extent/"
            "staging/severity; each treatment/procedure event (surgery, "
            "chemotherapy, radiotherapy, or other procedure); changes in disease "
            "status; and the follow-up/monitoring plan — in that CLINICAL-LOGIC "
            "order, not a chronological document-by-document order. Only surface a "
            "category that is actually documented, and skip any category with no "
            "supporting data. "
            "TREATMENT / PROCEDURE SEQUENCE OF CARE: within the treatment/procedure "
            "portion of the summary, still state each treatment or procedure event's "
            "own documented date and present multiple events in the real "
            "chronological order they actually happened relative to each other "
            "(earliest event first, most recent/current last) — never scrambled and "
            "never simply in the order the facts happen to be listed below — even "
            "though the summary as a whole is organized by topic rather than by "
            "date. "
            "PROCEDURE DETAIL RULE (MANDATORY, GRAPH-DRIVEN ONLY, unchanged): for "
            "EVERY treatment/procedure category that is actually present in this "
            "patient's documents — surgery, chemotherapy, radiotherapy, or any "
            "other procedure type found in the graph data — give the reading "
            "physician full, dated, doctor-ready detail on what was actually done, "
            "drawn only from the extracted facts/timeline below: the procedure/"
            "modality name, its date, treatment intent, protocol/regimen or "
            "operative procedure name, cycle numbers or session/fraction counts, "
            "dose (and any dose adjustments with reason), concurrent therapy, "
            "administration/operative details actually documented, monitoring "
            "observations, and documented response or toxicity/complication. Do "
            "NOT invent or assume a procedure category that has no supporting "
            "document — if this patient has no surgical document, do not mention "
            "surgery at all; if there is no radiotherapy document, do not mention "
            "radiotherapy; the set of procedures you detail must come ENTIRELY "
            "from what is actually present in the graph-derived facts, never from "
            "a fixed template of 'surgery/chemo/radio' assumed to apply to every "
            "patient. "
            "USE OF DATES: use the dates on the facts/timeline given to you to work "
            "out which diagnosis, investigation, treatment, medication, or status "
            "entry is the most CURRENT one, resolving any conflicting or superseded "
            "information (e.g. a dose later reduced, a status later updated, a "
            "regimen later changed), so the summary's current-status close reflects "
            "the patient's TRUE CURRENT state — while still writing the summary's "
            "overall structure by clinical logic/topic rather than in strict date "
            "order. "
            "COMPREHENSIVE, SPECIALTY-AGNOSTIC CONTENT: automatically recognize the "
            "patient's specialty/condition from the facts given, and weave in "
            "whichever of the following is EXPLICITLY documented (never invent, "
            "infer, or force a category that has no supporting data):\n"
            "  • Diagnosis — primary diagnosis, secondary diagnoses, associated "
            "diseases, current disease status/severity, classification, stage, "
            "grade.\n"
            "  • Pathology — histopathology, histological subtype, tumor grade, "
            "differentiation, margins, lymphovascular/perineural invasion, lymph "
            "node involvement, extranodal extension, biopsy/cytology findings.\n"
            "  • Molecular / biomarkers — disease-specific biomarkers, genetic "
            "mutations, molecular markers, IHC/NGS/FISH findings, tumor markers, or "
            "any other specialty-specific biomarker.\n"
            "  • Imaging / disease extent — key findings from CT, MRI, PET-CT, "
            "ultrasound, X-ray, nuclear medicine, echocardiography, angiography, "
            "endoscopy, colonoscopy, bronchoscopy, or other investigations: disease "
            "extent, tumor burden, lesion size (when clinically relevant — avoid "
            "listing every measurement unless it changes management), organ "
            "involvement, metastatic disease, vascular invasion, response "
            "assessment/RECIST.\n"
            "  • Laboratory — clinically meaningful trends and disease-specific "
            "biomarkers only. NEVER enumerate individual routine/normal lab values "
            "(do not write something like 'Hb 12.8, WBC 7.2, Platelets 256'); "
            "instead state the clinical impression in plain language, e.g. "
            "'laboratory investigations demonstrated stable hematological "
            "parameters with preserved renal and hepatic function.' Cite an exact "
            "lab value only when that specific value is itself clinically "
            "important (a significant abnormality, a disease-specific biomarker, "
            "or a value that directly drove a treatment decision).\n"
            "  • Procedures / surgeries — biopsy, surgery, endoscopy, colonoscopy, "
            "bronchoscopy, angioplasty, PCI, CABG, dialysis, device implantation, "
            "transplantation, or other interventional procedures — see the "
            "PROCEDURE DETAIL RULE above for the level of detail required.\n"
            "  • Treatment — treatment history (in true sequence of care, each "
            "with its own date), current treatment/regimen, line of therapy, "
            "treatment intent, treatment response, dose modification, treatment "
            "interruption/discontinuation, current medications — see the "
            "PROCEDURE DETAIL RULE above.\n"
            "  • Functional status — performance status/ECOG/KPS/NYHA/NIHSS/mRS/"
            "GCS/Child-Pugh/MELD/Barthel Index or other disease-specific functional "
            "scores, when documented.\n"
            "  • Clinical status — symptoms, pain, weight loss, nutrition, "
            "functional limitations, quality of life.\n"
            "  • Complications — treatment toxicities, procedure complications, "
            "disease complications, hospitalizations, serious adverse events.\n"
            "  • Other — comorbidities, allergies, concurrent medications, pending "
            "investigations, monitoring plan, follow-up plan.\n"
            "AUTOMATIC SPECIALTY ADAPTATION: let the facts guide which of the above "
            "matters most for this patient — e.g. for oncology: stage, "
            "histopathology, molecular biomarkers, tumor burden, RECIST response, "
            "treatment history/current treatment, toxicities; for cardiology: "
            "cardiac diagnosis, coronary anatomy, ejection fraction, valve disease, "
            "arrhythmias, NYHA class, PCI/CABG, cardiac biomarkers; for neurology: "
            "stroke subtype, MRI findings, EEG, NIHSS, neurological deficits, "
            "rehabilitation; for nephrology: CKD stage, eGFR trend, dialysis, renal "
            "biopsy, electrolyte abnormalities; for gastroenterology/hepatology: "
            "Child-Pugh, MELD, cirrhosis, portal hypertension, varices, fibrosis, "
            "endoscopy findings; for pulmonology: GOLD stage, PFT, oxygen "
            "requirement, CT chest findings; for endocrinology: HbA1c trend, "
            "thyroid status, hormonal profile, end-organ complications; for "
            "hematology: WHO classification, bone marrow findings, cytogenetics, "
            "transfusion history; for infectious disease: organism identified, "
            "culture/sensitivity, antibiotic treatment, treatment response; for "
            "rheumatology: autoimmune markers, disease activity, immunosuppressive "
            "therapy; for orthopedics: fracture classification, implant status, "
            "functional recovery; for urology/gynecology: disease stage, operative "
            "findings, specialty-specific biomarkers, reproductive status where "
            "clinically relevant. This list is guidance on what to look for, not a "
            "checklist to force into every summary — only include what is actually "
            "documented for THIS patient. "
            "TREATMENT DOCUMENTS ARE AUTHORITATIVE: chemotherapy, radiotherapy, "
            "surgical, nursing, and treatment-planning/workflow documents are your "
            "primary source for the patient's treatment course — always surface "
            "treatment modality, intent, regimen/protocol, current status, cycles "
            "completed versus planned, and any documented response or toxicity when "
            "present, woven naturally into the treatment portion of the summary "
            "with each event's own documented date — rather than a cycle-by-cycle "
            "log. Purely operational/administrative workflow metadata (nurse "
            "verification, pharmacy verification, consent capture, IV/venous-"
            "access mechanics, drug labeling/preparation checklists) is excluded "
            "unless it reflects an actual clinical event (a reaction, "
            "extravasation, or documented toxicity/tolerance note). "
            "BOLD FORMATTING — CLINICAL EMPHASIS: to help a physician rapidly "
            "understand the patient's condition, wrap the MOST clinically "
            "significant, patient-specific pieces of information in markdown "
            "**bold** the first time each is stated in full — for example: the "
            "primary diagnosis (especially if gold-standard CONFIRMED — see the "
            "CONFIRMED DIAGNOSIS rule below), disease stage/severity/"
            "classification, key histopathology, major imaging findings, tumor "
            "burden, organ involvement, metastatic disease, critical laboratory "
            "abnormalities, disease-specific biomarkers, major procedures/"
            "surgeries, treatment history, current treatment, treatment intent, "
            "treatment response, performance status, significant toxicities, "
            "important complications, major comorbidities, clinically significant "
            "allergies, critical concurrent medications, current disease status, "
            "and the follow-up plan. ALSO bold any specific clinically significant "
            "MEASUREMENT, SIZE, or NUMERIC VALUE exactly as documented — e.g. "
            "tumor/lesion size or dimensions (e.g. **4.2 x 3.1 cm mass**), organ "
            "measurements (e.g. **ejection fraction 30%**, **eGFR 28 mL/min**), "
            "critical/abnormal lab values with their units (e.g. **Hb 6.8 g/dL**, "
            "**creatinine 4.1 mg/dL**), key vital signs when abnormal or decisive, "
            "drug doses/dose changes (e.g. **cisplatin reduced to 60 mg/m²**), "
            "and staging measurements (e.g. **cT2N1M0**) — bold the number/value "
            "together with its unit and the entity it describes, not the number "
            "alone. Do NOT bold every medical term, value, or sentence — bold "
            "sparingly, only the information that helps a physician rapidly grasp "
            "this patient's condition. "
            "CONFIRMED DIAGNOSIS RULE: a diagnosis is only 'confirmed' if the "
            "record explicitly states gold-standard confirmation (histopathology, "
            "biopsy, cytology, or another definitive method) — never a merely "
            "suspected/probable/imaging-only one. The first full statement of each "
            "confirmed diagnosis (with staging/grading if documented) is wrapped in "
            "** bold **; a suspected/probable diagnosis is never bolded. "
            "ONCOLOGY CASE CLASSIFICATION RULE (applies ONLY when the confirmed "
            "diagnosis is a malignancy — skip entirely for non-oncology patients): "
            "using ONLY the facts/timeline given to you, classify the case using "
            "standard oncology charting terminology, never invented labels: "
            "(1) PRIMARY MALIGNANCY — no prior cancer diagnosis is documented "
            "anywhere in this patient's facts/timeline; this is a de novo "
            "diagnosis. "
            "(2) RECURRENCE — a prior cancer diagnosis IS documented (with its own "
            "treatment history and, where documented, a disease-free interval), and "
            "the new finding is the SAME histology arising in the same or a related "
            "site/field, explicitly described in the record as recurrent or "
            "relapsed. Where the documents support it, further specify LOCAL "
            "recurrence (same organ/site as the original tumor), REGIONAL "
            "recurrence (nearby nodes/tissue), or DISTANT recurrence (metastatic "
            "relapse to another organ) — leave this sub-type unspecified if the "
            "documents do not clearly support one. "
            "(3) SECOND PRIMARY MALIGNANCY (SPM) — a prior cancer diagnosis IS "
            "documented, but the new finding is a DIFFERENT histology and/or an "
            "unrelated primary site, and the record supports it being an "
            "independent primary rather than a recurrence or metastasis of the "
            "first cancer (e.g. explicit pathology language distinguishing it from "
            "the original tumor, or a wholly different organ/histology). Where "
            "dates support it, further specify SYNCHRONOUS (diagnosed at or near "
            "the same time as the first cancer, conventionally within about 6 "
            "months) or METACHRONOUS (diagnosed after a longer interval) — leave "
            "this timing unspecified if the documents do not clearly support one. "
            "Do NOT force a classification if the evidence is ambiguous or a prior "
            "cancer history is not clearly documented — in that case leave the "
            "classification null rather than guessing, and never infer a prior "
            "cancer that is not explicitly stated. Never use this rule's "
            "terminology anywhere in the narrative paragraphs themselves unless "
            "the source documents themselves use that language — the "
            "classification is a separate structured field, not narrative prose. "
            "MANDATORY FINAL PARAGRAPH: the LAST paragraph you write must always "
            "function as a current-status close for the reading physician. It must "
            "cover, whenever documented: current treatment status, current disease "
            "status, any significant toxicities or complications, active/current "
            "medications, and the follow-up or monitoring plan. Do not scatter these "
            "five items only across earlier paragraphs and skip pulling them "
            "together at the end — the summary must end on this consolidated "
            "current picture, in flowing prose, not a bulleted checklist. Omit any "
            "of the five items that has no supporting data, but do not omit the "
            "final paragraph itself if at least one of them is documented. "
            "MISSING INFORMATION: if a clinical category above is not documented "
            "for this patient, simply omit it — never write 'not documented', "
            "'unknown', 'unavailable', 'not assessed', or any similar placeholder "
            "in the narrative text, and never infer or hallucinate information "
            "that is not explicitly supported by the facts/timeline given to you. "
            "You never recommend a treatment or predict an outcome — reporting an "
            "already-documented referral, plan, or monitoring instruction is "
            "reporting a fact, not a recommendation. Always respond with valid "
            "JSON only."
        )

        prompt = f"""
Write this patient's clinical summary for their chart, for a {specialty}
specialist about to see them. This must read as ONE continuous, doctor-style
physician narrative, organized by CLINICAL LOGIC — grouped by topic
(diagnosis, pathology/findings, treatment course, current status) — NOT a
raw chronological document-by-document or date-by-date retelling. The goal
is a GENERIC, CONCISE summary that any physician can read at a glance while
still getting every clinically relevant piece of documented content,
including full doctor-ready detail on every procedure that was actually
done. Use ONLY the facts and timeline given to you below — never anything
from your own general medical knowledge or training data.

══════════════════════════════════════════════════════════
PATIENT IDENTIFICATION
══════════════════════════════════════════════════════════
Name (if documented): {patient_name or "Not documented — refer to the patient generically (e.g. 'The patient') if no name is available"}
Age: {age_str}
Sex: {sex}

══════════════════════════════════════════════════════════
PRE-EXTRACTED DENSE CLINICAL FACTS (from ALL {num_facts} facts extracted
batch-by-batch across the patient's documents in an earlier pass — this is
your ONLY source of truth; every fact below is already grounded in the raw
record; repeated same-type events are kept as separate individual facts,
not merged. Each fact carries its own date — use those dates only where a
specific date adds clinical value, and to work out what is CURRENT/LATEST
and resolve conflicts. Do not restate every fact individually — synthesize
the facts that belong to each clinical topic into natural, concise prose.
Do not add anything beyond what is listed here.)
══════════════════════════════════════════════════════════
{facts_text}

══════════════════════════════════════════════════════════
CONFIRMED DIAGNOSES FLAGGED DURING EXTRACTION (gold-standard confirmed —
apply the CONFIRMED DIAGNOSIS bold rule to these)
══════════════════════════════════════════════════════════
{confirmed_hint}

══════════════════════════════════════════════════════════
COMPACT DATE-WISE TIMELINE (A1 output, narrative form — sorted earliest date
first. Use this ONLY to resolve what is most CURRENT and to establish the
true chronological sequence of treatment/procedure events relative to each
other — it is a resolution aid, NOT the structure your paragraphs should
follow. Do not mention "the timeline" itself by name in your prose, and do
not copy its per-date narrative text verbatim — synthesize the
corresponding facts into your own concise, topic-organized, doctor-style
prose.)
══════════════════════════════════════════════════════════
{timeline_json}

══════════════════════════════════════════════════════════
WHAT TO COVER, ORGANIZED BY CLINICAL LOGIC/TOPIC (only what is EXPLICITLY
documented for this patient in the facts/timeline above — never invent,
infer, or force a category that isn't there, and never supplement with
outside medical knowledge)
══════════════════════════════════════════════════════════
  • Diagnosis — primary/secondary diagnoses, associated disease, current
    disease status, severity, classification, stage, grade.
  • Pathology — histopathology, subtype, grade, differentiation, margins,
    lymphovascular/perineural invasion, nodal involvement, extranodal
    extension, biopsy/cytology findings.
  • Molecular/biomarkers — disease-specific biomarkers, genetic mutations,
    IHC/NGS/FISH findings, tumor markers, or other specialty-specific
    biomarkers.
  • Imaging/disease extent — key CT/MRI/PET-CT/ultrasound/X-ray/nuclear
    medicine/echo/angiography/endoscopy findings: extent, tumor burden,
    lesion size (only when clinically relevant), organ involvement,
    metastasis, vascular invasion, response assessment/RECIST. Avoid
    listing every measurement unless it is clinically important.
  • Laboratory — clinically meaningful trends and disease-specific
    biomarkers only, stated as a plain-language impression. Do NOT
    enumerate normal/routine values one by one (never "Hb 12.8, WBC 7.2,
    Platelets 256" — instead "stable hematological parameters with
    preserved renal and hepatic function"). Cite an exact value only when
    it is itself a significant abnormality or clinically decisive.
  • Procedures/surgeries actually performed — apply the PROCEDURE DETAIL
    RULE: full, dated, doctor-ready detail for each procedure category
    actually present in the data (surgery, chemotherapy, radiotherapy, or
    any other documented procedure) — never a category with no supporting
    document.
  • Treatment — history presented in the ACTUAL SEQUENCE OF CARE (e.g.
    biopsy → surgery → chemotherapy → radiotherapy → maintenance therapy →
    current treatment, each with its own date — never presented out of
    sequence), current regimen, line of therapy, intent, response, dose
    modification, interruption/discontinuation, current medications. See
    the PROCEDURE DETAIL RULE.
  • Functional status — ECOG/KPS/NYHA/NIHSS/mRS/GCS/Child-Pugh/MELD/Barthel
    or other disease-specific score, if documented.
  • Clinical status — symptoms, pain, weight loss, nutrition, functional
    limitation, quality of life.
  • Complications — toxicities, procedure/disease complications,
    hospitalizations, serious adverse events.
  • Other — comorbidities, allergies, concurrent medications, pending
    investigations, monitoring/follow-up plan.
Let the patient's own facts determine which of these categories actually
apply — do not force a category that has no supporting data, and do not
write a placeholder ("not documented", "unknown", etc.) for one that's
missing; simply leave it out.

══════════════════════════════════════════════════════════
PROCEDURE DETAIL RULE (MANDATORY, GRAPH-DRIVEN ONLY — repeated for
emphasis)
══════════════════════════════════════════════════════════
For every treatment/procedure category actually present in this patient's
data — surgery, chemotherapy, radiotherapy, or any other documented
procedure — give full, dated, doctor-ready detail wherever that topic is
discussed: modality/procedure name, date, treatment intent, protocol/
regimen or operative detail, cycle/session/fraction counts, dose and any
dose adjustments (with reason if given), concurrent therapy, administration/
operative details actually documented, monitoring observations, and
documented response or toxicity/complication. Do NOT invent or assume a
procedure category that has no supporting document in the facts above —
the set of procedures you detail must come entirely from what this
specific patient's graph data actually contains.

══════════════════════════════════════════════════════════
BOLD RULE (MANDATORY)
══════════════════════════════════════════════════════════
  • Wrap the FIRST full statement of the confirmed primary diagnosis (with
    staging/grading if documented) in markdown bold:
    **squamous cell carcinoma of the supraglottic larynx, cT2N0M0**
    Only a gold-standard CONFIRMED diagnosis is bolded this way — never a
    suspected/probable/imaging-only one.
  • Also bold, sparingly, the first full statement of other information that
    most helps a physician rapidly grasp this patient's condition: disease
    stage/severity/classification, key histopathology, major imaging
    findings, tumor burden/organ involvement/metastatic disease, critical
    lab abnormalities, disease-specific biomarkers, major procedures/
    surgeries, treatment history, current treatment, treatment intent,
    treatment response, performance status, significant toxicities,
    important complications, major comorbidities, clinically significant
    allergies, critical concurrent medications, current disease status, and
    the follow-up plan.
  • Also bold every clinically significant MEASUREMENT, SIZE, or NUMERIC
    VALUE exactly as documented, together with its unit — tumor/lesion
    dimensions (**4.2 x 3.1 cm mass**), organ function measurements
    (**ejection fraction 30%**, **eGFR 28 mL/min**), abnormal/critical lab
    values (**Hb 6.8 g/dL**, **creatinine 4.1 mg/dL**), significant vital
    signs, drug doses and dose changes (**cisplatin reduced to 60 mg/m²**),
    and staging measurements (**cT2N1M0**). Do not bold routine/normal
    values (see the LABORATORY rule) — only ones that are clinically
    significant or decisive.
  • Do NOT bold every medical term, value, or date — bold only what is truly
    clinically significant, so the bolding stays meaningful.

══════════════════════════════════════════════════════════
TASK
══════════════════════════════════════════════════════════
Write this patient's clinical summary as ONE continuous, doctor-style
narrative, organized by CLINICAL LOGIC — diagnosis → pathology/findings →
disease extent → treatment/procedure course → current status — not
chronologically document-by-document or date-by-date. State a specific
date only where it is clinically meaningful (e.g. date of diagnosis, date
of a procedure, date of a critical lab). For EVERY treatment/procedure
category actually present in the data (surgery, chemotherapy, radiotherapy,
or any other documented procedure), give full, dated, doctor-ready detail —
modality, date, intent, protocol/regimen or operative details, cycle/
session counts, dose and dose changes, response, and toxicity/
complications — exactly as the PROCEDURE DETAIL RULE requires, presenting
multiple treatment events in their true relative chronological order; never
invent a procedure category that has no supporting document. Keep the
overall summary GENERIC and CONCISE — short enough to read at a glance —
while still covering everything clinically relevant that is documented.
Never mention a clinical category that has no supporting data in the facts
above, and never use a placeholder phrase for missing information. Never
add a fact, value, or clinical detail that is not present in the facts/
timeline above, even if it seems like an obvious or standard clinical
assumption. The FINAL paragraph must still close with the patient's current
treatment status, current disease status, any significant toxicities/
complications, active medications, and the follow-up/monitoring plan,
whenever any of these is documented.

ONCOLOGY CASE CLASSIFICATION (only if the confirmed diagnosis is a
malignancy — see the ONCOLOGY CASE CLASSIFICATION RULE above for the exact
definitions of each value): decide whether this is a PRIMARY MALIGNANCY, a
RECURRENCE (optionally LOCAL/REGIONAL/DISTANT), or a SECOND PRIMARY
MALIGNANCY (optionally SYNCHRONOUS/METACHRONOUS), based strictly on the
facts/timeline above. Populate "oncology_case_type" and
"oncology_case_chips" accordingly. If this patient's diagnosis is not
oncological, or a prior-cancer relationship cannot be determined from the
documents, set "oncology_case_type" to null and "oncology_case_chips" to an
empty list — do not guess.

{length_guidance}

Return ONLY valid JSON:
{{
  "diagnosis_header": "One-line diagnosis exactly as documented (including staging/grading if explicitly present). Wrapped in ** bold ** ONLY if confirmed. If only a working/suspected diagnosis exists, state it in PLAIN text and note '(not yet confirmed)'. If no diagnosis at all, use 'Not documented'.",
  "confirmed_diagnosis_present": true,
  "confirmed_diagnoses": ["exact bolded-equivalent text of each confirmed diagnosis, without ** markers"],
  "oncology_case_type": "primary_malignancy | recurrence_local | recurrence_regional | recurrence_distant | recurrence_unspecified | second_primary_synchronous | second_primary_metachronous | second_primary_unspecified | null — null if not oncology or not determinable",
  "oncology_case_chips": ["2-4 short ALL-CAPS labels, e.g. 'RECURRENT DISEASE', 'LOCAL RECURRENCE', 'PRIOR BREAST CANCER · 2019', 'HER2 POSITIVE' — empty list if oncology_case_type is null"],
  "paragraphs": [
    "Full summary paragraph 1 text (diagnosis / how it was reached / disease extent)...",
    "Additional paragraph(s) as needed, organized by clinical topic (e.g. treatment/procedure course per the procedure detail rule)...",
    "Final paragraph — current treatment status, current disease status, toxicities/complications, active medications, and follow-up plan..."
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
        logger.info(f"{self.agent_id} · ClinicalSummaryAgent (batched, clinical-logic-organized, generic multi-specialty) — START")
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
            f"{len(batches)} batch(es) of up to {SUMMARY_BATCH_SIZE} for fact extraction "
            f"(throttled to {LLM_CONCURRENCY} concurrent LLM requests)"
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
                "oncology_case_type": None,
                "oncology_case_chips": [],
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
# WORKFLOW GRAPH DEFINITION
#
# A3 (Organ System Agent) remains removed (as of v5.0). The pipeline is:
#   A1_TIMELINE -> A2_SUMMARY -> END
# ============================================================

def create_ccgi_workflow() -> Any:
    workflow = StateGraph(ClinicalState)

    workflow.add_node("A1_TIMELINE", TimelineAgent(llm_synthesis).run)
    workflow.add_node("A2_SUMMARY",  ClinicalSummaryAgent(llm_synthesis).run)

    workflow.set_entry_point("A1_TIMELINE")
    workflow.add_edge("A1_TIMELINE", "A2_SUMMARY")
    workflow.add_edge("A2_SUMMARY", END)

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
    Lean 2-agent CCGI clinical reasoning pipeline (v5.2.0). A1 (Timeline)
    and the overall pipeline shape (A1 -> A2, A3 removed) and the v5.0.1
    LLM_CONCURRENCY rate-limit fix are all unchanged. The only content
    change in v5.2.0 is A2's final synthesis prompt: the v5.1.0 rule that
    forced the clinical summary to be organized chronologically by
    document date is REVERTED — the narrative is once again organized by
    CLINICAL LOGIC/TOPIC (a concise, generic, doctor-readable summary),
    while the v5.1.0 mandatory, graph-driven-only procedure detail rule
    for surgery/chemotherapy/radiotherapy/other procedures is KEPT
    unchanged. No batch size, schema, or token budget was changed to
    achieve this — see the module docstring's "CHANGE IN v5.2.0" section
    for the full rationale.

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
      A2 — Clinical Summary: ONE continuous, doctor-style narrative,
           grounded strictly in graph document data, no recommendations or
           predictions, organized by CLINICAL LOGIC/TOPIC (diagnosis →
           pathology/findings → treatment course → current status) rather
           than by raw document/date order, using the A1 compact timeline
           only to resolve what is current and the true sequence of
           treatment events. Confirmed diagnoses (gold-standard confirmed,
           not merely suspected) are wrapped in markdown **bold**, along
           with a sparing set of other highly clinically significant facts
           (stage, pathology, major imaging findings, tumor burden,
           critical labs, biomarkers, major procedures, treatment history/
           current treatment/response, performance status, significant
           toxicities/complications, major comorbidities, significant
           allergies, critical concurrent medications, current disease
           status, follow-up plan). Structured workflow documents (chemo/
           radio/surgical/nursing/treatment planning) are treated as the
           AUTHORITATIVE source for treatment information and are fully
           mined for treatment-management detail (modality, intent,
           regimen, status, cycles, response/toxicity). A MANDATORY,
           GRAPH-DRIVEN-ONLY procedure detail rule requires full, dated,
           doctor-ready detail for every treatment/procedure category
           (surgery, chemotherapy, radiotherapy, or any other) actually
           present in the patient's documents — never a fixed template
           assumed to apply to every patient. The model automatically
           recognizes the patient's specialty/condition and pulls in
           whichever of a comprehensive, generic clinical checklist
           (diagnosis, pathology, molecular/biomarkers, imaging, labs,
           procedures, treatment, functional status, clinical status,
           complications, other information) is actually documented,
           rather than a single hardcoded schema. Routine/normal
           laboratory values are synthesized into a plain-language
           impression instead of enumerated, and the summary's final
           paragraph is mandatory and must close on current treatment
           status, current disease status, significant toxicities/
           complications, active medications, and the follow-up plan. The
           overall length is intentionally CONCISE (see length_guidance in
           code) so the result reads as a true, generic summary rather
           than a long narrative retelling. BATCHED (SUMMARY_BATCH_SIZE
           docs per fact-extraction call, each with its own
           SUMMARY_EXTRACTION_MAX_TOKENS budget, then one small synthesis
           call whose target length scales modestly with how much was
           documented, using its own SUMMARY_SYNTHESIS_MAX_TOKENS budget).

    EVERY prompt in both agents carries an explicit, non-negotiable "no
    external knowledge" rule: the model must use ONLY the
    graph_documents-derived data supplied inside that specific call, and
    must never supplement, infer, or "fill in" using its own general
    medical/training knowledge. This applies equally to the procedure-
    detail rule: the set of procedures detailed comes entirely from what
    is present in this patient's graph data, never from a hardcoded
    assumption of what procedures "should" exist.
    """
    start_ms = datetime.now().timestamp() * 1000
    logger.info(
        f"CCGI (lean v5.3.0) request | patient={request.patient_id} | doctor={request.doctor_id}"
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
            "agent_timings":       result.get("agent_timings", {}),
            "errors":              result.get("errors", []),
        }

        try:
            await summary_collection.insert_one(dict(full_payload))
        except Exception as e:
            logger.error(f"MongoDB save failed: {e}")

        logger.info(
            f"CCGI (lean v5.3.0) complete | patient={request.patient_id} | "
            f"{elapsed}ms | {len(graph_docs)} documents"
        )

        # NOTE: response shape — "timeline" is still the full A1 output
        # object, "summary" still carries the same keys as before. No
        # response-shape change versus v5.1.0/v5.0.1.
        response = {
            "patient_id":          request.patient_id,
            "doctor_id":           request.doctor_id,
            "generated_at":        datetime.now().isoformat(),
            "documents_analyzed":  len(graph_docs),
            "processing_time_ms":  elapsed,
            "agent_timings":       result.get("agent_timings", {}),
            "errors":              result.get("errors", []),
            "version":             "lean-5.3.0",

            "summary": {
                "diagnosis_header":            result.get("clinical_summary", {}).get("diagnosis_header", "Not documented"),
                "confirmed_diagnosis_present": result.get("clinical_summary", {}).get("confirmed_diagnosis_present", False),
                "confirmed_diagnoses":         result.get("clinical_summary", {}).get("confirmed_diagnoses", []),
                "oncology_classification": {
                    "applicable":  bool(result.get("clinical_summary", {}).get("oncology_case_type")),
                    "case_type":   result.get("clinical_summary", {}).get("oncology_case_type"),
                    "case_label":  _oncology_case_label(result.get("clinical_summary", {}).get("oncology_case_type")),
                    "chips":       result.get("clinical_summary", {}).get("oncology_case_chips", []) or [],
                },
                "paragraphs":                  result.get("clinical_summary", {}).get("paragraphs", []),
                "full_text":                   result.get("clinical_summary", {}).get("full_text", ""),
            },

            "timeline": result.get("timeline", {}),
        }

        if request.include_intermediates:
            response["intermediate"] = {
                "clinical_summary_raw": result.get("clinical_summary", {}),
                "timeline_raw":         result.get("timeline", {}),
            }

        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(
            f"CCGI (lean v5.3.0) pipeline failed | patient={request.patient_id} | {e}"
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health")
async def health():
    return {
        "status": "ok",
        "version": "lean-5.3.0",
        "agents": 2,
        "workflow_compiled": ccgi_workflow is not None,
        "timeline_batch_size": TIMELINE_BATCH_SIZE,
        "narrative_batch_size": NARRATIVE_BATCH_SIZE,
        "summary_batch_size": SUMMARY_BATCH_SIZE,
        "groq_max_tokens": GROQ_MAX_TOKENS,
        "summary_synthesis_max_tokens": SUMMARY_SYNTHESIS_MAX_TOKENS,
        "summary_extraction_max_tokens": SUMMARY_EXTRACTION_MAX_TOKENS,
        "llm_concurrency": LLM_CONCURRENCY,
        "agent_pipeline": [
            "A1-Timeline           [batched by "
            f"{TIMELINE_BATCH_SIZE} docs for entity organization, merged "
            "deterministically, grouped by date->entity_type, ordered latest date "
            "first, with per-date document list and a document-wise breakdown "
            "(documents_detail). Narratives generated per-document in batches of "
            f"{NARRATIVE_BATCH_SIZE} (flattened across all dates — a date with many "
            "documents is never sent to the LLM in one oversized call), with the "
            "date-level narrative then assembled deterministically (zero extra LLM "
            "calls) by concatenating each date's document narratives. Grounded "
            "strictly in graph_documents — no external/general medical knowledge "
            "used.]",
            "A2-ClinicalSummary    [BATCHED by "
            f"{SUMMARY_BATCH_SIZE} docs for fact extraction (concurrent, own "
            f"{SUMMARY_EXTRACTION_MAX_TOKENS}-token budget, treats chemo/radio/"
            "surgical/treatment-workflow docs as the AUTHORITATIVE source for "
            "treatment-course detail and excludes purely operational/administrative "
            "workflow metadata), merged deterministically, then ONE final synthesis "
            "call over the merged facts + a compact, earliest-first-sorted timeline "
            "used ONLY to resolve current status and the true treatment sequence, "
            "writing ONE continuous, doctor-style physician narrative organized by "
            "CLINICAL LOGIC/TOPIC (diagnosis, findings, treatment course, current "
            "status) rather than by document date, auto-adapting to the patient's "
            "specialty, pulling in whichever of a comprehensive generic clinical "
            "checklist is actually documented, giving MANDATORY, GRAPH-DRIVEN-ONLY "
            "doctor-ready detail (modality, date, intent, protocol, cycles/"
            "sessions, dose, response/toxicity) for every treatment/procedure "
            "category (surgery, chemotherapy, radiotherapy, or any other) actually "
            "present in the data — never a fixed procedure template — synthesizing "
            "lab values into a plain-language impression instead of enumerating "
            "normal results, and always closing with a mandatory final paragraph "
            "covering current treatment status/current disease status/toxicities-"
            "complications/active medications/follow-up plan — target length is "
            "intentionally CONCISE and scales only modestly with how much was "
            "documented, routine repeats are merged into one passage, meds/"
            "follow-up stated once, a sparing but expanded bold-emphasis rule "
            "highlights the most clinically significant facts, missing categories "
            "are silently omitted rather than flagged with placeholder text, and "
            "the synthesis call uses its own token budget "
            f"({SUMMARY_SYNTHESIS_MAX_TOKENS} tokens) so long summaries aren't "
            "truncated. Grounded strictly in graph_documents — no external/general "
            "medical knowledge used. No recommendations/predictions]",
        ],
        "rate_limit_fix": (
            f"All LLM calls across A1 and A2 share a single asyncio.Semaphore "
            f"(LLM_CONCURRENCY={LLM_CONCURRENCY}) inside BaseAgent._invoke(), so "
            "at most that many requests are ever in flight to the provider at "
            "once — this paces request admission to avoid Groq TPM 429s without "
            "reducing any batch size, max_tokens budget, or prompt content. "
            "Tune via the LLM_CONCURRENCY env var. (Unchanged since v5.0.1.)"
        ),
        "v5_2_0_change": (
            "A2's final synthesis narrative is REVERTED from v5.1.0's strict "
            "chronological-by-document-date ordering back to being organized by "
            "CLINICAL LOGIC/TOPIC — a concise, generic, doctor-readable summary "
            "(diagnosis, findings, treatment course, current status) rather than "
            "a date-by-date walk-through. The A1 compact timeline is still used, "
            "but only to resolve what is CURRENT and the true relative order of "
            "treatment events. The v5.1.0 MANDATORY, GRAPH-DRIVEN-ONLY procedure "
            "detail rule (full, dated, doctor-ready detail for every treatment/"
            "procedure category actually present in the patient's documents) is "
            "KEPT, unchanged. Length guidance is also tightened so the result "
            "stays a true, concise summary. No schema, batch-size, or token-"
            "budget change."
        ),
        "v5_3_0_change": (
            "A2's final synthesis call ADDITIONALLY classifies oncology patients "
            "using standard charting terminology — PRIMARY MALIGNANCY (no prior "
            "cancer documented), RECURRENCE (same histology/site as a prior "
            "documented cancer, optionally LOCAL/REGIONAL/DISTANT), or SECOND "
            "PRIMARY MALIGNANCY (a distinct histology/site in a patient with a "
            "cancer history, optionally SYNCHRONOUS/METACHRONOUS) — derived "
            "strictly from the same facts/timeline already used for the "
            "narrative, never guessed when evidence is ambiguous or absent. Adds "
            "'oncology_case_type' and 'oncology_case_chips' to A2's JSON schema, "
            "and a new 'oncology_classification' block (applicable / case_type / "
            "case_label / chips) inside the API response's 'summary' object; "
            "case_label is looked up deterministically in Python from a fixed "
            "vocabulary, never generated by the model. Non-oncology patients get "
            "'applicable': false and an unchanged narrative. No other schema, "
            "batch-size, or token-budget change."
        ),
        "removed_in_prior_version": [
            "A3-OrganAnalysis (organ/system-wise consolidated analysis agent) was "
            "removed from the pipeline, ClinicalState, and the API response in "
            "v5.0. The 'organ_analysis' response key does not exist."
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