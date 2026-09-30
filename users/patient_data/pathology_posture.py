# pathology_posture.py — Deterministic clinical posture for the Onco-Pathology engines
# ─────────────────────────────────────────────────────────────────────────────
# WHAT THIS FILE IS
# -----------------
# The deterministic half of the pathology advisory system. It answers, in plain
# Python, the questions a language model must never be left to guess:
#
#   • Has this patient had any treatment, and was any of it before this specimen?
#   • Which modality, at what dose, with what recorded intent?
#   • Did the radiotherapy plan target this specimen's site, or list it as an
#     organ at risk?
#   • Which imaging is actually on record?
#
# The advisory engines receive the result as established fact and are instructed
# not to re-derive or contradict it. That separation is the whole point: it is
# what makes the output auditable rather than a black box.
#
# Mirrors the stance of components/onco-pathology/shared/capValidation.js —
# deterministic, pure, and deliberately sitting apart from the AI path.
#
# PURITY
# ------
# No LLM, no Mongo, no HTTP, no env reads, no clock reads. Everything is passed
# in, including `now`. Safe to reason about and, in principle, to test.
#
# THE DATA-VOLUME INVARIANT
# -------------------------
# Raw clinical sources are ~300KB per patient. One radiology entry carries the
# same report four times (`raw_markdown`, `parameterwise_markdown`,
# `sections.sections[].content`, `parameterwise_content[].content`), and every
# surgery treatment row carries a 4000-character operative summary in `details`.
#
#   Raw data is read transiently. Only derived facts are returned.
#
# Nothing in the output holds a narrative, a report body, an operative summary or
# a `details` list. Every list is capped. The result is intended to persist on the
# case document at a size in the tens of KB.
#
# WHAT THIS FILE DELIBERATELY DOES NOT DO
# ---------------------------------------
#   • It does not parse imaging report narratives. Body regions appear only inside
#     OCR'd text, so any coverage claim would be a guess dressed as a fact. It
#     lists which studies exist; `expected_spread_regions` sits beside that as
#     reference, and the PATHOLOGIST draws the comparison.
#   • It does not recommend an investigation, imaging study or test. That is a
#     clinical-governance decision, not an omission.
#   • It never turns missing data into a negative finding. See below.
#
# THE MOST IMPORTANT RULE
# -----------------------
# Absence of evidence is not evidence of absence. Treatment records that exist but
# carry neither a recorded intent nor a parseable date yield
# `treatment_status="unknown"` and `therapy_before_specimen=None` — never
# "treatment_naive"/False. This mirrors the module's existing refusal to convert
# absent metastasis data into M0.
# ─────────────────────────────────────────────────────────────────────────────

from datetime import datetime
from typing import Any, Dict, List, Optional

from users.patient_data.pathology_guidelines import (
    canonical_sites,
    spread_pattern_for,
)

POSTURE_VERSION = "1.0.0"

# Caps. The posture is persisted and prompted, so every list is bounded.
_MAX_TREATMENTS = 25
_MAX_IMAGING = 30
_MAX_LIST = 15
_MAX_GAPS = 20
_MAX_TEXT = 300

# `intent` is a first-class recorded field on both the radiotherapy record
# (`common.treatment.intent`) and the chemotherapy record
# (`regimen.treatmentIntent`), surfaced by `_clinical_history_rows` as
# `row["intent"]`. Reading the label is far more reliable than inferring sequence
# from dates spread across four collections with four different date shapes.
_NEOADJUVANT_INTENT = ("neoadjuvant", "pre-operative", "preoperative", "induction")
_ADJUVANT_INTENT = ("adjuvant", "post-operative", "postoperative")
_ACTIVE_STATUS = ("active", "in progress", "in-progress", "ongoing", "started", "planned")

_DATE_FORMATS = ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d", "%d %b %Y", "%b %d %Y")


# ─── Small pure helpers ───────────────────────────────────────────────────────


def _text(value: Any, limit: int = _MAX_TEXT) -> str:
    out = str(value or "").strip()
    return out[:limit] if len(out) > limit else out


