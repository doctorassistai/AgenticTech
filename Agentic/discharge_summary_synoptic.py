"""
CCGI Discharge Summary Agent — Two-Tab Output · Synoptic Report · Zero-Prediction Labeling · Token-Safe
==========================================================================================
v5.4.0 — AddsFULL QUICK FACTS + DATE OVERVIEW SUMMARY on top of v5.3.0's
3-level drill-down:

  DATE OVERVIEW SUMMARY  (new, inside every "clinical_day" block in
  "timeline_tab", Level 2)
    Each date block now carries a "date_overview_summary" — a short
    NATURAL-LANGUAGE PARAGRAPH describing, in plain sentences, what
    happened across ALL documents filed on that date (e.g. "On this
    date, 4 documents were filed: Doctor Progress Note, Nursing Note,
    Medication Chart, and Post Op Notes. The patient was diagnosed with
    transitional cell carcinoma of the bladder, grade 3, and was
    reviewed post-TURBT. Notable abnormalities include hypotension
    (BP 90/60 mmHg) and low haemoglobin. Medications given include
    Inj. Ceftriaxone 1 g IV BD. Plan: continue IV antibiotics, monitor
    urine output hourly, and urology follow-up in 2 weeks."). This sits
    ABOVE the per-document list so a doctor gets the whole day's picture
    in one read before opening any single document. The existing
    "date_index" (Level 1) one-liner is unchanged and still exists as
    the very first, ultra-short screen.

  FULL QUICK FACTS  (expanded — every document's "quick_facts" now
  covers ALL 9 DS2-extracted categories, not just 3)
    Previously quick_facts only exposed abnormalities / medications /
    treatment_plan. Doctors asked to see the same fast, one-line-per-item
    view for the REST of the extracted data too, so nothing requires
    reading the full narrative to find. Every document's "quick_facts"
    now has:
      vitals            ["BP 90/60 mmHg (hypotension)", ...]
      medications        ["Inj. Ceftriaxone 1 g IV BD", ...]
      investigations      ["Haemoglobin 7.2 g/dL (low, ref 13-17 g/dL)", ...]
      procedures           ["TURBT — bulk, deep, random biopsy resection", ...]
      findings              ["Abdomen soft, non-tender", ...]
      diagnoses              ["Transitional cell carcinoma grade 3", ...]
      treatments              ["Ankle pumps every 2 hours for DVT prophylaxis", ...]
      abnormalities             ["Haemoglobin 7.2 g/dL (low, ref 13-17 g/dL)", ...]
      treatment_plan              ["Continue IV antibiotics", "Urology follow-up in 2 weeks", ...]
                                   (treatments actually given + recommendations/orders,
                                    combined — this is what a doctor means by
                                    "treatment plan" for that note/report)
    Every list item is a single, clipped, ONE-LINE string — never a
    paragraph — so the doctor can scan a document's quick facts in a few
    seconds. Nothing from DS2's 9 extracted categories is left out of
    quick_facts anymore.

  ZERO DATA LOSS IN SUMMARIES  (reinforced, not new)
    "_narrate_document" (Level 3 full narrative) already wove ALL 9
    DS2-extracted categories into prose (findings, diagnoses,
    procedures, vitals, investigations, medications, treatments,
    abnormalities, recommendations) — this is retained unchanged. The
    new "_build_date_overview_summary" reuses the SAME per-document
    narrative sentences (via the documents' own findings/diagnoses/
    abnormalities/recommendations) so the date-level paragraph never
    invents or drops information not already extracted by DS2.

  Both additions are pure deterministic Python (no LLM call), built in
  the SAME single pass over DS2's already-extracted data as every other
  Level-1/2/3/Tab-2 field, so they add ZERO additional token/latency
  cost regardless of patient document volume (RULE 5, unchanged).

  All v5.0.0 → v5.3.0 rules are retained unchanged:

  RULE 1 · NO PREDICTED DOCUMENT LABELS
    There is no agent that predicts what kind of document something is.
    Every document is identified purely by the graph's own `document`
    field — cleaned up for display only (strip extension, replace
    `_`/`-` with spaces, title-case). Nothing about the label is
    inferred or guessed.

  RULE 2 · OP, NOT IP — FIRST VISIT ONLY
    Admission context comes from the patient's FIRST OP (outpatient)
    appointment with this doctor, not the latest IP (inpatient) one.
    Only two fields are pulled from it: the visit date and the chief
    complaint. Nothing else.

  RULE 3 · ZERO EVIDENCE LOSS, ZERO DOCUMENT COMPRESSION
    Every entity's evidence is preserved and extracted in full.
    When more than one document shares the same date, they are NEVER
    merged, blended, or summarised into a single paragraph. Each date
    section lists its documents ONE BY ONE, each with its own
    independent synoptic table AND its own independent narrative
    timeline entry AND its own independent (now FULL) quick_facts. The
    new date_overview_summary sits ABOVE these per-document entries as
    an additive orientation aid — it never replaces or compresses the
    individual per-document entries.

  RULE 4 · SYNOPTIC REPORT OUTPUT (NOT PLAIN-TEXT NARRATIVE)
    Tab 2's discharge output is a true synoptic report — following the
    CAP/ACS/mCODE-style synoptic architecture (Data Element +
    Predefined/Discrete Response), not a dictated narrative paragraph.
    (Tab 1's per-document narrative + quick_facts is intentionally the
    opposite style — plain prose / one-liners — so doctors can quickly
    read the story; Tab 2 stays structured for auditing/coding purposes.)

  RULE 5 · TOKEN-SAFE FOR HIGH DOCUMENT VOLUME (50+ DOCS)
    Two independent safeguards:
      (a) DS2 (the only LLM step that scales with document volume)
          batches documents using BOTH a document-count ceiling AND a
          cumulative evidence-character ceiling.
      (b) BOTH tab-building stages (DS4) are 100% deterministic Python
          — there is NO LLM call in that stage at all — so formatting
          the final report (any of the 3 levels, including narrative
          text, full quick_facts, and the new date_overview_summary)
          never contributes to token cost or truncation risk, no
          matter how many documents (50, 100, or more) the patient has.
      (c) DS5's quality-audit prompt only ever receives a BOUNDED
          preview of the synoptic text (QUALITY_PREVIEW_CHARS) plus
          small counts/lists — never the full timeline/date_index/
          quick_facts/date_overview_summary payload — so DS5's token
          cost is flat regardless of how large the 3-level drill-down
          output is.

  RULE 6 · NULL-DATE HANDLING (retained)
    Documents with no recoverable date appear under "Date Unknown" in
    ALL 3 levels, including the new date_overview_summary.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, TypedDict

from fastapi import APIRouter, HTTPException
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorClient
from neo4j import AsyncGraphDatabase
from pydantic import BaseModel

from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import StateGraph, END


# ═══════════════════════════════════════════════════════════════
# ENVIRONMENT
# ═══════════════════════════════════════════════════════════════

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
NEO4J_URI = os.getenv("NEO4J_URI")
NEO4J_USER = os.getenv("NEO4J_USER")
NEO4J_PASS = os.getenv("NEO4J_PASSWORD")
MONGO_URI    = os.getenv("MONGO_URI")
MONGO_DB     = os.getenv("MONGO_DB", "doctorassistai")

# ── Token-safety knobs (RULE 5) ──────────────────────────────────
# Max documents in one DS2 (EvidenceAnalyzer) batch.
BATCH_SIZE = int(os.getenv("DISCHARGE_BATCH_SIZE", "5"))
# Max cumulative evidence characters in one DS2 batch, REGARDLESS of how
# many documents that is — a batch closes as soon as either ceiling hits.
MAX_BATCH_EVIDENCE_CHARS = int(os.getenv("DISCHARGE_MAX_BATCH_CHARS", "6000"))
# Hard cap on a single entity's evidence text before it ever enters a batch.
EVIDENCE_TRUNCATE_CHARS = int(os.getenv("DISCHARGE_EVIDENCE_TRUNCATE_CHARS", "1200"))
# Dedicated token budget for DS2's extraction call (kept generous since it
# is the only step doing heavy JSON extraction).
DS2_MAX_TOKENS = int(os.getenv("DISCHARGE_DS2_MAX_TOKENS", "8000"))
# Bounded preview length fed into the DS5 quality-audit prompt so that
# stage never scales with total report size either.
QUALITY_PREVIEW_CHARS = int(os.getenv("DISCHARGE_QUALITY_PREVIEW_CHARS", "3000"))
# Max length (characters) of any Level-1/Level-2 one-line summary string.
ONE_LINE_MAX_CHARS = int(os.getenv("DISCHARGE_ONE_LINE_MAX_CHARS", "180"))
# Max length (characters) of the new per-date natural-language overview
# paragraph (Level 2, sits above the per-document list for that date).
DATE_OVERVIEW_MAX_CHARS = int(os.getenv("DISCHARGE_DATE_OVERVIEW_MAX_CHARS", "700"))

# Sentinel for documents whose date cannot be determined
NULL_DATE_KEY = "UNKNOWN_DATE"

mongo_client = AsyncIOMotorClient(MONGO_URI)
mongo_db     = mongo_client[MONGO_DB]

neo4j_driver = AsyncGraphDatabase.driver(
    NEO4J_URI,
    auth=(NEO4J_USER, NEO4J_PASS),
    max_connection_lifetime=3600,
    max_connection_pool_size=50,
)

# Heavy model for clinical extraction (DS2 only — the sole LLM call that
# scales with document volume; batching keeps each call bounded).
llm_synthesis = ChatGroq(
    model="llama-3.3-70b-versatile",
    temperature=0.0,
    max_tokens=DS2_MAX_TOKENS,
    groq_api_key=GROQ_API_KEY,
)

# Light model for the quality audit (bounded preview input).
llm_light = ChatGroq(
    model="llama-3.1-8b-instant",
    temperature=0.1,
    max_tokens=4000,
    groq_api_key=GROQ_API_KEY,
)

router = APIRouter(prefix="", tags=["Discharge Summary"])


# ═══════════════════════════════════════════════════════════════
# REQUEST / RESPONSE MODELS
# ═══════════════════════════════════════════════════════════════

class DischargeSummaryRequest(BaseModel):
    patient_id:            str
    doctor_id:              str
    specialty:              str
    include_intermediates:  bool = False
    batch_size:              Optional[int] = None


# ═══════════════════════════════════════════════════════════════
# PIPELINE STATE
# ═══════════════════════════════════════════════════════════════

class DischargeState(TypedDict):
    patient_id:   str
    doctor_id:    str
    specialty:    str

    admission_reason: Optional[str]   # chief complaint, first OP visit only
    admission_date:   Optional[str]   # date of first OP visit
    patient_dob:      Optional[str]
    patient_sex:      Optional[str]
    patient_name:     Optional[str]

    graph_documents:   List[Dict]              # raw from Neo4j
    prepared_documents: Optional[List[Dict]]   # after DS1 (label + evidence prep)
    document_batches:   Optional[List[List[Dict]]]
    batch_analyses:      Optional[List[Dict]]
    date_merged:          Optional[Dict]

    discharge_summary:    Optional[str]         # TAB 2 — synoptic report, plain text
    day_wise_timeline:    Optional[List[Dict]]  # legacy full JSON (kept for compatibility)

    timeline_tab:          Optional[List[Dict]]  # TAB 1, Level 2/3 — date blocks -> documents -> summary/quick_facts
    date_index:              Optional[List[Dict]]  # TAB 1, Level 1 — flat date-wise summary list
    synoptic_tab:           Optional[List[Dict]]  # TAB 2 — structured JSON (date -> docs -> elements)

    quality_report:        Optional[Dict]

    errors:        List[str]
    agent_timings: Dict[str, float]


# ═══════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════

def _elapsed(start: float) -> float:
    return round((datetime.now().timestamp() - start) * 1000, 1)


def parse_llm_json(text: str) -> Any:
    if not text:
        return {}
    text = text.strip()
    text = re.sub(r"```json\s*", "", text)
    text = re.sub(r"```\s*", "", text)
    match = re.search(r"(\{.*\}|\[.*\])", text, re.DOTALL)
    if match:
        text = match.group(0)
    try:
        return json.loads(text)
    except Exception:
        return {"raw_output": text}


def _normalise_date(raw: Any) -> Optional[str]:
    if raw is None:
        return None
    s = str(raw).strip()
    if s.lower() in ("", "null", "none"):
        return None
    if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        return s
    m = re.match(r"^(\d{2})[/\-](\d{2})[/\-](\d{4})$", s)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    month_map = {
        "jan": "01", "feb": "02", "mar": "03", "apr": "04",
        "may": "05", "jun": "06", "jul": "07", "aug": "08",
        "sep": "09", "oct": "10", "nov": "11", "dec": "12",
    }
    m2 = re.match(r"^(\d{2})-([A-Za-z]{3})-(\d{4})$", s)
    if m2:
        mon = month_map.get(m2.group(2).lower())
        if mon:
            return f"{m2.group(3)}-{mon}-{m2.group(1)}"
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    logger.warning(f"Could not parse date string: '{s}'")
    return None


def _label_from_filename(filename: str) -> str:
    """
    RULE 1 — deterministic, NO LLM, NO prediction.
    Derives a human-readable label purely by cleaning up the graph's own
    `document` field for display. This is a text-formatting transform of
    the same string already in the graph — it is NOT a clinical
    classification and does not attempt to guess what kind of document
    this is.
    """
    if not filename or filename == "unknown":
        return "Clinical Document"
    name = filename
    for ext in (".pdf", ".docx", ".doc", ".txt", ".jpg", ".jpeg", ".png"):
        if name.lower().endswith(ext):
            name = name[: -len(ext)]
            break
    name = name.replace("_", " ").replace("-", " ").strip()
    if not name:
        return "Clinical Document"
    words = []
    for w in name.split():
        # Preserve already-uppercase tokens (e.g. "CBC", "ECG") as-is.
        words.append(w if (w.isupper() and len(w) > 1) else w.capitalize())
    return " ".join(words)


def _truncate_evidence(text: str, limit: int = EVIDENCE_TRUNCATE_CHARS) -> str:
    if not text:
        return text
    if len(text) <= limit:
        return text
    return text[:limit] + " …[truncated for token safety]"


def _smart_batch_documents(
    docs: List[Dict],
    max_docs_per_batch: int = BATCH_SIZE,
    max_chars_per_batch: int = MAX_BATCH_EVIDENCE_CHARS,
) -> List[List[Dict]]:
    """
    RULE 5(a) — the primary token-safety mechanism.
    Splits prepared documents into batches bounded by BOTH document count
    AND total evidence character volume, so a batch never overflows the
    LLM's usable context/output budget — whether the patient has many
    documents (50+) or just a few unusually large ones. A batch closes
    the moment either ceiling would be exceeded by the next document.
    """
    batches: List[List[Dict]] = []
    current: List[Dict] = []
    current_chars = 0

    for doc in docs:
        doc_chars = sum(
            len(e.get("evidence_text", "")) for e in doc.get("all_evidence", [])
        )
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


class BaseAgent:
    def __init__(self, llm_instance):
        self.llm = llm_instance

    async def _invoke(self, system: str, user: str) -> Any:
        response = await self.llm.ainvoke([
            SystemMessage(content=system),
            HumanMessage(content=user),
        ])
        return parse_llm_json(response.content)

    def _elapsed(self, start: float) -> float:
        return _elapsed(start)


# ═══════════════════════════════════════════════════════════════
# DATA FETCHERS
# ═══════════════════════════════════════════════════════════════

async def fetch_graph_documents(patient_id: str) -> List[Dict]:
    """
    Fetch every document node + all its evidence entities from Neo4j.
    The full evidence_text of every entity is preserved — nothing is
    dropped. `document` here is the RAW graph field — this is the only
    identifier ever used to label a document downstream (RULE 1).
    """
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

    WITH document, document_date, raw_date,
        collect({
            relation:    type(r),
            entity_type: CASE
                WHEN n:Treatment     THEN "Treatment"
                WHEN n:Procedure     THEN "Procedure"
                WHEN n:Diagnosis     THEN "Diagnosis"
                WHEN n:Medication    THEN "Medication"
                WHEN n:LabResult     THEN "Lab Result"
                WHEN n:VitalSign     THEN "Vital Sign"
                WHEN n:Finding       THEN "Finding"
                WHEN n:Anatomy       THEN "Anatomy"
                WHEN n:Investigation THEN "Investigation"
                WHEN n:Measurement   THEN "Measurement"
                WHEN n:Symptom       THEN "Symptom"
                WHEN n:Allergy       THEN "Allergy"
                WHEN n:Order         THEN "Order"
                WHEN n:Instruction   THEN "Instruction"
                WHEN n:Observation   THEN "Observation"
                WHEN n:Note          THEN "Note"
                ELSE head(labels(n))
            END,
            entity_name: coalesce(n.name, n.value, n.description, ""),
            date:        e.date,
            evidence:    e.evidence_text
        }) AS entities

    RETURN document, document_date, entities
    ORDER BY document_date ASC
    """
    try:
        async with neo4j_driver.session() as session:
            result = await session.run(cypher, patient_id=patient_id)
            docs: List[Dict] = []

            async for record in result:
                document_date = record["document_date"]
                entities      = record["entities"]

                if document_date is None:
                    for ent in entities:
                        recovered = _normalise_date(ent.get("date"))
                        if recovered:
                            document_date = recovered
                            break

                docs.append({
                    "document":      record["document"],
                    "document_date": _normalise_date(document_date),
                    "entities":      entities,
                })

            logger.info(f"Graph fetch: {len(docs)} docs for patient {patient_id}")
            for d in docs:
                logger.info(
                    f"  FETCHED → {d['document']} | date={d['document_date']} | "
                    f"entities={len(d['entities'])}"
                )
            return docs

    except Exception as e:
        logger.error(f"Neo4j fetch failed for patient {patient_id}: {e}")
        raise


