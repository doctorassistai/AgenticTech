"""Read-only data loading for the dashboard pipeline.

STRICT READ-ONLY: this module NEVER writes to Mongo — only `find(...)`. It reuses
the same async-motor client / DB / collection as `users/patient_data/surgical_oncology.py`
(`doctorassistai` → `surgical_oncology`).

`assemble_state(patient_id)` returns the seed for the LangGraph state:
  - all_bookings    : every surgery doc for the patient, newest first
  - active_booking  : the is_active doc (fallback: latest) — a single episode
  - labs            : lab values aggregated across ALL bookings (newest 3 per test)
  - patient         : the 6-cell patient strip (deterministic — no LLM)
  - reportGenerated : NOT stamped here (Date.now unavailable in some contexts);
                      the API layer stamps it.
"""

import os
import re
from datetime import datetime, date
from typing import Any, Dict, List

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

_client = AsyncIOMotorClient(MONGO_URI)
_database = _client[MONGO_DB]
surgical_oncology_collection = _database["surgical_oncology"]
# Completed investigations (labs, pathology/HPR, imaging reports) + their processed text.
# Same collections the `oncology-investigations/all-completed-documents` endpoint joins.
oncology_investigations_collection = _database["oncology_investigations"]
processed_documents_collection = _database["processed_documents"]
# The pathology department's structured post-operative case (synoptic CAP report +
# AJCC TNM staging). One doc per case; same collection as `onco-pathology/latest-case`.
onco_pathology_collection = _database["onco_pathology"]
# Medical-oncology / chemo records — the structured source of ECOG performance status
# (doc → data.assessment.performanceStatus), plus diagnosis/stage/comorbidities.
# Read-only; same collection the `oncology-records/{patient_id}` endpoint reads.
chemotherapy_records_collection = _database["chemotherapy_records"]
# Generated clinical summary (narrative) — one doc per patient; read-only. Same
# collection the doctors-note narration / OPD pages read via `format_patient_summary_text`.
patient_summary_collection = _database["patient_summary"]
# Decoupled anaesthesia records — own collection, WRITTEN only by the anaesthesia
# module. The pre-anaesthesia checkup (PAC — the "pre") lives ONLY here now; the
# intra-op procedure sections (mm/ga/reg/mac/io/eo/checklist) are copied into the
# surgery doc too. Read-only; same collection as `/anaesthesia/record/by-booking`.
anaesthesia_records_collection = _database["anaesthesia_records"]
# Tumor-board / MDT care-pathway plan — the dedicated cross-specialty collection.
# One approved care_pathway_plan per patient (steps sequenced across specialties,
# each with status / dependency / guideline_support), the specialist doctor_approvals,
# safety_flags and the mdt_basis_summary. This is the AUTHORITATIVE MDT source that the
# surgery booking's free-text mdtComments only gestures at. Read-only.
tumor_board_collection = _database["tumorBoardPlan"]
# OT room reservations — the department-scoped theatre-booking collection (one doc per
# reservation, keyed by room_name + date across ALL patients, NOT per-patient). WRITTEN by
# the surgical CRUD API (create/update/complete booking → users/patient_data/
# surgical_oncology.py); we only READ it. This is the ONE genuinely cohort-level source
# available to the otherwise patient-scoped pipeline, so m12 can compute a REAL Operating
# Room Utilization for the theatre on this case's surgery day. Read-only.
ot_room_bookings_collection = _database["ot_room_bookings"]
# Patient demographic details. Read-only.
patient_users_collection = _database["patient_users"]


# ─── BSON → JSON-safe conversion ─────────────────────────────────────────────

def mongo_safe(value: Any) -> Any:
    """Recursively convert BSON types (ObjectId, datetime/date) to strings so the
    payload is JSON-serialisable and safe to hand to the LLM."""
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: mongo_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [mongo_safe(v) for v in value]
    return value


# ─── Loaders (all read-only) ─────────────────────────────────────────────────

async def get_all_bookings(patient_id: str) -> List[Dict[str, Any]]:
    """Every surgery doc for the patient, newest first (read-only)."""
    cursor = surgical_oncology_collection.find({"patient_id": patient_id}).sort("created_at", -1)
    docs = await cursor.to_list(length=100)
    return [mongo_safe(d) for d in docs]


async def get_completed_documents(patient_id: str) -> List[Dict[str, Any]]:
    """All COMPLETED oncology investigations (labs, pathology/HPR, imaging) joined to
    their processed text — read-only. Mirrors the `oncology-investigations/
    all-completed-documents` endpoint, but keeps the investigation even when no
    processed document exists (its `parameters` may still hold structured results).

    Returns every completed doc regardless of date; agents filter to what they need
    (e.g. m4/m11 take pathology, m7 takes pathology + biomarkers).
    """
    cursor = oncology_investigations_collection.find(
        {"patient_id": patient_id, "status": "completed"}
    ).sort("date_of_order", -1)
    investigations = await cursor.to_list(length=None)

    out: List[Dict[str, Any]] = []
    for inv in investigations:
        document_id = inv.get("document_id")
        proc = {}
        if document_id:
            proc = await processed_documents_collection.find_one(
                {"document_id": document_id, "patient_id": patient_id}
            ) or {}
        out.append(mongo_safe({
            "investigation": inv.get("investigation"),
            "clinical_indication": inv.get("clinical_indication"),
            "date_of_order": inv.get("date_of_order"),
            "parameters": inv.get("parameters"),
            "document_id": document_id,
            "raw_markdown": proc.get("raw_markdown"),
            "parameterwise_markdown": proc.get("parameterwise_markdown"),
            "parameterwise_content": proc.get("parameterwise_content"),
            "sections": proc.get("sections"),
        }))
    return out


def _report_snippet(proc: Dict[str, Any], limit: int = 600) -> str:
    """A short human-readable snippet of a processed report, for narrative/imaging
    documents that carry no discrete `parameterwise_content` rows (CT/PET/MRI etc.).
    Prefers the structured `sections`, then parameterwise markdown, then raw markdown."""
    secs = ((proc.get("sections") or {}).get("sections")) or []
    parts: List[str] = []
    for s in secs[:8]:
        heading = str(s.get("heading") or "").strip()
        content = str(s.get("content") or "").strip()
        if content:
            parts.append(f"{heading}: {content}" if heading else content)
    text = " | ".join(parts).strip()
    if not text:
        text = str(proc.get("parameterwise_markdown") or proc.get("raw_markdown") or "").strip()
    text = " ".join(text.split())   # collapse whitespace/newlines
    return text[:limit]


