"""
Patient Education Agent — Autonomous Patient-Facing Education Generator
========================================================================

Architecture:
  Data Fetch             → Pulls latest treatment plan + medication docs from MongoDB
  Sequential Pipeline    → E1 → E2 → E3 → E4 → E5
  Output                 → Structured patient education package

Pipeline:
  E1 · MedicationEducationAgent   — How/when/how-much to take each drug, food interactions
  E2 · DosScheduleAgent           — Daily schedule, timing, meal relationship
  E3 · FollowUpAgent              — Follow-up appointments, warning signs, when to call doctor
  E4 · DosDontsAgent              — Activity, diet, lifestyle dos and don'ts
  E5 · NarrativePackageAgent      — Assembles everything into patient-readable output
"""

from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime
from typing import Any, Dict, List, Optional, TypedDict

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel

from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import StateGraph, END

from motor.motor_asyncio import AsyncIOMotorClient

# ============================================================
# ENVIRONMENT & DB CONFIGURATION
# ============================================================

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
MONGO_URI    = os.getenv("MONGO_URI")
MONGO_DB     = "doctorassistai"

mongo_client = AsyncIOMotorClient(MONGO_URI)
mongo_db     = mongo_client[MONGO_DB]

# Collections that hold documentation features (same as save_documentation_features_bulk)
treatment_plan_col    = mongo_db["documentation-treatment-plan"]
investigation_col     = mongo_db["documentation-investigation-notes"]
medication_col        = mongo_db["documentation-medication-analysis"]
clinical_notes_col    = mongo_db["documentation-clinical-notes"]
treatment_summary_col = mongo_db["documentation-treatment-summary"]

# Output collection
education_col = mongo_db["patient_education"]

# ============================================================
# LLM SETUP
# ============================================================

llm = ChatGroq(
    model="llama-3.1-8b-instant",
    temperature=0.2,
    max_tokens=4000,
    groq_api_key=GROQ_API_KEY,
)

llm_synthesis = ChatGroq(
    model="llama-3.3-70b-versatile",
    temperature=0.15,
    max_tokens=5000,
    groq_api_key=GROQ_API_KEY,
)

router = APIRouter(prefix="", tags=["Patient Education"])

# ============================================================
# REQUEST / RESPONSE MODELS
# ============================================================

class EducationRequest(BaseModel):
    patient_id:  str
    doctor_id:   str
    language:    str = "malayalam"       # target language for output
    reading_level: str = "simple"      # simple | intermediate | advanced
    include_intermediates: bool = False


class EducationResponse(BaseModel):
    patient_id:      str
    doctor_id:       str
    generated_at:    str
    processing_time_ms: int
    language:        str
    education_package: Dict[str, Any]
    intermediate:    Optional[Dict[str, Any]] = None


# ============================================================
# AGENT STATE
# ============================================================

class EducationState(TypedDict):
    # Inputs
    patient_id:     str
    doctor_id:      str
    language:       str
    reading_level:  str

    # Raw fetched documents
    treatment_plan:      Optional[Dict]   # latest treatment plan doc
    medications:         Optional[Dict]   # latest medication analysis doc
    clinical_notes:      Optional[Dict]   # latest clinical notes
    investigation_notes: Optional[Dict]   # latest investigation notes
    treatment_summary:   Optional[Dict]   # latest treatment summary

    # Agent outputs
    medication_education:  Optional[Dict]   # E1
    dose_schedule:         Optional[Dict]   # E2
    follow_up_guidance:    Optional[Dict]   # E3
    dos_and_donts:         Optional[Dict]   # E4
    education_package:     Optional[Dict]   # E5 — final assembled output

    # Telemetry
    errors:        List[str]
    agent_timings: Dict[str, float]


# ============================================================
# MONGO DATA FETCHER
# ============================================================

async def fetch_latest_doc(collection, patient_id: str, doctor_id: str) -> Optional[Dict]:
    """Fetch the most recent document for a patient from a given collection."""
    try:
        doc = await collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id},
            sort=[("created_at", -1)]
        )
        if doc:
            doc.pop("_id", None)
        return doc
    except Exception as e:
        logger.error(f"Mongo fetch error from {collection.name} for patient {patient_id}: {e}")
        return None


