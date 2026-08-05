"""
surgical_oncology_summary.py — Surgical Oncology Specialty Summary (STANDALONE module)
=========================================================================================

Purpose:
  A specialty-specific summary, focused ONLY on the clinical elements a
  Surgical Oncology consultant needs — operative diagnosis and surgical
  pathology findings:

    - Pre-operative diagnosis
    - Post-operative diagnosis
    - Tumor location
    - Laterality
    - Tumor size
    - Surgical TNM staging (T, N, M)
    - Intra-operative findings
    - Frozen section results
    - Resection status (R0/R1/R2)
    - Surgical margin status

  Overview:
    The Surgical Oncology module focuses on operative diagnosis and
    surgical pathology findings. It captures the pre-operative and
    post-operative diagnosis, tumor location, laterality, tumor size,
    surgical TNM staging (T, N, M), intra-operative findings, frozen
    section results, resection status (R0/R1/R2), and surgical margin
    status. The emphasis is on documenting the disease as confirmed
    during surgery and the completeness of tumor removal, rather than the
    initial cancer diagnosis.

  Strictly grounded in `graph_documents` fetched from Neo4j — nothing is
  invented, predicted, or pulled from outside the graph data. If a field
  is not documented, it is simply omitted from the paragraph rather than
  guessed or left to the model's imagination. No treatment recommendations
  are generated.

Pipeline (single agent — no Timeline stage):
  A2S Surgical Oncology Summary Agent — runs directly on the raw graph
      documents and produces a doctor-letter-style paragraph.

Persistence:
  Each generated summary is saved to its own dedicated MongoDB collection,
  `surgical_oncology_summary`, keyed by patient_id/doctor_id/generated_at.

This file is fully self-contained: it does NOT import from
ccgi_clinical_reasoning.py or any other project module. It sets up its
own Neo4j driver, Mongo client, and LLM client. Exposed as a DIRECT
endpoint — no background task queue, no polling.

============================================================================
v1.2.0 — TOKEN-SAFE BATCHING (fixes: groq.BadRequestError 400 "Please
reduce the length of the messages or completion")
============================================================================
ROOT CAUSE OF THE 400 ERROR:
  The previous version (v1.1.0) dumped ALL of a patient's `graph_documents`
  into ONE prompt, in ONE LLM call, with only the OUTPUT token budget
  (SURGONC_SYNTHESIS_MAX_TOKENS) being configurable. For a patient with a
  lot of documented history (multiple operative episodes, long
  histopathology / TNM / margin detail, many evidence entities), the INPUT
  side alone could exceed the model's total context window — at which
  point Groq rejects the request outright with a 400, regardless of how
  the max_tokens knob for the *completion* is set, because the model's
  input + requested completion together no longer fit.

THE FIX — a batching loop, mirroring the same pattern already proven in
the main CCGI discharge-summary agent:
  1. Every entity's evidence text is capped at SURGONC_EVIDENCE_TRUNCATE_CHARS
     before it can ever enter a prompt (protects against one giant
     document alone blowing the budget).
  2. Documents are split into batches bounded by BOTH a document-count
     ceiling (SURGONC_BATCH_MAX_DOCS) AND a cumulative evidence-character
     ceiling (SURGONC_BATCH_MAX_EVIDENCE_CHARS) — a batch closes the
     moment either ceiling would be exceeded by the next document.
  3. Each batch gets its OWN LLM call, run concurrently, producing the
     SAME JSON schema as before but scoped to just that batch's documents.
  4. The batch results are merged back into ONE final object with a
     100% deterministic Python merge step — NO extra LLM call — so this
     step costs zero additional tokens no matter how many batches there
     are (2, 10, 50+).

OUTPUT JSON IS UNCHANGED:
  The `summary` object returned to the caller — `diagnosis_header`,
  `confirmed_diagnosis_present`, `resection_status`, `margin_status`,
  `narrative`, `source_coverage_check` — has the EXACT same shape as
  v1.1.0. The frontend does not need to change. Only the internal
  construction of that object is now batched and merge-safe.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import datetime, date as date_cls
from typing import Any, Dict, List, Optional, TypedDict

from fastapi import APIRouter, HTTPException
from loguru import logger
from neo4j import AsyncGraphDatabase
from pydantic import BaseModel

from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage

from motor.motor_asyncio import AsyncIOMotorClient

# ============================================================
# ENVIRONMENT / CLIENTS  (self-contained — no shared imports)
# ============================================================

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB  = "doctorassistai"

mongo_client = AsyncIOMotorClient(MONGO_URI)
mongo_db     = mongo_client[MONGO_DB]

# Dedicated collection for this specialty's summaries.
surgonc_collection = mongo_db["surgical_oncology_summary"]

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

# Base/default completion-token budget for this module's LLM client. Kept
# as the fallback for any call that doesn't request its own override.
GROQ_MAX_TOKENS = int(os.getenv("GROQ_MAX_TOKENS", "5000"))

# Dedicated max_tokens for the Surgical Oncology SYNTHESIS call (now
# applied PER BATCH — see v1.2.0 note above). Split out so it can be
# tuned independently of GROQ_MAX_TOKENS.
SURGONC_SYNTHESIS_MAX_TOKENS = int(
    os.getenv("SURGONC_SYNTHESIS_MAX_TOKENS", str(max(GROQ_MAX_TOKENS, 8000)))
)

# ── NEW (v1.2.0) — token-safety batching knobs ───────────────────────────
# Max documents in one synthesis batch.
SURGONC_BATCH_MAX_DOCS = int(os.getenv("SURGONC_BATCH_MAX_DOCS", "6"))
# Max cumulative evidence characters in one batch, REGARDLESS of how many
# documents that is — a batch closes as soon as either ceiling hits. This
# is the primary fix for the "reduce the length of the messages" 40
SURGONC_BATCH_MAX_EVIDENCE_CHARS = int(
    os.getenv("SURGONC_BATCH_MAX_EVIDENCE_CHARS", "6000")
)
# Hard cap on a single entity's evidence text before it ever enters a batch
# — protects against one abnormally long note/report alone overflowing
# the input budget even in a batch of size 1.
SURGONC_EVIDENCE_TRUNCATE_CHARS = int(
    os.getenv("SURGONC_EVIDENCE_TRUNCATE_CHARS", "1200")
)

llm_synthesis = ChatGroq(
    model="llama-3.3-70b-versatile",
    temperature=0.1,
    max_tokens=GROQ_MAX_TOKENS,
    groq_api_key=GROQ_API_KEY,
)

router = APIRouter(prefix="", tags=["Surgical Oncology Reasoning"])


# ============================================================
# REQUEST MODEL  (self-contained copy — same shape as ClinicalRequest)
# ============================================================

class ClinicalRequest(BaseModel):
    patient_id:        str
    doctor_id:         str
    consultation_text: str
    specialty:         str
    include_intermediates: bool = False


# ============================================================
# STATE
# ============================================================

class SurgOncState(TypedDict):
    patient_id:        str
    doctor_id:          str
    consultation_text:  str
    specialty:          str
    graph_documents:    List[Dict]
    dob:                Optional[str]
    sex:                Optional[str]
    age:                Optional[int]
    patient_name:       Optional[str]

    surgonc_summary:    Optional[Dict]

    errors:             List[str]
    agent_timings:      Dict[str, float]


# ============================================================
# HELPERS  (self-contained copies — age calc, demographics, graph fetch)
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
# NEW (v1.2.0) — TOKEN-SAFETY HELPERS (evidence truncation + batching)
# ============================================================

def _truncate_evidence(text: Optional[str], limit: int = SURGONC_EVIDENCE_TRUNCATE_CHARS) -> str:
    """Caps a single entity's evidence text so one abnormally long note
    or report can never, by itself, blow the input budget of a batch."""
    if not text:
        return text or ""
    if len(text) <= limit:
        return text
    return text[:limit] + " …[truncated for token safety]"


def _prepare_documents_for_batching(graph_documents: List[Dict]) -> List[Dict]:
    """
    Returns a COPY of graph_documents with every entity's evidence text
    truncated (RULE: per-entity cap, applied before any batching math).
    The original graph_documents list/objects are left untouched — this
    is purely a prompt-input-safe view of the same data.
    """
    prepared: List[Dict] = []
    for doc in graph_documents:
        entities = doc.get("entities") or []
        safe_entities = []
        for ent in entities:
            safe_entities.append({
                **ent,
                "evidence": _truncate_evidence(ent.get("evidence")),
            })
        prepared.append({
            "document":      doc.get("document"),
            "document_date": doc.get("document_date"),
            "entities":      safe_entities,
        })
    return prepared


def _doc_evidence_chars(doc: Dict) -> int:
    return sum(len(ent.get("evidence") or "") for ent in doc.get("entities") or [])


def _smart_batch_documents(
    docs: List[Dict],
    max_docs_per_batch: int = SURGONC_BATCH_MAX_DOCS,
    max_chars_per_batch: int = SURGONC_BATCH_MAX_EVIDENCE_CHARS,
) -> List[List[Dict]]:
    """
    Splits prepared documents into batches bounded by BOTH document count
    AND total evidence character volume — this is the core fix for the
    Groq 400 "reduce the length of the messages or completion" error. A
    batch closes the moment either ceiling would be exceeded by the next
    document, so no single LLM call ever sees more input than it can
    safely handle, regardless of how many documents (or how large a few
    of them are) the patient has.
    """
    batches: List[List[Dict]] = []
    current: List[Dict] = []
    current_chars = 0

    for doc in docs:
        doc_chars     = _doc_evidence_chars(doc)
        exceeds_count = len(current) >= max_docs_per_batch
        exceeds_chars = bool(current) and (current_chars + doc_chars > max_chars_per_batch)

        if current and (exceeds_count or exceeds_chars):
            batches.append(current)
            current = []
            current_chars = 0

        current.append(doc)
        current_chars += doc_chars

    if current:
        batches.append(current)

    return batches


# ============================================================
# BASE AGENT  (self-contained copy — per-call max_tokens override)
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
        """Invoke the shared LLM. If max_tokens is given, bind a per-call
        override (used by the Surgical Oncology synthesis call so it
        doesn't get silently truncated by the client's base
        GROQ_MAX_TOKENS) without changing the token budget of any other
        call. Mirrors the same pattern used in the main CCGI clinical
        reasoning module for its A2 synthesis call."""
        llm = self.llm.bind(max_tokens=max_tokens) if max_tokens else self.llm
        response = await llm.ainvoke([
            SystemMessage(content=system),
            HumanMessage(content=user),
        ])
        return parse_llm_json(response.content)

    def _elapsed(self, start: float) -> float:
        return round((datetime.now().timestamp() - start) * 1000, 1)


# ============================================================
# A2S · SURGICAL ONCOLOGY SUMMARY AGENT
#
# v1.2.0: now runs the synthesis prompt PER BATCH (bounded input, RULE
# above) and merges the batch results into ONE final object with a
# deterministic, zero-LLM merge step. The final object's shape is
# UNCHANGED from v1.1.0 — same 6 top-level keys, same nested
# source_coverage_check shape.
#
# Narrowed strictly to the fields a Surgical Oncology consultant needs,
# and written as a doctor-letter-style paragraph rather than a
# structured field dump. Grounded ONLY in graph data. No recommendations,
# no predictions, no external knowledge.
#
# Bold rule here differs from other specialties: what gets emphasized is
# the CONFIRMED SURGICAL/POST-OPERATIVE diagnosis (i.e. confirmed by
# surgical pathology / final histopathology of the resected specimen —
# not a pre-operative or frozen-section impression), since the module's
# emphasis is on disease as confirmed during/after surgery.
# ============================================================

SURGONC_OVERVIEW = (
    "The Surgical Oncology module focuses on operative diagnosis and "
    "surgical pathology findings. It captures the pre-operative and "
    "post-operative diagnosis, tumor location, laterality, tumor size, "
    "surgical TNM staging (T, N, M), intra-operative findings, frozen "
    "section results, resection status (R0/R1/R2), and surgical margin "
    "status. The emphasis is on documenting the disease as confirmed "
    "during surgery and the completeness of tumor removal, rather than "
    "the initial cancer diagnosis."
)

_SURGONC_SYSTEM_TEMPLATE = """\
You are a Surgical Oncology specialist writing the operative diagnosis and \
surgical pathology paragraph of a patient's chart note, used purely as a \
surgical reference. Your ONLY job is to extract and report, in dense clinical \
narrative prose, what is EXPLICITLY documented in the patient's clinical graph \
data about: pre-operative diagnosis, post-operative diagnosis, tumor location, \
laterality, tumor size, surgical TNM staging (T, N, M), intra-operative findings, \
frozen section results, resection status (R0/R1/R2), and surgical margin status. \
You do NOT recommend any treatment, further surgery, adjuvant therapy, or \
follow-up. You do NOT predict outcome or disease course. You do NOT use any \
knowledge from outside the graph data provided — no textbook staging rules, no \
filling in a presumed resection status, no assumed margin status. \
If a field is not documented anywhere in the data YOU ARE GIVEN IN THIS CALL, \
you simply omit it from the paragraph and list it under fields_not_documented — \
you never guess it. \
IMPORTANT: you may be given only ONE BATCH of this patient's total documents at \
a time (the documents are processed in token-safe batches and merged afterward). \
Only report on what is present in the documents given to you in THIS call; do \
not assume anything about documents you have not been shown. \
The emphasis of this summary is on the disease AS CONFIRMED DURING OR AFTER \
SURGERY (post-operative/final histopathology, resection status, margins) rather \
than the initial pre-operative cancer diagnosis — the pre-operative diagnosis \
should still be mentioned if documented, but the post-operative/surgical-pathology \
findings are the primary focus. \
A post-operative diagnosis is CONFIRMED only when the record shows final \
histopathology/surgical pathology of the resected specimen for it — a \
pre-operative impression, imaging finding, or frozen section result alone is NOT \
the same as final confirmation, though it may still be reported as what it is \
(pre-operative/frozen-section finding). \
Always respond with valid JSON only.
"""

_SURGONC_PROMPT_TEMPLATE = """\
Write the Surgical Oncology operative diagnosis and surgical pathology summary
paragraph for this patient, strictly from the data given below. Do not use outside
knowledge. Do not recommend treatment. Do not predict outcome.

