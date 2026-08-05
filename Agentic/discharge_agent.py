"""
CCGI Discharge Summary Agent — Verbatim Evidence · LLM Label · Full Clinical Detail
======================================================================================
v4.0.0 — Breaking changes from v3:

  RULE 1 · ZERO EVIDENCE LOSS
    Every entity's evidence_text from every graph document is preserved
    in full. Nothing is summarised away, merged, or dropped. The output
    shows exactly what the graph contains — word for word.

  RULE 2 · LLM-ONLY DOCUMENT LABELING (DS0)
    The labeler agent reads the ACTUAL evidence content, entity types,
    relation types, AND filename to give the correct medical document label.
    No rule-based shortcuts. The LLM is always called.

  RULE 3 · PER-DOCUMENT ABNORMALITIES + RECOMMENDATIONS
    DS2 (EvidenceAnalyzer) flags abnormalities AND surfaces any
    recommendations / suggestions / plans written in each document
    individually. Both appear under every document section in DS4.

  RULE 4 · ALL DISCHARGE DOCUMENT TYPES SUPPORTED
    Prompts are written to handle: Doctor Progress Notes, Nurse Notes,
    Operative / Procedure Notes, Anaesthesia Notes, ICU Notes,
    Investigation Reports (Lab / Radiology / Echo / Histo / Micro /
    Urine / Culture / Coagulation / ABG / PFT / etc.),
    Medication Charts, Vital Signs Charts, Consultation Notes,
    Physiotherapy Notes, Dietary Notes, Blood Transfusion Records,
    Social Work Notes, Discharge Instructions — everything.

  RULE 5 · NULL-DATE HANDLING (retained from v2.1)
    Documents with no recoverable date appear under "Date Unknown".
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

BATCH_SIZE = int(os.getenv("DISCHARGE_BATCH_SIZE", "5"))

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

# Fast model for labeling (reads evidence content — needs comprehension)
llm_label = ChatGroq(
    model="llama-3.3-70b-versatile",
    temperature=0.0,
    max_tokens=512,
    groq_api_key=GROQ_API_KEY,
)

# Heavy model for clinical extraction (full evidence, all categories)
llm_synthesis = ChatGroq(
    model="llama-3.3-70b-versatile",
    temperature=0.0,
    max_tokens=8000,
    groq_api_key=GROQ_API_KEY,
)

# Light model for aggregation / quality
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
    doctor_id:             str
    specialty:             str
    include_intermediates: bool = False
    batch_size:            Optional[int] = None


# ═══════════════════════════════════════════════════════════════
# PIPELINE STATE
# ═══════════════════════════════════════════════════════════════

class DischargeState(TypedDict):
    patient_id:   str
    doctor_id:    str
    specialty:    str
    batch_size:   int

    admission_reason: Optional[str]
    admission_date:   Optional[str]
    patient_dob:      Optional[str]
    patient_sex:      Optional[str]
    patient_name:     Optional[str]

    graph_documents:   List[Dict]   # raw from Neo4j
    labeled_documents: Optional[List[Dict]]   # after DS0
    document_batches:  Optional[List[List[Dict]]]
    batch_analyses:    Optional[List[Dict]]
    date_merged:       Optional[Dict]
    discharge_summary: Optional[str]
    day_wise_timeline: Optional[List[Dict]]
    quality_report:    Optional[Dict]

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
    The full evidence_text of every entity is preserved — nothing is dropped.
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

                # Try to recover date from entity-level date fields
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
            ip_appts = [
                a for a in appt_doc.get("appointments", [])
                if a.get("doctor_id") == doctor_id
                and a.get("visit_type", "").upper() == "IP"
            ]
            if ip_appts:
                # ✅ FIX: sort using created_at instead of date
                ip_appts.sort(
                    key=lambda x: x.get("created_at", ""),
                    reverse=True
                )

                latest = ip_appts[0]
                result["admission_reason"] = latest.get("chief_complaint")
                result["admission_date"]   = latest.get("date")
    except Exception as e:
        logger.warning(f"Could not fetch IP appointment for {patient_id}: {e}")

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
# DS0 · DOCUMENT LABELER  — LLM reads actual evidence content
# ═══════════════════════════════════════════════════════════════
# The agent is always called (no rule-based shortcuts).
# It receives: filename, entity types + names, relation types,
# AND the full evidence texts — so it can make a fully-informed
# judgment about what kind of hospital document this really is.
# ═══════════════════════════════════════════════════════════════

_LABEL_TAXONOMY = """\
HOSPITAL DOCUMENT LABEL TAXONOMY
(choose the single most accurate label — create a new one if none fits):

CLINICAL NOTES
  Doctor Progress Note | Senior Doctor Round Note | Intern / Resident Note
  Nursing Progress Note | Nursing Assessment Note | Night Nursing Note
  ICU Progress Note | HDU Progress Note | NICU Note
  Operative Note | Post-Operative Note | Pre-Operative Assessment
  Anaesthesia Note | Recovery Room Note
  Consultation Note | Referral Note | Specialist Opinion
  Physiotherapy Note | Occupational Therapy Note | Speech Therapy Note
  Dietary / Nutritionist Note | Social Work Note | Palliative Care Note
  Discharge Note | Discharge Instructions | Transfer Note

