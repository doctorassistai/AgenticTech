"""
radiation_oncology_summary.py — Radiation Oncology Specialty Summary (STANDALONE module)
=========================================================================================

⚠️ RECONSTRUCTION NOTE:
  This file was reconstructed from a crash traceback only (the actual
  source was not provided). It mirrors the EXACT architecture of the
  now-fixed `surgical_oncology_summary.py` sibling module — same
  BaseAgent, same batching/merge pattern, same endpoint shape — adapted
  to Radiation Oncology fields. If your real file's prompt wording or
  JSON schema differs, paste it and this fix gets applied to your exact
  file instead. The important part — the token-safe batching loop — is
  identical regardless.

Purpose:
  A specialty-specific summary, focused ONLY on the clinical elements a
  Radiation Oncology consultant needs:

    - Primary diagnosis relevant to radiotherapy planning
    - Disease stage (clinical/pathological, as documented)
    - Treatment intent (curative / palliative / adjuvant / neoadjuvant)
    - Radiation technique (e.g. IMRT, VMAT, 3D-CRT, SBRT, brachytherapy)
    - Target volume(s) (GTV/CTV/PTV, site, laterality)
    - Prescribed dose and fractionation schedule
    - Organs at risk (OARs) and any documented constraint/dose limits
    - Concurrent systemic therapy, if documented alongside RT
    - Treatment response / toxicity, if documented

  Strictly grounded in `graph_documents` fetched from Neo4j — nothing is
  invented, predicted, or pulled from outside the graph data. If a field
  is not documented, it is simply omitted rather than guessed. No new
  treatment recommendations are generated.

Pipeline (single agent — no Timeline stage):
  A2R Radiation Oncology Summary Agent — runs directly on the raw graph
      documents and produces a doctor-letter-style paragraph.

Persistence:
  Each generated summary is saved to its own dedicated MongoDB collection,
  `radiation_oncology_summary`, keyed by patient_id/doctor_id/generated_at.

This file is fully self-contained: it does NOT import from
ccgi_clinical_reasoning.py or any other project module. It sets up its
own Neo4j driver, Mongo client, and LLM client. Exposed as a DIRECT
endpoint — no background task queue, no polling.

============================================================================
v1.1.0 — TOKEN-SAFE BATCHING (fixes: groq.BadRequestError 400 "Please
reduce the length of the messages or completion")
============================================================================
ROOT CAUSE OF THE 400 ERROR:
  The previous version dumped ALL of a patient's `graph_documents` into
  ONE prompt, in ONE LLM call, with only the OUTPUT token budget
  (RADONC_SYNTHESIS_MAX_TOKENS) being configurable. For a patient with 79
  documents (as seen in the crash log — patient PAT-3a457415-...), the
  INPUT side alone exceeded the model's total context window — Groq
  rejects the request outright with a 400 in that case, regardless of how
  the completion-side max_tokens knob is set, because input + requested
  completion together no longer fit.

THE FIX — the same batching loop already applied to the Surgical
Oncology sibling module:
  1. Every entity's evidence text is capped at RADONC_EVIDENCE_TRUNCATE_CHARS
     before it can ever enter a prompt.
  2. Documents are split into batches bounded by BOTH a document-count
     ceiling (RADONC_BATCH_MAX_DOCS) AND a cumulative evidence-character
     ceiling (RADONC_BATCH_MAX_EVIDENCE_CHARS) — a batch closes the
     moment either ceiling would be exceeded by the next document.
  3. Each batch gets its OWN LLM call, run concurrently, producing the
     SAME JSON schema as before but scoped to just that batch's documents.
  4. The batch results are merged back into ONE final object with a
     100% deterministic Python merge step — NO extra LLM call.

OUTPUT JSON IS UNCHANGED:
  The `summary` object returned to the caller keeps the same top-level
  keys throughout. The frontend does not need to change.
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
radonc_collection = mongo_db["radiation_oncology_summary"]

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

# Base/default completion-token budget for this module's LLM client.
GROQ_MAX_TOKENS = int(os.getenv("GROQ_MAX_TOKENS", "5000"))

# Dedicated max_tokens for the Radiation Oncology SYNTHESIS call (now
# applied PER BATCH — see v1.1.0 note above).
RADONC_SYNTHESIS_MAX_TOKENS = int(
    os.getenv("RADONC_SYNTHESIS_MAX_TOKENS", str(max(GROQ_MAX_TOKENS, 8000)))
)

# ── NEW (v1.1.0) — token-safety batching knobs ───────────────────────────
RADONC_BATCH_MAX_DOCS = int(os.getenv("RADONC_BATCH_MAX_DOCS", "6"))
RADONC_BATCH_MAX_EVIDENCE_CHARS = int(
    os.getenv("RADONC_BATCH_MAX_EVIDENCE_CHARS", "6000")
)
RADONC_EVIDENCE_TRUNCATE_CHARS = int(
    os.getenv("RADONC_EVIDENCE_TRUNCATE_CHARS", "1200")
)

llm_synthesis = ChatGroq(
    model="llama-3.3-70b-versatile",
    temperature=0.1,
    max_tokens=GROQ_MAX_TOKENS,
    groq_api_key=GROQ_API_KEY,
)

router = APIRouter(prefix="", tags=["Radiation Oncology Reasoning"])


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

class RadOncState(TypedDict):
    patient_id:        str
    doctor_id:          str
    consultation_text:  str
    specialty:          str
    graph_documents:    List[Dict]
    dob:                Optional[str]
    sex:                Optional[str]
    age:                Optional[int]
    patient_name:       Optional[str]

    radonc_summary:     Optional[Dict]

    errors:             List[str]
    agent_timings:      Dict[str, float]


# ============================================================
# HELPERS  (self-contained copies — age calc, demographics, graph fetch)
# ============================================================

def _calculate_age(dob_value: Any) -> Optional[int]:
    """Best-effort age calculation from a DOB stored in Mongo."""
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
# TOKEN-SAFETY HELPERS (evidence truncation + batching)
# ============================================================

def _truncate_evidence(text: Optional[str], limit: int = RADONC_EVIDENCE_TRUNCATE_CHARS) -> str:
    """Caps a single entity's evidence text so one abnormally long note
    or report can never, by itself, blow the input budget of a batch."""
    if not text:
        return text or ""
    if len(text) <= limit:
        return text
    return text[:limit] + " …[truncated for token safety]"


def _prepare_documents_for_batching(graph_documents: List[Dict]) -> List[Dict]:
    """Returns a COPY of graph_documents with every entity's evidence text
    truncated. Original graph_documents left untouched."""
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
    max_docs_per_batch: int = RADONC_BATCH_MAX_DOCS,
    max_chars_per_batch: int = RADONC_BATCH_MAX_EVIDENCE_CHARS,
) -> List[List[Dict]]:
    """
    Splits prepared documents into batches bounded by BOTH document count
    AND total evidence character volume — the core fix for the Groq 400
    "reduce the length of the messages or completion" error seen with
    this patient's 79 documents. A batch closes the moment either ceiling
    would be exceeded by the next document.
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
        override so it doesn't get silently truncated by the client's
        base GROQ_MAX_TOKENS, without changing the token budget of any
        other call."""
        llm = self.llm.bind(max_tokens=max_tokens) if max_tokens else self.llm
        response = await llm.ainvoke([
            SystemMessage(content=system),
            HumanMessage(content=user),
        ])
        return parse_llm_json(response.content)

    def _elapsed(self, start: float) -> float:
        return round((datetime.now().timestamp() - start) * 1000, 1)


# ============================================================
# A2R · RADIATION ONCOLOGY SUMMARY AGENT
#
# v1.1.0: runs the synthesis prompt PER BATCH (bounded input) and merges
# the batch results into ONE final object with a deterministic, zero-LLM
# merge step. Narrowed strictly to the fields a Radiation Oncology
# consultant needs, written as a doctor-letter-style paragraph rather
# than a structured field dump. Grounded ONLY in graph data. No new
# treatment recommendations, no predictions, no external knowledge.
# ============================================================

RADONC_OVERVIEW = (
    "The Radiation Oncology module focuses on the diagnosis and staging "
    "relevant to radiotherapy planning, treatment intent (curative, "
    "palliative, adjuvant, or neoadjuvant), the radiation technique used "
    "(e.g. IMRT, VMAT, 3D-CRT, SBRT, brachytherapy), the target volume(s) "
    "and site/laterality treated, the prescribed dose and fractionation "
    "schedule, organs at risk (OARs) and any documented dose constraints, "
    "any concurrent systemic therapy given alongside radiotherapy, and "
    "documented treatment response or toxicity. The emphasis is on "
    "documenting what radiotherapy was planned or delivered and how the "
    "disease was staged for that purpose, rather than the initial cancer "
    "diagnosis alone."
)

_RADONC_SYSTEM_TEMPLATE = """\
You are a Radiation Oncology specialist writing the diagnosis-and-staging \
paragraph of a patient's chart note, used purely for radiotherapy reference. \
Your ONLY job is to extract and report, in dense clinical narrative prose, what \
is EXPLICITLY documented in the patient's clinical graph data about: primary \
diagnosis relevant to radiotherapy, disease stage, treatment intent (curative / \
palliative / adjuvant / neoadjuvant), radiation technique, target volume(s) and \
site/laterality, prescribed dose and fractionation, organs at risk and any dose \
constraints, concurrent systemic therapy given alongside radiotherapy, and \
documented treatment response or toxicity. \
You do NOT recommend any new treatment, technique, dose, or follow-up. You do \
NOT predict outcome or disease course. You do NOT use any knowledge from outside \
the graph data provided — no textbook dose/fractionation conventions, no assumed \
technique, no assumed constraints. \
If a field is not documented anywhere in the data YOU ARE GIVEN IN THIS CALL, \
you simply omit it from the paragraph and list it under fields_not_documented — \
you never guess it. \
IMPORTANT: you may be given only ONE BATCH of this patient's total documents at \
a time (the documents are processed in token-safe batches and merged afterward). \
Only report on what is present in the documents given to you in THIS call; do \
not assume anything about documents you have not been shown. \
Always respond with valid JSON only.
"""

_RADONC_PROMPT_TEMPLATE = """\
Write the Radiation Oncology diagnostic/staging summary paragraph for this patient,
strictly from the data given below. Do not use outside knowledge. Do not recommend
new treatment. Do not predict outcome.

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
MODULE OVERVIEW (Radiation Oncology) — context only, do not copy verbatim
into the output; use it only to know what to look for
══════════════════════════════════════════════════════════
{overview}

