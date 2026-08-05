from __future__ import annotations
import os, json, re, sys
from typing import TypedDict, List, Dict, Optional
from datetime import datetime, date, timedelta

from fastapi import APIRouter
from pydantic import BaseModel
from loguru import logger
from langchain_groq import ChatGroq
from langchain_core.messages import SystemMessage, HumanMessage
from langgraph.graph import StateGraph, END
from neo4j import AsyncGraphDatabase
from motor.motor_asyncio import AsyncIOMotorClient

# =========================
# LOGGER CONFIG 🔥
# =========================
logger.remove()
logger.add(sys.stdout, level="INFO", enqueue=True)

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
# MONGODB CONFIG
# =========================
mongo_client = AsyncIOMotorClient(os.getenv("MONGO_URI"))
mongo_db = mongo_client["doctorassistai"]

procedure_notes_collection = mongo_db["procedure_notes"]
diagnosis_data_collection  = mongo_db["diagnosis_data"]

# =========================
# NEO4J CONFIG
# =========================
neo4j_driver = AsyncGraphDatabase.driver(
    os.getenv("NEO4J_URI", "bolt://neo4j:7687"),
    auth=(os.getenv("NEO4J_USER", "neo4j"), os.getenv("NEO4J_PASSWORD", "password")),
)

# =========================
# INPUT MODEL
# =========================
class ProcedureRequest(BaseModel):
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

    procedure:          Optional[Dict]
    latest_diagnosis:   Optional[Dict]
    graph:              Optional[List[Dict]]

    # Overnight
    current_day_data:   Optional[Dict]
    previous_day_data:  Optional[Dict]
    overnight_changes:  Optional[str]

    problems:  Optional[Dict]
    risks:     Optional[Dict]
    tasks:     Optional[List[Dict]]
    readiness: Optional[Dict]

# =========================
# HELPERS
# =========================
def parse_json(text: str):
    text = re.sub(r"```json|```", "", text)
    match = re.search(r"\{.*\}", text, re.DOTALL)
    return json.loads(match.group(0)) if match else {"raw": text}

async def llm_call(system: str, prompt: str):
    res = await llm.ainvoke([
        SystemMessage(content=system),
        HumanMessage(content=prompt)
    ])
    return parse_json(res.content)

def today_str() -> str:
    return date.today().isoformat()          # e.g. "2025-07-14"

def yesterday_str() -> str:
    return (date.today() - timedelta(days=1)).isoformat()

# =========================
# FETCH PROCEDURE
# =========================
async def fetch_procedure(patient_id: str) -> Dict:
    logger.info(f"[fetch_procedure] START {patient_id}")

    doc = await procedure_notes_collection.find_one(
        {"patient_id": patient_id},
        sort=[("updated_at", -1)]
    )

    if not doc:
        result = {"procedure_name": "Unknown", "indication": ""}
        logger.warning(f"[fetch_procedure] EMPTY → {result}")
        return result

    result = {
        "procedure_name": doc.get("selected_procedure"),
        "indication":     doc.get("patient_abstract", "")
    }

    logger.info(f"[fetch_procedure] RESULT → {result}")
    return result

# =========================
# FETCH DIAGNOSIS
# =========================
async def fetch_latest_diagnosis(patient_id: str, doctor_id: str) -> Dict:
    doc = await diagnosis_data_collection.find_one(
        {
            "patient_id": patient_id,
            "doctor_id":  doctor_id,
            "type":       "diagnosis"
        },
        sort=[("updated_at", -1)]
    )

    if not doc:
        logger.warning("[diagnosis] EMPTY")
        return {}

    result = {
        "diagnosis":  doc.get("diagnosis"),
        "updated_at": str(doc.get("updated_at"))
    }

    logger.info(f"[diagnosis] RESULT → {result}")
    return result

