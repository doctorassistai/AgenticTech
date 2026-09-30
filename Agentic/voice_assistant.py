# voice_agent_system.py
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, TypedDict

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from loguru import logger
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage
import httpx
import tempfile
import requests

from Agentic.clinical_agents import (
    ClinicalReasoningAgent,
    ClinicalAutonomousAgent,
    clear_agent_memory,
)

# ============================================================
# CONFIGURATION
# ============================================================

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
API_BASE_URL = os.getenv("VITE_BACKEND_URL", "https://doctorassist.ai/api/")
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")

router = APIRouter(prefix="", tags=["voice-agent"])

llm = ChatGroq(
    model="openai/gpt-oss-120b",
    temperature=0.1,
    groq_api_key=GROQ_API_KEY,
    max_tokens=8000,
)

# ============================================================
# MODELS
# ============================================================

class VoiceCommand(BaseModel):
    """Command body sent by the frontend.

    In push-to-talk mode the frontend:
      1. Records audio while the doctor holds / clicks Start.
      2. On Stop, sends the audio to /transcribe.
      3. Puts the returned text into the input box.
      4. When the doctor presses Send, POSTs it here as `text`.

    This means the backend sees the same payload whether the doctor
    typed the text or dictated it — the pipeline is identical.
    """
    text: str
    doctor_id: str
    conversation_id: Optional[str] = None
    patient_id: Optional[str] = None
    appointment_id: Optional[str] = None
    edited_vitals: Optional[Dict[str, Any]] = None
    # When set, /process bypasses intent detection and forwards the text
    # straight to the matching clinical agent.
    clinical_panel: Optional[str] = None  # "reasoning" | "autonomous" | None


class SelectPatientBody(BaseModel):
    patient_id: str
    doctor_id: str
    conversation_id: str
    appointment_id: Optional[str] = None
    patient_name: Optional[str] = None


class PreventiveDictateBody(BaseModel):
    doctor_id: str
    patient_id: str
    part: str
    text: str
    existing: Optional[Dict[str, Any]] = None


class SavePartBody(BaseModel):
    doctor_id: str
    patient_id: str
    appointment_id: Optional[str] = None
    part: str
    data: Dict[str, Any]


class ConsultationRunBody(BaseModel):
    """Body for the consultation SafeRx / generate-docs calls.

    `use_agentic` — when True, /consultation/safe-rx forwards to the
    agentic medication-agent instead of the legacy medication endpoint.
    """
    patient_id: str
    doctor_id: str
    dictation: str
    feature_ids: Optional[List[str]] = None
    use_agentic: Optional[bool] = False


class ConsultationSaveBody(BaseModel):
    """Body for /consultation/save-docs.

    Extended with the raw dictation (the doctor's textarea) and the
    output of /hms/users/cm/storage/analyze-transcript/ so the EMR sees
    what the doctor actually dictated — not just the generated output.
    """
    patient_id: str
    doctor_id: str
    documents: List[Dict[str, Any]]
    dictation: Optional[str] = None
    analyzed_dictation: Optional[Dict[str, Any]] = None


class ClinicalAgentBody(BaseModel):
    """Body for the read-only reasoning agent and the reasoning+action
    autonomous agent. Carries the doctor's query plus the conversation id
    so the agents can maintain per-conversation memory for follow-ups."""
    patient_id: str
    doctor_id: str
    query: str = ""
    conversation_id: str = ""


class ClinicalActionConfirmBody(BaseModel):
    """Body used when the doctor confirms one autonomous-agent action that
    was flagged as requiring confirmation."""
    patient_id: str
    doctor_id: str
    action: Dict[str, Any]


class ConversationState(TypedDict):
    conversation_id: str
    doctor_id: str
    current_patient_id: Optional[str]
    current_patient_name: Optional[str]
    current_appointment_id: Optional[str]
    last_intent: Optional[str]
    appointments: List[Dict[str, Any]]
    history: List[Dict[str, Any]]
    context: Dict[str, Any]
    pending_vitals: Optional[Dict[str, Any]]
    awaiting_vitals_confirmation: bool
    vitals_saved: bool
    preventive_part: Optional[str]
    preventive_draft: Optional[Dict[str, Any]]
    preventive_filled: List[str]
    report_stage: Optional[str]
    report_timing: Optional[str]
    report_category_mode: Optional[str]
    history_stage: Optional[str]
    history_tab: Optional[str]
    admission_stage: Optional[str]
    admission_dictation: Optional[str]
    clinical_panel: Optional[str]   # "reasoning" | "autonomous" | None


# ============================================================
# SECTION KEYS (single source of truth)
# ============================================================

PART_A_ALL_SECTIONS = [
    "visit_type",
    "registration",
    "history",
    "family_history",
    "substance_abuse",
    "previous_cancer",
    "menstrual_history",
    "obstetric_history",
    "contraceptive_history",
    "hrt_history",
]

PART_C_ALL_SECTIONS = [
    "general_examination",
    "breast_examination",
    "cervical_examination",
    "prescription",
    "follow_up_advise",
    "follow_up_visit",
]

CLINICAL_PANELS = {"reasoning", "autonomous"}


def compute_filled_sections(part: str, data: Dict[str, Any]) -> List[str]:
    """Return the list of top-level section keys that contain real data."""
    if not isinstance(data, dict):
        return []

    candidates = PART_A_ALL_SECTIONS if part.upper() == "A" else PART_C_ALL_SECTIONS

    def has_value(v: Any) -> bool:
        if v is None or v is False:
            return False
        if isinstance(v, str):
            return v.strip() != ""
        if isinstance(v, (int, float)):
            return True
        if isinstance(v, list):
            return len(v) > 0
        if isinstance(v, dict):
            if "value" in v and "checked" in v:
                return bool(str(v.get("value", "")).strip())
            return any(has_value(x) for x in v.values())
        return bool(v)

    filled = []
    for key in candidates:
        if key in data and has_value(data[key]):
            filled.append(key)
    return filled


# ============================================================
# DATA FETCHER
# ============================================================

class DoctorDataFetcher:
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=60.0)

    async def fetch_all_doctor_data(self, doctor_id: str) -> Dict[str, Any]:
        try:
            appointments = await self._fetch_appointments(doctor_id)
            return {"appointments": appointments, "fetch_timestamp": datetime.now().isoformat()}
        except Exception as e:
            logger.error(f"Failed to fetch doctor data: {e}")
            return {"appointments": []}

    async def _fetch_appointments(self, doctor_id: str) -> List[Dict]:
        try:
            resp = await self.client.get(
                f"{API_BASE_URL}hms/users/doctors/doctor_today_appointments/{doctor_id}"
            )
            if resp.status_code == 200:
                return resp.json().get("appointments", [])
            return []
        except Exception as e:
            logger.error(f"Failed to fetch appointments: {e}")
            return []

    async def save_vitals(self, patient_id: str, doctor_id: str,
                          appointment_id: str, vitals: Dict[str, Any]) -> Dict:
        try:
            timestamp = datetime.now().isoformat()
            payload = {
                "sys_user_id": patient_id,
                "appointment_id": appointment_id,
                "vitals": {
                    timestamp: {
                        "doctor_id": doctor_id,
                        "appointment_id": appointment_id,
                        **vitals,
                    }
                },
            }
            logger.info(f"[save_vitals] POST {API_BASE_URL}hms/users/data/save_patient_vitals")
            logger.info(f"[save_vitals] payload={json.dumps(payload, default=str)}")

            resp = await self.client.post(
                f"{API_BASE_URL}hms/users/data/save_patient_vitals",
                json=payload,
            )
            logger.info(f"[save_vitals] status={resp.status_code} body={resp.text[:500]}")
            if resp.status_code == 200:
                return {"saved": True, "response": resp.json()}
            return {"saved": False, "error": resp.text}
        except Exception as e:
            logger.error(f"save_vitals failed: {e}")
            return {"saved": False, "error": str(e)}

    async def save_preventive_part(self, doctor_id: str, patient_id: str,
                                    appointment_id: Optional[str], part: str,
                                    data: Dict[str, Any]) -> Dict:
        try:
            payload = {
                "doctor_id": doctor_id,
                "patient_id": patient_id,
                "appointment_id": appointment_id,
            }
            if part.upper() == "A":
                payload["case_history"] = data
                payload["examination"] = {}
            else:
                payload["examination"] = data
                payload["case_history"] = {}

            logger.info(f"[save_preventive_part] part={part} payload={json.dumps(payload, default=str)[:500]}")
            resp = await self.client.post(
                f"{API_BASE_URL}hms/users/data/context/preventive-screening/save",
                json=payload,
            )
            logger.info(f"[save_preventive_part] status={resp.status_code} body={resp.text[:500]}")
            if resp.status_code == 200:
                return {"saved": True, "response": resp.json()}
            return {"saved": False, "error": resp.text}
        except Exception as e:
            logger.error(f"save_preventive_part failed: {e}")
            return {"saved": False, "error": str(e)}


# ============================================================
# CONVERSATION MANAGER
# ============================================================

