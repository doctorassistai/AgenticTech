"""
grounded_evis/comparison_report.py
==============================================================
Reads accumulated shadow-mode comparison records (written by
shadow_compare.run_shadow_comparison) and produces a summary report:
agreement rate, per-field disagreement breakdown, latency, and the two
safety-signal metrics that actually matter for sign-off
(stage3_claims_dropped_ungrounded, facts_dropped_ungrounded) — plus a
best-effort list of cases where the OLD pipeline claimed a diagnosis the
NEW pipeline's grounded facts don't support. That last list is your
retroactive-hallucination-detection signal: manually check a few of those
against the source transcript.

Does NOT touch ambulance.py's response path — read-only, reads whatever
run_shadow_comparison() has already persisted to Mongo.

Usage:
    python -m Agentic.grounded_evis.comparison_report \
        --collection shadow_comparisons --since-hours 24 --db doctorassistai

Requires MONGO_URI in the environment (same one ambulance.py uses).
"""
from __future__ import annotations

import argparse
import asyncio
import os
from collections import Counter
from datetime import datetime, timedelta, timezone
from statistics import mean, median
from typing import Any, Dict, List

from motor.motor_asyncio import AsyncIOMotorClient


async def load_records(
    collection_name: str, since_hours: float, mongo_uri: str, db_name: str
) -> List[Dict[str, Any]]:
    client = AsyncIOMotorClient(mongo_uri)
    db = client[db_name]
    coll = db[collection_name]
    since = datetime.now(timezone.utc) - timedelta(hours=since_hours)
    cursor = coll.find({"compared_at_utc": {"$gte": since.isoformat()}})
    return await cursor.to_list(length=None)


def summarize(records: List[Dict[str, Any]]) -> None:
    total = len(records)
    if total == 0:
        print("No comparison records found in the requested window. "
              "Check that shadow_compare.run_shadow_comparison() is actually "
              "being called (see wiring patch) and that requests have come "
              "in since it was wired up.")
        return

    errored = [r for r in records if r.get("error")]
    ok = [r for r in records if not r.get("error")]

    print("=" * 70)
    print(f"SHADOW COMPARISON REPORT — {total} case(s)")
    print("=" * 70)

    print(f"New pipeline errored on: {len(errored)}/{total} cases")
    if errored:
        for r in errored[:10]:
            print(f"  - patient={r.get('patient_id')} request_id={r.get('request_id')} "
                  f"error={r.get('error')}")
        if len(errored) > 10:
            print(f"  ... and {len(errored) - 10} more")

    if not ok:
        print("\nNo successful comparisons to analyze further.")
        print("=" * 70)
        return

    agree = [r for r in ok if r.get("disagreement_count", 0) == 0]
    disagree = [r for r in ok if r.get("disagreement_count", 0) > 0]
    print(f"\nAgreement rate (headline fields): {len(agree)}/{len(ok)} "
          f"({100 * len(agree) / len(ok):.1f}%)")

    field_counter: Counter = Counter()
    for r in disagree:
        for d in r.get("disagreements", []):
            field = d.split(":")[0].strip()
            field_counter[field] += 1
    if field_counter:
        print("\nDisagreements by field:")
        for field, count in field_counter.most_common():
            print(f"  {field:30s} {count}")

    # ── Safety signals — the numbers that actually matter for sign-off ──
    stage3_dropped = [
        r["new"].get("stage3_claims_dropped_ungrounded") for r in ok
        if r.get("new", {}).get("stage3_claims_dropped_ungrounded") is not None
    ]
    facts_dropped = [
        r["new"].get("facts_dropped_ungrounded") for r in ok
        if r.get("new", {}).get("facts_dropped_ungrounded") is not None
    ]
    nonzero_stage3 = [v for v in stage3_dropped if v > 0]
    nonzero_facts = [v for v in facts_dropped if v > 0]

    if stage3_dropped:
        print(f"\nSAFETY SIGNAL — stage3_claims_dropped_ungrounded > 0 in "
              f"{len(nonzero_stage3)}/{len(stage3_dropped)} case(s) "
              f"(mean={mean(stage3_dropped):.2f})")
        if nonzero_stage3:
            print("  -> Nonzero means Stage 3 tried to say something Stage 2 didn't")
            print("     support, even though it was caught and dropped safely.")
            print("     Worth reviewing which patients these were.")
    else:
        print("\nNo stage3_claims_dropped_ungrounded data found in these records.")

    if facts_dropped:
        print(f"\nSAFETY SIGNAL — facts_dropped_ungrounded > 0 in "
              f"{len(nonzero_facts)}/{len(facts_dropped)} case(s) "
              f"(mean={mean(facts_dropped):.2f})")
        if nonzero_facts:
            print("  -> Nonzero means Stage 1 cited evidence_text that didn't")
            print("     actually match its claimed source entry.")
    else:
        print("\nNo facts_dropped_ungrounded data found in these records.")

    # ── Latency ──
    timings = [r.get("new_pipeline_processing_time_ms") for r in ok
               if r.get("new_pipeline_processing_time_ms")]
    if timings:
        print(f"\nNew pipeline latency — mean={mean(timings):.0f}ms "
              f"median={median(timings):.0f}ms max={max(timings):.0f}ms "
              f"min={min(timings):.0f}ms")

    # ── Retroactive hallucination-detection signal ──
    # Cases where the OLD pipeline's suspected_diagnoses contains something
    # the NEW (grounded) pipeline's suspected_diagnoses does not. This is
    # the closest thing to "did old EVIS invent something new EVIS's
    # grounded facts don't support" that's derivable from the fields
    # shadow_compare currently extracts.
    hallucination_candidates = []
    for r in disagree:
        legacy_dx = set(r.get("legacy", {}).get("suspected_diagnoses") or [])
        new_dx = set(r.get("new", {}).get("suspected_diagnoses") or [])
        only_in_legacy = legacy_dx - new_dx
        if only_in_legacy:
            hallucination_candidates.append(
                (r.get("patient_id"), r.get("request_id"), only_in_legacy)
            )

    if hallucination_candidates:
        print(f"\nPOSSIBLE RETROACTIVE HALLUCINATION CATCHES: "
              f"{len(hallucination_candidates)} case(s) where the OLD pipeline "
              f"claimed a diagnosis the NEW pipeline's grounded facts don't support:")
        for pid, rid, dx in hallucination_candidates[:20]:
            print(f"  - patient={pid} request_id={rid} legacy-only dx={sorted(dx)}")
        if len(hallucination_candidates) > 20:
            print(f"  ... and {len(hallucination_candidates) - 20} more")
        print("  -> Manually check these against the source transcript. If the")
        print("     old diagnosis genuinely wasn't supported by the data, that's")
        print("     exactly the failure mode this rebuild exists to catch.")
    else:
        print("\nNo cases found where the old pipeline had a suspected diagnosis "
              "absent from the new pipeline's grounded output.")

    print("=" * 70)


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--collection", default="shadow_comparisons")
    parser.add_argument("--since-hours", type=float, default=24.0)
    parser.add_argument("--db", default="doctorassistai")
    args = parser.parse_args()

    mongo_uri = os.getenv("MONGO_URI")
    if not mongo_uri:
        raise SystemExit("MONGO_URI not set in environment.")

    records = await load_records(args.collection, args.since_hours, mongo_uri, args.db)
    summarize(records)


if __name__ == "__main__":
    asyncio.run(main())