"""
Oncology Case View Service — Agentic (LangGraph) Version, v4
-----------------------------------------------------------------------------
v4 addresses the ROOT CAUSE identified in review: the extraction prompt was
still asking the LLM to make a classification judgement ("is this a disease
metric, a lab metric, a performance metric...?") before it extracted
anything. That judgement is exactly where richness became disease-dependent
-- well-known cancers (breast: ER/PR/HER2/Ki67) got rich output because the
model "knew" those were important; less-standardized report styles
(esophageal narrative prose, AML cytogenetics/FLT3/NPM1, etc.) got sparse
output because nothing told the model those numbers mattered.

WHAT CHANGED VS v3
-------------------
1. THE 8-BUCKET `visit_snapshot` IS GONE.
   disease_metrics / laboratory_metrics / imaging_metrics /
   performance_metrics / treatment_metrics / symptom_metrics /
   toxicity_metrics / quality_of_life_metrics -> replaced with a single
   flat list: `clinical_measurements`. The model's ONLY job is: "extract
   every measurable number this document states, with its unit." It no
   longer decides which of 8 dictionaries something belongs in.

2. CATEGORY IS NEVER AN LLM DECISION ANYMORE.
   Every document already gets a structural classification (consultation /
   vitals / laboratory / imaging / pathology / molecular / tumor_markers /
   treatment / adverse_event / orders / other) -- that classification was
   already required to route the document into the visit record, so it's
   not new work. A measurement's display category (Laboratory, Imaging,
   Performance, ...) is now DERIVED DETERMINISTICALLY from the document
   category it came from, via one fixed structural mapping
   (_DOCUMENT_CATEGORY_TO_MEASUREMENT_CATEGORY, below). This mapping talks
   about DOCUMENT TYPES (a lab report vs an imaging report), never about
   diseases, organs, or specific metric names -- so it needs no per-cancer
   keyword list and works identically for breast, esophageal, AML, or
   anything else.

3. NO MORE KEYWORD LISTS FOR DOCUMENT CLASSIFICATION.
   v3's prompt had hard keyword lists ("biopsy, tissue, histology,
   adenocarcinoma, squamous, neoplastic, stain, slides, margin, grade...")
   to help the model tell lab vs pathology vs imaging apart. Those are
   gone. The model is simply told what each document TYPE conceptually
   *is* in one sentence and left to use its own judgement -- the same way
   a human coder would, without a memorized word list that happens to
   favor whichever cancer types the keyword list's author thought of.

4. disease_status NO LONGER ASKS THE LLM TO INFER A VERDICT.
   Previously the LLM was asked to directly output "clinical_response"
   and "overall_direction" -- an interpretive judgement call, and exactly
   the kind of thing review flagged as unreliable/inconsistent. Now the
   LLM only transcribes disease-status language EXACTLY AS WRITTEN
   ("status_statements": ["Stable disease", "Partial response", ...]) or
   returns nothing. "clinical_response" / "overall_direction" are instead
   derived deterministically downstream from standardized RECIST /
   PERCIST / Lugano response-criteria vocabulary -- terminology that is
   part of oncology response reporting across every cancer type, not a
   disease-specific keyword list -- via the same regex-matching function
   v3 already had as a "fallback" (it is now the *only* source, not a
   backstop).

5. Everything else -- the visit/delta/timeline/analytics four-layer
   architecture, the metric-name lexical-similarity matching, unit
   normalization, alert lifecycle, treatment-line grouping -- is
   UNCHANGED. Those pieces were already generic and deterministic and
   both review passes explicitly said to keep them.

GRAPH
-----
(same shape as v3; only the extraction schema and the measurement/merge
functions changed)

    load_existing_state
            |
            +--[document_id already merged]--> already_processed --> END
            |
            v
    extraction_agent              AGENT (Groq)
            |
            v
    determine_visit                deterministic
            |
            v
    merge_document                 deterministic
            |
            v
    recompute_visit_statuses       deterministic
            |
            v
    visit_summary_agent            AGENT (per changed visit)
            |
            v
    load_patient_information       I/O only
            |
            v
    find_completed_visits          deterministic
            |
            v
    compute_numeric_trends          deterministic
            |
            v
    compute_visit_delta             deterministic
            |
            v
    compute_overall_trends          deterministic
            |
            v
    compute_analytics_layers        deterministic
            |
            v
    prepare_longitudinal_summary   deterministic
            |
            +--[trends computed]--> narrative_agent (AGENT)
            |                              |
            +--[no trends]-----------------+
                                            v
                                     build_case_view    deterministic
                                            |
                                            v
                                     create_record      deterministic
                                            |
                                            v
                                     persist_case_view  I/O only
                                            |
                                            v
                                           END

Public surface is unchanged:
  - generate_longitudinal_case_view(...)
  - rebuild_longitudinal_case_view_from_history(...)
  - POST /internal/case-view/generate
  - GET  /api/patients/{patient_id}/case-view
"""

import os
import re
import json
import hashlib
import difflib
from datetime import datetime, date
from typing import Optional, List, Dict, Any, Union, TypedDict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorClient
from groq import Groq
from loguru import logger

from langgraph.graph import StateGraph, END

# ------------------- CONFIG -------------------
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = os.getenv("MONGO_DB")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

_client = AsyncIOMotorClient(MONGO_URI)
_db = _client[MONGO_DB]

processed_documents = _db.processed_documents
patient_appointments = _db.patient_appointments
patient_user_collection = _db.patient_users
longitudinal_case_view = _db.longitudinal_case_view

groq_client = Groq(api_key=GROQ_API_KEY)
GROQ_MODEL = "llama-3.3-70b-versatile"

router = APIRouter()


# ------------------- REQUEST / RESPONSE MODELS -------------------

class GenerateCaseViewRequest(BaseModel):
    patient_id: str
    doctor_id: Optional[str] = None
    document_text: str
    document_date: Optional[str] = None
    file_name: Optional[str] = None
    document_id: str


class CaseViewResponse(BaseModel):
    patient_id: str
    doctor_id: Optional[str] = None
    generated_at: str
    data: Dict[str, Any]


# =====================================================================
# DATE PARSING (unchanged, deterministic)
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
# LOAD APPOINTMENTS (unchanged, deterministic)
# =====================================================================
async def load_patient_appointments(patient_id: str) -> List[dict]:
    patient_doc = await patient_appointments.find_one({"sys_user_id": patient_id})
    if not patient_doc:
        return []

    raw_appointments = patient_doc.get("appointments") or []

    def sort_key(a: dict):
        d = _parse_date(a.get("date"))
        return d or date.min

    return sorted(raw_appointments, key=sort_key)


# =====================================================================
# DETERMINE VISIT (unchanged, deterministic)
# =====================================================================
def determine_visit(document_date: Optional[str], appointments: List[dict]) -> Dict:
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
# AGENT 1 - EXTRACTION AGENT (LLM, called once per new document)
# =====================================================================
VISIT_BUCKETS = [
    "consultation",
    "vitals",
    "orders",
    "laboratory",
    "imaging",
    "pathology",
    "molecular",
    "tumor_markers",
    "treatment",
    "adverse_event",
    "other",
]

# -----------------------------------------------------------------------
# Structural document-type -> measurement-display-category mapping.
#
# This is the ONLY place a "category" for a clinical_measurement comes
# from, and it is intentionally about DOCUMENT TYPES, not diseases,
# organs, or metric names. A lab report's numbers are "Laboratory"; an
# imaging report's numbers are "Imaging"; a pathology report's numbers
# are "Pathology" -- regardless of whether the patient has breast cancer,
# AML, or anything else. Nothing here needs to change to support a new
# cancer type, because it never looked at cancer type in the first place.
# -----------------------------------------------------------------------
_DOCUMENT_CATEGORY_TO_MEASUREMENT_CATEGORY: Dict[str, str] = {
    "laboratory": "Laboratory",
    "imaging": "Imaging",
    "pathology": "Pathology",
    "molecular": "Molecular",
    "tumor_markers": "Tumor Marker",
    "vitals": "Performance",
    "treatment": "Treatment",
    "consultation": "Clinical",
    "adverse_event": "Toxicity",
    "orders": "Other",
    "other": "Other",
}


def _measurement_category_for_document(primary_category: Optional[str]) -> str:
    return _DOCUMENT_CATEGORY_TO_MEASUREMENT_CATEGORY.get(primary_category or "other", "Other")


