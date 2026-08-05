import os
import re
import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorClient
from groq import Groq

logger = logging.getLogger(__name__)

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]
    radiotherapy_protocol_collection = database["radiotherapy_protocol_master"]
    radiotherapy_records_collection = database["radiotherapy_records"]
    summary_collection = database["patient_summary"]
except Exception as e:
    logger.error(f"Error initializing MongoDB: {e}")

api_key = os.getenv("GROQ_API_KEY")
groq_client = Groq(api_key=api_key)

router = APIRouter(prefix="/radiotherapy-protocol", tags=["radiotherapy_protocol_master"])


# ─────────────────────────────────────────────────────────────
# MODELS
# ─────────────────────────────────────────────────────────────

class SimulationProtocol(BaseModel):
    patient_position: Optional[str] = None
    immobilization: Optional[str] = None
    imaging: Optional[str] = None
    slice_thickness: Optional[str] = None
    contrast: Optional[str] = None


class TargetVolumes(BaseModel):
    gtv: Optional[str] = None
    ctv: Optional[str] = None
    ptv: Optional[str] = None


class PrescriptionProtocol(BaseModel):
    total_dose: Optional[str] = None
    fractions: Optional[int] = None
    dose_per_fraction: Optional[str] = None
    overall_time: Optional[str] = None


class MachineProtocol(BaseModel):
    technique: Optional[str] = None
    linac: Optional[str] = None
    energy: Optional[str] = None


class IGRTProtocol(BaseModel):
    type: Optional[str] = None
    frequency: Optional[str] = None


class PlanningProtocol(BaseModel):
    peer_review: Optional[bool] = None
    adaptive: Optional[bool] = None
    bolus: Optional[str] = None


class QAProtocol(BaseModel):
    physics_check: Optional[bool] = None
    patient_specific_QA: Optional[bool] = None


class FollowUpProtocol(BaseModel):
    first_review: Optional[str] = None


class BrachytherapyProtocol(BaseModel):
    applicator_type: Optional[str] = None
    technique: Optional[str] = None
    dose_rate: Optional[str] = None
    total_dose: Optional[str] = None
    fractions: Optional[int] = None
    dose_per_fraction: Optional[str] = None
    number_of_implants: Optional[int] = None


class RadiotherapyProtocol(BaseModel):
    protocol_id: str
    protocol_name: str
    display_name: str

    aliases: List[str] = []
    disease_site: str
    subsite: Optional[str] = None

    intent: List[str]

    technique: str
    rt_type: str  # "External Beam" | "Brachytherapy" | "Combined"

    simulation: Optional[SimulationProtocol] = None
    target_volumes: Optional[TargetVolumes] = None
    prescription: Optional[PrescriptionProtocol] = None
    machine: Optional[MachineProtocol] = None
    igrt: Optional[IGRTProtocol] = None
    oar_constraints: Dict[str, str] = {}
    planning: Optional[PlanningProtocol] = None
    qa: Optional[QAProtocol] = None
    followup: Optional[FollowUpProtocol] = None
    brachytherapy: Optional[BrachytherapyProtocol] = None

    references: List[str] = []

    version: str = "1.0"
    status: str = "Active"


# ─────────────────────────────────────────────────────────────
# ENDPOINT: Bulk add (useful for seeding)
# ─────────────────────────────────────────────────────────────
@router.post("/bulk")
async def add_protocols_bulk(protocols: List[RadiotherapyProtocol]):

    added = 0
    updated = 0

    for protocol in protocols:
        result = await radiotherapy_protocol_collection.update_one(
            {"protocol_id": protocol.protocol_id},
            {"$set": protocol.model_dump()},
            upsert=True
        )

        if result.upserted_id:
            added += 1
        elif result.modified_count > 0:
            updated += 1

    return {
        "status": "success",
        "added": added,
        "updated": updated,
        "total": len(protocols)
    }


# ─────────────────────────────────────────────────────────────
# ENDPOINT 1: Save Protocol
# POST /radiotherapy-protocol
# ─────────────────────────────────────────────────────────────
@router.post("")
async def add_protocol(protocol: RadiotherapyProtocol):

    exists = await radiotherapy_protocol_collection.find_one(
        {"protocol_id": protocol.protocol_id}
    )

    if exists:
        raise HTTPException(
            status_code=409,
            detail="Protocol already exists."
        )

    await radiotherapy_protocol_collection.insert_one(protocol.model_dump())

    return {
        "status": "success",
        "message": "Protocol added successfully."
    }


# ─────────────────────────────────────────────────────────────
# ENDPOINT 2: Update Protocol
# PUT /radiotherapy-protocol/{protocol_id}
# ─────────────────────────────────────────────────────────────
@router.put("/{protocol_id}")
async def update_protocol(protocol_id: str, protocol: RadiotherapyProtocol):

    exists = await radiotherapy_protocol_collection.find_one(
        {"protocol_id": protocol_id}
    )

    if not exists:
        raise HTTPException(
            status_code=404,
            detail="Protocol not found."
        )

    update_data = protocol.model_dump()
    update_data["protocol_id"] = protocol_id  # protocol_id in path is authoritative

    await radiotherapy_protocol_collection.update_one(
        {"protocol_id": protocol_id},
        {"$set": update_data}
    )

    return {
        "status": "success",
        "message": "Protocol updated successfully."
    }


