from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, HTTPException
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
from bson.errors import InvalidId
from pydantic import BaseModel

from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage
from Agentic.clinical_shared.triage import upsert_authoritative_triage
# ============================================================
# TIMEZONE — India Standard Time (UTC+5:30)
# ============================================================

IST = timezone(timedelta(hours=5, minutes=30))


def now_ist() -> datetime:
    return datetime.now(IST)


def iso_ist(dt: Any) -> str:
    """Convert any datetime / string / None to an IST ISO-8601 string."""
    if dt is None:
        return ""
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(IST).isoformat()
    return str(dt)


# ============================================================
# ENVIRONMENT / DB
# ============================================================

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

mongo_client = AsyncIOMotorClient(MONGO_URI)
mongo_db = mongo_client[MONGO_DB]

voice_dictations_collection = mongo_db["voice_dictations"]
doctor_voice_notes_collection_forprocessing = mongo_db["doctor_voice_notes"]
Image_Extracted_Ambulance_collection = mongo_db["Image_Extracted_Ambulance"]
clinical_actions_collection = mongo_db["clinical_actions"]
patient_triage_status_collection = mongo_db["patient_triage_status"]


llm_extract = ChatGroq(
    model="openai/gpt-oss-120b",
    temperature=0.1,
    max_tokens=4000,
    groq_api_key=GROQ_API_KEY,
)

llm_suggest = ChatGroq(
    model="openai/gpt-oss-120b",
    temperature=0.1,
    max_tokens=8000,
    groq_api_key=GROQ_API_KEY,
)

router = APIRouter(prefix="", tags=["Emergency Voice Intelligence"])

# Responder scope is fixed at EMT-Basic — the on-scene skill-level selector
# was removed from the frontend, so every treatment_plan/procedures item
# must be safe/valid for the most conservative responder scope. This is
# intentionally hardcoded, not inferred or defaulted at the LLM's discretion.
RESPONDER_SKILL_LEVEL = "EMT-Basic"


# ============================================================
# REQUEST MODELS
# ============================================================

class EmergencyVoiceRequest(BaseModel):
    patient_id: str
    include_intermediates: bool = False


# ============================================================
# HELPERS
# ============================================================
def parse_llm_json(text: str, response=None) -> Dict:
    if not text:
        return {}

    finish_reason = None
    if response is not None:
        finish_reason = (getattr(response, "response_metadata", None) or {}).get("finish_reason")

    text = text.strip()
    text = re.sub(r"```json", "", text)
    text = re.sub(r"```", "", text)
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        text = match.group(0)
    try:
        return json.loads(text)
    except Exception:
        if finish_reason == "length":
            logger.error(
                f"LLM output truncated by max_tokens (finish_reason=length). "
                f"Raw text length={len(text)}. Increase max_tokens for this call."
            )
            return {"_parse_error": True, "_truncated": True, "raw_output": text}
        logger.error(f"Failed to parse LLM JSON output. Raw text: {text[:500]}")
        return {"_parse_error": True, "raw_output": text}


async def _invoke_llm(llm_instance, system: str, user: str) -> Dict:
    response = await llm_instance.ainvoke([
        SystemMessage(content=system),
        HumanMessage(content=user),
    ])
    return parse_llm_json(response.content, response)


# ============================================================
# DATA FETCHING — EMT dictations, doctor notes, image-extracted vitals
# ============================================================

async def _fetch_all_clinical_entries(patient_id: str) -> tuple[List[Dict], int, int, int]:
    """
    Fetch and merge clinical data from all four MongoDB sources,
    sorted chronologically. Returns (entries, emt_count, doctor_count, image_count).
    doctor_count includes both doctor_voice_notes AND "not_approved"
    clinical_actions (Doctor -> EMT notes sent from the Clinical Chat
    composer, e.g. the auto-generated incident-creation voice note) —
    these are both doctor-authored notes to EMT and were previously
    invisible to this endpoint even though they're fully visible in the
    Clinical Chat tab, causing false "no clinical data" 404s.
    """
    entries: List[Dict] = []

    try:
        cursor = voice_dictations_collection.find(
            {"patient_id": patient_id}, {"_id": 0}
        ).sort("timestamp", 1)
        emt_docs = await cursor.to_list(length=None)
    except Exception as e:
        logger.error(f"Failed to fetch voice_dictations: {e}")
        emt_docs = []

    emt_count = 0
    for doc in emt_docs:
        conv = (doc.get("conversation") or "").strip()
        ts = doc.get("timestamp")
        if conv and ts:
            entries.append({**doc, "_source": "voice_dictation", "timestamp": ts})
            emt_count += 1

    try:
        cursor = doctor_voice_notes_collection_forprocessing.find(
            {"patient_id": patient_id}, {"_id": 0}
        ).sort("timestamp", 1)
        doctor_docs = await cursor.to_list(length=None)
    except Exception as e:
        logger.error(f"Failed to fetch doctor_voice_notes: {e}")
        doctor_docs = []

    doctor_count = 0
    for doc in doctor_docs:
        conv = (doc.get("conversation") or "").strip()
        ts = doc.get("timestamp")
        if conv and ts:
            entries.append({**doc, "_source": "doctor_voice_note", "timestamp": ts})
            doctor_count += 1

    try:
        cursor = Image_Extracted_Ambulance_collection.find(
            {"patient_id": patient_id}, {"_id": 0}
        ).sort("timestamp", 1)
        image_docs = await cursor.to_list(length=None)
    except Exception as e:
        logger.error(f"Failed to fetch Image_Extracted_Ambulance: {e}")
        image_docs = []

    image_count = 0
    for doc in image_docs:
        text = (doc.get("extracted_text") or "").strip()
        ts = doc.get("timestamp")
        if text and ts:
            entries.append({**doc, "_source": "image_extracted", "conversation": text, "timestamp": ts})
            image_count += 1

    try:
        cursor = clinical_actions_collection.find(
            {"patient_id": patient_id, "action_type": "not_approved"}, {"_id": 0}
        ).sort("server_received_at", 1)
        doctor_to_emt_docs = await cursor.to_list(length=None)
    except Exception as e:
        logger.error(f"Failed to fetch clinical_actions (doctor-to-EMT notes): {e}")
        doctor_to_emt_docs = []

    for doc in doctor_to_emt_docs:
        conv = (doc.get("voice_dictation") or "").strip()
        ts = doc.get("server_received_at")
        if conv and ts:
            entries.append({**doc, "_source": "doctor_to_emt_note", "conversation": conv, "timestamp": ts})
            doctor_count += 1

    if emt_count == 0 and doctor_count == 0:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No valid clinical data found for patient {patient_id}. "
                "voice_dictations, doctor_voice_notes, and doctor-to-EMT clinical actions are all empty or missing."
            ),
        )

    def _ts_sort_key(entry: Dict) -> str:
        ts = entry.get("timestamp")
        if ts is None:
            return ""
        return ts.isoformat() if hasattr(ts, "isoformat") else str(ts)

    entries_sorted = sorted(entries, key=_ts_sort_key)
    return entries_sorted, emt_count, doctor_count, image_count


def _build_timeline_text(entries: List[Dict]) -> str:
    """Combine all entries into one chronological block of text for STEP 1."""
    parts = ["=== CLINICAL INPUT TIMELINE (chronological, all timestamps IST) ===\n"]
    for idx, entry in enumerate(entries, start=1):
        source = entry.get("_source", "unknown")
        if source == "image_extracted":
            # Use the EMT-tagged image type when available (Fall, Burn, RPM
            # Monitor, etc.) instead of assuming every image is a monitor
            # screenshot — mislabeling a wound/burn photo's findings as
            # "MONITOR DATA" here would feed the extraction LLM a false
            # frame for that entry. Falls back to the old generic label for
            # any record saved before image tagging existed.
            type_label = entry.get("image_type_label")
            label = f"IMAGE-EXTRACTED DATA ({type_label})" if type_label else "IMAGE-EXTRACTED DATA"
        else:
            label = {
                "voice_dictation": "EMT VOICE DICTATION",
                "doctor_voice_note": "DOCTOR VOICE NOTE",
                "doctor_to_emt_note": "DOCTOR NOTE TO EMT",
            }.get(source, "NOTE")
        ts_ist = iso_ist(entry.get("timestamp"))
        text = entry.get("conversation", "").strip()
        parts.append(f"[{label} {idx} | {ts_ist}]\n{text}\n")
    return "\n".join(parts)

# ============================================================
# PRIOR CLINICAL ACTIONS — read directly from the DB record,
# no text-matching / regex re-derivation
# ============================================================

async def _fetch_clinical_actions(patient_id: str) -> List[Dict]:
    try:
        cursor = clinical_actions_collection.find(
            {"patient_id": patient_id}, {"_id": 0}
        ).sort("server_received_at", -1)
        return await cursor.to_list(length=None)
    except Exception as e:
        logger.warning(f"Could not fetch clinical actions: {e}")
        return []

def _summarize_clinical_actions(actions: List[Dict]) -> tuple[List[str], List[str]]:
    """
    Split into (approved, rejected) using only the fields the doctor
    actually recorded. IMPORTANT: action_type == "not_approved" is written
    by TWO different frontend flows that must not be conflated —
    (1) the Composer's plain "Voice Note" mode, which stamps EVERY free-text
    doctor instruction to EMT with action_type "not_approved" and
    ai_suggestion: null, regardless of content (this is NOT a rejection —
    it is an arbitrary order, e.g. "start aspirin if not already given",
    and is already surfaced to the suggestion model via the timeline text
    as a "DOCTOR NOTE TO EMT" entry); and (2) an actual AI-suggestion
    rejection, which (if ever wired up) would carry a populated
    ai_suggestion payload. Treating case (1) as "explicitly rejected" was
    the root cause of standing doctor orders (e.g. aspirin) being
    suppressed from every later suggestion. Only entries that carry an
    ai_suggestion payload represent a genuine reject-of-a-suggestion.
    """
    approved, rejected = [], []
    for a in actions:
        label = (a.get("voice_dictation") or "").strip()
        ai = a.get("ai_suggestion") or {}
        if not label:
            label = (ai.get("triage") or {}).get("rationale") or "Unspecified action"
        ts = iso_ist(a.get("client_created_at") or a.get("server_received_at"))
        entry = f"[{ts}] {label}"
        if a.get("action_type") == "approved":
            approved.append(entry)
        elif a.get("action_type") == "not_approved" and ai:
            # Only a genuine rejection of a generated AI suggestion —
            # never a plain free-text doctor voice note to EMT.
            rejected.append(entry)
    return approved, rejected


def _extract_previously_advised_treatments(actions: List[Dict]) -> List[Dict]:
    """
    Pull every specific drug/treatment/procedure name out of previously
    APPROVED ai_suggestion payloads — not just the rationale text — so the
    next generation call can recognize an exact match and avoid blindly
    re-advising something already given/advised. Most-recent-first.
    """
    advised: List[Dict] = []
    for a in actions:
        if a.get("action_type") != "approved":
            continue
        ai = a.get("ai_suggestion") or {}
        ts = iso_ist(a.get("client_created_at") or a.get("server_received_at"))

        for item in (ai.get("treatment_plan") or {}).get("items", []) or []:
            name = (item.get("drug_or_treatment") or "").strip()
            if name:
                advised.append({
                    "kind": "treatment_plan",
                    "name": name,
                    "dose": item.get("dose"),
                    "advised_at": ts,
                })

        for item in (ai.get("procedures") or {}).get("items", []) or []:
            name = (item.get("procedure") or "").strip()
            if name:
                advised.append({
                    "kind": "procedure",
                    "name": name,
                    "timing": item.get("timing"),
                    "advised_at": ts,
                })

    return advised