class ConversationManager:
    def __init__(self):
        self._conversations: Dict[str, ConversationState] = {}
        self._data_fetcher = DoctorDataFetcher()
        self._max_history = 50

    async def get_or_create(self, conversation_id: str, doctor_id: str) -> ConversationState:
        if conversation_id not in self._conversations:
            doctor_data = await self._data_fetcher.fetch_all_doctor_data(doctor_id)
            self._conversations[conversation_id] = {
                "conversation_id": conversation_id,
                "doctor_id": doctor_id,
                "current_patient_id": None,
                "current_patient_name": None,
                "current_appointment_id": None,
                "last_intent": None,
                "appointments": doctor_data.get("appointments", []),
                "history": [],
                "context": {"last_refresh": datetime.now().isoformat()},
                "pending_vitals": None,
                "awaiting_vitals_confirmation": False,
                "vitals_saved": False,
                "preventive_part": None,
                "preventive_draft": None,
                "preventive_filled": [],
                "report_stage": None,
                "report_timing": None,
                "report_category_mode": None,
                "history_stage": None,
                "history_tab": None,
                "admission_stage": None,
                "admission_dictation": None,
                "clinical_panel": None,
            }
        return self._conversations[conversation_id]

    async def refresh_data(self, conversation_id: str) -> None:
        if conversation_id in self._conversations:
            conv = self._conversations[conversation_id]
            doctor_data = await self._data_fetcher.fetch_all_doctor_data(conv["doctor_id"])
            conv["appointments"] = doctor_data.get("appointments", [])
            conv["context"]["last_refresh"] = datetime.now().isoformat()

    def update(self, conversation_id: str, updates: Dict[str, Any]) -> None:
        if conversation_id in self._conversations:
            for key, value in updates.items():
                if key == "history":
                    self._conversations[conversation_id][key].append(value)
                    if len(self._conversations[conversation_id][key]) > self._max_history:
                        self._conversations[conversation_id][key] = self._conversations[conversation_id][key][-self._max_history:]
                elif key == "context":
                    self._conversations[conversation_id][key].update(value)
                else:
                    self._conversations[conversation_id][key] = value

    def get(self, conversation_id: str) -> Optional[ConversationState]:
        return self._conversations.get(conversation_id)

    def get_context(self, conversation_id: str) -> Dict[str, Any]:
        if conversation_id in self._conversations:
            conv = self._conversations[conversation_id]
            return {
                "appointments_count": len(conv.get("appointments", [])),
                "current_patient_id": conv.get("current_patient_id"),
                "current_patient_name": conv.get("current_patient_name"),
                "current_appointment_id": conv.get("current_appointment_id"),
                "last_intent": conv.get("last_intent"),
                "awaiting_vitals_confirmation": conv.get("awaiting_vitals_confirmation", False),
                "has_pending_vitals": conv.get("pending_vitals") is not None,
                "vitals_saved": conv.get("vitals_saved", False),
                "preventive_part": conv.get("preventive_part"),
                "preventive_filled": conv.get("preventive_filled", []),
                "report_stage": conv.get("report_stage"),
                "report_timing": conv.get("report_timing"),
                "report_category_mode": conv.get("report_category_mode"),
                "history_stage": conv.get("history_stage"),
                "history_tab": conv.get("history_tab"),
                "admission_stage": conv.get("admission_stage"),
                "clinical_panel": conv.get("clinical_panel"),
            }
        return {}

    def clear(self, conversation_id: str) -> None:
        if conversation_id in self._conversations:
            del self._conversations[conversation_id]


conversation_manager = ConversationManager()


# ============================================================
# INTENT DETECTION AGENT
# ============================================================

class IntentDetectionAgent:
    def __init__(self):
        self.system_prompt = """
You are an intent detection agent for a medical voice assistant.

The frontend uses PUSH-TO-TALK: the doctor speaks, the audio is transcribed,
and the resulting text arrives here as a single command. Treat the text as
one complete utterance — not a partial phrase.

Classify the user's voice command into ONE of these intents:

BASE INTENTS:
1. APPOINTMENT_COUNT - "how many appointments"
2. LIST_APPOINTMENTS - "list appointments", "show appointments"
3. BOOK_APPOINTMENT - "book appointment", "new appointment"
4. NEW_ADMISSION - "new admission", "admit patient", "register patient", "add patient", "create patient"
5. HELP - "help"

PATIENT WORKFLOW INTENTS:
6. RECORD_VITALS - "vitals", "record vitals", "take vitals"
7. PREVENTIVE_SCREENING - "preventive screening", "screening", "preventive check"
8. REPORT_UPLOAD - "upload report", "add report"
9. PATIENT_SUMMARY - "patient summary", "generate summary"

VITALS CONFIRMATION:
10. SAVE_VITALS - "save", "yes save", "confirm"
11. EDIT_VITALS - "edit vitals", "change"
12. CANCEL_VITALS - "no", "cancel", "don't save"

PREVENTIVE SCREENING — PARTS:
13. START_PART_A - "part a", "case history", "start part a", "do part a", "open part a"
14. START_PART_C - "part c", "examination", "start part c", "do part c", "open part c"
15. SAVE_PART_A - "save part a", "save case history", "yes save part a"
16. SAVE_PART_C - "save part c", "save examination", "yes save part c"

PATIENT SUMMARY FOLLOW-UPS:
17. GENERATE_PRETREATMENT - "generate pre-treatment", "pre-treatment plan", "pretreatment", "pre treatment"
18. SHOW_LONGITUDINAL_SUMMARY - "show longitudinal summary", "longitudinal summary", "history summary", "long term summary"
19. SHOW_TUMOR_BOARD - "tumor board", "tumour board", "tumor board review", "md board", "multidisciplinary board", "multidisciplinary team"
20. START_CONSULTATION - "start consultation", "begin consultation", "consultation"

HISTORY FLOW:
21. SHOW_HISTORY - "history", "patient history", "medical history", "show history", "past records", "past history"

NEW ADMISSION FLOW (only active inside the admission panel):
22. ADMISSION_DICTATE - any dictation containing patient details
23. ADMISSION_EDIT - "edit", "change", "modify", "fix"
24. ADMISSION_CONFIRM - "confirm", "yes register", "submit", "save patient", "register patient"
25. ADMISSION_CANCEL - "cancel admission", "stop admission", "discard"

CONSULTATION WORKFLOW:
26. CONSULTATION_SAFE_RX - "safe rx", "check safety", "check medication safety", "safe prescription", "medication safety"
27. CONSULTATION_GENERATE_DOCS - "generate documentation", "generate docs", "create documentation", "generate notes"
28. CONSULTATION_SAVE_DOCS - "save documentation", "save docs", "save notes", "confirm save"
29. CONSULTATION_CANCEL - "cancel consultation", "stop consultation", "close consultation"

REPORT UPLOAD FLOW:
30. REPORT_CURRENT - "current report", "current", "yes current"
31. REPORT_PREVIOUS - "previous report", "previous", "old report", "past report"
32. REPORT_WITH_CATEGORY - "with category", "with report type", "categorized"
33. REPORT_WITHOUT_CATEGORY - "without category", "no category", "no report type", "plain upload"
34. REPORT_PENDING - "pending investigation", "pending investigations", "pending report"
35. REPORT_NORMAL - "normal upload", "normal", "regular upload", "just upload"
36. REPORT_CANCEL - "cancel report", "cancel upload", "stop upload"

CLINICAL AGENTS:
37. CLINICAL_REASONING - "clinical reasoning", "reasoning agent", "reason through this patient", "analyze patient", "clinical analysis", "run reasoning"
38. CLINICAL_AUTONOMOUS - "autonomous agent", "autonomous action", "autonomous review", "auto review patient", "run autonomous agent", "let the agent handle it"

39. UNKNOWN - anything else

VITALS DICTATION TAKES PRIORITY:
If the text contains any vitals keyword (temperature, temp, BP, blood pressure,
pulse, heart rate, HR, SpO2, oxygen, saturation, respiratory rate, resp rate,
blood sugar, glucose, weight, height, vitals, fever) — EVEN IF the numbers
are spelled out as words ("one hundred and twenty", "ninety eight point six",
"one twenty over eighty") — classify as RECORD_VITALS.

Examples:
- "Temperature is hundred and the BP is one hundred and twenty bar eighty" → RECORD_VITALS
- "BP one twenty over eighty" → RECORD_VITALS
- "Pulse seventy two, temp ninety eight" → RECORD_VITALS

For OTHER dictation (symptoms, exam findings that are NOT vitals), return UNKNOWN.

Extract entities:
- patient_name: name mentioned (if any)
- date: date or time mentioned (if any)

Return ONLY valid JSON, no markdown fences:
{
    "intent": "RECORD_VITALS",
    "confidence": 0.95,
    "patient_name": null,
    "date": null
}
"""

    async def detect(self, text: str, context: Dict[str, Any]) -> Dict[str, Any]:
        prompt = f"""
User Command: {text}

Context:
- Current Patient: {context.get('current_patient_name') or context.get('current_patient_id') or 'None'}
- Awaiting Vitals Confirmation: {context.get('awaiting_vitals_confirmation', False)}
- Has Pending Vitals: {context.get('has_pending_vitals', False)}
- Preventive Part Currently Open: {context.get('preventive_part')}
- Report Stage: {context.get('report_stage')}
- Report Timing: {context.get('report_timing')}
- Report Category Mode: {context.get('report_category_mode')}
- History Stage: {context.get('history_stage')}
- Admission Stage: {context.get('admission_stage')}

Classify the intent.
"""
        try:
            response = await llm.ainvoke([
                SystemMessage(content=self.system_prompt),
                HumanMessage(content=prompt),
            ])
            content = response.content.strip()
            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]
            return json.loads(content)
        except Exception as e:
            logger.error(f"Intent detection failed: {e}")
            return {"intent": "UNKNOWN", "confidence": 0.0, "patient_name": None, "date": None}


# ============================================================
# VITALS PARSING AGENT  (LLM-based detection + extraction)
# ============================================================