async def fetch_admission_context(patient_id: str, doctor_id: str) -> Dict:
    """
    RULE 2 — OP, not IP. Pulls ONLY the date and chief complaint from the
    patient's FIRST (earliest) OP appointment with this doctor. No other
    IP-specific fields are used.
    """
    result = {
        "admission_reason": None,
        "admission_date":   None,
        "patient_dob":      None,
        "patient_sex":      None,
        "patient_name":     None,
    }
    try:
        appt_doc = await mongo_db["patient_appointments"].find_one(
            {"sys_user_id": patient_id}, {"appointments": 1}
        )
        if appt_doc:
            op_appts = [
                a for a in appt_doc.get("appointments", [])
                if a.get("doctor_id") == doctor_id
                and a.get("visit_type", "").upper() == "OP"
            ]
            if op_appts:
                # FIRST OP visit — earliest by appointment date, falling
                # back to created_at if the date field is missing/blank.
                def _sort_key(a: Dict) -> str:
                    return a.get("date") or a.get("created_at") or "9999-99-99"

                op_appts.sort(key=_sort_key)  # ascending → earliest first

                first = op_appts[0]
                result["admission_reason"] = first.get("chief_complaint")
                result["admission_date"]   = first.get("date")
    except Exception as e:
        logger.warning(f"Could not fetch first OP appointment for {patient_id}: {e}")

    try:
        patient = await mongo_db["patient_users"].find_one(
            {"sys_user_id": patient_id},
            {"_id": 0, "date_of_birth": 1, "gender": 1, "full_name": 1, "name": 1},
        )
        if patient:
            result["patient_dob"]  = patient.get("date_of_birth")
            result["patient_sex"]  = patient.get("gender")
            result["patient_name"] = patient.get("full_name") or patient.get("name")
    except Exception as e:
        logger.warning(f"Could not fetch demographics for {patient_id}: {e}")

    return result


# ═══════════════════════════════════════════════════════════════
# DS1 · DOCUMENT PREPARER — deterministic, NO LLM CALL
# ═══════════════════════════════════════════════════════════════
# Replaces the old DS0 (LLM label-predictor) + DS1 (batch builder).
# Every document keeps its raw graph `document` field verbatim; the
# display label is a pure text transform of that same field (RULE 1).
# Also performs evidence truncation and smart batching for DS2 (RULE 5).
# ═══════════════════════════════════════════════════════════════

class DocumentPreparerAgent(BaseAgent):
    agent_id = "DS1"

    async def run(self, state: DischargeState) -> DischargeState:
        logger.info(f"{self.agent_id} · DocumentPreparer — START (no LLM)")
        t0 = datetime.now().timestamp()

        raw_docs = state["graph_documents"]
        prepared: List[Dict] = []

        for doc in raw_docs:
            filename = doc.get("document", "unknown")

            all_evidence = []
            for ent in doc.get("entities", []):
                ev = (ent.get("evidence") or "").strip()
                if ev:
                    all_evidence.append({
                        "entity_type":   ent.get("entity_type", ""),
                        "entity_name":   ent.get("entity_name", ""),
                        "relation":      ent.get("relation", ""),
                        "evidence_text": _truncate_evidence(ev),
                    })

            if not all_evidence:
                logger.debug(f"{self.agent_id} · Skipping {filename} — no evidence text")
                continue

            prepared.append({
                "document":       filename,                       # raw graph field, verbatim
                "document_date":  doc.get("document_date"),
                "document_label": _label_from_filename(filename),  # deterministic display label
                "all_evidence":   all_evidence,
            })

        # Sort: dated docs first (ascending), undated last.
        prepared.sort(key=lambda d: (0, d["document_date"]) if d["document_date"] else (1, ""))

        batches = _smart_batch_documents(prepared)

        state["prepared_documents"]           = prepared
        state["document_batches"]             = batches
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(
            f"{self.agent_id} · DocumentPreparer — DONE "
            f"({state['agent_timings'][self.agent_id]}ms) | "
            f"{len(prepared)} docs prepared into {len(batches)} token-safe batch(es)"
        )
        return state


# ═══════════════════════════════════════════════════════════════
# DS2 · EVIDENCE ANALYZER — verbatim extraction, per-doc sections
# ═══════════════════════════════════════════════════════════════
# Only LLM step that scales with document volume. Batches come from DS1's
# smart batching (bounded by count AND evidence char volume — RULE 5a).
# ═══════════════════════════════════════════════════════════════