async def get_investigation_register(patient_id: str) -> List[Dict[str, Any]]:
    """Every oncology investigation ORDERED for the patient — ALL statuses, ALL doctors —
    for m1's baseline-investigation-completeness view (READ-ONLY).

    Unlike `get_completed_documents` (completed-only, joined to the FULL processed text so
    m4/m7/m11 can read the report), this returns the ORDER picture m1 needs to JUDGE
    completeness: what was requested (`requested`), each order's `status` ('pending' vs
    'completed'), its `clinical_indication`, `date_of_order` and `order_context` — plus,
    for a COMPLETED order, a COMPACT `resulted` list from processed_documents (parameter +
    value + date, or a short report snippet for narrative/imaging reports) so m1 can see
    which results came back, without loading the whole markdown.

    COMPLETION mirrors the Lab Investigations UI (components/LabInvestigations.jsx:591,597,
    which treats an order as pending iff it has no `document_id`): an order is COMPLETED once
    it carries a `document_id` (the uploaded/processed result), regardless of whether the
    stored `status` string was flipped to 'completed'. `document_id` is null at creation
    (see create_investigation) and only set when a result is uploaded, so its presence is
    the reliable completion signal; `status == 'completed'` is also honoured as a fallback.

    Scoped to the patient ONLY (NOT the surgical booking's doctor): the baseline work-up
    can be ordered by any doctor — surgeon, medical oncologist, anaesthetist — so the
    register spans every ordering doctor, mirroring the `/oncology-investigations/
    all-completed-documents` endpoint's across-all-doctors behaviour.
    """
    cursor = oncology_investigations_collection.find(
        {"patient_id": patient_id}
    ).sort("date_of_order", -1)
    investigations = await cursor.to_list(length=None)

    out: List[Dict[str, Any]] = []
    for inv in investigations:
        document_id = inv.get("document_id")
        raw_status = str(inv.get("status") or "").strip().lower()
        # A result document (document_id) is the reliable completion marker — same rule the
        # Lab Investigations UI uses; 'completed' status is honoured too as a fallback.
        is_completed = bool(document_id) or raw_status == "completed"
        status = "completed" if is_completed else (raw_status or "pending")

        resulted: List[Dict[str, Any]] = []
        report_date = ""
        if document_id:
            proc = await processed_documents_collection.find_one(
                {"document_id": document_id, "patient_id": patient_id}
            ) or {}
            for p in (proc.get("parameterwise_content") or [])[:40]:
                # Keep any parameter that carries content. Radiology/narrative reports may
                # not set `found`, so gate on content presence, not the `found` flag.
                content = str(p.get("content") or "").strip()
                if content:
                    resulted.append({
                        "parameter": p.get("parameter_name", ""),
                        "value": content,
                        "date": p.get("date", ""),
                    })
            # Narrative/imaging report with no parameter rows → surface a short snippet so
            # m1 still sees that a report came back (not an empty 'resulted').
            if not resulted:
                snippet = _report_snippet(proc)
                if snippet:
                    resulted.append({"parameter": "Report", "value": snippet, "date": ""})
            meta = proc.get("metadata") or {}
            report_date = meta.get("document_date") or meta.get("processing_date") or ""
        out.append(mongo_safe({
            "investigation": inv.get("investigation"),   # type-prefixed key (radiology_.../lab_...)
            "requested": inv.get("parameters"),           # tests requested in this order
            "clinical_indication": inv.get("clinical_indication"),
            "status": status,                             # 'completed' (result on file) | 'pending'
            "date_of_order": inv.get("date_of_order"),
            "document_id": document_id,
            "order_context": inv.get("order_context"),    # {type, label, booking_id}
            "resulted": resulted,                         # resulted values / report snippet (completed only)
            "report_date": report_date,
        }))
    return out


# Keywords that identify a histopathology / surgical-pathology report among the
# completed investigations (used by m4 / m11 / m7 to pick the right document).
_PATHOLOGY_KEYWORDS = (
    "pathology", "histopath", "hpr", "biopsy", "specimen", "immunohisto",
    "ihc", "cytology", "synoptic", "margin", "grossing",
)

# Keywords that identify a radiology / imaging report among the completed
# investigations (used by m2 to correlate imaging findings against the biopsy +
# clinical stage). The `investigation` key is type-prefixed ('radiology_...') so
# that prefix is the primary signal; the modality words catch anything else.
_IMAGING_KEYWORDS = (
    "ct scan", "computed tomography", "pet", "mri", "magnetic resonance",
    "ultrasound", "usg", "sonograph", "x-ray", "xray", "radiograph", "scan",
    "imaging", "mammogr", "endoscop", "eus", "doppler", "angiogra", "scintigraph",
)


def _drop_empty(d: Dict[str, Any]) -> Dict[str, Any]:
    """Copy of a dict keeping only keys with a real value (drop None/''/[]/{}).
    Keeps the pathology payload compact so the empty-slice guard stays meaningful."""
    return {k: v for k, v in (d or {}).items() if v not in (None, "", [], {})}


async def get_pathology_case(patient_id: str) -> Dict[str, Any]:
    """The pathology department's latest case for the patient (READ-ONLY).

    Mirrors the `onco-pathology/patient/{id}/latest-case` endpoint: prefer the
    active case; when a case is signed-out `is_active` is cleared, so fall back to
    the newest case by `created_at`. Empty dict if the patient has no case yet.
    """
    doc = await onco_pathology_collection.find_one(
        {"patient_id": patient_id, "is_active": True}
    )
    if not doc:
        doc = await onco_pathology_collection.find_one(
            {"patient_id": patient_id}, sort=[("created_at", -1)]
        )
    return mongo_safe(doc) if doc else {}


def normalize_pathology_case(case: Dict[str, Any]) -> Dict[str, Any]:
    """Flatten a raw pathology case into the clean structured facts the agents need.

    Pulls the three authoritative sections — `synoptic` (CAP synoptic report),
    `tnm.latest` (AJCC staging + final diagnosis) and `grossing` — plus the case
    status. Returns {} when a case exists but carries no pathology content yet, so
    the agents' empty-slice guard still fires (and never sees a bare `False` flag).
    """
    if not case:
        return {}
    synoptic = _drop_empty(case.get("synoptic") or {})
    tnm = _drop_empty((case.get("tnm") or {}).get("latest") or {})
    grossing = _drop_empty(case.get("grossing") or {})
    final_dx = tnm.get("final_diagnosis") or case.get("final_diagnosis") or ""

    if not (synoptic or tnm or grossing or final_dx):
        return {}

    norm = {
        "status": case.get("status", ""),
        "accession_id": case.get("accession_id", ""),
        "reported_date": case.get("updated_at") or case.get("created_at") or "",
        "synoptic": synoptic,          # CAP: site, histology, grade, size, margins, nodes, LVI/PNI
        "tnm": tnm,                    # AJCC 8th: pT/pN/pM, final stage, tnm_code, final_diagnosis
        "grossing": grossing,          # specimen description / dimensions
        "final_diagnosis": final_dx,
    }
    return _drop_empty(norm)