# ─────────────────────────────────────────────────────────────
# ENDPOINT 3: Delete Protocol
# DELETE /radiotherapy-protocol/{protocol_id}
# ─────────────────────────────────────────────────────────────
@router.delete("/{protocol_id}")
async def delete_protocol(protocol_id: str):

    result = await radiotherapy_protocol_collection.delete_one(
        {"protocol_id": protocol_id}
    )

    if result.deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Protocol not found."
        )

    return {
        "status": "success",
        "message": "Protocol deleted successfully."
    }


# ─────────────────────────────────────────────────────────────
# ENDPOINT 4: Delete All
# DELETE /radiotherapy-protocol
# ─────────────────────────────────────────────────────────────
@router.delete("")
async def delete_all_protocols():

    result = await radiotherapy_protocol_collection.delete_many({})

    return {
        "status": "success",
        "deleted": result.deleted_count
    }


# ─────────────────────────────────────────────────────────────
# ENDPOINT 5: List Protocols (lightweight, for browser UI)
# GET /radiotherapy-protocol/list?search=...&patient_id=...
#
# NOTE: must stay declared before the "/{protocol_id}" GET route.
#
# If patient_id is supplied, protocols are deterministically matched
# against the patient's diagnosis (regex/keyword match — NO LLM) and
# flagged with "recommended": true, exactly like the chemotherapy
# protocol-master list. The old separate POST /recommend call is gone.
# ─────────────────────────────────────────────────────────────
@router.get("/list")
async def list_protocols(search: str = "", patient_id: Optional[str] = None):
    query = {}
    if search:
        query["$or"] = [
            {"protocol_name": {"$regex": search, "$options": "i"}},
            {"display_name": {"$regex": search, "$options": "i"}},
            {"aliases": {"$regex": search, "$options": "i"}},
            {"disease_site": {"$regex": search, "$options": "i"}},
        ]

    cursor = radiotherapy_protocol_collection.find(query, {
        "_id": 0,
        "protocol_id": 1,
        "protocol_name": 1,
        "disease_site": 1,
        "intent": 1,
        "technique": 1,
        "prescription.total_dose": 1,
        "prescription.fractions": 1,
    })
    protocols = await cursor.to_list(length=300)

    logger.info(f"Fetched {len(protocols)} radiotherapy protocols from MongoDB")

    # flatten prescription.total_dose / fractions for a simple browser row
    for p in protocols:
        prescription = p.pop("prescription", {}) or {}
        p["dose"] = prescription.get("total_dose")
        p["fractions"] = prescription.get("fractions")

    # ── deterministic recommendation flag (no LLM) ──
    recommended_ids: set = set()
    if patient_id:
        try:
            summary_doc = await summary_collection.find_one({"patient_id": patient_id}) or {}
            match_text = _build_match_text(summary_doc)
            matches = await _match_protocols_by_diagnosis(match_text, limit=5)
            recommended_ids = {m["protocol_id"] for m in matches}
        except Exception as e:
            # Non-fatal — if matching fails for any reason, just show the
            # plain, unranked list instead of breaking the whole endpoint.
            logger.warning(f"Protocol matching failed for patient_id={patient_id}: {e}")

    for p in protocols:
        p["recommended"] = p["protocol_id"] in recommended_ids

    # recommended first, then alphabetical within each group
    protocols.sort(key=lambda p: (not p["recommended"], p.get("protocol_name") or ""))

    return {
        "status": "success",
        "data": protocols
    }


# ─────────────────────────────────────────────────────────────
# ENDPOINT 6: Get One Protocol (full document)
# GET /radiotherapy-protocol/{protocol_id}
# ─────────────────────────────────────────────────────────────
@router.get("/{protocol_id}")
async def get_protocol(protocol_id: str):

    proto = await radiotherapy_protocol_collection.find_one(
        {"protocol_id": protocol_id}, {"_id": 0}
    )

    if not proto:
        raise HTTPException(
            status_code=404,
            detail="Protocol not found."
        )

    return {
        "status": "success",
        "data": proto
    }