DOCUMENT_EXTRACTION_PROMPT_TEMPLATE = """You are generating structured data for a disease-agnostic oncology
longitudinal engine used across ALL cancer types (solid tumors,
hematologic malignancies, everything). Never assume a specific cancer
type, and never decide whether a piece of data is "important enough" to
extract -- extract everything the document actually states and let the
backend decide how to use it.

Valid document categories (use only these): {buckets}

WHAT EACH DOCUMENT CATEGORY MEANS (conceptually, not by keyword-matching):
- "laboratory": routine blood/serum test results (blood counts, chemistry
  panels, coagulation, etc).
- "pathology": findings from examining tissue or cells under a
  microscope (biopsies, resections, cytology, bone marrow exams).
- "imaging": findings from a radiology study (CT, MRI, PET, ultrasound,
  X-ray).
- "molecular": genetic/genomic testing results (mutation panels, NGS,
  FISH, cytogenetics).
- "tumor_markers": a blood test whose specific purpose is to measure a
  cancer-associated marker.
- "consultation": a clinician's visit note (history, exam, assessment, plan).
- "vitals": physical/functional measurements taken at a visit.
- "treatment": a record of a treatment being planned, given, or modified.
- "adverse_event": a documented side effect or complication.
- "orders": a list of things the clinician is ordering.
Use your own judgement of what the document IS, the same way a clinician
reading it would -- do not require a specific word to appear before you
classify it.

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
   fractions, date, regimen name, response, etc.). Additionally, WHEN
   THE DOCUMENT SUPPORTS IT, include:
     - "line": integer therapy line number (1, 2, 3...) if the document
       states or clearly implies which line of therapy this is.
     - "intent": "Curative" | "Palliative" | "Neoadjuvant" | "Adjuvant"
       if stated.
     - "cycles_completed": integer, if stated.
     - "reason_for_change": short string -- why this regimen replaced or
       ended a prior one (e.g. "toxicity", "disease progression",
       "completed planned cycles"), ONLY if the document actually says so.
   Omit any of these four sub-fields you cannot support from the text --
   never guess a line number.
9. Use only information explicitly present in the document -- never
   invent values, dates, or fields. Omit a category from
   fields_by_category entirely if it has nothing to contribute.

UNIVERSAL MEASUREMENT EXTRACTION (this replaces any notion of "which
metrics matter for this disease"):

10. Extract "clinical_measurements" -- a FLAT LIST of every single
    quantifiable value this document states, no matter what it measures
    or how routine or unusual it seems. Do NOT decide whether something
    is clinically important, and do NOT decide which "kind" of metric it
    is -- that classification happens later, deterministically, in code.
    Your only job for each one is:
      {{"name": "<the value's name, exactly as the document phrases it>",
        "value": <number>,
        "unit": "<unit exactly as documented, or null>",
        "body_site": "<anatomical location if stated, else null>",
        "favorable_direction": "down" | "up" | "neutral"}}
    Scan the ENTIRE document -- including narrative prose, not just
    obviously labeled report fields -- for every discrete measurement:
    lab values, biomarker/tumor-marker levels, imaging measurements
    (size, thickness, density, uptake value, count), pathology
    percentages, functional/performance scores, treatment doses/cycles,
    symptom or toxicity severity scores, quality-of-life scores, vitals,
    or anything else numeric. Extract a value regardless of whether you
    recognize it as "typical" for a particular cancer type -- extract
    what the document states, not what you expect a report for that
    disease to contain. Do not skip a measurable value just because it
    is embedded in a descriptive sentence rather than a labeled field.
    "favorable_direction" is your clinical judgement of whether a
    DECREASE, INCREASE, or neither is favorable for that specific value
    (e.g. "down" for a tumor marker, "up" for hemoglobin, "down" for a
    toxicity grade) -- this is what lets the numeric-trend engine work
    generically for any metric without a hardcoded list on the backend.
    ALWAYS report "unit" EXACTLY as documented (e.g. "mm" vs "cm"
    matter) -- never normalize or convert units yourself; the backend
    handles that.
    NEVER include an entry with a null or missing value. If a quantity is
    discussed but no specific number is stated (e.g. "some reduction in
    size" with no measurement given), DO NOT create an entry with
    "value": null -- simply omit it. A missing measurement is far better
    than a fake one, because a fake one permanently shows as blank on the
    doctor's dashboard.

STRUCTURED TIMELINE / LONGITUDINAL FIELDS (all optional -- only populate
what this document actually supports):

11. "clinical_events" -- a list of DISCRETE, dated clinical happenings this
    document reports (not a paragraph). One event per distinct thing that
    happened. Each item:
      {{"date": "YYYY-MM-DD" (use the document date if no other date is
        stated), "event_type": "consultation"|"diagnosis"|"imaging"|
        "pathology"|"treatment_plan"|"treatment_administered"|
        "surgery"|"lab_result"|"adverse_event"|"other",
        "title": "short title, e.g. 'Biopsy confirmed IDC'",
        "description": "one short sentence, optional",
        "importance": "high"|"medium"|"low"}}
    Include one event for EVERY clinically meaningful milestone this
    document supports -- a completed consultation, a completed lab panel,
    a completed imaging study, a new diagnosis, a staging result, a
    treatment start/stop, a significant response or progression, a
    completed procedure. Do not skip a document type just because it
    seems routine -- a completed CBC or LFT is still a reportable event
    for the timeline. Only exclude truly duplicate restatements of
    something already fully captured elsewhere in this same document.
12. "disease_status" -- the disease state AS OF this document, TRANSCRIBED
    exactly as documented, with no interpretation of your own. Omit
    entirely if disease status is not discussed in this document:
      {{"current_stage": "...", "disease_state": "e.g. Newly Diagnosed,
        On Treatment, Remission, Relapsed -- only if the document uses
        wording like this itself",
        "status_statements": ["exact phrase(s) as written, e.g.
        'Stable disease', 'Partial response', 'No evidence of
        recurrence', 'Progressive disease'"]}}
    Do NOT infer or summarize a response/trajectory verdict yourself --
    only transcribe status language that is actually present in the
    text. If the document states none, return null / omit the field.
    For "current_stage": actively look for TNM staging (e.g. "T2N1M0") or
    a named stage (e.g. "Stage IIB") ANYWHERE in the document --
    pathology reports, consultation notes, and imaging reports all
    commonly state it.
13. "symptoms" -- patient-reported or documented symptoms with severity,
    if present. Actively scan free-text fields such as chief_complaints
    and clinical_assessment for symptom mentions (e.g. pain, discomfort,
    fatigue, nausea, swelling, breathlessness, fever) -- do not require a
    formal severity grading system. If a symptom is mentioned but no
    numeric/graded severity is given, still include it with
    "severity": null: [{{"name": "Pain", "severity": 0-10 (or null if
    only qualitative), "trend": "Improving"|"Stable"|"Worsening"|null}}].
14. "medications" -- medication-level changes stated in this document:
    [{{"drug": "...", "action": "started"|"stopped"|"dose_changed"|
    "continued", "dose": "..." or null, "reason": "..." or null}}].
    Actively scan doctor_plan / treatment-plan text for NAMED drugs the
    patient is being started on, continued on, or having stopped/changed
    -- chemotherapy agents, hormone therapy, targeted therapy, and
    supportive medications (e.g. anti-emetics, analgesics, growth
    factors) mentioned by name. Extract each named drug as its own entry
    even if several are listed together in one plan sentence. Only use
    "continued" for the whole current medication list if the document
    explicitly reviews/reconciles it; otherwise only list drugs whose
    action is actually stated.
15. "clinical_decisions" -- explicit decisions made and their reasons:
    [{{"decision": "...", "reason": "...", "decided_by": "..." or null}}].
16. "pending_actions" -- investigations, referrals, or follow-ups this
    document orders or flags as outstanding: ["...", "..."].
17. "completed_actions" -- items this document reports as NOW completed
    (use this to close out something that may have been pending from an
    earlier visit, e.g. "PET CT" once the PET CT report itself arrives):
    ["...", "..."].
18. "alerts" -- safety-relevant flags a covering clinician should see at a
    glance: [{{"priority": "high"|"medium"|"low", "title": "..."}}]. Use
    for things like contraindications, severe toxicity, drug interactions,
    or critical lab/imaging findings requiring action.
19. "resolved_alerts" -- titles of alerts raised in a PRIOR document/visit
    that THIS document indicates are now resolved, recovered, or no
    longer relevant. Only include a title here if this document actually
    supports closing it out -- do not invent resolutions. List of
    strings: ["...", "..."].
20. "summary" is ONE short clinical sentence describing what this specific
    document says (for an audit trail) -- not a comparison to anything else.
21. Return ONLY valid JSON in exactly this shape, no commentary, no
    markdown fences:

{{
  "primary_category": "...",
  "secondary_categories": ["..."],
  "document_type": "...",
  "fields_by_category": {{ "category_name": {{...}} }},
  "clinical_measurements": [
    {{"name": "...", "value": 0, "unit": null, "body_site": null, "favorable_direction": "down"}}
  ],
  "clinical_events": [ {{"date": "...", "event_type": "...", "title": "...", "description": "...", "importance": "..."}} ],
  "disease_status": {{"current_stage": null, "disease_state": null, "status_statements": []}},
  "symptoms": [ {{"name": "...", "severity": null, "trend": null}} ],
  "medications": [ {{"drug": "...", "action": "...", "dose": null, "reason": null}} ],
  "clinical_decisions": [ {{"decision": "...", "reason": "...", "decided_by": null}} ],
  "pending_actions": ["..."],
  "completed_actions": ["..."],
  "alerts": [ {{"priority": "...", "title": "..."}} ],
  "resolved_alerts": ["..."],
  "summary": "..."
}}

=== FILE NAME ===
{file_name}

=== DOCUMENT TEXT ===
{document_text}
"""

_NEW_LAYER_LIST_FIELDS = (
    "clinical_events", "symptoms", "medications",
    "clinical_decisions", "pending_actions", "completed_actions", "alerts",
    "resolved_alerts",
)


def _measurement_value(entry: Any) -> Any:
    return entry.get("value") if isinstance(entry, dict) else entry


async def extract_longitudinal_document(document_text: str, file_name: str) -> Dict[str, Any]:
    """Extraction Agent. Single-responsibility LLM call: classify + extract
    ONE document. No knowledge of prior visits or patient history. The
    model extracts facts only -- it never buckets them into disease-metric
    categories, and never renders a disease-status verdict."""
    prompt = DOCUMENT_EXTRACTION_PROMPT_TEMPLATE.format(
        buckets=", ".join(VISIT_BUCKETS),
        file_name=file_name or "unknown",
        document_text=(document_text or "")[:12000],
    )

    completion = groq_client.chat.completions.create(
        model=GROQ_MODEL,
        temperature=0.0,
        max_tokens=2800,
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": prompt}],
    )
    raw = completion.choices[0].message.content

    try:
        result = json.loads(raw)
    except json.JSONDecodeError as e:
        logger.error(f"Document extraction JSON parse failed for {file_name}: {e} | raw={raw[:500]}")
        result = {}

    if result.get("primary_category") not in VISIT_BUCKETS:
        if result:
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
    result.setdefault("disease_status", None)
    result.setdefault("summary", None)
    for field in _NEW_LAYER_LIST_FIELDS:
        val = result.get(field)
        result[field] = val if isinstance(val, list) else []

    # Safety net: even though the prompt explicitly forbids null-valued
    # placeholder measurements, strip any that slip through anyway, and
    # drop any entry missing a usable name -- a missing measurement is
    # always better than one that permanently renders blank.
    measurements = result.get("clinical_measurements")
    clean_measurements: List[dict] = []
    if isinstance(measurements, list):
        for m in measurements:
            if not isinstance(m, dict):
                continue
            if not m.get("name"):
                continue
            if _measurement_value(m) is None:
                continue
            if not isinstance(_measurement_value(m), (int, float)):
                continue
            clean_measurements.append(m)
    result["clinical_measurements"] = clean_measurements

    return result


# =====================================================================
# VISIT SKELETON + MERGE (deterministic — no agent, no disease logic)
# =====================================================================
def _new_visit_skeleton(visit_info: dict) -> dict:
    vnum = visit_info["visit_number"]
    return {
        "visit_id": f"VISIT{vnum:03d}",
        "visit_number": vnum,
        "status": "Preparing",
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
        "treatment": {},
        "adverse_events": [],
        # Flat, universal measurement store. Keyed by canonical metric
        # name -> {"value", "unit", "favorable_direction", "category",
        # "body_site"}. "category" is derived deterministically from the
        # document type it came from (see
        # _measurement_category_for_document), never decided by the LLM.
        "clinical_measurements": {},
        # ---- Layer 2/3/4 raw material, accumulated per visit ----
        "clinical_events": [],
        "disease_status": None,
        "symptoms": [],
        "medications": [],
        "clinical_decisions": [],
        "pending_actions": [],
        "completed_actions": [],
        "alerts": [],
        "resolved_alerts": [],
        # ----------------------------------------------------------
        "visit_summary": None,
        "documents": [],
        "_document_ids": [],
    }


