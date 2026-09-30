"""
data_sources.py — Reference-only reads from the radiotherapy databases.

Live async Motor reads from the two collections used in the workflow. NEVER writes.

  * rt-record-details    → the EBRT record (Rt_record shape)
  * radiotherapy_records → the RT workflow record (RadiotherapyRecord shape)
  * onco_pathology       → the surgical-pathology report (read-only; keyed by
    `patient_id`), the authoritative source for histology / grade / stage / margins /
    nodes / LVI-PNI. `resolve_pathology()` flattens it for the pathology-aware agents.
  * patient_summary      → the AI "Clinical Summary" the RadiotherapyRecord tab renders
    (read-only; keyed by `patient_id`, newest by `generated_at`; body under
    `summary.paragraphs[]`). Feeds Module 09's Consultation Summary.
  * tumorBoardPlan       → the "Tumor Board / MDT Plan" the Common-data-elements tab
    shows (read-only; keyed by `patient_id`, newest by `created_at`). Feeds Module 09's
    Tumor Board Summary; `rt-record-details.common.tumorBoard` is only an ad-hoc mirror.
  * chemotherapy_records → the authoritative systemic-therapy record (read-only; keyed by
    `patientId`, newest by `updatedAt`). `resolve_chemotherapy()` flattens the latest
    record's regimen / cycle progress / allergy-toxicity-organ safety profile / tumor-board
    question for Module 11's multidisciplinary rows.

Configure with MONGO_URI (required; RT_MONGO_URI also accepted as an override) and,
optionally, MONGO_DB / RT_MONGO_DB / RT_EBRT_COLLECTION / RT_WORKFLOW_COLLECTION /
RT_PATHOLOGY_COLLECTION / RT_SUMMARY_COLLECTION / RT_TUMOR_BOARD_COLLECTION /
RT_CHEMO_COLLECTION.

History walk
------------
On radiotherapy_records the latest flattened section is often nulled while the real
values live in earlier data.history.<stage>[] snapshots. `coalesce_history()` merges
newest→oldest so a consumer always sees the most recent POPULATED value without ever
mutating the stored document.
"""

from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Optional


# ── shared Mongo handle ─────────────────────────────────────────────────────
_client_singleton = None  # created lazily inside the running event loop


def get_mongo_db():
    """
    Return the shared AsyncIOMotorDatabase.

    Reads the same connection env the rest of the app uses (`MONGO_URI` / `MONGO_DB`);
    the `RT_`-prefixed names are optional overrides if this package ever needs to point
    at a different cluster/db. One of the two URI vars MUST be set — there is no mock
    fallback; this platform reads only from the live radiotherapy databases.
    """
    global _client_singleton
    uri = os.getenv("RT_MONGO_URI") or os.getenv("MONGO_URI")
    if not uri:
        raise RuntimeError(
            "No Mongo URI configured. Set MONGO_URI (or RT_MONGO_URI). This platform "
            "reads only from the live radiotherapy databases "
            "(rt-record-details, radiotherapy_records)."
        )
    if _client_singleton is None:
        from motor.motor_asyncio import AsyncIOMotorClient  # lazy import

        _client_singleton = AsyncIOMotorClient(uri)
    db_name = os.getenv("RT_MONGO_DB") or os.getenv("MONGO_DB") or "doctorassistai"
    return _client_singleton[db_name]


# ── helpers ─────────────────────────────────────────────────────────────────
def _is_empty(value: Any) -> bool:
    """True for None / '' / [] / {} — the shapes a nulled section takes."""
    if value is None:
        return True
    if isinstance(value, (str, list, dict)) and len(value) == 0:
        return True
    return False


def _is_blank(value: Any) -> bool:
    """
    True when a value carries no information, looking *inside* containers — None,
    whitespace-only strings, empty/all-blank lists, and dicts whose leaves are all
    blank (e.g. a form-seeded ``completion:{rtCompletion:'', clinResponse:''}``).

    Unlike ``_is_empty`` (which only sees a structurally empty container), this treats
    a present-but-unfilled nested object as blank, so it can never win the merge
    against a populated copy layered up from history. Numbers and booleans — including
    ``0`` and ``False`` — are real values and are never blank.
    """
    if value is None:
        return True
    if isinstance(value, str):
        return len(value.strip()) == 0
    if isinstance(value, dict):
        return all(_is_blank(v) for v in value.values())
    if isinstance(value, list):
        return all(_is_blank(v) for v in value)
    return False


def _deep_merge(base: Any, incoming: Any) -> Any:
    """
    Layer ``incoming`` (newer) onto ``base`` (older), recursing into nested dicts so a
    present-but-blank nested object never erases a populated copy from an older layer.
    For lists and scalars the newer value wins unless it is blank, in which case the
    older value is kept. This is what lets a stage whose *current* top-level object was
    saved blank still surface the real values wrapped in ``history.<stage>[].data``.
    """
    if isinstance(base, dict) and isinstance(incoming, dict):
        out = dict(base)
        for key, value in incoming.items():
            if key in out:
                out[key] = _deep_merge(out[key], value)
            else:
                out[key] = value
        return out
    if _is_blank(incoming):
        return base
    return incoming