# ─────────────────────────────────────────────────────────────
# ENDPOINT 7: Select Protocol (replaces the old /apply)
# POST /radiotherapy-protocol/select
#
# Mirrors the chemotherapy "select" flow:
#   protocol → _build_clinical_context() → _adapt_protocol_with_llm()
#   → _map_protocol_to_form() → save → return
#
# The LLM is ONLY allowed to fill in patient-specific metadata
# (treatment intent label, start date, special instructions,
# concurrent therapy, reason for change, safety flags). It never
# sees or is allowed to alter dose, fractions, PTV, OAR, machine,
# or technique — those are always read verbatim from the stored
# protocol document.
# ─────────────────────────────────────────────────────────────
@router.post("/select")
async def select_protocol(payload: dict):

    patient_id = payload.get("patientId")
    doctor_id = payload.get("doctorId", "")
    protocol_id = payload.get("protocolId")

    if not patient_id or not protocol_id:
        raise HTTPException(
            status_code=400,
            detail="patientId and protocolId are required."
        )

    proto = await radiotherapy_protocol_collection.find_one(
        {"protocol_id": protocol_id}, {"_id": 0}
    )

    if not proto:
        return {"status": "error", "detail": "Protocol not found."}

    summary_doc = await summary_collection.find_one({"patient_id": patient_id}) or {}
    context = _build_clinical_context(summary_doc)

    llm_data = await _adapt_protocol_with_llm(proto, context)

    data = _map_protocol_to_form(proto, llm_data)

    await radiotherapy_records_collection.update_one(
        {"patient_id": patient_id, "doctor_id": doctor_id},
        {
            "$set": {
                "protocol_ref": protocol_id,
                "applied_at": datetime.now().isoformat(),
                "common": data["common"],
                "ebrt": data["ebrt"],
                "brachy": data["brachy"],
            }
        },
        upsert=True
    )

    return {"status": "success", "data": data}


# ─────────────────────────────────────────────────────────────
# HELPERS — clinical context (same shape as chemo, reused here)
# ─────────────────────────────────────────────────────────────

def _strip_markdown(text: str) -> str:
    return re.sub(r"\*+", "", text or "").strip()




# ── NEW: normalize UK/US spelling so the same site isn't split across
# two different tokens (e.g. "esophagus" vs "oesophagus") ──
_SPELLING_NORMALIZE = {
    "oesophagus": "esophagus",
    "oesophageal": "esophageal",
    "tumour": "tumor",
    "tumours": "tumors",
    "anaemia": "anemia",
    "haemoglobin": "hemoglobin",
    "oedema": "edema",
    "leukaemia": "leukemia",
    "oestrogen": "estrogen",
}

def _normalize_spelling(text: str) -> str:
    text = text or ""
    for uk, us in _SPELLING_NORMALIZE.items():
        text = re.sub(rf"\b{uk}\b", us, text, flags=re.IGNORECASE)
    return text


def _build_match_text(summary_doc: dict) -> str:
    """Wider text pool for protocol matching than diagnosis_header alone —
    histology-only headers (e.g. 'invasive carcinoma NST') often omit the
    anatomical site entirely, so pull from full_text/paragraphs too."""
    root = summary_doc.get("data", summary_doc)
    summary = root.get("summary", {})

    parts = []

    header = summary.get("diagnosis_header", "")
    if isinstance(header, str) and header.strip():
        parts.append(_strip_markdown(header))

    for d in summary.get("confirmed_diagnoses", []):
        if isinstance(d, dict):
            d = d.get("text") or d.get("diagnosis") or d.get("name") or ""
        if isinstance(d, str) and d.strip():
            parts.append(_strip_markdown(d))

    full_text = summary.get("full_text", "") or " ".join(summary.get("paragraphs", []))
    if full_text:
        parts.append(full_text[:2000])

    return " ".join(parts)

def _build_clinical_context(summary_doc: dict) -> dict:
    root = summary_doc.get("data", summary_doc)
    summary = root.get("summary", {})
    timeline = root.get("timeline", {}).get("timeline", [])

    diagnosis = _strip_markdown(summary.get("diagnosis_header", ""))
    if not diagnosis:
        diagnoses = summary.get("confirmed_diagnoses", [])
        diagnosis = _strip_markdown(diagnoses[0]) if diagnoses else ""

    full_text = summary.get("full_text", "") or " ".join(summary.get("paragraphs", []))

    all_entities = []
    for entry in timeline:
        for et in entry.get("entity_types", []):
            for ent in et.get("entities", []):
                all_entities.append(ent)

    def find_evidence(*name_fragments):
        frags = [f.lower() for f in name_fragments]
        for ent in all_entities:
            name = (ent.get("name") or "").lower()
            if any(f in name for f in frags):
                return ent.get("evidence") or ""
        return ""

    return {
        "diagnosis": diagnosis,
        "clinical_narrative": full_text[:6000],
        "stage_evidence": find_evidence("stage", "tnm"),
        "histology_evidence": find_evidence("histology", "differentiated", "carcinoma"),
        "surgery_evidence": find_evidence("surgery", "resection", "mastectomy", "excision"),
        "prior_rt_evidence": find_evidence("radiotherapy", "radiation", "rt "),
        "chemo_evidence": find_evidence("chemotherapy", "chemo"),
        "ecog_evidence": find_evidence("ecog", "performance status"),
        "tumor_board_evidence": find_evidence("tumor board", "tumour board", "mdt"),
    }