def _extract_rejected_treatments(actions: List[Dict]) -> List[Dict]:
    """
    Mirror of _extract_previously_advised_treatments above, but for GENUINE
    suggestion rejections only (action_type == "not_approved" AND an
    ai_suggestion payload is present — see _summarize_clinical_actions'
    docstring on why a plain doctor-to-EMT voice note must never be treated
    as a rejection). Pulls exact drug/procedure names so the next
    generation call can be told specifically what was rejected, instead of
    relying on _summarize_clinical_actions' free-text label, which for a
    rejection with no typed note falls back to the triage rationale and
    may never actually name the rejected item.
    """
    rejected: List[Dict] = []
    for a in actions:
        if a.get("action_type") != "not_approved":
            continue
        ai = a.get("ai_suggestion") or {}
        if not ai:
            continue  # plain doctor voice note to EMT — not a rejection
        ts = iso_ist(a.get("client_created_at") or a.get("server_received_at"))

        for item in (ai.get("treatment_plan") or {}).get("items", []) or []:
            name = (item.get("drug_or_treatment") or "").strip()
            if name:
                rejected.append({
                    "kind": "treatment_plan",
                    "name": name,
                    "rejected_at": ts,
                })

        for item in (ai.get("procedures") or {}).get("items", []) or []:
            name = (item.get("procedure") or "").strip()
            if name:
                rejected.append({
                    "kind": "procedure",
                    "name": name,
                    "rejected_at": ts,
                })

    return rejected


# ============================================================
# NEW — PREVIOUSLY ADMINISTERED  (code-level, no LLM)
# ------------------------------------------------------------
# Historical, display-only list of what has already been given to the
# patient this encounter — sourced directly from Step 1's extraction
# (facts.interventions_given_this_encounter, populated from BOTH EMT
# pre-hospital notes and doctor manual voice notes — extract_facts()
# does not separate them by source, so this section intentionally covers
# both). This is never fed back into treatment_plan/procedures and is
# never itself editable as a "suggestion" — it exists purely so the
# clinical-actions screen shows what's already been done before showing
# what's being newly recommended.
# ============================================================
def _apply_previously_administered(suggestions: Dict, facts: Dict) -> Dict:
    items_given = facts.get("interventions_given_this_encounter") or []
    none_confirmed = facts.get("prehospital_treatment_status") == "none_given_confirmed"
    items = [
        {
            "treatment_or_medication": str(x).strip(),
            "reason": "Documented as already administered in the EMT/doctor notes.",
        }
        for x in items_given if str(x).strip()
    ]
    # "Known and empty" (EMT explicitly confirmed nothing given) is a
    # resolved answer, not a gap — it must not re-trigger the clarifying
    # question. Only genuinely unknown (neither given nor explicitly
    # confirmed as not-given) should ask EMT.
    resolved = bool(items) or none_confirmed
    if none_confirmed and not items:
        reason = "EMT explicitly confirmed no treatment/medication has been given on scene yet."
    elif items:
        reason = None
    else:
        reason = "No previously administered treatments/medications documented in the notes."
    suggestions["previously_administered"] = {
        "data_available": resolved,
        "reason_if_unavailable": None if resolved else reason,
        "emt_clarifying_question": None if resolved else (
            "Has any treatment or medication (e.g. aspirin, oxygen, IV fluids) "
            "already been given to the patient on scene?"
        ),
        "items": items,
        "confirmed_none_given": none_confirmed,
    }
    return suggestions


# ============================================================
# STEP 1 — EXTRACT  (restate only what is explicitly stated)
# ============================================================

EXTRACTION_SYSTEM = (
    "You extract clinical facts from EMT and doctor notes for an emergency "
    "patient. You do NOT diagnose, interpret, or infer. You only restate what "
    "is explicitly stated in the text. If something is not mentioned, leave it "
    "null or an empty list — do not guess a plausible value. Extract "
    "patient_age and patient_sex whenever explicitly stated anywhere in the "
    "notes (e.g. '68-year-old male') — these are frequently stated once, "
    "early, and must not be lost; leave them null only if truly never "
    "stated. Numeric vitals "
    "belong ONLY in the 'vitals' object; put descriptive exam findings in the "
    "matching 'primary_survey' bucket, and never state the same fact in both "
    "places. The primary_survey buckets are a purely structural restatement — "
    "airway/breathing/circulation/disability/exposure are standard universal "
    "categories, not a diagnosis — so this categorization does not violate "
    "the 'do not diagnose or infer' rule as long as you only place facts that "
    "are explicitly stated. Likewise, if the notes themselves already contain "
    "an explicit diagnostic conclusion made by a clinician or a diagnostic "
    "study (e.g. 'ECG shows ST elevation in II, III, aVF consistent with "
    "inferior STEMI', 'CT read as showing a subdural hematoma'), restating "
    "that stated conclusion verbatim/near-verbatim into "
    "diagnostic_conclusions_stated is NOT diagnosing or inferring — you are "
    "only forbidden from producing a NEW conclusion the notes do not "
    "themselves state. Always capture the most specific diagnostic label "
    "already given in the notes (e.g. 'inferior STEMI'), not a vaguer "
    "category, when both appear. Similarly, capture every test/investigation "
    "the notes state has already been ordered, sent, or is pending, even if "
    "no result is yet given — this is separate from "
    "interventions_given_this_encounter, which is for treatments/procedures, "
    "not diagnostic tests. All timestamps you reference must stay in IST as "
    "given in the input.\n\n"
    "COMPLETED VS IN-PROGRESS/FUTURE ACTIONS — a critical tense "
    "distinction: only mark something as already given/done/administered "
    "when the notes use completed-action language (past tense, or an "
    "explicit confirmation such as 'given', 'administered', 'established', "
    "'done', 'secured'). Present-progressive or imminent-action language — "
    "e.g. 'starting aspirin now', 'about to start IV', 'beginning oxygen', "
    "'going to give X' — describes an action that has NOT yet been "
    "confirmed complete and must NOT be placed in "
    "interventions_given_this_encounter; it stays pending/not-yet-given "
    "until a later entry confirms completion. This matters most when a "
    "single sentence contains both an explicit negation and a "
    "present-progressive clause, e.g. 'Aspirin not given yet, IV not "
    "started yet. Starting both now.' — this entire sentence means NEITHER "
    "has been given yet; do not let the word 'starting' cause you to treat "
    "either as completed. If a later entry explicitly confirms completion "
    "(e.g. 'aspirin given', 'IV established'), use that later entry to "
    "update the status at that point, not before.\n\n"
    "REFERRING-FACILITY / PRIOR-FACILITY ADMINISTRATIONS AND HYBRID "
    "PHRASING: in an inter-facility transfer, any treatment or medication "
    "explicitly stated as already given by a referring/prior facility "
    "(e.g. 'given one dose of IV paracetamol at the referring hospital', "
    "'patient was given one dose of IV paracetamol only, no other "
    "medications administered') is a CONFIRMED COMPLETED intervention for "
    "this encounter and MUST be included in interventions_given_this_"
    "encounter — do not omit it merely because it was administered by a "
    "different facility/crew rather than the current one. Watch "
    "specifically for the hybrid pattern 'X only, no other Y administered' "
    "or 'X given, nothing else given' — this states BOTH that X was given "
    "AND that nothing else was: you must include X in interventions_given_"
    "this_encounter AND set prehospital_treatment_status to 'given' in "
    "this case. Only use 'none_given_confirmed' when the notes state that "
    "NOTHING AT ALL has been given — never when a specific treatment is "
    "named as given, even if the same sentence also says no other "
    "treatment was given.\n\n"
    "INVESTIGATION STATUS — THREE DISTINCT BUCKETS (do not merge these; a "
    "test in the wrong bucket downstream causes either a missed critical "
    "finding or a false claim that something was done): "
    "(1) investigations_already_ordered_or_pending — a test the notes state "
    "was ordered/sent/activated, where NO result or finding is yet given "
    "(e.g. 'CBC sent', 'awaiting troponin', 'Cath Lab notified'). "
    "(2) investigations_completed_with_findings — a test the notes state has "
    "ALREADY BEEN PERFORMED and for which a finding, result, or reading is "
    "given, even a qualitative one (e.g. 'FAST positive for free "
    "intraperitoneal fluid', 'eFAST demonstrates a significant pleural fluid "
    "collection', 'ECG shows ST depression in V4-V6', 'CT brain pending' is "
    "NOT this bucket, but 'CT brain shows no hemorrhage' IS). Every item here "
    "needs both the investigation name and the finding stated. Never put a "
    "completed/positive result item into bucket (1) — that discards the "
    "actual finding and must not happen. "
    "(3) investigations_conditionally_planned — a test only mentioned as a "
    "possible/future/conditional action, not something already ordered now "
    "(e.g. 'ultrasound abdomen requested if symptoms persist or alternative "
    "pathology is suspected', 'CT KUB to be considered'). Do not put a "
    "conditional item into bucket (1) or (2) — it has not actually been "
    "ordered yet, only contemplated as a contingency.\n\n"
    "NEGATIVE / RULED-OUT FINDINGS: separately capture any explicit "
    "statement that something is normal, stable, absent, or has been ruled "
    "out (e.g. 'pelvis stable, no pelvic instability', 'GCS 15, no loss of "
    "consciousness, pupils equal and reactive', 'afebrile, no chills'). "
    "These matter as much as positive findings because a downstream "
    "reasoning step must never contradict them — do not drop a stated "
    "negative just because it seems like 'nothing to report'.\n\n"
    "Respond with valid JSON only."
)

