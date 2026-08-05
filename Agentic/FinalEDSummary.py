"""
EDFS — Emergency Department Final Summary System  (v8 — Case-Type Aware +
                                                    Shared Deterministic Triage)
====================================================================================
3-Agent Autonomous ED Summary Generator
LOCKED 25-SECTION OUTPUT STRUCTURE — UNCHANGED (v8 changes are internal logic
and top-level API response fields only; no section keys were added, removed,
or renamed)

WHAT CHANGED IN v8 (case-type-aware fix, ported patterns from EIDIS v3.1 /
EVIS v4.2)
---------------------------------------------------------------------------
ROOT-CAUSE BUG (same class of bug fixed in EIDIS v3.1): section_23_sbar_summary
was built in post_process_fill with HARDCODED trauma/RTA content —
"suspected head trauma and multiple abrasions", "Risk of ongoing haemorrhage,
spinal cord injury, and neurological deterioration", "Activate Full Trauma
Team", "Expedite CT Head, CT Chest, CT Abdomen-Pelvis" — injected whenever a
doctor note was present, REGARDLESS of what the patient actually presented
with. A cardiac patient with a doctor note got an RTA/polytrauma SBAR.
Additionally, all three documentation pipelines (EIDIS, EDFS, Structured
Note) independently derived triage colour with no shared logic, so the same
patient could get three different triage colours across the three
documents.

Fixed by:
  1. NEW `classify_case_type()` — a fast-model LLM call (EIDIS I0 / EVIS
     A0-style) that reads the unified chronological timeline ONCE, BEFORE
     A1 runs, and produces `is_trauma` / `case_type` / `routing_rationale`.
     These are threaded into EDFSState and into every A1/A2/A3 prompt, and
     into post_process_fill.
  2. Section 23 SBAR (situation/assessment/recommendation) is now built
     entirely from THIS patient's actual documented data — working
     diagnosis, differential diagnoses, specialist alerts, suggested
     investigations, chief complaint, and (only when is_trauma is true)
     mechanism of injury and suspected injuries. No second hardcoded
     medical-panel string was substituted in its place; when a data point
     isn't available the corresponding clause is simply omitted rather
     than guessed.
  3. FIX L (PREDICT-HF clinical-irrelevance note) now uses the classifier's
     `is_trauma` directly instead of solely re-deriving it from a mechanism
     keyword match (keyword match is retained ONLY as a fallback when
     classification is unavailable).
  4. Guardrail patterns ported from EVIS v4.2 / EIDIS v3.1 —
     `STABILITY_LABELING_RULE`, `DIAGNOSTIC_HEDGING_RULE`,
     `EVIDENCE_TRACEABILITY_RULE` — are now injected into A1, A2, and A3
     prompts.
  5. NEW `compute_triage_colour()` — ported BYTE-FOR-BYTE from EIDIS
     v3.1's shared deterministic triage function (same signature, same
     logic: reasons purely from physiological derangement — HR, RR, SpO2,
     BP, GCS, consciousness, shock/respiratory-failure/chest-life-threat
     flags, doctor-stated severity, arrest/deceased flag — never from
     injury mechanism). This REPLACES the LLM-suggested value in
     `section_10_triage_information.triage_colour` (same key, same
     schema — the value is now deterministic rather than LLM-guessed).
     The LLM's own suggestion (from A2's `ed_assessment.triage.colour`,
     produced before the override) is preserved only in the top-level API
     response as `triage_colour_llm_suggested`, never inside the locked
     25-section object, so the locked schema is genuinely unchanged.
     NOTE: this is the same candidate-for-shared-module function as in
     EIDIS — once a real shared module exists, both pipelines (and the
     Structured Note pipeline) should import the identical function
     instead of each keeping a synchronized copy.

UNCHANGED FROM v7
-----------------
FIX M   SpO₂ always populated (vitals_timeline key fix + raw-OCR fallback)
FIX N   C_circulation "Stable" also corrected (not just "Unstable")
FIX O   SBAR uses registration age, not monitor OCR age (still true in v8 —
        the section_23 rebuild in v8 still uses reg_age/reg_gender only)
FIX P   Section 13 skin_findings vs monitor_clinical_data separation
FIX Q   Section 18 only real specialist referrals; physician_alert → section 21
FIX R   Section 17 overall_trend guard dedupes IMAGE_EXTRACTED_VITALS only
FIX S   Section 7 ai_generated_summary uses SBAR situation, not image AI impression
ROOT CAUSE FIX  APPROVE_IMAGE_DB_NAME default = "doctorassist"
FIX G   SpO₂ _is_null_value() guard
FIX H   Pump data loop per-pump check + total_fluid_infused_ml
FIX I   Haemodynamic status "Unknown" prompt + post-process guard
FIX J   overall_trend "Unknown" prompt + post-process guard (superseded by FIX R)
FIX K   Age/gender discrepancy detection and flagging
FIX A   Section 20 condition_at_disposition always overwritten
FIX B   doctor_voice_notes naive-UTC normalised
F11     Section 11 D_disability / AVPU hedge
F2      Section 17 always rebuilt
F3      Section 19 always rebuilt
F4      Section 23 SBAR recommendation always in-hospital
F5      Section 10 triage_rationale appends doctor note
F7      Section 20 condition_at_disposition from doctor note
F8      Section 21 narrative appended with doctor note
F9      Section 22 handover critical_points includes doctor note
F10     approved_image_suggestion_count always accurate

TEMPORAL PRECEDENCE RULE (unchanged)
--------------------------------------
Doctor voice note > Approved AI suggestion > Image extraction >
NOT_APPROVED EMT dictation > Earlier EMT voice note
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, TypedDict

from fastapi import APIRouter, HTTPException
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel
from Agentic.clinical_shared.triage import (
    compute_triage_colour, first_int, parse_bp_systolic, fetch_authoritative_triage,
)
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import StateGraph, END


# ============================================================
# ENVIRONMENT & CONNECTIONS
# ============================================================

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
MONGO_URI    = os.getenv("MONGO_URI")

MONGO_DB = "doctorassistai"

# ROOT CAUSE FIX (v6): ApproveImageSuggestion lives in "doctorassist"
APPROVE_IMAGE_DB_NAME = os.getenv("APPROVE_IMAGE_DB_NAME", "doctorassist")

mongo_client     = AsyncIOMotorClient(MONGO_URI)
mongo_db         = mongo_client[MONGO_DB]
approve_image_db = mongo_client[APPROVE_IMAGE_DB_NAME]

emergency_patients_collection        = mongo_db["patients"]
voice_dictations_collection          = mongo_db["voice_dictations"]
clinical_actions_collection          = mongo_db["clinical_actions"]
doctor_voice_notes_collection        = mongo_db["doctor_voice_notes"]
image_extracted_ambulance_collection = mongo_db["Image_Extracted_Ambulance"]
doctor_suggestion_collection         = mongo_db["Doctor_Suggestion_Ambulance"]
approve_image_suggestion_collection  = approve_image_db["ApproveImageSuggestion"]
ed_summaries_collection              = mongo_db["ed_final_summaries"]
patient_triage_status_collection     = mongo_db["patient_triage_status"]
llm_fast = ChatGroq(
    model        = "llama-3.1-8b-instant",
    temperature  = 0.1,
    max_tokens   = 4000,
    groq_api_key = GROQ_API_KEY,
)

llm_synthesis = ChatGroq(
    model        = "llama-3.3-70b-versatile",
    temperature  = 0.1,
    max_tokens   = 8000,
    groq_api_key = GROQ_API_KEY,
)

router = APIRouter(prefix="", tags=["ED Final Summary"])


# ============================================================
# MODELS
# ============================================================

class EDFSRequest(BaseModel):
    patient_id:       str
    include_raw_data: bool = False


# ============================================================
# STATE
# ============================================================

class EDFSState(TypedDict):
    patient_id:                  str
    patient_record:              Optional[Dict]
    voice_dictations:            List[Dict]
    clinical_actions:            List[Dict]
    doctor_voice_notes:          List[Dict]
    image_extractions:           List[Dict]
    doctor_suggestions:          List[Dict]
    approved_image_suggestions:  List[Dict]
    unified_timeline:            List[Dict]
    current_status_snapshot:     Optional[Dict]

    # NEW v8 — case-type classification (I0-style), computed BEFORE the
    # graph runs and threaded into every agent prompt + post_process_fill.
    is_trauma:                   Optional[bool]
    case_type:                   Optional[str]
    routing_rationale:           Optional[str]

    clinical_extraction:         Optional[Dict]
    ed_assessment:                Optional[Dict]
    final_summary:                Optional[Dict]
    errors:                      List[str]
    agent_timings:                Dict[str, float]


# ============================================================
# HELPERS
# ============================================================

def parse_llm_json(text: str) -> Dict:
    if not text:
        return {}
    text = text.strip()
    text = re.sub(r"```json", "", text)
    text = re.sub(r"```",     "", text)
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        text = match.group(0)
    try:
        return json.loads(text)
    except Exception:
        return {"raw_output": text}


def serialize_doc(doc: Dict) -> Dict:
    out = {}
    for k, v in doc.items():
        if hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        elif isinstance(v, dict):
            out[k] = serialize_doc(v)
        elif isinstance(v, list):
            out[k] = [serialize_doc(i) if isinstance(i, dict) else i for i in v]
        else:
            out[k] = v
    return out


def _is_null_value(val) -> bool:
    """Return True if a value should be treated as absent/null."""
    if val is None:
        return True
    if isinstance(val, str) and val.strip().lower() in ("", "null", "none", "n/a"):
        return True
    return False


def _to_dt(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str) and value:
        v = value.replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(v)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except Exception:
            for fmt in (
                "%Y-%m-%d %H:%M:%S",
                "%Y-%m-%dT%H:%M:%S",
                "%d %b %Y, %I:%M:%S %p",
            ):
                try:
                    return datetime.strptime(v, fmt).replace(tzinfo=timezone.utc)
                except Exception:
                    continue
    return datetime(1970, 1, 1, tzinfo=timezone.utc)


def _normalize_naive_utc(ts_str: str) -> str:
    """Normalise a naive-UTC timestamp string to an explicit +00:00 offset."""
    if not ts_str or not isinstance(ts_str, str):
        return ts_str
    s = ts_str.strip()
    if not s:
        return s
    if s.endswith("Z"):
        return s
    if re.search(r"[+-]\d{2}:\d{2}$", s):
        return s
    return s + "+00:00"


def _ist_label(ts_str: str) -> str:
    if not ts_str:
        return "unknown time"
    dt  = _to_dt(ts_str)
    ist = dt + timedelta(hours=5, minutes=30)
    return ist.strftime("%d %b %Y %H:%M IST")


# ============================================================
# NEW v8 — small numeric-parsing helpers used only by the
# deterministic triage colour computation below (vitals in EDFS
# are loosely-typed display strings, e.g. "128/84", "97", so these
# extract the first usable integer rather than assuming clean ints).
# ============================================================



# ============================================================
# SHARED DETERMINISTIC TRIAGE COLOUR FUNCTION  (v8 — ported from
# EIDIS v3.1's compute_triage_colour(), byte-for-byte identical
# logic)
# ------------------------------------------------------------
# CANDIDATE FOR EXTRACTION: once EIDIS, EDFS, and the Structured
# Note pipeline can all import a shared module, this exact function
# should be moved there so triage colour can never diverge between
# the three documents for the same patient. Until that module
# exists, this is a self-contained, deterministic copy kept in sync
# with EIDIS's copy — it does NOT call an LLM and always returns
# the same colour for the same inputs, unlike the previous ad hoc
# triage_colour taken straight from the A2 LLM's free-text
# assessment (which is now kept only as a secondary cross-reference
# at the top level of the API response, not the authoritative
# value used inside the locked 25-section schema).
# ============================================================


# ============================================================
# FIX M HELPER — extract vitals from raw OCR text
# Used as fallback when vitals_timeline dict keys are missing
# ============================================================

def _extract_vitals_from_raw_text(raw_text: str) -> Dict:
    """
    Parse vital signs from OCR extracted_text string.
    Returns dict with keys matching vital_key_map dst_keys.
    Only extracts values that are clearly present.
    """
    vitals: Dict = {}
    if not raw_text:
        return vitals

    # SpO₂  — looks like "99 %" or "99%" or "SpO2: 99"
    spo2_match = re.search(r"(\d{2,3})\s*%", raw_text)
    if spo2_match:
        val = spo2_match.group(1)
        try:
            if 50 <= int(val) <= 100:
                vitals["spo2_percent"] = val
        except ValueError:
            pass

    # Blood pressure — "125/84" or "125/84 mmHg"
    bp_match = re.search(r"(\d{2,3}/\d{2,3})\s*(?:mmHg)?", raw_text)
    if bp_match:
        vitals["blood_pressure"] = bp_match.group(1)

    # Temperature — "36.6°C" or "36.6 C"
    temp_match = re.search(r"(\d{2,3}(?:\.\d)?)\s*°?\s*C\b", raw_text)
    if temp_match:
        try:
            t = float(temp_match.group(1))
            if 30.0 <= t <= 43.0:
                vitals["temperature_celsius"] = temp_match.group(1)
        except ValueError:
            pass

    # Heart rate — look for standalone bpm values, avoid matching BP systolic
    hr_match = re.search(
        r"(?:HR|Heart Rate|Pulse)[:\s]+(\d{2,3})\s*(?:bpm)?",
        raw_text, re.IGNORECASE
    )
    if hr_match:
        vitals["pulse_rate_bpm"] = hr_match.group(1)

    # Respiratory rate
    rr_match = re.search(
        r"(?:RR|Resp(?:iratory)?\s*Rate)[:\s]+(\d{1,3})\s*(?:bpm)?",
        raw_text, re.IGNORECASE
    )
    if rr_match:
        vitals["respiratory_rate_bpm"] = rr_match.group(1)

    return vitals


# ============================================================
# FIX K HELPER — extract age/gender from vitals_timeline raw text
# ============================================================

def _extract_age_gender_from_raw_text(raw_text: str):
    """
    Parse age and gender from OCR text like "62 yrs / M" or "62yrs / M".
    Returns (age_str, gender_str) or (None, None) if not found.
    """
    if not raw_text:
        return None, None
    age_match = re.search(r"(\d{1,3})\s*yrs?\s*/?\s*(M|F|Male|Female)", raw_text, re.IGNORECASE)
    if age_match:
        age_str    = age_match.group(1)
        gender_raw = age_match.group(2).strip().upper()
        gender_str = "Male" if gender_raw in ("M", "MALE") else "Female"
        return age_str, gender_str
    return None, None


class BaseAgent:
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
# GUARDRAIL RULES — ported (in spirit, adapted to ED-summary
# wording) from EVIS v4.2 / EIDIS v3.1's STABILITY_LABELING_RULE /
# DIAGNOSTIC_HEDGING_RULE / EVIDENCE_TRACEABILITY_RULE. Injected
# into A1, A2, and A3 prompts so EDFS never contradicts EVIS's/
# EIDIS's clinical reasoning conventions — and, specifically for
# this bugfix, so no agent invents case-type-mismatched clinical
# content.
# ============================================================

STABILITY_LABELING_RULE = """
CRITICAL — DO NOT MISLABEL PATIENT STATUS AS "STABLE":
Only describe a patient as "Stable" if the vitals and clinical picture are
actually within/near-normal ranges AND no ongoing organ-supportive
intervention (NIV/CPAP/BiPAP, oxygen beyond minimal supplementation,
vasoactive drugs, etc.) is required to keep them that way.
If a parameter improved only BECAUSE of an active ongoing intervention, or
other vitals remain deranged (tachypnea, tachycardia, severe hypertension/
hypotension, increased work of breathing), use language such as "improved
after intervention but still critically ill / requires close monitoring" —
never plain "Stable". Always state which parameters improved, which remain
abnormal, and why ongoing monitoring is still required.
"""

DIAGNOSTIC_HEDGING_RULE = """
CRITICAL — NEVER PRESENT A SUSPECTED CONDITION AS A CONFIRMED DIAGNOSIS:
You are producing ED clinical documentation; you do not issue a diagnosis on
the patient's behalf. Any diagnostic label not explicitly documented by a
clinician in the input timeline MUST be phrased as "suspected" / "possible"
(e.g. "suspected acute myocardial infarction", "possible haemothorax") and
must be explicitly linked to the supporting findings it is based on. Never
state a diagnosis as confirmed unless the input timeline explicitly says a
clinician has already diagnosed it. This applies equally to trauma and
non-trauma (cardiac, neurological, toxicological, obstetric, infectious)
cases — do NOT default to a trauma-pattern diagnosis just because that is a
common example in training data; ground every diagnosis in THIS patient's
documented data and its case_type/is_trauma classification.
"""

EVIDENCE_TRACEABILITY_RULE = """
CRITICAL — EVERY STATEMENT MUST BE TRACEABLE TO THE INPUT:
Do not add any diagnosis, injury, mechanism, medication, investigation, or
intervention that is not directly supported by the clinical input (EMT
voice dictations, doctor voice notes, image-extracted vitals, clinical
actions, approved image analyses, or the unified chronological timeline).
In particular:
  - Do NOT invent trauma-specific content (e.g. mechanism of injury, spinal
    precautions, specific injuries, cervical immobilization) for a case
    classified is_trauma=false, and do NOT invent cardiac/medical content
    for a case classified is_trauma=true, unless the actual data genuinely
    supports it.
  - If a data point needed for full confidence is missing or ambiguous, say
    so explicitly (e.g. in a data_gaps / limiting_factors / outstanding_
    issues field) rather than guessing or defaulting to a stock example
    from a different case type.
  - Every entry in working_diagnosis, differential_diagnoses,
    specialist_alerts, and investigations_ordered must correspond to
    something actually observed, reported, or performed for THIS patient.
