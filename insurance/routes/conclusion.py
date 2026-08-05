"""
POST /web/generate-conclusion/{case_id}
Supports single trigger (claimTrigger field) and multi-trigger (triggers[] body param).
"""
from __future__ import annotations
from routes.agents.preprocessor import reconcile_conclusion, parse_reviewer_annotations
from routes.agents.preprocessor import parse_conclusion_struct, render_conclusion as _render

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import re
from fastapi import APIRouter, HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel
import os
from routes.agents.preprocessor import preprocess
from routes.agents.base import run_pass1
from merge_utils.registry import (
    generate_conclusion,
    generate_multi_conclusion,
    generate_unified_conclusion,
    TRIGGER_LABELS,
)
from datetime import datetime, timezone, timedelta
IST = timezone(timedelta(hours=5, minutes=30))

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Conclusion"])

motor_client = AsyncIOMotorClient(os.getenv("MONGO_URI"))
db = motor_client["doctorassistai"]
insurance_claims_col = db["insurance_claims_new"]
case_documents_col = db["case_documents"]


class ConclusionRequest(BaseModel):
    triggers: Optional[List[str]] = None
    additional_context: Optional[str] = None   # ← add this


def _force_verdict_alignment(
    conclusion: str,
    verdict: str,
    disc: str = "",
) -> str:
    if verdict != "SUSPECTED":
        return conclusion

    # Fix body contradiction first
    if disc:
        conclusion = re.sub(
            r"No major discrepancies were noted\.?",
            f"Kindly note —\n{disc}",
            conclusion,
            flags=re.IGNORECASE,
        )
        conclusion = re.sub(
            r"hospitalisation seems to be genuine based on[^.]*\.",
            "claim has discrepancies as noted above.",
            conclusion,
            flags=re.IGNORECASE,
        )

    # Then fix the final verdict line
    replacements = [
        (
            "admission is verified and claim found to be Genuine",
            "admission is verified and claim found to be Suspected",
        ),
        (
            "found to be Genuine",
            "found to be Suspected",
        ),
        (
            "claim found to be Genuine",
            "claim found to be Suspected",
        ),
    ]
    for old, new in replacements:
        if old in conclusion:
            conclusion = conclusion.replace(old, new)
            return conclusion

    conclusion = conclusion.rstrip()
    conclusion += (
        "\n\nRECOMMENDATION\n"
        "As per the verification, admission is verified and "
        "claim found to be Suspected."
    )
    return conclusion

def _get_user(request: Request) -> dict:
    uid = request.headers.get("X-User-Id")
    role = request.headers.get("X-User-Role")
    if uid:
        return {"user_id": uid, "role": role}
    from jose import jwt
    auth = request.headers.get("authorization", "")
    if not auth:
        raise HTTPException(status_code=401, detail="Missing auth")
    try:
        token = auth.split(" ")[1]
        payload = jwt.decode(
            token,
            os.getenv("SECRET_KEY"),
            algorithms=[os.getenv("ALGORITHM", "HS256")]
        )
        return {"user_id": payload.get("sub"), "role": payload.get("role")}
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