_DS2_SYSTEM_TEMPLATE = """\
You are a senior {specialty} clinician extracting structured clinical data from
hospital discharge documents. You are reading raw evidence text extracted from a
knowledge graph — this evidence comes from ALL types of hospital documents including:

  Doctor Progress Notes, Senior/Consultant Round Notes, Intern Notes
  Nursing Progress Notes, Nursing Assessment Notes, Night Duty Notes
  ICU/HDU Progress Notes, Post-operative Notes, Anaesthesia Notes
  Operative / Procedure Notes (TURBT, laparoscopy, endoscopy, etc.)
  Consultation Notes, Specialist Referral Notes
  Investigation Reports: Lab (CBC, LFT, RFT, coagulation, cultures, ABG, hormones,
    tumour markers, microbiology, blood bank), Imaging (X-ray, CT, MRI, USG, Echo,
    PET), Histopathology, Cytology, Biopsy, PFT, EMG, Endoscopy, Cystoscopy
  Vital Signs Charts, Fluid Balance Charts, Input-Output Charts
  Medication Administration Records / Medication Charts
  Blood Transfusion Records
  Physiotherapy / OT / Speech / Dietary Notes
  Wound Care Records, Discharge Instructions, Transfer Notes

ABSOLUTE RULES:
1. ZERO SUMMARISATION — reproduce every finding, value, measurement, drug, instruction,
   and observation exactly as it appears in the evidence text. Do NOT condense, merge,
   or leave anything out.
2. Extract ALL 9 clinical categories per document (leave empty list [] only if
   truly absent from evidence — not because you chose not to extract).
3. Flag EACH document's own abnormalities (out-of-range values, critical findings,
   unexpected results, danger signs).
4. Extract EACH document's own recommendations / plans / suggestions (anything the
   author wrote as next steps, orders, advice, follow-up, review instructions).
5. Group documents by document_date. Documents with date '{null_key}' go under
   that exact key — do NOT discard them.
6. NEVER merge two different documents' data together, even if they share the same
   date — each document in the batch produces its OWN separate entry in "documents".
7. Return ONLY valid JSON — no prose outside the JSON.
"""

_DS2_PROMPT_TEMPLATE = """\
SPECIALTY       : {specialty}
FIRST-VISIT COMPLAINT (OP): {admission_reason}
BATCH           : {batch_num} of {batch_total}
DOCUMENTS IN BATCH: {batch_len}

══════════════════════════════════════════════════════════════
DOCUMENTS (each contains all_evidence from the knowledge graph, plus
its own raw `document` filename and `document_label`)
══════════════════════════════════════════════════════════════
{batch_json}

══════════════════════════════════════════════════════════════
EXTRACTION TASK — For EVERY document in this batch (each document below
is its OWN, SEPARATE entry — never combine two documents together):
══════════════════════════════════════════════════════════════

Read each item in all_evidence (entity_type + evidence_text).
Extract the following 9 categories — pull EVERY value/item found:

  vitals         BP, HR, RR, Temperature, SpO2, Weight, Height, BMI,
                 GCS, Pain score, Oxygen flow, Urine output, CVP, etc.
                 Format: [{{"parameter":"...","value":"...","unit":"...","note":"..."}}]

  medications    Every drug: name, dose, route, frequency, duration.
                 Includes IV fluids, infusions, eye drops, inhalers, patches.
                 Format: [{{"drug":"...","dose":"...","route":"...","frequency":"...","duration":"..."}}]

  investigations Every test ordered or resulted: name, result, unit, reference range,
                 status (normal/abnormal/critical/pending).
                 Includes labs, imaging findings, cultures, ECG, PFT, ABG, etc.
                 Format: [{{"test":"...","result":"...","unit":"...","reference_range":"...","status":"..."}}]

  procedures     Every procedure, intervention, operation, biopsy, scope, line
                 insertion, catheterisation, transfusion, wound care.
                 Format: [{{"name":"...","detail":"...","laterality":"...","surgeon":"..."}}]

  findings       All clinical findings, observations, examination findings,
                 imaging findings, histological findings, symptoms, complaints.
                 Format: ["finding 1","finding 2"]

  diagnoses      All confirmed or provisional diagnoses, differential diagnoses,
                 pathological diagnoses, grading/staging.
                 Format: ["diagnosis 1","diagnosis 2"]

  treatments     Non-medication therapies: physiotherapy, oxygen therapy, nebulisation,
                 wound care instructions, dietary restrictions, mobilisation plan,
                 blood transfusion plan, isolation precautions, palliative measures.
                 Format: ["treatment 1","treatment 2"]

  abnormalities  ANY finding in this document that is:
                 • outside normal reference range (state the value and the range)
                 • clinically critical or danger-level
                 • unexpected for this patient's context
                 • flagged as HIGH / LOW / CRITICAL in the evidence
                 Format: ["Haemoglobin 7.2 g/dL (low, ref 12-16)", "BP 90/60 mmHg (hypotension)"]

  recommendations  Everything written as next steps, clinical plans, orders given,
                 follow-up instructions, advice to patient/family, referral requests,
                 review timings, discharge criteria, wound review dates.
                 Includes "Plan:", "Advice:", "To do:", "For review:", "Suggested:" etc.
                 Format: ["recommendation 1","recommendation 2"]

══════════════════════════════════════════════════════════════
OUTPUT FORMAT — ONLY valid JSON, no other text:
══════════════════════════════════════════════════════════════
{{
  "YYYY-MM-DD": {{
    "documents": [
      {{
        "document_label":    "... (use the document_label given to you as-is)",
        "filename":          "... (use the document field given to you as-is)",
        "vitals":            [...],
        "medications":       [...],
        "investigations":    [...],
        "procedures":        [...],
        "findings":          [...],
        "diagnoses":         [...],
        "treatments":        [...],
        "abnormalities":     [...],
        "recommendations":   [...]
      }}
    ]
  }},
  "{null_key}": {{
    "documents": [...]
  }}
}}
"""


class EvidenceAnalyzerAgent(BaseAgent):
    agent_id = "DS2"

    async def _analyze_batch(
        self,
        batch:            List[Dict],
        batch_index:      int,
        batch_total:      int,
        specialty:        str,
        admission_reason: Optional[str],
    ) -> Dict:
        system = _DS2_SYSTEM_TEMPLATE.format(
            specialty=specialty,
            null_key=NULL_DATE_KEY,
        )

        prompt = _DS2_PROMPT_TEMPLATE.format(
            specialty        = specialty,
            admission_reason = admission_reason or "Not documented",
            batch_num        = batch_index + 1,
            batch_total      = batch_total,
            batch_len        = len(batch),
            batch_json       = json.dumps(batch, indent=2, default=str),
            null_key         = NULL_DATE_KEY,
        )

        return await self._invoke(system, prompt)

    async def run(self, state: DischargeState) -> DischargeState:
        logger.info(f"{self.agent_id} · EvidenceAnalyzer — START (concurrent, token-safe batches)")
        t0 = datetime.now().timestamp()

        batches          = state["document_batches"] or []
        specialty        = state["specialty"]
        admission_reason = state.get("admission_reason")
        batch_total      = len(batches)

        if not batches:
            state["batch_analyses"]               = []
            state["agent_timings"][self.agent_id] = self._elapsed(t0)
            return state

        tasks = [
            self._analyze_batch(batch, i, batch_total, specialty, admission_reason)
            for i, batch in enumerate(batches)
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        analyses = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"{self.agent_id} · Batch {i} failed: {result}")
                state["errors"].append(f"DS2 batch {i}: {str(result)}")
            else:
                analyses.append(result)

        state["batch_analyses"]               = analyses
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(
            f"{self.agent_id} · EvidenceAnalyzer — DONE "
            f"({state['agent_timings'][self.agent_id]}ms) | "
            f"{len(analyses)}/{batch_total} batches"
        )
        return state


# ═══════════════════════════════════════════════════════════════
# DS3 · DATE AGGREGATOR
# ═══════════════════════════════════════════════════════════════
# Merges batch outputs into one date-keyed dict. De-duplicates by
# filename ONLY — documents are never merged/blended together even when
# they share a date (RULE 3). Each document keeps its own independent
# entry in the date's "documents" list.
# ═══════════════════════════════════════════════════════════════

class DateAggregatorAgent(BaseAgent):
    agent_id = "DS3"

    async def run(self, state: DischargeState) -> DischargeState:
        logger.info(f"{self.agent_id} · DateAggregator — START")
        t0 = datetime.now().timestamp()

        batch_analyses = state.get("batch_analyses") or []
        admission_date = state.get("admission_date")

        merged: Dict[str, Dict] = {}

        for batch_result in batch_analyses:
            if not isinstance(batch_result, dict):
                continue
            for date_key, date_data in batch_result.items():
                if not isinstance(date_data, dict):
                    continue
                if date_key not in merged:
                    merged[date_key] = {"documents": []}

                existing_filenames = {
                    d.get("filename", "") for d in merged[date_key]["documents"]
                }
                for doc_entry in date_data.get("documents", []):
                    fname = doc_entry.get("filename", "")
                    if fname and fname in existing_filenames:
                        continue  # already have this exact document for this date
                    merged[date_key]["documents"].append(doc_entry)
                    if fname:
                        existing_filenames.add(fname)

        if not merged:
            state["date_merged"]                  = {}
            state["agent_timings"][self.agent_id] = self._elapsed(t0)
            return state

        known_dates   = sorted(k for k in merged if k != NULL_DATE_KEY)
        has_null_docs = NULL_DATE_KEY in merged

        if admission_date:
            try:
                adm_str = datetime.strptime(admission_date[:10], "%Y-%m-%d").strftime("%Y-%m-%d")
            except Exception:
                adm_str = known_dates[0] if known_dates else None
        else:
            adm_str = known_dates[0] if known_dates else None

        for date_key in known_dates:
            try:
                current_dt = datetime.strptime(date_key, "%Y-%m-%d")
                adm_dt_obj = datetime.strptime(adm_str, "%Y-%m-%d") if adm_str else current_dt
                day_num    = (current_dt - adm_dt_obj).days + 1
            except Exception:
                day_num = None

            if day_num == 1:
                date_label = "First OP Visit Day"
            elif day_num is not None and day_num > 1:
                date_label = f"Day {day_num} After First Visit"
            elif day_num is not None and day_num <= 0:
                date_label = f"Pre-Visit ({date_key})"
            else:
                date_label = date_key

            merged[date_key]["day_number"] = day_num
            merged[date_key]["date_label"] = date_label
            merged[date_key]["date"]       = date_key

        if has_null_docs:
            merged[NULL_DATE_KEY]["day_number"] = None
            merged[NULL_DATE_KEY]["date_label"] = "Date Unknown"
            merged[NULL_DATE_KEY]["date"]       = NULL_DATE_KEY

        state["date_merged"]                  = merged
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(
            f"{self.agent_id} · DateAggregator — DONE "
            f"({state['agent_timings'][self.agent_id]}ms) | "
            f"{len(known_dates)} dated + {'1 undated' if has_null_docs else '0 undated'} block(s)"
        )
        return state


