"""
Oncology Case View Service
---------------------------
Builds the longitudinal, visit-based JSON payload that drives the doctor
facing case view. Designed to be disease-agnostic: nothing in this file
hardcodes a metric name, cancer type, or treatment modality. All clinical
vocabulary (which biomarkers matter, which treatment types exist, which
direction is "favorable" for a given metric) comes from the LLM extraction
step; Python only does generic merging, diffing, and hashing.

ARCHITECTURE (per-document, incremental -- not a batch rebuild):

    process_mongo_document()
        |
        v
    document_text, document_date, file_name, document_id   (ONE document)
        |
        v
    generate_longitudinal_case_view()
        |
        +--> extract_longitudinal_document()   LLM, once, on THIS document only
        |       -> primary_category, secondary_categories, document_type,
        |          fields_by_category, visit_snapshot, summary
        |
        |       visit_snapshot is itself LLM-generated and generic:
        |       { "disease_metrics": {"PSA": {"value":12,"unit":"ng/mL",
        |         "favorable_direction":"down"}}, "laboratory_metrics": {...},
        |         "imaging_metrics": {...}, "performance_metrics": {...},
        |         "treatment_metrics": {...} }
        |       The LLM decides section names, metric names, units, AND
        |       which direction is clinically favorable per metric -- so
        |       the same code path works for PSA, Gleason, M-protein,
        |       Blast %, Karnofsky, or anything else, with zero code changes.
        |
        +--> load_patient_appointments()       deterministic
        +--> determine_visit()                 deterministic (ported from timeline_builder)
        |
        +--> load existing longitudinal_case_view record (persisted state)
        |
        +--> merge this document's fields + visit_snapshot into the ONE
        |    visit it belongs to (generic dict merge, no metric-name logic)
        |
        +--> recompute visit statuses (Completed / Preparing)
        |
        +--> generate_visit_summary()          LLM, only for a visit whose
        |                                       CONTENT changed since it was
        |                                       last summarized
        |
        +--> compute_numeric_trends()          deterministic diff between
        |                                       previous/current visit_snapshot,
        |                                       iterating whatever sections/
        |                                       metrics are present -- no
        |                                       hardcoded metric list
        +--> generate_longitudinal_narrative()  LLM, ONLY writes the prose
        |                                       overall_ai_assessment -- never
        |                                       recomputes the numbers
        |
        v
    upsert longitudinal_case_view

Nothing here re-reads or re-classifies the whole `processed_documents`
collection on every call -- each document is classified by the LLM
exactly once, at the moment `process_mongo_document()` calls this
function. All continuity comes from the persisted `longitudinal_case_view`
record.

The visit-boundary logic (`determine_visit`) is ported directly from
`timeline_builder._determine_visit` / `_get_patient_appointments`, and
stays deterministic (no LLM) -- appointment scheduling is genuinely
disease-agnostic, unlike clinical metrics, so hardcoding that logic is fine.

Exposes:
  - generate_longitudinal_case_view(patient_id, doctor_id, document_text,
        document_date, file_name, document_id) -> dict
      Core async function. Call directly (awaited) from
      process_mongo_document(), once per newly processed document.

  - rebuild_longitudinal_case_view_from_history(patient_id, doctor_id)
      OPTIONAL backfill utility. Not part of the normal per-upload path.

  - POST /internal/case-view/generate
      HTTP wrapper around generate_longitudinal_case_view.

  - GET /api/patients/{patient_id}/case-view
      What the frontend fetches to render the page.
"""

import os
import json
import hashlib
from datetime import datetime, date
from typing import Optional, List, Dict, Any, Union

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorClient
from groq import Groq
from loguru import logger

# ------------------- CONFIG -------------------
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = os.getenv("MONGO_DB")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

_client = AsyncIOMotorClient(MONGO_URI)
_db = _client[MONGO_DB]

processed_documents = _db.processed_documents               # only used by the optional backfill utility
patient_appointments = _db.patient_appointments              # same collection timeline_builder reads
patients_collection = _db.patients                            # TODO: adjust if patient demographics live elsewhere
longitudinal_case_view = _db.longitudinal_case_view            # persisted state, one doc per (patient, doctor)

groq_client = Groq(api_key=GROQ_API_KEY)
GROQ_MODEL = "llama-3.3-70b-versatile"

router = APIRouter()


# ------------------- REQUEST / RESPONSE MODELS -------------------

class GenerateCaseViewRequest(BaseModel):
    patient_id: str
    doctor_id: str
    document_text: str
    document_date: Optional[str] = None
    file_name: Optional[str] = None
    document_id: str


class CaseViewResponse(BaseModel):
    patient_id: str
    doctor_id: str
    generated_at: str
    data: Dict[str, Any]