"""


# ============================================================
# UNIFIED CHRONOLOGICAL TIMELINE
# ============================================================

def build_unified_timeline(
    voice_dictations:           List[Dict],
    clinical_actions:           List[Dict],
    doctor_voice_notes:         List[Dict],
    image_extractions:          List[Dict],
    doctor_suggestions:         List[Dict],
    approved_image_suggestions: List[Dict],
) -> List[Dict]:
    timeline: List[Dict] = []

    for d in voice_dictations:
        timeline.append({
            "source":    "EMT_VOICE_NOTE",
            "timestamp": d.get("timestamp") or d.get("date_time") or "",
            "content":   (d.get("conversation") or "").strip(),
        })

    for n in doctor_voice_notes:
        raw_ts = n.get("timestamp") or ""
        timeline.append({
            "source":    "DOCTOR_VOICE_NOTE",
            "timestamp": _normalize_naive_utc(raw_ts),
            "content":   (n.get("conversation") or "").strip(),
        })

    for a in clinical_actions:
        ts = (
            a.get("server_received_ist")
            or a.get("client_created_at")
            or a.get("server_received_at")
            or ""
        )
        action_type = (a.get("action_type") or "unknown").upper()
        timeline.append({
            "source":    f"AI_SUGGESTION_{action_type}",
            "timestamp": ts,
            "approved":  action_type == "APPROVED",
            "content": {
                "action_type":     action_type,
                "voice_dictation": a.get("voice_dictation") or "",
                "ai_suggestion":   a.get("ai_suggestion"),
            },
        })

    for img in image_extractions:
        timeline.append({
            "source":    "IMAGE_EXTRACTED_VITALS",
            "timestamp": img.get("image_timestamp_iso") or img.get("timestamp") or "",
            "content":   img.get("extracted_text") or "",
        })

    for s in doctor_suggestions:
        timeline.append({
            "source":    "DOCTOR_SUGGESTION",
            "timestamp": s.get("timestamp_iso") or s.get("timestamp") or "",
            "content":   s.get("suggestion_text") or "",
        })

    for ap in approved_image_suggestions:
        ts = (
            ap.get("approved_at")
            or ap.get("approved_at_display")
            or ap.get("timestamp")
            or ""
        )
        timeline.append({
            "source":    "APPROVED_IMAGE_ANALYSIS",
            "timestamp": ts,
            "content": {
                "ai_impression":       ap.get("ai_impression"),
                "impressive_findings": ap.get("impressive_findings"),
                "comorbidities":       ap.get("comorbidities"),
                "trend_analysis":      ap.get("trend_analysis"),
                "risk_level":          ap.get("risk_level"),
                "emt_actions":         ap.get("emt_actions"),
                "physician_alert":     ap.get("physician_alert"),
                "vitals_timeline":     ap.get("vitals_timeline"),
                "trends":              ap.get("trends"),
            },
        })

    timeline.sort(key=lambda e: _to_dt(e.get("timestamp", "")))
    return timeline


def get_current_status_snapshot(unified_timeline: List[Dict]) -> Optional[Dict]:
    return unified_timeline[-1] if unified_timeline else None


def _build_progression_narrative(unified_timeline: List[Dict]) -> List[str]:
    lines = []
    for entry in unified_timeline:
        source  = entry.get("source", "UNKNOWN")
        ts      = entry.get("timestamp", "")
        label   = _ist_label(ts)
        content = entry.get("content")

        if source == "EMT_VOICE_NOTE":
            text = str(content)[:400] if content else "(no content)"
            lines.append(f"[{label}] EMT Voice Note: {text}")

        elif source == "DOCTOR_VOICE_NOTE":
            text = str(content)[:400] if content else "(no content)"
            lines.append(f"[{label}] DOCTOR NOTE (authoritative): {text}")

        elif source.startswith("AI_SUGGESTION_"):
            approved_label = "APPROVED" if "APPROVED" in source else "NOT_APPROVED (rejected by doctor)"
            vd = ""
            if isinstance(content, dict):
                vd = content.get("voice_dictation") or ""
            if vd:
                lines.append(f"[{label}] AI Suggestion ({approved_label}) — EMT dictation: {str(vd)[:300]}")
            else:
                lines.append(f"[{label}] AI Suggestion ({approved_label}) — no inline dictation text")

        elif source == "IMAGE_EXTRACTED_VITALS":
            text = str(content)[:300] if content else "(no content)"
            lines.append(f"[{label}] Monitor Image Extraction: {text}")

        elif source == "APPROVED_IMAGE_ANALYSIS":
            if isinstance(content, dict):
                imp  = content.get("ai_impression") or ""
                risk = content.get("risk_level") or ""
                lines.append(
                    f"[{label}] Approved Image AI Analysis — Impression: {imp[:200]} | Risk: {risk}"
                )
            else:
                lines.append(f"[{label}] Approved Image AI Analysis: {str(content)[:300]}")

        elif source == "DOCTOR_SUGGESTION":
            text = str(content)[:300] if content else "(no content)"
            lines.append(f"[{label}] Doctor Free-text Suggestion: {text}")

        else:
            lines.append(f"[{label}] {source}: {str(content)[:200]}")

    return lines


# ============================================================
# CASE-TYPE CLASSIFIER  (v8 — NEW, EIDIS I0 / EVIS A0-style)
# ------------------------------------------------------------
# Runs BEFORE the LangGraph (before A1), off the unified
# chronological timeline narrative alone, using the fast model.
# Every downstream agent prompt (A1/A2/A3) and post_process_fill
# sees the same, single, authoritative case_type/is_trauma
# classification — this is what allows the hardcoded trauma/RTA
# fallback content in section_23 to be replaced with data-driven,
# case-type-gated content instead.
# ============================================================

async def classify_case_type(narrative: str) -> Dict[str, Any]:
    system = (
        "You are a triage classification assistant for an emergency department "
        "documentation pipeline. Your ONLY job is to read the clinical narrative and "
        "decide whether this is a TRAUMA case or a non-trauma MEDICAL case, and give it a "
        "short case_type label. You do NOT diagnose or treat. Be conservative: if trauma is "
        "even plausibly implied (fall, RTA, assault, blunt/penetrating mechanism, visible "
        "wound, fracture, bleeding from injury), mark is_trauma=true. If the presentation is "
        "purely medical (chest pain, breathing difficulty, seizure, fever, stroke-like "
        "symptoms, cardiac event, poisoning, allergic reaction, obstetric emergency) with NO "
        "injury mechanism, mark is_trauma=false. Always respond with valid JSON only."
    )
    prompt = f"""
Classify this emergency case from the clinical narrative below.

CLINICAL NARRATIVE:
\"\"\"{narrative}\"\"\"

Decide:
1. is_trauma — true if any mechanism of injury (fall, RTA, assault,
   blunt/penetrating trauma, burn, visible wound/fracture/bleeding from an
   injury) is stated or implied. false for purely medical presentations
   (chest pain, breathing difficulty, seizure, syncope, poisoning, allergic
   reaction, fever, stroke-like symptoms, cardiac arrest/arrhythmia,
   obstetric emergency) with no injury mechanism.
2. case_type — short label: "trauma" | "cardiac" | "cardiorespiratory" |
   "neurological" | "toxicology" | "obstetric" | "infectious_sepsis" |
   "general_medical" | "unknown"

Return ONLY valid JSON:
{{
  "is_trauma": true,
  "case_type": "...",
  "rationale": "one sentence explaining the decision"
}}
"""
    parsed: Dict[str, Any] = {}
    try:
        response = await llm_fast.ainvoke([
            SystemMessage(content=system), HumanMessage(content=prompt)
        ])
        parsed = parse_llm_json(response.content)
    except Exception as e:
        logger.error(f"[EDFS I0] Case-type classification failed: {e}")

    # Safest fallback (mirrors EIDIS I0 / EVIS A0's philosophy): if
    # classification fails to parse, default is_trauma=True so
    # trauma-appropriate caution is not silently dropped — but case_type
    # stays "unknown" rather than inventing a specific mechanism.
    is_trauma = bool(parsed.get("is_trauma", True))
    case_type = parsed.get("case_type", "unknown")
    rationale = parsed.get("rationale") or "Classification unavailable — defaulted to trauma-cautious mode."

    logger.info(f"[EDFS I0] case_type={case_type} is_trauma={is_trauma} | {rationale}")
    return {"is_trauma": is_trauma, "case_type": case_type, "routing_rationale": rationale}


# ============================================================
# A1 · CLINICAL DATA EXTRACTOR
# ============================================================

class ClinicalDataExtractorAgent(BaseAgent):
    agent_id = "A1"

    async def run(self, state: EDFSState) -> EDFSState:
        logger.info(f"{self.agent_id} · ClinicalDataExtractor — START")
        t0 = datetime.now().timestamp()

        patient   = state["patient_record"] or {}
        dicts_    = state["voice_dictations"]
        actions   = state["clinical_actions"]
        doc_notes = state["doctor_voice_notes"]
        img_ext   = state["image_extractions"]
        doc_sugg  = state["doctor_suggestions"]
        appr_img  = state["approved_image_suggestions"]
        timeline  = state["unified_timeline"]
        current   = state["current_status_snapshot"] or {}
        case_type = state.get("case_type")
        is_trauma = state.get("is_trauma")

        approved = [a for a in actions if a.get("action_type") == "approved"]
        rejected = [a for a in actions if a.get("action_type") == "not_approved"]

        voice_parts = ["=== EMT VOICE DICTATION TIMELINE (Chronological) ===\n"]
        for idx, d in enumerate(dicts_, 1):
            voice_parts.append(
                f"[NOTE {idx} | {d.get('date','')} {d.get('time','')} | TS: {d.get('timestamp','')}]\n"
                f"{d.get('conversation','').strip()}\n"
            )
        voice_timeline = "\n".join(voice_parts) if dicts_ else "No EMT voice dictations recorded."

        doc_note_parts = ["=== DOCTOR VOICE NOTE TIMELINE (Chronological) ===\n"]
        for idx, n in enumerate(doc_notes, 1):
            doc_note_parts.append(
                f"[DOCTOR NOTE {idx} | {n.get('date','')} {n.get('time','')} | "
                f"TS: {n.get('timestamp','')}]\n"
                f"{(n.get('conversation') or '').strip()}\n"
            )
        doctor_voice_timeline = (
            "\n".join(doc_note_parts) if doc_notes else "No doctor voice notes recorded."
        )

        img_parts = ["=== IMAGE-EXTRACTED CLINICAL TEXT (Chronological) ===\n"]
        for idx, img in enumerate(img_ext, 1):
            img_parts.append(
                f"[IMAGE EXTRACTION {idx} | TS: {img.get('timestamp','')}]\n"
                f"{(img.get('extracted_text') or '').strip()}\n"
            )
        image_extraction_text = (
            "\n".join(img_parts) if img_ext else "No image-extracted clinical data recorded."
        )

        progression_lines = _build_progression_narrative(timeline)
        progression_text  = "\n".join(progression_lines) if progression_lines else "No entries."
        current_json      = json.dumps(current, indent=2, default=str)

        system = (
            "You are a senior emergency physician extracting every available clinical fact "
            "from ALL connected data sources. "
            "CRITICAL RULE: populate every field from the data. null only if genuinely absent. "
            "TEMPORAL PRECEDENCE: the LATEST record in the unified timeline is the CURRENT "
            "authoritative patient status. NOT_APPROVED actions contain EMT observations that "
            "the doctor rejected — include them in the progression narrative but do NOT use "
            "them as the current clinical status. "
            "The DOCTOR VOICE NOTE is the most authoritative non-AI source. "
            "IMPORTANT: Use REGISTRATION data for patient age and gender, NOT monitor OCR data. "
            "When multiple medications are mentioned in a single sentence or note, extract EACH "
            "one as a separate item — never merge two drug names into one string or drop any of "
            "them. "
            f"CASE CLASSIFICATION (pre-computed — use as ground truth, do not re-derive): "
            f"case_type={case_type!r}, is_trauma={is_trauma!r}. Do not add trauma-specific "
            "findings (mechanism, injuries, spinal precautions) for a case classified "
            "is_trauma=false, and do not add cardiac/medical findings for is_trauma=true, "
            "unless the actual source data documents them. "
            "Never fabricate. Return valid JSON only."
        ) + EVIDENCE_TRACEABILITY_RULE

        prompt = f"""
Extract ALL clinical data for patient: {state["patient_id"]}.
CASE TYPE (pre-classified): case_type={case_type} | is_trauma={is_trauma}

━━━ SOURCE 1 — PATIENT REGISTRATION (demographics only — USE THIS for age/gender)
{json.dumps(patient, indent=2, default=str)}

━━━ SOURCE 2 — EMT VOICE DICTATIONS ({len(dicts_)} notes)
{voice_timeline}

━━━ SOURCE 3 — DOCTOR VOICE NOTES ({len(doc_notes)} notes)
{doctor_voice_timeline}

━━━ SOURCE 4 — IMAGE-EXTRACTED CLINICAL DATA ({len(img_ext)} extractions)
{image_extraction_text}

━━━ SOURCE 5 — DOCTOR FREE-TEXT SUGGESTIONS ({len(doc_sugg)})
{json.dumps(doc_sugg, indent=2, default=str)}