def _apply_fields_to_bucket(visit: dict, category: str, fields: dict) -> None:
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
        modality = fields.get("modality") or "unspecified"
        modality_fields = {k: v for k, v in fields.items() if k != "modality"}
        visit["treatment"][modality] = {**visit["treatment"].get(modality, {}), **modality_fields}
    elif category == "adverse_event":
        if fields not in visit["adverse_events"]:
            visit["adverse_events"].append(fields)
    else:
        logger.debug(f"category={category!r} not merged into any visit field")


# =====================================================================
# GENERIC METRIC NAME NORMALIZATION
# -----------------------------------------------------------------------
# Different documents describe the SAME measurement with different
# wording ("SUVmax" vs "Maximum SUV", "Wall thickening" vs "Residual
# wall thickness", "Largest lesion" vs "Dominant mass"). If every new
# wording were stored as its own key, the trend engine would never get
# more than one data point per key -- which is exactly why a
# narratively-worded report can look sparse next to a
# highly-standardized one.
#
# This is deliberately NOT a lookup table of disease-specific synonyms.
# There is no hardcoded list of cancer types, metric names, or keywords
# anywhere below -- it's pure lexical similarity. Every time a metric
# name is merged into a visit, it's compared against the metric names
# THIS SAME PATIENT already has on file (their own growing vocabulary,
# built at runtime), using string/token similarity. A close enough match
# reuses the existing key so the trend line continues; otherwise the new
# wording becomes its own canonical key so nothing is ever silently
# dropped or wrongly merged.
# =====================================================================
_GENERIC_STOPWORDS = {
    "the", "a", "an", "of", "in", "on", "at", "to", "and", "or", "with",
    "measured", "measurement", "level", "levels", "value", "score",
}


def _tokenize_metric_name(name: str) -> set:
    cleaned = re.sub(r"[^a-z0-9]+", " ", (name or "").lower())
    return {t for t in cleaned.split() if t and t not in _GENERIC_STOPWORDS}


def _metric_name_similarity(a: str, b: str) -> float:
    """Blends whole-string similarity (catches near-identical spelling,
    e.g. 'Hemoglobin' vs 'Haemoglobin') with token-set overlap (catches
    reordered/abbreviated phrasing, e.g. 'SUV max' vs 'Maximum SUV').
    Neither component knows anything about what the words *mean* -- it's
    purely lexical, so the same function works identically for a breast,
    esophageal, hematologic, or any other metric name without any
    per-disease logic."""
    a_norm, b_norm = (a or "").strip().lower(), (b or "").strip().lower()
    if not a_norm or not b_norm:
        return 0.0
    if a_norm == b_norm:
        return 1.0

    seq_ratio = difflib.SequenceMatcher(None, a_norm, b_norm).ratio()

    tokens_a, tokens_b = _tokenize_metric_name(a), _tokenize_metric_name(b)
    if tokens_a and tokens_b:
        overlap = len(tokens_a & tokens_b)
        union = len(tokens_a | tokens_b)
        jaccard = overlap / union if union else 0.0
        subset_bonus = 0.25 if (tokens_a <= tokens_b or tokens_b <= tokens_a) else 0.0
    else:
        jaccard, subset_bonus = 0.0, 0.0

    return min(1.0, max(seq_ratio, jaccard) + subset_bonus)


_METRIC_MATCH_THRESHOLD = 0.72


def _collect_known_metric_names(all_visits: Dict[int, dict]) -> List[str]:
    """All metric names this patient already has on file, across every
    visit -- the patient's own growing vocabulary, not a predefined list."""
    seen: List[str] = []
    seen_lower = set()
    for v in all_visits.values():
        for name in (v.get("clinical_measurements") or {}):
            if name.lower() not in seen_lower:
                seen_lower.add(name.lower())
                seen.append(name)
    return seen


def _resolve_canonical_metric_name(new_name: str, known_names: List[str]) -> str:
    """Returns an existing name from `known_names` if one is a close
    enough lexical match to `new_name` (best match wins, not just the
    first one above threshold); otherwise returns `new_name` unchanged
    so it registers as a brand-new metric."""
    best_name, best_score = None, 0.0
    for existing in known_names:
        score = _metric_name_similarity(new_name, existing)
        if score > best_score:
            best_name, best_score = existing, score
    if best_name is not None and best_score >= _METRIC_MATCH_THRESHOLD:
        return best_name
    return new_name


def _merge_measurements_into_visit(
    visit: dict,
    measurements: List[dict],
    document_primary_category: Optional[str],
    all_visits: Optional[Dict[int, dict]] = None,
) -> None:
    """Merges one document's flat clinical_measurements list into the
    visit's flat clinical_measurements dict.

    - Never stores a measurement with no usable numeric value.
    - Resolves the incoming name against every metric name this patient
      already has on file (generic lexical similarity, see above) so
      "SUV max" and "Maximum SUV" become the SAME trend line instead of
      two sparse ones.
    - Assigns "category" deterministically from the document TYPE this
      measurement came from -- never an LLM decision, never a
      disease-specific rule.
    """
    if not measurements:
        return
    visit.setdefault("clinical_measurements", {})

    known_names = (
        _collect_known_metric_names(all_visits)
        if all_visits is not None
        else list(visit["clinical_measurements"].keys())
    )

    derived_category = _measurement_category_for_document(document_primary_category)

    for m in measurements:
        value = _measurement_value(m)
        if value is None or not isinstance(value, (int, float)):
            continue  # never store a placeholder measurement

        raw_name = m.get("name")
        if not raw_name:
            continue

        canonical_name = _resolve_canonical_metric_name(raw_name, known_names)
        if canonical_name not in known_names:
            known_names.append(canonical_name)

        new_entry = {
            "value": value,
            "unit": m.get("unit"),
            "favorable_direction": m.get("favorable_direction"),
            "body_site": m.get("body_site"),
            "category": derived_category,
        }

        existing_entry = visit["clinical_measurements"].get(canonical_name)
        if isinstance(existing_entry, dict):
            merged_entry = {**existing_entry, **{k: v for k, v in new_entry.items() if v is not None}}
        else:
            merged_entry = new_entry
        visit["clinical_measurements"][canonical_name] = merged_entry


_STAGE_PATTERN = re.compile(
    r"\bStage\s+(?:0|IV|I{1,3}|[0-4])[A-C]?\b|\bT[0-4isX][a-c]?\s*N[0-3isX][a-c]?\s*M[0-1X]\b",
    re.IGNORECASE,
)


def _infer_stage_from_text(*texts: Optional[str]) -> Optional[str]:
    """Deterministic fallback for disease_status.current_stage. The
    extraction LLM is prompted to actively look for TNM/stage mentions,
    but pathology reports in particular often carry the stage in a way
    that's easy to under-weight. This regex-based backstop scans the
    already-merged consultation and pathology text for a stage on visits
    where disease_status.current_stage is still null, so a documented
    stage is never silently dropped just because the LLM didn't surface
    it into disease_status specifically."""
    for text in texts:
        if not text:
            continue
        match = _STAGE_PATTERN.search(text)
        if match:
            return match.group(0).strip()
    return None


# The phrases matched below (complete/partial response, stable disease,
# progressive disease, mixed response) are standardized RECIST / PERCIST
# / Lugano response-criteria vocabulary used across ALL cancer types --
# solid tumor or hematologic -- not wording specific to any one disease.
# This is universal oncology response-reporting terminology, not a
# per-cancer keyword list. Since the extraction LLM no longer renders its
# own "clinical_response"/"overall_direction" verdict (v4 change #4), this
# is now the ONLY source for those two fields -- derived from whatever
# exact status language the LLM transcribed (status_statements) plus the
# document's own free text, never invented.
_RESPONSE_PATTERNS = [
    (re.compile(r"\bcomplete (?:metabolic |radiologic |radiographic |clinical )?response\b", re.IGNORECASE), "Complete Response", "Improving"),
    (re.compile(r"\bpartial (?:metabolic |radiologic |radiographic |clinical )?response\b", re.IGNORECASE), "Partial Response", "Improving"),
    (re.compile(r"\bstable disease\b", re.IGNORECASE), "Stable Disease", "Stable"),
    (re.compile(r"\bprogressive disease\b|\bdisease progression\b", re.IGNORECASE), "Progressive Disease", "Progressing"),
    (re.compile(r"\bmixed response\b", re.IGNORECASE), None, "Mixed Response"),
    (re.compile(r"\bno evidence of (?:recurrence|disease)\b|\bcomplete remission\b", re.IGNORECASE), "Complete Response", "Improving"),
    (re.compile(r"\brelapse[d]?\b|\brecurrence\b|\bresidual disease\b", re.IGNORECASE), "Progressive Disease", "Progressing"),
]


def _infer_response_from_text(*texts: Optional[str]) -> Optional[Dict[str, str]]:
    """Derives clinical_response / overall_direction purely from
    standardized response-criteria language found in the text (including
    the LLM's verbatim status_statements). Only fires when a recognizable
    phrase is actually present -- it never guesses."""
    combined = " ".join(t for t in texts if t)
    if not combined:
        return None
    for pattern, response_label, direction_label in _RESPONSE_PATTERNS:
        if pattern.search(combined):
            result: Dict[str, str] = {}
            if response_label:
                result["clinical_response"] = response_label
            if direction_label:
                result["overall_direction"] = direction_label
            return result or None
    return None