# =====================================================================
# STEP 0 - DATE PARSING
# =====================================================================
def _parse_date(value: Optional[Union[str, date, datetime]]) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value).date()
        except Exception:  # noqa: BLE001
            logger.warning(f"Could not parse date string: {value!r}")
            return None
    return None


# =====================================================================
# STEP 1 - LOAD APPOINTMENTS
# =====================================================================
async def load_patient_appointments(patient_id: str) -> List[dict]:
    """Ported from timeline_builder._get_patient_appointments."""
    patient_doc = await patient_appointments.find_one({"sys_user_id": patient_id})
    if not patient_doc:
        return []

    raw_appointments = patient_doc.get("appointments") or []

    def sort_key(a: dict):
        d = _parse_date(a.get("date"))
        return d or date.min

    return sorted(raw_appointments, key=sort_key)


# =====================================================================
# STEP 2 - DETERMINE VISIT FOR A GIVEN DOCUMENT DATE
# =====================================================================
def determine_visit(document_date: Optional[str], appointments: List[dict]) -> Dict:
    """Direct port of timeline_builder._determine_visit. Appointment-date
    bucketing is genuinely disease-agnostic, so this stays deterministic
    and unchanged regardless of cancer type."""
    doc_dt = _parse_date(document_date)

    if not appointments or doc_dt is None:
        logger.warning(
            f"No appointment schedule / document_date available; "
            f"defaulting document_date={document_date!r} to visit 1."
        )
        return {
            "appointment_id": None,
            "visit_number": 1,
            "appointment_date": None,
            "visit_start_date": None,
            "visit_end_date": None,
        }

    parsed_dates = [_parse_date(a.get("date")) for a in appointments]

    chosen_index = len(appointments) - 1
    for i, appt_date in enumerate(parsed_dates):
        if appt_date is None:
            continue

        next_date = parsed_dates[i + 1] if i + 1 < len(parsed_dates) else None

        if i == 0 and doc_dt < appt_date:
            chosen_index = 0
            break

        if doc_dt >= appt_date and (next_date is None or doc_dt < next_date):
            chosen_index = i
            break

    chosen_appt = appointments[chosen_index]
    visit_start = parsed_dates[chosen_index]
    visit_end = parsed_dates[chosen_index + 1] if chosen_index + 1 < len(parsed_dates) else None

    return {
        "appointment_id": chosen_appt.get("appointment_id"),
        "visit_number": chosen_index + 1,
        "appointment_date": visit_start.isoformat() if visit_start else None,
        "visit_start_date": visit_start.isoformat() if visit_start else None,
        "visit_end_date": visit_end.isoformat() if visit_end else None,
    }


# =====================================================================
# STEP 3 - EXTRACT STRUCTURED DATA FROM ONE DOCUMENT (LLM, called once)
# =====================================================================
# Called exactly ONCE per document, because generate_longitudinal_case_view()
# is itself only called once per document (from process_mongo_document).
# No caching layer needed.
#
# VISIT_BUCKETS is a taxonomy of DOCUMENT TYPES (what kind of report this
# is), not clinical metrics -- "laboratory", "imaging", "pathology" etc.
# apply identically whether the patient has lung cancer or multiple
# myeloma, so this list is safe to keep fixed. Note "treatment_chemo" /
# "treatment_radiation" were REMOVED and replaced with a single generic
# "treatment" bucket -- chemo/radiation-only buckets would have silently
# excluded surgery, immunotherapy, hormone therapy, stem-cell transplant,
# CAR-T, etc. The LLM now names the modality itself inside "fields".
VISIT_BUCKETS = [
    "consultation",   # doctor's visit note                    -> visit["consultation"]
    "vitals",          # height/weight/BP/ECOG etc                -> visit["vitals"]
    "orders",           # tests/procedures ordered                   -> visit["orders"]
    "laboratory",        # any lab panel (CBC, LFT, M-protein, etc.)    -> visit["uploaded_between_visits"]["laboratory"]
    "imaging",             # CT/PET/MRI/X-ray/ultrasound/bone scan          -> visit["uploaded_between_visits"]["imaging"]
    "pathology",             # biopsy/histopath/cytopath/Gleason/marrow          -> visit["uploaded_between_visits"]["pathology"]
    "molecular",               # NGS/cytogenetics/genomic/MRD testing                -> visit["uploaded_between_visits"]["molecular"]
    "tumor_markers",             # any disease-specific marker (CEA/PSA/CA125/etc)       -> visit["uploaded_between_visits"]["tumor_markers"]
    "treatment",                   # ANY treatment/therapy record, any modality              -> visit["treatment"][modality]
    "adverse_event",                 # toxicity/CTCAE/side-effect note                            -> visit["adverse_events"]
    "other",                           # doesn't fit any bucket above                                 -> ignored
]