def coalesce_history(record: Dict[str, Any], stage: str) -> Dict[str, Any]:
    """
    Return the most recent POPULATED snapshot for a stage, layering the flattened
    top-level copy over older history entries. Newest source wins per key, but a
    nulled newer value never clobbers a populated older one.

    The merge is *deep*: a nested object (``completion``, ``followUp``, ``procedure``,
    …) saved blank on the current stage no longer overwrites a populated copy from an
    earlier ``history.<stage>[].data`` snapshot — the populated leaves survive.
    """
    layers: List[Dict[str, Any]] = []

    # 1. history snapshots, oldest → newest
    history = (record.get("history") or {}).get(stage) or []
    for snap in history:
        data = snap.get("data") if isinstance(snap, dict) else None
        if isinstance(data, dict) and data:
            layers.append(data)

    # 2. flattened top-level copy is treated as newest
    flat = record.get(stage)
    if isinstance(flat, dict) and flat:
        layers.append(flat)

    merged: Dict[str, Any] = {}
    for layer in layers:  # newest last → deep-merge in order, blank never clobbers
        merged = _deep_merge(merged, layer)
    return merged


# ── modality-aware delivery resolution ───────────────────────────────────────
# A course is delivered either as EBRT or brachytherapy. Both write their delivery
# summary into `data.sessions`, but under DIFFERENT keys: EBRT uses the bare names,
# brachytherapy uses `brachy`-prefixed ones. `resolve_delivery()` collapses whichever
# course was actually delivered into ONE shape so every agent/header reads a single
# set of keys instead of hard-coding the EBRT names (which silently blanked brachy
# patients). The per-fraction calendar (`treatmentSessions[]`) is EBRT-only.
_EBRT_DELIVERY_KEYS = {
    "startDate": "startDate",
    "endDate": "endDate",
    "totalSessionsDelivered": "totalSessionsDelivered",
    "totalDoseDeliveredGy": "totalDoseDeliveredGy",
    "interruptions": "treatmentInterruptions",
}
_BRACHY_DELIVERY_KEYS = {
    "startDate": "brachyStartDate",
    "endDate": "brachyEndDate",
    "totalSessionsDelivered": "brachyTotalSessionsDelivered",
    "totalDoseDeliveredGy": "brachyTotalDoseDeliveredGy",
    "interruptions": "brachyTreatmentInterruptions",
}