async def fetch_all_patient_docs(patient_id: str, doctor_id: str) -> Dict[str, Optional[Dict]]:
    """Concurrently fetch latest docs from all relevant collections."""
    results = await asyncio.gather(
        fetch_latest_doc(treatment_plan_col,    patient_id, doctor_id),
        fetch_latest_doc(medication_col,        patient_id, doctor_id),
        fetch_latest_doc(clinical_notes_col,    patient_id, doctor_id),
        fetch_latest_doc(investigation_col,     patient_id, doctor_id),
        fetch_latest_doc(treatment_summary_col, patient_id, doctor_id),
        return_exceptions=True,
    )

    def safe(r): return r if isinstance(r, dict) else None

    return {
        "treatment_plan":      safe(results[0]),
        "medications":         safe(results[1]),
        "clinical_notes":      safe(results[2]),
        "investigation_notes": safe(results[3]),
        "treatment_summary":   safe(results[4]),
    }


# ============================================================
# JSON PARSING HELPER
# ============================================================

import re

def parse_llm_json(text: str) -> Dict:
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


# ============================================================
# BASE AGENT
# ============================================================

class BaseEducationAgent:

    def __init__(self, llm):
        self.llm = llm

    async def _invoke(self, system: str, user: str) -> Dict:
        response = await self.llm.ainvoke([
            SystemMessage(content=system),
            HumanMessage(content=user),
        ])
        return parse_llm_json(response.content)

    def _elapsed(self, start: float) -> float:
        return round((datetime.now().timestamp() - start) * 1000, 1)


# ============================================================
# HELPERS
# ============================================================

def _extract_finaloutput(doc: Optional[Dict]) -> Any:
    """Safely pull the finaloutput field from a documentation feature doc."""
    if not doc:
        return None
    fo = doc.get("finaloutput")
    if isinstance(fo, list) and fo:
        return fo[0]
    return fo


def _build_context_block(state: EducationState) -> str:
    """Build a single readable context string from all fetched docs."""
    parts = []

    tp = _extract_finaloutput(state.get("treatment_plan"))
    if tp:
        parts.append(f"=== TREATMENT PLAN ===\n{json.dumps(tp, indent=2, default=str)}")

    med = _extract_finaloutput(state.get("medications"))
    if med:
        parts.append(f"=== MEDICATION ANALYSIS ===\n{json.dumps(med, indent=2, default=str)}")

    cn = _extract_finaloutput(state.get("clinical_notes"))
    if cn:
        parts.append(f"=== CLINICAL NOTES ===\n{json.dumps(cn, indent=2, default=str)}")

    inv = _extract_finaloutput(state.get("investigation_notes"))
    if inv:
        parts.append(f"=== INVESTIGATION NOTES ===\n{json.dumps(inv, indent=2, default=str)}")

    ts = _extract_finaloutput(state.get("treatment_summary"))
    if ts:
        parts.append(f"=== TREATMENT SUMMARY ===\n{json.dumps(ts, indent=2, default=str)}")

    return "\n\n".join(parts) if parts else "No clinical documents available."


# ============================================================
# E1 · MEDICATION EDUCATION AGENT
# ============================================================