DOCUMENT_EXTRACTION_PROMPT_TEMPLATE = """You are generating structured data for a disease-agnostic oncology
longitudinal engine. This system is used across ALL cancer types (solid
tumors, hematologic malignancies, everything) -- do not assume any
specific cancer type. Your classification determines exactly where this
document's content gets merged into the patient's visit record.

Valid categories (use only these): {buckets}

Read the document below and:
1. Choose ONE "primary_category" -- the category that best describes what
   this document fundamentally is.
2. Optionally choose "secondary_categories" -- other categories this SAME
   document also contains clinically relevant content for (e.g. a
   consultation note that also records vitals and orders a treatment
   cycle). Leave empty if the document only covers its primary category.
3. Give a short human-readable "document_type" label (e.g. "PET CT Report",
   "Oncology Consultation Note", "Bone Marrow Biopsy Report").
4. For EACH category you listed (primary + secondary), extract its
   relevant content into "fields_by_category", keyed by that category
   name. Use clinically conventional nested keys within each category's
   fields (e.g. "laboratory": {{"cbc": {{"hb": 12.4, "wbc": 6900}}}}).
5. "consultation" fields should capture chief_complaints,
   clinical_assessment, diagnosis, doctor_plan, and -- if stated or
   implied -- "vital_status": "alive" or "vital_status": "deceased".
6. "vitals" fields should map directly to height/weight/bmi/bp/pulse/
   temperature/spo2/ecog where present.
7. "orders" fields should be {{"orders": ["...", "..."]}}.
8. "treatment" fields MUST include a "modality" field naming the
   treatment type in your own words based on what the document says (e.g.
   "chemotherapy", "radiation", "surgery", "immunotherapy",
   "hormone_therapy", "targeted_therapy", "stem_cell_transplant",
   "car_t_therapy", or anything else) -- do not force it into a fixed
   list. Include whatever details are given (cycle number, dose,
   fractions, date, regimen name, response, etc.).
9. Use only information explicitly present in the document -- never
   invent values, dates, or fields. Omit a category from
   fields_by_category entirely if it has nothing to contribute.
10. Additionally extract a "visit_snapshot" of any QUANTIFIABLE clinical
    metrics this document reports -- biomarkers, tumor/disease
    measurements, lab values, performance-status scores, treatment
    doses/cycles, or anything else clinically relevant for tracking this
    specific patient over time, REGARDLESS of cancer type. Group them
    under these five generic sections (omit a section entirely if this
    document has nothing for it):
      - "disease_metrics": disease-specific markers (e.g. PSA, CEA,
        M-protein, Blast %, tumor size -- whatever applies to THIS patient)
      - "laboratory_metrics": routine labs (e.g. Hemoglobin, ANC,
        Platelets, Creatinine)
      - "imaging_metrics": measurements from imaging (e.g. lesion size, SUV)
      - "performance_metrics": functional status (e.g. ECOG, Karnofsky, weight)
      - "treatment_metrics": dose, cycle number, fractions delivered
    Each metric must be an object:
      {{"value": <number>, "unit": "<string or null>",
        "favorable_direction": "down" | "up" | "neutral"}}
    where "favorable_direction" is YOUR clinical judgement of whether a
    DECREASE, INCREASE, or neither is favorable for that specific metric
    (e.g. "down" for CEA, "up" for Hemoglobin, "down" for ECOG). This is
    what lets the numeric-trend comparison work generically for any
    metric without any hardcoded list on the backend. Omit "visit_snapshot"
    (or any section/metric within it) if nothing quantifiable is present.
11. "summary" is ONE short clinical sentence describing what this specific
    document says (for an audit trail) -- not a comparison to anything else.
12. Return ONLY valid JSON in exactly this shape, no commentary, no
    markdown fences:

{{
  "primary_category": "...",
  "secondary_categories": ["..."],
  "document_type": "...",
  "fields_by_category": {{ "category_name": {{...}} }},
  "visit_snapshot": {{
    "disease_metrics": {{ "Metric Name": {{"value": 0, "unit": null, "favorable_direction": "down"}} }},
    "laboratory_metrics": {{}},
    "imaging_metrics": {{}},
    "performance_metrics": {{}},
    "treatment_metrics": {{}}
  }},
  "summary": "..."
}}

=== FILE NAME ===
{file_name}

=== DOCUMENT TEXT ===
{document_text}
"""


