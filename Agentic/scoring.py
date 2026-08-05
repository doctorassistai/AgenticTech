from __future__ import annotations
import os, json, re
from typing import TypedDict, Optional, List, Dict
from datetime import datetime, date

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


MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

mongo_client = AsyncIOMotorClient(MONGO_URI)
mongo_db = mongo_client[MONGO_DB]

# 🔥 Collections
procedure_notes_collection = mongo_db["procedure_notes"]
diagnosis_data_collection = mongo_db["diagnosis_data"]
patient_appointments_collection = mongo_db["patient_appointments"]
# =========================
# CONFIG
# =========================
router = APIRouter(prefix="/vitals-intelligence", tags=["Vitals Intelligence"])
GROQ_API_KEY  = os.getenv("GROQ_API_KEY")
llm = ChatGroq(
    model="llama-3.3-70b-versatile",
    temperature=0.1,
    groq_api_key=os.getenv("GROQ_API_KEY"),
    max_tokens=3000,
)


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
# INPUT
# =========================
class Request(BaseModel):
    patient_id: str


# =========================
# STATE
# =========================
class State(TypedDict):
    patient_id: str

    admission_date: Optional[str]
    graph_data: Optional[List[Dict]]

    vitals: Optional[List[Dict]]
    timeline: Optional[List[Dict]]

    # Agent 1 output — raw daily scores
    daily_scores: Optional[List[Dict]]

    # Agent 2 output — clinical intelligence
    llm_output: Optional[Dict]


# =========================
# HELPERS
# =========================
def normalize_date(d):
    if not d:
        return None

    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(str(d), fmt).date().isoformat()
        except:
            continue

    return None


def parse_json(text):
    try:
        cleaned = re.sub(r"```json|```", "", text).strip()
        return json.loads(cleaned)
    except Exception as e:
        return {"raw": text, "error": str(e)}


async def llm_call(system, prompt):
    res = await llm.ainvoke([
        SystemMessage(content=system),
        HumanMessage(content=prompt)
    ])

    logger.debug(f"[LLM RAW] {res.content}")
    return parse_json(res.content)


# =========================
# ADMISSION (TEMP)
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

async def admission_agent(state: State):
    admission = await fetch_admission(state["patient_id"])

    state["admission_date"] = admission.get("admitted_at")

    logger.info(f"[admission_agent] admission_date={state['admission_date']}")

    return state

# =========================
# FETCH GRAPH
# =========================
async def graph_agent(state: State):

    cypher = """
    MATCH (p:Patient {patient_id: $patient_id})-[r]->(n)
    OPTIONAL MATCH (n)-[:SUPPORTED_BY_EVIDENCE]->(e:Evidence)

    RETURN 
        labels(n)[0] as entity_type,
        n.vital_type as vital_type,
        n.value as value,
        e.document_date as date
    """

    data = []

    async with neo4j_driver.session() as session:
        result = await session.run(cypher, patient_id=state["patient_id"])

        async for r in result:
            data.append(dict(r))

    logger.info(f"[graph] fetched {len(data)} records")

    state["graph_data"] = data
    return state


# =========================
# FILTER VITALS
# =========================
async def vitals_agent(state: State):
    admission_date = state["admission_date"]

    vitals = []

    for rec in state.get("graph_data", []):
        if rec.get("entity_type") != "VitalSign":
            continue

        d = normalize_date(rec.get("date"))
        if not d:
            continue

        if d >= admission_date:
            vitals.append({
                "type": rec.get("vital_type"),
                "value": rec.get("value"),
                "date": d
            })

    logger.info(f"[vitals] {vitals} after admission")

    state["vitals"] = vitals
    return state


# =========================
# TIMELINE
# =========================
async def timeline_agent(state: State):
    grouped = defaultdict(list)

    for v in state.get("vitals", []):
        grouped[v["date"]].append(v)

    timeline = sorted(
        [{"date": k, "vitals": v} for k, v in grouped.items()],
        key=lambda x: x["date"]
    )

    logger.info(f"[timeline] {len(timeline)} days")

    state["timeline"] = timeline
    return state


