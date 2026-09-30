"""
POST /web/generate-conclusion/{case_id}
Supports single trigger (claimTrigger field) and multi-trigger (triggers[] body param).

ASYNC: the actual generation (Pass 1 extraction, unified conclusion LLM
calls, validation/repair) now runs as a Celery task
(celery_worker/generate_conclusion_task.py) instead of inline in this
request — the old synchronous version could exceed Cloudflare's 524
origin timeout on large cases. This endpoint now only validates that
generation is possible (case exists, triggers selected, text available)
and enqueues the task; the frontend polls
/web/advanced-upload/status/{task_id}, same pattern as
regenerate-findings and run-agentic-investigation.

FIELD-OFFICER BRANCH POINT (added): _process_generate_conclusion now
checks whether this claim's raw_llama_markdown carries field-officer
[INV_TYPE/step_key] tags and, if so, calls the new tag-aware generator
(routes.agents.field_officer_report_agent.generate_field_officer_conclusion)
instead of the existing untagged generator
(merge_utils.registry.generate_unified_conclusion). Every other step in
this pipeline — Pass 1 extraction, template field extraction, auto-fill,
validation, verdict-alignment repair, reconciliation, storage — is
UNCHANGED and shared by both branches, since both generators return the
identical {conclusion, status, failed_sections, verdict, specialistFindings}
shape (see the docstrings on each generator).
"""
from __future__ import annotations
from routes.agents.preprocessor import reconcile_conclusion, parse_reviewer_annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import re
from fastapi import APIRouter, HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel
import os
from routes.agents.preprocessor import preprocess
from routes.agents.base import run_pass1
from merge_utils.registry import generate_unified_conclusion, TRIGGER_LABELS
from routes.agents.investigation_checklist import has_field_officer_tags
from routes.agents.field_officer_report_agent import generate_field_officer_conclusion
from celery_client import celery_client
from datetime import datetime, timezone, timedelta
IST = timezone(timedelta(hours=5, minutes=30))

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Conclusion"])

motor_client = AsyncIOMotorClient(os.getenv("MONGO_URI"))
db = motor_client["doctorassistai"]
insurance_claims_col = db["insurance_claims_new"]
advanced_upload_tasks_col = db["advanced_upload_tasks"]
template_extractions_col = db["template_field_extractions"]


class ConclusionRequest(BaseModel):
    triggers: Optional[List[str]] = None
    additional_context: Optional[str] = None
    selected_findings: Optional[List[Dict[str, Any]]] = None  # doctor-selected findings from Investigation Review — informational only, see unified_report_agent.py

def _force_verdict_alignment(
    conclusion: str,
    verdict: str,
    disc: str = "",
) -> str:
    """
    The story-based pipelines (both the original and the field-officer-aware
    one) write verdict sentences like "appears Genuine as an advisory read"
    / "appears Suspected as an advisory read" — not the old fixed "found to
    be Genuine"/"claim found to be Suspected" phrases — so this only needs
    to catch the one real failure mode: the computed verdict is SUSPECTED
    but the sentence still reads Genuine. `disc` is accepted for call-site
    compatibility but unused — flags already live inline in each story,
    there is no separate discrepancy block to re-inject here.
    """
    if verdict != "SUSPECTED":
        return conclusion
    if "suspected" in conclusion.lower():
        return conclusion

    conclusion = re.sub(
        r"appears Genuine as an advisory read[^.]*\.",
        "appears Suspected as an advisory read for the reviewing doctor — "
        "manual review is recommended before any decision.",
        conclusion, count=1, flags=re.IGNORECASE,
    )
    if "suspected" not in conclusion.lower():
        conclusion = conclusion.rstrip() + (
            "\n\n[VERDICT OVERRIDE] This claim requires manual review — "
            "please weigh the flags above; the narrative tone alone should "
            "not be read as a final Genuine determination."
        )
    return conclusion