# ═══════════════════════════════════════════════════════════════
# DS4 · THREE-LEVEL REPORT BUILDER — 100% DETERMINISTIC, NO LLM CALL
# ═══════════════════════════════════════════════════════════════
# RULE 4 (synoptic format) + RULE 5(b) (zero token cost for report
# assembly, regardless of document count). Builds ALL THREE drill-down
# levels + Tab 2 from the same date_merged data:
#   LEVEL 1 — date_index    : flat, one row per date, one-line summary
#   LEVEL 2 — timeline_tab  : date blocks (now carrying a
#             "date_overview_summary" natural-language paragraph) ->
#             documents -> one-line preview
#   LEVEL 3 — (inside each timeline_tab document) full narrative +
#             quick_facts. quick_facts now covers ALL 9 DS2-extracted
#             categories (vitals, medications, investigations,
#             procedures, findings, diagnoses, treatments,
#             abnormalities, treatment_plan), each a list of one-liners.
#   TAB 2   — synoptic_tab  : structured [Element ID]/[Data Element]/[Value]
#                             rows, plus discharge_summary (plain text)
# Every category extracted by DS2 is rendered per document; documents
# sharing a date are ALWAYS listed one by one, never blended.
# ═══════════════════════════════════════════════════════════════

_ELEMENT_PREFIX = {
    "vitals":          "VIT",
    "medications":     "MED",
    "investigations":  "INV",
    "procedures":       "PROC",
    "findings":         "FIND",
    "diagnoses":         "DX",
    "treatments":         "TX",
    "abnormalities":       "ABN",
    "recommendations":      "REC",
}

_ELEMENT_LABEL = {
    "vitals":          "Vital Parameter",
    "medications":     "Medication",
    "investigations":  "Investigation / Lab Result",
    "procedures":       "Procedure",
    "findings":         "Finding / Observation",
    "diagnoses":         "Diagnosis",
    "treatments":         "Treatment / Therapy",
    "abnormalities":       "Abnormality / Alert",
    "recommendations":      "Recommendation / Plan",
}


def _sorted_date_keys(date_merged: Dict) -> List[str]:
    known   = sorted(k for k in date_merged if k != NULL_DATE_KEY)
    unknown = [NULL_DATE_KEY] if NULL_DATE_KEY in date_merged else []
    return known + unknown


def _fmt_vital_value(v: Dict) -> str:
    val = f"{v.get('value','')}".strip()
    if v.get("unit"):
        val += f" {v['unit']}"
    if v.get("note"):
        val += f" ({v['note']})"
    return val.strip()


def _fmt_med_value(m: Dict) -> str:
    parts = [m.get("drug", "")]
    if m.get("dose"):      parts.append(m["dose"])
    if m.get("route"):     parts.append(f"({m['route']})")
    if m.get("frequency"): parts.append(m["frequency"])
    if m.get("duration"):  parts.append(f"× {m['duration']}")
    return "  ".join(p for p in parts if p)


def _fmt_inv_value(i: Dict) -> str:
    val = f"{i.get('result','')}"
    if i.get("unit"):
        val += f" {i['unit']}"
    if i.get("reference_range"):
        val += f"  [ref: {i['reference_range']}]"
    status = (i.get("status") or "").lower()
    if status in ("abnormal", "critical"):
        val += f"  ⚠ {status.upper()}"
    return val.strip()


def _fmt_inv_narrative(i: Dict) -> str:
    """Same as _fmt_inv_value but folds the test name in, for prose use."""
    test = (i.get("test") or "").strip()
    val  = _fmt_inv_value(i)
    if test and val:
        return f"{test} {val}"
    return test or val


def _fmt_proc_value(p: Dict) -> str:
    val = p.get("name", "")
    if p.get("detail"):     val += f" — {p['detail']}"
    if p.get("laterality"): val += f" [{p['laterality']}]"
    if p.get("surgeon"):    val += f"  (Surgeon: {p['surgeon']})"
    return val.strip()


def _fmt_vital_narrative(v: Dict) -> str:
    """Same as _fmt_vital_value but folds the parameter name in, for prose use."""
    label = (v.get("parameter") or "").strip()
    val   = _fmt_vital_value(v)
    if label and val:
        return f"{label} {val}"
    return label or val


def _clip(text: str, limit: int = ONE_LINE_MAX_CHARS) -> str:
    """Deterministic truncation for one-line summary strings."""
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def _build_synoptic_elements(doc: Dict) -> List[Dict[str, str]]:
    """
    Deterministically converts one document's already-extracted DS2
    categories into a flat synoptic element list:
    [{"element_id": "VIT-001", "data_element": "BP", "value": "90/60 mmHg"}, ...]
    """
    elements: List[Dict[str, str]] = []
    counters = {k: 0 for k in _ELEMENT_PREFIX}

    def add(cat: str, label: str, value: str) -> None:
        if not value:
            return
        counters[cat] += 1
        elements.append({
            "element_id":   f"{_ELEMENT_PREFIX[cat]}-{counters[cat]:03d}",
            "data_element": label,
            "value":        value,
        })

    for v in doc.get("vitals", []):
        add("vitals", v.get("parameter") or _ELEMENT_LABEL["vitals"], _fmt_vital_value(v))
    for m in doc.get("medications", []):
        add("medications", "Medication", _fmt_med_value(m))
    for i in doc.get("investigations", []):
        add("investigations", i.get("test") or _ELEMENT_LABEL["investigations"], _fmt_inv_value(i))
    for p in doc.get("procedures", []):
        add("procedures", "Procedure", _fmt_proc_value(p))
    for f in doc.get("findings", []):
        add("findings", _ELEMENT_LABEL["findings"], f)
    for d in doc.get("diagnoses", []):
        add("diagnoses", _ELEMENT_LABEL["diagnoses"], d)
    for t in doc.get("treatments", []):
        add("treatments", _ELEMENT_LABEL["treatments"], t)
    for ab in doc.get("abnormalities", []):
        add("abnormalities", _ELEMENT_LABEL["abnormalities"], ab)
    for rec in doc.get("recommendations", []):
        add("recommendations", _ELEMENT_LABEL["recommendations"], rec)

    return elements


def _join_natural(items: List[str]) -> str:
    """
    Joins a list of phrases into natural English:
      1 item  -> "A"
      2 items -> "A and B"
      3+ items -> "A, B, and C"
    Deterministic — no LLM. Used to turn DS2's extracted lists into
    flowing prose for the Tab 1 narrative.
    """
    items = [i.strip().rstrip(".") for i in items if i and i.strip()]
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return ", ".join(items[:-1]) + f", and {items[-1]}"


def _narrate_document(doc: Dict) -> str:
    """
    LEVEL 3 helper — deterministic, NO LLM.
    Builds a short, doctor-readable NARRATIVE PARAGRAPH for ONE document,
    weaving together whichever of the 9 DS2-extracted categories are
    non-empty into flowing prose (not a label:value dump) — e.g.:

      "Diagnosed with transitional cell carcinoma of the bladder,
       grade 3. Underwent TURBT with bulk, deep, and random biopsy
       resection. Notable abnormalities: haemoglobin 7.2 g/dL (low,
       ref 13-17 g/dL) — flagged for clinical attention. Plan: continue
       IV antibiotics, monitor urine output hourly, and review in
       urology clinic in 2 weeks."

    This reads like a clinician's own summary of that single document,
    so that scanning the timeline top-to-bottom tells the patient's
    story from first visit through to discharge, one document/event at
    a time. EVERY non-empty category from DS2's extraction is woven in
    — nothing is dropped from the source document.

    This is a pure prose-assembly operation over data DS2 already
    extracted — it adds zero additional token/latency cost (RULE 5b),
    so it stays safe even for patients with 50+ documents.
    """
    sentences: List[str] = []

    findings = doc.get("findings", [])
    if findings:
        sentences.append(f"Presented with / noted: {_join_natural(findings)}.")

    diagnoses = doc.get("diagnoses", [])
    if diagnoses:
        sentences.append(f"Diagnosed with {_join_natural(diagnoses)}.")

    procedures = doc.get("procedures", [])
    if procedures:
        proc_strs = [s for s in (_fmt_proc_value(p) for p in procedures) if s]
        if proc_strs:
            sentences.append(f"Underwent {_join_natural(proc_strs)}.")

    vitals = doc.get("vitals", [])
    if vitals:
        vit_strs = [s for s in (_fmt_vital_narrative(v) for v in vitals) if s]
        if vit_strs:
            sentences.append(f"Vitals recorded: {_join_natural(vit_strs)}.")

    investigations = doc.get("investigations", [])
    if investigations:
        inv_strs = [s for s in (_fmt_inv_narrative(i) for i in investigations) if s]
        if inv_strs:
            sentences.append(f"Investigations showed {_join_natural(inv_strs)}.")

    medications = doc.get("medications", [])
    if medications:
        med_strs = [s for s in (_fmt_med_value(m) for m in medications) if s]
        if med_strs:
            sentences.append(f"Medications given: {_join_natural(med_strs)}.")

    treatments = doc.get("treatments", [])
    if treatments:
        sentences.append(f"Also received: {_join_natural(treatments)}.")

    abnormalities = doc.get("abnormalities", [])
    if abnormalities:
        sentences.append(
            f"⚠ Notable abnormalities flagged: {_join_natural(abnormalities)} "
            "— requires clinical attention."
        )

    recommendations = doc.get("recommendations", [])
    if recommendations:
        sentences.append(f"Plan: {_join_natural(recommendations)}.")

    if not sentences:
        return "No structured clinical data extracted for this document."

    return " ".join(sentences)


def _build_quick_facts(doc: Dict) -> Dict[str, List[str]]:
    """
    LEVEL 3 helper — deterministic, NO LLM.
    Produces the fast "at a glance" checklist for a single document —
    now covering EVERY ONE of the 9 DS2-extracted categories, so a
    doctor never has to fall back to the full narrative just to find,
    say, a vital sign or an investigation result. Each category is a
    list of ONE-LINE strings (never a paragraph), so the whole set can
    be scanned top to bottom in a few seconds:

      vitals            — every vital parameter recorded in THIS
                           document, one line each (parameter + value +
                           unit + note folded into a single readable
                           line), e.g. "BP 90/60 mmHg (hypotension)".
      medications        — every drug given in THIS document, one line
                           each (drug + dose + route + frequency +
                           duration folded into a single readable line).
      investigations       — every test/lab/imaging result in THIS
                           document, one line each (test + result + unit
                           + reference range, with an ⚠ marker if the
                           document flagged it abnormal/critical).
      procedures            — every procedure/intervention in THIS
                           document, one line each.
      findings               — every clinical finding / observation in
                           THIS document, one line each.
      diagnoses                — every diagnosis (confirmed, provisional,
                           differential, staged/graded) in THIS document,
                           one line each.
      treatments                 — every non-medication therapy actually
                           GIVEN in THIS document, one line each.
      abnormalities                — every flagged out-of-range /
                           critical / unexpected finding for THIS
                           document only, one line each.
      treatment_plan                 — what was DONE (treatments) plus
                           what was PLANNED / ORDERED next
                           (recommendations) for THIS document, one line
                           each — this is what a doctor means by
                           "treatment plan" for that note/report.

    Pure formatting over data DS2 already extracted for this document —
    zero extra LLM/token cost, independent of how many documents the
    patient has in total (RULE 5b). Nothing from the 9 extracted
    categories is left out of quick_facts.
    """
    vitals = [
        _clip(s) for s in (_fmt_vital_narrative(v) for v in doc.get("vitals", [])) if s
    ]
    medications = [
        _clip(_fmt_med_value(m)) for m in doc.get("medications", []) if _fmt_med_value(m)
    ]
    investigations = [
        _clip(s) for s in (_fmt_inv_narrative(i) for i in doc.get("investigations", [])) if s
    ]
    procedures = [
        _clip(s) for s in (_fmt_proc_value(p) for p in doc.get("procedures", [])) if s
    ]
    findings = [
        _clip(f) for f in doc.get("findings", []) if f and str(f).strip()
    ]
    diagnoses = [
        _clip(d) for d in doc.get("diagnoses", []) if d and str(d).strip()
    ]
    treatments = [
        _clip(t) for t in doc.get("treatments", []) if t and str(t).strip()
    ]
    abnormalities = [
        _clip(a) for a in doc.get("abnormalities", []) if a and str(a).strip()
    ]
    treatment_plan = treatments + [
        _clip(r) for r in doc.get("recommendations", []) if r and str(r).strip()
    ]

    return {
        "vitals":          vitals,
        "medications":     medications,
        "investigations":  investigations,
        "procedures":      procedures,
        "findings":        findings,
        "diagnoses":       diagnoses,
        "treatments":      treatments,
        "abnormalities":   abnormalities,
        "treatment_plan":  treatment_plan,
    }