EXTRACTION_OUTPUT_SHAPE = """
Return ONLY valid JSON in this exact shape:
{
  "patient_age": null,
  "patient_sex": "string or null — e.g. 'male', 'female', only if explicitly stated",
  "reason_for_encounter": "string or null — WHY the patient is being seen. This can be a stated complaint ('chest pain'), a described incident/mechanism ('high-speed road traffic accident, helmet found broken'), or a stated event ('found unresponsive at home'). A described incident or mechanism DOES satisfy this field even if no separate 'complains of' sentence exists — do not leave this null just because the wording isn't phrased as a complaint.",
  "symptom_onset_or_event_timing": "string or null — any explicitly stated timing of symptom/event onset relative to now or to arrival, restated as given, e.g. 'began 50 minutes prior to arrival', 'started 2 hours ago', 'found down at an unknown time'. Pull this out as its own field even though it may also appear inside reason_for_encounter, because exact timing drives time-window-dependent treatment eligibility downstream.",
  "relevant_history": "string or null — medical/social history relevant to the case, if stated, separate from the reason for this encounter",
  "vitals": {
    "heart_rate_bpm": null,
    "respiratory_rate_bpm": null,
    "spo2_percent": null,
    "blood_pressure": "string or null, e.g. '120/80'",
    "temperature_c": null,
    "consciousness_or_gcs": "string or null"
  },
  "primary_survey": {
    "airway": "string or null — only explicit airway-related facts, e.g. 'airway patent, cervical collar in situ', 'obstructed', 'intubated'",
    "breathing": ["explicit breathing/respiratory exam findings NOT already captured by respiratory_rate_bpm or spo2_percent above, e.g. 'reduced air entry over left hemithorax', 'bilateral diffuse crepitations', 'marked work of breathing', 'tracheal deviation to the right', 'hyper-resonance on percussion'"],
    "circulation": ["explicit circulation-related exam findings NOT already captured by heart_rate_bpm or blood_pressure above, e.g. 'active bleeding from scalp laceration', 'two large-bore IV cannulas secured', 'S3 gallop', 'bilateral pedal edema', 'distended neck veins', 'muffled heart sounds'"],
    "disability": ["explicit neuro findings NOT already captured by consciousness_or_gcs above, e.g. 'brief loss of consciousness reported by bystanders', 'pupils equal and reactive', 'anisocoria', 'left-sided power 2/5'"],
    "exposure": ["explicit exposure/skin/wound/deformity findings NOT already captured by temperature_c above, e.g. 'multiple abrasions over chest and abdomen', 'suspected pelvic instability', 'deformity over left thigh', 'afebrile', 'seatbelt bruising', 'left costovertebral angle tenderness'"]
  },
  "diagnostic_conclusions_stated": ["only diagnostic conclusions/interpretations EXPLICITLY given in the notes by a clinician or a diagnostic study/report, restated verbatim/near-verbatim — e.g. 'ECG: ST elevation in II, III, aVF consistent with acute inferior STEMI'. Use the MOST SPECIFIC label already stated (e.g. 'inferior STEMI', not just 'ACS' or 'cardiac event') when the notes give one. Leave empty if the notes only describe symptoms/signs without a clinician or study ever stating a named diagnosis."],
  "investigations_already_ordered_or_pending": ["tests explicitly stated as ordered/sent/activated THIS encounter with NO result/finding given yet — see INVESTIGATION STATUS rule. Do not include conditional/future-only tests here."],
  "investigations_completed_with_findings": [
    {"investigation": "string, e.g. 'FAST examination' or 'ECG'", "finding": "string — the actual result/reading stated, restated closely, e.g. 'positive, free intraperitoneal fluid' or 'ST depression V4-V6, T-wave inversion I and aVL'"}
  ],
  "investigations_conditionally_planned": ["tests mentioned only as a possible/future/conditional action, not yet actually ordered — see INVESTIGATION STATUS rule, e.g. 'ultrasound abdomen if symptoms persist'"],
  "interventions_given_this_encounter": [
    "only things explicitly CONFIRMED AS COMPLETED this encounter (see COMPLETED VS IN-PROGRESS/FUTURE ACTIONS rule above — do NOT include an action only described as starting/about to start/being initiated right now with no separate confirmation of completion) — include EVERY type mentioned: oxygen therapy, monitoring (cardiac/multiparameter), NIV/BiPAP, IV fluids/medications, procedures (e.g. 'two large-bore IV cannulas secured', 'cervical collar applied'), blood-product preparedness (e.g. 'blood grouping and cross-match completed', 'massive transfusion protocol activated/on standby'), any definitive procedure (surgery, transfusion, decompression) already PREPARED FOR or IN PROGRESS, and any treatment/medication explicitly stated as already given by a REFERRING/PRIOR FACILITY in an inter-facility transfer (e.g. 'IV paracetamol given at referring hospital') — a prior facility's administration is still a completed intervention for this encounter and must not be omitted just because a different crew/facility gave it. Include the stated effect if given, e.g. 'BiPAP initiated, SpO2 improved from 67% to 97%' (the stated effect itself confirms completion)."
  ],
  "prehospital_treatment_status": "string or null — ONLY set this when the notes contain an EXPLICIT statement about whether any treatment/medication has been given on scene so far. Use 'none_given_confirmed' if the notes explicitly say nothing has been administered yet (e.g. 'no aspirin given', 'nothing given on scene', 'we were waiting on your orders'). Use 'given' if interventions_given_this_encounter is non-empty. Leave null if the notes say nothing either way about this — do not guess either value.",
  "doctor_conditional_orders": [
    "capture EVERY doctor instruction to EMT that orders a treatment conditionally, of BOTH kinds: (a) conditional on administration status — phrasing like 'give X if not already given', 'start X unless already administered'; (b) conditional on a VITAL-SIGN THRESHOLD — phrasing like 'give O2 if sats drop below 94%', 'start pressors if BP under 90', 'give X if HR exceeds 120'. Both are ORDERS TO GIVE, not rejections and not completed interventions — extract each as {\"treatment_or_action\": \"string, e.g. 'oxygen therapy'\", \"condition_type\": \"administration_status|vital_threshold\", \"threshold_detail\": \"string or null — for vital_threshold only, e.g. 'SpO2 < 94%', restated precisely as the doctor stated the comparison and value\", \"stated_at\": \"IST timestamp string\", \"full_instruction\": \"verbatim doctor instruction\"}. Do NOT also place the same instruction in interventions_given_this_encounter unless the notes separately confirm it was actually administered."
  ],
  "known_medical_history": ["only if explicitly stated — includes conditions (e.g. 'diabetic', 'hypertensive', 'atrial fibrillation') AND named current medications (e.g. 'on Apixaban', 'on Warfarin', 'on Aspirin', 'on insulin'). Capture the specific drug name whenever one is stated rather than only a generic category like 'on blood thinners' — the specific agent matters for downstream eligibility/contraindication checks."],
  "explicitly_stated_negative_findings": ["only findings explicitly stated as normal/stable/absent/ruled-out, restated closely, e.g. 'pelvis stable, no pelvic instability', 'GCS 15, no loss of consciousness', 'pupils equal and reactive, no anisocoria', 'afebrile, no chills', 'no history of trauma'. These are used downstream to prevent contradicting the notes."],
  "latest_status_text": "verbatim or near-verbatim restatement of the MOST RECENT entry's current-status description",
  "data_gaps": ["things a clinician would normally need but that are not present in the notes, e.g. 'no vitals recorded', 'no reason for encounter given'"]
}
"""


async def extract_facts(timeline_text: str) -> Dict:
    prompt = f"""
CLINICAL NOTES TO EXTRACT FROM:
\"\"\"{timeline_text}\"\"\"

The most recent entry is the current status — if later entries update or
correct earlier ones (e.g. vitals re-checked, complaint clarified), use the
latest value, but do not discard information from earlier entries that
still applies (e.g. an earlier-stated history or treatment given).

    {EXTRACTION_OUTPUT_SHAPE}
"""
    return await _invoke_llm(llm_extract, EXTRACTION_SYSTEM, prompt)


# ============================================================
# DETERMINISTIC VITAL-SIGN SAFETY NET — pure Python, no LLM.
# Can only escalate triage.colour to Red; never downgrades or
# overrides anything else the model produced. This exists so a
# handful of unambiguous physiological red lines can never be
# missed by a bad/inconsistent LLM call.
# ============================================================

_TRIAGE_RANK = {"Green": 0, "Yellow": 1, "Unknown": 1, "Red": 2, "Black": 3}


def _vital_redlines(vitals: Dict) -> List[str]:
    """Return a list of human-readable redline breaches, or [] if none."""
    breaches: List[str] = []

    def _numeric(key):
        v = vitals.get(key)
        return v if isinstance(v, (int, float)) else None

    hr = _numeric("heart_rate_bpm")
    if hr is not None and (hr > 150 or hr < 40):
        breaches.append(f"Heart rate {hr}/min outside safe range (>150 or <40)")

    rr = _numeric("respiratory_rate_bpm")
    if rr is not None and (rr > 30 or rr < 8):
        breaches.append(f"Respiratory rate {rr}/min outside safe range (>30 or <8)")

    spo2 = _numeric("spo2_percent")
    if spo2 is not None and spo2 < 90:
        breaches.append(f"SpO2 {spo2}% below 90%")

    bp = vitals.get("blood_pressure")
    if isinstance(bp, str) and "/" in bp:
        try:
            sbp = float(bp.split("/")[0].strip())
            if sbp < 90:
                breaches.append(f"Systolic BP {sbp} below 90")
        except ValueError:
            pass

    gcs = vitals.get("consciousness_or_gcs")
    if isinstance(gcs, str):
        gcs_val = None
        # Prefer the number stated immediately after "GCS" (e.g. "GCS 12",
        # "GCS of 8") — this is always the total, never a component.
        m = re.search(r"gcs\D{0,10}?(\d{1,2})\b", gcs, re.IGNORECASE)
        if m:
            gcs_val = int(m.group(1))
        else:
            # Component breakdowns (e.g. "E1V2M3=6", "3+4+5=12") state the
            # TOTAL last, after an "=" — never take the first digit group,
            # which is a component score (e.g. "3" from "3+4+5=12"), not
            # the total.
            eq_matches = re.findall(r"=\s*(\d{1,2})\b", gcs)
            if eq_matches:
                gcs_val = int(eq_matches[-1])
            else:
                all_matches = re.findall(r"\b(\d{1,2})\b", gcs)
                if all_matches:
                    gcs_val = int(all_matches[-1])
        if gcs_val is not None and 3 <= gcs_val <= 15 and gcs_val < 13:
            breaches.append(f"GCS {gcs_val} below 13")

    return breaches


def _apply_vital_safety_net(suggestions: Dict, facts: Dict) -> Dict:
    """
    Deterministically escalate triage.colour to Red if a hard vital-sign
    redline is breached and the model's own colour was lower. Never
    downgrades. Records what triggered it (if anything) on the triage
    object itself so the frontend can show it came from the safety net,
    not the model's own reasoning.
    """
    vitals = facts.get("vitals") or {}
    breaches = _vital_redlines(vitals)
    triage = suggestions.setdefault("triage", {})

    if not breaches:
        triage["safety_net_breaches"] = []
        return suggestions

    current = triage.get("colour") or "Unknown"
    if _TRIAGE_RANK.get(current, 1) < _TRIAGE_RANK["Red"]:
        triage["colour"] = "Red"
        triage["data_available"] = True
        note = "Escalated to Red by automated vital-sign safety net: " + "; ".join(breaches)
        triage["rationale"] = (
            (triage.get("rationale") or "").strip() + " " + note
        ).strip()
    triage["safety_net_breaches"] = breaches
    return suggestions

_PDE5_TERMS = ("sildenafil", "tadalafil", "vardenafil", "pde-5", "pde5", "viagra", "cialis", "levitra")
_NITRO_TERMS = ("nitroglycerin", "nitrate", "gtn", "isosorbide")


def _facts_mention_pde5(facts: Dict) -> bool:
    """Search every free-text-bearing field for an existing PDE5 statement
    so we don't overwrite a clarifying question the model already asked
    correctly, or force a redundant question when the notes already state
    PDE5 use/non-use."""
    haystack_parts = [
        str(facts.get("relevant_history") or ""),
        str(facts.get("latest_status_text") or ""),
        " ".join(str(x) for x in (facts.get("known_medical_history") or [])),
        " ".join(str(x) for x in (facts.get("explicitly_stated_negative_findings") or [])),
    ]
    haystack = " ".join(haystack_parts).lower()
    return any(term in haystack for term in _PDE5_TERMS)


def _apply_nitro_pde5_safety_net(suggestions: Dict, facts: Dict) -> Dict:
    treatment_plan = suggestions.get("treatment_plan") or {}
    items = treatment_plan.get("items") or []

    nitro_recommended = any(
        any(t in str(item.get("drug_or_treatment") or "").lower() for t in _NITRO_TERMS)
        for item in items
    )
    if not nitro_recommended:
        return suggestions

    if _facts_mention_pde5(facts):
        return suggestions  # already documented either way — nothing to force

    existing_q = (treatment_plan.get("emt_clarifying_question") or "")
    if "pde" in existing_q.lower() or "sildenafil" in existing_q.lower() or "tadalafil" in existing_q.lower():
        return suggestions  # model already asked correctly

    treatment_plan["emt_clarifying_question"] = (
        "Has the patient taken sildenafil, tadalafil, or a similar PDE5 "
        "inhibitor recently? (Nitroglycerin is contraindicated with recent "
        "PDE5 inhibitor use.)"
    )
    suggestions["treatment_plan"] = treatment_plan
    return suggestions

# ============================================================
# STEP 2 — SUGGEST  (works only from STEP 1's structured facts)
#
# Output is deliberately limited to exactly the sections the frontend
# shows: clinical_impression, triage, treatment_plan, investigations,
# procedures, sbar_summary, referrals, complications, contraindications,
# precautions. Every one of these carries its own data_available /
# reason_if_unavailable — insufficiency in one section never blocks
# another, and the model must say "not enough data" per section rather
# than inventing a plausible-sounding filler.
# ============================================================