def _get_nested(obj: dict, dotted_key: str):
    cur = obj
    for p in dotted_key.split("."):
        if not isinstance(cur, dict) or p not in cur:
            return None
        cur = cur[p]
    return cur


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
    report_verdict: str,
) -> List[str]:
    """
    Both pipelines write free-flowing narrative accounts, not a
    field-by-field template — so checks that assumed exact wording ("the
    word 'stable' must not appear", "70%+ of complaints must appear as
    substrings", "discrepancies_verbatim must appear verbatim") no longer
    apply and would fire on essentially every well-written conclusion.
    Kept: the two checks that are still meaningful regardless of writing
    style — verdict-word/verdict-field agreement, and the bill figure
    actually being mentioned somewhere.
    """
    failures = []
    c = conclusion.lower()

    if report_verdict == "SUSPECTED" and "genuine" in c and "suspected" not in c:
        failures.append(
            "Verdict mismatch: conclusion reads Genuine but computed verdict is SUSPECTED."
        )

    gross = str(pass1.get("gross_bill_amount") or pass1.get("bill_amount") or "")
    if gross and gross[:4] not in conclusion:
        failures.append(f"Bill: gross amount '{gross}' not found in conclusion.")

    return failures


async def _process_generate_conclusion(
    case_id: str,
    triggers: List[str],
    additional_context: str,
    selected_findings: Optional[List[Dict[str, Any]]],
    insurance_claims_col=None,
    template_extractions_col=None,
) -> Dict[str, Any]:
    # Callers running inside their own asyncio.run() (e.g. the Celery task)
    # must pass their own loop-scoped collection — the module-level
    # `insurance_claims_col` global is bound to whichever event loop first
    # used it and breaks with "Event loop is closed" once that loop is
    # torn down and a later task's fresh loop tries to reuse it.
    if insurance_claims_col is None:
        insurance_claims_col = globals()["insurance_claims_col"]
    if template_extractions_col is None:
        template_extractions_col = globals()["template_extractions_col"]
    """
    Does the actual generation work: Pass 1 extraction, unified conclusion
    generation, validation + repair, storage. Called by the Celery task
    (celery_worker/generate_conclusion_task.py). Raises on unrecoverable
    errors — the task's try/except turns that into a "failed" status row
    the frontend can surface, same convention as
    celery_worker/regenerate_findings_task.py.

    NOTE: this assumes the caller (the HTTP endpoint) already validated
    that the case exists, triggers were selected, and raw text is present
    — those are re-checked here defensively but errors here should be rare
    since the endpoint checks them synchronously before enqueueing.
    """
    claim = await insurance_claims_col.find_one({"caseId": case_id})
    if not claim:
        raise ValueError(f"Case {case_id} not found.")

    raw_text: Optional[str] = (claim.get("raw_llama_markdown") or "").strip()
    if not raw_text:
        raise ValueError("No document text found. Please upload at least one document.")

    # ── Branch point (field-officer-aware pipeline) ──────────────────────
    # Checked on raw_llama_markdown exactly as stored on the claim, before
    # the patient-name-based document filtering just below (which splits on
    # "=== NEW DOCUMENT ===", a delimiter field-officer content never
    # contains — it's PDF_START/PAGE_START-marked instead) can touch it
    # either way. If this claim has ANY [INV_TYPE/step_key] tag anywhere in
    # its parsed documents, generation routes to the new tag-aware
    # generator; every claim without such a tag takes the existing,
    # completely untouched path.
    is_field_officer_case = has_field_officer_tags(raw_text)

    documents = raw_text.split("=== NEW DOCUMENT ===")
    filtered_docs = []
    claim_patient_name = (claim.get("patient_name") or claim.get("claimantName") or "").strip()

    if claim_patient_name:
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

    if is_field_officer_case and len(filtered_docs) < len(documents):
        # The patient-name filter above assumes "=== NEW DOCUMENT ==="-
        # delimited content; field-officer markdown never contains that
        # delimiter, so `documents` is a single element for these claims —
        # the filter can only ever keep-or-drop that ONE giant blob, never
        # partially filter it. If it got dropped, raw_text is now empty
        # even though the claim clearly has real content; surface that
        # loudly rather than silently proceeding on empty text.
        logger.warning(
            "generate_conclusion | case=%s | field-officer claim's single "
            "undelimited document blob was dropped by the patient-name "
            "filter (claim_patient_name=%r) — this filter was designed for "
            "the old '=== NEW DOCUMENT ==='-delimited format and may not "
            "apply cleanly to tag-based content; check raw_text emptiness.",
            case_id, claim_patient_name,
        )

    logger.info(
        "generate_conclusion | case=%s | triggers=%s | text_len=%d | field_officer_case=%s",
        case_id, triggers, len(raw_text), is_field_officer_case
    )
    pass1_result, raw_text = await run_pass1(raw_text)
    pre_extracted = claim.get("pre_extracted_facts", {}) or {}
    for key, val in pre_extracted.items():
        if val is not None and pass1_result.get(key) is None:
            pass1_result[key] = val

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

    preprocessed = preprocess(pass1_result)

    _annotations = parse_reviewer_annotations(additional_context or "")

    from services.pdf_generator import resolve_template
    from services.template_field_manifests import get_manifest_or_default
    from services.template_field_extractor import extract_all_manifest_fields

    template_config = resolve_template(
        insurer=claim.get("insurer", ""), tpa=claim.get("tpaName", ""),
        claim_mode=claim.get("claimMode", ""), case_data=claim,
    )
    manifest = get_manifest_or_default(template_config.get("template"))

    if is_field_officer_case:
        conclusion_coro = generate_field_officer_conclusion(
            case_id=case_id,
            claim=claim,
            triggers=triggers,
            text=raw_text,
            pass1_result=pass1_result,
            preprocessed=preprocessed,
            additional_context=additional_context,
            selected_findings=selected_findings,
        )
    else:
        conclusion_coro = generate_unified_conclusion(
            triggers=triggers,
            text=raw_text,
            pass1_result=pass1_result,
            preprocessed=preprocessed,
            additional_context=additional_context,
            selected_findings=selected_findings,
        )

    field_candidates_by_key, _generation_result = await asyncio.gather(
        extract_all_manifest_fields(raw_text, manifest, claim),
        conclusion_coro,
    )

    try:
        await template_extractions_col.update_one(
            {"caseId": case_id},
            {"$set": {
                "caseId": case_id,
                "template": template_config.get("template"),
                "generatedAt": datetime.now(IST),
                "fields": field_candidates_by_key,
            }},
            upsert=True,
        )
        logger.info(
            "Stored %d field candidates for case %s (template=%s)",
            len(field_candidates_by_key), case_id, template_config.get("template"),
        )
    except Exception:
        logger.exception("Failed to persist template field extractions for %s", case_id)

    # Auto-fill: for any manifest field with exactly ONE extracted candidate
    # and no existing value on the claim, write it straight into the claim
    # doc's nested field. Fields with 2+ candidates are left for the doctor
    # to pick via the resolved-fields UI — only unambiguous single-candidate
    # fields get auto-populated, so the PDF/DOCX (which read the claim doc
    # directly, not template_field_extractions) actually show what Pass 1
    # found instead of staying blank until a human manually applies a chip.
    try:
        auto_fill_set = {}
        for field_key, candidates in field_candidates_by_key.items():
            if not candidates or len(candidates) != 1:
                continue
            cand = candidates[0]
            if cand.get("manual"):
                continue  # this candidate IS the existing case value — nothing to fill
            existing = _get_nested(claim, field_key)
            if existing not in (None, "", [], {}):
                continue
            if cand.get("rows") is not None:
                value = cand["rows"]
            elif cand.get("raw_phrase") is not None:
                value = cand.get("interpreted") or cand.get("raw_phrase")
            else:
                value = cand.get("value")
            if value in (None, ""):
                continue
            auto_fill_set[field_key] = value

        if auto_fill_set:
            await insurance_claims_col.update_one(
                {"caseId": case_id},
                {"$set": auto_fill_set},
            )
            logger.info(
                "Auto-filled %d unambiguous fields onto claim %s: %s",
                len(auto_fill_set), case_id, list(auto_fill_set.keys()),
            )
    except Exception:
        logger.exception("Failed to auto-fill extracted fields onto claim %s", case_id)

    conclusion_text = _generation_result["conclusion"]
    report_status = _generation_result["status"]
    report_failed_sections = _generation_result["failed_sections"]
    report_verdict = _generation_result["verdict"]

    failures = _validate_conclusion(conclusion_text, pass1_result, preprocessed, report_verdict)

    if failures:
        logger.warning("Conclusion validation failures for %s: %s", case_id, failures)
        conclusion_text = _force_verdict_alignment(
            conclusion_text,
            report_verdict,
            disc=pass1_result.get("discrepancies_verbatim", ""),
        )
        retry_failures = _validate_conclusion(conclusion_text, pass1_result, preprocessed, report_verdict)
        if retry_failures:
            logger.warning("Validation still failing after alignment for %s: %s", case_id, retry_failures)

    if report_verdict == "SUSPECTED":
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

    # NOTE: the old stale-discrepancy re-injection block (which searched for
    # a "SECTION 2 ... DISCREPANCIES" region) is removed — both pipelines'
    # flags are already generated precisely inline within their story
    # sections and a final cross-section/conclusion discrepancy list (see
    # unified_report_agent.py and field_officer_report_agent.py), so there
    # is no separate Pass-1-verbatim block that needs to be force-inserted
    # here anymore.
    conclusion_text = reconcile_conclusion(conclusion_text, pass1_result, _annotations)
    if not conclusion_text:
        raise ValueError("Conclusion generation returned empty result. Please retry.")



    now = datetime.now(IST)
    trigger_labels = [TRIGGER_LABELS.get(t, t) for t in triggers]

    await insurance_claims_col.update_one(
        {"caseId": case_id},
        {"$set": {
            "conclusion":              conclusion_text,
            "conclusionGeneratedAt":   now,
            "conclusionTriggers":      triggers,
            "conclusionTriggerLabels": trigger_labels,
            "reportStatus":            report_status,
            "reportFailedSections":    report_failed_sections,
            "updatedAt":               now,
        }}
    )

    logger.info(
        "Conclusion stored | case=%s | triggers=%s | chars=%d",
        case_id, triggers, len(conclusion_text)
    )

    return {
        "success":         True,
        "case_id":         case_id,
        "triggers":        triggers,
        "trigger_labels":  trigger_labels,
        "conclusion":      conclusion_text,
        "status":          report_status,
        "failed_sections": report_failed_sections,
        "chars":           len(conclusion_text),
        "generated_at":    now.isoformat(),
    }