Only cover the elements named in the overview above, and ONLY those that
are actually documented in THIS batch's graph data. Do not pad the paragraph
with elements that have no data — just leave them out entirely.

WHAT NOT TO DO:
  • Do NOT recommend any new treatment, technique, dose, or follow-up.
  • Do NOT predict outcome, recurrence risk, or disease course.
  • Do NOT infer a technique, dose, fractionation, or constraint that is
    not explicitly stated — leave it out of the paragraph instead.
  • Do NOT pull in any staging system or dosimetry knowledge from outside
    the given graph data.
  • Do NOT use bullet points — write in full clinical sentences.

Return ONLY valid JSON:
{{
  "diagnosis_header": "One-line diagnosis with stage as documented, or 'Not documented' if nothing at all is present in THIS batch.",
  "confirmed_diagnosis_present": true,
  "treatment_intent": "Curative|Palliative|Adjuvant|Neoadjuvant or 'Not documented'",
  "radiation_technique": "... or 'Not documented'",
  "prescribed_dose_fractionation": "... or 'Not documented'",
  "narrative": "The Radiation Oncology diagnosis-and-staging paragraph for THIS batch's documents, in dense clinical-letter prose, covering only the documented elements. Exact values, dates, and measurements preserved as given — never rounded or paraphrased. If NOTHING relevant is in this batch, return an empty string.",
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
    Deterministic, NO LLM merge of per-batch synthesis results into ONE
    final object with a consistent schema. Costs zero additional tokens
    regardless of how many batches were run (2, 10, 50+).
    """
    valid = [r for r in batch_results if isinstance(r, dict) and "raw_output" not in r]

    if not valid:
        return {
            "diagnosis_header": "Not documented",
            "confirmed_diagnosis_present": False,
            "treatment_intent": "Not documented",
            "radiation_technique": "Not documented",
            "prescribed_dose_fractionation": "Not documented",
            "narrative": "",
            "source_coverage_check": {
                "fields_not_documented": [
                    "primary diagnosis", "disease stage", "treatment intent",
                    "radiation technique", "target volume", "prescribed dose "
                    "and fractionation", "organs at risk", "concurrent "
                    "systemic therapy", "treatment response/toxicity",
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

    treatment_intent = next(
        (r["treatment_intent"] for r in valid if _is_documented(r.get("treatment_intent"))),
        "Not documented",
    )
    radiation_technique = next(
        (r["radiation_technique"] for r in valid if _is_documented(r.get("radiation_technique"))),
        "Not documented",
    )
    prescribed_dose_fractionation = next(
        (r["prescribed_dose_fractionation"] for r in valid
         if _is_documented(r.get("prescribed_dose_fractionation"))),
        "Not documented",
    )

    narrative_parts = [
        r["narrative"].strip() for r in valid
        if r.get("narrative") and r["narrative"].strip()
    ]
    narrative = " ".join(narrative_parts) if narrative_parts else "Not documented"

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
        "treatment_intent": treatment_intent,
        "radiation_technique": radiation_technique,
        "prescribed_dose_fractionation": prescribed_dose_fractionation,
        "narrative": narrative,
        "source_coverage_check": {
            "fields_not_documented": fields_not_documented,
            "no_recommendations_included": _all_true("no_recommendations_included"),
            "no_predictions_included": _all_true("no_predictions_included"),
            "no_external_knowledge_used": _all_true("no_external_knowledge_used"),
        },
    }


class RadiationOncologySummaryAgent(BaseAgent):
    agent_id = "A2R"

    async def _run_batch(
        self,
        batch: List[Dict],
        batch_index: int,
        batch_total: int,
        name: Optional[str],
        age_str: str,
        sex: str,
    ) -> Any:
        prompt = _RADONC_PROMPT_TEMPLATE.format(
            name=name or "Not documented — refer to the patient generically",
            age_str=age_str,
            sex=sex,
            batch_num=batch_index + 1,
            batch_total=batch_total,
            batch_len=len(batch),
            docs_json=json.dumps(batch, indent=2, default=str),
            overview=RADONC_OVERVIEW,
        )
        return await self._invoke(
            _RADONC_SYSTEM_TEMPLATE, prompt, max_tokens=RADONC_SYNTHESIS_MAX_TOKENS
        )

    async def run(self, state: RadOncState) -> RadOncState:
        logger.info(f"{self.agent_id} · RadiationOncologySummaryAgent — START (batched)")
        t0 = datetime.now().timestamp()

        age     = state.get("age")
        sex     = state.get("sex") or "Not documented"
        name    = state.get("patient_name") or None
        age_str = str(age) if age is not None else "Not documented"

        # ── Token-safety pipeline ────────────────────────────────────
        prepared = _prepare_documents_for_batching(state["graph_documents"])
        batches  = _smart_batch_documents(prepared)
        batch_total = len(batches)

        logger.info(
            f"{self.agent_id} · {len(prepared)} document(s) split into "
            f"{batch_total} token-safe batch(es) "
            f"(max {RADONC_BATCH_MAX_DOCS} docs / {RADONC_BATCH_MAX_EVIDENCE_CHARS} chars per batch)"
        )

        if not batches:
            state["radonc_summary"] = _merge_batch_summaries([])
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
                state["errors"].append(f"A2R batch {i}: {str(result)}")
            else:
                batch_results.append(result)

        merged = _merge_batch_summaries(batch_results)

        state["radonc_summary"] = merged
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(
            f"{self.agent_id} · RadiationOncologySummaryAgent — DONE "
            f"({state['agent_timings'][self.agent_id]}ms) | "
            f"{len(batch_results)}/{batch_total} batch(es) merged"
        )
        return state


# ============================================================
# WORKFLOW (single stage — no Timeline agent)
# ============================================================

async def run_radonc_pipeline(state: RadOncState) -> RadOncState:
    """Single-stage pipeline: run the Radiation Oncology summary agent
    directly on the raw graph documents (now internally batched for
    token safety). No timeline/chronology pre-processing stage."""
    radonc_agent = RadiationOncologySummaryAgent(llm_synthesis)
    state = await radonc_agent.run(state)  # type: ignore[arg-type]
    return state


# ============================================================
# INITIAL STATE FACTORY
# ============================================================

def build_radonc_initial_state(
    request: ClinicalRequest,
    graph_docs: List[Dict],
    dob: Optional[str] = None,
    sex: Optional[str] = None,
    age: Optional[int] = None,
    patient_name: Optional[str] = None,
) -> RadOncState:
    return RadOncState(
        patient_id=request.patient_id,
        doctor_id=request.doctor_id,
        consultation_text=request.consultation_text,
        specialty=request.specialty,
        graph_documents=graph_docs,
        dob=dob,
        sex=sex,
        age=age,
        patient_name=patient_name,
        radonc_summary=None,
        errors=[],
        agent_timings={},
    )


# ============================================================
# API ENDPOINT — DIRECT CALL (no queue, no background task)
# ============================================================

@router.post("/radiation-oncology-summary")
async def get_radiation_oncology_summary(request: ClinicalRequest):
    """
    Direct (synchronous) endpoint — fetches graph data, generates the
    Radiation Oncology specialty paragraph summary, saves it to the
    `radiation_oncology_summary` Mongo collection, and returns it in the
    same request/response cycle.
    """
    start_ms = datetime.now().timestamp() * 1000
    logger.info(
        f"RadOnc summary request | patient={request.patient_id} | doctor={request.doctor_id}"
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

        initial_state = build_radonc_initial_state(
            request,
            graph_docs,
            dob=demographics.get("dob"),
            sex=demographics.get("sex"),
            age=age,
            patient_name=demographics.get("name"),
        )

        result = await run_radonc_pipeline(initial_state)

        elapsed = round(datetime.now().timestamp() * 1000 - start_ms)

        logger.info(
            f"RadOnc summary complete | patient={request.patient_id} | "
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
            "version":            "radonc-1.1.0",
            "module_overview":    RADONC_OVERVIEW,

            "summary": result.get("radonc_summary", {}),
        }

        # ---- Persist to Mongo (dedicated collection for this specialty) ----
        try:
            mongo_doc = dict(response)
            mongo_doc["generated_at"] = generated_at_dt  # store as datetime, not str
            await radonc_collection.insert_one(mongo_doc)
        except Exception as e:
            logger.error(
                f"MongoDB save failed for radiation_oncology_summary | "
                f"patient={request.patient_id} | {e}"
            )
            result.get("errors", []).append(f"mongo-save: {str(e)}")

        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(
            f"RadOnc summary pipeline failed | patient={request.patient_id} | {e}"
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/radiation-oncology/health")
async def radonc_health():
    return {
        "status": "ok",
        "version": "radonc-1.1.0",
        "module_overview": RADONC_OVERVIEW,
        "pipeline": [
            "A2R-RadiationOncologySummary — runs in token-safe batches "
            "(bounded by doc count AND evidence char volume), merged "
            "deterministically (zero extra LLM calls) into one final summary"
        ],
        "storage_collection": "radiation_oncology_summary",
        "groq_max_tokens": GROQ_MAX_TOKENS,
        "radonc_synthesis_max_tokens": RADONC_SYNTHESIS_MAX_TOKENS,
        "token_safety": {
            "batch_max_docs":              RADONC_BATCH_MAX_DOCS,
            "batch_max_evidence_chars":     RADONC_BATCH_MAX_EVIDENCE_CHARS,
            "per_entity_evidence_cap_chars": RADONC_EVIDENCE_TRUNCATE_CHARS,
            "merge_llm_calls": 0,
            "note": (
                "Fixes groq.BadRequestError 400 'Please reduce the length of "
                "the messages or completion' (seen with a 79-document "
                "patient) by never sending more than batch_max_docs "
                "documents OR batch_max_evidence_chars of evidence text in "
                "a single prompt. Batches run concurrently; results are "
                "merged with plain Python (no LLM)."
            ),
        },
    }