# =========================
# FETCH GRAPH
# =========================
async def fetch_patient_graph(patient_id: str) -> List[Dict]:
    cypher = """
    MATCH (p:Patient {patient_id: $patient_id})-[r]->(n)
    OPTIONAL MATCH (n)-[:SUPPORTED_BY_EVIDENCE]->(e:Evidence)
    RETURN e.document_name AS document,
           e.document_date AS date,
           collect({
               relation: type(r),
               name: coalesce(n.name, n.value, n.description),
               type: head(labels(n))
           }) AS entities
    ORDER BY date ASC
    """

    async with neo4j_driver.session() as session:
        result = await session.run(cypher, patient_id=patient_id)

        docs = []
        async for record in result:
            docs.append({
                "document": record["document"],
                "date":     str(record["date"]),
                "entities": record["entities"]
            })

    logger.info(f"[graph] fetched {len(docs)} docs")
    return docs

# =========================
# FETCH BY DATE
# =========================
async def fetch_day_data(patient_id: str, target_date: str) -> Dict:
    """
    Fetches all graph entities whose supporting evidence falls on `target_date`.
    Returns: { date, documents: [...] }
    """
    cypher = """
    MATCH (p:Patient {patient_id: $patient_id})-[r]->(n)
    OPTIONAL MATCH (n)-[:SUPPORTED_BY_EVIDENCE]->(e:Evidence)
    WHERE toString(e.document_date) STARTS WITH $target_date
    RETURN e.document_name AS document,
           e.document_date AS date,
           collect({
               relation: type(r),
               name: coalesce(n.name, n.value, n.description),
               type: head(labels(n))
           }) AS entities
    ORDER BY date ASC
    """

    async with neo4j_driver.session() as session:
        result = await session.run(
            cypher,
            patient_id=patient_id,
            target_date=target_date
        )

        docs = []
        async for record in result:
            docs.append({
                "document": record["document"],
                "date":     str(record["date"]),
                "entities": record["entities"]
            })

    logger.info(f"[fetch_day_data] date={target_date} → {docs} docs")
    return {"date": target_date, "documents": docs}

# =========================
# AGENTS
# =========================
async def procedure_agent(state: State) -> State:
    logger.info("[agent] procedure")
    state["procedure"] = await fetch_procedure(state["patient_id"])
    return state

async def diagnosis_agent(state: State) -> State:
    logger.info("[agent] diagnosis")
    state["latest_diagnosis"] = await fetch_latest_diagnosis(
        state["patient_id"], state["doctor_id"]
    )
    return state

async def graph_agent(state: State) -> State:
    logger.info("[agent] graph")
    state["graph"] = await fetch_patient_graph(state["patient_id"])
    return state

