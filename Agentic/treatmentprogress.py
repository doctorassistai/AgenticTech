from __future__ import annotations
import os, json
from typing import TypedDict, Optional, List, Dict
from datetime import datetime
from collections import defaultdict

from fastapi import APIRouter
from pydantic import BaseModel

from loguru import logger

from langchain_groq import ChatGroq
from langchain_core.messages import SystemMessage, HumanMessage
from langgraph.graph import StateGraph, END

from neo4j import AsyncGraphDatabase
from motor.motor_asyncio import AsyncIOMotorClient

# =========================
# CONFIG
# =========================
router = APIRouter(prefix="/treatment-progress", tags=["Treatment Progress"])

llm = ChatGroq(
    model="llama-3.3-70b-versatile",
    temperature=0.1,
    groq_api_key=os.getenv("GROQ_API_KEY"),
    max_tokens=5000,
)

# Mongo
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

mongo_client = AsyncIOMotorClient(MONGO_URI)
mongo_db = mongo_client[MONGO_DB]

# 🔥 Collections
procedure_notes_collection = mongo_db["procedure_notes"]
diagnosis_data_collection = mongo_db["diagnosis_data"]
patient_appointments_collection = mongo_db["patient_appointments"]
# =========================
# NEO4J CONFIG
# =========================
GROQ_API_KEY  = os.getenv("GROQ_API_KEY")
NEO4J_URI     = os.getenv("NEO4J_URI", "bolt://neo4j:7687")
NEO4J_USER    = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASS    = os.getenv("NEO4J_PASSWORD", "password")


neo4j_driver = AsyncGraphDatabase.driver(
    NEO4J_URI,
    auth=(NEO4J_USER, NEO4J_PASS),
    max_connection_lifetime=3600,
    max_connection_pool_size=50,
)

# =========================
# INPUT MODEL
# =========================
class Request(BaseModel):
    patient_id: str
    doctor_id: str
    care_level: str


# =========================
# STATE
# =========================
class State(TypedDict):
    patient_id: str
    doctor_id: str
    care_level: str

    admission: Optional[Dict]
    diagnosis: Optional[Dict]

    baseline_graph: Optional[List[Dict]]
    treatment_graph: Optional[List[Dict]]

    baseline_summary: Optional[str]
    timeline: Optional[List[Dict]]

    mode: Optional[str]
    mode_reasoning: Optional[str]
    progress: Optional[Dict]


# =========================
# HELPERS
# =========================
import json
import re

def parse_json(text):
    try:
        # 🔥 remove markdown wrappers
        cleaned = re.sub(r"```json|```", "", text).strip()

        return json.loads(cleaned)

    except Exception as e:
        return {
            "raw": text,
            "error": str(e)
        }


async def llm_call(system, prompt):
    res = await llm.ainvoke([
        SystemMessage(content=system),
        HumanMessage(content=prompt)
    ])

    content = res.content.strip()

    logger.debug(f"[LLM RAW OUTPUT] {content}")

    return parse_json(content)


# =========================
# FETCHERS
# =========================
from datetime import date
from loguru import logger

async def fetch_admission(patient_id: str):
    today = date.today().isoformat()

    logger.info(f"[fetch_admission] Fetching admission for patient_id={patient_id}, today={today}")

    doc = await patient_appointments_collection.find_one(
        {
            "sys_user_id": patient_id,
            "appointments": {
                "$elemMatch": {
                    "patient_status": "Admitted",
                    "date": {"$lte": today}
                }
            }
        },
        {
            "_id": 0,
            "appointments": 1
        }
    )

    if not doc:
        result = {
            "admission_reason": "unknown",
            "admitted_at": None,
            "discharge_at": None
        }
        logger.warning(f"[fetch_admission] No document found for patient_id={patient_id}. Returning: {result}")
        return result

    valid_appts = [
        appt for appt in doc.get("appointments", [])
        if appt.get("patient_status") == "Admitted"
        and appt.get("date") <= today
    ]

    if not valid_appts:
        result = {
            "admission_reason": "unknown",
            "admitted_at": None,
            "discharge_at": None
        }
        logger.warning(f"[fetch_admission] No valid admitted appointments for patient_id={patient_id}. Returning: {result}")
        return result

    latest = sorted(valid_appts, key=lambda x: x.get("date"), reverse=True)[0]

    result = {
        "admission_reason": latest.get("chief_complaint", "unknown"),
        "admitted_at": latest.get("date"),
        "discharge_at": None
    }

    logger.info(f"[fetch_admission] Latest admission for patient_id={patient_id}: {result}")

    return result


