"""
Oncology Case View Service — Agentic (LangGraph) Version, v4 + Phase 1
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

PHASE 1 ADDITIONS (this version)
---------------------------------
Adds three new deterministic (non-LLM) layers on top of v4, computed once
per document-processing run, right after find_completed_visits:

  - build_cancer_case_identity  -- the stable identity of the patient's
    cancer (diagnosis / organ / site / histology / grade / stage / TNM),
    resolved by scanning fields_by_category across every completed visit,
    with full provenance and preserved conflicts. No cancer-type logic.
  - build_t0_baseline            -- the patient's measurable/clinical
    state at the earliest cancer-defining visit.
  - build_treatment_baselines    -- one entry per treatment LINE (reusing
    the existing compute_treatment_history line assignment), each with
    the pre-treatment baseline state.

These are computed in parallel with, not instead of, the existing
trend/delta/timeline/narrative pipeline, and are stored as new top-level
keys (cancer_case_identity, t0_baseline, treatment_baselines) alongside
visits/longitudinal_summary in the same Mongo record.

GRAPH
-----
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
    build_phase1_baseline           deterministic  (NEW)
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
from typing import Optional, List, Dict, Any, Union, TypedDict, Tuple

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorClient
from groq import Groq
from loguru import logger
import asyncio

from langgraph.graph import StateGraph, END

# ------------------- CONFIG -------------------
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = os.getenv("MONGO_DB")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

_client = AsyncIOMotorClient(MONGO_URI)
_db = _client[MONGO_DB]

processed_documents = _db.processed_documents
patient_appointments = _db.patient_appointments
doctor_user_collection = _db.doctor_users
patient_user_collection = _db.patient_users
longitudinal_case_view = _db.longitudinal_case_view

groq_client = Groq(api_key=GROQ_API_KEY)
GROQ_MODEL = "openai/gpt-oss-120b"

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


# ===================================================================
# LOAD APPOINTMENTS (deterministic, patient-wide — never doctor-filtered)
# =====================================================================
async def get_doctor_details(doctor_id: Optional[str]) -> Dict[str, Any]:
    """Pure identity lookup -- resolves a doctor_id into display/attribution
    metadata (name, specialization, hospital). No clinical or disease logic
    of any kind; identical behavior for every doctor."""
    if not doctor_id:
        return {"doctor_id": None, "doctor_name": None, "specialization": None, "hospital_id": None}

    doctor = await doctor_user_collection.find_one(
        {"sys_user_id": doctor_id},
        {"_id": 0, "sys_user_id": 1, "name": 1, "specialization": 1, "hospital_id": 1},
    )
    if not doctor:
        logger.warning(f"Doctor not found: {doctor_id}")
        return {"doctor_id": doctor_id, "doctor_name": None, "specialization": None, "hospital_id": None}

    return {
        "doctor_id": doctor.get("sys_user_id"),
        "doctor_name": doctor.get("name"),
        "specialization": doctor.get("specialization"),
        "hospital_id": doctor.get("hospital_id"),
    }


async def load_patient_appointments(patient_id: str) -> List[dict]:
    """Loads EVERY appointment for this patient across every doctor and
    specialty -- NEVER filtered to a single doctor_id. The longitudinal
    case belongs to the patient; doctor/specialty is attribution metadata
    carried on each appointment, not a filter on which appointments exist.
    """
    patient_doc = await patient_appointments.find_one({"sys_user_id": patient_id})
    if not patient_doc:
        return []

    raw_appointments = patient_doc.get("appointments") or []

    enriched_appointments: List[dict] = []
    for appointment in raw_appointments:
        doctor_details = await get_doctor_details(appointment.get("doctor_id"))
        enriched_appointments.append({
            **appointment,
            "doctor_id": doctor_details.get("doctor_id"),
            "doctor_name": doctor_details.get("doctor_name"),
            "specialization": doctor_details.get("specialization"),
            "hospital_id": doctor_details.get("hospital_id"),
        })

    def sort_key(a: dict):
        d = _parse_date(a.get("date"))
        return d or date.min

    return sorted(enriched_appointments, key=sort_key)

# =====================================================================
# DETERMINE VISIT (deterministic — grouped by UNIQUE CLINICAL DATE,
# never by appointment list position/doctor)
# =====================================================================
def determine_visit(document_date: Optional[str], appointments: List[dict]) -> Dict:
    """A visit_number is derived purely from the UNIQUE CLINICAL DATE an
    appointment belongs to. Multiple appointments (different doctors,
    different specialties) that share the same date all collapse into the
    SAME visit -- this function has no notion of "doctor" as a grouping
    key, only "date". This is pure date arithmetic: identical logic for
    every patient and every cancer type, with zero hardcoded rules.
    """
    doc_dt = _parse_date(document_date)

    appointments_by_date: Dict[date, List[dict]] = {}
    for appointment in appointments or []:
        appt_date = _parse_date(appointment.get("date"))
        if appt_date is None:
            continue
        appointments_by_date.setdefault(appt_date, []).append(appointment)

    unique_dates = sorted(appointments_by_date.keys())

    if not unique_dates or doc_dt is None:
        logger.warning(
            f"No appointment schedule / document_date available; "
            f"defaulting document_date={document_date!r} to visit 1."
        )
        return {
            "appointment_id": None,
            "visit_number": 1,
            "appointment_date": doc_dt.isoformat() if doc_dt else None,
            "visit_start_date": doc_dt.isoformat() if doc_dt else None,
            "visit_end_date": None,
            "appointments": [],
        }

    def _build_result(visit_date: date, visit_number: int) -> Dict:
        same_day_appointments = appointments_by_date[visit_date]
        later_dates = [d for d in unique_dates if d > visit_date]
        visit_end = min(later_dates) if later_dates else None
        return {
            "appointment_id": same_day_appointments[0].get("appointment_id"),
            "visit_number": visit_number,
            "appointment_date": visit_date.isoformat(),
            "visit_start_date": visit_date.isoformat(),
            "visit_end_date": visit_end.isoformat() if visit_end else None,
            "appointments": same_day_appointments,
        }

    # Exact match: document date lands on a real clinical date.
    if doc_dt in appointments_by_date:
        visit_number = unique_dates.index(doc_dt) + 1
        return _build_result(doc_dt, visit_number)

    # No exact match: attach to the most recent PRIOR clinical date.
    prior_dates = [d for d in unique_dates if d <= doc_dt]
    if prior_dates:
        visit_date = max(prior_dates)
        visit_number = unique_dates.index(visit_date) + 1
        return _build_result(visit_date, visit_number)

    # Document predates every known appointment: attach to visit 1
    # rather than inventing a new/negative visit.
    first_date = unique_dates[0]
    return _build_result(first_date, 1)

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

# No translation table. A measurement's "category" IS the document's own
# structural classification -- the same primary_category value the
# extraction agent already assigned from the fixed VISIT_BUCKETS enum.
# Renaming it to a display label was pure indirection with zero
# information gain; every consumer downstream can format the raw value
# itself if it wants a display string.
def _measurement_category_for_document(primary_category: Optional[str]) -> str:
    category = (primary_category or "other").strip().lower()
    return category if category in VISIT_BUCKETS else "other"




def _direction_tally(metrics: List[dict]) -> Dict[str, int]:
    tally = {"Improving": 0, "Worsening": 0, "Stable": 0, "Other": 0}
    for m in metrics or []:
        trend = m.get("trend")
        if trend in tally:
            tally[trend] += 1
        else:
            tally["Other"] += 1
    return tally




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

DOCUMENT TYPE METADATA:
The file name given below (see "FILE NAME") is system-generated metadata
describing the source document. Treat it as a STRONG structural signal
for choosing "primary_category" -- weigh it at least as heavily as the
document text itself, and do not invent or reinterpret the document's
type when the file name clearly identifies it. For example: a file name
describing a chemotherapy, radiation, surgery, immunotherapy, or other
treatment workflow identifies a "treatment" document -- classify it as
primary_category = "treatment" and capture the specific treatment type
in the "modality" field, NOT as "consultation". A file name describing a
dictation or consultation note identifies a "consultation" document. A
file name describing vitals identifies a "vitals" document. This rule is
about the document's structural TYPE only -- the actual clinical DETAILS
(what treatment, what values, what findings) still come entirely from
the document content, never from the file name.

Read the document below and:

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
6. "vitals" fields must be extracted with an EXPLICIT value/unit
   structure so downstream code can trend them precisely -- never as a
   combined string. For a SIMPLE vital (height, weight, bmi, pulse,
   temperature, spo2, ecog, or any other single-number vital the
   document reports), use:
     {{"<field_name>": {{"value": <number>, "unit": "<unit or null>"}}}}
   For a COMPOUND vital reported as two numbers together (most commonly
   blood pressure, e.g. "BP 110/60"), extract EACH number as its own
   separately named sub-field, in the SAME ORDER they appear in the
   source text -- never combine them into one string and never swap
   which number belongs to which sub-field:
     {{"bp": {{"systolic": {{"value": <first number>, "unit": "mmHg"}},
              "diastolic": {{"value": <second number>, "unit": "mmHg"}}}}}}
   This same value/unit-object pattern applies to ANY other compound
   vital the document reports -- split it into clearly and separately
   named sub-fields, each with its own "value"/"unit", preserving the
   exact order and pairing given in the source text.
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
     - "status": the treatment's OWN administration status, TRANSCRIBED
       exactly as the document states or clearly implies it (e.g.
       "planned", "pending", "on hold", "scheduled", "in progress",
       "active", "ongoing", "completed", "discontinued") -- never invent
       a status word the document doesn't support.
     - "administered": true | false -- true ONLY if the document
       describes this specific treatment actually being GIVEN (a dose
       delivered, a cycle administered, a procedure performed). false if
       the document is only discussing, planning, ordering, or
       scheduling it. Omit this field if you genuinely can't tell --
       never guess.
     - "cycle_number": integer -- the SPECIFIC cycle THIS document is
       reporting on (e.g. a note about "Cycle 3 Day 1"), if stated. This
       is distinct from "cycles_completed" below: one answers "which
       cycle does this document describe", the other answers "how many
       cycles has the patient completed in total so far".
     - "cycles_completed": integer -- the CUMULATIVE number of cycles
       completed so far, if stated.
     - "reason_for_change": short string -- why this regimen replaced or
       ended a prior one (e.g. "toxicity", "disease progression",
       "completed planned cycles"), ONLY if the document actually says so.
   Omit any of these seven sub-fields you cannot support from the text --
   never guess a line, cycle number, status, or administered flag. A
   tumor board plan, a consult recommending a regimen, or an order for a
   future treatment is NOT the same as the treatment being given --
   describe it as what the document actually says, and only set
   "administered": true when the document documents it actually happening.
9. Use only information explicitly present in the document -- never
   invent values, dates, or fields. Omit a category from
   fields_by_category entirely if it has nothing to contribute.

STRUCTURED CLINICAL SUB-SCHEMAS (apply inside fields_by_category; identical
key names across every cancer type -- solid tumor or hematologic. Omit any
key the document does not actually support; never invent one):

- "pathology" fields, when the document supports them, should use these key
  names so they can be merged deterministically downstream:
    "diagnosis", "organ", "site", "histology", "subtype", "grade",
    "differentiation", "tumor_size", "tumor_depth",
    "lymph_nodes_examined", "lymph_nodes_positive", "margins",
    "margin_status", "necrosis", "mitotic_rate", "lvi", "pni",
    "stage" (a plain string like "Stage III"),
    "tnm": {{"t": "...", "n": "...", "m": "..."}},
    "ihc": [ {{"marker": "...", "result": "...", "status": "..."}} ].
  "ihc" entries are for ANY immunohistochemistry marker the report names --
  do not limit yourself to a fixed marker list, and do not omit a marker
  just because it's unfamiliar. "tumor_size" / "tumor_depth" belong here
  as short strings exactly as documented (e.g. "4.2 cm") for readability
  on the pathology panel -- the SAME value should ALSO appear as its own
  entry in the universal "clinical_measurements" list below so it
  participates in longitudinal numeric trending, mirroring how
  "tumor_markers" already gives both a semantic dict entry and a numeric
  clinical_measurements entry for the same value.

- "molecular" fields, when supported, should use:
    "test_name", "specimen",
    "mutations": [ {{"gene": "...", "alteration": "...", "variant_type": "...", "status": "..."}} ],
    "amplifications": [...], "deletions": [...], "fusions": [...],
    "msi", "tmb", "loh" -- whatever the report actually reports.

- "imaging" fields, when supported, should use:
    "modality", "body_site", "findings" (list of short strings),
    "impression", "stage" (if the imaging report states one),
    "tnm" (same {{"t","n","m"}} shape as pathology, if stated).

- "treatment" fields, in addition to what's already required above, should
  also include when stated: "regimen_name", "drugs" (list), "dose",
  "schedule", "start_date".

- "tumor_markers" fields should be a flat dict of marker name -> value as
  documented (e.g. {{"CEA": 25.4}}), in addition to the corresponding entry
  in clinical_measurements.

UNIVERSAL MEASUREMENT EXTRACTION (this replaces any notion of "which
metrics matter for this disease"):

10. Extract "clinical_measurements" -- a FLAT LIST of every single
    quantifiable value this document states, no matter what it measures
    or how routine or unusual it seems. Do NOT decide whether something
    is clinically important, and do NOT decide which "kind" of metric it
    is -- that classification happens later, deterministically, in code.
    SCOPE LIMIT: clinical_measurements is for DISEASE/TREATMENT/CLINICAL
    findings only. It NEVER includes the patient's own demographic or
    identity attributes -- age, date of birth, sex/gender, name, medical
    record/identifier numbers, contact details. Those describe WHO the
    patient is, not a clinical observation about their disease or
    treatment, and must never get an entry here even when the number
    appears in narrative text (e.g. "a 62-year-old patient presented...").
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
13. "symptoms" -- patient-reported or clinically documented symptoms.

Actively scan the ENTIRE document, especially free-text fields such as
chief_complaints, history/HPI, review of systems, clinical_assessment,
and relevant treatment/clinical notes, for actual symptom mentions.

Extract only symptoms/signs that are actually documented in the source.

For each symptom return:

{{
  "name": "...",
  "severity": "...",
  "trend": "..."
}}

Severity rules:
- Preserve an explicitly documented numeric severity, such as 5, 7/10,
  or 3/10.
- Preserve explicitly documented qualitative severity such as:
  "mild", "minimal", "moderate", "severe", or "very severe".
- Preserve the severity wording exactly as documented whenever possible.
- Do NOT convert qualitative severity into a number in the extracted JSON.
- If severity is not documented, use null.
- NEVER infer or invent severity from the diagnosis, cancer stage,
  imaging, pathology, treatment, or clinical context.

Trend rules:
- Preserve an explicitly documented trend such as:
  "improving", "worsening", "stable", "unchanged", "resolved",
  or "persistent".
- If the source explicitly states that the symptom is getting
  better, getting worse, resolving, persisting, or remaining
  unchanged, capture that as the trend.
- If no trend is documented, use null.
- NEVER infer or invent a trend.

Do NOT include diagnoses, diseases, cancer types, imaging findings,
pathology findings, laboratory abnormalities, treatment plans, or
generic clinical conditions as symptoms.
14. "medications" -- medication-level information explicitly documented
in this document.

Actively scan the ENTIRE document, especially doctor_plan,
treatment-plan text, prescriptions, medication lists, assessment,
and clinical notes, for NAMED medications.

For each medication return:

{{
  "drug": "...",
  "action": "started"|"stopped"|"dose_changed"|"continued"|null,
  "dose": "..." or null,
  "reason": "..." or null
}}

Medication rules:

- Extract each named medication as its own entry.
- Preserve the medication name as documented.
- Extract chemotherapy agents, hormone therapy, targeted therapy,
  immunotherapy, supportive medications, analgesics, anti-emetics,
  steroids, antibiotics, and other named medications when documented.
- If the medication is explicitly started, use "started".
- If explicitly discontinued/stopped, use "stopped".
- If the dose is explicitly changed, use "dose_changed".
- If the medication is explicitly continued, use "continued".
- If the medication is mentioned but the action is not documented,
  use null for action.
- Preserve the explicitly documented dose.
- Preserve the explicitly documented reason for starting, stopping,
  continuing, or changing the dose.
- If dose is not documented, use null.
- If reason is not documented, use null.
- NEVER infer that a medication was started, stopped, continued,
  or dose-changed from context alone.
- NEVER invent a dose or reason.
- Do not treat a medication merely appearing in a historical
  medication list as newly started or currently active unless
  the source explicitly states this.
15. "clinical_decisions" -- explicit decisions made and their reasons:
    [{{"decision": "...", "reason": "...", "decided_by": "..." or null}}].
16. "pending_actions" -- investigations, referrals, or follow-ups this
    document orders or flags as outstanding: ["...", "..."].
17. "completed_actions" -- items this document reports as NOW completed
    (use this to close out something that may have been pending from an
    earlier visit, e.g. "PET CT" once the PET CT report itself arrives):
    ["...", "..."].
18. "alerts" -- safety-relevant flags explicitly supported by the
document that a covering clinician should see at a glance.

For each alert return:

{{
  "priority": "high" | "medium" | "low",
  "title": "short description of the alert exactly supported by
            the document",
  "attributes": {{
      "<attribute_name>": "<attribute_value>"
  }}
}}

The "attributes" object is open-ended. Include only attributes
actually supported by the document that help describe the identity
or state of the alert.

Do not use a predefined attribute list.
Do not infer attributes.
Do not create an attribute merely because it would normally be
useful for a particular type of alert.
19. "resolved_alerts" -- titles of alerts raised in a PRIOR document/visit
    that THIS document indicates are now resolved, recovered, or no
    longer relevant. Only include a title here if this document actually
    supports closing it out -- do not invent resolutions. List of
    strings: ["...", "..."].
19a. "clinical_attributes" -- a GENERIC SAFETY NET for clinically
    meaningful facts stated in the document that do NOT fit any of the
    structured schemas above (fields_by_category, clinical_measurements,
    clinical_events, disease_status, symptoms, medications,
    clinical_decisions, pending_actions, completed_actions, alerts,
    tumor_markers, treatment). If a fact is already fully captured by one
    of those, do NOT duplicate it here -- use this ONLY for facts that
    would otherwise be lost. Each item:
      {{"name": "<the fact's own name/label, exactly as the document
        phrases or implies it, e.g. 'grade', 'ER status', 'performance
        status'>",
        "value": "<the fact's value, exactly as documented>",
        "context": "<one short phrase of surrounding context, or null>",
        "source_category": "<which VISIT_BUCKETS category this fact came
        from>"}}
    Do not invent a name or value; only transcribe what is explicitly
    stated.
19b. "clinical_recommendations" -- ANY recommendation, opinion, or
    decision from a clinician, specialist, or multidisciplinary/tumor
    board discussion, regardless of which document category it appears
    in (a consultation note, a tumor board note, a specialist opinion
    letter, an MDT summary, etc). Each item:
      {{"recommendation": "<the recommendation itself, as stated>",
        "reason": "<the stated rationale, or null>",
        "source": "<who/what made the recommendation, e.g. 'tumor
        board', 'medical oncology', 'radiology', exactly as stated, or
        null>",
        "specialty": "<the specialty/discipline it came from, if
        stated, or null>",
        "status": "<e.g. 'proposed', 'accepted', 'pending', if stated,
        or null>"}}
    Only populate values actually supported by the document text -- never
    invent a source or specialty that isn't stated.
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
  "clinical_attributes": [ {{"name": "...", "value": "...", "context": null, "source_category": "..."}} ],
  "clinical_recommendations": [ {{"recommendation": "...", "reason": null, "source": null, "specialty": null, "status": null}} ],
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
    "resolved_alerts", "clinical_attributes", "clinical_recommendations",
)

_DEMOGRAPHIC_MEASUREMENT_NAMES = {
    "age",
    "patient age",
    "dob",
    "date of birth",
    "birth date",
    "sex",
    "gender",
}

def _is_demographic_measurement(name: Any) -> bool:
    if not isinstance(name, str):
        return False

    normalized = re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()

    return normalized in _DEMOGRAPHIC_MEASUREMENT_NAMES

def _measurement_value(entry: Any) -> Any:
    return entry.get("value") if isinstance(entry, dict) else entry


# ===================================================================
# CHUNKED EXTRACTION (fixes the fixed 12,000-character truncation)
# -----------------------------------------------------------------------
# The extraction LLM has a bounded context window per call, so a single
# call can only safely see a bounded slice of text. Rather than silently
# truncating the document (dropping anything past a fixed character
# count), the FULL document is split into overlapping chunks, EVERY
# chunk is sent through the same single-chunk extractor, and the
# per-chunk results are merged back into one document-level extraction
# deterministically. This is purely mechanical (character counting +
# structural merge) -- no content awareness, no per-document-type
# behavior -- so it is identical for a one-page note or a fifty-page
# tumor board packet, for any cancer type.
# =====================================================================
_MAX_EXTRACTION_CHUNK_CHARS = 10000
_EXTRACTION_CHUNK_OVERLAP_CHARS = 400


def _chunk_document_text(
    document_text: str,
    max_chars: int = _MAX_EXTRACTION_CHUNK_CHARS,
    overlap: int = _EXTRACTION_CHUNK_OVERLAP_CHARS,
) -> List[str]:
    """Splits a document into overlapping chunks so the extraction LLM
    sees the ENTIRE document text, not just the first max_chars. The
    small overlap ensures a fact split across a chunk boundary still
    lands intact in at least one chunk."""
    text = document_text or ""
    if len(text) <= max_chars:
        return [text]

    chunks: List[str] = []
    start = 0
    text_len = len(text)
    while start < text_len:
        end = min(start + max_chars, text_len)
        chunks.append(text[start:end])
        if end >= text_len:
            break
        start = end - overlap  # step back so nothing is lost at the seam
    return chunks


def _dedupe_dicts(items: List[dict]) -> List[dict]:
    seen = set()
    result: List[dict] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        sig = json.dumps(item, sort_keys=True, default=str)
        if sig in seen:
            continue
        seen.add(sig)
        result.append(item)
    return result

# =====================================================================
# GENERIC ALERT CANONICALIZATION
# =====================================================================

def _normalize_comparable_text(value: Any) -> str:
    """
    Normalize representation only.

    This function has NO clinical vocabulary, keyword list,
    synonym mapping, disease knowledge, or cancer-specific logic.
    """

    if value is None:
        return ""

    text = str(value)

    # Normalize Unicode punctuation.
    text = (
        text.replace("\u2013", "-")
            .replace("\u2014", "-")
            .replace("\u2212", "-")
            .replace("\u2018", "'")
            .replace("\u2019", "'")
            .replace("\u201c", '"')
            .replace("\u201d", '"')
    )

    # Case-insensitive comparison.
    text = text.casefold()

    # Treat punctuation differences as representation differences.
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)

    # Collapse repeated whitespace.
    text = re.sub(r"\s+", " ", text).strip()

    return text


def _canonicalize_alert_value(value: Any) -> Any:
    """
    Recursively canonicalize an alert for structural comparison.

    No semantic/medical interpretation is performed.
    """

    if isinstance(value, dict):
        return {
            key: _canonicalize_alert_value(value[key])
            for key in sorted(value.keys())
        }

    if isinstance(value, list):
        canonical_items = [
            _canonicalize_alert_value(item)
            for item in value
        ]

        # Lists containing primitive/scalar values can be compared
        # independently of ordering.
        if all(
            not isinstance(item, (dict, list))
            for item in canonical_items
        ):
            return sorted(
                canonical_items,
                key=lambda item: str(item),
            )

        return canonical_items

    if isinstance(value, str):
        return _normalize_comparable_text(value)

    return value


_TEXT_ASSERTION_MATCH_THRESHOLD = 0.55


def _find_fuzzy_text_match(
    text: str,
    known_texts: List[str],
    threshold: float = _TEXT_ASSERTION_MATCH_THRESHOLD,
) -> Optional[str]:
    """Generic, disease-agnostic fuzzy match: finds an entry in
    `known_texts` lexically close enough to `text` to represent the SAME
    underlying clinical assertion (an alert, a disease-status statement,
    etc.), reusing the same similarity function (_metric_name_similarity)
    already relied on elsewhere in this pipeline to reconcile
    differently-worded mentions of the same fact across chunked/
    re-extracted documents. No keyword list, synonym table, or
    disease-specific vocabulary -- purely lexical similarity, identical
    behavior for any assertion about any condition or cancer type."""
    if not text:
        return None
    best_text, best_score = None, 0.0
    for existing in known_texts:
        score = _metric_name_similarity(text, existing)
        if score >= threshold and score > best_score:
            best_score = score
            best_text = existing
    return best_text


def _cluster_text_assertions(
    texts: List[str],
    threshold: float = _TEXT_ASSERTION_MATCH_THRESHOLD,
) -> List[str]:
    """Generic dedup for a list of free-text clinical assertions that may
    be phrased slightly differently across documents/chunks describing
    the SAME underlying fact. Keeps the shortest (fewest-token) phrasing
    per cluster -- the same tie-break already used to canonicalize
    metric names elsewhere -- preserving first-seen order otherwise."""
    canonical: List[str] = []
    for text in texts or []:
        if not text:
            continue
        match = _find_fuzzy_text_match(text, canonical, threshold)
        if match is None:
            canonical.append(text)
        elif len(_tokenize_metric_name(text)) < len(_tokenize_metric_name(match)):
            canonical[canonical.index(match)] = text
    return canonical

def _merge_alert_records(
    existing: Dict[str, Any],
    incoming: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Merge two alerts that have already been proven to represent
    the same canonical structure.

    No clinical interpretation occurs here.
    """

    merged = dict(existing)

    for key, value in incoming.items():

        if value in (None, "", [], {}):
            continue

        if key not in merged:
            merged[key] = value
            continue

        if merged[key] in (None, "", [], {}):
            merged[key] = value

    return merged


