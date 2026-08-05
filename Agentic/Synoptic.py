"""
CCGI Synoptic Report Agent — Standalone (v1.0)
===============================================

Generates a structured, tabular SYNOPTIC REPORT (Data Element + Value,
mCODE / CAP / ASTRO / ASCO style) strictly from a patient's Neo4j
graph_documents. This file is fully standalone: it does its own Neo4j /
Mongo fetch, its own LLM calls, and its own FastAPI endpoint. It does not
import anything from the rest of the CCGI codebase.

WHY THIS SHAPE (mirrors the A1/A2/A3 lessons already learned in
ccgi_clinical_reasoning.py):

  - A single "read every document and write the whole synoptic report"
    LLM call scales with total patient document volume and is exactly
    the failure mode that used to blow past context/output limits. This
    agent NEVER does that.

  - Instead: raw documents are split into small batches
    (SYNOPTIC_BATCH_SIZE), each batch is a bounded, independent LLM call
    that only tags + extracts synoptic elements for its own documents
    (Pass 1, concurrent). All batches are then merged 100%
    DETERMINISTICALLY in Python (grouped by clinical domain, then by
    document, in chronological order) — no LLM involved in the merge, so
    nothing can be lost, blended, or hallucinated there.

  - The per-document ASCII-style synoptic TABLE (the
    "[ELEMENT ID] [DATA ELEMENT] [VALUE]" layout) is built 100%
    DETERMINISTICALLY in Python from the merged elements — never by the
    LLM — so formatting can never drift, truncate, or silently fail.

  - The ONLY other LLM call (Pass 2) is a single, small "domain rollup"
    call that reads ONLY the compact, already-deduplicated per-domain
    element list (never the raw documents again) and writes a couple of
    grounded sentences per domain describing what the documented pattern
    shows (e.g. "3 chemotherapy cycles documented, with a dose reduction
    in cycle 2 for neutropenia"). This call's size scales with the
    number of distinct elements, not with total document/entity volume,
    and uses its own token budget so it is never silently truncated.

DESIGN PRINCIPLES (same as the rest of CCGI):
  - No hardcoded disease logic. No hardcoded synoptic vocabulary/element
    list. The LLM identifies domain names AND data elements freely from
    what is actually documented — this file only assigns element IDs
    deterministically (DOMAIN_PREFIX-001, -002, ...) in Python, purely
    for display, after the LLM has already decided what the elements are.
  - Every element in the output must be traceable to an entity/evidence
    string actually present in graph_documents. Nothing is invented,
    inferred, or predicted.
  - Multiple documents of the SAME domain (e.g. 6 separate chemotherapy
    administration records) are NEVER merged into one element table —
    each keeps its own date, its own elements, its own table.
  - Purely operational/administrative workflow metadata (nurse
    verification, pharmacy verification, consent capture, drug labeling
    checklists, IV/venous-access mechanics) is excluded UNLESS it
    reflects an actual clinical event (a reaction, extravasation, or
    documented toxicity) — same rule as A2 in ccgi_clinical_reasoning.py.
  - No recommendations, no predicted outcomes — only what is documented.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import datetime, date as date_cls
from typing import Any, Dict, List, Optional, Tuple, TypedDict

from fastapi import APIRouter, HTTPException
from loguru import logger
from neo4j import AsyncGraphDatabase
from pydantic import BaseModel

from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage

from motor.motor_asyncio import AsyncIOMotorClient

# ============================================================
# ENVIRONMENT / CLIENTS  (standalone — this file does its own fetch/save)
# ============================================================

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

mongo_client = AsyncIOMotorClient(MONGO_URI)
mongo_db = mongo_client[MONGO_DB]

synoptic_collection = mongo_db["patient_synoptic_report"]

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

# Default completion-token cap for any call that doesn't override it.
GROQ_MAX_TOKENS = int(os.getenv("GROQ_MAX_TOKENS", "8000"))

# Pass-1 (per-batch element extraction) token budget. Split out from
# GROQ_MAX_TOKENS because a batch that happens to contain several dense
# structured workflow documents (many chemo cycles, many RT fractions)
# can produce a longer JSON output than a batch of plain consult notes.
# Raise this independently if you see extraction-pass truncation in logs
# (parse_llm_json falling back to {"raw_output": ...}).
SYNOPTIC_EXTRACTION_MAX_TOKENS = int(
    os.getenv("SYNOPTIC_EXTRACTION_MAX_TOKENS", str(GROQ_MAX_TOKENS))
)

# Pass-2 (domain rollup synthesis) token budget. This call's input is
# always small (compact per-domain element list only), but kept
# independently tunable for consistency with the rest of the pipeline.
SYNOPTIC_SYNTHESIS_MAX_TOKENS = int(
    os.getenv("SYNOPTIC_SYNTHESIS_MAX_TOKENS", str(GROQ_MAX_TOKENS))
)

llm_synoptic = ChatGroq(
    model="llama-3.3-70b-versatile",
    temperature=0.1,
    groq_api_key=GROQ_API_KEY,
    max_tokens=GROQ_MAX_TOKENS,
)

router = APIRouter(prefix="", tags=["Synoptic Report"])

# How many raw documents each Pass-1 extraction call reads. Keeps every
# call small/bounded regardless of how many documents the patient has —
# same idea as TIMELINE_BATCH_SIZE / SUMMARY_BATCH_SIZE / ORGAN_BATCH_SIZE
# in ccgi_clinical_reasoning.py.
SYNOPTIC_BATCH_SIZE = int(os.getenv("SYNOPTIC_BATCH_SIZE", "8"))


def _chunk_list(items: List[Any], size: int) -> List[List[Any]]:
    if size <= 0:
        return [items] if items else []
    return [items[i:i + size] for i in range(0, len(items), size)]


def _safe_date_key(d: Optional[str]) -> str:
    """Sort key for ISO-ish date strings that tolerates None/garbage
    values by sorting them last, without ever raising."""
    if not d or d in ("None", "null", "NaT"):
        return "9999-99-99"
    return str(d)


def _domain_prefix(domain: str) -> str:
    """Deterministic short prefix for element IDs, derived purely from
    the domain name text itself (never a hardcoded lookup table) —
    e.g. 'Surgical Oncology' -> 'SURG', 'Radiation Oncology' -> 'RADI',
    'Medical Oncology / Systemic Therapy' -> 'MEDI'."""
    letters = re.sub(r"[^A-Za-z]", "", domain or "")
    if not letters:
        return "GEN"
    return letters[:4].upper()


# ============================================================
# REQUEST / RESPONSE MODELS
# ============================================================

class SynopticRequest(BaseModel):
    patient_id:             str
    doctor_id:              str
    specialty:              str
    include_intermediates:  bool = False


class SynopticTrigger(BaseModel):
    patient_id: str
    doctor_id:  str


class SynopticState(TypedDict):
    patient_id:       str
    doctor_id:        str
    specialty:        str
    graph_documents:  List[Dict]
    dob:              Optional[str]
    sex:              Optional[str]
    age:              Optional[int]
    patient_name:      Optional[str]

    synoptic_report:  Optional[Dict]

    errors:        List[str]
    agent_timings: Dict[str, float]


# ============================================================
# NEO4J / MONGO FETCH  (self-contained — same shape as the rest of CCGI)
# ============================================================

def _calculate_age(dob_value: Any) -> Optional[int]:
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
    """Same shape/query as ccgi_clinical_reasoning.py — kept here too so
    this file can run fully standalone."""
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
# BASE LLM HELPER
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


async def _invoke(system: str, user: str, max_tokens: Optional[int] = None):
    llm = llm_synoptic.bind(max_tokens=max_tokens) if max_tokens else llm_synoptic
    response = await llm.ainvoke([
        SystemMessage(content=system),
        HumanMessage(content=user),
    ])
    return parse_llm_json(response.content)


def _elapsed(start: float) -> float:
    return round((datetime.now().timestamp() - start) * 1000, 1)


# ============================================================
# SYNOPTIC AGENT
# ============================================================

class SynopticAgent:
    agent_id = "SYN"

    # ---- Pass 1: per-batch, per-document domain + element extraction ------

    async def _extract_batch(
        self, batch_docs: List[Dict], specialty: str, batch_index: int
    ) -> Dict[str, Any]:
        """Bounded LLM call over ONE small batch of raw documents. For
        EACH document, classify its clinical domain and extract a flat
        list of {data_element, value, unit, date} entries strictly from
        that document's own entities/evidence. Deliberately does NOT
        write any prose or table here — that happens deterministically
        afterwards in Python."""

        docs_json = json.dumps(batch_docs, indent=2, default=str)

        system = (
            f"You are a senior {specialty} specialist producing SYNOPTIC (structured, "
            "discrete data-element) documentation from a BATCH of raw clinical graph "
            "documents, in the style used by CAP pathology protocols, ACS operative "
            "standards, ASTRO radiation summaries, and ASCO/NCCN medical-oncology "
            "treatment records, following the mCODE data-element philosophy. Synoptic "
            "documentation means: instead of prose, you extract discrete "
            "'Data Element : Value' pairs (e.g. 'Margin Status: Negative', "
            "'Total Dose: 50 Gy', 'ECOG Performance Status: 1', 'Protocol Selected: "
            "FOLFOX', 'Cycle Number: 2'). "
            "For EACH document in this batch you must: "
            "(1) assign it to the ONE clinical domain it best belongs to — choose "
            "freely and specifically based on what the document actually documents "
            "(typical domains include Pathology, Surgical Oncology, Medical Oncology / "
            "Systemic Therapy, Radiation Oncology, Palliative / Supportive Care, "
            "Diagnostic Imaging, but you are not limited to this list — use "
            "'Unclassified' only if the document truly contains no procedural, "
            "treatment, or pathology data element worth capturing synoptically); "
            "(2) extract every discrete data element actually present in that "
            "document's entities/evidence, each as its own {data_element, value} pair, "
            "preserving exact values, units, and dates — never rounding, never "
            "paraphrasing away a number. "
            "You NEVER invent a data element or value that isn't backed by the "
            "document's own entities/evidence. You NEVER borrow an element from a "
            "different document, even if it shares the same date. If a document has "
            "several distinct data elements, list every one of them separately — do "
            "not compress several fields into one combined value. "
            "EXCLUDE purely operational/administrative workflow bookkeeping — nurse "
            "verification, pharmacy verification, consent-form capture, IV/venous- "
            "access line mechanics, drug labeling/preparation checklist steps — UNLESS "
            "it records an actual clinical event (a reaction, extravasation, or "
            "documented toxicity/tolerance note), in which case that clinical event IS "
            "extracted as its own element. "
            "Always respond with valid JSON only."
        )

        prompt = f"""