async def extract_longitudinal_document(document_text: str, file_name: str) -> Dict[str, Any]:
    prompt = DOCUMENT_EXTRACTION_PROMPT_TEMPLATE.format(
        buckets=", ".join(VISIT_BUCKETS),
        file_name=file_name or "unknown",
        document_text=(document_text or "")[:12000],
    )

    completion = groq_client.chat.completions.create(
        model=GROQ_MODEL,
        temperature=0.0,
        max_tokens=2000,
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": prompt}],
    )
    raw = completion.choices[0].message.content

    try:
        result = json.loads(raw)
    except json.JSONDecodeError as e:
        logger.error(f"Document extraction JSON parse failed for {file_name}: {e} | raw={raw[:500]}")
        return {
            "primary_category": "other",
            "secondary_categories": [],
            "document_type": None,
            "fields_by_category": {},
            "visit_snapshot": {},
            "summary": None,
        }

    if result.get("primary_category") not in VISIT_BUCKETS:
        logger.warning(
            f"LLM returned unknown primary_category {result.get('primary_category')!r} "
            f"for {file_name}; treating as 'other'"
        )
        result["primary_category"] = "other"

    result["secondary_categories"] = [
        c for c in (result.get("secondary_categories") or []) if c in VISIT_BUCKETS
    ]
    result.setdefault("document_type", None)
    result.setdefault("fields_by_category", {})
    result.setdefault("visit_snapshot", {})
    result.setdefault("summary", None)
    return result


# =====================================================================
# STEP 4 - VISIT SKELETON + MERGE (deterministic, no LLM, no disease logic)
# =====================================================================
def _new_visit_skeleton(visit_info: dict) -> dict:
    vnum = visit_info["visit_number"]
    return {
        "visit_id": f"VISIT{vnum:03d}",
        "visit_number": vnum,
        "status": "Preparing",  # corrected by _recompute_visit_statuses()
        "appointment": {
            "appointment_id": visit_info["appointment_id"],
            "appointment_date": visit_info["appointment_date"],
            "visit_start_date": visit_info["visit_start_date"],
            "visit_end_date": visit_info["visit_end_date"],
        },
        "consultation": None,
        "vitals": None,
        "orders": [],
        "uploaded_between_visits": {
            "laboratory": {},
            "imaging": {},
            "pathology": {},
            "molecular": {},
            "tumor_markers": {},
        },
        "treatment": {},           # keyed by modality string chosen by the LLM, e.g. treatment["chemotherapy"]
        "adverse_events": [],
        "visit_snapshot": {},      # sections/metrics entirely as named by the LLM -- no fixed schema here
        "visit_summary": None,
        "documents": [],           # lightweight audit trail: which docs fed this visit
        "_document_ids": [],       # used for idempotency (has this document already been merged?)
    }


def _apply_fields_to_bucket(visit: dict, category: str, fields: dict) -> None:
    """Routes one category's extracted fields into the right visit field.
    Dedupes list-valued buckets (orders, adverse_events) so re-processing
    or overlapping documents don't create duplicate entries."""
    if not fields:
        return

    if category == "consultation":
        visit["consultation"] = {**(visit["consultation"] or {}), **fields}
    elif category == "vitals":
        visit["vitals"] = {**(visit["vitals"] or {}), **fields}
    elif category == "orders":
        for order in fields.get("orders", []) or []:
            if order not in visit["orders"]:
                visit["orders"].append(order)
    elif category in ("laboratory", "imaging", "pathology", "molecular", "tumor_markers"):
        visit["uploaded_between_visits"][category].update(fields)
    elif category == "treatment":
        # Generic across every modality -- surgery, chemo, radiation,
        # immunotherapy, transplant, CAR-T, hormone therapy, anything.
        # The LLM names the modality; Python never hardcodes which ones exist.
        modality = fields.get("modality") or "unspecified"
        modality_fields = {k: v for k, v in fields.items() if k != "modality"}
        visit["treatment"][modality] = {**visit["treatment"].get(modality, {}), **modality_fields}
    elif category == "adverse_event":
        if fields not in visit["adverse_events"]:
            visit["adverse_events"].append(fields)
    else:
        logger.debug(f"category={category!r} not merged into any visit field")


def _merge_snapshot_into_visit(visit: dict, snapshot: dict) -> None:
    """Merges a document's LLM-extracted visit_snapshot into the visit's
    cumulative snapshot. Fully generic: section names and metric names
    come entirely from the LLM, so this works for any cancer type,
    biomarker, or clinical scale without any code changes."""
    if not snapshot:
        return
    visit.setdefault("visit_snapshot", {})
    for section, metrics in snapshot.items():
        if not isinstance(metrics, dict):
            continue
        visit["visit_snapshot"].setdefault(section, {})
        visit["visit_snapshot"][section].update(metrics)


def _merge_document_into_visit(
    visit: dict,
    extraction: dict,
    document_id: str,
    file_name: Optional[str],
    document_date: Optional[str],
) -> None:
    """Folds ONE document's extraction result into the given visit, in place."""
    fields_by_category = extraction.get("fields_by_category") or {}
    categories = [extraction.get("primary_category")] + list(extraction.get("secondary_categories") or [])

    for category in categories:
        _apply_fields_to_bucket(visit, category, fields_by_category.get(category) or {})

    _merge_snapshot_into_visit(visit, extraction.get("visit_snapshot") or {})

    visit["_document_ids"].append(document_id)
    visit["documents"].append({
        "document_id": document_id,
        "file_name": file_name,
        "document_date": document_date,
        "document_type": extraction.get("document_type"),
        "primary_category": extraction.get("primary_category"),
        "secondary_categories": extraction.get("secondary_categories") or [],
        "summary": extraction.get("summary"),
    })