def _merge_narrative_layers_into_visit(
    visit: dict,
    extraction: dict,
    document_date: Optional[str],
    document_text: Optional[str] = None,
) -> None:
    """Layer 2/3/4 raw material. Appends structured, de-duplicated items
    onto the visit so the deterministic aggregation nodes downstream
    (compute_visit_delta / compute_analytics_layers) have something to
    work with."""

    appointment_date = (visit.get("appointment") or {}).get("appointment_date")

    for event in extraction.get("clinical_events") or []:
        event = dict(event)
        event.setdefault("date", document_date)

        if event.get("event_type") == "consultation":
            event["date"] = appointment_date

        if event not in visit["clinical_events"]:
            visit["clinical_events"].append(event)

    disease_status = extraction.get("disease_status")
    if disease_status:
        # Only current_stage / disease_state / status_statements can come
        # from the LLM now -- clinical_response / overall_direction are
        # always derived below, never taken from the LLM directly.
        incoming = {
            k: v for k, v in disease_status.items()
            if k in ("current_stage", "disease_state", "status_statements") and v
        }
        merged_status = {**(visit.get("disease_status") or {})}
        if incoming.get("status_statements"):
            existing_statements = merged_status.get("status_statements") or []
            merged_status["status_statements"] = list(dict.fromkeys(
                existing_statements + incoming["status_statements"]
            ))
            incoming = {k: v for k, v in incoming.items() if k != "status_statements"}
        merged_status.update(incoming)
        visit["disease_status"] = merged_status

    for symptom in extraction.get("symptoms") or []:
        if symptom not in visit["symptoms"]:
            visit["symptoms"].append(symptom)

    for med in extraction.get("medications") or []:
        if med not in visit["medications"]:
            visit["medications"].append(med)

    for decision in extraction.get("clinical_decisions") or []:
        if decision not in visit["clinical_decisions"]:
            visit["clinical_decisions"].append(decision)

    for item in extraction.get("pending_actions") or []:
        if item not in visit["pending_actions"]:
            visit["pending_actions"].append(item)

    for item in extraction.get("completed_actions") or []:
        if item not in visit["completed_actions"]:
            visit["completed_actions"].append(item)

    for alert in extraction.get("alerts") or []:
        if alert not in visit["alerts"]:
            visit["alerts"].append(alert)

    for title in extraction.get("resolved_alerts") or []:
        if title not in visit["resolved_alerts"]:
            visit["resolved_alerts"].append(title)

    # ---- Deterministic stage backfill ----
    current_ds = visit.get("disease_status") or {}
    consultation_text = json.dumps(visit.get("consultation") or {}, default=str)
    pathology_text = json.dumps(
        (visit.get("uploaded_between_visits") or {}).get("pathology", {}), default=str
    )
    if not current_ds.get("current_stage"):
        inferred_stage = _infer_stage_from_text(consultation_text, pathology_text)
        if inferred_stage:
            current_ds = {**current_ds, "current_stage": inferred_stage}
            visit["disease_status"] = current_ds

    # ---- Deterministic response/direction derivation (v4: ALWAYS runs
    # off status_statements + document text, since the LLM no longer
    # supplies clinical_response/overall_direction directly) ----
    imaging_text = json.dumps(
        (visit.get("uploaded_between_visits") or {}).get("imaging", {}), default=str
    )
    status_statement_text = " ".join(current_ds.get("status_statements") or [])
    inferred_response = _infer_response_from_text(
        status_statement_text, consultation_text, pathology_text, imaging_text, document_text
    )
    if inferred_response:
        # A later document's clearer status language can update the
        # verdict; only overwrite fields the new evidence actually speaks to.
        visit["disease_status"] = {**current_ds, **inferred_response}


def _merge_document_into_visit(
    visit: dict,
    extraction: dict,
    document_id: str,
    file_name: Optional[str],
    document_date: Optional[str],
    document_text: Optional[str] = None,
    all_visits: Optional[Dict[int, dict]] = None,
) -> None:
    fields_by_category = extraction.get("fields_by_category") or {}
    primary_category = extraction.get("primary_category")
    categories = [primary_category] + list(extraction.get("secondary_categories") or [])

    for category in categories:
        _apply_fields_to_bucket(visit, category, fields_by_category.get(category) or {})

    _merge_measurements_into_visit(
        visit,
        extraction.get("clinical_measurements") or [],
        document_primary_category=primary_category,
        all_visits=all_visits,
    )
    _merge_narrative_layers_into_visit(visit, extraction, document_date, document_text=document_text)

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
    if not visits_by_number:
        return
    latest = max(visits_by_number.keys())
    for vnum, visit in visits_by_number.items():
        visit["status"] = "Preparing" if vnum == latest else "Completed"


def _hash_visit_content(visit: dict) -> str:
    payload = {
        k: v for k, v in visit.items()
        if k not in ("visit_summary", "_document_hash", "_document_ids", "clinical_measurements", "status", "documents")
    }
    return hashlib.sha256(json.dumps(payload, default=str, sort_keys=True).encode("utf-8")).hexdigest()


# =====================================================================
# AGENT 2 - VISIT SUMMARY AGENT (LLM, only for visits whose content hash changed)
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
shows. This narrative is a supplementary human-readable overlay; the
structured fields already present on the visit (clinical_events,
disease_status, symptoms, medications, clinical_decisions,
pending_actions, alerts) are what actually drive the UI, so do not try to
re-derive or contradict them -- just narrate.

RULES:
1. Use only information explicitly present in the visit data below.
2. Do not fabricate stage, grade, marker values, or dates.
3. If a field cannot be populated, set it to null or omit it -- do not
   invent placeholder values.
4. In "overall_visit_summary", do NOT state or imply a disease
   trajectory/response verdict yourself (e.g. do not write "stable",
   "progressing", "improving", "no evidence of progression" as your own
   conclusion). The visit's disease_status field is the single
   authoritative source for that verdict and the system appends it
   separately -- your job here is to summarize findings, values, and
   visit specifics, not to render a trajectory judgement.
5. Return ONLY valid JSON matching the schema. No commentary, no markdown fences.

=== JSON SCHEMA ===
{schema}

=== VISIT DATA ===
{visit_json}
"""


async def generate_visit_summary(visit: dict) -> Dict[str, Any]:
    """Visit Summary Agent. Single-responsibility LLM call: summarize ONE
    completed visit in isolation. Never compares across visits."""
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


def _enforce_visit_summary_consistency(visit: dict) -> None:
    """The visit_summary agent can also author a trajectory verdict in
    `overall_visit_summary` that disagrees with the visit's own
    structured `disease_status`. Rather than trying to catch every
    possible phrasing, disease_status is treated as the single source of
    truth and DETERMINISTICALLY prepended to the visit summary, dropping
    the LLM's own sentence only if it actually contradicts. This makes
    the verdict shown to the doctor always consistent with the
    structured data by construction, not by hoping a keyword check
    catches every case."""
    disease_status = visit.get("disease_status")
    if not disease_status:
        return
    summary = visit.get("visit_summary")
    if not isinstance(summary, dict):
        return

    statement = _deterministic_status_statement(disease_status)
    if not statement:
        return

    existing = summary.get("overall_visit_summary")
    if _narrative_contradicts_status(existing, disease_status):
        summary["overall_visit_summary"] = statement
    elif existing:
        if not existing.strip().lower().startswith(statement.strip().lower()[:20].lower()):
            summary["overall_visit_summary"] = f"{statement} {existing}".strip()
    else:
        summary["overall_visit_summary"] = statement


# =====================================================================
# UNIT NORMALIZATION
# =====================================================================
_UNIT_CONVERSIONS: Dict[tuple, float] = {
    # length
    ("mm", "cm"): 0.1, ("cm", "mm"): 10,
    ("cm", "m"): 0.01, ("m", "cm"): 100,
    ("mm", "m"): 0.001, ("m", "mm"): 1000,
    # mass
    ("mcg", "mg"): 0.001, ("mg", "mcg"): 1000,
    ("mg", "g"): 0.001, ("g", "mg"): 1000,
    ("g", "kg"): 0.001, ("kg", "g"): 1000,
    # volume
    ("ml", "l"): 0.001, ("l", "ml"): 1000,
    # concentration (common lab pairs)
    ("mg/dl", "g/dl"): 0.001, ("g/dl", "mg/dl"): 1000,
}


def _convert_unit(value: float, from_unit: Optional[str], to_unit: Optional[str]) -> Optional[float]:
    """Converts `value` from from_unit to to_unit using a small known
    conversion table. Returns None if units are unknown/incompatible so
    the caller can flag a mismatch instead of silently comparing apples
    to oranges."""
    if value is None:
        return None
    if not from_unit or not to_unit:
        return value
    fu, tu = from_unit.strip().lower(), to_unit.strip().lower()
    if fu == tu:
        return value
    factor = _UNIT_CONVERSIONS.get((fu, tu))
    if factor is not None:
        return round(value * factor, 6)
    return None


# =====================================================================
# NUMERIC TREND COMPUTATION (deterministic, no hardcoded metrics)
# =====================================================================
def _metric_value(entry: Any) -> Any:
    return entry.get("value") if isinstance(entry, dict) else entry


def _metric_unit(entry: Any) -> Any:
    return entry.get("unit") if isinstance(entry, dict) else None


def _metric_favorable_direction(entry: Any) -> Optional[str]:
    return entry.get("favorable_direction") if isinstance(entry, dict) else None


def _metric_category(entry: Any) -> Optional[str]:
    return entry.get("category") if isinstance(entry, dict) else None


def _compute_delta(
    old: Any,
    new: Any,
    favorable_direction: Optional[str] = None,
    old_unit: Optional[str] = None,
    new_unit: Optional[str] = None,
) -> Dict[str, Any]:
    result: Dict[str, Any] = {"previous": old, "current": new}
    if not (isinstance(old, (int, float)) and isinstance(new, (int, float))):
        return result

    normalized_new = new
    if old_unit and new_unit and old_unit.strip().lower() != new_unit.strip().lower():
        converted = _convert_unit(new, new_unit, old_unit)
        if converted is None:
            result["unit_mismatch"] = True
            result["previous_unit"] = old_unit
            result["current_unit"] = new_unit
            result["trend"] = "Unknown (unit mismatch)"
            return result
        normalized_new = converted
        result["normalized_current"] = normalized_new
        result["normalized_unit"] = old_unit

    change = round(normalized_new - old, 3)
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
    """Flat comparison across the union of metric names in both visits'
    clinical_measurements -- no per-section looping needed anymore since
    there's only one flat store. Output is still grouped by category (for
    the frontend) using each metric's own "category" field."""
    prev_measurements = previous_visit.get("clinical_measurements") or {}
    curr_measurements = current_visit.get("clinical_measurements") or {}

    metric_changes: Dict[str, List[Dict[str, Any]]] = {}
    for metric_name in set(prev_measurements.keys()) & set(curr_measurements.keys()):
        prev_entry = prev_measurements[metric_name]
        curr_entry = curr_measurements[metric_name]
        favorable = _metric_favorable_direction(curr_entry) or _metric_favorable_direction(prev_entry)
        prev_unit = _metric_unit(prev_entry)
        curr_unit = _metric_unit(curr_entry)
        section = _metric_category(curr_entry) or _metric_category(prev_entry) or "Other"
        delta = _compute_delta(
            _metric_value(prev_entry),
            _metric_value(curr_entry),
            favorable_direction=favorable,
            old_unit=prev_unit,
            new_unit=curr_unit,
        )
        metric_changes.setdefault(section, []).append({
            "name": metric_name,
            "unit": prev_unit or curr_unit,
            **delta,
        })

    prev_ae_signatures = {json.dumps(a, sort_keys=True, default=str) for a in (previous_visit.get("adverse_events") or [])}
    new_ae = [
        a for a in (current_visit.get("adverse_events") or [])
        if json.dumps(a, sort_keys=True, default=str) not in prev_ae_signatures
    ]

    prev_treatment = previous_visit.get("treatment") or {}
    curr_treatment = current_visit.get("treatment") or {}

    vital_status = (current_visit.get("consultation") or {}).get("vital_status")
    alive = not (isinstance(vital_status, str) and vital_status.strip().lower() == "deceased")

    return {
        "metric_changes": metric_changes,
        "safety": {"new_adverse_events": new_ae},
        "treatment_modifications": {
            "changed": prev_treatment != curr_treatment,
            "current_treatment": curr_treatment or None,
        },
        "survival": {"alive": alive},
    }


