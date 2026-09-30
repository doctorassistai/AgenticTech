"""
Doctor-pattern analysis: reads the 3-section conclusion a doctor wrote and
extracts WHAT drove their verdict. One row per case in
`doctor_decision_patterns`, overwritten on every re-run (upsert on caseId).
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
from datetime import datetime, timezone, timedelta

from motor.motor_asyncio import AsyncIOMotorClient

from .celery_app import celery_app
from routes.agents.base import call_groq_sync

logger = logging.getLogger(__name__)
IST = timezone(timedelta(hours=5, minutes=30))
MONGO_URI = os.getenv("MONGO_URI")

_CLAIM_PROJECTION = {
    "_id": 0, "caseId": 1, "insurer": 1, "tpaName": 1, "claimMode": 1,
    "claimSubtype": 1, "claimTriggers": 1, "claimedAmount": 1, "sumInsured": 1,
    "claimantName": 1, "doctor_assigned": 1,
    "hospitalDetails.name": 1, "hospitalDetails.type": 1,
    "hospitalDetails.ppnStatus": 1,
    "criticalDetails.diagnosis": 1, "criticalDetails.procedure": 1,
    "billingDetails.finalBillAmount": 1,
    "policyDetails.startDate": 1, "policyDetails.endDate": 1,
    "riskDetails": 1,
    "supportingDocuments.file_name": 1, "supportingDocuments.display_label": 1,
    "investigationDocuments.file_name": 1,
    "investigationDocuments.display_label": 1,
    "investigationDocuments.status": 1,
}

_SYSTEM = """
You analyse the written 3-section report of a doctor who audited an insurance
claim. Your job is NOT to judge the claim. It is to record what drove THIS
doctor's verdict, so patterns can be mined across many cases later.

Use ONLY what the text and claim context below actually say. Never invent
facts, documents, or reasons the doctor did not state. Section 3 is the
doctor's verdict reasoning and is the primary signal; Sections 1 and 2 are
the recorded findings.

Return ONLY one JSON object, no markdown fences:
{
  "verdict": "GENUINE" | "SUSPECTED" | "UNCLEAR",
  "verdict_firmness": "firm" | "hedged" | "unclear",
  "section1_hospital": {
    "facts_recorded": ["..."],
    "gaps_or_missing_documents": ["..."],
    "billing_concerns": ["..."]
  },
  "section2_member": {
    "member_visit_conducted": true | false,
    "disclosures": ["..."],
    "gaps_or_contradictions": ["..."]
  },
  "section3_reasoning": {
    "decision_drivers": [
      {"factor": "<short plain-language reason>",
       "category": "<one of: billing, ped_non_disclosure, missing_document, timeline, identity, hospital_credentials, clinical_necessity, policy_coverage, document_integrity, member_visit, other>",
       "role": "primary" | "supporting",
       "evidence": "<short phrase from the text>"}
    ],
    "discrepancies_relied_on": ["<flag the doctor treated as decisive>"],
    "discrepancies_dismissed": ["<flag the doctor explicitly explained away>"],
    "reasoning_summary": "<2-4 sentences: why this doctor reached this verdict>"
  },
  "pattern_tags": ["<3-8 lowercase snake_case tags, ONE concept per tag, no 'and'/combined items, e.g. unsupported_icu_charges, ped_not_disclosed, missing_ip_register, missing_ot_register>"]
  }