def _recompute_visit_statuses(visits_by_number: Dict[int, dict]) -> None:
    """The highest visit_number seen so far is the current/active one
    ("Preparing"); every visit before it is "Completed"."""
    if not visits_by_number:
        return
    latest = max(visits_by_number.keys())
    for vnum, visit in visits_by_number.items():
        visit["status"] = "Preparing" if vnum == latest else "Completed"


def _hash_visit_content(visit: dict) -> str:
    """Hashes the CONTENT of a visit (not just which document_ids touched
    it), so any change to consultation/vitals/treatment/adverse_events --
    however it got there -- triggers a visit_summary regeneration."""
    payload = {
        k: v for k, v in visit.items()
        if k not in ("visit_summary", "_document_hash", "_document_ids", "visit_snapshot", "status", "documents")
    }
    return hashlib.sha256(json.dumps(payload, default=str, sort_keys=True).encode("utf-8")).hexdigest()


# =====================================================================
# STEP 5 - VISIT SUMMARY (LLM, only when a visit's content actually changed)
# =====================================================================
VISIT_SUMMARY_SCHEMA = """
{
  "clinical_snapshot": {},
  "investigation_summary": {},
  "treatment_summary": {},
  "safety_summary": {},
  "overall_visit_summary": "string"
}
"""

VISIT_SUMMARY_PROMPT_TEMPLATE = """You are a clinical data synthesis engine.

Summarize ONLY the single visit given below. Do NOT compare it to any
other visit and do NOT reference prior or future visits. Do not assume
any specific cancer type -- describe whatever this visit's data actually
shows.

RULES:
1. Use only information explicitly present in the visit data below.
2. Do not fabricate stage, grade, marker values, or dates.
3. If a field cannot be populated, set it to null or omit it -- do not
   invent placeholder values.
4. Return ONLY valid JSON matching the schema. No commentary, no markdown fences.

=== JSON SCHEMA ===
{schema}

=== VISIT DATA ===
{visit_json}
"""


async def generate_visit_summary(visit: dict) -> Dict[str, Any]:
    """LLM call producing the structured visit_summary. Only meant to be
    called for visits with status == "Completed" whose content changed
    since the last summary (enforced by the orchestrator)."""
    visit_payload = {
        k: v for k, v in visit.items()
        if k not in ("visit_summary", "_document_ids", "_document_hash")
    }
    prompt = VISIT_SUMMARY_PROMPT_TEMPLATE.format(
        schema=VISIT_SUMMARY_SCHEMA,
        visit_json=json.dumps(visit_payload, default=str, indent=2)[:16000],
    )

    completion = groq_client.chat.completions.create(
        model=GROQ_MODEL,
        temperature=0.0,
        max_tokens=2000,
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": prompt}],
    )
    raw = completion.choices[0].message.content

    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        logger.error(f"Visit summary JSON parse failed for {visit.get('visit_id')}: {e} | raw={raw[:500]}")
        raise


# =====================================================================
# STEP 6 - LONGITUDINAL TRENDS (deterministic, no LLM, no hardcoded metrics)
# + NARRATIVE (LLM, prose only)
# =====================================================================
def _metric_value(entry: Any) -> Any:
    return entry.get("value") if isinstance(entry, dict) else entry


def _metric_unit(entry: Any) -> Any:
    return entry.get("unit") if isinstance(entry, dict) else None


def _metric_favorable_direction(entry: Any) -> Optional[str]:
    return entry.get("favorable_direction") if isinstance(entry, dict) else None


def _compute_delta(old: Any, new: Any, favorable_direction: Optional[str] = None) -> Dict[str, Any]:
    """favorable_direction ('down' / 'up' / None) comes from the LLM's own
    per-metric annotation at extraction time -- Python never assumes which
    direction is clinically favorable for any given metric."""
    result: Dict[str, Any] = {"previous": old, "current": new}
    if isinstance(old, (int, float)) and isinstance(new, (int, float)):
        change = round(new - old, 3)
        result["change"] = change
        result["percentage_change"] = round((change / old) * 100, 1) if old else None
        if favorable_direction == "down":
            result["trend"] = "Improving" if change < 0 else "Worsening" if change > 0 else "Stable"
        elif favorable_direction == "up":
            result["trend"] = "Improving" if change > 0 else "Worsening" if change < 0 else "Stable"
        else:
            result["trend"] = "Increasing" if change > 0 else "Decreasing" if change < 0 else "Stable"
    return result