def _parse_date(value: Any) -> Optional[datetime]:
    """Best-effort date parse across the shapes these four collections use.

    Returns None rather than a guess. A None here never becomes a negative
    finding; it becomes a recorded data gap.
    """
    if isinstance(value, datetime):
        return value
    raw = str(value or "").strip()
    if not raw:
        return None
    cleaned = raw.replace("Z", "").replace("z", "")
    try:
        return datetime.fromisoformat(cleaned)
    except ValueError:
        pass
    # `2026-07-30T05: 20: 54` — the shell-dump shape seen in radio_db samples.
    compact = cleaned.replace(" ", "")
    try:
        return datetime.fromisoformat(compact)
    except ValueError:
        pass
    head = cleaned.split("T")[0].strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(head, fmt)
        except ValueError:
            continue
    return None


def _matches(text: Any, needles) -> bool:
    lowered = str(text or "").lower()
    return any(needle in lowered for needle in needles)


def _is_neoadjuvant(intent: Any) -> bool:
    """True for neoadjuvant-family intent. Checked before adjuvant, because
    'neoadjuvant' contains 'adjuvant' as a substring."""
    return _matches(intent, _NEOADJUVANT_INTENT)


def _names(items: Any, *keys: str) -> List[str]:
    """Non-empty values at any of `keys` across a list of dicts."""
    out = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        for key in keys:
            value = _text(item.get(key), 120)
            if value:
                out.append(value)
                break
    return out[:_MAX_LIST]


def _latest(records: Any) -> Dict[str, Any]:
    """First dict in a newest-first record list. The callers already sort."""
    for record in records or []:
        if isinstance(record, dict):
            return record
    return {}


# ─── Radiotherapy ─────────────────────────────────────────────────────────────


def _radiotherapy_facts(collected: Dict[str, Any], specimen_sites: List[str]) -> Dict[str, Any]:
    """Target volumes, organs at risk, and whether this specimen's site is among
    either. Both come from structured clinician-entered names — never OCR'd text.

    The two flags are clinically distinct and must not be collapsed:
      • in a target volume  → the tumour was deliberately irradiated there
      • on the organs-at-risk list → the organ took incidental dose
    Either supports therapy-related change in the differential, and they carry
    different weight, so both are reported.
    """
    radiotherapy = _latest(collected.get("radiotherapy_records"))
    rt_details = _latest(collected.get("rt_details_records"))

    rt_data = radiotherapy.get("data") or {}
    intent_block = rt_data.get("intent") or {}
    summary_block = rt_data.get("summary") or {}
    treatment_block = rt_data.get("treatment") or {}

    common = rt_details.get("common") or {}
    detail_treatment = common.get("treatment") or {}
    ebrt = rt_details.get("ebrt") or {}
    simulations = [s for s in (ebrt.get("simulationSets") or []) if isinstance(s, dict)]
    simulation = simulations[0] if simulations else {}
    procedure = ebrt.get("procedure") or {}

    target_volumes = _names(intent_block.get("targetVolumes"), "volumeName")
    organs_at_risk = [
        {
            "organ": _text(organ.get("organName"), 120),
            "max_dose_gy": _text(organ.get("maxDoseGy"), 40),
            "mean_dose_gy": _text(organ.get("meanDoseGy"), 40),
        }
        for organ in (intent_block.get("organsAtRisk") or [])[:_MAX_LIST]
        if isinstance(organ, dict) and _text(organ.get("organName"), 120)
    ]
    organ_names = [organ["organ"] for organ in organs_at_risk]

    adverse = _names(ebrt.get("adverseEvents"), "event")
    adverse += _names(summary_block.get("toxicities"), "toxicity")

    dose = (
        _text(summary_block.get("totalDoseDeliveredGy"), 40)
        or _text(simulation.get("totalDose"), 40)
        or _text(treatment_block.get("totalDose"), 40)
    )

    recorded_intent = (
        _text(detail_treatment.get("intent"), 80)
        or _text(intent_block.get("treatmentIntent"), 80)
    )

    # Site overlap. `canonical_sites` returning [] on either side means the
    # question cannot be answered — which is None, never False. A false negative
    # here would let the model wave away radiation change.
    specimen_keys = set(canonical_sites(specimen_sites))
    target_keys = set(canonical_sites(target_volumes))
    organ_keys = set(canonical_sites(organ_names))

    in_target: Optional[bool] = None
    on_oar: Optional[bool] = None
    basis_parts: List[str] = []

    if not specimen_keys:
        basis_parts.append("no recognisable specimen anatomic site recorded")
    else:
        if target_volumes:
            shared = specimen_keys & target_keys
            in_target = bool(shared)
            basis_parts.append(
                f"specimen site matches target volume on {', '.join(sorted(shared))}"
                if shared else
                f"specimen site ({', '.join(sorted(specimen_keys))}) not among target volumes "
                f"({', '.join(target_volumes)})"
            )
        else:
            basis_parts.append("no radiotherapy target volume recorded")
        if organ_names:
            shared_organ = specimen_keys & organ_keys
            on_oar = bool(shared_organ)
            basis_parts.append(
                f"specimen site listed as an organ at risk ({', '.join(sorted(shared_organ))})"
                if shared_organ else
                "specimen site not on the organs-at-risk list"
            )
        else:
            basis_parts.append("no organs-at-risk list recorded")

    has_rt = bool(
        radiotherapy or rt_details or target_volumes or organ_names or dose or recorded_intent
    )
    return {
        "recorded": has_rt,
        "recorded_intent": recorded_intent,
        "rt_role": _text(detail_treatment.get("rtRole"), 120),
        "rt_type": _text(detail_treatment.get("rtType") or treatment_block.get("treatmentType"), 80),
        "dose": dose,
        "technique": _text(procedure.get("technique") or treatment_block.get("treatmentType"), 80),
        "target_volumes": target_volumes,
        "organs_at_risk": organs_at_risk,
        "adverse_events": adverse[:_MAX_LIST],
        "specimen_site_in_target_volume": in_target,
        "specimen_site_on_organs_at_risk": on_oar,
        "field_overlap_basis": _text("; ".join(basis_parts), 400),
        # Concurrent chemotherapy is recorded inside the RT record too, giving a
        # second independent source for systemic exposure.
        "concurrent_systemic_therapy": _text(
            (common.get("systemicTherapy") or {}).get("regimen")
            or procedure.get("systemicTherapy"),
            200,
        ),
    }