You are reading a BATCH of raw clinical graph documents (batch #{batch_index + 1}) for
a patient under a {specialty} specialist. This is only a subset of the patient's full
record — classify and extract ONLY from what is given below.

RAW CLINICAL GRAPH DOCUMENTS IN THIS BATCH:
{docs_json}

══════════════════════════════════════════════════════════
TASK — FOR EACH DOCUMENT: ASSIGN A DOMAIN + EXTRACT SYNOPTIC ELEMENTS
══════════════════════════════════════════════════════════

RULES (STRICT):
  1. Use ONLY the data given above. Never add, infer, or predict anything
     not explicitly present in that document's own entities/evidence.
  2. One domain per document — the single best fit based on content.
  3. Every data_element/value pair must be traceable to something actually
     documented in that specific document. If unsure whether a field
     qualifies as a discrete synoptic element (vs. free narrative
     commentary with no discrete value), only include it if a concrete
     value/finding is actually stated.
  4. Do not merge two different documents' elements together, even if
     they share the same date and domain.
  5. Do not fabricate a "normal"/default value for anything not explicitly
     stated — omit the element entirely if no value is documented.
  6. Exclude purely operational/administrative workflow metadata (see
     system instructions) unless it reflects an actual clinical event.
  7. This is only ONE batch — extract exactly what you were given, no more.

Return ONLY valid JSON:
{{
  "documents": [
    {{
      "document": "exact document name as given",
      "date": "YYYY-MM-DD or null",
      "domain": "Surgical Oncology | Medical Oncology / Systemic Therapy | Radiation Oncology | Pathology | Palliative / Supportive Care | Diagnostic Imaging | Unclassified | <your own specific domain if a better fit>",
      "elements": [
        {{
          "data_element": "exact discrete field name, e.g. 'Margin Status'",
          "value": "exact documented value, e.g. 'Negative'",
          "unit": "unit if numeric/applicable, else null",
          "evidence_snippet": "short verbatim-adjacent phrase from the source evidence this element is grounded in (for traceability only, not for display)"
        }}
      ]
    }}
  ]
}}
"""
        result = await self._invoke_wrapped(system, prompt, batch_index)
        if not isinstance(result, dict) or "documents" not in result:
            logger.warning(
                f"{self.agent_id} · batch {batch_index + 1} returned unparseable "
                f"output — falling back to deterministic extraction for this batch"
            )
            return self._deterministic_batch_fallback(batch_docs)
        return result

    async def _invoke_wrapped(self, system: str, prompt: str, batch_index: int) -> Dict:
        return await _invoke(system, prompt, max_tokens=SYNOPTIC_EXTRACTION_MAX_TOKENS)

    def _deterministic_batch_fallback(self, batch_docs: List[Dict]) -> Dict[str, Any]:
        """If a batch's LLM extraction fails entirely, build a minimal,
        purely deterministic per-document element list in Python (domain
        'Unclassified' since we can't safely infer a domain without the
        LLM) so nothing is silently dropped from the synoptic report."""
        documents_out = []
        for doc in batch_docs:
            doc_name = doc.get("document", "unknown")
            doc_date = doc.get("document_date")
            elements = []
            for e in doc.get("entities", []) or []:
                name = e.get("name")
                if not name:
                    continue
                elements.append({
                    "data_element": e.get("entity_type") or "Finding",
                    "value": name,
                    "unit": None,
                    "evidence_snippet": e.get("evidence"),
                })
            documents_out.append({
                "document": doc_name,
                "date": doc_date,
                "domain": "Unclassified",
                "elements": elements,
            })
        return {"documents": documents_out}

    # ---- Deterministic merge (no LLM) --------------------------------------

    def _merge_batches(self, batch_results: List[Dict[str, Any]]) -> Dict[str, List[Dict]]:
        """Group all batches' per-document element sets by domain, in
        chronological (earliest-first) document order within each domain.
        Purely deterministic — nothing can be lost or hallucinated here."""
        by_domain: Dict[str, List[Dict]] = {}

        for batch in batch_results:
            for doc_entry in batch.get("documents", []) or []:
                if not isinstance(doc_entry, dict):
                    continue
                domain = (doc_entry.get("domain") or "Unclassified").strip() or "Unclassified"
                by_domain.setdefault(domain, []).append({
                    "document": doc_entry.get("document") or "unknown",
                    "date": doc_entry.get("date"),
                    "elements": [
                        el for el in (doc_entry.get("elements") or [])
                        if isinstance(el, dict) and el.get("data_element") and el.get("value")
                    ],
                })

        # Chronological order (earliest first) within each domain — a
        # synoptic treatment course (e.g. cycle 1, 2, 3...) reads most
        # naturally in the order it happened.
        for domain, docs in by_domain.items():
            docs.sort(key=lambda d: _safe_date_key(d.get("date")))

        return by_domain

    # ---- Deterministic table assembly (NO LLM) -----------------------------

    def _assign_element_ids(self, domain: str, docs: List[Dict]) -> None:
        """Deterministically stamps an element_id onto every element,
        sequential within its domain across all of that domain's
        documents, in the chronological order already established. Purely
        a Python counter — never an LLM-invented ID, never a hardcoded
        vocabulary table."""
        prefix = _domain_prefix(domain)
        counter = 1
        for doc in docs:
            for el in doc.get("elements", []):
                el["element_id"] = f"{prefix}-{counter:03d}"
                counter += 1

    def _build_document_table(self, domain: str, doc: Dict) -> str:
        """Deterministically renders one document's elements as an
        ASCII-style synoptic table, matching the CAP/ACS/ASTRO-style
        layout — built purely in Python from already-extracted,
        already-ID-assigned elements. No LLM involved, so this can never
        truncate, drift, or blend documents together."""
        header = f"SYNOPTIC REPORT — {domain.upper()} — {doc.get('document', 'unknown')}"
        if doc.get("date"):
            header += f" ({doc['date']})"
        rule = "-" * max(len(header), 70)

        lines = [header, rule]
        lines.append(f"{'[ELEMENT ID]':<16}{'[DATA ELEMENT]':<32}{'[VALUE/RESPONSE]'}")
        lines.append(rule)

        elements = doc.get("elements", [])
        if not elements:
            lines.append("(No discrete synoptic data elements documented for this record.)")
        else:
            for el in elements:
                value = el.get("value") or ""
                if el.get("unit"):
                    value = f"{value} {el['unit']}"
                lines.append(f"{el.get('element_id', ''):<16}{el.get('data_element', ''):<32}{value}")
        lines.append(rule)
        return "\n".join(lines)

    # ---- Pass 2: single small domain-rollup synthesis call -----------------

    async def _synthesize_domain_rollups(
        self, by_domain: Dict[str, List[Dict]], specialty: str
    ) -> Dict[str, str]:
        """ONE bounded LLM call over a COMPACT, deduplicated per-domain
        element list (never the raw documents again) that writes a
        short, grounded rollup sentence or two per domain describing the
        documented pattern across that domain's documents (e.g. dose
        reduction across cycles, margin status at surgery, etc.). Size
        scales with the number of distinct elements, not with total
        patient document/entity volume."""

        if not by_domain:
            return {}

        compact_payload = []
        for domain, docs in by_domain.items():
            compact_payload.append({
                "domain": domain,
                "documents": [
                    {
                        "document": d.get("document"),
                        "date": d.get("date"),
                        "elements": [
                            {"data_element": el.get("data_element"), "value": el.get("value"), "unit": el.get("unit")}
                            for el in d.get("elements", [])
                        ],
                    }
                    for d in docs
                ],
            })

        payload_json = json.dumps(compact_payload, indent=2, default=str)

        system = (
            f"You are a senior {specialty} specialist writing brief rollup notes over "
            "already-extracted synoptic (discrete data-element) records, grouped by "
            "clinical domain. For EACH domain given, write 1-2 dense sentences "
            "describing the documented pattern ACROSS that domain's records — e.g. "
            "how many distinct records/cycles/sessions are documented, and any change "
            "across them that is explicitly supported by the data (a dose reduction, a "
            "margin status, a change in performance status, etc.). You use ONLY the "
            "elements given below — never invent a trend that isn't backed by the "
            "actual values shown. You do not recommend treatment and you do not "
            "predict outcomes. If a domain has only one record, simply state what was "
            "documented — do not force a trend claim. Always respond with valid JSON "
            "only."
        )

        prompt = f"""