SUGGESTION_SYSTEM = (
    "You are assisting emergency clinicians. You are given ONLY a structured "
    "summary of facts already extracted from the patient's notes — you do not "
    "see the raw notes. Use ONLY these facts.\n\n"
    "You must produce exactly these ten things and nothing else: "
    "(1) clinical impression, (2) triage colour, (3) treatment plan / drugs "
    "to give, (4) investigations needed, (5) procedures to be done, "
    "(6) an SBAR handover summary, (7) referral department(s), "
    "(8) anticipated complications, (9) contraindication checks, "
    "(10) precautions. Do not add differentials-as-complications, "
    "monitoring plans beyond what's asked, timelines, or any other section — "
    "only fields matching this list.\n\n"
    "CHIEF-COMPLAINT-ONLY / PRE-ASSESSMENT CASES: if the facts consist only "
    "of a reported complaint (e.g. a dispatch call or bystander report) with "
    "NO vitals, NO exam findings, and NO clinician assessment yet performed, "
    "do NOT leave treatment_plan/investigations/procedures empty by default. "
    "Instead, you MAY populate them with standard, protocol-level first-"
    "response actions that are appropriate for that specific complaint "
    "pattern regardless of exam findings — e.g. for chest pain with "
    "breathing difficulty: obtain full vitals (BP, HR, RR, SpO2, temp), "
    "attach continuous cardiac/SpO2 monitoring, obtain a 12-lead ECG, "
    "establish IV access, and consider aspirin 300mg PO if no known "
    "contraindication once confirmed. Every such item MUST be explicitly "
    "marked as provisional: set confirmation_status to "
    "'provisional_pending_assessment' and word the reason to make clear "
    "this is based on the reported complaint pattern alone, pending actual "
    "clinical assessment — e.g. 'Standard first-response action for "
    "reported chest pain + dyspnea; confirm on exam before administering.' "
    "Never invent a specific weight-based or condition-specific dose that "
    "requires information not available (e.g. do not dose by renal "
    "function, weight-based drips, or anything needing a value you don't "
    "have) — only include actions/doses that are standard regardless of "
    "exam findings. This provisional tier does NOT apply once any real "
    "vitals or exam findings exist in the facts — in that case, use those "
    "findings normally per the rules below instead of provisional "
    "language.\n\n"
    "CLINICAL IMPRESSION — PATTERN RECOGNITION IS ALLOWED AND EXPECTED: "
    "this is the one place you are explicitly permitted to synthesize a "
    "most-likely working diagnosis from a constellation of symptoms/signs, "
    "even if no clinician or study in the notes ever stated that diagnosis "
    "outright. This is standard emergency-medicine pattern recognition (e.g. "
    "colicky loin-to-groin pain + hematuria + prior stone history + CVA "
    "tenderness -> 'most likely acute ureteric colic'; LUQ tenderness + "
    "seatbelt bruising + positive FAST + hypotension -> 'most likely splenic "
    "injury with hemoperitoneum'; burning epigastric pain + regular NSAID "
    "use + alcohol + no peritonism -> 'most likely NSAID-induced gastritis / "
    "peptic ulcer disease'), and it is DIFFERENT from inventing an "
    "unsupported complication or contraindication elsewhere in the output — "
    "confine this kind of synthesis to this one field. Requirements: "
    "(a) if diagnostic_conclusions_stated is non-empty, that IS the "
    "clinical impression verbatim — do not soften an already-confirmed "
    "diagnosis into a vaguer 'possible X'; (b) if diagnostic_conclusions_"
    "stated is empty but the facts (history + exam + vitals + any "
    "investigations_completed_with_findings) form a recognizable classic "
    "pattern, name the single most likely diagnosis (plus a brief "
    "differential if genuinely close) and explicitly label it as a working "
    "impression pending confirmation — cite the specific supporting facts; "
    "(c) if the facts are too sparse or nonspecific to support any pattern, "
    "say so plainly rather than forcing a name. This field feeds and must "
    "stay consistent with every other section below — name the impression "
    "explicitly in triage rationale, sbar_summary, and referrals rather "
    "than leaving those sections generic once an impression is reached "
    "here.\n\n"
    "MOST-SPECIFIC-STATED-DIAGNOSIS RULE: if "
    "diagnostic_conclusions_stated is non-empty, treat that as the "
    "governing diagnosis for every section below (treatment_plan, "
    "investigations, sbar_summary, referrals, complications, "
    "precautions) — do NOT default to a broader/generic category (e.g. "
    "'acute coronary syndrome') once the facts already give you a more "
    "specific, already-confirmed diagnosis (e.g. 'inferior STEMI'). Name "
    "the specific stated diagnosis explicitly wherever it drives a "
    "recommendation. If diagnostic_conclusions_stated is empty, fall back "
    "to the working impression from clinical_impression (if one was "
    "reached) to drive these same sections; only reason from bare "
    "symptoms/signs/vitals with no named impression at all if neither is "
    "available. Never invent a diagnosis beyond what clinical_impression "
    "itself already named.\n\n"
    "STRICT NO-HALLUCINATION RULE — the single most important rule you "
    "follow: for EACH of the ten things above, decide first whether the "
    "extracted facts genuinely support a real answer for that ONE section. "
    "If they do not, set that section's data_available to false, give a "
    "one-sentence reason_if_unavailable stating specifically what's missing "
    "for THAT section, and leave that section's item list / text empty or "
    "null. Never fill a section with a plausible-sounding generic answer "
    "just because the output shape asks for it. Insufficiency in one "
    "section never blocks another — judge every section independently. "
    "Every item you DO include, in every section, must cite the specific "
    "extracted fact(s) it is based on; if you cannot point to a specific "
    "fact, leave the item out entirely. This also means never inventing an "
    "underlying cause or mechanism to justify an item — e.g. do not "
    "justify an investigation with 'possible infection', 'possible "
    "inflammatory process', or 'possible coagulopathy', and do not label a "
    "complication as trauma-related (e.g. 'traumatic brain injury') "
    "unless that specific cause or mechanism is explicitly stated in the "
    "facts. If a justification would require assuming a cause the facts "
    "don't state, rewrite it to justify the item by what it is actually "
    "needed for instead (see each section below) or leave the item out. "
    "This also means never overstating what a test/investigation can "
    "actually diagnose — e.g. a plain chest X-ray does not diagnose "
    "pulmonary embolism (that requires CT pulmonary angiography or "
    "equivalent), a plain X-ray does not diagnose most soft-tissue or "
    "internal organ injuries, and so on; only state a capability for a "
    "test that is factually correct for that specific test and that "
    "specific condition.\n\n"
    "EMT CLARIFYING QUESTIONS — for clinical_impression, triage, "
    "treatment_plan, investigations, and procedures ONLY: whenever "
    "data_available is false, or is true but a specific detail relevant to "
    "that section is missing, ask yourself whether the missing piece is "
    "something the on-scene EMT crew could plausibly know and report right "
    "now (e.g. what has already been given, current vitals, exam findings, "
    "mechanism/timing details, patient response to an intervention) as "
    "opposed to something that requires imaging, lab results, a hospital-"
    "level assessment, or reflects the doctor's own prior clinical "
    "decision. If, and only if, it is EMT-answerable, populate that "
    "section's emt_clarifying_question with ONE short, plain-language "
    "question a doctor could send directly to the crew as-is — no jargon, "
    "no multi-part questions, phrased the way a doctor would actually type "
    "it to EMT (e.g. 'Has aspirin already been given?', 'What is the "
    "current oxygen saturation?', 'Is there any known allergy to aspirin?'). "
    "If the gap is NOT something EMT could answer, leave emt_clarifying_"
    "question null — never invent a question EMT has no way to answer, and "
    "never populate this field just because reason_if_unavailable is "
    "non-null; the two are independent judgements. MANDATORY CHECK BEFORE "
    "WRITING ANY emt_clarifying_question: re-read the ENTIRE facts object "
    "you were given — not just this section's inputs — including "
    "reason_for_encounter, symptom_onset_or_event_timing, vitals, "
    "primary_survey, interventions_given_this_encounter, "
    "prehospital_treatment_status, explicitly_stated_negative_findings, "
    "known_medical_history, and investigations_completed_with_findings. If "
    "the answer to your candidate question is already stated anywhere in "
    "that object, you MUST leave emt_clarifying_question null for this "
    "section instead — do not re-ask it, and do not fold an "
    "already-answered detail into a compound question alongside a genuinely "
    "new one (e.g. do not ask 'does it radiate to the arm or jaw' when arm "
    "radiation is already stated — ask only about jaw radiation, the part "
    "actually missing). Each section's question must be checked "
    "independently against the full facts object even though sections are "
    "otherwise judged independently of each other.\n\n"
    "HARD CONTRADICTION RULE — applies to every section, and is a SEPARATE, "
    "STRICTER check on top of the no-hallucination rule above: before "
    "including ANY item anywhere in the output (complication, procedure, "
    "precaution, contraindication, treatment), check it against "
    "explicitly_stated_negative_findings. If an item would directly "
    "contradict something the facts explicitly rule out, you MUST NOT "
    "include it — no exceptions, regardless of how generically plausible "
    "it sounds for 'this kind of case'. Concrete examples: if the facts "
    "state the pelvis is stable with no pelvic instability, do not "
    "recommend a pelvic binder and do not anticipate pelvic hemorrhage as a "
    "complication; if the facts state GCS 15/no loss of consciousness/"
    "normal pupils, do not anticipate traumatic brain injury or recommend "
    "airway protection for neuro reasons; if the facts state the patient "
    "is afebrile with no systemic infective signs, do not anticipate "
    "infection as a complication (a genuinely mechanism-linked future risk, "
    "e.g. obstructive pyelonephritis risk from an obstructing stone, may "
    "still be named, but must be framed explicitly as a potential future "
    "risk tied to the mechanism, not as a currently-anticipated active "
    "complication); if the facts state no history of trauma, do not add "
    "spinal-precaution or cervical-spine-injury content; if the facts "
    "describe non-tension/undifferentiated findings only, do not escalate "
    "to tension-pneumothorax-specific interventions unless tension-specific "
    "signs (tracheal deviation, hemodynamic instability, hyper-resonance, "
    "absent/markedly diminished unilateral breath sounds) are themselves "
    "present in the facts.\n\n"
    "DIFFERENTIAL-DIAGNOSIS-BEING-WORKED-UP IS NOT A COMPLICATION: if a "
    "condition is only present in the facts because a test was ordered to "
    "rule it in/out (e.g. amylase/lipase sent to check for pancreatitis "
    "alongside a gastritis-pattern presentation), that condition belongs, "
    "if anywhere, in clinical_impression's brief differential — never list "
    "it in the complications section as something anticipated to develop.\n\n"
    "TREATMENT PLAN / DRUGS: list only drugs/treatments the facts directly "
    "justify giving now, or that were already started and need continuing — "
    "hedge if there is genuine uncertainty. Give a dose ONLY if it is a "
    "standard, well-established dose for a clearly-indicated first-line "
    "drug in this exact scenario (e.g. 300mg aspirin for suspected ACS "
    "with no contraindication). If you are not confident of a safe "
    "standard dose, leave dose null and put 'dose per local protocol' in "
    "reason — never invent a number. Do not list a treatment the facts "
    "show was already given this encounter as if it were a new plan item; "
    "if the only appropriate action is continuing/reassessing something "
    "already given, say that explicitly instead (data_available stays "
    "true). Likewise, if the facts show a definitive intervention (surgery, "
    "transfusion, decompression, catheterization) is already being "
    "prepared for or is in progress, say so explicitly rather than phrasing "
    "it as a fresh recommendation to 'prepare for X'. Only recommend "
    "supplemental oxygen therapy as a plan item when the facts show a "
    "specific indication for it — hypoxia (typically SpO2 below 90%), "
    "respiratory distress, or heart failure — a stated SpO2 at or above "
    "90-94% alone, with no distress or heart failure described, is NOT by "
    "itself an indication for routine supplemental oxygen; state the "
    "actual basis (hypoxia/distress/heart failure) rather than defaulting "
    "to 'oxygen' whenever any SpO2 figure is present. "
    "THRESHOLD-CONDITIONAL DOCTOR ORDERS MUST BE RE-EVALUATED AGAINST "
    "CURRENT VITALS, EVERY TIME: for each entry in doctor_conditional_orders "
    "with condition_type 'vital_threshold', compare its threshold_detail "
    "against the CURRENT/most recent value of that vital in facts.vitals. "
    "If the current value already satisfies the stated trigger (e.g. order "
    "was 'O2 if SpO2 < 94%' and facts.vitals.spo2_percent is now 93%), the "
    "item MUST be listed as an ACTIVE, unconditional treatment_plan item — "
    "phrase the reason to state plainly that the doctor's threshold has "
    "already been met by the current vitals (e.g. 'Doctor ordered oxygen "
    "if SpO2 drops below 94%; current SpO2 is 93%, so this threshold is "
    "already met — administer now'), never still as a future 'if X' "
    "condition. Only keep it phrased as a future conditional ('to give if "
    "SpO2 drops below 94%') when the current vital has NOT yet crossed the "
    "stated threshold. Re-check this on every regeneration, since vitals "
    "may change between calls. "
    "Whenever "    "nitroglycerin/nitrate therapy appears in treatment_plan, it must have "
    "a matching entry in CONTRAINDICATIONS (see below) that explicitly "
    "checks right ventricular involvement/inferior infarction, "
    "hypotension, recent PDE-5 inhibitor use if stated, and significant "
    "bradycardia/tachycardia. If recent PDE-5 inhibitor use (sildenafil, "
    "tadalafil, vardenafil, or similar) is NOT already documented in the "
    "facts, treatment_plan's emt_clarifying_question MUST ask EMT to "
    "confirm whether the patient has taken a PDE-5 inhibitor recently — "
    "this is mandatory whenever nitroglycerin is recommended, not "
    "optional. ADDITIONALLY, whenever nitroglycerin is recommended for a "
    "presentation with ischemic changes in the inferior leads (II, III, "
    "aVF) and investigations_completed_with_findings does NOT contain a "
    "right-sided ECG (V4R) result, the nitroglycerin contraindication "
    "entry must NOT state 'no signs of right ventricular infarction' as a "
    "clean negative — instead it must state explicitly that right "
    "ventricular involvement has not been ruled out because a "
    "right-sided ECG (V4R) has not been obtained, and investigations "
    "must include 'right-sided ECG (V4R)' as an item to obtain before or "
    "alongside nitroglycerin administration if not already ordered. For an "
    "acute coronary syndrome presentation "
    "of ANY kind — ST-elevation OR non-ST-elevation/unstable angina — "
    "explicitly consider each of the following and include whichever are "
    "supported by the facts, not just the single most obvious drug: a "
    "second antiplatelet agent (e.g. ticagrelor or clopidogrel) alongside "
    "aspirin, anticoagulation (e.g. unfractionated heparin or a "
    "low-molecular-weight heparin), a high-intensity statin, adequate "
    "analgesia (e.g. morphine if pain persists despite nitrates), and "
    "beta-blocker therapy only when hemodynamically appropriate (avoid or "
    "flag as inappropriate if signs of heart failure, bradycardia, "
    "hypotension, or right ventricular infarction are present in the "
    "facts). PREHOSPITAL SCOPE GUARDRAIL: treatment_plan is a FIELD/EMS "
    "administration list only — never include a medication whose benefit "
    "requires sustained/chronic dosing rather than an acute effect during "
    "transport (e.g. high-intensity statins, other long-term chronic-"
    "disease medications). Such therapy is a hospital-admission-time "
    "decision, not a prehospital intervention, and must never appear as a "
    "treatment_plan item even when guideline-recommended for the condition "
    "in the inpatient setting — omit it entirely rather than listing it "
    "as 'to give'. THROMBOLYSIS IS NEVER APPROPRIATE FOR NSTEMI/NON-ST-ELEVATION "
    "ACS OR UNSTABLE ANGINA: if the facts describe ST depression and/or "
    "T-wave inversion (i.e. no ST elevation stated), you must NOT list or "
    "prepare for thrombolytic/fibrinolytic therapy under any framing — "
    "this is reserved for ST-elevation MI only, and including it for a "
    "non-ST-elevation picture is a serious, never-acceptable error; instead "
    "consider an early invasive strategy (catheterization) based on risk. "
    "For major trauma with evidence of significant hemorrhage/hemorrhagic "
    "shock, explicitly consider each of the following and include "
    "whichever are supported by the facts, not just the most obvious one: "
    "tranexamic acid (TXA) if within the guideline time window from injury, "
    "a pelvic binder ONLY if the facts state pelvic instability is "
    "suspected (never if the facts state the pelvis is stable — see HARD "
    "CONTRADICTION RULE), activating a massive hemorrhage protocol if "
    "shock physiology is present, direct pressure/hemorrhage control for "
    "any external bleeding site, analgesia appropriate to the injuries, "
    "and active warming/hypothermia prevention. For fluid resuscitation in "
    "hemorrhagic shock, do not simply say 'IV fluids' — state the "
    "preferred strategy explicitly: prioritize blood products over "
    "large-volume crystalloid, and favor permissive hypotension where "
    "clinically appropriate rather than aggressive crystalloid "
    "administration, unless the facts argue against it; if the facts "
    "already state blood grouping/cross-match is complete or a massive "
    "transfusion protocol is activated/on standby, treat blood-product "
    "resuscitation as the primary active strategy in your wording, not "
    "crystalloid, and say so explicitly rather than defaulting back to "
    "'continue crystalloids'. This blood-product consideration is "
    "MANDATORY, not optional phrasing, whenever the facts show "
    "hemorrhagic shock physiology (hypotension + tachycardia with a "
    "suspected significant bleeding source) — even if cross-match has "
    "NOT yet been done, include a distinct treatment_plan item for it "
    "(phrased as a relay instruction per the EMT-Basic scope rule above, "
    "e.g. 'Relay to incoming ALS/receiving facility: activate blood "
    "bank, obtain type & crossmatch, prepare for blood-product "
    "transfusion') rather than omitting blood products because a "
    "cross-match result isn't available yet. For a presentation with colicky flank/loin "
    "pain radiating toward the groin plus hematuria and/or a prior stone "
    "history (renal colic pattern), do not recommend liberal/aggressive IV "
    "fluid administration — state the goal as maintaining euvolemia only, "
    "since aggressive fluids do not facilitate stone passage — and "
    "explicitly consider medical expulsive therapy (e.g. an alpha-blocker "
    "such as tamsulosin) alongside analgesia and antiemetics. For a "
    "presentation suggesting acute stroke (sudden focal neurological "
    "deficit and/or reduced consciousness of non-traumatic origin), do NOT "
    "include thrombolysis, antiplatelet therapy (including aspirin), "
    "reperfusion therapy, or any other hemorrhage-incompatible treatment as "
    "a treatment_plan item to give now unless the facts explicitly state "
    "that neuroimaging (e.g. CT brain) has already been performed and has "
    "excluded hemorrhage — if imaging has not yet been done/reported in the "
    "facts, that determination is simply not available yet and must NOT "
    "appear as a plan item; instead flag the pending eligibility in "
    "contraindications (see CONTRAINDICATIONS below). When the facts show "
    "markedly elevated blood pressure alongside a suspected acute stroke "
    "presentation, include controlled blood pressure management (e.g. "
    "titrated intravenous antihypertensive therapy such as nicardipine or "
    "labetalol toward the guideline-appropriate target) as a "
    "treatment_plan item, and explicitly tie the target/urgency to "
    "reperfusion-therapy eligibility if that eligibility is still pending. "
    "For a presentation of severe, sudden headache with rapidly "
    "progressive neurological decline and markedly elevated blood pressure "
    "(hypertensive-emergency pattern with suspected raised intracranial "
    "pressure), explicitly consider, alongside blood pressure control: "
    "hyperosmolar therapy (mannitol or hypertonic saline) if signs of "
    "raised ICP/herniation are present, and avoidance of hypoxia/"
    "hypercapnia. For a tension pneumothorax pattern (see PROCEDURES below "
    "for the exact sign threshold), state explicitly that treatment must "
    "not be delayed for imaging — the diagnosis and the decompression "
    "decision are clinical, not radiographic.\n\n"
    "INVESTIGATIONS: labs, imaging, bedside tests, or validated severity-"
    "scoring tools that the specific findings justify. Reason from what is "
    "actually present in the facts, not a fixed memorized panel. You MUST "
    "reflect all three investigation buckets from the facts accurately and "
    "distinctly: (a) list every item in investigations_already_ordered_or_"
    "pending as already-in-progress/pending (data_available stays true) — "
    "do not omit any, and do not phrase them as if newly ordering "
    "something already ordered; (b) list every item in investigations_"
    "completed_with_findings as a COMPLETED result, stating the actual "
    "finding given — never describe one of these as merely 'ordered' or "
    "'pending', that discards the positive/actionable result; (c) list "
    "items in investigations_conditionally_planned as conditional/"
    "contingent, exactly as stated (e.g. 'if symptoms persist') — do not "
    "upgrade a conditional item into an unconditional 'already ordered' "
    "claim. Do not re-recommend a specific study the facts show has "
    "already been performed and interpreted (e.g. an ECG already read as "
    "showing ST elevation, or a positive FAST) as if it still needs to be "
    "obtained — instead, if further surveillance is clinically warranted, "
    "phrase it as 'repeat ECG if symptoms evolve' or 'continuous ECG "
    "monitoring', or (for a chest drain) 'post-procedure chest X-ray to "
    "confirm lung re-expansion and tube position'. For major trauma, "
    "explicitly consider each of: eFAST/FAST examination, arterial blood "
    "gas, serum lactate, complete blood count, blood grouping and "
    "crossmatch, coagulation profile, renal function, liver function, "
    "serum electrolytes, trauma CT imaging (when hemodynamically "
    "appropriate), ECG, and baseline biochemistry — alongside any targeted "
    "imaging (e.g. chest/pelvis/limb X-ray) the specific findings already "
    "justify. For chest-drain scenarios, include ongoing monitoring of "
    "drain output as an investigation/monitoring item (large or rapidly "
    "accumulating output can indicate need for thoracotomy). For a renal-"
    "colic pattern, explicitly include ongoing monitoring of pain score and "
    "urine output if the facts state these are being tracked, and consider "
    "urine culture if infection is suspected or the system is obstructed. "
    "WHENEVER nitroglycerin/nitrate therapy appears in treatment_plan for a "
    "presentation with ischemic changes in the inferior leads (II, III, "
    "aVF), and investigations_completed_with_findings does NOT already "
    "contain a right-sided ECG/V4R result, you MUST include 'Right-sided "
    "ECG (V4R)' as its own investigations item here, with status 'pending' "
    "and justification tied to ruling out right ventricular infarction "
    "before/alongside nitroglycerin administration — this is mandatory "
    "whenever that combination of drug and ECG pattern occurs, not "
    "optional, and is required in addition to (not instead of) the "
    "matching contraindications entry. "
    "For a suspected acute stroke/neurological presentation, explicitly "
    "consider: a validated stroke severity scale (e.g. NIH Stroke Scale) "
    "in addition to GCS, and CT angiography plus large-vessel-occlusion "
    "assessment (with mechanical thrombectomy evaluation where indicated) "
    "following an initial non-contrast CT. Justify every investigation by "
    "what it is actually needed for — baseline assessment, a specific "
    "treatment's eligibility, excluding a differential that IS supported "
    "by the facts, or procedural/surgical planning — never by inventing a "
    "suspected underlying cause that has no supporting fact, and never by "
    "claiming a test can diagnose a condition it cannot actually "
    "diagnose. CONSISTENCY WITH REFERRALS AND SBAR: this section must be "
    "judged from the exact same facts as referrals and sbar_summary — if "
    "you name a specific imaging study or lab test anywhere in a "
    "referral's reason or in the SBAR recommendation line, that same "
    "study MUST also appear as its own item here (status pending/"
    "completed/conditionally_planned as appropriate). Do NOT set "
    "investigations.data_available to false, or leave items empty, while "
    "recommending imaging or labs elsewhere in the same output — that is "
    "a self-contradiction and is never acceptable.\n\n"
    "PROCEDURES: hands-on procedures the facts justify(e.g. large-bore IV "
    "access, cervical collar, cardiac/multiparameter monitoring, advanced "
    "airway management, needle decompression) — kept separate from drugs. "
    "Do not recommend a procedure for a condition that is only suspected, "
    "not confirmed, when the procedure itself carries real risk and is "
    "only indicated for the confirmed/severe form — instead recommend "
    "close monitoring and preparedness, UNLESS the specific confirming "
    "signs are already present in the facts, in which case the procedure "
    "must be listed as an action to perform NOW, not deferred to "
    "'prepare for'. Concretely: needle/chest decompression must be listed "
    "as an action to perform NOW whenever the facts show signs specific to "
    "TENSION pneumothorax (e.g. tracheal deviation, absent/markedly "
    "diminished unilateral breath sounds with hyper-resonance, and "
    "hemodynamic instability/hypotension attributable to it) — when those "
    "specific signs are present together, do not soften this into a "
    "chest-drain-only or 'prepare for' recommendation; needle decompression "
    "comes first, before or in parallel with definitive chest drain "
    "insertion, and must not be delayed for chest X-ray. Reduced air entry "
    "or a suspected (non-tension) pneumothorax ALONE, without those "
    "tension-specific signs, is NOT sufficient justification for "
    "decompression now — in that case say the patient should be monitored "
    "closely and prepared for emergency decompression if tension physiology "
    "develops. This same anticipatory-versus-indicated-now distinction "
    "applies to every procedure, not only chest decompression: do not "
    "recommend endotracheal intubation as an action to perform now solely "
    "because of reduced consciousness/drowsiness, without another acute "
    "indication actually present — phrase it instead as preparedness, e.g. "
    "'prepare for airway protection if neurological deterioration occurs "
    "or airway reflexes become impaired.' For a suspected acute stroke "
    "presentation, also consider frequent neurological reassessment and a "
    "swallow assessment before any oral intake, when supported by the "
    "facts. For a suspected raised-ICP presentation, also consider close "
    "pupillary/neurological monitoring. For a renal-colic pattern, name "
    "concrete potential urological interventions (ureteric stenting, "
    "percutaneous nephrostomy if an obstructed infected system develops, "
    "ureteroscopy) rather than a generic 'prepare for intervention'. For a "
    "confirmed cardiac tamponade pattern, name pericardiocentesis as the "
    "immediate decompressive step and also mention that definitive "
    "surgical management (emergency thoracotomy/surgical pericardial "
    "exploration) commonly follows. Do not re-list a procedure the facts "
    "show is already in progress/activated/prepared (e.g. 'Cath Lab "
    "notified', 'prepared for exploratory laparotomy', 'chest drain "
    "planned') as a new action item — acknowledge explicitly that it is "
    "already underway/prepared instead. "
    f"The responder on scene is {RESPONDER_SKILL_LEVEL}. Any procedure "
    f"above {RESPONDER_SKILL_LEVEL} scope must NOT be phrased as a direct "
    "instruction to perform — phrase it as something to relay to incoming "
    "ALS/paramedic or hospital staff, e.g. 'Relay to incoming ALS: prepare "
    "for needle decompression if tension physiology develops.'. The same "
    "scope rule applies to treatment_plan items — anything requiring a "
    f"skill level above {RESPONDER_SKILL_LEVEL} must be phrased as a "
    "relay instruction, not a direct one. When "
    f"{RESPONDER_SKILL_LEVEL} is 'EMT-Basic' specifically, treat IV/IO "
    "cannulation, IV fluid administration (including any crystalloid "
    "bolus, e.g. normal saline or Ringer's lactate), and any IV/IM "
    "medication administration (including TXA, opioid/analgesic "
    "administration, and any other injectable drug) as ABOVE EMT-Basic "
    "scope by default, unless the facts themselves state a higher-scope "
    "clinician or an ALS/paramedic unit is already on scene performing "
    "them — phrase these as a relay instruction, e.g. 'Relay to incoming "
    "ALS: establish second IV access and give TXA 1g IV over 10 min if "
    "within the time window' or 'Relay to incoming ALS: administer "
    "500 mL crystalloid bolus' rather than a direct instruction to the "
    "EMT-Basic responder. This applies EVERY TIME an IV fluid bolus is "
    "recommended, with no exception for hemorrhagic-shock cases — do not "
    "let the urgency of the shock picture cause this item to slip back "
    "into direct-instruction phrasing the way morphine and decompression "
    "correctly do not. Advanced airway drugs are always above EMT-Basic "
    "scope for the same reason.\n\n"
    "SBAR SUMMARY: Situation / Background / Assessment / Recommendation, a "
    "few sentences, built only from facts and conclusions already present "
    "in the other sections you produced above — no new claims. If "
    "patient_age and/or patient_sex are present in the extracted facts, "
    "state them in the Situation line (e.g. '68-year-old male...') — do "
    "not say age/sex is unspecified when it is present in the facts you "
    "were given. The Situation/Assessment lines MUST include any item from "
    "investigations_completed_with_findings (e.g. a positive FAST/eFAST "
    "result, specific ECG changes, Beck's triad on exam) — omitting a "
    "completed diagnostic finding from the handover is a significant "
    "handover safety gap and must not happen. If clinical_impression named "
    "a working diagnosis or diagnostic_conclusions_stated is non-empty, the "
    "Assessment line must name that specific diagnosis and its key "
    "supporting finding(s) (e.g. 'inferior STEMI, ST elevation in II, III, "
    "aVF with reciprocal depression in I, aVL'; or 'findings consistent "
    "with traumatic cardiac tamponade causing obstructive shock'), and the "
    "Recommendation line must reflect any definitive-management step "
    "already activated per investigations_already_ordered_or_pending or "
    "interventions_given_this_encounter (e.g. Cath Lab activation, "
    "massive transfusion protocol, surgery already prepared) rather than "
    "omitting it.\n\n"
    "REFERRALS: department(s) directly justified by the facts, ordered by "
    "clinical urgency — the department tied to the most time-critical "
    "concern listed first. Do not collapse multiple separately-justified "
    "specialties into one vague referral, and do not add a specialty with "
    "no specific supporting fact. For a stated or strongly-impressed "
    "STEMI/NSTE-ACS diagnosis, explicitly consider, in addition to "
    "Cardiology and Emergency Medicine: Interventional Cardiology, Cath "
    "Lab, and Coronary Care Unit/Cardiac ICU. For major trauma, in "
    "addition to any organ/injury-specific surgical specialty already "
    "justified (e.g. Trauma Surgery, Orthopedic Surgery, Neurosurgery, "
    "Cardiothoracic Surgery), also explicitly consider: Emergency "
    "Medicine/Trauma Team Lead, Anesthesiology, Intensive Care Unit, Blood "
    "Bank/Transfusion Medicine, and Radiology — include whichever the "
    "facts justify (e.g. ICU if the patient needs high-acuity monitoring, "
    "Blood Bank/Transfusion Medicine if hemorrhagic shock or massive "
    "hemorrhage protocol is in play). For a suspected acute stroke "
    "presentation, in addition to any specialty already justified by the "
    "facts (e.g. Neurosurgery if hemorrhage/mass effect is plausible), "
    "also explicitly consider: Neurology/Stroke Team, Intensive Care Unit "
    "if high-acuity monitoring is needed, and Interventional "
    "Neuroradiology if the facts make thrombectomy for a large-vessel "
    "occlusion plausible. For a renal-colic pattern, Urology referral is "
    "appropriate mainly if the facts show obstruction, significant stone "
    "burden, renal impairment, or uncontrolled pain — for an uncomplicated "
    "presentation, Emergency Medicine management with outpatient Urology "
    "follow-up is more accurate than an immediate referral. For a "
    "gastritis/PUD-pattern presentation without alarm features, "
    "Gastroenterology referral is appropriate only if symptoms persist, "
    "recur, or investigations suggest ulcer disease — do not make it a "
    "routine immediate referral by default.\n\n"
    "COMPLICATIONS: complications plausible specifically for this "
    "patient's actual findings/mechanism — not a generic checklist for a "
    "similar-sounding case, and never one that violates the HARD "
    "CONTRADICTION RULE above. Only include one if a fact makes it a "
    "plausible consequence. Never list the patient's current, "
    "already-stated or already-impressed diagnosis itself (e.g. "
    "'myocardial infarction' when MI is the presenting diagnosis) as an "
    "anticipated complication — anticipated complications must be "
    "conditions that have not yet occurred but could still develop. Never "
    "list a condition that is only present because it is being actively "
    "ruled out via ordered tests (see DIFFERENTIAL-DIAGNOSIS rule above) — "
    "that belongs in clinical_impression's differential, not here. For a "
    "stated/impressed STEMI or NSTE-ACS, explicitly consider: ventricular "
    "fibrillation, ventricular tachycardia, complete heart block "
    "(especially for an inferior STEMI), cardiogenic shock (only if the "
    "mechanism is primary pump failure — see obstructive-vs-cardiogenic "
    "note below), right ventricular infarction, acute heart failure, and "
    "mechanical complications (papillary muscle rupture, ventricular "
    "septal rupture). OBSTRUCTIVE VS CARDIOGENIC SHOCK: if the facts show "
    "the shock mechanism is obstructive (e.g. pericardial effusion/"
    "tamponade with Beck's triad, or tension pneumothorax), do not label "
    "it or its complications as 'cardiogenic shock' — cardiogenic shock "
    "specifically means primary myocardial pump failure, which is a "
    "different mechanism; use 'obstructive shock' language instead and "
    "reserve cardiogenic-shock complications for a primary cardiac "
    "pump-failure picture (e.g. large MI). For major blunt/high-energy "
    "trauma, explicitly consider each of: progressive traumatic brain "
    "injury (ONLY if a head mechanism/finding is stated — e.g. loss of "
    "consciousness, abnormal GCS, or scalp/head injury — never if GCS is "
    "normal with no LOC and no head-injury finding), pelvic hemorrhage "
    "(ONLY if pelvic instability is stated, never if the facts state the "
    "pelvis is stable), acute respiratory failure (only if there is "
    "ongoing respiratory compromise in the facts, not once oxygenation is "
    "already stated as adequate), trauma-induced coagulopathy, "
    "hypothermia, compartment syndrome, fat embolism syndrome (particularly "
    "for long-bone/femoral fractures), and multi-organ dysfunction (only "
    "as a longer-term theoretical risk in a genuinely unstable/shocked "
    "patient, not a stable one) — include whichever are plausible given "
    "the specific mechanism and findings present, not the full list by "
    "default. Never attribute a complication to a mechanism the facts do "
    "not state. For a spontaneous, non-traumatic neurological "
    "presentation (e.g. suspected intracerebral hemorrhage), use the "
    "correct non-traumatic equivalents instead where the facts support "
    "them: hematoma expansion, raised intracranial pressure, cerebral "
    "edema, brain herniation, hydrocephalus, hemorrhagic expansion/"
    "transformation, seizures, and neurological deterioration — do not "
    "default to generic 'cardiac complications' as a leading concern here. "
    "For a suspected obstructive uropathy/renal colic pattern, a genuinely "
    "mechanism-linked future risk (e.g. obstructive pyelonephritis if the "
    "system becomes obstructed and infected) may be named but must be "
    "framed as a potential future risk, not a currently-anticipated active "
    "complication, when the patient is currently afebrile with no "
    "infective signs.\n\n"
    "CONTRAINDICATIONS: produce one entry for EVERY treatment/drug/"
    "procedure you yourself recommended in treatment_plan or procedures "
    "above — check it against the extracted facts (current medications, "
    "allergies, comorbidities, recent procedures, and explicitly_stated_"
    "negative_findings) and state the specific concern found. For aspirin "
    "specifically, the entry must address active bleeding and severe "
    "aspirin allergy if either is statable from the facts (state "
    "explicitly that neither is reported in the facts if that's genuinely "
    "the case). For nitroglycerin/nitrates specifically, the entry must "
    "address right ventricular involvement/inferior infarction, "
    "hypotension, recent PDE-5 inhibitor use if stated, and bradycardia/"
    "tachycardia.     Only write 'no contraindication evidence found in the given facts' "
    "when you have genuinely checked and found nothing "
    "relevant — do not let this become a default filler answer; for many "
    "trauma patients on an initial presentation there may genuinely be no "
    "documented contraindication yet, and that is a legitimate answer, but "
    "it must reflect an actual check each time, not a reflex. For any "
    "PROVISIONAL item (confirmation_status = 'provisional_pending_"
    "assessment'), do NOT write 'no contraindication found' — instead "
    "state explicitly that contraindications (allergy, active bleeding, "
    "current medications, comorbidities) cannot be verified without a "
    "clinical assessment/history, and that this must be confirmed before "
    "administration. Never leave "
    "a recommended item without a matching contraindication entry. Two "
    "situations must NEVER be reported as 'no contraindication found': "
    "(1) if the treatment's eligibility genuinely depends on a "
    "confirmatory result not yet present in the facts (e.g. thrombolysis/"
    "antiplatelet eligibility in suspected stroke pending a non-contrast "
    "CT to exclude hemorrhage) — state plainly that eligibility cannot be "
    "determined until that specific test/result is available, and name "
    "the pending test; (2) if a fact already directly conflicts with a "
    "known safety threshold for that treatment (e.g. blood pressure "
    "exceeding the accepted threshold for thrombolysis) — that IS a "
    "contraindication and must be stated explicitly, never omitted or "
    "concealed behind a 'no contraindication found' answer.\n\n"
    "PRECAUTIONS: distinct from contraindications — these are mechanism- "
    "or presentation-specific things the treating team should be careful "
    "about given this patient's condition, independent of any single drug/"
    "procedure eligibility check, and — like every other section — must "
    "obey the HARD CONTRADICTION RULE above. Examples: cautious use of "
    "positive-pressure ventilation, but ONLY in a patient with facts "
    "showing suspected (non-tension) pneumothorax or similar air-leak "
    "risk — never add this precaution when no pneumothorax/air-leak finding "
    "is present in the facts; avoiding excessive crystalloid "
    "administration in hemorrhagic shock; caution with sedation in a "
    "patient with reduced GCS; care with spinal movement, but ONLY in "
    "suspected spinal injury or a trauma mechanism actually stated in the "
    "facts — never add this precaution when the facts state no history of "
    "trauma. Only include a precaution if it is tied to a specific fact "
    "about this patient — do not list generic precautions that would "
    "apply to any patient, and never one already excluded by an "
    "explicitly_stated_negative_finding.\n\n"
    "TRIAGE: Red/Yellow/Green/Black, tied explicitly to named facts in the "
    "rationale. Only use Unknown if the case truly cannot be assessed at "
    "all (see sufficiency standard below). HIGH-RISK ACS MUST BE RED: any "
    "presentation with ischemic-pattern chest pain AND dynamic/ischemic ECG "
    "changes explicitly stated (ST elevation OR ST depression/T-wave "
    "inversion) must be triaged Red/high-acuity, not Yellow — this applies "
    "regardless of ST-elevation vs non-ST-elevation, and regardless of "
    "current hemodynamic stability, because the ischemia itself is the "
    "time-critical threat. Any presentation the vital-sign safety net "
    "would flag (see the deterministic check applied after your output) "
    "should already be Red in your own reasoning too — do not undertriage "
    "a patient with clear high-risk ischemic, hemorrhagic, obstructive-"
    "shock, or neurological-emergency findings just because a single "
    "vital sign is currently within a borderline-normal range.\n\n"
    "SUFFICIENCY STANDARD (applies to the overall case, before the "
    "per-section checks above): sufficient_data is false ONLY when you "
    "lack BOTH (a) a reason the patient is being seen, AND (b) any "
    "indication at all of their physiological state (vitals, "
    "consciousness level, or described injury/symptom severity) — i.e. "
    "you genuinely cannot tell what's wrong or how sick they are. A single "
    "missing routine data point does not make the whole case insufficient; "
    "it may still make ONE specific section (e.g. investigations) "
    "unavailable while the rest remain available. When multiple vitals "
    "already point to a critical picture, do not withhold or soften "
    "triage waiting on an unrelated missing data point.\n\n"
    "Respond with valid JSON only."
)