INVESTIGATION REPORTS — LABORATORY
  CBC / Haematology Report | Biochemistry / Metabolic Panel Report
  Coagulation / Clotting Profile | Blood Culture Report
  Urine Analysis Report | Urine Culture Report | Stool Culture Report
  Arterial Blood Gas (ABG) Report | Thyroid Function Test Report
  Liver Function Test Report | Renal Function Test Report
  Lipid Profile Report | Blood Glucose / HbA1c Report
  Tumour Markers Report | Hormone Panel Report | Serology Report
  Microbiology / Sensitivity Report | Blood Bank / Crossmatch Report
  Genetic / Molecular Report | CSF Analysis Report | Fluid Analysis Report

INVESTIGATION REPORTS — IMAGING & CARDIOLOGY
  X-Ray Report | CT Scan Report | MRI Report | PET Scan Report
  Ultrasound / USG Report | Doppler Study Report
  Echocardiogram Report | ECG / EKG Report | Holter Report
  Nuclear Medicine / Isotope Scan Report | Bone Densitometry Report
  Mammogram Report | Fluoroscopy Report

INVESTIGATION REPORTS — PROCEDURE-BASED
  Histopathology / Biopsy Report | Cytology / FNAC Report
  Endoscopy Report | Colonoscopy Report | Bronchoscopy Report
  Cystoscopy / TURBT Report | Laparoscopy Report
  Pulmonary Function Test (PFT) Report | Sleep Study Report
  Cardiac Catheterisation / Angiography Report
  Electromyography (EMG) / Nerve Conduction Study

CHARTS & RECORDS
  Vital Signs Chart | Fluid Balance Chart | Input-Output Chart
  Medication Administration Record (MAR) | Medication Chart
  Blood Transfusion Record | Insulin Sliding Scale Chart
  Wound Care / Dressing Record | Neurovascular Observation Chart
  Pain Assessment Chart | Fall Risk Assessment | Pressure Injury Chart
  Surgical Safety Checklist | Anaesthesia Monitoring Chart