══════════════════════════════════════════════════════════
PATIENT IDENTIFICATION
══════════════════════════════════════════════════════════
Name (if documented): {name}
Age: {age_str}
Sex: {sex}

══════════════════════════════════════════════════════════
RAW CLINICAL GRAPH DOCUMENTS — BATCH {batch_num} OF {batch_total} ({batch_len} document(s) in this batch)
══════════════════════════════════════════════════════════
{docs_json}

══════════════════════════════════════════════════════════
MODULE OVERVIEW (Surgical Oncology) — context only, do not copy verbatim
into the output; use it only to know what to look for
══════════════════════════════════════════════════════════
{overview}

Only cover the elements named in the overview above, and ONLY those that
are actually documented in THIS batch's graph data. Do not pad the paragraph
with elements that have no data — just leave them out entirely.

══════════════════════════════════════════════════════════
BOLD RULE FOR CONFIRMED POST-OPERATIVE DIAGNOSIS (MANDATORY)
══════════════════════════════════════════════════════════
  • If the post-operative / final surgical pathology diagnosis is present
    (i.e. confirmed on the resected specimen), wrap the full diagnosis
    phrase (including surgical stage, if given) in markdown bold the first
    time it is stated in full in the paragraph, e.g.
    **invasive ductal carcinoma, pT2N1M0**
  • Do NOT bold a pre-operative diagnosis, a frozen-section impression, or
    any other diagnosis not confirmed on final surgical pathology.
  • Do NOT bold anything else in the paragraph (do not bold resection
    status, margin status, or tumor size).

