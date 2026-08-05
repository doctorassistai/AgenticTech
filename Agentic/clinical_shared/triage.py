"""
clinical_shared/triage.py
==============================================================
SINGLE SOURCE OF TRUTH for deterministic triage-colour computation.

Previously, EIDIS (v3.1), EDFS (v8), and the emergency structured-note
pipeline each kept their own byte-for-byte-identical copy of
compute_triage_colour(), with comments in every copy saying it was a
"candidate for extraction into a shared module." This module IS that
extraction. All three pipelines (and any future one — e.g. EVIS, if it is
ever changed to cross-check its LLM-derived triage against a deterministic
floor) should import compute_triage_colour from here instead of keeping a
local copy. This guarantees triage colour can never diverge between the
insurance package (EIDIS), the ED final summary (EDFS), and the structured
note for the same patient, since they are now provably running the exact
same function.

Do not fork this function. If a pipeline needs different triage behaviour,
that is a signal the difference belongs in a documented parameter to this
function, not in a duplicated/modified copy.
"""

from datetime import datetime, timezone
from typing import Any, Dict, Optional


# ============================================================
# AUTHORITATIVE-TRIAGE STORE
# ------------------------------------------------------------
# EVIS is the single source of truth for triage colour: it's the only one
# of the four pipelines whose triage judgement comes from a full clinical
# LLM read of the case (chief complaint, ECG findings, mechanism, etc.),
# not just raw vitals. compute_triage_colour() below is deliberately dumb
# — it reasons only from physiological derangement — so it structurally
# cannot catch a diagnosis-driven Red (e.g. suspected STEMI with otherwise
# "stable-looking" vitals). It exists here only as:
#   (a) EVIS's own safety-net floor (not currently wired in — EVIS's
#       triage comes from its A3/A4 LLM agents), and
#   (b) a FALLBACK for EIDIS/EDFS/the structured-note pipeline, for the
#       rare case they're asked to generate a document for a patient EVIS
#       has never run for.
#
# These two functions are the read/write sides of that hand-off. Callers
# pass in whatever Motor collection they've pointed at the shared
# `patient_triage_status` collection (same "doctorassistai" DB all four
# pipelines already use) — this module deliberately holds no DB connection
# of its own, to avoid every pipeline needing clinical_shared's own Mongo
# config.
# ============================================================

async def upsert_authoritative_triage(
    collection: Any,
    patient_id: str,
    triage_colour: str,
    source_system: str = "EVIS",
    criticality_score: Any = None,
    risk_level: Any = None,
    rationale: Optional[str] = None,
    computed_at_ist: Optional[str] = None,
) -> None:
    """
    Persist the authoritative triage colour for a patient. Call this from
    EVIS after it produces a final patient_snapshot.triage_colour (i.e.
    after A8 / SIMPLE_SYNTH), so every later document (EIDIS, EDFS,
    structured note) can read the same value instead of recomputing its
    own from raw vitals alone.

    One document per patient_id (upserted) — this stores the LATEST
    triage judgement only, not a history. If a history is later needed
    (e.g. to show triage trend over a visit), switch to an insert with a
    timestamp and have fetch_authoritative_triage() sort by it — not done
    here to keep this a minimal, single-purpose store for now.
    """
    doc = {
        "patient_id":        patient_id,
        "triage_colour":     triage_colour,
        "source_system":     source_system,
        "criticality_score": criticality_score,
        "risk_level":        risk_level,
        "rationale":         rationale,
        "computed_at_ist":   computed_at_ist,
        "stored_at_utc":     datetime.now(timezone.utc).isoformat(),
    }
    try:
        await collection.update_one(
            {"patient_id": patient_id},
            {"$set": doc},
            upsert=True,
        )
    except Exception:
        # Never let a triage-store write failure break the caller's main
        # response — the caller's own document generation must not fail
        # just because this cross-pipeline convenience write failed.
        # Callers should log this themselves if they want visibility;
        # this function stays silent-safe by design.
        raise


async def fetch_authoritative_triage(
    collection: Any,
    patient_id: str,
) -> Optional[Dict[str, Any]]:
    """
    Fetch EVIS's authoritative triage judgement for a patient, or None if
    EVIS has never computed one for this patient_id yet.

    Callers (EIDIS / EDFS / structured note) should treat None as "fall
    back to compute_triage_colour() on our own extracted vitals, and mark
    the output as a fallback" — never as "assume Green" or silently skip
    the field.
    """
    return await collection.find_one({"patient_id": patient_id}, {"_id": 0})