# ─────────────────────────────────────────────────────────────
# HELPERS — deterministic diagnosis matching (NO LLM)
#
# Replaces the old LLM-based _rank_protocols_with_llm /
# _get_candidate_protocols pair. Pure keyword/regex scoring against
# disease_site / subsite / aliases, same spirit as the chemotherapy
# protocol-master matching.
# ─────────────────────────────────────────────────────────────

_STOPWORDS = {
    "moderately", "differentiated", "clinical", "stage", "with",
    "unspecified", "malignant", "neoplasm", "carcinoma",
    "invasive", "special", "grade", "type",
    # generic narrative / report boilerplate — NOT medical vocabulary,
    # just standard English filler that carries no site/disease signal
    "patient", "patients", "presented", "which", "same", "before",
    "following", "showed", "found", "noted", "based", "current",
    "currently", "status", "recent", "case", "complex", "multiple",
    "including", "further", "will", "depend", "overall", "this",
    "these", "those", "there", "their", "about", "after", "during",
    "revealed", "suggested", "demonstrated", "conducted", "performed",
    "administered", "documented", "evaluations", "findings", "outcomes",
    "management", "planning", "course", "limited", "latest", "follow",
    "elsewhere", "definitive", "primary", "showing", "area", "ratio",
    "mean", "underwent", "duration", "taken", "examination", "scopy",
}


def _extract_diagnosis_keywords(diagnosis: str) -> List[str]:
    text = _normalize_spelling(diagnosis or "")
    return [w for w in re.split(r"[^a-z0-9]+", text.lower())
            if len(w) > 3 and w not in _STOPWORDS]


# ─────────────────────────────────────────────────────────────
# Corpus-driven generic-token downweighting (same principle as
# Phase 2: words that appear across MOST protocols are generic
# and shouldn't drive a match; words that appear in only a few
# protocols are actually site-specific and should count more).
# Cached in memory, refreshed lazily so we don't recompute on
# every single /list call.
# ─────────────────────────────────────────────────────────────
_corpus_doc_freq_cache: Dict[str, Any] = {"freqs": None, "total": 0}

async def _get_corpus_doc_frequencies() -> tuple[Dict[str, int], int]:
    if _corpus_doc_freq_cache["freqs"] is not None:
        return _corpus_doc_freq_cache["freqs"], _corpus_doc_freq_cache["total"]

    cursor = radiotherapy_protocol_collection.find({}, {
        "_id": 0, "disease_site": 1, "subsite": 1, "aliases": 1
    })
    protocols = await cursor.to_list(length=1000)

    doc_freq: Dict[str, int] = {}
    for p in protocols:
        haystack = _normalize_spelling(" ".join([
            p.get("disease_site") or "",
            p.get("subsite") or "",
            " ".join(p.get("aliases") or []),
        ])).lower()
        tokens = {t for t in re.split(r"[^a-z0-9]+", haystack) if len(t) > 3}
        for t in tokens:
            doc_freq[t] = doc_freq.get(t, 0) + 1

    _corpus_doc_freq_cache["freqs"] = doc_freq
    _corpus_doc_freq_cache["total"] = len(protocols)
    return doc_freq, len(protocols)

async def _match_protocols_by_diagnosis(diagnosis: str, limit: int = 5) -> List[dict]:
    import math
    from collections import Counter

    diagnosis = _normalize_spelling(diagnosis or "")
    raw_tokens = [w for w in re.split(r"[^a-z0-9]+", diagnosis.lower())
                  if len(w) > 3 and w not in _STOPWORDS]
    if not raw_tokens:
        return []

    keyword_counts = Counter(raw_tokens)
    unique_keywords = list(keyword_counts.keys())

    pattern = "|".join(re.escape(k) for k in unique_keywords)
    query = {
        "$or": [
            {"disease_site": {"$regex": pattern, "$options": "i"}},
            {"subsite": {"$regex": pattern, "$options": "i"}},
            {"aliases": {"$regex": pattern, "$options": "i"}},
        ]
    }

    cursor = radiotherapy_protocol_collection.find(query, {
        "_id": 0, "protocol_id": 1, "disease_site": 1, "subsite": 1, "aliases": 1,
    })
    candidates = await cursor.to_list(length=100)
    if not candidates:
        logger.warning(f"RT match: no candidates at all for keywords={unique_keywords}")
        return []

    doc_freq, total_protocols = await _get_corpus_doc_frequencies()

    def keyword_weight(k: str) -> float:
        df = doc_freq.get(k, 1)
        # rare across the corpus -> high weight; common -> near zero
        return math.log((total_protocols + 1) / (df + 1)) + 0.01

    def score(p: dict) -> float:
        site = _normalize_spelling(p.get("disease_site") or "").lower()
        subsite = _normalize_spelling(p.get("subsite") or "").lower()
        aliases = _normalize_spelling(" ".join(p.get("aliases") or [])).lower()

        s = 0.0
        for k, tf in keyword_counts.items():
            # cap RARITY itself, not the final contribution — this way a
            # word mentioned only once (tf=1) can never reach the same
            # score as a word mentioned repeatedly (tf=4+), no matter how
            # rare it is across the protocol corpus
            w = min(keyword_weight(k), 2.0)
            contribution = w * math.sqrt(tf)
            if k in site:
                s += contribution * 5      # disease_site match matters most
            if k in subsite:
                s += contribution * 2
            if k in aliases:
                s += contribution * 1
        return s

    scored = [(p, score(p)) for p in candidates]
    scored = [(p, s) for p, s in scored if s > 2.0]   # absolute floor — filters out near-zero noise
    scored.sort(key=lambda x: x[1], reverse=True)

    if scored:
        top_score = scored[0][1]
        # relative floor — a candidate must be within 50% of the strongest
        # match's score to be considered a real recommendation. This is what
        # actually filters out "one generic word happened to be rare enough
        # to clear the absolute gate" cases like biopsy/lesion/evidence
        # matching an unrelated disease site — those sit far below the
        # confidently-matched protocols, not close behind them.
        scored = [(p, s) for p, s in scored if s >= top_score * 0.5]

    logger.info(f"RT match keywords_tf={dict(keyword_counts)} -> "
                f"{[(p['protocol_id'], round(s, 2)) for p, s in scored[:limit]]}")

    return [p for p, _ in scored[:limit]]