Write a brief rollup note for EACH clinical domain below, using ONLY the
already-extracted elements given (do not re-derive facts from anything else).

══════════════════════════════════════════════════════════
PER-DOMAIN SYNOPTIC ELEMENTS (already grouped, already deduplicated)
══════════════════════════════════════════════════════════
{payload_json}

Return ONLY valid JSON:
{{
  "domain_rollups": [
    {{
      "domain": "exact domain name as given above",
      "rollup": "1-2 dense sentences describing the documented pattern across this domain's records, grounded only in the elements given."
    }}
  ]
}}
"""
        result = await _invoke(system, prompt, max_tokens=SYNOPTIC_SYNTHESIS_MAX_TOKENS)
        out: Dict[str, str] = {}
        if isinstance(result, dict) and isinstance(result.get("domain_rollups"), list):
            for item in result["domain_rollups"]:
                if isinstance(item, dict) and item.get("domain"):
                    out[str(item["domain"])] = item.get("rollup") or ""
        return out

    def _deterministic_rollup_fallback(self, domain: str, docs: List[Dict]) -> str:
        """If the rollup call fails, a plain deterministic fallback so no
        domain is ever left without at least a factual note."""
        n = len(docs)
        dates = [d.get("date") for d in docs if d.get("date")]
        span = ""
        if len(dates) >= 2:
            span = f" spanning {min(dates)} to {max(dates)}"
        return f"{n} document(s) documented in this domain{span}."

    # ---- Main run -----------------------------------------------------------

    async def run(self, state: SynopticState) -> SynopticState:
        logger.info(f"{self.agent_id} · SynopticAgent — START")
        t0 = datetime.now().timestamp()

        specialty = state.get("specialty", "General Medicine")
        docs = state["graph_documents"]
        batches = _chunk_list(docs, SYNOPTIC_BATCH_SIZE)

        logger.info(
            f"{self.agent_id} · {len(docs)} documents split into "
            f"{len(batches)} batch(es) of up to {SYNOPTIC_BATCH_SIZE} for element extraction"
        )

        batch_results = await asyncio.gather(
            *[self._extract_batch(batch, specialty, i) for i, batch in enumerate(batches)],
            return_exceptions=True,
        )

        clean_results = []
        for i, r in enumerate(batch_results):
            if isinstance(r, Exception):
                logger.error(f"{self.agent_id} · batch {i + 1} failed: {r}")
                state["errors"].append(f"SYN-batch-{i + 1}: {str(r)}")
                clean_results.append(self._deterministic_batch_fallback(batches[i]))
            else:
                clean_results.append(r)

        by_domain = self._merge_batches(clean_results)

        # Deterministically assign element IDs and build tables — zero LLM.
        for domain, domain_docs in by_domain.items():
            self._assign_element_ids(domain, domain_docs)
            for doc in domain_docs:
                doc["formatted_table"] = self._build_document_table(domain, doc)

        # Bounded rollup synthesis (single small call).
        try:
            rollups = await self._synthesize_domain_rollups(by_domain, specialty)
        except Exception as e:
            logger.error(f"{self.agent_id} · rollup synthesis failed: {e}")
            state["errors"].append(f"SYN-rollup: {str(e)}")
            rollups = {}

        domains_out = []
        unclassified_note = None
        for domain, domain_docs in by_domain.items():
            rollup = rollups.get(domain) or self._deterministic_rollup_fallback(domain, domain_docs)
            domains_out.append({
                "domain": domain,
                "documents": domain_docs,
                "domain_rollup": rollup,
            })

        # Order domains by how much is documented (most-documented first)
        # purely for readability — no bearing on content.
        domains_out.sort(key=lambda d: sum(len(doc.get("elements", [])) for doc in d["documents"]), reverse=True)

        total_elements = sum(
            len(doc.get("elements", []))
            for d in domains_out
            for doc in d["documents"]
        )
        total_documents_with_elements = sum(
            1 for d in domains_out for doc in d["documents"] if doc.get("elements")
        )

        full_text_sections = []
        for d in domains_out:
            for doc in d["documents"]:
                full_text_sections.append(doc["formatted_table"])
            if d.get("domain_rollup"):
                full_text_sections.append(f"[{d['domain']} — Rollup] {d['domain_rollup']}")
        full_text = "\n\n".join(full_text_sections)

        state["synoptic_report"] = {
            "domains": domains_out,
            "completeness_check": {
                "total_documents_processed": len(docs),
                "total_documents_with_synoptic_elements": total_documents_with_elements,
                "total_elements_extracted": total_elements,
                "notes": (
                    f"Built from {len(batches)} batch(es) of up to {SYNOPTIC_BATCH_SIZE} "
                    "documents each, merged deterministically by domain then by "
                    "document in chronological order. Element IDs and tables are "
                    "assembled deterministically in Python — never by the LLM."
                ),
            },
            "full_text": full_text,
        }
        state["agent_timings"][self.agent_id] = _elapsed(t0)
        logger.info(
            f"{self.agent_id} · SynopticAgent — DONE "
            f"({state['agent_timings'][self.agent_id]}ms) | "
            f"{len(domains_out)} domain(s), {total_elements} element(s)"
        )
        return state


synoptic_agent = SynopticAgent()


# ============================================================
# INITIAL STATE FACTORY
# ============================================================

def build_initial_state(
    request: SynopticRequest,
    graph_docs: List[Dict],
    dob: Optional[str] = None,
    sex: Optional[str] = None,
    age: Optional[int] = None,
    patient_name: Optional[str] = None,
) -> SynopticState:
    return SynopticState(
        patient_id=request.patient_id,
        doctor_id=request.doctor_id,
        specialty=request.specialty,
        graph_documents=graph_docs,
        dob=dob,
        sex=sex,
        age=age,
        patient_name=patient_name,
        synoptic_report=None,
        errors=[],
        agent_timings={},
    )


# ============================================================
# API ENDPOINTS
# ============================================================

@router.post("/synoptic-report")
async def trigger_synoptic(request: SynopticTrigger):
    """Optional lightweight trigger endpoint, mirroring the
    /clinical-reasoning-summary pattern, if you want to queue this via a
    task worker instead of running it inline. Wire up your own task
    client here if needed; left as a direct call by default."""
    result = await run_synoptic(SynopticRequest(
        patient_id=request.patient_id,
        doctor_id=request.doctor_id,
        specialty="General Medicine",
    ))
    return {"status": "completed", "patient_id": request.patient_id}


@router.post("/internal/run-synoptic")
async def run_synoptic(request: SynopticRequest):
    """
    Standalone synoptic-report pipeline (v1.0).

    Fetches the patient's graph_documents from Neo4j directly (no
    dependency on any other agent/module), then:

      Pass 1 (concurrent, batched, bounded): each batch of
      SYNOPTIC_BATCH_SIZE raw documents is sent to the LLM once, which
      classifies each document's clinical domain and extracts its
      discrete data-element/value pairs — grounded strictly in that
      document's own entities/evidence.

      Merge (deterministic, no LLM): all batches' documents are grouped
      by domain, ordered chronologically within each domain.

      Table assembly (deterministic, no LLM): each document's synoptic
      table (element ID / data element / value) is rendered in Python.

      Pass 2 (single, small, bounded): one LLM call writes a short
      grounded rollup sentence or two per domain, using only the
      compact, already-extracted element list.
    """
    start_ms = datetime.now().timestamp() * 1000
    logger.info(
        f"Synoptic (v1.0) request | patient={request.patient_id} | doctor={request.doctor_id}"
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

        state = build_initial_state(
            request,
            graph_docs,
            dob=demographics.get("dob"),
            sex=demographics.get("sex"),
            age=age,
            patient_name=demographics.get("name"),
        )

        state = await synoptic_agent.run(state)

        elapsed = round(datetime.now().timestamp() * 1000 - start_ms)

        full_payload = {
            "patient_id":         request.patient_id,
            "doctor_id":          request.doctor_id,
            "generated_at":       datetime.utcnow(),
            "documents_analyzed": len(graph_docs),
            "processing_time_ms": elapsed,
            "synoptic_report":    state.get("synoptic_report", {}),
            "agent_timings":      state.get("agent_timings", {}),
            "errors":             state.get("errors", []),
        }

        try:
            await synoptic_collection.insert_one(dict(full_payload))
        except Exception as e:
            logger.error(f"MongoDB save failed: {e}")

        logger.info(
            f"Synoptic (v1.0) complete | patient={request.patient_id} | "
            f"{elapsed}ms | {len(graph_docs)} documents"
        )

        response = {
            "patient_id":         request.patient_id,
            "doctor_id":          request.doctor_id,
            "generated_at":       datetime.now().isoformat(),
            "documents_analyzed": len(graph_docs),
            "processing_time_ms": elapsed,
            "agent_timings":      state.get("agent_timings", {}),
            "errors":             state.get("errors", []),
            "version":            "synoptic-1.0.0",
            "synoptic_report":    state.get("synoptic_report", {}),
        }

        if request.include_intermediates:
            response["intermediate"] = {
                "synoptic_report_raw": state.get("synoptic_report", {}),
            }

        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(
            f"Synoptic (v1.0) pipeline failed | patient={request.patient_id} | {e}"
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/synoptic-report")
async def trigger_synoptic_report(request: SynopticRequest):
    """Alias of /internal/run-synoptic, named to match the existing
    ai-legacy/<specialty>-summary POST convention used by the other
    specialty summary generators (e.g. ai-legacy/radiation-oncology-summary).
    Frontend 'Generate' buttons should call this path."""
    return await run_synoptic(request)


@router.get("/synoptic-report/{patient_id}")
async def get_latest_synoptic_report(patient_id: str):
    """Retrieve the most recently generated synoptic report for a patient
    from patient_synoptic_report — same shape/pattern as
    get_latest_surgical_oncology_summary, just pointed at the synoptic
    collection instead."""
    try:
        summary = await synoptic_collection.find_one(
            {"patient_id": patient_id},
            sort=[("generated_at", -1)]
        )

        if not summary:
            raise HTTPException(
                status_code=404,
                detail=f"No Synoptic report found for patient_id={patient_id}"
            )

        summary["_id"] = str(summary["_id"])

        return {
            "status": "success",
            "data": summary
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Failed fetching Synoptic report: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/synoptic/health")
async def health():
    return {
        "status": "ok",
        "version": "synoptic-1.0.0",
        "synoptic_batch_size": SYNOPTIC_BATCH_SIZE,
        "groq_max_tokens": GROQ_MAX_TOKENS,
        "synoptic_extraction_max_tokens": SYNOPTIC_EXTRACTION_MAX_TOKENS,
        "synoptic_synthesis_max_tokens": SYNOPTIC_SYNTHESIS_MAX_TOKENS,
        "pipeline": [
            "Pass1-ElementExtraction  [BATCHED by "
            f"{SYNOPTIC_BATCH_SIZE} docs, concurrent, own "
            f"{SYNOPTIC_EXTRACTION_MAX_TOKENS}-token budget per call — classifies "
            "domain + extracts discrete data-element/value pairs per document, "
            "grounded strictly in that document's own entities/evidence]",
            "Merge                    [deterministic, no LLM — groups by domain, "
            "orders chronologically within domain]",
            "TableAssembly            [deterministic, no LLM — assigns element IDs "
            "and renders the ASCII synoptic table per document]",
            "Pass2-DomainRollup       [ONE bounded call over the compact per-domain "
            f"element list, own {SYNOPTIC_SYNTHESIS_MAX_TOKENS}-token budget]",
        ],
    }


# ============================================================
# ENTRYPOINT
# ============================================================

if __name__ == "__main__":
    import uvicorn
    from fastapi import FastAPI

    app = FastAPI(title="CCGI Synoptic Report Agent")
    app.include_router(router)

    uvicorn.run(app, host="0.0.0.0", port=8001, reload=False, log_level="info")