def _compute_overall_trends(completed_visits: List[dict]) -> Dict[str, Dict[str, List[Any]]]:
    """Builds a category -> metric_name -> [values across visits] series,
    grouping by each metric's own (deterministically-assigned) category
    rather than a fixed set of predefined sections."""
    name_to_category: Dict[str, str] = {}
    for v in completed_visits:
        for name, entry in (v.get("clinical_measurements") or {}).items():
            category = _metric_category(entry)
            if category:
                name_to_category[name] = category  # latest-seen category wins
            name_to_category.setdefault(name, "Other")

    series: Dict[str, Dict[str, List[Any]]] = {}
    for name, category in name_to_category.items():
        series.setdefault(category, {})[name] = [
            _metric_value((v.get("clinical_measurements") or {}).get(name))
            for v in completed_visits
        ]
    return series


# =====================================================================
# LAYER 2 — VISIT DELTA (deterministic)
# =====================================================================
def compute_visit_delta(previous_visit: dict, current_visit: dict, trends: Optional[dict]) -> Dict[str, Any]:
    """"What changed since the previous visit", computed in code instead
    of asked from an LLM in prose."""

    def _sig(x: Any) -> str:
        return json.dumps(x, sort_keys=True, default=str)

    prev_event_sigs = {_sig(e) for e in previous_visit.get("clinical_events") or []}
    new_findings = [
        e for e in current_visit.get("clinical_events") or []
        if _sig(e) not in prev_event_sigs
    ]

    prev_started_drugs = {
        m.get("drug") for m in previous_visit.get("medications") or []
        if m.get("action") in ("started", "continued")
    }
    new_medications = [
        m for m in current_visit.get("medications") or []
        if m.get("action") == "started" and m.get("drug") not in prev_started_drugs
    ]
    stopped_medications = [
        m for m in current_visit.get("medications") or []
        if m.get("action") == "stopped"
    ]

    prev_pending = set(previous_visit.get("pending_actions") or [])
    curr_pending = set(current_visit.get("pending_actions") or [])
    curr_completed = set(current_visit.get("completed_actions") or [])

    completed_since_previous = sorted(prev_pending & curr_completed)
    still_pending = sorted(curr_pending - curr_completed)
    newly_pending = sorted(curr_pending - prev_pending)

    new_documents = [d.get("document_type") for d in current_visit.get("documents") or []]

    metric_changes = (trends or {}).get("metric_changes", {})
    improved_metrics, worsened_metrics = [], []
    for section, metrics in metric_changes.items():
        for m in metrics:
            entry = {"section": section, **m}
            if m.get("trend") == "Improving":
                improved_metrics.append(entry)
            elif m.get("trend") == "Worsening":
                worsened_metrics.append(entry)

    return {
        "new_findings": new_findings,
        "new_medications": new_medications,
        "stopped_medications": stopped_medications,
        "pending_actions": still_pending,
        "newly_pending_actions": newly_pending,
        "completed_actions": completed_since_previous,
        "new_documents": new_documents,
        "improved_metrics": improved_metrics,
        "worsened_metrics": worsened_metrics,
    }


# =====================================================================
# LAYER 3 / 4 — TIMELINE + LONGITUDINAL ANALYTICS (deterministic)
# =====================================================================
def compute_deterministic_events(ordered_visits: List[dict]) -> List[dict]:
    """Events derived from STRUCTURE, not asked from the LLM."""
    events: List[dict] = []
    seen_modalities: set = set()
    previous_disease_status: Optional[dict] = None

    DOC_EVENT_TYPE = {
        "pathology": "pathology",
        "imaging": "imaging",
        "molecular": "other",
        "tumor_markers": "lab_result",
        "laboratory": "lab_result",
        "consultation": "consultation",
        "treatment": "treatment_plan",
        "adverse_event": "adverse_event",
    }

    for v in ordered_visits:
        vnum = v["visit_number"]

        for doc in v.get("documents") or []:
            category = doc.get("primary_category")
            if category not in DOC_EVENT_TYPE:
                continue
            label = doc.get("document_type") or category.replace("_", " ").title()
            events.append({
                "visit_number": vnum,
                "date": doc.get("document_date"),
                "event_type": DOC_EVENT_TYPE[category],
                "title": f"{label} uploaded" if category not in ("consultation", "treatment") else f"{label} completed",
                "description": doc.get("summary"),
                "importance": "medium",
                "source": "deterministic",
            })

        visit_date = (v.get("appointment") or {}).get("appointment_date")
        for modality in (v.get("treatment") or {}).keys():
            if modality not in seen_modalities:
                seen_modalities.add(modality)
                events.append({
                    "visit_number": vnum,
                    "date": visit_date,
                    "event_type": "treatment_plan",
                    "title": f"Treatment started: {modality}",
                    "description": None,
                    "importance": "high",
                    "source": "deterministic",
                })

        current_disease_status = v.get("disease_status")
        if current_disease_status and current_disease_status != previous_disease_status:
            response = current_disease_status.get("clinical_response")
            direction = current_disease_status.get("overall_direction")
            label_bits = [b for b in (response, direction) if b]
            if label_bits:
                events.append({
                    "visit_number": vnum,
                    "date": visit_date,
                    "event_type": "disease_status_change",
                    "title": "Disease status: " + " / ".join(label_bits),
                    "description": None,
                    "importance": "high",
                    "source": "deterministic",
                })
            previous_disease_status = current_disease_status

    return events


def compute_timeline(visits_by_number: Dict[int, dict]) -> List[dict]:
    """Flat, chronological clinical_events across every visit -- LLM
    events plus deterministically-derived ones, deduplicated by
    (date, title)."""
    ordered_visits = [visits_by_number[n] for n in sorted(visits_by_number.keys())]

    events: List[dict] = []
    for vnum in sorted(visits_by_number.keys()):
        visit = visits_by_number[vnum]

        appointment_date = (
            visit.get("appointment") or {}
        ).get("appointment_date")

        for e in visit.get("clinical_events") or []:
            event = {
                "visit_number": vnum,
                "source": "extracted",
                **e,
            }

            if appointment_date:
                event["date"] = appointment_date

            events.append(event)

    events.extend(compute_deterministic_events(ordered_visits))

    seen = set()
    deduped: List[dict] = []
    for e in events:
        sig = (e.get("date"), (e.get("title") or "").strip().lower())
        if sig in seen:
            continue
        seen.add(sig)
        deduped.append(e)

    indexed = list(enumerate(deduped))

    def _key(pair):
        idx, e = pair
        return (_parse_date(e.get("date")) or date.min, e.get("visit_number", 0), idx)

    indexed.sort(key=_key)
    return [e for _, e in indexed]


def compute_longitudinal_overview(completed_visits: List[dict]) -> Optional[dict]:
    """Cross-visit summary that ISN'T just "previous vs current" --
    baseline vs latest, best response reached, every toxicity seen, and
    the single biggest reduction seen for each numeric metric, across
    the WHOLE history (not just the last two visits)."""
    if len(completed_visits) < 2:
        return None

    baseline_visit, latest_visit = completed_visits[0], completed_visits[-1]
    baseline_vs_current = compute_numeric_trends(baseline_visit, latest_visit)

    best_response = None
    best_rank = -1
    for v in completed_visits:
        response = (v.get("disease_status") or {}).get("clinical_response")
        rank = RESPONSE_RANK.get(response, -1)
        if response and rank > best_rank:
            best_rank = rank
            best_response = {"visit_number": v["visit_number"], "clinical_response": response}

    all_toxicities: List[dict] = []
    seen_ae = set()
    for v in completed_visits:
        for ae in v.get("adverse_events") or []:
            sig = json.dumps(ae, sort_keys=True, default=str)
            if sig not in seen_ae:
                seen_ae.add(sig)
                all_toxicities.append({"visit_number": v["visit_number"], **ae})

    max_reduction: Dict[str, dict] = {}
    for v in completed_visits:
        for metric_name, entry in (v.get("clinical_measurements") or {}).items():
            value = _metric_value(entry)
            favorable = _metric_favorable_direction(entry)
            if not isinstance(value, (int, float)):
                continue
            baseline_entry = (baseline_visit.get("clinical_measurements") or {}).get(metric_name)
            baseline_value = _metric_value(baseline_entry)
            if not isinstance(baseline_value, (int, float)) or not baseline_value:
                continue
            pct_change = round((value - baseline_value) / baseline_value * 100, 1)
            is_improvement = (
                (favorable == "down" and pct_change < 0)
                or (favorable == "up" and pct_change > 0)
            )
            if not is_improvement:
                continue
            magnitude = abs(pct_change)
            if metric_name not in max_reduction or magnitude > abs(max_reduction[metric_name]["percentage_change"]):
                max_reduction[metric_name] = {
                    "section": _metric_category(entry) or "Other",
                    "name": metric_name,
                    "baseline": baseline_value,
                    "best_value": value,
                    "percentage_change": pct_change,
                    "visit_number": v["visit_number"],
                }

    return {
        "baseline_visit": baseline_visit["visit_number"],
        "current_visit": latest_visit["visit_number"],
        "baseline_vs_current": baseline_vs_current,
        "best_response": best_response,
        "toxicities_seen": all_toxicities,
        "best_metric_improvements": list(max_reduction.values()),
        "latest_status": latest_visit.get("disease_status"),
    }


def compute_disease_trajectory(ordered_visits: List[dict]) -> List[dict]:
    trajectory = []
    for v in ordered_visits:
        ds = v.get("disease_status")
        if not ds:
            continue
        trajectory.append({
            "visit_number": v["visit_number"],
            "date": (v.get("appointment") or {}).get("appointment_date"),
            **ds,
        })
    return trajectory