class VitalsParsingAgent:
    """Detects whether the text is a vitals dictation AND extracts the
    vitals in a single LLM call. Replaces the old keyword heuristic."""

    def __init__(self):
        self.system_prompt = """
You are a medical vitals detection and extraction agent.

You receive free-form dictation from a doctor. Your job is TWO things:

1. Decide whether the text is describing patient VITALS.
2. If yes, extract the vitals as a flat JSON object.

────────────────────────────────────────
WHAT COUNTS AS VITALS
────────────────────────────────────────
- blood_pressure         (any of: BP, blood pressure, pressure, "120/80",
                          "one twenty over eighty", "one twenty bar eighty")
- heart_rate             (pulse, HR, "heart rate seventy two")
- temperature            (temp, "ninety eight point six", "one hundred F")
- respiratory_rate       (resp rate, RR, "breathing rate")
- oxygen_saturation      (SpO2, saturation, "ninety eight percent")
- blood_glucose          (sugar, glucose, "one hundred twenty mg/dl")
- weight
- height
- pulse

If NONE of these are mentioned → NOT vitals.

────────────────────────────────────────
NORMALIZATION RULES
────────────────────────────────────────
- Keys must be lowercase snake_case.
- Values must be strings; keep units when the doctor said them.
- CONVERT SPELLED-OUT NUMBERS TO DIGITS.
  "one hundred and twenty" → "120"
  "ninety eight point six" → "98.6"
- Normalize BP connectives to "/":
  "over", "by", "bar", "on", "/" → "/"
  Example: "one twenty bar eighty" → "120/80"
- If temperature has no unit and value > 50, append "F". Otherwise append "C".
- Omit vitals the doctor didn't mention.

────────────────────────────────────────
OUTPUT FORMAT
────────────────────────────────────────
Return ONLY valid JSON, no markdown fences, no explanation.

When the text IS vitals:
{
  "is_vitals": true,
  "vitals": { "<snake_case_key>": "<value>", ... }
}

When the text IS NOT vitals:
{
  "is_vitals": false,
  "vitals": {}
}

────────────────────────────────────────
EXAMPLES
────────────────────────────────────────
Input : "BP 120 over 80, heart rate 72, temp 98.6 F"
Output: {"is_vitals": true, "vitals": {"blood_pressure": "120/80", "heart_rate": "72", "temperature": "98.6 F"}}

Input : "Temperature is hundred and the BP is one hundred and twenty bar eighty"
Output: {"is_vitals": true, "vitals": {"temperature": "100 F", "blood_pressure": "120/80"}}

Input : "Pulse seventy two, saturation ninety eight percent"
Output: {"is_vitals": true, "vitals": {"pulse": "72", "oxygen_saturation": "98%"}}

Input : "blood pressure one twenty by eighty, temperature ninety nine point one fahrenheit"
Output: {"is_vitals": true, "vitals": {"blood_pressure": "120/80", "temperature": "99.1 F"}}

Input : "patient complains of chest pain radiating to left arm"
Output: {"is_vitals": false, "vitals": {}}

Input : "let's start a new admission"
Output: {"is_vitals": false, "vitals": {}}

Input : "show me the tumor board"
Output: {"is_vitals": false, "vitals": {}}
"""

    async def detect_and_parse(self, text: str) -> Dict[str, Any]:
        """Returns {"is_vitals": bool, "vitals": {...}}."""
        try:
            response = await llm.ainvoke([
                SystemMessage(content=self.system_prompt),
                HumanMessage(content=f"Dictation:\n{text}\n\nReturn JSON."),
            ])
            content = response.content.strip()
            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]
            parsed = json.loads(content)
            if not isinstance(parsed, dict):
                return {"is_vitals": False, "vitals": {}}
            return {
                "is_vitals": bool(parsed.get("is_vitals")),
                "vitals": parsed.get("vitals") or {},
            }
        except Exception as e:
            logger.error(f"Vitals detect/parse failed: {e}")
            return {"is_vitals": False, "vitals": {}}


# ============================================================
# PREVENTIVE DICTATION AGENT
# ============================================================

PART_A_SYSTEM_PROMPT = """
You are a medical data extraction agent for a Preventive Oncology Screening form (Part A — Case History).

Map the doctor's free-form dictation into this JSON schema. Include ONLY sections the doctor mentioned.

Schema (top-level sections):
{
  "visit_type": "New" | "Follow Up" | null,
  "registration": {
     "routine_screening": "Yes"|"No"|null,
     "asymptomatic": "Yes"|"No"|null,
     "symptoms": ["General","Breast Symptoms","Cervical Symptoms","Oral Symptoms","Gastro Intestinal Symptoms","Urinary Symptoms","Respiratory Symptoms","Others"],
     "symptoms_other_detail": "",
     "duration_of_symptoms": { "value": "", "unit": "Years" }
  },
  "history": {
     "comorbidities_present": "Yes"|"No"|"Unknown"|null,
     "comorbidities": [ { "name": "", "age_at_onset": "", "duration": { "value": "", "unit": "Years" }, "detail": "" } ],
     "remarks": ""
  },
  "family_history": {
     "family_history_of_cancer": "Yes"|"No"|"Unknown"|null,
     "relation_with_patient": "", "cancer_site": "", "laterality": "",
     "age_at_onset": "", "duration_months_years": "", "status": null
  },
  "substance_abuse": {
     "substance_abuse_history": "Yes"|"No"|"Unknown"|null,
     "habits": [ { "name": "", "quantity": "", "age_started": "", "duration": { "value":"","unit":"Years" }, "quit": null, "age_quit": "", "duration_since_quit": { "value":"","unit":"Years" }, "detail": "" } ],
     "occupational_exposure": "", "remarks": ""
  },
  "previous_cancer": {
     "history_of_previous_cancer": "Yes"|"No"|"Unknown"|null,
     "diagnosis": "", "cancer_site": "", "stage_at_diagnosis": "",
     "type_of_treatment": [], "remarks": ""
  },
  "menstrual_history": {
     "menstrual_history": "Yes"|"No"|"Unknown"|null,
     "menopause_status": "Pre Menarchal"|"Pre-Menopausal"|"Peri Menopausal"|"Post Menopausal"|null,
     "lmp_date": "", "marital_status": "Married"|"Unmarried"|"Separated"|"Divorced"|null,
     "age_at_marriage": "", "hysterectomy_done": "Yes"|"No"|null,
     "indications_for_hysterectomy": "", "age_at_hysterectomy": ""
  },
  "obstetric_history": {
     "obstetric_history": "Yes"|"No"|"Unknown"|null,
     "gravida": "", "para": "", "abortion": "", "living_children": "",
     "normal_delivery": "", "caesarean_section": "", "dead_children": "", "still_births": "",
     "breastfed": "Yes"|"No"|null, "breastfeeding_duration_months": ""
  },
  "contraceptive_history": {
     "contraceptives": "Yes"|"No"|"Unknown"|null,
     "contraceptive_type": [], "contraceptive_type_other_detail": "",
     "duration_of_contraceptive": "", "remarks": ""
  },
  "hrt_history": {
     "hrt_history": "Yes"|"No"|"Unknown"|null,
     "type_of_therapy": null, "from_date": "", "route_of_administration": "", "remarks": ""
  }
}

ALSO include "_filled_sections": [ list of top-level keys you populated ].
Return ONLY valid JSON. No markdown. No explanation.
"""

PART_C_SYSTEM_PROMPT = """
You are a medical data extraction agent for a Preventive Oncology Screening form (Part C — Examination).

Map doctor's free-form dictation into this JSON schema. Include ONLY sections mentioned.

Schema (top-level sections):
{
  "general_examination": {
     "height_cm": "", "weight_kg": "",
     "vitals": {
        "spo2": { "checked": false, "value": "" },
        "blood_pressure": { "checked": false, "value": "" },
        "others": [ { "id": "", "name": "", "value": "" } ]
     },
     "findings": ["Oedema","Cyanosis","Clubbing","Purpura","Obesity","Icterus","Pallor"],
     "nutrition": "", "hydration": "", "oral_cavity_findings": "",
     "dental_hygiene": "", "mouth_opening_cm": ""
  },
  "breast_examination": {
     "left": { "signs_of_surgery": null, "axilla": null, "axilla_other_detail": "", "palpation": "", "nipple_discharge": "", "nipple_retraction": "", "other_findings": "" },
     "right": { "signs_of_surgery": null, "axilla": null, "axilla_other_detail": "", "palpation": "", "nipple_discharge": "", "nipple_retraction": "", "other_findings": "" }
  },
  "cervical_examination": {
     "via": null, "vili": "", "colposcopy": "", "impression": null,
     "impression_other_detail": "", "remarks": ""
  },
  "prescription": "",
  "follow_up_advise": { "tobacco_cessation_details": "", "lifestyle_modification_details": "", "others": "" },
  "follow_up_visit": { "oral": null, "breast": null, "cervical": null }
}

ALSO include "_filled_sections": [ list of top-level keys you populated ].
Return ONLY valid JSON. No markdown. No explanation.
"""


class PreventiveDictationAgent:
    async def parse(self, part: str, text: str, existing: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        system = PART_A_SYSTEM_PROMPT if part.upper() == "A" else PART_C_SYSTEM_PROMPT
        prompt = f"""
Doctor's dictation:
{text}

Existing data (merge — only overwrite keys doctor mentioned):
{json.dumps(existing or {}, default=str, indent=2)}

Return JSON per schema plus "_filled_sections".
"""
        try:
            response = await llm.ainvoke([
                SystemMessage(content=system),
                HumanMessage(content=prompt),
            ])
            content = response.content.strip()
            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]
            parsed = json.loads(content)
            llm_filled = parsed.pop("_filled_sections", [])

            merged_full = {**(existing or {}), **parsed}
            actual_filled = compute_filled_sections(part, merged_full)

            return {
                "fields": parsed,
                "filled_sections": llm_filled,
                "all_filled_sections": actual_filled,
            }
        except Exception as e:
            logger.error(f"Preventive parse failed: {e}")
            return {"fields": {}, "filled_sections": [], "all_filled_sections": []}