def _one_line_document_summary(doc: Dict) -> str:
    """
    LEVEL 2 helper — deterministic, NO LLM.
    Condenses ONE document down to a single line for the "documents on
    this date" list, so a doctor can scan 4-5 same-date documents and
    pick the right one before opening it. Prioritises diagnosis >
    procedure > finding > plan > generic fallback.
    """
    parts: List[str] = []

    diagnoses = [d for d in doc.get("diagnoses", []) if d and str(d).strip()]
    if diagnoses:
        parts.append(_join_natural(diagnoses[:2]))
    else:
        findings = [f for f in doc.get("findings", []) if f and str(f).strip()]
        if findings:
            parts.append(_join_natural(findings[:2]))

    procedures = doc.get("procedures", [])
    proc_strs  = [s for s in (_fmt_proc_value(p) for p in procedures) if s]
    if proc_strs:
        parts.append(f"Procedure: {_join_natural(proc_strs[:2])}")

    if not parts:
        recs = [r for r in doc.get("recommendations", []) if r and str(r).strip()]
        if recs:
            parts.append(f"Plan: {_join_natural(recs[:2])}")

    if not parts:
        meds = [m for m in (_fmt_med_value(m) for m in doc.get("medications", [])) if m]
        if meds:
            parts.append(f"Medications: {_join_natural(meds[:2])}")

    if not parts:
        parts.append("Clinical documentation on file")

    if doc.get("abnormalities"):
        parts.append(f"{len(doc['abnormalities'])} abnormalit"
                      f"{'y' if len(doc['abnormalities']) == 1 else 'ies'} flagged")

    return _clip("; ".join(parts))


def _one_line_date_summary(documents: List[Dict]) -> str:
    """
    LEVEL 1 helper — deterministic, NO LLM.
    Condenses ALL documents filed on ONE date into a single line for the
    top-level date_index (e.g. "4 document(s): Doctor Progress Note,
    Nursing Note, Medication Chart, Post Op Notes — 2 with flagged
    abnormalities"). This is what the doctor sees FIRST, before drilling
    into a date.
    """
    if not documents:
        return "No documents on file for this date."

    labels    = [d.get("document_label", "Clinical Document") for d in documents]
    abn_count = sum(1 for d in documents if d.get("has_abnormalities"))

    line = f"{len(documents)} document(s): {_join_natural(labels)}"
    if abn_count:
        line += (
            f" — {abn_count} document{'s' if abn_count != 1 else ''} "
            "with flagged abnormalities"
        )
    return _clip(line, limit=ONE_LINE_MAX_CHARS + 60)


def _build_date_overview_summary(documents: List[Dict]) -> str:
    """
    LEVEL 2 helper — deterministic, NO LLM (NEW in v5.4.0).
    Builds a short NATURAL-LANGUAGE PARAGRAPH describing the whole date
    at a glance — one level above the per-document narrative — so a
    doctor opening a date sees the day's overall picture BEFORE reading
    each individual document's summary. It reuses the SAME DS2-extracted
    fields as the per-document narrative and quick_facts (findings,
    diagnoses, procedures, abnormalities, medications, recommendations)
    — pooled ACROSS every document filed that date — so it never invents
    information and never drops anything DS2 already extracted; it is a
    plain-language roll-up, not a replacement for the per-document
    entries that still follow it.

    Example output:
      "On this date, 4 documents were filed: Doctor Progress Note,
       Nursing Note, Medication Chart, and Post Op Notes. The patient
       was diagnosed with transitional cell carcinoma of the bladder,
       grade 3, and reviewed post-TURBT with no active complaints.
       Notable findings/observations: abdomen soft, non-tender;
       catheter draining clear urine. ⚠ Abnormalities flagged across
       these documents: BP 90/60 mmHg (hypotension), haemoglobin
       7.2 g/dL (low). Medications given include Inj. Ceftriaxone 1 g
       IV BD and Tab. Pantoprazole 40 mg OD. Plan for the day: continue
       IV antibiotics, monitor urine output hourly, and urology
       follow-up in 2 weeks."

    Pure prose assembly over data DS2 already extracted for this date's
    documents — zero extra LLM/token cost, independent of how many
    documents/dates the patient has in total (RULE 5b).
    """
    if not documents:
        return "No documents on file for this date."

    labels = [d.get("document_label", "Clinical Document") for d in documents]
    sentences: List[str] = [
        f"On this date, {len(documents)} document"
        f"{'s were' if len(documents) != 1 else ' was'} filed: {_join_natural(labels)}."
    ]

    # Pool each category ACROSS all documents for this date, preserving
    # every item DS2 extracted (de-duplicated only on exact repeats so
    # the same finding filed in two notes isn't stated twice).
    def _pool(key: str, formatter=None) -> List[str]:
        seen: List[str] = []
        for d in documents:
            for item in d.get(key, []):
                s = formatter(item) if formatter else item
                s = (s or "").strip()
                if s and s not in seen:
                    seen.append(s)
        return seen

    diagnoses      = _pool("diagnoses")
    findings       = _pool("findings")
    procedures     = _pool("procedures", _fmt_proc_value)
    vitals         = _pool("vitals", _fmt_vital_narrative)
    investigations = _pool("investigations", _fmt_inv_narrative)
    medications    = _pool("medications", _fmt_med_value)
    treatments     = _pool("treatments")
    abnormalities  = _pool("abnormalities")
    recommendations = _pool("recommendations")

    if diagnoses:
        sentences.append(f"Diagnosed with {_join_natural(diagnoses)}.")
    if findings:
        sentences.append(f"Notable findings/observations: {_join_natural(findings)}.")
    if procedures:
        sentences.append(f"Procedures performed: {_join_natural(procedures)}.")
    if vitals:
        sentences.append(f"Vitals recorded: {_join_natural(vitals)}.")
    if investigations:
        sentences.append(f"Investigations showed {_join_natural(investigations)}.")
    if medications:
        sentences.append(f"Medications given include {_join_natural(medications)}.")
    if treatments:
        sentences.append(f"Also received: {_join_natural(treatments)}.")
    if abnormalities:
        sentences.append(
            f"⚠ Abnormalities flagged across these documents: {_join_natural(abnormalities)}."
        )
    if recommendations:
        sentences.append(f"Plan for the day: {_join_natural(recommendations)}.")

    return _clip(" ".join(sentences), limit=DATE_OVERVIEW_MAX_CHARS)


def _render_document_table(label: str, filename: str, elements: List[Dict[str, str]]) -> List[str]:
    """One independent synoptic table for ONE document. Never combined
    with any other document's table, even on the same date (RULE 3)."""
    lines: List[str] = []
    header = f"  ▸ DOCUMENT: {label}"
    if filename:
        header += f"   [{filename}]"
    lines.append(header)
    lines.append("  " + "-" * 70)
    lines.append(f"  {'ELEMENT ID':<12}{'DATA ELEMENT':<32}VALUE / RESPONSE")
    lines.append("  " + "-" * 70)
    if not elements:
        lines.append("  (No structured data elements extracted for this document)")
    for el in elements:
        de = el["data_element"][:30]
        lines.append(f"  {el['element_id']:<12}{de:<32}{el['value']}")
    lines.append("  " + "-" * 70)
    lines.append("")
    return lines


def _build_synoptic_text(
    date_merged:      Dict,
    patient_name:     str,
    patient_dob:      str,
    patient_sex:      str,
    admission_reason: str,
    admission_date:   Optional[str],
    specialty:        str,
) -> str:
    SEP  = "═" * 74
    THIN = "─" * 74
    lines: List[str] = []

    lines += [
        SEP,
        f"  SYNOPTIC DISCHARGE REPORT — {specialty.upper()}",
        SEP,
        "",
        f"  {'ELEMENT ID':<14}{'DATA ELEMENT':<32}VALUE / RESPONSE",
        THIN,
        f"  {'PAT-001':<14}{'Patient Name':<32}{patient_name}",
        f"  {'PAT-002':<14}{'Date of Birth':<32}{patient_dob}",
        f"  {'PAT-003':<14}{'Sex':<32}{patient_sex}",
        THIN,
        f"  {'ADM-001':<14}{'Reason for Visit (OP)':<32}{admission_reason}",
        f"  {'ADM-002':<14}{'Date of First OP Visit':<32}{admission_date or 'Not documented'}",
        SEP,
        "",
    ]

    for date_key in _sorted_date_keys(date_merged):
        day_data   = date_merged[date_key]
        date_label = day_data.get("date_label", date_key)
        documents  = day_data.get("documents", [])
        if not documents:
            continue

        display_date = date_key if date_key != NULL_DATE_KEY else "Date Unknown"
        lines += [
            THIN,
            f"  {display_date}   │   {date_label.upper()}   │   {len(documents)} document(s) on this date",
            THIN,
            "",
        ]

        # RULE 3 — each document rendered as its OWN table, one by one,
        # never compressed into a single combined block for the date.
        for doc in documents:
            elements = doc.get("synoptic_elements", [])
            lines += _render_document_table(
                doc.get("document_label", "Clinical Document"),
                doc.get("filename", ""),
                elements,
            )

    lines += [SEP, "  END OF SYNOPTIC DISCHARGE REPORT", SEP]
    return "\n".join(lines)


def _build_synoptic_timeline_json(
    date_merged:      Dict,
    admission_reason: str,
    admission_date:   Optional[str],
    patient_name:     str,
    patient_dob:      str,
    patient_sex:      str,
) -> List[Dict]:
    """Legacy combined structure — kept for backward compatibility with
    any existing consumers of `day_wise_timeline`."""
    timeline: List[Dict] = []

    timeline.append({
        "type":              "first_op_visit",
        "visit_type":        "OP",
        "date":              admission_date,
        "day_number":        0,
        "date_label":        "First OP Visit",
        "reason_for_visit":  admission_reason,
        "patient": {
            "name": patient_name,
            "dob":  patient_dob,
            "sex":  patient_sex,
        },
        "documents": [],
    })

    for date_key in _sorted_date_keys(date_merged):
        day_data  = date_merged[date_key]
        documents = day_data.get("documents", [])
        if not documents:
            continue

        # One entry PER DOCUMENT — never merged, even when several
        # documents share this exact date (RULE 3).
        doc_entries: List[Dict] = []
        for doc in documents:
            doc_entries.append({
                "document_label":     doc.get("document_label"),
                "filename":            doc.get("filename"),
                "summary":             doc.get("content_summary", ""),
                "synoptic_elements":   doc.get("synoptic_elements", []),
                "has_abnormalities":   doc.get("has_abnormalities", False),
                "has_recommendations": doc.get("has_recommendations", False),
            })

        timeline.append({
            "type":         "clinical_day",
            "date":         None if date_key == NULL_DATE_KEY else date_key,
            "day_number":   day_data.get("day_number"),
            "date_label":   day_data.get("date_label", date_key),
            "document_count": len(doc_entries),
            "documents":    doc_entries,   # date -> [doc1, doc2, ...] one by one
        })

    return timeline