class MedicationEducationAgent(BaseEducationAgent):
    agent_id = "E1"

    async def run(self, state: EducationState) -> EducationState:
        logger.info(f"{self.agent_id} · MedicationEducationAgent — START")
        t0 = datetime.now().timestamp()

        context     = _build_context_block(state)
        language    = state.get("language", "English")
        level       = state.get("reading_level", "simple")

        system = (
            "You are a clinical pharmacist specializing in patient medication counselling. "
            "You translate complex medication regimens into clear, safe patient instructions. "
            "Write at a level appropriate for patients, not clinicians. "
            "Always respond with valid JSON only."
        )

        prompt = f"""
You are preparing medication education for a patient.
Target language: {language}
Reading level: {level} (simple = no jargon, intermediate = some medical terms explained, advanced = standard)

CLINICAL DOCUMENTS:
{context}

══════════════════════════════════════════════════════════
TASK — Extract and explain every medication prescribed
══════════════════════════════════════════════════════════

For EACH medication found in the documents, extract:

1. Drug name (generic name + brand name if available)
2. What it is for — explain in plain language what this drug does for THIS patient
3. Dose — exact dose in patient-friendly terms (e.g., "one tablet", "5 ml")
4. How to take it — with water? crushed? on empty stomach? whole?
5. When to take — morning / night / with food / before bed etc.
6. What happens if a dose is missed — specific instructions
7. Common side effects to EXPECT (not alarm, just be aware)
8. Side effects that mean STOP and call the doctor immediately
9. Food/drink to AVOID with this drug (e.g., grapefruit, alcohol, dairy)
10. Food/drink that HELPS this drug work better
11. Storage — fridge? room temp? away from light?
12. Duration — how long to take it

SAFETY FLAGS:
- If any drug has a narrow therapeutic index (warfarin, digoxin, lithium, phenytoin, etc.) — mark as HIGH_ALERT
- If any drug has a black-box warning — mention it simply
- If two drugs interact with each other — flag the interaction

Return ONLY valid JSON:
{{
  "medications": [
    {{
      "drug_name": "...",
      "brand_name": "...",
      "drug_class": "...",
      "why_prescribed": "...",
      "dose": "...",
      "how_to_take": "...",
      "timing": {{
        "frequency": "once daily|twice daily|three times daily|as needed|other",
        "specific_times": ["e.g., 8 AM", "8 PM"],
        "relation_to_meals": "before meals|with meals|after meals|empty stomach|does not matter",
        "meal_instruction_detail": "..."
      }},
      "if_missed_dose": "...",
      "expected_side_effects": ["..."],
      "stop_and_call_doctor_if": ["..."],
      "food_to_avoid": ["..."],
      "food_that_helps": ["..."],
      "storage": "...",
      "duration": "...",
      "high_alert": false,
      "high_alert_reason": null,
      "interactions_with_other_prescribed_drugs": ["..."],
      "special_instructions": "..."
    }}
  ],
  "drug_interactions_summary": [
    {{
      "drug_a": "...",
      "drug_b": "...",
      "interaction": "...",
      "action": "..."
    }}
  ],
  "high_alert_medications": ["..."],
  "total_medications_count": 0,
  "medication_education_notes": "..."
}}
"""
        state["medication_education"] = await self._invoke(system, prompt)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · MedicationEducationAgent — DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# E2 · DOSE SCHEDULE AGENT
# ============================================================

class DoseScheduleAgent(BaseEducationAgent):
    agent_id = "E2"

    async def run(self, state: EducationState) -> EducationState:
        logger.info(f"{self.agent_id} · DoseScheduleAgent — START")
        t0 = datetime.now().timestamp()

        med_data = state.get("medication_education", {})
        context  = _build_context_block(state)
        language = state.get("language", "English")

        system = (
            "You are a patient care coordinator creating clear daily medication schedules. "
            "You produce easy-to-follow timetables a patient can stick on their fridge. "
            "Always respond with valid JSON only."
        )

        prompt = f"""
Build a complete daily medication schedule for this patient.
Language: {language}

MEDICATIONS ALREADY ANALYZED (E1 output):
{json.dumps(med_data, indent=2, default=str)}

ORIGINAL CLINICAL DOCUMENTS:
{context}

══════════════════════════════════════════════════════════
TASK — Build a simple daily schedule
══════════════════════════════════════════════════════════

1. Create a MORNING → AFTERNOON → EVENING → BEDTIME schedule
   showing exactly which drug to take when.

2. For each time slot:
   - Which drugs (use patient-friendly names)
   - With or without food
   - Any special prep (e.g., "take 30 min before breakfast")

3. Create a WEEKLY view if any drugs are weekly/alternate-day.

4. Create a "HOW TO SET UP YOUR PHONE ALARMS" simple guide
   — list each alarm time and what it is for.

5. If the patient is on injectable medications (insulin, LMWH, etc.):
   - Injection site rotation instructions
   - How to store and handle

6. Special timing rules:
   - Drugs that MUST be separated by X hours from each other
   - Drugs that MUST be taken at the same time every day (steady state)

Return ONLY valid JSON:
{{
  "daily_schedule": {{
    "morning": [
      {{
        "time_suggestion": "7:00 AM",
        "drugs": ["drug_name: dose"],
        "with_food": true,
        "special_note": "..."
      }}
    ],
    "afternoon": [],
    "evening": [],
    "bedtime": [],
    "as_needed": []
  }},
  "weekly_schedule": [
    {{
      "day": "Monday",
      "extra_medications": ["..."],
      "note": "..."
    }}
  ],
  "phone_alarm_guide": [
    {{
      "alarm_label": "Morning Medications",
      "time": "7:00 AM",
      "what_to_take": ["..."]
    }}
  ],
  "injection_instructions": null,
  "separation_rules": [
    {{
      "drug_a": "...",
      "drug_b": "...",
      "minimum_gap_hours": 0,
      "reason": "..."
    }}
  ],
  "critical_timing_drugs": ["drugs that must be taken at same time daily"],
  "schedule_notes": "..."
}}
"""
        state["dose_schedule"] = await self._invoke(system, prompt)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · DoseScheduleAgent — DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# E3 · FOLLOW-UP GUIDANCE AGENT