# ─── Chemotherapy ─────────────────────────────────────────────────────────────


def _chemotherapy_facts(collected: Dict[str, Any]) -> Dict[str, Any]:
    """Protocol, drugs, intent and residual toxicity. Same cycle-selection rule as
    `_chemo_treatment_row`: the current cycle, else the highest-numbered one."""
    record = _latest(collected.get("chemo_records"))
    data = record.get("data") or {}
    treatment = record.get("treatment") or data.get("treatment") or {}
    cycles = data.get("cycles") if isinstance(data.get("cycles"), dict) else {}

    cycle = cycles.get(str(treatment.get("currentCycle") or "")) or {}
    if not cycle and cycles:
        cycle = cycles.get(sorted(cycles.keys())[-1]) or {}
    regimen = cycle.get("regimen") or {}
    completion = data.get("completion") or {}

    drugs = _names(regimen.get("drugs"), "name")
    current = _text(treatment.get("currentCycle"), 20)
    planned = _text(treatment.get("plannedCycles"), 20)

    rt_details = _latest(collected.get("rt_details_records"))
    systemic = (rt_details.get("common") or {}).get("systemicTherapy") or {}

    has_chemo = bool(record or drugs or regimen.get("selectedProtocol") or systemic.get("regimen"))
    return {
        "recorded": has_chemo,
        "protocol": _text(regimen.get("selectedProtocol") or systemic.get("regimen"), 200),
        "drugs": drugs or [d for d in [_text(systemic.get("drugs"), 200)] if d],
        "recorded_intent": _text(regimen.get("treatmentIntent"), 80),
        "chemo_type": _text(regimen.get("chemoType"), 80),
        "cycles": f"{current} of {planned}" if current and planned else current,
        "residual_toxicity": _text(
            completion.get("residualToxicity") or systemic.get("toxicityRemarks"), 200
        ),
        "concurrent_with_radiotherapy": bool(systemic.get("regimen") or systemic.get("drugs")),
    }


# ─── Imaging ──────────────────────────────────────────────────────────────────


