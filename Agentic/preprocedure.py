from __future__ import annotations
import os, json, re
from typing import TypedDict, List, Dict, Optional
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from loguru import logger
from langchain_groq import ChatGroq
from langchain_core.messages import SystemMessage, HumanMessage
from langgraph.graph import StateGraph, END

from neo4j import AsyncGraphDatabase

# 🔥 MongoDB (NEW)
from motor.motor_asyncio import AsyncIOMotorClient

# =========================
# LLM SETUP
# =========================
llm = ChatGroq(
    model="llama-3.3-70b-versatile",
    temperature=0.1,
    groq_api_key=os.getenv("GROQ_API_KEY")
)

router = APIRouter(prefix="/ip-procedure", tags=["IP Procedure Engine"])

# =========================
# 🔥 MONGODB CONFIG
# =========================
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

mongo_client = AsyncIOMotorClient(MONGO_URI)
mongo_db = mongo_client[MONGO_DB]

# 🔥 Collections
procedure_notes_collection = mongo_db["procedure_notes"]
diagnosis_data_collection = mongo_db["diagnosis_data"]

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
class ProcedureRequest(BaseModel):
    patient_id: str
    doctor_id: str
    care_level: str  # IP | ICU

# =========================
# STATE
# =========================
class State(TypedDict):
    patient_id: str
    doctor_id: str
    care_level: str

    procedure: Optional[Dict]
    latest_diagnosis: Optional[Dict]
    graph: Optional[List[Dict]]
    patient_summary: Optional[str]

    problems: Optional[Dict]
    risks: Optional[Dict]
    tasks: Optional[List[Dict]]
    readiness: Optional[Dict]

# =========================
# HELPERS
# =========================
def parse_json(text):
    text = re.sub(r"```json|```", "", text)
    match = re.search(r"\{.*\}", text, re.DOTALL)
    return json.loads(match.group(0)) if match else {"raw": text}

async def llm_call(system, prompt):
    res = await llm.ainvoke([
        SystemMessage(content=system),
        HumanMessage(content=prompt)
    ])
    return parse_json(res.content)

# =========================
# 🔥 FETCH PROCEDURE (Mongo)
# =========================
async def fetch_procedure(patient_id: str) -> Dict:
    try:
        doc = await procedure_notes_collection.find_one(
            {"patient_id": patient_id},
            sort=[("updated_at", -1)]
        )

        if not doc:
            result = {"procedure_name": "Unknown", "indication": ""}
            
            logger.warning(
                f"No procedure found for patient_id={patient_id}. Returning default: {result}"
            )
            return result

        result = {
            "procedure_name": doc.get("selected_procedure"),
            "indication": doc.get("patient_abstract", "")
        }

        # 🔥 Log the actual result
        logger.info(f"Latest procedure result for patient_id={patient_id}: {result}")

        return result

    except Exception as e:
        logger.error(
            f"Error fetching procedure for patient_id={patient_id}: {str(e)}",
            exc_info=True
        )
        return {"procedure_name": "Unknown", "indication": ""}

# =========================
# 🔥 FETCH LATEST DIAGNOSIS (Mongo)
# =========================
async def fetch_latest_diagnosis(patient_id: str, doctor_id: str) -> Dict:
    try:
        doc = await diagnosis_data_collection.find_one(
            {
                "patient_id": patient_id,
                "doctor_id": doctor_id,
                "type": "diagnosis"
            },
            sort=[("updated_at", -1)]
        )

        if not doc:
            logger.warning(
                f"No diagnosis found for patient_id={patient_id}, doctor_id={doctor_id}"
            )
            return {}

        result = {
            "diagnosis": doc.get("diagnosis"),
            "updated_at": str(doc.get("updated_at"))
        }

        # 🔥 Log the latest diagnosis result
        logger.info(
            f"Latest diagnosis for patient_id={patient_id}, doctor_id={doctor_id}: {result}"
        )

        return result

    except Exception as e:
        logger.error(
            f"Error fetching diagnosis for patient_id={patient_id}, doctor_id={doctor_id}: {str(e)}",
            exc_info=True
        )
        return {}