def compute_symptom_trends(ordered_visits: List[dict]) -> List[dict]:
    series: Dict[str, List[dict]] = {}
    for v in ordered_visits:
        for s in v.get("symptoms") or []:
            name = s.get("name")
            if not name:
                continue
            series.setdefault(name, []).append({
                "visit_number": v["visit_number"],
                "date": (v.get("appointment") or {}).get("appointment_date"),
                "severity": s.get("severity"),
                "trend": s.get("trend"),
            })

    result = []
    for name, points in series.items():
        numeric = [p["severity"] for p in points if isinstance(p["severity"], (int, float))]
        overall_trend = points[-1].get("trend")
        if not overall_trend and len(numeric) >= 2:
            if numeric[-1] < numeric[0]:
                overall_trend = "Improving"
            elif numeric[-1] > numeric[0]:
                overall_trend = "Worsening"
            else:
                overall_trend = "Stable"
        result.append({"name": name, "history": points, "overall_trend": overall_trend})
    return result


def compute_medication_timeline(ordered_visits: List[dict]) -> List[dict]:
    drugs: Dict[str, dict] = {}
    for v in ordered_visits:
        visit_date = (v.get("appointment") or {}).get("appointment_date")
        for m in v.get("medications") or []:
            drug = m.get("drug")
            if not drug:
                continue
            entry = drugs.setdefault(drug, {
                "drug": drug, "started": None, "stopped": None,
                "dose_changes": [], "status": "unknown",
            })
            action = m.get("action")
            if action == "started":
                entry["started"] = entry["started"] or visit_date
                entry["status"] = "active"
            elif action == "stopped":
                entry["stopped"] = visit_date
                entry["status"] = "stopped"
                entry["reason_for_stop"] = m.get("reason")
            elif action == "dose_changed":
                entry["dose_changes"].append({"date": visit_date, "dose": m.get("dose"), "reason": m.get("reason")})
                if entry["status"] != "stopped":
                    entry["status"] = "active"
            elif action == "continued" and entry["status"] != "stopped":
                entry["status"] = "active"
    return list(drugs.values())


def compute_treatment_history(ordered_visits: List[dict]) -> List[dict]:
    """Line-of-therapy-aware treatment history. Groups treatment entries
    by explicit `line` (when the extraction prompt supplied one) instead
    of by modality identity, and falls back to modality-identity grouping
    (line=None) for anything the LLM couldn't confidently number."""
    lines_by_key: Dict[Any, dict] = {}
    order: List[Any] = []

    for v in ordered_visits:
        visit_date = (v.get("appointment") or {}).get("appointment_date")
        for modality, details in (v.get("treatment") or {}).items():
            details = details or {}
            line_number = details.get("line")
            key = ("line", line_number) if line_number is not None else ("modality", modality)

            if key not in lines_by_key:
                lines_by_key[key] = {
                    "line": line_number,
                    "regimen": details.get("regimen") or modality,
                    "intent": details.get("intent"),
                    "cycles_completed": details.get("cycles_completed"),
                    "start_date": visit_date,
                    "end_date": None,
                    "status": "Active",
                    "reason_for_change": details.get("reason_for_change"),
                    "last_seen_visit": v["visit_number"],
                    "details": details,
                }
                order.append(key)
            else:
                entry = lines_by_key[key]
                entry["details"] = {**entry["details"], **details}
                entry["last_seen_visit"] = v["visit_number"]
                entry["status"] = "Active"
                entry["intent"] = details.get("intent") or entry["intent"]
                entry["cycles_completed"] = details.get("cycles_completed", entry["cycles_completed"])
                entry["reason_for_change"] = details.get("reason_for_change") or entry["reason_for_change"]

    if ordered_visits:
        latest_vnum = ordered_visits[-1]["visit_number"]
        for key in order:
            entry = lines_by_key[key]
            if entry["last_seen_visit"] != latest_vnum:
                entry["status"] = "Completed / Changed"
                entry.setdefault("reason_for_change", entry.get("reason_for_change"))

    result = [lines_by_key[k] for k in order]
    result.sort(key=lambda e: (e["line"] is None, e["line"] if e["line"] is not None else 0))
    return result


RESPONSE_RANK = {
    "Complete Response": 4,
    "Partial Response": 3,
    "Stable Disease": 2,
    "Baseline": 1,
    "Progressive Disease": 0,
}


def compute_active_alerts(ordered_visits: List[dict]) -> List[dict]:
    """Alert LIFECYCLE, not just accumulation: an alert stays active only
    until (a) a later document explicitly resolves it via
    `resolved_alerts`, or (b) a pending action with the exact same title
    is marked completed."""
    active: Dict[str, dict] = {}
    for v in ordered_visits:
        for a in v.get("alerts") or []:
            title = a.get("title")
            if title:
                active[title] = a

        for title in v.get("resolved_alerts") or []:
            active.pop(title, None)

        for completed in v.get("completed_actions") or []:
            active.pop(completed, None)

    return list(active.values())


def compute_pending_items(ordered_visits: List[dict]) -> List[str]:
    pending, completed = set(), set()
    for v in ordered_visits:
        pending |= set(v.get("pending_actions") or [])
        completed |= set(v.get("completed_actions") or [])
    return sorted(pending - completed)


def compute_clinical_decisions_log(ordered_visits: List[dict]) -> List[dict]:
    log = []
    for v in ordered_visits:
        visit_date = (v.get("appointment") or {}).get("appointment_date")
        for d in v.get("clinical_decisions") or []:
            log.append({"visit_number": v["visit_number"], "date": visit_date, **d})
    return log


def compute_dashboard(ordered_visits: List[dict], layers: Dict[str, Any]) -> Optional[dict]:
    """A single Frontend ViewModel the UI can bind to directly instead of
    re-deriving "what's the headline status" on every render. Entirely
    deterministic -- built from fields already computed above."""
    if not ordered_visits:
        return None

    latest_visit = ordered_visits[-1]
    latest_consultation = latest_visit.get("consultation") or {}
    disease_status = latest_visit.get("disease_status") or {}

    active_treatments = [
        t.get("regimen") for t in (layers.get("treatment_history") or [])
        if t.get("status") == "Active"
    ]

    next_action = latest_consultation.get("doctor_plan")
    if not next_action:
        pending = layers.get("pending_items") or []
        next_action = pending[0] if pending else None

    return {
        "current_status": disease_status.get("disease_state") or disease_status.get("clinical_response"),
        "current_treatment": active_treatments,
        "response": disease_status.get("clinical_response"),
        "overall_direction": disease_status.get("overall_direction"),
        "alerts": layers.get("active_alerts") or [],
        "next_action": next_action,
        "last_updated": (latest_visit.get("appointment") or {}).get("appointment_date"),
        "current_visit_number": latest_visit.get("visit_number"),
        "current_visit_status": latest_visit.get("status"),
    }


# =====================================================================
# AGENT 3 - NARRATIVE AGENT (LLM, only fires when >=2 completed visits
# AND the latest completed visit actually changed since last run)
# =====================================================================
LONGITUDINAL_NARRATIVE_PROMPT_TEMPLATE = """You are a clinical data synthesis engine writing a brief narrative
comparing two consecutive oncology visits for the same patient. Do not
assume any specific cancer type -- describe whatever the data actually shows.

The trends below (metric changes, safety, treatment changes) have ALREADY
been computed deterministically -- do NOT recompute or contradict them.

The CURRENT VISIT'S STRUCTURED DISEASE STATUS below is GROUND TRUTH and
was determined by the extraction pipeline, not by you. It is:
{disease_status_json}

A system-generated verdict sentence stating the disease state, clinical
response, and overall trajectory will be PREPENDED to your text
automatically -- you do not need to and should NOT restate that verdict
yourself (do not write your own "stable"/"progressing"/"improving"
conclusion). Your job is ONLY to add brief supporting clinical color:
what changed and why it's clinically relevant, given the trends below.
Do not render any trajectory judgement of your own, consistent or not --
leave that entirely to the system-generated sentence.

Your only job is to write ONE short (1-3 sentence) supporting-color
addendum, in plain clinical language, that will be appended AFTER the
system's verdict sentence.

RULES:
1. Base your text only on the visit summaries and computed trends given.
2. Do not invent values not present below.
3. Do NOT state a disease trajectory/response verdict -- that is handled
   by the system, not you.
4. Return ONLY valid JSON: {{"overall_ai_assessment": "string"}}. No
   commentary, no markdown fences.

=== PREVIOUS VISIT SUMMARY (visit {previous_visit_number}) ===
{previous_summary_json}

=== CURRENT VISIT SUMMARY (visit {current_visit_number}) ===
{current_summary_json}

=== COMPUTED TRENDS (ground truth -- do not recompute) ===
{trends_json}
"""

_DIRECTION_CONTRADICTION_TERMS: Dict[str, List[str]] = {
    "Progressing": ["stable disease", "no evidence of progression", "is improving", "responding well", "remission"],
    "Improving": ["disease progression", "is progressing", "worsening disease"],
    "Stable": ["is progressing", "rapid progression"],
}


def _narrative_contradicts_status(narrative: Optional[str], disease_status: Optional[dict]) -> bool:
    if not narrative or not disease_status:
        return False
    direction = disease_status.get("overall_direction")
    bad_terms = _DIRECTION_CONTRADICTION_TERMS.get(direction, [])
    lowered = narrative.lower()
    return any(term in lowered for term in bad_terms)


def _deterministic_status_statement(disease_status: Optional[dict]) -> Optional[str]:
    """The single authoritative, code-generated verdict sentence built
    directly from structured disease_status -- never from an LLM."""
    if not disease_status:
        return None
    stage = disease_status.get("current_stage")
    state = disease_status.get("disease_state")
    response = disease_status.get("clinical_response")
    direction = disease_status.get("overall_direction")

    bits = []
    if state:
        bits.append(f"Disease state: {state}")
    if response:
        bits.append(f"Clinical response: {response}")
    if direction:
        bits.append(f"Overall trajectory: {direction}")
    if not bits:
        return None

    statement = ". ".join(bits) + "."
    if stage:
        statement = f"[{stage}] " + statement
    return statement


def _fallback_narrative_from_status(disease_status: Optional[dict]) -> Optional[str]:
    """Kept for backward compatibility with any callers expecting the old
    name; delegates to the deterministic statement builder."""
    return _deterministic_status_statement(disease_status)