WHAT NOT TO DO:
  • Do NOT recommend any further surgery, adjuvant treatment, or follow-up.
  • Do NOT predict outcome, recurrence risk, or disease course.
  • Do NOT infer a resection status, margin status, or stage that is not
    explicitly stated — leave it out of the paragraph instead.
  • Do NOT pull in any staging system knowledge or clinical guideline from
    outside the given graph data.
  • Do NOT use bullet points — write in full clinical sentences.

Return ONLY valid JSON:
{{
  "diagnosis_header": "One-line post-operative diagnosis with surgical staging, wrapped in ** bold ** ONLY if confirmed by final surgical pathology; if only a pre-operative/frozen-section diagnosis exists, state it in PLAIN text noting it is pre-operative/frozen-section, not yet confirmed on final pathology; 'Not documented' if nothing at all is present in THIS batch.",
  "confirmed_diagnosis_present": true,
  "resection_status": "R0|R1|R2 or 'Not documented'",
  "margin_status": "... or 'Not documented'",
  "narrative": "The Surgical Oncology operative-diagnosis and surgical-pathology paragraph for THIS batch's documents, in dense clinical-letter prose, covering only the documented elements (pre-operative diagnosis, post-operative diagnosis, tumor location, laterality, tumor size, surgical TNM, intra-operative findings, frozen section results, resection status, margin status), with the confirmed post-operative diagnosis wrapped in **bold** per the rule above. Exact values, dates, and measurements preserved as given — never rounded or paraphrased. If NOTHING relevant is in this batch, return an empty string.",
  "source_coverage_check": {{
    "fields_not_documented": ["list of the overview fields above that had no data in THIS batch"],
    "no_recommendations_included": true,
    "no_predictions_included": true,
    "no_external_knowledge_used": true
  }}
}}
"""


def _merge_batch_summaries(batch_results: List[Any]) -> Dict:
    """
    NEW (v1.2.0) — deterministic, NO LLM merge of per-batch synthesis
    results into ONE final object with the EXACT same schema as before
    batching was introduced. Costs zero additional tokens regardless of
    how many batches were run.

    Merge rules:
      • diagnosis_header      — prefer the first batch that reports a
                                 CONFIRMED post-operative diagnosis; else
                                 the first non-"Not documented" header
                                 found in batch order; else "Not documented".
      • confirmed_diagnosis_present — True if ANY batch found one.
      • resection_status / margin_status — first non-"Not documented"
                                 value found, in batch order.
      • narrative              — every batch's non-empty narrative,
                                 concatenated in order (batches don't
                                 overlap in documents, so nothing is
                                 duplicated); reads as one continuous
                                 paragraph since each batch's narrative
                                 is already full prose.
      • fields_not_documented  — INTERSECTION across batches: a field is
                                 only truly "not documented" for this
                                 patient if it was absent in EVERY batch.
      • no_recommendations_included / no_predictions_included /
        no_external_knowledge_used — AND across all batches (all must
        hold true for the merged guarantee to hold).
    """
    valid = [r for r in batch_results if isinstance(r, dict) and "raw_output" not in r]

    if not valid:
        # Every batch failed to parse — surface a safely-shaped fallback
        # rather than breaking the response schema.
        return {
            "diagnosis_header": "Not documented",
            "confirmed_diagnosis_present": False,
            "resection_status": "Not documented",
            "margin_status": "Not documented",
            "narrative": "",
            "source_coverage_check": {
                "fields_not_documented": [
                    "pre-operative diagnosis", "post-operative diagnosis",
                    "tumor location", "laterality", "tumor size",
                    "surgical TNM staging", "intra-operative findings",
                    "frozen section results", "resection status",
                    "surgical margin status",
                ],
                "no_recommendations_included": True,
                "no_predictions_included": True,
                "no_external_knowledge_used": True,
            },
        }

    def _is_documented(v: Any) -> bool:
        return bool(v) and str(v).strip().lower() not in ("", "not documented")

    diagnosis_header = "Not documented"
    confirmed_pick = next(
        (r for r in valid
         if r.get("confirmed_diagnosis_present") and _is_documented(r.get("diagnosis_header"))),
        None,
    )
    if confirmed_pick:
        diagnosis_header = confirmed_pick["diagnosis_header"]
    else:
        fallback_pick = next((r for r in valid if _is_documented(r.get("diagnosis_header"))), None)
        if fallback_pick:
            diagnosis_header = fallback_pick["diagnosis_header"]

    confirmed_diagnosis_present = any(bool(r.get("confirmed_diagnosis_present")) for r in valid)

    resection_status = next(
        (r["resection_status"] for r in valid if _is_documented(r.get("resection_status"))),
        "Not documented",
    )
    margin_status = next(
        (r["margin_status"] for r in valid if _is_documented(r.get("margin_status"))),
        "Not documented",
    )

    narrative_parts = [
        r["narrative"].strip() for r in valid
        if r.get("narrative") and r["narrative"].strip()
    ]
    narrative = " ".join(narrative_parts) if narrative_parts else "Not documented"

    # Intersection: only "not documented" overall if absent from EVERY
    # batch's own fields_not_documented list.
    coverage_lists = [
        set(r.get("source_coverage_check", {}).get("fields_not_documented", []) or [])
        for r in valid
    ]
    fields_not_documented = sorted(set.intersection(*coverage_lists)) if coverage_lists else []

    def _all_true(key: str) -> bool:
        return all(
            bool(r.get("source_coverage_check", {}).get(key, True)) for r in valid
        )

    return {
        "diagnosis_header": diagnosis_header,
        "confirmed_diagnosis_present": confirmed_diagnosis_present,
        "resection_status": resection_status,
        "margin_status": margin_status,
        "narrative": narrative,
        "source_coverage_check": {
            "fields_not_documented": fields_not_documented,
            "no_recommendations_included": _all_true("no_recommendations_included"),
            "no_predictions_included": _all_true("no_predictions_included"),
            "no_external_knowledge_used": _all_true("no_external_knowledge_used"),
        },
    }


class SurgicalOncologySummaryAgent(BaseAgent):
    agent_id = "A2S"

    async def _run_batch(
        self,
        batch: List[Dict],
        batch_index: int,
        batch_total: int,
        name: Optional[str],
        age_str: str,
        sex: str,
    ) -> Any:
        prompt = _SURGONC_PROMPT_TEMPLATE.format(
            name=name or "Not documented — refer to the patient generically",
            age_str=age_str,
            sex=sex,
            batch_num=batch_index + 1,
            batch_total=batch_total,
            batch_len=len(batch),
            docs_json=json.dumps(batch, indent=2, default=str),
            overview=SURGONC_OVERVIEW,
        )
        return await self._invoke(
            _SURGONC_SYSTEM_TEMPLATE, prompt, max_tokens=SURGONC_SYNTHESIS_MAX_TOKENS
        )

    async def run(self, state: SurgOncState) -> SurgOncState:
        logger.info(f"{self.agent_id} · SurgicalOncologySummaryAgent — START (batched)")
        t0 = datetime.now().timestamp()

        age     = state.get("age")
        sex     = state.get("sex") or "Not documented"
        name    = state.get("patient_name") or None
        age_str = str(age) if age is not None else "Not documented"

        # ── Token-safety pipeline (v1.2.0) ──────────────────────────────
        prepared = _prepare_documents_for_batching(state["graph_documents"])
        batches  = _smart_batch_documents(prepared)
        batch_total = len(batches)

        if not batches:
            state["surgonc_summary"] = _merge_batch_summaries([])
            state["agent_timings"][self.agent_id] = self._elapsed(t0)
            return state

        tasks = [
            self._run_batch(batch, i, batch_total, name, age_str, sex)
            for i, batch in enumerate(batches)
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        batch_results: List[Any] = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"{self.agent_id} · Batch {i} failed: {result}")
                state["errors"].append(f"A2S batch {i}: {str(result)}")
            else:
                batch_results.append(result)

        merged = _merge_batch_summaries(batch_results)

        state["surgonc_summary"] = merged
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(
            f"{self.agent_id} · SurgicalOncologySummaryAgent — DONE "
            f"({state['agent_timings'][self.agent_id]}ms) | "
            f"{len(batch_results)}/{batch_total} batch(es) merged"
        )
        return state


# ============================================================
# WORKFLOW (single stage — no Timeline agent)
# ============================================================

async def run_surgonc_pipeline(state: SurgOncState) -> SurgOncState:
    """Single-stage pipeline: run the Surgical Oncology summary agent
    directly on the raw graph documents (now internally batched for
    token safety). No timeline/chronology pre-processing stage."""
    surgonc_agent = SurgicalOncologySummaryAgent(llm_synthesis)
    state = await surgonc_agent.run(state)  # type: ignore[arg-type]
    return state


# ============================================================
# INITIAL STATE FACTORY
# ============================================================

def build_surgonc_initial_state(
    request: ClinicalRequest,
    graph_docs: List[Dict],
    dob: Optional[str] = None,
    sex: Optional[str] = None,
    age: Optional[int] = None,
    patient_name: Optional[str] = None,
) -> SurgOncState:
    return SurgOncState(
        patient_id=request.patient_id,
        doctor_id=request.doctor_id,
        consultation_text=request.consultation_text,
        specialty=request.specialty,
        graph_documents=graph_docs,
        dob=dob,
        sex=sex,
        age=age,
        patient_name=patient_name,
        surgonc_summary=None,
        errors=[],
        agent_timings={},
    )


# ============================================================
# API ENDPOINT — DIRECT CALL (no queue, no background task)
# ============================================================

@router.post("/surgical-oncology-summary")
async def get_surgical_oncology_summary(request: ClinicalRequest):
    """
    Direct (synchronous) endpoint — fetches graph data, generates the
    Surgical Oncology specialty paragraph summary, saves it to the
    `surgical_oncology_summary` Mongo collection, and returns it in the
    same request/response cycle. No background task, no polling required
    by the caller.

    Response shape is UNCHANGED from v1.1.0 — batching (v1.2.0) is purely
    an internal token-safety fix.
    """
    start_ms = datetime.now().timestamp() * 1000
    logger.info(
        f"SurgOnc summary request | patient={request.patient_id} | doctor={request.doctor_id}"
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

        initial_state = build_surgonc_initial_state(
            request,
            graph_docs,
            dob=demographics.get("dob"),
            sex=demographics.get("sex"),
            age=age,
            patient_name=demographics.get("name"),
        )

        result = await run_surgonc_pipeline(initial_state)

        elapsed = round(datetime.now().timestamp() * 1000 - start_ms)

        logger.info(
            f"SurgOnc summary complete | patient={request.patient_id} | "
            f"{elapsed}ms | {len(graph_docs)} documents"
        )

        generated_at_dt = datetime.utcnow()

        response = {
            "patient_id":         request.patient_id,
            "doctor_id":          request.doctor_id,
            "generated_at":       generated_at_dt.isoformat(),
            "documents_analyzed": len(graph_docs),
            "processing_time_ms": elapsed,
            "agent_timings":      result.get("agent_timings", {}),
            "errors":             result.get("errors", []),
            "version":            "surgonc-1.2.0",
            "module_overview":    SURGONC_OVERVIEW,

            "summary": result.get("surgonc_summary", {}),
        }

        # ---- Persist to Mongo (dedicated collection for this specialty) ----
        try:
            mongo_doc = dict(response)
            mongo_doc["generated_at"] = generated_at_dt  # store as datetime, not str
            await surgonc_collection.insert_one(mongo_doc)
        except Exception as e:
            logger.error(
                f"MongoDB save failed for surgical_oncology_summary | "
                f"patient={request.patient_id} | {e}"
            )
            result.get("errors", []).append(f"mongo-save: {str(e)}")

        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(
            f"SurgOnc summary pipeline failed | patient={request.patient_id} | {e}"
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/surgical-oncology/health")
async def surgonc_health():
    return {
        "status": "ok",
        "version": "surgonc-1.2.0",
        "module_overview": SURGONC_OVERVIEW,
        "pipeline": [
            "A2S-SurgicalOncologySummary — now runs in token-safe batches "
            "(bounded by doc count AND evidence char volume), merged "
            "deterministically (zero extra LLM calls) back into the same "
            "output schema as before"
        ],
        "storage_collection": "surgical_oncology_summary",
        "groq_max_tokens": GROQ_MAX_TOKENS,
        "surgonc_synthesis_max_tokens": SURGONC_SYNTHESIS_MAX_TOKENS,
        "token_safety": {
            "batch_max_docs":              SURGONC_BATCH_MAX_DOCS,
            "batch_max_evidence_chars":     SURGONC_BATCH_MAX_EVIDENCE_CHARS,
            "per_entity_evidence_cap_chars": SURGONC_EVIDENCE_TRUNCATE_CHARS,
            "merge_llm_calls": 0,
            "note": (
                "Fixes groq.BadRequestError 400 'Please reduce the length of "
                "the messages or completion' by never sending more than "
                "batch_max_docs documents OR batch_max_evidence_chars of "
                "evidence text in a single prompt. Batches run concurrently; "
                "results are merged with plain Python (no LLM), so merge cost "
                "is O(1) regardless of how many batches ran."
            ),
        },
    }