# ─────────────────────────────────────────────────────────────
# HELPERS — LLM adaptation (Phase: /select only)
#
# Only ever fills in patient-specific METADATA. It is never given,
# and never allowed to return, dose / fractions / PTV / OAR /
# machine / technique — those always come straight from the
# protocol document, untouched, in _map_protocol_to_form().
# ─────────────────────────────────────────────────────────────

_DEFAULT_LLM_ADAPTATION = {
    "treatmentIntent": "",
    "startDate": "",
    "specialInstructions": "",
    "concurrentTherapy": "",
    "reasonForChange": "",
    "safetyFlags": [],
}


async def _adapt_protocol_with_llm(proto: dict, context: dict) -> dict:
    intent_list = proto.get("intent") or []
    intent_primary = intent_list[0] if intent_list else ""

    system_prompt = f"""
You are adapting a fixed radiotherapy protocol to one specific patient.

You are NOT permitted to invent, modify, or output dose, fraction, PTV,
CTV, GTV, OAR constraint, machine, or technique values — those are
already fixed by the protocol and are handled separately. You only
fill in patient-specific administrative and clinical metadata.

Protocol: {proto.get('display_name') or proto.get('protocol_name')}
Protocol default intent: {intent_primary or 'not specified'}
Disease site: {proto.get('disease_site')}

Patient diagnosis: {context.get('diagnosis') or 'not documented'}
Stage evidence: {context.get('stage_evidence') or 'not documented'}
Histology evidence: {context.get('histology_evidence') or 'not documented'}
Prior surgery evidence: {context.get('surgery_evidence') or 'not documented'}
Prior radiotherapy evidence: {context.get('prior_rt_evidence') or 'none documented'}
Chemotherapy evidence: {context.get('chemo_evidence') or 'not documented'}
Performance status evidence: {context.get('ecog_evidence') or 'not documented'}
Tumor board evidence: {context.get('tumor_board_evidence') or 'not documented'}

Full clinical narrative:
{context.get('clinical_narrative', '')}

Return ONLY this JSON, no prose, no markdown fences:
{{
  "treatmentIntent": "",
  "startDate": "",
  "specialInstructions": "",
  "concurrentTherapy": "",
  "reasonForChange": "",
  "safetyFlags": []
}}

Rules:
- "treatmentIntent" should normally match the protocol's default intent
  ({intent_primary or 'n/a'}) unless the clinical narrative clearly indicates
  a different intent for this patient.
- "startDate" should be left as an empty string unless a specific planned
  start date is documented — never guess a date.
- "specialInstructions" is a short (1-3 sentence) clinical note relevant to
  this patient (e.g. prior surgery site, comorbidities to consider).
- "concurrentTherapy" names any concurrent systemic therapy documented for
  this patient (e.g. "Weekly Cisplatin"), or empty string if none documented.
- "reasonForChange" briefly explains why this protocol was selected for this
  patient, or empty string if not clinically necessary to note.
- "safetyFlags" is a list of short caveats to flag to the treating physician
  (e.g. prior radiotherapy overlap, allergy concerns), or an empty list.
- Do not include any dose, fraction, PTV, OAR, machine, or technique value
  anywhere in your output.
"""

    try:
        resp = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": "Adapt the protocol metadata for this patient now."}
            ],
            response_format={"type": "json_object"},
            temperature=0,
        )
        llm_data = json.loads(resp.choices[0].message.content)
    except Exception as e:
        # Non-fatal — selecting a protocol should never fail just because
        # the metadata-adaptation call failed. Fall back to safe defaults.
        logger.warning(f"Protocol metadata adaptation failed, using defaults: {e}")
        llm_data = {}

    merged = dict(_DEFAULT_LLM_ADAPTATION)
    merged.update({k: v for k, v in llm_data.items() if k in _DEFAULT_LLM_ADAPTATION})

    if not merged.get("treatmentIntent"):
        merged["treatmentIntent"] = intent_primary

    if not isinstance(merged.get("safetyFlags"), list):
        merged["safetyFlags"] = []

    return merged