# =========================
# AGENT 1 — SCORING ENGINE
# Purpose : Pure numerical scoring only.
# Small, deterministic prompt. No trend reasoning.
# Handles large timelines without token overflow.
# =========================
async def scoring_agent(state: State):

    system = """You are a clinical scoring engine that computes validated early warning scores from raw vital signs.

Your ONLY job is to calculate numerical scores per day using the exact thresholds below.
Do NOT analyse trends, generate alerts, or reason about clinical patterns — that is done by a separate agent.
Return ONLY valid JSON. No preamble. No explanation outside JSON.

NEWS2 SCORING (Royal College of Physicians, 2017)
--------------------------------------------------
RR (breaths/min): <=8->3 | 9-11->1 | 12-20->0 | 21-24->2 | >=25->3
SpO2 Scale1: <=91%->3 | 92-93%->2 | 94-95%->1 | >=96%->0
SpO2 Scale2 (COPD): <=83%->3 | 84-85%->2 | 86-87%->1 | 88-92%->0 | 93-94%air->0 | 93-94%O2->1 | 95-96%O2->2 | >=97%O2->3
Supplemental O2: +2 pts if on any oxygen
SBP (mmHg): <=90->3 | 91-100->2 | 101-110->1 | 111-219->0 | >=220->3
HR (bpm): <=40->3 | 41-50->1 | 51-90->0 | 91-110->1 | 111-130->2 | >=131->3
Temp (C): <=35.0->3 | 35.1-36.0->1 | 36.1-38.0->0 | 38.1-39.0->1 | >=39.1->2
Consciousness (ACVPU): Alert->0 | Confused->3 | Voice->3 | Pain->3 | Unresponsive->3
Risk bands: 0->low | 1-4->low | 5-6->medium | >=7->high | any_param_3->high

MEWS SCORING
------------
RR: <9->2 | 9-14->0 | 15-20->1 | 21-29->2 | >=30->3
HR: <40->2 | 40-50->1 | 51-100->0 | 101-110->1 | 111-129->2 | >=130->3
SBP: <70->3 | 71-80->2 | 81-100->1 | 101-199->0 | >=200->2
Temp: <35->2 | 35-38.4->0 | >=38.5->2
Consciousness: Alert->0 | Voice->1 | Pain->2 | Unresponsive->3
Risk bands: <=4->low | 5->moderate | >=5->high

CART SCORE
----------
RR: <=20->0 | 21-23->2 | >=24->9
Pulse: <=109->0 | 110-139->4 | >=140->7
DBP: <=49->4 | 50-59->3 | 60-69->2 | >=70->0
Age: <=54->0 | 55-69->2 | >=70->5
Risk bands: 0-7->low | 8-12->moderate | >=13->high"""

    prompt = f"""
Vitals timeline (one object per day):
{json.dumps(state["timeline"], indent=2)}

For EACH date, compute NEWS2, MEWS, CART using the exact thresholds above.
If a parameter is missing, use 0 pts for that parameter and mark it null in breakdown.

Return a JSON array — one object per date:

[
  {{
    "date": "YYYY-MM-DD",
    "NEWS2": {{
      "total": <int>,
      "breakdown": {{
        "respiratory_rate": <pts|null>,
        "spo2": <pts|null>,
        "oxygen_supplementation": <pts|null>,
        "systolic_bp": <pts|null>,
        "heart_rate": <pts|null>,
        "temperature": <pts|null>,
        "consciousness": <pts|null>
      }},
      "risk_band": "low|medium|high",
      "single_param_3_trigger": true|false
    }},
    "MEWS": {{
      "total": <int>,
      "risk_band": "low|moderate|high"
    }},
    "CART": {{
      "total": <int>,
      "risk_band": "low|moderate|high"
    }}
  }}
]"""

    result = await llm_call(system, prompt)

    # Normalise — model may return list or wrapped dict
    if isinstance(result, list):
        state["daily_scores"] = result
    elif isinstance(result, dict) and "daily_scores" in result:
        state["daily_scores"] = result["daily_scores"]
    else:
        state["daily_scores"] = result  # fallback

    logger.info(f"[scoring_agent] scored {len(state['daily_scores'] or [])} days")
    return state