# ============================================================

class FollowUpAgent(BaseEducationAgent):
    agent_id = "E3"

    async def run(self, state: EducationState) -> EducationState:
        logger.info(f"{self.agent_id} · FollowUpAgent — START")
        t0 = datetime.now().timestamp()

        context  = _build_context_block(state)
        language = state.get("language", "English")

        system = (
            "You are a senior nurse care coordinator creating patient follow-up instructions. "
            "You translate clinical follow-up plans into clear patient actions and warning signs. "
            "Always respond with valid JSON only."
        )

        prompt = f"""
Extract and explain all follow-up care instructions for this patient.
Language: {language}

CLINICAL DOCUMENTS:
{context}

══════════════════════════════════════════════════════════
TASK — Follow-up guidance extraction
══════════════════════════════════════════════════════════

SECTION 1 — UPCOMING APPOINTMENTS
  Extract every follow-up appointment mentioned:
  - What type (lab test, scan, specialist visit, dressing change, etc.)
  - When (date or "in X weeks")
  - Where (department/clinic)
  - What to bring (reports, fasting required?, etc.)
  - What will happen at that visit

SECTION 2 — TESTS TO GET DONE
  All blood tests, scans, or investigations ordered:
  - Test name (in plain language)
  - When to get it done
  - Fasting required?
  - Where to go
  - Why it is needed (in simple terms)

SECTION 3 — WARNING SIGNS — CALL DOCTOR IMMEDIATELY
  Based on the diagnosis and medications, list specific warning signs:
  - The exact symptom
  - Why it matters for THIS patient
  - What to do (call helpline / go to ER / go to clinic)
  
  Categories:
  a) Go to Emergency Room immediately
  b) Call doctor within 24 hours
  c) Mention at next appointment

SECTION 4 — WOUND / PROCEDURE CARE (if applicable)
  If any procedure was performed, extract wound/site care instructions:
  - How to clean
  - What to look for (infection signs)
  - When to change dressings
  - When stitches come out

SECTION 5 — MONITORING AT HOME
  What should the patient monitor themselves:
  - Blood pressure / glucose / weight / temperature — thresholds
  - How often
  - When to report

Return ONLY valid JSON:
{{
  "upcoming_appointments": [
    {{
      "appointment_type": "...",
      "when": "...",
      "where": "...",
      "what_to_bring": ["..."],
      "fasting_required": false,
      "what_will_happen": "...",
      "purpose": "..."
    }}
  ],
  "tests_ordered": [
    {{
      "test_name": "...",
      "plain_name": "...",
      "when": "...",
      "fasting": false,
      "where": "...",
      "why": "..."
    }}
  ],
  "warning_signs": {{
    "go_to_er_immediately": [
      {{
        "symptom": "...",
        "why_matters": "...",
        "action": "Go to nearest Emergency Room immediately"
      }}
    ],
    "call_doctor_within_24h": [
      {{
        "symptom": "...",
        "action": "Call your doctor's helpline"
      }}
    ],
    "mention_at_next_visit": [
      {{
        "symptom": "...",
        "action": "Note it down and tell your doctor at next visit"
      }}
    ]
  }},
  "wound_care": null,
  "home_monitoring": [
    {{
      "what_to_monitor": "...",
      "how_often": "...",
      "normal_range": "...",
      "alert_threshold": "...",
      "action_if_abnormal": "..."
    }}
  ],
  "follow_up_notes": "..."
}}
"""
        state["follow_up_guidance"] = await self._invoke(system, prompt)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · FollowUpAgent — DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# E4 · DOS AND DON'TS AGENT