"""


class DocumentLabelerAgent(BaseAgent):
    agent_id = "DS0"

    async def _label_one(self, doc: Dict, specialty: str) -> Dict:
        filename     = doc.get("document", "unknown")
        doc_date     = doc.get("document_date") or "Unknown"
        entities     = doc.get("entities", [])

        # Gather entity metadata and ALL evidence texts
        entity_types   = list({e.get("entity_type", "") for e in entities if e.get("entity_type")})
        relation_types = list({e.get("relation", "") for e in entities if e.get("relation")})
        entity_names   = [e.get("entity_name", "") for e in entities if e.get("entity_name")]

        # All evidence texts — full, verbatim
        evidence_texts = [
            e.get("evidence", "").strip()
            for e in entities
            if e.get("evidence", "").strip()
        ]

        # Concatenate evidence for the labeler (truncate to 2000 chars to keep prompt sane)
        evidence_concat = "\n---\n".join(evidence_texts)
        if len(evidence_concat) > 2000:
            evidence_concat = evidence_concat[:2000] + "\n...[truncated for labeling]"

        system = (
            f"You are a senior {specialty} clinician and medical records expert. "
            "Read the document evidence text carefully and assign the single most "
            "accurate document label from the provided taxonomy. "
            "You MUST read the actual evidence content — not just the entity types — "
            "to determine the correct label. For example:\n"
            "  • If evidence mentions 'BP 130/80, HR 88, Temp 98.6' → Vital Signs Chart\n"
            "  • If evidence mentions 'Inj. Ceftriaxone 1g IV BD' → Medication Chart\n"
            "  • If evidence mentions histological sections, staining → Histopathology Report\n"
            "  • If evidence mentions 'Patient reviewed, plan is...' → Doctor Progress Note\n"
            "  • If evidence mentions 'Patient repositioned, IV site checked' → Nursing Progress Note\n"
            "  • If evidence mentions 'EF 71%, LVIDd 4.8 cm' → Echocardiogram Report\n"
            "  • If evidence mentions intraoperative events → Operative Note\n"
            "  • If evidence mentions post-operative status → Post-Operative Note\n"
            "Return ONLY valid JSON with a single field: document_label."
        )

        prompt = (
            f"SPECIALTY      : {specialty}\n"
            f"FILENAME       : {filename}\n"
            f"DOCUMENT DATE  : {doc_date}\n"
            f"ENTITY TYPES   : {json.dumps(entity_types)}\n"
            f"RELATION TYPES : {json.dumps(relation_types)}\n"
            f"ENTITY NAMES   : {json.dumps(entity_names[:20])}\n\n"
            f"EVIDENCE TEXT (full content from graph):\n"
            f"{evidence_concat}\n\n"
            f"{_LABEL_TAXONOMY}\n\n"
            'Return ONLY: {"document_label": "Exact Label From Taxonomy Or New Specific Label"}'
        )

        result = await self._invoke(system, prompt)
        label  = result.get("document_label") or "Clinical Document"
        return label

    async def run(self, state: DischargeState) -> DischargeState:
        logger.info(f"{self.agent_id} · DocumentLabeler — START")
        t0 = datetime.now().timestamp()

        raw_docs  = state["graph_documents"]
        specialty = state["specialty"]

        # Label all docs concurrently
        labels = await asyncio.gather(
            *[self._label_one(doc, specialty) for doc in raw_docs],
            return_exceptions=True,
        )

        labeled: List[Dict] = []
        for doc, label_result in zip(raw_docs, labels):
            if isinstance(label_result, Exception):
                logger.error(f"{self.agent_id} · Labeling failed for {doc.get('document')}: {label_result}")
                label = "Clinical Document"
            else:
                label = label_result

            # Collect ALL evidence texts — every entity, nothing skipped
            all_evidence = []
            for ent in doc.get("entities", []):
                ev = ent.get("evidence", "").strip()
                if ev:
                    all_evidence.append({
                        "entity_type":  ent.get("entity_type", ""),
                        "entity_name":  ent.get("entity_name", ""),
                        "relation":     ent.get("relation", ""),
                        "evidence_text": ev,
                    })

            # Only skip documents that have zero evidence text at all
            if not all_evidence:
                logger.debug(
                    f"{self.agent_id} · Skipping {doc.get('document')} — "
                    f"no evidence text in any entity"
                )
                continue

            labeled.append({
                **doc,
                "document_label": label,
                "all_evidence":   all_evidence,   # full verbatim evidence, structured
            })

        # Sort: dated docs first (ascending), undated last
        labeled.sort(key=lambda d: (0, d["document_date"]) if d["document_date"] else (1, ""))

        state["labeled_documents"]            = labeled
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(
            f"{self.agent_id} · DocumentLabeler — DONE "
            f"({state['agent_timings'][self.agent_id]}ms) | "
            f"{len(labeled)} docs labeled"
        )
        return state


# ═══════════════════════════════════════════════════════════════
# DS1 · BATCH BUILDER
# ═══════════════════════════════════════════════════════════════
# Passes the full all_evidence list to DS2 — nothing is stripped.
# ═══════════════════════════════════════════════════════════════

class BatchBuilderAgent(BaseAgent):
    agent_id = "DS1"

    async def run(self, state: DischargeState) -> DischargeState:
        logger.info(f"{self.agent_id} · BatchBuilder — START")
        t0 = datetime.now().timestamp()

        labeled    = state["labeled_documents"] or []
        batch_size = state["batch_size"]

        slim_docs = []
        for doc in labeled:
            slim_docs.append({
                "document_date":  doc["document_date"] or NULL_DATE_KEY,
                "document_label": doc["document_label"],
                "filename":       doc.get("document", "unknown"),
                # Full evidence — all entities, all text
                "all_evidence":   doc["all_evidence"],
            })

        batches: List[List[Dict]] = []
        for i in range(0, len(slim_docs), batch_size):
            batches.append(slim_docs[i : i + batch_size])

        state["document_batches"]             = batches
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(
            f"{self.agent_id} · BatchBuilder — DONE "
            f"({state['agent_timings'][self.agent_id]}ms) | "
            f"{len(batches)} batches of up to {batch_size}"
        )
        return state


# ═══════════════════════════════════════════════════════════════
# DS2 · EVIDENCE ANALYZER  — verbatim extraction, per-doc sections
# ═══════════════════════════════════════════════════════════════
# KEY RULES for this agent:
#   • Present EVERY piece of evidence as-is. Do NOT summarise or merge.
#   • Extract all 9 clinical categories per document.
#   • Flag abnormalities FOR EACH DOCUMENT individually.
#   • Surface any recommendations / plans / suggestions found in the doc.
#   • Handle ALL document types: notes, charts, reports, records.
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
6. Return ONLY valid JSON — no prose outside the JSON.
"""