# ============================================================
# MAIN VOICE AGENT
# ============================================================

class VoiceAgent:
    def __init__(self):
        self.intent_agent = IntentDetectionAgent()
        self.vitals_agent = VitalsParsingAgent()
        self.preventive_agent = PreventiveDictationAgent()
        self.data_fetcher = DoctorDataFetcher()
        self.reasoning_agent = ClinicalReasoningAgent()
        self.autonomous_agent = ClinicalAutonomousAgent()

    # ─────────────────────────────────────────────────────────
    # Report-upload flow — state helpers
    # ─────────────────────────────────────────────────────────
    async def _handle_report_intent(
        self, conv_id: str, intent: str, conv: Dict[str, Any],
        text: str, lowered: str,
    ) -> Optional[Dict[str, Any]]:
        stage = conv.get("report_stage")

        if stage and intent == "REPORT_CANCEL":
            conversation_manager.update(conv_id, {
                "report_stage": None,
                "report_timing": None,
                "report_category_mode": None,
            })
            return {
                "response": "Report upload cancelled.",
                "follow_up": None,
                "action": "show_patient_menu",
                "data": {},
            }

        if not stage and intent != "REPORT_UPLOAD":
            return None

        if intent == "REPORT_UPLOAD" or stage == "choose_timing":
            if intent in ("REPORT_UPLOAD", "REPORT_CURRENT", "REPORT_PREVIOUS"):
                if intent == "REPORT_CURRENT":
                    conversation_manager.update(conv_id, {
                        "report_stage": "current_choice",
                        "report_timing": "current",
                        "report_category_mode": None,
                    })
                    return {
                        "response": "Current report. Would you like to attach a report to a pending investigation, or do a normal upload?",
                        "follow_up": "Pending investigations, or Normal upload?",
                        "action": "open_report_upload",
                        "data": {"report_stage": "current_choice", "report_timing": "current"},
                    }
                if intent == "REPORT_PREVIOUS":
                    conversation_manager.update(conv_id, {
                        "report_stage": "previous_choice",
                        "report_timing": "previous",
                        "report_category_mode": None,
                    })
                    return {
                        "response": "Previous report. Upload with category, or without category?",
                        "follow_up": "With category, or Without category?",
                        "action": "open_report_upload",
                        "data": {"report_stage": "previous_choice", "report_timing": "previous"},
                    }
                conversation_manager.update(conv_id, {
                    "report_stage": "choose_timing",
                    "report_timing": None,
                    "report_category_mode": None,
                })
                return {
                    "response": "Is this a current report or a previous report?",
                    "follow_up": "Current report, or Previous report?",
                    "action": "open_report_upload",
                    "data": {"report_stage": "choose_timing"},
                }

        if stage == "current_choice":
            if intent == "REPORT_PENDING":
                conversation_manager.update(conv_id, {"report_stage": "current_pending"})
                return {
                    "response": "Opening pending investigations for this patient. Attach files to any of them on the right.",
                    "follow_up": None,
                    "action": "open_report_upload",
                    "data": {"report_stage": "current_pending"},
                }
            if intent == "REPORT_NORMAL":
                conversation_manager.update(conv_id, {"report_stage": "current_normal"})
                return {
                    "response": "Normal upload. With category, or without category?",
                    "follow_up": "With category, or Without category?",
                    "action": "open_report_upload",
                    "data": {"report_stage": "current_normal"},
                }

        if stage in ("current_normal", "previous_choice"):
            if intent == "REPORT_WITH_CATEGORY":
                conversation_manager.update(conv_id, {
                    "report_stage": "upload_zone",
                    "report_category_mode": "with",
                })
                return {
                    "response": "Upload with category. Pick a file on the right and upload.",
                    "follow_up": None,
                    "action": "open_report_upload",
                    "data": {"report_stage": "upload_zone", "report_category_mode": "with"},
                }
            if intent == "REPORT_WITHOUT_CATEGORY":
                conversation_manager.update(conv_id, {
                    "report_stage": "upload_zone",
                    "report_category_mode": "without",
                })
                return {
                    "response": "Upload without category. Pick a file on the right and upload.",
                    "follow_up": None,
                    "action": "open_report_upload",
                    "data": {"report_stage": "upload_zone", "report_category_mode": "without"},
                }

        return None

    # ─────────────────────────────────────────────────────────
    # History flow
    # ─────────────────────────────────────────────────────────
    async def _handle_history_intent(
        self, conv_id: str, intent: str, conv: Dict[str, Any],
        text: str, lowered: str,
    ) -> Optional[Dict[str, Any]]:
        if intent == "SHOW_HISTORY":
            conversation_manager.update(conv_id, {
                "history_stage": "choose",
                "history_tab": None,
            })
            return {
                "response": "Opening patient history. Choose List, Medications, Investigations, Treatment, Clinical Notes, Vitals, or DICOM Imaging.",
                "follow_up": "Which history view?",
                "action": "open_history",
                "data": {"history_stage": "choose"},
            }
        return None

    # ─────────────────────────────────────────────────────────
    # New Admission flow
    # ─────────────────────────────────────────────────────────
    async def _handle_admission_intent(
        self, conv_id: str, intent: str, conv: Dict[str, Any],
        text: str, lowered: str,
    ) -> Optional[Dict[str, Any]]:
        admission_stage = conv.get("admission_stage")

        if admission_stage and intent == "ADMISSION_CANCEL":
            conversation_manager.update(conv_id, {
                "admission_stage": None,
                "admission_dictation": None,
            })
            return {
                "response": "Admission cancelled.",
                "follow_up": None,
                "action": "show_patient_menu",
                "data": {},
            }

        if intent == "NEW_ADMISSION":
            conversation_manager.update(conv_id, {
                "admission_stage": "dictating",
                "admission_dictation": "",
            })
            return {
                "response": ("Let's register a new patient. Dictate or type the details — "
                             "for example: Name, DOB, gender, phone, email, blood group, address, "
                             "occupation, income, family history. I'll show them on the right for review."),
                "follow_up": "Go ahead and dictate the patient details.",
                "action": "open_admission_form",
                "data": {"admission_stage": "dictating"},
            }
        return None

    # ─────────────────────────────────────────────────────────
    # Clinical agents
    # ─────────────────────────────────────────────────────────
    async def _handle_clinical_agent_intent(
        self, conv_id: str, intent: str, conv: Dict[str, Any], patient_id: Optional[str],
    ) -> Optional[Dict[str, Any]]:
        if not patient_id:
            return {
                "response": "Please select a patient first — both agents reason over that patient's record.",
                "follow_up": None,
                "action": None,
                "data": {},
            }

        if intent == "CLINICAL_REASONING":
            conversation_manager.update(conv_id, {"clinical_panel": "reasoning"})
            return {
                "response": ("Clinical Reasoning is open (read-only). Ask a question about this "
                             "patient — for example, 'Summarise the current clinical picture', "
                             "'What are the current risk flags?', or 'What WBC trend do you see?'"),
                "follow_up": "What would you like to ask?",
                "action": "start_clinical_reasoning",
                "data": {},
            }

        if intent == "CLINICAL_AUTONOMOUS":
            conversation_manager.update(conv_id, {"clinical_panel": "autonomous"})
            return {
                "response": ("Autonomous Agent is open. Ask a question — low-risk items "
                             "(flags, notifications, internal tasks) will run automatically, "
                             "and anything that touches the care plan will wait for your confirmation."),
                "follow_up": "What would you like the agent to look at?",
                "action": "start_clinical_autonomous",
                "data": {},
            }
        return None

    async def _handle_clinical_agent_query(
        self,
        conv_id: str,
        panel: str,
        conv: Dict[str, Any],
        text: str,
        patient_id: Optional[str],
        doctor_id: str,
    ) -> Dict[str, Any]:
        if not patient_id:
            return {
                "status": "success",
                "response": "Please select a patient before asking the clinical agent.",
                "follow_up": None,
                "intent": "CLINICAL_QUERY",
                "patient_id": patient_id,
                "appointment_id": conv.get("current_appointment_id"),
                "action": None,
                "data": {},
                "conversation_id": conv_id,
            }

        try:
            if panel == "reasoning":
                result = await self.reasoning_agent.run(
                    patient_id=patient_id,
                    doctor_id=doctor_id,
                    query=text,
                    conversation_id=conv_id,
                )
                response_text = (
                    result.get("answer")
                    or result.get("clinical_picture")
                    or "I couldn't produce a reasoning response."
                )
                action = "clinical_reasoning_result"
                data = result

            elif panel == "autonomous":
                result = await self.autonomous_agent.run(
                    patient_id=patient_id,
                    doctor_id=doctor_id,
                    query=text,
                    conversation_id=conv_id,
                )
                reasoning = result.get("reasoning") or {}
                response_text = (
                    reasoning.get("answer")
                    or reasoning.get("clinical_picture")
                    or "I couldn't produce an autonomous response."
                )
                n_pending = len(result.get("pending_actions") or [])
                n_executed = len(result.get("executed_actions") or [])
                if n_pending:
                    response_text += (
                        f" {n_pending} action{'s' if n_pending != 1 else ''} "
                        "waiting for your confirmation — review them on the right."
                    )
                elif n_executed:
                    response_text += (
                        f" {n_executed} low-risk action{'s' if n_executed != 1 else ''} "
                        "were logged automatically."
                    )
                action = "clinical_autonomous_result"
                data = result

            else:
                return {
                    "status": "success",
                    "response": "Unknown clinical panel.",
                    "follow_up": None,
                    "intent": "CLINICAL_QUERY",
                    "patient_id": patient_id,
                    "appointment_id": conv.get("current_appointment_id"),
                    "action": None,
                    "data": {},
                    "conversation_id": conv_id,
                }

            conversation_manager.update(conv_id, {
                "last_intent": "CLINICAL_QUERY",
                "history": {
                    "command": text,
                    "intent": f"CLINICAL_{panel.upper()}_QUERY",
                    "response": response_text,
                    "timestamp": datetime.now().isoformat(),
                },
            })

            return {
                "status": "success",
                "response": response_text,
                "follow_up": None,
                "intent": "CLINICAL_QUERY",
                "patient_id": patient_id,
                "appointment_id": conv.get("current_appointment_id"),
                "action": action,
                "data": data,
                "conversation_id": conv_id,
            }

        except Exception as e:
            logger.error(f"[_handle_clinical_agent_query] failed: {e}")
            return {
                "status": "success",
                "response": f"The clinical agent failed: {e}",
                "follow_up": None,
                "intent": "CLINICAL_QUERY",
                "patient_id": patient_id,
                "appointment_id": conv.get("current_appointment_id"),
                "action": None,
                "data": {},
                "conversation_id": conv_id,
            }

    # ─────────────────────────────────────────────────────────
    # Main entry
    # ─────────────────────────────────────────────────────────
    async def process_command(self, command: VoiceCommand) -> Dict[str, Any]:
        conv_id = command.conversation_id or f"conv_{uuid.uuid4().hex[:8]}"
        conversation = await conversation_manager.get_or_create(conv_id, command.doctor_id)

        if command.patient_id and command.patient_id != conversation.get("current_patient_id"):
            conversation_manager.update(conv_id, {"current_patient_id": command.patient_id})
            conversation = conversation_manager.get(conv_id)
        if command.appointment_id and command.appointment_id != conversation.get("current_appointment_id"):
            conversation_manager.update(conv_id, {"current_appointment_id": command.appointment_id})
            conversation = conversation_manager.get(conv_id)

        patient_id = conversation.get("current_patient_id")
        appointment_id = conversation.get("current_appointment_id")
        text = command.text.strip()
        lowered = text.lower().strip(" .!?,")

        context = conversation_manager.get_context(conv_id)
        awaiting_vitals = conversation.get("awaiting_vitals_confirmation", False)
        pending_vitals = conversation.get("pending_vitals") or {}
        preventive_part = conversation.get("preventive_part")
        report_stage = conversation.get("report_stage")
        admission_stage = conversation.get("admission_stage")
        open_clinical_panel = conversation.get("clinical_panel")

        data: Dict[str, Any] = {}
        action = None
        response_data: Optional[Dict[str, Any]] = None
        intent = "UNKNOWN"

        # =================================================================
        # PHASE 0 — CLINICAL AGENT QUERY ROUTING
        # =================================================================
        panel_for_this_call = command.clinical_panel or open_clinical_panel

        close_phrases = {
            "close", "close panel", "close reasoning", "close autonomous",
            "cancel", "cancel reasoning", "cancel autonomous",
            "stop", "stop reasoning", "stop autonomous", "exit", "back",
        }

        if panel_for_this_call in CLINICAL_PANELS:
            if lowered in close_phrases:
                conversation_manager.update(conv_id, {"clinical_panel": None})
                response_data = {
                    "response": f"{panel_for_this_call.title()} panel closed.",
                    "follow_up": None,
                    "action": "close_clinical_panel",
                }
                action = "close_clinical_panel"
                intent = "CLINICAL_QUERY"
            else:
                return await self._handle_clinical_agent_query(
                    conv_id=conv_id,
                    panel=panel_for_this_call,
                    conv=conversation,
                    text=text,
                    patient_id=patient_id,
                    doctor_id=command.doctor_id,
                )

        # =================================================================
        # PHASE 1 — STATE-DRIVEN OVERRIDES
        # =================================================================
        if response_data is None:
            if awaiting_vitals and lowered in ("yes", "yeah", "yep", "save", "save it",
                                                "confirm", "ok", "okay", "proceed", "sure",
                                                "yes save", "yes please", "go ahead"):
                intent = "SAVE_VITALS"
            elif awaiting_vitals and lowered in ("no", "nope", "cancel", "abort",
                                                  "don't save", "dont save", "discard", "stop"):
                intent = "CANCEL_VITALS"
            elif awaiting_vitals and lowered in ("edit", "change", "modify", "correct", "update"):
                intent = "EDIT_VITALS"
            elif preventive_part and lowered in ("yes", "yeah", "yep", "save", "save it",
                                                  "confirm", "ok", "okay", "proceed", "sure",
                                                  "yes save", "yes please", "go ahead"):
                intent = "SAVE_PART_A" if preventive_part == "A" else "SAVE_PART_C"
            elif preventive_part and lowered in ("no", "nope", "cancel", "abort", "discard", "stop"):
                intent = "CANCEL_VITALS"
            elif preventive_part and lowered in ("edit", "change", "modify", "correct"):
                intent = "START_PART_A" if preventive_part == "A" else "START_PART_C"
            elif admission_stage == "dictating":
                if lowered in ("cancel", "stop", "abort", "cancel admission"):
                    intent = "ADMISSION_CANCEL"
            elif admission_stage == "reviewing":
                if lowered in ("confirm", "yes", "yes register", "submit", "save patient", "register patient", "proceed"):
                    intent = "ADMISSION_CONFIRM"
                elif lowered in ("edit", "change", "modify", "fix", "update"):
                    intent = "ADMISSION_EDIT"
                elif lowered in ("cancel", "stop", "abort", "cancel admission"):
                    intent = "ADMISSION_CANCEL"
            elif report_stage == "choose_timing":
                if lowered in ("current", "current report", "yes current"):
                    intent = "REPORT_CURRENT"
                elif lowered in ("previous", "previous report", "old", "old report", "past report"):
                    intent = "REPORT_PREVIOUS"
                elif lowered in ("cancel", "stop", "abort"):
                    intent = "REPORT_CANCEL"
            elif report_stage == "current_choice":
                if lowered in ("pending", "pending investigation", "pending investigations", "pending report"):
                    intent = "REPORT_PENDING"
                elif lowered in ("normal", "normal upload", "regular upload", "just upload"):
                    intent = "REPORT_NORMAL"
                elif lowered in ("cancel", "stop", "abort"):
                    intent = "REPORT_CANCEL"
            elif report_stage in ("current_normal", "previous_choice"):
                if lowered in ("with", "with category", "categorized", "yes with category"):
                    intent = "REPORT_WITH_CATEGORY"
                elif lowered in ("without", "without category", "no category", "plain upload"):
                    intent = "REPORT_WITHOUT_CATEGORY"
                elif lowered in ("cancel", "stop", "abort"):
                    intent = "REPORT_CANCEL"
            elif report_stage in ("upload_zone", "current_pending"):
                if lowered in ("cancel", "stop", "abort", "cancel report", "cancel upload"):
                    intent = "REPORT_CANCEL"

        # =================================================================
        # PHASE 2 — LLM intent (only if state didn't decide)
        # =================================================================
        if intent == "UNKNOWN" and response_data is None:
            intent_result = await self.intent_agent.detect(text, context)
            intent = intent_result.get("intent", "UNKNOWN")

        # =================================================================
        # PHASE 3 — Handle the resolved intent
        # =================================================================

        # ---------------- REPORT UPLOAD FLOW ----------------
        report_intents = {
            "REPORT_UPLOAD", "REPORT_CURRENT", "REPORT_PREVIOUS",
            "REPORT_WITH_CATEGORY", "REPORT_WITHOUT_CATEGORY",
            "REPORT_PENDING", "REPORT_NORMAL", "REPORT_CANCEL",
        }
        if response_data is None and intent in report_intents:
            report_response = await self._handle_report_intent(
                conv_id, intent, conversation, text, lowered,
            )
            if report_response is not None:
                conversation_manager.update(conv_id, {
                    "last_intent": intent,
                    "history": {
                        "command": text,
                        "intent": intent,
                        "response": report_response.get("response"),
                        "timestamp": datetime.now().isoformat(),
                    }
                })
                return {
                    "status": "success",
                    "response": report_response.get("response", ""),
                    "follow_up": report_response.get("follow_up"),
                    "intent": intent,
                    "patient_id": patient_id,
                    "appointment_id": appointment_id,
                    "action": report_response.get("action"),
                    "data": report_response.get("data", {}),
                    "conversation_id": conv_id,
                }

        # ---------------- HISTORY FLOW ----------------
        if response_data is None and intent == "SHOW_HISTORY":
            history_response = await self._handle_history_intent(
                conv_id, intent, conversation, text, lowered,
            )
            if history_response is not None:
                conversation_manager.update(conv_id, {
                    "last_intent": intent,
                    "history": {
                        "command": text,
                        "intent": intent,
                        "response": history_response.get("response"),
                        "timestamp": datetime.now().isoformat(),
                    }
                })
                return {
                    "status": "success",
                    "response": history_response.get("response", ""),
                    "follow_up": history_response.get("follow_up"),
                    "intent": intent,
                    "patient_id": patient_id,
                    "appointment_id": appointment_id,
                    "action": history_response.get("action"),
                    "data": history_response.get("data", {}),
                    "conversation_id": conv_id,
                }

        # ---------------- NEW ADMISSION FLOW ----------------
        admission_intents = {
            "NEW_ADMISSION", "ADMISSION_DICTATE", "ADMISSION_EDIT",
            "ADMISSION_CONFIRM", "ADMISSION_CANCEL",
        }
        if response_data is None and intent in admission_intents:
            admission_response = await self._handle_admission_intent(
                conv_id, intent, conversation, text, lowered,
            )
            if admission_response is not None:
                conversation_manager.update(conv_id, {
                    "last_intent": intent,
                    "history": {
                        "command": text,
                        "intent": intent,
                        "response": admission_response.get("response"),
                        "timestamp": datetime.now().isoformat(),
                    }
                })
                return {
                    "status": "success",
                    "response": admission_response.get("response", ""),
                    "follow_up": admission_response.get("follow_up"),
                    "intent": intent,
                    "patient_id": patient_id,
                    "appointment_id": appointment_id,
                    "action": admission_response.get("action"),
                    "data": admission_response.get("data", {}),
                    "conversation_id": conv_id,
                }

        # ---------------- CLINICAL AGENTS (open panel) ----------------
        clinical_agent_intents = {"CLINICAL_REASONING", "CLINICAL_AUTONOMOUS"}
        if response_data is None and intent in clinical_agent_intents:
            clinical_response = await self._handle_clinical_agent_intent(
                conv_id, intent, conversation, patient_id,
            )
            if clinical_response is not None:
                conversation_manager.update(conv_id, {
                    "last_intent": intent,
                    "history": {
                        "command": text,
                        "intent": intent,
                        "response": clinical_response.get("response"),
                        "timestamp": datetime.now().isoformat(),
                    }
                })
                return {
                    "status": "success",
                    "response": clinical_response.get("response", ""),
                    "follow_up": clinical_response.get("follow_up"),
                    "intent": intent,
                    "patient_id": patient_id,
                    "appointment_id": appointment_id,
                    "action": clinical_response.get("action"),
                    "data": clinical_response.get("data", {}),
                    "conversation_id": conv_id,
                }

        # ---------------- BASE ----------------
        if response_data is None:
            if intent == "APPOINTMENT_COUNT":
                appointments = conversation.get("appointments", [])
                data = {"count": len(appointments)}
                response_data = {
                    "response": f"You have {len(appointments)} appointments today.",
                    "follow_up": "Would you like me to list them?",
                    "action": None,
                }

            elif intent == "LIST_APPOINTMENTS":
                appointments = conversation.get("appointments", [])
                data = {"appointments": appointments, "count": len(appointments)}
                action = "show_appointments"
                response_data = {
                    "response": f"You have {len(appointments)} appointments today. I've listed them on screen.",
                    "follow_up": "Tap a patient to select them.",
                    "action": "show_appointments",
                }

            elif intent == "BOOK_APPOINTMENT":
                action = "open_booking_form"
                response_data = {
                    "response": "Sure, let's book a new appointment. Please fill in the details on the booking screen.",
                    "follow_up": None,
                    "action": "open_booking_form",
                }

            elif intent == "NEW_ADMISSION":
                action = "open_admission_form"
                response_data = {
                    "response": "Let's register a new admission. Please fill in the details on the admission screen.",
                    "follow_up": None,
                    "action": "open_admission_form",
                }

            elif intent == "HELP":
                response_data = {
                    "response": ("I can tell you how many appointments you have, list them, help you book a new appointment, "
                                 "start a new admission, and once you select a patient I can record vitals, run preventive screening, "
                                 "upload reports, generate a patient summary, open the pre-treatment plan, "
                                 "show the longitudinal summary, open the tumor board, show patient history, "
                                 "walk through clinical reasoning on the patient, or run the autonomous review agent."),
                    "follow_up": "What would you like to do?",
                    "action": None,
                }

            # ── RECORD_VITALS ── short-circuit: if the same utterance
            # already carries vitals content, parse it now.
            elif intent == "RECORD_VITALS":
                vitals_result = {"is_vitals": False, "vitals": {}}
                if patient_id:
                    vitals_result = await self.vitals_agent.detect_and_parse(text)

                if patient_id and vitals_result.get("is_vitals") and vitals_result.get("vitals"):
                    parsed = vitals_result.get("vitals") or {}
                    existing = conversation.get("pending_vitals") or {}
                    merged = {**existing, **parsed}
                    conversation_manager.update(conv_id, {
                        "pending_vitals": merged,
                        "awaiting_vitals_confirmation": True,
                    })
                    data = {"parsed_vitals": merged}
                    action = "show_parsed_vitals"
                    response_data = {
                        "response": "I've formatted the vitals on the right. Please review them — do you want to save, edit, or cancel?",
                        "follow_up": "Save, Edit, or Cancel?",
                        "action": "show_parsed_vitals",
                    }
                else:
                    action = "await_vitals_input"
                    response_data = {
                        "response": "You can dictate or type the patient's vitals — I'll format them on the right for review.",
                        "follow_up": None,
                        "action": "await_vitals_input",
                    }

            elif intent == "PREVENTIVE_SCREENING":
                conversation_manager.update(conv_id, {
                    "preventive_part": None,
                    "preventive_draft": None,
                    "preventive_filled": [],
                })
                action = "open_preventive_screening"
                response_data = {
                    "response": "Preventive screening opened. Would you like to start with Part A (Case History) or Part C (Examination)?",
                    "follow_up": "Part A or Part C?",
                    "action": "open_preventive_screening",
                }

            elif intent == "START_PART_A":
                conversation_manager.update(conv_id, {
                    "preventive_part": "A",
                    "preventive_draft": conversation.get("preventive_draft") or {},
                    "preventive_filled": conversation.get("preventive_filled") or [],
                })
                action = "await_part_a_dictation"
                response_data = {
                    "response": "Go ahead — dictate or type the case history. I'll fill the relevant sections and flag them.",
                    "follow_up": None,
                    "action": "await_part_a_dictation",
                }

            elif intent == "START_PART_C":
                conversation_manager.update(conv_id, {
                    "preventive_part": "C",
                    "preventive_draft": conversation.get("preventive_draft") or {},
                    "preventive_filled": conversation.get("preventive_filled") or [],
                })
                action = "await_part_c_dictation"
                response_data = {
                    "response": "Go ahead — dictate or type the examination findings.",
                    "follow_up": None,
                    "action": "await_part_c_dictation",
                }

            elif intent in ("SAVE_PART_A", "SAVE_PART_C"):
                part = "A" if intent == "SAVE_PART_A" else "C"
                draft = conversation.get("preventive_draft") or {}
                if not draft:
                    response_data = {
                        "response": f"There are no Part {part} details to save yet. Please dictate first.",
                        "follow_up": None,
                        "action": f"await_part_{part.lower()}_dictation",
                    }
                    action = f"await_part_{part.lower()}_dictation"
                elif not patient_id:
                    response_data = {"response": "Please select a patient first.", "follow_up": None, "action": None}
                else:
                    result = await self.data_fetcher.save_preventive_part(
                        doctor_id=command.doctor_id,
                        patient_id=patient_id,
                        appointment_id=appointment_id,
                        part=part,
                        data=draft,
                    )
                    if result.get("saved"):
                        conversation_manager.update(conv_id, {
                            "preventive_part": None,
                            "preventive_draft": None,
                            "preventive_filled": [],
                        })
                        data = {"saved": True, "part": part}
                        action = "part_a_saved" if part == "A" else "part_c_saved"
                        next_msg = ("Part A saved. Ready for Part C?" if part == "A"
                                    else "Part C saved. All preventive screening data is complete.")
                        response_data = {
                            "response": next_msg,
                            "follow_up": ("Say 'Part C' to continue." if part == "A" else None),
                            "action": action,
                        }
                    else:
                        data = {"saved": False, "error": result.get("error")}
                        response_data = {
                            "response": f"I couldn't save Part {part}. Please try again.",
                            "follow_up": None,
                            "action": None,
                        }

            elif intent == "REPORT_UPLOAD":
                action = "open_report_upload"
                response_data = {
                    "response": "Opening report upload for this patient.",
                    "follow_up": None,
                    "action": "open_report_upload",
                }

            elif intent == "PATIENT_SUMMARY":
                action = "generate_patient_summary"
                response_data = {
                    "response": "Generating the patient summary.",
                    "follow_up": None,
                    "action": "generate_patient_summary",
                }

            elif intent == "GENERATE_PRETREATMENT":
                action = "generate_pretreatment"
                response_data = {
                    "response": "Opening the pre-treatment plan.",
                    "follow_up": None,
                    "action": "generate_pretreatment",
                }

            elif intent == "SHOW_LONGITUDINAL_SUMMARY":
                action = "show_longitudinal_summary"
                response_data = {
                    "response": "Opening the longitudinal summary.",
                    "follow_up": None,
                    "action": "show_longitudinal_summary",
                }

            elif intent == "SHOW_TUMOR_BOARD":
                action = "show_tumor_board"
                response_data = {
                    "response": "Opening the tumor board.",
                    "follow_up": None,
                    "action": "show_tumor_board",
                }

            elif intent == "START_CONSULTATION":
                action = "start_consultation"
                response_data = {
                    "response": "Consultation started. Dictate or type the consultation notes — I'll show them on the right for review.",
                    "follow_up": None,
                    "action": "start_consultation",
                }

            elif intent == "CONSULTATION_SAFE_RX":
                action = "consultation_safe_rx"
                response_data = {
                    "response": "Checking medication safety…",
                    "follow_up": None,
                    "action": "consultation_safe_rx",
                }

            elif intent == "CONSULTATION_GENERATE_DOCS":
                action = "consultation_generate_docs"
                response_data = {
                    "response": "Generating documentation for the consultation…",
                    "follow_up": None,
                    "action": "consultation_generate_docs",
                }

            elif intent == "CONSULTATION_SAVE_DOCS":
                action = "consultation_save_docs"
                response_data = {
                    "response": "Please confirm saving the documentation.",
                    "follow_up": "Confirm save?",
                    "action": "consultation_save_docs",
                }

            elif intent == "CONSULTATION_CANCEL":
                action = "consultation_cancel"
                response_data = {
                    "response": "Consultation cancelled.",
                    "follow_up": None,
                    "action": "consultation_cancel",
                }

            elif intent == "SAVE_VITALS":
                merged = pending_vitals
                if command.edited_vitals:
                    merged = {**merged, **command.edited_vitals}
                if not merged:
                    conversation_manager.update(conv_id, {"pending_vitals": None, "awaiting_vitals_confirmation": False})
                    action = "show_patient_menu"
                    response_data = {
                        "response": "There are no vitals pending. What would you like to do?",
                        "follow_up": None,
                        "action": "show_patient_menu",
                    }
                elif not patient_id or not appointment_id:
                    response_data = {
                        "response": "I need a patient and appointment to save vitals.",
                        "follow_up": None,
                        "action": None,
                    }
                else:
                    result = await self.data_fetcher.save_vitals(patient_id, command.doctor_id, appointment_id, merged)
                    if result.get("saved"):
                        conversation_manager.update(conv_id, {
                            "pending_vitals": None,
                            "awaiting_vitals_confirmation": False,
                            "vitals_saved": True,
                        })
                        data = {"saved": True, "vitals": merged}
                        action = "vitals_saved"
                        response_data = {
                            "response": "Vitals saved successfully. What would you like to do next?",
                            "follow_up": None,
                            "action": "vitals_saved",
                        }
                    else:
                        data = {"saved": False, "error": result.get("error")}
                        response_data = {
                            "response": "I couldn't save the vitals. Please try again.",
                            "follow_up": None,
                            "action": None,
                        }

            elif intent == "EDIT_VITALS":
                conversation_manager.update(conv_id, {"awaiting_vitals_confirmation": False})
                action = "await_vitals_input"
                response_data = {
                    "response": "Sure — dictate or type the corrected vitals.",
                    "follow_up": None,
                    "action": "await_vitals_input",
                }

            elif intent == "CANCEL_VITALS":
                if preventive_part:
                    conversation_manager.update(conv_id, {
                        "preventive_part": None,
                        "preventive_draft": None,
                        "preventive_filled": [],
                    })
                    action = "show_patient_menu"
                    response_data = {
                        "response": "No problem — what would you like to do instead?",
                        "follow_up": None,
                        "action": "show_patient_menu",
                    }
                else:
                    conversation_manager.update(conv_id, {
                        "pending_vitals": None,
                        "awaiting_vitals_confirmation": False,
                    })
                    data = {"cleared": True}
                    action = "show_patient_menu"
                    response_data = {
                        "response": "No problem — what would you like to do instead?",
                        "follow_up": None,
                        "action": "show_patient_menu",
                    }

            # ---------------- FALLBACK ----------------
            else:
                if preventive_part and patient_id:
                    parsed = await self.preventive_agent.parse(
                        preventive_part, text, conversation.get("preventive_draft")
                    )
                    merged = {**(conversation.get("preventive_draft") or {}), **parsed["fields"]}
                    all_filled = compute_filled_sections(preventive_part, merged)

                    conversation_manager.update(conv_id, {
                        "preventive_draft": merged,
                        "preventive_filled": all_filled,
                    })

                    all_sections = PART_A_ALL_SECTIONS if preventive_part == "A" else PART_C_ALL_SECTIONS
                    pending_sections = [s for s in all_sections if s not in all_filled]

                    data = {
                        "fields": parsed["fields"],
                        "filled_sections": parsed["filled_sections"],
                        "all_filled_sections": all_filled,
                        "pending_sections": pending_sections,
                        "part": preventive_part,
                    }
                    action = "preventive_filled"

                    pretty_filled = ", ".join(s.replace("_", " ") for s in all_filled)
                    if pending_sections:
                        response_msg = (
                            f"I've filled {len(all_filled)} section{'s' if len(all_filled) != 1 else ''}: {pretty_filled}. "
                            f"Still pending: {len(pending_sections)} section{'s' if len(pending_sections) != 1 else ''}. "
                            f"Save Part {preventive_part}, or keep dictating?"
                        )
                    else:
                        response_msg = f"All {len(all_filled)} sections filled! Save Part {preventive_part}?"

                    response_data = {
                        "response": response_msg,
                        "follow_up": f"Save Part {preventive_part}? Yes or No.",
                        "action": "preventive_filled",
                    }
                else:
                    # ── Vitals fallback: ask the LLM whether this is vitals dictation ──
                    vitals_result = {"is_vitals": False, "vitals": {}}
                    if patient_id:
                        vitals_result = await self.vitals_agent.detect_and_parse(text)

                    if patient_id and vitals_result.get("is_vitals"):
                        parsed = vitals_result.get("vitals") or {}
                        existing = conversation.get("pending_vitals") or {}
                        merged = {**existing, **parsed}
                        conversation_manager.update(conv_id, {
                            "pending_vitals": merged,
                            "awaiting_vitals_confirmation": True,
                        })
                        data = {"parsed_vitals": merged}
                        action = "show_parsed_vitals"
                        response_data = {
                            "response": "I've formatted the vitals on the right. Please review them — do you want to save, edit, or cancel?",
                            "follow_up": "Save, Edit, or Cancel?",
                            "action": "show_parsed_vitals",
                        }
                    else:
                        response_data = {
                            "response": "I can help with appointments, admissions, vitals, screening, reports, a patient summary, the tumor board, patient history, clinical reasoning, or the autonomous review agent.",
                            "follow_up": "What would you like to do?",
                            "action": None,
                        }

        conversation_manager.update(conv_id, {
            "last_intent": intent,
            "history": {
                "command": text,
                "intent": intent,
                "response": response_data.get("response"),
                "timestamp": datetime.now().isoformat(),
            }
        })

        return {
            "status": "success",
            "response": response_data.get("response", ""),
            "follow_up": response_data.get("follow_up"),
            "intent": intent,
            "patient_id": patient_id,
            "appointment_id": appointment_id,
            "action": action or response_data.get("action"),
            "data": data,
            "conversation_id": conv_id,
        }


