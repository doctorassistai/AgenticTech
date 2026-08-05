"""
test_adjudication.py
──────────────────────────────────────────────────────────
Run from project root:
    python test_adjudication.py <case_id> [trigger]

Examples:
    python test_adjudication.py CIMS-ABC12345
    python test_adjudication.py CIMS-ABC12345 ped_non_disclosure

Triggers tested by default:
    - claim_genuinity_authenticity
    - ped_non_disclosure

Zero changes to existing code. Read-only — nothing is written to DB.
──────────────────────────────────────────────────────────
"""
import asyncio
import sys
import os
import logging

from dotenv import load_dotenv
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s"
)
logger = logging.getLogger("test_adjudication")

# ── same DB setup your main app uses ─────────────────────
from motor.motor_asyncio import AsyncIOMotorClient
from routes.agents.base import run_pass1
from routes.agents.preprocessor import preprocess
from routes.agents.adjudication_agent import run   # your adjudication file

MONGO_URI = os.getenv("MONGO_URI")
client    = AsyncIOMotorClient(MONGO_URI)
db        = client["doctorassistai"]

insurance_claims_col = db["insurance_claims_new"]
case_documents_col   = db["case_documents"]


# ── fetch the same data the real endpoint fetches ────────
async def fetch_case_data(case_id: str):
    claim = await insurance_claims_col.find_one({"caseId": case_id})
    if not claim:
        raise ValueError(f"Case '{case_id}' not found in insurance_claims_new.")

    # 1. raw text — same priority order as generate_conclusion endpoint
    raw_text = (claim.get("raw_llama_markdown") or "").strip()

    if not raw_text:
        doc_record = await case_documents_col.find_one({"case_id": case_id})
        if doc_record:
            for doc in doc_record.get("documents", []):
                candidate = (doc.get("raw_markdown") or "").strip()
                if candidate:
                    raw_text = candidate
                    break

    if not raw_text:
        raise ValueError(
            f"No document text found for case '{case_id}'. "
            "Upload at least one document first."
        )

    # 2. extracted_flat — same as generate_conclusion endpoint
    EXCLUDE = {"_id", "raw_llama_markdown", "conclusion", "conclusionParts"}
    extracted_flat = {
        k: v for k, v in claim.items()
        if k not in EXCLUDE and v is not None
    }

    return raw_text, extracted_flat


async def test_trigger(case_id: str, trigger: str):
    print(f"\n{'='*60}")
    print(f"  CASE   : {case_id}")
    print(f"  TRIGGER: {trigger}")
    print(f"{'='*60}\n")

    logger.info("Fetching case data...")
    raw_text, extracted_flat = await fetch_case_data(case_id)
    logger.info("Raw text length: %d chars", len(raw_text))
    logger.info("Extracted flat fields: %d", len(extracted_flat))

    logger.info("Running Pass-1...")
    pass1_result = await run_pass1(raw_text) or {}
    logger.info(
        "Pass-1 done: %d fields",
        sum(1 for v in pass1_result.values() if v is not None)
    )

    preprocessed = preprocess(pass1_result, extracted_flat)
    logger.info("Preprocessed. Verdict override: %s", preprocessed.get("verdict_override"))

    logger.info("Running adjudication agent for trigger: %s", trigger)
    conclusion = await run(
        text=raw_text,
        trigger=trigger,
        pass1_result=pass1_result,
        extracted_flat=extracted_flat,
        preprocessed=preprocessed,
    )

    print("\n" + "─"*60)
    print("CONCLUSION OUTPUT:")
    print("─"*60)
    print(conclusion)
    print("─"*60)
    print(f"\nTotal chars: {len(conclusion)}")

    # ── basic sanity checks ───────────────────────────────
    issues = []
    verdict = preprocessed.get("verdict_override", "")
    c_lower = conclusion.lower()

    if verdict == "SUSPECTED" and "genuine" in c_lower and "suspected" not in c_lower:
        issues.append("⚠  Verdict mismatch: conclusion says Genuine but should be SUSPECTED")

    if "stable" in c_lower:
        issues.append("⚠  'stable' found in vitals — should be exact values")

    complaints = preprocessed.get("complaints_list", [])
    missing = [c for c in complaints if c.lower()[:10] not in c_lower]
    if missing:
        issues.append(f"⚠  Missing chief complaints: {missing}")

    if not conclusion.strip().startswith("==="):
        issues.append("⚠  Header missing — should start with ===")

    if issues:
        print("\nSANITY CHECK FAILURES:")
        for i in issues:
            print(" ", i)
    else:
        print("\n✓ All sanity checks passed.")

    return conclusion


async def main():
    if len(sys.argv) < 2:
        print("Usage: python test_adjudication.py <case_id> [trigger]")
        print("       trigger defaults to both: claim_genuinity_authenticity, ped_non_disclosure")
        sys.exit(1)

    case_id = sys.argv[1]

    # if specific trigger passed, test only that one
    if len(sys.argv) >= 3:
        triggers_to_test = [sys.argv[2]]
    else:
        triggers_to_test = [
            "claim_genuinity_authenticity",
            "ped_non_disclosure",
        ]

    for trigger in triggers_to_test:
        await test_trigger(case_id, trigger)


if __name__ == "__main__":
    asyncio.run(main())