def compute_numeric_trends(previous_visit: dict, current_visit: dict) -> Dict[str, Any]:
    """Deterministic visit-to-visit comparison, computed entirely in
    Python from each visit's visit_snapshot -- but with ZERO hardcoded
    metric names. It iterates whatever sections/metrics the LLM put in
    each visit's snapshot, and only compares a metric if it's present at
    BOTH visits. Works identically for PSA, CEA, M-protein, Blast %,
    Karnofsky, or any future metric -- no code changes required."""
    prev_snap = previous_visit.get("visit_snapshot") or {}
    curr_snap = current_visit.get("visit_snapshot") or {}

    metric_changes: Dict[str, List[Dict[str, Any]]] = {}
    for section in set(prev_snap.keys()) | set(curr_snap.keys()):
        prev_section = prev_snap.get(section) or {}
        curr_section = curr_snap.get(section) or {}
        if not isinstance(prev_section, dict) or not isinstance(curr_section, dict):
            continue

        for metric_name in set(prev_section.keys()) & set(curr_section.keys()):
            prev_entry = prev_section[metric_name]
            curr_entry = curr_section[metric_name]
            favorable = _metric_favorable_direction(curr_entry) or _metric_favorable_direction(prev_entry)
            delta = _compute_delta(_metric_value(prev_entry), _metric_value(curr_entry), favorable_direction=favorable)
            metric_changes.setdefault(section, []).append({
                "name": metric_name,
                "unit": _metric_unit(curr_entry) or _metric_unit(prev_entry),
                **delta,
            })

    prev_ae_signatures = {json.dumps(a, sort_keys=True, default=str) for a in (previous_visit.get("adverse_events") or [])}
    new_ae = [
        a for a in (current_visit.get("adverse_events") or [])
        if json.dumps(a, sort_keys=True, default=str) not in prev_ae_signatures
    ]

    prev_treatment = previous_visit.get("treatment") or {}
    curr_treatment = current_visit.get("treatment") or {}

    # Vital status now comes from an explicit LLM-extracted field
    # (consultation.vital_status), not a keyword search over free text.
    vital_status = (current_visit.get("consultation") or {}).get("vital_status")
    alive = not (isinstance(vital_status, str) and vital_status.strip().lower() == "deceased")

    return {
        "metric_changes": metric_changes,   # {section_name: [{name, unit, previous, current, change, percentage_change, trend}, ...]}
        "safety": {"new_adverse_events": new_ae},
        "treatment_modifications": {
            "changed": prev_treatment != curr_treatment,
            "current_treatment": curr_treatment or None,
        },
        "survival": {"alive": alive},
    }


def _compute_overall_trends(completed_visits: List[dict]) -> Dict[str, Dict[str, List[Any]]]:
    """Time series of EVERY metric that appears anywhere in any completed
    visit's snapshot, grouped by whatever sections the LLM chose. Fully
    generic -- no metric names are hardcoded, so this works for any
    cancer type or document set without code changes."""
    series: Dict[str, Dict[str, List[Any]]] = {}
    seen_keys: List[tuple] = []
    seen = set()
    for v in completed_visits:
        for section, metrics in (v.get("visit_snapshot") or {}).items():
            if not isinstance(metrics, dict):
                continue
            for metric_name in metrics:
                key = (section, metric_name)
                if key not in seen:
                    seen.add(key)
                    seen_keys.append(key)

    for section, metric_name in seen_keys:
        series.setdefault(section, {})[metric_name] = [
            _metric_value((v.get("visit_snapshot") or {}).get(section, {}).get(metric_name))
            for v in completed_visits
        ]
    return series


LONGITUDINAL_NARRATIVE_PROMPT_TEMPLATE = """You are a clinical data synthesis engine writing a brief narrative
comparing two consecutive oncology visits for the same patient. Do not
assume any specific cancer type -- describe whatever the data actually shows.

The trends below (metric changes, safety, treatment changes) have ALREADY
been computed deterministically -- do NOT recompute or contradict them.
Your only job is to write ONE short, doctor-facing paragraph (2-4
sentences) synthesizing what they mean together, in plain clinical language.

RULES:
1. Base the narrative only on the visit summaries and computed trends given.
2. Do not invent values not present below.
3. Return ONLY valid JSON: {{"overall_ai_assessment": "string"}}. No
   commentary, no markdown fences.

=== PREVIOUS VISIT SUMMARY (visit {previous_visit_number}) ===
{previous_summary_json}

=== CURRENT VISIT SUMMARY (visit {current_visit_number}) ===
{current_summary_json}

=== COMPUTED TRENDS (ground truth -- do not recompute) ===
{trends_json}
"""