SUGGESTION_OUTPUT_SHAPE = """
Return ONLY valid JSON in this exact shape:
{
  "sufficient_data": true,
  "missing_information": ["only if sufficient_data is false — the specific reason(s) you genuinely cannot assess this patient at all"],
  "clinical_impression": {
    "data_available": true,
    "reason_if_unavailable": "string or null",
    "emt_clarifying_question": "string or null — see EMT CLARIFYING QUESTIONS rule",
    "impression": "string or null — the single most likely diagnosis (verbatim from diagnostic_conclusions_stated if non-empty, otherwise a synthesized working impression from the symptom/sign/vitals pattern, explicitly labeled as pending confirmation if not already stated by a clinician/study)",
    "supporting_findings": ["the specific extracted facts that support this impression"],
    "differential": ["optional — other plausible diagnoses genuinely close in likelihood, or conditions being actively investigated/ruled out via ordered tests; leave empty if not applicable"]
  },
  "triage": {
    "colour": "Red|Yellow|Green|Black|Unknown",
    "rationale": "string or null — tied to specific facts",
    "data_available": true,
    "reason_if_unavailable": "string or null",
    "emt_clarifying_question": "string or null — see EMT CLARIFYING QUESTIONS rule"
  },
  "treatment_plan": {
    "data_available": true,
    "reason_if_unavailable": "string or null",
    "emt_clarifying_question": "string or null — see EMT CLARIFYING QUESTIONS rule",
    "items": [
{"drug_or_treatment": "string", "dose": "string or null", "reason": "string — cite the specific extracted fact(s) or doctor_conditional_orders entry", "confirmation_status": "new|continuing|previously_advised_unconfirmed|provisional_pending_assessment"}
    ]
  },
  "investigations": {
    "data_available": true,
    "reason_if_unavailable": "string or null",
    "emt_clarifying_question": "string or null — see EMT CLARIFYING QUESTIONS rule",
    "items": [
      {"investigation": "string", "status": "pending|completed|conditionally_planned", "finding_if_completed": "string or null", "justification": "string — cite the specific fact"}
    ]
  },
  "procedures": {
    "data_available": true,
    "reason_if_unavailable": "string or null",
    "emt_clarifying_question": "string or null — see EMT CLARIFYING QUESTIONS rule",
    "items": [
      {"procedure": "string", "timing": "perform_now|prepare_for|already_in_progress", "reason": "string — cite the specific fact", "confirmation_status": "new|continuing|previously_advised_unconfirmed|provisional_pending_assessment"}
    ]
  },
  "sbar_summary": {
    "data_available": true,
    "reason_if_unavailable": "string or null",
    "text": "string or null"
  },
  "referrals": {
    "data_available": true,
    "reason_if_unavailable": "string or null",
    "items": [
      {"specialty": "string", "reason": "string — cite the specific fact"}
    ]
  },
  "complications": {
    "data_available": true,
    "reason_if_unavailable": "string or null",
    "items": [
      {"complication": "string", "reason": "string — cite the specific fact"}
    ]
  },
  "contraindications": {
    "data_available": true,
    "reason_if_unavailable": "string or null",
    "items": [
      {"treatment_or_medication": "string — must be something recommended in treatment_plan or procedures", "contraindication_assessment": "string"}
    ]
  },
  "precautions": {
    "data_available": true,
    "reason_if_unavailable": "string or null",
    "items": [
      {"precaution": "string", "reason": "string — cite the specific fact this precaution is tied to"}
    ]
  }
}
Every section's data_available must be an honest, independent judgement for
THAT section only. If data_available is false for a section, its items list
must be empty (or text/rationale/impression null for sbar_summary/triage/
clinical_impression) and reason_if_unavailable must explain specifically
what is missing — never leave reason_if_unavailable null when data_available
is false, and never populate items when data_available is false. For each
investigations item, "status" must match which of the three extracted
buckets it came from (investigations_already_ordered_or_pending -> "pending",
investigations_completed_with_findings -> "completed" with
finding_if_completed filled in, investigations_conditionally_planned ->
"conditionally_planned") — never mark a completed item as pending or a
conditional item as already ordered. emt_clarifying_question is independent
of data_available — it may be populated on a data_available:true section if
one specific EMT-answerable detail is still missing, and must stay null on a
data_available:false section if the gap is not something EMT could answer
(see EMT CLARIFYING QUESTIONS rule above).
"""