# ═════════════════════════════════════════════════════════════
# PROTOCOL VALUE MAPPING LAYER
#
# Classifies every protocol value that must land in a fixed
# radio/select control into one of three buckets:
#
#   1. Exact Match   — protocol value equals a known UI option
#   2. Synonym Match  — protocol value normalizes to a known UI
#                        option via a curated synonym table
#   3. Unknown Value  — no match found; select "Other" and
#                        preserve the original protocol text in
#                        a dedicated "<field>Other" companion key,
#                        flagged with "<field>FromProtocol": True
#                        so the frontend can show "Imported from
#                        Protocol Master" next to it.
#
# Nothing is ever silently dropped — every protocol value ends
# up either selected in the UI or preserved verbatim in an
# "Other" field.
# ═════════════════════════════════════════════════════════════
 
def _classify(
    value: Optional[str],
    options: List[str],
    synonyms: Optional[Dict[str, str]] = None,
    other_label: str = "Other",
) -> tuple[str, Optional[str]]:
    """
    Returns (selected_ui_value, other_text).
    other_text is None unless the value fell through to "Other".
    """
    if value is None:
        return "", None
    v = str(value).strip()
    if not v:
        return "", None
    v_low = v.lower()
 
    # Level 1 — Exact Match
    for opt in options:
        if opt.lower() == v_low:
            return opt, None
 
    # Level 2 — Synonym Match
    if synonyms:
        mapped = synonyms.get(v_low)
        if mapped:
            return mapped, None
        # substring match — protocol text is often a longer phrase
        # containing the synonym key, e.g. "RapidArc (VMAT) technique"
        for syn_key, syn_val in synonyms.items():
            if syn_key in v_low:
                return syn_val, None
 
    # Level 3 — Unknown Value
    return other_label, v
 
 
def _classify_energy(value: Optional[str]) -> Dict[str, Any]:
    """
    Parses a free-text protocol energy string (e.g. "6 MV", "15MV Photon",
    "9 MeV Electron") into the structured energy object the EBRT form
    already uses. Anything that can't be parsed goes into "other" instead
    of being dropped.
    """
    result = {
        "photon": False, "photonMV": "",
        "electron": False, "electronMeV": "",
        "proton": False, "protonMeV": "",
        "other": "",
    }
    if not value:
        return result
 
    v_low = str(value).lower()
    matched = False
 
    photon_match = re.search(r"(\d+(\.\d+)?)\s*mv", v_low)
    if photon_match and "electron" not in v_low:
        result["photon"] = True
        result["photonMV"] = photon_match.group(1)
        matched = True
 
    electron_match = re.search(r"(\d+(\.\d+)?)\s*mev", v_low)
    if electron_match or "electron" in v_low:
        result["electron"] = True
        if electron_match:
            result["electronMeV"] = electron_match.group(1)
        matched = True
 
    if "proton" in v_low:
        result["proton"] = True
        proton_match = re.search(r"(\d+(\.\d+)?)\s*mev", v_low)
        if proton_match:
            result["protonMeV"] = proton_match.group(1)
        matched = True
 
    if not matched:
        result["other"] = str(value)
 
    return result
 
 
# ── Canonical UI option sets + synonym tables ──
# These must stay in sync with the <option> lists in RadiotherapyRecord.jsx.
 
_TECHNIQUE_OPTIONS = ["Single Portal", "2 Dimensional", "3DCRT", "IMRT", "VMAT"]
_TECHNIQUE_SYNONYMS = {
    "rapidarc": "VMAT",
    "volumetric modulated arc therapy": "VMAT",
    "volumetric arc therapy": "VMAT",
    "intensity modulated radiation therapy": "IMRT",
    "intensity-modulated radiotherapy": "IMRT",
    "intensity modulated radiotherapy": "IMRT",
    "three dimensional conformal": "3DCRT",
    "three-dimensional conformal radiotherapy": "3DCRT",
    "3d conformal radiotherapy": "3DCRT",
    "conformal radiotherapy": "3DCRT",
}
 
_MACHINE_OPTIONS = ["Cobalt", "LA", "CyberKnife", "MRI LINAC", "Proton"]
_MACHINE_SYNONYMS = {
    "linac": "LA",
    "linear accelerator": "LA",
    "cyberknife": "CyberKnife",
    "cyber knife": "CyberKnife",
    "mri linac": "MRI LINAC",
    "mr-linac": "MRI LINAC",
    "proton beam": "Proton",
    "proton beam therapy": "Proton",
    "proton therapy": "Proton",
    "cobalt-60": "Cobalt",
    "cobalt 60": "Cobalt",
    "co-60": "Cobalt",
}
 