━━━ SOURCE 6 — APPROVED IMAGE AI ANALYSES ({len(appr_img)})
{json.dumps(appr_img, indent=2, default=str)}

━━━ SOURCE 7A — APPROVED AI SUGGESTIONS ({len(approved)})
{json.dumps(approved, indent=2, default=str)}

━━━ SOURCE 7B — REJECTED AI SUGGESTIONS ({len(rejected)})
{json.dumps(rejected, indent=2, default=str)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FULL CHRONOLOGICAL PROGRESSION — EVERY ENTRY, OLDEST → NEWEST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{progression_text}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CURRENT PATIENT STATUS — LATEST RECORD (authoritative)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{current_json}

TASK: Return ONLY valid JSON matching this exact structure:
{{
  "patient_information": {{
    "patient_id": "{state["patient_id"]}",
    "full_name": null,
    "age": null,
    "gender": null,
    "phone_number": null,
    "address": null,
    "emergency_contact": {{"name": null, "relationship": null, "phone": null}}
  }},
  "arrival_details": {{
    "mode_of_arrival": null,
    "registration_date": null,
    "registration_time": null,
    "referral_source": null,
    "ambulance_driver_name": null,
    "ambulance_driver_id": null
  }},
  "incident_details": {{
    "type_of_incident": null,
    "mechanism_of_injury": null,
    "location_of_incident": null,
    "latitude": null,
    "longitude": null,
    "date_of_incident": null,
    "time_of_incident": null,
    "condition_at_scene": null
  }},
  "chief_complaint": null,
  "emt_pre_hospital_report": {{
    "scene_findings": null,
    "consciousness_on_scene": null,
    "airway_status": null,
    "breathing_status": null,
    "circulation_status": null,
    "vitals_on_scene": {{
      "pulse_rate_bpm": null,
      "blood_pressure": null,
      "spo2_percent": null,
      "respiratory_rate_bpm": null,
      "gcs_estimated": null
    }},
    "bleeding_status": null,
    "pre_hospital_interventions": [],
    "time_at_scene_minutes": null,
    "eta_to_hospital_minutes": null,
    "combined_emt_narrative": null
  }},
  "voice_note_summary": {{
    "total_notes": {len(dicts_)},
    "first_note_timestamp": null,
    "last_note_timestamp": null,
    "clinical_findings_across_notes": [],
    "progression_signals_from_voice": []
  }},
  "visible_injuries": [],
  "known_medical_history": {{
    "diabetes": null,
    "hypertension": null,
    "cardiac": null,
    "allergies": null,
    "current_medications": [],
    "other_conditions": []
  }},
  "clinical_actions_summary": {{
    "total_actions": {len(actions)},
    "approved_count": {len(approved)},
    "rejected_count": {len(rejected)},
    "latest_approved_content": null,
    "latest_approved_timestamp": null,
    "doctor_modifications_or_notes": []
  }},
  "doctor_voice_notes_summary": {{
    "total_notes": {len(doc_notes)},
    "combined_doctor_narrative": null,
    "key_updates_from_doctor": []
  }},
  "image_based_clinical_findings": {{
    "total_image_extractions": {len(img_ext)},
    "vitals_from_images": [],
    "ai_impression_from_images": null,
    "risk_level_from_images": null,
    "physician_alerts_from_images": [],
    "trend_analysis_from_images": null
  }},
  "doctor_free_text_suggestions": [],
  "status_progression_analysis": {{
    "earliest_documented_status": null,
    "current_status": null,
    "progression_narrative": null,
    "status_changed_since_earliest": null
  }},
  "extraction_confidence": "High|Moderate|Low",
  "data_gaps": []
}}
"""
        state["clinical_extraction"] = await self._invoke(system, prompt)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A2 · ED ASSESSMENT & DIAGNOSIS AGENT
# ============================================================

class EDAssessmentAgent(BaseAgent):
    agent_id = "A2"

    async def run(self, state: EDFSState) -> EDFSState:
        logger.info(f"{self.agent_id} · EDAssessmentAgent — START")
        t0 = datetime.now().timestamp()

        actions  = state["clinical_actions"]
        approved = [a for a in actions if a.get("action_type") == "approved"]
        rejected = [a for a in actions if a.get("action_type") == "not_approved"]

        latest_approved = approved[-1] if approved else None
        current         = state["current_status_snapshot"] or {}
        case_type       = state.get("case_type")
        is_trauma       = state.get("is_trauma")

        progression_lines = _build_progression_narrative(state["unified_timeline"])
        progression_text  = "\n".join(progression_lines) if progression_lines else "No entries."

        system = (
            "You are a consultant emergency physician performing a complete ED clinical "
            "assessment using ATLS/ABCDE principles.\n"
            "CRITICAL — TEMPORAL PRECEDENCE: triage colour, ABCDE, shock, and disposition "
            "MUST be based on the CURRENT PATIENT STATUS (the latest record).\n"
            "The doctor voice note is more authoritative than any AI suggestion or EMT "
            "NOT_APPROVED dictation.\n"
            "\n"
            "PATIENT IDENTITY RULE: Always use REGISTRATION data for patient age and gender. "
            "OCR data from monitors may contain a different patient's demographics. "
            "Never use monitor OCR age/gender in any narrative or assessment field.\n"
            "\n"
            f"CASE CLASSIFICATION (pre-computed by an upstream classifier — use as ground "
            f"truth, do not re-derive): case_type={case_type!r}, is_trauma={is_trauma!r}. Do "
            "NOT invent trauma-specific ABCDE findings, injuries, or a trauma-pattern working "
            "diagnosis for a case classified is_trauma=false, and do NOT invent cardiac/"
            "medical findings for is_trauma=true, unless the actual data genuinely supports "
            "it. Still provide your own best-clinical-judgement triage.colour based purely on "
            "the physiological picture (this will be cross-checked against a deterministic "
            "rule downstream, not discarded).\n"
            "\n"
            "HAEMODYNAMIC STATUS RULE: Set haemodynamic_status to 'Unknown — requires "
            "reassessment' (NOT 'Stable' or 'Unstable') when the only available circulatory "
            "data is a single blood pressure reading and heart rate is absent. A single normal "
            "BP does not confirm haemodynamic stability, especially when the treating doctor "
            "has stated the patient is not stable. 'Stable' requires confirmed normal HR, BP, "
            "perfusion, and no active bleeding. 'Unstable' requires objective evidence. "
            "When in doubt with a doctor note of instability, use 'Unknown — requires "
            "reassessment'.\n"
            "\n"
            "CLINICAL TREND RULE: Set overall_trend to 'Unknown' (NOT 'Deteriorating') when "
            "there are no sequential vital sign measurements from different time points to show "
            "a direction of change. A single set of vital signs cannot establish a trend. "
            "Deteriorating requires evidence of worsening measured values over time.\n"
            "\n"
            "SKIN FINDINGS RULE: Only populate skin_findings from actual documented physical "
            "examination findings (abrasions, pallor, diaphoresis, rash, etc.). Do NOT put "
            "monitor data, pump readings, or vital sign summaries in skin_findings.\n"
            "\n"
            "Describe the full clinical progression — from first contact to current status — "
            "in the clinical_progression field, using 'earlier was X, currently Y' language.\n"
            "Do not return null if the data supports a value. Return valid JSON only."
        ) + STABILITY_LABELING_RULE + DIAGNOSTIC_HEDGING_RULE + EVIDENCE_TRACEABILITY_RULE

        prompt = f"""
Full ED clinical assessment for patient: {state["patient_id"]}.
CASE TYPE (pre-classified): case_type={case_type} | is_trauma={is_trauma}

━━━ A1 CLINICAL EXTRACTION
{json.dumps(state["clinical_extraction"], indent=2, default=str)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FULL CHRONOLOGICAL PROGRESSION — ALL SOURCES, OLDEST → NEWEST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{progression_text}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CURRENT PATIENT STATUS — LATEST RECORD (drives triage, ABCDE, disposition)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{json.dumps(current, indent=2, default=str)}

━━━ LATEST APPROVED AI SUGGESTION
{json.dumps(latest_approved, indent=2, default=str)}

━━━ ALL CLINICAL ACTIONS (Approved: {len(approved)} | Rejected: {len(rejected)})
{json.dumps(actions, indent=2, default=str)}

TASK: Populate every field. Return ONLY valid JSON:
{{
  "triage": {{
    "colour": "Red|Yellow|Green|Black",
    "category": "T1_Immediate|T2_Urgent|T3_Delayed|T4_Expectant",
    "criticality_score": null,
    "risk_level": "Low|Moderate|High|Critical|Immediately_Life_Threatening",
    "triage_rationale": null
  }},
  "abcde_assessment": {{
    "A_airway": {{
      "status": "Patent|Compromised|Maintained",
      "finding": null,
      "intervention_applied": null
    }},
    "B_breathing": {{
      "rate_bpm": null,
      "adequacy": "Adequate|Inadequate|Absent|Unknown",
      "finding": null,
      "intervention_applied": null
    }},
    "C_circulation": {{
      "pulse_rate_bpm": null,
      "blood_pressure": null,
      "haemodynamic_status": "Stable|Unstable|Critical|Unknown",
      "estimated_blood_loss_ml": null,
      "finding": null,
      "intervention_applied": null
    }},
    "D_disability": {{
      "gcs_total": null,
      "gcs_eye": null,
      "gcs_verbal": null,
      "gcs_motor": null,
      "avpu": "A|V|P|U|Unknown",
      "pupils": null,
      "finding": null,
      "intervention_applied": null
    }},
    "E_exposure": {{
      "major_injuries_found": [],
      "temperature_celsius": null,
      "finding": null,
      "intervention_applied": null
    }}
  }},
  "physical_examination": {{
    "head_and_face": null,
    "neck_and_cervical_spine": null,
    "chest_and_thorax": null,
    "abdomen": null,
    "pelvis": null,
    "spine": null,
    "upper_limbs": null,
    "lower_limbs": null,
    "wounds_and_bleeding": null,
    "skin_findings": null
  }},
  "shock_assessment": {{
    "shock_present": null,
    "type": "Haemorrhagic|Neurogenic|Obstructive|Distributive|None|Unknown",
    "stage": "Compensated|Decompensated|Irreversible|Unknown",
    "shock_index": null,
    "management_applied": null
  }},
  "emergency_interventions_performed": [
    {{
      "intervention": null,
      "time_performed": null,
      "response": null,
      "performed_by": "EMT|ED_Team|Both"
    }}
  ],
  "investigations_ordered": [
    {{
      "investigation": null,
      "type": "CT_Head|CT_Chest|CT_AP|CT_Whole_Body|XR_Chest|XR_Pelvis|FAST|Blood_Tests|ECG|Other",
      "priority": "Immediate|Urgent|Routine",
      "reason": null,
      "result_if_known": null
    }}
  ],
  "working_diagnosis": {{
    "primary_diagnosis": null,
    "secondary_diagnoses": [],
    "suspected_injuries": [],
    "differential_diagnoses": [],
    "diagnosis_confidence": "High|Moderate|Low"
  }},
  "clinical_progression": {{
    "overall_trend": "Stable|Improving|Deteriorating|Rapidly_Deteriorating|Fluctuating|Unknown",
    "initial_presentation_status": null,
    "current_status": null,
    "changes_over_dictation_timeline": [],
    "response_to_pre_hospital_interventions": null
  }},
  "specialist_alerts": [
    {{
      "specialty": null,
      "reason": null,
      "urgency": "Immediate|Urgent|Routine"
    }}
  ],
  "ed_clinical_course_summary": null,
  "final_disposition_recommendation": {{
    "disposition": "ICU_Admission|Surgery_OT|Ward_Transfer|Discharge|Referral|Death",
    "destination_unit": null,
    "urgency": "Immediate|Urgent|Routine",
    "rationale": null
  }},
  "doctor_review_status": {{
    "ai_suggestion_review": "Approved|Rejected|Modified|Pending",
    "approved_actions_count": {len(approved)},
    "rejected_actions_count": {len(rejected)},
    "summary_of_doctor_decisions": null
  }}
}}
"""
        state["ed_assessment"] = await self._invoke(system, prompt)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A3 · FINAL ED SUMMARY SYNTHESIZER
# LOCKED 25-section structure — unchanged.
# ============================================================

class FinalEDSummaryAgent(BaseAgent):
    agent_id = "A3"

    async def run(self, state: EDFSState) -> EDFSState:
        logger.info(f"{self.agent_id} · FinalEDSummaryAgent — START")
        t0 = datetime.now().timestamp()

        voice_transcripts = []
        for idx, d in enumerate(state["voice_dictations"], 1):
            voice_transcripts.append({
                "note_number": idx,
                "timestamp":   str(d.get("timestamp", "")),
                "date":        d.get("date", ""),
                "time":        d.get("time", ""),
                "transcript":  d.get("conversation", "").strip(),
            })

        actions  = state["clinical_actions"]
        approved = [a for a in actions if a.get("action_type") == "approved"]
        rejected = [a for a in actions if a.get("action_type") == "not_approved"]

        latest_approved = approved[-1] if approved else {}
        now_iso         = datetime.utcnow().isoformat()
        current         = state["current_status_snapshot"] or {}
        case_type       = state.get("case_type")
        is_trauma       = state.get("is_trauma")

        progression_lines = _build_progression_narrative(state["unified_timeline"])
        progression_text  = "\n".join(progression_lines) if progression_lines else "No entries."

        system = (
            "You are the ED Consultant generating the definitive Final Emergency Department "
            "Summary for a real hospital record. Every field must be populated from the data.\n"
            "CRITICAL RULES:\n"
            "1. NEVER return null if ANY source contains the data.\n"
            "2. Derive values when not explicitly stated (e.g. estimate GCS from consciousness "
            "description).\n"
            "3. The JSON structure MUST match the template exactly — 25 sections, same keys.\n"
            "4. TEMPORAL PRECEDENCE: sections describing CURRENT condition (10, 11, 17, 19, "
            "20, 21, 22, 23) MUST be based on the CURRENT PATIENT STATUS — the latest record.\n"
            "5. Section 17 MUST list every timeline entry, oldest to newest.\n"
            "6. Section 23 SBAR recommendation must reflect current IN-HOSPITAL management, "
            "NOT prehospital transport instructions.\n"
            "7. PATIENT IDENTITY: ALWAYS use registration age/gender in ALL narrative fields "
            "and the SBAR situation. The monitor may show a different patient's demographics "
            "due to OCR — never use monitor age/gender in any clinical text.\n"
            "8. HAEMODYNAMIC STATUS: set haemodynamic_status to 'Unknown — requires "
            "reassessment' when HR is absent AND doctor confirmed instability. Do NOT write "
            "'Stable' when a doctor note says the patient is not stable. Do NOT write "
            "'Unstable' without objective haemodynamic evidence.\n"
            "9. CLINICAL TREND: set overall_trend to 'Unknown' when no sequential vital sign "
            "measurements from different time points exist. Mechanism alone does not justify "
            "'Deteriorating'.\n"
            "10. SKIN FINDINGS: only document actual skin/surface examination findings here "
            "(e.g. abrasions, lacerations, pallor, diaphoresis). Never put monitor readings, "
            "pump data, or vital sign summaries in skin_findings.\n"
            "11. SECTION 7 ai_generated_summary: use the SBAR situation from the approved AI "
            "clinical suggestion. Do NOT use the image AI impression (which was generated from "
            "monitor data only and may contradict the overall triage).\n"
            "12. SECTION 18: only include actual specialist referrals with a named specialty. "
            "Do not include monitor data analysis or physician alerts as specialist alert entries.\n"
            "13. MEDICATIONS: medications_administered in section 14 MUST list every individual "
            "medication mentioned anywhere in the sources as its own array entry. If a doctor "
            "note or EMT note mentions two or more drugs together (e.g. 'gave paracetamol and "
            "tramadol'), both MUST appear as separate list items — never merge or drop one.\n"
            f"14. CASE CLASSIFICATION (pre-computed — use as ground truth, do not re-derive): "
            f"case_type={case_type!r}, is_trauma={is_trauma!r}. Do NOT invent trauma-specific "
            "content (mechanism, injuries, spinal precautions, trauma-team activation language) "
            "anywhere in this document for a case classified is_trauma=false, and do NOT invent "
            "cardiac/medical content for is_trauma=true, unless the actual source data "
            "genuinely supports it. Ground every diagnosis, differential, and recommendation in "
            "THIS patient's documented presentation.\n"
            "15. Return valid JSON only — no markdown fences, no extra text."
        ) + STABILITY_LABELING_RULE + DIAGNOSTIC_HEDGING_RULE + EVIDENCE_TRACEABILITY_RULE

        prompt = f"""
Generate the COMPLETE Final ED Summary for patient: {state["patient_id"]}.
CASE TYPE (pre-classified): case_type={case_type} | is_trauma={is_trauma}

━━━ A1 — CLINICAL EXTRACTION
{json.dumps(state["clinical_extraction"], indent=2, default=str)}

━━━ A2 — ED ASSESSMENT
{json.dumps(state["ed_assessment"], indent=2, default=str)}

━━━ EMT VOICE TRANSCRIPTS ({len(voice_transcripts)})
{json.dumps(voice_transcripts, indent=2, default=str)}

━━━ DOCTOR VOICE NOTES ({len(state["doctor_voice_notes"])})
{json.dumps(state["doctor_voice_notes"], indent=2, default=str)}

━━━ IMAGE-EXTRACTED CLINICAL DATA ({len(state["image_extractions"])})
{json.dumps(state["image_extractions"], indent=2, default=str)}

━━━ DOCTOR FREE-TEXT SUGGESTIONS ({len(state["doctor_suggestions"])})
{json.dumps(state["doctor_suggestions"], indent=2, default=str)}

━━━ APPROVED IMAGE AI ANALYSES ({len(state["approved_image_suggestions"])})
{json.dumps(state["approved_image_suggestions"], indent=2, default=str)}

━━━ APPROVED CLINICAL ACTIONS ({len(approved)})
{json.dumps(approved, indent=2, default=str)}

━━━ REJECTED CLINICAL ACTIONS ({len(rejected)})
{json.dumps(rejected, indent=2, default=str)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FULL CHRONOLOGICAL PROGRESSION — ALL SOURCES, OLDEST → NEWEST
(use EXACTLY these entries for section_17 dictation_by_dictation_progression)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{progression_text}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CURRENT PATIENT STATUS — LATEST RECORD (authoritative)
Use for sections 10, 11, 17 (current side), 19, 20, 21, 22, 23.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{json.dumps(current, indent=2, default=str)}

GENERATED AT: {now_iso}

Return ONLY this exact JSON structure populated with real data:

{{
  "section_1_patient_information": {{
    "patient_id": "{state["patient_id"]}",
    "full_name": null,
    "age": null,
    "gender": null,
    "phone_number": null,
    "address": null,
    "date_of_arrival": null,
    "time_of_arrival": null,
    "emergency_contact_name": null,
    "emergency_contact_relationship": null,
    "emergency_contact_phone": null
  }},
  "section_2_arrival_details": {{
    "mode_of_arrival": null,
    "emt_driver_name": null,
    "referral_source": null,
    "transport_duration_minutes": null,
    "arrival_clinical_condition": null
  }},
  "section_3_incident_details": {{
    "type_of_incident": null,
    "mechanism_of_injury": null,
    "location_of_incident": null,
    "coordinates": {{"latitude": null, "longitude": null}},
    "date_of_incident": null,
    "time_of_incident": null
  }},
  "section_4_chief_complaint": {{"chief_complaint": null}},
  "section_5_emt_pre_hospital_report": {{
    "scene_findings": null,
    "consciousness_level_on_scene": null,
    "airway": null,
    "breathing": null,
    "circulation": null,
    "vitals_on_scene": {{
      "pulse_rate_bpm": null, "blood_pressure": null,
      "spo2_percent": null, "respiratory_rate_bpm": null, "gcs_estimated": null
    }},
    "bleeding_status": null,
    "pre_hospital_interventions_performed": [],
    "time_at_scene_minutes": null,
    "eta_to_hospital_minutes": null,
    "clinical_narrative_from_emt": null
  }},
  "section_6_voice_note_processing": {{
    "total_voice_notes": {len(voice_transcripts)},
    "voice_notes": {json.dumps(voice_transcripts)},
    "ai_transcription_status": "Processed",
    "processing_quality": "High|Moderate|Low",
    "combined_clinical_summary_from_voice": null
  }},
  "section_7_ai_clinical_suggestion": {{
    "ai_generated_summary": null,
    "image_ai_impression": null,
    "image_ai_context_note": null,
    "key_clinical_recommendations": [],
    "triage_suggestion": null,
    "criticality_score_suggested": null,
    "suggested_immediate_interventions": [],
    "suggested_investigations": [],
    "suggested_specialist_alerts": [],
    "hospital_prep_instructions": null,
    "confidence_level": "High|Moderate|Low"
  }},
  "section_8_doctor_review_status": {{
    "ai_review_decision": "Approved|Rejected|Modified|Pending",
    "total_reviews_performed": {len(actions)},
    "approved_count": {len(approved)},
    "rejected_count": {len(rejected)},
    "review_timestamp": null,
    "reviewer_summary": null
  }},
  "section_9_doctor_manual_note": {{
    "manual_clinical_summary": null,
    "corrections_or_additions_to_ai": null,
    "additional_clinical_findings": null,
    "doctor_entered_at": null
  }},
  "section_10_triage_information": {{
    "triage_colour": "Red|Yellow|Green|Black",
    "triage_category": "T1_Immediate|T2_Urgent|T3_Delayed|T4_Expectant",
    "criticality_score": null,
    "risk_level": null,
    "triage_rationale": null,
    "triage_performed_at": null
  }},
  "section_11_initial_ed_assessment": {{
    "abcde_summary": {{
      "A_airway": null, "B_breathing": null, "C_circulation": null,
      "D_disability": null, "E_exposure": null
    }},
    "gcs_total": null,
    "gcs_breakdown": {{"eye": null, "verbal": null, "motor": null}},
    "avpu": null,
    "neurological_findings": null,
    "initial_vitals_in_ed": {{
      "pulse_rate_bpm": null, "blood_pressure": null,
      "spo2_percent": null, "respiratory_rate_bpm": null, "temperature_celsius": null
    }}
  }},
  "section_12_visible_injuries": {{"visible_injuries": []}},
  "section_13_physical_examination": {{
    "head_and_face": null, "neck_and_cervical_spine": null,
    "chest_and_thorax": null, "abdomen": null, "pelvis": null,
    "spine_and_back": null, "upper_limbs": null, "lower_limbs": null,
    "wounds_lacerations_and_bleeding": null, "skin_findings": null,
    "monitor_clinical_data": null
  }},
  "section_14_emergency_interventions": {{
    "airway_management": [],
    "oxygen_therapy": {{
      "applied": null, "delivery_device": null,
      "flow_rate_lpm": null, "target_spo2": null
    }},
    "iv_access_and_fluids": {{
      "iv_access_established": null, "fluid_type": null,
      "volume_ml": null, "rate": null
    }},
    "haemorrhage_control_measures": [],
    "immobilization_applied": [],
    "medications_administered": [],
    "cpr_performed": null,
    "defibrillation_performed": null,
    "other_interventions": [],
    "total_intervention_count": null
  }},
  "section_15_known_medical_history": {{
    "known_medical_history": {{
      "diabetes": null, "hypertension": null, "cardiac": null,
      "allergies": null, "current_medications": [], "other_conditions": []
    }}
  }},
  "section_16_working_diagnosis": {{
    "primary_diagnosis": null,
    "secondary_diagnoses": [],
    "suspected_injuries": [],
    "differential_diagnoses": [],
    "diagnosis_confidence": "High|Moderate|Low",
    "icd_code_approximate": null
  }},
  "section_17_clinical_progression": {{
    "overall_trend": "Stable|Improving|Deteriorating|Rapidly_Deteriorating|Fluctuating|Unknown",
    "dictation_by_dictation_progression": [],
    "response_to_interventions": null,
    "current_clinical_status": null,
    "trajectory_clinical_note": null
  }},
  "section_18_specialist_alerts": [
    {{"specialty": null, "reason": null, "urgency": "Immediate|Urgent|Routine",
      "alert_time": null, "response_status": null}}
  ],
  "section_19_ed_clinical_course": {{
    "narrative": null,
    "key_events_chronological": [],
    "patient_response_to_treatment": null,
    "complications_noted": null,
    "significant_changes_in_ed": []
  }},
  "section_20_final_disposition": {{
    "disposition": "ICU_Admission|Surgery_OT|Ward_Transfer|Discharge|Referral|Death",
    "destination_unit": null,
    "urgency": "Immediate|Urgent|Routine",
    "rationale": null,
    "disposition_time": null,
    "condition_at_disposition": null
  }},
  "section_21_final_ed_summary": {{
    "consolidated_narrative": null,
    "clinical_highlights": [],
    "outcome_at_ed_discharge": null,
    "follow_up_instructions": null,
    "outstanding_issues": []
  }},
  "section_22_handover_information": {{
    "handover_to": "ICU|OT|Ward|Other",
    "receiving_unit": null,
    "handover_summary": null,
    "critical_points_for_receiving_team": [],
    "pending_investigations_at_handover": [],
    "active_medications_at_handover": [],
    "monitoring_requirements": []
  }},
  "section_23_sbar_summary": {{
    "situation": null,
    "background": null,
    "assessment": null,
    "recommendation": null
  }},
  "section_24_clinical_actions_summary": {{
    "total_actions": {len(actions)},
    "approved_count": {len(approved)},
    "rejected_count": {len(rejected)},
    "latest_approved_content": null,
    "doctor_modifications_or_notes": []
  }},
  "section_25_summary_metadata": {{
    "patient_id": "{state["patient_id"]}",
    "generated_at": "{now_iso}",
    "total_voice_notes": {len(voice_transcripts)},
    "total_clinical_actions": {len(actions)},
    "approved_actions": {len(approved)},
    "rejected_actions": {len(rejected)},
    "data_completeness": "Complete|Partial|Minimal",
    "summary_confidence": "High|Moderate|Low",
    "sections_populated": 25
  }}
}}
"""
        state["final_summary"] = await self._invoke(system, prompt)
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# WORKFLOW
# ============================================================

def create_edfs_workflow() -> Any:
    workflow = StateGraph(EDFSState)
    workflow.add_node("A1", ClinicalDataExtractorAgent(llm_fast).run)
    workflow.add_node("A2", EDAssessmentAgent(llm_synthesis).run)
    workflow.add_node("A3", FinalEDSummaryAgent(llm_synthesis).run)
    workflow.set_entry_point("A1")
    workflow.add_edge("A1", "A2")
    workflow.add_edge("A2", "A3")
    workflow.add_edge("A3", END)
    return workflow.compile()


edfs_workflow = create_edfs_workflow()


# ============================================================
# POST-PROCESS FILL  (v8 — all v7 fixes + case-type-aware SBAR +
# deterministic triage colour)
#
# Deterministic hard-patches applied after LLM pipeline.
# Zero LLM cost (except the triage colour override, which is also
# zero LLM cost — compute_triage_colour is pure Python). All fixes
# are idempotent.
# ============================================================

_CONSCIOUSNESS_KEYWORDS = (
    "conscious", "unconscious", "responsive", "unresponsive",
    "gcs", "glasgow", "avpu", "alert", "drowsy", "obtunded",
    "comatose", "coma", "stupor", "pupil",
)

_REJECTED_STABILITY_KEYWORDS = (
    "conscious", "stable", "responsive", "alert", "awake",
)

_TRAUMA_MECHANISM_KEYWORDS = (
    "road traffic", "rta", "collision", "accident", "trauma",
    "fall", "assault", "penetrating", "blunt", "crush",
)

# Keywords that indicate a doctor note is asserting instability
_DOCTOR_INSTABILITY_KEYWORDS = (
    "not stable", "unstable", "critical", "deteriorating",
    "worsening", "not doing well", "bad condition",
)


def _doctor_asserts_instability(doctor_text: str) -> bool:
    """Return True if the doctor note indicates the patient is not stable."""
    lc = doctor_text.lower()
    return any(kw in lc for kw in _DOCTOR_INSTABILITY_KEYWORDS)


def post_process_fill(
    summary:                     Dict,
    patient:                     Dict,
    voice_transcripts:           List[Dict],
    approved:                    List[Dict],
    rejected:                    List[Dict],
    all_actions:                 List[Dict],
    doctor_voice_notes:          List[Dict],
    image_extractions:           List[Dict],
    doctor_suggestions:          List[Dict],
    approved_image_suggestions:  List[Dict],
    unified_timeline:            List[Dict],
    current_status_snapshot:     Optional[Dict],
    now_iso:                     str,
    patient_id:                  str,
    is_trauma:                   Optional[bool] = None,
    case_type:                   Optional[str]  = None,
    routing_rationale:           Optional[str]  = None,
    authoritative_triage:        Optional[Dict] = None,
) -> Dict:
    if not summary:
        return summary

    accident = patient.get("accidentDetails", {}) or {}
    meta     = patient.get("metadata", {}) or {}
    contact  = patient.get("emergencyContact", {}) or {}
    driver   = patient.get("ambulance_driver") or {}

    progression_lines = _build_progression_narrative(unified_timeline)

    latest_doctor_note    = doctor_voice_notes[-1] if doctor_voice_notes else None
    latest_doctor_text    = (latest_doctor_note.get("conversation") or "").strip() if latest_doctor_note else ""
    latest_doctor_ts      = latest_doctor_note.get("timestamp", "") if latest_doctor_note else ""
    latest_doctor_label   = _ist_label(latest_doctor_ts) if latest_doctor_ts else ""
    latest_doctor_text_lc = latest_doctor_text.lower()

    # Registration demographics (authoritative for identity)
    reg_age    = str(patient.get("age") or "").strip()
    reg_gender = str(patient.get("gender") or "").strip()

    # ── Section 1 — Patient Information ────────────────────
    s1 = summary.get("section_1_patient_information", {}) or {}
    if patient.get("fullName"):
        s1["full_name"] = patient["fullName"]
    if patient.get("age"):
        s1["age"] = patient["age"]
    if patient.get("gender"):
        s1["gender"] = patient["gender"]
    if patient.get("phoneNumber"):
        s1["phone_number"] = patient["phoneNumber"]
    if patient.get("address"):
        s1["address"] = patient["address"]
    reg = meta.get("registrationDate") or meta.get("created_at", "")
    if reg and "T" in str(reg):
        s1["date_of_arrival"] = str(reg).split("T")[0]
        s1["time_of_arrival"] = str(reg).split("T")[1][:8]
    elif reg:
        s1["date_of_arrival"] = str(reg)
    if contact.get("name"):
        s1["emergency_contact_name"]         = contact["name"]
    if contact.get("relationship"):
        s1["emergency_contact_relationship"] = contact["relationship"]
    if contact.get("phoneNumber"):
        s1["emergency_contact_phone"]        = contact["phoneNumber"]
    summary["section_1_patient_information"] = s1

    # ── Section 2 — Arrival Details ────────────────────────
    s2 = summary.get("section_2_arrival_details", {}) or {}
    s2["mode_of_arrival"] = s2.get("mode_of_arrival") or "Ambulance"
    s2["referral_source"] = s2.get("referral_source") or meta.get("registration_source", "ambulance_mobile_app")
    if isinstance(driver, dict) and driver.get("name"):
        s2["emt_driver_name"] = driver["name"]
    summary["section_2_arrival_details"] = s2

    # ── Section 3 — Incident Details ───────────────────────
    s3 = summary.get("section_3_incident_details", {}) or {}
    if accident.get("accidentType"):
        s3["type_of_incident"] = accident["accidentType"]
    if accident.get("location"):
        s3["location_of_incident"] = accident["location"]
    coords = s3.setdefault("coordinates", {})
    if accident.get("latitude"):
        coords["latitude"]  = accident["latitude"]
    if accident.get("longitude"):
        coords["longitude"] = accident["longitude"]
    if accident.get("accidentDate"):
        s3["date_of_incident"] = accident["accidentDate"]
    if accident.get("accidentTime"):
        s3["time_of_incident"] = accident["accidentTime"]
    summary["section_3_incident_details"] = s3

    # ── Section 6 — Voice Notes ─────────────────────────────
    s6 = summary.get("section_6_voice_note_processing", {}) or {}
    s6["total_voice_notes"]       = len(voice_transcripts)
    s6["voice_notes"]             = voice_transcripts
    s6["ai_transcription_status"] = "Processed"
    summary["section_6_voice_note_processing"] = s6

    # ── Section 7 — AI Clinical Suggestion ─────────────────
    # FIX S: ai_generated_summary uses SBAR situation, NOT image AI impression.
    # Image AI impression stored separately as image_ai_impression.
    s7 = summary.get("section_7_ai_clinical_suggestion", {}) or {}

    if approved:
        latest_appr = approved[-1]
        ai_sug      = latest_appr.get("ai_suggestion") or {}
        sbar        = ai_sug.get("sbar_summary") or (ai_sug.get("suggestions") or {}).get("sbar_summary") or {}
        if sbar:
            situation = sbar.get("situation", "")
            if situation and not s7.get("ai_generated_summary"):
                s7["ai_generated_summary"] = situation
        snap = (
            ai_sug.get("patient_snapshot")
            or (ai_sug.get("suggestions") or {}).get("patient_snapshot")
            or {}
        )
        if snap.get("triage_colour") and not s7.get("triage_suggestion"):
            s7["triage_suggestion"] = snap["triage_colour"]
        if snap.get("criticality_score") and not s7.get("criticality_score_suggested"):
            s7["criticality_score_suggested"] = snap["criticality_score"]
        crit_action = (
            ai_sug.get("single_most_critical_action_right_now")
            or (ai_sug.get("suggestions") or {}).get("single_most_critical_action_right_now")
        )
        if crit_action and not s7.get("hospital_prep_instructions"):
            s7["hospital_prep_instructions"] = crit_action

    # FIX S + FIX Q: Store image AI impression separately, with context note
    if approved_image_suggestions:
        img_impression = approved_image_suggestions[-1].get("ai_impression")
        if img_impression:
            s7["image_ai_impression"] = img_impression
            s7["image_ai_context_note"] = (
                "This impression was generated from monitor image data only (vital signs, "
                "infusion pump readings) and does not incorporate the EMT narrative, "
                "mechanism of injury, or doctor assessment. It should not override the "
                "overall triage decision or doctor clinical note."
            )
    summary["section_7_ai_clinical_suggestion"] = s7

    # ── Section 8 — Doctor Review Status ───────────────────
    s8 = summary.get("section_8_doctor_review_status", {}) or {}
    s8["total_reviews_performed"] = len(all_actions)
    s8["approved_count"]          = len(approved)
    s8["rejected_count"]          = len(rejected)
    if approved and not s8.get("review_timestamp"):
        la = approved[-1]
        s8["review_timestamp"] = la.get("client_created_at") or la.get("server_received_at", "")
    s8["ai_review_decision"] = "Approved" if approved else ("Rejected" if rejected else "Pending")
    summary["section_8_doctor_review_status"] = s8

    # ── Section 9 — Doctor Manual Note ─────────────────────
    s9 = summary.get("section_9_doctor_manual_note", {}) or {}
    if latest_doctor_note:
        if not s9.get("manual_clinical_summary"):
            s9["manual_clinical_summary"] = latest_doctor_text
        if not s9.get("doctor_entered_at"):
            s9["doctor_entered_at"] = latest_doctor_ts
    if doctor_suggestions:
        if not s9.get("additional_clinical_findings"):
            s9["additional_clinical_findings"] = (
                doctor_suggestions[-1].get("suggestion_text") or ""
            )
    summary["section_9_doctor_manual_note"] = s9

    # ── Section 10 — Triage ─────────────────────────────────
    s10 = summary.get("section_10_triage_information", {}) or {}
    if latest_doctor_text:
        existing   = s10.get("triage_rationale") or ""
        annotation = f"Doctor confirmed at {latest_doctor_label}: \"{latest_doctor_text}\"."
        if annotation not in existing:
            s10["triage_rationale"] = (
                f"{existing} {annotation}".strip() if existing else annotation
            )
    summary["section_10_triage_information"] = s10

    # ── Section 11 — Initial ED Assessment ─────────────────
    # FIX M: SpO₂ and all vitals — try vitals_timeline dict first,
    # then fall back to raw OCR text regex extraction.

    s11 = summary.get("section_11_initial_ed_assessment", {}) or {}
    iv  = s11.get("initial_vitals_in_ed") or {}

    vital_key_map = [
        # (source_key_in_vitals_timeline, destination_key_in_iv)
        ("spo2",                 "spo2_percent"),
        ("spo2_percent",         "spo2_percent"),
        ("SpO2",                 "spo2_percent"),
        ("pulse_rate_bpm",       "pulse_rate_bpm"),
        ("heart_rate",           "pulse_rate_bpm"),
        ("hr",                   "pulse_rate_bpm"),
        ("blood_pressure",       "blood_pressure"),
        ("bp",                   "blood_pressure"),
        ("NIBP",                 "blood_pressure"),
        ("respiratory_rate",     "respiratory_rate_bpm"),
        ("respiratory_rate_bpm", "respiratory_rate_bpm"),
        ("rr",                   "respiratory_rate_bpm"),
        ("temperature",          "temperature_celsius"),
        ("temperature_celsius",  "temperature_celsius"),
    ]

    if approved_image_suggestions:
        latest_img = approved_image_suggestions[-1]
        vitals_tl  = latest_img.get("vitals_timeline") or []
        if vitals_tl:
            lv = vitals_tl[-1] if isinstance(vitals_tl, list) else vitals_tl
            if isinstance(lv, dict):
                for src_key, dst_key in vital_key_map:
                    val = lv.get(src_key)
                    if not _is_null_value(val) and _is_null_value(iv.get(dst_key)):
                        iv[dst_key] = val

        # FIX M fallback: if spo2_percent still null, try raw_extracted_text from vitals_timeline
        if _is_null_value(iv.get("spo2_percent")):
            vitals_tl = latest_img.get("vitals_timeline") or []
            for vt in (vitals_tl if isinstance(vitals_tl, list) else [vitals_tl]):
                if isinstance(vt, dict):
                    raw = vt.get("raw_extracted_text") or ""
                    if raw:
                        parsed = _extract_vitals_from_raw_text(raw)
                        for dst_key, val in parsed.items():
                            if not _is_null_value(val) and _is_null_value(iv.get(dst_key)):
                                iv[dst_key] = val
                        break

    # FIX M fallback 2: try Image_Extracted_Ambulance extracted_text directly
    if _is_null_value(iv.get("spo2_percent")) and image_extractions:
        for img_ext_doc in image_extractions:
            raw = img_ext_doc.get("extracted_text") or ""
            if raw:
                parsed = _extract_vitals_from_raw_text(raw)
                for dst_key, val in parsed.items():
                    if not _is_null_value(val) and _is_null_value(iv.get(dst_key)):
                        iv[dst_key] = val

    s11["initial_vitals_in_ed"] = iv
    summary["section_11_initial_ed_assessment"] = s11

    # FIX N — C_circulation correction: "Stable" is wrong when doctor confirms instability.
    # FIX I — "Unstable" is wrong when only a single normal BP and HR absent.
    # Both corrected here deterministically.
    s11   = summary.get("section_11_initial_ed_assessment", {}) or {}
    iv    = s11.get("initial_vitals_in_ed") or {}
    abcde = s11.get("abcde_summary") or {}
    c_circ = abcde.get("C_circulation") or ""

    hr_absent = _is_null_value(iv.get("pulse_rate_bpm"))
    bp_val    = iv.get("blood_pressure") or ""
    bp_normal = False
    if bp_val and "/" in str(bp_val):
        try:
            systolic  = int(str(bp_val).split("/")[0].strip())
            bp_normal = systolic >= 90
        except Exception:
            pass

    doctor_says_unstable = _doctor_asserts_instability(latest_doctor_text) if latest_doctor_text else False

    qualified_unknown = (
        "Unknown — requires reassessment: BP within normal limits but HR absent; "
        "haemodynamic stability cannot be confirmed. "
        "Doctor confirmed: patient not stable."
        if doctor_says_unstable
        else
        "Unknown — BP within normal limits, HR not recorded; "
        "haemodynamic stability cannot be confirmed."
    )

    if isinstance(c_circ, str):
        if hr_absent and bp_normal and ("Unstable" in c_circ or "Stable" in c_circ):
            # FIX I + FIX N: replace both "Stable" and "Unstable" with qualified unknown
            corrected = c_circ
            corrected = corrected.replace("Unstable", qualified_unknown)
            corrected = corrected.replace("Stable", qualified_unknown)
            abcde["C_circulation"] = corrected
            s11["abcde_summary"]   = abcde
            summary["section_11_initial_ed_assessment"] = s11

    # ── v8 — Deterministic triage colour override ──────────
    # Ported byte-for-byte from EIDIS's compute_triage_colour() so triage
    # can never diverge between the insurance package, this ED summary,
    # and the structured note for the same patient. This REPLACES the
    # LLM's value in section_10.triage_colour (same key — schema
    # unchanged). The LLM's own suggestion is captured separately at the
    # top level of the API response (see run_edfs_pipeline), never inside
    # this locked section.
    s10 = summary.get("section_10_triage_information", {}) or {}

    hr_i     = first_int(iv.get("pulse_rate_bpm"))
    rr_i     = first_int(iv.get("respiratory_rate_bpm"))
    spo2_i   = first_int(iv.get("spo2_percent"))
    bp_sys_i = parse_bp_systolic(iv.get("blood_pressure"))
    gcs_i    = first_int(s11.get("gcs_total"))

    avpu_val = str(s11.get("avpu") or "")
    neuro_text = str(s11.get("neurological_findings") or "")
    consciousness_for_triage = None
    if avpu_val.strip().upper() == "U":
        consciousness_for_triage = "unconscious"
    elif "unconscious" in neuro_text.lower() or "unresponsive" in neuro_text.lower():
        consciousness_for_triage = "unconscious"
    elif "confus" in neuro_text.lower():
        consciousness_for_triage = "confused"

    c_circ_text_lc = str(abcde.get("C_circulation") or "").lower()
    shock_suspected = (
        any(kw in c_circ_text_lc for kw in ("shock", "unstable", "haemorrhage", "hemorrhage"))
        or (bp_sys_i is not None and bp_sys_i < 90)
    )

    b_breathing_text_lc = str(abcde.get("B_breathing") or "").lower()
    respiratory_failure_risk = (
        "inadequate" in b_breathing_text_lc
        or (rr_i is not None and rr_i > 30)
    )

    chest_exam_text = str(
        (summary.get("section_13_physical_examination") or {}).get("chest_and_thorax") or ""
    ).lower()
    working_dx_text = str(
        (summary.get("section_16_working_diagnosis") or {}).get("primary_diagnosis") or ""
    ).lower()
    chest_life_threat_flag = any(
        kw in chest_exam_text or kw in working_dx_text
        for kw in ("pneumothorax", "hemothorax", "haemothorax", "tamponade")
    )

    doctor_stated_severity = None
    if latest_doctor_text_lc:
        if "severe" in latest_doctor_text_lc or "critical" in latest_doctor_text_lc:
            doctor_stated_severity = "SEVERE"
        elif "moderate" in latest_doctor_text_lc:
            doctor_stated_severity = "MODERATE"

    disposition_val = (summary.get("section_20_final_disposition", {}) or {}).get("disposition")
    arrest_or_deceased_indicated = (disposition_val == "Death")

    computed_triage_colour = compute_triage_colour(
        hr=hr_i,
        rr=rr_i,
        spo2_room_air=spo2_i,
        spo2_on_o2=None,
        bp_sys=bp_sys_i,
        gcs=gcs_i,
        consciousness=consciousness_for_triage,
        shock_suspected=shock_suspected,
        respiratory_failure_risk=respiratory_failure_risk,
        pneumothorax_or_hemothorax_flag=chest_life_threat_flag,
        doctor_stated_severity=doctor_stated_severity,
        arrest_or_deceased_indicated=arrest_or_deceased_indicated,
    )
    if authoritative_triage and authoritative_triage.get("triage_colour"):
        s10["triage_colour"] = authoritative_triage["triage_colour"]
        s10["triage_colour_source"] = "EVIS_authoritative"
        s10["triage_colour_deterministic_cross_check"] = computed_triage_colour
    else:
        s10["triage_colour"] = computed_triage_colour
        s10["triage_colour_source"] = "deterministic_fallback_no_evis_data"
    summary["section_10_triage_information"] = s10

    # F11 — D_disability / AVPU hedge
    if latest_doctor_note:
        doctor_addressed_consciousness = any(
            kw in latest_doctor_text_lc for kw in _CONSCIOUSNESS_KEYWORDS
        )
        rejected_stability_claims = []
        for r in rejected:
            vd = (r.get("voice_dictation") or "").strip()
            if not vd:
                continue
            if any(kw in vd.lower() for kw in _REJECTED_STABILITY_KEYWORDS):
                rejected_stability_claims.append((r, vd))

        if not doctor_addressed_consciousness and rejected_stability_claims:
            s11   = summary.get("section_11_initial_ed_assessment", {}) or {}
            abcde = s11.get("abcde_summary") or {}
            rejected_fragments = []
            for r, vd in rejected_stability_claims:
                r_ts = (
                    r.get("server_received_ist")
                    or r.get("client_created_at")
                    or r.get("server_received_at")
                    or ""
                )
                rejected_fragments.append(f"{_ist_label(r_ts)} EMT reported: \"{vd}\"")
            rejected_summary_text = "; ".join(rejected_fragments)
            hedge_text = (
                f"Consciousness status uncertain — {rejected_summary_text} "
                f"(NOT approved by doctor, so cannot be used as confirmed "
                f"current status). Doctor confirmed at {latest_doctor_label}: "
                f"\"{latest_doctor_text}\" without specifying consciousness "
                f"level, GCS, or AVPU. Current consciousness/neurological "
                f"status should be reassessed and documented explicitly by "
                f"the treating team."
            )
            abcde["D_disability"] = hedge_text
            s11["abcde_summary"]  = abcde
            s11["avpu"]           = "Unknown"
            s11["neurological_findings"] = (
                f"Conflicting information: scene presentation was unconscious/"
                f"unresponsive; later rejected EMT dictations reported the "
                f"patient conscious and responsive (not approved by doctor); "
                f"doctor's most recent note ({latest_doctor_label}) confirms "
                f"general instability (\"{latest_doctor_text}\") but does not "
                f"address neurological/consciousness status specifically. "
                f"Requires direct reassessment."
            )
            summary["section_11_initial_ed_assessment"] = s11

    # ── Section 13 — Physical Examination ──────────────────
    # FIX P: impressive_findings goes into monitor_clinical_data, NOT skin_findings.
    # skin_findings is only populated from actual physical examination observations.
    if approved_image_suggestions:
        impressive = approved_image_suggestions[-1].get("impressive_findings")
        if impressive:
            s13 = summary.get("section_13_physical_examination", {}) or {}
            # Always store monitor data in its own field
            s13["monitor_clinical_data"] = impressive
            # Only populate skin_findings from actual skin exam language
            # Look for skin-relevant terms in EMT narrative
            skin_findings_from_emt = None
            for vd in voice_transcripts:
                transcript = (vd.get("transcript") or "").lower()
                skin_terms = ["abrasion", "laceration", "pallor", "diaphoresis",
                              "bruise", "contusion", "rash", "wound", "swelling",
                              "ecchymosis", "cyanosis", "jaundice", "erythema"]
                if any(term in transcript for term in skin_terms):
                    # Extract the relevant phrase — use the full transcript for context
                    skin_findings_from_emt = (
                        "Documented injuries per EMT: see wounds_lacerations_and_bleeding "
                        "and visible_injuries sections."
                    )
                    break
            if skin_findings_from_emt and _is_null_value(s13.get("skin_findings")):
                s13["skin_findings"] = skin_findings_from_emt
            summary["section_13_physical_examination"] = s13

    # ── Section 14 — Emergency Interventions ───────────────
    # FIX H (v6): inject ALL pump data, compute total fluid, per-pump check
    if approved_image_suggestions:
        latest_img = approved_image_suggestions[-1]
        vitals_tl  = latest_img.get("vitals_timeline") or []
        if vitals_tl:
            lv  = vitals_tl[-1] if isinstance(vitals_tl, list) else vitals_tl
            s14 = summary.get("section_14_emergency_interventions", {}) or {}
            iv14 = s14.get("iv_access_and_fluids") or {}

            if isinstance(lv, dict):
                pump_keys = [k for k in lv.keys() if "pump" in k.lower() or "infus" in k.lower()]
                if pump_keys:
                    iv14["iv_access_established"] = True

                pump_entries  = []
                total_infused = 0.0

                for i in range(1, 4):
                    flow_key    = f"pump{i}_flow"
                    infused_key = f"pump{i}_infused"
                    flow_val    = lv.get(flow_key)
                    infused_val = lv.get(infused_key)

                    if not _is_null_value(flow_val) or not _is_null_value(infused_val):
                        entry = f"Pump {i}"
                        if not _is_null_value(flow_val):
                            entry += f" — Flow Rate: {flow_val} ml/hr"
                        if not _is_null_value(infused_val):
                            entry += f", Volume Infused: {infused_val} ml"
                            try:
                                total_infused += float(str(infused_val).strip())
                            except Exception:
                                pass
                        pump_entries.append(entry)

                if pump_entries:
                    if total_infused > 0:
                        iv14["volume_ml"] = round(total_infused, 2)
                        iv14["rate"]      = f"Total infused across all pumps: {round(total_infused, 2)} ml"

                    other = s14.get("other_interventions") or []
                    if not isinstance(other, list):
                        other = []
                    existing_pump_entries = set(other)
                    for pe in pump_entries:
                        if pe not in existing_pump_entries:
                            other.append(pe)
                            existing_pump_entries.add(pe)
                    s14["other_interventions"] = other

            s14["iv_access_and_fluids"] = iv14
            summary["section_14_emergency_interventions"] = s14

    # ── Section 16 — Working Diagnosis ─────────────────────
    # Use approved AI suggestion SBAR assessment as primary diagnosis context,
    # NOT the image AI impression (FIX S related)
    s16 = summary.get("section_16_working_diagnosis", {}) or {}
    if not s16.get("primary_diagnosis"):
        if approved:
            latest_appr = approved[-1]
            ai_sug      = latest_appr.get("ai_suggestion") or {}
            sbar        = ai_sug.get("sbar_summary") or (ai_sug.get("suggestions") or {}).get("sbar_summary") or {}
            assessment  = sbar.get("assessment") or ""
            if assessment:
                s16["primary_diagnosis"] = assessment
        # Fallback: use image AI impression only if nothing else available
        if not s16.get("primary_diagnosis") and approved_image_suggestions:
            ai_impression = approved_image_suggestions[-1].get("ai_impression")
            if ai_impression:
                s16["primary_diagnosis"] = (
                    f"[From monitor image analysis — limited context] {ai_impression}"
                )
    summary["section_16_working_diagnosis"] = s16

    # ── Section 17 — Clinical Progression ──────────────────
    s17 = summary.get("section_17_clinical_progression", {}) or {}
    s17["dictation_by_dictation_progression"] = progression_lines

    if latest_doctor_text and latest_doctor_label:
        s17["current_clinical_status"] = (
            f"Per doctor assessment at {latest_doctor_label}: \"{latest_doctor_text}\""
        )
    elif current_status_snapshot:
        cs_content = current_status_snapshot.get("content")
        cs_text = (
            json.dumps(cs_content, default=str)
            if isinstance(cs_content, dict)
            else str(cs_content)
        )
        s17["current_clinical_status"] = (
            f"Latest record [{current_status_snapshot.get('source')} @ "
            f"{_ist_label(current_status_snapshot.get('timestamp', ''))}]: {cs_text[:300]}"
        )

    # FIX R (improved FIX J): only count IMAGE_EXTRACTED_VITALS, not APPROVED_IMAGE_ANALYSIS
    # (both may exist for the same image event and double-counting inflates the count)
    if s17.get("overall_trend") in ("Deteriorating", "Rapidly_Deteriorating"):
        vital_reading_count = sum(
            1 for e in unified_timeline
            if e.get("source") == "IMAGE_EXTRACTED_VITALS"
        )
        if vital_reading_count < 2:
            s17["overall_trend"] = (
                "Unknown — insufficient sequential vital sign data to determine "
                "trend direction (only one monitor reading available)"
            )

    if latest_doctor_text:
        first_entry = unified_timeline[0] if unified_timeline else None
        first_label = _ist_label(first_entry.get("timestamp", "")) if first_entry else "unknown time"
        rejected_claims_text = ""
        if rejected:
            frags = []
            for r in rejected:
                vd = (r.get("voice_dictation") or "").strip()
                if not vd:
                    continue
                r_ts = (
                    r.get("server_received_ist")
                    or r.get("client_created_at")
                    or r.get("server_received_at")
                    or ""
                )
                frags.append(f"[{_ist_label(r_ts)}] \"{vd}\"")
            if frags:
                rejected_claims_text = (
                    " Subsequent EMT dictations (NOT approved by the doctor) reported: "
                    + "; ".join(frags) + "."
                )
        s17["trajectory_clinical_note"] = (
            f"Earliest record at {first_label}. "
            f"{rejected_claims_text} "
            f"Doctor confirmed at {latest_doctor_label}: \"{latest_doctor_text}\". "
            f"This is the most recent authoritative clinical statement and overrides "
            f"any earlier reports of stability or improvement not approved by the doctor."
        ).strip()
    summary["section_17_clinical_progression"] = s17

    # ── Section 18 — Specialist Alerts ─────────────────────
    # FIX Q: Only include named specialist referrals here.
    # physician_alert from image analysis goes to section 21 outstanding_issues instead.
    s18 = summary.get("section_18_specialist_alerts") or []
    if not isinstance(s18, list):
        s18 = []

    # Remove any entries with null specialty (these are monitor/physician alerts, not referrals)
    s18 = [
        a for a in s18
        if isinstance(a, dict) and not _is_null_value(a.get("specialty"))
    ]

    # Move physician_alert content to section 21 outstanding_issues instead
    if approved_image_suggestions:
        for img_analysis in approved_image_suggestions:
            phys_alert = img_analysis.get("physician_alert")
            if phys_alert:
                s21_outstanding = (
                    (summary.get("section_21_final_ed_summary") or {}).get("outstanding_issues") or []
                )
                if not isinstance(s21_outstanding, list):
                    s21_outstanding = []
                alert_note = f"[Monitor Image Physician Alert] {phys_alert}"
                if not any("Monitor Image Physician Alert" in str(o) for o in s21_outstanding):
                    s21_outstanding.append(alert_note)
                # Write back — section 21 block below will also write, so use a temp store
                _temp_s21 = summary.get("section_21_final_ed_summary") or {}
                _temp_s21["outstanding_issues"] = s21_outstanding
                summary["section_21_final_ed_summary"] = _temp_s21

    summary["section_18_specialist_alerts"] = s18

    # ── Section 19 — ED Clinical Course ────────────────────
    s19    = summary.get("section_19_ed_clinical_course", {}) or {}
    events = []
    for entry in unified_timeline:
        content = entry.get("content")
        content_text = (
            json.dumps(content, default=str)
            if isinstance(content, dict)
            else str(content) if content else ""
        )
        if content_text and content_text not in ("", "None", "null", "{}"):
            events.append(
                f"{_ist_label(entry.get('timestamp', ''))} — "
                f"{entry.get('source')}: {content_text[:250]}"
            )
    s19["key_events_chronological"] = events
    sig_changes = s19.get("significant_changes_in_ed") or []
    if not isinstance(sig_changes, list):
        sig_changes = []
    if latest_doctor_text:
        doctor_change = f"Doctor assessment at {latest_doctor_label}: \"{latest_doctor_text}\""
        if doctor_change not in sig_changes:
            sig_changes.append(doctor_change)
    s19["significant_changes_in_ed"] = sig_changes
    summary["section_19_ed_clinical_course"] = s19

    # ── Section 20 — Final Disposition ─────────────────────
    s20 = summary.get("section_20_final_disposition", {}) or {}
    if latest_doctor_text and latest_doctor_label:
        s20["condition_at_disposition"] = (
            f"Confirmed unstable per doctor at {latest_doctor_label}: "
            f"\"{latest_doctor_text}\""
        )
        existing_rationale = s20.get("rationale") or ""
        if latest_doctor_text not in existing_rationale:
            s20["rationale"] = (
                f"{existing_rationale} Doctor confirmed: \"{latest_doctor_text}\" "
                f"at {latest_doctor_label}.".strip()
            )
    summary["section_20_final_disposition"] = s20

    # ── Section 21 — Final ED Summary ──────────────────────
    s21 = summary.get("section_21_final_ed_summary", {}) or {}
    highlights  = s21.get("clinical_highlights") or []
    outstanding = s21.get("outstanding_issues") or []
    if not isinstance(highlights, list):
        highlights = []
    if not isinstance(outstanding, list):
        outstanding = []

    if latest_doctor_text:
        doctor_highlight = (
            f"Doctor confirmed patient unstable at {latest_doctor_label}: "
            f"\"{latest_doctor_text}\""
        )
        if doctor_highlight not in highlights:
            highlights.insert(0, doctor_highlight)
        narrative = s21.get("consolidated_narrative") or ""
        if latest_doctor_text not in narrative:
            s21["consolidated_narrative"] = (
                narrative
                + f" The treating doctor assessed the patient at {latest_doctor_label} "
                f"and noted: \"{latest_doctor_text}.\""
            ).strip()

    # FIX L — PREDICT-HF clinical irrelevance note for trauma
    # v8: now uses the classifier's is_trauma directly; keyword match on
    # mechanism_of_injury is kept ONLY as a fallback when classification
    # is unavailable (is_trauma is None).
    if approved_image_suggestions:
        for img_analysis in approved_image_suggestions:
            vitals_tl = img_analysis.get("vitals_timeline") or []
            for vt in (vitals_tl if isinstance(vitals_tl, list) else [vitals_tl]):
                if isinstance(vt, dict) and not _is_null_value(vt.get("predict_hf")):
                    if is_trauma is True:
                        predict_hf_is_trauma = True
                    elif is_trauma is False:
                        predict_hf_is_trauma = False
                    else:
                        mechanism = (
                            (summary.get("section_3_incident_details") or {}).get("mechanism_of_injury") or ""
                        ).lower()
                        predict_hf_is_trauma = any(kw in mechanism for kw in _TRAUMA_MECHANISM_KEYWORDS)
                    if predict_hf_is_trauma:
                        predict_note = (
                            "PREDICT-HF score present in monitor data (value: "
                            + str(vt.get("predict_hf"))
                            + "). NOTE: PREDICT-HF is a cardiac heart failure risk score "
                            "and is CLINICALLY INAPPLICABLE in acute trauma. This value "
                            "should not be used for clinical decision-making in this case."
                        )
                        if not any("PREDICT-HF" in str(o) for o in outstanding):
                            outstanding.append(predict_note)
                    break

    s21["clinical_highlights"] = highlights
    s21["outstanding_issues"]  = outstanding
    summary["section_21_final_ed_summary"] = s21

    # ── Section 22 — Handover Information ──────────────────
    s22 = summary.get("section_22_handover_information", {}) or {}
    if latest_doctor_text:
        critical_pts = s22.get("critical_points_for_receiving_team") or []
        if not isinstance(critical_pts, list):
            critical_pts = []
        doctor_point = (
            f"[MOST RECENT CLINICAL NOTE — {latest_doctor_label}] "
            f"Doctor: \"{latest_doctor_text}\""
        )
        if doctor_point not in critical_pts:
            critical_pts.insert(0, doctor_point)
        s22["critical_points_for_receiving_team"] = critical_pts
        existing_hs = s22.get("handover_summary") or ""
        if latest_doctor_text not in existing_hs:
            s22["handover_summary"] = (
                f"{existing_hs} Current status confirmed by doctor at "
                f"{latest_doctor_label}: \"{latest_doctor_text}\"."
            ).strip()
    summary["section_22_handover_information"] = s22

    # ── Section 23 — SBAR ──────────────────────────────────
    # v8: REBUILT to be entirely data-driven and case-type-gated, replacing
    # the previous hardcoded trauma/RTA content (fixed strings about head
    # trauma, abrasions, haemorrhage, spinal cord injury, CT Head/Chest/
    # Abdomen-Pelvis, Full Trauma Team activation) that previously fired
    # for EVERY patient with a doctor note, regardless of what they
    # actually presented with. Situation is still deterministically built
    # from REGISTRATION demographics only (FIX O — never monitor OCR age).
    s23 = summary.get("section_23_sbar_summary", {}) or {}

    s4  = summary.get("section_4_chief_complaint", {}) or {}
    s16 = summary.get("section_16_working_diagnosis", {}) or {}

    age_str    = reg_age if reg_age else "unknown age"
    gender_str = reg_gender if reg_gender else "unknown gender"
    mechanism      = s3.get("mechanism_of_injury") or ""
    incident_type  = s3.get("type_of_incident") or "incident"
    chief_complaint = s4.get("chief_complaint") or "an unspecified presenting complaint"
    primary_diagnosis = s16.get("primary_diagnosis") or ""
    suspected_injuries = s16.get("suspected_injuries") or []
    if not isinstance(suspected_injuries, list):
        suspected_injuries = []

    # consciousness/status descriptor — derived from data, never assumed
    if latest_doctor_text:
        consciousness_str = f"confirmed unstable by treating doctor (\"{latest_doctor_text}\")"
    else:
        avpu_for_sbar   = s11.get("avpu")
        neuro_for_sbar  = s11.get("neurological_findings")
        if avpu_for_sbar and avpu_for_sbar != "Unknown":
            consciousness_str = f"AVPU {avpu_for_sbar}"
        elif neuro_for_sbar:
            consciousness_str = str(neuro_for_sbar)[:150]
        else:
            consciousness_str = "clinical status pending detailed assessment"

    if is_trauma is True:
        presentation_clause = f"involved in a {mechanism or 'trauma incident'} ({incident_type})"
        if suspected_injuries:
            presentation_clause += (
                f", with suspected {', '.join(str(i) for i in suspected_injuries[:3])}"
            )
    elif is_trauma is False:
        presentation_clause = f"presenting with {chief_complaint}"
        if primary_diagnosis:
            dx_phrase = primary_diagnosis if "suspected" in primary_diagnosis.lower() else f"suspected {primary_diagnosis}"
            presentation_clause += f" (working impression: {dx_phrase})"
    else:
        # Case type undetermined — stay neutral rather than guessing trauma vs medical.
        presentation_clause = f"presenting with {chief_complaint or mechanism or 'an unspecified emergency presentation'}"

    situation_text = f"{age_str}-year-old {gender_str} patient {presentation_clause}, {consciousness_str}."
    s23["situation"] = situation_text

    if latest_doctor_text and latest_doctor_label:
        triage_colour_for_sbar = (summary.get("section_10_triage_information", {}) or {}).get(
            "triage_colour", "Unknown"
        )
        differential = s16.get("differential_diagnoses") or []
        if not isinstance(differential, list):
            differential = []
        specialist_alerts_for_sbar = summary.get("section_18_specialist_alerts") or []
        suggested_investigations = (
            (summary.get("section_7_ai_clinical_suggestion", {}) or {}).get("suggested_investigations") or []
        )

        if is_trauma is True:
            risk_note = (
                "Risk of ongoing haemorrhage, occult injury, and clinical deterioration "
                "given the trauma mechanism."
            )
        elif is_trauma is False:
            risk_note = (
                "Risk of clinical deterioration related to the underlying medical "
                "presentation; ongoing evaluation required."
            )
        else:
            risk_note = (
                "Case type could not be confidently classified from available data; "
                "maintain vigilance for both traumatic and medical causes of deterioration."
            )

        assessment_parts = [f"Triage: {triage_colour_for_sbar}."]
        if primary_diagnosis:
            assessment_parts.append(f"Working impression: {primary_diagnosis}.")
        if differential:
            assessment_parts.append(
                f"Differential considerations: {', '.join(str(d) for d in differential[:4])}."
            )
        assessment_parts.append(f"Doctor assessment at {latest_doctor_label}: \"{latest_doctor_text}\".")
        assessment_parts.append(risk_note)
        s23["assessment"] = " ".join(assessment_parts)

        recommendation_parts = ["Immediate senior clinician review."]
        specs = ", ".join(
            str(a.get("specialty")) for a in specialist_alerts_for_sbar
            if isinstance(a, dict) and a.get("specialty")
        )
        if specs:
            recommendation_parts.append(f"Specialist input from: {specs}.")
        if suggested_investigations:
            inv_list = ", ".join(str(i) for i in suggested_investigations[:5])
            recommendation_parts.append(f"Expedite investigations: {inv_list}.")
        recommendation_parts.append(
            "Continuous monitoring of vital signs and clinical/neurological status per the "
            "working diagnosis; escalate immediately for any deterioration."
        )
        s23["recommendation"] = " ".join(recommendation_parts)
    summary["section_23_sbar_summary"] = s23

    # ── Section 24 — Clinical Actions Summary ──────────────
    s24 = summary.get("section_24_clinical_actions_summary", {}) or {}
    s24["total_actions"]  = len(all_actions)
    s24["approved_count"] = len(approved)
    s24["rejected_count"] = len(rejected)
    if approved:
        s24["latest_approved_content"] = approved[-1].get("ai_suggestion")
    summary["section_24_clinical_actions_summary"] = s24

    # ── FIX K — Age/Gender Discrepancy Detection ───────────
    monitor_age    = None
    monitor_gender = None
    if approved_image_suggestions:
        for img_analysis in approved_image_suggestions:
            vitals_tl = img_analysis.get("vitals_timeline") or []
            for vt in (vitals_tl if isinstance(vitals_tl, list) else [vitals_tl]):
                if isinstance(vt, dict):
                    raw = vt.get("raw_extracted_text") or ""
                    a, g = _extract_age_gender_from_raw_text(raw)
                    if a:
                        monitor_age    = a
                        monitor_gender = g
                        break
            if monitor_age:
                break

    # Also check image_extractions for monitor age
    if not monitor_age and image_extractions:
        for img_ext_doc in image_extractions:
            raw = img_ext_doc.get("extracted_text") or ""
            a, g = _extract_age_gender_from_raw_text(raw)
            if a:
                monitor_age    = a
                monitor_gender = g
                break

    discrepancies_found = []
    reg_age_norm    = reg_age.strip()
    reg_gender_norm = reg_gender.strip().upper()

    if reg_age_norm and monitor_age and reg_age_norm != monitor_age:
        discrepancies_found.append(
            f"AGE DISCREPANCY — Registration: {reg_age_norm} years | "
            f"RPM Monitor: {monitor_age} years. "
            f"Registration data used as legal identity source. "
            f"Treating team must verify correct patient identity before proceeding."
        )
    if reg_gender_norm and monitor_gender:
        rg_norm = "MALE" if reg_gender_norm in ("M", "MALE") else "FEMALE"
        mg_norm = monitor_gender.upper()
        if rg_norm != mg_norm:
            discrepancies_found.append(
                f"GENDER DISCREPANCY — Registration: {reg_gender} | "
                f"RPM Monitor: {monitor_gender}. "
                f"Registration data used as legal identity source. "
                f"Treating team must verify correct patient identity before proceeding."
            )

    if discrepancies_found:
        s21 = summary.get("section_21_final_ed_summary", {}) or {}
        highlights  = s21.get("clinical_highlights") or []
        outstanding = s21.get("outstanding_issues") or []
        if not isinstance(highlights, list):
            highlights = []
        if not isinstance(outstanding, list):
            outstanding = []
        for disc in discrepancies_found:
            alert = f"\u26a0 DATA INTEGRITY ALERT: {disc}"
            if alert not in highlights:
                highlights.insert(0, alert)
            if alert not in outstanding:
                outstanding.append(alert)
        s21["clinical_highlights"] = highlights
        s21["outstanding_issues"]  = outstanding
        summary["section_21_final_ed_summary"] = s21

        s22 = summary.get("section_22_handover_information", {}) or {}
        critical_pts = s22.get("critical_points_for_receiving_team") or []
        if not isinstance(critical_pts, list):
            critical_pts = []
        for disc in discrepancies_found:
            alert = f"\u26a0 DATA INTEGRITY ALERT: {disc}"
            if alert not in critical_pts:
                critical_pts.append(alert)
        s22["critical_points_for_receiving_team"] = critical_pts
        summary["section_22_handover_information"] = s22

        # Also append discrepancy note to SBAR situation for completeness
        s23 = summary.get("section_23_sbar_summary", {}) or {}
        existing_sit = s23.get("situation") or ""
        disc_note = " [NOTE: Age discrepancy detected — registration age used above; monitor shows different demographics. Verify patient identity.]"
        if disc_note not in existing_sit:
            s23["situation"] = existing_sit + disc_note
        summary["section_23_sbar_summary"] = s23

    # ── Section 25 — Metadata ───────────────────────────────
    has_secondary = any([
        voice_transcripts, approved, rejected, doctor_voice_notes,
        image_extractions, doctor_suggestions, approved_image_suggestions,
    ])
    meta_25: Dict = {
        "patient_id":                      patient_id,
        "generated_at":                    now_iso,
        "total_voice_notes":               len(voice_transcripts),
        "total_clinical_actions":          len(all_actions),
        "approved_actions":                len(approved),
        "rejected_actions":                len(rejected),
        "doctor_voice_note_count":         len(doctor_voice_notes),
        "image_extraction_count":          len(image_extractions),
        "doctor_suggestion_count":         len(doctor_suggestions),
        "approved_image_suggestion_count": len(approved_image_suggestions),
        "data_completeness": (
            "Complete" if (voice_transcripts and approved) else
            "Partial"  if has_secondary else
            "Minimal"
        ),
        "summary_confidence": (
            summary.get("section_25_summary_metadata", {}) or {}
        ).get("summary_confidence", "Moderate"),
        "sections_populated": 25,
    }
    if discrepancies_found:
        meta_25["data_integrity_alerts"] = discrepancies_found
    summary["section_25_summary_metadata"] = meta_25

    return summary


# ============================================================
# DATA FETCHER — ALL 7 SOURCES, IN PARALLEL
# ============================================================

async def fetch_all_patient_data(patient_id: str):
    async def _get_patient():
        doc = await emergency_patients_collection.find_one(
            {"patient_id": patient_id}, {"_id": 0}
        )
        return serialize_doc(doc) if doc else {}

    async def _get_voice_dictations():
        cursor = voice_dictations_collection.find(
            {"patient_id": patient_id}, {"_id": 0}
        ).sort("timestamp", 1)
        return [serialize_doc(d) for d in await cursor.to_list(length=None)]

    async def _get_clinical_actions():
        cursor = clinical_actions_collection.find(
            {"patient_id": patient_id}, {"_id": 0}
        ).sort("server_received_at", 1)
        return [serialize_doc(a) for a in await cursor.to_list(length=None)]

    async def _get_doctor_voice_notes():
        cursor = doctor_voice_notes_collection.find(
            {"patient_id": patient_id}, {"_id": 0}
        ).sort("timestamp", 1)
        return [serialize_doc(d) for d in await cursor.to_list(length=None)]

    async def _get_image_extractions():
        cursor = image_extracted_ambulance_collection.find(
            {"patient_id": patient_id}, {"_id": 0}
        ).sort("timestamp", 1)
        return [serialize_doc(d) for d in await cursor.to_list(length=None)]

    async def _get_doctor_suggestions():
        cursor = doctor_suggestion_collection.find(
            {"patient_id": patient_id}, {"_id": 0}
        ).sort("timestamp", 1)
        return [serialize_doc(d) for d in await cursor.to_list(length=None)]

    async def _get_approved_image_suggestions():
        cursor = approve_image_suggestion_collection.find(
            {"patient_id": patient_id}, {"_id": 0}
        ).sort("approved_at", 1)
        return [serialize_doc(a) for a in await cursor.to_list(length=None)]

    (
        patient,
        voice_dictations,
        clinical_actions,
        doctor_voice_notes,
        image_extractions,
        doctor_suggestions,
        approved_image_suggestions,
    ) = await asyncio.gather(
        _get_patient(),
        _get_voice_dictations(),
        _get_clinical_actions(),
        _get_doctor_voice_notes(),
        _get_image_extractions(),
        _get_doctor_suggestions(),
        _get_approved_image_suggestions(),
    )

    logger.info(
        f"DB fetch — patient={'found' if patient else 'NOT FOUND'}, "
        f"voice_dictations={len(voice_dictations)}, "
        f"clinical_actions={len(clinical_actions)}, "
        f"doctor_voice_notes={len(doctor_voice_notes)}, "
        f"image_extractions={len(image_extractions)}, "
        f"doctor_suggestions={len(doctor_suggestions)}, "
        f"approved_image_suggestions={len(approved_image_suggestions)} "
        f"[db={APPROVE_IMAGE_DB_NAME}]"
    )

    if len(approved_image_suggestions) == 0:
        logger.warning(
            f"Patient {patient_id} — approved_image_suggestions is 0. "
            f"Verify APPROVE_IMAGE_DB_NAME='{APPROVE_IMAGE_DB_NAME}' is correct "
            f"and that ApproveImageSuggestion collection exists in that database."
        )

    secondary_sources_present = any([
        voice_dictations, clinical_actions, doctor_voice_notes,
        image_extractions, doctor_suggestions, approved_image_suggestions,
    ])

    return (
        patient,
        voice_dictations,
        clinical_actions,
        doctor_voice_notes,
        image_extractions,
        doctor_suggestions,
        approved_image_suggestions,
        secondary_sources_present,
    )


# ============================================================
# PIPELINE RUNNER
# ============================================================

async def run_edfs_pipeline(
    patient_id:                  str,
    patient_record:              Dict,
    voice_dictations:            List[Dict],
    clinical_actions:            List[Dict],
    doctor_voice_notes:          List[Dict],
    image_extractions:           List[Dict],
    doctor_suggestions:          List[Dict],
    approved_image_suggestions:  List[Dict],
    include_raw_data:            bool = False,
) -> Dict:
    start_ms = datetime.now().timestamp() * 1000

    unified_timeline        = build_unified_timeline(
        voice_dictations           = voice_dictations,
        clinical_actions           = clinical_actions,
        doctor_voice_notes         = doctor_voice_notes,
        image_extractions          = image_extractions,
        doctor_suggestions         = doctor_suggestions,
        approved_image_suggestions = approved_image_suggestions,
    )
    current_status_snapshot = get_current_status_snapshot(unified_timeline)

    # v8 — NEW: case-type classification (I0-style), run BEFORE A1 so every
    # agent prompt and post_process_fill see the same is_trauma/case_type,
    # mirroring EIDIS's I0 pattern. Uses the same progression narrative
    # already built above — no extra DB round-trip needed.
    progression_lines_for_classification = _build_progression_narrative(unified_timeline)
    classification_narrative = (
        "\n".join(progression_lines_for_classification)
        if progression_lines_for_classification else "No clinical entries available."
    )
    classification = await classify_case_type(classification_narrative)
    authoritative_triage = await fetch_authoritative_triage(patient_triage_status_collection, patient_id)

    initial_state: EDFSState = {
        "patient_id":                 patient_id,
        "patient_record":             patient_record,
        "voice_dictations":           voice_dictations,
        "clinical_actions":           clinical_actions,
        "doctor_voice_notes":         doctor_voice_notes,
        "image_extractions":          image_extractions,
        "doctor_suggestions":         doctor_suggestions,
        "approved_image_suggestions": approved_image_suggestions,
        "unified_timeline":           unified_timeline,
        "current_status_snapshot":    current_status_snapshot,
        "is_trauma":                  classification["is_trauma"],
        "case_type":                  classification["case_type"],
        "routing_rationale":          classification["routing_rationale"],
        "clinical_extraction":        None,
        "ed_assessment":              None,
        "final_summary":              None,
        "errors":                     [],
        "agent_timings":              {},
    }

    result  = await edfs_workflow.ainvoke(initial_state)
    elapsed = round(datetime.now().timestamp() * 1000 - start_ms)

    voice_transcripts = [
        {
            "note_number": idx,
            "timestamp":   str(d.get("timestamp", "")),
            "date":        d.get("date", ""),
            "time":        d.get("time", ""),
            "transcript":  d.get("conversation", "").strip(),
        }
        for idx, d in enumerate(voice_dictations, 1)
    ]

    approved = [a for a in clinical_actions if a.get("action_type") == "approved"]
    rejected = [a for a in clinical_actions if a.get("action_type") == "not_approved"]
    now_iso  = datetime.utcnow().isoformat()

    final_summary = post_process_fill(
        summary                     = result.get("final_summary") or {},
        patient                     = patient_record,
        voice_transcripts           = voice_transcripts,
        approved                    = approved,
        rejected                    = rejected,
        all_actions                 = clinical_actions,
        doctor_voice_notes          = doctor_voice_notes,
        image_extractions           = image_extractions,
        doctor_suggestions          = doctor_suggestions,
        approved_image_suggestions  = approved_image_suggestions,
        unified_timeline            = unified_timeline,
        current_status_snapshot     = current_status_snapshot,
        now_iso                     = now_iso,
        patient_id                  = patient_id,
        is_trauma                   = classification["is_trauma"],
        case_type                   = classification["case_type"],
        routing_rationale           = classification["routing_rationale"],
        authoritative_triage        = authoritative_triage,
    )

    # v8 — the LLM's own triage suggestion (from A2, captured BEFORE
    # post_process_fill's deterministic override) is surfaced only at the
    # top level of the API response, never inside the locked 25-section
    # schema, so the schema itself is genuinely unchanged.
    triage_colour_llm_suggested = (
        (result.get("ed_assessment") or {}).get("triage", {}).get("colour")
    )
    triage_colour_final = (
        (final_summary.get("section_10_triage_information") or {}).get("triage_colour")
    )

    output: Dict = {
        "patient_id":                  patient_id,
        "generated_at":                now_iso,
        "processing_time_ms":          elapsed,
        "agent_timings":               result.get("agent_timings", {}),
        "errors":                      result.get("errors", []),
        "case_type":                   classification["case_type"],
        "is_trauma":                   classification["is_trauma"],
        "routing_rationale":           classification["routing_rationale"],
        "triage_colour":               triage_colour_final,
        "triage_colour_llm_suggested": triage_colour_llm_suggested,
        "final_summary":               final_summary,
    }

    if include_raw_data:
        output["intermediate_agent_outputs"] = {
            "A1_clinical_extraction":  result.get("clinical_extraction"),
            "A2_ed_assessment":        result.get("ed_assessment"),
            "unified_timeline":        unified_timeline,
            "current_status_snapshot": current_status_snapshot,
        }

    return output


# ============================================================
# API ENDPOINTS
# ============================================================

@router.post("/ed-summary/generate/{patient_id}")
async def generate_ed_summary(
    patient_id:       str,
    include_raw_data: bool = False,
):
    """
    Generate the complete Final Emergency Department Summary.

    Data fetched in PARALLEL from 7 MongoDB collections:
      patients                    → demographics only
      voice_dictations            → EMT voice note timeline
      clinical_actions            → approved/rejected AI decisions (ascending)
      doctor_voice_notes          → doctor dictation notes
      Image_Extracted_Ambulance   → AI-extracted vitals/findings from images
      Doctor_Suggestion_Ambulance → doctor free-text suggestions
      ApproveImageSuggestion      → approved image AI analyses (incl. vitals_timeline)
                                    *** READ FROM "doctorassist" DB (ROOT FIX) ***

    Pipeline (v8): classify_case_type() [pre-step] → A1 (8b) → A2 (70b) →
    A3 (70b) → post_process_fill (includes deterministic triage colour
    override via compute_triage_colour(), ported from EIDIS).
    """
    start_ms = datetime.now().timestamp() * 1000
    logger.info(f"EDFS v8 generate | patient_id={patient_id}")

    try:
        (
            patient_record,
            voice_dictations,
            clinical_actions,
            doctor_voice_notes,
            image_extractions,
            doctor_suggestions,
            approved_image_suggestions,
            secondary_sources_present,
        ) = await fetch_all_patient_data(patient_id)
    except Exception as e:
        logger.exception(f"DB fetch failed: {e}")
        raise HTTPException(status_code=500, detail=f"Database fetch failed: {str(e)}")

    if not patient_record:
        raise HTTPException(
            status_code=404,
            detail=f"Patient '{patient_id}' not found in patients collection.",
        )

    try:
        result = await run_edfs_pipeline(
            patient_id                  = patient_id,
            patient_record              = patient_record,
            voice_dictations            = voice_dictations,
            clinical_actions            = clinical_actions,
            doctor_voice_notes          = doctor_voice_notes,
            image_extractions           = image_extractions,
            doctor_suggestions          = doctor_suggestions,
            approved_image_suggestions  = approved_image_suggestions,
            include_raw_data            = include_raw_data,
        )
    except Exception as e:
        logger.exception(f"Pipeline error: {e}")
        raise HTTPException(status_code=500, detail=f"Pipeline error: {str(e)}")

    try:
        await ed_summaries_collection.insert_one({
            "patient_id":                      patient_id,
            "generated_at":                    datetime.utcnow(),
            "dictation_count":                 len(voice_dictations),
            "action_count":                    len(clinical_actions),
            "doctor_voice_note_count":         len(doctor_voice_notes),
            "image_extraction_count":          len(image_extractions),
            "doctor_suggestion_count":         len(doctor_suggestions),
            "approved_image_suggestion_count": len(approved_image_suggestions),
            "secondary_sources_present":       secondary_sources_present,
            "approve_image_db_used":           APPROVE_IMAGE_DB_NAME,
            "case_type":                       result.get("case_type"),
            "is_trauma":                       result.get("is_trauma"),
            "routing_rationale":               result.get("routing_rationale"),
            "triage_colour":                   result.get("triage_colour"),
            "triage_colour_llm_suggested":      result.get("triage_colour_llm_suggested"),
            "agent_timings":                   result.get("agent_timings"),
            "final_summary":                   result.get("final_summary"),
            "edfs_version":                    "8.0",
        })
        logger.info(f"Saved ED summary v8 for patient {patient_id}")
    except Exception as e:
        logger.error(f"MongoDB save failed (non-fatal): {e}")

    elapsed = round(datetime.now().timestamp() * 1000 - start_ms)

    return {
        "status":                          "success",
        "patient_id":                      patient_id,
        "generated_at":                    datetime.utcnow().isoformat(),
        "processing_time_ms":              elapsed,
        "dictation_count":                 len(voice_dictations),
        "clinical_action_count":           len(clinical_actions),
        "doctor_voice_note_count":         len(doctor_voice_notes),
        "image_extraction_count":          len(image_extractions),
        "doctor_suggestion_count":         len(doctor_suggestions),
        "approved_image_suggestion_count": len(approved_image_suggestions),
        "approve_image_db_used":           APPROVE_IMAGE_DB_NAME,
        "secondary_sources_present":       secondary_sources_present,
        "case_type":                       result.get("case_type"),
        "is_trauma":                       result.get("is_trauma"),
        "routing_rationale":               result.get("routing_rationale"),
        "triage_colour":                   result.get("triage_colour"),
        "triage_colour_llm_suggested":      result.get("triage_colour_llm_suggested"),
        "result":                          result,
    }


@router.get("/ed-summary/latest/{patient_id}")
async def get_latest_ed_summary(patient_id: str):
    """Retrieve the most recently stored ED summary. Does NOT re-run the pipeline."""
    try:
        cursor = ed_summaries_collection.find(
            {"patient_id": patient_id}, {"_id": 0}
        ).sort("generated_at", -1).limit(1)
        docs = await cursor.to_list(length=1)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if not docs:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No ED summary found for '{patient_id}'. "
                f"Run POST /ed-summary/generate/{patient_id} first."
            ),
        )
    return {
        "status":     "success",
        "patient_id": patient_id,
        "result":     serialize_doc(docs[0]),
    }


@router.get("/ed-summary/history/{patient_id}")
async def get_ed_summary_history(patient_id: str, limit: int = 10):
    """List past ED summary runs for a patient (newest first)."""
    try:
        cursor = ed_summaries_collection.find(
            {"patient_id": patient_id},
            {
                "_id": 0, "patient_id": 1, "generated_at": 1,
                "dictation_count": 1, "action_count": 1,
                "doctor_voice_note_count": 1, "image_extraction_count": 1,
                "doctor_suggestion_count": 1,
                "approved_image_suggestion_count": 1,
                "approve_image_db_used": 1,
                "secondary_sources_present": 1, "agent_timings": 1,
                "case_type": 1, "is_trauma": 1, "routing_rationale": 1,
                "triage_colour": 1, "triage_colour_llm_suggested": 1,
            },
        ).sort("generated_at", -1).limit(limit)
        docs = await cursor.to_list(length=limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "status":     "success",
        "patient_id": patient_id,
        "total":      len(docs),
        "summaries":  [serialize_doc(d) for d in docs],
    }


@router.get("/ed-summary/health")
async def edfs_health():
    try:
        await emergency_patients_collection.count_documents({})
        db_status = "connected"
    except Exception:
        db_status = "disconnected"

    approve_img_status = "unknown"
    try:
        count = await approve_image_suggestion_collection.count_documents({})
        approve_img_status = f"connected — {count} documents total"
    except Exception as e:
        approve_img_status = f"ERROR: {str(e)}"

    return {
        "status":            "ok",
        "system":            "EDFS — Emergency Department Final Summary System (v8)",
        "version":           "8.0.0",
        "agents":            3,
        "workflow_compiled": edfs_workflow is not None,
        "v8_case_type_and_triage_fixes": [
            "NEW classify_case_type() — I0-style fast-model classifier (is_trauma/case_type/"
            "routing_rationale), run BEFORE A1, threaded into A1/A2/A3 prompts and "
            "post_process_fill. Same pattern as EIDIS's I0 / EVIS's A0.",
            "Section 23 SBAR (situation/assessment/recommendation) REBUILT to be entirely "
            "data-driven — replaced hardcoded trauma/RTA content (head trauma, abrasions, "
            "haemorrhage, spinal cord injury, CT Head/Chest/Abdomen-Pelvis, Full Trauma Team) "
            "that previously fired for every patient with a doctor note regardless of actual "
            "presentation. Now built from working_diagnosis, differential_diagnoses, "
            "specialist_alerts, suggested_investigations, chief_complaint, and is_trauma — no "
            "second hardcoded panel substituted in; unavailable data points are simply omitted.",
            "FIX L (PREDICT-HF) now uses the classifier's is_trauma directly instead of solely "
            "re-deriving it from a mechanism keyword match (keyword match kept only as a "
            "fallback when classification is unavailable).",
            "NEW compute_triage_colour() — ported byte-for-byte from EIDIS v3.1's shared "
            "deterministic triage function. Overrides section_10.triage_colour in place (same "
            "key, same schema) so triage can no longer diverge between the insurance package, "
            "this ED summary, and the structured note for the same patient. The LLM's own "
            "suggestion is preserved only in the top-level API response as "
            "triage_colour_llm_suggested, never inside the locked 25-section object.",
            "Guardrail rules ported from EVIS v4.2 / EIDIS v3.1 — STABILITY_LABELING_RULE, "
            "DIAGNOSTIC_HEDGING_RULE, EVIDENCE_TRACEABILITY_RULE — injected into A1, A2, A3.",
        ],
        "v7_clinical_validation_fixes": [
            "FIX M: SpO₂ always populated — vitals_timeline dict first, then raw OCR regex "
            "fallback on vitals_timeline.raw_extracted_text, then Image_Extracted_Ambulance "
            "extracted_text. SpO₂ (and all other vitals) will never be null if present in any source.",
            "FIX N: C_circulation 'Stable' now also corrected (v6 only caught 'Unstable'). "
            "When HR absent + BP normal + doctor confirms instability → 'Unknown — requires "
            "reassessment'. Prevents false reassurance of stability to receiving team.",
            "FIX O: SBAR situation built deterministically from registration demographics only. "
            "Monitor OCR age never appears in SBAR. Age discrepancy note appended to situation "
            "field as a bracketed safety annotation.",
            "FIX P: Section 13 skin_findings no longer receives monitor/pump data. "
            "impressive_findings from image analysis goes into section_13.monitor_clinical_data "
            "(new dedicated field). skin_findings populated from actual physical exam observations only.",
            "FIX Q: Section 18 specialist alerts cleaned — null-specialty entries (monitor "
            "physician_alert content) removed. physician_alert content moved to section 21 "
            "outstanding_issues with clear provenance label.",
            "FIX R: Section 17 overall_trend guard now counts only IMAGE_EXTRACTED_VITALS "
            "(not APPROVED_IMAGE_ANALYSIS which is derived from the same event). Prevents "
            "double-counting inflating the vital reading count and bypassing the guard.",
            "FIX S: Section 7 ai_generated_summary now uses SBAR situation from the approved "
            "AI clinical suggestion, not the image AI impression. Image AI impression stored "
            "separately in section_7.image_ai_impression with a context note explaining its "
            "limited scope (monitor data only).",
        ],
        "v6_fixes_inherited": [
            "ROOT CAUSE FIX: APPROVE_IMAGE_DB_NAME = 'doctorassist'",
            "FIX G: SpO₂ _is_null_value() guard",
            "FIX H: Pump data per-pump loop + total_fluid_infused_ml",
            "FIX I: haemodynamic_status 'Unknown' prompt + post-process guard",
            "FIX J: overall_trend 'Unknown' prompt + post-process guard (now superseded by FIX R)",
            "FIX K: Age/gender discrepancy detection and flagging in sections 21, 22, 25",
            "FIX A: Section 20 condition_at_disposition always overwritten from doctor note",
            "FIX B: doctor_voice_notes naive-UTC timestamps normalised",
            "F11: Section 11 D_disability / AVPU hedge for conflicting consciousness claims",
            "F2: Section 17 always rebuilt from full unified_timeline",
            "F3: Section 19 key_events always rebuilt",
            "F4: Section 23 SBAR recommendation always in-hospital",
            "F5: Section 10 triage_rationale appends doctor note",
            "F7: Section 20 condition_at_disposition from doctor note",
            "F8: Section 21 narrative appended with doctor note",
            "F9: Section 22 handover critical_points includes doctor note",
            "F10: approved_image_suggestion_count always accurate",
        ],
        "agent_pipeline": [
            "I0 · Case-Type Classifier      (llama-3.1-8b-instant)     — pre-step, NEW v8",
            "A1 · Clinical Data Extractor    (llama-3.1-8b-instant)    — 7-source extraction",
            "A2 · ED Assessment & Diagnosis  (llama-3.3-70b-versatile)  — ATLS/ABCDE, triage",
            "A3 · Final ED Summary Synth     (llama-3.3-70b-versatile)  — 25-section output",
            "   · post_process_fill v8       (Python — zero LLM cost)   — deterministic patches "
            "+ compute_triage_colour() override",
        ],
        "data_sources": [
            "MongoDB: patients                    (demographics — doctorassistai)",
            "MongoDB: voice_dictations            (EMT voice notes — doctorassistai)",
            "MongoDB: clinical_actions            (approved/rejected — doctorassistai)",
            "MongoDB: doctor_voice_notes          (doctor dictation — doctorassistai)",
            "MongoDB: Image_Extracted_Ambulance   (image vitals — doctorassistai)",
            "MongoDB: Doctor_Suggestion_Ambulance (doctor suggestions — doctorassistai)",
            f"MongoDB: ApproveImageSuggestion      (approved image analyses — {APPROVE_IMAGE_DB_NAME})",
        ],
        "temporal_precedence": (
            "Doctor voice note > Approved AI suggestion > Image extraction > "
            "NOT_APPROVED EMT dictation > Earlier EMT voice note"
        ),
        "db_status":                       db_status,
        "approve_image_db_name_in_use":    APPROVE_IMAGE_DB_NAME,
        "approve_image_collection_status": approve_img_status,
    }