# ============================================================

class DosDontsAgent(BaseEducationAgent):
    agent_id = "E4"

    async def run(self, state: EducationState) -> EducationState:
        logger.info(f"{self.agent_id} · DosDontsAgent — START")
        t0 = datetime.now().timestamp()

        context  = _build_context_block(state)
        med_data = state.get("medication_education", {})
        language = state.get("language", "English")

        system = (
            "You are a clinical lifestyle counsellor. "
            "You give practical, specific dos and don'ts based on the patient's "
            "actual diagnosis and medications — not generic advice. "
            "Always respond with valid JSON only."
        )

        prompt = f"""
Generate SPECIFIC dos and don'ts for this patient based on their actual condition and medications.
Language: {language}

IMPORTANT: Every instruction must be specific to THIS patient's condition and drugs.
No generic advice. If you cannot tie an instruction to a specific finding or drug, omit it.

CLINICAL DOCUMENTS:
{context}

MEDICATION DATA (E1):
{json.dumps(med_data, indent=2, default=str)}

══════════════════════════════════════════════════════════
TASK — Specific Dos and Don'ts
══════════════════════════════════════════════════════════

DIET:
  DO eat: foods that help recovery / support medication efficacy
  DON'T eat: foods that interfere with medications / worsen condition
  LIMIT: foods to reduce (not eliminate)

ACTIVITY & REST:
  DO: exercises or activities that are safe and beneficial
  DON'T: activities to avoid entirely (with specific reason)
  LIMIT: activities to do carefully or in moderation

LIFESTYLE:
  Alcohol — exact guidance (none / limit to X units / occasional ok)
  Smoking — guidance
  Driving — any restrictions?
  Work — any restrictions?
  Sex — any restrictions? (include only if clinically relevant)
  Travel — any restrictions or precautions?

HYGIENE & INFECTION PREVENTION:
  (especially relevant for immunosuppressed patients, post-surgical, etc.)

SUN / HEAT EXPOSURE:
  (relevant for some drugs and conditions)

SLEEP:
  Specific sleep guidance if relevant to condition or medications

STRESS MANAGEMENT:
  If relevant to the condition

For each instruction provide:
  - The specific instruction
  - The REASON tied to their condition or specific drug
  - How long this restriction applies (temporary vs permanent)

Return ONLY valid JSON:
{{
  "diet": {{
    "do_eat": [
      {{
        "food": "...",
        "reason": "...",
        "duration": "..."
      }}
    ],
    "dont_eat": [
      {{
        "food": "...",
        "reason": "...",
        "duration": "..."
      }}
    ],
    "limit": [
      {{
        "food": "...",
        "limit_to": "...",
        "reason": "..."
      }}
    ]
  }},
  "activity": {{
    "do": [
      {{
        "activity": "...",
        "frequency": "...",
        "reason": "..."
      }}
    ],
    "dont": [
      {{
        "activity": "...",
        "reason": "...",
        "duration": "..."
      }}
    ],
    "limit": []
  }},
  "lifestyle": {{
    "alcohol": {{
      "instruction": "...",
      "reason": "..."
    }},
    "smoking": {{
      "instruction": "...",
      "reason": "..."
    }},
    "driving": {{
      "restriction": "...",
      "reason": "...",
      "duration": "..."
    }},
    "work": {{
      "restriction": "...",
      "reason": "...",
      "duration": "..."
    }},
    "travel": {{
      "restriction": "...",
      "precautions": ["..."]
    }}
  }},
  "hygiene_infection_prevention": ["..."],
  "sun_heat_exposure": "...",
  "sleep_guidance": "...",
  "stress_management": "...",
  "dos_donts_summary": "A 3-sentence plain-language summary of the most important lifestyle rules for this patient."
}}
"""
        state["dos_and_donts"] = await self._invoke(system, prompt)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · DosDontsAgent — DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# E5 · NARRATIVE PACKAGE ASSEMBLER