async def get_clinical_context(patient_id: str) -> Dict[str, Any]:
    """Structured clinical narrative + ECOG performance status (READ-ONLY).

    Two untapped structured sources the surgical booking itself doesn't carry:
      * `chemotherapy_records` → data.assessment.performanceStatus — the medical-
        oncology ECOG (same value OTRecord surfaces as "Latest ECOG (from Chemo)"),
        plus disease stage / diagnosis / functional context.
      * `patient_summary` → patient_summary.* — the generated clinical summary
        (one-liner, active problems, treatments, functional status incl. ECOG/KPS).

    Returns {} when neither source has usable content, so the empty-slice guard fires.
    """
    chemo, summary_doc = None, None
    chemo = await chemotherapy_records_collection.find_one(
        {"patientId": patient_id}, sort=[("updatedAt", -1)]
    )
    summary_doc = await patient_summary_collection.find_one(
        {"patient_id": patient_id}, sort=[("updated_at", -1)]
    )
    return normalize_clinical_context(mongo_safe(chemo) or {}, mongo_safe(summary_doc) or {})


def normalize_clinical_context(chemo: Dict[str, Any], summary_doc: Dict[str, Any]) -> Dict[str, Any]:
    """Flatten chemo + patient_summary into the clean clinical facts m1/m3 need.

    ECOG is read from the chemo assessment first (structured integer/string), then
    from the summary's functional-status section as a fallback. Everything is the
    DOCUMENTED value — never invented; missing pieces are simply omitted.
    """
    assessment = ((chemo.get("data") or {}).get("assessment")) or {}
    ps = summary_doc.get("patient_summary") or {}
    functional = ps.get("section_6_functional_status") or {}
    overview = ps.get("patient_overview") or {}

    ecog = assessment.get("performanceStatus") or functional.get("ecog_or_kps") or ""

    # Compact active-problem / treatment lines for the summary narrative.
    problems = [
        f"{p.get('problem', '')} ({p.get('current_stage_or_severity', '')})".strip(" ()")
        for p in (ps.get("section_1_current_active_problems") or [])
        if p.get("problem")
    ]
    treatments = [
        f"{t.get('treatment', '')} (started {t.get('started', '')})".strip()
        for t in ((ps.get("section_3_treatment_history") or {}).get("current_active_treatments") or [])
        if t.get("treatment")
    ]

    norm = {
        "ecogStatus": ecog,
        "ecogSource": "chemotherapy record" if assessment.get("performanceStatus")
        else ("clinical summary" if functional.get("ecog_or_kps") else ""),
        "karnofsky": assessment.get("karnofskyScore") or "",
        "mobility": functional.get("mobility", ""),
        "adl": functional.get("adl", ""),
        "diseaseStage": assessment.get("diseaseStage", ""),
        "oncologyDiagnosis": assessment.get("diagnosis", ""),
        "cardiacFunction": assessment.get("cardiacFunction", ""),
        "renalFunction": assessment.get("renalFunction", ""),
        "hepaticFunction": assessment.get("hepaticFunction", ""),
        "clinicalOneLiner": overview.get("one_liner", ""),
        "activeProblems": problems,
        "activeTreatments": treatments,
    }
    return _drop_empty(norm)