async def generate_suggestions(
    facts: Dict,
    approved: List[str],
    rejected: List[str],
    previously_advised: List[Dict],
    rejected_items: List[Dict],
) -> Dict:
    approved_block = "\n".join(f"  - {a}" for a in approved) or "  (none)"
    rejected_block = "\n".join(f"  - {r}" for r in rejected) or "  (none)"
    rejected_items_block = "\n".join(
        f"  - [{item['kind']}] {item['name']} — rejected at {item['rejected_at']}"
        for item in rejected_items
    ) or "  (none)"
    conditional_orders = facts.get("doctor_conditional_orders") or []
    conditional_orders_block = "\n".join(
        f"  - {o.get('treatment_or_action')} — ordered at {o.get('stated_at')} "
        f"(\"{o.get('full_instruction')}\")"
        for o in conditional_orders if isinstance(o, dict)
    ) or "  (none)"
    advised_block = "\n".join(
        f"  - [{item['kind']}] {item['name']}"
        + (f" ({item['dose']})" if item.get('dose') else "")
        + f" — advised at {item['advised_at']}"
        for item in previously_advised
    ) or "  (none)"

    prompt = f"""
EXTRACTED FACTS (this is ALL the information you have — do not assume anything beyond it):
{json.dumps(facts, indent=2, default=str)}

RESPONDER SKILL LEVEL ON SCENE: {RESPONDER_SKILL_LEVEL}
Any treatment_plan or procedures item above this scope must be phrased as
something to relay to incoming higher-scope personnel, not a direct
instruction.

ACTIONS ALREADY APPROVED AND DONE FOR THIS PATIENT — do not re-suggest these
in treatment_plan/procedures as if new; if relevant, note continuation or
reassessment instead:
{approved_block}

ACTIONS THE DOCTOR EXPLICITLY REJECTED — never re-suggest these:
{rejected_block}

SPECIFIC DRUGS/TREATMENTS/PROCEDURES EXPLICITLY REJECTED IN A PRIOR
SUGGESTION FOR THIS PATIENT (name-level, not just a rationale summary) —
NEVER re-suggest any of these by name unless a new fact in the current
notes materially changes the clinical picture that justified the
rejection (e.g. a new vital-sign breach, a new doctor instruction
superseding it, or a new finding). If nothing has materially changed,
omit the item entirely rather than re-listing it — do not silently
re-suggest a rejected item just because it would otherwise be clinically
indicated by the same facts that were already present when it was
rejected:
{rejected_items_block}

DOCTOR CONDITIONAL ORDERS FOR THIS ENCOUNTER — these are ORDERS TO GIVE,
NOT rejections, regardless of their "if not already given" / "unless
already administered" phrasing. Each one MUST appear in treatment_plan or
procedures with confirmation_status "previously_advised_unconfirmed", a
reason quoting the doctor's own instruction, AND a populated
emt_clarifying_question asking EMT to confirm whether it has already been
administered (unless facts.interventions_given_this_encounter already
confirms it was, in which case treat it as already-given per the existing
rule). NEVER classify one of these as rejected, and never silently drop it
from a later-regenerated suggestion just because it was raised earlier in
the conversation — it remains a standing order until confirmed given or the
doctor issues a new instruction superseding it:
{conditional_orders_block}

SPECIFIC DRUGS/TREATMENTS/PROCEDURES ALREADY ADVISED IN A PRIOR APPROVED
SUGGESTION FOR THIS PATIENT (name-level, not just a rationale summary):
{advised_block}
For each one: check facts.interventions_given_this_encounter. If the current
notes now confirm it was actually administered, treat it as already-done per
the existing rule above (note continuation/reassessment, do not list as new).
If it is NOT confirmed given in the current facts, you MUST NOT silently
repeat it as a fresh unqualified "give this" instruction and you must NOT
duplicate it as a second, separate item. Instead include it exactly once in
treatment_plan or procedures with confirmation_status set to
"previously_advised_unconfirmed" and a reason such as: "Advised in a prior
approved suggestion at {{advised_at}} — not yet confirmed as administered in
the current notes. Confirm whether this was given; if not, give it now."

    {SUGGESTION_OUTPUT_SHAPE}
"""
    return await _invoke_llm(llm_suggest, SUGGESTION_SYSTEM, prompt)