# ============================================================

class NarrativePackageAgent(BaseEducationAgent):
    agent_id = "E5"

    async def run(self, state: EducationState) -> EducationState:
        logger.info(f"{self.agent_id} · NarrativePackageAgent — START")
        t0 = datetime.now().timestamp()

        language = state.get("language", "English")
        level    = state.get("reading_level", "simple")

        context   = _build_context_block(state)
        med_edu   = state.get("medication_education",  {})
        schedule  = state.get("dose_schedule",          {})
        follow_up = state.get("follow_up_guidance",     {})
        dos_donts = state.get("dos_and_donts",          {})

        system = (
            "You are a patient education specialist and medical writer. "
            "You assemble all clinical inputs into a complete, warm, easy-to-read "
            "patient education document. Write as if speaking directly to the patient. "
            "Use 'you' and 'your'. Be encouraging, clear, and specific. "
            "Always respond with valid JSON only."
        )

        prompt = f"""
Assemble the complete patient education package from all agent outputs.
Write in: {language}
Reading level: {level}

You are writing DIRECTLY TO THE PATIENT in warm, clear, supportive language.

ALL AGENT OUTPUTS:

[E1 — Medication Details]
{json.dumps(med_edu, indent=2, default=str)}

[E2 — Daily Schedule]
{json.dumps(schedule, indent=2, default=str)}

[E3 — Follow-up Guidance]
{json.dumps(follow_up, indent=2, default=str)}

[E4 — Dos and Don'ts]
{json.dumps(dos_donts, indent=2, default=str)}

[ORIGINAL CLINICAL CONTEXT]
{context}

══════════════════════════════════════════════════════════
ASSEMBLY TASK — Patient Education Package
══════════════════════════════════════════════════════════

Produce a complete patient education document with these sections:

1. WELCOME MESSAGE (2–3 sentences, warm, specific to their condition)

2. UNDERSTANDING YOUR CONDITION
   Plain-language explanation of what was found and what the treatment plan is doing.
   2–4 sentences. No jargon.

3. YOUR MEDICATIONS — one entry per drug
   Keep the detail from E1 but write in warm, direct language.
   
4. YOUR DAILY MEDICATION SCHEDULE
   A clear morning/afternoon/evening/bedtime table.

5. WHAT YOU SHOULD DO — top 10 most important DOs

6. WHAT TO AVOID — top 10 most important DON'Ts

7. YOUR UPCOMING APPOINTMENTS & TESTS
   Bullet list of what is coming up and what to expect.

8. WARNING SIGNS — WHEN TO SEEK HELP
   Three tiers clearly labelled:
   🚨 GO TO EMERGENCY NOW
   📞 CALL YOUR DOCTOR TODAY
   📋 MENTION AT NEXT VISIT

9. YOUR QUESTIONS CHECKLIST
   Generate 5–8 questions the patient SHOULD ask their doctor at the next visit,
   based on the clinical situation (pending results, treatment decisions, etc.)

10. QUICK REFERENCE CARD
    One paragraph (5–6 sentences) the patient can read every morning:
    diagnosis, key medications, most important rule, next appointment, who to call.

TONE RULES:
- Use "you" and "your" throughout
- Short sentences (max 20 words)
- No abbreviations without explanation
- Numbers in words for small numbers (two tablets, not 2 tablets)
- Positive framing where possible ("Take this with food" not "Do not take on empty stomach")
- For {language}: if not English, translate ALL output text including keys into {language}

Return ONLY valid JSON:
{{
  "welcome_message": "...",
  "condition_explanation": "...",
  "medications_section": [
    {{
      "drug_name": "...",
      "plain_explanation": "...",
      "dose_instruction": "...",
      "timing_instruction": "...",
      "key_warnings": ["..."],
      "high_alert": false
    }}
  ],
  "daily_schedule_table": {{
    "morning": "...",
    "afternoon": "...",
    "evening": "...",
    "bedtime": "...",
    "as_needed": "..."
  }},
  "top_dos": [
    {{
      "do": "...",
      "why": "..."
    }}
  ],
  "top_donts": [
    {{
      "dont": "...",
      "why": "..."
    }}
  ],
  "appointments_and_tests": [
    {{
      "what": "...",
      "when": "...",
      "what_to_prepare": "...",
      "what_will_happen": "..."
    }}
  ],
  "warning_signs": {{
    "go_to_er_now": [
      {{
        "symptom": "...",
        "action": "..."
      }}
    ],
    "call_doctor_today": [
      {{
        "symptom": "...",
        "action": "..."
      }}
    ],
    "mention_next_visit": [
      {{
        "symptom": "...",
        "action": "..."
      }}
    ]
  }},
  "questions_for_doctor": ["..."],
  "quick_reference_card": "...",
  "language": "{language}",
  "reading_level": "{level}",
  "generated_at": "{datetime.now().isoformat()}"
}}
"""
        state["education_package"] = await self._invoke(system, prompt)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · NarrativePackageAgent — DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# LANGGRAPH WORKFLOW