# =========================
# 🔥 OVERNIGHT AGENT
# =========================
async def overnight_agent(state: State) -> State:
    logger.info("[agent] overnight START")

    today     = today_str()
    yesterday = yesterday_str()

    current_day_data  = await fetch_day_data(state["patient_id"], today)
    previous_day_data = await fetch_day_data(state["patient_id"], yesterday)

    state["current_day_data"]  = current_day_data
    state["previous_day_data"] = previous_day_data

    has_today     = bool(current_day_data.get("documents"))
    has_yesterday = bool(previous_day_data.get("documents"))

    if not has_today and not has_yesterday:
        state["overnight_changes"] = "No data available for today or yesterday."
        logger.warning("[overnight] No data for either day")
        return state

    if not has_yesterday:
        state["overnight_changes"] = "No previous-day data available for comparison."
        logger.warning("[overnight] Missing yesterday data")
        return state

    if not has_today:
        state["overnight_changes"] = "No current-day data available yet."
        logger.warning("[overnight] Missing today data")
        return state

    system_prompt = """
You are a senior ICU clinical decision-support AI embedded in a hospital inpatient workflow.
Your role is to perform an overnight clinical handover analysis — comparing today's patient data
against yesterday's data — and surface any significant changes that a physician needs to be
aware of at the start of their round.

You must reason like a clinical expert across ALL domains:
  • Vital signs (BP, HR, RR, SpO2, Temperature, GCS)
  • Bleeding events: new haematuria, melena, haemoptysis, surgical site bleeding,
    drain output changes, drop in Hb/Hct
  • Fall risk & fall events: new documented falls, mobility changes, sedation levels,
    orthostatic hypotension, dizziness, balance issues
  • Medication-related changes: new drugs started/stopped, dose changes, known side-effects
    (e.g., anticoagulant → bleeding risk, diuretic → electrolyte shift, opioid → sedation/constipation,
    steroid → hyperglycaemia, antihypertensive → hypotension/fall risk)
  • Neurological: new confusion, agitation, GCS drop, seizure activity, focal deficits
  • Respiratory: new oxygen requirement, desaturation events, ventilator changes, sputum changes
  • Cardiovascular: arrhythmias, BP instability, fluid balance shifts
  • Renal/metabolic: urine output trends, electrolyte abnormalities, AKI signals
  • Infection/sepsis: new fever, rising WBC, CRP/procalcitonin changes, culture results
  • Pain: uncontrolled pain, new analgesic escalation
  • Surgical/procedural: post-op status changes, wound concerns, drain output

Be concise but clinically complete. Prioritise HIGH-RISK findings first.
Return only valid JSON.
""".strip()

    prompt = f"""
Below are two snapshots of clinical data for patient {state["patient_id"]}.

━━━ PREVIOUS DAY ({yesterday}) ━━━
{json.dumps(previous_day_data, indent=2)}

━━━ CURRENT DAY ({today}) ━━━
{json.dumps(current_day_data, indent=2)}

Analyse ALL differences between these two snapshots.
Pay special attention to:
  1. Any NEW bleeding signals (lab values, documentation, drain/wound output)
  2. Any NEW fall event or increased fall risk (medication changes, orthostatic changes, sedation)
  3. Vital sign deterioration or instability
  4. Medication additions/removals and their clinical implications
  5. Any other acute overnight change regardless of category

Return a JSON object in EXACTLY this structure:
{{
  "overnight_changes": {{
    "high_priority": [
      "• <finding> — <clinical implication>"
    ],
    "moderate_priority": [
      "• <finding> — <clinical implication>"
    ],
    "low_priority_or_stable": [
      "• <finding>"
    ],
    "no_change_confirmed": [
      "<domain> — stable"
    ],
    "recommended_actions": [
      "• <actionable suggestion for the rounding physician>"
    ],
    "data_gaps": "<mention if any clinical domain had missing data>"
  }}
}}

If a domain has no data in either snapshot, note it under data_gaps.
Do NOT fabricate any clinical values — only report what is present in the data.
"""

    res = await llm_call(system_prompt, prompt)
    state["overnight_changes"] = res.get("overnight_changes", res)

    logger.info(f"[overnight RESULT] {json.dumps(state['overnight_changes'], indent=2)}")
    return state

# =========================
# WORKFLOW
# =========================
def build():
    g = StateGraph(State)

    # ✅ Rename nodes (important)
    g.add_node("procedure_node",  procedure_agent)
    g.add_node("diagnosis_node",  diagnosis_agent)
    g.add_node("graph_node",      graph_agent)
    g.add_node("overnight_node",  overnight_agent)

    # ✅ Entry point
    g.set_entry_point("procedure_node")

    # ✅ Edges
    g.add_edge("procedure_node",  "diagnosis_node")
    g.add_edge("diagnosis_node",  "graph_node")
    g.add_edge("graph_node",      "overnight_node")
    g.add_edge("overnight_node",  END)

    return g.compile()

workflow = build()

# =========================
# API
# =========================
@router.post("/evaluateovernight")
async def evaluate(req: ProcedureRequest):
    state: State = {
        "patient_id":  req.patient_id,
        "doctor_id":   req.doctor_id,
        "care_level":  req.care_level,

        "procedure":          None,
        "latest_diagnosis":   None,
        "graph":              None,

        "current_day_data":   None,
        "previous_day_data":  None,
        "overnight_changes":  None,

        "problems":   None,
        "risks":      None,
        "tasks":      None,
        "readiness":  None,
    }

    result = await workflow.ainvoke(state)

    return {
        "procedure":         result["procedure"],
        "latest_diagnosis":  result["latest_diagnosis"],
        "overnight_changes": result["overnight_changes"],
        "data_dates": {
            "today":     today_str(),
            "yesterday": yesterday_str(),
        }
    }