# =========================
# 🔥 FETCH FULL GRAPH (Neo4j)
# =========================
async def fetch_patient_graph(patient_id: str) -> List[Dict]:
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
# =========================
# AGENTS
# =========================
async def procedure_agent(state: State):
    logger.info(f"[procedure_agent] START patient_id={state['patient_id']}")

    result = await fetch_procedure(state["patient_id"])

    # 🔥 Log fetched result
    logger.info(f"[procedure_agent] fetched procedure: {result}")

    state["procedure"] = result

    logger.info(f"[procedure_agent] END state updated")

    return state

async def diagnosis_agent(state: State):
    state["latest_diagnosis"] = await fetch_latest_diagnosis(
        state["patient_id"], state["doctor_id"]
    )
    return state

async def graph_agent(state: State):
    state["graph"] = await fetch_patient_graph(state["patient_id"])
    return state

# 1️⃣ Summary Agent
async def summary_agent(state: State):
    prompt = f"""
You are a senior hospital physician preparing a structured pre-procedure clinical briefing.

Your task is to synthesize the patient's diagnosis and full clinical graph into a 
concise, medically accurate narrative summary. This summary will be used downstream 
by clinical risk assessment and task planning agents — so completeness and precision matter.

LATEST DIAGNOSIS:
{json.dumps(state["latest_diagnosis"], indent=2)}

PATIENT CLINICAL GRAPH (vitals, labs, history, medications, comorbidities):
{json.dumps(state["graph"], indent=2)}

Instructions:
- Summarize the patient's current clinical condition in 3–5 sentences
- Highlight key active problems, abnormal findings, and clinically significant history
- Note any abnormal vitals, critical lab values, or relevant medication context
- Use precise medical language; avoid vague generalities
- Do NOT include inferences beyond what the data supports

Respond ONLY with this exact JSON structure, no extra text:
{{
  "summary": "<structured clinical narrative in 3–5 sentences>"
}}
"""
    res = await llm_call(
        "You are an expert clinical summarizer. Synthesize patient data into a precise, structured clinical narrative for pre-procedure assessment. Return only valid JSON.",
        prompt
    )
    state["patient_summary"] = res.get("summary", "")
    return state


# 2️⃣ Problem Agent
async def problem_agent(state: State):
    prompt = f"""
You are a senior anesthesiologist and intensivist performing a comprehensive 
pre-procedure clinical risk assessment.

Your task is to identify ALL clinical problems that could affect the SAFETY or 
FEASIBILITY of the planned procedure, based on the patient's summary, diagnosis, 
graph data, and the specific procedure being considered.

CARE LEVEL: {state["care_level"]}

PATIENT CLINICAL SUMMARY:
{state["patient_summary"]}

LATEST DIAGNOSIS:
{json.dumps(state["latest_diagnosis"], indent=2)}

PATIENT CLINICAL GRAPH:
{json.dumps(state["graph"], indent=2)}

PLANNED PROCEDURE:
{json.dumps(state["procedure"], indent=2)}

Problem Categories to Evaluate:
- Cardiovascular: arrhythmias, heart failure, uncontrolled hypertension, recent MI
- Respiratory: hypoxia, COPD exacerbation, active infection, low SpO2
- Hematological: coagulopathy, active bleeding, anticoagulation status, thrombocytopenia
- Metabolic/Endocrine: uncontrolled diabetes, electrolyte imbalances, renal/hepatic dysfunction
- Nutritional: severe malnutrition, hypoalbuminemia
- Neurological: altered consciousness, seizure activity, raised ICP
- Infectious: active sepsis, uncontrolled infection, fever
- Medications: high-risk drugs (anticoagulants, immunosuppressants, steroids)

Severity Guidelines:
- mild: minimally increases procedural risk, easily manageable
- moderate: increases risk, requires active optimization or close monitoring
- severe: poses high procedural risk, may require procedure delay or escalated management

Note: Apply stricter thresholds for ICU-level patients.

Respond ONLY with this exact JSON structure, no extra text:
{{
  "problems": [
    {{
      "name": "<clinical problem in standard medical terminology>",
      "severity": "mild | moderate | severe"
    }}
  ]
}}
"""
    state["problems"] = await llm_call(
        "You are an expert clinical risk assessor specializing in pre-procedure optimization. Identify all problems affecting procedural safety with precise severity grading. Return only valid JSON.",
        prompt
    )
    return state