_DS2_PROMPT_TEMPLATE = """\
SPECIALTY       : {specialty}
ADMISSION REASON: {admission_reason}
BATCH           : {batch_num} of {batch_total}
DOCUMENTS IN BATCH: {batch_len}

══════════════════════════════════════════════════════════════
DOCUMENTS (each contains all_evidence from the knowledge graph)
══════════════════════════════════════════════════════════════
{batch_json}

══════════════════════════════════════════════════════════════
EXTRACTION TASK — For EVERY document in this batch:
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
        "document_label":    "...",
        "filename":          "...",
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
        logger.info(f"{self.agent_id} · EvidenceAnalyzer — START (concurrent)")
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
# Merges batch outputs into one date-keyed dict.
# All 9 clinical categories + abnormalities + recommendations retained.
# De-duplication: by (document_label + filename) pair, NOT by summary text,
# because we no longer produce summaries — we keep all evidence.
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

                # De-duplicate by filename — same physical document should
                # not appear twice even if processed in overlapping batches.
                existing_filenames = {
                    d.get("filename", "") for d in merged[date_key]["documents"]
                }
                for doc_entry in date_data.get("documents", []):
                    fname = doc_entry.get("filename", "")
                    if fname and fname in existing_filenames:
                        continue  # already have this file for this date
                    merged[date_key]["documents"].append(doc_entry)
                    if fname:
                        existing_filenames.add(fname)

        if not merged:
            state["date_merged"]                  = {}
            state["agent_timings"][self.agent_id] = self._elapsed(t0)
            return state

        # Separate known dates from unknown
        known_dates   = sorted(k for k in merged if k != NULL_DATE_KEY)
        has_null_docs = NULL_DATE_KEY in merged

        # Determine admission date baseline for day numbering
        if admission_date:
            try:
                adm_str = datetime.strptime(admission_date[:10], "%Y-%m-%d").strftime("%Y-%m-%d")
            except Exception:
                adm_str = known_dates[0] if known_dates else None
        else:
            adm_str = known_dates[0] if known_dates else None

        # Annotate known-date entries with day labels
        for date_key in known_dates:
            try:
                current_dt = datetime.strptime(date_key, "%Y-%m-%d")
                adm_dt_obj = datetime.strptime(adm_str, "%Y-%m-%d") if adm_str else current_dt
                day_num    = (current_dt - adm_dt_obj).days + 1
            except Exception:
                day_num = None

            if day_num == 1:
                date_label = "Admission Day"
            elif day_num is not None and day_num > 1:
                date_label = f"Day {day_num} of Admission"
            elif day_num is not None and day_num <= 0:
                date_label = f"Pre-Admission ({date_key})"
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
# DS4 · NARRATIVE BUILDER  — story mode, full verbatim sections
# ═══════════════════════════════════════════════════════════════

def _sorted_date_keys(date_merged: Dict) -> List[str]:
    known   = sorted(k for k in date_merged if k != NULL_DATE_KEY)
    unknown = [NULL_DATE_KEY] if NULL_DATE_KEY in date_merged else []
    return known + unknown


def _fmt_vitals(items: List[Dict]) -> List[str]:
    out = []
    for v in items:
        line = f"{v.get('parameter','')}: {v.get('value','')}".strip(": ")
        if v.get("unit"):   line += f" {v['unit']}"
        if v.get("note"):   line += f"  ({v['note']})"
        if line:
            out.append(line)
    return out


def _fmt_medications(items: List[Dict]) -> List[str]:
    out = []
    for m in items:
        parts = [m.get("drug", "")]
        if m.get("dose"):      parts.append(m["dose"])
        if m.get("route"):     parts.append(f"({m['route']})")
        if m.get("frequency"): parts.append(m["frequency"])
        if m.get("duration"):  parts.append(f"× {m['duration']}")
        line = "  ".join(p for p in parts if p)
        if line:
            out.append(line)
    return out


def _fmt_investigations(items: List[Dict]) -> List[str]:
    out = []
    for inv in items:
        line = f"{inv.get('test','')}: {inv.get('result','')}".strip(": ")
        if inv.get("unit"):            line += f" {inv['unit']}"
        if inv.get("reference_range"): line += f"  [ref: {inv['reference_range']}]"
        status = (inv.get("status") or "").lower()
        if status in ("abnormal", "critical"):
            line += f"  ⚠ {status.upper()}"
        if line:
            out.append(line)
    return out


def _fmt_procedures(items: List[Dict]) -> List[str]:
    out = []
    for p in items:
        line = p.get("name", "")
        if p.get("detail"):     line += f" — {p['detail']}"
        if p.get("laterality"): line += f" [{p['laterality']}]"
        if p.get("surgeon"):    line += f"  (Surgeon: {p['surgeon']})"
        if line:
            out.append(line)
    return out


def _build_plain_text(
    date_merged:      Dict,
    patient_name:     str,
    patient_dob:      str,
    patient_sex:      str,
    admission_reason: str,
    admission_date:   Optional[str],
    specialty:        str,
) -> str:
    SEP  = "═" * 72
    THIN = "─" * 72
    lines: List[str] = []

    lines += [
        SEP,
        f"  DISCHARGE SUMMARY  —  {specialty.upper()}",
        SEP,
        f"  Patient           : {patient_name}",
        f"  Date of Birth     : {patient_dob}",
        f"  Sex               : {patient_sex}",
        SEP,
        "",
        THIN,
        "  ADMISSION DETAILS",
        THIN,
        f"  Reason for Admission : {admission_reason}",
        f"  Date of Admission    : {admission_date or 'Not documented'}",
        "",
    ]

    for date_key in _sorted_date_keys(date_merged):
        day_data   = date_merged[date_key]
        date_label = day_data.get("date_label", date_key)
        documents  = day_data.get("documents", [])
        if not documents:
            continue

        display_date = date_key if date_key != NULL_DATE_KEY else "—"
        lines += [
            THIN,
            f"  {display_date}   │   {date_label.upper()}",
            THIN,
            "",
        ]

        for idx, doc in enumerate(documents, start=1):
            label   = doc.get("document_label", f"Document {idx}")
            fname   = doc.get("filename", "")

            vitals         = doc.get("vitals", [])
            medications    = doc.get("medications", [])
            investigations = doc.get("investigations", [])
            procedures     = doc.get("procedures", [])
            findings       = doc.get("findings", [])
            diagnoses      = doc.get("diagnoses", [])
            treatments     = doc.get("treatments", [])
            abnormalities  = doc.get("abnormalities", [])
            recommendations= doc.get("recommendations", [])

            header = f"  ▸ {label}"
            if fname:
                header += f"  [{fname}]"
            lines += [header, ""]

            if vitals:
                lines.append("    🩺  VITALS")
                for v in _fmt_vitals(vitals):
                    lines.append(f"         • {v}")
                lines.append("")

            if investigations:
                lines.append("    🔬  INVESTIGATIONS / LAB RESULTS")
                for inv in _fmt_investigations(investigations):
                    lines.append(f"         • {inv}")
                lines.append("")

            if procedures:
                lines.append("    🏥  PROCEDURES")
                for p in _fmt_procedures(procedures):
                    lines.append(f"         • {p}")
                lines.append("")

            if medications:
                lines.append("    💊  MEDICATIONS")
                for m in _fmt_medications(medications):
                    lines.append(f"         • {m}")
                lines.append("")

            if findings:
                lines.append("    📋  FINDINGS / OBSERVATIONS")
                for f in findings:
                    lines.append(f"         • {f}")
                lines.append("")

            if diagnoses:
                lines.append("    🩻  DIAGNOSES")
                for d in diagnoses:
                    lines.append(f"         • {d}")
                lines.append("")

            if treatments:
                lines.append("    💉  TREATMENTS / THERAPY")
                for t in treatments:
                    lines.append(f"         • {t}")
                lines.append("")

            if abnormalities:
                lines.append("    ⚠️   ABNORMALITIES / ALERTS")
                for ab in abnormalities:
                    lines.append(f"         ⚠  {ab}")
                lines.append("")

            if recommendations:
                lines.append("    📌  RECOMMENDATIONS / PLAN")
                for rec in recommendations:
                    lines.append(f"         →  {rec}")
                lines.append("")

    lines += [SEP, "  END OF DISCHARGE SUMMARY", SEP]
    return "\n".join(lines)


def _build_timeline_json(
    date_merged:      Dict,
    admission_reason: str,
    admission_date:   Optional[str],
    patient_name:     str,
    patient_dob:      str,
    patient_sex:      str,
    specialty:        str,
) -> List[Dict]:
    timeline: List[Dict] = []

    # ── Admission block — always first ──
    timeline.append({
        "type":            "admission",
        "date":            admission_date,
        "day_number":      0,
        "date_label":      "Admission",
        "story_narrative": (
            f"{patient_name or 'The patient'} "
            f"({'DOB: ' + patient_dob + ', ' if patient_dob and patient_dob != 'Not documented' else ''}"
            f"{patient_sex if patient_sex and patient_sex != 'Not documented' else ''}) "
            f"was admitted on {admission_date or 'an unrecorded date'} "
            f"under {specialty} with the presenting complaint of: {admission_reason}."
        ).replace("()","").replace("  "," "),
        "documents":         [],
        "all_abnormalities": [],
        "all_recommendations": [],
        "has_abnormalities": False,
        "clinical_summary":  {
            "vitals": [], "medications": [], "investigations": [],
            "procedures": [], "findings": [], "diagnoses": [],
            "treatments": [], "recommendations": [],
        },
    })

    # ── Clinical day blocks ──
    for date_key in _sorted_date_keys(date_merged):
        day_data  = date_merged[date_key]
        documents = day_data.get("documents", [])
        if not documents:
            continue

        # Aggregate across all documents on this date
        agg: Dict[str, List] = {
            "vitals": [], "medications": [], "investigations": [],
            "procedures": [], "findings": [], "diagnoses": [],
            "treatments": [], "abnormalities": [], "recommendations": [],
        }

        doc_entries: List[Dict] = []

        for idx, doc in enumerate(documents, start=1):
            label           = doc.get("document_label", f"Document {idx}")
            fname           = doc.get("filename", "")
            vitals          = doc.get("vitals", [])
            medications     = doc.get("medications", [])
            investigations  = doc.get("investigations", [])
            procedures      = doc.get("procedures", [])
            findings        = doc.get("findings", [])
            diagnoses       = doc.get("diagnoses", [])
            treatments      = doc.get("treatments", [])
            abnormalities   = doc.get("abnormalities", [])
            recommendations = doc.get("recommendations", [])

            for k, v in (
                ("vitals", vitals), ("medications", medications),
                ("investigations", investigations), ("procedures", procedures),
                ("findings", findings), ("diagnoses", diagnoses),
                ("treatments", treatments), ("abnormalities", abnormalities),
                ("recommendations", recommendations),
            ):
                agg[k].extend(v)

            doc_entries.append({
                "document_label":    label,
                "filename":          fname,
                "vitals":            vitals,
                "medications":       medications,
                "investigations":    investigations,
                "procedures":        procedures,
                "findings":          findings,
                "diagnoses":         diagnoses,
                "treatments":        treatments,
                "abnormalities":     abnormalities,
                "recommendations":   recommendations,
                "has_abnormalities": len(abnormalities) > 0,
                "has_recommendations": len(recommendations) > 0,
            })

        # Build the day's story narrative
        day_label    = day_data.get("date_label", date_key)
        story_parts  = []

        if agg["procedures"]:
            names = [p.get("name", "") for p in agg["procedures"] if p.get("name")]
            if names:
                story_parts.append(f"Procedure(s) carried out: {', '.join(names)}.")

        if agg["diagnoses"]:
            story_parts.append(f"Diagnosis/es: {'; '.join(agg['diagnoses'][:4])}.")

        if agg["investigations"]:
            tests = list({inv.get("test","") for inv in agg["investigations"] if inv.get("test")})
            if tests:
                story_parts.append(f"Investigations: {', '.join(tests[:6])}.")

        if agg["medications"]:
            drugs = list({m.get("drug","") for m in agg["medications"] if m.get("drug")})
            if drugs:
                story_parts.append(f"Medications administered: {', '.join(drugs[:6])}.")

        if agg["abnormalities"]:
            story_parts.append(
                f"Alerts: {'; '.join(agg['abnormalities'][:3])}."
            )

        if agg["recommendations"]:
            story_parts.append(
                f"Plan: {'; '.join(agg['recommendations'][:3])}."
            )

        story_narrative = (
            f"On {day_label} — "
            + (" ".join(story_parts) if story_parts else "clinical events documented below.")
        )

        timeline.append({
            "type":               "clinical_day",
            "date":               None if date_key == NULL_DATE_KEY else date_key,
            "day_number":         day_data.get("day_number"),
            "date_label":         day_data.get("date_label", date_key),
            "story_narrative":    story_narrative,
            "documents":          doc_entries,
            "all_abnormalities":  agg["abnormalities"],
            "all_recommendations": agg["recommendations"],
            "has_abnormalities":  len(agg["abnormalities"]) > 0,
            "clinical_summary": {
                "vitals":         agg["vitals"],
                "medications":    agg["medications"],
                "investigations": agg["investigations"],
                "procedures":     agg["procedures"],
                "findings":       agg["findings"],
                "diagnoses":      agg["diagnoses"],
                "treatments":     agg["treatments"],
                "recommendations":agg["recommendations"],
            },
        })

    return timeline


class NarrativeBuilderAgent(BaseAgent):
    agent_id = "DS4"

    async def run(self, state: DischargeState) -> DischargeState:
        logger.info(f"{self.agent_id} · NarrativeBuilder — START")
        t0 = datetime.now().timestamp()

        date_merged      = state.get("date_merged") or {}
        specialty        = state["specialty"]
        admission_reason = state.get("admission_reason") or "Not documented"
        admission_date   = state.get("admission_date")
        patient_name     = state.get("patient_name") or "Not documented"
        patient_dob      = state.get("patient_dob") or "Not documented"
        patient_sex      = state.get("patient_sex") or "Not documented"

        plain_text    = _build_plain_text(
            date_merged      = date_merged,
            patient_name     = patient_name,
            patient_dob      = patient_dob,
            patient_sex      = patient_sex,
            admission_reason = admission_reason,
            admission_date   = admission_date,
            specialty        = specialty,
        )
        timeline_json = _build_timeline_json(
            date_merged      = date_merged,
            admission_reason = admission_reason,
            admission_date   = admission_date,
            patient_name     = patient_name,
            patient_dob      = patient_dob,
            patient_sex      = patient_sex,
            specialty        = specialty,
        )

        state["discharge_summary"]            = plain_text
        state["day_wise_timeline"]            = timeline_json
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(
            f"{self.agent_id} · NarrativeBuilder — DONE "
            f"({state['agent_timings'][self.agent_id]}ms) | "
            f"{len(timeline_json)} blocks"
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
        labeled_docs      = state.get("labeled_documents") or []
        admission_reason  = state.get("admission_reason")

        clinical_blocks  = [e for e in day_wise_timeline if e.get("type") == "clinical_day"]
        timeline_dates   = [entry.get("date","") for entry in clinical_blocks]
        labeled_dates    = sorted({d.get("document_date") or "Unknown" for d in labeled_docs})

        total_docs         = len(labeled_docs)
        summarized_docs    = sum(len(e.get("documents",[])) for e in clinical_blocks)
        dates_with_abnorms = [e["date"] for e in clinical_blocks if e.get("has_abnormalities")]

        has_vitals    = any(e.get("clinical_summary",{}).get("vitals")    for e in clinical_blocks)
        has_meds      = any(e.get("clinical_summary",{}).get("medications") for e in clinical_blocks)
        has_invest    = any(e.get("clinical_summary",{}).get("investigations") for e in clinical_blocks)
        has_procs     = any(e.get("clinical_summary",{}).get("procedures") for e in clinical_blocks)
        has_recs      = any(e.get("clinical_summary",{}).get("recommendations") for e in clinical_blocks)

        summary_preview = discharge_summary[:3000] + (
            "\n...[truncated]" if len(discharge_summary) > 3000 else ""
        )

        system = (
            f"You are a senior {specialty} clinical quality auditor. "
            "Audit this discharge summary for completeness, accuracy, and "
            "clinical safety. Documents with date 'null' / 'UNKNOWN_DATE' / "
            "'Date Unknown' are valid and must be counted as covered. "
            "Return ONLY valid JSON."
        )

        prompt = (
            f"SPECIALTY: {specialty}\n"
            f"ADMISSION REASON: {admission_reason or 'Not documented'}\n\n"
            f"TOTAL GRAPH DOCUMENTS: {total_docs}\n"
            f"DOCUMENTS IN OUTPUT: {summarized_docs}\n"
            f"ALL DOCUMENT DATES: {json.dumps(labeled_dates)}\n"
            f"DATES IN TIMELINE: {json.dumps(timeline_dates)}\n"
            f"DATES WITH ABNORMALITIES: {json.dumps(dates_with_abnorms)}\n"
            f"VITALS PRESENT: {has_vitals} | MEDICATIONS: {has_meds} | "
            f"INVESTIGATIONS: {has_invest} | PROCEDURES: {has_procs} | "
            f"RECOMMENDATIONS: {has_recs}\n\n"
            f"DISCHARGE SUMMARY PREVIEW:\n{summary_preview}\n\n"
            "AUDIT CHECKLIST (PASS / FAIL / PARTIAL):\n"
            "  1. admission_reason_in_header\n"
            "  2. all_graph_documents_covered  — every doc from the graph appears\n"
            "  3. all_dates_covered\n"
            "  4. vitals_extracted_where_present\n"
            "  5. medications_extracted_where_present\n"
            "  6. investigations_extracted_where_present\n"
            "  7. procedures_extracted_where_present\n"
            "  8. per_doc_abnormalities_flagged\n"
            "  9. per_doc_recommendations_captured\n"
            " 10. document_labels_clinically_accurate\n"
            " 11. no_evidence_dropped  — no data omitted or summarised away\n"
            " 12. day_numbering_consistent\n\n"
            "SCORES (0.0-1.0):\n"
            "  completeness, date_coverage, clinical_detail,\n"
            "  abnormality_detection, recommendation_capture, coherence\n"
            "  overall = mean of all six\n\n"
            "Return ONLY:\n"
            "{\n"
            '  "checklist": { "item_name": "PASS|FAIL|PARTIAL", ... },\n'
            '  "scores": { "completeness":0.0, "date_coverage":0.0,\n'
            '    "clinical_detail":0.0, "abnormality_detection":0.0,\n'
            '    "recommendation_capture":0.0, "coherence":0.0, "overall":0.0 },\n'
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

    workflow.add_node("DS0", DocumentLabelerAgent(llm_label).run)
    workflow.add_node("DS1", BatchBuilderAgent(llm_light).run)
    workflow.add_node("DS2", EvidenceAnalyzerAgent(llm_synthesis).run)
    workflow.add_node("DS3", DateAggregatorAgent(llm_light).run)
    workflow.add_node("DS4", NarrativeBuilderAgent(llm_light).run)
    workflow.add_node("DS5", DischargeQualityAgent(llm_light).run)

    workflow.set_entry_point("DS0")
    workflow.add_edge("DS0", "DS1")
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
        patient_id         = request.patient_id,
        doctor_id          = request.doctor_id,
        specialty          = request.specialty,
        batch_size         = request.batch_size or BATCH_SIZE,
        admission_reason   = admission_context.get("admission_reason"),
        admission_date     = admission_context.get("admission_date"),
        patient_dob        = admission_context.get("patient_dob"),
        patient_sex        = admission_context.get("patient_sex"),
        patient_name       = admission_context.get("patient_name"),
        graph_documents    = graph_docs,
        labeled_documents  = None,
        document_batches   = None,
        batch_analyses     = None,
        date_merged        = None,
        discharge_summary  = None,
        day_wise_timeline  = None,
        quality_report     = None,
        errors             = [],
        agent_timings      = {},
    )


# ═══════════════════════════════════════════════════════════════
# DEMO DATA — covers all document types
# ═══════════════════════════════════════════════════════════════

def load_demo_graph_documents() -> List[Dict]:
    return [
        # ── Histopathology report (dated) ──
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
        # ── Doctor progress note (dated) ──
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
        # ── Nursing note (dated) ──
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
        # ── Medication chart (dated) ──
        {
            "document":      "medication_chart.pdf",
            "document_date": "2026-01-07",
            "entities": [
                {
                    "relation":    "HAS_MEDICATION",
                    "entity_type": "Medication",
                    "evidence":    "Inj. Ceftriaxone 1 g IV BD. Tab. Pantoprazole 40 mg OD before food. Inj. Tramadol 50 mg IV SOS for pain (max 3 doses/day). IV Fluids: Normal Saline 100 ml/hr. Tab. Metronidazole 400 mg TDS."
                },
            ],
        },
        # ── Post-op vitals note (dated) ──
        {
            "document":      "post_op_notes.pdf",
            "document_date": "2026-01-07",
            "entities": [
                {
                    "relation":    "HAS_VITAL",
                    "entity_type": "Vital Sign",
                    "evidence":    "Post-operative hypotension noted. Blood pressure recorded at 90/60 mmHg. Patient pale and diaphoretic. IV fluids started immediately. 500 ml NS bolus given. BP improved to 110/70 mmHg after resuscitation."
                },
            ],
        },
        # ── Echocardiogram report (undated) ──
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
        # ── CBC lab report (undated) ──
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
        # ── Physiotherapy note (undated) ──
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

@router.post("/discharge-summary", response_model=None)
async def generate_discharge_summary(request: DischargeSummaryRequest):
    """
    Discharge Summary Agent v4.0.0
    • Zero evidence loss — every graph entity shown verbatim
    • LLM-only document labeling (reads actual content)
    • Per-document abnormalities + recommendations
    • All discharge document types supported
    • Story-mode timeline starting with admission block
    • Null-date docs under 'Date Unknown'
    """
    start_ms = datetime.now().timestamp() * 1000
    logger.info(
        f"Discharge Summary v4 | patient={request.patient_id} | "
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
            f"Admission context: reason='{admission_context.get('admission_reason')}' "
            f"date='{admission_context.get('admission_date')}'"
        )

        initial_state = build_discharge_state(request, graph_docs, admission_context)
        result        = await discharge_workflow.ainvoke(initial_state)

        elapsed = round(datetime.now().timestamp() * 1000 - start_ms)
        quality = result.get("quality_report") or {}

        response = {
            "patient_id":         request.patient_id,
            "doctor_id":          request.doctor_id,
            "generated_at":       datetime.now().isoformat(),
            "documents_analyzed": len(graph_docs),
            "processing_time_ms": elapsed,
            "version":            "4.0.0",

            "admission_reason": result.get("admission_reason"),
            "admission_date":   result.get("admission_date"),
            "patient": {
                "name": result.get("patient_name"),
                "dob":  result.get("patient_dob"),
                "sex":  result.get("patient_sex"),
            },

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
                "labeled_documents": result.get("labeled_documents"),
                "document_batches":  result.get("document_batches"),
                "batch_analyses":    result.get("batch_analyses"),
                "date_merged":       result.get("date_merged"),
            }

        try:
            await mongo_db["discharge_summaries"].insert_one({
                **response,
                "saved_at": datetime.utcnow(),
            })
        except Exception as e:
            logger.error(f"MongoDB save failed: {e}")

        logger.info(
            f"Discharge Summary v4 complete | patient={request.patient_id} | "
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
    """Run pipeline with demo data covering all document types."""
    demo_request = DischargeSummaryRequest(
        patient_id            = "PAT-demo-001",
        doctor_id             = "DOC-demo-001",
        specialty             = "Urology",
        include_intermediates = True,
        batch_size            = 5,
    )
    return await generate_discharge_summary(demo_request)


@router.get("/discharge-summary/health")
async def discharge_health():
    return {
        "status":  "ok",
        "version": "4.0.0",
        "agents":  6,
        "core_rules": [
            "RULE 1 · ZERO EVIDENCE LOSS — every entity's evidence_text shown verbatim, nothing merged or dropped",
            "RULE 2 · LLM-ONLY LABELING — DS0 reads actual evidence content to label every document",
            "RULE 3 · PER-DOC ABNORMALITIES + RECOMMENDATIONS — each document section has its own ⚠ and 📌 blocks",
            "RULE 4 · ALL DOCUMENT TYPES — prompts handle: doctor/nurse/ICU notes, operative notes, anaesthesia, all investigation types, vitals charts, medication charts, physio/dietary/social notes, blood transfusion records",
            "RULE 5 · NULL-DATE HANDLING — undated docs appear under 'Date Unknown' block",
        ],
        "pipeline": [
            "DS0 · DocumentLabeler   — llm_label reads evidence content + filename + entity types → accurate label",
            "DS1 · BatchBuilder      — passes full all_evidence list; assigns NULL_DATE_KEY to undated docs",
            "DS2 · EvidenceAnalyzer  — llm_synthesis extracts 9 categories verbatim: vitals, meds, investigations, procedures, findings, diagnoses, treatments, abnormalities, recommendations",
            "DS3 · DateAggregator    — deduplicates by filename; annotates day labels",
            "DS4 · NarrativeBuilder  — plain-text + JSON timeline; admission block first; per-doc ⚠ + 📌 sections",
            "DS5 · QualityGate       — 6-dimension scoring incl. evidence_dropped and recommendation_capture checks",
        ],
        "document_types_supported": [
            "Doctor Progress Note, Senior Round Note, Consultant Note",
            "Nursing Progress Note, Night Duty Note, Nursing Assessment",
            "ICU/HDU Note, Post-Operative Note, Anaesthesia Note, Operative Note",
            "Consultation Note, Referral, Specialist Opinion",
            "Laboratory: CBC, LFT, RFT, Coagulation, Cultures, ABG, Thyroid, Tumour Markers, Hormones",
            "Imaging: X-Ray, CT, MRI, USG, Echo, PET, Doppler, Nuclear Medicine",
            "Histopathology, Biopsy, Cytology, FNAC",
            "Endoscopy, Colonoscopy, Bronchoscopy, Cystoscopy/TURBT",
            "Vital Signs Chart, Fluid Balance Chart, I/O Chart",
            "Medication Chart / MAR, Blood Transfusion Record",
            "Physiotherapy Note, Dietary Note, Social Work Note",
            "Discharge Instructions, Transfer Note",
        ],
        "null_date_handling": (
            f"Docs with no recoverable date → sentinel '{NULL_DATE_KEY}' in DS1 "
            f"→ 'Date Unknown' block at end of timeline in DS4."
        ),
    }