# =========================
# AGENT 2 — CLINICAL INTELLIGENCE
# Purpose : Trend analysis, pattern detection, risk synthesis, nurse alert.
# Receives compact score summary only — NOT raw vitals — so prompt stays lean.
# =========================
async def intelligence_agent(state: State):

    system = """You are a board-certified intensivist embedded in a hospital early warning system.

You receive pre-computed NEWS2, MEWS, CART scores across multiple days.
Your job is CLINICAL REASONING — trends, patterns, risk synthesis, actionable escalation.
Do NOT recompute scores. Reason only over the scores given to you.
Return ONLY valid JSON. No preamble. No markdown.

TREND RULES
-----------
- Trend > absolute value. NEWS2 rising 2->4->6 over 3 days = escalate even without threshold breach.
- single_param_3_trigger = true on any day → escalate regardless of total.
- Silent deterioration: slow, subtle rise across many days — most commonly missed pattern.
- Conservative bias: incomplete data = assume worse, escalate.

DETERIORATION PHENOTYPES
------------------------
SEPSIS: NEWS2 + MEWS + CART rising together. HR and RR driving early breakdown points.
RESPIRATORY FAILURE: RR and SpO2 dominating NEWS2 breakdown. Rising over 24-48h.
HAEMODYNAMIC INSTABILITY: SBP driving NEWS2 and MEWS. CART elevated on HR + DBP.
NEUROLOGICAL DETERIORATION: Consciousness component non-zero on any day = immediate concern.
SILENT DETERIORATION: One parameter scoring every day even when total appears low.

NURSE ALERT RULES
-----------------
- State WHO to call (charge nurse, rapid response, on-call physician, MET team).
- State WHAT to do (repeat obs, escalate, start sepsis bundle, call MET).
- State WHEN (immediately, within 30 min, next scheduled round).
- NEVER write "monitor closely" — not actionable."""

    prompt = f"""
DAILY SCORES (from Scoring Agent):
{json.dumps(state["daily_scores"], indent=2)}

TASKS:

1. TREND — overall trajectory + silent deterioration flag
2. DETERIORATION PATTERN — phenotype + confidence + supporting score evidence
3. RISK SYNTHESIS — overall risk level + most informative score system
4. CRITICAL PARAMETER — which vital sign domain is the primary risk driver
5. CLINICAL SUMMARY — 3-5 sentence synthesis
6. NURSE ALERT — urgency + specific actionable message (WHO / WHAT / WHEN)

Return exactly this JSON:

{{
  "trend": {{
    "overall": "improving|worsening|stable|volatile",
    "trajectory_note": "<one clinical sentence>",
    "silent_deterioration_detected": true|false,
    "escalating_scores": {{
      "NEWS2": true|false,
      "MEWS": true|false,
      "CART": true|false
    }}
  }},
  "deterioration_pattern": {{
    "phenotype": "sepsis|respiratory_failure|haemodynamic_instability|neurological_deterioration|silent_deterioration|none",
    "confidence": "suspected|likely|highly_likely|not_detected",
    "supporting_evidence": "<which score components triggered this>"
  }},
  "risk_synthesis": {{
    "overall_risk": "low|medium|high|critical",
    "most_sensitive_score": "NEWS2|MEWS|CART",
    "reasoning": "<why this score is most informative for this patient>"
  }},
  "critical_parameter": {{
    "domain": "respiratory_rate|spo2|systolic_bp|heart_rate|temperature|consciousness",
    "clinical_concern": "<one precise sentence explaining the clinical risk>"
  }},
  "summary": "<3-5 sentence clinical synthesis>",
  "alert": {{
    "urgency": "routine|urgent|emergent",
    "message": "<specific nurse-facing action — WHO, WHAT, WHEN>",
    "escalation_recommended": true|false
  }}
}}"""

    result = await llm_call(system, prompt)

    # Attach daily_scores to final output for complete API response
    result["daily_scores"] = state.get("daily_scores", [])

    state["llm_output"] = result

    logger.info(
        f"[intelligence_agent] risk={result.get('risk_synthesis', {}).get('overall_risk')} "
        f"urgency={result.get('alert', {}).get('urgency')}"
    )
    return state


# =========================
# WORKFLOW
# =========================
def build():
    g = StateGraph(State)

    g.add_node("admission_node",    admission_agent)
    g.add_node("graph_node",        graph_agent)
    g.add_node("vitals_node",       vitals_agent)
    g.add_node("timeline_node",     timeline_agent)
    g.add_node("scoring_node",      scoring_agent)
    g.add_node("intelligence_node", intelligence_agent)

    g.set_entry_point("admission_node")

    g.add_edge("admission_node",    "graph_node")
    g.add_edge("graph_node",        "vitals_node")
    g.add_edge("vitals_node",       "timeline_node")
    g.add_edge("timeline_node",     "scoring_node")
    g.add_edge("scoring_node",      "intelligence_node")
    g.add_edge("intelligence_node", END)

    return g.compile()


workflow = build()


# =========================
# API
# =========================
@router.post("/evaluate")
async def evaluate(req: Request):

    state: State = {
        "patient_id":     req.patient_id,
        "admission_date": None,
        "graph_data":     None,
        "vitals":         None,
        "timeline":       None,
        "daily_scores":   None,  # populated by Agent 1
        "llm_output":     None,  # populated by Agent 2
    }

    result = await workflow.ainvoke(state)

    return result["llm_output"]