# ============================================================
# MENUS
# ============================================================

def build_greeting() -> Dict[str, Any]:
    hour = datetime.now().hour
    if hour < 12:
        salutation = "Good morning, Doctor."
    elif hour < 17:
        salutation = "Good afternoon, Doctor."
    else:
        salutation = "Good evening, Doctor."
    return {
        "greeting": f"{salutation} Would you like to check your appointments, take a new appointment, or start a new admission?",
        "options": [
            {"label": "List Appointments", "intent": "LIST_APPOINTMENTS", "text": "List appointments"},
            {"label": "Take Appointment", "intent": "BOOK_APPOINTMENT", "text": "Book a new appointment"},
            {"label": "New Admission", "intent": "NEW_ADMISSION", "text": "New admission"},
        ],
    }


def build_patient_menu() -> Dict[str, Any]:
    return {
        "options": [
            {"label": "Vitals", "intent": "RECORD_VITALS", "text": "Record vitals", "icon": "activity"},
            {"label": "Preventive Screening", "intent": "PREVENTIVE_SCREENING", "text": "Preventive screening", "icon": "shield"},
            {"label": "Generate Patient Summary", "intent": "PATIENT_SUMMARY", "text": "Generate patient summary", "icon": "file-text"},
            {"label": "Tumor Board", "intent": "SHOW_TUMOR_BOARD", "text": "Tumor board", "icon": "users"},
            {"label": "History", "intent": "SHOW_HISTORY", "text": "Show patient history", "icon": "clock"},
            {"label": "Report Upload", "intent": "REPORT_UPLOAD", "text": "Upload report", "icon": "file-up"},
            {"label": "Clinical Reasoning", "intent": "CLINICAL_REASONING", "text": "Clinical reasoning", "icon": "brain"},
            {"label": "Autonomous Actions", "intent": "CLINICAL_AUTONOMOUS", "text": "Autonomous actions", "icon": "zap"},
        ]
    }