def _build_three_levels(
    date_merged:      Dict,
    admission_reason: str,
    admission_date:   Optional[str],
    patient_name:     str,
    patient_dob:      str,
    patient_sex:      str,
) -> (List[Dict], List[Dict], List[Dict]):
    """
    Builds ALL THREE drill-down levels + Tab 2 from the SAME date_merged
    data, in one deterministic pass — zero LLM calls (RULE 5b):

      LEVEL 1 — date_index
        Flat list, one row per date (+ "Date Unknown"): date, date_label,
        day_number, document_count, and a single `one_line_summary`
        string. This is the very first screen — "date-wise summary list".

      LEVEL 2 — timeline_tab
        Same date blocks as before, but each block now ALSO carries a
        `date_overview_summary` — a natural-language paragraph covering
        everything filed that date, BEFORE the per-document list. Each
        document entry inside still carries `one_line_summary` — a
        single-line preview so a doctor can scan the documents filed on
        a clicked date before opening any of them. Documents sharing a
        date are NEVER merged (RULE 3).

      LEVEL 3 — (nested inside each timeline_tab document)
        `summary`       — full narrative paragraph (plain prose).
        `quick_facts`   — {vitals, medications, investigations,
                          procedures, findings, diagnoses, treatments,
                          abnormalities, treatment_plan}, each a list of
                          one-line strings, for the doctor to scan in
                          seconds after opening one document. Covers ALL
                          9 DS2-extracted categories — nothing omitted.

      TAB 2 — synoptic_tab
        Same date-wise structure, but each document carries its
        structured `synoptic_elements` (Element ID / Data Element /
        Value rows) instead of prose — for rendering as a table in the
        UI. The plain-text version lives in `discharge_summary` (built
        by `_build_synoptic_text`).
    """
    timeline_tab: List[Dict] = [{
        "type":             "first_op_visit",
        "visit_type":       "OP",
        "date":             admission_date,
        "day_number":       0,
        "date_label":       "First OP Visit",
        "reason_for_visit": admission_reason,
        "date_overview_summary": _clip(
            f"First OP visit. Chief complaint: {admission_reason or 'Not documented'}.",
            limit=DATE_OVERVIEW_MAX_CHARS,
        ),
        "patient": {
            "name": patient_name,
            "dob":  patient_dob,
            "sex":  patient_sex,
        },
        "documents": [],
    }]
    synoptic_tab: List[Dict] = []
    date_index:   List[Dict] = []

    if admission_date or admission_reason:
        date_index.append({
            "date":              admission_date,
            "date_label":        "First OP Visit Day",
            "day_number":        0,
            "document_count":    0,
            "one_line_summary":  _clip(
                f"First OP visit — chief complaint: {admission_reason or 'Not documented'}",
                limit=ONE_LINE_MAX_CHARS + 60,
            ),
        })

    for date_key in _sorted_date_keys(date_merged):
        day_data  = date_merged[date_key]
        documents = day_data.get("documents", [])
        if not documents:
            continue

        display_date = None if date_key == NULL_DATE_KEY else date_key
        date_label   = day_data.get("date_label", date_key)
        day_number   = day_data.get("day_number")

        # LEVEL 1 row for this date.
        date_index.append({
            "date":             display_date,
            "date_label":       date_label,
            "day_number":       day_number,
            "document_count":   len(documents),
            "one_line_summary": _one_line_date_summary(documents),
        })

        # LEVEL 2 date-level overview — natural-language paragraph
        # covering ALL documents filed on this date, pooled from the
        # same DS2-extracted fields as the per-document narrative below.
        date_overview_summary = _build_date_overview_summary(documents)

        timeline_docs: List[Dict] = []
        synoptic_docs: List[Dict] = []

        # RULE 3 — one entry per document, in filing order, never blended
        # even though they share the same date.
        for doc in documents:
            timeline_docs.append({
                "document_label":      doc.get("document_label"),
                "filename":            doc.get("filename"),
                "one_line_summary":    doc.get("one_line_summary", ""),  # LEVEL 2 preview
                "summary":             doc.get("content_summary", ""),   # LEVEL 3 full narrative
                "quick_facts":         doc.get("quick_facts", {}),       # LEVEL 3 one-liners (all 9 categories)
                "has_abnormalities":   doc.get("has_abnormalities", False),
                "has_recommendations": doc.get("has_recommendations", False),
            })
            synoptic_docs.append({
                "document_label":     doc.get("document_label"),
                "filename":           doc.get("filename"),
                "synoptic_elements":  doc.get("synoptic_elements", []),
                "has_abnormalities":  doc.get("has_abnormalities", False),
            })

        timeline_tab.append({
            "type":                   "clinical_day",
            "date":                   display_date,
            "day_number":             day_number,
            "date_label":             date_label,
            "document_count":         len(timeline_docs),
            "date_overview_summary":  date_overview_summary,  # NEW — whole-date natural-language summary
            "documents":              timeline_docs,
        })
        synoptic_tab.append({
            "type":           "clinical_day",
            "date":           display_date,
            "day_number":     day_number,
            "date_label":     date_label,
            "document_count": len(synoptic_docs),
            "documents":      synoptic_docs,
        })

    return timeline_tab, synoptic_tab, date_index


class SynopticReportBuilderAgent(BaseAgent):
    """
    DS4 — Builds ALL THREE drill-down levels + Tab 2. ZERO LLM calls in
    this stage, by design (RULE 5b): it only formats data DS2 already
    extracted (including assembling the narrative prose, one-line
    previews, the date-level overview paragraph, and the full
    quick_facts across all 9 categories), so it can never contribute to
    a token/context overflow no matter how many documents (50, 100+)
    the patient has.
    """
    agent_id = "DS4"

    async def run(self, state: DischargeState) -> DischargeState:
        logger.info(f"{self.agent_id} · ThreeLevelReportBuilder — START (no LLM)")
        t0 = datetime.now().timestamp()

        date_merged      = state.get("date_merged") or {}
        specialty        = state["specialty"]
        admission_reason = state.get("admission_reason") or "Not documented"
        admission_date   = state.get("admission_date")
        patient_name     = state.get("patient_name") or "Not documented"
        patient_dob      = state.get("patient_dob") or "Not documented"
        patient_sex      = state.get("patient_sex") or "Not documented"

        # Attach deterministic per-document fields ONCE, then reuse across
        # all 3 levels + Tab 2:
        #   synoptic_elements    -> Tab 2
        #   content_summary      -> Level 3 full narrative
        #   quick_facts          -> Level 3 one-liners, ALL 9 categories
        #                           (vitals / medications / investigations /
        #                           procedures / findings / diagnoses /
        #                           treatments / abnormalities / treatment_plan)
        #   one_line_summary     -> Level 2 document-list preview
        for _, day_data in date_merged.items():
            for doc in day_data.get("documents", []):
                doc["synoptic_elements"]   = _build_synoptic_elements(doc)
                doc["content_summary"]     = _narrate_document(doc)       # Level 3 narrative
                doc["quick_facts"]         = _build_quick_facts(doc)      # Level 3 one-liners (all categories)
                doc["one_line_summary"]    = _one_line_document_summary(doc)  # Level 2 preview
                doc["has_abnormalities"]   = len(doc.get("abnormalities", [])) > 0
                doc["has_recommendations"] = len(doc.get("recommendations", [])) > 0

        # TAB 2 (text) — plain-text synoptic report for printing.
        synoptic_text = _build_synoptic_text(
            date_merged      = date_merged,
            patient_name     = patient_name,
            patient_dob      = patient_dob,
            patient_sex      = patient_sex,
            admission_reason = admission_reason,
            admission_date   = admission_date,
            specialty        = specialty,
        )

        # Legacy combined JSON — kept for any existing consumers.
        legacy_timeline_json = _build_synoptic_timeline_json(
            date_merged      = date_merged,
            admission_reason = admission_reason,
            admission_date   = admission_date,
            patient_name     = patient_name,
            patient_dob      = patient_dob,
            patient_sex      = patient_sex,
        )

        # NEW — all 3 drill-down levels + Tab 2 structured JSON.
        timeline_tab, synoptic_tab, date_index = _build_three_levels(
            date_merged      = date_merged,
            admission_reason = admission_reason,
            admission_date   = admission_date,
            patient_name     = patient_name,
            patient_dob      = patient_dob,
            patient_sex      = patient_sex,
        )

        state["discharge_summary"]            = synoptic_text
        state["day_wise_timeline"]            = legacy_timeline_json
        state["timeline_tab"]                 = timeline_tab
        state["date_index"]                   = date_index
        state["synoptic_tab"]                 = synoptic_tab
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(
            f"{self.agent_id} · ThreeLevelReportBuilder — DONE "
            f"({state['agent_timings'][self.agent_id]}ms) | "
            f"date_index={len(date_index)} rows | timeline_tab={len(timeline_tab)} blocks | "
            f"synoptic_tab={len(synoptic_tab)} blocks"
        )
        return state


# ═══════════════════════════════════════════════════════════════
# DS5 · QUALITY GATE
# ═══════════════════════════════════════════════════════════════