@router.post("/web/generate-conclusion/{case_id}")
async def generate_conclusion_endpoint(
    case_id: str,
    request: Request,
    body: ConclusionRequest = ConclusionRequest(),
):
    """
    Validates and enqueues conclusion generation as a Celery task. Returns
    task_id immediately — the frontend (GenerateConclusionBar.jsx) polls
    GET /web/advanced-upload/status/{task_id} until status is "success" or
    "failed", same pattern as regenerate-findings and
    run-agentic-investigation.
    """
    _get_user(request)

    claim = await insurance_claims_col.find_one(
        {"caseId": case_id}, {"_id": 0, "raw_llama_markdown": 1, "claimTriggers": 1}
    )
    if not claim:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found.")

    triggers: List[str] = []
    if body.triggers:
        triggers = [t.strip() for t in body.triggers if t.strip()]
    elif claim.get("claimTriggers"):
        triggers = [t for t in claim["claimTriggers"] if t]

    if not triggers:
        raise HTTPException(
            status_code=400,
            detail="No triggers selected. Please select at least one trigger."
        )

    raw_text = (claim.get("raw_llama_markdown") or "").strip()
    if not raw_text:
        raise HTTPException(
            status_code=422,
            detail="No document text found. Please upload at least one document."
        )

    task_id = f"conclusion_{uuid.uuid4().hex}"
    now = datetime.now(IST)
    await advanced_upload_tasks_col.insert_one({
        "task_id":        task_id,
        "case_id":        case_id,
        "doc_id":         None,
        "task_type":      "conclusion",  # excluded from the "Extracting" dashboard badge,
                                           # same convention as "findings" / "agentic_investigation"
        "file_name":      "Conclusion generation",
        "display_label":  "Conclusion generation",
        "supervisor_id":  None,
        "status":         "queued",
        "result":         None,
        "error":          None,
        "total_pages":    None,
        "created_at":     now,
        "updated_at":     now,
    })

    celery_client.send_task(
        "generate_conclusion.run",
        kwargs={
            "task_id": task_id,
            "case_id": case_id,
            "triggers": triggers,
            "additional_context": body.additional_context or "",
            "selected_findings": body.selected_findings,
        },
        task_id=task_id,
        queue="advanced_upload_queue",
    )

    return {
        "success": True,
        "status": "queued",
        "task_id": task_id,
        "case_id": case_id,
        "triggers": triggers,
        "message": "Conclusion generation queued.",
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