async def generate_longitudinal_narrative(
    previous_visit_summary: dict,
    current_visit_summary: dict,
    trends: dict,
    previous_visit_number: int,
    current_visit_number: int,
) -> Optional[str]:
    prompt = LONGITUDINAL_NARRATIVE_PROMPT_TEMPLATE.format(
        previous_visit_number=previous_visit_number,
        current_visit_number=current_visit_number,
        previous_summary_json=json.dumps(previous_visit_summary, default=str, indent=2)[:6000],
        current_summary_json=json.dumps(current_visit_summary, default=str, indent=2)[:6000],
        trends_json=json.dumps(trends, default=str, indent=2)[:4000],
    )

    completion = groq_client.chat.completions.create(
        model=GROQ_MODEL,
        temperature=0.0,
        max_tokens=400,
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": prompt}],
    )
    raw = completion.choices[0].message.content

    try:
        return json.loads(raw).get("overall_ai_assessment")
    except json.JSONDecodeError as e:
        logger.error(f"Longitudinal narrative JSON parse failed: {e} | raw={raw[:500]}")
        return None


# =====================================================================
# STEP 7 - PATIENT INFORMATION
# =====================================================================
async def load_patient_information(patient_id: str) -> Dict[str, Any]:
    """TODO: adjust to wherever patient demographics/baseline diagnosis
    actually live in your system. Falls back to {} so the pipeline never
    hard-fails."""
    patient_doc = await patients_collection.find_one({"patient_id": patient_id})
    if not patient_doc:
        logger.warning(f"No patient_information found for patient_id={patient_id}")
        return {}
    patient_doc.pop("_id", None)
    return patient_doc


# =====================================================================
# STEP 8 - ASSEMBLE FRONTEND JSON
# =====================================================================
def build_frontend_json(
    patient_id: str,
    doctor_id: str,
    patient_information: Dict[str, Any],
    visits_by_number: Dict[int, dict],
    longitudinal_summary: Optional[dict],
) -> Dict[str, Any]:
    ordered_visits = [visits_by_number[n] for n in sorted(visits_by_number.keys())]
    current_active_visit = ordered_visits[-1]["visit_number"] if ordered_visits else None

    clean_visits = [
        {k: v for k, v in visit.items() if k not in ("_document_ids", "_document_hash")}
        for visit in ordered_visits
    ]

    return {
        "doctor_id": doctor_id,
        "patient_id": patient_id,
        "patient_information": patient_information,
        "current_active_visit": current_active_visit,
        "visits": clean_visits,
        "longitudinal_summary": longitudinal_summary or {},
    }