# ============================================================
# ORCHESTRATION
# ============================================================

async def process_patient(
    patient_id: str,
    include_intermediates: bool = False,
) -> Dict:
    start_ms = datetime.now().timestamp() * 1000

    entries, emt_count, doctor_count, image_count = await _fetch_all_clinical_entries(patient_id)
    timeline_text = _build_timeline_text(entries)

    clinical_actions = await _fetch_clinical_actions(patient_id)
    approved, rejected = _summarize_clinical_actions(clinical_actions)
    previously_advised = _extract_previously_advised_treatments(clinical_actions)
    rejected_items = _extract_rejected_treatments(clinical_actions)

    facts = await extract_facts(timeline_text)
    if facts.get("_parse_error"):
        logger.error(f"Fact extraction failed to parse for patient {patient_id}: truncated={facts.get('_truncated')}")
        facts = {}

    suggestions = await generate_suggestions(facts, approved, rejected, previously_advised, rejected_items)
    if suggestions.get("_parse_error"):
        logger.error(f"Suggestion generation failed to parse for patient {patient_id}: truncated={suggestions.get('_truncated')}")
        reason = (
            "The AI response was cut off before completing (output too long for the current limit)."
            if suggestions.get("_truncated")
            else "The AI response could not be parsed."
        )
        suggestions = {
            "sufficient_data": False,
            "missing_information": [reason],
            "clinical_impression": {"data_available": False, "reason_if_unavailable": reason, "emt_clarifying_question": None, "impression": None, "supporting_findings": [], "differential": []},
            "triage": {"colour": "Unknown", "rationale": None, "data_available": False, "reason_if_unavailable": reason, "emt_clarifying_question": None},
            "treatment_plan": {"data_available": False, "reason_if_unavailable": reason, "emt_clarifying_question": None, "items": []},
            "investigations": {"data_available": False, "reason_if_unavailable": reason, "emt_clarifying_question": None, "items": []},
            "procedures": {"data_available": False, "reason_if_unavailable": reason, "emt_clarifying_question": None, "items": []},
            "sbar_summary": {"data_available": False, "reason_if_unavailable": reason, "text": None},
            "referrals": {"data_available": False, "reason_if_unavailable": reason, "items": []},
            "complications": {"data_available": False, "reason_if_unavailable": reason, "items": []},
            "contraindications": {"data_available": False, "reason_if_unavailable": reason, "items": []},
            "precautions": {"data_available": False, "reason_if_unavailable": reason, "items": []},
        }

    # Deterministic vital-sign safety net — code-level, no LLM. Can only
    # escalate triage.colour to Red, never downgrade or override anything
    # else the model produced.
    suggestions = _apply_vital_safety_net(suggestions, facts)

    # Deterministic, code-level — surfaces already-given EMT/doctor
    # treatments as their own display-only section (see definition above).
    suggestions = _apply_previously_administered(suggestions, facts)

    # Deterministic, code-level — the LLM's own PDE5 instruction is not
    # reliably followed (observed: nitro suggested with the PDE5 question
    # silently missing). Never invents or removes the drug itself; only
    # force-populates the clarifying question if the model failed to.
    suggestions = _apply_nitro_pde5_safety_net(suggestions, facts)

    latest_ts_ist = iso_ist(entries[-1].get("timestamp")) if entries else ""
    elapsed = round(datetime.now().timestamp() * 1000 - start_ms)

    result = {
        "patient_id": patient_id,
        "generated_at_ist": now_ist().isoformat(),
        "latest_entry_timestamp_ist": latest_ts_ist,
        "processing_time_ms": elapsed,
        "data_sources": {
            "emt_voice_dictations": emt_count,
            "doctor_voice_notes": doctor_count,
            "image_extracted_records": image_count,
            "total_entries": len(entries),
        },
        "clinical_action_history": {
            "approved_count": len(approved),
            "rejected_count": len(rejected),
            "approved": approved,
            "rejected": rejected,
        },
        "suggestions": suggestions,
    }
    if include_intermediates:
        result["extracted_facts"] = facts


    return result