def _dedupe_alerts(alerts: List[dict]) -> List[dict]:
    """
    Deterministic, disease-agnostic alert deduplication.

    Alerts describing the SAME underlying fact are frequently re-emitted
    with slightly different wording across chunked extractions of one
    document, or across the several documents uploaded at a single
    visit. Two alerts merge only when their titles are lexically close
    enough (via the same generic _metric_name_similarity function used
    to reconcile differently-worded metric names elsewhere) -- never via
    a keyword list, synonym table, or disease-specific vocabulary.
    """
    canonical_titles: List[str] = []
    by_title: Dict[str, Dict[str, Any]] = {}

    for alert in alerts or []:
        if not isinstance(alert, dict):
            continue
        title = alert.get("title")
        if not title:
            continue

        match = _find_fuzzy_text_match(title, canonical_titles)

        if match is None:
            canonical_titles.append(title)
            by_title[title] = dict(alert)
            continue

        merged = _merge_alert_records(by_title[match], alert)

        if len(_tokenize_metric_name(title)) < len(_tokenize_metric_name(match)):
            del by_title[match]
            canonical_titles[canonical_titles.index(match)] = title
            merged["title"] = title
            by_title[title] = merged
        else:
            merged["title"] = match
            by_title[match] = merged

    return list(by_title.values())

def _dedupe_strings(items: List[Optional[str]]) -> List[str]:
    seen = set()
    result: List[str] = []
    for item in items:
        if not isinstance(item, str) or not item:
            continue
        if item in seen:
            continue
        seen.add(item)
        result.append(item)
    return result


def _merge_chunk_measurements(all_measurements: List[List[dict]]) -> List[dict]:
    merged: List[dict] = []
    seen = set()
    for measurements in all_measurements:
        for m in measurements or []:
            if not isinstance(m, dict):
                continue
            sig = json.dumps(m, sort_keys=True, default=str)
            if sig in seen:
                continue
            seen.add(sig)
            merged.append(m)
    return merged


def _merge_chunk_disease_status(statuses: List[Optional[dict]]) -> Optional[dict]:
    """Combines each chunk's disease_status: scalar fields keep the first
    non-empty value seen (chunk order == document order, so this is
    "earliest documented value wins", consistent with how identity fields
    are resolved elsewhere); status_statements union + dedupe."""
    merged: Dict[str, Any] = {}
    all_statements: List[str] = []
    for status in statuses:
        if not status:
            continue
        for k, v in status.items():
            if k == "status_statements":
                all_statements.extend(v or [])
                continue
            if v not in (None, "", [], {}) and not merged.get(k):
                merged[k] = v
    if all_statements:
        merged["status_statements"] = _dedupe_strings(all_statements)
    return merged or None