# ============================================================
# API ENDPOINTS
# ============================================================

@router.get("/greeting")
async def get_greeting():
    return {"status": "success", **build_greeting()}


@router.get("/patient-menu")
async def get_patient_menu():
    return {"status": "success", **build_patient_menu()}


@router.post("/process")
async def process_voice_command(command: VoiceCommand):
    try:
        agent = VoiceAgent()
        return await agent.process_command(command)
    except Exception as e:
        logger.error(f"Voice processing failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/preventive/dictate")
async def preventive_dictate(body: PreventiveDictateBody):
    """Doctor dictates → LLM maps to Part A or Part C fields + filled_sections."""
    agent = VoiceAgent()
    parsed = await agent.preventive_agent.parse(body.part, body.text, body.existing)

    merged = {**(body.existing or {}), **parsed["fields"]}
    all_filled = compute_filled_sections(body.part, merged)
    all_sections = PART_A_ALL_SECTIONS if body.part.upper() == "A" else PART_C_ALL_SECTIONS
    pending_sections = [s for s in all_sections if s not in all_filled]

    return {
        "status": "success",
        "part": body.part.upper(),
        "fields": parsed["fields"],
        "filled_sections": parsed["filled_sections"],
        "all_filled_sections": all_filled,
        "pending_sections": pending_sections,
    }


