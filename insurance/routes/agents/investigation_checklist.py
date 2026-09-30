"""
routes/agents/investigation_checklist.py
─────────────────────────────────────────────────────────────────────────────
Single shared source of truth for:

  1. The checklist-building logic originally in qc_review.py (_normalize_doc_key,
     _find_form_val, _get_path/_get_document_id/_get_file_name/_is_not_applicable/
     _get_skip_reason/_is_accounted, DOC_KEY_LABELS, TEXT_KEYS, build_investigations)
     — generalized to not hardcode the inv_type list. qc_review.py imports these
     instead of defining them locally, and the new field-officer report/findings
     generators import the SAME functions, so "what's missing" can never drift
     between QC's view and the report's view (design decision #3).

  2. Tag parsing for the [INV_TYPE/step_key] filename markers that
     field_investigation_parse_task.py writes into raw_llama_markdown block
     names (design decision #4), and the branch-point detector conclusion.py /
     case_documents.py use to decide "old untagged path" vs "new field-officer
     path" (design decision #5).

  3. The investigationDocuments[] <-> raw_llama_markdown join (tagged_file_name
     is byte-identical to the PDF_START block name — design decision #4), and
     content-category classification of step_keys (design decision #2).

NO INV_TYPES CONSTANT ON PURPOSE (design decision #1): the type set is being
actively renamed/merged by the team (see AssignmentSection.jsx's newest intent
of MV/HVI/HV/DIGI vs. TaskStepsScreen.jsx's still-live TRIGGER branch vs.
qc_review.py's older MV/HV/HVI/TELE/BILL). Every function here either takes
inv_type as a parameter or discovers the set actually present in a given
claim's `investigations` dict / `raw_llama_markdown` tags at runtime.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

# split_text_by_pdf is the one place PDF_START/PDF_END markers are parsed —
# reuse it rather than re-implementing block splitting here.
from routes.agents.chunking import split_text_by_pdf


# ═════════════════════════════════════════════════════════════════════════════
# Tag parsing — [INV_TYPE/step_key] original_filename
# ═════════════════════════════════════════════════════════════════════════════
# Matches exactly what field_investigation_parse_task.py writes:
#   tagged_filename = f"[{inv_type}/{step_key}] {file_name}"
_TAG_RE = re.compile(r"^\[([A-Z]+)/([a-z0-9_]+)\]\s*(.*)$")

# Used only as a cheap existence check (design decision #5's branch point) —
# does this claim's raw_llama_markdown contain ANY field-officer tag at all,
# without fully parsing every block name.
FIELD_OFFICER_TAG_RE = re.compile(r"\[[A-Z]+/[a-z0-9_]+\]")


def parse_labeled_filename(block_name: str) -> Optional[Dict[str, str]]:
    """
    Parse one PDF_START block name (or a tagged_file_name / display_label
    string of the same shape) into {"inv_type", "step_key", "original_filename"}.
    Returns None if it doesn't match the field-officer tag shape at all —
    e.g. an old untagged upload's plain filename.
    """
    if not block_name:
        return None
    m = _TAG_RE.match(block_name.strip())
    if not m:
        return None
    return {
        "inv_type": m.group(1),
        "step_key": m.group(2),
        "original_filename": m.group(3).strip(),
    }


def has_field_officer_tags(raw_llama_markdown: str) -> bool:
    """
    The branch-point check itself (design decision #5): does this claim's
    combined markdown contain at least one [INV_TYPE/step_key] tag? If not,
    callers should fall through to the existing untagged/classifier path
    unchanged.
    """
    return bool(FIELD_OFFICER_TAG_RE.search(raw_llama_markdown or ""))


def discover_inv_types(raw_llama_markdown: str) -> List[str]:
    """
    Which inv_type codes are ACTUALLY present in this claim's parsed
    documents, in first-seen order. This is what callers should iterate
    over instead of any hardcoded INV_TYPES list (design decision #1).
    """
    seen: List[str] = []
    seen_set = set()
    for block_name in split_text_by_pdf(raw_llama_markdown or "").keys():
        parsed = parse_labeled_filename(block_name)
        if parsed and parsed["inv_type"] not in seen_set:
            seen_set.add(parsed["inv_type"])
            seen.append(parsed["inv_type"])
    return seen


def discover_inv_type_step_keys(raw_llama_markdown: str) -> Dict[str, List[str]]:
    """{inv_type: [step_key, ...]} for every tagged block actually present,
    step_keys in first-seen order, deduped. Useful for a generator that
    wants to know exactly which sections it needs to build for this claim
    without touching claim['investigations'] at all."""
    out: Dict[str, List[str]] = {}
    seen_pairs = set()
    for block_name in split_text_by_pdf(raw_llama_markdown or "").keys():
        parsed = parse_labeled_filename(block_name)
        if not parsed:
            continue
        key = (parsed["inv_type"], parsed["step_key"])
        if key in seen_pairs:
            continue
        seen_pairs.add(key)
        out.setdefault(parsed["inv_type"], []).append(parsed["step_key"])
    return out


# ═════════════════════════════════════════════════════════════════════════════
# Best-effort label map for known inv_type codes — extend as new codes show
# up; never treat this as the authoritative type list (there isn't one).
# ═════════════════════════════════════════════════════════════════════════════
INV_LABEL_MAP: Dict[str, str] = {
    "MV":      "Member Visit",
    "HVI":     "Hospital Visit",
    "HV":      "Past Hospital Visit",
    "DIGI":    "Digi Verification",
    "TELE":    "Telephone Verification",   # legacy code, pre-DIGI rename
    "BILL":    "Bill Verification",        # legacy, retired into MV/HVI
    "TRIGGER": "Trigger Investigation",    # legacy but still a live branch
                                            # in TaskStepsScreen.jsx — keep
                                            # supporting it until it's gone
                                            # from the mobile app too
}


def label_for_inv_type(code: str) -> str:
    """Known code -> friendly label; unknown code -> title-cased fallback,
    per design decision #1 ('fall back to title-casing the raw code')."""
    if not code:
        return "Unknown"
    if code in INV_LABEL_MAP:
        return INV_LABEL_MAP[code]
    return code.replace("_", " ").title()


def get_investigation_entries(claim: dict, inv_type: str) -> List[dict]:
    """Raw claim.investigations[inv_type] entries (investigatorName,
    investigatorId, documents[], submission), filtered to actual dicts.
    Callers that just need the checklist + investigator name for a section
    (rather than the full QC-shaped build_investigations() output) can use
    this directly."""
    entries = (claim.get("investigations") or {}).get(inv_type, [])
    return [e for e in entries if isinstance(e, dict)]


# ═════════════════════════════════════════════════════════════════════════════
# Content-category classification (design decision #2)
# ═════════════════════════════════════════════════════════════════════════════
CATEGORY_CURRENT_ADMISSION  = "current_admission"
CATEGORY_PED_PRIOR_HISTORY  = "ped_prior_history"
CATEGORY_VERIFICATION       = "verification"    # DIGI/TELE/TRIGGER — bespoke,
                                                  # kept separate per inv_type,
                                                  # same pattern as today's
                                                  # hospital/member split
CATEGORY_ADMINISTRATIVE     = "administrative"  # identity/admin — referenced
                                                  # lightly, not flag-heavy

# inv_type codes that are ALWAYS their own bespoke verification section,
# regardless of step_key content.
_VERIFICATION_INV_TYPES = {"DIGI", "TELE", "TRIGGER"}

# inv_type codes that are ALWAYS PED/Prior History, regardless of step_key —
# "all of HV's content (it's inherently about a prior/different admission,
# verified by interview)".
_PED_PRIOR_HISTORY_INV_TYPES = {"HV"}

# Keyword substrings checked against the normalized step_key. Order matters:
# PED/prior-history keywords are checked before current-admission keywords
# so e.g. "past_op_papers" (current-admission-ish name but PED in meaning)
# lands correctly regardless of which inv_type (MV or HVI) contributed it.
_PED_PRIOR_HISTORY_KEYWORDS = (
    "past_op_paper", "past_ip_paper", "previous_consultation",
    "pre_existing_disease", "pre_existing", "medication_history",
    "other_treatment_history", "first_consultation_detail", "doctor_detail",
    "admission_detail", "treatment_detail", "discharge_detail",
)

_CURRENT_ADMISSION_KEYWORDS = (
    "discharge_summary", "discharge_bill", "bill_copy", "hospital_record",
    "investigation_report", "lab_bill", "op_card", "doctor_statement",
    "pharmacy_bill", "all_bill", "every_bill", "bills_from", "bill_amount",
    "bill_payment", "first_consultation_paper", "icp", "ip_paper",
    "emergency_note", "casualty_note", "blood_report", "x_ray", "mri",
    "reference_note", "transferred_hospital", "treatment_record",
    "initial_assessment_chart", "treatment_chart", "bp_chart",
    "diabetic_chart", "temperature_chart", "nurses", "anesthesia",
    "anaesthesia", "surgery_note", "post_operative", "postoperative",
    "mlc", "fir", "wound_certificate", "death_summary", "death_narration",
    "postmortem", "chemical_analysis", "cashless_claim", "bill_genuineness",
    "discount_verification", "non_medical_expenses", "seal_verification",
    "rta_verification", "hospital_geotag", "accident_narration",
    "vehicle_damage", "safety_measure", "driver_detail",
)

_ADMINISTRATIVE_KEYWORDS = (
    "policy_card", "id_proof", "policy_related_document", "policy_document",
    "declaration_form", "forms_and_declaration", "patient_photo",
    "google_timeline", "house_geotagged_photo", "scar_photo",
    "driving_license", "residence_proof", "consent_for",
)

# Some investigationDocuments entries get a suffixed step_key when a voice
# note is attached alongside/instead of a file for that same checklist item
# (see TaskStepsScreen.jsx's uploadTranscriptPdf -> `${step.key}_voice_transcript`
# and the sample claim's "patient_id_proof_voice_transcript" entry). Strip
# known suffixes before categorizing/labeling so the transcript lands in the
# same section as its parent document instead of falling through to
# administrative.
_STEP_KEY_SUFFIXES_TO_STRIP = ("_voice_transcript",)


def _base_step_key(step_key: str) -> str:
    key = (step_key or "").lower()
    for suffix in _STEP_KEY_SUFFIXES_TO_STRIP:
        if key.endswith(suffix):
            key = key[: -len(suffix)]
            break
    return key


def _matches_any(step_key: str, keywords: Tuple[str, ...]) -> bool:
    return any(kw in step_key for kw in keywords)


def categorize_step(inv_type: str, step_key: str) -> str:
    """
    The single function both the report generator and the findings
    generator call to decide which section a given (inv_type, step_key)
    block belongs to. See CATEGORY_* constants above.
    """
    inv_type = (inv_type or "").upper()
    base_key = _base_step_key(step_key)

    if inv_type in _VERIFICATION_INV_TYPES:
        return CATEGORY_VERIFICATION

    if inv_type in _PED_PRIOR_HISTORY_INV_TYPES:
        return CATEGORY_PED_PRIOR_HISTORY

    if _matches_any(base_key, _PED_PRIOR_HISTORY_KEYWORDS):
        return CATEGORY_PED_PRIOR_HISTORY

    if _matches_any(base_key, _CURRENT_ADMISSION_KEYWORDS):
        return CATEGORY_CURRENT_ADMISSION

    if _matches_any(base_key, _ADMINISTRATIVE_KEYWORDS):
        return CATEGORY_ADMINISTRATIVE

    # Unknown step_key on an inv_type that (per known codes) collects
    # current-claim documents defaults to current-admission rather than
    # silently vanishing into administrative.
    if inv_type in ("MV", "HVI", "BILL") or inv_type not in INV_LABEL_MAP:
        return CATEGORY_CURRENT_ADMISSION

    return CATEGORY_ADMINISTRATIVE


# Backward/forward-compatible alias matching the name used in the handoff
# prompt's "what to build" list.
STEP_KEY_CONTENT_CATEGORY = categorize_step


# ═════════════════════════════════════════════════════════════════════════════
# investigationDocuments[] <-> raw_llama_markdown join (design decision #4)
# ═════════════════════════════════════════════════════════════════════════════
def build_document_lookup(investigation_documents: List[dict]) -> Dict[str, dict]:
    """
    {tagged_file_name: {doc_id, investigator_id, kind, inv_type, step_key,
    status}} for every parsed investigationDocuments[] entry.

    Keyed strictly on tagged_file_name (NOT display_label) because
    tagged_file_name is the field that's byte-identical to the PDF_START
    block name (set once field_investigation_parse_task.py finishes parsing
    that doc) — display_label is set earlier, at submit time, in a
    different string shape ("[MV] Policy Card   Health Card" vs.
    "[MV/policy_card___health_card] photo.jpg") and does NOT match block
    names. An entry with no tagged_file_name yet (still queued_for_parse,
    skipped, or not_applicable) has no markdown block to join to and is
    skipped here — callers relying on this lookup should expect gaps for
    anything not yet parsed.
    """
    lookup: Dict[str, dict] = {}
    for doc in investigation_documents or []:
        if not isinstance(doc, dict):
            continue
        tagged = doc.get("tagged_file_name")
        if not tagged:
            continue
        lookup[tagged] = {
            "doc_id":          doc.get("doc_id") or doc.get("document_id"),
            "investigator_id": doc.get("investigator_id"),
            "kind":            doc.get("kind", "document"),
            "inv_type":        doc.get("inv_type"),
            "step_key":        doc.get("step_key"),
            "status":          doc.get("status"),
        }
    return lookup


def lookup_document_for_block(lookup: Dict[str, dict], block_name: str) -> Optional[dict]:
    """Resolve one split_text_by_pdf() block name back to its
    investigationDocuments metadata via build_document_lookup()'s output.
    Returns None if the block has no matching investigationDocuments entry
    (e.g. it came from the old untagged upload path)."""
    return lookup.get(block_name)


# ═════════════════════════════════════════════════════════════════════════════
# Checklist logic — pulled out of qc_review.py verbatim except where noted,
# generalized to discover inv_types from claim['investigations'].keys()
# instead of a hardcoded list.
# ═════════════════════════════════════════════════════════════════════════════

# NOTE: kept as an open, extensible dict exactly as in qc_review.py — the
# fallback (dk.replace("_", " ").title()) already handles anything not
# listed here, so this only needs entries worth a nicer label.
DOC_KEY_LABELS: Dict[str, str] = {
    "id_proof_of_patient":               "ID Proof – Patient",
    "policy_card___health_card":         "Policy / Health Card",
    "id_of_person_filling_mvf":          "ID – MVF Filler",
    "discharge_summary":                 "Discharge Summary",
    "doctor_statement":                  "Doctor Statement",
    "hospital_records":                  "Hospital Records",
    "op_card":                           "OP Card",
    "neighbour_statement":               "Neighbour Statement",
    "residence_proof":                   "Residence Proof",
    "call_recording":                    "Call Recording",
    "pharmacy_bill":                     "Pharmacy Bill",
    "discharge_bill":                    "Discharge Bill",
    "report_format":                     "Report Format",
    "check_for_cl___rsby_availability":  "CL / RSBY Check",
    "id_proof_patient":                  "ID Proof – Patient",
    "id_proof_mvf":                      "ID Proof – MVF",
    "policy_card":                       "Policy Card",
    "investigation_reports":             "Investigation Reports",
    "bill_copy":                         "Bill Copy",
    "driving_license":                   "Driving License",
    "scar_photo":                        "Scar Photo",
    # extended for the newer AssignmentSection.jsx checklist / DIGI codes
    "patient_id_proof":                  "Patient ID Proof",
    "id_proof_of_person_filling_mvf__if_different_": "ID Proof – Person Filling MVF",
    "policy_related_documents":          "Policy-Related Documents",
    "declaration_form":                  "Declaration Form",
    "forms_and_declarations":            "Forms and Declarations",
    "past_op_papers":                    "Past OP Papers",
    "past_ip_papers":                    "Past IP Papers",
    "google_timeline":                   "Google Timeline",
    "house_geotagged_photos":            "House Geotagged Photos",
    "hospital_geotag_photo":             "Hospital Geotag Photo",
    "surgery_scar_mark_photos":          "Surgery Scar Mark Photos",
    "telephonic_statement":              "Telephonic Statement",
}

# Extensible — not exhaustive. As new inv_types add their own *_remarks /
# *_visit_date style fields, add them here so they keep being treated as
# investigator notes (folded into narrative) rather than counted as an
# expected-but-missing document.
TEXT_KEYS = {
    "mv_visit_date", "mv_remarks",
    "hv_doctor_name", "hv_observations",
    "hvi_neighbour", "hvi_remarks",
    "tele_person", "tele_datetime", "tele_summary",
    "bill_amount", "bill_notes",
    "trigger_date", "trigger_reason", "trigger_observations",
}


def _get_path(value) -> Optional[str]:
    if not value:
        return None
    if isinstance(value, str):
        v = value.strip()
        return v if v and ("/" in v or v.startswith("http") or v == "voice-note") else None
    if isinstance(value, dict):
        path = value.get("path", "")
        if isinstance(path, str):
            p = path.strip()
            return p if p and ("/" in p or p.startswith("http") or p == "voice-note") else None
    return None


def _get_document_id(value) -> Optional[str]:
    if isinstance(value, dict):
        return value.get("document_id") or None
    return None


def _get_file_name(value) -> Optional[str]:
    if isinstance(value, dict):
        return value.get("file_name") or None
    return None


def _is_file(value) -> bool:
    return _get_path(value) is not None


def _is_not_applicable(value) -> bool:
    if isinstance(value, dict):
        return bool(value.get("not_applicable")) or value.get("status") == "NOT_APPLICABLE"
    return False


def _is_accounted(value) -> bool:
    """True if the investigator resolved this step — file submitted, or
    explicitly marked Not Applicable — so completion counting doesn't stay
    stuck below 100% forever on a legitimately-skipped doc."""
    return _is_file(value) or _is_not_applicable(value)


def _get_skip_reason(value) -> Optional[str]:
    if isinstance(value, dict):
        return value.get("skip_reason") or None
    return None


def _normalize_doc_key(label: str) -> str:
    key = label.lower()
    key = re.sub(r"[^a-z0-9]+", "_", key)
    key = key.strip("_")
    return key


def _find_form_val(form_data: dict, normalized_key: str):
    if normalized_key in form_data:
        return form_data[normalized_key]
    for k, v in form_data.items():
        if _normalize_doc_key(k) == normalized_key:
            return v
    return None


def _get_submission_for_entry(all_subs: dict, inv_type: str, user_id: str) -> dict:
    inv_subs = all_subs.get(inv_type, {})
    if not inv_subs:
        return {}
    if user_id and user_id in inv_subs:
        return inv_subs[user_id]
    return next(iter(inv_subs.values()), {})


def count_docs(claim: dict, all_subs: dict) -> dict:
    """Same shape/behavior as qc_review.py's _count_docs, generalized to
    iterate whatever inv_types are actually present on the claim."""
    total = submitted = 0
    inv = claim.get("investigations", {}) or {}
    for inv_type, entries in inv.items():
        for entry in entries or []:
            if not isinstance(entry, dict):
                continue

            assigned = entry.get("documents", [])
            assigned_keys = [_normalize_doc_key(d) for d in assigned]
            total += len(assigned_keys)

            user_id = entry.get("investigatorId", "")
            ts = _get_submission_for_entry(all_subs, inv_type, user_id)
            form_data = ts.get("form_data", {}) or entry.get("submission", {}).get("form_data", {}) or {}

            for dk in assigned_keys:
                if _is_accounted(_find_form_val(form_data, dk)):
                    submitted += 1

            for dk, fv in form_data.items():
                if dk not in assigned_keys and dk not in TEXT_KEYS and _is_accounted(fv):
                    total += 1
                    submitted += 1

    return {"total": total, "submitted": submitted}


def build_investigations(
    case_id: str,
    claim: dict,
    all_subs: dict,
    get_extracted_for_file=None,
) -> dict:
    """
    Same shape/behavior as qc_review.py's _build_investigations, generalized
    to iterate claim['investigations'].keys() instead of a hardcoded
    INV_TYPES list. `get_extracted_for_file(case_id, form_val) -> dict` is
    injectable so QC (which always has nothing to look up pre-parse — see
    the original's docstring) and any future caller with real extracted
    content can both use this without duplicating the loop.
    """
    if get_extracted_for_file is None:
        def get_extracted_for_file(_case_id, _form_val):
            return {"entities": [], "raw_markdown": None, "sections": None}

    inv_raw = claim.get("investigations", {}) or {}
    result: Dict[str, dict] = {}

    for inv_type, entries in inv_raw.items():
        if not entries:
            continue

        for entry in entries:
            if not isinstance(entry, dict):
                continue

            inv_name = entry.get("investigatorName") or entry.get("investigator") or "Unknown"
            user_id  = entry.get("investigatorId") or ""
            req_docs = entry.get("documents", [])
            if not isinstance(req_docs, list):
                req_docs = []
            req_docs = [_normalize_doc_key(d) for d in req_docs]

            ts       = _get_submission_for_entry(all_subs, inv_type, user_id)
            embedded = entry.get("submission") or {}

            if ts:
                form_data    = ts.get("form_data", {}) or {}
                submitted_at = ts.get("submitted_at")
                status       = ts.get("status", "PENDING")
            elif embedded:
                form_data    = embedded.get("form_data", {}) or {}
                submitted_at = embedded.get("submitted_at")
                status       = embedded.get("status", "PARTIAL")
            else:
                form_data    = {}
                submitted_at = None
                status       = "PENDING"

            docs_detail = []
            for dk in req_docs:
                form_val       = _find_form_val(form_data, dk)
                path           = _get_path(form_val)
                not_applicable = _is_not_applicable(form_val)
                skip_reason    = _get_skip_reason(form_val)
                doc_id         = _get_document_id(form_val)
                orig_name      = _get_file_name(form_val)
                extracted      = get_extracted_for_file(case_id, form_val) if path else {}

                docs_detail.append({
                    "key":            dk,
                    "label":          DOC_KEY_LABELS.get(dk, dk.replace("_", " ").title()),
                    "submitted":      bool(path),
                    "not_applicable": not_applicable,
                    "skip_reason":    skip_reason,
                    "path":           path,  # raw storage path/URL — display
                                              # callers (e.g. qc_review.py)
                                              # resolve this into a full
                                              # viewable file_url themselves;
                                              # this module has no
                                              # STORAGE_BASE concept
                    "file_name":      orig_name or (path.split("/")[-1] if path else None),
                    "document_id":    doc_id,
                    "entities":       extracted.get("entities", []),
                    "raw_markdown":   extracted.get("raw_markdown"),
                    "sections":       extracted.get("sections"),
                })

            text_fields = {k: v for k, v in form_data.items() if k in TEXT_KEYS and v}

            submission_out = None
            if form_data or status != "PENDING":
                submission_out = {
                    "status":       status,
                    "submitted_at": submitted_at,
                    "text_fields":  text_fields,
                }

            result[inv_type] = {
                "label":            label_for_inv_type(inv_type),
                "investigatorName": inv_name,
                "investigatorId":   user_id,
                "docs":             docs_detail,
                "submission":       submission_out,
            }

    return result


def compute_checklist_gaps(investigations: dict) -> List[dict]:
    """
    Deterministic [MISSING] flags derived purely from build_investigations()'s
    output — design decision #3's "never LLM-inferred" completeness check.
    A step marked not_applicable, or genuinely submitted, produces nothing;
    everything else is a programmatic gap the generator merges straight into
    its flags array (file_name/page_number are None since there is no
    source document for something that was never submitted).
    """
    gaps: List[dict] = []
    for inv_type, inv in (investigations or {}).items():
        for doc in inv.get("docs", []):
            if doc["submitted"] or doc["not_applicable"]:
                continue
            gaps.append({
                "inv_type":    inv_type,
                "step_key":    doc["key"],
                "label":       doc["label"],
                "category":    categorize_step(inv_type, doc["key"]),
                "tag":         "MISSING",
                "text": (
                    f"{doc['label']} was not collected for "
                    f"{inv.get('label', label_for_inv_type(inv_type))} "
                    f"({inv.get('investigatorName', 'investigator')}) and is not marked Not Applicable."
                ),
                "file_name":   None,
                "page_number": None,
            })
    return gaps