def _validate_conclusion(
    conclusion: str,
    pass1: Dict[str, Any],
    preprocessed: Dict[str, Any],
) -> List[str]:
    failures = []
    c = conclusion.lower()

    # Verdict check — only flag if BOTH genuine present AND suspected absent
    verdict = preprocessed["verdict_override"]
    if verdict == "SUSPECTED" and "genuine" in c and "suspected" not in c:
        failures.append(
            "Verdict mismatch: conclusion says Genuine but verdict_override is SUSPECTED."
        )

    # Vitals check
    if "stable" in c:
        vitals_available = preprocessed.get("vitals_formatted") or pass1.get("vitals_on_admission")
        if vitals_available:
            failures.append("Vitals: the word 'stable' appears — must be replaced with exact values.")

    # Bill check
    gross = str(pass1.get("gross_bill_amount") or pass1.get("bill_amount") or "")
    if gross and gross[:4] not in conclusion:
        failures.append(f"Bill: gross amount '{gross}' not found in conclusion.")

    # Chief complaints check
    complaints = preprocessed.get("complaints_list", [])
    missing_c = [c2 for c2 in complaints if c2.lower()[:10] not in conclusion.lower()]
    if len(missing_c) > len(complaints) * 0.3:
        failures.append(
            f"Chief complaints: {len(missing_c)} of {len(complaints)} items missing: "
            + str(missing_c[:3])
        )

    # Discrepancy block check — ONLY if verbatim came from actual document
    # not from synthetic auto-generation. Skip if conclusion already
    # contains discrepancy section content.
    disc = (pass1.get("discrepancies_verbatim") or "").strip()
    conclusion_lower = conclusion.lower()
    disc_already_present = (
        "discrepanc" in conclusion_lower
        or "kindly note" in conclusion_lower
        or "single stretch" in conclusion_lower
        or "missing" in conclusion_lower
        or "billing mismatch" in conclusion_lower
    )
    if disc and len(disc) > 50 and not disc_already_present:
        normalized_disc = " ".join(disc.split())[:180]
        normalized_conc = " ".join(conclusion.split())
        if normalized_disc not in normalized_conc:
            failures.append(
                "Discrepancy block: exact verbatim block missing."
            )

    return failures

async def _repair_conclusion(
    conclusion: str,
    failures: List[str],
    pass1: Dict[str, Any],
    preprocessed: Dict[str, Any],
    annotations: Optional[List[Dict[str, Any]]] = None,   # ← add this
) -> str:
    from routes.agents.base import call_groq, SHARED_RULES

    # Safety: if only verdict mismatch, fix it directly without LLM call
    if (
        len(failures) == 1
        and "Verdict mismatch" in failures[0]
    ):
        return _force_verdict_alignment(conclusion, preprocessed["verdict_override"])

    failure_text = "\n".join(f"- {f}" for f in failures)
    ann_text = ""
    if annotations:
        ann_text = "\n".join(
            f"- Reviewer flagged on \"{a['highlighted_text']}\": {a['note']}"
            for a in annotations
        )

    user = f"""
The following investigation report conclusion has errors that must be fixed.

ERRORS TO FIX:
{failure_text}

BINDING FACTS (use these exact values):
Verdict: {preprocessed['verdict_override']}
Bill: {preprocessed['bill_block']}
Chief complaints (ALL must appear): {preprocessed['complaints_list']}
Vitals on admission (exact, use this — do NOT write "stable"): {preprocessed.get('vitals_formatted') or pass1.get('vitals_on_admission') or 'Not documented in source records'}
Vitals at discharge (exact): {pass1.get('vitals_at_discharge') or 'Not documented in source records'}
Discrepancies verbatim block: {pass1.get('discrepancies_verbatim') or 'None'}

Reviewer annotations (MUST be addressed in the conclusion, verbatim where possible):
{ann_text or 'None'}
ORIGINAL CONCLUSION:
{conclusion}

Return the corrected conclusion as a JSON object: {{"conclusion": "..."}}
STRICT REPAIR RULES:
- Return the COMPLETE conclusion with ALL sections intact.
- Fix ONLY the listed missing or incorrect sections.
- Do NOT rewrite correct sections.
- Do NOT paraphrase discrepancies_verbatim.
- Do NOT remove valid complaints.
- Do NOT invent dates, symptoms, numbers, medicines, or billing values.
- Preserve section order and ALL newlines.
- The returned conclusion MUST be at least as long as the original.
- If verdict mismatch exists, repair ONLY final recommendation line.
"""

    system = (
        SHARED_RULES
        + "You are a medical investigation report editor. Fix only the listed errors. "
        "Return the COMPLETE report, not just the fixed section."
    )

    result = await call_groq(system, user, max_tokens=6000)
    repaired = result.get("conclusion") or ""

    # Safety: if repair returned something shorter than half the original, reject it
    if len(repaired) < len(conclusion) * 0.5:
        logger.warning(
            "Repair returned truncated result (%d chars vs %d original) — keeping original",
            len(repaired),
            len(conclusion),
        )
        return conclusion

    return repaired