class DischargeQualityAgent(BaseAgent):
    agent_id = "DS5"

    async def run(self, state: DischargeState) -> DischargeState:
        logger.info(f"{self.agent_id} · DischargeQuality — START")
        t0 = datetime.now().timestamp()

        discharge_summary = state.get("discharge_summary") or ""
        day_wise_timeline = state.get("day_wise_timeline") or []
        specialty         = state["specialty"]
        prepared_docs      = state.get("prepared_documents") or []
        admission_reason   = state.get("admission_reason")

        clinical_blocks  = [e for e in day_wise_timeline if e.get("type") == "clinical_day"]
        timeline_dates   = [entry.get("date", "") for entry in clinical_blocks]
        prepared_dates   = sorted({d.get("document_date") or "Unknown" for d in prepared_docs})

        total_docs      = len(prepared_docs)
        reported_docs   = sum(len(e.get("documents", [])) for e in clinical_blocks)
        dates_with_multi_docs = [
            e["date"] for e in clinical_blocks if e.get("document_count", 0) > 1
        ]
        dates_with_abnorms = [
            e["date"] for e in clinical_blocks
            if any(d.get("has_abnormalities") for d in e.get("documents", []))
        ]

        # Bounded preview — never scales report size into the prompt.
        # NOTE: this preview stays bounded regardless of how large the
        # date_index / timeline_tab / quick_facts / date_overview_summary
        # payload is (RULE 5c) — DS5 never sees the full 3-level JSON,
        # only this text preview + small counts.
        summary_preview = discharge_summary[:QUALITY_PREVIEW_CHARS] + (
            "\n...[truncated]" if len(discharge_summary) > QUALITY_PREVIEW_CHARS else ""
        )

        system = (
            f"You are a senior {specialty} clinical quality auditor reviewing a "
            "3-level discharge report: a Level-1 date-wise summary list, a "
            "Level-2 per-date document list (each date also carrying a "
            "plain-language date_overview_summary paragraph), and a Level-3 "
            "per-document view (plain-language narrative + one-line quick_facts "
            "covering vitals/medications/investigations/procedures/findings/"
            "diagnoses/treatments/abnormalities/treatment_plan), alongside a "
            "SYNOPTIC tab (discrete Element ID / Data Element / Value rows, one "
            "table per document). Documents with date 'null' / 'UNKNOWN_DATE' / "
            "'Date Unknown' are valid and must be counted as covered. A date "
            "with multiple documents must show each document separately at "
            "every level — never one combined block, and the date_overview_"
            "summary must not replace or omit any of them. Return ONLY valid "
            "JSON."
        )

        prompt = (
            f"SPECIALTY: {specialty}\n"
            f"FIRST OP VISIT — CHIEF COMPLAINT: {admission_reason or 'Not documented'}\n\n"
            f"TOTAL GRAPH DOCUMENTS: {total_docs}\n"
            f"DOCUMENTS IN OUTPUT: {reported_docs}\n"
            f"ALL DOCUMENT DATES: {json.dumps(prepared_dates)}\n"
            f"DATES IN TIMELINE: {json.dumps(timeline_dates)}\n"
            f"DATES WITH MULTIPLE DOCUMENTS (must each be a separate table): {json.dumps(dates_with_multi_docs)}\n"
            f"DATES WITH ABNORMALITIES: {json.dumps(dates_with_abnorms)}\n\n"
            f"SYNOPTIC REPORT PREVIEW (Tab 2, text form):\n{summary_preview}\n\n"
            "AUDIT CHECKLIST (PASS / FAIL / PARTIAL):\n"
            "  1. first_op_visit_reason_in_header\n"
            "  2. all_graph_documents_covered  — every doc from the graph appears\n"
            "  3. all_dates_covered\n"
            "  4. multi_document_dates_kept_separate  — no date collapses >1 doc into one block\n"
            "  5. synoptic_element_ids_present  — every row has an [Element ID]\n"
            "  6. per_doc_abnormalities_flagged\n"
            "  7. per_doc_recommendations_captured\n"
            "  8. document_identifiers_match_graph  — labels trace back to the raw filename\n"
            "  9. no_evidence_dropped  — no data omitted or summarised away\n"
            " 10. day_numbering_consistent\n"
            " 11. level3_has_per_document_narrative  — every document has a non-empty narrative summary\n"
            " 12. level3_has_full_quick_facts  — every document exposes ALL of vitals/medications/"
            "investigations/procedures/findings/diagnoses/treatments/abnormalities/treatment_plan as one-liners\n"
            " 13. level2_has_date_overview_summary  — every date block has a non-empty plain-language overview\n\n"
            "SCORES (0.0-1.0):\n"
            "  completeness, date_coverage, document_separation, synoptic_structure,\n"
            "  abnormality_detection, recommendation_capture\n"
            "  overall = mean of all six\n\n"
            "Return ONLY:\n"
            "{\n"
            '  "checklist": { "item_name": "PASS|FAIL|PARTIAL", ... },\n'
            '  "scores": { "completeness":0.0, "date_coverage":0.0,\n'
            '    "document_separation":0.0, "synoptic_structure":0.0,\n'
            '    "abnormality_detection":0.0, "recommendation_capture":0.0, "overall":0.0 },\n'
            '  "gaps_flagged": ["..."],\n'
            '  "missing_dates": ["..."],\n'
            '  "approved_for_clinical_use": true,\n'
            '  "review_notes": "One paragraph quality summary for the treating doctor"\n'
            "}"
        )

        result = await self._invoke(system, prompt)
        state["quality_report"]               = result
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(
            f"{self.agent_id} · DischargeQuality — DONE "
            f"({state['agent_timings'][self.agent_id]}ms) | "
            f"Overall: {result.get('scores',{}).get('overall','N/A')}"
        )
        return state


# ═══════════════════════════════════════════════════════════════
# WORKFLOW GRAPH
# ═══════════════════════════════════════════════════════════════

def create_discharge_workflow() -> Any:
    workflow = StateGraph(DischargeState)

    workflow.add_node("DS1", DocumentPreparerAgent(llm_light).run)     # no LLM used inside, arg unused
    workflow.add_node("DS2", EvidenceAnalyzerAgent(llm_synthesis).run)
    workflow.add_node("DS3", DateAggregatorAgent(llm_light).run)        # no LLM used inside, arg unused
    workflow.add_node("DS4", SynopticReportBuilderAgent(llm_light).run) # no LLM used inside, arg unused
    workflow.add_node("DS5", DischargeQualityAgent(llm_light).run)

    workflow.set_entry_point("DS1")
    workflow.add_edge("DS1", "DS2")
    workflow.add_edge("DS2", "DS3")
    workflow.add_edge("DS3", "DS4")
    workflow.add_edge("DS4", "DS5")
    workflow.add_edge("DS5", END)

    return workflow.compile()


discharge_workflow = create_discharge_workflow()


# ═══════════════════════════════════════════════════════════════
# STATE FACTORY
# ═══════════════════════════════════════════════════════════════

def build_discharge_state(
    request:           DischargeSummaryRequest,
    graph_docs:        List[Dict],
    admission_context: Dict,
) -> DischargeState:
    return DischargeState(
        patient_id          = request.patient_id,
        doctor_id            = request.doctor_id,
        specialty            = request.specialty,
        admission_reason     = admission_context.get("admission_reason"),
        admission_date       = admission_context.get("admission_date"),
        patient_dob          = admission_context.get("patient_dob"),
        patient_sex          = admission_context.get("patient_sex"),
        patient_name         = admission_context.get("patient_name"),
        graph_documents      = graph_docs,
        prepared_documents   = None,
        document_batches      = None,
        batch_analyses         = None,
        date_merged             = None,
        discharge_summary       = None,
        day_wise_timeline        = None,
        timeline_tab              = None,
        date_index                 = None,
        synoptic_tab                 = None,
        quality_report                  = None,
        errors                            = [],
        agent_timings                       = {},
    )


# ═══════════════════════════════════════════════════════════════
# DEMO DATA — covers multiple documents sharing the same date
# ═══════════════════════════════════════════════════════════════

def load_demo_graph_documents() -> List[Dict]:
    return [
        {
            "document":      "histopath_turbt.pdf",
            "document_date": "2026-01-06",
            "entities": [
                {
                    "relation":    "HAS_PROCEDURE",
                    "entity_type": "Procedure",
                    "evidence":    "Bulk of resection, Deep resection, and Random biopsy specimens submitted for histopathological examination following TURBT. Multiple fragments measuring 6×3.8×1.5 cm received."
                },
                {
                    "relation":    "HAS_DIAGNOSIS",
                    "entity_type": "Diagnosis",
                    "evidence":    "Sections show transitional cell carcinoma grade 3 infiltrating muscle bundles. Lamina propria shows multiple Von Brunn's nests. Muscularis propria involved. Lymphovascular invasion not identified."
                },
            ],
        },
        # ── Same date, DIFFERENT documents — must render as SEPARATE tables ──
        {
            "document":      "doctor_progress_note_07jan.pdf",
            "document_date": "2026-01-07",
            "entities": [
                {
                    "relation":    "HAS_FINDING",
                    "entity_type": "Finding",
                    "evidence":    "Patient reviewed post-TURBT. Comfortable, no active complaints. Abdomen soft, non-tender. Catheter draining clear urine."
                },
                {
                    "relation":    "HAS_DIAGNOSIS",
                    "entity_type": "Diagnosis",
                    "evidence":    "Post-operative day 1 TURBT. Transitional cell carcinoma bladder grade 3."
                },
                {
                    "relation":    "HAS_ORDER",
                    "entity_type": "Instruction",
                    "evidence":    "Plan: Continue IV antibiotics. Monitor urine output hourly. Repeat CBC tomorrow. Remove catheter on post-op day 3 if urine clear. Urology follow-up in 2 weeks."
                },
            ],
        },
        {
            "document":      "nursing_note_07jan.pdf",
            "document_date": "2026-01-07",
            "entities": [
                {
                    "relation":    "HAS_VITAL",
                    "entity_type": "Vital Sign",
                    "evidence":    "BP 90/60 mmHg, HR 110 bpm, RR 20/min, Temp 37.8°C, SpO2 96% on room air. Patient appears pale and diaphoretic. IV access patent. Urine output 25 ml/hr — below target."
                },
                {
                    "relation":    "HAS_OBSERVATION",
                    "entity_type": "Observation",
                    "evidence":    "Patient repositioned every 2 hours. IV site inspected — no signs of phlebitis. Catheter bag drained and recorded. IV fluids NS 100 ml/hr commenced per doctor's orders."
                },
            ],
        },
        {
            "document":      "medication_chart_07jan.pdf",
            "document_date": "2026-01-07",
            "entities": [
                {
                    "relation":    "HAS_MEDICATION",
                    "entity_type": "Medication",
                    "evidence":    "Inj. Ceftriaxone 1 g IV BD. Tab. Pantoprazole 40 mg OD before food. Inj. Tramadol 50 mg IV SOS for pain (max 3 doses/day). IV Fluids: Normal Saline 100 ml/hr. Tab. Metronidazole 400 mg TDS."
                },
            ],
        },
        {
            "document":      "post_op_notes_07jan.pdf",
            "document_date": "2026-01-07",
            "entities": [
                {
                    "relation":    "HAS_VITAL",
                    "entity_type": "Vital Sign",
                    "evidence":    "Post-operative hypotension noted. Blood pressure recorded at 90/60 mmHg. Patient pale and diaphoretic. IV fluids started immediately. 500 ml NS bolus given. BP improved to 110/70 mmHg after resuscitation."
                },
            ],
        },
        # ── Undated docs ──
        {
            "document":      "echo_report.pdf",
            "document_date": None,
            "entities": [
                {
                    "relation":    "HAS_FINDING",
                    "entity_type": "Finding",
                    "evidence":    "Trivial aortic regurgitation noted. Normal LV systolic function. Mild LV diastolic dysfunction grade 1. EF 71%. MV E/A ratio 0.7. No pericardial effusion. No wall motion abnormality."
                },
                {
                    "relation":    "HAS_MEASUREMENT",
                    "entity_type": "Measurement",
                    "evidence":    "LVIDd 4.8 cm. LVIDs 3.1 cm. IVSd 1.0 cm. LVPWd 1.2 cm. LA 3.2 cm. Aortic root 3.0 cm. RVSP 28 mmHg."
                },
            ],
        },
        {
            "document":      "lab_cbc.pdf",
            "document_date": None,
            "entities": [
                {
                    "relation":    "HAS_LAB",
                    "entity_type": "Lab Result",
                    "evidence":    "CBC: Haemoglobin 7.2 gm% (LOW — ref 13-17 gm%), WBC 9210 cells/cmm (normal), Platelets 2.46 lakhs/cmm (normal), MPV 7.8 fl (low — ref 9.4-12.3 fl). PCV 21.6% (LOW). MCV 78 fl. MCH 24 pg (low). Neutrophils 72%, Lymphocytes 22%, Monocytes 4%, Eosinophils 2%."
                },
            ],
        },
        {
            "document":      "physio_note.pdf",
            "document_date": None,
            "entities": [
                {
                    "relation":    "HAS_TREATMENT",
                    "entity_type": "Treatment",
                    "evidence":    "Patient assessed for post-operative rehabilitation. Deep breathing exercises taught. Ankle pumps and calf compression advised every 2 hours for DVT prophylaxis. Advised ambulation with assistance from post-op day 2. Incentive spirometry commenced."
                },
            ],
        },
    ]