_POSITION_OPTIONS = ["Supine", "Prone", "Lateral"]
_POSITION_SYNONYMS = {
    "supine position": "Supine",
    "prone position": "Prone",
    "lateral decubitus": "Lateral",
}
_POSITION_OTHER_LABEL = "Others"  # matches the existing frontend radio value
 
_IMAGING_OPTIONS = ["CT", "CT / MRI", "CT / PET", "X-Ray", "Clinical"]
_IMAGING_SYNONYMS = {
    "ct scan": "CT",
    "ct simulation": "CT",
    "ct-mri": "CT / MRI",
    "ct/mri": "CT / MRI",
    "mri": "CT / MRI",
    "ct-pet": "CT / PET",
    "ct/pet": "CT / PET",
    "pet-ct": "CT / PET",
    "pet ct": "CT / PET",
    "pet/ct": "CT / PET",
}
 
_IMPLANT_OPTIONS = [
    "Tandem & Ovoid", "Tandem & Ring", "Vaginal Cylinder (30 mm)",
    "Utrecht Applicator with Interstitial Needles", "Venezia Applicator",
    "Syed-Neblett Template", "MUPIT", "Transperineal Template Grid",
    "Multi-catheter Implant", "SAVI Applicator", "Freiburg Flap",
    "Leipzig Applicator", "COMS Plaque",
]
_IMPLANT_SYNONYMS = {
    "tandem and ovoid": "Tandem & Ovoid",
    "tandem ovoid": "Tandem & Ovoid",
    "t&o": "Tandem & Ovoid",
    "tandem and ring": "Tandem & Ring",
    "tandem ring": "Tandem & Ring",
    "t&r": "Tandem & Ring",
    "vaginal cylinder": "Vaginal Cylinder (30 mm)",
    "cylinder": "Vaginal Cylinder (30 mm)",
    "utrecht applicator": "Utrecht Applicator with Interstitial Needles",
    "venezia": "Venezia Applicator",
    "syed neblett": "Syed-Neblett Template",
    "syed-neblett": "Syed-Neblett Template",
    "template grid": "Transperineal Template Grid",
    "multicatheter": "Multi-catheter Implant",
    "multi catheter": "Multi-catheter Implant",
    "savi": "SAVI Applicator",
    "freiburg": "Freiburg Flap",
    "leipzig": "Leipzig Applicator",
    "coms plaque": "COMS Plaque",
}
 
_DOSE_RATE_OPTIONS = ["HDR", "LDR", "PDR"]
_DOSE_RATE_SYNONYMS = {
    "high dose rate": "HDR",
    "low dose rate": "LDR",
    "pulsed dose rate": "PDR",
}
 
 
def _classify_field(proto: dict, path: List[str], options: List[str],
                     synonyms: Dict[str, str], other_label: str = "Other") -> dict:
    """
    Convenience wrapper: reads proto[path[0]][path[1]]... , classifies it,
    and returns a dict fragment with the "<key>" / "<key>Other" /
    "<key>FromProtocol" triple, ready to merge into the outgoing form data.
    Returns {} entirely if the source value is empty (nothing to map).
    """
    node = proto
    for key in path[:-1]:
        node = (node or {}).get(key) or {}
    raw_value = (node or {}).get(path[-1])
 
    selected, other_text = _classify(raw_value, options, synonyms, other_label)
    if not selected:
        return {}
 
    out = {path[-1]: selected}
    if other_text is not None:
        out[f"{path[-1]}Other"] = other_text
        out[f"{path[-1]}FromProtocol"] = True
    return out
 
 
# ─────────────────────────────────────────────────────────────
# HELPERS — deterministic form mapping (now runs every classified
# field through the mapping layer above instead of copying raw
# protocol text straight into a fixed radio/select value)
# ─────────────────────────────────────────────────────────────
 