def compute_triage_colour(
    hr: Any = None,
    rr: Any = None,
    spo2_room_air: Any = None,
    spo2_on_o2: Any = None,
    bp_sys: Any = None,
    gcs: Any = None,
    consciousness: Optional[str] = None,
    shock_suspected: Optional[bool] = None,
    respiratory_failure_risk: Optional[bool] = None,
    pneumothorax_or_hemothorax_flag: Optional[bool] = None,
    doctor_stated_severity: Optional[str] = None,
    arrest_or_deceased_indicated: Optional[bool] = None,
) -> str:
    """
    Deterministic triage colour (Red/Yellow/Green/Black), computed the same
    way regardless of case type (trauma or medical) — it reasons purely
    from physiological derangement, not from injury mechanism. Never
    guesses Black; only returns it when arrest_or_deceased_indicated is
    explicitly True (never inferred from CPR being performed, which could
    mean the patient is being actively — and successfully — resuscitated).
    """
    def _to_int(v):
        try:
            return int(v)
        except Exception:
            return None

    hr_i    = _to_int(hr)
    rr_i    = _to_int(rr)
    spo2a_i = _to_int(spo2_room_air)
    spo2o_i = _to_int(spo2_on_o2)
    bps_i   = _to_int(bp_sys)
    gcs_i   = _to_int(gcs)

    if arrest_or_deceased_indicated:
        return "Black"

    red_reasons = []
    if shock_suspected:
        red_reasons.append("shock_suspected")
    if respiratory_failure_risk:
        red_reasons.append("respiratory_failure_risk")
    if pneumothorax_or_hemothorax_flag:
        red_reasons.append("chest_life_threat_flag")
    if spo2a_i is not None and spo2a_i < 85:
        red_reasons.append("severe_hypoxia_room_air")
    if spo2o_i is not None and spo2o_i < 90:
        red_reasons.append("severe_hypoxia_on_o2")
    if gcs_i is not None and gcs_i <= 8:
        red_reasons.append("gcs_le_8")
    if consciousness and "unconscious" in consciousness.lower():
        red_reasons.append("unconscious")
    if bps_i is not None and bps_i < 90:
        red_reasons.append("hypotensive")
    if (doctor_stated_severity or "").upper() == "SEVERE":
        red_reasons.append("doctor_stated_severe")

    if red_reasons:
        return "Red"

    yellow_reasons = []
    if hr_i is not None and hr_i > 100:
        yellow_reasons.append("tachycardia")
    if rr_i is not None and rr_i > 20:
        yellow_reasons.append("tachypnoea")
    if spo2a_i is not None and 85 <= spo2a_i < 95:
        yellow_reasons.append("mild_moderate_hypoxia_room_air")
    if gcs_i is not None and 9 <= gcs_i <= 13:
        yellow_reasons.append("gcs_9_13")
    if consciousness and "confus" in consciousness.lower():
        yellow_reasons.append("confused")
    if (doctor_stated_severity or "").upper() == "MODERATE":
        yellow_reasons.append("doctor_stated_moderate")

    if yellow_reasons:
        return "Yellow"

    return "Green"


# ── Small numeric-parsing helpers used by callers when building the
# arguments above from loosely-typed display-string vitals (e.g. a blood
# pressure field stored as "128/84"). Centralised here too, since EIDIS,
# EDFS, and the structured-note pipeline each also kept their own copies
# of these two small helpers for the exact same reason. ─────────────────

def first_int(val: Any) -> Optional[int]:
    """Extract the first integer found in a loosely-typed value/string."""
    import re
    if val is None:
        return None
    m = re.search(r"(\d{1,3})", str(val))
    if m:
        try:
            return int(m.group(1))
        except Exception:
            return None
    return None


def parse_bp_systolic(bp_str: Any) -> Optional[int]:
    """Extract the systolic component from a 'SYS/DIA' style BP string."""
    import re
    if not bp_str:
        return None
    m = re.search(r"(\d{2,3})\s*/\s*\d{2,3}", str(bp_str))
    if m:
        try:
            return int(m.group(1))
        except Exception:
            return None
    return None