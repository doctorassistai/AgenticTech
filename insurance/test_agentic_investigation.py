"""
test_agentic_investigation.py

Standalone, one-off test script. Calls run_agentic_investigation(...)
DIRECTLY — no Celery, no queue, no worker process needed. This isolates
"does the classification + PED + Billing agent logic actually work"
from "does the Celery/queue plumbing work", so we debug one thing at a
time.

WHAT THIS TOUCHES:
- READS insurance_claims_new for the case_id you give it.
- WRITES ONLY the agenticInvestigation field on that same document
  (via run_agentic_investigation itself — this script doesn't do any
  extra writes of its own).
- Does NOT touch raw_llama_markdown, documentFindings, or any other
  field. Does NOT touch case_documents_router.py, advanced_upload_task.py,
  celery_app.py, or multiagent_extraction.py.

HOW TO RUN:
1. Place this file at the repo root (same level you'd run other
   one-off scripts from), so `from services.agentic_investigation import
   run_agentic_investigation` resolves the same way it does inside
   agentic_investigation_task.py.
2. Make sure MONGO_URI and GROQ_API_KEY are set in your environment
   (same env the real app/worker uses).
3. Run:
     python test_agentic_investigation.py <CASE_ID>
   e.g.
     python test_agentic_investigation.py CIMS-A1B2C3D4

WHAT TO EYEBALL IN THE OUTPUT:
- documentClassification: does the doc_type distribution look sane for
  what you know is in that case's uploaded files? Any large "Other"
  bucket is worth a second look (means the taxonomy or prompt may need
  tuning, or those really are miscellaneous pages).
- ped.result.status: does it match what you'd expect for this case
  (UNDISCLOSED_PED_SUSPECTED / DISCLOSED_CONSISTENT / NO_PED_EVIDENCE /
  UNCLEAR)? Check the quotes — do they look like real excerpts, and is
  verified=true on all of them?
- billing.result.status: SUPPORTED / VARIANCE_FOUND / INSUFFICIENT_EVIDENCE
  — does total_billed_amount look right, and if VARIANCE_FOUND, is the
  variance genuinely material or just rounding noise?
- Any verified=false quote is a bug worth investigating immediately —
  it means the LLM said something wasn't actually verbatim on the page
  it claimed to be from, and got caught, which is exactly what the
  quote-verification step exists to catch. One or two on first run is
  plausible; the LLM output itself should never surface an unverified
  quote as if it were confirmed.
- Force-test the error path once: temporarily set GROQ_API_KEY to a
  garbage value and re-run. Confirm agenticInvestigation.status comes
  back "error" with a real error message — NOT an empty/successful-
  looking result. This is the exact failure mode the existing findings
  pipeline was bitten by before (an infra failure silently looking like
  "nothing found").
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import datetime

from motor.motor_asyncio import AsyncIOMotorClient

from services.agentic_investigation import run_agentic_investigation

MONGO_URI = os.getenv("MONGO_URI")


def _default(o):
    if isinstance(o, datetime):
        return o.isoformat()
    return str(o)


async def main(case_id: str) -> None:
    if not MONGO_URI:
        print("ERROR: MONGO_URI is not set in the environment.")
        sys.exit(1)
    if not os.getenv("GROQ_API_KEY"):
        print("ERROR: GROQ_API_KEY is not set in the environment.")
        sys.exit(1)

    client = AsyncIOMotorClient(MONGO_URI)
    try:
        db = client["doctorassistai"]
        insurance_claims_col = db["insurance_claims_new"]

        # Pre-check: does this case exist and have parsed text at all?
        pre = await insurance_claims_col.find_one(
            {"caseId": case_id}, {"_id": 0, "raw_llama_markdown": 1, "caseId": 1}
        )
        if not pre:
            print(f"ERROR: no claim found with caseId={case_id!r}. Nothing to test.")
            sys.exit(1)

        markdown_len = len((pre.get("raw_llama_markdown") or ""))
        print(f"Case {case_id}: raw_llama_markdown is {markdown_len} chars.")
        if markdown_len == 0:
            print(
                "WARNING: this case has no parsed document text yet — "
                "the pipeline will run its early-exit path and persist an "
                "empty agenticInvestigation result. Pick a case that's "
                "already been through /web/advanced-upload at least once "
                "if you want to exercise classification + the agents."
            )

        print("\nRunning run_agentic_investigation(...) directly (no Celery)...\n")
        started = datetime.utcnow()
        result = await run_agentic_investigation(insurance_claims_col, case_id)
        elapsed = (datetime.utcnow() - started).total_seconds()

        print(f"Done in {elapsed:.1f}s. Top-level status: {result.get('status')}")
        if result.get("error"):
            print(f"Top-level error: {result['error']}")

        classification = result.get("documentClassification", [])
        print(f"\nClassified {len(classification)} page(s). Breakdown by doc_type:")
        counts: dict[str, int] = {}
        for c in classification:
            counts[c["doc_type"]] = counts.get(c["doc_type"], 0) + 1
        for doc_type, n in sorted(counts.items(), key=lambda kv: -kv[1]):
            print(f"  {doc_type:35s} {n}")

        agents = result.get("agents", {})

        ped = agents.get("ped", {})
        print(f"\n--- PED agent --- status={ped.get('status')} error={ped.get('error')}")
        if ped.get("result"):
            r = ped["result"]
            print(f"  verdict: {r.get('status')}  confidence: {r.get('confidence')}")
            print(f"  condition: {r.get('condition')}")
            print(f"  first_documented_date: {r.get('first_documented_date')}  "
                  f"policy_inception_date: {r.get('policy_inception_date')}")
            print(f"  explanation: {r.get('explanation')}")
            for q in r.get("quotes", []):
                flag = "OK" if q.get("verified") else "!! UNVERIFIED !!"
                print(f"    [{flag}] {q.get('file_name')} p.{q.get('page_number')}: {q.get('quote')!r}")

        billing = agents.get("billing", {})
        print(f"\n--- Billing agent --- status={billing.get('status')} error={billing.get('error')}")
        if billing.get("result"):
            r = billing["result"]
            print(f"  verdict: {r.get('status')}  confidence: {r.get('confidence')}")
            print(f"  claimed_amount: {r.get('claimed_amount')}  "
                  f"total_billed_amount: {r.get('total_billed_amount')}  "
                  f"variance: {r.get('variance')}")
            print(f"  explanation: {r.get('explanation')}")
            for flag in r.get("itemized_flags", []):
                print(f"    [{flag.get('type')}] {flag.get('explanation')}")
                for q in flag.get("quotes", []):
                    ok = "OK" if q.get("verified") else "!! UNVERIFIED !!"
                    print(f"      [{ok}] {q.get('file_name')} p.{q.get('page_number')}: {q.get('quote')!r}")

        print("\nFull raw result (for anything the summary above didn't surface):\n")
        print(json.dumps(result, indent=2, default=_default))

    finally:
        client.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python test_agentic_investigation.py <CASE_ID>")
        sys.exit(1)
    asyncio.run(main(sys.argv[1]))