def _map_protocol_to_form(proto: dict, llm_data: Optional[dict] = None) -> dict:
    llm_data = llm_data or dict(_DEFAULT_LLM_ADAPTATION)
 
    rt_type_raw = (proto.get("rt_type") or "").lower()
    if "combined" in rt_type_raw:
        rt_type_ui = "Both"
    elif "brachy" in rt_type_raw:
        rt_type_ui = "Brachytherapy"
    else:
        rt_type_ui = "EBRT"
 
    is_ebrt = rt_type_ui in ("EBRT", "Both")
    is_brachy = rt_type_ui in ("Brachytherapy", "Both")
 
    simulation = proto.get("simulation") or {}
    target_volumes = proto.get("target_volumes") or {}
    prescription = proto.get("prescription") or {}
    machine = proto.get("machine") or {}
    igrt = proto.get("igrt") or {}
    planning = proto.get("planning") or {}
    qa = proto.get("qa") or {}
    followup = proto.get("followup") or {}
    brachytherapy = proto.get("brachytherapy") or {}
 
    intent_list = proto.get("intent") or []
    intent_primary = intent_list[0] if intent_list else ""
 
    # ── common ──
    common = {
        "treatment": {
            "intent": llm_data.get("treatmentIntent") or intent_primary,
            "rtRole": proto.get("technique") or "",
            "rtType": rt_type_ui,
        },
        "startDate": llm_data.get("startDate", ""),
        "concurrentTherapy": llm_data.get("concurrentTherapy", ""),
        "specialInstructions": llm_data.get("specialInstructions", ""),
        "reasonForChange": llm_data.get("reasonForChange", ""),
        "safetyFlags": llm_data.get("safetyFlags", []),
    }
 
    # ── ebrt ──
    ebrt: Dict[str, Any] = {}
    if is_ebrt:
        # Patient position — classify, "Others" is the existing bucket name
        position_selected, position_other = _classify(
            simulation.get("patient_position"), _POSITION_OPTIONS,
            _POSITION_SYNONYMS, other_label=_POSITION_OTHER_LABEL,
        )
        # Imaging — classify against the simulation-imaging radio options
        imaging_selected, imaging_other = _classify(
            simulation.get("imaging"), _IMAGING_OPTIONS, _IMAGING_SYNONYMS,
        )
 
        sim_set = {
            # Immobilisation is a free-text field in the UI already —
            # no classification needed, protocol text goes straight in.
            "immobilisation": simulation.get("immobilization") or "",
            "imaging": imaging_selected,
            "patientPos": position_selected,
            "totalDose": prescription.get("total_dose") or "",
            "totalFractions": prescription.get("fractions") or "",
            "dosePerFrac": prescription.get("dose_per_fraction") or "",
        }
        if imaging_other is not None:
            sim_set["imagingOther"] = imaging_other
            sim_set["imagingFromProtocol"] = True
        if position_other is not None:
            sim_set["positionOther"] = position_other
            sim_set["positionFromProtocol"] = True
 
        # Technique + Machine — classify against the procedure radio options
        technique_selected, technique_other = _classify(
            machine.get("technique") or proto.get("technique"),
            _TECHNIQUE_OPTIONS, _TECHNIQUE_SYNONYMS,
        )
        machine_selected, machine_other = _classify(
            machine.get("linac"), _MACHINE_OPTIONS, _MACHINE_SYNONYMS,
        )
        energy_struct = _classify_energy(machine.get("energy"))
 
        procedure = {
            "machine": machine_selected,
            "technique": technique_selected,
            "energy": energy_struct,
        }
        if machine_other is not None:
            procedure["machineOther"] = machine_other
            procedure["machineFromProtocol"] = True
        if technique_other is not None:
            procedure["techniqueOther"] = technique_other
            procedure["techniqueFromProtocol"] = True
 
        ebrt = {
            "simulationSets": [sim_set],
            "procedure": procedure,
            "planning": {
                "adaptiveRadiation": "Yes" if planning.get("adaptive") else "No",
            },
            # Reference-only block — read-only in the UI, never bound to
            # an input, so the doctor can see the untouched protocol data
            # regardless of how the classified fields above were resolved.
            "protocolReference": {
                "protocolId": proto.get("protocol_id"),
                "protocolName": proto.get("display_name") or proto.get("protocol_name"),
                "targetVolumes": target_volumes,
                "oarConstraints": proto.get("oar_constraints", {}),
                "igrt": igrt,
                "qa": qa,
                "followUpGuidance": followup.get("first_review"),
                "references": proto.get("references", []),
            },
        }
 
    # ── brachy ──
    brachy: Dict[str, Any] = {}
    if is_brachy:
        applicator_selected, applicator_other = _classify(
            brachytherapy.get("applicator_type"), _IMPLANT_OPTIONS, _IMPLANT_SYNONYMS,
        )
        dose_rate_selected, dose_rate_other = _classify(
            brachytherapy.get("dose_rate"), _DOSE_RATE_OPTIONS, _DOSE_RATE_SYNONYMS,
        )
 
        dose_prescription = {
            "technique": dose_rate_selected,
            "prescriptionDose": brachytherapy.get("dose_per_fraction") or "",
            "numberOfFractions": brachytherapy.get("fractions") or "",
            "totalDose": brachytherapy.get("total_dose") or "",
        }
        if dose_rate_other is not None:
            dose_prescription["techniqueOther"] = dose_rate_other
            dose_prescription["techniqueFromProtocol"] = True
 
        procedure = {
            "implantUsed": applicator_selected,
        }
        if applicator_other is not None:
            procedure["implantUsedOther"] = applicator_other
            procedure["implantUsedFromProtocol"] = True
 
        brachy = {
            "dosePrescription": dose_prescription,
            "procedure": procedure,
            "protocolReference": {
                "protocolId": proto.get("protocol_id"),
                "protocolName": proto.get("display_name") or proto.get("protocol_name"),
                "technique": brachytherapy.get("technique"),
                "numberOfImplants": brachytherapy.get("number_of_implants"),
            },
        }
 
    return {
        "common": common,
        "ebrt": ebrt,
        "brachy": brachy,
    }