# 3️⃣ Risk Agent
async def risk_agent(state: State):
    prompt = f"""
You are a clinical risk stratification expert specializing in peri-procedural safety.

Your task is to map each identified clinical problem to its SPECIFIC PROCEDURAL RISK 
for the planned procedure. Focus on the direct mechanism by which each problem 
increases procedural or peri-procedural danger.

PLANNED PROCEDURE:
{json.dumps(state["procedure"], indent=2)}

IDENTIFIED CLINICAL PROBLEMS:
{json.dumps(state["problems"], indent=2)}

Instructions:
- For each problem, describe the direct procedural or peri-procedural risk it introduces
- Consider specific risk types: uncontrolled bleeding, hemodynamic instability, 
  respiratory compromise, poor wound healing, anesthetic complications, 
  post-procedure deterioration, infection, thromboembolism, organ dysfunction
- Be mechanistic and specific — avoid vague statements like "increases risk"
- If multiple problems compound each other, note the combined risk where relevant

Respond ONLY with this exact JSON structure, no extra text:
{{
  "risks": [
    {{
      "problem": "<clinical problem name>",
      "risk": "<specific procedural risk and its mechanism>"
    }}
  ]
}}
"""
    state["risks"] = await llm_call(
        "You are an expert in clinical risk mapping for procedural safety. Provide precise, mechanistic risk statements for each identified clinical problem. Return only valid JSON.",
        prompt
    )
    return state


# 4️⃣ Task Agent (ONLY PRE-PROCEDURE TASKS ⭐)
async def task_agent(state: State):
    prompt = f"""
You are a clinical pre-procedure optimization specialist responsible for ensuring 
complete patient safety and readiness before a planned procedure.

Your task is to generate a COMPREHENSIVE, PRIORITIZED LIST of tasks that MUST be 
completed BEFORE the procedure begins. Focus on optimization, stabilization, 
investigations, consents, and preparation tasks only.

CARE LEVEL: {state["care_level"]}

PLANNED PROCEDURE:
{json.dumps(state["procedure"], indent=2)}

CLINICAL PROBLEMS:
{json.dumps(state["problems"], indent=2)}

PROCEDURAL RISKS:
{json.dumps(state["risks"], indent=2)}

Task Categories to Consider:
- Investigations: labs (CBC, coagulation profile, metabolic panel, type & screen), imaging, ECG, echocardiogram
- Optimization: control of BP, blood glucose, electrolytes, hemoglobin, active infection
- Medication Management: hold anticoagulants, adjust insulin protocol, steroids, dialysis timing
- Specialist Consults: cardiology, nephrology, hematology, anesthesia pre-assessment
- Consent & Documentation: informed consent, surgical safety checklist, NPO confirmation
- IV Access & Monitoring: central line, arterial line, urinary catheter if indicated
- Blood Products: crossmatch, FFP/platelet availability for high-risk or major procedures

Strict Rules:
- Include ONLY pre-procedure tasks — NO intra-operative or post-procedure tasks
- Mark blocking: true if the procedure CANNOT safely proceed without completing this task
- Mark blocking: false if important for optimization but not an absolute prerequisite
- ICU patients require stricter pre-procedure criteria — apply higher thresholds
- Priority must be exactly: "high", "medium", or "low"

Respond ONLY with this exact JSON structure, no extra text:
{{
  "tasks": [
    {{
      "task": "<specific actionable pre-procedure task>",
      "blocking": true,
      "priority": "high | medium | low"
    }}
  ]
}}
"""
    res = await llm_call(
        "You are an expert clinical pre-procedure planner. Generate precise, actionable, evidence-based pre-procedure tasks. Return only valid JSON.",
        prompt
    )
    state["tasks"] = res.get("tasks", [])
    return state