# ============================================================
# API ENDPOINTS
# ============================================================

@router.post("/emergency/voice-suggestions/{patient_id}")
async def get_emergency_suggestions(
    patient_id: str,
    include_intermediates: bool = False,
):
    """
    Reads EMT + doctor notes (+ any image-extracted vitals) for the patient
    and returns exactly: clinical impression, triage, treatment plan/drugs,
    investigations, procedures, an SBAR handover summary, referrals,
    anticipated complications, and contraindication checks. Each section
    independently reports data_available — if the notes don't contain enough
    to responsibly fill a given section, that section says so explicitly
    instead of guessing. Responder scope is fixed at EMT-Basic.
    """
    result = await process_patient(
        patient_id,
        include_intermediates=include_intermediates,
    )
    return {
        "status": "success",
        "patient_id": patient_id,
        "generated_at_ist": result["generated_at_ist"],
        "processing_time_ms": result["processing_time_ms"],
        "results": [result],
    }


@router.get("/emergency/health")
async def evis_health():
    return {
        "status": "ok",
        "system": "EVIS — Emergency Voice Intelligence System (simplified)",
        "version": "6.1.0",
        "pipeline": [
            "STEP 1 — extract explicitly-stated facts from EMT/doctor notes, "
            "including a 3-way investigation status split (pending / "
            "completed-with-finding / conditionally-planned) and explicit "
            "negative/ruled-out findings",
            "STEP 2 — clinical impression (pattern-recognition working "
            "diagnosis), triage, treatment plan/drugs, investigations, "
            "procedures, SBAR summary, referrals, complications, "
            "contraindications, precautions — from extracted facts only, "
            "each section self-reporting data_available and forbidden from "
            "contradicting explicitly_stated_negative_findings",
            "(code-level, no LLM) — vital-sign safety net, deterministically "
            "built from STEP 1's extracted facts, can only escalate triage "
            "to Red",
        ],
        "responder_skill_level": RESPONDER_SKILL_LEVEL,
        "timezone": "IST (Asia/Kolkata, UTC+5:30)",
        "current_time_ist": now_ist().isoformat(),
    }


# ============================================================
# CLINICAL ACTIONS  (unchanged CRUD — not part of the suggestion pipeline)
# ============================================================

class ClinicalActionSaveRequest(BaseModel):
    patient_id: str
    ai_suggestion: Optional[dict] = None
    voice_dictation: Optional[str] = None
    action_type: str
    created_at: str


async def _notify_driver(patient_id: str) -> None:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(
                "https://doctorassist.ai/api/hms/users/ambulance/notify-driver-update",
                json={"patient_id": patient_id, "update_type": "CLINICAL_ACTION_UPDATE"},
            )
    except Exception as notify_err:
        logger.warning(f"Driver notify failed (non-critical): {notify_err}")


async def _notify_doctor(patient_id: str, update_type: str) -> None:
    """
    Pushes a live WebSocket update to any doctor browser tab with this
    patient open (PatientProfileEmergency.jsx). The doctor's WS connection
    is held by the gateway service, not this one, so this crosses the
    service boundary the same way _notify_driver above already does.
    """
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(
                "https://doctorassist.ai/api/hms/users/ambulance/notify-doctor-update",
                json={"patient_id": patient_id, "update_type": update_type},
            )
    except Exception as notify_err:
        logger.warning(f"Doctor notify failed (non-critical): {notify_err}")


@router.post("/clinical-action/save")
async def save_clinical_action(data: ClinicalActionSaveRequest):
    if data.ai_suggestion is None and data.voice_dictation is None:
        raise HTTPException(status_code=400, detail="Either ai_suggestion or voice_dictation must be provided")

    document = {
        "patient_id": data.patient_id,
        "ai_suggestion": data.ai_suggestion,
        "voice_dictation": data.voice_dictation,
        "action_type": data.action_type,
        "client_created_at": data.created_at,
        "server_received_at": now_ist(),
        "server_received_ist": now_ist().isoformat(),
    }
    try:
        result = await clinical_actions_collection.insert_one(document)
        await _notify_driver(data.patient_id)
        await _notify_doctor(data.patient_id, "CLINICAL_ACTION_UPDATE")

        # EVIS is the authoritative source of truth for triage colour across
        # all downstream documents (EIDIS insurance package, EDFS ED summary,
        # emergency structured note). The moment a doctor approves an AI
        # suggestion that carries a triage colour, persist it here so every
        # other pipeline's fetch_authoritative_triage() picks up THIS value
        # instead of independently recomputing its own from raw vitals —
        # which is what caused the same patient to show different triage
        # colours (e.g. Red on the live feed, Green on generated summaries).
        if data.action_type == "approved" and data.ai_suggestion:
            triage = data.ai_suggestion.get("triage") or {}
            triage_colour = triage.get("colour")
            if triage_colour:
                try:
                    await upsert_authoritative_triage(
                        collection=patient_triage_status_collection,
                        patient_id=data.patient_id,
                        triage_colour=triage_colour,
                        source_system="EVIS",
                        criticality_score=data.ai_suggestion.get("criticality_score"),
                        risk_level=data.ai_suggestion.get("risk_level"),
                        rationale=triage.get("rationale"),
                        computed_at_ist=now_ist().isoformat(),
                    )
                    logger.info(
                        f"Authoritative triage colour '{triage_colour}' stored for "
                        f"patient {data.patient_id} following doctor approval."
                    )
                except Exception as triage_err:
                    logger.warning(
                        f"Failed to persist authoritative triage for "
                        f"{data.patient_id} (non-critical): {triage_err}"
                    )

        return {"status": "success", "message": "Clinical action saved", "id": str(result.inserted_id)}
    except Exception as e:
        logger.error(f"Failed to save clinical action: {e}")
        raise HTTPException(status_code=500, detail="Database error")


@router.get("/clinical-action/{patient_id}")
async def get_patient_clinical_actions(patient_id: str):
    try:
        cursor = clinical_actions_collection.find({"patient_id": patient_id}).sort("server_received_at", -1)
        actions = await cursor.to_list(length=None)
        for action in actions:
            action["_id"] = str(action["_id"])
        return {"status": "success", "patient_id": patient_id, "total": len(actions), "actions": actions}
    except Exception as e:
        logger.error(f"Failed to fetch clinical actions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/clinical-action/delete-all")
async def delete_all_clinical_actions():
    try:
        result = await clinical_actions_collection.delete_many({})
        return {"status": "success", "message": "All clinical actions deleted", "deleted_count": result.deleted_count}
    except Exception as e:
        logger.error(f"Failed to delete clinical actions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/clinical-action/{patient_id}")
async def delete_patient_clinical_actions(patient_id: str):
    try:
        result = await clinical_actions_collection.delete_many({"patient_id": patient_id})
        return {
            "status": "success",
            "message": f"Clinical actions deleted for patient {patient_id}",
            "patient_id": patient_id,
            "deleted_count": result.deleted_count,
        }
    except Exception as e:
        logger.error(f"Failed to delete clinical actions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/clinical-action/single/{action_id}")
async def delete_single_clinical_action(action_id: str, patient_id: str):
    try:
        oid = ObjectId(action_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=400, detail=f"'{action_id}' is not a valid clinical action id")

    try:
        result = await clinical_actions_collection.delete_one({"_id": oid, "patient_id": patient_id})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail=f"No clinical action with id={action_id} found for patient {patient_id}")
        await _notify_driver(patient_id)
        return {"status": "success", "message": "Clinical action deleted", "patient_id": patient_id, "action_id": action_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete clinical action {action_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# DOCTOR VOICE NOTES  (unchanged CRUD)
# ============================================================

class DoctorVoiceNoteRequest(BaseModel):
    patient_id: str
    conversation: str


@router.post("/doctor-voice-note-forprocessing/save")
async def save_doctor_voice_note(note_data: DoctorVoiceNoteRequest):
    try:
        now = now_ist()
        document = {
            "patient_id": note_data.patient_id,
            "conversation": note_data.conversation,
            "timestamp": now,
            "date": now.strftime("%Y-%m-%d"),
            "time": now.strftime("%H:%M:%S"),
            "created_at": now,
            "timezone": "IST (Asia/Kolkata)",
        }
        result = await doctor_voice_notes_collection_forprocessing.insert_one(document)
        await _notify_doctor(note_data.patient_id, "DOCTOR_NOTE_SAVED")
        return {
            "status": "success",
            "message": "Doctor voice note saved successfully",
            "patient_id": note_data.patient_id,
            "note_id": str(result.inserted_id),
            "timestamp_ist": now.isoformat(),
        }
    except Exception as e:
        logger.error(f"Failed to save doctor voice note: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save doctor voice note: {e}")


@router.get("/doctor-voice-note-forprocessing/{patient_id}")
async def get_doctor_voice_notes(patient_id: str):
    try:
        cursor = doctor_voice_notes_collection_forprocessing.find({"patient_id": patient_id}).sort("timestamp", -1)
        notes = await cursor.to_list(length=None)
        for note in notes:
            note["_id"] = str(note["_id"])
            if "timestamp" in note and hasattr(note["timestamp"], "isoformat"):
                note["timestamp"] = iso_ist(note["timestamp"])
            if "created_at" in note and hasattr(note["created_at"], "isoformat"):
                note["created_at"] = iso_ist(note["created_at"])
        return {
            "status": "success",
            "patient_id": patient_id,
            "total_notes": len(notes),
            "timezone": "IST (Asia/Kolkata)",
            "doctor_voice_notes": notes,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))