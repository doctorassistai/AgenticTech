"""
grounded_evis/replay_real_cases.py
==============================================================
Replays a curated list of already-stored patient_ids through the REAL
running EVIS endpoint (POST /emergency/voice-suggestions/{patient_id}).

This is deliberately an HTTP-level replay, not a direct function call,
so it exercises exactly what production does: the legacy pipeline runs
and returns its normal response, and (because of the shadow_compare
wiring you added) the new grounded pipeline runs in the background and
writes a comparison record to shadow_comparisons_collection.

WHY HTTP AND NOT CALLING process_combined_entries() DIRECTLY:
Calling the internal function directly would skip route-level concerns
(auth headers, any middleware) and risks drifting from what real traffic
actually triggers. HTTP replay = closest thing to "this really happened."

SIDE EFFECTS (same as any real request — nothing extra from this script):
  - process_combined_entries() writes to voice_processed_results as usual
  - authoritative triage gets re-published for that patient (upsert, not
    append — if you replay a patient who has since moved on clinically,
    their authoritative triage record will reflect this replay's output
    until a fresh real request overwrites it again). If that's a concern
    for a specific patient, skip replaying them, or replay against a
    staging DB instead of production.
  - the shadow comparison write is the only NEW side effect, and it's
    additive/isolated (its own collection).

USAGE:
    python replay_real_cases.py \
        --base-url https://doctorassist.ai/api/hms/users/ai-legacy \
        --patient-ids-file patient_ids.txt \
        --delay-seconds 3

patient_ids.txt: one patient_id per line, '#' comments allowed.

If your endpoint requires auth headers, set them in HEADERS below or via
the --auth-header "Name: Value" flag (repeatable).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path
from typing import Dict, List

import httpx


def load_patient_ids(path: str) -> List[str]:
    ids = []
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        ids.append(line)
    return ids


def parse_headers(raw_headers: List[str]) -> Dict[str, str]:
    headers = {}
    for h in raw_headers:
        if ":" not in h:
            print(f"WARNING: ignoring malformed header {h!r} (expected 'Name: Value')", file=sys.stderr)
            continue
        name, value = h.split(":", 1)
        headers[name.strip()] = value.strip()
    return headers


async def replay_one(
    client: httpx.AsyncClient, base_url: str, patient_id: str, timeout_s: float
) -> Dict:
    url = f"{base_url.rstrip('/')}/emergency/voice-suggestions/{patient_id}"
    t0 = time.monotonic()
    try:
        resp = await client.post(url, timeout=timeout_s)
        elapsed_ms = round((time.monotonic() - t0) * 1000)
        if resp.status_code != 200:
            return {
                "patient_id": patient_id, "ok": False, "status_code": resp.status_code,
                "elapsed_ms": elapsed_ms, "body_snippet": resp.text[:300],
            }
        body = resp.json()
        return {
            "patient_id": patient_id, "ok": True, "status_code": 200,
            "elapsed_ms": elapsed_ms,
            "case_type": body.get("case_type"), "is_trauma": body.get("is_trauma"),
            "entry_count": body.get("entry_count"),
            "processing_time_ms": body.get("processing_time_ms"),
        }
    except Exception as e:
        elapsed_ms = round((time.monotonic() - t0) * 1000)
        return {"patient_id": patient_id, "ok": False, "error": str(e), "elapsed_ms": elapsed_ms}


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True,
                         help="e.g. https://doctorassist.ai/api/hms/users/ai-legacy")
    parser.add_argument("--patient-ids-file", required=True)
    parser.add_argument("--delay-seconds", type=float, default=3.0,
                         help="Pause between requests — be kind to your Groq rate limit "
                              "since each replay triggers legacy AND (async) new pipeline calls.")
    parser.add_argument("--timeout-seconds", type=float, default=60.0)
    parser.add_argument("--auth-header", action="append", default=[],
                         help="Repeatable, e.g. --auth-header 'Authorization: Bearer xyz'")
    args = parser.parse_args()

    patient_ids = load_patient_ids(args.patient_ids_file)
    if not patient_ids:
        raise SystemExit(f"No patient_ids found in {args.patient_ids_file}")

    headers = parse_headers(args.auth_header)

    print(f"Replaying {len(patient_ids)} patient(s) against {args.base_url}")
    print(f"Delay between requests: {args.delay_seconds}s | timeout: {args.timeout_seconds}s\n")

    results = []
    async with httpx.AsyncClient(headers=headers) as client:
        for i, pid in enumerate(patient_ids, start=1):
            print(f"[{i}/{len(patient_ids)}] {pid} ...", end=" ", flush=True)
            r = await replay_one(client, args.base_url, pid, args.timeout_seconds)
            results.append(r)
            if r["ok"]:
                print(f"OK case_type={r.get('case_type')} is_trauma={r.get('is_trauma')} "
                      f"legacy_ms={r.get('processing_time_ms')} http_ms={r['elapsed_ms']}")
            else:
                print(f"FAILED — {r.get('error') or r.get('body_snippet')}")
            if i < len(patient_ids):
                await asyncio.sleep(args.delay_seconds)

    ok = [r for r in results if r["ok"]]
    failed = [r for r in results if not r["ok"]]
    print(f"\nDone. {len(ok)}/{len(results)} succeeded.")
    if failed:
        print("Failed patient_ids:")
        for r in failed:
            print(f"  - {r['patient_id']}: {r.get('error') or r.get('body_snippet')}")

    print(
        "\nNOTE: the legacy responses above are what came back synchronously. "
        "The NEW pipeline's shadow comparisons are still running/writing in the "
        "background per-request (fire-and-forget on the server side) — wait ~30-60s "
        "after this script finishes before running comparison_report.py, so the last "
        "few shadow tasks have time to finish and persist."
    )


if __name__ == "__main__":
    asyncio.run(main())