# ═══════════════════════════════════════════════════════════════
# API ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@router.post("/discharge-summaryy", response_model=None)
async def generate_discharge_summary(request: DischargeSummaryRequest):
    """
    Discharge Summary Agent v5.4.0 — 3-LEVEL DRILL-DOWN + DATE OVERVIEW
    + FULL QUICK FACTS + SYNOPTIC REPORT
    • tabs.timeline.date_index — LEVEL 1: flat date-wise summary list
                                  (one line per date) — the first screen.
    • tabs.timeline.blocks     — LEVEL 2/3: click a date -> see a whole-
                                  date "date_overview_summary" paragraph
                                  PLUS every document filed that date
                                  (one-line preview each); click a
                                  document -> full narrative "summary" +
                                  "quick_facts" covering ALL 9 categories
                                  (vitals / medications / investigations /
                                  procedures / findings / diagnoses /
                                  treatments / abnormalities /
                                  treatment_plan), one line per item.
    • tabs.synoptic_report     — synoptic report: text + structured
                                  Element ID/Data Element/Value JSON.
    • No predicted document labels — raw graph `document` field used directly
    • OP-based admission context (first visit date + chief complaint only)
    • Multiple same-date documents are NEVER compressed together, at ANY level
    • Token-safe batching for 50+ document patients (DS2 is the only LLM
      step; ALL 3 drill-down levels + Tab 2 — including narrative text,
      the date overview summary, and full quick_facts — are built with
      zero additional LLM calls, and DS5's audit prompt only ever sees a
      bounded text preview + counts, never the full 3-level JSON)
    """
    start_ms = datetime.now().timestamp() * 1000
    logger.info(
        f"Discharge Summary v5.4 | patient={request.patient_id} | "
        f"doctor={request.doctor_id} | specialty={request.specialty}"
    )

    try:
        try:
            graph_docs = await fetch_graph_documents(request.patient_id)
        except Exception as neo4j_err:
            logger.warning(f"Neo4j unavailable ({neo4j_err}), using demo data")
            graph_docs = load_demo_graph_documents()

        if not graph_docs:
            raise HTTPException(
                status_code=404,
                detail=f"No clinical data found for patient {request.patient_id}",
            )

        admission_context = await fetch_admission_context(
            request.patient_id, request.doctor_id
        )
        logger.info(
            f"First OP visit context: reason='{admission_context.get('admission_reason')}' "
            f"date='{admission_context.get('admission_date')}'"
        )

        initial_state = build_discharge_state(request, graph_docs, admission_context)
        result        = await discharge_workflow.ainvoke(initial_state)

        elapsed = round(datetime.now().timestamp() * 1000 - start_ms)
        quality = result.get("quality_report") or {}

        response = {
            "patient_id":          request.patient_id,
            "doctor_id":           request.doctor_id,
            "generated_at":        datetime.now().isoformat(),
            "documents_analyzed":  len(graph_docs),
            "processing_time_ms":  elapsed,
            "version":             "5.4.0",

            "visit_type":       "OP",
            "admission_reason": result.get("admission_reason"),
            "admission_date":   result.get("admission_date"),
            "patient": {
                "name": result.get("patient_name"),
                "dob":  result.get("patient_dob"),
                "sex":  result.get("patient_sex"),
            },

            # ── TWO-TAB OUTPUT, TIMELINE NOW 3-LEVEL DRILL-DOWN ─────
            "tabs": {
                "timeline": {
                    "label": "Timeline",
                    # LEVEL 1 — click here first: flat date-wise list.
                    "date_index": result.get("date_index", []),
                    # LEVEL 2/3 — click a date_index row's `date` to find
                    # its matching block below. Each block now carries
                    # `date_overview_summary` (whole-date natural-
                    # language paragraph). Each block's `documents` list
                    # is LEVEL 2 (one row per document, with
                    # one_line_summary), and each document's `summary`
                    # + `quick_facts` (all 9 categories) is LEVEL 3.
                    "blocks": result.get("timeline_tab", []),
                },
                "synoptic_report": {
                    "label":      "Synoptic Report",
                    "text":       result.get("discharge_summary", ""),
                    "structured": result.get("synoptic_tab", []),
                },
            },

            # ── Legacy fields (kept for backward compatibility) ─────
            "discharge_summary":  result.get("discharge_summary", ""),
            "day_wise_timeline":  result.get("day_wise_timeline", []),

            "gaps_flagged":   quality.get("gaps_flagged", []),
            "score":          quality.get("scores", {}),
            "quality_report": quality,

            "agent_timings": result.get("agent_timings", {}),
            "errors":        result.get("errors", []),
        }

        if request.include_intermediates:
            response["intermediate"] = {
                "prepared_documents": result.get("prepared_documents"),
                "document_batches":    result.get("document_batches"),
                "batch_analyses":       result.get("batch_analyses"),
                "date_merged":           result.get("date_merged"),
            }

        try:
            await mongo_db["discharge_summaries_synoptic"].insert_one({
                **response,
                "saved_at": datetime.utcnow(),
            })
        except Exception as e:
            logger.error(f"MongoDB save failed: {e}")

        logger.info(
            f"Discharge Summary v5.4 complete | patient={request.patient_id} | "
            f"{elapsed}ms | {len(graph_docs)} docs"
        )
        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(
            f"Discharge Summary pipeline failed | patient={request.patient_id} | {e}"
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/discharge-summary/demo")
async def run_discharge_demo():
    """Run pipeline with demo data — includes 4 different documents sharing
    the SAME date (2026-01-07), to demonstrate they render as 4 separate
    Level-2 rows AND 4 separate Level-3 summaries/quick_facts/synoptic
    tables, never compressed into one block, at any level — plus a single
    date_overview_summary paragraph covering all 4 of them together."""
    demo_request = DischargeSummaryRequest(
        patient_id            = "PAT-demo-001",
        doctor_id             = "DOC-demo-001",
        specialty             = "Urology",
        include_intermediates = True,
    )
    return await generate_discharge_summary(demo_request)


@router.get("/discharge-summary/health")
async def discharge_health():
    return {
        "status":  "ok",
        "version": "5.4.0",
        "agents":  5,
        "output_levels": [
            "Level 1 · Date Index — flat, one row per date, one-line summary ('4 document(s): ... — 2 with flagged abnormalities'). This is the first screen.",
            "Level 2 · Documents on that date — click a date to see a whole-date natural-language 'date_overview_summary' paragraph, PLUS every document filed that date listed one-by-one with a one-line preview each, never merged even if 4-5 share a date",
            "Level 3 · Single document view — click a document to see the full narrative paragraph PLUS quick_facts covering ALL 9 categories: vitals / medications / investigations / procedures / findings / diagnoses / treatments / abnormalities / treatment_plan, each a list of one-liners",
            "Tab 2 · Synoptic Report — [Element ID] | [Data Element] : [Value] tables, one per document, grouped per date (text + structured JSON) — for coding/audit",
        ],
        "core_rules": [
            "RULE 1 · NO PREDICTED LABELS — every document identified purely by the graph's own `document` field, no LLM guesses the document type",
            "RULE 2 · OP, NOT IP — admission context = first OP visit's date + chief complaint only",
            "RULE 3 · NO DOCUMENT COMPRESSION — same-date documents are always listed one by one at EVERY level, each its own entry, never blended. The new date_overview_summary is additive orientation only — it never replaces the per-document entries.",
            "RULE 4 · SYNOPTIC REPORT OUTPUT — every fact rendered as [Element ID] | [Data Element] : [Value] (Tab 2); Levels 1-3 stay plain narrative / one-liners by design",
            "RULE 5 · TOKEN-SAFE FOR 50+ DOCS — DS2 batches bounded by BOTH doc count and evidence char volume; DS4 builds ALL 3 levels + Tab 2 (including the date overview paragraph and full quick_facts) with ZERO LLM calls; DS5's audit prompt only sees a bounded text preview + counts, never the full 3-level JSON",
            "RULE 6 · NULL-DATE HANDLING — undated docs appear under 'Date Unknown' at every level, including the date_overview_summary",
        ],
        "pipeline": [
            "DS1 · DocumentPreparer      — NO LLM. Uses raw `document` field verbatim, deterministic display label, truncates oversized evidence, builds token-safe batches (count + char ceiling)",
            "DS2 · EvidenceAnalyzer      — llm_synthesis extracts 9 categories verbatim per document, one batch at a time",
            "DS3 · DateAggregator        — dedupes by filename only; documents sharing a date stay as separate list entries",
            "DS4 · ThreeLevelReportBuilder — NO LLM. Deterministically builds Level 1 date_index, Level 2 date_overview_summary + document previews, Level 3 narrative + full 9-category quick_facts, and the Tab 2 synoptic Element ID/Data Element/Value tables",
            "DS5 · QualityGate           — audits completeness, document separation, and structure of all levels, using only a bounded text preview + counts (never the full JSON)",
        ],
        "token_safety": {
            "ds2_batch_max_docs":            BATCH_SIZE,
            "ds2_batch_max_evidence_chars":  MAX_BATCH_EVIDENCE_CHARS,
            "per_entity_evidence_cap_chars": EVIDENCE_TRUNCATE_CHARS,
            "ds2_max_tokens":                 DS2_MAX_TOKENS,
            "ds4_llm_calls":                  0,
            "ds5_input":                      "bounded synoptic-text preview (QUALITY_PREVIEW_CHARS) + small counts/date lists only — never the full date_index/timeline/quick_facts/date_overview_summary payload",
            "one_line_summary_max_chars":     ONE_LINE_MAX_CHARS,
            "date_overview_summary_max_chars": DATE_OVERVIEW_MAX_CHARS,
            "note": (
                "With 50+ documents, DS1 produces multiple small batches bounded by "
                "BOTH document count and evidence character volume, run concurrently "
                "in DS2 (the ONLY LLM step whose cost scales with document count). "
                "DS4 (all 3 drill-down levels + Tab 2, including narrative prose, the "
                "date-level overview paragraph, and full 9-category quick_facts) never "
                "calls an LLM, so formatting cost is O(1) regardless of document count. "
                "DS5's audit call is also flat-cost: it only ever receives a bounded "
                "text preview plus small counts/date lists, never the full date_index/"
                "timeline/quick_facts/date_overview_summary JSON, so it can't grow with "
                "patient document volume either."
            ),
        },
        "null_date_handling": (
            f"Docs with no recoverable date → sentinel '{NULL_DATE_KEY}' → "
            f"'Date Unknown' row/block at end of every level, including its own "
            f"date_overview_summary."
        ),
    }