async def generate_longitudinal_narrative(
    previous_visit_summary: dict,
    current_visit_summary: dict,
    trends: dict,
    previous_visit_number: int,
    current_visit_number: int,
    current_disease_status: Optional[dict] = None,
) -> Optional[str]:
    """Narrative Agent. Single-responsibility LLM call: writes prose ONLY.
    Never recomputes numbers — trends are handed to it as ground truth.
    current_disease_status is also handed in as ground truth so the LLM
    cannot independently re-derive a contradictory verdict."""
    prompt = LONGITUDINAL_NARRATIVE_PROMPT_TEMPLATE.format(
        disease_status_json=json.dumps(current_disease_status or {}, default=str, indent=2),
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
        color_text = json.loads(raw).get("overall_ai_assessment")
    except json.JSONDecodeError as e:
        logger.error(f"Longitudinal narrative JSON parse failed: {e} | raw={raw[:500]}")
        color_text = None

    verdict = _deterministic_status_statement(current_disease_status)

    if color_text and _narrative_contradicts_status(color_text, current_disease_status):
        logger.warning(
            "Narrative color text contradicted structured disease_status "
            f"(overall_direction={(current_disease_status or {}).get('overall_direction')!r}); "
            "dropping LLM color text, keeping deterministic verdict only."
        )
        color_text = None

    if verdict and color_text:
        return f"{verdict} {color_text}".strip()
    if verdict:
        return verdict
    return color_text


# =====================================================================
# PATIENT INFORMATION (unchanged, deterministic)
# =====================================================================
async def load_patient_information(patient_id: str) -> Dict[str, Any]:
    try:
        patient_doc = await patient_user_collection.find_one(
            {"sys_user_id": patient_id},
            {"_id": 0}
        )

        if not patient_doc:
            logger.warning(
                f"No patient_information found for patient_id={patient_id}"
            )
            return {}

        return patient_doc

    except Exception:
        logger.exception(
            f"Failed to load patient_information for patient_id={patient_id}"
        )
        return {}


# =====================================================================
# ASSEMBLE FRONTEND JSON (unchanged, deterministic)
# =====================================================================
def build_frontend_json(
    patient_id: str,
    patient_information: Dict[str, Any],
    visits_by_number: Dict[int, dict],
    longitudinal_summary: Optional[dict],
    doctor_id: Optional[str] = None,
) -> Dict[str, Any]:
    ordered_visits = [visits_by_number[n] for n in sorted(visits_by_number.keys())]
    current_active_visit = ordered_visits[-1]["visit_number"] if ordered_visits else None

    clean_visits = [
        {k: v for k, v in visit.items() if k not in ("_document_ids", "_document_hash")}
        for visit in ordered_visits
    ]

    return {
        "doctor_id": doctor_id,   # kept as metadata only, never used to filter
        "patient_id": patient_id,
        "patient_information": patient_information,
        "current_active_visit": current_active_visit,
        "visits": clean_visits,
        "longitudinal_summary": longitudinal_summary or {},
    }


# =====================================================================
# LANGGRAPH STATE — namespaced groups instead of one flat dict
# =====================================================================
class InputState(TypedDict):
    patient_id: str
    doctor_id: str
    document_text: str
    document_date: Optional[str]
    file_name: Optional[str]
    document_id: str


class ExtractionState(TypedDict, total=False):
    extraction: dict
    appointments: List[dict]


class VisitState(TypedDict, total=False):
    visit_info: dict
    visits_by_number: Dict[int, dict]
    completed_visits: List[dict]
    latest_completed_visit: Optional[int]
    previously_latest_completed: Optional[int]


class LongitudinalState(TypedDict, total=False):
    trends: Optional[dict]
    visit_delta: Optional[dict]
    overall_trends: Optional[dict]
    layers: Optional[dict]
    narrative: Optional[str]
    longitudinal_summary: Optional[dict]


class PatientState(TypedDict, total=False):
    patient_information: dict


class OutputState(TypedDict, total=False):
    case_view_data: dict
    mongo_record: dict
    record: dict


class CaseViewState(TypedDict, total=False):
    input: InputState
    existing_record: Optional[dict]
    already_processed: bool
    extraction: ExtractionState
    visit: VisitState
    longitudinal: LongitudinalState
    patient: PatientState
    output: OutputState


def _ns(state: CaseViewState, key: str) -> dict:
    return dict(state.get(key) or {})


# =====================================================================
# GRAPH NODES
# =====================================================================
async def load_existing_state_node(state: CaseViewState) -> CaseViewState:
    inp = state["input"]
    existing_record = await longitudinal_case_view.find_one(
        {"patient_id": inp["patient_id"]}
    )
    existing_data = (existing_record or {}).get("data", {})

    visits_by_number: Dict[int, dict] = {}
    for v in existing_data.get("visits", []):
        v.setdefault("_document_ids", [d.get("document_id") for d in v.get("documents", [])])
        v.setdefault("clinical_measurements", {})
        # Migration safety net: if an older record still has the v3
        # 8-bucket "visit_snapshot" shape, flatten it into
        # clinical_measurements once so old patients don't lose history.
        legacy_snapshot = v.pop("visit_snapshot", None)
        if isinstance(legacy_snapshot, dict):
            for section, metrics in legacy_snapshot.items():
                if not isinstance(metrics, dict):
                    continue
                for name, entry in metrics.items():
                    if not isinstance(entry, dict):
                        continue
                    if name in v["clinical_measurements"]:
                        continue
                    v["clinical_measurements"][name] = {
                        "value": entry.get("value"),
                        "unit": entry.get("unit"),
                        "favorable_direction": entry.get("favorable_direction"),
                        "body_site": None,
                        "category": section.replace("_metrics", "").replace("_", " ").title(),
                    }
        v.setdefault("clinical_events", [])
        v.setdefault("disease_status", None)
        v.setdefault("symptoms", [])
        v.setdefault("medications", [])
        v.setdefault("clinical_decisions", [])
        v.setdefault("pending_actions", [])
        v.setdefault("completed_actions", [])
        v.setdefault("alerts", [])
        v.setdefault("resolved_alerts", [])
        visits_by_number[v["visit_number"]] = v

    already_seen = {doc_id for v in visits_by_number.values() for doc_id in v.get("_document_ids", [])}
    already_processed = inp["document_id"] in already_seen

    return {
        "existing_record": existing_record,
        "already_processed": already_processed,
        "visit": {**_ns(state, "visit"), "visits_by_number": visits_by_number},
        "longitudinal": {**_ns(state, "longitudinal"), "longitudinal_summary": existing_data.get("longitudinal_summary")},
    }


def skip_already_processed_node(state: CaseViewState) -> CaseViewState:
    logger.info(f"[agentic] document_id={state['input']['document_id']} already merged; skipping.")
    return {"output": {**_ns(state, "output"), "record": state.get("existing_record") or {}}}


async def extraction_agent_node(state: CaseViewState) -> CaseViewState:
    inp = state["input"]
    extraction = await extract_longitudinal_document(inp["document_text"], inp["file_name"])
    appointments = await load_patient_appointments(inp["patient_id"])
    return {"extraction": {"extraction": extraction, "appointments": appointments}}


def determine_visit_node(state: CaseViewState) -> CaseViewState:
    inp = state["input"]
    appointments = state["extraction"]["appointments"]
    visit_info = determine_visit(inp["document_date"], appointments)
    return {"visit": {**_ns(state, "visit"), "visit_info": visit_info}}


def merge_document_node(state: CaseViewState) -> CaseViewState:
    inp = state["input"]
    visit_info = state["visit"]["visit_info"]
    visits_by_number = state["visit"]["visits_by_number"]
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
        extraction=state["extraction"]["extraction"],
        document_id=inp["document_id"],
        file_name=inp["file_name"],
        document_date=inp["document_date"],
        document_text=inp.get("document_text"),
        all_visits=visits_by_number,
    )
    return {"visit": {**state["visit"], "visits_by_number": visits_by_number}}


def recompute_visit_statuses_node(state: CaseViewState) -> CaseViewState:
    visits_by_number = state["visit"]["visits_by_number"]
    _recompute_visit_statuses(visits_by_number)
    return {"visit": {**state["visit"], "visits_by_number": visits_by_number}}


async def visit_summary_agent_node(state: CaseViewState) -> CaseViewState:
    visits_by_number = state["visit"]["visits_by_number"]
    for v in visits_by_number.values():
        if v["status"] != "Completed":
            continue

        current_hash = _hash_visit_content(v)
        if v.get("visit_summary") and v.get("_document_hash") == current_hash:
            continue

        v["visit_summary"] = await generate_visit_summary(v)
        _enforce_visit_summary_consistency(v)
        v["_document_hash"] = current_hash

    return {"visit": {**state["visit"], "visits_by_number": visits_by_number}}


async def load_patient_information_node(state: CaseViewState) -> CaseViewState:
    patient_information = await load_patient_information(state["input"]["patient_id"])
    return {"patient": {**_ns(state, "patient"), "patient_information": patient_information}}


def find_completed_visits_node(state: CaseViewState) -> CaseViewState:
    visits_by_number = state["visit"]["visits_by_number"]
    completed_visits = sorted(
        (v for v in visits_by_number.values() if v["status"] == "Completed"),
        key=lambda v: v["visit_number"],
    )
    latest_completed = completed_visits[-1]["visit_number"] if completed_visits else None
    previously_latest_completed = (state["longitudinal"].get("longitudinal_summary") or {}).get("latest_completed_visit")

    return {
        "visit": {
            **state["visit"],
            "completed_visits": completed_visits,
            "latest_completed_visit": latest_completed,
            "previously_latest_completed": previously_latest_completed,
        }
    }


def compute_numeric_trends_node(state: CaseViewState) -> CaseViewState:
    visit = state["visit"]
    completed_visits = visit["completed_visits"]
    latest_completed = visit["latest_completed_visit"]
    previously_latest_completed = visit["previously_latest_completed"]

    trends = None
    if latest_completed and latest_completed != previously_latest_completed and len(completed_visits) >= 2:
        previous_visit, current_visit = completed_visits[-2], completed_visits[-1]
        trends = compute_numeric_trends(previous_visit, current_visit)

    return {"longitudinal": {**_ns(state, "longitudinal"), "trends": trends}}


def compute_visit_delta_node(state: CaseViewState) -> CaseViewState:
    completed_visits = state["visit"]["completed_visits"]
    trends = state["longitudinal"].get("trends")

    visit_delta = None
    if trends is not None and len(completed_visits) >= 2:
        previous_visit, current_visit = completed_visits[-2], completed_visits[-1]
        visit_delta = compute_visit_delta(previous_visit, current_visit, trends)

    return {"longitudinal": {**state["longitudinal"], "visit_delta": visit_delta}}