def resolve_delivery(
    sessions_stage: Optional[Dict[str, Any]],
    treatment_stage: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Normalise the modality-specific delivery-summary keys under `data.sessions`.

    Returns a single shape regardless of modality::

        {"modality": "ebrt" | "brachy",
         "startDate", "endDate",
         "totalSessionsDelivered", "totalDoseDeliveredGy" (Gy),
         "interruptions": [{startDate, endDate, reason}, ...],
         "treatmentSessions": [...]}   # per-fraction calendar; EBRT-only, [] for brachy

    Modality is taken from `data.treatment.treatmentType`; when that is unset — or
    names EBRT while only the brachy keys carry data — it is inferred from whichever
    key-set is actually populated. Nothing is invented: absent values stay None/[]. A
    combined EBRT+brachy-boost course reports as EBRT (the primary external course).
    """
    sessions_stage = sessions_stage or {}
    treatment_stage = treatment_stage or {}
    tt = str(treatment_stage.get("treatmentType") or "").strip().lower()

    def _populated(keymap: Dict[str, str]) -> bool:
        return any(not _is_empty(sessions_stage.get(raw)) for raw in keymap.values())

    ebrt_has = (_populated(_EBRT_DELIVERY_KEYS)
                or not _is_empty(sessions_stage.get("treatmentSessions")))
    brachy_has = _populated(_BRACHY_DELIVERY_KEYS)

    if tt == "brachy" or (brachy_has and not ebrt_has):
        modality, keymap = "brachy", _BRACHY_DELIVERY_KEYS
    else:
        modality, keymap = "ebrt", _EBRT_DELIVERY_KEYS

    out: Dict[str, Any] = {"modality": modality}
    for norm, raw in keymap.items():
        out[norm] = sessions_stage.get(raw)
    out["interruptions"] = [i for i in (out.get("interruptions") or [])
                            if isinstance(i, dict)]
    out["treatmentSessions"] = ([s for s in (sessions_stage.get("treatmentSessions") or [])
                                 if isinstance(s, dict)] if modality == "ebrt" else [])
    return out


# ── modality-aware prescription resolution ───────────────────────────────────
# The prescribed dose / fractionation is entered in TWO places, in TWO units, depending
# on which UI wrote it:
#   * radiotherapy_records `data.treatment` — the workflow "Treatment Plan" tab. Dose in
#     **Gy** (totalDose, dosePerFraction, numFractions, treatmentType). This is the CURRENT
#     UI and, when present, the authoritative source.
#   * rt-record-details `ebrt.simulationSets[0]` — the legacy EBRT record. Dose in **cGy**
#     (totalDose, dosePerFrac, totalFractions, fracSched[+fracSchedOther], sibBoost, peerReview).
#   * rt-record-details `brachy.dosePrescription` — brachytherapy. Dose already in **Gy**
#     (totalDose, dosePerFraction, numberOfFractions, fractionationSchedule, prescriptionDose…).
# resolve_prescription() collapses whichever source actually carries the prescription into
# ONE Gy-normalised, modality-aware shape so every agent/header reads a single set of keys
# with the unit already correct — instead of each reading the sim set in cGy and blanking
# whenever the value was entered via the Treatment Plan tab (different collection, Gy not cGy).
_RX_NUM_RE = re.compile(r"-?\d+(?:\.\d+)?")


def _rx_num(value: Any) -> Optional[float]:
    """Leading number out of 3000 / '3000.0 cGy' / '30 Gy' → float; None if absent."""
    if value is None:
        return None
    m = _RX_NUM_RE.search(str(value))
    return float(m.group()) if m else None


def _rx_str(value: Any) -> str:
    """Trimmed string; empty for None/blank/none/null so callers can test truthiness."""
    text = str(value).strip() if value is not None else ""
    return "" if text.lower() in ("", "none", "null", "nil") else text


def resolve_prescription(
    wf_treatment: Optional[Dict[str, Any]],
    ebrt: Optional[Dict[str, Any]] = None,
    brachy: Optional[Dict[str, Any]] = None,
    common_treatment: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Normalise the prescribed dose / fractionation into ONE modality-aware, Gy-based shape.

    Source priority, per field (unit-correct):
      1. `data.treatment` — the workflow "Treatment Plan" tab (dose in Gy):
         totalDose, dosePerFraction, numFractions, treatmentType.
      2. `ebrt.simulationSets[0]` — legacy EBRT sim set (dose in cGy → ÷100):
         totalDose, dosePerFrac, totalFractions, fracSched(+fracSchedOther), sibBoost, peerReview.
      3. `brachy.dosePrescription` — brachytherapy (dose already Gy):
         totalDose, dosePerFraction, numberOfFractions, fractionationSchedule,
         prescriptionDose (free text), technique, prescriptionTarget.

    Modality comes from common.treatment.rtType, then data.treatment.treatmentType, then
    whichever section carries data (a combined course reports EBRT — the primary external
    course). Returns::

        {"modality": "ebrt" | "brachy", "source": "treatment" | "ebrt" | "brachy" | "",
         "total_gy": float | None, "per_gy": float | None, "n_fx": str,
         "schedule": str, "free_text": str,
         "sib_boost": str, "peer_review": str,   # EBRT sim-set extras
         "technique": str, "target": str}        # brachytherapy extras

    Nothing is invented; absent fields stay None/"". A missing per/total dose is derived
    from the other two when the fraction count is known. Doses are ALWAYS returned in Gy.
    """
    wt = wf_treatment or {}
    ebrt = ebrt or {}
    brachy = brachy or {}
    ct = common_treatment or {}

    sim_sets = ebrt.get("simulationSets") or []
    sim = sim_sets[0] if isinstance(sim_sets, list) and sim_sets else {}
    dp = brachy.get("dosePrescription") or {}

    rt_type = _rx_str(ct.get("rtType")).lower()
    wf_type = _rx_str(wt.get("treatmentType")).lower()

    # 1. Treatment Plan tab (Gy)
    t_total = _rx_num(wt.get("totalDose"))
    t_per = _rx_num(wt.get("dosePerFraction"))
    t_nfx = _rx_str(wt.get("numFractions"))
    t_has = t_total is not None or t_per is not None or bool(t_nfx)

    # 2. Legacy EBRT simulation set (cGy → Gy)
    s_total_cgy = _rx_num(sim.get("totalDose"))
    s_per_cgy = _rx_num(sim.get("dosePerFrac"))
    s_nfx = _rx_str(sim.get("totalFractions"))
    s_sched = _rx_str(sim.get("fracSched"))
    if s_sched.lower() == "others":
        s_sched = _rx_str(sim.get("fracSchedOther")) or s_sched
    s_has = (s_total_cgy is not None or s_per_cgy is not None
             or bool(s_nfx) or bool(s_sched))

    # 3. Brachytherapy dose prescription (Gy)
    b_total = _rx_num(dp.get("totalDose"))
    b_per = _rx_num(dp.get("dosePerFraction"))
    b_nfx = _rx_str(dp.get("numberOfFractions"))
    b_sched = _rx_str(dp.get("fractionationSchedule"))
    b_free = _rx_str(dp.get("prescriptionDose"))
    b_has = (b_total is not None or b_per is not None or bool(b_nfx)
             or bool(b_sched) or bool(b_free))

    ebrt_has = t_has or s_has
    is_brachy = ("brachy" in rt_type or wf_type == "brachy"
                 or (b_has and not ebrt_has))

    if is_brachy:
        total_gy = t_total if t_total is not None else b_total
        per_gy = t_per if t_per is not None else b_per
        n_fx = t_nfx or b_nfx
        schedule = b_sched
        free_text = b_free
        modality = "brachy"
        source = "treatment" if (t_total is not None or t_per is not None) else (
            "brachy" if b_has else ("treatment" if t_has else ""))
    else:
        s_total_gy = s_total_cgy / 100.0 if s_total_cgy is not None else None
        s_per_gy = s_per_cgy / 100.0 if s_per_cgy is not None else None
        total_gy = t_total if t_total is not None else s_total_gy
        per_gy = t_per if t_per is not None else s_per_gy
        n_fx = t_nfx or s_nfx
        schedule = s_sched
        free_text = ""
        modality = "ebrt"
        source = "treatment" if (t_total is not None or t_per is not None) else (
            "ebrt" if s_has else ("treatment" if t_has else ""))

    # Derive the missing third value when the other two are known.
    n_fx_num = _rx_num(n_fx)
    if per_gy is None and total_gy is not None and n_fx_num:
        per_gy = total_gy / n_fx_num
    if total_gy is None and per_gy is not None and n_fx_num:
        total_gy = per_gy * n_fx_num

    return {
        "modality": modality,
        "source": source,
        "total_gy": total_gy,
        "per_gy": per_gy,
        "n_fx": n_fx,
        "schedule": schedule,
        "free_text": free_text,
        "sib_boost": _rx_str(sim.get("sibBoost")),
        "peer_review": _rx_str(sim.get("peerReview")),
        "technique": _rx_str(dp.get("technique")),
        "target": _rx_str(dp.get("prescriptionTarget")),
    }


# ── surgical-pathology normalisation (onco_pathology) ─────────────────────────
# The pathology report is the authoritative source for histology / grade / stage /
# margins / nodes / LVI-PNI — richer and more structured than the histology snapshot
# echoed into the RT discharge summary. `resolve_pathology()` flattens the four report
# sections into ONE clean shape so agents read a single set of keys instead of walking
# case_register/grossing/synoptic/tnm.latest by hand. Nothing is invented: absent or
# not-assessed values are dropped, and `has_data` is False when nothing usable is present.
_PATH_NULLS = {
    "", "none", "null", "nil", "na", "n/a", "not specified", "not stated",
    "not applicable", "not assessed", "not reported", "cannot be assessed",
    "unknown", "-",
}


def _pclean(value: Any) -> str:
    """Trimmed string; empty for the null-ish / not-assessed tokens pathology uses."""
    text = str(value).strip() if value is not None else ""
    return "" if text.lower() in _PATH_NULLS else text


def _pnum(value: Any) -> Optional[float]:
    try:
        return float(str(value).strip())
    except (ValueError, TypeError):
        return None


def resolve_pathology(path_record: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Flatten an `onco_pathology` document into one clean, agent-friendly shape.

    The report has four sections:
      * case_register — accession + demographics + clinical indication
      * grossing      — macroscopic description, dimensions, margins, node count
      * synoptic      — the structured CAP-style report (grade, margins, nodes, LVI/PNI…)
      * tnm.latest    — computed AJCC stage (t/n/m, code, final stage, final diagnosis)

    `synoptic` is the authoritative structured source; `grossing` back-fills dimensions /
    margin distances / node counts; `tnm.latest` supplies staging. Returns primitives plus
    a few pre-composed convenience strings (`stage_display`, `nodes_summary`,
    `margin_summary`, `risk_features`). `has_data` is False when nothing usable is present.
    """
    rec = path_record or {}
    case = rec.get("case_register") or {}
    gross = rec.get("grossing") or {}
    syn = rec.get("synoptic") or {}
    tnm = ((rec.get("tnm") or {}).get("latest")) or {}

    def pick(*vals: Any) -> str:
        for v in vals:
            c = _pclean(v)
            if c:
                return c
        return ""

    histology = pick(syn.get("histologic_type"))
    grade = pick(syn.get("grade"), tnm.get("grade"))
    tumor_site = pick(syn.get("tumor_site"), gross.get("tumor_location"))
    depth = pick(syn.get("depth_of_invasion"))
    dimension = pick(syn.get("tumor_greatest_dimension_cm"),
                     gross.get("tumor_greatest_dimension"))

    t_stage = pick(tnm.get("t_stage"))
    n_stage = pick(tnm.get("n_stage"))
    m_stage = pick(tnm.get("m_stage"))
    tnm_code = pick(tnm.get("tnm_code"))
    final_stage = pick(tnm.get("final_stage"))
    # One human-readable stage string, e.g. "IVA (pT1 pN1b M1a)".
    composed = tnm_code or " ".join(x for x in (t_stage, n_stage, m_stage) if x)
    if final_stage and composed:
        stage_display = f"{final_stage} ({composed})"
    else:
        stage_display = final_stage or composed

    # Nodes: positive of examined.
    nodes_pos = pick(syn.get("positive_nodes"))
    nodes_exam = pick(syn.get("total_nodes_examined"), gross.get("total_lymph_nodes"))
    if nodes_pos and nodes_exam:
        nodes_summary = f"{nodes_pos}/{nodes_exam} nodes positive"
    elif nodes_exam:
        nodes_summary = f"{nodes_exam} nodes examined"
    else:
        nodes_summary = ""
    nodes_involved = bool(nodes_pos) and (_pnum(nodes_pos) or 0) > 0

    # Margins: keep each sampled margin's status + distance; flag involved ones.
    margins: List[Dict[str, str]] = []
    for label, st_key, dist_key, gross_dist in (
        ("Proximal", "proximal_margin_status",
         "proximal_margin_distance_cm", "proximal_margin"),
        ("Distal", "distal_margin_status",
         "distal_margin_distance_cm", "distal_margin"),
        ("Circumferential/radial", "circumferential_margin_status",
         "circumferential_margin_distance_cm", "radial_margin"),
    ):
        status = pick(syn.get(st_key))
        dist = pick(syn.get(dist_key), gross.get(gross_dist))
        if status:
            involved = "involv" in status.lower() or "positive" in status.lower()
            margins.append({"label": label, "status": status,
                            "distance_cm": dist, "involved": involved})
    involved = [m for m in margins if m["involved"]]
    if involved:
        margin_summary = "; ".join(
            f"{m['label']} involved" + (f" ({m['distance_cm']} cm)" if m["distance_cm"] else "")
            for m in involved)
    elif margins:
        margin_summary = "All sampled margins uninvolved"
    else:
        margin_summary = ""

    lvi = pick(syn.get("lymphovascular_invasion"))
    pni = pick(syn.get("perineural_invasion"))
    deposits = pick(syn.get("tumor_deposits"))
    risk_features: List[str] = []
    if "present" in lvi.lower():
        risk_features.append("LVI present")
    if "present" in pni.lower():
        risk_features.append("PNI present")
    if "present" in deposits.lower():
        dn = pick(syn.get("tumor_deposits_number"))
        risk_features.append(f"tumor deposits{f' ({dn})' if dn else ''}")

    out = {
        "accession_id": pick(rec.get("accession_id"), case.get("accession_id")),
        "histology": histology,
        "grade": grade,
        "tumor_site": tumor_site,
        "depth_of_invasion": depth,
        "tumor_dimension_cm": dimension,
        "t_stage": t_stage, "n_stage": n_stage, "m_stage": m_stage,
        "tnm_code": tnm_code, "final_stage": final_stage, "stage_display": stage_display,
        "nodes_positive": nodes_pos, "nodes_examined": nodes_exam,
        "nodes_summary": nodes_summary, "nodes_involved": nodes_involved,
        "margins": margins, "margin_summary": margin_summary,
        "margin_involved": bool(involved),
        "lvi": lvi, "pni": pni, "tumor_deposits": deposits,
        "risk_features": risk_features,
        "final_diagnosis": pick(tnm.get("final_diagnosis")),
        "ai_confidence": pick(tnm.get("ai_confidence")),
    }
    out["has_data"] = any([
        histology, grade, tumor_site, stage_display, depth, dimension,
        nodes_summary, margin_summary, risk_features, out["final_diagnosis"],
    ])
    return out


# ── systemic-therapy normalisation (chemotherapy_records) ─────────────────────
# chemotherapy_records is the authoritative systemic-therapy record — far richer than the
# RT record's single `ebrt.procedure.systemicTherapy` note. Its `data.cycles.<n>` carry the
# per-cycle regimen / pre-chemo safety check / post-chemo toxicity & organ-function data,
# and `data.assessment` mirrors the allergy + tumor-board context; `treatment` tracks cycle
# progress. resolve_chemotherapy() flattens the LATEST record into the few facts Module 11
# needs to coordinate the systemic arm with RT — regimen, cycle progress, allergy/toxicity/
# organ safety profile, and the tumor-board question. Nothing is invented; absent values are
# dropped and `has_data` is False when nothing usable is present.
_SEVERITY_RANK = {"mild": 1, "moderate": 2, "severe": 3, "life-threatening": 4}


def _cy_int(key: Any) -> int:
    """Numeric order for a cycle key ('1','2',…); unparseable keys sort first."""
    try:
        return int(str(key))
    except (ValueError, TypeError):
        return -1


def resolve_chemotherapy(chemo_record: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Flatten a `chemotherapy_records` document into one agent-friendly systemic-therapy shape.

    Layout: `data.cycles.<n>` (regimen / pre_chemo / post_chemo per cycle), `data.assessment`
    (diagnosis, allergies, tumor-board fields), and a top-level `treatment` progress block.
    We read the regimen from the newest populated cycle, aggregate valid toxicities across all
    cycles (worst grade kept), rank allergies by severity, surface the most-recent organ-
    function flags, and lift the tumor-board question/verdict. Returns primitives plus a few
    convenience flags (`severe_allergy`, `worst_tox_grade`, `concurrent_rt`). `has_data` is
    False when nothing usable is present.
    """
    rec = chemo_record or {}
    data = rec.get("data") or {}
    assessment = data.get("assessment") or {}
    treatment = rec.get("treatment") or {}

    # cycles: dict keyed by string ints; sort ascending so the newest is last.
    cycles_raw = data.get("cycles") or {}
    cycles = sorted(
        ((k, v) for k, v in cycles_raw.items() if isinstance(v, dict)),
        key=lambda kv: _cy_int(kv[0]),
    )
    latest = cycles[-1][1] if cycles else {}

    # Regimen: prefer the latest cycle's; fall back to the newest cycle that has one.
    regimen = latest.get("regimen") or {}
    if not regimen:
        for _, cyc in reversed(cycles):
            if cyc.get("regimen"):
                regimen = cyc["regimen"]
                break

    diagnosis = _rx_str(assessment.get("diagnosis"))
    intent = _rx_str(regimen.get("treatmentIntent"))
    protocol = _rx_str(regimen.get("selectedProtocol"))
    start_date = _rx_str(regimen.get("startDate"))
    reason_for_change = _rx_str(regimen.get("reasonForChange"))
    drugs = [_rx_str(d.get("name")) for d in (regimen.get("drugs") or [])
             if isinstance(d, dict) and _rx_str(d.get("name"))]

    # concurrentTherapy describes therapy given alongside the chemo; 'None' is emptied by
    # _rx_str. Flag concurrency with RT only when the note actually names radiation.
    concurrent_note = _rx_str(regimen.get("concurrentTherapy"))
    concurrent_rt = any(t in concurrent_note.lower() for t in
                        ("radiation", "radiotherap", "chemoradiation", "chemo-radiation", "crt"))

    # Cycle progress (NumberInt values come through as ints already).
    def _int(v: Any) -> Optional[int]:
        n = _rx_num(v)
        return int(n) if n is not None else None

    planned_cycles = _int(treatment.get("plannedCycles"))
    current_cycle = _int(treatment.get("currentCycle"))
    completed_cycles = _int(treatment.get("completedCycles"))
    treatment_status = _rx_str(treatment.get("status"))
    treatment_completed = bool(treatment.get("treatmentCompleted"))

    # Allergies (assessment mirrors the cycle-level list); rank by severity.
    allergies: List[Dict[str, str]] = []
    for a in (assessment.get("allergies") or []):
        if not isinstance(a, dict):
            continue
        drug = _rx_str(a.get("drug"))
        typ = _rx_str(a.get("type"))
        sev = _rx_str(a.get("severity"))
        if drug or typ:
            allergies.append({"drug": drug, "type": typ, "severity": sev})
    worst_allergy: Dict[str, str] = {}
    for a in allergies:
        if (not worst_allergy or _SEVERITY_RANK.get(a["severity"].lower(), 0)
                > _SEVERITY_RANK.get(worst_allergy["severity"].lower(), 0)):
            worst_allergy = a
    severe_allergy = _SEVERITY_RANK.get(worst_allergy.get("severity", "").lower(), 0) >= 3

    # Toxicities: aggregate valid (event+grade) entries across every cycle, worst grade kept.
    tox_seen = set()
    toxicities: List[Dict[str, str]] = []
    for _, cyc in cycles:
        for t in ((cyc.get("post_chemo") or {}).get("toxicities") or []):
            if not isinstance(t, dict):
                continue
            event = _rx_str(t.get("event"))
            grade = _rx_str(t.get("grade"))
            if not event or not grade:
                continue
            key = (event.lower(), grade)
            if key in tox_seen:
                continue
            tox_seen.add(key)
            toxicities.append({
                "event": event, "grade": grade,
                "system": _rx_str(t.get("system")),
                "attribution": _rx_str(t.get("attribution")),
                "onset": _rx_str(t.get("onset")),
            })
    grades = [int(_rx_num(t["grade"]) or 0) for t in toxicities]
    worst_tox_grade = max(grades) if grades else 0
    worst_tox_name = ""
    if worst_tox_grade:
        for t in toxicities:
            if int(_rx_num(t["grade"]) or 0) == worst_tox_grade:
                worst_tox_name = t["event"]
                break

    # Organ function: aggregate flags across every cycle (a system flagged in any cycle stays
    # clinically relevant), keeping the most-recent LVEF reading. Ordered cardiac→neuro→
    # pulmonary→audio for a stable display.
    cardiac = neuro = pulmonary = audio = False
    lvef = ""
    for _, cyc in cycles:  # ascending → later cycles overwrite the LVEF value
        pc = cyc.get("post_chemo") or {}
        v = _rx_str(pc.get("lvef"))
        if v:
            lvef = v
        if pc.get("organCardiac"):
            cardiac = True
        if pc.get("organNeuro") or _rx_str(pc.get("neuroAssessment")):
            neuro = True
        if pc.get("organPulmonary"):
            pulmonary = True
        if pc.get("organAudio"):
            audio = True
    organ_flags: List[str] = []
    if cardiac or lvef:
        organ_flags.append("cardiac" + (f" (LVEF {lvef}%)" if lvef else ""))
    if neuro:
        organ_flags.append("neurologic")
    if pulmonary:
        organ_flags.append("pulmonary")
    if audio:
        organ_flags.append("audiologic")

    # Pre-chemo safety sign-off (newest populated).
    safety_verified = False
    for _, cyc in reversed(cycles):
        sv = _rx_str((cyc.get("pre_chemo") or {}).get("safetyVerified"))
        if sv:
            safety_verified = sv.lower() in ("yes", "true", "verified", "y", "1", "done")
            break

    # Tumor-board context.
    tb_followed = _rx_str(assessment.get("tbFollowed"))
    tb_not_followed_reason = _rx_str(assessment.get("tbNotFollowedReason"))
    tb_question = _rx_str(assessment.get("tbQuestion"))
    tb_schedule = _rx_str(assessment.get("tbScheduleDate"))
    tb_reference = ""
    for _, cyc in reversed(cycles):
        ref = _rx_str((cyc.get("details") or {}).get("tumorBoardReference"))
        if ref:
            tb_reference = ref
            break

    regimen_label = protocol or (", ".join(drugs) if drugs else "")

    out = {
        "diagnosis": diagnosis,
        "intent": intent,
        "protocol": protocol,
        "drugs": drugs,
        "regimen_label": regimen_label,
        "concurrent_note": concurrent_note,
        "concurrent_rt": concurrent_rt,
        "planned_cycles": planned_cycles,
        "current_cycle": current_cycle,
        "completed_cycles": completed_cycles,
        "treatment_status": treatment_status,
        "treatment_completed": treatment_completed,
        "start_date": start_date,
        "reason_for_change": reason_for_change,
        "allergies": allergies,
        "worst_allergy": worst_allergy,
        "severe_allergy": severe_allergy,
        "toxicities": toxicities,
        "worst_tox_grade": worst_tox_grade,
        "worst_tox_name": worst_tox_name,
        "organ_flags": organ_flags,
        "safety_verified": safety_verified,
        "tb_followed": tb_followed,
        "tb_not_followed_reason": tb_not_followed_reason,
        "tb_question": tb_question,
        "tb_schedule": tb_schedule,
        "tb_reference": tb_reference,
        "updated_at": str(rec.get("updatedAt") or ""),
    }
    out["has_data"] = any([
        protocol, drugs, diagnosis, toxicities, allergies, tb_question, treatment_status,
    ])
    return out


# ── data source ─────────────────────────────────────────────────────────────
class MongoRTDataSource:
    """Live async reads via Motor. Read-only: no update/insert methods exist here."""

    def __init__(self, uri: Optional[str] = None, db_name: Optional[str] = None):
        self._db = get_mongo_db()
        self._ebrt_coll = os.getenv("RT_EBRT_COLLECTION", "rt-record-details")
        self._workflow_coll = os.getenv("RT_WORKFLOW_COLLECTION", "radiotherapy_records")
        self._pathology_coll = os.getenv("RT_PATHOLOGY_COLLECTION", "onco_pathology")
        self._summary_coll = os.getenv("RT_SUMMARY_COLLECTION", "patient_summary")
        self._tumor_board_coll = os.getenv("RT_TUMOR_BOARD_COLLECTION", "tumorBoardPlan")
        self._chemo_coll = os.getenv("RT_CHEMO_COLLECTION", "chemotherapy_records")

    @staticmethod
    def _activity_key(doc: Dict[str, Any]) -> tuple:
        """
        A sortable recency key for one record — the most-recently-touched course.

        The rt collections carry NO reliable top-level `updatedAt`; the real
        timestamps live inside `history.<stage>[].savedAt` (and are sometimes
        written in a spaced `HH: MM: SS` form). Derive recency from the newest
        stamp actually present — top-level updatedAt/createdAt if any, else the
        newest history `savedAt` — with the ObjectId's generation time as a
        final tiebreaker. Never raises; a doc with no stamps sorts oldest.
        """
        stamps: List[str] = []
        for k in ("updatedAt", "createdAt"):
            v = doc.get(k)
            if isinstance(v, str) and v:
                stamps.append(v)
        history = doc.get("history")
        if isinstance(history, dict):
            for arr in history.values():
                if isinstance(arr, list):
                    for snap in arr:
                        if isinstance(snap, dict):
                            s = snap.get("savedAt")
                            if isinstance(s, str) and s:
                                stamps.append(s)
        # Normalise the spaced 'HH: MM: SS' form so ISO strings compare lexically.
        newest = max((s.replace(" ", "") for s in stamps), default="")
        try:
            gen = doc["_id"].generation_time.isoformat()
        except (KeyError, AttributeError):
            gen = ""
        return (newest, gen)

    async def _latest_for_patient(
        self, coll_name: str, patient_id: Optional[str]
    ) -> Dict[str, Any]:
        """
        Return the patient's most-recently-touched document from `coll_name`.

        A patient may hold several records (one per treatment course; the API
        returns them as `past_records`). Selecting with a plain
        `find_one(sort=[("updatedAt", -1)])` is unsafe here because these docs
        have no `updatedAt` — Mongo then returns an arbitrary (often empty/older)
        course. Instead, read the patient's candidates and pick the newest by
        `_activity_key`. Read-only; never mutates.
        """
        coll = self._db[coll_name]
        if not patient_id:
            doc = await coll.find_one({}, sort=[("_id", -1)])
            return doc or {}
        docs = await coll.find({"patientId": patient_id}).to_list(length=100)
        if not docs:
            return {}
        if len(docs) == 1:
            return docs[0]
        return max(docs, key=self._activity_key)

    async def get_ebrt_record(self, patient_id: Optional[str]) -> Dict[str, Any]:
        return await self._latest_for_patient(self._ebrt_coll, patient_id)

    async def get_workflow_record(self, patient_id: Optional[str]) -> Dict[str, Any]:
        return await self._latest_for_patient(self._workflow_coll, patient_id)

    async def get_pathology_record(self, patient_id: Optional[str]) -> Dict[str, Any]:
        # onco_pathology keys the patient with snake_case `patient_id` and timestamps
        # with `updated_at` (unlike the RT collections' patientId/updatedAt). Read-only.
        query = {"patient_id": patient_id} if patient_id else {}
        doc = await self._db[self._pathology_coll].find_one(query, sort=[("updated_at", -1)])
        return doc or {}

    async def get_patient_summary(self, patient_id: Optional[str]) -> Dict[str, Any]:
        # patient_summary holds the AI "Clinical Summary" (summary.paragraphs[]) the
        # RadiotherapyRecord tab renders. Keyed by snake_case `patient_id`, versioned by
        # `generated_at` (newest wins) — same id value the dashboard passes, only the
        # field name differs; `patientId` is accepted as a fallback. Read-only.
        query = ({"$or": [{"patient_id": patient_id}, {"patientId": patient_id}]}
                 if patient_id else {})
        doc = await self._db[self._summary_coll].find_one(query, sort=[("generated_at", -1)])
        return doc or {}

    async def get_tumor_board_plan(self, patient_id: Optional[str]) -> Dict[str, Any]:
        # tumorBoardPlan is the authoritative "Tumor Board / MDT Plan" source the
        # RadiotherapyRecord Common-data-elements tab displays; keyed by `patient_id`,
        # newest by `created_at`. (rt-record-details.common.tumorBoard is only a mirror,
        # saved ad-hoc when that tab is persisted.) Read-only.
        query = ({"$or": [{"patient_id": patient_id}, {"patientId": patient_id}]}
                 if patient_id else {})
        doc = await self._db[self._tumor_board_coll].find_one(query, sort=[("created_at", -1)])
        return doc or {}

    async def get_chemotherapy_record(self, patient_id: Optional[str]) -> Dict[str, Any]:
        # chemotherapy_records is the authoritative systemic-therapy record for a patient;
        # keyed by `patientId` (the same value the RT dashboard passes) and it carries a real
        # `updatedAt` ISODate, so newest-wins is a direct sort (unlike the RT collections,
        # which need _activity_key). Read-only. Feeds Module 11's systemic-therapy rows.
        query = {"patientId": patient_id} if patient_id else {}
        doc = await self._db[self._chemo_coll].find_one(query, sort=[("updatedAt", -1)])
        return doc or {}

    async def get_latest_protocol_reference(self, patient_id: Optional[str]) -> Dict[str, Any]:
        """
        Find the latest protocolReference applied across all radiotherapy_records for the patient,
        ordering by the top-level `applied_at` timestamp.
        """
        coll = self._db[self._workflow_coll]
        query = ({"$or": [{"patient_id": patient_id}, {"patientId": patient_id}]}
                 if patient_id else {})
        docs = await coll.find(query).to_list(length=100)
        if not docs:
            return {}

        latest_proto: Dict[str, Any] = {}
        latest_applied_at: str = ""

        for doc in docs:
            ebrt = doc.get("ebrt") if isinstance(doc.get("ebrt"), dict) else {}
            proto = ebrt.get("protocolReference") or doc.get("protocolReference")
            if isinstance(proto, dict) and proto:
                applied_at = str(doc.get("applied_at") or proto.get("applied_at") or "").strip()
                if not latest_applied_at or applied_at >= latest_applied_at:
                    latest_applied_at = applied_at
                    latest_proto = proto

        return latest_proto

    async def close(self) -> None:  # pragma: no cover - client is shared/singleton
        pass


# Backwards-compatible alias for the interface name used by agents/type hints.
RTDataSource = MongoRTDataSource


def get_data_source() -> MongoRTDataSource:
    """Live Mongo data source. Requires RT_MONGO_URI to be set."""
    get_mongo_db()  # validates RT_MONGO_URI early
    return MongoRTDataSource()