def pick_pathology_documents(documents: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Filter completed documents down to the pathology-type reports."""
    picked = []
    for d in documents or []:
        name = f"{d.get('investigation', '')} {d.get('clinical_indication', '')}".lower()
        if any(kw in name for kw in _PATHOLOGY_KEYWORDS):
            picked.append(d)
    return picked


def pick_imaging_documents(documents: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Filter completed documents down to the radiology / imaging reports (CT / PET-CT /
    MRI / USG etc.) — used by m2 to correlate imaging findings against the diagnostic
    biopsy + clinical stage. The `investigation` key is type-prefixed ('radiology_...'),
    so that prefix is the primary signal; the requested `parameters` (modality names) and
    `clinical_indication` are the fallback. Pathology reports are excluded so a doc never
    lands in both the imaging and the biopsy list."""
    picked = []
    for d in documents or []:
        inv = str(d.get("investigation", "")).lower()
        
        # Safely extract string representations from parameters (which may be a list of dicts)
        params = d.get('parameters') or []
        if isinstance(params, str):
            param_str = params
        elif isinstance(params, list):
            param_str = " ".join(
                str(p.get("parameter_name") or p.get("name") or p.get("label") or p.get("parameter") or "") if isinstance(p, dict) else str(p)
                for p in params
            )
        else:
            param_str = str(params)
            
        haystack = f"{inv} {d.get('clinical_indication', '')} {param_str}".lower()
        if any(kw in haystack for kw in _PATHOLOGY_KEYWORDS):
            continue  # pathology/biopsy — belongs in the biopsy list, not imaging
        if inv.startswith("radiology") or any(kw in haystack for kw in _IMAGING_KEYWORDS):
            picked.append(d)
    return picked


# ─── WHO-aligned surgical safety checklist (custom) ──────────────────────────
# The system's checklist is a CUSTOM list aligned to — not identical with — the WHO
# Surgical Safety Checklist. Every verification item is stored FLAT in
# active_booking.checklist as `${id}_status` ("Yes"/"No"/"NA"/"") plus `${id}_remarks`
# (free text). A handful of TIME OUT / SIGN OUT rows are FREE-TEXT concern fields with no
# `_status` at all — present-or-absent notes, never a Yes/No, so they must NOT be counted
# as "No". The item ids below mirror the CheckRow ids in
# components/surgical-oncology/SurgicalOncologyWorkflow.jsx one-for-one. This mapping is the
# single source of truth for both m1 (Pre-operative Checklist) and m3 (WHO Surgical Safety
# Checklist) so the LLM never eyeballs the raw key blob and miscounts blanks/NA as "No"
# (same lesson as m1's investigation _register_summary).
_CHECKLIST_PHASES = {
    "signin": {
        "who_phase": "Sign In — before induction of anaesthesia",
        "items": {
            "signin_identity": "Identity verified",
            "signin_procedure": "Procedure confirmed",
            "signin_side": "Side (laterality) confirmed",
            "signin_surgical_site": "Surgical site confirmed",
            "signin_consent": "Anaesthesia & surgery consent obtained",
            "signin_site": "Site marked",
            "signin_viral": "Viral markers checked",
            "signin_blood": "Blood confirmed (units available)",
            "signin_instruments": "Specified instruments available",
            "signin_position": "Preparation for position",
            "signin_machine": "Anaesthesia machine check",
            "signin_oximeter": "Pulse oximeter on & functioning",
            "signin_airway": "Difficult airway anticipated",
            "signin_aspiration": "Aspiration risk",
            "signin_starvation": "Adequate starvation (NPO)",
            "signin_allergy": "Known allergy?",
        },
    },
    "timeout": {
        "who_phase": "Time Out — before skin incision",
        "items": {
            "timeout_intro": "Team members introduce themselves",
            "timeout_patient": "Patient identity confirmed",
            "timeout_procedure": "Procedure confirmed",
            "timeout_side": "Side (laterality) confirmed",
            "timeout_mop": "Mop / gauze count done & recorded",
            "timeout_antibiotic": "Antibiotic prophylaxis given (drug/dose/time)",
            "timeout_imaging": "Essential imaging displayed",
            "timeout_hpr": "HPR / frozen form checked",
            "timeout_tourniquet": "Tourniquet application checked",
            "timeout_throat": "Throat pack inserted",
        },
    },
    "signout": {
        "who_phase": "Sign Out — before patient leaves OT",
        "items": {
            "signout_name": "Name of procedure recorded",
            "signout_count": "Instrument, sponge & needle counts complete",
            "signout_specimen": "Specimen labelled",
            "signout_equipment": "Equipment problems addressed",
        },
    },
    "extubation": {
        "who_phase": "Before Extubation — site-specific extra (beyond WHO)",
        "items": {
            "extubation_throat": "Throat pack removed before extubation",
        },
    },
}

# Free-text concern fields (no `_status`) — present-or-absent notes, NEVER Yes/No.
_CHECKLIST_FREETEXT = {
    "timeout_events_surgeon": "Anticipated critical events — surgical team",
    "timeout_events_anaesthesia": "Anticipated critical events — anaesthesia team",
    "timeout_events_nursing": "Anticipated critical events — nursing team",
    "signout_concerns_surgeon": "Post-op care concerns — surgical team",
    "signout_concerns_anaesthesia": "Post-op care concerns — anaesthesia team",
    "signout_concerns_nursing": "Post-op care concerns — nursing team",
}

# Safety-critical items: a 'No' here is an actionable stop, not a mere gap.
_CHECKLIST_CRITICAL = {
    "signin_consent", "signin_blood", "signin_viral", "signin_surgical_site",
    "signin_side", "timeout_antibiotic", "timeout_mop", "signout_count",
}


def summarize_checklist(checklist: Dict[str, Any]) -> Dict[str, Any]:
    """Deterministic per-phase completeness for the custom WHO-aligned safety checklist.

    The LLM must NOT count the raw `${id}_status` blob — blanks, NA and the free-text
    concern fields make it miscount and default the whole row to 'pending'. This returns
    exact per-phase tallies plus the WHO phase mapping so both m1 and m3 quote the numbers
    verbatim instead of eyeballing keys.

    Semantics (mirror SurgicalOncologyWorkflow.jsx):
      - 'Yes'         -> done
      - 'No'          -> answered negative = a safety gap ('critical_no' if a critical item)
      - 'NA' / 'N/A'  -> not applicable; EXCLUDED from the 'expected' denominator, not a fail
      - '' / absent   -> not yet performed (the checklist is filled in theatre, so pre-op the
                         intra-op phases are legitimately blank — 'started' flags this)
      - free-text concern fields are present-or-absent notes, never Yes/No.
    """
    cl = checklist or {}

    def _status(item_id: str) -> str:
        return str(cl.get(f"{item_id}_status") or "").strip().lower()

    phases = []
    for pid, spec in _CHECKLIST_PHASES.items():
        items = spec["items"]
        yes, no, na, blank, crit_no = [], [], [], [], []
        for iid, label in items.items():
            v = _status(iid)
            if v == "yes":
                yes.append(label)
            elif v == "no":
                no.append(label)
                if iid in _CHECKLIST_CRITICAL:
                    crit_no.append(label)
            elif v in ("na", "n/a"):
                na.append(label)
            else:
                blank.append(label)
        expected = len(items) - len(na)          # NA drops out of the denominator
        phases.append({
            "phase_id": pid,
            "who_phase": spec["who_phase"],
            "total_items": len(items),
            "expected": expected,                # non-NA items that still need a Yes
            "yes": len(yes), "no": len(no), "na": len(na), "blank": len(blank),
            "answered": len(yes) + len(no),      # actively responded (Yes or No)
            "performed": not blank,              # every non-NA item was answered (Yes or No)
            "all_clear": (not blank and not no), # answered AND nothing flagged 'No'
            "no_items": no,
            "critical_no": crit_no,
            "pending_items": blank[:12],
        })

    # free-text concern fields that were actually filled in
    freetext = {label: str(cl.get(key) or "").strip()
                for key, label in _CHECKLIST_FREETEXT.items()
                if str(cl.get(key) or "").strip()}

    total_expected = sum(p["expected"] for p in phases)
    total_yes = sum(p["yes"] for p in phases)
    total_no = sum(p["no"] for p in phases)
    total_answered = sum(p["answered"] for p in phases)
    critical_no = [x for p in phases for x in p["critical_no"]]

    return {
        "started": total_answered > 0,           # False => checklist not begun (not yet performed)
        "phases": phases,
        "freetext_concerns": freetext,
        "total_expected": total_expected,
        "total_yes": total_yes,
        "total_no": total_no,
        "total_answered": total_answered,
        "critical_no": critical_no,
        "all_performed": all(p["performed"] for p in phases),
        "all_clear": all(p["all_clear"] for p in phases),
    }


async def get_anaesthesia_record(patient_id: str, booking_id: str) -> Dict[str, Any]:
    """The decoupled anaesthesia record for this booking (READ-ONLY).

    The PAC ('pre') — comorbidities, ASA, airway, infection screening, pre-op
    remarks — now lives ONLY in the `anaesthesia_records` collection, not in the
    surgery doc. Mirrors `/anaesthesia/record/by-booking/{booking_id}`: prefer the
    record explicitly linked to this booking, then fall back to the patient's
    active record, then their latest record. {} if the patient has none.
    """
    doc = None
    if booking_id:
        doc = await anaesthesia_records_collection.find_one(
            {"linked_booking_id": booking_id}, sort=[("created_at", -1)]
        )
    if not doc:
        doc = await anaesthesia_records_collection.find_one(
            {"patient_id": patient_id, "status": "active"}, sort=[("created_at", -1)]
        )
    if not doc:
        doc = await anaesthesia_records_collection.find_one(
            {"patient_id": patient_id}, sort=[("created_at", -1)]
        )
    return mongo_safe(doc) if doc else {}


def merge_anaesthesia(active: Dict[str, Any], record: Dict[str, Any]) -> Dict[str, Any]:
    """Fold the decoupled anaesthesia record into the active booking's `anaesthesia`
    block so every pac-reading agent (m1/m2/m7/m8/m9/m10) sees one shape, unchanged.

    The PAC ('pre') is UNIQUE to the anaesthesia DB, so it is authoritative and
    overrides any stale embedded copy. The intra-op procedure sections are copied
    into the surgery doc, so keep the surgery's own copy and only backfill a section
    from the anaesthesia record when the surgery copy is missing.
    """
    if not record:
        return active
    embedded = dict(active.get("anaesthesia") or {})
    if record.get("pac"):
        embedded["pac"] = record["pac"]          # the 'pre' — lives only in the anaesthesia DB
    for section in ("checklist", "mm", "ga", "reg", "mac", "io", "eo"):
        if not embedded.get(section) and record.get(section):
            embedded[section] = record[section]  # backfill only if surgery lacks the copy
    active = dict(active)
    active["anaesthesia"] = embedded
    return active


async def get_tumor_board_plan(patient_id: str) -> Dict[str, Any]:
    """The tumor-board / MDT care-pathway plan for the patient (READ-ONLY).

    One approved plan per patient in `tumorBoardPlan`; prefer the active/approved
    plan, fall back to the newest by `created_at`. {} if the patient has no plan.
    """
    doc = await tumor_board_collection.find_one(
        {"patient_id": patient_id, "status": {"$ne": "archived"}},
        sort=[("updated_at", -1)],
    )
    if not doc:
        doc = await tumor_board_collection.find_one(
            {"patient_id": patient_id}, sort=[("created_at", -1)]
        )
    return mongo_safe(doc) if doc else {}


async def get_patient_user(patient_id: str) -> Dict[str, Any]:
    """Basic patient demographic details (READ-ONLY)."""
    doc = await patient_users_collection.find_one({"sys_user_id": patient_id})
    return mongo_safe(doc) if doc else {}


async def get_ot_room_day(room_name: str, date: str, hospital_id: str = "") -> List[Dict[str, Any]]:
    """Every OT reservation for ONE theatre on ONE day, across ALL patients (READ-ONLY).

    This is the department-scoped view m12 needs: the same query the OT-schedule UI runs
    (users/patient_data/surgical_oncology.py::get_ot_schedule — find by room_name + date,
    sorted by start_time). `hospital_id` is added to the filter when known, so a shared
    room name at two sites can't bleed together. Returns [] when the theatre/date is
    unknown (this case was never scheduled to a room) — the honest 'Not available' case.
    """
    if not room_name or not date:
        return []
    query: Dict[str, Any] = {"room_name": room_name, "date": date}
    if hospital_id:
        query["hospital_id"] = hospital_id
    cursor = ot_room_bookings_collection.find(query).sort("start_time", 1)
    docs = await cursor.to_list(length=200)
    return [mongo_safe(d) for d in docs]


def normalize_tumor_board(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Flatten a raw tumorBoardPlan doc into the clean MDT facts m2/m10 need.

    Pulls the `care_pathway_plan` header (intent, diagnosis, stage, rationale,
    guideline basis, safety flags, confidence) plus a compact per-step list, and
    the specialist approvals. Everything is the DOCUMENTED value — never invented;
    missing pieces are simply omitted so the agents' empty-slice guard still fires.

    Also exposes `surgicalStep` — the surgical-modality step pre-picked — so m2 can
    read the surgical pathway decision without re-scanning every step.
    """
    if not doc:
        return {}
    plan = doc.get("care_pathway_plan") or {}

    steps = []
    for s in (plan.get("steps") or []):
        step = _drop_empty({
            "step": s.get("step_number", ""),
            "phase": s.get("phase_name", ""),
            "modality": s.get("modality", ""),
            "treatment": s.get("treatment_name", ""),
            "plan": s.get("detailed_plan", ""),
            "timing": s.get("sequence_timing", ""),
            "dependsOnStep": s.get("depends_on_step", ""),
            "specialty": s.get("responsible_specialty", ""),
            "guideline": s.get("guideline_support", ""),
            "monitoringBeforeStarting": s.get("monitoring_before_starting", []),
            "status": s.get("status", ""),
            "statusReason": s.get("status_reason", ""),
            "isUrgent": s.get("is_urgent", ""),
        })
        if step:
            steps.append(step)

    surgical_step = next(
        (s for s in steps if str(s.get("modality", "")).lower() == "surgical"), {}
    )

    approvals = [
        _drop_empty({
            "specialty": a.get("speciality", ""),
            "doctor": a.get("doctor_name", ""),
            "status": a.get("status", ""),
        })
        for a in (doc.get("doctor_approvals") or [])
        if a.get("speciality") or a.get("status")
    ]

    norm = {
        "planStatus": doc.get("status", ""),
        "diagnosis": plan.get("primary_diagnosis", ""),
        "cancerStage": plan.get("cancer_stage", ""),
        "treatmentIntent": plan.get("overall_treatment_intent", ""),
        "totalSteps": plan.get("total_steps", ""),
        "steps": steps,
        "surgicalStep": surgical_step,
        "sequenceRationale": plan.get("sequence_rationale", ""),
        "mdtBasisSummary": plan.get("mdt_basis_summary", ""),
        "contributingSpecialties": plan.get("contributing_specialties", []),
        "safetyFlags": plan.get("safety_flags", []),
        "warnings": plan.get("warnings", []),
        "confidenceScore": plan.get("confidence_score", ""),
        "generatedAt": plan.get("generated_at", ""),
        "approvals": approvals,
    }
    return _drop_empty(norm)


def get_active_booking(bookings: List[Dict[str, Any]]) -> Dict[str, Any]:
    """The current episode: prefer is_active True; fall back to newest (already
    sorted newest-first). Empty dict if the patient has no bookings."""
    if not bookings:
        return {}
    for b in bookings:
        if b.get("is_active"):
            return b
    return bookings[0]


def aggregate_labs(bookings: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """Aggregate lab values across ALL bookings, mirroring
    `get_doctors_note_summary`: labs live at doctors_note.labResults.values
    (each {key,label,value,unit,range,flag}). Keep the newest 3 readings per test.

    `bookings` is already newest-first, so appends preserve recency order.
    """
    history: Dict[str, List[Dict[str, Any]]] = {}
    for b in bookings:
        dn = b.get("doctors_note") or {}
        surg_date = (b.get("booking") or {}).get("surgeryDate") or b.get("created_at") or ""
        values = (dn.get("labResults") or {}).get("values") or []
        for lab in values:
            key = lab.get("key")
            val = lab.get("value")
            if not key or val in (None, ""):
                continue
            history.setdefault(key, []).append({
                "date": surg_date,
                "value": val,
                "unit": lab.get("unit", ""),
                "range": lab.get("range", ""),
                "flag": lab.get("flag", ""),
                "label": lab.get("label", key),
            })
    return {k: v[:3] for k, v in history.items() if v}


# Serum tumour markers recognised for m8's monitoring / trend row. Each pattern is matched
# (case-insensitive) against a resulted lab parameter name (from the investigation register)
# or a doctor's-note lab label/key. Short abbreviations are word-boundary-anchored so they do
# NOT substring-match unrelated tests; the ambiguous "SCC" requires the antigen wording so it
# never picks up the squamous-cell-carcinoma histology type.
_MARKER_PATTERNS = [
    (re.compile(r"\bcea\b|carcinoembryonic", re.I), "CEA"),
    (re.compile(r"ca[\s\-]?19[\s\-.]?9", re.I), "CA 19-9"),
    (re.compile(r"ca[\s\-]?125", re.I), "CA 125"),
    (re.compile(r"ca[\s\-]?15[\s\-.]?3", re.I), "CA 15-3"),
    (re.compile(r"ca[\s\-]?27[\s\-.]?29", re.I), "CA 27-29"),
    (re.compile(r"\bafp\b|alpha[\s\-]?feto", re.I), "AFP"),
    (re.compile(r"\bpsa\b|prostate[\s\-]?specific", re.I), "PSA"),
    (re.compile(r"\bhcg\b|beta[\s\-]?hcg|β[\s\-]?hcg|\bb[\s\-]?hcg\b", re.I), "beta-hCG"),
    (re.compile(r"thyroglobulin", re.I), "Thyroglobulin"),
    (re.compile(r"calcitonin", re.I), "Calcitonin"),
    (re.compile(r"chromogranin", re.I), "Chromogranin A"),
    (re.compile(r"\bnse\b|neuron[\s\-]?specific[\s\-]?enolase", re.I), "NSE"),
    (re.compile(r"\bscc[\s\-]?ag\b|squamous[\s\-]?cell[\s\-]?carcinoma[\s\-]?antigen", re.I), "SCC antigen"),
    (re.compile(r"\bhe4\b", re.I), "HE4"),
    (re.compile(r"\bldh\b|lactate[\s\-]?dehydrogenase", re.I), "LDH"),
]


def _match_marker(name: str) -> str:
    """Return the canonical marker name if `name` is a recognised serum tumour marker, else ''."""
    n = str(name or "")
    if not n.strip():
        return ""
    for pat, canon in _MARKER_PATTERNS:
        if pat.search(n):
            return canon
    return ""


def pick_tumor_markers(
    register: List[Dict[str, Any]], labs: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """Deterministically collect serial serum tumour-marker readings for m8's monitoring /
    trend row, so the LLM never has to hunt the raw register (same lesson as m1's
    `_register_summary`). Markers are pulled from BOTH sources and merged per marker:

      1. the cross-doctor investigation register — resulted lab parameters (any ordering
         doctor: surgeon, medical oncology, anaesthesia), each with its result date; this is
         where serial CEA / CA 19-9 etc. actually live (they are rarely re-typed into the
         surgical doctor's note).
      2. the surgical doctor's-note lab panel (`aggregate_labs`) — a supplement.

    Each reading is dated (falling back to the order's report/order date) and grouped into a
    date-sorted series (oldest -> newest) so the agent can read the value AND the trend.
    Returns [] when no tumour markers have resulted — the honest 'Not available' case.
    """
    series: Dict[str, List[Dict[str, Any]]] = {}

    def _add(name: Any, value: Any, when: Any, source: str) -> None:
        canon = _match_marker(name)
        if not canon:
            return
        val = str(value or "").strip()
        if not val:
            return
        series.setdefault(canon, []).append(
            {"value": val[:120], "date": str(when or "").strip(), "source": source}
        )

    # 1) investigation register — resulted lab parameters across ALL ordering doctors
    for e in register or []:
        fallback_date = e.get("report_date") or e.get("date_of_order") or ""
        for r in e.get("resulted") or []:
            _add(r.get("parameter"), r.get("value"),
                 r.get("date") or fallback_date, "investigation register")

    # 2) doctor's-note labs (supplement)
    for key, readings in (labs or {}).items():
        for rd in readings or []:
            _add(rd.get("label") or key, rd.get("value"), rd.get("date"), "doctor's-note labs")

    out: List[Dict[str, Any]] = []
    for marker, vals in series.items():
        seen = set()
        uniq = []
        for v in vals:
            k = (v["value"], v["date"])
            if k in seen:
                continue
            seen.add(k)
            uniq.append(v)
        uniq.sort(key=lambda v: v["date"])          # ascending; undated readings sort first
        out.append({"marker": marker, "readings": uniq[-6:], "count": len(uniq)})
    out.sort(key=lambda m: m["marker"])
    return out


# ─── OT room utilization (m12) ───────────────────────────────────────────────
# The department-scoped theatre load for ONE room on ONE day, computed in Python so the
# agent reads exact numbers instead of adding up times from a raw booking blob (same
# lesson as m1's `_register_summary` / m8's `pick_tumor_markers`).

_HHMM = re.compile(r"^\s*(\d{1,2}):(\d{2})")


def _hhmm_to_min(t: Any) -> int:
    """'HH:MM' (24h) -> minutes past midnight; -1 if unparseable."""
    m = _HHMM.match(str(t or ""))
    if not m:
        return -1
    h, mm = int(m.group(1)), int(m.group(2))
    if h > 23 or mm > 59:
        return -1
    return h * 60 + mm


def _min_to_hhmm(mins: int) -> str:
    """minutes past midnight -> 'HH:MM' (wraps past 24h for readability)."""
    mins = int(mins) % 1440
    return f"{mins // 60:02d}:{mins % 60:02d}"


def _fmt_dur(mins: int) -> str:
    """minutes -> compact 'Nh Mm' / 'Nh' / 'Nm' duration."""
    mins = max(0, int(mins))
    h, m = divmod(mins, 60)
    if h and m:
        return f"{h}h {m}m"
    if h:
        return f"{h}h"
    return f"{m}m"


def summarize_or_utilization(
    schedule: List[Dict[str, Any]],
    active_booking_id: str = "",
    standard_day_min: int = 480,
    today: str = "",
) -> Dict[str, Any]:
    """Deterministically turn a theatre's day of reservations into the factual OR-load
    numbers m12 needs, so the LLM never adds up times from the raw schedule blob.

    `schedule` = get_ot_room_day(room, date) — every reservation for ONE theatre on ONE
    day across ALL patients. Each doc carries start_time / end_time ('HH:MM' 24h), a
    `status` ('Reserved' | 'Completed') and `booking_id`.

    `today` ('YYYY-MM-DD', server date) lets the agent place the theatre day in time — a
    day two weeks in the PAST is a historical record (report what happened, don't tell the
    surgeon to 'optimise scheduling'); TODAY / UPCOMING is where forward actions apply.
    `days_ago` (>0 past, 0 today, <0 upcoming) + `when` carry that context.

    Two utilization denominators, because they answer different questions:
      - `occupancy_pct` = booked ÷ the actual open window (earliest start → latest end).
        In-window occupancy — how densely the day that ACTUALLY ran was used. Bounded
        0-100, needs no assumption, and is the honest HEADLINE metric.
      - `utilization_pct` = booked ÷ an ASSUMED `standard_day_min` (480 = 8h list). There
        is NO stored room-availability config, so this is only a planning proxy vs an
        assumed day and CAN exceed 100% when the list simply ran longer than 8h — cite it
        as a rough load indicator, never as measured occupancy.

    Other caveats baked in so the agent frames them honestly:
      - A 'Reserved' case's end_time is hourly-rounded at booking (calculate_end_time);
        only a 'Completed' case carries the real finish. `completed` / `reserved` counts
        are returned so the agent can say how much of the load is still an estimate.
      - Cancellations are NOT tracked (nothing writes a 'Cancelled' status), so a released
        slot still counts — utilization can be over- but never under-stated.

    Returns {} when the theatre/day has no reservations (the honest 'Not available').
    """
    rows: List[Dict[str, Any]] = []
    for d in schedule or []:
        s = _hhmm_to_min(d.get("start_time"))
        if s < 0:
            continue
        e = _hhmm_to_min(d.get("end_time"))
        minutes = None
        if e >= 0:
            minutes = e - s
            if minutes < 0:
                minutes += 1440  # list crosses midnight (rare)
        rows.append({
            "start": s,
            "end": e,
            "minutes": minutes,
            "status": d.get("status", ""),
            "is_this_case": bool(active_booking_id) and d.get("booking_id") == active_booking_id,
        })
    if not rows:
        return {}

    rows.sort(key=lambda r: r["start"])
    cases = len(rows)
    completed = sum(1 for r in rows if str(r["status"]).lower() == "completed")
    reserved = cases - completed
    total_booked = sum(r["minutes"] for r in rows if r["minutes"] is not None)

    earliest = rows[0]["start"]
    ended = [r["end"] for r in rows if r["end"] >= 0]
    latest = max(ended) if ended else earliest
    span = max(0, latest - earliest)

    # Double-booking: any case starting before the running latest end (schedule is
    # start-sorted). end<0 rows (no finish recorded) are skipped from the overlap check.
    double_booked = False
    running_end = None
    for r in rows:
        if r["end"] < 0:
            continue
        if running_end is not None and r["start"] < running_end:
            double_booked = True
        running_end = r["end"] if running_end is None else max(running_end, r["end"])

    idle = max(0, span - total_booked)  # gaps inside the working window
    util_pct = round(total_booked / standard_day_min * 100) if standard_day_min else 0
    # In-window occupancy: booked ÷ the window that actually ran. Bounded 0-100, no
    # assumption — the honest headline (util_pct vs an assumed 8h can exceed 100%).
    occupancy_pct = round(total_booked / span * 100) if span else 0

    # Place the theatre day in time relative to the server's 'today'. days_ago>0 = past
    # (historical record — report, don't optimise); 0 = today; <0 = upcoming.
    day = ""
    for d in schedule or []:
        if d.get("date"):
            day = str(d.get("date"))[:10]
            break
    days_ago = _days_between(day, today) if (day and today) else None
    if days_ago is None:
        when = ""
    elif days_ago > 0:
        when = "past"
    elif days_ago == 0:
        when = "today"
    else:
        when = "upcoming"

    case_list = [
        {
            "slot": f"{_min_to_hhmm(r['start'])}-{_min_to_hhmm(r['end'])}"
                    if r["end"] >= 0 else f"{_min_to_hhmm(r['start'])}-?",
            "minutes": r["minutes"],
            "status": r["status"],
            "is_this_case": r["is_this_case"],
        }
        for r in rows
    ]

    return {
        "date": day,
        "days_ago": days_ago,
        "when": when,
        "cases": cases,
        "completed": completed,
        "reserved": reserved,
        "total_booked_minutes": total_booked,
        "total_booked_hm": _fmt_dur(total_booked),
        "earliest_start": _min_to_hhmm(earliest),
        "latest_end": _min_to_hhmm(latest) if ended else "",
        "span_minutes": span,
        "span_hm": _fmt_dur(span),
        "idle_minutes": idle,
        "idle_hm": _fmt_dur(idle),
        "occupancy_pct": occupancy_pct,
        "standard_day_hours": round(standard_day_min / 60, 1),
        "utilization_pct": util_pct,
        "double_booked": double_booked,
        "case_list": case_list,
    }


def _leading_date(s: Any) -> str:
    """The leading 'YYYY-MM-DD' of a date/ISO-datetime string, '' if not parseable.
    (surgeryDate is a date-picker 'YYYY-MM-DD'; created_at is an ISO datetime.)"""
    txt = str(s or "").strip()[:10]
    try:
        datetime.strptime(txt, "%Y-%m-%d")
        return txt
    except ValueError:
        return ""


def _days_between(d1: str, d2: str):
    """Whole days from d1 -> d2 (both 'YYYY-MM-DD'); None if either is missing."""
    if not d1 or not d2:
        return None
    return (datetime.strptime(d2, "%Y-%m-%d") - datetime.strptime(d1, "%Y-%m-%d")).days


def summarize_case_scheduling(active: Dict[str, Any], today: str = "") -> Dict[str, Any]:
    """Deterministic scheduling facts for THIS case that m12 needs — the waiting time and
    the postpone / cancellation track record — computed in Python so the agent never does
    date arithmetic by hand (same lesson as the other deterministic summaries).

    Only a single case, so these are NOT cohort statistics (no waiting-list depth, no
    cancellation RATE) — they are this record's real contribution to those views:
      - wait_days   : booking-created ('listed' proxy) -> surgeryDate. created_at is when the
                      booking was entered, the closest thing to a listing date the record has
                      (there is no separate decision-to-treat date), so label it as such.
      - listing_reliable : wait_days is only a REAL waiting time if the booking was entered
                      BEFORE the surgery day (wait_days > 0). When created_at falls on/after
                      surgeryDate (wait_days <= 0) the booking was entered retrospectively
                      (same-day data entry), so a '0-day wait' is a data artifact, NOT a
                      genuine zero wait — the agent must say the waiting time isn't captured
                      rather than report it as an on-target 0 days.
      - status      : lifecycle (Pending / Postponed / Completed / Cancelled).
      - acuity      : caseStatus type(s) (Minor / Elective / Emergency / Re-Exploration).
      - postpone_*  : whether/how often this case slipped, and why (a real disruption signal).
      - cancellation_reason : populated only if the case was cancelled.
      - surgery_days_ago : places surgeryDate vs `today` (>0 past / 0 today / <0 upcoming)
                      so the agent frames a completed case in the past tense and only applies
                      forward waiting-list actions to a case still ahead.
    Returns {} if there's no active booking.
    """
    if not active:
        return {}
    booking = active.get("booking") or {}
    listed = _leading_date(active.get("created_at"))
    surgery = _leading_date(booking.get("surgeryDate"))
    history = booking.get("postponeHistory") or []
    postpone_count = len(history) if history else (1 if booking.get("originalSurgeryDate") else 0)
    wait_days = _days_between(listed, surgery)
    listing_reliable = wait_days is not None and wait_days > 0
    surgery_days_ago = _days_between(surgery, today) if (surgery and today) else None
    return {
        "status": active.get("status", ""),
        "acuity": booking.get("caseStatus", []),
        "listed_date": listed,
        "surgery_date": surgery,
        "surgery_days_ago": surgery_days_ago,
        "original_surgery_date": _leading_date(booking.get("originalSurgeryDate")),
        "wait_days": wait_days,
        "listing_reliable": listing_reliable,
        "is_postponed": bool(booking.get("isPostponed")),
        "postpone_count": postpone_count,
        "postpone_reason": booking.get("postponeReason", ""),
        "cancellation_reason": booking.get("cancellationReason", ""),
    }


def build_patient_strip(active: Dict[str, Any], pathology_case: Dict[str, Any] = None, patient_user: Dict[str, Any] = None) -> Dict[str, Any]:
    """The 6-cell patient strip — deterministic, straight from the active booking
    (+ the pathology department's case for the pathology-status cell). No LLM.
    Cells the DB can't fill are simply omitted (UI shows 'Not available').
    """
    booking = active.get("booking") or {}
    pathology_case = pathology_case or {}
    patient_user = patient_user or {}
    strip: Dict[str, Any] = {}

    name = booking.get("patientName") or patient_user.get("name")
    if name:
        strip["patientId"] = {"value": name, "sub": active.get("patient_id") or patient_user.get("sys_user_id") or ""}

    diagnosis = booking.get("preOpDiagnosis")
    if diagnosis:
        strip["diagnosis"] = {"value": diagnosis}

    procedure = booking.get("procedureName")
    if procedure:
        sub = booking.get("caseStatus") or ""
        strip["procedure"] = {"value": procedure, "sub": sub}

    # Pathology status: prefer the pathology department's case status (with the final
    # diagnosis as sub-line); fall back to the booking's own status.
    path_tnm = pathology_case.get("tnm") or {}
    if pathology_case.get("status"):
        strip["pathologyStatus"] = {
            "value": pathology_case["status"],
            "sub": pathology_case.get("final_diagnosis") or "",
        }
    elif active.get("status"):
        strip["pathologyStatus"] = {"value": active["status"]}

    if booking.get("surgeryDate"):
        strip["stageMigration"] = {"value": booking["surgeryDate"], "sub": booking.get("otRoom", "")}

    return strip


async def assemble_state(patient_id: str) -> Dict[str, Any]:
    """Build the LangGraph seed state for a patient (read-only)."""
    import asyncio

    # Server's calendar date ('today'). datetime/date work fine on the Python server
    # (store.py stamps generated_at with datetime.now); the 'Date.now unavailable' note
    # elsewhere is about the JS frontend, not this pipeline. Threaded into the m12
    # summaries so the theatre day / surgery date can be placed as past / today / upcoming
    # instead of every date being read present-tense.
    today = date.today().isoformat()

    bookings, documents, raw_pathology_case, clinical_context, raw_tumor_board, patient_user = await asyncio.gather(
        get_all_bookings(patient_id),
        get_completed_documents(patient_id),
        get_pathology_case(patient_id),
        get_clinical_context(patient_id),
        get_tumor_board_plan(patient_id),
        get_patient_user(patient_id),
    )
    active = get_active_booking(bookings)
    # The PAC ('pre') is decoupled into anaesthesia_records — fetch it for THIS booking
    # (needs the resolved active booking's id) and merge it back into the active doc so
    # every pac-reading agent sees the usual `anaesthesia.pac` shape.
    anaesthesia_record = await get_anaesthesia_record(
        patient_id, active.get("booking_id", "")
    )
    active = merge_anaesthesia(active, anaesthesia_record)
    # Full investigation ORDER register (all statuses, all ordering doctors) for m1's
    # baseline-completeness view — patient-scoped only, since any doctor can order the
    # baseline work-up (read-only).
    investigation_register = await get_investigation_register(patient_id)
    pathology_case = normalize_pathology_case(raw_pathology_case)
    tumor_board = normalize_tumor_board(raw_tumor_board)
    # OT room utilization (m12) — the ONE department-scoped source. Pull every reservation
    # for THIS case's theatre on its surgery day (across all patients), then reduce it to
    # exact load numbers in Python. Empty when the case has no room/date scheduled.
    active_booking = active.get("booking") or {}
    ot_schedule = await get_ot_room_day(
        active_booking.get("otRoom", ""),
        active_booking.get("surgeryDate", ""),
        active.get("hospital_id", ""),
    )
    or_utilization = summarize_or_utilization(ot_schedule, active.get("booking_id", ""), today=today)
    # This case's scheduling facts (waiting time + postpone/cancel track record) — the
    # single-case contribution m12's waiting-list / cancellation rows can honestly report.
    case_scheduling = summarize_case_scheduling(active, today=today)
    return {
        "patient_id": patient_id,
        "today": today,                                        # server calendar date (m12 date-context)
        "all_bookings": bookings,
        "active_booking": active,
        "labs": aggregate_labs(bookings),
        "completed_documents": documents,                      # all completed investigations
        "pathology_documents": pick_pathology_documents(documents),  # pathology/HPR subset
        "investigation_register": investigation_register,      # all ordered investigations (m1 completeness)
        "pathology_case": pathology_case,                      # structured synoptic + TNM (path dept)
        "clinical_context": clinical_context,                  # ECOG + clinical summary (med-onc / summary)
        "tumor_board": tumor_board,                            # MDT care-pathway plan (tumorBoardPlan)
        "ot_schedule": ot_schedule,                            # raw theatre/day reservations (m12)
        "or_utilization": or_utilization,                      # deterministic OR-load numbers (m12)
        "case_scheduling": case_scheduling,                    # this case's wait + postpone/cancel record (m12)
        "patient": build_patient_strip(active, pathology_case, patient_user),
        "modules": {},
        "warnings": [],
    }