# ============================================================

def create_education_workflow() -> Any:
    workflow = StateGraph(EducationState)

    workflow.add_node("E1", MedicationEducationAgent(llm).run)
    workflow.add_node("E2", DoseScheduleAgent(llm).run)
    workflow.add_node("E3", FollowUpAgent(llm).run)
    workflow.add_node("E4", DosDontsAgent(llm).run)
    workflow.add_node("E5", NarrativePackageAgent(llm_synthesis).run)

    workflow.set_entry_point("E1")
    workflow.add_edge("E1", "E2")
    workflow.add_edge("E2", "E3")
    workflow.add_edge("E3", "E4")
    workflow.add_edge("E4", "E5")
    workflow.add_edge("E5", END)

    return workflow.compile()


education_workflow = create_education_workflow()


# ============================================================
# INITIAL STATE FACTORY
# ============================================================

def build_initial_state(
    request: EducationRequest,
    docs:    Dict[str, Optional[Dict]],
) -> EducationState:
    return EducationState(
        patient_id=request.patient_id,
        doctor_id=request.doctor_id,
        language=request.language,
        reading_level=request.reading_level,
        treatment_plan=docs.get("treatment_plan"),
        medications=docs.get("medications"),
        clinical_notes=docs.get("clinical_notes"),
        investigation_notes=docs.get("investigation_notes"),
        treatment_summary=docs.get("treatment_summary"),
        medication_education=None,
        dose_schedule=None,
        follow_up_guidance=None,
        dos_and_donts=None,
        education_package=None,
        errors=[],
        agent_timings={},
    )


# ============================================================
# API ENDPOINTS
# ============================================================