@router.post("/preventive/save-part")
async def preventive_save_part(body: SavePartBody):
    fetcher = DoctorDataFetcher()
    result = await fetcher.save_preventive_part(
        doctor_id=body.doctor_id,
        patient_id=body.patient_id,
        appointment_id=body.appointment_id,
        part=body.part,
        data=body.data,
    )
    if not result.get("saved"):
        raise HTTPException(status_code=500, detail=result.get("error", "save failed"))
    return {"status": "success", "part": body.part.upper(), "data": result.get("response")}


# ============================================================
# CONSULTATION WORKFLOW ENDPOINTS
# ============================================================

@router.post("/consultation/safe-rx")
async def consultation_safe_rx(body: ConsultationRunBody):
    """Run a medication safety (SafeRx) analysis on the doctor's dictation.

    When `use_agentic=True`, forwards to the agentic medication-agent —
    the same endpoint used by the doctor dashboard's AgenticMedicationPanel.
    Otherwise, uses the legacy medication-agent path (identical URL, but
    the flag lets us version this cleanly if the routes ever diverge).
    """
    if not body.dictation.strip():
        raise HTTPException(status_code=400, detail="Empty dictation")

    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            resp = await client.post(
                f"{API_BASE_URL}hms/users/ai-legacy/medication-agent",
                json={
                    "patient_id": body.patient_id,
                    "doctor_id": body.doctor_id,
                    "prescription_text": body.dictation,
                    # Some deployments key on `use_agentic` server-side —
                    # pass it through so behaviour is explicit.
                    "use_agentic": bool(body.use_agentic),
                },
            )
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail=resp.text)
            data = resp.json()
            return {"status": "success", "data": data}
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"SafeRx failed: {e}")
            raise HTTPException(status_code=500, detail=str(e))