def _imaging_on_record(collected: Dict[str, Any]) -> tuple:
    """Radiology studies as a flat list of facts, with no report text.

    Two things this gets right that the compacted feed cannot:
      • `found` distinguishes ORDERED from REPORTED. A PET-CT ordered with no
        report on file is a documentation gap, not imaging coverage.
      • `parameterwise_content[].date` is the real study date and differs from
        `date_of_order`; its `date_confidence` is carried through rather than the
        date being presented as certain.

    Deliberately derives NO body-region coverage — regions exist only inside the
    OCR'd narrative, so any claim would be a guess. Returns (studies, gaps).
    """
    studies: List[Dict[str, Any]] = []
    gaps: List[str] = []

    for item in collected.get("investigations_raw") or []:
        if not isinstance(item, dict):
            continue
        if not str(item.get("investigation") or "").lower().startswith("radiology_"):
            continue
        ordered_on = _text(item.get("date_of_order"), 40)
        reported = {
            _text(entry.get("parameter_name"), 120): entry
            for entry in (item.get("parameterwise_content") or [])
            if isinstance(entry, dict)
        }
        for modality in (item.get("parameters") or [])[:_MAX_LIST]:
            name = _text(modality, 120)
            if not name:
                continue
            entry = reported.get(name) or {}
            found = bool(entry.get("found"))
            studies.append({
                "modality": name,
                "found": found,
                "date": _text(entry.get("date"), 40) if found else ordered_on,
                "date_basis": "study date" if found else "order date",
                "date_confidence": _text(entry.get("date_confidence"), 20) if found else "",
                "note": "" if found else "ordered, no report on record",
            })
            if not found:
                gaps.append(f"{name} was ordered but no report is on record")

    studies.sort(key=lambda s: (bool(s["date"]), str(s["date"])), reverse=True)
    return studies[:_MAX_IMAGING], gaps[:_MAX_LIST]


# ─── Treatment sequencing ─────────────────────────────────────────────────────


def _specimen_reference_date(case_register: Dict[str, Any]) -> tuple:
    """Earliest specimen collection date — the pivot every sequencing question
    turns on. Falls back to receipt date, then reports a gap."""
    candidates = []
    for specimen in (case_register.get("specimens") or []):
        if not isinstance(specimen, dict):
            continue
        for key in ("collection_datetime", "received_datetime"):
            parsed = _parse_date(specimen.get(key))
            if parsed:
                candidates.append(parsed)
                break
    if not candidates:
        return None, "no specimen collection or receipt date recorded"
    return min(candidates), ""


def _sequence_treatments(treatments: List[Dict[str, Any]], reference: Optional[datetime]) -> tuple:
    """Per-treatment sequencing plus the case-level verdict.

    Recorded intent outranks date arithmetic: an RT record whose intent reads
    'Neoadjuvant' establishes pre-specimen therapy even when no date parses.
    """
    rows: List[Dict[str, Any]] = []
    any_dated_before = False
    any_neoadjuvant = False
    any_active = False
    any_dated = False

    for row in treatments[:_MAX_TREATMENTS]:
        if not isinstance(row, dict):
            continue
        intent = _text(row.get("intent"), 80)
        status = _text(row.get("status"), 80)
        parsed = _parse_date(row.get("date"))
        neoadjuvant = _is_neoadjuvant(intent)
        precedes: Optional[bool] = None
        if parsed and reference:
            precedes = parsed < reference
            any_dated = True
            if precedes:
                any_dated_before = True
        elif neoadjuvant:
            precedes = True
        if neoadjuvant:
            any_neoadjuvant = True
        if _matches(status, _ACTIVE_STATUS):
            any_active = True
        rows.append({
            "treatment_type": _text(row.get("treatment_type"), 60),
            "intent": intent,
            "date": _text(row.get("date"), 40),
            "status": status,
            # A short joined line. `details` — which carries 4000-character
            # operative summaries — is deliberately dropped.
            "summary": _text(row.get("summary"), 300),
            "precedes_specimen": precedes,
        })

    if not rows:
        return rows, False, "none", "treatment_naive", (
            "no chemotherapy, radiotherapy or surgical record found for this patient"
        )

    if any_neoadjuvant and any_dated_before:
        before, basis = True, "both"
    elif any_neoadjuvant:
        before, basis = True, "recorded_intent"
    elif any_dated_before:
        before, basis = True, "dates"
    elif any_dated:
        before, basis = False, "dates"
    else:
        # Records exist but nothing establishes order. NOT naive, NOT false.
        before, basis = None, "none"

    if any_active:
        status_value = "on_treatment"
        status_basis = "a treatment record is recorded as active or in progress"
    elif basis == "none":
        status_value = "unknown"
        status_basis = (
            "treatment records exist but carry neither a recorded intent nor a parseable "
            "date, so their timing relative to this specimen cannot be established"
        )
    elif before is False:
        # The patient has been treated, but not before this specimen was taken —
        # typical of a diagnostic biopsy that preceded therapy. Both facts matter
        # and must not be collapsed: the case is post-treatment, the SPECIMEN is not.
        status_value = "post_treatment"
        status_basis = (
            "treatment is recorded but all of it is dated after this specimen was taken, "
            "so this specimen itself is treatment-naive"
        )
    else:
        status_value = "post_treatment"
        status_basis = f"treatment recorded before this specimen, established from {basis.replace('_', ' ')}"

    return rows, before, basis, status_value, status_basis