def _merge_document_chunks(chunk_results: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Deterministically merges per-chunk extraction results back into a
    SINGLE document-level extraction dict, so a document larger than one
    extraction call's context window is never silently truncated -- every
    chunk gets extracted and everything found anywhere in the document
    survives the merge. Pure structural combination (deep-merge for
    nested category fields, concatenate + dedupe for flat lists) -- no
    content interpretation, no cancer-type or document-type-specific
    logic."""
    if not chunk_results:
        return {}
    if len(chunk_results) == 1:
        return chunk_results[0]

    # Document-level classification is a whole-document property: the
    # first chunk's judgement is canonical for primary_category /
    # document_type, but any additional category another chunk's content
    # also touched on is folded into secondary_categories so nothing is
    # lost.
    primary_category = chunk_results[0].get("primary_category", "other")
    document_type = chunk_results[0].get("document_type")
    secondary_categories: List[str] = []
    for c in chunk_results:
        secondary_categories.extend(c.get("secondary_categories") or [])
        if c.get("primary_category") and c["primary_category"] != primary_category:
            secondary_categories.append(c["primary_category"])
    secondary_categories = _dedupe_strings([s for s in secondary_categories if s != primary_category])

    fields_by_category: Dict[str, Any] = {}
    for c in chunk_results:
        for category, fields in (c.get("fields_by_category") or {}).items():
            if not isinstance(fields, dict):
                continue
            fields_by_category[category] = _deep_merge_clinical_dict(
                fields_by_category.get(category, {}), fields
            )

    return {
        "primary_category": primary_category,
        "secondary_categories": secondary_categories,
        "document_type": document_type,
        "fields_by_category": fields_by_category,
        "clinical_measurements": _merge_chunk_measurements(
            [c.get("clinical_measurements") for c in chunk_results]
        ),
        "clinical_events": _dedupe_dicts(
            [e for c in chunk_results for e in (c.get("clinical_events") or [])]
        ),
        "disease_status": _merge_chunk_disease_status(
            [c.get("disease_status") for c in chunk_results]
        ),
        "symptoms": _dedupe_dicts(
            [s for c in chunk_results for s in (c.get("symptoms") or [])]
        ),
        "medications": _dedupe_dicts(
            [m for c in chunk_results for m in (c.get("medications") or [])]
        ),
        "clinical_decisions": _dedupe_dicts(
            [d for c in chunk_results for d in (c.get("clinical_decisions") or [])]
        ),
        "pending_actions": _dedupe_strings(
            [p for c in chunk_results for p in (c.get("pending_actions") or [])]
        ),
        "completed_actions": _dedupe_strings(
            [p for c in chunk_results for p in (c.get("completed_actions") or [])]
        ),
        "alerts": _dedupe_alerts(
            [a for c in chunk_results for a in (c.get("alerts") or [])]
        ),
        "resolved_alerts": _dedupe_strings(
            [a for c in chunk_results for a in (c.get("resolved_alerts") or [])]
        ),
        "clinical_attributes": _dedupe_dicts(
            [a for c in chunk_results for a in (c.get("clinical_attributes") or [])]
        ),
        "clinical_recommendations": _dedupe_dicts(
            [r for c in chunk_results for r in (c.get("clinical_recommendations") or [])]
        ),
        "summary": " ".join(
            _dedupe_strings([c.get("summary") for c in chunk_results])
        ) or None,
    }


async def _extract_document_chunk(document_text: str, file_name: str) -> Dict[str, Any]:
    """Extraction Agent for ONE chunk of a document (see
    extract_longitudinal_document for chunking/merging across the whole
    document). Single-responsibility LLM call: classify + extract this
    chunk's text. No knowledge of prior visits, patient history, or other
    chunks of the same document."""
    prompt = DOCUMENT_EXTRACTION_PROMPT_TEMPLATE.format(
        buckets=", ".join(VISIT_BUCKETS),
        file_name=file_name or "unknown",
        document_text=document_text or "",
    )

    completion = groq_client.chat.completions.create(
        model=GROQ_MODEL,
        temperature=0.0,
        max_tokens=8000,
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
    # =========================================================
    # NORMALIZE LIST FIELDS
    # =========================================================

    result["clinical_events"] = [
        x for x in (result.get("clinical_events") or [])
        if isinstance(x, dict)
    ]

    result["symptoms"] = [
        x for x in (result.get("symptoms") or [])
        if isinstance(x, dict)
    ]

    result["medications"] = [
        x for x in (result.get("medications") or [])
        if isinstance(x, dict)
    ]

    result["clinical_decisions"] = [
        x for x in (result.get("clinical_decisions") or [])
        if isinstance(x, dict)
    ]

    result["pending_actions"] = [
        x for x in (result.get("pending_actions") or [])
        if isinstance(x, str)
    ]

    result["completed_actions"] = [
        x for x in (result.get("completed_actions") or [])
        if isinstance(x, str)
    ]

    result["alerts"] = [
        x for x in (result.get("alerts") or [])
        if isinstance(x, dict)
    ]

    result["resolved_alerts"] = [
        x for x in (result.get("resolved_alerts") or [])
        if isinstance(x, str)
    ]

    # Generic safety-net facts (see prompt item 19a) -- require a name
    # AND a non-empty value, never invent either.
    result["clinical_attributes"] = [
        x for x in (result.get("clinical_attributes") or [])
        if isinstance(x, dict) and x.get("name") and x.get("value") not in (None, "", [], {})
    ]

    # Any clinician/specialist/tumor-board recommendation (see prompt
    # item 19b) -- require at least the recommendation text itself.
    result["clinical_recommendations"] = [
        x for x in (result.get("clinical_recommendations") or [])
        if isinstance(x, dict) and x.get("recommendation")
    ]

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

            # Never allow demographic/identity values into clinical measurements.
            if _is_demographic_measurement(m.get("name")):
                continue

            if _measurement_value(m) is None:
                continue

            if not isinstance(_measurement_value(m), (int, float)):
                continue

            clean_measurements.append(m)
    result["clinical_measurements"] = clean_measurements

    return result


async def extract_longitudinal_document(document_text: str, file_name: str) -> Dict[str, Any]:
    """Extraction Agent orchestrator. Splits the FULL document into
    overlapping chunks (see _chunk_document_text) so nothing past the old
    fixed 12,000-character cutoff is ever silently dropped, runs the
    single-chunk extractor (_extract_document_chunk) on every chunk, then
    deterministically merges the chunk-level results back into one
    document-level extraction (see _merge_document_chunks). For a
    document that already fits in one chunk this is exactly one
    extraction call, identical to before -- no added cost for the common
    case."""
    chunks = _chunk_document_text(document_text)
    chunk_results: List[Dict[str, Any]] = []
    for idx, chunk_text in enumerate(chunks):
        chunk_label = file_name if len(chunks) == 1 else f"{file_name} (part {idx + 1}/{len(chunks)})"
        chunk_results.append(await _extract_document_chunk(chunk_text, chunk_label))

    if len(chunks) > 1:
        logger.info(
            f"[extraction] {file_name}: document split into {len(chunks)} chunks "
            f"({len(document_text or '')} chars total) and merged deterministically."
        )

    return _merge_document_chunks(chunk_results)


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
        # ALL appointments (any doctor/specialty) sharing this visit's
        # clinical date. "appointment" above stays as a single primary
        # reference for backward compatibility; this list is the full set.
        "appointments": visit_info.get("appointments", []),
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
        # Generic safety net for facts that don't fit any predefined
        # category schema (e.g. a value embedded in narrative prose), and
        # any clinician/specialist/tumor-board recommendation -- see the
        # extraction prompt items 19a/19b above.
        "clinical_attributes": [],
        "clinical_recommendations": [],
        # ----------------------------------------------------------
        "visit_summary": None,
        "documents": [],
        "_document_ids": [],
    }

def _resolve_treatment_bucket_key(fields: dict) -> Tuple[str, bool]:
    """Generic identity resolution for one document's treatment fields —
    mirrors the SAME priority order _treatment_identity()/
    compute_treatment_history() already use downstream, so a bucket key
    assigned here and the eventual treatment-line identity computed later
    are always consistent. Returns (bucket_key, has_identity). has_identity
    is False ONLY when the document truly gave us nothing to identify the
    treatment by (no modality, no regimen/treatment_name/name) — never a
    disease- or modality-specific check."""
    identity = (
        fields.get("modality")
        or fields.get("regimen")
        or fields.get("regimen_name")
        or fields.get("treatment_name")
        or fields.get("name")
    )
    if identity:
        return str(identity).strip().lower(), True
    return "unidentified_treatment", False


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
    elif category not in ("consultation", "vitals", "orders", "treatment", "adverse_event"):
        uploaded = visit.setdefault("uploaded_between_visits", {})
        existing = uploaded.get(category) or {}

        if isinstance(existing, dict) and isinstance(fields, dict):
            uploaded[category] = _deep_merge_clinical_dict(existing, fields)
        else:
            uploaded[category] = fields
    elif category == "treatment":
        bucket_key, has_identity = _resolve_treatment_bucket_key(fields)
        modality_fields = dict(fields)
        if not has_identity:
            modality_fields["_identity_unknown"] = True
        visit["treatment"][bucket_key] = {**visit["treatment"].get(bucket_key, {}), **modality_fields}
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


def _dedupe_measurement_list(measurements: List[dict]) -> List[dict]:
    """Generic, structural dedup for measurements produced within a
    SINGLE document/extraction pass. Two entries are treated as
    duplicate representations of the SAME underlying observation only
    when they carry the EXACT SAME numeric value and the SAME unit --
    the one piece of structural evidence that two differently-worded
    fields describe one fact -- AND their names share at least one
    common token (so two unrelated readings that coincidentally share a
    value/unit are never merged). No field-name pairs, metric names, or
    disease vocabulary are hardcoded anywhere -- identical behavior for
    any measurement, any document, any patient, any cancer type."""
    if not measurements or len(measurements) < 2:
        return measurements or []

    def _unit_key(u):
        return (u or "").strip().lower()

    def _value_key(v):
        return round(float(v), 6) if isinstance(v, (int, float)) else v

    groups: Dict[Tuple[Any, str], List[int]] = {}
    for idx, m in enumerate(measurements):
        if not isinstance(m, dict):
            continue
        key = (_value_key(_measurement_value(m)), _unit_key(m.get("unit")))
        groups.setdefault(key, []).append(idx)

    drop: set = set()
    for _, indices in groups.items():
        if len(indices) < 2:
            continue
        remaining = list(indices)
        while remaining:
            seed_idx = remaining.pop(0)
            seed_tokens = _tokenize_metric_name(measurements[seed_idx].get("name") or "")
            cluster = [seed_idx]
            still_remaining = []
            for other_idx in remaining:
                other_tokens = _tokenize_metric_name(measurements[other_idx].get("name") or "")
                if seed_tokens & other_tokens:
                    cluster.append(other_idx)
                else:
                    still_remaining.append(other_idx)
            remaining = still_remaining
            if len(cluster) < 2:
                continue
            # Keep the entry with the FEWEST name tokens as canonical --
            # a purely structural tie-break, no per-name preference list.
            canonical_idx = min(
                cluster,
                key=lambda i: len(_tokenize_metric_name(measurements[i].get("name") or "")),
            )
            drop.update(i for i in cluster if i != canonical_idx)

    return [m for i, m in enumerate(measurements) if i not in drop]




def _merge_measurements_into_visit(
    visit,
    measurements,
    document_primary_category,
    document_id=None,
    document_date=None,
    all_visits=None,
)-> None:
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
    # Generic structural dedup before anything else touches this list --
    # collapses duplicate representations of the SAME reading that this
    # one document produced under two differently-worded names.
    measurements = _dedupe_measurement_list(measurements)
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
            "source_document_id": document_id,
            "source_document_date": document_date,
        }

        existing_entry = visit["clinical_measurements"].get(canonical_name)
        if isinstance(existing_entry, dict):
            merged_entry = {**existing_entry, **{k: v for k, v in new_entry.items() if v is not None}}
        else:
            merged_entry = new_entry
        visit["clinical_measurements"][canonical_name] = merged_entry


def _derive_measurements_from_vitals(vitals_fields: Optional[dict]) -> List[dict]:
    """Deterministically derives clinical_measurements entries directly
    from the already-extracted, structurally-keyed `vitals` dict instead
    of trusting a SEPARATE, independently-generated LLM
    clinical_measurements list for vitals. Vitals use a small, fixed,
    universal schema (height/weight/bmi/bp/pulse/temperature/spo2/ecog,
    or anything else the document names) -- a value can be read straight
    from its own labeled key, so it can never be cross-associated with
    the wrong vital's name the way a second, independently-generated
    free-form list can. Recursively walks nested {"value","unit"}
    objects (see prompt item 6) so compound readings like blood pressure
    never collapse into one ambiguous number. Also accepts a bare
    numeric leaf for backward compatibility with older extractions. No
    cancer type, keyword list, or disease-specific logic anywhere --
    purely structural, identical for every patient and every vital."""
    measurements: List[dict] = []

    def _walk(path: List[str], node: Any) -> None:
        if isinstance(node, dict):
            if "value" in node and isinstance(node.get("value"), (int, float)):
                measurements.append({
                    "name": " ".join(path),
                    "value": node["value"],
                    "unit": node.get("unit"),
                    "body_site": None,
                    "favorable_direction": "neutral",
                })
                return
            for k, v in node.items():
                _walk(path + [str(k)], v)
        elif isinstance(node, (int, float)):
            measurements.append({
                "name": " ".join(path),
                "value": node,
                "unit": None,
                "body_site": None,
                "favorable_direction": "neutral",
            })

    for key, value in (vitals_fields or {}).items():
        _walk([str(key)], value)

    # Two vitals keys in the SAME document (e.g. a compound reading
    # documented under two different field names) can flatten into two
    # measurements with identical value/unit -- collapse structurally.
    return _dedupe_measurement_list(measurements)


def _reconcile_vitals_measurements(visit: dict) -> None:
    """Deterministic correction pass, run after every document merge:
    makes every numeric field in the visit's OWN structured `vitals`
    dict authoritative in `clinical_measurements`, overwriting any
    conflicting/mislabeled entry a separately-generated LLM list may
    have produced for the same vital. This is what prevents a value
    documented under one vital's label from silently ending up stored
    under a different vital's name. Purely structural -- no cancer type
    or keyword logic; runs identically for every patient and visit."""
    derived = _derive_measurements_from_vitals(visit.get("vitals"))
    if not derived:
        return

    visit.setdefault("clinical_measurements", {})
    known_names = list(visit["clinical_measurements"].keys())

    for m in derived:
        canonical_name = _resolve_canonical_metric_name(m["name"], known_names)
        if canonical_name not in known_names:
            known_names.append(canonical_name)
        existing_entry = visit["clinical_measurements"].get(canonical_name)
        visit["clinical_measurements"][canonical_name] = {
            "value": m["value"],
            "unit": m.get("unit") or (existing_entry or {}).get("unit"),
            "favorable_direction": (existing_entry or {}).get("favorable_direction") or m.get("favorable_direction"),
            "body_site": (existing_entry or {}).get("body_site"),
            "category": "vitals",
        }


def _dedupe_visit_measurements(visit: dict) -> None:
    """Final structural dedup over a visit's WHOLE flat
    clinical_measurements store, run after every document merge. Two
    canonical names are collapsed into one when they currently carry the
    EXACT SAME value and unit AND share at least one name token --
    catching a duplicate that arrived through two different extraction
    paths (free-form list vs. structured vitals walk) for the same
    visit. Purely structural -- no field-name pairs hardcoded."""
    measurements = visit.get("clinical_measurements") or {}
    if len(measurements) < 2:
        return

    def _unit_key(u):
        return (u or "").strip().lower()

    def _value_key(v):
        return round(float(v), 6) if isinstance(v, (int, float)) else v

    groups: Dict[Tuple[Any, str], List[str]] = {}
    for name, entry in measurements.items():
        if not isinstance(entry, dict):
            continue
        key = (_value_key(entry.get("value")), _unit_key(entry.get("unit")))
        groups.setdefault(key, []).append(name)

    drop: set = set()
    for _, names in groups.items():
        if len(names) < 2:
            continue
        remaining = list(names)
        while remaining:
            seed = remaining.pop(0)
            seed_tokens = _tokenize_metric_name(seed)
            cluster = [seed]
            still_remaining = []
            for other in remaining:
                if seed_tokens & _tokenize_metric_name(other):
                    cluster.append(other)
                else:
                    still_remaining.append(other)
            remaining = still_remaining
            if len(cluster) < 2:
                continue

            def _rank(n):
                return (
                    len(_tokenize_metric_name(n)),
                    0 if measurements[n].get("category") == "vitals" else 1,
                )

            canonical = min(cluster, key=_rank)
            drop.update(n for n in cluster if n != canonical)

    for name in drop:
        measurements.pop(name, None)


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
    # Negation MUST be checked before the bare progression pattern below,
    # or "no evidence of disease progression" would match "disease
    # progression" first and be misread as documenting progression.
    (re.compile(r"\bno evidence of (?:recurrence|disease progression|progression|disease)\b|\bcomplete remission\b", re.IGNORECASE), "Complete Response", "Improving"),
    (re.compile(r"\bprogressive disease\b|\bdisease progression\b", re.IGNORECASE), "Progressive Disease", "Progressing"),
    (re.compile(r"\bmixed response\b", re.IGNORECASE), None, "Mixed Response"),
    # "residual disease" removed -- it's a pathology margin/surgical
    # term (e.g. "no residual disease at margins"), not a progression
    # indicator, and was causing false positives on newly-diagnosed
    # pathology reports.
    (re.compile(r"\brelapse[d]?\b|\brecurrence\b", re.IGNORECASE), "Progressive Disease", "Progressing"),
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

    # =========================================================
    # ALERTS
    # =========================================================

    visit.setdefault("alerts", [])

    visit["alerts"] = _dedupe_alerts(
        [
            *visit.get("alerts", []),
            *(extraction.get("alerts") or []),
        ]
    )

    visit.setdefault(
        "resolved_alerts",
        []
    )

    for title in (
        extraction.get("resolved_alerts") or []
    ):

        if not isinstance(title, str):
            continue

        if not title:
            continue

        if title not in visit["resolved_alerts"]:
            visit["resolved_alerts"].append(title)

    # Generic safety-net facts that didn't fit a predefined category
    # schema, and any clinician/specialist/tumor-board recommendation --
    # merged the same way as the other narrative layers above (append +
    # exact-dict dedupe), so a tumor-board recommendation now has a
    # dedicated place to survive the extraction -> merge pipeline.
    visit.setdefault("clinical_attributes", [])
    for attribute in extraction.get("clinical_attributes") or []:
        if attribute not in visit["clinical_attributes"]:
            visit["clinical_attributes"].append(attribute)

    visit.setdefault("clinical_recommendations", [])
    for recommendation in extraction.get("clinical_recommendations") or []:
        if recommendation not in visit["clinical_recommendations"]:
            visit["clinical_recommendations"].append(recommendation)

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
        # ---- Deterministic response/direction derivation ----
    # IMPORTANT: only scan status_statement_text -- the LLM's VERBATIM
    # transcription of actual disease-status language (extraction prompt
    # item 12: "only transcribe status language that is actually
    # present"). Scanning the full raw consultation/pathology/imaging/
    # document text was the root cause of false "Progressive Disease"
    # classifications: generic report vocabulary that has nothing to do
    # with THIS patient's current trajectory (margin language,
    # contingency planning, etc.) can appear anywhere in a document.
    status_statement_text = " ".join(current_ds.get("status_statements") or [])
    inferred_response = _infer_response_from_text(status_statement_text)
    if inferred_response:
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
        document_id=document_id,
        document_date=document_date,
        all_visits=all_visits,
    )
    _merge_narrative_layers_into_visit(visit, extraction, document_date, document_text=document_text)

    # Vitals are always made authoritative last, so a value the LLM
    # mislabeled in its free-form clinical_measurements list is
    # corrected by the structurally-derived vitals dict, never the
    # other way around. See _reconcile_vitals_measurements.
        # Vitals are always made authoritative last, so a value the LLM
    # mislabeled in its free-form clinical_measurements list is
    # corrected by the structurally-derived vitals dict, never the
    # other way around. See _reconcile_vitals_measurements.
    _reconcile_vitals_measurements(visit)

    # Final structural dedup across the whole visit -- see
    # _dedupe_visit_measurements.
    _dedupe_visit_measurements(visit)

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


def _validate_visit_dates(visits_by_number: Dict[int, dict]) -> None:
    """Diagnostic only -- logs (never raises) if the same clinical date
    ends up attached to two different visit_numbers, which would mean the
    date-grouping in determine_visit() is out of sync with what's already
    stored for this patient."""
    seen_dates: Dict[str, int] = {}
    for visit_number, visit in visits_by_number.items():
        appointment_date = (visit.get("appointment") or {}).get("appointment_date")
        if not appointment_date:
            continue
        prior_owner = seen_dates.get(appointment_date)
        if prior_owner is not None and prior_owner != visit_number:
            logger.error(
                f"Duplicate visit date detected: {appointment_date} appears in "
                f"Visit {prior_owner} and Visit {visit_number}. This patient's "
                f"case view likely needs a rebuild (see rebuild_longitudinal_case_view_from_history)."
            )
        else:
            seen_dates[appointment_date] = visit_number

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
        max_tokens=8000,
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


# Generic minimum-magnitude threshold below which a numeric change is
# treated as measurement noise/rounding rather than a clinically
# meaningful worsening or improvement. Applied IDENTICALLY to every
# metric, category, and cancer type -- never looks at a metric's name.



def _compute_delta(
    old: Any,
    new: Any,
    favorable_direction: Optional[str] = None,
    old_unit: Optional[str] = None,
    new_unit: Optional[str] = None,
) -> Dict[str, Any]:

    result = {
        "previous": old,
        "current": new,
    }

    if not (
        isinstance(old, (int, float))
        and isinstance(new, (int, float))
    ):
        if old != new:
            result["trend"] = "Changed"
        else:
            result["trend"] = "Stable"

        return result

    normalized_new = new

    if (
        old_unit
        and new_unit
        and old_unit.strip().lower() != new_unit.strip().lower()
    ):
        converted = _convert_unit(
            new,
            new_unit,
            old_unit,
        )

        if converted is None:
            result.update({
                "unit_mismatch": True,
                "previous_unit": old_unit,
                "current_unit": new_unit,
                "trend": "Unknown (unit mismatch)",
            })
            return result

        normalized_new = converted

        result.update({
            "normalized_current": normalized_new,
            "normalized_unit": old_unit,
        })

    change = normalized_new - old

    result["change"] = round(change, 6)

    if old != 0:
        result["percentage_change"] = round(
            (change / old) * 100,
            3,
        )
    else:
        result["percentage_change"] = None

    favorable_direction = (
        str(favorable_direction).strip().lower()
        if favorable_direction is not None
        else None
    )

    if change == 0:
        result["trend"] = "Stable"

    elif favorable_direction == "down":
        result["trend"] = (
            "Improving"
            if change < 0
            else "Worsening"
        )

    elif favorable_direction == "up":
        result["trend"] = (
            "Improving"
            if change > 0
            else "Worsening"
        )

    else:
        # We know the measurement changed,
        # but we do not know whether that is clinically
        # favorable or unfavorable.
        result["trend"] = "Changed"

    return result


def _build_last_known_measurements(
    ordered_visits: List[dict],
    before_visit_number: int,
) -> Dict[str, dict]:
    """For each metric name (the SAME canonical name already used as the
    key in every visit's own clinical_measurements dict -- see
    _resolve_canonical_metric_name), returns the most recently reported
    observation from ANY completed visit strictly before
    `before_visit_number` -- scanning the patient's ENTIRE prior history,
    not just the single immediately-preceding visit.

    Later (more recent) visits overwrite earlier ones for the same
    metric name as we walk forward in chronological order, so the result
    is each metric's true 'last known value as of just before this
    visit' -- e.g. if a metric was reported at Visit 1 and Visit 2 is
    silent on it, a Visit 3 lookup still returns the Visit 1 observation,
    never treats it as missing/new.

    Purely structural. No metric-name, cancer-type, or keyword logic --
    identical behavior for every patient and every disease.
    """
    last_known: Dict[str, dict] = {}
    for visit in ordered_visits:
        vnum = visit.get("visit_number")
        if vnum is None or vnum >= before_visit_number:
            continue
        vdate = (visit.get("appointment") or {}).get("appointment_date")
        for name, entry in (visit.get("clinical_measurements") or {}).items():
            if not isinstance(entry, dict) or entry.get("value") is None:
                continue
            last_known[name] = {
                **entry,
                "visit_number": vnum,
                "visit_date": vdate,
            }
    return last_known

def compute_numeric_trends(
    completed_visits: List[dict],
    current_visit: dict,
) -> Dict[str, Any]:
    """
    ALL-HISTORY-AWARE comparison.

    Every metric on the current visit (or previously documented and not
    repeated here) is compared against the LAST VISIT THAT ACTUALLY
    REPORTED IT, scanning every completed visit that precedes the
    current one -- not just the single immediately-previous visit. This
    is what lets a metric reported at Visit 1, silent at Visit 2, still
    be correctly compared against its Visit 1 value when Visit 3
    arrives, instead of being (wrongly) reported as brand-new just
    because Visit 2 didn't happen to repeat it.

    No disease names.
    No cancer-specific metrics.
    No keyword lists.
    No predefined clinical checklist.

    A metric that exists only in the current visit (never reported
    before) is reported as NEW.
    A metric that was previously reported but is not repeated at the
    current visit is reported as NOT_REPEATED.

    Numeric values are compared only when both values are numeric.
    Clinical significance is NOT inferred from a universal percentage
    threshold.
    """

    ordered = _chronological(completed_visits)
    current_visit_number = current_visit.get("visit_number") or 0
    prior_visits = [v for v in ordered if (v.get("visit_number") or -1) < current_visit_number]

    last_known = _build_last_known_measurements(ordered, current_visit_number)
    curr_measurements = current_visit.get("clinical_measurements") or {}

    all_metric_names = sorted(
        set(last_known.keys()) |
        set(curr_measurements.keys())
    )

    metric_changes: Dict[str, List[Dict[str, Any]]] = {}

    for metric_name in all_metric_names:

        previous = last_known.get(metric_name)
        current = curr_measurements.get(metric_name)

        previous_value = _metric_value(previous)
        current_value = _metric_value(current)

        previous_unit = _metric_unit(previous)
        current_unit = _metric_unit(current)

        category = (
            _metric_category(current)
            or _metric_category(previous)
            or "other"
        )

        row = {
            "name": metric_name,
            "category": category,
            "previous": previous_value,
            "current": current_value,
            "previous_unit": previous_unit,
            "current_unit": current_unit,
            # Which visit the "previous" reading actually came from --
            # not necessarily current_visit_number - 1.
            "previous_visit_number": (
                previous.get("visit_number") if isinstance(previous, dict) else None
            ),
            "previous_visit_date": (
                previous.get("visit_date") if isinstance(previous, dict) else None
            ),
            "current_visit_number": current_visit_number,
            "previous_body_site": (
                previous.get("body_site")
                if isinstance(previous, dict)
                else None
            ),
            "current_body_site": (
                current.get("body_site")
                if isinstance(current, dict)
                else None
            ),
            "previous_source_document_id": (
                previous.get("source_document_id")
                if isinstance(previous, dict)
                else None
            ),
            "current_source_document_id": (
                current.get("source_document_id")
                if isinstance(current, dict)
                else None
            ),
        }

        if previous is None:
            row["change_type"] = "new"
            row["trend"] = "New"
            metric_changes.setdefault(category, []).append(row)
            continue

        if current is None:
            row["change_type"] = "not_repeated"
            row["trend"] = "Not repeated"
            metric_changes.setdefault(category, []).append(row)
            continue

        favorable_direction = (
            _metric_favorable_direction(current)
            or _metric_favorable_direction(previous)
        )

        delta = _compute_delta(
            previous_value,
            current_value,
            favorable_direction=favorable_direction,
            old_unit=previous_unit,
            new_unit=current_unit,
        )

        row.update(delta)

        if previous_value == current_value and previous_unit == current_unit:
            row["change_type"] = "unchanged"
        else:
            row["change_type"] = "changed"

        metric_changes.setdefault(category, []).append(row)

    # Kept for treatment_modifications / survival, which are genuinely
    # "since the immediately preceding visit" concepts (unlike metric
    # values, a treatment record or vital_status flag isn't sparse in
    # the same way) -- unchanged semantics from before.
    immediate_previous_visit = prior_visits[-1] if prior_visits else None

    return {
        "metric_changes": metric_changes,
        "safety": {
            "new_adverse_events": []
        },
        "treatment_modifications": {
            "changed": (
                (immediate_previous_visit or {}).get("treatment") or {}
            ) != (
                current_visit.get("treatment") or {}
            ),
            "current_treatment": current_visit.get("treatment") or None,
        },
        "survival": {
            "alive": (
                (current_visit.get("consultation") or {})
                .get("vital_status")
            )
        },
    }


_COMPARISON_EXCLUDED_KEYS = {
    "visit_id",
    "visit_number",
    "status",
    "appointment",
    "appointments",
    "documents",
    "_document_ids",
    "_document_hash",
    "visit_summary",
}


def _flatten_for_comparison(
    value: Any,
    path: Tuple[str, ...] = (),
) -> Dict[str, Any]:

    if isinstance(value, dict):

        result = {}

        for key, child in value.items():

            if (
                len(path) == 0
                and key in _COMPARISON_EXCLUDED_KEYS
            ):
                continue

            result.update(
                _flatten_for_comparison(
                    child,
                    path + (str(key),),
                )
            )

        return result

    if isinstance(value, list):

        normalized_items = []

        for item in value:

            if isinstance(item, (dict, list)):
                normalized_items.append(
                    json.dumps(
                        item,
                        sort_keys=True,
                        default=str,
                    )
                )
            else:
                normalized_items.append(item)

        return {
            ".".join(path): normalized_items
        }

    if value in (None, "", [], {}):
        return {}

    return {
        ".".join(path): value
    }


def compute_structured_visit_changes(
    previous_visit: dict,
    current_visit: dict,
) -> Dict[str, Any]:

    previous_flat = _flatten_for_comparison(
        previous_visit
    )

    current_flat = _flatten_for_comparison(
        current_visit
    )

    all_paths = sorted(
        set(previous_flat.keys()) |
        set(current_flat.keys())
    )

    added = []
    removed = []
    changed = []
    unchanged = []

    for path in all_paths:

        previous = previous_flat.get(path)
        current = current_flat.get(path)

        if path not in previous_flat:
            added.append({
                "path": path,
                "current": current,
                "change_type": "added",
            })
            continue

        if path not in current_flat:
            removed.append({
                "path": path,
                "previous": previous,
                "change_type": "not_repeated",
            })
            continue

        if previous == current:
            unchanged.append({
                "path": path,
                "value": current,
            })
        else:
            changed.append({
                "path": path,
                "previous": previous,
                "current": current,
                "change_type": "changed",
            })

    return {
        "added": added,
        "removed_or_not_repeated": removed,
        "changed": changed,
        "unchanged": unchanged,
        "counts": {
            "added": len(added),
            "removed_or_not_repeated": len(removed),
            "changed": len(changed),
            "unchanged": len(unchanged),
        },
    }


def _metric_identity_key(name: str, body_site: Optional[str]) -> str:
    """Generic, non-hardcoded structural identity for a metric's own
    longitudinal series: the metric's already-canonicalized name (see
    _resolve_canonical_metric_name, applied once per visit during merge)
    combined with its normalized body_site. This is what stops e.g. a
    'left breast lesion' measurement from being silently folded into a
    'right breast lesion' series that happens to share the same metric
    name -- pure text normalization (reusing _normalize_comparable_text,
    already defined above for alerts), no anatomical vocabulary and no
    per-disease keyword list."""
    name_part = _normalize_comparable_text(name)
    site_part = _normalize_comparable_text(body_site) if body_site else ""
    return f"{name_part}||{site_part}"


def _build_metric_comparisons(observations: List[dict]) -> List[dict]:
    """Derives comparisons between every pair of CONSECUTIVE AVAILABLE
    observations in this metric's own sparse series -- consecutive in
    the series, NOT consecutive visit numbers. A metric present only at
    visits 1 and 3 produces exactly one comparison, V1->V3, using the
    exact same _compute_delta logic (unit normalization + trend
    direction) already used for the latest-visit-pair comparison, so
    behavior stays consistent everywhere. When 3+ observations exist, an
    additional first->latest 'overall' comparison is appended so the UI
    can show total change across the whole history without recomputing
    it itself."""
    if len(observations) < 2:
        return []

    comparisons = []
    for prev_obs, curr_obs in zip(observations, observations[1:]):
        favorable_direction = curr_obs.get("favorable_direction") or prev_obs.get("favorable_direction")
        delta = _compute_delta(
            prev_obs.get("value"),
            curr_obs.get("value"),
            favorable_direction=favorable_direction,
            old_unit=prev_obs.get("unit"),
            new_unit=curr_obs.get("unit"),
        )
        comparisons.append({
            "from_visit": prev_obs.get("visit_number"),
            "to_visit": curr_obs.get("visit_number"),
            "from_date": prev_obs.get("date"),
            "to_date": curr_obs.get("date"),
            "is_overall": False,
            **delta,
        })

    if len(observations) >= 3:
        first_obs, last_obs = observations[0], observations[-1]
        favorable_direction = last_obs.get("favorable_direction") or first_obs.get("favorable_direction")
        overall_delta = _compute_delta(
            first_obs.get("value"),
            last_obs.get("value"),
            favorable_direction=favorable_direction,
            old_unit=first_obs.get("unit"),
            new_unit=last_obs.get("unit"),
        )
        comparisons.append({
            "from_visit": first_obs.get("visit_number"),
            "to_visit": last_obs.get("visit_number"),
            "from_date": first_obs.get("date"),
            "to_date": last_obs.get("date"),
            "is_overall": True,
            **overall_delta,
        })

    return comparisons


def build_metric_history(completed_visits: List[dict]) -> Dict[str, Dict[str, Any]]:
    """Deterministic longitudinal metric-history layer.

    For every (metric name, body_site) identity that has EVER appeared in
    ANY completed visit, builds a SPARSE observation series -- one entry
    per visit that actually reported it, never a padded/null entry for a
    visit where it wasn't reported. This is what lets a metric documented
    at visits 1 and 3 (but not 2) be compared V1->V3 directly, with no
    fabricated 'visit 2 = null' row, and with no requirement that the
    metric repeat at every visit or at consecutive visits.

    Purely structural aggregation over whatever clinical_measurements
    each visit's own extraction already produced -- no keyword lists, no
    cancer-type or metric-name-specific logic, identical for every
    patient and every disease.
    """
    ordered = _chronological(completed_visits)

    identity_meta: Dict[str, Dict[str, Any]] = {}
    series: Dict[str, List[dict]] = {}

    for visit in ordered:
        visit_number = visit.get("visit_number")
        visit_date = (visit.get("appointment") or {}).get("appointment_date")
        for name, entry in (visit.get("clinical_measurements") or {}).items():
            if not isinstance(entry, dict):
                continue
            value = entry.get("value")
            if value is None:
                continue  # never fabricate/store a missing observation

            body_site = entry.get("body_site")
            category = entry.get("category")
            key = _metric_identity_key(name, body_site)

            if key not in identity_meta:
                identity_meta[key] = {"name": name, "category": category, "body_site": body_site}
            elif category and not identity_meta[key].get("category"):
                identity_meta[key]["category"] = category

            series.setdefault(key, []).append({
                "visit_number": visit_number,
                "date": visit_date,
                "value": value,
                "unit": entry.get("unit"),
                "body_site": body_site,
                "favorable_direction": entry.get("favorable_direction"),
                "source_document_id": entry.get("source_document_id"),
            })

    history: Dict[str, Dict[str, Any]] = {}
    for key, observations in series.items():
        observations = sorted(observations, key=lambda o: (o.get("visit_number") or 0))
        meta = identity_meta[key]
        history[key] = {
            "name": meta["name"],
            "category": meta.get("category") or "other",
            "body_site": meta.get("body_site"),
            "history": observations,
            "comparisons": _build_metric_comparisons(observations),
            "first_available": observations[0] if observations else None,
            "latest_available": observations[-1] if observations else None,
        }
    return history

def _compute_overall_trends(completed_visits: List[dict]) -> Dict[str, Dict[str, Any]]:
    """Category -> display_name -> {history, comparisons, first_available,
    latest_available}, built from the full SPARSE metric history (see
    build_metric_history) -- never a dense per-visit array padded with
    None for visits where the metric wasn't reported. A metric present
    only at visits 1 and 3 shows exactly two history entries and one
    V1->V3 comparison; visit 2 never appears for it at all.

    Two metrics that share a name but not a body_site (e.g. a lesion
    measured at two different anatomical sites) are kept as separate
    series -- see _metric_identity_key -- and disambiguated in the
    display key, purely structurally, with no site/organ keyword list.
    """
    metric_history = build_metric_history(completed_visits)

    series: Dict[str, Dict[str, Any]] = {}
    for entry in metric_history.values():
        category = entry.get("category") or "other"
        body_site = entry.get("body_site")
        display_name = f"{entry['name']} ({body_site})" if body_site else entry["name"]
        series.setdefault(category, {})[display_name] = entry
    return series


# =====================================================================
# LAYER 2 — VISIT DELTA (deterministic)
# =====================================================================
def compute_visit_delta(previous_visit: dict, current_visit: dict, trends: Optional[dict]) -> Dict[str, Any]:
    """"What changed since the previous visit" -- fully deterministic.
    Keeps the original flat keys (backward compatible with existing
    callers) and adds a categorized `what_changed`-style structure built
    purely from already-derived, structural data: measurement categories
    (assigned from document type, not content), disease_status fields
    (already extracted/inferred elsewhere), adverse_event set membership,
    and treatment dict diffing. No keyword lists, no cancer-specific logic.
    """

    def _sig(x: Any) -> str:
        return json.dumps(x, sort_keys=True, default=str)

    # ---------------- existing flat computation (unchanged) ----------------
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
    newly_pending = sorted(curr_pending - prev_pending)

    # Reconcile any remaining pending item against treatment THIS visit's
    # own documents show as structurally administered -- a "start
    # treatment" pending item must not keep showing as outstanding once
    # its treatment has real administration evidence.
    still_pending_raw = curr_pending - curr_completed
    administered_this_visit = _administered_treatments([current_visit])
    resolved_by_treatment = sorted(
        item for item in still_pending_raw
        if _is_pending_action_resolved_by_administered_treatment(item, administered_this_visit)
    )
    still_pending = sorted(still_pending_raw - set(resolved_by_treatment))

    new_documents = [d.get("document_type") for d in current_visit.get("documents") or []]

    metric_changes = (trends or {}).get("metric_changes", {})
    structured_changes = compute_structured_visit_changes(
        previous_visit,
        current_visit,
    )
    improved_metrics, worsened_metrics = [], []
    for section, metrics in metric_changes.items():
        for m in metrics:
            entry = {"section": section, **m}
            if m.get("trend") == "Improving":
                improved_metrics.append(entry)
            elif m.get("trend") == "Worsening":
                worsened_metrics.append(entry)

    # ---------------- categorized structure (Step 6) ----------------
    # metric_changes is already grouped by each metric's own category --
    # whatever document type it came from. No re-bucketing, no
    # translation table: the categories present are exactly whatever thisssssss
    # patient's documents actually used.
    metrics_by_category = metric_changes

    def _norm_symptom_name(s):
        n = (s or {}).get("name")
        return " ".join(str(n).strip().lower().split()) if n else None

    prev_symptom_names = {n for n in (_norm_symptom_name(s) for s in previous_visit.get("symptoms") or []) if n}
    curr_symptom_names = {n for n in (_norm_symptom_name(s) for s in current_visit.get("symptoms") or []) if n}
    new_symptom_names = sorted(curr_symptom_names - prev_symptom_names)
    undocumented_symptom_names = sorted(prev_symptom_names - curr_symptom_names)

    prev_ecog = (previous_visit.get("vitals") or {}).get("ecog")
    curr_ecog = (current_visit.get("vitals") or {}).get("ecog")
    ecog_delta = _compute_delta(prev_ecog, curr_ecog, favorable_direction="down") if (
        isinstance(prev_ecog, (int, float)) and isinstance(curr_ecog, (int, float))
    ) else None

    symptoms_and_performance = {
        "new_symptoms": new_symptom_names,
        "symptoms_no_longer_documented": undocumented_symptom_names,
        "ecog": ecog_delta,
    }

    # disease_status: literal field comparison, never a keyword match
    prev_status = previous_visit.get("disease_status") or {}
    curr_status = current_visit.get("disease_status") or {}
    prev_state, curr_state = prev_status.get("disease_state"), curr_status.get("disease_state")
    prev_stage, curr_stage = prev_status.get("current_stage"), curr_status.get("current_stage")
    disease_status_bucket = {
        "state": {"previous": prev_state, "current": curr_state,
                   "changed": bool(curr_state and curr_state != prev_state)},
        "stage": {"previous": prev_stage, "current": curr_stage,
                   "changed": bool(curr_stage and curr_stage != prev_stage)},
        "status_statements_added": sorted(
            set(curr_status.get("status_statements") or []) - set(prev_status.get("status_statements") or [])
        ),
    }

    # treatment: structural diff of the treatment dict (modality -> details)
    prev_treatment = previous_visit.get("treatment") or {}
    curr_treatment = current_visit.get("treatment") or {}
    treatment_modality_changes = {}
    for modality in set(prev_treatment.keys()) | set(curr_treatment.keys()):
        prev_details = prev_treatment.get(modality) or {}
        curr_details = curr_treatment.get(modality) or {}
        if prev_details == curr_details:
            continue
        prev_cycle = prev_details.get("cycle_number") or prev_details.get("cycles_completed")
        curr_cycle = curr_details.get("cycle_number") or curr_details.get("cycles_completed")
        treatment_modality_changes[modality] = {
            "present_previously": bool(prev_details),
            "present_currently": bool(curr_details),
            "cycle": {"previous": prev_cycle, "current": curr_cycle} if (prev_cycle or curr_cycle) else None,
            "regimen": {
                "previous": prev_details.get("regimen") or prev_details.get("regimen_name"),
                "current": curr_details.get("regimen") or curr_details.get("regimen_name"),
            },
        }

    # toxicity: pure set comparison of adverse_events dicts
    prev_ae_sigs = {_sig(a): a for a in (previous_visit.get("adverse_events") or [])}
    curr_ae_sigs = {_sig(a): a for a in (current_visit.get("adverse_events") or [])}
    toxicity_bucket = {
        "new": [a for sig, a in curr_ae_sigs.items() if sig not in prev_ae_sigs],
        "resolved": [a for sig, a in prev_ae_sigs.items() if sig not in curr_ae_sigs],
    }

    medications_bucket = {"started": new_medications, "stopped": stopped_medications}
    pending_bucket = {
        "still_pending": still_pending,
        "newly_pending": newly_pending,
        "completed_since_previous": completed_since_previous,
        "resolved_by_treatment_administration": resolved_by_treatment,
    }
    all_metrics_flat = [m for metrics in metric_changes.values() for m in metrics]
    tally = _direction_tally(all_metrics_flat)
    if tally["Improving"] and not tally["Worsening"]:
        overall_direction = "Improving"
    elif tally["Worsening"] and not tally["Improving"]:
        overall_direction = "Worsening"
    elif tally["Improving"] and tally["Worsening"]:
        overall_direction = "Mixed"
    elif tally["Stable"]:
        overall_direction = "Stable"
    else:
        overall_direction = "Unknown"
    overall_bucket = {"direction": overall_direction, "metric_tally": tally}

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
        "structured_changes": structured_changes,
        "categorized": {
            "metrics_by_category": metrics_by_category,
            "symptoms_and_performance": symptoms_and_performance,
            "disease_status": disease_status_bucket,
            "treatment": {"modalities_changed": treatment_modality_changes},
            "toxicity": toxicity_bucket,
            "medications": medications_bucket,
            "pending": pending_bucket,
            "overall": overall_bucket,
        },
    }


# =====================================================================
# LAYER 3 / 4 — TIMELINE + LONGITUDINAL ANALYTICS (deterministic)
# =====================================================================
def compute_deterministic_events(
    ordered_visits: List[dict],
) -> List[dict]:
    """
    Build deterministic timeline events from structured visit data.

    Sources:
      - uploaded documents
      - treatment state
      - disease-status changes

    No disease-specific mappings or document-category mappings are used.
    """

    events: List[dict] = []

    seen_modalities: set = set()
    previous_disease_status: Optional[dict] = None

    for v in ordered_visits:

        vnum = v.get("visit_number")

        visit_date = (
            v.get("appointment") or {}
        ).get("appointment_date")

        # =====================================================
        # 1. DOCUMENT EVENTS
        # =====================================================

        for doc in v.get("documents") or []:

            category = (
                doc.get("primary_category")
                or "other"
            )

            label = (
                doc.get("document_type")
                or category.replace("_", " ").title()
            )

            document_date = (
                doc.get("document_date")
                or visit_date
            )

            events.append({
                "visit_number": vnum,
                "date": document_date,
                "event_type": category,
                "title": f"{label} uploaded",
                "description": doc.get("summary"),
                "importance": "medium",
                "source": "deterministic",
                "document_id": doc.get("document_id"),
                "document_type": doc.get("document_type"),
                "primary_category": category,
                "secondary_categories": (
                    doc.get("secondary_categories") or []
                ),
            })

        # =====================================================
        # 2. TREATMENT EVENTS
        # =====================================================

        for modality, mod_details in (
            v.get("treatment") or {}
        ).items():

            if modality in seen_modalities:
                continue

            seen_modalities.add(modality)

            mod_details = mod_details or {}

            has_administration_evidence = bool(
                mod_details.get("administered") is True
                or mod_details.get("cycles_completed")
                or mod_details.get("cycle_number")
            )

            if has_administration_evidence:
                title = f"Treatment started: {modality}"
                event_type = "treatment_administered"
            else:
                title = f"Treatment planned: {modality}"
                event_type = "treatment_plan"

            events.append({
                "visit_number": vnum,
                "date": visit_date,
                "event_type": event_type,
                "title": title,
                "description": None,
                "importance": "high",
                "source": "deterministic",
            })

        # =====================================================
        # 3. DISEASE STATUS EVENTS
        # =====================================================

        current_disease_status = (
            v.get("disease_status")
        )

        if (
            current_disease_status
            and current_disease_status
            != previous_disease_status
        ):

            response = (
                current_disease_status.get(
                    "clinical_response"
                )
            )

            direction = (
                current_disease_status.get(
                    "overall_direction"
                )
            )

            label_bits = [
                value
                for value in (
                    response,
                    direction,
                )
                if value
            ]

            if label_bits:

                events.append({
                    "visit_number": vnum,
                    "date": visit_date,
                    "event_type": "disease_status_change",
                    "title": (
                        "Disease status: "
                        + " / ".join(label_bits)
                    ),
                    "description": None,
                    "importance": "high",
                    "source": "deterministic",
                })

            previous_disease_status = (
                current_disease_status
            )

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

            event_date = event.get("date")

            if not event_date:
                event_date = appointment_date

            event["date"] = event_date

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


def compute_longitudinal_overview(
    completed_visits: List[dict],
) -> Optional[dict]:

    if not completed_visits:
        return None

    ordered = sorted(
        completed_visits,
        key=lambda v: (
            (v.get("appointment") or {}).get(
                "appointment_date"
            ) or "",
            v.get("visit_number") or 0,
        ),
    )

    baseline = ordered[0]
    latest = ordered[-1]

    baseline_latest_changes = compute_structured_visit_changes(
        baseline,
        latest,
    )

    measurement_history = {}

    for visit in ordered:

        visit_number = visit.get("visit_number")

        raw_measurements = (
            visit.get("clinical_measurements") or {}
        )

        # -------------------------------------------------------------
        # Normalize both supported representations:
        #
        # 1. canonical visit representation:
        #       {"Hb": {"value": 12.4, ...}}
        #
        # 2. extraction representation:
        #       [{"name": "Hb", "value": 12.4, ...}]
        # -------------------------------------------------------------

        if isinstance(raw_measurements, dict):

            measurement_items = raw_measurements.items()

        elif isinstance(raw_measurements, list):

            measurement_items = []

            for entry in raw_measurements:

                if not isinstance(entry, dict):
                    continue

                name = entry.get("name")

                if not name:
                    continue

                measurement_items.append(
                    (name, entry)
                )

        else:

            measurement_items = []

        for name, entry in measurement_items:

            if not isinstance(entry, dict):
                continue

            value = _metric_value(entry)

            if value is None:
                continue

            measurement_history.setdefault(
                name,
                [],
            ).append({
                "visit_number": visit_number,
                "date": (
                    visit.get("appointment") or {}
                ).get("appointment_date"),
                "value": value,
                "unit": _metric_unit(entry),
                "body_site": entry.get("body_site"),
                "category": _metric_category(entry),
                "source_document_id": entry.get(
                    "source_document_id"
                ),
            })

    documented_status_history = []

    for visit in ordered:

        status = visit.get("disease_status")

        if status:
            documented_status_history.append({
                "visit_number": visit.get("visit_number"),
                "date": (
                    visit.get("appointment") or {}
                ).get("appointment_date"),
                "status": status,
            })

    return {
        "baseline_visit": baseline.get("visit_number"),
        "current_visit": latest.get("visit_number"),

        "baseline_date": (
            baseline.get("appointment") or {}
        ).get("appointment_date"),

        "current_date": (
            latest.get("appointment") or {}
        ).get("appointment_date"),

        "baseline_vs_current": baseline_latest_changes,

        "measurement_history": measurement_history,

        "documented_disease_status_history":
            documented_status_history,

        "disease_trajectory":
            compute_disease_trajectory(ordered),

        "treatment_history":
            compute_treatment_history(ordered),

        "symptom_trends":
            compute_symptom_trends(ordered),

        "medication_timeline":
            compute_medication_timeline(ordered),

        "active_alerts":
            compute_active_alerts(ordered),

        "pending_items":
            compute_pending_items(ordered),

        "clinical_decisions":
            compute_clinical_decisions_log(ordered),

        "clinical_attributes":
            compute_clinical_attributes_log(ordered),

        "clinical_recommendations":
            compute_recommendations_log(ordered),
    }


def compute_disease_trajectory(
    ordered_visits: List[dict]
) -> List[dict]:
    """
    Build a sparse longitudinal disease trajectory.

    Core rule:

        A missing disease_status at a later visit does NOT erase
        previously documented disease information.

    A new trajectory period is created only when a visit actually
    documents a meaningful new disease-status value.

    The function is disease-agnostic and performs no cancer-specific
    interpretation.
    """

    if not ordered_visits:
        return []

    # -------------------------------------------------------------
    # Chronological + visit-number deduplication
    # -------------------------------------------------------------

    visits_by_number: Dict[Any, dict] = {}

    for visit in ordered_visits:

        if not isinstance(visit, dict):
            continue

        visit_number = visit.get("visit_number")

        if visit_number is None:
            continue

        visits_by_number[visit_number] = visit

    visits = sorted(
        visits_by_number.values(),
        key=lambda v: (
            (v.get("appointment") or {}).get(
                "appointment_date"
            ) or "",
            v.get("visit_number") or 0,
        ),
    )

    # -------------------------------------------------------------
    # Normalization helpers
    # -------------------------------------------------------------

    def _normalize(value: Any) -> Optional[str]:

        if value is None:
            return None

        if isinstance(value, str):
            normalized = " ".join(
                value.strip().casefold().split()
            )
            return normalized or None

        return str(value).strip().casefold() or None

    def _normalize_statements(values: Any) -> Tuple[str, ...]:

        if not isinstance(values, list):
            return ()

        normalized = []

        for value in values:

            value_normalized = _normalize(value)

            if value_normalized:
                normalized.append(value_normalized)

        return tuple(sorted(set(normalized)))

    def _has_status(status: Any) -> bool:

        if not isinstance(status, dict):
            return False

        return any([
            status.get("current_stage"),
            status.get("disease_state"),
            status.get("clinical_response"),
            status.get("overall_direction"),
            status.get("status_statements"),
        ])

    def _field_materially_changed(previous_value: Any, current_value: Any) -> bool:
        """Fuzzy check (reuses _metric_name_similarity) for whether a
        short free-text field is materially different from its previous
        value, not just a rewording. No keyword/disease-specific logic."""
        current_norm = _normalize(current_value)
        previous_norm = _normalize(previous_value)
        if not current_norm:
            return False
        if not previous_norm:
            return True
        if current_norm == previous_norm:
            return False
        return _metric_name_similarity(str(current_value), str(previous_value)) < _TEXT_ASSERTION_MATCH_THRESHOLD

    def _statements_have_new_information(
        current_statements: Tuple[str, ...],
        previous_statements: Tuple[str, ...],
    ) -> bool:
        """True only when at least one current statement has no
        fuzzy-equivalent counterpart already documented -- i.e. genuinely
        new information, not a rewording of what's already on file."""
        if not current_statements:
            return False
        for statement in current_statements:
            if _find_fuzzy_text_match(statement, list(previous_statements), _TEXT_ASSERTION_MATCH_THRESHOLD) is None:
                return True
        return False

    def _status_materially_changed(
        previous_status: Dict[str, Any],
        current_status: Dict[str, Any],
    ) -> bool:
        """Generic, disease-agnostic test for whether `current_status` is
        a real change vs. a differently-worded restatement of the same
        facts. current_stage/disease_state via fuzzy similarity;
        clinical_response/overall_direction (already canonicalized from
        standardized response-criteria vocabulary -- see
        _infer_response_from_text) via exact comparison;
        status_statements via fuzzy per-statement matching. No keyword
        list, synonym table, or cancer-specific rule anywhere."""
        if _field_materially_changed(previous_status.get("current_stage"), current_status.get("current_stage")):
            return True
        if _field_materially_changed(previous_status.get("disease_state"), current_status.get("disease_state")):
            return True

        current_response = _normalize(current_status.get("clinical_response"))
        if current_response and current_response != _normalize(previous_status.get("clinical_response")):
            return True
        current_direction = _normalize(current_status.get("overall_direction"))
        if current_direction and current_direction != _normalize(previous_status.get("overall_direction")):
            return True

        current_statements = _normalize_statements(current_status.get("status_statements"))
        previous_statements = _normalize_statements(previous_status.get("status_statements"))
        if _statements_have_new_information(current_statements, previous_statements):
            return True

        return False

    def _merge_known_status(
        previous: Dict[str, Any],
        current: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Build the disease status for the newly documented trajectory period.

        The current visit is authoritative for fields that it documents.
        Previously known fields are retained only when the current visit
        does not provide that field.

        IMPORTANT:
        status_statements are NOT accumulated across periods.
        They belong to the documentation that created the current period.
        """

        previous = previous or {}
        current = current or {}

        merged = {}

        for key in (
            "current_stage",
            "disease_state",
            "clinical_response",
            "overall_direction",
        ):
            current_value = current.get(key)

            if current_value not in (None, "", [], {}):
                merged[key] = current_value
            else:
                previous_value = previous.get(key)

                if previous_value not in (None, "", [], {}):
                    merged[key] = previous_value

        current_statements = current.get(
            "status_statements"
        ) or []

        if current_statements:
            merged["status_statements"] = _cluster_text_assertions(
                current_statements
            )

        return merged

    # -------------------------------------------------------------
    # Build periods
    # -------------------------------------------------------------

    periods: List[dict] = []

    active_status: Dict[str, Any] = {}
    active_period: Optional[dict] = None

    for visit in visits:

        visit_number = visit.get("visit_number")

        appointment = visit.get("appointment") or {}

        visit_date = appointment.get("appointment_date")

        raw_status = visit.get("disease_status")

        if not isinstance(raw_status, dict):
            raw_status = {}

        has_documented_status = _has_status(raw_status)

        # =========================================================
        # FIRST DOCUMENTED DISEASE STATUS
        # =========================================================

        if not active_status and has_documented_status:

            active_status = dict(raw_status)

            active_period = {
                "start_visit": visit_number,
                "end_visit": visit_number,
                "start_date": visit_date,
                "end_date": visit_date,

                # Important:
                # this records where the status was actually documented.
                "documented_at_visit": visit_number,

                "disease_status": dict(active_status),

                "supporting_visits": [
                    visit_number
                ],
            }

            periods.append(active_period)

            continue

        # =========================================================
        # NO DISEASE STATUS AT THIS VISIT
        #
        # Do NOT create a new period.
        # Do NOT erase previous disease state.
        # =========================================================

        if not has_documented_status:

            if active_period is not None:

                active_period["end_visit"] = visit_number
                active_period["end_date"] = visit_date

                if visit_number not in active_period["supporting_visits"]:
                    active_period["supporting_visits"].append(
                        visit_number
                    )

            continue

        # =========================================================
        # NEW DISEASE STATUS
        # =========================================================

                # No meaningful status change -- current_status may just be a
        # differently-worded restatement of what's already documented.
        if not _status_materially_changed(active_status, raw_status):

            if active_period is not None:

                active_period["end_visit"] = visit_number
                active_period["end_date"] = visit_date

                if visit_number not in active_period["supporting_visits"]:
                    active_period["supporting_visits"].append(
                        visit_number
                    )

            continue

        # =========================================================
        # STATUS CHANGED
        # =========================================================

        if active_period is not None:

            active_period["end_visit"] = visit_number
            active_period["end_date"] = visit_date

        active_status = _merge_known_status(
            active_status,
            raw_status,
        )

        active_period = {
            "start_visit": visit_number,
            "end_visit": visit_number,
            "start_date": visit_date,
            "end_date": visit_date,
            "documented_at_visit": visit_number,
            "disease_status": dict(active_status),
            "supporting_visits": [
                visit_number
            ],
        }

        periods.append(active_period)

    # -------------------------------------------------------------
    # Clean period representation
    # -------------------------------------------------------------

    for period in periods:

        period["supporting_visits"] = sorted(
            set(period.get("supporting_visits") or [])
        )

        period["visit_span"] = {
            "from": period.get("start_visit"),
            "to": period.get("end_visit"),
        }

    return periods


def _normalize_disease_trajectory_for_frontend(
    periods: List[dict],
) -> List[dict]:
    """
    Purely structural reshape of compute_disease_trajectory()'s period
    objects into the flat, one-row-per-documented-point shape the
    frontend disease-trajectory table consumes.

    No clinical interpretation, no keyword/cancer-specific logic --
    just unwraps the nested "disease_status" dict and renames two keys
    (documented_at_visit -> visit_number, start_date -> date). Because
    compute_disease_trajectory() only ever creates a new period when a
    visit actually documents/changes disease status, this never
    fabricates a row for a visit where nothing was documented.
    """
    normalized: List[dict] = []
    for period in periods or []:
        disease_status = period.get("disease_status") or {}
        normalized.append({
            "visit_number": period.get("documented_at_visit"),
            "date": period.get("start_date"),
            "current_stage": disease_status.get("current_stage"),
            "disease_state": disease_status.get("disease_state"),
            "clinical_response": disease_status.get("clinical_response"),
            "overall_direction": disease_status.get("overall_direction"),
        })
    return normalized

def compute_symptom_trends(
    ordered_visits: List[dict]
) -> List[dict]:

    series: Dict[str, dict] = {}

    # =========================================================
    # HELPERS
    # =========================================================

    def normalize_name(value):

        if not value:
            return None

        return " ".join(
            str(value).strip().lower().split()
        )

    def numeric_severity(value):
        """
        Convert ONLY genuinely numeric severity values.

        Supported:
            5
            5.0
            "5"
            "5.0"
            "5/10"

        Qualitative values such as:
            mild
            moderate
            severe
            none
            absent

        are NOT converted into artificial numbers.
        """

        if value is None:
            return None

        if isinstance(value, bool):
            return None

        if isinstance(value, (int, float)):
            return float(value)

        if not isinstance(value, str):
            return None

        text = value.strip()

        if not text:
            return None

        # -----------------------------------------------------
        # Direct numeric value
        # -----------------------------------------------------

        try:
            return float(text)

        except ValueError:
            pass

        # -----------------------------------------------------
        # Numeric severity scale such as 5/10
        # -----------------------------------------------------

        if "/" in text:

            first = text.split("/", 1)[0].strip()

            try:
                return float(first)

            except ValueError:
                pass

        return None

    # =========================================================
    # COLLECT
    # =========================================================

    for v in ordered_visits:

        visit_number = v.get(
            "visit_number"
        )

        visit_date = (
            v.get("appointment") or {}
        ).get(
            "appointment_date"
        )

        for symptom in (
            v.get("symptoms") or []
        ):

            if not isinstance(symptom, dict):
                continue

            # -------------------------------------------------
            # Preserve original display name
            # -------------------------------------------------

            original_name = symptom.get(
                "name"
            )

            name = normalize_name(
                original_name
            )

            if not name:
                continue

            raw_severity = symptom.get(
                "severity"
            )

            trend = symptom.get(
                "trend"
            )

            # -------------------------------------------------
            # Create symptom series
            # -------------------------------------------------

            if name not in series:

                series[name] = {
                    "name": original_name,
                    "history": [],
                }

            history = series[
                name
            ]["history"]

            # -------------------------------------------------
            # One row per symptom per visit
            # -------------------------------------------------

            existing = next(
                (
                    x
                    for x in history
                    if x.get(
                        "visit_number"
                    ) == visit_number
                ),
                None,
            )

            if existing:

                # -------------------------------------------------
                # If duplicate extraction exists for the same
                # symptom/visit, preserve the first useful
                # severity and trend.
                # -------------------------------------------------

                if (
                    existing.get(
                        "severity"
                    ) is None
                    and raw_severity is not None
                ):

                    existing[
                        "severity"
                    ] = raw_severity

                    existing[
                        "severity_score"
                    ] = numeric_severity(
                        raw_severity
                    )

                if (
                    not existing.get(
                        "trend"
                    )
                    and trend
                ):

                    existing[
                        "trend"
                    ] = trend

            else:

                history.append({

                    "visit_number":
                        visit_number,

                    "date":
                        visit_date,

                    # -------------------------------------------------
                    # Original extracted severity.
                    #
                    # Examples:
                    #   "mild"
                    #   "moderate"
                    #   "5/10"
                    #   7
                    #
                    # Nothing is rewritten.
                    # -------------------------------------------------

                    "severity":
                        raw_severity,

                    # -------------------------------------------------
                    # Numeric calculation value.
                    #
                    # ONLY populated when the original value
                    # itself is numeric.
                    # -------------------------------------------------

                    "severity_score":
                        numeric_severity(
                            raw_severity
                        ),

                    # -------------------------------------------------
                    # Explicitly documented trend
                    # -------------------------------------------------

                    "trend":
                        trend,
                })

    # =========================================================
    # BUILD RESULT
    # =========================================================

    result = []

    for name, symptom_data in series.items():

        history = symptom_data[
            "history"
        ]

        # -----------------------------------------------------
        # Chronological order
        # -----------------------------------------------------

        history.sort(
            key=lambda x: (
                x.get(
                    "visit_number"
                ) or 0
            )
        )

        # -----------------------------------------------------
        # Actual numeric severity measurements
        #
        # Qualitative values are deliberately excluded.
        # -----------------------------------------------------

        numeric_points = [
            x
            for x in history
            if isinstance(
                x.get(
                    "severity_score"
                ),
                (int, float)
            )
        ]

        # -----------------------------------------------------
        # Explicitly documented trends
        # -----------------------------------------------------

        explicit_trends = [
            x.get("trend")
            for x in history
            if x.get("trend")
        ]

        latest_documented_trend = (
            explicit_trends[-1]
            if explicit_trends
            else None
        )

        # -----------------------------------------------------
        # Numeric trend
        #
        # Only derive a trend when at least two actual numeric
        # severity measurements are available.
        # -----------------------------------------------------

        numeric_trend = None

        if len(numeric_points) >= 2:

            first_numeric = (
                numeric_points[0][
                    "severity_score"
                ]
            )

            latest_numeric = (
                numeric_points[-1][
                    "severity_score"
                ]
            )

            if latest_numeric < first_numeric:

                numeric_trend = (
                    "Improving"
                )

            elif latest_numeric > first_numeric:

                numeric_trend = (
                    "Worsening"
                )

            else:

                numeric_trend = (
                    "Stable"
                )

        # -----------------------------------------------------
        # Trend priority:
        #
        # 1. Explicitly documented clinical trend
        # 2. Derivable numeric trend
        # 3. No trend
        # -----------------------------------------------------

        overall_trend = (
            latest_documented_trend
            or numeric_trend
        )

        # -----------------------------------------------------
        # First documented severity
        #
        # Do NOT use numeric_points here because the first
        # documented severity could be qualitative.
        # -----------------------------------------------------

        first_documented = (
            history[0]
            if history
            else None
        )

        latest_documented = (
            history[-1]
            if history
            else None
        )

        # -----------------------------------------------------
        # Build final longitudinal symptom record
        # -----------------------------------------------------

        result.append({

            # Original display name
            "name":
                symptom_data["name"],

            # Complete sparse history
            "history":
                history,

            # First documented severity,
            # regardless of whether numeric or qualitative
            "first_severity":
                (
                    first_documented.get(
                        "severity"
                    )
                    if first_documented
                    else None
                ),

            # Latest documented severity
            "latest_severity":
                (
                    latest_documented.get(
                        "severity"
                    )
                    if latest_documented
                    else None
                ),

            # Latest explicitly documented trend
            "latest_documented_trend":
                latest_documented_trend,

            # Overall trend:
            # explicit documentation first,
            # numeric derivation second
            "overall_trend":
                overall_trend,
        })

    return result


def compute_medication_timeline(
    ordered_visits: List[dict]
) -> List[dict]:

    drugs: Dict[str, dict] = {}

    # =========================================================
    # HELPERS
    # =========================================================

    def normalize_drug(name):

        if not name:
            return None

        return " ".join(
            str(name).strip().lower().split()
        )

    def normalize_action(value):

        if not value:
            return None

        return " ".join(
            str(value).strip().lower().split()
        )

    def normalize_text(value):

        if value is None:
            return ""

        if isinstance(value, (list, tuple)):
            return " ".join(
                str(x)
                for x in value
                if x
            )

        return str(value)

    def contains_any(text, terms):

        text = normalize_text(text).lower()

        return any(
            term in text
            for term in terms
        )

    def medication_mentioned_in_text(
        drug_name,
        text
    ):

        if not drug_name or not text:
            return False

        return (
            normalize_drug(drug_name)
            in normalize_text(text).lower()
        )

    # =========================================================
    # COLLECT
    # =========================================================

    for v in ordered_visits:

        visit_number = v.get(
            "visit_number"
        )

        visit_date = (
            v.get("appointment") or {}
        ).get(
            "appointment_date"
        )

        medications = (
            v.get("medications") or []
        )

        # -----------------------------------------------------
        # Generic evidence from the visit
        # -----------------------------------------------------

        completed_actions = (
            v.get("completed_actions")
            or []
        )

        orders = (
            v.get("orders")
            or []
        )

        # Some pipelines may store this under treatment/events
        # rather than directly on the visit.
        treatment_events = (
            v.get("treatment_events")
            or v.get("events")
            or []
        )

        visit_text_parts = []

        visit_text_parts.extend(
            str(x)
            for x in completed_actions
            if x
        )

        visit_text_parts.extend(
            str(x)
            for x in orders
            if x
        )

        # Add common textual clinical fields if present.
        for key in (
            "overall_visit_summary",
            "clinical_assessment",
            "treatment_summary",
            "consultation",
            "treatment",
        ):

            value = v.get(key)

            if value:

                if isinstance(
                    value,
                    dict
                ):
                    visit_text_parts.append(
                        json.dumps(
                            value,
                            default=str
                        )
                    )

                else:
                    visit_text_parts.append(
                        str(value)
                    )

        for event in treatment_events:

            if isinstance(
                event,
                dict
            ):

                visit_text_parts.extend(
                    str(event.get(k))
                    for k in (
                        "title",
                        "description",
                        "event_type",
                    )
                    if event.get(k)
                )

            else:

                visit_text_parts.append(
                    str(event)
                )

        visit_text = " ".join(
            visit_text_parts
        )

        # =====================================================
        # PROCESS MEDICATIONS
        # =====================================================

        for medication in medications:

            if not isinstance(
                medication,
                dict
            ):
                continue

            raw_drug = medication.get(
                "drug"
            )

            drug_key = normalize_drug(
                raw_drug
            )

            if not drug_key:
                continue

            action = normalize_action(
                medication.get("action")
            )

            dose = medication.get(
                "dose"
            )

            reason = medication.get(
                "reason"
            )

            # -------------------------------------------------
            # Additional optional medication fields
            # -------------------------------------------------

            route = medication.get(
                "route"
            )

            frequency = medication.get(
                "frequency"
            )

            medication_status = (
                medication.get("status")
            )

            administered = medication.get(
                "administered"
            )

            # -------------------------------------------------
            # Create drug record
            # -------------------------------------------------

            entry = drugs.setdefault(
                drug_key,
                {
                    "drug": raw_drug,

                    "started": None,

                    "stopped": None,

                    "status": "unknown",

                    "current_dose": None,

                    "reason_for_stop": None,

                    "dose_changes": [],

                    "history": [],
                }
            )

            # =================================================
            # DETERMINE WHETHER THIS VISIT REPRESENTS
            # ACTUAL ADMINISTRATION / USE
            # =================================================

            explicitly_administered = (
                administered is True
            )

            action_indicates_use = (
                action in {
                    "started",
                    "continued",
                    "administered",
                    "given",
                    "infused",
                    "completed",
                    "dose_changed",
                }
            )

            action_indicates_stop = (
                action in {
                    "stopped",
                    "discontinued",
                    "held",
                    "cancelled",
                }
            )

            # -------------------------------------------------
            # Generic textual administration evidence.
            #
            # This does NOT use medication names.
            # It simply checks whether the current medication
            # appears in an administration statement.
            # -------------------------------------------------

            drug_in_visit_text = (
                medication_mentioned_in_text(
                    raw_drug,
                    visit_text
                )
            )

            administration_language = (
                "administered",
                "given",
                "infused",
                "injected",
                "received",
                "completed",
            )

            text_indicates_administration = (
                drug_in_visit_text
                and contains_any(
                    visit_text,
                    administration_language
                )
            )

            actual_use = (
                explicitly_administered
                or action_indicates_use
                or text_indicates_administration
            )

            # =================================================
            # HISTORY DEDUPLICATION
            # =================================================

            existing_event = next(
                (
                    x
                    for x in entry["history"]
                    if x.get(
                        "visit_number"
                    ) == visit_number
                ),
                None
            )

            if existing_event:

                if (
                    not existing_event.get(
                        "action"
                    )
                    and action
                ):
                    existing_event[
                        "action"
                    ] = action

                if (
                    existing_event.get(
                        "dose"
                    ) is None
                    and dose is not None
                ):
                    existing_event[
                        "dose"
                    ] = dose

                if (
                    not existing_event.get(
                        "reason"
                    )
                    and reason
                ):
                    existing_event[
                        "reason"
                    ] = reason

                if (
                    not existing_event.get(
                        "route"
                    )
                    and route
                ):
                    existing_event[
                        "route"
                    ] = route

                if (
                    not existing_event.get(
                        "frequency"
                    )
                    and frequency
                ):
                    existing_event[
                        "frequency"
                    ] = frequency

                if (
                    existing_event.get(
                        "administered"
                    ) is not True
                    and actual_use
                ):
                    existing_event[
                        "administered"
                    ] = True

            else:

                entry["history"].append({

                    "visit_number":
                        visit_number,

                    "date":
                        visit_date,

                    "action":
                        action,

                    "dose":
                        dose,

                    "reason":
                        reason,

                    "route":
                        route,

                    "frequency":
                        frequency,

                    "administered":
                        actual_use,

                })

            # =================================================
            # EXPLICIT STOP
            # =================================================

            if action_indicates_stop:

                entry[
                    "stopped"
                ] = visit_date

                entry[
                    "status"
                ] = "stopped"

                if reason:

                    entry[
                        "reason_for_stop"
                    ] = reason

                continue

            # =================================================
            # EXPLICIT START / CONTINUE / ADMINISTRATION
            # =================================================

            if actual_use:

                if not entry[
                    "started"
                ]:

                    entry[
                        "started"
                    ] = visit_date

                # ---------------------------------------------
                # Do not reactivate a medication explicitly
                # documented as stopped unless a later explicit
                # start is present.
                # ---------------------------------------------

                if entry[
                    "status"
                ] != "stopped":

                    entry[
                        "status"
                    ] = "active"

                if dose is not None:

                    entry[
                        "current_dose"
                    ] = dose

            # =================================================
            # DOSE CHANGE
            # =================================================

            if action == "dose_changed":

                duplicate_change = any(
                    x.get(
                        "visit_number"
                    ) == visit_number
                    for x in entry[
                        "dose_changes"
                    ]
                )

                if not duplicate_change:

                    entry[
                        "dose_changes"
                    ].append({

                        "visit_number":
                            visit_number,

                        "date":
                            visit_date,

                        "dose":
                            dose,

                        "reason":
                            reason,

                    })

                if dose is not None:

                    entry[
                        "current_dose"
                    ] = dose

                if entry[
                    "status"
                ] != "stopped":

                    entry[
                        "status"
                    ] = "active"

    # =========================================================
    # SORT
    # =========================================================

    result = list(
        drugs.values()
    )

    for entry in result:

        entry[
            "history"
        ].sort(
            key=lambda x:
                x.get(
                    "visit_number"
                ) or 0
        )

        entry[
            "dose_changes"
        ].sort(
            key=lambda x:
                x.get(
                    "visit_number"
                ) or 0
        )

    return result

def compute_treatment_history(
    ordered_visits: List[dict]
) -> List[dict]:

    treatments = {}

    def first_non_empty(*values):
        for value in values:
            if value not in (None, "", [], {}):
                return value
        return None

    # =========================================================
    # CYCLE HISTORY
    # =========================================================
    def extract_cycle_history(details):

        history = []

        if not isinstance(details, dict):
            return history

        # ---------------------------------------------
        # Nested previous treatments
        # ---------------------------------------------
        previous_treatments = (
            details.get("previous_treatments") or []
        )

        if isinstance(previous_treatments, list):

            for treatment in previous_treatments:

                if not isinstance(treatment, dict):
                    continue

                cycle = first_non_empty(
                    treatment.get("cycle"),
                    treatment.get("cycle_number"),
                    treatment.get("cycles_completed"),
                )

                if cycle is None:
                    continue

                history.append({
                    "cycle": cycle,
                    "date": treatment.get("date"),
                    "outcome": treatment.get("outcome"),
                })

        # ---------------------------------------------
        # Current treatment cycle
        # ---------------------------------------------
        current_cycle = first_non_empty(
            details.get("cycle_number"),
            details.get("cycle"),
        )

        if current_cycle is not None:

            history.append({
                "cycle": current_cycle,
                "date": details.get("cycle_date"),
                "outcome": details.get("cycle_outcome"),
            })

        # ---------------------------------------------
        # Deduplicate
        # ---------------------------------------------
        unique = []
        seen = set()

        for item in history:

            key = (
                item.get("cycle"),
                item.get("date"),
                item.get("outcome"),
            )

            if key in seen:
                continue

            seen.add(key)
            unique.append(item)

        return unique

    # =========================================================
    # CYCLES COMPLETED
    # =========================================================
    def extract_cycles(details):

        if not isinstance(details, dict):
            return None

        # Direct values
        direct = first_non_empty(
            details.get("cycles_completed"),
            details.get("cycles"),
        )

        if direct is not None:
            return direct

        # Derive from cycle history
        history = extract_cycle_history(details)

        cycle_numbers = []

        for item in history:

            cycle = item.get("cycle")

            if isinstance(cycle, (int, float)):
                cycle_numbers.append(int(cycle))

            elif isinstance(cycle, str):

                try:
                    cycle_numbers.append(int(cycle))
                except (ValueError, TypeError):
                    pass

        if cycle_numbers:
            return max(cycle_numbers)

        # Last fallback
        cycle_number = details.get("cycle_number")

        if cycle_number is not None:
            return cycle_number

        return None

    # =========================================================
    # END DATE
    # =========================================================
    def extract_end_date(details):

        if not isinstance(details, dict):
            return None

        return first_non_empty(
            details.get("end_date"),
            details.get("endDate"),
            details.get("stop_date"),
            details.get("completion_date"),
            details.get("completed_date"),
        )

    # =========================================================
    # STATUS
    # =========================================================
    def extract_status(details):

        if not isinstance(details, dict):
            return None

        return first_non_empty(
            details.get("status"),
            details.get("treatment_status"),
            details.get("therapy_status"),
        )

    # =========================================================
    # REASON FOR CHANGE
    # =========================================================
    def extract_reason_for_change(details):

        if not isinstance(details, dict):
            return None

        # Direct fields
        reason = first_non_empty(
            details.get("reason_for_change"),
            details.get("change_reason"),
            details.get("reason_for_discontinuation"),
            details.get("reason_for_stop"),
        )

        if reason:
            return reason

        # Search nested fields
        def walk(value):

            if isinstance(value, dict):

                for key in (
                    "reason_for_change",
                    "change_reason",
                    "reason_for_discontinuation",
                    "reason_for_stop",
                ):
                    if value.get(key):
                        return value.get(key)

                for child in value.values():

                    result = walk(child)

                    if result:
                        return result

            elif isinstance(value, list):

                for child in value:

                    result = walk(child)

                    if result:
                        return result

            return None

        return walk(details)

    # =========================================================
    # REGIMEN IDENTITY
    # =========================================================
    def treatment_identity(modality, details):

        regimen = first_non_empty(
            details.get("regimen"),
            details.get("treatment_name"),
            details.get("name"),
            modality,
        )

        if not regimen:
            return None

        # Normalize identity so the same treatment across visits
        # is merged into the same treatment line.
        return str(regimen).strip().lower()

    # =========================================================
    # PROCESS VISITS
    # =========================================================
    for visit in ordered_visits:

        visit_number = visit.get("visit_number")

        visit_date = (
            visit.get("appointment") or {}
        ).get("appointment_date")

        visit_treatments = visit.get("treatment") or {}

        if not isinstance(visit_treatments, dict):
            continue

        for modality, raw_details in visit_treatments.items():

            details = raw_details or {}

            if not isinstance(details, dict):
                continue

            # Never fabricate a treatment LINE for a document that gave us
            # no identifying information (no modality, no regimen name).
            # The underlying data is still preserved on the visit record
            # for audit — it's just excluded from the numbered line table.
            if details.get("_identity_unknown"):
                continue

            # ---------------------------------------------
            # REGIMEN
            # ---------------------------------------------
            regimen = first_non_empty(
                details.get("regimen"),
                details.get("treatment_name"),
                details.get("name"),
                modality,
            )

            if not regimen:
                continue

            # ---------------------------------------------
            # IDENTITY
            # ---------------------------------------------
            treatment_key = treatment_identity(
                modality,
                details
            )

            if not treatment_key:
                continue

            # ---------------------------------------------
            # Extract all information
            # ---------------------------------------------
            cycle_history = extract_cycle_history(details)

            cycles_completed = extract_cycles(details)

            end_date = extract_end_date(details)

            explicit_status = extract_status(details)

            reason_for_change = (
                extract_reason_for_change(details)
            )

            intent = first_non_empty(
                details.get("intent"),
                details.get("treatment_intent"),
            )

            # =================================================
            # FIRST OCCURRENCE
            # =================================================
            if treatment_key not in treatments:

                treatments[treatment_key] = {

                    # Temporary value.
                    # Actual Line number is assigned after
                    # all treatments are collected.
                    "line": None,

                    "regimen": regimen,

                    "intent": intent,

                    "start_date": visit_date,

                    "end_date": end_date,

                    "cycles_completed": cycles_completed,

                    "cycle_history": cycle_history,

                    "status": explicit_status,

                    "reason_for_change": reason_for_change,

                    # Preserve complete original treatment data
                    "details": dict(details),

                    "last_seen_visit": visit_number,
                }

            # =================================================
            # EXISTING TREATMENT
            # =================================================
            else:

                entry = treatments[treatment_key]

                # ---------------------------------------------
                # Merge details
                # ---------------------------------------------
                entry["details"] = {
                    **entry.get("details", {}),
                    **details,
                }

                # ---------------------------------------------
                # Intent
                # ---------------------------------------------
                entry["intent"] = first_non_empty(
                    intent,
                    entry.get("intent"),
                )

                # ---------------------------------------------
                # Cycles
                # ---------------------------------------------
                entry["cycles_completed"] = first_non_empty(
                    cycles_completed,
                    entry.get("cycles_completed"),
                )

                # ---------------------------------------------
                # Cycle history
                # ---------------------------------------------
                existing_history = (
                    entry.get("cycle_history") or []
                )

                combined_history = (
                    existing_history + cycle_history
                )

                unique_history = []

                seen_cycles = set()

                for item in combined_history:

                    cycle_key = (
                        item.get("cycle"),
                        item.get("date"),
                        item.get("outcome"),
                    )

                    if cycle_key in seen_cycles:
                        continue

                    seen_cycles.add(cycle_key)

                    unique_history.append(item)

                entry["cycle_history"] = unique_history

                # ---------------------------------------------
                # Recalculate cycle count
                # ---------------------------------------------
                cycle_numbers = []

                for item in unique_history:

                    cycle = item.get("cycle")

                    if isinstance(cycle, (int, float)):

                        cycle_numbers.append(int(cycle))

                    elif isinstance(cycle, str):

                        try:
                            cycle_numbers.append(
                                int(cycle)
                            )
                        except (ValueError, TypeError):
                            pass

                if cycle_numbers:

                    entry["cycles_completed"] = max(
                        cycle_numbers
                    )

                # ---------------------------------------------
                # End date
                # ---------------------------------------------
                entry["end_date"] = first_non_empty(
                    end_date,
                    entry.get("end_date"),
                )

                # ---------------------------------------------
                # Status
                # ---------------------------------------------
                entry["status"] = first_non_empty(
                    explicit_status,
                    entry.get("status"),
                )

                # ---------------------------------------------
                # Reason for change
                # ---------------------------------------------
                entry["reason_for_change"] = first_non_empty(
                    reason_for_change,
                    entry.get("reason_for_change"),
                )

                # ---------------------------------------------
                # Last visit
                # ---------------------------------------------
                entry["last_seen_visit"] = visit_number

                # ---------------------------------------------
                # Earliest treatment date
                # ---------------------------------------------
                if (
                    visit_date
                    and (
                        not entry.get("start_date")
                        or visit_date < entry["start_date"]
                    )
                ):
                    entry["start_date"] = visit_date

    # =========================================================
    # AUTOMATICALLY ASSIGN LINE NUMBERS
    # =========================================================
    result = list(treatments.values())

    # Sort chronologically first
    result.sort(
        key=lambda x: (
            x.get("start_date") or "",
            x.get("regimen") or "",
        )
    )

    # Assign Line 1, Line 2, Line 3...
    for index, entry in enumerate(result, start=1):

        entry["line"] = f"Line {index}"

        # =========================================================
    # FINAL STATUS NORMALIZATION
    # -----------------------------------------------------------------
    # NEVER default an unlabeled treatment to "Active". A treatment that
    # is only PLANNED, ORDERED, or PENDING must not be reported as
    # started just because a regimen name exists in a document. The only
    # evidence allowed to imply "started" without an explicit status word
    # is STRUCTURAL: a recorded cycle/administration actually happened
    # (cycles_completed, real cycle_history entries, or an explicit
    # administered=true flag). Absent both, the treatment is "Planned" --
    # a neutral label, not a guess.
    # =========================================================
    for entry in result:

        details = entry.get("details") or {}

        explicit_status = first_non_empty(
            entry.get("status"),
            details.get("status"),
            details.get("treatment_status"),
            details.get("therapy_status"),
        )

        administered_flag = details.get("administered")
        has_administration_evidence = bool(
            administered_flag is True
            or entry.get("cycles_completed")
            or (entry.get("cycle_history") or [])
        )
        entry["administered"] = bool(administered_flag is True or has_administration_evidence)

        if explicit_status:

            entry["status"] = explicit_status

        elif entry.get("end_date"):

            entry["status"] = "Completed"

        elif has_administration_evidence:

            entry["status"] = "Active"

        else:

            entry["status"] = "Planned"

    return result

RESPONSE_RANK = {
    "Complete Response": 4,
    "Partial Response": 3,
    "Stable Disease": 2,
    "Baseline": 1,
    "Progressive Disease": 0,
}


# =====================================================================
# PHASE 1 — CANCER CASE IDENTITY / T0 BASELINE / TREATMENT-LINE BASELINES
# -----------------------------------------------------------------------
# Everything below is deterministic (no LLM calls). Every lookup is
# structural: it walks the SAME fields_by_category / clinical_measurements
# / symptoms / vitals / treatment schema the extraction prompt above
# already produces, the same way compute_treatment_history() and
# _infer_stage_from_text() already do. Nothing here references a cancer
# type, organ, biomarker, or treatment keyword.
# =====================================================================
def _get_nested(container: Optional[dict], path: str) -> Any:
    """Generic dotted-path getter, e.g. _get_nested(d, 'tnm.t')."""
    cur = container
    for part in path.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def _normalize_identity_value(value: Any) -> Any:
    if isinstance(value, str):
        return " ".join(value.strip().lower().split())
    if isinstance(value, dict):
        return json.dumps(value, sort_keys=True, default=str)
    return value


def _v(field: Optional[dict]) -> Any:
    """Unwraps a provenance-tagged identity field to its bare value."""
    return field.get("value") if isinstance(field, dict) else None


def _visit_documents_for_category(visit: dict, category: str) -> List[dict]:
    return [
        d for d in (visit.get("documents") or [])
        if d.get("primary_category") == category
        or category in (d.get("secondary_categories") or [])
    ]


def _latest_document_ref(visit: dict, category: str) -> Optional[dict]:
    docs = _visit_documents_for_category(visit, category)
    if not docs:
        return None
    return docs[-1]


def _chronological(visits: List[dict]) -> List[dict]:
    """Same ordering rule compute_analytics_layers already uses: date first,
    visit_number only as a tie-breaker."""
    return sorted(
        visits,
        key=lambda v: (
            (v.get("appointment") or {}).get("appointment_date") or "",
            v.get("visit_number") or 0,
        ),
    )


def _deep_merge_clinical_dict(base: dict, incoming: dict) -> dict:
    """Generic accumulator for a category's fields_by_category dict across
    multiple visits. Dicts merge recursively; lists concatenate + dedupe by
    content (so repeated IHC/mutation entries across documents don't
    duplicate); scalars keep the first non-empty value seen (earliest wins,
    consistent with case-identity resolution below)."""
    result = dict(base or {})
    for k, v in (incoming or {}).items():
        if v in (None, "", [], {}):
            continue
        if k not in result or result[k] in (None, "", [], {}):
            result[k] = v
        elif isinstance(result[k], dict) and isinstance(v, dict):
            result[k] = _deep_merge_clinical_dict(result[k], v)
        elif isinstance(result[k], list) and isinstance(v, list):
            seen = {json.dumps(x, sort_keys=True, default=str) for x in result[k]}
            merged = list(result[k])
            for item in v:
                sig = json.dumps(item, sort_keys=True, default=str)
                if sig not in seen:
                    merged.append(item)
                    seen.add(sig)
            result[k] = merged
        # else: keep the first value already stored; do not overwrite
    return result


def _category_container(visit: dict, category: str) -> Optional[dict]:
    if category == "consultation":
        return visit.get("consultation") or {}
    return (visit.get("uploaded_between_visits") or {}).get(category) or {}


_CLINICAL_ATTRIBUTE_MATCH_THRESHOLD = 0.72


def _clinical_attribute_search_term(field_key: str) -> str:
    """Derives a generic lexical search term directly from the identity
    field's OWN schema key -- e.g. 'stage_overall' -> 'stage overall',
    'tnm_t' -> 'tnm t'. This is purely a formatting of the field's own
    name (already defined structurally in _CASE_IDENTITY_FIELD_MAP below),
    not a disease-specific vocabulary list -- identical derivation for
    every field, every cancer type."""
    return field_key.replace("_", " ").strip()


def _resolve_from_clinical_attributes(
    ordered_completed_visits: List[dict],
    field_key: str,
) -> Optional[dict]:
    """Generic fallback evidence source (fixes the gap where information
    embedded inside narrative/diagnosis text isn't preserved structurally):
    scans every visit's flat clinical_attributes list -- the LLM's
    catch-all for clinically meaningful facts that didn't fit a predefined
    category schema -- for an attribute whose own "name" lexically matches
    this identity field's own schema key, using the SAME generic
    similarity function already used for clinical_measurements name
    matching (_metric_name_similarity). A fact the LLM extracted as
    {"name": "Grade", "value": "Grade 2"} is thereby found for the "grade"
    identity field WITHOUT any per-cancer or per-field keyword list --
    purely structural lexical matching against the field's own name."""
    search_term = _clinical_attribute_search_term(field_key)
    best: Optional[dict] = None
    best_score = 0.0
    for visit in ordered_completed_visits:
        for attribute in visit.get("clinical_attributes") or []:
            if not isinstance(attribute, dict):
                continue
            name = attribute.get("name")
            value = attribute.get("value")
            if not name or value in (None, "", [], {}):
                continue
            score = _metric_name_similarity(search_term, name)
            if score >= _CLINICAL_ATTRIBUTE_MATCH_THRESHOLD and score > best_score:
                best_score = score
                best = {
                    "value": value,
                    "source": "clinical_attributes",
                    "document_id": None,
                    "visit_number": visit.get("visit_number"),
                    "date": (visit.get("appointment") or {}).get("appointment_date"),
                    "match_score": round(score, 2),
                }
    return best


def _resolve_case_identity_field(
    ordered_completed_visits: List[dict],
    field_key: str,
    candidates: List[Tuple[str, str]],  # [(category, dotted_path), ...] priority order
) -> Optional[dict]:
    """Scans every completed visit, for every (category, path) candidate in
    priority order, and returns the FIRST value found (by candidate
    priority, then chronological order within that category) as the
    primary value -- with full provenance. Every differing value found
    anywhere else (any category, any visit, or the generic
    clinical_attributes fallback below) is recorded under "conflicts",
    never silently dropped or overwritten."""
    found: List[dict] = []

    for category, path in candidates:
        for visit in ordered_completed_visits:
            container = _category_container(visit, category)
            value = _get_nested(container, path)
            if value in (None, "", [], {}):
                continue
            doc_ref = _latest_document_ref(visit, category)
            found.append({
                "value": value,
                "source": category,
                "document_id": doc_ref.get("document_id") if doc_ref else None,
                "visit_number": visit.get("visit_number"),
                "date": (visit.get("appointment") or {}).get("appointment_date"),
            })

    # Generic safety-net fallback: only reaches primary position when no
    # structured schema field produced a value above -- otherwise it's
    # recorded as a conflict for transparency (see selection below).
    attribute_candidate = _resolve_from_clinical_attributes(ordered_completed_visits, field_key)
    if attribute_candidate:
        found.append(attribute_candidate)

    if not found:
        return None

    primary = found[0]
    conflicts = [
        f for f in found[1:]
        if _normalize_identity_value(f["value"]) != _normalize_identity_value(primary["value"])
    ]
    result = dict(primary)
    if conflicts:
        result["conflicts"] = conflicts
    return result


# Priority order per identity field: which document TYPE is the most
# authoritative source for that field, structurally -- not disease-specific.
# Pathology > consultation > imaging > molecular is a general convention
# for diagnostic fields (the tissue diagnosis outranks a clinical
# impression), identical for every cancer type.
_CASE_IDENTITY_FIELD_MAP: Dict[str, List[Tuple[str, str]]] = {
    "diagnosis": [("pathology", "diagnosis"), ("consultation", "diagnosis"), ("imaging", "diagnosis")],
    "organ": [("pathology", "organ"), ("imaging", "body_site"), ("consultation", "organ")],
    "site": [("pathology", "site"), ("imaging", "body_site")],
    "histology": [("pathology", "histology"), ("consultation", "histology")],
    "subtype": [("pathology", "subtype")],
    "grade": [("pathology", "grade"), ("consultation", "grade")],
    "differentiation": [("pathology", "differentiation")],
    "stage_overall": [("pathology", "stage"), ("consultation", "stage"), ("imaging", "stage")],
    "tnm_t": [("pathology", "tnm.t"), ("consultation", "tnm.t"), ("imaging", "tnm.t")],
    "tnm_n": [("pathology", "tnm.n"), ("consultation", "tnm.n"), ("imaging", "tnm.n")],
    "tnm_m": [("pathology", "tnm.m"), ("consultation", "tnm.m"), ("imaging", "tnm.m")],
}


def build_cancer_case_identity(
    patient_information: Dict[str, Any],
    completed_visits: List[dict],
) -> Dict[str, Any]:
    """Deterministic. The stable identity of the patient's cancer, resolved
    by scanning fields_by_category (plus the generic clinical_attributes
    safety net) across ALL completed visits -- never a fresh LLM call.
    Every field carries provenance (source category, document_id,
    visit_number, date) and any conflicting value found elsewhere is
    preserved under "conflicts" rather than discarded."""
    if not completed_visits:
        return {}

    ordered = _chronological(completed_visits)
    identity: Dict[str, Optional[dict]] = {
        name: _resolve_case_identity_field(ordered, name, candidates)
        for name, candidates in _CASE_IDENTITY_FIELD_MAP.items()
    }

    # Deterministic stage backfill using the SAME regex helper the rest of
    # the pipeline already relies on (_infer_stage_from_text), only if no
    # structured field (or clinical_attributes fallback) produced a stage
    # anywhere above.
    if not identity.get("stage_overall"):
        for visit in ordered:
            consultation_text = json.dumps(visit.get("consultation") or {}, default=str)
            pathology_text = json.dumps(_category_container(visit, "pathology"), default=str)
            inferred = _infer_stage_from_text(consultation_text, pathology_text)
            if inferred:
                identity["stage_overall"] = {
                    "value": inferred,
                    "source": "regex_backfill",
                    "document_id": None,
                    "visit_number": visit.get("visit_number"),
                    "date": (visit.get("appointment") or {}).get("appointment_date"),
                }
                break

    pathology_full: Dict[str, Any] = {}
    molecular_full: Dict[str, Any] = {}
    tumor_markers_full: Dict[str, Any] = {}
    imaging_full: Dict[str, Any] = {}
    first_cancer_document_date = None

    for visit in ordered:
        pathology_full = _deep_merge_clinical_dict(pathology_full, _category_container(visit, "pathology"))
        molecular_full = _deep_merge_clinical_dict(molecular_full, _category_container(visit, "molecular"))
        tumor_markers_full = _deep_merge_clinical_dict(tumor_markers_full, _category_container(visit, "tumor_markers"))
        imaging_full = _deep_merge_clinical_dict(imaging_full, _category_container(visit, "imaging"))

        if first_cancer_document_date is None and (
            _category_container(visit, "pathology") or (visit.get("consultation") or {}).get("diagnosis")
        ):
            first_cancer_document_date = (visit.get("appointment") or {}).get("appointment_date")

    return {
        "diagnosis": identity.get("diagnosis"),
        "cancer": {
            "organ": identity.get("organ"),
            "site": identity.get("site"),
            "histology": identity.get("histology"),
            "subtype": identity.get("subtype"),
            "grade": identity.get("grade"),
            "differentiation": identity.get("differentiation"),
        },
        "stage": {
            "overall": identity.get("stage_overall"),
            "tnm": {
                "T": identity.get("tnm_t"),
                "N": identity.get("tnm_n"),
                "M": identity.get("tnm_m"),
            },
        },
        "pathology": pathology_full,
        "molecular": molecular_full,
        "baseline_biomarkers": tumor_markers_full,
        "baseline_imaging": imaging_full,
        "first_cancer_document_date": first_cancer_document_date,
    }


def _find_t0_visit(ordered_completed_visits: List[dict]) -> Optional[dict]:
    """T0 = the earliest visit that actually carries cancer-defining
    content (a pathology result, a stated diagnosis, or an imaging
    workup) -- not simply visit_number == 1, since backfilled/historical
    documents can arrive out of order."""
    for visit in ordered_completed_visits:
        if (
            _category_container(visit, "pathology")
            or (visit.get("consultation") or {}).get("diagnosis")
            or _category_container(visit, "imaging")
        ):
            return visit
    return ordered_completed_visits[0] if ordered_completed_visits else None


def _find_baseline_window_visits(ordered_completed_visits: List[dict]) -> List[dict]:
    """The full pre-treatment diagnostic-workup window: every completed
    visit up to (but not including) the FIRST visit where ANY treatment
    is structurally documented as actually administered (the same
    "administered" evidence compute_treatment_history already uses).
    Diagnostic workup -- pathology, staging imaging, molecular testing --
    routinely spans several visits before treatment starts, so T0 must
    aggregate that WHOLE pre-treatment history, not just the single
    earliest visit that happened to first mention a diagnosis. If no
    treatment has been administered yet, the window is every completed
    visit so far. Purely structural -- no cancer type or keyword logic."""
    for i, visit in enumerate(ordered_completed_visits):
        for details in (visit.get("treatment") or {}).values():
            details = details or {}
            has_administration_evidence = bool(
                details.get("administered") is True
                or details.get("cycles_completed")
                or details.get("cycle_number")
            )
            if has_administration_evidence:
                return ordered_completed_visits[:i] if i > 0 else ordered_completed_visits[:1]
    return ordered_completed_visits


def build_t0_baseline(
    case_identity: Dict[str, Any],
    completed_visits: List[dict],
) -> Dict[str, Any]:
    """Deterministic. T0 is meant to be the RICHEST baseline snapshot
    available, so instead of reading only the single earliest
    cancer-defining visit's own documents, this merges every structured
    category field (pathology / imaging / molecular / tumor_markers) and
    every numeric measurement across the FULL pre-treatment diagnostic
    window (see _find_baseline_window_visits) -- using the exact same
    generic deep-merge helper (_deep_merge_clinical_dict) already used to
    build cancer_case_identity. Pure structural aggregation, no
    cancer-type / metric-name / keyword logic."""
    ordered = _chronological(completed_visits)
    t0_visit = _find_t0_visit(ordered)
    if not t0_visit:
        return {}

    baseline_window_visits = _find_baseline_window_visits(ordered)
    # Guarantee the identified T0 visit itself is always included, even
    # if it happens to fall outside the pre-treatment window (defensive;
    # should not normally trigger).
    if t0_visit not in baseline_window_visits:
        baseline_window_visits = sorted(
            baseline_window_visits + [t0_visit],
            key=lambda v: (
                (v.get("appointment") or {}).get("appointment_date") or "",
                v.get("visit_number") or 0,
            ),
        )

    pathology_baseline: Dict[str, Any] = {}
    molecular_baseline: Dict[str, Any] = {}
    tumor_markers_baseline: Dict[str, Any] = {}
    imaging_baseline: Dict[str, Any] = {}
    measurements: Dict[str, Any] = {}
    baseline_source_documents: List[str] = []

    for v in baseline_window_visits:
        pathology_baseline = _deep_merge_clinical_dict(pathology_baseline, _category_container(v, "pathology"))
        molecular_baseline = _deep_merge_clinical_dict(molecular_baseline, _category_container(v, "molecular"))
        tumor_markers_baseline = _deep_merge_clinical_dict(tumor_markers_baseline, _category_container(v, "tumor_markers"))
        imaging_baseline = _deep_merge_clinical_dict(imaging_baseline, _category_container(v, "imaging"))
        baseline_source_documents += [d.get("document_id") for d in v.get("documents", [])]

        # Earliest-documented value wins per metric name -- same
        # "earliest wins" convention already used for case_identity.
        for name, entry in (v.get("clinical_measurements") or {}).items():
            if not isinstance(entry, dict) or name in measurements:
                continue
            measurements[name] = {
                "value": entry.get("value"),
                "unit": entry.get("unit"),
                "category": entry.get("category"),
                "body_site": entry.get("body_site"),
            }

    stage = case_identity.get("stage") or {}
    tnm = stage.get("tnm") or {}
    cancer = case_identity.get("cancer") or {}

    return {
        "timepoint": "T0",
        "type": "diagnosis_baseline",
        "date": (t0_visit.get("appointment") or {}).get("appointment_date"),
        "visit_number": t0_visit.get("visit_number"),
        "disease": {
            "diagnosis": _v(case_identity.get("diagnosis")),
            "organ": _v(cancer.get("organ")),
            "site": _v(cancer.get("site")),
            "histology": _v(cancer.get("histology")),
            "grade": _v(cancer.get("grade")),
            "stage": _v(stage.get("overall")),
            "tnm": {"T": _v(tnm.get("T")), "N": _v(tnm.get("N")), "M": _v(tnm.get("M"))},
        },
        "clinical": {"symptoms": t0_visit.get("symptoms") or []},
        "performance": {"ecog": (t0_visit.get("vitals") or {}).get("ecog")},
        "pathology": pathology_baseline,
        "imaging": imaging_baseline,
        "molecular_profile": molecular_baseline,
        "tumor_markers": tumor_markers_baseline,
        "measurements": measurements,
        "source_documents": list(dict.fromkeys(d for d in baseline_source_documents if d)),
    }


def _treatment_identity(details: dict, modality: str) -> str:
    regimen = (
        details.get("regimen")
        or details.get("treatment_name")
        or details.get("regimen_name")
        or details.get("name")
        or modality
    )
    return str(regimen).strip().lower()


def _find_treatment_start(
    ordered_completed_visits: List[dict], regimen_identity: str
) -> Tuple[Optional[int], Optional[str]]:
    """Earliest visit (and its modality key) where this treatment identity
    was first documented -- reuses the exact identity rule
    compute_treatment_history() already uses, so the two stay consistent."""
    for visit in ordered_completed_visits:
        for modality, details in (visit.get("treatment") or {}).items():
            details = details or {}
            if _treatment_identity(details, modality) == regimen_identity:
                return visit.get("visit_number"), modality
    return None, None


def build_treatment_baselines(
    completed_visits: List[dict],
    t0_baseline: Dict[str, Any],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Deterministic. Splits treatment history into two distinct
    concepts:
      - treatment_baselines: treatment LINES with STRUCTURAL evidence of
        actually being administered (entry["administered"] from
        compute_treatment_history) -- true T1/T2/... baselines.
      - treatment_plans: everything else (planned/ordered/pending/on
        hold) -- never numbered as a T-timepoint, never treated as
        active therapy.
    The gate is the purely structural "administered" boolean -- never a
    status-word/keyword check."""
    ordered = _chronological(completed_visits)
    if not ordered:
        return [], []

    treatment_history = compute_treatment_history(ordered)
    if not treatment_history:
        return [], []

    visits_by_number = {v["visit_number"]: v for v in ordered}
    baselines: List[Dict[str, Any]] = []
    plans: List[Dict[str, Any]] = []

    for treatment in treatment_history:
        regimen_identity = str(treatment.get("regimen") or "").strip().lower()
        start_visit_number, modality = _find_treatment_start(ordered, regimen_identity)
        if start_visit_number is None:
            continue

        pre_treatment_visit = None
        for visit in ordered:
            if visit["visit_number"] >= start_visit_number:
                break
            pre_treatment_visit = visit
        baseline_visit = pre_treatment_visit or visits_by_number.get(start_visit_number)

        baseline_measurements = {
            name: {"value": entry.get("value"), "unit": entry.get("unit"), "category": entry.get("category")}
            for name, entry in (baseline_visit.get("clinical_measurements") or {}).items()
            if isinstance(entry, dict)
        } if baseline_visit else {}

        source_documents = []
        if baseline_visit:
            source_documents += [d.get("document_id") for d in baseline_visit.get("documents", [])]
        start_visit = visits_by_number.get(start_visit_number)
        if start_visit:
            source_documents += [d.get("document_id") for d in start_visit.get("documents", [])]
        source_documents = list(dict.fromkeys(d for d in source_documents if d))

        treatment_payload = {
            "modality": modality,
            "regimen_name": treatment.get("regimen"),
            "intent": treatment.get("intent"),
            "start_date": treatment.get("start_date"),
            "cycles_completed": treatment.get("cycles_completed"),
            "status": treatment.get("status"),
            "administered": treatment.get("administered", False),
            "details": treatment.get("details"),
        }
        baseline_state = {
            "clinical": {"symptoms": (baseline_visit.get("symptoms") if baseline_visit else []) or []},
            "performance": {"ecog": ((baseline_visit or {}).get("vitals") or {}).get("ecog")},
            "measurements": baseline_measurements,
        }

        if treatment.get("administered"):
            baselines.append({
                "timepoint": f"T{len(baselines) + 1}",
                "type": "treatment_baseline",
                "treatment_line": treatment.get("line"),
                "date": treatment.get("start_date"),
                "treatment": treatment_payload,
                "baseline_state": baseline_state,
                "source_documents": source_documents,
            })
        else:
            plans.append({
                "type": "treatment_plan",
                "treatment_line": treatment.get("line"),
                "date": treatment.get("start_date"),
                "treatment": treatment_payload,
                "state_at_plan": baseline_state,
                "source_documents": source_documents,
            })

    return baselines, plans


def build_phase1_baseline(
    patient_information: Dict[str, Any],
    completed_visits: List[dict],
) -> Dict[str, Any]:
    """Orchestrator: Cancer Case Identity -> T0 Baseline -> Treatment
    Baselines / Treatment Plans."""
    ordered = _chronological(completed_visits)
    case_identity = build_cancer_case_identity(patient_information, ordered)
    t0_baseline = build_t0_baseline(case_identity, ordered)
    treatment_baselines, treatment_plans = build_treatment_baselines(ordered, t0_baseline)
    return {
        "cancer_case_identity": case_identity,
        "t0_baseline": t0_baseline,
        "treatment_baselines": treatment_baselines,
        "treatment_plans": treatment_plans,
    }


# def _administered_treatment_reference_texts(ordered_visits: List[dict]) -> List[str]:
#     """Every treatment record any of these visits documents as actually
#     administered (same structural evidence compute_treatment_history()
#     already uses), rendered as a plain reference string built purely
#     from the treatment's OWN structured fields -- never a hardcoded
#     drug or regimen name."""
#     references: List[str] = []
#     for v in ordered_visits:
#         for modality, details in (v.get("treatment") or {}).items():
#             details = details or {}
#             has_administration_evidence = bool(
#                 details.get("administered") is True
#                 or details.get("cycles_completed")
#                 or details.get("cycle_number")
#             )
#             if not has_administration_evidence:
#                 continue
#             parts = [
#                 modality,
#                 details.get("regimen") or "",
#                 details.get("regimen_name") or "",
#                 details.get("treatment_name") or "",
#             ]
#             drugs = details.get("drugs")
#             if isinstance(drugs, list):
#                 parts.append(" ".join(str(d) for d in drugs))
#             reference = " ".join(p for p in parts if p)
#             if reference.strip():
#                 references.append(reference)
#     return references

def _administered_treatments(ordered_visits: List[dict]) -> List[dict]:
    """
    Return structured treatment records that have evidence of actual
    administration.

    Uses only the treatment structure extracted from the document.
    No disease-specific or drug-specific logic......
    """
    administered: List[dict] = []

    for visit in ordered_visits or []:
        for modality, details in (visit.get("treatment") or {}).items():
            if not isinstance(details, dict):
                continue

            status = str(
                details.get("status") or ""
            ).strip().lower()

            is_administered = (
                details.get("administered") is True
                or status in {
                    "completed",
                    "administered",
                    "given",
                    "delivered",
                    "ongoing",
                    "in progress",
                    "active",
                }
            )

            if not is_administered:
                continue

            administered.append({
                "modality": modality,
                "details": details,
            })

    return administered

def _extract_cycle_number(text: Optional[str]) -> Optional[int]:
    if not text:
        return None

    match = re.search(
        r"\bcycle\s*(?:number\s*)?(\d+)\b",
        text.lower()
    )

    if not match:
        return None

    return int(match.group(1))

def _is_pending_action_resolved_by_administered_treatment(
    pending_text: str,
    administered_treatments: List[dict],
) -> bool:
    """
    Determine whether a pending treatment action was fulfilled by an
    actually administered treatment.

    Uses only structured treatment data from the visit.
    No cancer-specific, drug-specific, or regimen-specific rules.
    """

    if not pending_text:
        return False

    pending_lower = pending_text.lower()

    # If the pending action explicitly contains a cycle number,
    # extract it so we can compare it with the administered treatment.
    pending_cycle = _extract_cycle_number(pending_text)

    for treatment in administered_treatments or []:

        details = treatment.get("details") or {}

        modality = str(
            treatment.get("modality") or ""
        ).strip().lower()

        # ---------------------------------------------------------
        # Check cycle when the pending action specifies one
        # ---------------------------------------------------------
        if pending_cycle is not None:

            administered_cycle = details.get("cycle_number")

            if administered_cycle is None:
                administered_cycle = details.get("cycles_completed")

            try:
                administered_cycle = int(administered_cycle)
            except (TypeError, ValueError):
                administered_cycle = None

            if administered_cycle != pending_cycle:
                continue

        # ---------------------------------------------------------
        # Build searchable text from the ACTUAL structured
        # treatment fields.
        # ---------------------------------------------------------
        treatment_parts = [
            modality,
            details.get("modality"),
            details.get("regimen"),
            details.get("regimen_name"),
            details.get("treatment_name"),
        ]

        drugs = details.get("drugs")

        if isinstance(drugs, list):
            treatment_parts.extend(
                str(drug)
                for drug in drugs
                if drug
            )

        treatment_text = " ".join(
            str(value)
            for value in treatment_parts
            if value
        ).lower()

        # ---------------------------------------------------------
        # Generic treatment identity comparison
        # ---------------------------------------------------------
        if _metric_name_similarity(
            pending_text,
            treatment_text
        ) >= _METRIC_MATCH_THRESHOLD:
            return True

        # ---------------------------------------------------------
        # Generic modality match
        #
        # Example:
        # pending = "Administer Cycle 1 chemotherapy"
        # modality = "chemotherapy"
        #
        # Cycle has already matched above.
        # ---------------------------------------------------------
        if modality and modality in pending_lower:
            return True

    return False


def compute_active_alerts(ordered_visits: List[dict]) -> List[dict]:
    """
    Calculate the active alert set across the complete longitudinal history.

    Identity rule: two alert mentions represent the SAME underlying
    alert when their titles are lexically close enough via the same
    generic, disease-agnostic similarity function used throughout this
    pipeline (_metric_name_similarity). No keyword list, synonym table,
    or disease-specific vocabulary is used anywhere.
    """
    active: Dict[str, Dict[str, Any]] = {}
    canonical_titles: List[str] = []

    for visit in ordered_visits:

        # ADD / UPDATE
        for alert in visit.get("alerts") or []:
            if not isinstance(alert, dict):
                continue
            title = alert.get("title")
            if not title:
                continue

            match = _find_fuzzy_text_match(title, canonical_titles)
            if match is None:
                canonical_titles.append(title)
                active[title] = dict(alert)
            else:
                active[match] = _merge_alert_records(active[match], alert)

        # RESOLVE
        for resolved_title in visit.get("resolved_alerts") or []:
            if not isinstance(resolved_title, str) or not resolved_title:
                continue
            match = _find_fuzzy_text_match(resolved_title, canonical_titles)
            if match is not None and match in active:
                active.pop(match, None)
                canonical_titles.remove(match)

    return _dedupe_alerts(list(active.values()))

def compute_pending_items(ordered_visits: List[dict]) -> List[str]:
    pending, completed = set(), set()
    for v in ordered_visits:
        pending |= set(v.get("pending_actions") or [])
        completed |= set(v.get("completed_actions") or [])

    still_open = pending - completed
    if not still_open:
        return []

    administered_treatments = _administered_treatments(ordered_visits)
    if not administered_treatments:
        return sorted(still_open)

    unresolved = {
        item for item in still_open
        if not _is_pending_action_resolved_by_administered_treatment(
            item,
            administered_treatments
        )
    }
    return sorted(unresolved)

def compute_clinical_decisions_log(ordered_visits: List[dict]) -> List[dict]:
    log = []
    for v in ordered_visits:
        visit_date = (v.get("appointment") or {}).get("appointment_date")
        for d in v.get("clinical_decisions") or []:
            log.append({"visit_number": v["visit_number"], "date": visit_date, **d})
    return log


def compute_clinical_attributes_log(ordered_visits: List[dict]) -> List[dict]:
    """Cross-visit log of the generic safety-net facts (see
    clinical_attributes in the extraction schema) -- lets a consumer see
    every otherwise-unstructured fact recovered across the patient's
    whole history in one place."""
    log = []
    for v in ordered_visits:
        visit_date = (v.get("appointment") or {}).get("appointment_date")
        for a in v.get("clinical_attributes") or []:
            if isinstance(a, dict):
                log.append({"visit_number": v["visit_number"], "date": visit_date, **a})
    return log


def compute_recommendations_log(ordered_visits: List[dict]) -> List[dict]:
    """Cross-visit log of every clinician/specialist/tumor-board
    recommendation (see clinical_recommendations in the extraction
    schema) -- this is where a tumor-board recommendation now surfaces,
    with no tumor-board-specific code anywhere in the pipeline."""
    log = []
    for v in ordered_visits:
        visit_date = (v.get("appointment") or {}).get("appointment_date")
        for r in v.get("clinical_recommendations") or []:
            if isinstance(r, dict):
                log.append({"visit_number": v["visit_number"], "date": visit_date, **r})
    return log


def compute_dashboard(
    ordered_visits: List[dict],
    layers: Dict[str, Any]
) -> Optional[dict]:
    """
    Build the dashboard from the latest COMPLETED clinical visit.

    Preparing/scheduled/incomplete visits must not overwrite the
    clinical headline information from the latest completed visit.
    """

    if not ordered_visits:
        return None

    # ---------------------------------------------------------
    # 1. Use latest completed visit for clinical headline data
    # ---------------------------------------------------------
    completed_visits = [
        v for v in ordered_visits
        if v.get("status") == "Completed"
    ]

    if completed_visits:
        latest_clinical_visit = completed_visits[-1]
    else:
        latest_clinical_visit = ordered_visits[-1]

    latest_consultation = latest_clinical_visit.get("consultation") or {}
    disease_status = latest_clinical_visit.get("disease_status") or {}

    # ---------------------------------------------------------
    # Find latest non-empty diagnosis across completed visits
    # ---------------------------------------------------------
    latest_diagnosis = None

    for visit in reversed(completed_visits):
        consultation = visit.get("consultation") or {}
        diagnosis = consultation.get("diagnosis")

        if diagnosis:
            latest_diagnosis = diagnosis
            break


    # ---------------------------------------------------------
    # Find latest non-empty disease status across completed visits
    # ---------------------------------------------------------
    latest_disease_state = None

    for visit in reversed(completed_visits):
        ds = visit.get("disease_status") or {}

        disease_state = ds.get("disease_state")

        if disease_state:
            latest_disease_state = disease_state
            break

    # ---------------------------------------------------------
    # 2. Find latest available explicit disease-response data
    # ---------------------------------------------------------
    latest_response = None
    latest_direction = None

    for visit in reversed(completed_visits):
        ds = visit.get("disease_status") or {}

        if latest_response is None and ds.get("clinical_response"):
            latest_response = ds.get("clinical_response")

        if latest_direction is None and ds.get("overall_direction"):
            latest_direction = ds.get("overall_direction")

        if latest_response and latest_direction:
            break

    # Current visit values take priority if present
    response = disease_status.get("clinical_response") or latest_response
    overall_direction = (
        disease_status.get("overall_direction")
        or latest_direction
    )

    # ---------------------------------------------------------
    # 3. Current disease status
    # ---------------------------------------------------------
    current_status = (
        disease_status.get("disease_state")
        or latest_disease_state
    )

    if not current_status:
        overview = layers.get("longitudinal_overview") or {}
        latest_status = overview.get("latest_status") or {}

        current_status = (
            latest_status.get("disease_state")
            or latest_status.get("clinical_response")
        )

    # ---------------------------------------------------------
    # 4. Current treatment
    # ---------------------------------------------------------
    treatment_history = layers.get("treatment_history") or []

    # First use explicitly active treatment records
    active_treatments = [
        t.get("regimen")
        for t in treatment_history
        if t.get("status") == "Active"
        and t.get("regimen")
    ]

    # If no explicit Active status exists, use treatment from
    # the latest completed clinical visit..........
    if not active_treatments:
        latest_visit_treatment = (
            latest_clinical_visit.get("treatment") or {}
        )

        active_treatments = [
            name
            for name, details in latest_visit_treatment.items()
            if name and details is not None and not (
                isinstance(details, dict) and details.get("_identity_unknown")
            )
        ]

    # If still empty, use the most recently started treatment
    # record rather than returning [] immediately.
    if not active_treatments:
        dated_treatments = [
            t for t in treatment_history
            if t.get("regimen") and t.get("start_date")
        ]

        if dated_treatments:
            dated_treatments.sort(
                key=lambda x: x.get("start_date") or ""
            )

            active_treatments = [
                dated_treatments[-1]["regimen"]
            ]

    # Remove duplicates while preserving order
    active_treatments = list(dict.fromkeys(active_treatments))

    # ---------------------------------------------------------
    # 5. Next action
    # ---------------------------------------------------------
    next_action = latest_consultation.get("doctor_plan")

    if not next_action:
        pending = layers.get("pending_items") or []
        next_action = pending[0] if pending else None

    # ---------------------------------------------------------
    # 6. Dashboard
    # ---------------------------------------------------------
    return {
        "diagnosis": latest_diagnosis,
        "current_status": current_status,
        "current_treatment": active_treatments,
        "response": response,
        "overall_direction": overall_direction,

        "alerts": layers.get("active_alerts") or [],

        "next_action": next_action,

        "last_updated": (
            latest_clinical_visit.get("appointment") or {}
        ).get("appointment_date"),

        "current_visit_number": (
            latest_clinical_visit.get("visit_number")
        ),

        "current_visit_status": (
            latest_clinical_visit.get("status")
        ),
    }


# =====================================================================
# PHASE 2 — STEP 8: RESPONSE / TOXICITY / PROGRESSION INTELLIGENCE
# -----------------------------------------------------------------------
# All three functions below are deterministic and operate ONLY on data
# structures your pipeline already produces (measurement "category",
# disease_status, adverse_events dicts). No cancer type, organ, drug, or
# biomarker name is referenced anywhere.
# =====================================================================

def compute_response_intelligence(
    t0_baseline: Dict[str, Any],
    treatment_baseline: Optional[Dict[str, Any]],
    previous_visit: Optional[dict],
    current_visit: dict,
    numeric_trends: Optional[dict],
    disease_status: Optional[dict],
) -> Dict[str, Any]:
    """Step 8A. Computes a direction (improving/worsening/mixed/stable) for
    EVERY category actually present in this patient's metric_changes --
    whatever those categories happen to be. No fixed list of expected
    evidence types anywhere; a patient whose documents only ever produced
    "laboratory" and "molecular" categories gets exactly those two, a
    patient with ten document types gets ten."""
    metric_changes = (numeric_trends or {}).get("metric_changes", {})

    by_category: Dict[str, Any] = {}
    for category, metrics in metric_changes.items():
        tally = _direction_tally(metrics)
        total = sum(tally.values())
        if total == 0:
            continue
        if tally["Improving"] and not tally["Worsening"]:
            direction = "improving"
        elif tally["Worsening"] and not tally["Improving"]:
            direction = "worsening"
        elif tally["Improving"] and tally["Worsening"]:
            direction = "mixed"
        else:
            direction = "stable"
        by_category[category] = {"direction": direction, "evidence_count": total, "tally": tally}

    # symptoms aren't part of clinical_measurements, so handled from their
    # own already-extracted per-symptom "trend" field -- never re-derived.
    symptom_trends_seen = [
        s.get("trend") for s in current_visit.get("symptoms") or [] if s.get("trend")
    ]
    if symptom_trends_seen:
        improving = sum(1 for t in symptom_trends_seen if t and t.lower() == "improving")
        worsening = sum(1 for t in symptom_trends_seen if t and t.lower() == "worsening")
        if improving and not worsening:
            symptom_direction = "improving"
        elif worsening and not improving:
            symptom_direction = "worsening"
        elif improving and worsening:
            symptom_direction = "mixed"
        else:
            symptom_direction = "stable"
        by_category["symptoms"] = {"direction": symptom_direction, "evidence_count": len(symptom_trends_seen)}

    directions_with_evidence = [
        d["direction"] for d in by_category.values() if d["direction"] in ("improving", "worsening")
    ]
    if not directions_with_evidence:
        evidence_concordance = "insufficient"
    elif len(set(directions_with_evidence)) == 1:
        evidence_concordance = "concordant"
    else:
        evidence_concordance = "discordant"

    return {
        "by_category": by_category,
        "evidence_concordance": evidence_concordance,
        "overall_response": (disease_status or {}).get("clinical_response"),
        "overall_direction": (disease_status or {}).get("overall_direction"),
    }


# CTCAE is a universal, cross-disease grading STANDARD (grade 1-5), not a
# disease-specific keyword list -- the same convention RESPONSE_RANK above
# already uses for RECIST-family terminology.



def _adverse_event_grade(ae: dict) -> Optional[int]:
    grade = ae.get("grade") if isinstance(ae, dict) else None
    if isinstance(grade, (int, float)):
        return int(grade)
    if isinstance(grade, str) and grade.strip().isdigit():
        return int(grade.strip())
    return None


def compute_toxicity_intelligence(previous_visit: Optional[dict], current_visit: dict) -> Dict[str, Any]:
    """Step 8B. Pure set comparison of adverse_events dicts already
    extracted per visit -- never text/keyword matching. "treatment_related"
    is populated only when the source document explicitly says so."""

    def _sig(x: Any) -> str:
        return json.dumps(x, sort_keys=True, default=str)

    prev_ae = {_sig(a): a for a in (previous_visit or {}).get("adverse_events", []) or []}
    curr_ae = {_sig(a): a for a in current_visit.get("adverse_events", []) or []}

    new_events = [a for sig, a in curr_ae.items() if sig not in prev_ae]
    resolved_events = [a for sig, a in prev_ae.items() if sig not in curr_ae]
    ongoing_events = [a for sig, a in curr_ae.items() if sig in prev_ae]

    all_current_grades = [g for g in (_adverse_event_grade(a) for a in curr_ae.values()) if g is not None]
    highest_grade = max(all_current_grades) if all_current_grades else None

    treatment_related = [
        a for a in curr_ae.values()
        if isinstance(a, dict) and a.get("treatment_related") is True
    ]

    # The grade number IS the standard -- no label translation. A "Grade
    # 3" event is exactly what the source document said; no code-level
    # judgment about what severity word that number "means."
    overall_status = f"Grade {highest_grade}" if highest_grade else "None"

    return {
        "new": new_events,
        "ongoing": ongoing_events,
        "resolved": resolved_events,
        "highest_grade": highest_grade,
        "treatment_related": treatment_related,
        "overall_toxicity_status": overall_status,
    }


_PROGRESSION_STATUS_RANK = {"No evidence": 0, "Insufficient evidence": 0, "Possible": 1, "Suspected": 2, "Confirmed": 3}


def compute_progression_intelligence(
    t0_baseline: Dict[str, Any],
    treatment_baseline: Optional[Dict[str, Any]],
    previous_state: Optional[dict],
    current_state: dict,
    response_intelligence: Dict[str, Any],
) -> Dict[str, Any]:
    """Step 8C. Conservative by construction. A "Confirmed" verdict only
    fires off a documented, standardized progression statement. A
    trend-based "Possible" verdict additionally requires the patient to
    actually HAVE a baseline to progress FROM -- a prior completed visit
    to compare against (previous_state is not None) AND a treatment that
    has actually started (treatment_baseline is not None, see Fix 3).
    Without either of those, worsening-looking numbers are exactly as
    likely to reflect a newly-diagnosed / pre-treatment workup as true
    progression, so no "Possible" verdict is generated. Purely
    structural gate -- no cancer type or keyword rule."""
    disease_status = current_state.get("disease_status") or {}
    documented_progression = disease_status.get("clinical_response") == "Progressive Disease"

    has_comparison_baseline = previous_state is not None
    has_started_treatment = treatment_baseline is not None

    evidence: List[str] = []
    if documented_progression:
        status = "Confirmed"
        evidence.append("Disease status documents Progressive Disease using standardized response terminology.")
    elif not has_comparison_baseline or not has_started_treatment:
        status = "Insufficient evidence"
        evidence.append(
            "No documented progression statement, and no prior visit / started "
            "treatment baseline exists yet to assess a trajectory against "
            "(e.g. newly diagnosed / pre-treatment case)."
        )
    else:
        concordance = response_intelligence.get("evidence_concordance")
        worsening_categories = [
            name for name, val in (response_intelligence.get("by_category") or {}).items()
            if val.get("direction") == "worsening" and val.get("evidence_count", 0) > 0
        ]
        if concordance == "concordant" and worsening_categories:
            status = "Possible"
            evidence.append(
                f"Concordant worsening trend across: {', '.join(worsening_categories)} (not a documented progression statement)."
            )
        elif worsening_categories:
            status = "Possible"
            evidence.append(f"Worsening trend observed in: {', '.join(worsening_categories)}.")
        else:
            status = "No evidence"

    return {
        "status": status,
        "evidence": evidence,
        "discordance": response_intelligence.get("evidence_concordance") == "discordant",
    }


# =====================================================================
# PHASE 2 — STEP 7: CLINICAL PHENOTYPE
# =====================================================================
def compute_clinical_phenotype(
    previous_state: Optional[dict],
    current_visit: dict,
    visit_delta: Optional[dict],
    t0_baseline: Dict[str, Any],
    treatment_baseline: Optional[Dict[str, Any]],
    response_intelligence: Dict[str, Any],
    toxicity_intelligence: Dict[str, Any],
    progression_intelligence: Dict[str, Any],
    completed_visits_so_far: List[dict],
) -> Dict[str, Any]:
    """Deterministic. NO LLM. Assembles the patient-specific state purely
    from already-computed structured facts."""
    overall_direction = (visit_delta or {}).get("categorized", {}).get("overall", {}).get("direction")
    condition_map = {
        "Improving": "Clinically improving",
        "Worsening": "Clinically worsening",
        "Stable": "Clinically stable",
        "Mixed": "Mixed clinical picture",
        "Unknown": "Insufficient information",
    }
    clinical_condition = condition_map.get(overall_direction, "Insufficient information")

    disease_status = current_visit.get("disease_status") or {}
    disease_state = disease_status.get("disease_state")
    if not disease_state:
        treatment_dict = current_visit.get("treatment") or {}
        has_administered_treatment = any(
            isinstance(details, dict) and (
                details.get("administered") is True
                or details.get("cycles_completed")
                or details.get("cycle_number")
            )
            for details in treatment_dict.values()
        )
        if has_administered_treatment:
            # Structural fallback only -- something is documented as
            # actually administered (see the same "administered" gate
            # compute_treatment_history already uses).
            disease_state = "On Treatment"
        elif treatment_dict:
            # A treatment PLAN exists but nothing has been administered
            # yet -- a neutral, structurally-derived label (same
            # convention as the "Planned" treatment status), never
            # invented clinical content.
            disease_state = "Pre-treatment"

    stage = disease_status.get("current_stage") or (
        (t0_baseline.get("disease") or {}).get("stage") if t0_baseline else None
    )

    # Locate the active regimen(s) documented at this visit and cross
    # reference against compute_treatment_history for line assignment --
    # reuses existing infra, no new logic.
    treatment_history = compute_treatment_history(completed_visits_so_far)
    treatment_state = None
    for modality, details in (current_visit.get("treatment") or {}).items():
        details = details or {}
        identity = _treatment_identity(details, modality)
        match = next((t for t in treatment_history if str(t.get("regimen") or "").strip().lower() == identity), None)
        treatment_state = {
            "line": match.get("line") if match else None,
            "regimen": details.get("regimen") or details.get("regimen_name") or modality,
            "cycle": details.get("cycle_number") or details.get("cycles_completed"),
            "intent": details.get("intent"),
            "status": match.get("status") if match else details.get("status"),
        }
        break  # current visit's primary documented treatment

    supporting_evidence = []
    for m in (visit_delta or {}).get("improved_metrics", [])[:5]:
        supporting_evidence.append(f"{m.get('name')} improved ({m.get('section')})")
    for m in (visit_delta or {}).get("worsened_metrics", [])[:5]:
        supporting_evidence.append(f"{m.get('name')} worsened ({m.get('section')})")

    return {
        "clinical_condition": clinical_condition,
        "disease_state": disease_state,
        "stage": stage,
        "treatment_state": treatment_state,
        "response_state": {
            # No fallback to the general visit-level `overall_direction`
            # here -- that reflects ANY metric movement (vitals, labs,
            # etc.), not a disease response assessment. When there is no
            # documented response and no response-intelligence evidence,
            # this must stay null rather than silently reporting
            # "Stable".
            "clinical_response": response_intelligence.get("overall_response"),
            "overall_direction": response_intelligence.get("overall_direction"),
            "evidence_concordance": response_intelligence.get("evidence_concordance"),
        },
        "toxicity_state": {
            "active": [a for a in toxicity_intelligence.get("ongoing", []) + toxicity_intelligence.get("new", [])],
            "new": toxicity_intelligence.get("new", []),
            "resolved": toxicity_intelligence.get("resolved", []),
            "highest_grade": toxicity_intelligence.get("highest_grade"),
            "status": toxicity_intelligence.get("overall_toxicity_status"),
        },
        "progression_state": {
            "status": progression_intelligence.get("status"),
            "evidence": progression_intelligence.get("evidence", []),
        },
        "supporting_evidence": supporting_evidence,
    }

# =====================================================================
# PHASE 2 — STEP 5: LONGITUDINAL STATE
# =====================================================================
def _assign_timepoints(ordered_completed_visits: List[dict], t0_baseline: Dict[str, Any]) -> Dict[int, str]:
    """T0 = the visit build_t0_baseline() identified as cancer-defining;
    every other completed visit gets the next sequential T-number in
    chronological order. Purely positional -- no per-cancer logic."""
    t0_visit_number = (t0_baseline or {}).get("visit_number")
    mapping: Dict[int, str] = {}
    counter = 0
    for v in ordered_completed_visits:
        vnum = v["visit_number"]
        if vnum == t0_visit_number:
            mapping[vnum] = "T0"
        else:
            counter += 1
            mapping[vnum] = f"T{counter}"
    return mapping


def _measurements_by_category(visit: dict) -> Dict[str, dict]:
    """Groups this visit's measurements by whatever category they already
    carry (the document's own classification) -- no translation table."""
    grouped: Dict[str, dict] = {}
    for name, entry in (visit.get("clinical_measurements") or {}).items():
        if not isinstance(entry, dict):
            continue
        category = entry.get("category") or "other"
        grouped.setdefault(category, {})[name] = {
            "value": entry.get("value"), "unit": entry.get("unit"), "body_site": entry.get("body_site"),
        }
    return grouped


def _known_measurement_categories(completed_visits: List[dict]) -> set:
    """The full set of measurement categories THIS patient's own document
    history has ever produced -- derived entirely at runtime from data
    already on the visits (the same "category" field the extraction
    pipeline already assigns from document type). No fixed/global list of
    categories anywhere -- a patient whose documents only ever produced
    "laboratory" and "imaging" gets exactly those two as the completeness
    baseline; a patient with ten document types gets ten."""
    categories: set = set()
    for v in completed_visits:
        for entry in (v.get("clinical_measurements") or {}).values():
            if isinstance(entry, dict) and entry.get("category"):
                categories.add(entry["category"])
    return categories


def compute_data_completeness(visit: dict, known_categories: set) -> Dict[str, Any]:
    """Deterministic, disease-agnostic completeness flags for ONE visit.
    "known_categories" is this patient's own runtime vocabulary (see
    _known_measurement_categories) -- so this only ever flags categories
    that exist for THIS patient's own case, never a hardcoded cancer-type
    checklist. "symptoms" / "disease_status" / "treatment" are structural
    buckets already part of the visit schema itself, not clinical content."""
    present_categories = {
        entry.get("category")
        for entry in (visit.get("clinical_measurements") or {}).values()
        if isinstance(entry, dict) and entry.get("category")
    }

    completeness: Dict[str, str] = {
        category: ("available" if category in present_categories else "missing")
        for category in known_categories
    }
    completeness["symptoms"] = "available" if visit.get("symptoms") else "missing"
    completeness["disease_status"] = "available" if visit.get("disease_status") else "missing"
    completeness["treatment"] = "available" if visit.get("treatment") else "missing"

    values = list(completeness.values())
    available = values.count("available")
    if not values or available == 0:
        overall = "missing"
    elif available == len(values):
        overall = "complete"
    else:
        overall = "partial"

    return {**completeness, "overall": overall}


def build_longitudinal_state(
    visit: dict,
    timepoint: str,
    visit_delta: Optional[dict],
    clinical_phenotype: Dict[str, Any],
    llm_interpretation: Optional[str] = None,
    known_categories: Optional[set] = None,
) -> Dict[str, Any]:
    measurements_by_category = _measurements_by_category(visit)
    disease_status = visit.get("disease_status") or {}

    return {
        "timepoint": timepoint,
        "visit_number": visit.get("visit_number"),
        "date": (visit.get("appointment") or {}).get("appointment_date"),
        "type": "diagnosis_baseline" if timepoint == "T0" else "treatment_visit",
        "disease": {
            "stage": disease_status.get("current_stage"),
            "state": clinical_phenotype.get("disease_state"),
            "response": clinical_phenotype.get("response_state", {}).get("clinical_response"),
            "direction": clinical_phenotype.get("response_state", {}).get("overall_direction"),
        },
        "treatment": clinical_phenotype.get("treatment_state"),
        "clinical": {"symptoms": visit.get("symptoms") or []},
        "measurements": measurements_by_category,
        "toxicity": clinical_phenotype.get("toxicity_state"),
        "response": clinical_phenotype.get("response_state"),
        "progression": clinical_phenotype.get("progression_state"),
        "what_changed": (visit_delta or {}).get("categorized"),
        "clinical_phenotype": clinical_phenotype,
        "data_completeness": compute_data_completeness(visit, known_categories or set()),
        "llm_interpretation": llm_interpretation,
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
        max_tokens=8000,
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


CLINICAL_PHENOTYPE_NARRATIVE_PROMPT_TEMPLATE = """You are explaining a patient's current longitudinal oncology state.

Use ONLY the supplied structured patient-specific information below.
Do not introduce information that is not explicitly provided.

Do not invent:
- biomarkers, molecular findings, guideline recommendations
- a progression or response verdict different from what is given
- treatment recommendations or expected cancer behavior for this diagnosis

If a field below is null or missing, state plainly that it is not documented
-- do not fill the gap with an assumption.

Explain, in plain clinical language, 4-7 sentences total:
1. Current clinical condition
2. Disease status
3. Treatment status
4. Response
5. Toxicity
6. Progression/resistance evidence
7. One overall patient-specific interpretation sentence

Return ONLY valid JSON: {{"llm_interpretation": "string"}}. No markdown fences.

=== STRUCTURED PATIENT STATE ===
{state_json}
"""


async def generate_clinical_phenotype_narrative(clinical_phenotype: Dict[str, Any]) -> Optional[str]:
    """Step 9 LLM call. Receives ONLY the deterministic phenotype already
    computed -- never raw documents, never prior visit text."""
    prompt = CLINICAL_PHENOTYPE_NARRATIVE_PROMPT_TEMPLATE.format(
        state_json=json.dumps(clinical_phenotype, default=str, indent=2)[:6000]
    )
    completion = groq_client.chat.completions.create(
        model=GROQ_MODEL,
        temperature=0.0,
        max_tokens=8000,
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": prompt}],
    )
    raw = completion.choices[0].message.content
    try:
        return json.loads(raw).get("llm_interpretation")
    except json.JSONDecodeError as e:
        logger.error(f"Clinical phenotype narrative JSON parse failed: {e} | raw={raw[:500]}")
        return None

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
# ASSEMBLE FRONTEND JSON (Phase 1: now also carries cancer_case_identity /
# t0_baseline / treatment_baselines as top-level keys)
# =====================================================================
def build_frontend_json(
    patient_id: str,
    patient_information: Dict[str, Any],
    visits_by_number: Dict[int, dict],
    longitudinal_summary: Optional[dict],
    doctor_id: Optional[str] = None,
    phase1: Optional[Dict[str, Any]] = None,
    phase2: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    ordered_visits = [visits_by_number[n] for n in sorted(visits_by_number.keys())]
    current_active_visit = ordered_visits[-1]["visit_number"] if ordered_visits else None

    clean_visits = [
        {k: v for k, v in visit.items() if k not in ("_document_ids", "_document_hash")}
        for visit in ordered_visits
    ]

    phase2 = phase2 or {}

    return {
        "doctor_id": doctor_id,
        "patient_id": patient_id,
        "patient_information": patient_information,
        "current_active_visit": current_active_visit,
        **(phase1 or {}),
        "longitudinal_states": phase2.get("longitudinal_states", []),
        "current_state": phase2.get("clinical_phenotype"),
        # Step 18: response/toxicity/progression are also surfaced as
        # their own top-level keys with a "current" snapshot, so a
        # consumer that only wants the latest verdict doesn't have to dig
        # into current_state's nested sub-fields. The FULL history for
        # each stays in longitudinal_states (every visit carries its own
        # "response"/"toxicity"/"progression"), so nothing is lost by
        # only storing "current" here -- consistent with the plan's
        # explicit warning not to store only a single top-level snapshot
        # without the longitudinal history alongside it.
        "response_intelligence": {"current": phase2.get("response_intelligence")},
        "toxicity_intelligence": {"current": phase2.get("toxicity_intelligence")},
        "progression_intelligence": {"current": phase2.get("progression_intelligence")},
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


class Phase1State(TypedDict, total=False):
    cancer_case_identity: dict
    t0_baseline: dict
    treatment_baselines: List[dict]
    treatment_plans: List[dict]

class Phase2State(TypedDict, total=False):
    longitudinal_states: List[dict]
    response_intelligence: Optional[dict]
    toxicity_intelligence: Optional[dict]
    progression_intelligence: Optional[dict]
    clinical_phenotype: Optional[dict]


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
    phase1: Phase1State
    phase2: Phase2State
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
        # Migration safety net for records generated before this version:
        # older visits won't have these two keys yet.
        v.setdefault("clinical_attributes", [])
        v.setdefault("clinical_recommendations", [])
        visits_by_number[v["visit_number"]] = v

    already_seen = {doc_id for v in visits_by_number.values() for doc_id in v.get("_document_ids", [])}
    already_processed = inp["document_id"] in already_seen

    existing_longitudinal_states = existing_data.get("longitudinal_states", []) or []

    return {
        "existing_record": existing_record,
        "already_processed": already_processed,
        "visit": {**_ns(state, "visit"), "visits_by_number": visits_by_number},
        "longitudinal": {**_ns(state, "longitudinal"), "longitudinal_summary": existing_data.get("longitudinal_summary")},
        "phase2": {"longitudinal_states": existing_longitudinal_states},
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

    # Merge in any appointment(s) for this same clinical date that aren't
    # already recorded on the visit (e.g. a second doctor's appointment
    # arriving on a later document upload). Dedupe by appointment_id only
    # -- no doctor/specialty-specific logic.
    visit.setdefault("appointments", [])
    existing_appt_ids = {a.get("appointment_id") for a in visit["appointments"] if a.get("appointment_id")}
    for appointment in visit_info.get("appointments", []) or []:
        appt_id = appointment.get("appointment_id")
        if appt_id and appt_id in existing_appt_ids:
            continue
        visit["appointments"].append(appointment)
        if appt_id:
            existing_appt_ids.add(appt_id)

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
    _validate_visit_dates(visits_by_number)
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


def build_phase1_baseline_node(state: CaseViewState) -> CaseViewState:
    patient_information = state["patient"].get("patient_information", {})
    completed_visits = state["visit"].get("completed_visits") or []
    phase1 = build_phase1_baseline(patient_information, completed_visits)
    return {"phase1": phase1}




def compute_numeric_trends_node(state: CaseViewState) -> CaseViewState:
    completed_visits = state["visit"]["completed_visits"]

    trends = None

    if len(completed_visits) >= 2:
        current_visit = completed_visits[-1]

        trends = compute_numeric_trends(
            completed_visits,
            current_visit,
        )

    return {
        "longitudinal": {
            **_ns(state, "longitudinal"),
            "trends": trends,
        }
    }


def compute_visit_delta_node(state: CaseViewState) -> CaseViewState:
    completed_visits = state["visit"]["completed_visits"]
    trends = state["longitudinal"].get("trends")

    visit_delta = None
    if trends is not None and len(completed_visits) >= 2:
        previous_visit, current_visit = completed_visits[-2], completed_visits[-1]
        visit_delta = compute_visit_delta(previous_visit, current_visit, trends)

    return {"longitudinal": {**state["longitudinal"], "visit_delta": visit_delta}}

def compute_response_toxicity_progression_node(state: CaseViewState) -> CaseViewState:
    visit = state["visit"]
    completed_visits = visit["completed_visits"]
    latest_completed = visit["latest_completed_visit"]
    previously_latest_completed = visit["previously_latest_completed"]
    phase1 = state.get("phase1") or {}

    should_compute = bool(latest_completed) and (
        latest_completed != previously_latest_completed
        or not any(s.get("visit_number") == latest_completed for s in (state.get("phase2") or {}).get("longitudinal_states", []))
    )

    if not should_compute or not completed_visits:
        return {"phase2": {**_ns(state, "phase2")}}

    current_visit = completed_visits[-1]
    previous_visit = completed_visits[-2] if len(completed_visits) >= 2 else None
    trends = state["longitudinal"].get("trends")
    if trends is None and previous_visit:
        trends = compute_numeric_trends(completed_visits, current_visit)

    treatment_baselines = phase1.get("treatment_baselines") or []
    current_treatment_baseline = treatment_baselines[-1] if treatment_baselines else None

    response_intel = compute_response_intelligence(
        phase1.get("t0_baseline") or {}, current_treatment_baseline,
        previous_visit, current_visit, trends, current_visit.get("disease_status"),
    )
    toxicity_intel = compute_toxicity_intelligence(previous_visit, current_visit)
    progression_intel = compute_progression_intelligence(
        phase1.get("t0_baseline") or {}, current_treatment_baseline,
        previous_visit, current_visit, response_intel,
    )

    return {"phase2": {
        **_ns(state, "phase2"),
        "response_intelligence": response_intel,
        "toxicity_intelligence": toxicity_intel,
        "progression_intelligence": progression_intel,
    }}


def compute_clinical_phenotype_node(state: CaseViewState) -> CaseViewState:
    phase2 = state.get("phase2") or {}
    if "response_intelligence" not in phase2:
        return {"phase2": phase2}

    visit = state["visit"]
    completed_visits = visit["completed_visits"]
    current_visit = completed_visits[-1]
    previous_visit = completed_visits[-2] if len(completed_visits) >= 2 else None
    visit_delta = state["longitudinal"].get("visit_delta")
    phase1 = state.get("phase1") or {}
    treatment_baselines = phase1.get("treatment_baselines") or []

    phenotype = compute_clinical_phenotype(
        previous_state=previous_visit,
        current_visit=current_visit,
        visit_delta=visit_delta,
        t0_baseline=phase1.get("t0_baseline") or {},
        treatment_baseline=treatment_baselines[-1] if treatment_baselines else None,
        response_intelligence=phase2["response_intelligence"],
        toxicity_intelligence=phase2["toxicity_intelligence"],
        progression_intelligence=phase2["progression_intelligence"],
        completed_visits_so_far=completed_visits,
    )
    return {"phase2": {**phase2, "clinical_phenotype": phenotype}}


async def build_longitudinal_state_node(state: CaseViewState) -> CaseViewState:
    phase2 = state.get("phase2") or {}
    if "clinical_phenotype" not in phase2:
        return {"phase2": phase2}

    visit = state["visit"]
    completed_visits = visit["completed_visits"]
    current_visit = completed_visits[-1]
    phase1 = state.get("phase1") or {}
    timepoints = _assign_timepoints(completed_visits, phase1.get("t0_baseline") or {})
    timepoint = timepoints.get(current_visit["visit_number"], f"T{current_visit['visit_number']}")

    llm_interpretation = await generate_clinical_phenotype_narrative(phase2["clinical_phenotype"])

    new_state_entry = build_longitudinal_state(
        current_visit, timepoint, state["longitudinal"].get("visit_delta"),
        phase2["clinical_phenotype"], llm_interpretation,
        known_categories=_known_measurement_categories(completed_visits),
    )

    existing_states = list(phase2.get("longitudinal_states") or [])
    existing_states = [s for s in existing_states if s.get("visit_number") != current_visit["visit_number"]]
    existing_states.append(new_state_entry)
    existing_states.sort(key=lambda s: s.get("visit_number") or 0)

    return {"phase2": {**phase2, "longitudinal_states": existing_states, "clinical_phenotype": phase2["clinical_phenotype"]}}


def compute_overall_trends_node(state: CaseViewState) -> CaseViewState:
    completed_visits = state["visit"]["completed_visits"]
    overall_trends = _compute_overall_trends(completed_visits) if completed_visits else {}
    return {"longitudinal": {**state["longitudinal"], "overall_trends": overall_trends}}


def compute_analytics_layers_node(state: CaseViewState) -> CaseViewState:

    visits_by_number = state["visit"]["visits_by_number"]

    # ---------------------------------------------------------
    # Use completed visits for longitudinal clinical analytics
    # ---------------------------------------------------------

    completed_visits = state["visit"].get("completed_visits") or []

    # ---------------------------------------------------------
    # Sort chronologically.
    #
    # Date is the primary ordering key.
    # Visit number is only a tie-breaker.
    # ---------------------------------------------------------

    ordered_completed_visits = sorted(
        completed_visits,
        key=lambda v: (
            (
                v.get("appointment") or {}
            ).get("appointment_date") or "",
            v.get("visit_number") or 0,
        )
    )

    for v in ordered_completed_visits:

        logger.info(
            f"LONGITUDINAL INPUT "
            f"visit={v.get('visit_number')} "
            f"symptoms={v.get('symptoms')} "
            f"medications={v.get('medications')} "
            f"disease_status={v.get('disease_status')} "
            f"alerts={v.get('alerts')} "
            f"clinical_decisions={v.get('clinical_decisions')}"
        )

    # =========================================================
    # COMPUTE ANALYTICS LAYERS
    # =========================================================

    logger.info("Analytics: computing timeline")
    timeline = compute_timeline(visits_by_number)

    logger.info("Analytics: computing disease_trajectory")
    disease_trajectory_periods = compute_disease_trajectory(
        ordered_completed_visits
    )
    disease_trajectory = _normalize_disease_trajectory_for_frontend(
        disease_trajectory_periods
    )

    logger.info("Analytics: computing symptom_trends")
    symptom_trends = compute_symptom_trends(
        ordered_completed_visits
    )

    logger.info("Analytics: computing medication_timeline")
    medication_timeline = compute_medication_timeline(
        ordered_completed_visits
    )

    logger.info("Analytics: computing treatment_history")
    treatment_history = compute_treatment_history(
        ordered_completed_visits
    )

    logger.info("Analytics: computing active_alerts")
    active_alerts = compute_active_alerts(
        ordered_completed_visits
    )

    logger.info("Analytics: computing pending_items")
    pending_items = compute_pending_items(
        ordered_completed_visits
    )

    logger.info("Analytics: computing clinical_decisions_log")
    clinical_decisions_log = compute_clinical_decisions_log(
        ordered_completed_visits
    )

    logger.info("Analytics: computing clinical_attributes_log")
    clinical_attributes_log = compute_clinical_attributes_log(
        ordered_completed_visits
    )

    logger.info("Analytics: computing clinical_recommendations_log")
    clinical_recommendations_log = compute_recommendations_log(
        ordered_completed_visits
    )

    logger.info("Analytics: computing longitudinal_overview")
    longitudinal_overview = compute_longitudinal_overview(
        ordered_completed_visits
    )

    # =========================================================
    # BUILD LAYERS
    # =========================================================

    layers = {
        "timeline": timeline,
        "disease_trajectory": disease_trajectory,
        # Full interval/period representation preserved separately —
        # nothing is lost, it's just not what the flat table needs.
        "disease_trajectory_periods": disease_trajectory_periods,
        "symptom_trends": symptom_trends,
        "medication_timeline": medication_timeline,
        "treatment_history": treatment_history,
        "active_alerts": active_alerts,
        "pending_items": pending_items,
        "clinical_decisions_log": clinical_decisions_log,
        "clinical_attributes_log": clinical_attributes_log,
        "clinical_recommendations_log": clinical_recommendations_log,
        "longitudinal_overview": longitudinal_overview,
    }

    # =========================================================
    # DASHBOARD
    # =========================================================

    logger.info("Analytics: computing dashboard")

    layers["dashboard"] = compute_dashboard(
        ordered_completed_visits,
        layers
    )

    logger.info("Analytics: all layers computed successfully")

    return {
        "longitudinal": {
            **_ns(state, "longitudinal"),
            "layers": layers
        }
    }


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

    base_fields = {
        "overall_trends": overall_trends,

        # Explicit frontend-facing longitudinal metric contract.
        "longitudinal_metric_trends": overall_trends,

        "visit_delta": visit_delta,
        **layers,
    }

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


def _build_compact_longitudinal_payload(
    completed_visits: List[dict],
    overall_trends: Dict[str, Any],
    longitudinal_layers: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Build a genuinely small evidence payload for the final narrative LLM.

    IMPORTANT:
    - Do NOT send raw completed_visits.
    - Do NOT send longitudinal_overview because it already contains
      multiple other longitudinal layers and therefore duplicates data.
    - Do NOT send medication_timeline when treatment_history already
      captures treatment evolution.
    - The full clinical history remains available in the backend/MongoDB.
    """

    layers = longitudinal_layers or {}

    return {
        "overall_trends": overall_trends or {},

        # Primary longitudinal evidence
        "disease_trajectory": layers.get("disease_trajectory") or [],
        "symptom_trends": layers.get("symptom_trends") or {},
        "treatment_history": layers.get("treatment_history") or [],
        "active_alerts": layers.get("active_alerts") or [],
        "pending_items": layers.get("pending_items") or [],
        "clinical_decisions_log": layers.get(
            "clinical_decisions_log"
        ) or [],
    }


async def generate_all_history_longitudinal_narrative(
    completed_visits: List[dict],
    overall_trends: Dict[str, Any],
    longitudinal_layers: Dict[str, Any],
) -> str:

    payload = _build_compact_longitudinal_payload(
        completed_visits=completed_visits,
        overall_trends=overall_trends,
        longitudinal_layers=longitudinal_layers,
    )

    # ---------------------------------------------------------
    # DIAGNOSTIC: measure every section before sending to Groq
    # ---------------------------------------------------------
    for key, value in payload.items():
        try:
            value_json = json.dumps(
                value,
                ensure_ascii=False,
                default=str,
            )

            logger.info(
                f"[longitudinal] payload section={key} "
                f"size={len(value_json):,} chars "
                f"approx_tokens={len(value_json) // 4:,}"
            )

        except Exception as exc:
            logger.warning(
                f"[longitudinal] Could not measure "
                f"payload section={key}: {exc}"
            )

    payload_json = json.dumps(
        payload,
        ensure_ascii=False,
        default=str,
    )

    logger.info(
        "[longitudinal] Narrative payload size: "
        f"{len(payload_json):,} characters | "
        f"approx_tokens={len(payload_json) // 4:,}"
    )

    if len(payload_json) > 100_000:
        logger.warning(
            "[longitudinal] Narrative payload is still large: "
            f"{len(payload_json):,} characters"
        )
    prompt = f"""
You are generating a CONCISE LONGITUDINAL CLINICAL SNAPSHOT for a
doctor reviewing a patient.

The patient may have ANY cancer type, hematologic malignancy, or other
oncology-related condition.

Use ONLY the supplied structured patient history.

=========================================================
CORE LONGITUDINAL RULES
=========================================================

1. Analyze the COMPLETE available longitudinal history.

2. Do NOT treat the immediately previous visit as the only baseline.

3. Do NOT produce a visit-by-visit narrative.

4. Do NOT repeat the same information simply because it appears in
   multiple visits.

5. Preserve clinically important information from earlier visits even
   when later visits do not repeat it.

6. A metric may be documented at Visit 1, Visit 3 and Visit 5 while
   absent from Visits 2 and 4. Treat this as one sparse longitudinal
   series.

7. Never invent values for visits where the metric was not documented.

8. Missing data must NOT be interpreted as improvement, worsening,
   resolution, stability, or treatment response.

9. Do not manufacture disease progression, response, improvement,
   toxicity, or treatment failure.

10. Distinguish documented facts from interpretation.

11. Use only trends supported by the supplied observations.

12. Do not use cancer-specific assumptions.

13. Do not use predefined disease-specific metric lists.

14. If the available evidence is sparse, state that briefly rather than
    filling the gap with assumptions.

15. Prioritize clinically meaningful changes over routine repeated data.

=========================================================
DOCTOR-FACING PRIORITY
=========================================================

The output must allow a doctor to understand the patient's longitudinal
status in approximately 10–20 seconds.

Prioritize:

A. Major disease-status evolution
B. Important measurable longitudinal changes
C. Treatment evolution/current treatment state
D. Important symptoms or toxicities
E. Important persistent findings or safety issues
F. Important missing information that limits interpretation

Do NOT include every available measurement.

Do NOT list every medication unless it represents an important treatment
change or clinically relevant finding.

Do NOT repeat unchanged information unless it is clinically important.

=========================================================
OUTPUT FORMAT
=========================================================

Return ONLY the following compact structure:

LONGITUDINAL CLINICAL SNAPSHOT

• Disease status: <most important documented longitudinal disease-status
  evolution>

• Key trends: <only the most clinically meaningful longitudinal
  measurements or findings, including direction and values when
  supported>

• Treatment: <important treatment evolution and current documented
  treatment state>

• Symptoms/toxicities: <important symptoms, treatment toxicities, or
  relevant safety findings; if none are documented, say so briefly>

• Important changes/persistent findings: <most important changes or
  persistent clinically relevant findings>

• Gaps/limitations: <only important missing information that limits
  interpretation>

=========================================================
STRICT LENGTH REQUIREMENT
=========================================================

- Maximum 6 bullets after the title.
- Prefer 4–6 bullets.
- Target approximately 120–180 words total.
- Never exceed 220 words.
- Each bullet should normally be 1–2 sentences.
- Do NOT create numbered sections.
- Do NOT create tables.
- Do NOT create long paragraphs.
- Do NOT provide a detailed visit-by-visit chronology.
- Do NOT provide a "next steps" section.
- Do NOT provide recommendations unless a recommendation is explicitly
  documented in the supplied evidence and is essential to understanding
  the current clinical state.
- Do NOT repeat the same fact in multiple bullets.
- Use concise clinical language suitable for a doctor's dashboard.

=========================================================
TREND REPRESENTATION
=========================================================

When a meaningful numeric longitudinal trend exists, show it compactly.

Example format:

56 → 54 → 50 → 48 kg

and, when mathematically supported:

56 → 48 kg (~14% decrease)

Only calculate percentages or changes when the underlying values are
actually available and comparable.

For sparse measurements, mention only the visits where the measurement
was documented when that distinction matters.

Do not convert qualitative measurements into artificial numerical values.

=========================================================
EVIDENCE RULE
=========================================================

Every statement must be supported by the supplied data.

If the supplied data does not establish something, do not state it as
fact.

Do not infer that a disease is stable merely because no new information
was documented.

Do not infer that treatment is continuing merely because a medication
appeared in an earlier visit.

Do not infer treatment response without documented clinical, laboratory,
pathological, or imaging evidence.

======================================================
DATA
======================================================

{payload_json}
"""

    response = await asyncio.to_thread(
        groq_client.chat.completions.create,
        model=GROQ_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a disease-agnostic longitudinal "
                    "clinical summarization agent. "
                    "Use only supplied evidence. "
                    "Never invent or assume missing information."
                ),
            },
            {
                "role": "user",
                "content": prompt,
            },
        ],
        temperature=0.1,
        max_tokens=600,
    )

    return (
        response.choices[0].message.content.strip()
        if response.choices
        else ""
    )


async def narrative_agent_node(state: CaseViewState) -> CaseViewState:
    """
    Builds ONE assessment from the complete longitudinal history.

    This intentionally does not use previous_visit/current_visit as the
    primary analytical input.
    """

    visit = state["visit"]
    longitudinal = state["longitudinal"]

    completed_visits = visit.get("completed_visits") or []

    overall_trends = (
        longitudinal.get("overall_trends") or {}
    )

    layers = (
        longitudinal.get("layers") or {}
    )

    if not completed_visits:
        return {
            "longitudinal": {
                **longitudinal,
                "narrative": None,
            }
        }

    narrative = await generate_all_history_longitudinal_narrative(
        completed_visits=completed_visits,
        overall_trends=overall_trends,
        longitudinal_layers=layers,
    )

    prior_summary = longitudinal.get(
        "longitudinal_summary"
    ) or {}

    longitudinal_summary = {
        **prior_summary,
        "latest_completed_visit":
            visit.get("latest_completed_visit"),
        "longitudinal_ai_assessment": narrative,
    }

    return {
        "longitudinal": {
            **longitudinal,
            "narrative": narrative,
            "longitudinal_summary": longitudinal_summary,
        }
    }


def build_case_view_node(state: CaseViewState) -> CaseViewState:
    inp = state["input"]
    case_view_data = build_frontend_json(
        patient_id=inp["patient_id"],
        doctor_id=inp["doctor_id"],
        patient_information=state["patient"].get("patient_information", {}),
        visits_by_number=state["visit"]["visits_by_number"],
        longitudinal_summary=state["longitudinal"].get("longitudinal_summary"),
        phase1=state.get("phase1"),
        phase2=state.get("phase2"),
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
    graph.add_node("build_phase1_baseline", build_phase1_baseline_node)
    graph.add_node("compute_numeric_trends", compute_numeric_trends_node)
    graph.add_node("compute_visit_delta", compute_visit_delta_node)
    graph.add_node("compute_overall_trends", compute_overall_trends_node)
    graph.add_node("compute_analytics_layers", compute_analytics_layers_node)
    graph.add_node("prepare_longitudinal_summary", prepare_longitudinal_summary_node)
    graph.add_node("narrative_agent", narrative_agent_node)
    graph.add_node("build_case_view", build_case_view_node)
    graph.add_node("create_record", create_record_node)
    graph.add_node("persist_case_view", persist_case_view_node)
    graph.add_node("compute_response_toxicity_progression", compute_response_toxicity_progression_node)
    graph.add_node("compute_clinical_phenotype", compute_clinical_phenotype_node)
    graph.add_node("build_longitudinal_state", build_longitudinal_state_node)

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

    graph.add_edge("find_completed_visits", "build_phase1_baseline")
    graph.add_edge("build_phase1_baseline", "compute_numeric_trends")
    graph.add_edge("compute_numeric_trends", "compute_visit_delta")
    # replace:  graph.add_edge("compute_visit_delta", "compute_overall_trends")
    graph.add_edge("compute_visit_delta", "compute_response_toxicity_progression")
    graph.add_edge("compute_response_toxicity_progression", "compute_clinical_phenotype")
    graph.add_edge("compute_clinical_phenotype", "build_longitudinal_state")
    graph.add_edge("build_longitudinal_state", "compute_overall_trends")
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
    """Rebuild a patient's longitudinal_case_view from processed_documents.

    Deterministic, no LLM, no patient/cancer-specific logic. Two steps only:
      1. Delete the existing longitudinal_case_view record for this patient
         (a stale/broken record must not seed load_existing_state_node on
         the very next replay -- otherwise old visit numbers, old
         disease_status, old measurements would all be inherited instead
         of freshly recomputed).
      2. Replay every processed_document for this patient, oldest first,
         through the CURRENT pipeline (generate_longitudinal_case_view),
         which persists as it goes.

    processed_documents is NEVER touched -- it is the source of truth this
    rebuild reads from, not something it modifies or deletes.
    """
    logger.info(f"[REBUILD] Starting rebuild for patient={patient_id}")

    delete_result = await longitudinal_case_view.delete_one(
        {"patient_id": patient_id}
    )
    logger.info(
        f"[REBUILD] Existing case view cleared | patient={patient_id} | "
        f"deleted={delete_result.deleted_count}"
    )

    cursor = processed_documents.find(
        {"patient_id": patient_id}
    ).sort(
        [
            ("metadata.document_date", 1),
            ("_id", 1),
        ]
    )

    result: Dict[str, Any] = {}
    document_count = 0

    async for doc in cursor:
        document_count += 1
        result = await generate_longitudinal_case_view(
            patient_id=patient_id,
            document_text=doc.get("raw_text") or "",
            document_date=doc.get("metadata", {}).get("document_date"),
            file_name=doc.get("file_name"),
            document_id=doc.get("document_id"),
        )
        logger.info(
            f"[REBUILD] Replayed document {document_count} | "
            f"patient={patient_id} | document_id={doc.get('document_id')}"
        )

    logger.info(
        f"[REBUILD] Completed | patient={patient_id} | documents={document_count}"
    )
    return result


@router.post("/internal/case-view/rebuild/{patient_id}")
async def rebuild_case_view_endpoint(patient_id: str):
    try:
        result = await rebuild_longitudinal_case_view_from_history(
            patient_id
        )

        return {
            "status": "success",
            "message": "Case view rebuilt successfully",
            "patient_id": patient_id,
            "data": result,
        }

    except Exception as e:
        logger.exception(
            f"Case view rebuild failed for patient={patient_id}"
        )

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )

# ------------------- HTTP ENDPOINTS ----------------

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


@router.delete("/api/delete/patients/{patient_id}/case-view")
async def delete_case_view(patient_id: str):
    """
    Deletes the generated longitudinal case view for a patient.
    """

    result = await longitudinal_case_view.delete_one(
        {
            "patient_id": patient_id,
        }
    )

    if result.deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Case view not found for this patient",
        )

    return {
        "message": "Patient case view deleted successfully",
        "patient_id": patient_id,
        "deleted_count": result.deleted_count,
    }

# ============================================================
# DELETE ONE DOCUMENT FROM LONGITUDINAL CASE VIEW
# ============================================================

@router.delete(
    "/api/delete/patients/{patient_id}/documents/{document_id}"
)
async def delete_document_from_case_view(
    patient_id: str,
    document_id: str,
):
    """
    Deletes ONE specific document from the patient's
    longitudinal_case_view.

    Removes the document from:
      - data.visits[].documents[]
      - data.visits[]._document_ids[]

    IMPORTANT:
    This only removes the document from longitudinal_case_view.
    It does NOT delete the document from processed_documents.
    """

    record = await longitudinal_case_view.find_one(
        {"patient_id": patient_id}
    )

    if not record:
        raise HTTPException(
            status_code=404,
            detail=f"Case view not found for patient {patient_id}",
        )

    data = record.get("data") or {}
    visits = data.get("visits") or []

    found = False
    removed_from_visits = []

    for visit in visits:
        # ----------------------------------------------------
        # Remove from documents[]
        # ----------------------------------------------------
        documents = visit.get("documents") or []

        original_document_count = len(documents)

        visit["documents"] = [
            doc
            for doc in documents
            if doc.get("document_id") != document_id
        ]

        if len(visit["documents"]) < original_document_count:
            found = True

            removed_from_visits.append(
                visit.get("visit_number")
            )

        # ----------------------------------------------------
        # Remove from _document_ids[]
        # ----------------------------------------------------
        document_ids = visit.get("_document_ids") or []

        visit["_document_ids"] = [
            doc_id
            for doc_id in document_ids
            if doc_id != document_id
        ]

    if not found:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Document {document_id} was not found "
                f"in longitudinal_case_view for patient {patient_id}"
            ),
        )

    # --------------------------------------------------------
    # Save modified case view
    # --------------------------------------------------------
    result = await longitudinal_case_view.update_one(
        {"patient_id": patient_id},
        {
            "$set": {
                "data.visits": visits,
                "updated_at": datetime.utcnow().isoformat(),
            }
        },
    )

    if result.modified_count == 0:
        raise HTTPException(
            status_code=500,
            detail="Document was found but case view could not be updated",
        )

    logger.info(
        f"[DELETE DOCUMENT] Removed document={document_id} "
        f"from patient={patient_id} "
        f"visits={removed_from_visits}"
    )

    return {
        "status": "success",
        "message": "Document deleted from longitudinal case view",
        "patient_id": patient_id,
        "document_id": document_id,
        "removed_from_visits": removed_from_visits,
    }