"""
grounded_evis/dump_raw_case.py
==============================================================
Dumps the RAW, unfiltered output of run_grounded_pipeline() for one real
patient_id — no shadow_compare diffing, no legacy-shape mapping, no set-
equality string comparison in between. This exists because
comparison_report.py's "legacy-only diagnosis" list turned out to be
near-meaningless noise (exact string-set diff between two independently-
worded LLM outputs will almost always show "legacy-only" content even
when the new pipeline agrees) — the only way to actually answer "did
bleeding_evidence/anticoag_hit fire correctly, and what did Stage 3/4 do
with it" is to read the real output directly.

WHAT THIS FETCHES (confirmed directly against Agentic/ambulance.py, not
guessed — mirrors the exact call pattern used at the real
/emergency/voice-suggestions/{patient_id} endpoint, around line 5080):
  - patient_record   via _fetch_patient_record(patient_id)
  - entries, emt_count, doctor_count, image_count, raw_image_entries
                      via _fetch_all_clinical_entries(patient_id)
                      (5-tuple — entries already has image items merged
                      in; raw_image_entries is passed SEPARATELY as
                      image_entries anyway, matching ambulance.py's own
                      call even though that looks redundant)
  - clinical_actions  via a direct query against clinical_actions_collection,
                      filtered by patient_id, sorted by server_received_at
                      descending — same as ambulance.py's own inline query,
                      NOT via _fetch_all_clinical_entries

Importing ambulance.py opens a real Mongo connection at import time
(module-level mongo_db = AsyncIOMotorClient(...)) — expected, not a bug.

MUST BE RUN AS A MODULE FROM THE REPO ROOT (same requirement as
comparison_report.py — pipeline.py uses relative imports like
`from .case_classification import classify_case`, which only resolve
when this file is loaded as part of the Agentic.grounded_evis package,
not when run as a bare script):

    cd ~/AiEngine/4.1.7_beta/DoctorAssist-AiEngine
    python -m Agentic.grounded_evis.dump_raw_case 3453536454654
    python -m Agentic.grounded_evis.dump_raw_case 3453536454654 --claims-only
    python -m Agentic.grounded_evis.dump_raw_case 3453536454654 ID324 INC-20260731-002

Running `python dump_raw_case.py ...` directly (or from inside the
grounded_evis/ folder) WILL fail with "attempted relative import with no
known parent package" — that's pipeline.py's own relative imports
breaking, not this script.
"""

from __future__ import annotations

import argparse
import asyncio
import json

# Confirmed against Agentic/ambulance.py directly (not guessed): real
# module path, real function names, real collection object.
# NOTE: importing ambulance.py opens a real Mongo connection at import
# time (mongo_db = AsyncIOMotorClient(...) runs at module load) — that's
# expected, same as every other script in this package that touches
# these collections.
from Agentic.ambulance import (
    _fetch_patient_record,
    _fetch_all_clinical_entries,
    clinical_actions_collection,
)

# Relative import — REQUIRES running via `python -m
# Agentic.grounded_evis.dump_raw_case`, see USAGE above. Matches how
# every other module in this package imports pipeline internals
# (pipeline.py itself uses `from .stage1_extract import extract_facts`
# etc.) — this script is not special, it just wasn't run as a module
# the first time.
from .pipeline import run_grounded_pipeline


async def dump_one(patient_id: str, claims_only: bool) -> None:
    print("=" * 70)
    print(f"PATIENT {patient_id}")
    print("=" * 70)

    # ── fetch real data — matches ambulance.py's own call pattern exactly
    # (see process_combined_entries's caller around line 5080) ──
    patient_record = await _fetch_patient_record(patient_id)

    entries, emt_count, doctor_count, image_count, raw_image_entries = (
        await _fetch_all_clinical_entries(patient_id)
    )
    source_counts = {"emt": emt_count, "doctor": doctor_count, "image": image_count}

    try:
        cursor = clinical_actions_collection.find(
            {"patient_id": patient_id}, {"_id": 0}
        ).sort("server_received_at", -1)
        clinical_actions = await cursor.to_list(length=None)
    except Exception as e:
        print(f"WARNING: could not fetch clinical_actions for {patient_id}: {e}")
        clinical_actions = []

    result = await run_grounded_pipeline(
        patient_id=patient_id,
        entries=entries,
        clinical_actions=clinical_actions,
        image_entries=raw_image_entries,  # ambulance.py passes raw_image_entries
                                           # here too, alongside entries which
                                           # ALSO already contains image items —
                                           # matching that exact convention even
                                           # though it looks redundant, since
                                           # that's what the real caller does
        patient_record=patient_record,
        source_counts=source_counts,
    )

    print("\n--- TRIGGERS FIRED ---")
    print(result.get("triggers_fired"))
    print("\n--- TRIGGER BASIS (why each fired) ---")
    print(json.dumps(result.get("trigger_basis"), indent=2, default=str))

    print("\n--- AUDIT ---")
    audit = dict(result.get("audit", {}))
    # dropped_fact_details / dropped_claim_details are printed separately
    # below so the top-level audit counts are readable at a glance
    dropped_fact_details = audit.pop("dropped_fact_details", [])
    dropped_claim_details = audit.pop("dropped_claim_details", [])
    print(json.dumps(audit, indent=2, default=str))

    if not claims_only:
        print("\n--- DROPPED FACTS (Stage 2 grounding failures) ---")
        print(json.dumps(dropped_fact_details, indent=2, default=str))

    print("\n--- DROPPED CLAIMS (Stage 4 enforcement — this is the important part) ---")
    print(json.dumps(dropped_claim_details, indent=2, default=str))

    print("\n--- KEPT CLAIMS (all categories) ---")
    print(json.dumps(result.get("claims"), indent=2, default=str))

    print("\n--- suspected_diagnoses (kept only) ---")
    print(json.dumps(result.get("suspected_diagnoses"), indent=2, default=str))

    if not claims_only:
        print("\n--- TRIAGE FLOOR ---")
        print(f"triage_colour: {result.get('triage_colour')}")
        print(f"triage_colour_source: {result.get('triage_colour_source')}")
        print(json.dumps(result.get("triage_floor_inputs"), indent=2, default=str))

        print("\n--- FULL GROUNDED FACTS ---")
        print(json.dumps(result.get("facts"), indent=2, default=str))

    print()


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("patient_ids", nargs="+", help="one or more patient_ids to dump")
    parser.add_argument(
        "--claims-only",
        action="store_true",
        help="skip dropped facts, triage floor, and full facts list — just triggers + claims",
    )
    args = parser.parse_args()

    for pid in args.patient_ids:
        await dump_one(pid, args.claims_only)


if __name__ == "__main__":
    asyncio.run(main())