@router.post("/patient-education/generate", response_model=EducationResponse)
async def generate_patient_education(request: EducationRequest):
    """
    Patient Education Agent — 5-agent pipeline.

    Fetches:
      - Latest treatment plan
      - Latest medication analysis
      - Latest clinical notes
      - Latest investigation notes
      - Latest treatment summary

    Runs:
      E1 — Medication education (how/when/what to eat)
      E2 — Daily dose schedule (timetable + phone alarms)
      E3 — Follow-up guidance (appointments, tests, warning signs)
      E4 — Dos and don'ts (diet, activity, lifestyle)
      E5 — Final narrative package (patient-readable document)
    """
    start_ms = datetime.now().timestamp() * 1000
    logger.info(
        f"PatientEducation request | patient={request.patient_id} | "
        f"language={request.language} | level={request.reading_level}"
    )

    try:
        # ── Fetch all latest clinical documents ──────────────────────────
        docs = await fetch_all_patient_docs(request.patient_id, request.doctor_id)

        has_any = any(v is not None for v in docs.values())
        if not has_any:
            raise HTTPException(
                status_code=404,
                detail=f"No clinical documents found for patient {request.patient_id}. "
                       f"Ensure at least one documentation feature has been saved."
            )

        docs_found = [k for k, v in docs.items() if v is not None]
        logger.info(f"Documents found: {docs_found}")

        # ── Build initial state and run workflow ─────────────────────────
        initial_state = build_initial_state(request, docs)
        result        = await education_workflow.ainvoke(initial_state)

        elapsed = round(datetime.now().timestamp() * 1000 - start_ms)

        # ── Save to MongoDB ──────────────────────────────────────────────
        save_doc = {
            "patient_id":        request.patient_id,
            "doctor_id":         request.doctor_id,
            "language":          request.language,
            "reading_level":     request.reading_level,
            "generated_at":      datetime.utcnow(),
            "processing_time_ms": elapsed,
            "education_package": result.get("education_package", {}),
            "medication_education": result.get("medication_education", {}),
            "dose_schedule":     result.get("dose_schedule", {}),
            "follow_up_guidance": result.get("follow_up_guidance", {}),
            "dos_and_donts":     result.get("dos_and_donts", {}),
            "agent_timings":     result.get("agent_timings", {}),
            "errors":            result.get("errors", []),
        }

        try:
            await education_col.insert_one(save_doc)
            logger.info(f"Education package saved to MongoDB for patient {request.patient_id}")
        except Exception as e:
            logger.error(f"MongoDB save failed: {e}")

        logger.info(
            f"PatientEducation complete | patient={request.patient_id} | {elapsed}ms"
        )

        response: Dict[str, Any] = {
            "patient_id":        request.patient_id,
            "doctor_id":         request.doctor_id,
            "generated_at":      datetime.now().isoformat(),
            "processing_time_ms": elapsed,
            "language":          request.language,
            "education_package": result.get("education_package", {}),
            "agent_timings":     result.get("agent_timings", {}),
            "errors":            result.get("errors", []),
            "documents_used":    docs_found,
        }

        if request.include_intermediates:
            response["intermediate"] = {
                "medication_education":  result.get("medication_education", {}),
                "dose_schedule":         result.get("dose_schedule", {}),
                "follow_up_guidance":    result.get("follow_up_guidance", {}),
                "dos_and_donts":         result.get("dos_and_donts", {}),
            }

        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(
            f"PatientEducation pipeline failed | patient={request.patient_id} | {e}"
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/patient-education/{patient_id}/latest")
async def get_latest_education(patient_id: str, doctor_id: str):
    """Retrieve the most recently generated education package for a patient."""
    try:
        doc = await education_col.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id},
            sort=[("generated_at", -1)]
        )
        if not doc:
            raise HTTPException(
                status_code=404,
                detail=f"No education package found for patient {patient_id}"
            )
        doc.pop("_id", None)
        return doc
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to fetch education for patient {patient_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/patient-education/health")
async def education_health():
    return {
        "status": "ok",
        "version": "1.0.0",
        "agents": 5,
        "workflow_compiled": education_workflow is not None,
        "agent_pipeline": [
            "E1 — MedicationEducation  : how/when/what to eat for each drug",
            "E2 — DoseSchedule         : daily timetable + phone alarm guide",
            "E3 — FollowUpGuidance     : appointments, tests, warning signs",
            "E4 — DosDonts             : diet, activity, lifestyle rules",
            "E5 — NarrativePackage     : final patient-readable document (llm_synthesis)",
        ],
        "supported_languages":    "Any — pass language= in request",
        "supported_reading_levels": ["simple", "intermediate", "advanced"],
        "data_sources": [
            "documentation-treatment-plan",
            "documentation-medication-analysis",
            "documentation-clinical-notes",
            "documentation-investigation-notes",
            "documentation-treatment-summary",
        ],
        "output_collection": "patient_education",
    }