@router.post("/web/generate-conclusion/{case_id}")
async def generate_conclusion_endpoint(
    case_id: str,
    request: Request,
    body: ConclusionRequest = ConclusionRequest(),
):
    _get_user(request)

    # ── 1. Fetch claim ────────────────────────────────────────────────────
    claim = await insurance_claims_col.find_one({"caseId": case_id})
    if not claim:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found.")

    # ── 2. Determine triggers ─────────────────────────────────────────────
    # Priority: body.triggers → claim.claimTriggers (array) → claim.claimTrigger (string)
    triggers: List[str] = []

    if body.triggers:
        triggers = [t.strip() for t in body.triggers if t.strip()]
    elif claim.get("claimTriggers"):
        # Support array field on claim
        triggers = [t for t in claim["claimTriggers"] if t]

    if not triggers:
        raise HTTPException(
            status_code=400,
            detail="No triggers selected. Please select at least one trigger."
        )

    # ── 3. Get raw markdown ───────────────────────────────────────────────
    raw_text: Optional[str] = (claim.get("raw_llama_markdown") or "").strip()

    if not raw_text:
        doc_record = await case_documents_col.find_one({"case_id": case_id})
        if doc_record:
            for doc in doc_record.get("documents", []):
                candidate = (doc.get("raw_markdown") or "").strip()
                if candidate:
                    raw_text = candidate
                    break

    if not raw_text:
        raise HTTPException(
            status_code=422,
            detail="No document text found. Please upload at least one document."
        )

    if raw_text:
        documents = raw_text.split("=== NEW DOCUMENT ===")
        filtered_docs = []
        claim_patient_name = (claim.get("patient_name") or claim.get("claimantName") or "").strip()

        if claim_patient_name:
            import re

            def _name_tokens(name: str):
                clean = re.sub(r"\b(mr|mrs|ms|dr|master)\.?\b", "", name.lower())
                return set(t.strip() for t in clean.split() if len(t.strip()) > 1)

            def _names_overlap(name_a: str, name_b: str) -> bool:
                tokens_a = _name_tokens(name_a)
                tokens_b = _name_tokens(name_b)
                if not tokens_a or not tokens_b:
                    return True
                common = tokens_a & tokens_b
                min_tokens = min(len(tokens_a), len(tokens_b))
                return len(common) >= max(1, min_tokens // 2)

            for doc in documents:
                search_window = doc[:1500]
                name_patterns = [
                    r"Patient\s*Name\s*[:\s]+([A-Za-z][A-Za-z\.\s]{2,40}?)(?:\n|\||\t|Gender|Age|DOB|UHID)",
                    r"Name\s*[:\*]+\s*([A-Za-z][A-Za-z\.\s]{2,40}?)(?:\n|\||\t|Gender|Age|DOB)",
                    r"\*\*Name\s*:\s*\*\*\s*([A-Za-z][A-Za-z\.\s]{2,40}?)(?:\n)",
                ]
                doc_patient_name = None
                for pat in name_patterns:
                    m = re.search(pat, search_window, re.IGNORECASE)
                    if m:
                        candidate = m.group(1).strip()
                        if len(candidate) >= 2 and not re.search(
                            r"\b(male|female|ward|bed|ip|uhid|date)\b",
                            candidate.lower(),
                        ):
                            doc_patient_name = candidate
                            break

                if doc_patient_name and not _names_overlap(claim_patient_name, doc_patient_name):
                    logger.info(
                        "Filtered out document for patient '%s' (claim patient: '%s')",
                        doc_patient_name,
                        claim_patient_name,
                    )
                    continue

                filtered_docs.append(doc)

        else:
            filtered_docs = documents

        raw_text = "=== NEW DOCUMENT ===".join(filtered_docs)

    # ── 4. Build extracted_flat ───────────────────────────────────────────
    EXCLUDE = {"_id", "raw_llama_markdown", "conclusion", "conclusionParts"}
    extracted_flat: Dict[str, Any] = {
        k: v for k, v in claim.items()
        if k not in EXCLUDE and v is not None
    }

    # ── 5. Run Pass 1 ─────────────────────────────────────────────────────
    logger.info(
        "generate_conclusion | case=%s | triggers=%s | text_len=%d",
        case_id, triggers, len(raw_text)
    )
    # ── 5. Run Pass 1 ─────────────────────────────────────────
    pass1_result, raw_text = await run_pass1(raw_text)
    from routes.agents.base import translate_regional_text
    raw_text = translate_regional_text(raw_text)  # ← raw_text now in English

    # CRITICAL: allow preprocess fallback extractor
    # to search original raw markdown
    pre_extracted = claim.get("pre_extracted_facts", {}) or {}
    for key, val in pre_extracted.items():
        if val is not None and pass1_result.get(key) is None:
            pass1_result[key] = val

    # Force critical chart anomaly fields from pre_extracted
    # even if pass1 returned something — pre_extracted is ground truth
    force_keys = [
        "vitals_chart_dates_present",
        "vitals_chart_single_stretch",
        "nurses_notes_dates_present",
        "nurses_notes_single_stretch",
        "medication_chart_ip_number_present",
        "medication_chart_time_date_present",
        "investigation_result_chart_status",
        "pharmacy_register_collected",
        "discrepancies_verbatim",
        "final_verdict_verbatim",
    ]
    for key in force_keys:
        val = pre_extracted.get(key)
        if val is not None:
            pass1_result[key] = val
    
    from routes.agents.preprocessor import detect_chart_quality_from_markdown
    chart_quality = detect_chart_quality_from_markdown(raw_text)
    for key, val in chart_quality.items():
        if pass1_result.get(key) is None:
            pass1_result[key] = val

    extracted_flat["raw_llama_markdown"] = raw_text

    preprocessed = preprocess(
        pass1_result,
        extracted_flat,
    )

        # Pull reviewer annotations from request body
    additional_context = getattr(body, "additional_context", None) or ""
    _annotations = parse_reviewer_annotations(additional_context)

    conclusion_text = await generate_unified_conclusion(
        triggers=triggers,
        text=raw_text,
        pass1_result=pass1_result,
        extracted_flat=extracted_flat,
        preprocessed=preprocessed,
        additional_context=additional_context,   # ← add this
    )
 

    # ── Struct path: field-level alignment, no regex ──────────────────────
    _struct = parse_conclusion_struct(conclusion_text)
    struct_path_used = False

    if _struct:
        if _struct["verdict"] != preprocessed["verdict_override"]:
            _struct["verdict"] = preprocessed["verdict_override"]
        if _struct["verdict"] == "SUSPECTED" and not _struct["discrepancies"]:
            disc = pass1_result.get("discrepancies_verbatim", "")
            _struct["discrepancies"] = [disc] if disc else ["Refer to investigation notes."]
        conclusion_text = _render(_struct, pass1_result, preprocessed["verdict_override"])
        struct_path_used = True

    # ── Prose path: string-based validation + repair (fallback only) ──────
    if not struct_path_used:
        failures = _validate_conclusion(
            conclusion_text,
            pass1_result,
            preprocessed,
        )

        if failures:
            logger.warning("Conclusion validation failures for %s: %s", case_id, failures)
            original_conclusion = conclusion_text
            repaired = await _repair_conclusion(
                conclusion_text, failures, pass1_result, preprocessed,annotations=_annotations,
            )
            if len(repaired) >= len(original_conclusion) * 0.5:
                conclusion_text = repaired
            else:
                logger.warning(
                    "Repair truncated report for %s (%d→%d chars) — keeping original",
                    case_id, len(original_conclusion), len(repaired),
                )
                conclusion_text = _force_verdict_alignment(
                    original_conclusion,
                    preprocessed["verdict_override"],
                    disc=pass1_result.get("discrepancies_verbatim", ""),
                )

            retry_failures = _validate_conclusion(
                conclusion_text, pass1_result, preprocessed,
            )
            if retry_failures:
                logger.warning("Repair still failed for %s: %s", case_id, retry_failures)

        # Verdict safeguards — prose path only
        if preprocessed["verdict_override"] == "SUSPECTED":
            c = conclusion_text.lower()
            if "genuine" in c and "suspected" not in c:
                logger.warning("Forcing verdict correction for %s", case_id)
                conclusion_text = _force_verdict_alignment(
                    conclusion_text,
                    "SUSPECTED",
                    disc=pass1_result.get("discrepancies_verbatim", ""),
                )

        raw_lower = raw_text.lower()
        conclusion_lower = conclusion_text.lower()
        if (
            re.search(
                r"(claim seems to be|found to be|verdict|recommend)[^\n]*suspected",
                raw_lower,
            )
            and "genuine" in conclusion_lower
            and "suspected" not in conclusion_lower
        ):
            logger.warning(
                "Verdict mismatch detected: raw indicates SUSPECTED, "
                "conclusion says GENUINE. Forcing repair for %s", case_id,
            )
            conclusion_text = _force_verdict_alignment(
                conclusion_text,
                "SUSPECTED",
                disc=pass1_result.get("discrepancies_verbatim", ""),
            )

        disc = (pass1_result.get("discrepancies_verbatim") or "").strip()
        if disc and len(disc) > 20:
            normalized_disc = " ".join(disc.split())
            normalized_conc = " ".join(conclusion_text.split())
            if normalized_disc not in normalized_conc:
                logger.warning(
                    "Discrepancy block missing in conclusion. Replacing Section 2 for %s",
                    case_id,
                )
                insert_block = f"DISCREPANCIES\nKindly note —\n{disc}\n"
                conclusion_text = re.sub(
                    r'(SECTION 2[^\n]*\n.*?DISCREPANCIES.*?)(None|no discrepancies noted\.?)',
                    r'\1' + disc,
                    conclusion_text, count=1, flags=re.DOTALL | re.IGNORECASE,
                )
                if normalized_disc not in " ".join(conclusion_text.split()):
                    if "SECTION 3" in conclusion_text:
                        conclusion_text = conclusion_text.replace(
                            "SECTION 3", f"{insert_block}\nSECTION 3", 1,
                        )
    conclusion_text = reconcile_conclusion(conclusion_text, pass1_result, _annotations)
    if not conclusion_text:
        raise HTTPException(
            status_code=500,
            detail="Conclusion generation returned empty result. Please retry."
        )

    # ── 7. Store conclusion ───────────────────────────────────────────────
    now = datetime.now(IST)
    trigger_labels = [TRIGGER_LABELS.get(t, t) for t in triggers]

    await insurance_claims_col.update_one(
        {"caseId": case_id},
        {"$set": {
            "conclusion":              conclusion_text,
            "conclusionGeneratedAt":   now,
            "conclusionTriggers":      triggers,
            "conclusionTriggerLabels": trigger_labels,
            "updatedAt":               now,
        }}
    )

    logger.info(
        "Conclusion stored | case=%s | triggers=%s | chars=%d",
        case_id, triggers, len(conclusion_text)
    )

    return {
        "success":        True,
        "case_id":        case_id,
        "triggers":       triggers,
        "trigger_labels": trigger_labels,
        "conclusion":     conclusion_text,
        "chars":          len(conclusion_text),
        "generated_at":   now.isoformat(),
    }


@router.get("/web/conclusion/{case_id}")
async def get_conclusion(case_id: str, request: Request):
    _get_user(request)

    claim = await insurance_claims_col.find_one(
        {"caseId": case_id},
        {
            "_id": 0,
            "conclusion": 1,
            "conclusionTrigger": 1,
            "conclusionTriggers": 1,
            "conclusionTriggerLabels": 1,
            "conclusionGeneratedAt": 1,
        }
    )
    if not claim:
        raise HTTPException(status_code=404, detail="Case not found.")

    conclusion = claim.get("conclusion")
    if not conclusion:
        return {
            "success":  False,
            "case_id":  case_id,
            "conclusion": None,
            "message":  "No conclusion generated yet."
        }

    generated_at = claim.get("conclusionGeneratedAt")
    if isinstance(generated_at, datetime):
        generated_at = generated_at.isoformat()

    return {
        "success":        True,
        "case_id":        case_id,
        "triggers":       claim.get("conclusionTriggers") or [claim.get("conclusionTrigger")],
        "trigger_labels": claim.get("conclusionTriggerLabels", []),
        "conclusion":     conclusion,
        "generated_at":   generated_at,
    }