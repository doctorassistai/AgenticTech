"""
grounded_evis/inspect_case.py
==============================================================
Runs the NEW grounded pipeline directly (bypassing HTTP and
shadow_compare's field-extraction) for a single patient, and prints
EVERYTHING: all Stage 1 grounded facts, all Stage 2 triggers, ALL Stage 3
claims regardless of category (not just suspected_diagnosis — this is the
gap shadow_compare.py's summary view has), and the final composed output.

Use this when a shadow_compare disagreement needs a real look, not just
the headline-field diff.

USAGE:
    python inspect_case.py --patient-id 100003

Requires MONGO_URI and GROQ_API_KEY in the environment (same as the
running server).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys

sys.path.insert(0, "/root/AiEngine/4.1.7_beta/DoctorAssist-AiEngine")  # adjust if needed

from Agentic.ambulance import _fetch_all_clinical_entries, _fetch_patient_record
from Agentic.grounded_evis.pipeline import run_grounded_pipeline


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--patient-id", required=True)
    args = parser.parse_args()

    entries, emt_count, doctor_count, image_count, raw_image_entries = \
        await _fetch_all_clinical_entries(args.patient_id)

    try:
        cursor = None  # not needed here — clinical_actions optional for inspection,
        # but include if you want prior_action_context exercised too.
        from Agentic.ambulance import clinical_actions_collection
        cursor = clinical_actions_collection.find(
            {"patient_id": args.patient_id}, {"_id": 0}
        ).sort("server_received_at", -1)
        clinical_actions = await cursor.to_list(length=None)
    except Exception as e:
        print(f"WARNING: could not fetch clinical_actions: {e}")
        clinical_actions = []

    patient_record = await _fetch_patient_record(args.patient_id)

    print(f"Running grounded pipeline for patient={args.patient_id} "
          f"({len(entries)} entries, {len(clinical_actions)} clinical actions)...\n")

    result = await run_grounded_pipeline(
        patient_id=args.patient_id,
        entries=entries,
        clinical_actions=clinical_actions,
        image_entries=raw_image_entries,
        patient_record=patient_record,
        source_counts={"emt": emt_count, "doctor": doctor_count, "image": image_count},
    )

    print("=" * 70)
    print("FULL PIPELINE OUTPUT")
    print("=" * 70)
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    asyncio.run(main())