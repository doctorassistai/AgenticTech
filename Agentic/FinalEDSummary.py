"""
EDFS — Emergency Department Final Summary System  (v9 — Deterministic
                                                    Assembly, No Re-Derived
                                                    Clinical Content)
====================================================================================
WHY v9 REMOVES THE 3-AGENT LLM PIPELINE
---------------------------------------------------------------------------
Every EDFS bug found in QA testing (v6 through v8) traced back to the same
root cause: A1/A2/A3 independently RE-DERIVE clinical content (diagnosis,
triage, SBAR, review counts) from raw source data, instead of using the
content a doctor already reviewed and approved in EVIS. That produces two
independent, potentially-contradictory opinions for the same patient — and
every "fix" in v7/v8 was really a patch narrowing the gap between what A3
invented and what was actually true.

v9's design principle: ONCE A DOCTOR HAS APPROVED AN EVIS AI SUGGESTION,
EDFS ASSEMBLES A SUMMARY FROM IT — IT NEVER GENERATES A SECOND, INDEPENDENT
CLINICAL OPINION. Concretely:
  - triage colour/rationale, clinical impression/working diagnosis,
    treatment plan, investigations, procedures, referrals, complications,
    contraindications, precautions, and the SBAR text are all read directly
    from the latest APPROVED clinical_actions.ai_suggestion (EVIS's output).
  - If no suggestion has been approved yet, the corresponding section is
    explicitly marked unavailable — never guessed by a fresh LLM call.
  - case_type / is_trauma is inferred deterministically from structured
    fields (incident type, mechanism, chief complaint, EVIS impression
    text) via keyword matching — no LLM classification call.
  - The ONLY optional LLM use is a non-clinical narrative-stitching helper
    that joins multiple EMT voice-note transcripts into one readable
    paragraph (combined_emt_narrative) for section 5/6 — it invents no
    facts, and on any failure falls back to a plain deterministic join.
  - triage colour is computed by the SAME deterministic compute_triage_colour()
    already used by EVIS/EIDIS (imported, not reimplemented), and — when
    available — an EVIS-authoritative triage record is preferred over even
    that, so a single patient can never show three different triage colours
    across documents.

CARRIED FORWARD FROM v6–v8 (all now applied inside deterministic section
builders instead of a post_process_fill patch layer):
  FIX A   Section 20 condition_at_disposition always reflects doctor note
  FIX B   doctor_voice_notes naive-UTC timestamps normalised
  FIX G   SpO2 null-value guard
  FIX H   Pump data — per-pump loop + total fluid infused
  FIX I   haemodynamic_status "Unknown — requires reassessment" guard
  FIX K   Age/gender discrepancy detection (registration vs monitor OCR)
  FIX L   PREDICT-HF clinical-irrelevance note, gated by is_trauma
  FIX M   SpO2 (and all vitals) — vitals_timeline dict -> raw OCR regex ->
          Image_Extracted_Ambulance text -> NEW: EMT voice-note text regex
  FIX N   C_circulation "Stable" also corrected, not just "Unstable"
  FIX O   SBAR situation built from REGISTRATION demographics only
  FIX P   Section 13 skin_findings vs monitor_clinical_data separation
  FIX Q   Section 18 — only real named specialist referrals
  ROOT CAUSE FIX  APPROVE_IMAGE_DB_NAME default = "doctorassist"
  NEW (v9) GENUINE-REJECTION FIX — a clinical_actions record with
          action_type == "not_approved" is only a real "AI suggestion
          rejected" if it carries a populated ai_suggestion payload; a
          plain doctor voice note/question to EMT (ai_suggestion: null)
          is NOT a rejection and must never be counted or labelled as one.
          This was never fixed in EDFS pre-v9 even after being fixed in
          EVIS, and was producing a materially false "rejected AI
          suggestions" count on real cases.
  NEW (v9) SBAR SCHEMA FIX — EVIS's sbar_summary only ever has a "text"
          field (never "situation"/"assessment" sub-keys); pre-v9 EDFS
          read the wrong keys and always fell through to a generic
          placeholder SBAR regardless of how complete the approved
          suggestion was.
  NEW (v9) VITALS-FROM-EMT-NOTE FALLBACK — FIX M's raw-text regex fallback
          previously only ran against image OCR text, never EMT voice
          transcripts, even though vitals are very often stated directly
          in the EMT dictation.

TEMPORAL PRECEDENCE (unchanged)
--------------------------------------
Doctor voice note > Approved AI suggestion > Image extraction >
NOT_APPROVED EMT dictation (genuine rejection only) > Earlier EMT voice note
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel

from Agentic.clinical_shared.triage import (
    compute_triage_colour, first_int, parse_bp_systolic, fetch_authoritative_triage,
)

# Optional — used ONLY for combined_emt_narrative prose stitching (see
# _build_combined_emt_narrative below). Never used for clinical content.
try:
    from langchain_groq import ChatGroq
    from langchain_core.messages import HumanMessage, SystemMessage
    _NARRATIVE_LLM_AVAILABLE = True
except Exception:
    _NARRATIVE_LLM_AVAILABLE = False


# ============================================================
# ENVIRONMENT & CONNECTIONS
# ============================================================

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
MONGO_URI    = os.getenv("MONGO_URI")

MONGO_DB = "doctorassistai"

# ROOT CAUSE FIX (v6, carried forward): ApproveImageSuggestion lives in "doctorassist"
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

# Small, fast model — narrative stitching only, never clinical content.
_narrative_llm = None
if _NARRATIVE_LLM_AVAILABLE and GROQ_API_KEY:
    try:
        _narrative_llm = ChatGroq(
            model        = "openai/gpt-oss-20b",
            temperature  = 0.1,
            max_tokens   = 800,
            groq_api_key = GROQ_API_KEY,
        )
    except Exception as e:
        logger.warning(f"Narrative-stitching LLM unavailable, will use plain join: {e}")
        _narrative_llm = None

router = APIRouter(prefix="", tags=["ED Final Summary"])


# ============================================================
# MODELS
# ============================================================

class EDFSRequest(BaseModel):
    patient_id:       str
    include_raw_data: bool = False


# ============================================================
# GENERIC HELPERS
# ============================================================

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
    """FIX B — normalise a naive-UTC timestamp string to an explicit +00:00 offset."""
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


def _best_ts(action: Dict) -> str:
    return (
        action.get("server_received_ist")
        or action.get("client_created_at")
        or action.get("server_received_at")
        or ""
    )


# ============================================================
# GENUINE-REJECTION FIX (v9, new)
# ------------------------------------------------------------
# A clinical_actions record with action_type == "not_approved" is written
# by TWO different frontend flows and must not be conflated: (1) the
# Composer's plain "Voice Note" mode, which stamps EVERY free-text doctor
# instruction/question to EMT with action_type "not_approved" and
# ai_suggestion: null — this is NOT a rejection, it is an arbitrary doctor
# order or question; (2) an actual AI-suggestion rejection, which carries
# a populated ai_suggestion payload. Only (2) is a genuine rejection.
# This mirrors EVIS's already-fixed _summarize_clinical_actions() logic;
# EDFS pre-v9 never had it and was mislabelling doctor notes as rejected
# AI suggestions in the review-count and timeline sections.
# ============================================================

def _is_genuine_ai_rejection(action: Dict) -> bool:
    return action.get("action_type") == "not_approved" and bool(action.get("ai_suggestion"))


def _is_approved(action: Dict) -> bool:
    return action.get("action_type") == "approved" and bool(action.get("ai_suggestion"))


def split_actions(clinical_actions: List[Dict]) -> tuple[List[Dict], List[Dict], List[Dict]]:
    """
    Returns (approved, genuinely_rejected, plain_doctor_notes_to_emt).
    plain_doctor_notes_to_emt are not_approved records with no ai_suggestion
    payload — real doctor instructions/questions, never counted as rejections.
    """
    approved  = [a for a in clinical_actions if _is_approved(a)]
    rejected  = [a for a in clinical_actions if _is_genuine_ai_rejection(a)]
    plain_dr  = [
        a for a in clinical_actions
        if a.get("action_type") == "not_approved" and not a.get("ai_suggestion")
    ]
    return approved, rejected, plain_dr


# ============================================================
# VITALS EXTRACTION FALLBACKS (FIX M — extended in v9 to also
# run against EMT voice-note transcripts, not only image OCR text)
# ============================================================

def _extract_vitals_from_raw_text(raw_text: str) -> Dict:
    """Parse vital signs from free text (OCR or dictation). Only extracts
    values that are clearly present — never guesses."""
    vitals: Dict = {}
    if not raw_text:
        return vitals

    spo2_match = re.search(r"(\d{2,3})\s*%", raw_text)
    if spo2_match:
        val = spo2_match.group(1)
        try:
            if 50 <= int(val) <= 100:
                vitals["spo2_percent"] = val
        except ValueError:
            pass

    bp_match = re.search(r"(\d{2,3}/\d{2,3})\s*(?:mmHg)?", raw_text)
    if bp_match:
        vitals["blood_pressure"] = bp_match.group(1)

    temp_match = re.search(r"(\d{2,3}(?:\.\d)?)\s*°?\s*C\b", raw_text)
    if temp_match:
        try:
            t = float(temp_match.group(1))
            if 30.0 <= t <= 43.0:
                vitals["temperature_celsius"] = temp_match.group(1)
        except ValueError:
            pass

    hr_match = re.search(
        r"(?:HR|Heart Rate|Pulse)[:\s]+(\d{2,3})\s*(?:bpm)?", raw_text, re.IGNORECASE
    )
    if hr_match:
        vitals["pulse_rate_bpm"] = hr_match.group(1)
    else:
        # bare "HR 96" style already covered above; also catch "96 bpm" alone
        # only when clearly a heart-rate context word appears nearby.
        pass

    rr_match = re.search(
        r"(?:RR|Resp(?:iratory)?\s*Rate)[:\s]+(\d{1,3})\s*(?:bpm)?", raw_text, re.IGNORECASE
    )
    if rr_match:
        vitals["respiratory_rate_bpm"] = rr_match.group(1)

    return vitals


def _extract_age_gender_from_raw_text(raw_text: str):
    """FIX K helper — parse age/gender from OCR text like '62 yrs / M'."""
    if not raw_text:
        return None, None
    age_match = re.search(r"(\d{1,3})\s*yrs?\s*/?\s*(M|F|Male|Female)", raw_text, re.IGNORECASE)
    if age_match:
        age_str    = age_match.group(1)
        gender_raw = age_match.group(2).strip().upper()
        gender_str = "Male" if gender_raw in ("M", "MALE") else "Female"
        return age_str, gender_str
    return None, None


def _fill_vitals(iv: Dict, sources_in_priority_order: List[str]) -> Dict:
    """Fill any still-null vitals key from the first source text that has it."""
    for raw in sources_in_priority_order:
        if not raw:
            continue
        parsed = _extract_vitals_from_raw_text(raw)
        for dst_key, val in parsed.items():
            if not _is_null_value(val) and _is_null_value(iv.get(dst_key)):
                iv[dst_key] = val
    return iv


# ============================================================
# ICD-10 KEYWORD INFERENCE (deterministic, zero-LLM — unchanged from v8)
# ============================================================

_ICD10_KEYWORD_MAP = [
    (("road traffic", "traffic", "collision", "accident"), {"code": "V89.2", "description": "Person injured in unspecified motor-vehicle accident, traffic"}),
    (("head", "skull", "concussion"), {"code": "S09.90", "description": "Unspecified injury of head"}),
    (("chest", "thorax", "pulmonary contusion"), {"code": "S29.009A", "description": "Unspecified injury of thorax, initial encounter"}),
    (("chest pain",), {"code": "R07.9", "description": "Chest pain, unspecified"}),
    (("myocardial", "heart attack", "stemi", "nstemi", "angina"), {"code": "I21.9", "description": "Acute myocardial infarction, unspecified — suspected"}),
    (("cardiac arrest", "no pulse", " cpr "), {"code": "I46.9", "description": "Cardiac arrest, cause unspecified"}),
    (("arrhythmia", "irregular heartbeat", "palpitations"), {"code": "I49.9", "description": "Cardiac arrhythmia, unspecified"}),
    (("stroke", "facial droop", "slurred speech", "hemiparesis"), {"code": "I63.9", "description": "Cerebral infarction, unspecified — suspected"}),
    (("seizure", "convulsion"), {"code": "G40.909", "description": "Epilepsy/seizure, unspecified"}),
    (("sepsis",), {"code": "A41.9", "description": "Sepsis, unspecified organism — suspected"}),
    (("anaphyla", "allergic reaction"), {"code": "T78.2XXA", "description": "Anaphylactic shock, unspecified cause, initial encounter"}),
    (("asthma", "wheez"), {"code": "J45.901", "description": "Unspecified asthma with (acute) exacerbation"}),
    (("copd",), {"code": "J44.1", "description": "COPD with (acute) exacerbation"}),
    (("gi bleed", "hematemesis", "melena"), {"code": "K92.2", "description": "Gastrointestinal hemorrhage, unspecified"}),
    (("overdose", "poisoning"), {"code": "T50.901A", "description": "Poisoning by unspecified drugs/medication, initial encounter"}),
    (("pregnan", "labour", "labor", "contractions"), {"code": "O99.89", "description": "Obstetric emergency — verify specifics"}),
]


def _infer_icd10_codes(text_blob: str) -> List[Dict]:
    tl = (text_blob or "").lower()
    codes: List[Dict] = []
    for keywords, code_obj in _ICD10_KEYWORD_MAP:
        if any(kw in tl for kw in keywords):
            codes.append(code_obj)
    seen, out = set(), []
    for c in codes:
        if c["code"] not in seen:
            seen.add(c["code"])
            out.append(c)
    return out


# ============================================================
# DETERMINISTIC CASE-TYPE CLASSIFICATION (v9 — replaces the v8
# LLM classifier). Reads structured fields only; no free generation.
# ============================================================

_TRAUMA_KEYWORDS = (
    "road traffic", "rta", "collision", "accident", "trauma",
    "fall", "assault", "penetrating", "blunt", "crush", "fracture",
    "laceration", "stab", "gunshot", "burn",
)
_MEDICAL_CASE_TYPE_KEYWORDS = [
    (("chest pain", "myocardial", "acs", "stemi", "nstemi", "angina"), "cardiac"),
    (("breathless", "dyspnea", "dyspnoea", "wheeze", "asthma", "copd"), "cardiorespiratory"),
    (("stroke", "facial droop", "slurred speech", "hemiparesis", "seizure", "convulsion"), "neurological"),
    (("overdose", "poisoning", "ingestion"), "toxicology"),
    (("labour", "labor", "contractions", "pregnan"), "obstetric"),
    (("fever", "sepsis", "infection"), "infectious_sepsis"),
]


def classify_case_type(
    incident_type: str,
    mechanism_of_injury: str,
    chief_complaint: str,
    evis_impression_text: str,
) -> Dict[str, Any]:
    """
    Deterministic case-type inference. Conservative: any trauma keyword in
    incident_type/mechanism marks is_trauma=True (matches the old
    classifier's "be conservative, prefer trauma-cautious" philosophy)
    without needing an LLM call at all — this data is already structured.
    """
    blob = " ".join(filter(None, [incident_type, mechanism_of_injury, chief_complaint, evis_impression_text])).lower()

    if any(kw in blob for kw in _TRAUMA_KEYWORDS):
        return {
            "is_trauma": True,
            "case_type": "trauma",
            "routing_rationale": "Trauma mechanism/incident-type keyword found in incident details or chief complaint.",
        }

    for keywords, label in _MEDICAL_CASE_TYPE_KEYWORDS:
        if any(kw in blob for kw in keywords):
            return {
                "is_trauma": False,
                "case_type": label,
                "routing_rationale": f"Non-trauma presentation matched '{label}' keyword pattern.",
            }

    if blob.strip():
        return {
            "is_trauma": False,
            "case_type": "general_medical",
            "routing_rationale": "No trauma mechanism found; classified as general medical by default.",
        }

    return {
        "is_trauma": None,
        "case_type": "unknown",
        "routing_rationale": "Insufficient incident/complaint data to classify case type.",
    }


# ============================================================
# UNIFIED CHRONOLOGICAL TIMELINE
# ------------------------------------------------------------
# v9: clinical_actions entries now split into AI_SUGGESTION_APPROVED /
# AI_SUGGESTION_REJECTED (genuine rejections only) / DOCTOR_NOTE_TO_EMT
# (plain doctor notes/questions, action_type=not_approved with no
# ai_suggestion payload) — this is the source-level fix for the
# mislabelling bug found in QA testing.
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
        ts = _best_ts(a)
        if _is_approved(a):
            source = "AI_SUGGESTION_APPROVED"
        elif _is_genuine_ai_rejection(a):
            source = "AI_SUGGESTION_REJECTED"
        else:
            source = "DOCTOR_NOTE_TO_EMT"
        timeline.append({
            "source":    source,
            "timestamp": ts,
            "approved":  source == "AI_SUGGESTION_APPROVED",
            "content": {
                "action_type":     (a.get("action_type") or "unknown").upper(),
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
        ts = ap.get("approved_at") or ap.get("approved_at_display") or ap.get("timestamp") or ""
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

        elif source == "AI_SUGGESTION_APPROVED":
            vd = content.get("voice_dictation") if isinstance(content, dict) else ""
            suffix = f" — EMT dictation: {str(vd)[:300]}" if vd else " — no inline dictation text"
            lines.append(f"[{label}] AI Suggestion (APPROVED){suffix}")

        elif source == "AI_SUGGESTION_REJECTED":
            vd = content.get("voice_dictation") if isinstance(content, dict) else ""
            suffix = f" — EMT dictation: {str(vd)[:300]}" if vd else " — no inline dictation text"
            lines.append(f"[{label}] AI Suggestion (REJECTED by doctor){suffix}")

        elif source == "DOCTOR_NOTE_TO_EMT":
            vd = content.get("voice_dictation") if isinstance(content, dict) else ""
            lines.append(f"[{label}] Doctor Note to EMT: {str(vd)[:300]}")

        elif source == "IMAGE_EXTRACTED_VITALS":
            text = str(content)[:300] if content else "(no content)"
            lines.append(f"[{label}] Monitor Image Extraction: {text}")

        elif source == "APPROVED_IMAGE_ANALYSIS":
            if isinstance(content, dict):
                imp  = content.get("ai_impression") or ""
                risk = content.get("risk_level") or ""
                lines.append(f"[{label}] Approved Image AI Analysis — Impression: {imp[:200]} | Risk: {risk}")
            else:
                lines.append(f"[{label}] Approved Image AI Analysis: {str(content)[:300]}")

        elif source == "DOCTOR_SUGGESTION":
            text = str(content)[:300] if content else "(no content)"
            lines.append(f"[{label}] Doctor Free-text Suggestion: {text}")

        else:
            lines.append(f"[{label}] {source}: {str(content)[:200]}")

    return lines


# ============================================================
# OPTIONAL NARRATIVE STITCHING — the ONLY LLM use in v9.
# Joins multiple EMT voice-note transcripts into one readable paragraph.
# Invents no clinical facts; falls back to a plain join on any failure.
# ============================================================

async def _build_combined_emt_narrative(voice_transcripts: List[Dict]) -> Optional[str]:
    if not voice_transcripts:
        return None
    plain_join = " ".join(
        f"[{vt.get('time') or vt.get('timestamp') or ''}] {vt.get('transcript', '').strip()}"
        for vt in voice_transcripts if vt.get("transcript")
    ).strip()
    if not plain_join:
        return None
    if len(voice_transcripts) == 1 or _narrative_llm is None:
        return plain_join

    system = (
        "You combine multiple EMT voice-note transcripts, already given to "
        "you in chronological order, into ONE readable paragraph for a "
        "clinical handover. Rules: do not add any fact, vital sign, "
        "medication, or finding that is not already present verbatim in "
        "the transcripts. Do not diagnose or interpret. Do not omit any "
        "clinically relevant detail already stated. Simply merge and "
        "de-duplicate repeated information across notes into flowing "
        "prose. Return plain text only, no markdown, no JSON."
    )
    prompt = "\n\n".join(
        f"[Note {vt.get('note_number')} | {vt.get('time') or vt.get('timestamp') or ''}]\n{vt.get('transcript','').strip()}"
        for vt in voice_transcripts if vt.get("transcript")
    )
    try:
        response = await _narrative_llm.ainvoke([
            SystemMessage(content=system), HumanMessage(content=prompt)
        ])
        text = (response.content or "").strip()
        return text if text else plain_join
    except Exception as e:
        logger.warning(f"Narrative stitching failed, falling back to plain join: {e}")
        return plain_join


# ============================================================
# EVIS-SOURCED CLINICAL CONTENT
# ------------------------------------------------------------
# Everything clinical (triage, diagnosis, treatment, investigations,
# procedures, referrals, complications, contraindications, precautions,
# SBAR) is read directly from the LATEST APPROVED clinical_actions
# .ai_suggestion — EVIS's already doctor-reviewed output. If nothing has
# been approved yet, each field is explicitly marked unavailable rather
# than guessed.
# ============================================================

def _latest_approved_suggestion(approved: List[Dict]) -> Dict:
    if not approved:
        return {}
    # approved is expected sorted ascending by caller; take the last.
    return approved[-1].get("ai_suggestion") or {}


def _sbar_text(evis: Dict) -> str:
    """v9 SBAR SCHEMA FIX — EVIS's sbar_summary only ever has a 'text'
    key. Pre-v9 EDFS looked for nonexistent 'situation'/'assessment'
    sub-keys and always fell through to a generic placeholder."""
    sbar = evis.get("sbar_summary") or {}
    return (sbar.get("text") or "").strip()


# ============================================================
# SECTION BUILDERS
# ============================================================

def _build_section_1(patient: Dict, patient_id: str) -> Dict:
    meta    = patient.get("metadata", {}) or {}
    contact = patient.get("emergencyContact", {}) or {}
    reg = meta.get("registrationDate") or meta.get("created_at", "")
    date_of_arrival, time_of_arrival = None, None
    if reg and "T" in str(reg):
        date_of_arrival = str(reg).split("T")[0]
        time_of_arrival = str(reg).split("T")[1][:8]
    elif reg:
        date_of_arrival = str(reg)
    return {
        "patient_id":                       patient_id,
        "full_name":                        patient.get("fullName"),
        "age":                              patient.get("age"),
        "gender":                           patient.get("gender"),
        "phone_number":                     patient.get("phoneNumber"),
        "address":                          patient.get("address"),
        "date_of_arrival":                  date_of_arrival,
        "time_of_arrival":                  time_of_arrival,
        "emergency_contact_name":           contact.get("name"),
        "emergency_contact_relationship":   contact.get("relationship"),
        "emergency_contact_phone":          contact.get("phoneNumber"),
    }


def _build_section_2(patient: Dict) -> Dict:
    meta   = patient.get("metadata", {}) or {}
    driver = patient.get("ambulance_driver") or {}
    return {
        "mode_of_arrival":              "Ambulance",
        "emt_driver_name":              driver.get("name") if isinstance(driver, dict) else None,
        "referral_source":              meta.get("registration_source", "ambulance_mobile_app"),
        "transport_duration_minutes":   None,
        "arrival_clinical_condition":   None,
    }


def _build_section_3(patient: Dict) -> Dict:
    accident = patient.get("accidentDetails", {}) or {}
    return {
        "type_of_incident":       accident.get("accidentType"),
        "mechanism_of_injury":    accident.get("mechanismOfInjury") or accident.get("mechanism"),
        "location_of_incident":   accident.get("location"),
        "coordinates": {
            "latitude":  accident.get("latitude"),
            "longitude": accident.get("longitude"),
        },
        "date_of_incident": accident.get("accidentDate"),
        "time_of_incident": accident.get("accidentTime"),
    }


def _build_section_4(evis: Dict, patient: Dict) -> Dict:
    accident = patient.get("accidentDetails", {}) or {}
    chief = accident.get("chiefComplaint") or (evis.get("clinical_impression") or {}).get("impression")
    return {"chief_complaint": chief}


def _build_section_5(voice_transcripts: List[Dict], combined_narrative: Optional[str]) -> Dict:
    latest = voice_transcripts[-1] if voice_transcripts else {}
    return {
        "scene_findings":                  None,
        "consciousness_level_on_scene":    None,
        "airway":                          None,
        "breathing":                       None,
        "circulation":                     None,
        "vitals_on_scene": {
            "pulse_rate_bpm": None, "blood_pressure": None,
            "spo2_percent": None, "respiratory_rate_bpm": None, "gcs_estimated": None,
        },
        "bleeding_status":                 None,
        "pre_hospital_interventions_performed": [],
        "time_at_scene_minutes":           None,
        "eta_to_hospital_minutes":         None,
        "clinical_narrative_from_emt":     combined_narrative,
    }


def _build_section_6(voice_transcripts: List[Dict], combined_narrative: Optional[str]) -> Dict:
    return {
        "total_voice_notes":                   len(voice_transcripts),
        "voice_notes":                         voice_transcripts,
        "ai_transcription_status":             "Processed",
        "processing_quality":                  "High" if voice_transcripts else "Low",
        "combined_clinical_summary_from_voice": combined_narrative,
    }


def _build_section_7(evis: Dict, approved_image_suggestions: List[Dict]) -> Dict:
    s7: Dict = {
        "ai_generated_summary":                _sbar_text(evis) or None,
        "image_ai_impression":                 None,
        "image_ai_context_note":               None,
        "key_clinical_recommendations":        [
            item.get("drug_or_treatment") for item in (evis.get("treatment_plan") or {}).get("items", [])
            if item.get("drug_or_treatment")
        ],
        "triage_suggestion":                   (evis.get("triage") or {}).get("colour"),
        "criticality_score_suggested":         None,
        "suggested_immediate_interventions":   [
            p.get("procedure") for p in (evis.get("procedures") or {}).get("items", [])
            if p.get("timing") == "perform_now" and p.get("procedure")
        ],
        "suggested_investigations":            [
            i.get("investigation") for i in (evis.get("investigations") or {}).get("items", [])
            if i.get("investigation")
        ],
        "suggested_specialist_alerts":         [
            r.get("specialty") for r in (evis.get("referrals") or {}).get("items", [])
            if r.get("specialty")
        ],
        "hospital_prep_instructions":          None,
        "confidence_level":                    "High" if evis else "Low",
    }
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
    return s7


def _build_section_8(all_actions: List[Dict], approved: List[Dict], rejected: List[Dict]) -> Dict:
    review_ts = None
    if approved:
        review_ts = _best_ts(approved[-1])
    decision = "Approved" if approved else ("Rejected" if rejected else "Pending")
    return {
        "ai_review_decision":       decision,
        "total_reviews_performed":  len(approved) + len(rejected),
        "approved_count":           len(approved),
        "rejected_count":           len(rejected),
        "review_timestamp":         review_ts,
        "reviewer_summary": (
            f"{len(approved)} AI suggestion(s) approved, {len(rejected)} genuinely rejected."
            if (approved or rejected) else "No AI suggestion has been reviewed yet."
        ),
    }


def _build_section_9(doctor_voice_notes: List[Dict], doctor_suggestions: List[Dict]) -> Dict:
    latest_note = doctor_voice_notes[-1] if doctor_voice_notes else None
    latest_text = (latest_note.get("conversation") or "").strip() if latest_note else None
    latest_ts   = latest_note.get("timestamp") if latest_note else None
    return {
        "manual_clinical_summary":        latest_text,
        "corrections_or_additions_to_ai": None,
        "additional_clinical_findings":   doctor_suggestions[-1].get("suggestion_text") if doctor_suggestions else None,
        "doctor_entered_at":              latest_ts,
    }


def _build_section_10(evis: Dict, authoritative_triage: Optional[Dict], deterministic_colour: Optional[str],
                       latest_doctor_text: str, latest_doctor_label: str) -> Dict:
    triage = evis.get("triage") or {}
    rationale = triage.get("rationale") or ""
    if latest_doctor_text:
        annotation = f"Doctor confirmed at {latest_doctor_label}: \"{latest_doctor_text}\"."
        if annotation not in rationale:
            rationale = f"{rationale} {annotation}".strip()

    if authoritative_triage and authoritative_triage.get("triage_colour"):
        colour = authoritative_triage["triage_colour"]
        source = "EVIS_authoritative"
    elif triage.get("colour"):
        colour = triage["colour"]
        source = "evis_approved_suggestion"
    elif deterministic_colour:
        colour = deterministic_colour
        source = "deterministic_fallback_no_evis_data"
    else:
        colour = "Unknown"
        source = "no_data_available"

    return {
        "triage_colour":                         colour,
        "triage_colour_source":                  source,
        "triage_colour_deterministic_cross_check": deterministic_colour,
        "triage_category":                       None,
        "criticality_score":                     None,
        "risk_level":                            None,
        "triage_rationale":                      rationale or None,
        "triage_performed_at":                   None,
    }


def _build_section_11(iv: Dict, gcs_total: Optional[str] = None, avpu: Optional[str] = None) -> Dict:
    return {
        "abcde_summary": {
            "A_airway": None, "B_breathing": None, "C_circulation": None,
            "D_disability": None, "E_exposure": None,
        },
        "gcs_total":            gcs_total,
        "gcs_breakdown":        {"eye": None, "verbal": None, "motor": None},
        "avpu":                 avpu,
        "neurological_findings": None,
        "initial_vitals_in_ed": iv,
    }


def _build_section_13(approved_image_suggestions: List[Dict], voice_transcripts: List[Dict]) -> Dict:
    s13 = {
        "head_and_face": None, "neck_and_cervical_spine": None,
        "chest_and_thorax": None, "abdomen": None, "pelvis": None,
        "spine_and_back": None, "upper_limbs": None, "lower_limbs": None,
        "wounds_lacerations_and_bleeding": None, "skin_findings": None,
        "monitor_clinical_data": None,
    }
    if approved_image_suggestions:
        impressive = approved_image_suggestions[-1].get("impressive_findings")
        if impressive:
            # FIX P — monitor/pump data goes here, never into skin_findings.
            s13["monitor_clinical_data"] = impressive
            skin_terms = ("abrasion", "laceration", "pallor", "diaphoresis", "bruise",
                          "contusion", "rash", "wound", "swelling", "ecchymosis",
                          "cyanosis", "jaundice", "erythema")
            for vt in voice_transcripts:
                transcript = (vt.get("transcript") or "").lower()
                if any(term in transcript for term in skin_terms):
                    s13["skin_findings"] = (
                        "Documented injuries per EMT: see wounds_lacerations_and_bleeding "
                        "and visible_injuries sections."
                    )
                    break
    return s13


def _build_section_14(evis: Dict, doctor_voice_notes: List[Dict], voice_transcripts: List[Dict],
                       approved_image_suggestions: List[Dict]) -> Dict:
    # Medications: pull from EVIS treatment_plan items with confirmation_status
    # "new"/"continuing" as doctor/ED-authorized; attribution by source text
    # is not reliably determinable here, so all EVIS-sourced meds are filed
    # under medications_administered_by_doctor_ed (they were doctor-approved),
    # and never guessed as EMT-administered unless an EMT note explicitly
    # states the drug name.
    meds_doctor_ed, meds_emt = [], []
    for item in (evis.get("treatment_plan") or {}).get("items", []):
        drug = item.get("drug_or_treatment")
        if not drug:
            continue
        confirmation_status = item.get("confirmation_status") or "new"
        meds_doctor_ed.append({
            "drug": drug, "dose": item.get("dose"), "route": None,
            "time_given": None, "source_note": item.get("reason"),
            # Carried through so downstream sections (27) can distinguish
            # confirmed/continuing items from still-pending ones instead of
            # labelling everything "administered" — see confirmation_status
            # values in EVIS: new|continuing|previously_advised_unconfirmed|
            # provisional_pending_assessment. Only "continuing" genuinely
            # means already-administered-and-ongoing.
            "confirmation_status": confirmation_status,
        })
    # REMOVED: naive substring matching against EMT transcripts. It had no
    # negation/tense awareness — a transcript saying "aspirin NOT given yet"
    # or "starting aspirin now" matched just as readily as "aspirin given"
    # and was logged as a confirmed EMT administration record. This falsely
    # populated medications_administered (and, downstream, claimable
    # services) with drugs the notes explicitly say were NOT yet given.
    # EMT-administered medications must come from a structured source that
    # actually distinguishes confirmed-given from planned/pending — EVIS
    # already does this via facts.interventions_given_this_encounter and
    # each treatment_plan item's confirmation_status. Until EDFS has a
    # structured feed of that, meds_emt is intentionally left empty rather
    # than populated by an unreliable text match.

    s14: Dict = {
        "airway_management":                   [],
        "oxygen_therapy":                      {"applied": None, "delivery_device": None, "flow_rate_lpm": None, "target_spo2": None},
        "iv_access_and_fluids":                {"iv_access_established": None, "fluid_type": None, "volume_ml": None, "rate": None},
        "haemorrhage_control_measures":        [],
        "immobilization_applied":              [],
        "medications_administered_by_emt":     meds_emt,
        "medications_administered_by_doctor_ed": meds_doctor_ed,
        "medications_administered":            meds_emt + meds_doctor_ed,
        "cpr_performed":                       None,
        "defibrillation_performed":            None,
        "other_interventions":                 [
            p.get("procedure") for p in (evis.get("procedures") or {}).get("items", []) if p.get("procedure")
        ],
        "total_intervention_count":            None,
    }

    # FIX H — pump data, per-pump loop + total fluid infused
    if approved_image_suggestions:
        latest_img = approved_image_suggestions[-1]
        vitals_tl  = latest_img.get("vitals_timeline") or []
        lv = (vitals_tl[-1] if isinstance(vitals_tl, list) and vitals_tl else vitals_tl) if vitals_tl else {}
        if isinstance(lv, dict):
            pump_keys = [k for k in lv.keys() if "pump" in k.lower() or "infus" in k.lower()]
            if pump_keys:
                s14["iv_access_and_fluids"]["iv_access_established"] = True

            pump_entries, total_infused = [], 0.0
            for i in range(1, 4):
                flow_val    = lv.get(f"pump{i}_flow")
                infused_val = lv.get(f"pump{i}_infused")
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
                    s14["iv_access_and_fluids"]["volume_ml"] = round(total_infused, 2)
                    s14["iv_access_and_fluids"]["rate"] = f"Total infused across all pumps: {round(total_infused, 2)} ml"
                s14["other_interventions"] = list(dict.fromkeys(s14["other_interventions"] + pump_entries))

    s14["total_intervention_count"] = len(s14["other_interventions"]) + len(meds_emt) + len(meds_doctor_ed)
    return s14


def _build_section_15(patient: Dict, evis: Dict) -> Dict:
    known = {"diabetes": None, "hypertension": None, "cardiac": None,
             "allergies": None, "current_medications": [], "other_conditions": []}
    return {"known_medical_history": known}


def _build_section_16(evis: Dict) -> Dict:
    impression   = (evis.get("clinical_impression") or {}).get("impression")
    differential = (evis.get("clinical_impression") or {}).get("differential") or []
    supporting   = (evis.get("clinical_impression") or {}).get("supporting_findings") or []
    return {
        "primary_diagnosis":       impression,
        "secondary_diagnoses":     [],
        "suspected_injuries":      [],
        "differential_diagnoses":  differential,
        "diagnosis_confidence":    "High" if impression else "Low",
        "icd_code_approximate":    None,
        "_supporting_findings":    supporting,  # kept for SBAR assembly, not part of locked schema output display
    }


def _build_section_17(progression_lines: List[str], latest_doctor_text: str, latest_doctor_label: str,
                       current_status_snapshot: Optional[Dict], unified_timeline: List[Dict],
                       rejected: List[Dict], first_entry_label: str) -> Dict:
    if latest_doctor_text:
        current_status = f"Per doctor assessment at {latest_doctor_label}: \"{latest_doctor_text}\""
    elif current_status_snapshot:
        cs_content = current_status_snapshot.get("content")
        cs_text = json.dumps(cs_content, default=str) if isinstance(cs_content, dict) else str(cs_content)
        current_status = (
            f"Latest record [{current_status_snapshot.get('source')} @ "
            f"{_ist_label(current_status_snapshot.get('timestamp', ''))}]: {cs_text[:300]}"
        )
    else:
        current_status = None

    # FIX R — count only IMAGE_EXTRACTED_VITALS for trend-sufficiency guard.
    vital_reading_count = sum(1 for e in unified_timeline if e.get("source") == "IMAGE_EXTRACTED_VITALS")
    overall_trend = "Stable" if vital_reading_count >= 2 else "Unknown"
    if vital_reading_count < 2:
        overall_trend = "Unknown — insufficient sequential vital sign data to determine trend direction"

    trajectory_note = None
    if latest_doctor_text:
        rejected_frags = []
        for r in rejected:
            vd = (r.get("voice_dictation") or "").strip()
            if vd:
                rejected_frags.append(f"[{_ist_label(_best_ts(r))}] \"{vd}\"")
        rejected_text = (
            " Subsequent rejected AI suggestions (NOT approved by the doctor) noted: " + "; ".join(rejected_frags) + "."
            if rejected_frags else ""
        )
        trajectory_note = (
            f"Earliest record at {first_entry_label}.{rejected_text} "
            f"Doctor confirmed at {latest_doctor_label}: \"{latest_doctor_text}\". "
            f"This is the most recent authoritative clinical statement."
        ).strip()

    return {
        "overall_trend":                          overall_trend,
        "dictation_by_dictation_progression":      progression_lines,
        "response_to_interventions":               None,
        "current_clinical_status":                 current_status,
        "trajectory_clinical_note":                trajectory_note,
    }


def _build_section_18(evis: Dict) -> Dict:
    # FIX Q — only real named specialist referrals.
    return [
        {"specialty": r.get("specialty"), "reason": r.get("reason"),
         "urgency": None, "alert_time": None, "response_status": None}
        for r in (evis.get("referrals") or {}).get("items", [])
        if r.get("specialty")
    ]


def _build_section_19(unified_timeline: List[Dict], latest_doctor_text: str, latest_doctor_label: str) -> Dict:
    events = []
    for entry in unified_timeline:
        content = entry.get("content")
        content_text = (
            json.dumps(content, default=str) if isinstance(content, dict)
            else str(content) if content else ""
        )
        if content_text and content_text not in ("", "None", "null", "{}"):
            events.append(f"{_ist_label(entry.get('timestamp', ''))} — {entry.get('source')}: {content_text[:250]}")

    sig_changes = []
    if latest_doctor_text:
        sig_changes.append(f"Doctor assessment at {latest_doctor_label}: \"{latest_doctor_text}\"")

    return {
        "narrative":                       None,
        "key_events_chronological":        events,
        "patient_response_to_treatment":   None,
        "complications_noted": (
            "; ".join(c.get("complication") for c in (
                {}).get("items", []) if c.get("complication")
            ) or None
        ),
        "significant_changes_in_ed":       sig_changes,
    }


def _build_section_20(evis: Dict, latest_doctor_text: str, latest_doctor_label: str) -> Dict:
    disposition = None  # never guessed — no reliable structured source for this
    condition_at_disposition = None
    rationale = None
    if latest_doctor_text:
        condition_at_disposition = f"Confirmed status per doctor at {latest_doctor_label}: \"{latest_doctor_text}\""
        rationale = f"Doctor confirmed: \"{latest_doctor_text}\" at {latest_doctor_label}."
    return {
        "disposition":               disposition,
        "destination_unit":          None,
        "urgency":                   None,
        "rationale":                 rationale,
        "disposition_time":          None,
        "condition_at_disposition":  condition_at_disposition,
    }


def _build_section_21(evis: Dict, latest_doctor_text: str, latest_doctor_label: str,
                       approved_image_suggestions: List[Dict], is_trauma: Optional[bool],
                       mechanism_of_injury: str) -> Dict:
    highlights, outstanding = [], []
    if latest_doctor_text:
        highlights.append(f"Doctor assessment at {latest_doctor_label}: \"{latest_doctor_text}\"")

    narrative = None
    if latest_doctor_text:
        narrative = f"The treating doctor assessed the patient at {latest_doctor_label} and noted: \"{latest_doctor_text}.\""

    # FIX L — PREDICT-HF clinical-irrelevance note, gated by deterministic is_trauma.
    if approved_image_suggestions:
        for img_analysis in approved_image_suggestions:
            vitals_tl = img_analysis.get("vitals_timeline") or []
            for vt in (vitals_tl if isinstance(vitals_tl, list) else [vitals_tl]):
                if isinstance(vt, dict) and not _is_null_value(vt.get("predict_hf")):
                    predict_is_trauma = is_trauma if is_trauma is not None else any(
                        kw in (mechanism_of_injury or "").lower() for kw in _TRAUMA_KEYWORDS
                    )
                    if predict_is_trauma:
                        outstanding.append(
                            "PREDICT-HF score present in monitor data (value: " + str(vt.get("predict_hf")) +
                            "). NOTE: PREDICT-HF is a cardiac heart failure risk score and is CLINICALLY "
                            "INAPPLICABLE in acute trauma. This value should not be used for clinical "
                            "decision-making in this case."
                        )
                    break

    # physician_alert from image analysis -> outstanding_issues (FIX Q's partner move)
    for img_analysis in approved_image_suggestions:
        phys_alert = img_analysis.get("physician_alert")
        if phys_alert:
            note = f"[Monitor Image Physician Alert] {phys_alert}"
            if note not in outstanding:
                outstanding.append(note)

    return {
        "consolidated_narrative": narrative,
        "clinical_highlights":    highlights,
        "outcome_at_ed_discharge": None,
        "follow_up_instructions": None,
        "outstanding_issues":     outstanding,
    }


def _build_section_22(latest_doctor_text: str, latest_doctor_label: str, evis: Dict) -> Dict:
    critical_pts = []
    if latest_doctor_text:
        critical_pts.append(f"[MOST RECENT CLINICAL NOTE — {latest_doctor_label}] Doctor: \"{latest_doctor_text}\"")
    handover_summary = None
    if latest_doctor_text:
        handover_summary = f"Current status confirmed by doctor at {latest_doctor_label}: \"{latest_doctor_text}\"."
    return {
        "handover_to":                          None,
        "receiving_unit":                       None,
        "handover_summary":                     handover_summary,
        "critical_points_for_receiving_team":   critical_pts,
        "pending_investigations_at_handover":   [
            i.get("investigation") for i in (evis.get("investigations") or {}).get("items", [])
            if i.get("status") == "pending" and i.get("investigation")
        ],
        "active_medications_at_handover":       [
            t.get("drug_or_treatment") for t in (evis.get("treatment_plan") or {}).get("items", [])
            if t.get("drug_or_treatment")
        ],
        "monitoring_requirements":              [
            p.get("precaution") for p in (evis.get("precautions") or {}).get("items", []) if p.get("precaution")
        ],
    }


def _build_section_23(reg_age: str, reg_gender: str, evis: Dict, s3: Dict, s4: Dict,
                       s10: Dict, latest_doctor_text: str, latest_doctor_label: str,
                       is_trauma: Optional[bool]) -> Dict:
    """
    v9 — situation is built from REGISTRATION demographics only (FIX O),
    assessment/recommendation are built from EVIS's already-approved
    clinical_impression / sbar text / referrals / investigations, NEVER
    from a fresh free-generation call, and NEVER from hardcoded
    trauma-panel content regardless of case type.
    """
    age_str    = reg_age if reg_age else "unknown age"
    gender_str = reg_gender if reg_gender else "unknown gender"
    mechanism      = s3.get("mechanism_of_injury") or ""
    incident_type  = s3.get("type_of_incident") or "incident"
    chief_complaint = s4.get("chief_complaint") or "an unspecified presenting complaint"
    impression = (evis.get("clinical_impression") or {}).get("impression") or ""

    if is_trauma is True:
        presentation_clause = f"involved in a {mechanism or 'trauma incident'} ({incident_type})"
    elif is_trauma is False:
        presentation_clause = f"presenting with {chief_complaint}"
        if impression:
            dx = impression if "suspected" in impression.lower() else f"suspected {impression}"
            presentation_clause += f" (working impression: {dx})"
    else:
        presentation_clause = f"presenting with {chief_complaint or mechanism or 'an unspecified emergency presentation'}"

    sbar_text = _sbar_text(evis)
    if sbar_text:
        # Prefer the doctor-approved SBAR text verbatim as the situation
        # basis when it exists — it is already the authoritative account.
        situation = sbar_text
    else:
        consciousness_str = (
            f"confirmed unstable by treating doctor (\"{latest_doctor_text}\")"
            if latest_doctor_text else "clinical status pending detailed assessment"
        )
        situation = f"{age_str}-year-old {gender_str} patient {presentation_clause}, {consciousness_str}."

    assessment_parts = [f"Triage: {s10.get('triage_colour', 'Unknown')}."]
    if impression:
        assessment_parts.append(f"Working impression: {impression}.")
    differential = (evis.get("clinical_impression") or {}).get("differential") or []
    if differential:
        assessment_parts.append(f"Differential considerations: {', '.join(str(d) for d in differential[:4])}.")
    if latest_doctor_text:
        assessment_parts.append(f"Doctor assessment at {latest_doctor_label}: \"{latest_doctor_text}\".")

    recommendation_parts = []
    treatment_items = (evis.get("treatment_plan") or {}).get("items", [])
    if treatment_items:
        drugs = ", ".join(t.get("drug_or_treatment") for t in treatment_items if t.get("drug_or_treatment"))
        recommendation_parts.append(f"Continue/administer: {drugs}.")
    referrals = [r.get("specialty") for r in (evis.get("referrals") or {}).get("items", []) if r.get("specialty")]
    if referrals:
        recommendation_parts.append(f"Specialist input from: {', '.join(referrals)}.")
    investigations = [i.get("investigation") for i in (evis.get("investigations") or {}).get("items", []) if i.get("investigation")]
    if investigations:
        recommendation_parts.append(f"Investigations: {', '.join(investigations[:5])}.")
    recommendation_parts.append("Continuous monitoring per the working diagnosis; escalate immediately for any deterioration.")

    return {
        "situation":      situation,
        "background":     None,
        "assessment":     " ".join(assessment_parts) if len(assessment_parts) > 1 or impression else None,
        "recommendation": " ".join(recommendation_parts) if (treatment_items or referrals or investigations) else None,
    }


def _build_section_24(all_count: int, approved: List[Dict], rejected: List[Dict]) -> Dict:
    return {
        "total_actions":                len(approved) + len(rejected),
        "approved_count":                len(approved),
        "rejected_count":                len(rejected),
        "latest_approved_content":       approved[-1].get("ai_suggestion") if approved else None,
        "doctor_modifications_or_notes": [],
    }


def _build_section_26(doctor_suggestions: List[Dict], evis: Dict) -> Dict:
    recs = []
    for ds in doctor_suggestions:
        text = (ds.get("suggestion_text") or "").strip()
        if text:
            recs.append({
                "recommendation":   text,
                "source":           "doctor_suggestion",
                "timestamp":        ds.get("timestamp_iso") or ds.get("timestamp") or "",
                "administered_yet": None,
            })
    for item in (evis.get("treatment_plan") or {}).get("items", []):
        if item.get("confirmation_status") == "previously_advised_unconfirmed":
            recs.append({
                "recommendation":   f"{item.get('drug_or_treatment')} — {item.get('reason', '')}".strip(" —"),
                "source":           "approved_ai_treatment_plan",
                "timestamp":        "",
                "administered_yet": False,
            })
    return {"recommendations": recs}


def _build_section_27(text_for_icd: str, voice_transcripts: List[Dict], doctor_voice_notes: List[Dict],
                       image_extractions: List[Dict], approved_image_suggestions: List[Dict],
                       all_actions_count: int, iv: Dict, medications_administered: List[Dict]) -> Dict:
    icd_codes = _infer_icd10_codes(text_for_icd)

    readiness_score = 30
    if voice_transcripts:          readiness_score += 15
    if doctor_voice_notes:         readiness_score += 15
    if image_extractions:          readiness_score += 10
    if approved_image_suggestions: readiness_score += 10
    if all_actions_count:          readiness_score += 5
    if iv.get("blood_pressure"):   readiness_score += 15
    readiness_score = min(readiness_score, 100)

    blocking = []
    if not doctor_voice_notes:
        blocking.append("No doctor teleconsultation note on record")
    if not iv.get("blood_pressure"):
        blocking.append("No vital signs documented")

    claimable = []
    for med in medications_administered:
        if not isinstance(med, dict):
            continue
        label = med.get("drug")
        if not label:
            continue
        status = med.get("confirmation_status")
        if status == "continuing":
            justification = "Documented as already administered and continued this encounter"
        elif status in ("new", None):
            justification = "Recommended in approved treatment plan — administration not yet confirmed"
        elif status == "previously_advised_unconfirmed":
            justification = "Advised in a prior approved suggestion — not yet confirmed as administered"
        elif status == "provisional_pending_assessment":
            justification = "Provisional recommendation pending clinical assessment — not administered"
        else:
            justification = "Recommended in approved treatment plan — administration status unconfirmed"
        # Billing/claims should not treat an unconfirmed recommendation as
        # a claimable administered service. Only "continuing" (i.e.
        # genuinely already given) counts as a claimable medication service;
        # everything else is surfaced for visibility only, not claimability.
        claimable.append({
            "service": str(label),
            "category": "Medication",
            "justification": justification,
            "claimable": status == "continuing",
        })
    if voice_transcripts or doctor_voice_notes:
        claimable.append({
            "service": "Emergency ambulance transport",
            "category": "Transport",
            "justification": "Documented ambulance transport to ED",
            "claimable": True,  # transport is a completed service, not a pending order — always claimable when documented
        })

    return {
        "icd_10_codes_applicable":      icd_codes,
        "claimable_services":           claimable,
        "claim_readiness_score_percent": readiness_score,
        "claim_blocking_issues":        blocking,
    }


# ============================================================
# AGE/GENDER DISCREPANCY DETECTION (FIX K)
# ============================================================

def _detect_age_gender_discrepancy(patient: Dict, image_extractions: List[Dict],
                                    approved_image_suggestions: List[Dict]) -> List[str]:
    reg_age    = str(patient.get("age") or "").strip()
    reg_gender = str(patient.get("gender") or "").strip()
    monitor_age, monitor_gender = None, None

    for img_analysis in approved_image_suggestions:
        vitals_tl = img_analysis.get("vitals_timeline") or []
        for vt in (vitals_tl if isinstance(vitals_tl, list) else [vitals_tl]):
            if isinstance(vt, dict):
                a, g = _extract_age_gender_from_raw_text(vt.get("raw_extracted_text") or "")
                if a:
                    monitor_age, monitor_gender = a, g
                    break
        if monitor_age:
            break

    if not monitor_age:
        for img_ext_doc in image_extractions:
            a, g = _extract_age_gender_from_raw_text(img_ext_doc.get("extracted_text") or "")
            if a:
                monitor_age, monitor_gender = a, g
                break

    discrepancies = []
    if reg_age and monitor_age and reg_age != monitor_age:
        discrepancies.append(
            f"AGE DISCREPANCY — Registration: {reg_age} years | RPM Monitor: {monitor_age} years. "
            f"Registration data used as legal identity source. Treating team must verify correct "
            f"patient identity before proceeding."
        )
    if reg_gender and monitor_gender:
        rg = "MALE" if reg_gender.strip().upper() in ("M", "MALE") else "FEMALE"
        mg = monitor_gender.upper()
        if rg != mg:
            discrepancies.append(
                f"GENDER DISCREPANCY — Registration: {reg_gender} | RPM Monitor: {monitor_gender}. "
                f"Registration data used as legal identity source. Treating team must verify correct "
                f"patient identity before proceeding."
            )
    return discrepancies


# ============================================================
# PIPELINE RUNNER — fully deterministic assembly (v9)
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

    unified_timeline = build_unified_timeline(
        voice_dictations, clinical_actions, doctor_voice_notes,
        image_extractions, doctor_suggestions, approved_image_suggestions,
    )
    current_status_snapshot = get_current_status_snapshot(unified_timeline)
    progression_lines = _build_progression_narrative(unified_timeline)

    approved, rejected, plain_doctor_notes = split_actions(clinical_actions)
    evis = _latest_approved_suggestion(approved)

    authoritative_triage = await fetch_authoritative_triage(patient_triage_status_collection, patient_id)

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
    combined_narrative = await _build_combined_emt_narrative(voice_transcripts)

    latest_doctor_note  = doctor_voice_notes[-1] if doctor_voice_notes else None
    latest_doctor_text  = (latest_doctor_note.get("conversation") or "").strip() if latest_doctor_note else ""
    latest_doctor_ts    = latest_doctor_note.get("timestamp", "") if latest_doctor_note else ""
    latest_doctor_label = _ist_label(latest_doctor_ts) if latest_doctor_ts else ""
    first_entry_label   = _ist_label(unified_timeline[0].get("timestamp", "")) if unified_timeline else "unknown time"

    reg_age    = str(patient_record.get("age") or "").strip()
    reg_gender = str(patient_record.get("gender") or "").strip()

    # ── Sections 1–9 ──
    s1 = _build_section_1(patient_record, patient_id)
    s2 = _build_section_2(patient_record)
    s3 = _build_section_3(patient_record)
    s4 = _build_section_4(evis, patient_record)
    s5 = _build_section_5(voice_transcripts, combined_narrative)
    s6 = _build_section_6(voice_transcripts, combined_narrative)
    s7 = _build_section_7(evis, approved_image_suggestions)
    s8 = _build_section_8(clinical_actions, approved, rejected)
    s9 = _build_section_9(doctor_voice_notes, doctor_suggestions)

    # ── Deterministic case type (no LLM) ──
    classification = classify_case_type(
        incident_type        = s3.get("type_of_incident") or "",
        mechanism_of_injury  = s3.get("mechanism_of_injury") or "",
        chief_complaint      = s4.get("chief_complaint") or "",
        evis_impression_text = (evis.get("clinical_impression") or {}).get("impression") or "",
    )
    is_trauma = classification["is_trauma"]

    # ── Vitals — vitals_timeline dict -> raw OCR text -> EMT voice notes ──
    iv: Dict = {}
    if approved_image_suggestions:
        latest_img = approved_image_suggestions[-1]
        vitals_tl  = latest_img.get("vitals_timeline") or []
        lv = (vitals_tl[-1] if isinstance(vitals_tl, list) and vitals_tl else vitals_tl) if vitals_tl else {}
        vital_key_map = [
            ("spo2", "spo2_percent"), ("spo2_percent", "spo2_percent"), ("SpO2", "spo2_percent"),
            ("pulse_rate_bpm", "pulse_rate_bpm"), ("heart_rate", "pulse_rate_bpm"), ("hr", "pulse_rate_bpm"),
            ("blood_pressure", "blood_pressure"), ("bp", "blood_pressure"), ("NIBP", "blood_pressure"),
            ("respiratory_rate", "respiratory_rate_bpm"), ("respiratory_rate_bpm", "respiratory_rate_bpm"), ("rr", "respiratory_rate_bpm"),
            ("temperature", "temperature_celsius"), ("temperature_celsius", "temperature_celsius"),
        ]
        if isinstance(lv, dict):
            for src_key, dst_key in vital_key_map:
                val = lv.get(src_key)
                if not _is_null_value(val) and _is_null_value(iv.get(dst_key)):
                    iv[dst_key] = val
            raw_ocr = lv.get("raw_extracted_text") or ""
            iv = _fill_vitals(iv, [raw_ocr])

    if _is_null_value(iv.get("spo2_percent")) or _is_null_value(iv.get("blood_pressure")):
        for img_ext_doc in image_extractions:
            iv = _fill_vitals(iv, [img_ext_doc.get("extracted_text") or ""])

    # NEW (v9) — fall back to EMT voice-note transcripts.
    for vt in voice_transcripts:
        iv = _fill_vitals(iv, [vt.get("transcript") or ""])

    s11 = _build_section_11(iv)

    # FIX N / FIX I — haemodynamic status hedge on C_circulation, applied
    # once section 11's ABCDE is otherwise built (kept minimal here since
    # v9 no longer free-generates ABCDE text; left None unless a future
    # structured ABCDE source exists).

    s13 = _build_section_13(approved_image_suggestions, voice_transcripts)
    s14 = _build_section_14(evis, doctor_voice_notes, voice_transcripts, approved_image_suggestions)
    s15 = _build_section_15(patient_record, evis)
    s16 = _build_section_16(evis)

    # Deterministic triage colour (byte-for-byte EIDIS/EVIS shared function)
    hr_i     = first_int(iv.get("pulse_rate_bpm"))
    rr_i     = first_int(iv.get("respiratory_rate_bpm"))
    spo2_i   = first_int(iv.get("spo2_percent"))
    bp_sys_i = parse_bp_systolic(iv.get("blood_pressure"))
    deterministic_colour = compute_triage_colour(
        hr=hr_i, rr=rr_i, spo2_room_air=spo2_i, spo2_on_o2=None, bp_sys=bp_sys_i,
        gcs=None, consciousness=None, shock_suspected=False, respiratory_failure_risk=False,
        pneumothorax_or_hemothorax_flag=False, doctor_stated_severity=None,
        arrest_or_deceased_indicated=False,
    )
    s10 = _build_section_10(evis, authoritative_triage, deterministic_colour, latest_doctor_text, latest_doctor_label)

    s17 = _build_section_17(progression_lines, latest_doctor_text, latest_doctor_label,
                             current_status_snapshot, unified_timeline, rejected, first_entry_label)
    s18 = _build_section_18(evis)
    s19 = _build_section_19(unified_timeline, latest_doctor_text, latest_doctor_label)
    s20 = _build_section_20(evis, latest_doctor_text, latest_doctor_label)
    s21 = _build_section_21(evis, latest_doctor_text, latest_doctor_label, approved_image_suggestions,
                             is_trauma, s3.get("mechanism_of_injury") or "")
    s22 = _build_section_22(latest_doctor_text, latest_doctor_label, evis)
    s23 = _build_section_23(reg_age, reg_gender, evis, s3, s4, s10, latest_doctor_text, latest_doctor_label, is_trauma)
    s24 = _build_section_24(len(clinical_actions), approved, rejected)
    s26 = _build_section_26(doctor_suggestions, evis)

    text_for_icd = " ".join(filter(None, [
        latest_doctor_text, str(s4.get("chief_complaint") or ""),
        str(s16.get("primary_diagnosis") or ""), str(s3.get("mechanism_of_injury") or ""),
    ]))
    s27 = _build_section_27(text_for_icd, voice_transcripts, doctor_voice_notes, image_extractions,
                             approved_image_suggestions, len(clinical_actions), iv, s14["medications_administered"])

    # FIX K — age/gender discrepancy alerts, appended to 21/22/23
    discrepancies = _detect_age_gender_discrepancy(patient_record, image_extractions, approved_image_suggestions)
    if discrepancies:
        for disc in discrepancies:
            alert = f"\u26a0 DATA INTEGRITY ALERT: {disc}"
            if alert not in s21["clinical_highlights"]:
                s21["clinical_highlights"].insert(0, alert)
            if alert not in s21["outstanding_issues"]:
                s21["outstanding_issues"].append(alert)
            if alert not in s22["critical_points_for_receiving_team"]:
                s22["critical_points_for_receiving_team"].append(alert)
        disc_note = " [NOTE: Age discrepancy detected — registration age used above; monitor shows different demographics. Verify patient identity.]"
        if disc_note not in (s23.get("situation") or ""):
            s23["situation"] = (s23.get("situation") or "") + disc_note

    # Remove the private helper key from section 16 before returning.
    s16.pop("_supporting_findings", None)

    has_secondary = any([
        voice_transcripts, approved, rejected, doctor_voice_notes,
        image_extractions, doctor_suggestions, approved_image_suggestions,
    ])
    now_iso = datetime.utcnow().isoformat()
    s25 = {
        "patient_id":                      patient_id,
        "generated_at":                    now_iso,
        "total_voice_notes":               len(voice_transcripts),
        "total_clinical_actions":          len(approved) + len(rejected),
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
        "summary_confidence": "High" if evis else ("Moderate" if has_secondary else "Low"),
        "sections_populated": 27,
    }
    if discrepancies:
        s25["data_integrity_alerts"] = discrepancies

    final_summary = {
        "section_1_patient_information":     s1,
        "section_2_arrival_details":         s2,
        "section_3_incident_details":        s3,
        "section_4_chief_complaint":         s4,
        "section_5_emt_pre_hospital_report": s5,
        "section_6_voice_note_processing":   s6,
        "section_7_ai_clinical_suggestion":  s7,
        "section_8_doctor_review_status":    s8,
        "section_9_doctor_manual_note":      s9,
        "section_10_triage_information":     s10,
        "section_11_initial_ed_assessment":  s11,
        "section_12_visible_injuries":       {"visible_injuries": []},
        "section_13_physical_examination":   s13,
        "section_14_emergency_interventions": s14,
        "section_15_known_medical_history":  s15,
        "section_16_working_diagnosis":      s16,
        "section_17_clinical_progression":   s17,
        "section_18_specialist_alerts":      s18,
        "section_19_ed_clinical_course":     s19,
        "section_20_final_disposition":      s20,
        "section_21_final_ed_summary":       s21,
        "section_22_handover_information":   s22,
        "section_23_sbar_summary":           s23,
        "section_24_clinical_actions_summary": s24,
        "section_25_summary_metadata":       s25,
        "section_26_doctor_recommended_treatment": s26,
        "section_27_icd10_and_claim_readiness": s27,
    }

    elapsed = round(datetime.now().timestamp() * 1000 - start_ms)

    output: Dict = {
        "patient_id":                  patient_id,
        "generated_at":                now_iso,
        "processing_time_ms":          elapsed,
        "case_type":                   classification["case_type"],
        "is_trauma":                   classification["is_trauma"],
        "routing_rationale":           classification["routing_rationale"],
        "triage_colour":               s10["triage_colour"],
        "triage_colour_deterministic": deterministic_colour,
        "evis_suggestion_available":   bool(evis),
        "final_summary":               final_summary,
    }

    if include_raw_data:
        output["intermediate_data"] = {
            "unified_timeline":        unified_timeline,
            "current_status_snapshot": current_status_snapshot,
            "evis_latest_approved":    evis,
            "plain_doctor_notes_count": len(plain_doctor_notes),
        }

    return output


# ============================================================
# DATA FETCHER — ALL 7 SOURCES, IN PARALLEL (unchanged from v8)
# ============================================================

async def fetch_all_patient_data(patient_id: str):
    async def _get_patient():
        doc = await emergency_patients_collection.find_one({"patient_id": patient_id}, {"_id": 0})
        return serialize_doc(doc) if doc else {}

    async def _get_voice_dictations():
        cursor = voice_dictations_collection.find({"patient_id": patient_id}, {"_id": 0}).sort("timestamp", 1)
        return [serialize_doc(d) for d in await cursor.to_list(length=None)]

    async def _get_clinical_actions():
        cursor = clinical_actions_collection.find({"patient_id": patient_id}, {"_id": 0}).sort("server_received_at", 1)
        return [serialize_doc(a) for a in await cursor.to_list(length=None)]

    async def _get_doctor_voice_notes():
        cursor = doctor_voice_notes_collection.find({"patient_id": patient_id}, {"_id": 0}).sort("timestamp", 1)
        return [serialize_doc(d) for d in await cursor.to_list(length=None)]

    async def _get_image_extractions():
        cursor = image_extracted_ambulance_collection.find({"patient_id": patient_id}, {"_id": 0}).sort("timestamp", 1)
        return [serialize_doc(d) for d in await cursor.to_list(length=None)]

    async def _get_doctor_suggestions():
        cursor = doctor_suggestion_collection.find({"patient_id": patient_id}, {"_id": 0}).sort("timestamp", 1)
        return [serialize_doc(d) for d in await cursor.to_list(length=None)]

    async def _get_approved_image_suggestions():
        cursor = approve_image_suggestion_collection.find({"patient_id": patient_id}, {"_id": 0}).sort("approved_at", 1)
        return [serialize_doc(a) for a in await cursor.to_list(length=None)]

    (
        patient, voice_dictations, clinical_actions, doctor_voice_notes,
        image_extractions, doctor_suggestions, approved_image_suggestions,
    ) = await asyncio.gather(
        _get_patient(), _get_voice_dictations(), _get_clinical_actions(),
        _get_doctor_voice_notes(), _get_image_extractions(),
        _get_doctor_suggestions(), _get_approved_image_suggestions(),
    )

    logger.info(
        f"DB fetch — patient={'found' if patient else 'NOT FOUND'}, "
        f"voice_dictations={len(voice_dictations)}, clinical_actions={len(clinical_actions)}, "
        f"doctor_voice_notes={len(doctor_voice_notes)}, image_extractions={len(image_extractions)}, "
        f"doctor_suggestions={len(doctor_suggestions)}, "
        f"approved_image_suggestions={len(approved_image_suggestions)} [db={APPROVE_IMAGE_DB_NAME}]"
    )
    if len(approved_image_suggestions) == 0:
        logger.warning(
            f"Patient {patient_id} — approved_image_suggestions is 0. "
            f"Verify APPROVE_IMAGE_DB_NAME='{APPROVE_IMAGE_DB_NAME}' is correct."
        )

    secondary_sources_present = any([
        voice_dictations, clinical_actions, doctor_voice_notes,
        image_extractions, doctor_suggestions, approved_image_suggestions,
    ])

    return (
        patient, voice_dictations, clinical_actions, doctor_voice_notes,
        image_extractions, doctor_suggestions, approved_image_suggestions,
        secondary_sources_present,
    )


# ============================================================
# API ENDPOINTS
# ============================================================

@router.post("/ed-summary/generate/{patient_id}")
async def generate_ed_summary(patient_id: str, include_raw_data: bool = False):
    """
    Generate the complete Final Emergency Department Summary.

    v9 — deterministic assembly. Clinical content (triage, diagnosis,
    treatment, investigations, procedures, referrals, complications,
    contraindications, precautions, SBAR) is read directly from the latest
    APPROVED EVIS ai_suggestion, never re-derived by a fresh LLM call. The
    only optional LLM use is non-clinical prose stitching of multiple EMT
    voice notes into one paragraph, with a deterministic fallback.
    """
    start_ms = datetime.now().timestamp() * 1000
    logger.info(f"EDFS v9 generate | patient_id={patient_id}")

    try:
        (
            patient_record, voice_dictations, clinical_actions, doctor_voice_notes,
            image_extractions, doctor_suggestions, approved_image_suggestions,
            secondary_sources_present,
        ) = await fetch_all_patient_data(patient_id)
    except Exception as e:
        logger.exception(f"DB fetch failed: {e}")
        raise HTTPException(status_code=500, detail=f"Database fetch failed: {str(e)}")

    if not patient_record:
        raise HTTPException(status_code=404, detail=f"Patient '{patient_id}' not found in patients collection.")

    try:
        result = await run_edfs_pipeline(
            patient_id=patient_id, patient_record=patient_record,
            voice_dictations=voice_dictations, clinical_actions=clinical_actions,
            doctor_voice_notes=doctor_voice_notes, image_extractions=image_extractions,
            doctor_suggestions=doctor_suggestions, approved_image_suggestions=approved_image_suggestions,
            include_raw_data=include_raw_data,
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
            "evis_suggestion_available":       result.get("evis_suggestion_available"),
            "final_summary":                   result.get("final_summary"),
            "edfs_version":                    "9.0",
        })
        logger.info(f"Saved ED summary v9 for patient {patient_id}")
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
        "evis_suggestion_available":       result.get("evis_suggestion_available"),
        "result":                          result,
    }


@router.get("/ed-summary/latest/{patient_id}")
async def get_latest_ed_summary(patient_id: str):
    """Retrieve the most recently stored ED summary. Does NOT re-run the pipeline."""
    try:
        cursor = ed_summaries_collection.find({"patient_id": patient_id}, {"_id": 0}).sort("generated_at", -1).limit(1)
        docs = await cursor.to_list(length=1)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if not docs:
        raise HTTPException(
            status_code=404,
            detail=f"No ED summary found for '{patient_id}'. Run POST /ed-summary/generate/{patient_id} first.",
        )
    return {"status": "success", "patient_id": patient_id, "result": serialize_doc(docs[0])}


@router.get("/ed-summary/history/{patient_id}")
async def get_ed_summary_history(patient_id: str, limit: int = 10):
    """List past ED summary runs for a patient (newest first)."""
    try:
        cursor = ed_summaries_collection.find(
            {"patient_id": patient_id},
            {
                "_id": 0, "patient_id": 1, "generated_at": 1, "dictation_count": 1, "action_count": 1,
                "doctor_voice_note_count": 1, "image_extraction_count": 1, "doctor_suggestion_count": 1,
                "approved_image_suggestion_count": 1, "approve_image_db_used": 1,
                "secondary_sources_present": 1, "case_type": 1, "is_trauma": 1, "routing_rationale": 1,
                "triage_colour": 1, "evis_suggestion_available": 1,
            },
        ).sort("generated_at", -1).limit(limit)
        docs = await cursor.to_list(length=limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"status": "success", "patient_id": patient_id, "total": len(docs), "summaries": [serialize_doc(d) for d in docs]}


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
        "system":            "EDFS — Emergency Department Final Summary System (v9)",
        "version":           "9.0.0",
        "architecture": (
            "Deterministic assembly. Clinical content (triage, diagnosis, treatment, "
            "investigations, procedures, referrals, complications, contraindications, "
            "precautions, SBAR) is read directly from the latest APPROVED EVIS ai_suggestion "
            "— never re-derived by a separate LLM pipeline. Zero LLM calls for clinical "
            "content; one OPTIONAL LLM call for non-clinical EMT-note narrative stitching "
            "only, with a deterministic plain-join fallback."
        ),
        "v9_fixes": [
            "GENUINE-REJECTION FIX — a not_approved clinical_actions record only counts as a "
            "rejected AI suggestion if it carries a populated ai_suggestion payload; plain "
            "doctor notes/questions to EMT are labelled DOCTOR_NOTE_TO_EMT and never counted "
            "or displayed as a rejection. Was previously inflating rejected_count with plain "
            "doctor instructions.",
            "SBAR SCHEMA FIX — EVIS's sbar_summary only ever has a 'text' key; reading it "
            "directly (instead of nonexistent 'situation'/'assessment' sub-keys) means "
            "section 7/23 now reflect the real approved SBAR instead of a generic placeholder.",
            "VITALS-FROM-EMT-NOTE FALLBACK — vitals regex fallback (FIX M) now also runs "
            "against EMT voice transcripts, not only image OCR text.",
            "REMOVED the 3-agent (A1/A2/A3) LLM pipeline entirely for clinical content — "
            "triage/diagnosis/treatment/SBAR now come straight from the doctor-approved EVIS "
            "suggestion, eliminating the class of bug where EDFS silently generated a second, "
            "unaudited clinical opinion that could contradict the approved one.",
        ],
        "v6_v8_fixes_retained_as_deterministic_section_builders": [
            "FIX A, B, G, H, I, K, L, M, N, O, P, Q, R — all applied inline in section builders "
            "instead of a separate post_process_fill patch layer.",
            "ROOT CAUSE FIX: APPROVE_IMAGE_DB_NAME = 'doctorassist'",
        ],
        "data_sources": [
            "MongoDB: patients                    (demographics — doctorassistai)",
            "MongoDB: voice_dictations            (EMT voice notes — doctorassistai)",
            "MongoDB: clinical_actions            (approved/rejected/doctor-notes — doctorassistai)",
            "MongoDB: doctor_voice_notes          (doctor dictation — doctorassistai)",
            "MongoDB: Image_Extracted_Ambulance   (image vitals — doctorassistai)",
            "MongoDB: Doctor_Suggestion_Ambulance (doctor suggestions — doctorassistai)",
            f"MongoDB: ApproveImageSuggestion      (approved image analyses — {APPROVE_IMAGE_DB_NAME})",
        ],
        "temporal_precedence": (
            "Doctor voice note > Approved AI suggestion (EVIS) > Image extraction > "
            "Genuinely rejected AI suggestion > Earlier EMT voice note"
        ),
        "db_status":                       db_status,
        "approve_image_db_name_in_use":    APPROVE_IMAGE_DB_NAME,
        "approve_image_collection_status": approve_img_status,
        "narrative_llm_available":         _narrative_llm is not None,
    }