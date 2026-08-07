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

llm = ChatGroq(
    model="llama-3.3-70b-versatile",
    temperature=0.1,
    max_tokens=2500,
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
        logger.error(f"Failed to parse LLM JSON output. Raw text: {text[:500]}")
        return {"_parse_error": True, "raw_output": text}


async def _invoke_llm(system: str, user: str) -> Dict:
    response = await llm.ainvoke([
        SystemMessage(content=system),
        HumanMessage(content=user),
    ])
    return parse_llm_json(response.content)


# ============================================================
# DATA FETCHING — EMT dictations, doctor notes, image-extracted vitals
# ============================================================

async def _fetch_all_clinical_entries(patient_id: str) -> tuple[List[Dict], int, int, int]:
    """
    Fetch and merge clinical data from all three MongoDB collections,
    sorted chronologically. Returns (entries, emt_count, doctor_count, image_count).
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

    if emt_count == 0 and doctor_count == 0:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No valid clinical data found for patient {patient_id}. "
                "Both voice_dictations and doctor_voice_notes are empty or missing."
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
        label = {
            "voice_dictation": "EMT VOICE DICTATION",
            "doctor_voice_note": "DOCTOR VOICE NOTE",
            "image_extracted": "IMAGE-EXTRACTED MONITOR DATA",
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
    actually recorded — the free-text voice_dictation they gave when
    approving/rejecting, or the single-line action if no dictation was
    given. No inference, no keyword matching.
    """
    approved, rejected = [], []
    for a in actions:
        label = (a.get("voice_dictation") or "").strip()
        if not label:
            ai = a.get("ai_suggestion") or {}
            label = (
                (ai.get("triage") or {}).get("rationale")
                or "Unspecified action"
            )
        ts = iso_ist(a.get("client_created_at") or a.get("server_received_at"))
        entry = f"[{ts}] {label}"
        if a.get("action_type") == "approved":
            approved.append(entry)
        elif a.get("action_type") == "not_approved":
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
    "only things explicitly stated as already given/done/started THIS encounter — include EVERY type mentioned: oxygen therapy, monitoring (cardiac/multiparameter), NIV/BiPAP, IV fluids/medications, procedures (e.g. 'two large-bore IV cannulas secured', 'cervical collar applied'), blood-product preparedness (e.g. 'blood grouping and cross-match completed', 'massive transfusion protocol activated/on standby'), and any statement that a definitive procedure (surgery, transfusion, decompression) has already been PREPARED FOR or is IN PROGRESS, not just contemplated. Include the stated effect if given, e.g. 'BiPAP initiated, SpO2 improved from 67% to 97%'."
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
    return await _invoke_llm(EXTRACTION_SYSTEM, prompt)


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
        m = re.search(r"\b(\d{1,2})\b", gcs)
        if m:
            gcs_val = int(m.group(1))
            if 3 <= gcs_val <= 15 and gcs_val < 13:
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
    "to 'oxygen' whenever any SpO2 figure is present. Whenever "
    "nitroglycerin/nitrate therapy appears in treatment_plan, it must have "
    "a matching entry in CONTRAINDICATIONS (see below) that explicitly "
    "checks right ventricular involvement/inferior infarction, "
    "hypotension, recent PDE-5 inhibitor use if stated, and significant "
    "bradycardia/tachycardia. For an acute coronary syndrome presentation "
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
    "facts). THROMBOLYSIS IS NEVER APPROPRIATE FOR NSTEMI/NON-ST-ELEVATION "
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
    "'continue crystalloids'. For a presentation with colicky flank/loin "
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
    "diagnose.\n\n"
    "PROCEDURES: hands-on procedures the facts justify (e.g. large-bore IV "
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
    f"skill level above {RESPONDER_SKILL_LEVEL} (e.g. advanced airway "
    "drugs, certain IV medications) must be phrased as a relay "
    "instruction, not a direct one.\n\n"
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
    "tachycardia. Only write 'no contraindication evidence found in the "
    "given facts' when you have genuinely checked and found nothing "
    "relevant — do not let this become a default filler answer; for many "
    "trauma patients on an initial presentation there may genuinely be no "
    "documented contraindication yet, and that is a legitimate answer, but "
    "it must reflect an actual check each time, not a reflex. Never leave "
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
    "impression": "string or null — the single most likely diagnosis (verbatim from diagnostic_conclusions_stated if non-empty, otherwise a synthesized working impression from the symptom/sign/vitals pattern, explicitly labeled as pending confirmation if not already stated by a clinician/study)",
    "supporting_findings": ["the specific extracted facts that support this impression"],
    "differential": ["optional — other plausible diagnoses genuinely close in likelihood, or conditions being actively investigated/ruled out via ordered tests; leave empty if not applicable"]
  },
  "triage": {
    "colour": "Red|Yellow|Green|Black|Unknown",
    "rationale": "string or null — tied to specific facts",
    "data_available": true,
    "reason_if_unavailable": "string or null"
  },
  "treatment_plan": {
    "data_available": true,
    "reason_if_unavailable": "string or null",
    "items": [
      {"drug_or_treatment": "string", "dose": "string or null", "reason": "string — cite the specific extracted fact(s)", "confirmation_status": "new|continuing|previously_advised_unconfirmed"}
    ]
  },
  "investigations": {
    "data_available": true,
    "reason_if_unavailable": "string or null",
    "items": [
      {"investigation": "string", "status": "pending|completed|conditionally_planned", "finding_if_completed": "string or null", "justification": "string — cite the specific fact"}
    ]
  },
  "procedures": {
    "data_available": true,
    "reason_if_unavailable": "string or null",
    "items": [
      {"procedure": "string", "timing": "perform_now|prepare_for|already_in_progress", "reason": "string — cite the specific fact", "confirmation_status": "new|continuing|previously_advised_unconfirmed"}
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
conditional item as already ordered.
"""

async def generate_suggestions(
    facts: Dict,
    approved: List[str],
    rejected: List[str],
    previously_advised: List[Dict],
) -> Dict:
    approved_block = "\n".join(f"  - {a}" for a in approved) or "  (none)"
    rejected_block = "\n".join(f"  - {r}" for r in rejected) or "  (none)"
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
    return await _invoke_llm(SUGGESTION_SYSTEM, prompt)


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

    facts = await extract_facts(timeline_text)
    if facts.get("_parse_error"):
        raise HTTPException(status_code=502, detail="Failed to parse fact-extraction output from the model.")

    suggestions = await generate_suggestions(facts, approved, rejected, previously_advised)
    if suggestions.get("_parse_error"):
        raise HTTPException(status_code=502, detail="Failed to parse suggestion output from the model.")

    # Deterministic vital-sign safety net — code-level, no LLM. Can only
    # escalate triage.colour to Red, never downgrade or override anything
    # else the model produced.
    suggestions = _apply_vital_safety_net(suggestions, facts)

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