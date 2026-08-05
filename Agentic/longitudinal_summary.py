"""
longitudinal_summary.py

Longitudinal Clinical Summary — agentic reasoning pipeline (single file: router + service).

This is a rewrite of longitudinal_summary.py. It keeps every existing data source,
node style (LangGraph + call_llm_json), and collection unchanged — it only
changes WHAT the pipeline organizes its output around.

    OLD:  Patient -> Diagnosis -> Treatment -> Response -> Recommendation   (a snapshot)
    NEW:  Baseline -> Visit 1 -> Visit 2 -> ... -> Current -> Trend         (a journey)

Nothing is hardcoded to a speciality. There is no "tumor_size" or "BP" field
anywhere in this file. Every measurement name, unit, visit label, and
response category is decided by the LLM from the patient's own data, so the
exact same code path works for oncology, cardiology, nephrology, neurology,
endocrinology, or any speciality that doesn't exist yet.

COLLECTIONS (unchanged from longitudinal_summary.py):
  * patient_summary_collection ("patient_summary")   — only clinical input
  * doctor_user_collection ("doctor_users")           — doctor's speciality
  * longitudinal_summary_collection ("longitudinal_summary") — this pipeline's
    own output store AND prior-state store (same collection, richer schema)

WHAT CHANGED VS THE OLD PIPELINE
  * Node 3 (visit_builder) replaces implicit "just use the flat event list" —
    events are grouped into dated Visits (mini-CRFs), the way a clinical
    trial CRF groups data by visit rather than by document.
  * Node 4 (baseline_builder) explicitly carves out Visit 0 / baseline.
  * Node 5 (measurement_engine) is new: one LLM pass finds EVERY repeated
    quantitative measurement in the record (whatever it is) and returns a
    baseline -> current timeline with % change and clinical direction for
    each one — this is the "no hardcoding" requirement from your plan.
  * Node 6/7 (treatment_timeline, safety_timeline) turn events into
    chronological CRF-style timelines instead of a single "current
    treatment" / "adverse events" snapshot.
  * Node 8 (response_evaluation) produces one overall longitudinal verdict,
    using whatever response framework actually fits the patient's condition
    (it is told to name the framework itself — RECIST for a solid tumor,
    a plain improving/stable/worsening call for anything without a named
    framework — never forced into one specialty's convention).
  * Node 9 (longitudinal_reasoning) is your existing care-stage/trend
    tracker, kept almost as-is, because it already did real longitudinal
    work — it's demoted from being the main output to being one input
    among several into the final assembly.
  * Node 11 (final_assembly) replaces the old 8-section-agent fan-out.
    Only 2 dynamic LLM section agents remain (patient_overview,
    ai_decision_support); everything else is now built from the
    structured Node 3-8 outputs, so there's far less free-text narrative
    and far more chartable, timestamped data for the frontend.

IMPORTANT FIX (this revision):
  * Every LangGraph node now returns ONLY the state keys it actually
    changed (a partial-update dict), instead of mutating `state` in place
    and returning the whole thing. When several nodes run concurrently in
    the same superstep (see the fan-out after baseline_builder), returning
    the full state caused every one of them to also "write" unrelated keys
    like `patient_id` in the same step, which LangGraph's default
    LastValue channel rejects with:
        InvalidUpdateError: At key 'patient_id': Can receive only one
        value per step. Use an Annotated key to handle multiple values.
    Returning only the changed keys fixes this without needing Annotated
    reducers and without changing how state is read anywhere else.
"""

import asyncio
import json
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, TypedDict

from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_groq import ChatGroq
from langgraph.graph import END, StateGraph

load_dotenv()

# ═══════════════════════════════════════════════════════════════
# CONFIG (unchanged)
# ═══════════════════════════════════════════════════════════════

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = os.getenv("MONGO_DB", "doctorassistai")

client = AsyncIOMotorClient(MONGO_URI)
db = client[MONGO_DB]

patient_summary_collection = db["patient_summary"]
doctor_user_collection = db["doctor_users"]
longitudinal_summary_collection = db["longitudinal_summary"]  # output + prior-state store

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise RuntimeError("GROQ_API_KEY is not set")

llm = ChatGroq(
    model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
    groq_api_key=GROQ_API_KEY,
    temperature=0.1,
    max_tokens=4000,
)


# ═══════════════════════════════════════════════════════════════
# UTILITIES (unchanged)
# ═══════════════════════════════════════════════════════════════

def repair_json(content: str) -> str:
    content = re.sub(r"```json|```", "", content).strip()
    match = re.search(r"[\{\[].*[\}\]]", content, re.DOTALL)
    if match:
        content = match.group(0)
    content = re.sub(r",\s*([\]}])", r"\1", content)
    return content