@router.post("/consultation/generate-docs")
async def consultation_generate_docs(body: ConsultationRunBody):
    if not body.dictation.strip():
        raise HTTPException(status_code=400, detail="Empty dictation")

    feature_ids = body.feature_ids or [
        "documentation-medication-analysis",
        "documentation-investigation-notes",
        "documentation-clinical-notes",
        "documentation-treatment-plan",
        "structured-note",
    ]

    results: Dict[str, Any] = {}

    async with httpx.AsyncClient(timeout=180.0) as client:
        for fid in feature_ids:
            try:
                resp = await client.post(
                    f"{API_BASE_URL}hms/users/orchestration/generate_documentation_with_suggestions",
                    json={
                        "doctor_id": body.doctor_id,
                        "patient_id": body.patient_id,
                        "feature_id": fid,
                        "dictation": body.dictation,
                        "output_json": None,
                    },
                )
                json_resp = resp.json()
                results[fid] = (
                    json_resp.get("finaloutput")
                    or json_resp.get("data")
                    or None
                )
            except Exception as e:
                logger.error(f"[generate-docs] {fid} failed: {e}")
                results[fid] = None

    return {"status": "success", "documents": results}


@router.post("/consultation/save-docs")
async def consultation_save_docs(body: ConsultationSaveBody):
    """Proxy to the EMR bulk save endpoint.

    The raw dictation (the doctor's textarea) and the analyze-transcript
    output are stamped into each document's `metadata` so the EMR always
    sees the original input alongside the generated output.
    """
    if not body.documents:
        raise HTTPException(status_code=400, detail="No documents to save")

    # Stamp dictation + analysis onto each document's metadata.
    documents: List[Dict[str, Any]] = []
    for doc in body.documents:
        doc = dict(doc)
        md = dict(doc.get("metadata") or {})
        if body.dictation is not None:
            md["dictation_text"] = body.dictation
        if body.analyzed_dictation is not None:
            md["analyzed_dictation"] = body.analyzed_dictation
        doc["metadata"] = md
        documents.append(doc)

    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            resp = await client.post(
                f"{API_BASE_URL}hms/users/data/context/save_documentation_features_bulk",
                json={
                    "documents": documents,
                    # Also send the raw dictation at the top level so
                    # downstream consumers that read it from the root can.
                    "dictation": body.dictation,
                    "analyzed_dictation": body.analyzed_dictation,
                },
            )
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail=resp.text)
            return {"status": "success", "data": resp.json()}
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Bulk save failed: {e}")
            raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# CLINICAL AGENTS ENDPOINTS
# ============================================================

@router.post("/clinical/reasoning")
async def run_clinical_reasoning(body: ClinicalAgentBody):
    agent = ClinicalReasoningAgent()
    result = await agent.run(
        patient_id=body.patient_id,
        doctor_id=body.doctor_id,
        query=body.query,
        conversation_id=body.conversation_id,
    )
    if result.get("status") != "success":
        raise HTTPException(status_code=500, detail=result.get("error", "reasoning failed"))
    return {"status": "success", "data": result}


@router.post("/clinical/autonomous")
async def run_clinical_autonomous(body: ClinicalAgentBody):
    agent = ClinicalAutonomousAgent()
    result = await agent.run(
        patient_id=body.patient_id,
        doctor_id=body.doctor_id,
        query=body.query,
        conversation_id=body.conversation_id,
    )
    if result.get("status") != "success":
        raise HTTPException(status_code=500, detail=result.get("error", "autonomous run failed"))
    return {"status": "success", "data": result}


@router.post("/clinical/autonomous/confirm")
async def confirm_clinical_autonomous_action(body: ClinicalActionConfirmBody):
    agent = ClinicalAutonomousAgent()
    result = await agent.execute_confirmed(body.patient_id, body.doctor_id, body.action)
    return {"status": "success", "data": result}


@router.post("/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    language_code: str = Form("eng"),
):
    """Speech-to-text endpoint used by push-to-talk.

    Frontend records audio while Start is held/clicked, stops on Stop,
    and POSTs the blob here. The returned `text` is written into the
    input box by the frontend — it is NOT auto-sent.
    """
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name

        url = "https://api.elevenlabs.io/v1/speech-to-text"
        headers = {"xi-api-key": ELEVENLABS_API_KEY}

        with open(tmp_path, "rb") as f:
            response = requests.post(
                url, headers=headers, files={"file": f},
                data={"model_id": "scribe_v1", "language_code": language_code},
            )

        os.unlink(tmp_path)

        if response.status_code == 200:
            result = response.json()
            text = (result.get("text") or "").strip()
            return {"text": text, "language_code": language_code, "no_speech": len(text) == 0}
        return {"text": "", "error": "Transcription failed", "no_speech": True}
    except Exception as e:
        logger.error(f"Transcription error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/conversation/{conversation_id}")
async def get_conversation(conversation_id: str):
    conv = conversation_manager.get(conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {
        "status": "success",
        "conversation_id": conversation_id,
        "context": conversation_manager.get_context(conversation_id),
        "current_patient": conv.get("current_patient_id"),
        "current_appointment_id": conv.get("current_appointment_id"),
        "last_intent": conv.get("last_intent"),
        "pending_vitals": conv.get("pending_vitals"),
        "awaiting_vitals_confirmation": conv.get("awaiting_vitals_confirmation"),
        "preventive_part": conv.get("preventive_part"),
        "preventive_draft": conv.get("preventive_draft"),
        "preventive_filled": conv.get("preventive_filled"),
        "report_stage": conv.get("report_stage"),
        "report_timing": conv.get("report_timing"),
        "report_category_mode": conv.get("report_category_mode"),
        "history_stage": conv.get("history_stage"),
        "history_tab": conv.get("history_tab"),
        "admission_stage": conv.get("admission_stage"),
        "admission_dictation": conv.get("admission_dictation"),
        "clinical_panel": conv.get("clinical_panel"),
        "history": conv.get("history", [])[-10:],
    }


@router.delete("/conversation/{conversation_id}")
async def clear_conversation(conversation_id: str):
    conversation_manager.clear(conversation_id)
    clear_agent_memory(conversation_id)
    return {"status": "success", "message": "Conversation cleared"}


@router.post("/refresh/{conversation_id}")
async def refresh_conversation(conversation_id: str):
    await conversation_manager.refresh_data(conversation_id)
    return {"status": "success", "message": "Data refreshed"}


@router.post("/select-patient")
async def select_patient(body: SelectPatientBody):
    await conversation_manager.get_or_create(body.conversation_id, body.doctor_id)
    updates: Dict[str, Any] = {
        "current_patient_id": body.patient_id,
        "pending_vitals": None,
        "awaiting_vitals_confirmation": False,
        "vitals_saved": False,
        "preventive_part": None,
        "preventive_draft": None,
        "preventive_filled": [],
        "report_stage": None,
        "report_timing": None,
        "report_category_mode": None,
        "history_stage": None,
        "history_tab": None,
        "admission_stage": None,
        "admission_dictation": None,
        "clinical_panel": None,
    }
    if body.appointment_id:
        updates["current_appointment_id"] = body.appointment_id
    if body.patient_name:
        updates["current_patient_name"] = body.patient_name

    conversation_manager.update(body.conversation_id, updates)
    clear_agent_memory(body.conversation_id)

    return {
        "status": "success",
        "patient_id": body.patient_id,
        "appointment_id": body.appointment_id,
        "conversation_id": body.conversation_id,
        "response": "Patient selected. What would you like to do — record vitals, preventive screening, generate patient summary, tumor board, history, report upload, clinical reasoning, or autonomous actions?",
        **build_patient_menu(),
    }