# 5️⃣ Readiness Agent
async def readiness_agent(state: State):
    prompt = f"""
You are a senior attending physician making the final GO / NO-GO procedural 
readiness decision based on outstanding pre-procedure tasks.

CARE LEVEL: {state["care_level"]}

PLANNED PROCEDURE:
{json.dumps(state["procedure"], indent=2)}

PRE-PROCEDURE TASKS:
{json.dumps(state["tasks"], indent=2)}

Decision Criteria:
- READY: All blocking tasks are confirmed complete. Patient is physiologically 
  stable and fully optimized for the planned procedure.
- NOT_READY: One or more blocking tasks remain incomplete or unverified. 
  Proceeding poses unacceptable clinical risk — procedure must be deferred.
- OPTIMIZING: No blocking tasks are outstanding, but non-blocking optimization 
  tasks are still in progress. Procedure can be scheduled once these are confirmed complete.

Additional Rules:
- ICU patients additionally require confirmed hemodynamic stability, adequate 
  oxygenation, and critical care team sign-off before READY status
- If ANY blocking task is unresolved, status MUST be NOT_READY regardless of all other factors
- Provide a specific clinical rationale referencing the actual tasks and patient condition

Respond ONLY with this exact JSON structure, no extra text:
{{
  "status": "READY | NOT_READY | OPTIMIZING",
  "reason": "<specific clinical rationale referencing tasks and patient condition>"
}}
"""
    result = await llm_call(
        "You are an expert clinical decision-maker for procedural readiness. Apply strict, evidence-based criteria to determine procedure go/no-go status. Return only valid JSON.",
        prompt
    )
    result["timestamp"] = datetime.now().isoformat()
    state["readiness"] = result
    return state


# =========================
# WORKFLOW
# =========================
def build():
    g = StateGraph(State)

    g.add_node("fetch_procedure", procedure_agent)
    g.add_node("fetch_diagnosis", diagnosis_agent)
    g.add_node("fetch_graph", graph_agent)
    g.add_node("summarize", summary_agent)
    g.add_node("problem", problem_agent)
    g.add_node("risk", risk_agent)
    g.add_node("task", task_agent)
    g.add_node("ready", readiness_agent)

    g.set_entry_point("fetch_procedure")

    g.add_edge("fetch_procedure", "fetch_diagnosis")
    g.add_edge("fetch_diagnosis", "fetch_graph")
    g.add_edge("fetch_graph", "summarize")
    g.add_edge("summarize", "problem")
    g.add_edge("problem", "risk")
    g.add_edge("risk", "task")
    g.add_edge("task", "ready")
    g.add_edge("ready", END)

    return g.compile()

workflow = build()

# =========================
# API
# =========================
@router.post("/evaluate")
async def evaluate(req: ProcedureRequest):
    state: State = {
        "patient_id": req.patient_id,
        "doctor_id": req.doctor_id,
        "care_level": req.care_level,

        "procedure": None,
        "latest_diagnosis": None,
        "graph": None,
        "patient_summary": None,

        "problems": None,
        "risks": None,
        "tasks": None,
        "readiness": None
    }

    result = await workflow.ainvoke(state)

    return {
        "procedure": result["procedure"],
        "latest_diagnosis": result["latest_diagnosis"],
        "graph": result["graph"],
        "patient_summary": result["patient_summary"],
        "problems": result["problems"],
        "risks": result["risks"],
        "tasks": result["tasks"],
        "readiness": result["readiness"]
    }