If a section is empty, return empty lists for it. If there is no reasoning at
all, verdict is "UNCLEAR".
"""

_SEC_RE = re.compile(r"^SECTION\s+([123])\s*[—\-–]", re.IGNORECASE | re.MULTILINE)


def split_sections(conclusion: str) -> dict:
    out = {"section1": "", "section2": "", "section3": ""}
    matches = list(_SEC_RE.finditer(conclusion))
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(conclusion)
        body = conclusion[m.end():end]
        out[f"section{m.group(1)}"] = body.split("\n", 1)[-1].strip()
    return out


def _user_prompt(sections: dict, claim: dict) -> str:
    docs = [d.get("display_label") or d.get("file_name")
            for d in (claim.get("supportingDocuments") or [])]
    docs += [d.get("display_label") or d.get("file_name")
             for d in (claim.get("investigationDocuments") or [])
             if d.get("status") != "REINVESTIGATION_REQUESTED"]
    ctx = {
        "insurer": claim.get("insurer"),
        "claimMode": claim.get("claimMode"),
        "claimSubtype": claim.get("claimSubtype"),
        "triggersRequested": claim.get("claimTriggers"),
        "claimedAmount": claim.get("claimedAmount"),
        "sumInsured": claim.get("sumInsured"),
        "hospital": claim.get("hospitalDetails"),
        "diagnosis": (claim.get("criticalDetails") or {}).get("diagnosis"),
        "policyPeriod": claim.get("policyDetails"),
        "documentsAvailable": [d for d in docs if d],
    }
    return (
        f"CLAIM CONTEXT:\n{ctx}\n\n"
        f"SECTION 1 — HOSPITAL VISIT FINDINGS:\n{sections['section1'][:8000] or '(empty)'}\n\n"
        f"SECTION 2 — MEMBER VISIT FINDINGS:\n{sections['section2'][:5000] or '(empty)'}\n\n"
        f"SECTION 3 — CONCLUSION (doctor's verdict reasoning):\n{sections['section3'][:6000] or '(empty)'}"
    )


async def _process(case_id, doctor_id, trigger, conclusion):
    client = AsyncIOMotorClient(MONGO_URI)
    db = client["doctorassistai"]
    claims = db["insurance_claims_new"]
    users = db["user_auth"]
    patterns = db["doctor_decision_patterns"]
    now = datetime.now(IST)

    try:
        await patterns.create_index("caseId", unique=True)
        await patterns.create_index("doctor_id")

        conclusion = (conclusion or "").strip()
        if not conclusion:
            logger.info("doctor_pattern: empty conclusion for %s — skipped", case_id)
            return

        claim = await claims.find_one({"caseId": case_id}, _CLAIM_PROJECTION)
        if not claim:
            raise ValueError(f"Case {case_id} not found")

        # Person who actually clicked (JWT), falling back to doctor_assigned.
        effective_id = doctor_id or claim.get("doctor_assigned") or ""
        user = await users.find_one({"sys_user_id": effective_id},
                                    {"_id": 0, "full_name": 1}) or {}
        doctor_name = user.get("full_name") or ""

        c_hash = hashlib.sha256(conclusion.encode("utf-8")).hexdigest()
        existing = await patterns.find_one({"caseId": case_id},
                                           {"_id": 0, "conclusion_hash": 1})

        # Same conclusion as last analysis → no LLM call, just touch metadata.
        if existing and existing.get("conclusion_hash") == c_hash:
            await patterns.update_one(
                {"caseId": case_id},
                {"$set": {"last_trigger": trigger, "last_analyzed_at": now,
                          "doctor_id": effective_id, "doctor_name": doctor_name}},
            )
            logger.info("doctor_pattern: unchanged conclusion for %s — LLM skipped", case_id)
            return

        sections = split_sections(conclusion)
        loop = asyncio.get_event_loop()
        analysis = await loop.run_in_executor(
            None, call_groq_sync, _SYSTEM, _user_prompt(sections, claim), 3500
        )
        if not isinstance(analysis, dict) or not analysis:
            raise RuntimeError("LLM returned empty/unparseable analysis")

        doc = {
            "caseId": case_id,
            "doctor_id": effective_id,
            "doctor_name": doctor_name,
            "doctor_assigned": claim.get("doctor_assigned"),
            "last_trigger": trigger,          # save | pdf | docx | formatted_docx
            "last_analyzed_at": now,
            "conclusion_hash": c_hash,
            "conclusion_text": conclusion,
            "sections": sections,
            "analysis": analysis,
            "verdict": str(analysis.get("verdict") or "UNCLEAR").upper(),
            "claim_context": {
                "insurer": claim.get("insurer"),
                "claimMode": claim.get("claimMode"),
                "claimSubtype": claim.get("claimSubtype"),
                "claimTriggers": claim.get("claimTriggers"),
                "claimedAmount": claim.get("claimedAmount"),
                "hospitalName": (claim.get("hospitalDetails") or {}).get("name"),
                "diagnosis": (claim.get("criticalDetails") or {}).get("diagnosis"),
            },
        }
        await patterns.update_one(
            {"caseId": case_id},
            {"$set": doc, "$setOnInsert": {"created_at": now}},
            upsert=True,
        )
        logger.info("doctor_pattern: stored for %s (verdict=%s, doctor=%s)",
                    case_id, doc["verdict"], effective_id)
    except Exception as exc:
        logger.error("doctor_pattern failed for %s: %s", case_id, exc)
        raise
    finally:
        client.close()


@celery_app.task(name="doctor_pattern.analyze", bind=True,
                 max_retries=1, default_retry_delay=30)
def doctor_pattern_task(self, case_id, doctor_id, trigger, conclusion):
    try:
        asyncio.run(_process(case_id, doctor_id, trigger, conclusion))
    except Exception as exc:
        raise self.retry(exc=exc)