def compute_overall_trends_node(state: CaseViewState) -> CaseViewState:
    completed_visits = state["visit"]["completed_visits"]
    overall_trends = _compute_overall_trends(completed_visits) if completed_visits else {}
    return {"longitudinal": {**state["longitudinal"], "overall_trends": overall_trends}}


def compute_analytics_layers_node(state: CaseViewState) -> CaseViewState:
    visits_by_number = state["visit"]["visits_by_number"]
    ordered_visits = [visits_by_number[n] for n in sorted(visits_by_number.keys())]
    completed_visits = state["visit"].get("completed_visits") or []

    layers = {
        "timeline": compute_timeline(visits_by_number),
        "disease_trajectory": compute_disease_trajectory(ordered_visits),
        "symptom_trends": compute_symptom_trends(ordered_visits),
        "medication_timeline": compute_medication_timeline(ordered_visits),
        "treatment_history": compute_treatment_history(ordered_visits),
        "active_alerts": compute_active_alerts(ordered_visits),
        "pending_items": compute_pending_items(ordered_visits),
        "clinical_decisions_log": compute_clinical_decisions_log(ordered_visits),
        "longitudinal_overview": compute_longitudinal_overview(completed_visits),
    }
    layers["dashboard"] = compute_dashboard(ordered_visits, layers)
    return {"longitudinal": {**state["longitudinal"], "layers": layers}}


def prepare_longitudinal_summary_node(state: CaseViewState) -> CaseViewState:
    visit = state["visit"]
    longitudinal = state["longitudinal"]
    latest_completed = visit["latest_completed_visit"]
    completed_visits = visit["completed_visits"]
    trends = longitudinal.get("trends")
    overall_trends = longitudinal.get("overall_trends")
    layers = longitudinal.get("layers") or {}
    visit_delta = longitudinal.get("visit_delta")
    longitudinal_summary = longitudinal.get("longitudinal_summary")

    base_fields = {"overall_trends": overall_trends, "visit_delta": visit_delta, **layers}

    if trends is not None:
        longitudinal_summary = {**(longitudinal_summary or {}), **base_fields}
    elif latest_completed and not longitudinal_summary and len(completed_visits) < 2:
        longitudinal_summary = {
            "latest_completed_visit": latest_completed,
            "comparison": {},
            "history": [],
            **base_fields,
        }
    elif longitudinal_summary and latest_completed:
        longitudinal_summary = {**longitudinal_summary, **base_fields}

    return {"longitudinal": {**longitudinal, "longitudinal_summary": longitudinal_summary}}


async def narrative_agent_node(state: CaseViewState) -> CaseViewState:
    visit = state["visit"]
    longitudinal = state["longitudinal"]
    completed_visits = visit["completed_visits"]
    previous_visit, current_visit = completed_visits[-2], completed_visits[-1]
    trends = longitudinal["trends"]

    narrative = await generate_longitudinal_narrative(
        previous_visit["visit_summary"],
        current_visit["visit_summary"],
        trends,
        previous_visit["visit_number"],
        current_visit["visit_number"],
        current_disease_status=current_visit.get("disease_status"),
    )
    comparison = {**trends, "overall_ai_assessment": narrative}

    prior_summary = longitudinal.get("longitudinal_summary") or {}
    history = list(prior_summary.get("history", []))
    history.append({
        "previous_visit": previous_visit["visit_number"],
        "current_visit": current_visit["visit_number"],
        "comparison": comparison,
    })

    carried_fields = {
        k: v for k, v in prior_summary.items()
        if k not in ("comparison", "history", "latest_completed_visit")
    }

    longitudinal_summary = {
        "latest_completed_visit": visit["latest_completed_visit"],
        "comparison": comparison,
        "history": history,
        **carried_fields,
    }
    return {"longitudinal": {**longitudinal, "narrative": narrative, "longitudinal_summary": longitudinal_summary}}


def build_case_view_node(state: CaseViewState) -> CaseViewState:
    inp = state["input"]
    case_view_data = build_frontend_json(
        patient_id=inp["patient_id"],
        doctor_id=inp["doctor_id"],
        patient_information=state["patient"].get("patient_information", {}),
        visits_by_number=state["visit"]["visits_by_number"],
        longitudinal_summary=state["longitudinal"].get("longitudinal_summary"),
    )
    return {"output": {**_ns(state, "output"), "case_view_data": case_view_data}}


def create_record_node(state: CaseViewState) -> CaseViewState:
    inp = state["input"]
    visits_by_number = state["visit"]["visits_by_number"]
    case_view_data = state["output"]["case_view_data"]

    stored_visits = [
        {k: v for k, v in visits_by_number[n].items() if k != "_document_ids"}
        for n in sorted(visits_by_number.keys())
    ]
    stored_data = {**case_view_data, "visits": stored_visits}

    mongo_record = {
        "patient_id": inp["patient_id"],
        "doctor_id": inp["doctor_id"],
        "generated_at": datetime.utcnow().isoformat(),
        "data": stored_data,
    }

    return {
        "output": {
            **state["output"],
            "mongo_record": mongo_record,
            "record": {**mongo_record, "data": case_view_data},
        }
    }


async def persist_case_view_node(state: CaseViewState) -> CaseViewState:
    inp = state["input"]
    mongo_record = state["output"]["mongo_record"]

    await longitudinal_case_view.update_one(
        {"patient_id": inp["patient_id"]},
        {"$set": mongo_record},
        upsert=True,
    )

    logger.info(
        f"[agentic] Longitudinal case view updated for patient={inp['patient_id']} "
        f"doctor={inp['doctor_id']} document_id={inp['document_id']} "
        f"visit_number={state['visit']['visit_info']['visit_number']} "
        f"({len(state['visit']['visits_by_number'])} visits total, "
        f"latest_completed={state['visit'].get('latest_completed_visit')})"
    )
    return {"output": state["output"]}


# =====================================================================
# GRAPH BUILDER
# =====================================================================
def build_case_view_graph():
    graph = StateGraph(CaseViewState)

    graph.add_node("load_existing_state", load_existing_state_node)
    graph.add_node("handle_already_processed", skip_already_processed_node)
    graph.add_node("extraction_agent", extraction_agent_node)
    graph.add_node("determine_visit", determine_visit_node)
    graph.add_node("merge_document", merge_document_node)
    graph.add_node("recompute_visit_statuses", recompute_visit_statuses_node)
    graph.add_node("visit_summary_agent", visit_summary_agent_node)
    graph.add_node("load_patient_information", load_patient_information_node)
    graph.add_node("find_completed_visits", find_completed_visits_node)
    graph.add_node("compute_numeric_trends", compute_numeric_trends_node)
    graph.add_node("compute_visit_delta", compute_visit_delta_node)
    graph.add_node("compute_overall_trends", compute_overall_trends_node)
    graph.add_node("compute_analytics_layers", compute_analytics_layers_node)
    graph.add_node("prepare_longitudinal_summary", prepare_longitudinal_summary_node)
    graph.add_node("narrative_agent", narrative_agent_node)
    graph.add_node("build_case_view", build_case_view_node)
    graph.add_node("create_record", create_record_node)
    graph.add_node("persist_case_view", persist_case_view_node)

    graph.set_entry_point("load_existing_state")

    graph.add_conditional_edges(
        "load_existing_state",
        lambda s: "handle_already_processed" if s["already_processed"] else "extraction_agent",
        {"handle_already_processed": "handle_already_processed", "extraction_agent": "extraction_agent"},
    )
    graph.add_edge("handle_already_processed", END)

    graph.add_edge("extraction_agent", "determine_visit")
    graph.add_edge("determine_visit", "merge_document")
    graph.add_edge("merge_document", "recompute_visit_statuses")

    graph.add_edge("recompute_visit_statuses", "visit_summary_agent")
    graph.add_edge("visit_summary_agent", "load_patient_information")
    graph.add_edge("load_patient_information", "find_completed_visits")

    graph.add_edge("find_completed_visits", "compute_numeric_trends")
    graph.add_edge("compute_numeric_trends", "compute_visit_delta")
    graph.add_edge("compute_visit_delta", "compute_overall_trends")
    graph.add_edge("compute_overall_trends", "compute_analytics_layers")
    graph.add_edge("compute_analytics_layers", "prepare_longitudinal_summary")

    graph.add_conditional_edges(
        "prepare_longitudinal_summary",
        lambda s: "narrative_agent" if s["longitudinal"].get("trends") is not None else "build_case_view",
        {"narrative_agent": "narrative_agent", "build_case_view": "build_case_view"},
    )
    graph.add_edge("narrative_agent", "build_case_view")

    graph.add_edge("build_case_view", "create_record")
    graph.add_edge("create_record", "persist_case_view")
    graph.add_edge("persist_case_view", END)

    return graph.compile()


_case_view_graph = build_case_view_graph()


# =====================================================================
# MAIN ENTRY POINT -- call this once per newly processed document
# =====================================================================
async def generate_longitudinal_case_view(
    patient_id: str,
    document_text: str,
    document_date: Optional[str],
    file_name: Optional[str],
    document_id: str,
    doctor_id: Optional[str] = None,
) -> Dict[str, Any]:
    initial_state: CaseViewState = {
        "input": {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "document_text": document_text,
            "document_date": document_date,
            "file_name": file_name,
            "document_id": document_id,
        }
    }
    final_state = await _case_view_graph.ainvoke(initial_state)
    return final_state.get("output", {}).get("record", {})


# =====================================================================
# OPTIONAL BACKFILL UTILITY -- NOT part of the per-upload path
# =====================================================================
async def rebuild_longitudinal_case_view_from_history(patient_id: str) -> Dict[str, Any]:
    cursor = processed_documents.find(
        {"patient_id": patient_id}
    ).sort("metadata.document_date", 1)

    result = {}
    async for doc in cursor:
        result = await generate_longitudinal_case_view(
            patient_id=patient_id,
            document_text=doc.get("raw_text") or "",
            document_date=doc.get("metadata", {}).get("document_date"),
            file_name=doc.get("file_name"),
            document_id=doc.get("document_id"),
        )
    return result


# ------------------- HTTP ENDPOINTS -------------------

@router.post("/internal/case-view/generate")
async def generate_case_view_endpoint(req: GenerateCaseViewRequest):
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
async def get_case_view(patient_id: str):
    record = await longitudinal_case_view.find_one({"patient_id": patient_id})
    if not record:
        raise HTTPException(status_code=404, detail="Case view not generated yet for this patient")
    record.pop("_id", None)
    for v in record.get("data", {}).get("visits", []):
        v.pop("_document_hash", None)
    return record