# =====================================================================
# MAIN ENTRY POINT -- call this once per newly processed document
# =====================================================================
async def generate_longitudinal_case_view(
    patient_id: str,
    doctor_id: str,
    document_text: str,
    document_date: Optional[str],
    file_name: Optional[str],
    document_id: str,
) -> Dict[str, Any]:
    """
    Incrementally folds ONE newly processed document into the patient's
    persisted longitudinal case view. Call this from process_mongo_document(),
    once per document -- not as a periodic full rebuild.
    """
    existing_record = await longitudinal_case_view.find_one(
        {"patient_id": patient_id, "doctor_id": doctor_id}
    )
    existing_data = (existing_record or {}).get("data", {})

    visits_by_number: Dict[int, dict] = {}
    for v in existing_data.get("visits", []):
        v.setdefault("_document_ids", [d.get("document_id") for d in v.get("documents", [])])
        visits_by_number[v["visit_number"]] = v

    already_seen = {doc_id for v in visits_by_number.values() for doc_id in v.get("_document_ids", [])}
    if document_id in already_seen:
        logger.info(f"document_id={document_id} already merged into longitudinal_case_view; skipping.")
        return existing_record or {}

    extraction = await extract_longitudinal_document(document_text, file_name)

    appointments = await load_patient_appointments(patient_id)
    visit_info = determine_visit(document_date, appointments)
    vnum = visit_info["visit_number"]

    visit = visits_by_number.setdefault(vnum, _new_visit_skeleton(visit_info))
    visit["appointment"] = {
        "appointment_id": visit_info["appointment_id"],
        "appointment_date": visit_info["appointment_date"],
        "visit_start_date": visit_info["visit_start_date"],
        "visit_end_date": visit_info["visit_end_date"],
    }
    _merge_document_into_visit(
        visit=visit,
        extraction=extraction,
        document_id=document_id,
        file_name=file_name,
        document_date=document_date,
    )

    _recompute_visit_statuses(visits_by_number)

    for v in visits_by_number.values():
        if v["status"] != "Completed":
            continue  # Preparing visit -> visit_summary stays null

        current_hash = _hash_visit_content(v)
        if v.get("visit_summary") and v.get("_document_hash") == current_hash:
            continue  # nothing changed since it was last summarized

        v["visit_summary"] = await generate_visit_summary(v)
        v["_document_hash"] = current_hash

    completed_visits = sorted(
        (v for v in visits_by_number.values() if v["status"] == "Completed"),
        key=lambda v: v["visit_number"],
    )
    latest_completed = completed_visits[-1]["visit_number"] if completed_visits else None

    longitudinal_summary = existing_data.get("longitudinal_summary")
    previously_latest_completed = (longitudinal_summary or {}).get("latest_completed_visit")

    if latest_completed and latest_completed != previously_latest_completed and len(completed_visits) >= 2:
        previous_visit = completed_visits[-2]
        current_visit = completed_visits[-1]

        trends = compute_numeric_trends(previous_visit, current_visit)
        narrative = await generate_longitudinal_narrative(
            previous_visit["visit_summary"],
            current_visit["visit_summary"],
            trends,
            previous_visit["visit_number"],
            current_visit["visit_number"],
        )
        comparison = {**trends, "overall_ai_assessment": narrative}

        history = list((longitudinal_summary or {}).get("history", []))
        history.append({
            "previous_visit": previous_visit["visit_number"],
            "current_visit": current_visit["visit_number"],
            "comparison": comparison,
        })

        longitudinal_summary = {
            "latest_completed_visit": latest_completed,
            "comparison": comparison,
            "history": history,
            "overall_trends": _compute_overall_trends(completed_visits),
        }
    elif latest_completed and not longitudinal_summary and len(completed_visits) < 2:
        longitudinal_summary = {
            "latest_completed_visit": latest_completed,
            "comparison": {},
            "history": [],
            "overall_trends": _compute_overall_trends(completed_visits),
        }
    elif longitudinal_summary and latest_completed:
        longitudinal_summary["overall_trends"] = _compute_overall_trends(completed_visits)

    patient_information = await load_patient_information(patient_id)

    case_view_data = build_frontend_json(
        patient_id=patient_id,
        doctor_id=doctor_id,
        patient_information=patient_information,
        visits_by_number=visits_by_number,
        longitudinal_summary=longitudinal_summary,
    )

    stored_visits = [
        {k: v for k, v in visits_by_number[n].items() if k != "_document_ids"}
        for n in sorted(visits_by_number.keys())
    ]
    stored_data = {**case_view_data, "visits": stored_visits}

    record = {
        "patient_id": patient_id,
        "doctor_id": doctor_id,
        "generated_at": datetime.utcnow().isoformat(),
        "data": stored_data,
    }

    await longitudinal_case_view.update_one(
        {"patient_id": patient_id, "doctor_id": doctor_id},
        {"$set": record},
        upsert=True,
    )

    logger.info(
        f"Longitudinal case view updated for patient={patient_id} doctor={doctor_id} "
        f"document_id={document_id} -> visit_number={vnum} "
        f"({len(visits_by_number)} visits total, latest_completed={latest_completed})"
    )

    return {**record, "data": case_view_data}


# =====================================================================
# OPTIONAL BACKFILL UTILITY -- NOT part of the per-upload path
# =====================================================================
async def rebuild_longitudinal_case_view_from_history(patient_id: str, doctor_id: str) -> Dict[str, Any]:
    """
    Replays every existing processed_documents record for a patient
    through generate_longitudinal_case_view(), in chronological order.
    Use once to backfill patients who already had documents processed
    before this incremental flow existed. Do NOT call from
    process_mongo_document().
    """
    cursor = processed_documents.find(
        {"patient_id": patient_id, "doctor_id": doctor_id}
    ).sort("metadata.document_date", 1)

    result = {}
    async for doc in cursor:
        result = await generate_longitudinal_case_view(
            patient_id=patient_id,
            doctor_id=doctor_id,
            document_text=doc.get("raw_text") or "",
            document_date=doc.get("metadata", {}).get("document_date"),
            file_name=doc.get("file_name"),
            document_id=doc.get("document_id"),
        )
    return result


# ------------------- HTTP ENDPOINTS -------------------

@router.post("/internal/case-view/generate")
async def generate_case_view_endpoint(req: GenerateCaseViewRequest):
    """HTTP entrypoint for callers running in a different process."""
    try:
        record = await generate_longitudinal_case_view(
            patient_id=req.patient_id,
            doctor_id=req.doctor_id,
            document_text=req.document_text,
            document_date=req.document_date,
            file_name=req.file_name,
            document_id=req.document_id,
        )
        if not record:
            raise HTTPException(status_code=404, detail="No data available for this patient yet")
        return record
    except Exception as e:
        logger.error(f"Case view generation failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/patients/{patient_id}/case-view", response_model=CaseViewResponse)
async def get_case_view(patient_id: str, doctor_id: str):
    """What the frontend calls to render the page."""
    record = await longitudinal_case_view.find_one({"patient_id": patient_id, "doctor_id": doctor_id})
    if not record:
        raise HTTPException(status_code=404, detail="Case view not generated yet for this patient")
    record.pop("_id", None)
    for v in record.get("data", {}).get("visits", []):
        v.pop("_document_hash", None)
    return record