# ─── Entry point ──────────────────────────────────────────────────────────────


def derive_clinical_posture(
    history_rows: Dict[str, Any],
    collected: Dict[str, Any],
    case_register: Dict[str, Any],
    site_key: str,
    now: datetime,
) -> Dict[str, Any]:
    """The deterministic clinical posture for one pathology case.

    `history_rows` is the existing `_clinical_history_rows(collected)` output —
    reused rather than reimplemented. Only its small per-row fields are read;
    `details` is never touched.

    Everything returned is a fact with a stated basis, or an explicit null with a
    recorded gap. Nothing here is a suggestion, and nothing names a test.
    """
    history_rows = history_rows or {}
    collected = collected or {}
    case_register = case_register or {}

    specimen_sites = []
    for specimen in (case_register.get("specimens") or []):
        if isinstance(specimen, dict):
            specimen_sites.extend([
                specimen.get("anatomic_site"), specimen.get("sub_site"),
                specimen.get("specimen_type"), specimen.get("procedure"),
            ])

    reference_date, reference_gap = _specimen_reference_date(case_register)
    treatments, before, sequencing_basis, status_value, status_basis = _sequence_treatments(
        [row for row in (history_rows.get("treatments") or []) if isinstance(row, dict)],
        reference_date,
    )

    radiotherapy = _radiotherapy_facts(collected, specimen_sites)
    chemotherapy = _chemotherapy_facts(collected)
    imaging, imaging_gaps = _imaging_on_record(collected)
    pattern = spread_pattern_for(site_key)

    modalities = sorted({
        row["treatment_type"] for row in treatments
        if row["treatment_type"] and row.get("precedes_specimen") is True
    })

    gaps: List[str] = []
    if reference_gap:
        gaps.append(reference_gap)
    if before is None and treatments:
        gaps.append(
            "whether any treatment preceded this specimen could not be determined; "
            "treat the sequencing as unknown rather than assuming a naive specimen"
        )
    if radiotherapy["recorded"] and radiotherapy["specimen_site_in_target_volume"] is None:
        gaps.append(
            "the relationship between this specimen's site and the radiotherapy field "
            "is undetermined"
        )
    if not collected.get("investigations_raw"):
        gaps.append("no completed investigation records were available")
    gaps.extend(imaging_gaps)
    for warning in (collected.get("warnings") or [])[:_MAX_LIST]:
        if isinstance(warning, dict) and warning.get("source"):
            gaps.append(f"clinical source '{warning.get('source')}' could not be read")

    treatment_effect_required = before is True
    return {
        "posture_version": POSTURE_VERSION,
        "derived_at": now.isoformat(),
        "site_key": site_key,
        "specimen_reference_date": reference_date.isoformat() if reference_date else "",

        # Case-level verdict, always with its basis.
        "treatment_status": status_value,
        "treatment_status_basis": _text(status_basis, 400),
        "therapy_before_specimen": before,
        "sequencing_basis": sequencing_basis,
        "modalities_before_specimen": modalities,
        "prior_treatments": treatments,

        "radiotherapy": radiotherapy,
        "chemotherapy": chemotherapy,

        # Studies on record. No coverage claim is made or implied.
        "imaging_on_record": imaging,

        # Reference only — the pathologist compares this against the imaging list.
        # Nothing here computes that comparison or recommends an investigation.
        "expected_spread_regions": pattern.get("expected_spread_regions") or [],
        "regional_nodes": pattern.get("regional_nodes") or "",
        "direct_extension": pattern.get("direct_extension") or [],
        "common_metastatic_sites": pattern.get("common_metastatic_sites") or [],

        "treatment_effect_required": treatment_effect_required,
        "treatment_effect_framework": pattern.get("treatment_effect_framework") or "",
        "staging_prefix_expected": "y" if treatment_effect_required else "",

        "data_gaps": list(dict.fromkeys(gaps))[:_MAX_GAPS],
    }