def sanitize_for_response(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: sanitize_for_response(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_for_response(v) for v in obj]
    return obj


async def call_llm_json(system_prompt: str, user_prompt: str, retries: int = 2) -> dict:
    """Same contract as before: returns {} on failure instead of raising,
    so one flaky node can't take the whole pipeline down."""
    last_err: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            response = await llm.ainvoke([
                SystemMessage(content=system_prompt),
                HumanMessage(content=user_prompt),
            ])
            content = repair_json(response.content)
            return json.loads(content)
        except Exception as e:  # noqa: BLE001
            last_err = e
            logger.warning(f"LLM call attempt {attempt} failed: {e}")
            await asyncio.sleep(0.5 * (attempt + 1))
    logger.error(f"LLM call failed after retries: {last_err}")
    return {}


async def call_llm_json_list(system_prompt: str, user_prompt: str, retries: int = 2) -> list:
    """Same as call_llm_json but for endpoints where the LLM's natural
    output is a JSON array rather than an object (e.g. measurement lists,
    timeline entries)."""
    last_err: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            response = await llm.ainvoke([
                SystemMessage(content=system_prompt),
                HumanMessage(content=user_prompt),
            ])
            content = re.sub(r"```json|```", "", response.content).strip()
            match = re.search(r"\[.*\]", content, re.DOTALL)
            if match:
                content = match.group(0)
            content = re.sub(r",\s*([\]}])", r"\1", content)
            parsed = json.loads(content)
            return parsed if isinstance(parsed, list) else parsed.get("items", [])
        except Exception as e:  # noqa: BLE001
            last_err = e
            logger.warning(f"LLM list call attempt {attempt} failed: {e}")
            await asyncio.sleep(0.5 * (attempt + 1))
    logger.error(f"LLM list call failed after retries: {last_err}")
    return []


async def fetch_doctor_speciality(doctor_id: str) -> str:
    try:
        doc = await doctor_user_collection.find_one(
            {"sys_user_id": doctor_id}, {"_id": 0, "specialization": 1}
        )
        if not doc:
            return ""
        spec = doc.get("specialization")
        if isinstance(spec, list):
            return ", ".join(spec)
        return spec or ""
    except Exception as e:  # noqa: BLE001
        logger.error(f"Failed fetching doctor speciality: {e}")
        return ""


# ═══════════════════════════════════════════════════════════════
# PATIENT SUMMARY FETCH (unchanged)
# ═══════════════════════════════════════════════════════════════

async def fetch_patient_summary_doc(patient_id: str) -> dict:
    try:
        doc = await patient_summary_collection.find_one({"patient_id": patient_id})
        return doc or {}
    except Exception as e:  # noqa: BLE001
        logger.error(f"Failed fetching patient_summary for {patient_id}: {e}")
        return {}


def _flatten_timeline_entities(timeline_obj: dict) -> List[dict]:
    """Unchanged from the old pipeline — pure reshaping, no LLM call."""
    flat: List[dict] = []

    for day in (timeline_obj.get("timeline") or []):
        date = day.get("date")
        for et in (day.get("entity_types") or []):
            entity_type = et.get("entity_type")
            for ent in (et.get("entities") or []):
                flat.append({
                    "date": ent.get("date") or date,
                    "event_type": entity_type,
                    "summary": ent.get("name"),
                    "evidence": ent.get("evidence"),
                    "source_document": ent.get("source_document"),
                })

    for et in (timeline_obj.get("undated") or []):
        entity_type = et.get("entity_type")
        for ent in (et.get("entities") or []):
            flat.append({
                "date": None,
                "event_type": entity_type,
                "summary": ent.get("name"),
                "evidence": ent.get("evidence"),
                "source_document": ent.get("source_document"),
            })

    return flat


def _group_evidence_by_document(events: List[dict]) -> Dict[str, dict]:
    by_doc: Dict[str, dict] = {}
    for e in events:
        doc_name = e.get("source_document")
        if not doc_name or doc_name == "unknown":
            continue
        bucket = by_doc.setdefault(doc_name, {"date": None, "evidence_snippets": []})
        if e.get("evidence"):
            bucket["evidence_snippets"].append(e["evidence"])
        if e.get("date") and not bucket["date"]:
            bucket["date"] = e["date"]
    return by_doc


# ═══════════════════════════════════════════════════════════════
# STATE
# ═══════════════════════════════════════════════════════════════

class LongitudinalSummaryState(TypedDict, total=False):
    patient_id: str
    doctor_id: str
    doctor_speciality: str
    force_refresh: bool

    patient_summary_doc: dict
    summary_text: dict
    documents_analyzed: int
    prior_output: Optional[dict]
    is_incremental: bool

    document_understanding: Dict[str, dict]
    all_clinical_events: List[dict]

    visits: List[dict]                 # chronological, date-grouped mini-CRFs
    baseline_visit: Optional[dict]      # Visit 0
    baseline_assessment: dict           # narrative baseline (generic fields)

    measurement_timelines: Dict[str, dict]   # generic measurement engine's output
    treatment_timeline: List[dict]
    safety_timeline: List[dict]
    response_summary: dict                   # overall longitudinal verdict

    visit_compliance: List[dict]             # NEW — visit timeliness vs documented expectation
    dosing_compliance: List[dict]            # NEW — documented medication adherence
    change_from_baseline_table: List[dict]   # NEW — one row per parameter (CRF-style)
    progression_matrix: Dict[str, dict]      # NEW — {parameter: {visit_label: value}}
    cdisc_mapping: dict                       # NEW — VS/LB/AE/CM/EX/DS domain tags
    ae_severity_matrix: dict                  # NEW — AE counts grouped by severity grade

    longitudinal_state: dict            # kept from old pipeline (care_stage/trends)
    cross_speciality_flags: List[dict]

    clinical_trial_summary: dict        # top-level output (replaces longitudinal_summary)
    meta: dict
    error: Optional[str]


# ═══════════════════════════════════════════════════════════════
# NODE 1 — Load + Preprocess
# ═══════════════════════════════════════════════════════════════

async def load_and_preprocess_node(state: LongitudinalSummaryState) -> dict:
    patient_id = state["patient_id"]
    doctor_id = state["doctor_id"]
    logger.info(f"📥 Load & Preprocess | patient={patient_id} doctor={doctor_id}")

    try:
        patient_summary_doc, prior_output, doctor_speciality = await asyncio.gather(
            fetch_patient_summary_doc(patient_id),
            (None if state.get("force_refresh") else longitudinal_summary_collection.find_one({"patient_id": patient_id})),
            fetch_doctor_speciality(doctor_id),
        )

        if not patient_summary_doc:
            raise ValueError(f"No patient_summary document found for patient_id={patient_id}")

        summary_text = patient_summary_doc.get("summary", {}) or {}
        timeline_obj = patient_summary_doc.get("timeline", {}) or {}
        documents_analyzed = patient_summary_doc.get("documents_analyzed", 0)

        all_events = _flatten_timeline_entities(timeline_obj)

        prior_documents_analyzed = (prior_output or {}).get("documents_analyzed", 0)
        is_incremental = bool(prior_output) and documents_analyzed == prior_documents_analyzed

        logger.info(
            f"✅ Loaded | documents_analyzed={documents_analyzed} "
            f"events={len(all_events)} incremental={is_incremental}"
        )

        return {
            "patient_summary_doc": patient_summary_doc,
            "summary_text": summary_text,
            "documents_analyzed": documents_analyzed,
            "prior_output": prior_output,
            "is_incremental": is_incremental,
            "all_clinical_events": all_events,
            "doctor_speciality": doctor_speciality or state.get("doctor_speciality", ""),
        }

    except Exception as e:  # noqa: BLE001
        logger.error(f"❌ Load & Preprocess failed: {e}")
        return {
            "error": f"load_and_preprocess failed: {e}",
            "summary_text": {},
            "all_clinical_events": [],
            "documents_analyzed": 0,
        }


# ═══════════════════════════════════════════════════════════════
# NODE 2 — Document Understanding
# ═══════════════════════════════════════════════════════════════

async def document_understanding_node(state: LongitudinalSummaryState) -> dict:
    all_events = state.get("all_clinical_events", [])
    by_doc = _group_evidence_by_document(all_events)
    logger.info(f"📄 Document Understanding | unique_documents={len(by_doc)}")

    if not by_doc:
        return {"document_understanding": {}}

    async def classify_one(doc_name: str, bucket: dict) -> tuple[str, dict]:
        evidence_text = "\n".join(bucket["evidence_snippets"])[:4000]
        if not evidence_text.strip():
            return doc_name, {
                "document_type": "Unclassified Clinical Document",
                "document_category": "",
                "document_speciality": "",
                "confidence": 0.0,
            }
        result = await call_llm_json(
            system_prompt=(
                "You are a clinical document classification agent used across ALL "
                "medical specialities. You are given only EVIDENCE SNIPPETS already "
                "extracted from one document. From this evidence alone, infer what "
                "kind of document it most likely was.\n\n"
                "RULES:\n"
                "1. Base your answer ONLY on what the evidence text says — never the "
                "filename.\n"
                "2. document_type: a concise standard clinical document type name "
                "(2-4 words). There is NO fixed list — name whatever it actually is.\n"
                "3. document_category: a broader grouping (e.g. 'Pathology', "
                "'Radiology', 'Cardiology Diagnostics', 'Clinical Note', 'Treatment "
                "Plan', 'Laboratory', 'Procedure Note').\n"
                "4. document_speciality: the medical speciality this document most "
                "relates to — empty string if unclear.\n"
                "5. If genuinely unclear, return 'Unclassified Clinical Document'.\n\n"
                "Return ONLY valid JSON: {\"document_type\": \"...\", "
                "\"document_category\": \"...\", \"document_speciality\": \"...\", "
                "\"confidence\": 0.0-1.0}."
            ),
            user_prompt=f"Evidence snippets from this document:\n\n{evidence_text}",
        )
        return doc_name, {
            "document_type": result.get("document_type", "Unclassified Clinical Document"),
            "document_category": result.get("document_category", ""),
            "document_speciality": result.get("document_speciality", ""),
            "confidence": result.get("confidence", 0.0),
        }

    try:
        classified_pairs = await asyncio.gather(*(
            classify_one(doc_name, bucket) for doc_name, bucket in by_doc.items()
        ))
        document_understanding = dict(classified_pairs)

        for event in all_events:
            classification = document_understanding.get(event.get("source_document"))
            if classification:
                event["document_type"] = classification["document_type"]
                event["document_category"] = classification["document_category"]
                event["document_speciality"] = classification["document_speciality"]

        logger.info(f"✅ Document Understanding complete | classified={len(document_understanding)}")
        return {"document_understanding": document_understanding, "all_clinical_events": all_events}
    except Exception as e:  # noqa: BLE001
        logger.error(f"❌ Document Understanding failed: {e}")
        return {"document_understanding": {}}


# ═══════════════════════════════════════════════════════════════
# NODE 3 — Visit Builder (no LLM — pure grouping, plus one batched
# LLM call for descriptive visit_type labels)
# ═══════════════════════════════════════════════════════════════

async def visit_builder_node(state: LongitudinalSummaryState) -> dict:
    all_events = state.get("all_clinical_events", [])
    dated = [e for e in all_events if e.get("date")]
    undated = [e for e in all_events if not e.get("date")]

    by_date: Dict[str, List[dict]] = {}
    for e in dated:
        by_date.setdefault(e["date"], []).append(e)

    visit_dates = sorted(by_date.keys())
    raw_visits = [
        {"visit_date": d, "events": by_date[d]}
        for d in visit_dates
    ]

    logger.info(f"🗓️ Visit Builder | visits={len(raw_visits)} undated_events={len(undated)}")

    # Label each visit's type in a single batched LLM call (not one call per
    # visit) — purely descriptive, never used to filter/drop data.
    if raw_visits:
        compact = [
            {
                "visit_date": v["visit_date"],
                "document_types": sorted({
                    ev.get("document_type") for ev in v["events"] if ev.get("document_type")
                }),
                "event_summaries": [ev.get("summary") for ev in v["events"] if ev.get("summary")][:10],
            }
            for v in raw_visits
        ]
        labels = await call_llm_json(
            system_prompt=(
                "You label clinical visits/encounters across ANY medical speciality. "
                "For each visit given (its date, the kinds of documents generated on "
                "that date, and short event summaries), return a short, standard "
                "visit_type label a clinician would recognise — e.g. 'Baseline "
                "Diagnostic Workup', 'Chemotherapy Cycle', 'Follow-up Consultation', "
                "'Surgical Admission', 'Post-operative Review', 'Routine Lab Draw', "
                "'Imaging Study', 'Emergency Presentation'. There is no fixed list — "
                "use whatever fits. If truly ambiguous, use 'Clinical Encounter'.\n\n"
                "Return ONLY valid JSON: {\"labels\": [{\"visit_date\": \"...\", "
                "\"visit_type\": \"...\"}, ...]} — one entry per visit given, in the "
                "same order."
            ),
            user_prompt=json.dumps(compact, default=str)[:14000],
        )
        label_map = {
            item.get("visit_date"): item.get("visit_type")
            for item in labels.get("labels", [])
            if item.get("visit_date")
        }
        for v in raw_visits:
            v["visit_type"] = label_map.get(v["visit_date"], "Clinical Encounter")
    for v in raw_visits:
        v.setdefault("visit_type", "Clinical Encounter")

    return {"visits": raw_visits, "all_clinical_events": dated + undated}


# ═══════════════════════════════════════════════════════════════
# NODE 3B — Study Visit Schedule
# ═══════════════════════════════════════════════════════════════

def _study_day(baseline_date: str, visit_date: str) -> Optional[int]:
    try:
        d0 = datetime.fromisoformat(baseline_date[:10])
        d1 = datetime.fromisoformat(visit_date[:10])
        return (d1 - d0).days
    except Exception:  # noqa: BLE001
        return None


async def study_visit_schedule_node(state: LongitudinalSummaryState) -> dict:
    visits = state.get("visits", [])
    if not visits:
        return {}

    baseline_date = visits[0]["visit_date"]
    for v in visits:
        v["study_day"] = _study_day(baseline_date, v["visit_date"])

    logger.info(f"🏷️ Study Visit Schedule | visits={len(visits)}")

    compact = [
        {
            "visit_date": v["visit_date"],
            "study_day": v["study_day"],
            "visit_type": v.get("visit_type"),
            "event_summaries": [ev.get("summary") for ev in v["events"] if ev.get("summary")][:10],
        }
        for v in visits
    ]

    result = await call_llm_json(
        system_prompt=(
            "You assign STUDY VISIT NOMENCLATURE to a patient's chronological "
            "visits, in the style used across clinical trial CRFs — across ANY "
            "medical speciality. You are given each visit's date, study_day "
            "(days since the first/baseline visit, which is always study_day 0), "
            "its generic visit_type, and short event summaries.\n\n"
            "For each visit return:\n"
            "  - study_visit_label: a standard trial-style label, e.g. "
            "'Screening', 'Baseline', 'Cycle 1 Day 1', 'Cycle 2 Day 1', "
            "'Day 14', 'Month 1', 'Month 2', 'End of Treatment', 'Follow-up 1' "
            "— pick whatever genuinely fits this patient's own care pattern "
            "(chemo cycles vs monthly follow-ups vs ad hoc visits). The FIRST "
            "visit (study_day 0) must be labelled 'Baseline' unless the events "
            "clearly describe it as a pure pre-baseline 'Screening' visit.\n"
            "  - expected_next_visit_days: an integer number of days until the "
            "NEXT visit was expected, ONLY if this visit's events explicitly "
            "document a planned interval (e.g. 'follow up in 3 weeks', 'next "
            "cycle in 21 days'). Use null if no such interval is documented — "
            "never infer one from a generic care pattern.\n\n"
            "Return ONLY valid JSON: {\"schedule\": [{\"visit_date\": \"...\", "
            "\"study_visit_label\": \"...\", \"expected_next_visit_days\": ... or "
            "null}, ...]} — one entry per visit given, same order."
        ),
        user_prompt=json.dumps(compact, default=str)[:14000],
    )

    schedule_map = {
        item.get("visit_date"): item
        for item in result.get("schedule", [])
        if item.get("visit_date")
    }
    for v in visits:
        entry = schedule_map.get(v["visit_date"], {})
        v["study_visit_label"] = entry.get("study_visit_label", v.get("visit_type", "Visit"))
        v["expected_next_visit_days"] = entry.get("expected_next_visit_days")

    # Guarantee: study_day 0 is always labelled Baseline, regardless of what
    # the LLM returned — this is the one rule that must never be violated.
    if visits:
        visits[0]["study_visit_label"] = "Baseline"

    return {"visits": visits}


# ═══════════════════════════════════════════════════════════════
# NODE 4 — Baseline Builder
# ═══════════════════════════════════════════════════════════════

async def baseline_builder_node(state: LongitudinalSummaryState) -> dict:
    visits = state.get("visits", [])
    summary_text = state.get("summary_text", {})
    doctor_speciality = state.get("doctor_speciality", "")

    if not visits:
        return {"baseline_visit": None, "baseline_assessment": {}}

    baseline_visit = visits[0]
    logger.info(f"📌 Baseline Builder | baseline_date={baseline_visit['visit_date']}")

    result = await call_llm_json(
        system_prompt=(
            "You build the BASELINE assessment for a longitudinal clinical record — "
            "equivalent to Visit 0 / Day 0 in a clinical trial CRF. This must reflect "
            "ONLY the earliest available data for this patient, never anything from "
            "a later visit.\n\n"
            f"Doctor speciality context: {doctor_speciality or 'unspecified'}.\n\n"
            "Decide the field names yourself based on what this patient's baseline "
            "visit actually contains (diagnosis, initial symptoms, initial imaging, "
            "initial labs, initial performance/severity score, initial vitals, "
            "initial medications — whatever is genuinely present). Omit a field "
            "entirely rather than guessing or writing 'not available'. Return a "
            "single flat JSON object."
        ),
        user_prompt=json.dumps({
            "diagnosis_header": summary_text.get("diagnosis_header"),
            "confirmed_diagnoses": summary_text.get("confirmed_diagnoses", []),
            "baseline_visit_date": baseline_visit["visit_date"],
            "baseline_events": baseline_visit["events"],
        }, default=str)[:14000],
    )

    return {"baseline_visit": baseline_visit, "baseline_assessment": result}


# ═══════════════════════════════════════════════════════════════
# NODE 5 — Measurement Engine
# ═══════════════════════════════════════════════════════════════

async def measurement_engine_node(state: LongitudinalSummaryState) -> dict:
    visits = state.get("visits", [])
    doctor_speciality = state.get("doctor_speciality", "")

    if not visits:
        return {"measurement_timelines": {}}

    events_for_llm = [
        {"visit_date": v["visit_date"], "events": v["events"]}
        for v in visits
    ]

    logger.info(f"📏 Measurement Engine | visits={len(visits)}")

    result = await call_llm_json(
        system_prompt=(
            "You are a generic longitudinal measurement extraction engine used "
            "across ALL medical specialities. You are given every dated clinical "
            "event for one patient, grouped by visit. Find every quantitative "
            "measurement that repeats across two or more visits (e.g. a lab value, "
            "a vital sign, a tumor/lesion size, a severity score, a functional "
            "score, a weight — literally anything numeric that the patient's own "
            "record actually repeats). Do NOT assume any fixed set of measurements "
            f"— decide entirely from the data. Doctor speciality: "
            f"{doctor_speciality or 'unspecified'} (context only, do not force "
            "measurements from a different speciality's convention).\n\n"
            "For EACH measurement found, return:\n"
            "  - name: a clear canonical name (e.g. 'Tumor Size (RECIST)', "
            "'Serum Creatinine', 'Systolic/Diastolic BP', 'HbA1c')\n"
            "  - unit: its unit of measure, empty string if unitless (e.g. a score)\n"
            "  - series: [{\"date\": \"...\", \"value\": \"...\"}] in chronological "
            "order, using ONLY values actually present in the data — never "
            "interpolate or invent a point\n"
            "  - baseline_value / current_value: the earliest and latest series "
            "values\n"
            "  - absolute_change and percent_change from baseline to current (as "
            "numbers if computable, else null)\n"
            "  - direction: 'improving' | 'worsening' | 'stable' | 'mixed' — judged "
            "clinically (know that for some measurements a rise is good and for "
            "others a rise is bad)\n"
            "  - note: one short clinical sentence explaining the direction call\n\n"
            "Only include a measurement with 2+ real data points. Never invent a "
            "value. Return ONLY valid JSON:\n"
            "{\"measurements\": [{\"name\": \"...\", \"unit\": \"...\", "
            "\"series\": [...], \"baseline_value\": \"...\", \"current_value\": "
            "\"...\", \"absolute_change\": ..., \"percent_change\": ..., "
            "\"direction\": \"...\", \"note\": \"...\"}]}"
        ),
        user_prompt=json.dumps(events_for_llm, default=str)[:16000],
    )

    measurements = result.get("measurements", [])
    # Key by canonical name so the frontend can address a timeline directly
    # (dict keeps insertion order in Python 3.7+, so chart ordering is stable).
    measurement_timelines = {
        m["name"]: {k: v for k, v in m.items() if k != "name"}
        for m in measurements
        if m.get("name") and m.get("series")
    }
    logger.info(f"✅ Measurement Engine | measurements_found={len(measurement_timelines)}")
    return {"measurement_timelines": measurement_timelines}


# ═══════════════════════════════════════════════════════════════
# NODE 6 — Treatment Timeline
# ═══════════════════════════════════════════════════════════════

async def treatment_timeline_node(state: LongitudinalSummaryState) -> dict:
    visits = state.get("visits", [])
    if not visits:
        return {"treatment_timeline": []}

    logger.info("💊 Treatment Timeline")
    result = await call_llm_json_list(
        system_prompt=(
            "Extract a chronological TREATMENT TIMELINE for this patient from the "
            "visit-grouped clinical events given — across ANY speciality (drugs, "
            "chemotherapy cycles, radiation sessions, surgery, dialysis sessions, "
            "device implantation, dose changes, discontinuations — whatever the "
            "data actually shows). Only include an entry with clear evidence in the "
            "events. Never invent a treatment or a date.\n\n"
            "Return ONLY a valid JSON array, one entry per treatment-related event, "
            "each shaped as: {\"visit_date\": \"...\", \"treatment\": \"...\", "
            "\"action\": \"started|continued|dose_changed|discontinued|completed\", "
            "\"detail\": \"...\"}"
        ),
        user_prompt=json.dumps(
            [{"visit_date": v["visit_date"], "events": v["events"]} for v in visits],
            default=str,
        )[:16000],
    )
    return {"treatment_timeline": result}


# ═══════════════════════════════════════════════════════════════
# NODE 7 — Safety Timeline
# ═══════════════════════════════════════════════════════════════

async def safety_timeline_node(state: LongitudinalSummaryState) -> dict:
    visits = state.get("visits", [])
    if not visits:
        return {"safety_timeline": []}

    logger.info("⚠️ Safety Timeline")
    result = await call_llm_json_list(
        system_prompt=(
            "Extract a chronological SAFETY TIMELINE (adverse events / complications) "
            "for this patient from the visit-grouped clinical events given — across "
            "ANY speciality. Only include an entry with clear evidence. Never invent "
            "a severity grade, causality, seriousness, or expectedness that isn't "
            "stated or clearly implied.\n\n"
            "Return ONLY a valid JSON array, each entry shaped as: "
            "{\"visit_date\": \"...\", \"event\": \"...\", \"severity_grade\": "
            "\"...\" (omit if not stated), \"causality\": \"...\" (omit if not "
            "stated), \"serious\": true|false (omit if not determinable — 'serious' "
            "meaning it resulted in hospitalisation, was life-threatening, or "
            "similar per standard AE reporting conventions), \"expected\": "
            "true|false (omit if not determinable — whether the record frames it "
            "as an anticipated/known effect of the treatment vs unexpected), "
            "\"action_taken\": \"...\" (omit if not stated), \"outcome\": \"...\" "
            "(omit if not stated)}"
        ),
        user_prompt=json.dumps(
            [{"visit_date": v["visit_date"], "events": v["events"]} for v in visits],
            default=str,
        )[:16000],
    )
    return {"safety_timeline": result}


# ═══════════════════════════════════════════════════════════════
# NODE 7B — AE Severity Matrix (no LLM — pure reshape)
# ═══════════════════════════════════════════════════════════════

async def ae_severity_matrix_node(state: LongitudinalSummaryState) -> dict:
    safety_timeline = state.get("safety_timeline", [])
    if not safety_timeline:
        return {"ae_severity_matrix": {}}

    by_grade: Dict[str, dict] = {}
    serious_count = 0
    for ae in safety_timeline:
        grade = ae.get("severity_grade") or "Ungraded"
        bucket = by_grade.setdefault(grade, {"count": 0, "events": []})
        bucket["count"] += 1
        bucket["events"].append(ae.get("event"))
        if ae.get("serious") is True:
            serious_count += 1

    return {
        "ae_severity_matrix": {
            "by_severity_grade": by_grade,
            "total_events": len(safety_timeline),
            "serious_event_count": serious_count,
        }
    }


# ═══════════════════════════════════════════════════════════════
# NODE — Visit Compliance (no LLM — pure comparison)
# ═══════════════════════════════════════════════════════════════

async def visit_compliance_node(state: LongitudinalSummaryState) -> dict:
    visits = state.get("visits", [])
    if len(visits) < 2:
        return {"visit_compliance": []}

    compliance: List[dict] = []
    for prev, curr in zip(visits, visits[1:]):
        expected_days = prev.get("expected_next_visit_days")
        actual_days = None
        if prev.get("study_day") is not None and curr.get("study_day") is not None:
            actual_days = curr["study_day"] - prev["study_day"]

        entry = {
            "visit_date": curr["visit_date"],
            "study_visit_label": curr.get("study_visit_label"),
            "days_since_previous_visit": actual_days,
            "expected_days": expected_days,
        }
        if expected_days is not None and actual_days is not None:
            # 20% tolerance window (minimum 3 days) before calling it delayed —
            # a plain, transparent rule rather than a clinical judgement call.
            tolerance = max(3, round(expected_days * 0.2))
            if actual_days <= expected_days + tolerance:
                entry["compliance_status"] = "on_time"
            else:
                entry["compliance_status"] = "delayed"
                entry["days_delayed"] = actual_days - expected_days
        else:
            entry["compliance_status"] = "unknown"  # nothing documented to compare against

        compliance.append(entry)

    return {"visit_compliance": compliance}


# ═══════════════════════════════════════════════════════════════
# NODE — Dosing Compliance
# ═══════════════════════════════════════════════════════════════

async def dosing_compliance_node(state: LongitudinalSummaryState) -> dict:
    visits = state.get("visits", [])
    if not visits:
        return {"dosing_compliance": []}

    logger.info("💊 Dosing Compliance")
    result = await call_llm_json_list(
        system_prompt=(
            "Extract any EXPLICITLY documented medication/dosing adherence "
            "information from these visit-grouped clinical events — across ANY "
            "speciality. Only include a visit where adherence is actually "
            "discussed (a stated percentage, a missed-dose count, a "
            "self-discontinuation, an interruption). Never assume or estimate "
            "compliance where it isn't documented.\n\n"
            "Return ONLY a valid JSON array, each entry shaped as: "
            "{\"visit_date\": \"...\", \"medication\": \"...\", "
            "\"adherence_percent\": ... or null, \"status\": \"as_prescribed|"
            "missed_doses|interrupted|discontinued\", \"detail\": \"...\"}"
        ),
        user_prompt=json.dumps(
            [{"visit_date": v["visit_date"], "events": v["events"]} for v in visits],
            default=str,
        )[:16000],
    )
    return {"dosing_compliance": result}


# ═══════════════════════════════════════════════════════════════
# NODE 8 — Longitudinal Reasoning (kept from old pipeline, mostly as-is)
# ═══════════════════════════════════════════════════════════════

async def longitudinal_reasoning_node(state: LongitudinalSummaryState) -> dict:
    prior_output = state.get("prior_output") or {}
    prior_longitudinal = prior_output.get("longitudinal_state", {}) or {}
    prior_care_stage = prior_longitudinal.get("care_stage")
    prior_key_findings = prior_longitudinal.get("key_findings_carry_forward", [])
    doctor_speciality = state.get("doctor_speciality", "")
    all_events = state.get("all_clinical_events", [])
    summary_text = state.get("summary_text", {})

    logger.info(f"📈 Longitudinal Reasoning | events={len(all_events)} speciality={doctor_speciality}")

    if state.get("is_incremental") and prior_longitudinal:
        return {"longitudinal_state": prior_longitudinal}

    result = await call_llm_json(
        system_prompt=(
            "You track a patient's evolving clinical course across ANY medical "
            "speciality. You are given the PRIOR state (empty on first run), a "
            "plain-language clinical summary, and the full set of clinical events. "
            "Update — never discard — the prior state.\n\n"
            "CARE STAGE: describe the patient's current phase of care in plain "
            "clinical language that fits THIS patient's diagnosis and "
            f"THIS doctor's speciality ({doctor_speciality or 'unspecified'}). Do "
            "NOT force it into a single speciality's staging model.\n\n"
            "Return ONLY valid JSON:\n"
            "{\"care_stage\": \"...\", \"stage_history\": [{\"stage\": \"...\", "
            "\"date\": \"...\"}], \"key_findings_carry_forward\": [<facts still "
            "clinically relevant right now>]}"
        ),
        user_prompt=json.dumps({
            "prior_care_stage": prior_care_stage,
            "prior_key_findings": prior_key_findings,
            "diagnosis_header": summary_text.get("diagnosis_header"),
            "confirmed_diagnoses": summary_text.get("confirmed_diagnoses", []),
            "clinical_events": all_events,
        }, default=str)[:14000],
    )

    result.setdefault("care_stage", prior_care_stage)
    result.setdefault("stage_history", prior_longitudinal.get("stage_history", []))
    result.setdefault("key_findings_carry_forward", prior_key_findings)
    logger.info(f"✅ Care stage: {result.get('care_stage')}")
    return {"longitudinal_state": result}


# ═══════════════════════════════════════════════════════════════
# NODE 9 — Cross-Speciality Reasoning (unchanged from old pipeline)
# ═══════════════════════════════════════════════════════════════

async def cross_speciality_reasoning_node(state: LongitudinalSummaryState) -> dict:
    all_events = state.get("all_clinical_events", [])
    longitudinal_state = state.get("longitudinal_state", {})
    logger.info(f"🔀 Cross-Speciality Reasoning | events={len(all_events)}")

    if not all_events:
        return {"cross_speciality_flags": []}

    result = await call_llm_json(
        system_prompt=(
            "You are a tumour-board-style cross-specialty reasoning agent, "
            "applicable to ANY combination of medical specialities. Given clinical "
            "events and the current longitudinal state, identify any situation "
            "where a finding managed by one specialist has a real implication for "
            "another specialist's decision. Return ONLY valid JSON:\n"
            "{\"cross_speciality_flags\": [{\"trigger\": \"...\", "
            "\"from_speciality\": \"...\", \"affects_speciality\": \"...\", "
            "\"question_or_action\": \"...\", \"urgency\": \"routine|prompt|"
            "urgent\"}]}\n"
            "Only include a flag with a clear, evidence-based clinical basis."
        ),
        user_prompt=json.dumps({
            "clinical_events": all_events[-20:],
            "longitudinal_state": longitudinal_state,
        }, default=str)[:14000],
    )
    return {"cross_speciality_flags": result.get("cross_speciality_flags", [])}


# ═══════════════════════════════════════════════════════════════
# NODE 10 — Response Evaluation
# ═══════════════════════════════════════════════════════════════

async def response_evaluation_node(state: LongitudinalSummaryState) -> dict:
    measurement_timelines = state.get("measurement_timelines", {})
    longitudinal_state = state.get("longitudinal_state", {})
    summary_text = state.get("summary_text", {})

    if not measurement_timelines:
        return {"response_summary": {}}

    logger.info("🎯 Response Evaluation")
    result = await call_llm_json(
        system_prompt=(
            "You produce ONE overall longitudinal response verdict for a patient, "
            "from their measurement timelines (baseline -> current, with computed "
            "direction) and their current care stage. Use whatever response "
            "framework genuinely fits this patient's own condition — name it "
            "yourself (e.g. RECIST 1.1 categories for a solid tumour with imaging "
            "measurements, a plain 'improving/stable/worsening' call for anything "
            "without a named framework, a disease-specific score threshold if one "
            "is clearly implied by the data). NEVER apply a framework the data "
            "doesn't support.\n\n"
            "Also identify, in the style of a clinical trial's endpoint "
            "definitions:\n"
            "  - primary_endpoint: the single measurement name (from "
            "measurement_timelines) that most directly reflects this patient's "
            "disease status and drove your overall_response call — empty string "
            "if none of the measurements are truly disease-defining.\n"
            "  - secondary_endpoints: other measurement names that support the "
            "picture but didn't drive the primary call — empty list if none.\n"
            "  - responder_status: 'responder' | 'non_responder' | "
            "'indeterminate' — 'indeterminate' if there isn't yet enough data "
            "to call it either way.\n\n"
            "Return ONLY valid JSON: {\"framework_used\": \"...\" (empty string if "
            "none applies), \"overall_response\": \"...\", \"confidence\": "
            "0.0-1.0, \"basis\": \"...\" (1-2 sentences citing which measurements "
            "drove the call), \"primary_endpoint\": \"...\", "
            "\"secondary_endpoints\": [...], \"responder_status\": \"...\"}"
        ),
        user_prompt=json.dumps({
            "diagnosis_header": summary_text.get("diagnosis_header"),
            "confirmed_diagnoses": summary_text.get("confirmed_diagnoses", []),
            "measurement_timelines": measurement_timelines,
            "care_stage": longitudinal_state.get("care_stage"),
        }, default=str)[:14000],
    )
    return {"response_summary": result}


# ═══════════════════════════════════════════════════════════════
# NODE — Subject Progression Matrix (no LLM — pure reshape)
# ═══════════════════════════════════════════════════════════════

async def progression_matrix_node(state: LongitudinalSummaryState) -> dict:
    measurement_timelines = state.get("measurement_timelines", {})
    visits = state.get("visits", [])

    if not measurement_timelines:
        return {"change_from_baseline_table": [], "progression_matrix": {}}

    date_to_label = {v["visit_date"]: v.get("study_visit_label", v["visit_date"]) for v in visits}

    change_table = []
    matrix: Dict[str, Dict[str, Any]] = {}

    for name, m in measurement_timelines.items():
        change_table.append({
            "parameter": name,
            "unit": m.get("unit", ""),
            "baseline_value": m.get("baseline_value"),
            "current_value": m.get("current_value"),
            "absolute_change": m.get("absolute_change"),
            "percent_change": m.get("percent_change"),
            "direction": m.get("direction"),
        })

        row: Dict[str, Any] = {}
        for point in m.get("series", []):
            label = date_to_label.get(point.get("date"), point.get("date"))
            row[label] = point.get("value")
        matrix[name] = row

    return {"change_from_baseline_table": change_table, "progression_matrix": matrix}


# ═══════════════════════════════════════════════════════════════
# NODE — CDISC Domain Mapping
# ═══════════════════════════════════════════════════════════════

async def cdisc_mapping_node(state: LongitudinalSummaryState) -> dict:
    measurement_names = list(state.get("measurement_timelines", {}).keys())
    treatment_entries = state.get("treatment_timeline", [])
    care_stage = state.get("longitudinal_state", {}).get("care_stage")

    if not measurement_names and not treatment_entries and not care_stage:
        return {"cdisc_mapping": {}}

    logger.info("🗂️ CDISC Domain Mapping")
    result = await call_llm_json(
        system_prompt=(
            "You map already-extracted clinical data to the closest-fitting "
            "CDISC SDTM domain codes. Domains available: "
            "VS = Vital Signs, LB = Laboratory, AE = Adverse Events, "
            "CM = Concomitant Medications, EX = Exposure (the study/primary "
            "treatment being tracked), DS = Disposition. Use 'OTHER' if nothing "
            "fits — never force a value into the wrong domain.\n\n"
            "Given a list of measurement names, a list of treatment timeline "
            "entries, and the patient's current care stage, return:\n"
            "  - measurement_domains: {measurement_name: domain_code}\n"
            "  - treatment_domains: [{\"treatment\": \"...\", \"domain_code\": "
            "\"...\"}] (EX for the primary/study treatment being tracked, CM for "
            "anything clearly a supportive/concomitant medication)\n"
            "  - disposition: {\"status\": \"ongoing|completed|discontinued|"
            "withdrawn\", \"domain_code\": \"DS\"} inferred from care_stage — "
            "return an empty object if the care stage doesn't clearly imply one "
            "of these.\n\n"
            "Return ONLY valid JSON with exactly those three keys."
        ),
        user_prompt=json.dumps({
            "measurement_names": measurement_names,
            "treatment_entries": treatment_entries,
            "care_stage": care_stage,
        }, default=str)[:14000],
    )

    return {
        "cdisc_mapping": {
            "measurement_domains": result.get("measurement_domains", {}),
            "treatment_domains": result.get("treatment_domains", []),
            "disposition": result.get("disposition", {}),
        }
    }


# ═══════════════════════════════════════════════════════════════
# NODE 11 — Final Assembly
# ═══════════════════════════════════════════════════════════════

class DynamicSectionAgent:
    section_key: str = "section"
    section_name: str = "Section"
    guidance: str = ""

    async def run(self, context: dict, doctor_speciality: str) -> dict:
        if not context or not any(v for v in context.values()):
            return {}
        system_prompt = (
            f"You are the '{self.section_name}' agent inside a longitudinal "
            "clinical summary system used across every medical speciality. The "
            f"treating doctor's speciality is: {doctor_speciality or 'unspecified'}.\n\n"
            f"{self.guidance}\n\n"
            "RULES:\n"
            "1. Decide field names yourself based on what is clinically relevant "
            "for THIS patient — there is no fixed schema.\n"
            "2. Include a field ONLY if the data supports it — never guess or "
            "write 'N/A'. Omit instead.\n"
            "3. Never carry over a different speciality's convention onto this "
            "patient.\n"
            "4. Return a single flat JSON object for this section only."
        )
        return await call_llm_json(system_prompt, json.dumps(context, default=str)[:14000])


class PatientOverviewAgent(DynamicSectionAgent):
    section_key = "patient_overview"
    section_name = "Patient Overview"
    guidance = (
        "Patient demographic and contextual information — identity fields, "
        "vitals/anthropometrics, allergies, comorbidities, relevant history — "
        "drawn from the clinical summary paragraphs and recent events."
    )


class AIDecisionSupportAgent(DynamicSectionAgent):
    section_key = "ai_decision_support"
    section_name = "AI Decision Support"
    guidance = (
        "You must NEVER invent a recommendation not grounded in the measurement "
        "timelines, response summary, longitudinal state, or cross-speciality "
        "flags given to you. If evidence is insufficient, omit the "
        "recommendation entirely rather than hedging. Any cross-speciality flag "
        "with urgency 'urgent' or 'prompt' must surface as a red flag here."
    )


async def final_assembly_node(state: LongitudinalSummaryState) -> dict:
    logger.info("🧩 Final Assembly")
    doctor_speciality = state.get("doctor_speciality", "")
    summary_text = state.get("summary_text", {})
    all_events = state.get("all_clinical_events", [])
    visits = state.get("visits", [])

    patient_overview_ctx = {
        "summary_paragraphs": summary_text.get("paragraphs", []),
        "recent_events": all_events[-8:],
    }
    ai_decision_ctx = {
        "measurement_timelines": state.get("measurement_timelines", {}),
        "response_summary": state.get("response_summary", {}),
        "longitudinal_state": state.get("longitudinal_state", {}),
        "cross_speciality_flags": state.get("cross_speciality_flags", []),
    }

    patient_overview, ai_decision_support = await asyncio.gather(
        PatientOverviewAgent().run(patient_overview_ctx, doctor_speciality),
        AIDecisionSupportAgent().run(ai_decision_ctx, doctor_speciality),
    )

    # Compact visit_timeline for the frontend: date, type, and a short list
    # of what happened — the full event detail already lives in `visits`
    # if a client wants to drill in, this is the "journey at a glance" view.
    visit_timeline = [
        {
            "visit_date": v["visit_date"],
            "visit_type": v.get("visit_type"),
            "events": [
                {
                    "summary": e.get("summary"),
                    "event_type": e.get("event_type"),
                    "document_type": e.get("document_type"),
                }
                for e in v["events"]
            ],
        }
        for v in visits
    ]

    clinical_trial_summary = {
        k: v for k, v in {
            "patient_overview": patient_overview,
            "baseline_assessment": state.get("baseline_assessment", {}),
            "visit_timeline": visit_timeline,
            "visit_compliance": state.get("visit_compliance", []),
            "measurement_timelines": state.get("measurement_timelines", {}),
            "change_from_baseline_table": state.get("change_from_baseline_table", []),
            "progression_matrix": state.get("progression_matrix", {}),
            "treatment_timeline": state.get("treatment_timeline", []),
            "dosing_compliance": state.get("dosing_compliance", []),
            "safety_timeline": state.get("safety_timeline", []),
            "ae_severity_matrix": state.get("ae_severity_matrix", {}),
            "response_summary": state.get("response_summary", {}),
            "longitudinal_summary": state.get("longitudinal_state", {}),
            "cross_speciality_flags": state.get("cross_speciality_flags", []),
            "cdisc_mapping": state.get("cdisc_mapping", {}),
            "ai_decision_support": ai_decision_support,
        }.items() if v
    }

    logger.info(f"✅ Final Assembly complete | sections={list(clinical_trial_summary.keys())}")
    return {"clinical_trial_summary": clinical_trial_summary}


# ═══════════════════════════════════════════════════════════════
# NODE 12 — Persist output + assemble meta
# ═══════════════════════════════════════════════════════════════

async def persist_state_node(state: LongitudinalSummaryState) -> dict:
    patient_id = state["patient_id"]
    longitudinal_state = state.get("longitudinal_state", {})
    documents_analyzed = state.get("documents_analyzed", 0)

    new_output_doc = {
        "patient_id": patient_id,
        "clinical_trial_summary": state.get("clinical_trial_summary", {}),
        "visits": state.get("visits", []),
        "baseline_visit": state.get("baseline_visit"),
        "measurement_timelines": state.get("measurement_timelines", {}),
        "change_from_baseline_table": state.get("change_from_baseline_table", []),
        "progression_matrix": state.get("progression_matrix", {}),
        "treatment_timeline": state.get("treatment_timeline", []),
        "dosing_compliance": state.get("dosing_compliance", []),
        "safety_timeline": state.get("safety_timeline", []),
        "ae_severity_matrix": state.get("ae_severity_matrix", {}),
        "visit_compliance": state.get("visit_compliance", []),
        "cdisc_mapping": state.get("cdisc_mapping", {}),
        "response_summary": state.get("response_summary", {}),
        "longitudinal_state": longitudinal_state,
        "cross_speciality_flags": state.get("cross_speciality_flags", []),
        "document_understanding": state.get("document_understanding", {}),
        "documents_analyzed": documents_analyzed,
        "last_generated_at": datetime.now(timezone.utc).isoformat(),
        "last_run_by_doctor_id": state.get("doctor_id"),
        "updated_at": datetime.now(timezone.utc),
    }

    try:
        await longitudinal_summary_collection.update_one(
            {"patient_id": patient_id}, {"$set": new_output_doc}, upsert=True
        )
    except Exception as e:  # noqa: BLE001
        logger.error(f"❌ Failed to persist longitudinal summary output: {e}")

    return {
        "meta": {
            "care_stage": longitudinal_state.get("care_stage"),
            "documents_analyzed": documents_analyzed,
            "is_incremental": state.get("is_incremental", False),
            "visit_count": len(state.get("visits", [])),
            "measurements_tracked": list(state.get("measurement_timelines", {}).keys()),
            "cross_speciality_flags": state.get("cross_speciality_flags", []),
            "generated_at": new_output_doc["last_generated_at"],
        }
    }


# ═══════════════════════════════════════════════════════════════
# WORKFLOW (unchanged)
# ═══════════════════════════════════════════════════════════════

def create_longitudinal_summary_workflow() -> StateGraph:
    workflow = StateGraph(LongitudinalSummaryState)

    workflow.add_node("load_and_preprocess", load_and_preprocess_node)
    workflow.add_node("document_understanding_agent", document_understanding_node)
    workflow.add_node("visit_builder", visit_builder_node)
    workflow.add_node("study_visit_schedule", study_visit_schedule_node)
    workflow.add_node("baseline_builder", baseline_builder_node)
    workflow.add_node("measurement_engine", measurement_engine_node)
    workflow.add_node("treatment_timeline_agent", treatment_timeline_node)
    workflow.add_node("safety_timeline_agent", safety_timeline_node)
    workflow.add_node("ae_severity_matrix_agent", ae_severity_matrix_node)
    workflow.add_node("visit_compliance_agent", visit_compliance_node)
    workflow.add_node("dosing_compliance_agent", dosing_compliance_node)
    workflow.add_node("longitudinal_reasoning", longitudinal_reasoning_node)
    workflow.add_node("cross_speciality_reasoning", cross_speciality_reasoning_node)
    workflow.add_node("response_evaluation", response_evaluation_node)
    workflow.add_node("progression_matrix_agent", progression_matrix_node)
    workflow.add_node("cdisc_mapping_agent", cdisc_mapping_node)
    workflow.add_node("final_assembly", final_assembly_node)
    workflow.add_node("persist_state", persist_state_node)

    workflow.set_entry_point("load_and_preprocess")
    workflow.add_edge("load_and_preprocess", "document_understanding_agent")
    workflow.add_edge("document_understanding_agent", "visit_builder")
    workflow.add_edge("visit_builder", "study_visit_schedule")
    workflow.add_edge("study_visit_schedule", "baseline_builder")

    # Fan out from baseline_builder — these six are independent of each
    # other and all only need `visits` / `all_clinical_events`, so they run
    # concurrently instead of one-after-another.
    workflow.add_edge("baseline_builder", "measurement_engine")
    workflow.add_edge("baseline_builder", "treatment_timeline_agent")
    workflow.add_edge("baseline_builder", "safety_timeline_agent")
    workflow.add_edge("baseline_builder", "longitudinal_reasoning")
    workflow.add_edge("baseline_builder", "visit_compliance_agent")
    workflow.add_edge("baseline_builder", "dosing_compliance_agent")

    # ae_severity_matrix_agent is a pure reshape of safety_timeline_agent's output.
    workflow.add_edge("safety_timeline_agent", "ae_severity_matrix_agent")

    # progression_matrix reshapes measurement_engine's output against the
    # study_visit_label already attached to each visit.
    workflow.add_edge("measurement_engine", "progression_matrix_agent")

    # cross_speciality_reasoning only needs longitudinal_reasoning's output.
    workflow.add_edge("longitudinal_reasoning", "cross_speciality_reasoning")

    # response_evaluation needs measurement_engine + longitudinal_reasoning,
    # so it must wait for both branches to land.
    workflow.add_edge("measurement_engine", "response_evaluation")
    workflow.add_edge("cross_speciality_reasoning", "response_evaluation")

    # cdisc_mapping needs measurements, treatments, and care_stage, so it
    # waits on all three of those branches.
    workflow.add_edge("measurement_engine", "cdisc_mapping_agent")
    workflow.add_edge("treatment_timeline_agent", "cdisc_mapping_agent")
    workflow.add_edge("longitudinal_reasoning", "cdisc_mapping_agent")

    # final_assembly waits on every branch that contributes a section.
    workflow.add_edge("response_evaluation", "final_assembly")
    workflow.add_edge("treatment_timeline_agent", "final_assembly")
    workflow.add_edge("safety_timeline_agent", "final_assembly")
    workflow.add_edge("ae_severity_matrix_agent", "final_assembly")
    workflow.add_edge("visit_compliance_agent", "final_assembly")
    workflow.add_edge("dosing_compliance_agent", "final_assembly")
    workflow.add_edge("progression_matrix_agent", "final_assembly")
    workflow.add_edge("cdisc_mapping_agent", "final_assembly")

    workflow.add_edge("final_assembly", "persist_state")
    workflow.add_edge("persist_state", END)

    return workflow.compile()


_longitudinal_summary_workflow = create_longitudinal_summary_workflow()


async def run_longitudinal_summary(patient_id: str, doctor_id: str, force_refresh: bool = False) -> dict:
    initial_state: LongitudinalSummaryState = {
        "patient_id": patient_id,
        "doctor_id": doctor_id,
        "force_refresh": force_refresh,
    }
    final_state = await _longitudinal_summary_workflow.ainvoke(initial_state)

    if final_state.get("error") and not final_state.get("clinical_trial_summary"):
        raise RuntimeError(final_state["error"])

    return sanitize_for_response({
        "clinical_trial_summary": final_state.get("clinical_trial_summary", {}),
        "meta": final_state.get("meta", {}),
    })


async def get_cached_longitudinal_summary(patient_id: str) -> Optional[dict]:
    return await longitudinal_summary_collection.find_one({"patient_id": patient_id})


# ═══════════════════════════════════════════════════════════════
# FASTAPI ROUTER (unchanged)
# ═══════════════════════════════════════════════════════════════

router = APIRouter(
    prefix="/longitudinal_summary",
    tags=["Longitudinal Clinical Summary"],
)


class LongitudinalSummaryRequest(BaseModel):
    doctor_id: str
    force_refresh: bool = Field(
        default=False,
        description="Bypass cached output and rerun the full pipeline.",
    )


class LongitudinalSummaryResponse(BaseModel):
    patient_id: str
    clinical_trial_summary: dict
    meta: dict


@router.post("/speciality/{patient_id}", response_model=LongitudinalSummaryResponse)
async def get_longitudinal_summary(patient_id: str, payload: LongitudinalSummaryRequest):
    try:
        result = await run_longitudinal_summary(
            patient_id=patient_id,
            doctor_id=payload.doctor_id,
            force_refresh=payload.force_refresh,
        )
        return LongitudinalSummaryResponse(
            patient_id=patient_id,
            clinical_trial_summary=result["clinical_trial_summary"],
            meta=result["meta"],
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:  # noqa: BLE001
        logger.exception(f"Longitudinal summary generation failed for patient_id={patient_id}")
        raise HTTPException(status_code=500, detail=f"Longitudinal summary generation failed: {e}")


@router.get("/{patient_id}/status")
async def get_longitudinal_summary_status(patient_id: str):
    state = await get_cached_longitudinal_summary(patient_id)
    if state is None:
        return {"patient_id": patient_id, "cached": False}
    return {
        "patient_id": patient_id,
        "cached": True,
        "last_generated_at": state.get("last_generated_at"),
        "documents_analyzed": state.get("documents_analyzed", 0),
        "current_stage": state.get("longitudinal_state", {}).get("care_stage"),
        "visit_count": len(state.get("visits", [])),
        "measurements_tracked": list(state.get("measurement_timelines", {}).keys()),
    }