from bson import ObjectId

from datetime import datetime, date

def serialize_mongo(doc):
    if not doc:
        return {}

    def convert(obj):
        if isinstance(obj, (datetime, date)):
            return obj.isoformat()
        if isinstance(obj, dict):
            return {k: convert(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [convert(i) for i in obj]
        return obj

    doc = convert(doc)

    if "_id" in doc:
        doc["_id"] = str(doc["_id"])

    return doc



async def fetch_diagnosis(patient_id, doctor_id):
    doc = await mongo_db["diagnosis_data"].find_one(
        {"patient_id": patient_id, "doctor_id": doctor_id},
        sort=[("updated_at", -1)]
    )
    return serialize_mongo(doc)


async def fetch_graph_split(patient_id, admitted_at, end_date):

    cypher = """ 
    // your query unchanged
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
                n.name,
                n.details,
                n.description,
                n.drug_name,
                n.test_name,
                n.vital_type,
                n.value
            ),

            date: raw_date,
            evidence: e.evidence_text
        }) AS entities

    RETURN document, document_date, entities
    ORDER BY document_date ASC
    """

    baseline, treatment = [], []

    async with neo4j_driver.session() as session:
        result = await session.run(cypher, patient_id=patient_id)

        logger.info(f"[graph_split] Running for patient={patient_id}, admitted_at={admitted_at}, end_date={end_date}")

        async for record in result:
            doc = dict(record)

            doc_date = doc.get("document_date")
            entities = doc.get("entities", [])

            # Convert Neo4j date → string
            if doc_date:
                doc_date_str = f"{doc_date.year:04d}-{doc_date.month:02d}-{doc_date.day:02d}"
            else:
                doc_date_str = None

            logger.debug(f"[graph_split] Document={doc.get('document')} | doc_date={doc_date_str} | entities={len(entities)}")

            for ent in entities:

                event_date = doc_date_str or ent.get("date")

                rec = {
                    "relation": ent.get("relation"),
                    "entity_type": ent.get("entity_type"),
                    "name": ent.get("name"),
                    "date": event_date,
                    "evidence": ent.get("evidence"),
                    "document": doc.get("document")
                }

                # NULL date → baseline
                if not event_date:
                    baseline.append(rec)
                    logger.debug(f"[baseline-null] {rec}")
                    continue

                if admitted_at and event_date < admitted_at:
                    baseline.append(rec)

                elif admitted_at and admitted_at <= event_date <= end_date:
                    treatment.append(rec)

                else:
                    baseline.append(rec)

    # 🔥 FINAL LOGS (MOST IMPORTANT)
    logger.info(f"[graph_split] ✅ Baseline count: {len(baseline)}")
    logger.info(f"[graph_split] ✅ Treatment count: {len(treatment)}")

    # 🔥 Sample logs (avoid huge logs)
    if baseline:
        logger.info(f"[graph_split] Baseline sample (first 3): {baseline[:3]}")

    if treatment:
        logger.info(f"[graph_split] Treatment sample (first 3): {treatment[:3]}")

    # 🔥 Edge case logging
    if not admitted_at:
        logger.warning("[graph_split] admitted_at is NULL → all data likely treated as baseline")

    return baseline, treatment

# =========================
# AGENTS
# =========================
async def admission_agent(state: State):
    state["admission"] = await fetch_admission(state["patient_id"])
    return state


async def diagnosis_agent(state: State):
    state["diagnosis"] = await fetch_diagnosis(
        state["patient_id"], state["doctor_id"]
    )
    return state


async def mode_agent(state: State):
    system_prompt = """You are a clinical triage specialist responsible for classifying hospital admissions 
into the correct care mode. Your classification determines how a patient's progress will be evaluated, 
so accuracy is critical.

There are exactly three valid modes:

1. "diagnostic" — The primary purpose of admission is to perform an investigative procedure to reach 
   a diagnosis. This includes biopsies (FNAC, core needle, excisional), endoscopies for diagnosis, 
   imaging-guided procedures, lumbar punctures, bone marrow aspirations, or any admission where 
   the goal is information-gathering rather than treatment.

2. "post_op" — The patient was admitted for or is recovering from a surgical intervention. This includes 
   tumor resections, organ removals, repairs, reconstructions, laparoscopic procedures, or any admission 
   where an operative procedure is the central event.

3. "medical" — The patient was admitted for non-surgical, non-diagnostic management of an acute or 
   chronic condition. This includes infections, exacerbations, systemic illnesses, chemotherapy cycles, 
   pain management, or general medical observation.

Classification rules:
- If the admission involves BOTH a diagnostic procedure AND a surgical component, classify as "post_op"
- If the admission involves BOTH a diagnostic procedure AND medical treatment, classify as "diagnostic"
- When ambiguous, use the diagnosis context to break the tie
- You must ALWAYS return one of exactly these three strings: diagnostic | post_op | medical
- Return ONLY valid JSON with no markdown, preamble, or explanation"""

    prompt = f"""Classify the following patient admission into the correct care mode.

=== ADMISSION REASON ===
{state["admission"].get("admission_reason", "Not provided")}

=== ADMISSION DETAILS ===
Admitted At  : {state["admission"].get("admitted_at", "Unknown")}
Discharge At : {state["admission"].get("discharge_at", "Still admitted")}

=== ACTIVE DIAGNOSIS CONTEXT ===
{json.dumps(state["diagnosis"], indent=2)}

=== CARE LEVEL ===
{state["care_level"]}

Your task:
1. Carefully read the admission reason and diagnosis context
2. Identify the PRIMARY purpose of this admission (investigate vs. operate vs. treat)
3. Apply the classification rules to select the most appropriate mode
4. Provide a brief clinical justification for your choice

Return ONLY the following JSON structure:
{{
  "mode": "diagnostic | post_op | medical",
  "reasoning": "2–3 sentence clinical justification explaining why this mode was chosen over the alternatives",
  "confidence": "high | moderate | low",
  "confidence_reason": "Brief note on what made this classification clear or ambiguous"
}}"""

    res = await llm_call(system_prompt, prompt)

    valid_modes = {"diagnostic", "post_op", "medical"}
    detected_mode = res.get("mode", "").strip().lower()

    # Fallback guard — if LLM returns something unexpected, default to medical
    if detected_mode not in valid_modes:
        logger.warning(
            f"Mode agent returned unexpected mode '{detected_mode}' "
            f"for patient {state['patient_id']}. Defaulting to 'medical'."
        )
        detected_mode = "medical"

    state["mode"] = detected_mode
    state["mode_reasoning"] = res.get("reasoning", "")

    logger.info(
        f"Mode identified for patient {state['patient_id']}: "
        f"{detected_mode} (confidence: {res.get('confidence', 'unknown')}) — {res.get('reasoning', '')}"
    )

    return state


async def graph_agent(state: State):
    adm = state["admission"]

    start = adm["admitted_at"]
    end = adm["discharge_at"] or datetime.utcnow().date().isoformat()

    baseline, treatment = await fetch_graph_split(
        state["patient_id"], start, end
    )

    state["baseline_graph"] = baseline
    state["treatment_graph"] = treatment

    # ✅ Counts (MOST IMPORTANT)
    logger.info(f"[graph_agent] Baseline count: {len(baseline)}")
    logger.info(f"[graph_agent] Treatment count: {len(treatment)}")

   

    return state


async def baseline_agent(state: State):
    system_prompt = """You are a senior clinical documentation specialist with deep expertise in synthesizing 
pre-admission patient records. Your role is to extract and summarize a patient's medical baseline — 
the ground truth of their condition BEFORE any current treatment episode began.

You must:
- Focus only on clinically significant findings (diagnoses, comorbidities, vitals trends, lab abnormalities, medications)
- Identify any chronic or pre-existing conditions that may influence the current treatment
- Note data gaps or absence of records explicitly — do not infer or fabricate
- Use precise, concise medical language suitable for a treating physician
- Return ONLY valid JSON with no extra commentary, markdown, or explanation"""

    prompt = f"""You are reviewing a patient's pre-admission knowledge graph to establish their medical baseline.

The following structured records represent clinical entities and relationships documented BEFORE the current admission:

<baseline_graph>
{json.dumps(state["baseline_graph"], indent=2)}
</baseline_graph>

Your task:
1. Identify the patient's known diagnoses, chronic conditions, and comorbidities
2. Highlight any abnormal lab values, vitals, or imaging findings
3. Note active medications or ongoing treatments at the time of admission
4. Flag any high-risk factors (e.g., immunosuppression, prior surgeries, allergies)
5. If the baseline graph is sparse or empty, explicitly state that pre-admission data is limited

Return ONLY the following JSON structure:
{{
  "summary": "Concise 3–5 sentence clinical narrative of the patient's baseline condition",
  "known_conditions": ["list of confirmed diagnoses or chronic conditions"],
  "risk_factors": ["list of clinically relevant risk factors"],
  "data_quality": "complete | partial | insufficient"
}}"""

    res = await llm_call(system_prompt, prompt)
    logger.info(f"baseline_data:{res}")
    state["baseline_summary"] = res.get("summary", "")
    return state


from collections import defaultdict
from datetime import datetime
from loguru import logger


def normalize_date(d):
    if not d:
        return None

    d = str(d).strip()

    # ✅ Try ISO first (YYYY-MM-DD)
    try:
        return datetime.strptime(d, "%Y-%m-%d").date().isoformat()
    except:
        pass

    # ✅ Try DD/MM/YYYY
    try:
        return datetime.strptime(d, "%d/%m/%Y").date().isoformat()
    except:
        pass

    # ✅ Try DD-MM-YYYY
    try:
        return datetime.strptime(d, "%d-%m-%Y").date().isoformat()
    except:
        pass

    # ❌ Unknown format
    logger.warning(f"[timeline] Invalid date format skipped: {d}")
    return None


async def timeline_agent(state: State):
    grouped = defaultdict(list)

    treatment_graph = state.get("treatment_graph") or []

    logger.info(f"[timeline] Building timeline from {len(treatment_graph)} treatment records")

    for i in treatment_graph:
        raw_date = i.get("date")
        normalized = normalize_date(raw_date)

        if not normalized:
            logger.debug(f"[timeline] Skipping record with invalid date: {i}")
            continue

        grouped[normalized].append(i)

    # ✅ Sort safely by date
    timeline = sorted(
        [{"date": k, "events": v} for k, v in grouped.items()],
        key=lambda x: x["date"]
    )

    state["timeline"] = timeline

    # ✅ Logging (VERY IMPORTANT)
    logger.info(f"[timeline] Timeline days: {len(timeline)}")

    if timeline:
        logger.debug(f"[timeline] Timeline sample (first 2): {timeline[:2]}")
    else:
        logger.warning("[timeline] No valid timeline events found")

    # 🔍 Debug date distribution (optional but useful)
    logger.debug(f"[timeline] Dates present: {list(grouped.keys())[:10]}")

    return state


async def progress_agent(state: State):
    mode_instructions = {
        "medical": """This is a MEDICAL admission (e.g., infection, systemic illness, chronic exacerbation).
Focus your evaluation on:
- Infection control: fever curve, inflammatory markers (CRP, WBC, procalcitonin), culture results
- Organ function trends: renal, hepatic, respiratory, cardiovascular
- Response to antibiotics or targeted therapy
- Resolution or worsening of presenting symptoms
- Risk of complications or deterioration""",

        "post_op": """This is a POST-OPERATIVE admission (e.g., surgery, tumor removal, resection).
Focus your evaluation on:
- Wound healing and surgical site status
- Post-op vitals stability and absence of hemorrhage
- Pain management effectiveness
- Early mobilization and functional recovery milestones
- Signs of post-op complications: infection, anastomotic leak, DVT, ileus
- Pathology results if available (surgical specimen findings)""",

        "diagnostic": """This is a DIAGNOSTIC admission (e.g., biopsy, FNAC, diagnostic procedure).
Focus your evaluation on:
- Whether the procedure was successfully completed
- Adequacy and preliminary results of specimens obtained
- Patient tolerance and immediate post-procedure status
- Any procedural complications (bleeding, pain, pneumothorax if applicable)
- Pending reports and next diagnostic or treatment steps
- Do NOT evaluate treatment response — this is a diagnostic episode only"""
    }

    mode_context = mode_instructions.get(
        state["mode"],
        "Evaluate clinical progress based on the available data using general medical reasoning."
    )

    system_prompt = """You are an experienced clinical reasoning engine embedded in a hospital decision-support system. 
Your role is to objectively evaluate a patient's treatment progress based on structured clinical data.

You must:
- Reason systematically using evidence from the timeline, baseline, and diagnosis
- Identify trends (improving, worsening, or plateauing) with clinical justification
- Flag active concerns or unresolved issues that require physician attention
- Avoid speculation — only report what is supported by the provided data
- Return ONLY valid JSON with no markdown, explanation, or preamble"""

    prompt = f"""Evaluate the treatment progress for the following patient case.

=== ADMISSION MODE ===
{state["mode"].upper()}

=== MODE CLASSIFICATION REASONING ===
{state.get("mode_reasoning", "Not available")}

=== MODE-SPECIFIC EVALUATION CRITERIA ===
{mode_context}

=== ADMISSION DETAILS ===
{json.dumps(state["admission"], indent=2)}

=== PATIENT BASELINE (Pre-Admission) ===
{state["baseline_summary"]}

=== ACTIVE DIAGNOSIS ===
{json.dumps(state["diagnosis"], indent=2)}

=== TREATMENT TIMELINE (Chronological Events) ===
{json.dumps(state["timeline"], indent=2)}

=== CARE LEVEL ===
{state["care_level"]}

Instructions:
1. Compare the patient's current clinical state against the established baseline
2. Identify the overall trajectory using ONLY the criteria relevant to the admission mode above
3. List specific unresolved issues, complications, or concerns requiring follow-up
4. Assign a status that reflects the patient's response to treatment so far

Return ONLY the following JSON structure:
{{
  "status": "improving | worsening | stable | completed",
  "summary": "3–5 sentence clinical narrative summarizing progress relative to baseline and admission goals",
  "issues": [
    {{
      "issue": "Brief description of the concern",
      "severity": "low | moderate | high",
      "recommendation": "Suggested clinical action or monitoring step"
    }}
  ],
  "confidence": "high | moderate | low",
  "confidence_reason": "Brief explanation of data quality or gaps affecting confidence"
}}"""

    state["progress"] = await llm_call(system_prompt, prompt)
    return state


# =========================
# WORKFLOW
# =========================
def build():
    g = StateGraph(State)

    # ✅ rename nodes (not state keys)
    g.add_node("admission_node", admission_agent)
    g.add_node("diagnosis_node", diagnosis_agent)
    g.add_node("mode_node", mode_agent)
    g.add_node("graph_node", graph_agent)
    g.add_node("baseline_node", baseline_agent)
    g.add_node("timeline_node", timeline_agent)
    g.add_node("progress_node", progress_agent)

    g.set_entry_point("admission_node")

    g.add_edge("admission_node", "diagnosis_node")
    g.add_edge("diagnosis_node", "mode_node")
    g.add_edge("mode_node", "graph_node")
    g.add_edge("graph_node", "baseline_node")
    g.add_edge("baseline_node", "timeline_node")
    g.add_edge("timeline_node", "progress_node")
    g.add_edge("progress_node", END)

    return g.compile()


workflow = build()


# =========================
# API
# =========================
@router.post("/evaluate")
async def evaluate(req: Request):

    state: State = {
        "patient_id": req.patient_id,
        "doctor_id": req.doctor_id,
        "care_level": req.care_level,

        "admission": None,
        "diagnosis": None,

        "baseline_graph": None,
        "treatment_graph": None,

        "baseline_summary": None,
        "timeline": None,

        "mode": None,
        "mode_reasoning": None,
        "progress": None
    }

    result = await workflow.ainvoke(state)

    return result["progress"]