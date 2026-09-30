"""
run_demo.py — Live smoke test for Module 09 against the radiotherapy databases.

    RT_MONGO_URI="mongodb+srv://..." python run_demo.py [PATIENT_ID]

Exercises the real cache flow end-to-end:
    1. get_or_generate() → loads the cached version, or generates + saves the first
    2. regenerate()      → forces a fresh run and a NEW stored version (silent history)
    3. list_versions()   → shows the retained history in radiation_onco_agentic

There is no mock/offline path: this reads only from the live collections
(rt-record-details, radiotherapy_records) and writes generated output to
radiation_onco_agentic. Requires RT_MONGO_URI (optionally GROQ_API_KEY for prose).
"""

import asyncio
import json
import os
import sys
from pathlib import Path

# Allow running as a loose script (python run_demo.py) or as a module.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from radiation_onc_workflow import store  # noqa: E402
from radiation_onc_workflow.workflow import get_or_generate, regenerate  # noqa: E402


def _print_module(envelope: dict) -> None:
    data = envelope["data"]
    tag = "cache" if envelope.get("cached") else "generated"
    print("\n" + "=" * 72)
    print(f"Module {data['num']} — {data['title']}")
    print(f"v{envelope.get('version')} ({tag}, {envelope.get('generatedAt')})")
    print(f"Roll-up: {data['status']}   |   {data['summary']}")
    print("=" * 72)
    for row in data["rows"]:
        pill = f"[{row['statusLabel']}]".ljust(22)
        print(f"  {pill} {row['param']:<34} last: {row['finding']}")


async def main() -> None:
    if not os.getenv("RT_MONGO_URI"):
        print("RT_MONGO_URI is not set — this smoke test reads the live databases.")
        print('Run:  RT_MONGO_URI="mongodb+srv://..." python run_demo.py [PATIENT_ID]')
        sys.exit(1)

    patient_id = sys.argv[1] if len(sys.argv) > 1 else None
    await store.ensure_indexes()

    print(">> get_or_generate (page visit: load cache, else generate + save)")
    first = await get_or_generate("documentation", patient_id=patient_id)
    _print_module(first)

    print("\n>> regenerate (button: fresh run, new version, keep history)")
    again = await regenerate("documentation", patient_id=patient_id)
    _print_module(again)

    versions = await store.list_versions(patient_id, "documentation")
    print(f"\n>> history in {store.COLLECTION}: {len(versions)} version(s)")
    for v in versions:
        latest = "  <- latest" if v.get("latest") else ""
        print(f"   v{v.get('version')}  {v.get('generatedAt')}{latest}")

    print("\nRaw envelope (latest):")
    print(json.dumps(again, indent=2, default=str))


if __name__ == "__main__":
    asyncio.run(main())
